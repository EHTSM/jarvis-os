"use strict";
/**
 * Phase 685 — Strategic Productivity Optimization
 *
 * Debugging efficiency, deployment readiness, workflow readability,
 * replay discoverability, operational calmness, execution clarity.
 * Reduces: workflow clutter, warning overload, operator fatigue.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Debugging efficiency score ────────────────────────────────────────────────

function debuggingEfficiencyScore() {
    let score = 100;
    const factors = [];

    const sdi = _tryRequire("./smartDebugIntelligence.cjs");
    if (sdi) {
        try {
            const repeated = sdi.detectRepeatedFailures({ windowMs: 4 * 60 * 60 * 1000, minCount: 2 });
            if (repeated.count > 0) { score -= 15 * Math.min(repeated.count, 4); factors.push({ factor: "repeated-failures", count: repeated.count, impact: -15 }); }
        } catch {}
    }

    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    if (arc) {
        try {
            const summary = arc.recoverySummary({ windowMs: 4 * 60 * 60 * 1000 });
            if (summary.problematic.length > 0) { score -= 10; factors.push({ factor: "stuck-recovery", count: summary.problematic.length, impact: -10 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "efficient" : score >= 60 ? "moderate" : "inefficient", factors };
}

// ── Deployment readiness clarity ──────────────────────────────────────────────

function deploymentReadinessClarity(deploymentId = "") {
    const dse = _tryRequire("./deploymentStrategyEngine.cjs");
    if (!dse) return { ok: true, skipped: true };

    try {
        const summary = dse.deploymentReadinessSummary(deploymentId);
        return {
            ok:      summary.ok,
            ready:   summary.ready,
            blocker: summary.blockers[0] || null,
            clarity: summary.blockers.length === 0 ? "clear" : "blocked",
            explainer: summary.recommendation,
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── Workflow readability ──────────────────────────────────────────────────────

function assessWorkflowReadability(workflows = []) {
    const readability = workflows.map(w => {
        let score = 100;
        const issues = [];

        if (!w.name)                        { score -= 10; issues.push("unnamed"); }
        if ((w.depth || 0) >= 5)            { score -= 15; issues.push("deep-chain"); }
        if (!w.replayable)                  { score -= 10; issues.push("not-replayable"); }
        if (!w.hasCheckpoint)               { score -= 10; issues.push("no-checkpoint"); }
        if (!w.approvalRequired && w.risky) { score -= 20; issues.push("unapproved-risky"); }
        if (w.steps?.length > 20)           { score -= 10; issues.push("too-many-steps"); }

        return { id: w.id, score: Math.max(0, score), issues, readable: score >= 70 };
    });

    const avgScore = readability.length > 0
        ? Math.round(readability.reduce((s, r) => s + r.score, 0) / readability.length)
        : 100;

    return {
        ok:          true,
        readability,
        avgScore,
        readable:    readability.filter(r => r.readable).length,
        unreadable:  readability.filter(r => !r.readable).length,
        summary:     `Readability: avg=${avgScore}% — ${readability.filter(r => r.readable).length}/${readability.length} readable`,
    };
}

// ── Replay discoverability ────────────────────────────────────────────────────

function assessReplayDiscoverability(goal = "") {
    const results = [];

    const emc = _tryRequire("./executionMemoryCoordination.cjs");
    if (emc) {
        try {
            const matches = emc.prioritizeRepeatedSuccesses(goal, { limit: 3 });
            results.push(...matches.matches.map(m => ({ source: "memory-coord", id: m.chainId, hits: m.hitCount })));
        } catch {}
    }

    const ems = _tryRequire("./engineeringMemoryStrategy.cjs");
    if (ems) {
        try {
            const matches = ems.prioritizeSuccessfulStrategies(goal, { limit: 3 });
            results.push(...matches.matches.map(m => ({ source: "strategy-memory", id: m.strategyId, hits: m.successCount })));
        } catch {}
    }

    const discoverable = results.length > 0;
    return {
        ok:           true,
        discoverable,
        results:      results.slice(0, 5),
        count:        results.length,
        explainer:    discoverable ? `${results.length} replay(s) discoverable for '${goal}'` : `No replays found for '${goal}'`,
    };
}

// ── Warning noise reduction ───────────────────────────────────────────────────

function reduceWarningNoise(warnings = []) {
    if (!warnings.length) return { ok: true, filtered: [], original: 0, filtered_count: 0 };

    // Dedup by message prefix
    const seen  = new Map();
    const deduped = warnings.filter(w => {
        const key = (w.message || w.factor || w).slice(0, 50);
        if (seen.has(key)) return false;
        seen.set(key, true);
        return true;
    });

    // Priority sort
    const priorityOrder = { critical: 0, high: 1, medium: 2, warning: 3, info: 4 };
    const sorted = deduped.sort((a, b) =>
        (priorityOrder[a.severity] ?? 3) - (priorityOrder[b.severity] ?? 3)
    );

    // Cap at 5
    const filtered = sorted.slice(0, 5);

    return {
        ok:             true,
        filtered,
        original:       warnings.length,
        filtered_count: filtered.length,
        reduced:        warnings.length - filtered.length,
        explainer:      `Warning noise: ${warnings.length} → ${filtered.length} (deduped + capped)`,
    };
}

// ── Operator fatigue score ────────────────────────────────────────────────────

function operatorFatigueScore() {
    let fatigue = 0;
    const factors = [];

    const epc = _tryRequire("./engineeringProductivityCoordination.cjs");
    if (epc) {
        try {
            const calm = epc.operationalCalmnessScore();
            if (calm.score < 60) { fatigue += 25; factors.push({ factor: "low-calmness",  score: calm.score,  impact: 25 }); }
        } catch {}
    }

    const esi = _tryRequire("./executionStateIntelligence.cjs");
    if (esi) {
        try {
            const state = esi.executionStateSummary();
            if (state.interrupted?.count > 0) { fatigue += 5 * Math.min(state.interrupted.count, 5); factors.push({ factor: "interrupted-workflows", count: state.interrupted.count, impact: 5 }); }
            if (state.warnings?.length > 0)   { fatigue += 3 * Math.min(state.warnings.length, 5);  factors.push({ factor: "active-warnings",       count: state.warnings.length,   impact: 3  }); }
        } catch {}
    }

    const level = fatigue >= 40 ? "high" : fatigue >= 20 ? "moderate" : "low";
    return {
        ok:      true,
        fatigue: Math.min(100, fatigue),
        level,
        factors,
        recommendation: level === "high" ? "Reduce active workflows — focus on top priority only" : level === "moderate" ? "Consider clearing interrupted workflows" : "Operator load nominal",
    };
}

// ── Full productivity optimization summary ────────────────────────────────────

function productivityOptimizationSummary() {
    const debugging  = debuggingEfficiencyScore();
    const calmness   = _tryRequire("./engineeringProductivityCoordination.cjs")?.operationalCalmnessScore?.() || { level: "unknown", score: null };
    const fatigue    = operatorFatigueScore();
    const discov     = assessReplayDiscoverability("");

    return {
        ok:               true,
        debuggingScore:   debugging.score,
        debuggingLevel:   debugging.level,
        calmnessLevel:    calmness.level,
        calmnessScore:    calmness.score,
        fatigueLevel:     fatigue.level,
        replayCount:      discov.count,
        summary:          `Productivity: debug=${debugging.level} calmness=${calmness.level} fatigue=${fatigue.level} replays=${discov.count}`,
    };
}

module.exports = { debuggingEfficiencyScore, deploymentReadinessClarity, assessWorkflowReadability, assessReplayDiscoverability, reduceWarningNoise, operatorFatigueScore, productivityOptimizationSummary };
