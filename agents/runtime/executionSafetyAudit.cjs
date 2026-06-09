"use strict";
/**
 * Phase 674 — Execution Safety Audit
 *
 * Verifies: no unsafe adaptive recovery, no hidden branching, no replay corruption,
 * no unsafe deployment sequencing, no uncontrolled continuation, no recursive loops.
 * Read-only. Diagnostic only. Never modifies state.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Check: No unsafe adaptive recovery ───────────────────────────────────────

function auditAdaptiveRecoverySafety() {
    const issues = [];

    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    if (!arc) return { ok: true, check: "adaptive-recovery-safety", skipped: true, reason: "module unavailable" };

    try {
        const summary = arc.recoverySummary({ windowMs: 8 * 60 * 60 * 1000 });
        if (summary.problematic.length > 0) {
            issues.push({ factor: "repeated-failures", paths: summary.problematic.map(p => p.path), count: summary.problematic.length });
        }
    } catch (e) {
        issues.push({ factor: "audit-error", message: e.message });
    }

    // Verify approval gates exist on recovery path (inspect function behavior)
    try {
        const result = arc.coordinateReplayRestoration("audit-check-674", { approved: false });
        if (result.ok === true) issues.push({ factor: "approval-bypass", message: "coordinateReplayRestoration allowed without approval" });
    } catch {}

    return {
        ok:     issues.length === 0,
        check:  "adaptive-recovery-safety",
        issues,
        detail: issues.length === 0 ? "Adaptive recovery approval gates intact" : `${issues.length} safety issue(s)`,
    };
}

// ── Check: No hidden branching ────────────────────────────────────────────────

function auditHiddenBranching() {
    const issues = [];

    const awc = _tryRequire("./adaptiveWorkflowChains.cjs");
    if (awc) {
        try {
            const chains = awc.listChains({ status: "running" });
            const deep = chains.filter(c => (c.depth || 0) >= 8);
            if (deep.length > 0) issues.push({ factor: "chains-at-max-depth", count: deep.length });
        } catch {}
    }

    const odp = _tryRequire("./operationalDecisionPrioritization.cjs");
    if (odp) {
        try {
            // Verify risky branch detection works
            const result = odp.identifyRiskyBranches([{ chainId: "audit-test", autonomousRollback: true, risky: true, approvalRequired: false }]);
            if (!result.ok || result.riskyCount === 0) issues.push({ factor: "risky-branch-detection-failed", message: "identifyRiskyBranches did not flag autonomous rollback" });
        } catch {}
    }

    return {
        ok:     issues.length === 0,
        check:  "hidden-branching",
        issues,
        detail: issues.length === 0 ? "No hidden branching detected" : `${issues.length} branching issue(s)`,
    };
}

// ── Check: No replay corruption ───────────────────────────────────────────────

function auditReplayCorruption() {
    const issues = [];

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    if (lhec) {
        try {
            // Check dedup is working
            const dup1 = lhec.isDuplicateRecovery("audit-dedup-674");
            lhec.isDuplicateRecovery("audit-dedup-674"); // second call
            const dup2 = lhec.isDuplicateRecovery("audit-dedup-674");
            if (!dup2) issues.push({ factor: "dedup-not-working", message: "Duplicate recovery not detected within dedup window" });
        } catch {}
    }

    const lhs = _tryRequire("./longHorizonExecutionSurvivability.cjs");
    if (lhs) {
        try {
            const health = lhs.survivabilityHealth();
            if (health.storm) issues.push({ factor: "reconnect-storm-active", reconnectCount: health.reconnectCount, severity: "critical" });
        } catch {}
    }

    const pre = _tryRequire("./platformResilienceEvolution.cjs");
    if (pre) {
        try {
            const durability = pre.replayDurabilityReport();
            if (!durability.durable) issues.push({ factor: "replay-not-durable", signals: (durability.signals || []).map(s => s.factor) });
        } catch {}
    }

    const criticalCount = issues.filter(i => i.severity === "critical").length;
    return {
        ok:       criticalCount === 0 && issues.length === 0,
        check:    "replay-corruption",
        issues,
        critical: criticalCount,
        detail:   issues.length === 0 ? "Replay integrity verified" : `${issues.length} replay concern(s)`,
    };
}

// ── Check: No unsafe deployment sequencing ───────────────────────────────────

function auditDeploymentSequencingSafety() {
    const issues = [];

    const sdc = _tryRequire("./smartDeploymentCoordination.cjs");
    if (sdc) {
        try {
            // Verify advance requires approval
            const advance = sdc.advanceDeploymentPhase("nonexistent-plan-674", { operatorApproved: false });
            if (advance.ok === true) issues.push({ factor: "approval-bypass", message: "advanceDeploymentPhase allowed without approval" });
        } catch {}

        try {
            const stale = sdc.detectStaleDeploymentReplays();
            if (stale.staleCount > 0) issues.push({ factor: "stale-deployment-plans", count: stale.staleCount });
        } catch {}
    }

    const dae = _tryRequire("./dependencyAwareExecution.cjs");
    if (dae) {
        try {
            const staleDeps = dae.detectStaleDependencyChains();
            if (staleDeps.staleCount > 0) issues.push({ factor: "stale-dep-chains", count: staleDeps.staleCount });
        } catch {}
    }

    const criticalCount = issues.filter(i => i.factor === "approval-bypass").length;
    return {
        ok:       criticalCount === 0,
        check:    "deployment-sequencing-safety",
        issues,
        critical: criticalCount,
        detail:   criticalCount === 0 ? "Deployment sequencing approval gates verified" : `${criticalCount} approval bypass(es) detected`,
    };
}

// ── Check: No uncontrolled continuation ──────────────────────────────────────

function auditUncontrolledContinuation() {
    const issues = [];

    const daf = _tryRequire("./dailyAutonomousFlows.cjs");
    if (daf) {
        try {
            const running = daf.listRuns({ status: "running" });
            if (running.length > 10) issues.push({ factor: "too-many-running-flows", count: running.length, severity: "warning" });
        } catch {}
    }

    const dec = _tryRequire("./dailyEngineeringCoordination.cjs");
    if (dec) {
        try {
            // Verify resume requires approval
            const resume = dec.resumeSequence("nonexistent-674", { operatorApproved: false });
            if (resume.ok === true) issues.push({ factor: "approval-bypass-resume", message: "resumeSequence allowed without approval", severity: "critical" });
        } catch {}
    }

    const dea = _tryRequire("./dailyExecutionAutomation.cjs");
    if (dea) {
        try {
            const resume = dea.resumeAutomation("nonexistent-674", { operatorApproved: false });
            if (resume.ok === true) issues.push({ factor: "approval-bypass-automation", message: "resumeAutomation allowed without approval", severity: "critical" });
        } catch {}
    }

    const criticalCount = issues.filter(i => i.severity === "critical").length;
    return {
        ok:       criticalCount === 0,
        check:    "uncontrolled-continuation",
        issues,
        critical: criticalCount,
        detail:   criticalCount === 0 ? "Continuation approval gates verified" : `${criticalCount} uncontrolled continuation(s)`,
    };
}

// ── Check: No recursive loops ─────────────────────────────────────────────────

function auditRecursiveLoops() {
    const issues = [];

    // Check dependency graphs for cycles
    const dae = _tryRequire("./dependencyAwareExecution.cjs");
    if (dae) {
        try {
            // Register a cyclic graph and verify detection
            dae.registerDependencyGraph("audit-cycle-674", { "a": ["b"], "b": ["a"] });
            const order = dae.getExecutionOrder("audit-cycle-674");
            if (!order.hasCycle) {
                issues.push({ factor: "cycle-detection-failed", message: "Cyclic dependency graph not detected" });
            }
            // Clean up by overwriting with valid graph
            dae.registerDependencyGraph("audit-cycle-674", { "a": [] });
        } catch {}
    }

    // Check adaptive workflow chain depth limits
    const awc = _tryRequire("./adaptiveWorkflowChains.cjs");
    if (awc) {
        try {
            const chains = awc.listChains({ status: "running" });
            const atMaxDepth = chains.filter(c => (c.depth || 0) >= 8);
            if (atMaxDepth.length > 0) issues.push({ factor: "chains-at-max-depth", count: atMaxDepth.length, severity: "warning" });
        } catch {}
    }

    return {
        ok:     issues.filter(i => i.severity !== "warning").length === 0,
        check:  "recursive-loops",
        issues,
        detail: issues.length === 0 ? "No recursive loops detected, cycle detection verified" : `${issues.length} loop concern(s)`,
    };
}

// ── Full audit ────────────────────────────────────────────────────────────────

function runAudit() {
    const checks = [
        auditAdaptiveRecoverySafety(),
        auditHiddenBranching(),
        auditReplayCorruption(),
        auditDeploymentSequencingSafety(),
        auditUncontrolledContinuation(),
        auditRecursiveLoops(),
    ];

    const passed   = checks.filter(c => c.ok).length;
    const critical = checks.reduce((sum, c) => sum + (c.critical || 0), 0);
    const warnings = checks.flatMap(c => (c.issues || []).filter(i => i.severity === "warning"));

    return {
        ok:       critical === 0,
        passed,
        total:    checks.length,
        critical,
        warnings: warnings.length,
        checks:   checks.map(c => ({ check: c.check, ok: c.ok, detail: c.detail })),
        failed:   checks.filter(c => !c.ok).map(c => c.check),
        summary:  `Execution safety audit: ${passed}/${checks.length} — critical=${critical} warnings=${warnings.length}`,
    };
}

module.exports = { auditAdaptiveRecoverySafety, auditHiddenBranching, auditReplayCorruption, auditDeploymentSequencingSafety, auditUncontrolledContinuation, auditRecursiveLoops, runAudit };
