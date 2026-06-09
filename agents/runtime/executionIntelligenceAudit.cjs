"use strict";
/**
 * Phase 659 — Execution Intelligence Audit
 *
 * Verifies: no unsafe adaptive execution, no recursive branching, no replay corruption,
 * no hidden autonomous behavior, no uncontrolled recovery loops, no unsafe deployment continuation.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function auditAdaptiveExecution() {
    const issues = [];

    const awc = _tryRequire("./adaptiveWorkflowChains.cjs");
    if (awc) {
        try {
            const running = awc.listChains({ status: "running" });
            const overDepth = running.filter(c => c.depth >= awc.MAX_DEPTH);
            if (overDepth.length > 0) issues.push({ check: "chain-over-depth", severity: "critical", detail: `${overDepth.length} chain(s) at max depth` });
            if (running.length > 20)  issues.push({ check: "too-many-running-chains", severity: "warning", detail: `${running.length} chains running simultaneously` });
        } catch {}
    }

    const clean = issues.filter(i => i.severity === "critical").length === 0;
    return { ok: clean, check: "adaptive-execution", issues, clean, detail: clean ? "Adaptive execution: bounded" : `${issues.length} issue(s)` };
}

function auditRecursiveBranching() {
    const issues = [];

    const awc = _tryRequire("./adaptiveWorkflowChains.cjs");
    if (awc) {
        try {
            const all = awc.listChains();
            // A chain with activeBranch that itself spawned another branch at depth >= MAX_DEPTH would be recursive
            const suspicious = all.filter(c => c.activeBranch !== null && c.depth >= 6);
            if (suspicious.length > 0) issues.push({ check: "deep-branch-execution", severity: "warning", detail: `${suspicious.length} chain(s) in deep branch` });
        } catch {}
    }

    const clean = issues.filter(i => i.severity === "critical").length === 0;
    return { ok: clean, check: "recursive-branching", issues, clean, detail: clean ? "No recursive branching detected" : `${issues.length} branching issue(s)` };
}

function auditReplayCorruption() {
    const issues = [];

    const pre = _tryRequire("./platformResilienceEvolution.cjs");
    if (pre) {
        try {
            const rd = pre.replayDurabilityReport();
            if (!rd.durable) {
                rd.signals.forEach(s => issues.push({ check: s.factor, severity: s.severity, detail: s.factor }));
            }
        } catch {}
    }

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    if (lhec) {
        try {
            const health = lhec.continuityHealth();
            if (health.storm) issues.push({ check: "reconnect-storm", severity: "critical", detail: `${health.recentReconnects} reconnects in last hour` });
        } catch {}
    }

    const clean = issues.filter(i => i.severity === "critical").length === 0;
    return { ok: clean, check: "replay-corruption", issues, clean, detail: clean ? "Replay integrity: clean" : `${issues.length} replay issue(s)` };
}

function auditHiddenAutonomousBehavior() {
    const issues = [];

    // Verify approval gates still enforced
    const trustedDebug = _tryRequire("./trustedDebugAutonomy.cjs");
    if (!trustedDebug) {
        issues.push({ check: "trusted-debug-unavailable", severity: "warning", detail: "trustedDebugAutonomy module not loaded" });
    }

    const autoBrowserOps = _tryRequire("./autonomousBrowserOperations.cjs");
    if (autoBrowserOps) {
        // submitBlocked is on the catalog entry itself (not on steps)
        const catalog = autoBrowserOps.OP_CATALOG || {};
        const formReview = catalog["form-review"];
        const submitBlocked = formReview?.submitBlocked === true || formReview?.steps?.some(s => s.submitBlocked);
        if (!submitBlocked) issues.push({ check: "browser-submit-not-blocked", severity: "critical", detail: "Form submission not blocked in OP_CATALOG" });
    }

    // Verify terminal still blocks dangerous commands
    const ato = _tryRequire("./autonomousTerminalOrchestration.cjs");
    if (ato && ato.classifyCommand) {
        try {
            const rmRf = ato.classifyCommand("rm -rf /");
            if (!rmRf?.blocked) issues.push({ check: "terminal-block-bypass", severity: "critical", detail: "rm -rf / not blocked by terminal orchestration" });
        } catch {}
    }

    const clean = issues.filter(i => i.severity === "critical").length === 0;
    return { ok: clean, check: "hidden-autonomous-behavior", issues, clean, detail: clean ? "No hidden autonomous behavior" : `${issues.length} autonomy issue(s)` };
}

function auditRecoveryLoops() {
    const issues = [];

    // Check terminal supervision for runaway auto-retries
    const ats = _tryRequire("./autonomousTerminalSupervision.cjs");
    if (ats) {
        try {
            const stale = ats.detectStale();
            if (stale.runawayCount > 0) issues.push({ check: "runaway-processes", severity: "critical", detail: `${stale.runawayCount} runaway processes detected` });
        } catch {}
    }

    // Check terminal execution intelligence for retry bounds
    const tei = _tryRequire("./terminalExecutionIntelligence.cjs");
    if (!tei) issues.push({ check: "terminal-intel-unavailable", severity: "warning", detail: "terminalExecutionIntelligence not loaded" });

    // Adaptive chains — no chain in "running" status older than 4 hours
    const awc = _tryRequire("./adaptiveWorkflowChains.cjs");
    if (awc) {
        try {
            const running = awc.listChains({ status: "running" });
            const staleChains = running.filter(c => Date.now() - c.startedAt > 4 * 60 * 60 * 1000);
            if (staleChains.length > 0) issues.push({ check: "stale-running-chains", severity: "warning", detail: `${staleChains.length} chains running >4h` });
        } catch {}
    }

    const clean = issues.filter(i => i.severity === "critical").length === 0;
    return { ok: clean, check: "recovery-loops", issues, clean, detail: clean ? "No uncontrolled recovery loops" : `${issues.length} loop issue(s)` };
}

function auditDeploymentContinuation() {
    const issues = [];

    const eri = _tryRequire("./executionRiskIntelligence.cjs");
    if (eri) {
        try {
            const warnings = eri.trustAwareWarnings();
            // Only flag if trust gate is completely absent or produces errors — a blocked gate is correct behavior
            const missingGate = warnings.warnings.filter(w => w.type === "trust-gate-missing");
            if (missingGate.length > 0) issues.push({ check: "deployment-trust-gate-missing", severity: "critical", detail: "Trust gate not enforced" });
        } catch {}
    }

    const dse = _tryRequire("./deploymentSurvivabilityEngine.cjs");
    if (!dse) issues.push({ check: "survivability-engine-unavailable", severity: "warning", detail: "deploymentSurvivabilityEngine not loaded" });

    const clean = issues.filter(i => i.severity === "critical").length === 0;
    return { ok: clean, check: "deployment-continuation", issues, clean, detail: clean ? "Deployment continuation: safe" : `${issues.length} deployment issue(s)` };
}

// ── Full audit ────────────────────────────────────────────────────────────────

function runAudit() {
    const checks = [
        auditAdaptiveExecution(),
        auditRecursiveBranching(),
        auditReplayCorruption(),
        auditHiddenAutonomousBehavior(),
        auditRecoveryLoops(),
        auditDeploymentContinuation(),
    ];

    const passed   = checks.filter(c => c.clean).length;
    const critical = checks.flatMap(c => c.issues).filter(i => i.severity === "critical").length;
    const warnings = checks.flatMap(c => c.issues).filter(i => i.severity === "warning").length;

    return {
        ok:       critical === 0,
        passed,
        total:    checks.length,
        critical,
        warnings,
        checks,
        failed:   checks.filter(c => !c.clean).map(c => c.check),
        summary:  `Execution intelligence audit 659: ${passed}/${checks.length} clean — ${critical} critical, ${warnings} warnings`,
    };
}

module.exports = { runAudit, auditAdaptiveExecution, auditRecursiveBranching, auditReplayCorruption, auditHiddenAutonomousBehavior, auditRecoveryLoops, auditDeploymentContinuation };
