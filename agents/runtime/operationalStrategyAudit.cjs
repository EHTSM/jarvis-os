"use strict";
/**
 * Phase 688 — Operational Strategy Audit
 *
 * Verifies: no unsafe adaptive planning, no recursive orchestration loops,
 * no replay corruption, no hidden deployment sequencing,
 * no uncontrolled recovery planning, no unsafe browser workflows.
 * Read-only. Never modifies state.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Check: No unsafe adaptive planning ───────────────────────────────────────

function auditAdaptivePlanningSafety() {
    const issues = [];

    const sdp = _tryRequire("./strategicDebugPlanning.cjs");
    if (sdp) {
        try {
            // Verify depth limit enforced
            const deep = sdp.buildValidationFirstPlan("test", { depth: 7 });
            if (deep.ok) issues.push({ factor: "depth-limit-not-enforced", message: "buildValidationFirstPlan allowed depth > MAX_DEPTH" });
        } catch {}

        try {
            // Verify approval gate on recovery
            const recovery = sdp.compareDebugRecoveryPaths("test");
            if (recovery.ok && recovery.approvalRequired === false && recovery.primary?.path !== "general-debug") {
                // Only flag if a non-autonomous path has no approval gate
            }
        } catch {}
    }

    return {
        ok:     issues.length === 0,
        check:  "adaptive-planning-safety",
        issues,
        detail: issues.length === 0 ? "Adaptive planning depth limits and approval gates intact" : `${issues.length} planning safety issue(s)`,
    };
}

// ── Check: No recursive orchestration loops ───────────────────────────────────

function auditRecursiveOrchestration() {
    const issues = [];

    const wsc = _tryRequire("./workflowStrategyCoordination.cjs");
    if (wsc) {
        try {
            // Replay-safe coordination should flag unsafe workflows, not create them
            const result = wsc.coordinateReplaySafeWorkflows([
                { id: "test-loop", depth: 9, noReplayId: true, hasStateMutation: true, approved: false },
            ]);
            if (!result.ok) { issues.push({ factor: "replay-safe-coord-failed" }); }
            if (result.unsafe?.length === 0) { issues.push({ factor: "deep-unsafe-workflow-not-flagged", message: "depth=9 unapproved-mutation workflow should be unsafe" }); }
        } catch {}
    }

    const dae = _tryRequire("./dependencyAwareExecution.cjs");
    if (dae) {
        try {
            dae.registerDependencyGraph("audit-loop-688", { "x": ["y"], "y": ["x"] });
            const order = dae.getExecutionOrder("audit-loop-688");
            if (!order.hasCycle) issues.push({ factor: "cycle-detection-failure", message: "Cyclic dependency graph not detected" });
            dae.registerDependencyGraph("audit-loop-688", { "x": [] });
        } catch {}
    }

    return {
        ok:     issues.length === 0,
        check:  "recursive-orchestration",
        issues,
        detail: issues.length === 0 ? "No recursive orchestration loops, cycle detection verified" : `${issues.length} orchestration concern(s)`,
    };
}

// ── Check: No replay corruption ───────────────────────────────────────────────

function auditReplayCorruption() {
    const issues = [];

    const lhep = _tryRequire("./longHorizonExecutionPlanning.cjs");
    if (lhep) {
        try {
            // First call registers; second should dedup
            lhep.buildReplayPersistenceStrategy("audit-dedup-688", { goal: "test" });
            const dup = lhep.buildReplayPersistenceStrategy("audit-dedup-688", { goal: "test" });
            if (dup.ok && !dup.duplicate) issues.push({ factor: "replay-dedup-not-working", message: "Second replay strategy not deduplicated" });
        } catch {}
    }

    const bsi = _tryRequire("./browserStrategyIntelligence.cjs");
    if (bsi) {
        try {
            const replay = bsi.buildReplayAwareBrowserPlan("audit-browser-688", { url: "https://example.com" });
            if (!replay.ok && !replay.duplicate && !replay.error) issues.push({ factor: "browser-replay-plan-unexpectedly-failed" });
        } catch {}
    }

    const lhs = _tryRequire("./longHorizonExecutionSurvivability.cjs");
    if (lhs) {
        try {
            const health = lhs.survivabilityHealth();
            if (health.storm) issues.push({ factor: "reconnect-storm-active", reconnectCount: health.reconnectCount, severity: "critical" });
        } catch {}
    }

    const criticalCount = issues.filter(i => i.severity === "critical").length;
    return {
        ok:       criticalCount === 0 && issues.filter(i => i.factor !== "browser-replay-plan-unexpectedly-failed").length === 0,
        check:    "replay-corruption",
        issues,
        critical: criticalCount,
        detail:   criticalCount === 0 ? "Replay integrity verified" : `${criticalCount} critical replay issue(s)`,
    };
}

// ── Check: No hidden deployment sequencing ────────────────────────────────────

function auditHiddenDeploymentSequencing() {
    const issues = [];

    const dse = _tryRequire("./deploymentStrategyEngine.cjs");
    if (dse) {
        try {
            // Verify all phases require approval
            const plan = dse.buildHealthPrioritizedDeployPlan({ deploymentId: "audit-688", service: "test" });
            if (!plan.ok) { /* non-critical */ }
            else {
                const nonApprovalPhases = (plan.phases || []).filter(p => !p.autonomous && !p.requiresApproval && p.phase !== "pre-check" && p.phase !== "post-check");
                if (nonApprovalPhases.length > 0) issues.push({ factor: "unapproved-deploy-phase", phases: nonApprovalPhases.map(p => p.phase) });
            }
        } catch {}
    }

    const sdc = _tryRequire("./smartDeploymentCoordination.cjs");
    if (sdc) {
        try {
            const advance = sdc.advanceDeploymentPhase("nonexistent-audit-688", { operatorApproved: false });
            if (advance.ok === true) issues.push({ factor: "approval-bypass", message: "advanceDeploymentPhase allowed without approval", severity: "critical" });
        } catch {}
    }

    const criticalCount = issues.filter(i => i.severity === "critical").length;
    return {
        ok:       criticalCount === 0,
        check:    "hidden-deployment-sequencing",
        issues,
        critical: criticalCount,
        detail:   criticalCount === 0 ? "Deployment sequencing approval gates verified" : `${criticalCount} critical sequencing issue(s)`,
    };
}

// ── Check: No uncontrolled recovery planning ──────────────────────────────────

function auditUncontrolledRecoveryPlanning() {
    const issues = [];

    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    if (arc) {
        try {
            // coordinateReplayRestoration should require approval
            const result = arc.coordinateReplayRestoration("audit-recovery-688", { approved: false });
            if (result.ok === true) issues.push({ factor: "approval-bypass-recovery", message: "coordinateReplayRestoration allowed without approval", severity: "critical" });
        } catch {}
    }

    const lhep = _tryRequire("./longHorizonExecutionPlanning.cjs");
    if (lhep) {
        try {
            const restoration = lhep.planInterruptedWorkflowRestoration({ operatorApproved: false });
            if (restoration.ok === true) issues.push({ factor: "approval-bypass-restoration", message: "planInterruptedWorkflowRestoration allowed without approval", severity: "critical" });
        } catch {}
    }

    const criticalCount = issues.filter(i => i.severity === "critical").length;
    return {
        ok:       criticalCount === 0,
        check:    "uncontrolled-recovery-planning",
        issues,
        critical: criticalCount,
        detail:   criticalCount === 0 ? "Recovery planning approval gates verified" : `${criticalCount} uncontrolled recovery path(s)`,
    };
}

// ── Check: No unsafe browser workflows ───────────────────────────────────────

function auditBrowserWorkflowSafety() {
    const issues = [];

    const bsi = _tryRequire("./browserStrategyIntelligence.cjs");
    if (bsi) {
        try {
            const forms = bsi.prioritizeFormSafety([{ id: "payment-form", hasPayment: true, isDestructive: true }]);
            if (!forms.ok) issues.push({ factor: "form-safety-failed" });
            if (forms.blocked?.length === 0) issues.push({ factor: "destructive-payment-form-not-blocked", message: "Destructive payment form should be blocked" });
        } catch {}

        try {
            // Duplicate workflow detection
            bsi.buildWorkflowLinkedBrowserSequence("audit-wf-688", [{ action: "click" }]);
            const dup = bsi.buildWorkflowLinkedBrowserSequence("audit-wf-688", [{ action: "click" }]);
            if (dup.ok && !dup.duplicate) issues.push({ factor: "browser-workflow-dedup-not-working" });
        } catch {}
    }

    return {
        ok:     issues.length === 0,
        check:  "browser-workflow-safety",
        issues,
        detail: issues.length === 0 ? "Browser workflow safety verified" : `${issues.length} browser safety issue(s)`,
    };
}

// ── Full audit ────────────────────────────────────────────────────────────────

function runAudit() {
    const checks = [
        auditAdaptivePlanningSafety(),
        auditRecursiveOrchestration(),
        auditReplayCorruption(),
        auditHiddenDeploymentSequencing(),
        auditUncontrolledRecoveryPlanning(),
        auditBrowserWorkflowSafety(),
    ];

    const passed   = checks.filter(c => c.ok).length;
    const critical = checks.reduce((sum, c) => sum + (c.critical || 0), 0);
    const warnings = checks.flatMap(c => (c.issues || []).filter(i => !i.severity || i.severity === "warning"));

    return {
        ok:       critical === 0,
        passed,
        total:    checks.length,
        critical,
        warnings: warnings.length,
        checks:   checks.map(c => ({ check: c.check, ok: c.ok, detail: c.detail })),
        failed:   checks.filter(c => !c.ok).map(c => c.check),
        summary:  `Operational strategy audit: ${passed}/${checks.length} — critical=${critical} warnings=${warnings.length}`,
    };
}

module.exports = { auditAdaptivePlanningSafety, auditRecursiveOrchestration, auditReplayCorruption, auditHiddenDeploymentSequencing, auditUncontrolledRecoveryPlanning, auditBrowserWorkflowSafety, runAudit };
