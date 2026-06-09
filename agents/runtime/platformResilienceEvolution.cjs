"use strict";
/**
 * Phase 657 — Platform Resilience Evolution
 *
 * Workflow survivability, replay durability, runtime-state integrity,
 * deployment rollback safety, adapter recovery coordination, execution continuity.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Workflow survivability ─────────────────────────────────────────────────────

function workflowSurvivabilityReport() {
    const signals = [];
    let score = 100;

    const ws = _tryRequire("./workflowSurvivability.cjs");
    if (ws) {
        try {
            const stale = ws.detectStaleWorkflows();
            if (stale.staleCount > 3) { score -= 20; signals.push({ factor: "stale-workflows", count: stale.staleCount, severity: "warning" }); }
            const surv = ws.survivabilityScore();
            if (surv.score < 60) { score -= 20; signals.push({ factor: "low-survivability", score: surv.score, severity: "warning" }); }
        } catch {}
    }

    const awc = _tryRequire("./adaptiveWorkflowChains.cjs");
    if (awc) {
        try {
            const running = awc.listChains({ status: "running" });
            const deepChains = running.filter(c => c.depth >= 6);
            if (deepChains.length > 0) { score -= 10; signals.push({ factor: "deep-chains", count: deepChains.length, severity: "warning" }); }
        } catch {}
    }

    const normalized = Math.max(0, Math.min(100, score));
    return { ok: normalized >= 60, score: normalized, signals, summary: `Workflow survivability: ${normalized}/100` };
}

// ── Replay durability ─────────────────────────────────────────────────────────

function replayDurabilityReport() {
    const signals = [];
    let durable = true;

    const ers = _tryRequire("./executionReplaySystem.cjs");
    if (ers) {
        try {
            const replays = ers.listReplays ? ers.listReplays({ limit: 10 }) : [];
            const corrupt = replays.filter(r => r.status === "corrupt" || r.status === "failed");
            if (corrupt.length > 0) { durable = false; signals.push({ factor: "corrupt-replays", count: corrupt.length, severity: "critical" }); }
        } catch {}
    }

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    if (lhec) {
        try {
            const health = lhec.continuityHealth();
            if (health.storm) { durable = false; signals.push({ factor: "reconnect-storm", severity: "critical" }); }
        } catch {}
    }

    return { ok: durable, durable, signals, summary: durable ? "Replay durability: intact" : `Durability issues: ${signals.map(s => s.factor).join(", ")}` };
}

// ── Runtime state integrity ───────────────────────────────────────────────────

function runtimeStateIntegrity() {
    const checks = [];
    let intact = true;

    // Process supervision
    const ats = _tryRequire("./autonomousTerminalSupervision.cjs");
    if (ats) {
        try {
            const stale = ats.detectStale();
            const ok = stale.runawayCount === 0;
            if (!ok) intact = false;
            checks.push({ check: "process-supervision", ok, detail: stale.runawayCount > 0 ? `${stale.runawayCount} runaway` : "clean" });
        } catch {}
    }

    // Trust integrity
    const otl = _tryRequire("./operationalTrustLayer.cjs");
    if (otl) {
        try {
            const score = otl.getTrustScore();
            const ok = score.score >= 40;
            if (!ok) intact = false;
            checks.push({ check: "trust-score", ok, detail: `score=${score.score}` });
        } catch {}
    }

    // Adaptive chains bounded
    const awc = _tryRequire("./adaptiveWorkflowChains.cjs");
    if (awc) {
        try {
            const running = awc.listChains({ status: "running" });
            const overDepth = running.filter(c => c.depth >= awc.MAX_DEPTH);
            const ok = overDepth.length === 0;
            if (!ok) intact = false;
            checks.push({ check: "chain-depth-bounds", ok, detail: overDepth.length > 0 ? `${overDepth.length} over-depth` : "all bounded" });
        } catch {}
    }

    return { ok: intact, intact, checks, summary: intact ? "Runtime state: intact" : `Integrity issues in ${checks.filter(c => !c.ok).map(c => c.check).join(", ")}` };
}

// ── Deployment rollback safety ────────────────────────────────────────────────

function deploymentRollbackSafety(ctx = {}) {
    const eri = _tryRequire("./executionRiskIntelligence.cjs");
    let riskLevel = "unknown";
    if (eri) {
        try { riskLevel = eri.riskSummary({ windowMs: 24 * 60 * 60 * 1000 }).overall; } catch {}
    }

    const safeToRollback = riskLevel !== "high" || ctx.operatorApproved;
    const steps = [
        { order: 0, step: "capture-current-state",  safe: true,  autonomous: true },
        { order: 1, step: "verify-rollback-target",  safe: true,  autonomous: true },
        { order: 2, step: "execute-rollback",        safe: false, autonomous: false, requiresApproval: true },
        { order: 3, step: "validate-rollback",       safe: true,  autonomous: true },
    ];

    return {
        ok:              true,
        safeToRollback,
        riskLevel,
        steps,
        approvalRequired: !ctx.operatorApproved,
        warning:         riskLevel === "high" ? "High risk environment — rollback requires explicit approval" : null,
    };
}

// ── Execution continuity summary ──────────────────────────────────────────────

function executionContinuitySummary() {
    const survivability = workflowSurvivabilityReport();
    const replayDurab   = replayDurabilityReport();
    const stateInteg    = runtimeStateIntegrity();

    const allOk = survivability.ok && replayDurab.ok && stateInteg.ok;

    return {
        ok:             allOk,
        survivability:  survivability.score,
        replayDurable:  replayDurab.durable,
        stateIntact:    stateInteg.intact,
        signals:        [...survivability.signals, ...replayDurab.signals, ...stateInteg.checks.filter(c => !c.ok)],
        summary:        `Execution continuity: ${allOk ? "HEALTHY" : "DEGRADED"} — surv=${survivability.score} replay=${replayDurab.durable} state=${stateInteg.intact}`,
    };
}

// ── Full resilience evolution report ─────────────────────────────────────────

function resilienceEvolutionReport() {
    const continuity   = executionContinuitySummary();
    const rollback     = deploymentRollbackSafety();

    // Platform resilience
    const apr = _tryRequire("./advancedPlatformResilience.cjs");
    let watchdog = null;
    if (apr) { try { watchdog = apr.watchdogSummary(); } catch {} }

    const ok = continuity.ok && (watchdog?.ok !== false);
    return {
        ok,
        continuity,
        rollbackSafety: { safeToRollback: rollback.safeToRollback, riskLevel: rollback.riskLevel },
        watchdog:       watchdog ? { ok: watchdog.ok, pressureLevel: watchdog.pressureLevel, cascadeRisk: watchdog.cascadeRisk } : null,
        summary:        `Resilience evolution: ${ok ? "HEALTHY" : "DEGRADED"}`,
    };
}

module.exports = { workflowSurvivabilityReport, replayDurabilityReport, runtimeStateIntegrity, deploymentRollbackSafety, executionContinuitySummary, resilienceEvolutionReport };
