"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const coordinator = require("../../agents/runtime/recovery/intelligence/autonomousRecoveryCoordinator.cjs");
const degraded    = require("../../agents/runtime/recovery/intelligence/degradedModeManager.cjs");
const isolation   = require("../../agents/runtime/recovery/intelligence/executionIsolationController.cjs");
const failover    = require("../../agents/runtime/recovery/intelligence/adaptiveFailoverEngine.cjs");
const healing     = require("../../agents/runtime/recovery/intelligence/runtimeSelfHealingEngine.cjs");
const policy      = require("../../agents/runtime/recovery/intelligence/stabilizationPolicyEngine.cjs");

// ── autonomousRecoveryCoordinator ─────────────────────────────────────
describe("autonomousRecoveryCoordinator", () => {
    beforeEach(() => coordinator.reset());

    it("triggers recovery and returns recoveryId", () => {
        const r = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "bottleneck", severity: "high" });
        assert.equal(r.triggered, true);
        assert.ok(r.recoveryId.startsWith("recovery-"));
        assert.equal(r.workflowId, "wf-1");
    });

    it("rejects trigger without workflowId", () => {
        const r = coordinator.triggerRecovery({ trigger: "crash", severity: "critical" });
        assert.equal(r.triggered, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("rejects unknown trigger", () => {
        const r = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "alien", severity: "low" });
        assert.equal(r.triggered, false);
        assert.ok(r.reason.startsWith("invalid_trigger"));
    });

    it("rejects unknown severity", () => {
        const r = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "crash", severity: "mega" });
        assert.equal(r.triggered, false);
        assert.ok(r.reason.startsWith("invalid_severity"));
    });

    it("maps bottleneck+critical to quarantine action", () => {
        const r = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "bottleneck", severity: "critical" });
        assert.equal(r.action, "quarantine");
    });

    it("maps bottleneck+high to isolate action", () => {
        const r = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "bottleneck", severity: "high" });
        assert.equal(r.action, "isolate");
    });

    it("maps starvation to compensate action", () => {
        const r = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "starvation", severity: "high" });
        assert.equal(r.action, "compensate");
    });

    it("maps crash to restart action", () => {
        const r = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "crash", severity: "medium" });
        assert.equal(r.action, "restart");
    });

    it("maps timeout to failover action", () => {
        const r = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "timeout", severity: "high" });
        assert.equal(r.action, "failover");
    });

    it("maps pressure+critical to degrade action", () => {
        const r = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "pressure", severity: "critical" });
        assert.equal(r.action, "degrade");
    });

    it("starts recovery at L1", () => {
        const r = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "crash", severity: "critical" });
        const state = coordinator.getRecoveryState();
        assert.equal(state.activeRecoveries, 1);
    });

    it("escalates recovery from L1 to L2", () => {
        const t = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "pressure", severity: "high" });
        const e = coordinator.escalateRecovery({ recoveryId: t.recoveryId, reason: "still_degraded" });
        assert.equal(e.escalated, true);
        assert.equal(e.oldLevel, "L1");
        assert.equal(e.level, "L2");
        assert.ok(e.escalationId.startsWith("esc-"));
    });

    it("escalates recovery all the way to L4", () => {
        const t = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "cascade", severity: "critical" });
        coordinator.escalateRecovery({ recoveryId: t.recoveryId });
        coordinator.escalateRecovery({ recoveryId: t.recoveryId });
        const e = coordinator.escalateRecovery({ recoveryId: t.recoveryId });
        assert.equal(e.level, "L4");
    });

    it("refuses to escalate beyond L4", () => {
        const t = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "cascade", severity: "critical" });
        for (let i = 0; i < 3; i++) coordinator.escalateRecovery({ recoveryId: t.recoveryId });
        const e = coordinator.escalateRecovery({ recoveryId: t.recoveryId });
        assert.equal(e.escalated, false);
        assert.equal(e.reason, "already_at_max_escalation");
    });

    it("escalateRecovery requires recoveryId", () => {
        const r = coordinator.escalateRecovery({});
        assert.equal(r.escalated, false);
        assert.equal(r.reason, "recoveryId_required");
    });

    it("resolves recovery with healed resolution", () => {
        const t = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "crash", severity: "high" });
        const r = coordinator.resolveRecovery({ recoveryId: t.recoveryId, resolution: "healed" });
        assert.equal(r.resolved, true);
        assert.equal(r.resolution, "healed");
    });

    it("refuses to resolve already-resolved recovery", () => {
        const t = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "crash", severity: "low" });
        coordinator.resolveRecovery({ recoveryId: t.recoveryId, resolution: "healed" });
        const r = coordinator.resolveRecovery({ recoveryId: t.recoveryId, resolution: "healed" });
        assert.equal(r.resolved, false);
        assert.equal(r.reason, "recovery_already_resolved");
    });

    it("escalation fails on resolved recovery", () => {
        const t = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "crash", severity: "low" });
        coordinator.resolveRecovery({ recoveryId: t.recoveryId, resolution: "healed" });
        const e = coordinator.escalateRecovery({ recoveryId: t.recoveryId });
        assert.equal(e.escalated, false);
        assert.equal(e.reason, "recovery_not_active");
    });

    it("getRecoveryMetrics computes healRate", () => {
        const t1 = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "crash", severity: "low" });
        const t2 = coordinator.triggerRecovery({ workflowId: "wf-2", trigger: "crash", severity: "low" });
        coordinator.resolveRecovery({ recoveryId: t1.recoveryId, resolution: "healed" });
        coordinator.resolveRecovery({ recoveryId: t2.recoveryId, resolution: "failed" });
        const m = coordinator.getRecoveryMetrics();
        assert.equal(m.healRate, 0.5);
    });

    it("TRIGGER_ACTION_MAP and ESCALATION_LEVELS are exported", () => {
        assert.ok(typeof coordinator.TRIGGER_ACTION_MAP === "object");
        assert.equal(coordinator.ESCALATION_LEVELS.length, 4);
    });
});

// ── degradedModeManager ───────────────────────────────────────────────
describe("degradedModeManager", () => {
    beforeEach(() => degraded.reset());

    it("activates degraded mode and returns modeId", () => {
        const r = degraded.activateDegradedMode({ level: "partial", reason: "pressure" });
        assert.equal(r.activated, true);
        assert.ok(r.modeId.startsWith("mode-"));
        assert.equal(r.level, "partial");
    });

    it("rejects invalid degradation level", () => {
        const r = degraded.activateDegradedMode({ level: "ultra" });
        assert.equal(r.activated, false);
        assert.ok(r.reason.startsWith("invalid_level"));
    });

    it("activated mode has capability and disabled lists", () => {
        const r = degraded.activateDegradedMode({ level: "minimal" });
        assert.ok(Array.isArray(r.capabilities));
        assert.ok(Array.isArray(r.disabled));
        assert.ok(r.capabilities.length > 0);
        assert.ok(r.disabled.length > 0);
    });

    it("minimal level has fewest capabilities", () => {
        const min  = degraded.activateDegradedMode({ level: "minimal" });
        const full = degraded.activateDegradedMode({ level: "full" });
        assert.ok(min.capabilities.length < full.capabilities.length);
    });

    it("deactivates an active mode", () => {
        const a = degraded.activateDegradedMode({ level: "reduced" });
        const d = degraded.deactivateDegradedMode({ modeId: a.modeId });
        assert.equal(d.deactivated, true);
        assert.equal(d.modeId, a.modeId);
    });

    it("deactivateDegradedMode requires modeId", () => {
        const r = degraded.deactivateDegradedMode({});
        assert.equal(r.deactivated, false);
        assert.equal(r.reason, "modeId_required");
    });

    it("deactivateDegradedMode rejects unknown modeId", () => {
        const r = degraded.deactivateDegradedMode({ modeId: "mode-999" });
        assert.equal(r.deactivated, false);
        assert.equal(r.reason, "mode_not_found");
    });

    it("refuses to deactivate already-inactive mode", () => {
        const a = degraded.activateDegradedMode({ level: "partial" });
        degraded.deactivateDegradedMode({ modeId: a.modeId });
        const d = degraded.deactivateDegradedMode({ modeId: a.modeId });
        assert.equal(d.deactivated, false);
        assert.equal(d.reason, "mode_already_inactive");
    });

    it("evaluateDegradationThreshold returns shouldDegrade=false below thresholds", () => {
        const r = degraded.evaluateDegradationThreshold({ pressureScore: 0.3, bottleneckCount: 1 });
        assert.equal(r.shouldDegrade, false);
        assert.equal(r.recommendedLevel, null);
    });

    it("evaluateDegradationThreshold recommends minimal at critical pressure", () => {
        const r = degraded.evaluateDegradationThreshold({ pressureScore: 0.95 });
        assert.equal(r.shouldDegrade, true);
        assert.equal(r.recommendedLevel, "minimal");
    });

    it("evaluateDegradationThreshold recommends reduced at high pressure", () => {
        const r = degraded.evaluateDegradationThreshold({ pressureScore: 0.75 });
        assert.equal(r.shouldDegrade, true);
        assert.equal(r.recommendedLevel, "reduced");
    });

    it("evaluateDegradationThreshold recommends minimal for many bottlenecks", () => {
        const r = degraded.evaluateDegradationThreshold({ bottleneckCount: 6 });
        assert.equal(r.shouldDegrade, true);
        assert.equal(r.recommendedLevel, "minimal");
    });

    it("getDegradedModeState reports isInDegradedMode", () => {
        degraded.activateDegradedMode({ level: "reduced" });
        const s = degraded.getDegradedModeState();
        assert.equal(s.isInDegradedMode, true);
        assert.equal(s.activeModeCount, 1);
    });

    it("getDegradationMetrics tracks byLevel counts", () => {
        degraded.activateDegradedMode({ level: "minimal" });
        degraded.activateDegradedMode({ level: "minimal" });
        degraded.activateDegradedMode({ level: "partial" });
        const m = degraded.getDegradationMetrics();
        assert.equal(m.byLevel.minimal, 2);
        assert.equal(m.byLevel.partial, 1);
        assert.equal(m.totalModes, 3);
    });

    it("DEGRADATION_LEVELS exports 4 levels", () => {
        assert.equal(degraded.DEGRADATION_LEVELS.length, 4);
    });
});

// ── executionIsolationController ──────────────────────────────────────
describe("executionIsolationController", () => {
    beforeEach(() => isolation.reset());

    it("isolates a workflow into a zone", () => {
        const r = isolation.isolateExecution({ workflowId: "wf-1", zone: "recovery-zone" });
        assert.equal(r.isolated, true);
        assert.ok(r.isolationId.startsWith("iso-"));
        assert.equal(r.zone, "recovery-zone");
    });

    it("rejects isolation without workflowId", () => {
        const r = isolation.isolateExecution({ zone: "recovery-zone" });
        assert.equal(r.isolated, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("rejects isolation into invalid zone", () => {
        const r = isolation.isolateExecution({ workflowId: "wf-1", zone: "unknown-zone" });
        assert.equal(r.isolated, false);
        assert.ok(r.reason.startsWith("invalid_zone"));
    });

    it("allows moving to a stricter zone", () => {
        isolation.isolateExecution({ workflowId: "wf-1", zone: "degraded-zone" });
        const r = isolation.isolateExecution({ workflowId: "wf-1", zone: "recovery-zone" });
        assert.equal(r.isolated, true);
        assert.equal(r.zone, "recovery-zone");
    });

    it("blocks zone downgrade", () => {
        isolation.isolateExecution({ workflowId: "wf-1", zone: "recovery-zone" });
        const r = isolation.isolateExecution({ workflowId: "wf-1", zone: "degraded-zone" });
        assert.equal(r.isolated, false);
        assert.equal(r.reason, "zone_downgrade_not_allowed");
    });

    it("quarantines a workflow", () => {
        const r = isolation.quarantineExecution({ workflowId: "wf-bad" });
        assert.equal(r.quarantined, true);
        assert.ok(r.quarantineId.startsWith("quar-"));
    });

    it("rejects quarantine without workflowId", () => {
        const r = isolation.quarantineExecution({});
        assert.equal(r.quarantined, false);
    });

    it("refuses to quarantine already-quarantined workflow", () => {
        isolation.quarantineExecution({ workflowId: "wf-bad" });
        const r = isolation.quarantineExecution({ workflowId: "wf-bad" });
        assert.equal(r.quarantined, false);
        assert.equal(r.reason, "already_quarantined");
    });

    it("quarantine overrides existing zone placement", () => {
        isolation.isolateExecution({ workflowId: "wf-1", zone: "degraded-zone" });
        isolation.quarantineExecution({ workflowId: "wf-1" });
        const s = isolation.getIsolationState();
        assert.equal(s.quarantinedCount, 1);
        assert.equal(s.byZone["quarantine-zone"], 1);
        assert.equal(s.byZone["degraded-zone"], 0);
    });

    it("blocks isolation of quarantined workflow", () => {
        isolation.quarantineExecution({ workflowId: "wf-bad" });
        const r = isolation.isolateExecution({ workflowId: "wf-bad", zone: "recovery-zone" });
        assert.equal(r.isolated, false);
        assert.equal(r.reason, "workflow_is_quarantined");
    });

    it("releases isolation for non-quarantined workflow", () => {
        isolation.isolateExecution({ workflowId: "wf-1", zone: "degraded-zone" });
        const r = isolation.releaseIsolation({ workflowId: "wf-1" });
        assert.equal(r.released, true);
    });

    it("blocks release of quarantined workflow", () => {
        isolation.quarantineExecution({ workflowId: "wf-bad" });
        const r = isolation.releaseIsolation({ workflowId: "wf-bad" });
        assert.equal(r.released, false);
        assert.equal(r.reason, "quarantine_escape_blocked");
    });

    it("releaseIsolation fails for unknown workflow", () => {
        const r = isolation.releaseIsolation({ workflowId: "nobody" });
        assert.equal(r.released, false);
        assert.equal(r.reason, "isolation_not_found");
    });

    it("validateIsolationSafety detects quarantine escape", () => {
        isolation.quarantineExecution({ workflowId: "wf-bad" });
        const r = isolation.validateIsolationSafety({ workflowId: "wf-bad", targetZone: "safe-zone" });
        assert.equal(r.safe, false);
        assert.ok(r.violations.includes("quarantine_escape_blocked"));
    });

    it("validateIsolationSafety passes for valid upgrade", () => {
        isolation.isolateExecution({ workflowId: "wf-1", zone: "degraded-zone" });
        const r = isolation.validateIsolationSafety({ workflowId: "wf-1", targetZone: "recovery-zone" });
        assert.equal(r.safe, true);
    });

    it("getIsolationState byZone counts are accurate", () => {
        isolation.isolateExecution({ workflowId: "wf-a", zone: "degraded-zone" });
        isolation.isolateExecution({ workflowId: "wf-b", zone: "recovery-zone" });
        const s = isolation.getIsolationState();
        assert.equal(s.byZone["degraded-zone"], 1);
        assert.equal(s.byZone["recovery-zone"], 1);
    });

    it("ZONES exports 4 zones", () => {
        assert.equal(isolation.ZONES.length, 4);
    });
});

// ── adaptiveFailoverEngine ────────────────────────────────────────────
describe("adaptiveFailoverEngine", () => {
    beforeEach(() => failover.reset());

    it("registers a failover route", () => {
        const r = failover.registerFailoverRoute({ primaryId: "wf-primary", backupId: "wf-backup" });
        assert.equal(r.registered, true);
        assert.ok(r.routeId.startsWith("route-"));
        assert.equal(r.primaryId, "wf-primary");
        assert.equal(r.backupId, "wf-backup");
    });

    it("rejects route without primaryId", () => {
        const r = failover.registerFailoverRoute({ backupId: "wf-backup" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "primaryId_required");
    });

    it("rejects route without backupId", () => {
        const r = failover.registerFailoverRoute({ primaryId: "wf-primary" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "backupId_required");
    });

    it("rejects route with identical primary and backup", () => {
        const r = failover.registerFailoverRoute({ primaryId: "wf-same", backupId: "wf-same" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "primary_backup_must_differ");
    });

    it("triggers failover and returns failoverId", () => {
        failover.registerFailoverRoute({ primaryId: "wf-1", backupId: "wf-backup" });
        const r = failover.triggerFailover({ workflowId: "wf-1", reason: "timeout" });
        assert.equal(r.triggered, true);
        assert.ok(r.failoverId.startsWith("failover-"));
        assert.equal(r.backupId, "wf-backup");
    });

    it("triggerFailover requires workflowId", () => {
        const r = failover.triggerFailover({});
        assert.equal(r.triggered, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("triggerFailover fails with no registered route", () => {
        const r = failover.triggerFailover({ workflowId: "wf-orphan" });
        assert.equal(r.triggered, false);
        assert.equal(r.reason, "no_failover_route");
    });

    it("selects highest-priority route among multiple backups", () => {
        failover.registerFailoverRoute({ primaryId: "wf-1", backupId: "wf-b1", priority: 3 });
        failover.registerFailoverRoute({ primaryId: "wf-1", backupId: "wf-b2", priority: 8 });
        const r = failover.triggerFailover({ workflowId: "wf-1" });
        assert.equal(r.backupId, "wf-b2");
    });

    it("validateFailoverSafety detects circular failover", () => {
        failover.registerFailoverRoute({ primaryId: "wf-a", backupId: "wf-b" });
        failover.registerFailoverRoute({ primaryId: "wf-b", backupId: "wf-a" });
        const r = failover.validateFailoverSafety({ workflowId: "wf-a", backupId: "wf-b" });
        assert.equal(r.safe, false);
        assert.equal(r.reason, "circular_failover_detected");
    });

    it("validateFailoverSafety passes for safe route", () => {
        const r = failover.validateFailoverSafety({ workflowId: "wf-a", backupId: "wf-c" });
        assert.equal(r.safe, true);
    });

    it("validateFailoverSafety blocks backup already in failover", () => {
        failover.registerFailoverRoute({ primaryId: "wf-b", backupId: "wf-c" });
        failover.registerFailoverRoute({ primaryId: "wf-a", backupId: "wf-b" });
        failover.triggerFailover({ workflowId: "wf-b" }); // wf-b is now in failover
        const r = failover.validateFailoverSafety({ workflowId: "wf-a", backupId: "wf-b" });
        assert.equal(r.safe, false);
        assert.equal(r.reason, "backup_already_in_failover");
    });

    it("getFailoverMetrics tracks routes and failovers", () => {
        failover.registerFailoverRoute({ primaryId: "wf-1", backupId: "wf-2" });
        failover.triggerFailover({ workflowId: "wf-1" });
        const m = failover.getFailoverMetrics();
        assert.equal(m.totalRoutes, 1);
        assert.equal(m.totalFailovers, 1);
        assert.equal(m.activeFailovers, 1);
    });
});

// ── runtimeSelfHealingEngine ──────────────────────────────────────────
describe("runtimeSelfHealingEngine", () => {
    beforeEach(() => healing.reset());

    it("diagnoses runtime and returns diagnosisId", () => {
        const r = healing.diagnoseRuntime({ latencyMs: 2000 });
        assert.equal(r.diagnosed, true);
        assert.ok(r.diagnosisId.startsWith("diag-"));
    });

    it("detects latency_degradation issue", () => {
        const r = healing.diagnoseRuntime({ latencyMs: 1500 });
        assert.ok(r.issues.some(i => i.type === "latency_degradation"));
        assert.equal(r.needsHealing, true);
    });

    it("detects starvation_chain issue", () => {
        const r = healing.diagnoseRuntime({ starvationCount: 3 });
        assert.ok(r.issues.some(i => i.type === "starvation_chain"));
    });

    it("detects queue_overflow issue", () => {
        const r = healing.diagnoseRuntime({ queueDepth: 75 });
        assert.ok(r.issues.some(i => i.type === "queue_overflow"));
    });

    it("detects error_spike issue", () => {
        const r = healing.diagnoseRuntime({ errorRate: 0.4 });
        assert.ok(r.issues.some(i => i.type === "error_spike"));
    });

    it("detects resource_contention issue", () => {
        const r = healing.diagnoseRuntime({ pressureScore: 0.7 });
        assert.ok(r.issues.some(i => i.type === "resource_contention"));
    });

    it("detects cascade_risk issue", () => {
        const r = healing.diagnoseRuntime({ cascadeDepth: 3 });
        assert.ok(r.issues.some(i => i.type === "cascade_risk"));
    });

    it("produces healing plan with deduplicated actions", () => {
        const r = healing.diagnoseRuntime({ latencyMs: 2000, pressureScore: 0.8 });
        const actionSet = new Set(r.healingPlan.map(p => p.action));
        assert.equal(actionSet.size, r.healingPlan.length);
    });

    it("returns needsHealing=false with healthy metrics", () => {
        const r = healing.diagnoseRuntime({ latencyMs: 100, errorRate: 0.01 });
        assert.equal(r.needsHealing, false);
        assert.equal(r.issueCount, 0);
    });

    it("executeHealingAction applies a valid action", () => {
        const r = healing.executeHealingAction({ workflowId: "wf-1", action: "flush_queue" });
        assert.equal(r.executed, true);
        assert.ok(r.actionId.startsWith("heal-"));
        assert.equal(r.outcome, "applied");
    });

    it("executeHealingAction requires workflowId", () => {
        const r = healing.executeHealingAction({ action: "flush_queue" });
        assert.equal(r.executed, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("executeHealingAction requires action", () => {
        const r = healing.executeHealingAction({ workflowId: "wf-1" });
        assert.equal(r.executed, false);
        assert.equal(r.reason, "action_required");
    });

    it("executeHealingAction rejects invalid action", () => {
        const r = healing.executeHealingAction({ workflowId: "wf-1", action: "nuke_system" });
        assert.equal(r.executed, false);
        assert.ok(r.reason.startsWith("invalid_action"));
    });

    it("validateHealingOutcome marks improvement when score decreases", () => {
        const r = healing.validateHealingOutcome({ beforeScore: 0.8, afterScore: 0.5 });
        assert.equal(r.valid, true);
        assert.equal(r.improved, true);
        assert.ok(r.deltaScore > 0);
    });

    it("validateHealingOutcome marks degradation when score increases", () => {
        const r = healing.validateHealingOutcome({ beforeScore: 0.4, afterScore: 0.9 });
        assert.equal(r.improved, false);
        assert.equal(r.outcome, "degraded");
    });

    it("validateHealingOutcome requires beforeScore", () => {
        const r = healing.validateHealingOutcome({ afterScore: 0.5 });
        assert.equal(r.valid, false);
    });

    it("getSelfHealingMetrics tracks diagnoses and actions", () => {
        healing.diagnoseRuntime({ latencyMs: 2000 });
        healing.executeHealingAction({ workflowId: "wf-1", action: "flush_queue" });
        const m = healing.getSelfHealingMetrics();
        assert.equal(m.totalDiagnoses, 1);
        assert.equal(m.totalActions, 1);
        assert.equal(m.actionCounts.flush_queue, 1);
    });

    it("HEALING_ACTIONS exports all 7 actions", () => {
        assert.equal(healing.HEALING_ACTIONS.length, 7);
    });
});

// ── stabilizationPolicyEngine ─────────────────────────────────────────
describe("stabilizationPolicyEngine", () => {
    beforeEach(() => policy.reset());

    it("registers a policy and returns policyId", () => {
        const r = policy.registerPolicy({
            name:      "high-pressure-degrade",
            trigger:   "pressure_threshold",
            threshold: 0.8,
            action:    "degrade_service",
        });
        assert.equal(r.registered, true);
        assert.ok(r.policyId.startsWith("policy-"));
        assert.equal(r.name, "high-pressure-degrade");
    });

    it("rejects policy without name", () => {
        const r = policy.registerPolicy({ trigger: "pressure_threshold", action: "degrade_service" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "name_required");
    });

    it("rejects policy without trigger", () => {
        const r = policy.registerPolicy({ name: "test", action: "degrade_service" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "trigger_required");
    });

    it("rejects policy without action", () => {
        const r = policy.registerPolicy({ name: "test", trigger: "pressure_threshold" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "action_required");
    });

    it("rejects invalid trigger", () => {
        const r = policy.registerPolicy({ name: "test", trigger: "alien_signal", action: "do_something" });
        assert.equal(r.registered, false);
        assert.ok(r.reason.startsWith("invalid_trigger"));
    });

    it("evaluatePolicy returns applicable=[] when no threshold met", () => {
        policy.registerPolicy({ name: "high-pressure", trigger: "pressure_threshold", threshold: 0.8, action: "degrade_service" });
        const r = policy.evaluatePolicy({ runtimeState: { pressureScore: 0.3 } });
        assert.equal(r.evaluated, true);
        assert.equal(r.applicableCount, 0);
    });

    it("evaluatePolicy triggers on pressure_threshold", () => {
        policy.registerPolicy({ name: "p", trigger: "pressure_threshold", threshold: 0.5, action: "degrade_service" });
        const r = policy.evaluatePolicy({ runtimeState: { pressureScore: 0.75 } });
        assert.equal(r.applicableCount, 1);
        assert.ok(r.actions.includes("degrade_service"));
    });

    it("evaluatePolicy triggers on bottleneck_count", () => {
        policy.registerPolicy({ name: "b", trigger: "bottleneck_count", threshold: 3, action: "isolate_workflow" });
        const r = policy.evaluatePolicy({ runtimeState: { bottleneckCount: 5 } });
        assert.equal(r.applicableCount, 1);
    });

    it("evaluatePolicy triggers on starvation_detected", () => {
        policy.registerPolicy({ name: "s", trigger: "starvation_detected", threshold: 2, action: "compensate_starvation" });
        const r = policy.evaluatePolicy({ runtimeState: { starvationCount: 3 } });
        assert.equal(r.applicableCount, 1);
    });

    it("evaluatePolicy triggers on error_rate", () => {
        policy.registerPolicy({ name: "e", trigger: "error_rate", threshold: 0.3, action: "restart_workflow" });
        const r = policy.evaluatePolicy({ runtimeState: { errorRate: 0.5 } });
        assert.equal(r.applicableCount, 1);
    });

    it("evaluatePolicy triggers on recovery_overload", () => {
        policy.registerPolicy({ name: "r", trigger: "recovery_overload", threshold: 5, action: "quarantine_workflow" });
        const r = policy.evaluatePolicy({ runtimeState: { activeRecoveries: 6 } });
        assert.equal(r.applicableCount, 1);
    });

    it("evaluatePolicy sorts applicable by priority descending", () => {
        policy.registerPolicy({ name: "low-p",  trigger: "pressure_threshold", threshold: 0.1, action: "monitor",        priority: 2 });
        policy.registerPolicy({ name: "high-p", trigger: "pressure_threshold", threshold: 0.1, action: "degrade_service", priority: 9 });
        const r = policy.evaluatePolicy({ runtimeState: { pressureScore: 0.5 } });
        assert.equal(r.applicable[0].name, "high-p");
    });

    it("applyStabilizationScore returns healthy for low pressure", () => {
        const r = policy.applyStabilizationScore({ pressureScore: 0.1, bottleneckCount: 0 });
        assert.equal(r.scored, true);
        assert.equal(r.health, "healthy");
        assert.ok(r.stabilizationScore >= 0.8);
    });

    it("applyStabilizationScore returns critical under maximum load", () => {
        const r = policy.applyStabilizationScore({
            pressureScore: 1.0, bottleneckCount: 10, starvationCount: 10, activeRecoveries: 20,
        });
        assert.equal(r.health, "critical");
        assert.ok(r.stabilizationScore < 0.4);
    });

    it("applyStabilizationScore scoreId starts with score-", () => {
        const r = policy.applyStabilizationScore({ pressureScore: 0.5 });
        assert.ok(r.scoreId.startsWith("score-"));
    });

    it("getPolicyRecommendations returns recommendations", () => {
        policy.registerPolicy({ name: "p", trigger: "pressure_threshold", threshold: 0.5, action: "degrade_service" });
        const r = policy.getPolicyRecommendations({ runtimeState: { pressureScore: 0.8 } });
        assert.ok(r.recommendations.length > 0);
        assert.equal(r.recommendations[0].action, "degrade_service");
    });

    it("getPolicyMetrics tracks policy count and evaluations", () => {
        policy.registerPolicy({ name: "p1", trigger: "pressure_threshold", threshold: 0.5, action: "degrade_service" });
        policy.evaluatePolicy({ runtimeState: { pressureScore: 0.8 } });
        const m = policy.getPolicyMetrics();
        assert.equal(m.totalPolicies, 1);
        assert.equal(m.totalEvaluations, 1);
    });

    it("POLICY_TRIGGERS exports 6 triggers", () => {
        assert.equal(policy.POLICY_TRIGGERS.length, 6);
    });
});

// ── end-to-end runtime stabilization simulation ───────────────────────
describe("end-to-end runtime stabilization simulation", () => {
    beforeEach(() => {
        coordinator.reset(); degraded.reset(); isolation.reset();
        failover.reset();    healing.reset();  policy.reset();
    });

    it("degraded mode activates then deactivates correctly", () => {
        const threshold = degraded.evaluateDegradationThreshold({ pressureScore: 0.85 });
        assert.equal(threshold.shouldDegrade, true);
        const mode = degraded.activateDegradedMode({ level: threshold.recommendedLevel });
        assert.equal(mode.activated, true);
        const state = degraded.getDegradedModeState();
        assert.equal(state.isInDegradedMode, true);
        degraded.deactivateDegradedMode({ modeId: mode.modeId });
        const after = degraded.getDegradedModeState();
        assert.equal(after.isInDegradedMode, false);
    });

    it("trigger → escalate → resolve recovery lifecycle", () => {
        const t = coordinator.triggerRecovery({ workflowId: "wf-1", trigger: "cascade", severity: "critical" });
        assert.equal(t.action, "quarantine");
        coordinator.escalateRecovery({ recoveryId: t.recoveryId, reason: "still_failing" });
        const r = coordinator.resolveRecovery({ recoveryId: t.recoveryId, resolution: "quarantined" });
        assert.equal(r.resolved, true);
        const m = coordinator.getRecoveryMetrics();
        assert.equal(m.totalRecoveries, 1);
    });

    it("isolation escalates from degraded to quarantine zone", () => {
        isolation.isolateExecution({ workflowId: "wf-unsafe", zone: "degraded-zone" });
        isolation.quarantineExecution({ workflowId: "wf-unsafe" });
        const s = isolation.getIsolationState();
        assert.equal(s.quarantinedCount, 1);
        assert.equal(s.byZone["quarantine-zone"], 1);
        assert.equal(s.byZone["degraded-zone"], 0);
    });

    it("failover routes away from a failing workflow", () => {
        failover.registerFailoverRoute({ primaryId: "wf-primary", backupId: "wf-secondary", priority: 7 });
        const safety = failover.validateFailoverSafety({ workflowId: "wf-primary", backupId: "wf-secondary" });
        assert.equal(safety.safe, true);
        const f = failover.triggerFailover({ workflowId: "wf-primary", reason: "crash" });
        assert.equal(f.triggered, true);
        assert.equal(f.backupId, "wf-secondary");
    });

    it("self-healing diagnoses and applies healing action", () => {
        const diag = healing.diagnoseRuntime({ latencyMs: 3000, pressureScore: 0.75, starvationCount: 4 });
        assert.ok(diag.needsHealing);
        const firstAction = diag.healingPlan[0].action;
        const exec = healing.executeHealingAction({ workflowId: "wf-sick", action: firstAction });
        assert.equal(exec.executed, true);
        const outcome = healing.validateHealingOutcome({ beforeScore: 0.85, afterScore: 0.4 });
        assert.equal(outcome.improved, true);
    });

    it("stabilization policy fires on multiple conditions simultaneously", () => {
        policy.registerPolicy({ name: "pressure-degrade",    trigger: "pressure_threshold", threshold: 0.6, action: "degrade_service",        priority: 8 });
        policy.registerPolicy({ name: "bottleneck-isolate",  trigger: "bottleneck_count",   threshold: 3,   action: "isolate_workflow",        priority: 6 });
        policy.registerPolicy({ name: "starvation-compensate", trigger: "starvation_detected", threshold: 2, action: "compensate_starvation", priority: 7 });
        const r = policy.evaluatePolicy({
            runtimeState: { pressureScore: 0.8, bottleneckCount: 4, starvationCount: 3 },
        });
        assert.equal(r.applicableCount, 3);
        assert.equal(r.applicable[0].name, "pressure-degrade"); // highest priority
    });

    it("stabilization score reflects recovery health accurately", () => {
        const healthy   = policy.applyStabilizationScore({ pressureScore: 0.1, bottleneckCount: 0, starvationCount: 0 });
        const degradedS = policy.applyStabilizationScore({ pressureScore: 0.6, bottleneckCount: 3, starvationCount: 2 });
        const critical  = policy.applyStabilizationScore({ pressureScore: 0.95, bottleneckCount: 8, starvationCount: 8, activeRecoveries: 18 });
        assert.ok(healthy.stabilizationScore > degradedS.stabilizationScore);
        assert.ok(degradedS.stabilizationScore > critical.stabilizationScore);
        assert.equal(healthy.health, "healthy");
        assert.equal(critical.health, "critical");
    });

    it("starvation recovery: detect, compensate, validate improvement", () => {
        const t = coordinator.triggerRecovery({ workflowId: "wf-starved", trigger: "starvation", severity: "high" });
        assert.equal(t.action, "compensate");
        const h = healing.executeHealingAction({ workflowId: "wf-starved", action: "compensate_starvation" });
        assert.equal(h.executed, true);
        const outcome = healing.validateHealingOutcome({ beforeScore: 0.7, afterScore: 0.3 });
        assert.equal(outcome.improved, true);
        coordinator.resolveRecovery({ recoveryId: t.recoveryId, resolution: "healed" });
        const m = coordinator.getRecoveryMetrics();
        assert.equal(m.healedCount, 1);
    });

    it("cascading failure containment: isolate then quarantine chain", () => {
        const workflows = ["wf-root", "wf-a", "wf-b", "wf-c"];
        for (const wf of workflows) {
            const r = isolation.isolateExecution({ workflowId: wf, zone: "recovery-zone" });
            assert.equal(r.isolated, true);
        }
        // Root is the most dangerous — quarantine it
        isolation.quarantineExecution({ workflowId: "wf-root" });
        const s = isolation.getIsolationState();
        assert.equal(s.quarantinedCount, 1);
        assert.equal(s.totalIsolated, 4);
    });
});
