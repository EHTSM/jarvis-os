"use strict";
/**
 * Phase 664 — Execution State Intelligence
 *
 * Tracks active workflow pressure, replay-chain integrity, runtime degradation,
 * unstable execution patterns, interrupted workflow states.
 * Generates execution-state summaries, stability warnings, recovery recommendations.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Active workflow pressure ───────────────────────────────────────────────────

function activeWorkflowPressure() {
    let pressure = 0;
    const signals = [];

    const daf = _tryRequire("./dailyAutonomousFlows.cjs");
    if (daf) {
        try {
            const runs = daf.listRuns({ status: "running" });
            if (runs.length > 5)  { pressure += 20; signals.push({ factor: "many-running-flows",  count: runs.length,  impact: 20 }); }
            else if (runs.length > 2) { pressure += 8; signals.push({ factor: "active-flows",     count: runs.length,  impact: 8  }); }
        } catch {}
    }

    const awc = _tryRequire("./adaptiveWorkflowChains.cjs");
    if (awc) {
        try {
            const chains = awc.listChains({ status: "running" });
            const deep   = chains.filter(c => c.depth >= 5);
            if (deep.length > 0)  { pressure += 15; signals.push({ factor: "deep-chains", count: deep.length, impact: 15 }); }
        } catch {}
    }

    const dea = _tryRequire("./dailyExecutionAutomation.cjs");
    if (dea) {
        try {
            const runs = dea.listRuns({ status: "running" });
            if (runs.length > 3)  { pressure += 10; signals.push({ factor: "running-automations", count: runs.length, impact: 10 }); }
        } catch {}
    }

    const level = pressure >= 40 ? "high" : pressure >= 20 ? "moderate" : "low";
    return { ok: level !== "high", pressure, level, signals };
}

// ── Replay chain integrity ─────────────────────────────────────────────────────

function replayChainIntegrity() {
    const issues = [];

    const pre = _tryRequire("./platformResilienceEvolution.cjs");
    if (pre) {
        try {
            const rd = pre.replayDurabilityReport();
            if (!rd.durable) issues.push(...rd.signals.map(s => ({ factor: s.factor, severity: s.severity })));
        } catch {}
    }

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    if (lhec) {
        try {
            const h = lhec.continuityHealth();
            if (h.storm) issues.push({ factor: "reconnect-storm", severity: "critical" });
        } catch {}
    }

    const intact = issues.filter(i => i.severity === "critical").length === 0;
    return { ok: intact, intact, issues, detail: intact ? "Replay chains intact" : `${issues.length} integrity issue(s)` };
}

// ── Runtime degradation detection ─────────────────────────────────────────────

function detectRuntimeDegradation() {
    const degraded  = [];

    const apr = _tryRequire("./advancedPlatformResilience.cjs");
    if (apr) {
        try {
            const dm = apr.detectDegradedMode();
            if (dm.degraded) degraded.push({ factor: "platform-degraded", pressureScore: dm.pressureScore, restrictions: dm.restrictions });
        } catch {}
    }

    const ote = _tryRequire("./operatorTrustEvolution.cjs");
    if (ote) {
        try {
            const prog = ote.trustProgression({ windowDays: 3 });
            if (prog.trend === "declining" && prog.score < 50) degraded.push({ factor: "trust-declining", score: prog.score, trend: prog.trend });
        } catch {}
    }

    const isDegraded = degraded.length > 0;
    return {
        ok:          !isDegraded,
        degraded:    isDegraded,
        factors:     degraded,
        recommendations: isDegraded ? degraded.map(d => `Address ${d.factor}`) : [],
        detail:      isDegraded ? `Degradation: ${degraded.map(d => d.factor).join(", ")}` : "Runtime healthy",
    };
}

// ── Unstable execution pattern detection ─────────────────────────────────────

function detectUnstablePatterns() {
    const patterns = [];

    const sdi = _tryRequire("./smartDebugIntelligence.cjs");
    if (sdi) {
        try {
            const repeated = sdi.detectRepeatedFailures({ windowMs: 2 * 60 * 60 * 1000, minCount: 3 });
            if (repeated.count > 0) patterns.push({ type: "repeated-failures", count: repeated.count, patterns: repeated.repeated.map(r => r.errorText?.slice(0, 50)) });
        } catch {}
    }

    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    if (arc) {
        try {
            const summary = arc.recoverySummary({ windowMs: 2 * 60 * 60 * 1000 });
            if (summary.problematic.length > 0) patterns.push({ type: "stuck-recovery", paths: summary.problematic.map(p => p.path) });
        } catch {}
    }

    const unstable = patterns.length > 0;
    return { ok: !unstable, unstable, patterns, detail: unstable ? `Unstable patterns: ${patterns.map(p => p.type).join(", ")}` : "Execution patterns stable" };
}

// ── Interrupted workflow states ───────────────────────────────────────────────

function interruptedWorkflowStates() {
    const interrupted = [];

    const daf = _tryRequire("./dailyAutonomousFlows.cjs");
    if (daf) {
        try {
            const runs = daf.listRuns({ status: "interrupted" });
            runs.slice(0, 10).forEach(r => interrupted.push({ type: "autonomous-flow", id: r.id, name: r.flowName, resumeFrom: r.currentStep }));
        } catch {}
    }

    const dea = _tryRequire("./dailyExecutionAutomation.cjs");
    if (dea) {
        try {
            const runs = dea.listRuns({ status: "interrupted" });
            runs.slice(0, 10).forEach(r => interrupted.push({ type: "automation", id: r.id, name: r.name, resumeFrom: r.currentStep }));
        } catch {}
    }

    return {
        ok:    true,
        count: interrupted.length,
        interrupted,
        detail: interrupted.length > 0 ? `${interrupted.length} interrupted workflow(s) awaiting resume` : "No interrupted workflows",
    };
}

// ── Full execution state summary ──────────────────────────────────────────────

function executionStateSummary() {
    const pressure    = activeWorkflowPressure();
    const replay      = replayChainIntegrity();
    const degradation = detectRuntimeDegradation();
    const patterns    = detectUnstablePatterns();
    const interrupted = interruptedWorkflowStates();

    const warnings = [];
    if (!pressure.ok)    warnings.push(`Workflow pressure: ${pressure.level}`);
    if (!replay.ok)      warnings.push(`Replay integrity issues: ${replay.issues.length}`);
    if (degradation.degraded) warnings.push(`Runtime degraded: ${degradation.factors.map(f => f.factor).join(", ")}`);
    if (patterns.unstable)    warnings.push(`Unstable patterns: ${patterns.patterns.length}`);

    const stable = warnings.length === 0;

    return {
        ok:          stable,
        stable,
        pressure:    { level: pressure.level, score: pressure.pressure },
        replay:      { intact: replay.intact },
        degradation: { degraded: degradation.degraded },
        patterns:    { unstable: patterns.unstable, count: patterns.patterns.length },
        interrupted: { count: interrupted.count },
        warnings,
        recommendations: [
            ...degradation.recommendations,
            ...interrupted.interrupted.slice(0, 2).map(i => `Resume interrupted ${i.type}: ${i.name}`),
        ],
        summary: `Execution state: ${stable ? "STABLE" : "UNSTABLE"} — pressure=${pressure.level} replay=${replay.intact} degraded=${degradation.degraded}`,
    };
}

module.exports = { activeWorkflowPressure, replayChainIntegrity, detectRuntimeDegradation, detectUnstablePatterns, interruptedWorkflowStates, executionStateSummary };
