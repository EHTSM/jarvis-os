"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const controller  = require("../../agents/runtime/control/runtimeExecutionController.cjs");
const wfManager   = require("../../agents/runtime/control/workflowControlManager.cjs");
const termEngine  = require("../../agents/runtime/control/executionTerminationEngine.cjs");
const pauseCoord  = require("../../agents/runtime/control/executionPauseResumeCoordinator.cjs");
const freezeCtrl  = require("../../agents/runtime/control/runtimeFreezeController.cjs");
const isoManager  = require("../../agents/runtime/control/subsystemIsolationManager.cjs");
const prioEngine  = require("../../agents/runtime/control/executionPriorityOverrideEngine.cjs");
const recovEngine = require("../../agents/runtime/control/manualRecoveryTriggerEngine.cjs");
const governor    = require("../../agents/runtime/control/runtimeEmergencyGovernor.cjs");
const logStream   = require("../../agents/runtime/control/liveExecutionLogStream.cjs");

// ─────────────────────────────────────────────────────────────────────────────
describe("1. runtimeExecutionController", () => {
  beforeEach(() => controller.reset());

  it("registers executions and tracks state", () => {
    const r = controller.registerExecution("exec-1", { workflowId: "wf-1" });
    assert.equal(r.registered, true);
    assert.equal(r.executionId, "exec-1");
    const s = controller.getExecutionState("exec-1");
    assert.equal(s.found, true);
    assert.equal(s.state, "active");
  });

  it("rejects duplicate registration", () => {
    controller.registerExecution("exec-1");
    const r = controller.registerExecution("exec-1");
    assert.equal(r.registered, false);
    assert.equal(r.reason, "already_registered");
  });

  it("dispatches pause/resume commands", () => {
    controller.registerExecution("exec-2");
    const p = controller.dispatchControl({ executionId: "exec-2", action: "pause", authorityLevel: "operator" });
    assert.equal(p.success, true);
    assert.equal(controller.getExecutionState("exec-2").state, "paused");

    const resume = controller.dispatchControl({ executionId: "exec-2", action: "resume", authorityLevel: "operator" });
    assert.equal(resume.success, true);
    assert.equal(controller.getExecutionState("exec-2").state, "resuming");
  });

  it("enforces authority level on terminate", () => {
    controller.registerExecution("exec-3");
    const r = controller.dispatchControl({ executionId: "exec-3", action: "terminate", authorityLevel: "operator" });
    assert.equal(r.success, false);
    assert.equal(r.reason, "insufficient_authority");
  });

  it("rejects invalid action names", () => {
    controller.registerExecution("exec-4");
    const r = controller.dispatchControl({ executionId: "exec-4", action: "explode", authorityLevel: "root-runtime" });
    assert.equal(r.success, false);
    assert.equal(r.reason, "invalid_action");
  });

  it("rejects invalid state transitions", () => {
    controller.registerExecution("exec-5");
    // Cannot resume active execution
    const r = controller.dispatchControl({ executionId: "exec-5", action: "resume", authorityLevel: "operator" });
    assert.equal(r.success, false);
    assert.match(r.reason, /invalid_state_transition/);
  });

  it("returns command log with audit entries", () => {
    controller.registerExecution("exec-6");
    controller.dispatchControl({ executionId: "exec-6", action: "pause", authorityLevel: "operator" });
    const log = controller.getCommandLog(10);
    assert.ok(log.length >= 1);
    assert.equal(log[0].action, "pause");
    assert.equal(log[0].executionId, "exec-6");
  });

  it("getControllerMetrics returns state distribution", () => {
    controller.registerExecution("e1");
    controller.registerExecution("e2");
    controller.dispatchControl({ executionId: "e1", action: "pause", authorityLevel: "operator" });
    const m = controller.getControllerMetrics();
    assert.ok(m.registeredCount >= 2);
    assert.ok(m.stateDistribution.paused >= 1);
    assert.ok(m.stateDistribution.active >= 1);
  });

  it("quarantine and recover transitions work", () => {
    controller.registerExecution("exec-7");
    controller.dispatchControl({ executionId: "exec-7", action: "quarantine", authorityLevel: "controller" });
    assert.equal(controller.getExecutionState("exec-7").state, "quarantined");

    const r = controller.dispatchControl({ executionId: "exec-7", action: "recover", authorityLevel: "controller" });
    assert.equal(r.success, true);
    assert.equal(controller.getExecutionState("exec-7").state, "recovering");
  });

  it("freeze / unfreeze transitions", () => {
    controller.registerExecution("exec-8");
    controller.dispatchControl({ executionId: "exec-8", action: "freeze", authorityLevel: "controller" });
    assert.equal(controller.getExecutionState("exec-8").state, "frozen");

    controller.dispatchControl({ executionId: "exec-8", action: "unfreeze", authorityLevel: "controller" });
    assert.equal(controller.getExecutionState("exec-8").state, "active");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("2. workflowControlManager", () => {
  beforeEach(() => wfManager.reset());

  it("registers workflows with executions", () => {
    const r = wfManager.registerWorkflow("wf-1", { executionIds: ["e1", "e2"] });
    assert.equal(r.registered, true);
    assert.equal(r.executionCount, 2);
  });

  it("prevents duplicate registration", () => {
    wfManager.registerWorkflow("wf-1");
    const r = wfManager.registerWorkflow("wf-1");
    assert.equal(r.registered, false);
    assert.equal(r.reason, "already_registered");
  });

  it("pauses and resumes a workflow", () => {
    wfManager.registerWorkflow("wf-2");
    const p = wfManager.pauseWorkflow("wf-2", { authorityLevel: "operator" });
    assert.equal(p.success, true);
    assert.equal(wfManager.getWorkflowState("wf-2").state, "paused");

    const r = wfManager.resumeWorkflow("wf-2", { authorityLevel: "operator" });
    assert.equal(r.success, true);
    assert.equal(wfManager.getWorkflowState("wf-2").state, "active");
  });

  it("cancels a workflow", () => {
    wfManager.registerWorkflow("wf-3");
    const r = wfManager.cancelWorkflow("wf-3", { authorityLevel: "controller" });
    assert.equal(r.success, true);
    assert.equal(wfManager.getWorkflowState("wf-3").state, "cancelling");
  });

  it("cannot cancel terminal workflow", () => {
    wfManager.registerWorkflow("wf-4");
    wfManager.cancelWorkflow("wf-4", { authorityLevel: "controller" });
    // cancelling is not yet terminal; complete it
    wfManager.completeWorkflow("wf-4");
    const r = wfManager.cancelWorkflow("wf-4", { authorityLevel: "controller" });
    assert.equal(r.success, false);
    assert.equal(r.reason, "already_terminal");
  });

  it("enforces authority on pause", () => {
    wfManager.registerWorkflow("wf-5");
    const r = wfManager.pauseWorkflow("wf-5", { authorityLevel: "observer" });
    assert.equal(r.success, false);
    assert.equal(r.reason, "insufficient_authority");
  });

  it("addExecution appends to tracked executions", () => {
    wfManager.registerWorkflow("wf-6", { executionIds: ["e1"] });
    wfManager.addExecution("wf-6", "e2");
    const s = wfManager.getWorkflowState("wf-6");
    assert.ok(s.executionIds.includes("e2"));
    assert.equal(s.executionCount, 2);
  });

  it("getActiveWorkflows excludes completed/cancelled", () => {
    wfManager.registerWorkflow("wf-a");
    wfManager.registerWorkflow("wf-b");
    wfManager.completeWorkflow("wf-b");
    const active = wfManager.getActiveWorkflows();
    const ids = active.map(w => w.workflowId);
    assert.ok(ids.includes("wf-a"));
    assert.ok(!ids.includes("wf-b"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("3. executionTerminationEngine", () => {
  beforeEach(() => termEngine.reset());

  it("initiates graceful termination", () => {
    const r = termEngine.initiateTermination("exec-1", { authorityLevel: "controller", reason: "user_request" });
    assert.equal(r.initiated, true);
    assert.ok(r.terminationId.startsWith("term-"));
    assert.ok(r.gracefulDeadline);
  });

  it("rejects insufficient authority", () => {
    const r = termEngine.initiateTermination("exec-1", { authorityLevel: "operator" });
    assert.equal(r.initiated, false);
    assert.equal(r.reason, "insufficient_authority");
  });

  it("confirms termination", () => {
    termEngine.initiateTermination("exec-1", { authorityLevel: "controller" });
    const r = termEngine.confirmTermination("exec-1", { success: true });
    assert.equal(r.confirmed, true);
    assert.equal(r.phase, "terminated");
  });

  it("rejects duplicate initiation", () => {
    termEngine.initiateTermination("exec-2", { authorityLevel: "controller" });
    const r = termEngine.initiateTermination("exec-2", { authorityLevel: "controller" });
    assert.equal(r.initiated, false);
    assert.equal(r.reason, "termination_in_progress");
  });

  it("forceTerminateIfOverdue checks grace period", () => {
    const r1 = termEngine.initiateTermination("exec-3", { authorityLevel: "controller" });
    // Before deadline — should not force
    const nowMs  = new Date(r1.gracefulDeadline).getTime() - 1000;
    const result = termEngine.forceTerminateIfOverdue("exec-3", { authorityLevel: "governor", nowMs });
    assert.equal(result.forced, false);
    assert.equal(result.reason, "grace_period_active");
  });

  it("forces termination after deadline", () => {
    const r1 = termEngine.initiateTermination("exec-4", { authorityLevel: "controller" });
    const nowMs  = new Date(r1.gracefulDeadline).getTime() + 1;
    const result = termEngine.forceTerminateIfOverdue("exec-4", { authorityLevel: "governor", nowMs });
    assert.equal(result.forced, true);
  });

  it("getPendingTerminations lists in-progress terminations", () => {
    termEngine.initiateTermination("exec-5", { authorityLevel: "controller" });
    termEngine.initiateTermination("exec-6", { authorityLevel: "controller" });
    termEngine.confirmTermination("exec-5");
    const pending = termEngine.getPendingTerminations();
    const ids = pending.map(p => p.executionId);
    assert.ok(!ids.includes("exec-5"));
    assert.ok(ids.includes("exec-6"));
  });

  it("audit log records each termination action", () => {
    termEngine.initiateTermination("exec-7", { authorityLevel: "controller" });
    termEngine.confirmTermination("exec-7");
    const log = termEngine.getAuditLog(10);
    assert.ok(log.length >= 2);
    const actions = log.map(e => e.action);
    assert.ok(actions.some(a => a.includes("termination")));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("4. executionPauseResumeCoordinator", () => {
  beforeEach(() => pauseCoord.reset());

  it("pauses execution and tracks it", () => {
    const r = pauseCoord.pauseExecution("exec-1", { authorityLevel: "operator", reason: "test" });
    assert.equal(r.paused, true);
    assert.ok(r.pauseId.startsWith("pause-"));
    const list = pauseCoord.getPausedExecutions();
    assert.ok(list.some(e => e.executionId === "exec-1"));
  });

  it("resumes execution and returns pause duration", () => {
    pauseCoord.pauseExecution("exec-2", { authorityLevel: "operator" });
    const r = pauseCoord.resumeExecution("exec-2", { authorityLevel: "operator" });
    assert.equal(r.resumed, true);
    assert.ok(typeof r.pauseDurationMs === "number");
  });

  it("rejects resuming non-paused execution", () => {
    const r = pauseCoord.resumeExecution("exec-3");
    assert.equal(r.resumed, false);
    assert.equal(r.reason, "execution_not_paused");
  });

  it("stores checkpoint on pause", () => {
    pauseCoord.pauseExecution("exec-4", { authorityLevel: "operator", checkpointData: { step: 5, vars: { x: 1 } } });
    const cp = pauseCoord.getCheckpoint("exec-4");
    assert.equal(cp.found, true);
    assert.deepEqual(cp.data, { step: 5, vars: { x: 1 } });
  });

  it("resume returns checkpoint data", () => {
    pauseCoord.pauseExecution("exec-5", { authorityLevel: "operator", checkpointData: { step: 3 } });
    const r = pauseCoord.resumeExecution("exec-5", { authorityLevel: "operator" });
    assert.deepEqual(r.checkpoint, { step: 3 });
  });

  it("saves checkpoint independently", () => {
    const r = pauseCoord.saveCheckpoint("exec-6", { progress: 0.8 });
    assert.equal(r.saved, true);
    assert.ok(r.savedAt);
  });

  it("pauseAll / resumeAll bulk operations", () => {
    const pr = pauseCoord.pauseAll(["ea", "eb", "ec"], { authorityLevel: "operator" });
    assert.equal(pr.succeeded, 3);
    const rr = pauseCoord.resumeAll(["ea", "eb", "ec"], { authorityLevel: "operator" });
    assert.equal(rr.succeeded, 3);
  });

  it("coordinator metrics tracks paused count", () => {
    pauseCoord.pauseExecution("ex-m1", { authorityLevel: "operator" });
    pauseCoord.pauseExecution("ex-m2", { authorityLevel: "operator" });
    const m = pauseCoord.getCoordinatorMetrics();
    assert.equal(m.currentlyPaused, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("5. runtimeFreezeController", () => {
  beforeEach(() => freezeCtrl.reset());

  it("applies global freeze", () => {
    const r = freezeCtrl.applyGlobalFreeze({ authorityLevel: "governor", reason: "deploy" });
    assert.equal(r.frozen, true);
    assert.ok(r.freezeId.startsWith("freeze-"));
  });

  it("isFrozen returns true under global freeze", () => {
    freezeCtrl.applyGlobalFreeze({ authorityLevel: "governor" });
    assert.equal(freezeCtrl.isFrozen().frozen, true);
  });

  it("lifts global freeze", () => {
    freezeCtrl.applyGlobalFreeze({ authorityLevel: "governor" });
    const r = freezeCtrl.liftGlobalFreeze({ authorityLevel: "governor" });
    assert.equal(r.lifted, true);
    assert.equal(freezeCtrl.isFrozen().frozen, false);
  });

  it("applies and lifts scoped freeze", () => {
    freezeCtrl.applyScopedFreeze("adapter-llm", { authorityLevel: "controller" });
    assert.equal(freezeCtrl.isFrozen("adapter-llm").frozen, true);
    freezeCtrl.liftScopedFreeze("adapter-llm", { authorityLevel: "controller" });
    assert.equal(freezeCtrl.isFrozen("adapter-llm").frozen, false);
  });

  it("scoped freeze does not affect other scopes", () => {
    freezeCtrl.applyScopedFreeze("scope-a", { authorityLevel: "controller" });
    assert.equal(freezeCtrl.isFrozen("scope-b").frozen, false);
  });

  it("enforces authority on global freeze", () => {
    const r = freezeCtrl.applyGlobalFreeze({ authorityLevel: "controller" }); // needs governor
    assert.equal(r.frozen, false);
    assert.equal(r.reason, "insufficient_authority");
  });

  it("expires time-bounded freeze", () => {
    const past = new Date(Date.now() - 1).toISOString();
    freezeCtrl.applyScopedFreeze("scope-x", { authorityLevel: "controller", durationMs: 1 });
    const r = freezeCtrl.expireFreezes({ nowMs: Date.now() + 5000 });
    assert.ok(r.expired >= 1);
    assert.equal(freezeCtrl.isFrozen("scope-x").frozen, false);
  });

  it("getFreezeStatus lists all active freezes", () => {
    freezeCtrl.applyScopedFreeze("s1", { authorityLevel: "controller" });
    freezeCtrl.applyScopedFreeze("s2", { authorityLevel: "controller" });
    const status = freezeCtrl.getFreezeStatus();
    assert.equal(status.scopedFreezes.length, 2);
    assert.equal(status.totalActive, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("6. subsystemIsolationManager", () => {
  beforeEach(() => isoManager.reset());

  it("registers and isolates a subsystem", () => {
    isoManager.registerSubsystem("adapter-llm");
    const r = isoManager.isolateSubsystem("adapter-llm", { authorityLevel: "controller" });
    assert.equal(r.isolated, true);
    assert.ok(r.isolationId.startsWith("iso-"));
    assert.equal(isoManager.getSubsystemState("adapter-llm").state, "isolated");
  });

  it("auto-registers on isolate", () => {
    const r = isoManager.isolateSubsystem("new-sub", { authorityLevel: "controller" });
    assert.equal(r.isolated, true);
  });

  it("canCommunicate blocks isolated subsystems", () => {
    isoManager.isolateSubsystem("sub-a", { authorityLevel: "controller" });
    assert.equal(isoManager.canCommunicate("sub-a", "sub-b").allowed, false);
    assert.equal(isoManager.canCommunicate("sub-b", "sub-a").allowed, false);
  });

  it("can block and unblock peers", () => {
    isoManager.registerSubsystem("sub-x");
    isoManager.blockPeer("sub-x", "sub-y", { authorityLevel: "controller" });
    assert.equal(isoManager.canCommunicate("sub-x", "sub-y").allowed, false);
    isoManager.unblockPeer("sub-x", "sub-y", { authorityLevel: "controller" });
    assert.equal(isoManager.canCommunicate("sub-x", "sub-y").allowed, true);
  });

  it("begin and complete reintegration", () => {
    isoManager.isolateSubsystem("sub-r", { authorityLevel: "controller" });
    isoManager.beginReintegration("sub-r", { authorityLevel: "controller" });
    assert.equal(isoManager.getSubsystemState("sub-r").state, "reintegrating");
    isoManager.completeReintegration("sub-r", { authorityLevel: "controller" });
    assert.equal(isoManager.getSubsystemState("sub-r").state, "normal");
  });

  it("getIsolatedSubsystems returns only isolated", () => {
    isoManager.isolateSubsystem("iso-1", { authorityLevel: "controller" });
    isoManager.isolateSubsystem("iso-2", { authorityLevel: "controller" });
    isoManager.registerSubsystem("norm-1");
    const iso = isoManager.getIsolatedSubsystems();
    assert.ok(iso.includes("iso-1") && iso.includes("iso-2"));
    assert.ok(!iso.includes("norm-1"));
  });

  it("metrics shows correct counts", () => {
    isoManager.isolateSubsystem("m1", { authorityLevel: "controller" });
    isoManager.registerSubsystem("m2");
    isoManager.markDegraded("m2", { authorityLevel: "operator" });
    const m = isoManager.getIsolationMetrics();
    assert.equal(m.stateDistribution.isolated, 1);
    assert.equal(m.stateDistribution.degraded, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("7. executionPriorityOverrideEngine", () => {
  beforeEach(() => prioEngine.reset());

  it("applies a priority override", () => {
    const r = prioEngine.applyOverride("exec-1", { priorityScore: 75, authorityLevel: "operator", reason: "urgent" });
    assert.equal(r.applied, true);
    assert.ok(r.overrideId.startsWith("po-"));
    assert.equal(r.priorityScore, 75);
  });

  it("returns effective priority override", () => {
    prioEngine.applyOverride("exec-2", { priorityScore: 90, authorityLevel: "operator" });
    const eff = prioEngine.getEffectivePriority("exec-2", 40);
    assert.equal(eff.overridden, true);
    assert.equal(eff.priority, 90);
  });

  it("returns original priority when no override", () => {
    const eff = prioEngine.getEffectivePriority("exec-99", 55);
    assert.equal(eff.overridden, false);
    assert.equal(eff.priority, 55);
  });

  it("rejects out-of-range priority", () => {
    const r = prioEngine.applyOverride("exec-3", { priorityScore: 150, authorityLevel: "operator" });
    assert.equal(r.applied, false);
    assert.match(r.reason, /priority_out_of_range/);
  });

  it("revokes an override", () => {
    prioEngine.applyOverride("exec-4", { priorityScore: 80, authorityLevel: "operator" });
    const r = prioEngine.revokeOverride("exec-4", { authorityLevel: "operator" });
    assert.equal(r.revoked, true);
    const eff = prioEngine.getEffectivePriority("exec-4", 30);
    assert.equal(eff.overridden, false);
  });

  it("expires time-bounded override", () => {
    prioEngine.applyOverride("exec-5", { priorityScore: 60, authorityLevel: "operator", expiresAt: new Date(Date.now() - 1).toISOString() });
    const r = prioEngine.expireOverrides({ nowMs: Date.now() + 1000 });
    assert.ok(r.expired >= 1);
    assert.equal(prioEngine.getEffectivePriority("exec-5", 20).overridden, false);
  });

  it("applyBatchOverrides applies multiple at once", () => {
    const r = prioEngine.applyBatchOverrides([
      { executionId: "e1", priorityScore: 50, reason: "batch" },
      { executionId: "e2", priorityScore: 70, reason: "batch" },
    ], { authorityLevel: "governor" });
    assert.equal(r.ok, true);
    assert.equal(r.succeeded, 2);
  });

  it("getActiveOverrides lists current overrides", () => {
    prioEngine.applyOverride("e10", { priorityScore: 44, authorityLevel: "operator" });
    prioEngine.applyOverride("e11", { priorityScore: 55, authorityLevel: "operator" });
    const active = prioEngine.getActiveOverrides();
    assert.equal(active.length, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("8. manualRecoveryTriggerEngine", () => {
  beforeEach(() => recovEngine.reset());

  it("triggers recovery with default strategy", () => {
    const r = recovEngine.triggerRecovery("exec-1", { authorityLevel: "operator" });
    assert.equal(r.triggered, true);
    assert.ok(r.recoveryId.startsWith("rec-"));
    assert.equal(r.strategy, "retry");
  });

  it("supports all strategies", () => {
    for (const s of recovEngine.RECOVERY_STRATEGIES) {
      const r = recovEngine.triggerRecovery(`exec-${s}`, { strategy: s, authorityLevel: "operator" });
      assert.equal(r.triggered, true, `strategy ${s} should trigger`);
    }
  });

  it("rejects unknown strategy", () => {
    const r = recovEngine.triggerRecovery("exec-2", { strategy: "teleport", authorityLevel: "operator" });
    assert.equal(r.triggered, false);
    assert.equal(r.reason, "invalid_strategy");
  });

  it("prevents duplicate in-flight recovery", () => {
    recovEngine.triggerRecovery("exec-3", { authorityLevel: "operator" });
    const r2 = recovEngine.triggerRecovery("exec-3", { authorityLevel: "operator" });
    assert.equal(r2.triggered, false);
    assert.equal(r2.reason, "recovery_already_in_progress");
  });

  it("advances recovery state machine", () => {
    const t = recovEngine.triggerRecovery("exec-4", { authorityLevel: "operator" });
    recovEngine.advanceRecovery(t.recoveryId, "triggered");
    recovEngine.advanceRecovery(t.recoveryId, "in_progress");
    recovEngine.advanceRecovery(t.recoveryId, "succeeded");
    const r = recovEngine.getRecovery(t.recoveryId);
    assert.equal(r.state, "succeeded");
    assert.ok(r.completedAt);
  });

  it("cancels a recovery", () => {
    const t = recovEngine.triggerRecovery("exec-5", { authorityLevel: "operator" });
    const r = recovEngine.cancelRecovery(t.recoveryId, { authorityLevel: "operator" });
    assert.equal(r.advanced, true);
  });

  it("getRecoveriesForExecution returns all attempts", () => {
    const t1 = recovEngine.triggerRecovery("exec-6", { authorityLevel: "operator" });
    recovEngine.advanceRecovery(t1.recoveryId, "triggered");
    recovEngine.advanceRecovery(t1.recoveryId, "in_progress");
    recovEngine.advanceRecovery(t1.recoveryId, "failed");
    // Second attempt is now allowed (previous is terminal)
    const t2 = recovEngine.triggerRecovery("exec-6", { authorityLevel: "operator" });
    assert.equal(t2.triggered, true);
    const recs = recovEngine.getRecoveriesForExecution("exec-6");
    assert.ok(recs.length >= 2);
  });

  it("getPendingRecoveries shows only non-terminal", () => {
    const t1 = recovEngine.triggerRecovery("pe-1", { authorityLevel: "operator" });
    const t2 = recovEngine.triggerRecovery("pe-2", { authorityLevel: "operator" });
    recovEngine.advanceRecovery(t2.recoveryId, "triggered");
    recovEngine.advanceRecovery(t2.recoveryId, "in_progress");
    recovEngine.advanceRecovery(t2.recoveryId, "succeeded");
    const pending = recovEngine.getPendingRecoveries();
    const ids = pending.map(p => p.recoveryId);
    assert.ok(ids.includes(t1.recoveryId));
    assert.ok(!ids.includes(t2.recoveryId));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("9. runtimeEmergencyGovernor", () => {
  beforeEach(() => governor.reset());

  it("issues alerts", () => {
    const r = governor.issueAlert({ level: "warning", message: "High error rate", authorityLevel: "operator" });
    assert.equal(r.issued, true);
    assert.ok(r.alertId.startsWith("alert-"));
  });

  it("rejects invalid alert level", () => {
    const r = governor.issueAlert({ level: "panic", message: "test", authorityLevel: "operator" });
    assert.equal(r.issued, false);
    assert.equal(r.reason, "invalid_level");
  });

  it("declares emergency", () => {
    const r = governor.declareEmergency({ authorityLevel: "governor", reason: "cascade failure", level: "critical" });
    assert.equal(r.declared, true);
    assert.equal(r.state, "emergency_shutdown");
    assert.equal(governor.isEmergencyActive(), true);
  });

  it("rejects emergency without governor authority", () => {
    const r = governor.declareEmergency({ authorityLevel: "controller", reason: "test" });
    assert.equal(r.declared, false);
    assert.equal(r.reason, "insufficient_authority");
  });

  it("resolves emergency", () => {
    governor.declareEmergency({ authorityLevel: "governor", level: "critical" });
    const r = governor.resolveEmergency({ authorityLevel: "governor", resolution: "mitigated" });
    assert.equal(r.resolved, true);
    assert.equal(governor.isEmergencyActive(), false);
  });

  it("executes intervention during emergency", () => {
    governor.declareEmergency({ authorityLevel: "governor", level: "emergency" });
    const r = governor.executeIntervention({ action: "drain_queues", authorityLevel: "governor" });
    assert.equal(r.executed, true);
    assert.ok(r.interventionId.startsWith("intv-"));
  });

  it("rejects intervention without active emergency", () => {
    const r = governor.executeIntervention({ action: "drain_queues", authorityLevel: "governor" });
    assert.equal(r.executed, false);
    assert.equal(r.reason, "no_active_emergency");
  });

  it("emergencyKillAll requires root-runtime authority", () => {
    const r = governor.emergencyKillAll(["e1", "e2"], { authorityLevel: "governor" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "insufficient_authority");
  });

  it("emergencyKillAll lists all execution ids", () => {
    const r = governor.emergencyKillAll(["e1", "e2", "e3"], { authorityLevel: "root-runtime" });
    assert.equal(r.ok, true);
    assert.equal(r.count, 3);
    assert.deepEqual(r.executionIds, ["e1", "e2", "e3"]);
  });

  it("getGovernorMetrics reports alert counts by level", () => {
    governor.issueAlert({ level: "warning", message: "w1", authorityLevel: "operator" });
    governor.issueAlert({ level: "critical", message: "c1", authorityLevel: "operator" });
    governor.issueAlert({ level: "warning", message: "w2", authorityLevel: "operator" });
    const m = governor.getGovernorMetrics();
    assert.equal(m.alertsByLevel.warning, 2);
    assert.equal(m.alertsByLevel.critical, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("10. liveExecutionLogStream", () => {
  beforeEach(() => logStream.reset());

  it("appends log entries", () => {
    const r = logStream.appendLog({ executionId: "exec-1", level: "info", message: "started" });
    assert.equal(r.appended, true);
    assert.ok(r.entryId.startsWith("log-"));
    assert.ok(r.seq >= 1);
  });

  it("rejects missing execution id", () => {
    const r = logStream.appendLog({ level: "info", message: "oops" });
    assert.equal(r.appended, false);
    assert.equal(r.reason, "missing_execution_id");
  });

  it("rejects invalid log level", () => {
    const r = logStream.appendLog({ executionId: "e1", level: "verbose", message: "hi" });
    assert.equal(r.appended, false);
    assert.equal(r.reason, "invalid_log_level");
  });

  it("queryLogs filters by executionId", () => {
    logStream.appendLog({ executionId: "e1", level: "info", message: "a" });
    logStream.appendLog({ executionId: "e2", level: "info", message: "b" });
    logStream.appendLog({ executionId: "e1", level: "warn", message: "c" });
    const r = logStream.queryLogs({ executionId: "e1" });
    assert.ok(r.every(e => e.executionId === "e1"));
    assert.equal(r.length, 2);
  });

  it("queryLogs filters by minLevel", () => {
    logStream.appendLog({ executionId: "e3", level: "debug", message: "d" });
    logStream.appendLog({ executionId: "e3", level: "error", message: "e" });
    const r = logStream.queryLogs({ minLevel: "warn" });
    assert.ok(r.every(e => ["warn","error","fatal"].includes(e.level)));
  });

  it("subscribe receives matching log entries", () => {
    const received = [];
    const { subId } = logStream.subscribe(e => received.push(e), { filter: { executionId: "sub-exec" } });
    logStream.appendLog({ executionId: "sub-exec", level: "info", message: "hello" });
    logStream.appendLog({ executionId: "other",    level: "info", message: "ignore" });
    assert.equal(received.length, 1);
    assert.equal(received[0].executionId, "sub-exec");
    logStream.unsubscribe(subId);
  });

  it("unsubscribes handler", () => {
    const received = [];
    const { subId } = logStream.subscribe(e => received.push(e));
    logStream.unsubscribe(subId);
    logStream.appendLog({ executionId: "e", level: "info", message: "m" });
    assert.equal(received.length, 0);
  });

  it("pruneOldEntries removes stale logs", () => {
    // Append log entries with an old timestamp by appending normally then checking prune works conceptually
    logStream.appendLog({ executionId: "old", level: "info", message: "stale" });
    const r = logStream.pruneOldEntries({ maxAgeMs: 0, nowMs: Date.now() + 1000 });
    assert.ok(r.pruned >= 1);
  });

  it("getStreamMetrics reports level counts", () => {
    logStream.appendLog({ executionId: "e", level: "info",  message: "i1" });
    logStream.appendLog({ executionId: "e", level: "error", message: "e1" });
    logStream.appendLog({ executionId: "e", level: "info",  message: "i2" });
    const m = logStream.getStreamMetrics();
    assert.equal(m.byLevel.info,  2);
    assert.equal(m.byLevel.error, 1);
    assert.ok(m.totalEntries >= 3);
  });

  it("getLogEntry retrieves by id", () => {
    const { entryId } = logStream.appendLog({ executionId: "e", level: "warn", message: "found me" });
    const r = logStream.getLogEntry(entryId);
    assert.equal(r.found, true);
    assert.equal(r.message, "found me");
  });
});
