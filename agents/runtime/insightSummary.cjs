"use strict";
/**
 * Phase 508 — Engineering Insight Summaries
 *
 * Generates calm, concise, operationally-useful summaries for:
 * debugging sessions, deployment operations, recovery chains,
 * repeated failures, unstable workflows.
 *
 * Low-noise: one paragraph max per summary type.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Session summary ───────────────────────────────────────────────────────────

function sessionSummary(sessionId) {
    const sm       = _tryRequire("./engineeringSession.cjs");
    const forensics = _tryRequire("./runtimeForensics.cjs");
    const replay   = _tryRequire("./executionReplayEngine.cjs");

    if (!sm) return { ok: false, error: "session module unavailable" };
    const session = sm.get(sessionId);
    if (!session) return { ok: false, error: "session not found" };

    const ageMins   = Math.round((Date.now() - (session.createdAt || Date.now())) / 60_000);
    const replays   = replay && replay.list ? replay.list({ sessionId, limit: 5 }) : [];
    const events    = forensics ? forensics.query({ sessionId, limit: 20 }) : [];
    const failures  = events.filter(e => e.type === "failure" || e.type === "error");
    const recoveries = events.filter(e => e.type === "recovery");

    const parts = [
        `Session "${session.goal}" has been ${session.state} for ${ageMins} minute(s).`,
    ];
    if (replays.length > 0) parts.push(`${replays.length} replay(s) recorded.`);
    if (failures.length > 0) parts.push(`${failures.length} failure event(s) detected.`);
    if (recoveries.length > 0) parts.push(`${recoveries.length} recovery event(s) executed.`);
    if (session.state === "blocked") parts.push("Session is blocked — investigate before continuing.");
    if (session.state === "completed") parts.push("Session completed successfully.");

    return {
        ok:         true,
        sessionId,
        goal:       session.goal,
        state:      session.state,
        ageMins,
        replayCount:    replays.length,
        failureCount:   failures.length,
        recoveryCount:  recoveries.length,
        summary:        parts.join(" "),
    };
}

// ── Deployment summary ────────────────────────────────────────────────────────

function deploymentSummary(runId) {
    const pipeline = _tryRequire("./deploymentPipeline.cjs");
    if (!pipeline) return { ok: false, error: "pipeline module unavailable" };

    const run = pipeline.getRun(runId);
    if (!run) return { ok: false, error: "run not found" };

    const elapsed    = run.completedAt ? Math.round((run.completedAt - run.createdAt) / 1000) : null;
    const passedStages = run.stages.filter(s => s.state === "passed").length;
    const failedStages = run.stages.filter(s => s.state === "failed").length;

    const parts = [`Deployment run "${run.pipeline}" is ${run.state}.`];
    if (run.dryRun) parts.push("(Dry run)");
    parts.push(`${passedStages}/${run.stages.length} stage(s) passed.`);
    if (failedStages > 0) parts.push(`${failedStages} stage(s) failed.`);
    if (run.rollbackTriggered) parts.push("Rollback was triggered.");
    if (elapsed !== null) parts.push(`Duration: ${elapsed}s.`);
    if (run.state === "awaiting-approval") parts.push("Waiting for operator approval to proceed.");

    const auditEvents = (run.auditLog || []).map(e => e.event).join(", ");
    if (auditEvents) parts.push(`Audit trail: ${auditEvents}.`);

    return {
        ok:            true,
        runId,
        pipeline:      run.pipeline,
        state:         run.state,
        passedStages,
        failedStages,
        totalStages:   run.stages.length,
        rollback:      run.rollbackTriggered,
        elapsedSec:    elapsed,
        summary:       parts.join(" "),
    };
}

// ── Recovery chain summary ────────────────────────────────────────────────────

function recoverySummary(chainName) {
    const analytics = _tryRequire("./operationalAnalytics.cjs");
    const rm        = _tryRequire("./executionRecoveryMemory.cjs");

    const parts = [`Recovery chain: ${chainName}.`];
    let successRate = null, runs = 0;

    if (analytics) {
        try {
            const s = analytics.summary();
            const chain = (s.chains || {})[chainName];
            if (chain) {
                runs = chain.runs || 0;
                successRate = chain.successRate;
                parts.push(`Run ${runs} time(s) with ${Math.round((successRate || 0) * 100)}% success rate.`);
                if (chain.avgMs) parts.push(`Average duration: ${Math.round(chain.avgMs / 1000)}s.`);
            }
        } catch {}
    }

    if (rm && rm.query) {
        try {
            const paths = rm.query({ limit: 100 }).filter(e => e.chainName === chainName && e.type === "validated-path");
            if (paths.length > 0) {
                const best = paths.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
                parts.push(`Best validated run: ${best.confidence}% confidence.`);
            }
        } catch {}
    }

    if (parts.length === 1) parts.push("No analytics data yet for this chain.");

    return {
        ok:          true,
        chainName,
        runs,
        successRate,
        summary:     parts.join(" "),
    };
}

// ── Repeated failure summary ──────────────────────────────────────────────────

function failureSummary(query = "") {
    const forensics = _tryRequire("./runtimeForensics.cjs");
    if (!forensics) return { ok: false, error: "forensics unavailable" };

    const events  = forensics.query({ limit: 100 });
    const failures = events.filter(e => e.type === "failure" || e.type === "error");

    if (failures.length === 0) return { ok: true, summary: "No recent failures detected.", count: 0, patterns: [] };

    // Group by chain/source
    const groups = {};
    failures.forEach(f => {
        const key = f.chain || f.source || "unknown";
        if (!groups[key]) groups[key] = 0;
        groups[key]++;
    });

    const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]);
    const top    = sorted.slice(0, 3);

    const parts = [`${failures.length} failure event(s) in the forensics log.`];
    if (top.length > 0) {
        parts.push(`Most frequent: ${top.map(([k, c]) => `${k} (${c}×)`).join(", ")}.`);
    }
    if (failures.length >= 5) parts.push("High failure frequency — consider safe-mode or recovery workflow.");

    return {
        ok:        true,
        count:     failures.length,
        patterns:  top.map(([chain, count]) => ({ chain, count })),
        summary:   parts.join(" "),
    };
}

// ── Unstable workflow summary ─────────────────────────────────────────────────

function workflowStabilitySummary() {
    const analytics = _tryRequire("./operationalAnalytics.cjs");
    if (!analytics) return { ok: false, error: "analytics unavailable" };

    try {
        const s        = analytics.summary();
        const chains   = s.chains || {};
        const unstable = Object.entries(chains)
            .filter(([, stats]) => stats.runs >= 3 && (stats.successRate || 0) < 0.6)
            .sort((a, b) => (a[1].successRate || 0) - (b[1].successRate || 0))
            .slice(0, 5);

        if (unstable.length === 0) {
            return { ok: true, summary: "All frequently-run workflows are stable.", unstableChains: [] };
        }

        const parts = [`${unstable.length} unstable workflow(s) detected (below 60% success rate).`];
        parts.push(`Chains: ${unstable.map(([n, s]) => `${n} (${Math.round((s.successRate || 0) * 100)}%)`).join(", ")}.`);
        parts.push("Consider reviewing these chains or adding recovery steps.");

        return {
            ok:             true,
            unstableChains: unstable.map(([name, stats]) => ({ name, successRate: stats.successRate, runs: stats.runs })),
            summary:        parts.join(" "),
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── Unified insight report ────────────────────────────────────────────────────

function insightReport({ sessionId, runId, chainName } = {}) {
    const report = {
        ts: new Date().toISOString(),
    };
    if (sessionId)  report.session    = sessionSummary(sessionId);
    if (runId)      report.deployment = deploymentSummary(runId);
    if (chainName)  report.recovery   = recoverySummary(chainName);
    report.failures   = failureSummary();
    report.stability  = workflowStabilitySummary();
    return report;
}

module.exports = { sessionSummary, deploymentSummary, recoverySummary, failureSummary, workflowStabilitySummary, insightReport };
