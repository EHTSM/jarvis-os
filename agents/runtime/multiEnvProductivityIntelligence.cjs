"use strict";
/**
 * Phase 711 — Multi-Environment Productivity Intelligence
 *
 * Cross-tool coordination, workspace continuity, replay discoverability,
 * execution clarity, debugging flow, deployment sequencing.
 * Reduces: workflow clutter, operator fatigue, warning overload.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Cross-tool coordination score ─────────────────────────────────────────────

function crossToolCoordinationScore() {
    let score = 100;
    const factors = [];

    const cee = _tryRequire("./crossEnvironmentExecution.cjs");
    if (cee) {
        try {
            const summary = cee.crossEnvSummary();
            if (summary.interrupted > 0) { score -= 15 * Math.min(summary.interrupted, 3); factors.push({ factor: "cross-env-interrupted", count: summary.interrupted, impact: -15 }); }
        } catch {}
    }

    const odc = _tryRequire("./operationalDecisionCoordination.cjs");
    if (odc) {
        try {
            const unstable = odc.detectUnstableCoordinationStates();
            if (!unstable.stable) { score -= 20; factors.push({ factor: "coordination-unstable", issues: unstable.issues.length, impact: -20 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "coordinated" : score >= 60 ? "partial" : "uncoordinated", factors };
}

// ── Workspace continuity score ────────────────────────────────────────────────

function workspaceContinuityScore() {
    let score = 100;
    const factors = [];

    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc) {
        try {
            const health = lhwc.workspaceContinuityHealth();
            if (health.storm)             { score -= 40; factors.push({ factor: "reconnect-storm", impact: -40 }); }
            if (health.staleSessions > 2) { score -= 10; factors.push({ factor: "stale-sessions", count: health.staleSessions, impact: -10 }); }
            if (!health.replayDurable)    { score -= 20; factors.push({ factor: "replay-not-durable", impact: -20 }); }
        } catch {}
    }

    const iwr = _tryRequire("./instantWorkspaceRestoration.cjs");
    if (iwr) {
        try {
            const health = iwr.workspaceRestoreHealth();
            if (health.freshSnapshots === 0) { score -= 10; factors.push({ factor: "no-fresh-snapshots", impact: -10 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "continuous" : score >= 60 ? "partial" : "fragile", factors };
}

// ── Replay discoverability ────────────────────────────────────────────────────

function replayDiscoverabilityScore() {
    let count = 0;
    const sources = [];

    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc) {
        try {
            const list = lhwc.listWorkspaceSessions({ limit: 10 });
            count += list.length;
            if (list.length > 0) sources.push({ source: "workspace-sessions", count: list.length });
        } catch {}
    }

    const mpci = _tryRequire("./multiProjectContextIntelligence.cjs");
    if (mpci) {
        try {
            const projects = mpci.listProjects();
            count += projects.length;
            if (projects.length > 0) sources.push({ source: "project-contexts", count: projects.length });
        } catch {}
    }

    const score = Math.min(100, count * 10);
    return { ok: true, score, count, sources, discoverable: count > 0, level: score >= 60 ? "discoverable" : "sparse" };
}

// ── Execution clarity score ───────────────────────────────────────────────────

function executionClarityScore() {
    let score = 100;
    const factors = [];

    const epc = _tryRequire("./executionProductivityChains.cjs");
    if (epc) {
        try {
            const running = epc.listProductivityChains({ status: "running" });
            if (running.length > 8) { score -= 15; factors.push({ factor: "too-many-concurrent-chains", count: running.length, impact: -15 }); }
        } catch {}
    }

    const rdf = _tryRequire("./rapidDebuggingFlows.cjs");
    if (rdf) {
        try {
            const health = rdf.debugRuntimeHealthCheck();
            if (!health.ok) { score -= 20; factors.push({ factor: "runtime-unhealthy", impact: -20 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "clear" : score >= 60 ? "moderate" : "cluttered", factors };
}

// ── Reduce operator fatigue ───────────────────────────────────────────────────

function reduceOperatorFatigue(signals = []) {
    // Deduplicate, prioritize, cap at 5
    const seen = new Map();
    const prioritized = [];

    const severityOrder = { critical: 0, warning: 1, info: 2 };
    const sorted = [...signals].sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

    sorted.forEach(s => {
        const key = `${s.type || s.factor}:${s.message || s.msg || ""}`.slice(0, 80);
        if (!seen.has(key)) {
            seen.set(key, true);
            prioritized.push(s);
        }
    });

    const capped = prioritized.slice(0, 5);
    const suppressed = signals.length - capped.length;
    return { ok: true, signals: capped, suppressed, original: signals.length, detail: `Fatigue reduction: showing ${capped.length}/${signals.length} signals` };
}

// ── Deployment sequencing clarity ─────────────────────────────────────────────

function deploymentSequencingClarity() {
    const rdw = _tryRequire("./rapidDeploymentWorkflows.cjs");
    if (!rdw) return { ok: true, skipped: true, ready: false };

    try {
        const readiness = rdw.scanEnvironmentReadiness("production");
        return {
            ok:    readiness.ok,
            ready: readiness.ready,
            checks: readiness.checks.length,
            detail: `Deployment sequencing: ready=${readiness.ready} checks=${readiness.checks.length}`,
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── Full productivity intelligence summary ────────────────────────────────────

function multiEnvProductivitySummary() {
    const coordination = crossToolCoordinationScore();
    const continuity   = workspaceContinuityScore();
    const replay       = replayDiscoverabilityScore();
    const clarity      = executionClarityScore();
    const deployment   = deploymentSequencingClarity();

    const avgScore = Math.round((coordination.score + continuity.score + clarity.score) / 3);

    return {
        ok:             true,
        avgScore,
        coordination:   { score: coordination.score, level: coordination.level },
        continuity:     { score: continuity.score,   level: continuity.level   },
        replay:         { count: replay.count,        discoverable: replay.discoverable },
        clarity:        { score: clarity.score,       level: clarity.level     },
        deployment:     { ready: deployment.ready },
        level:          avgScore >= 80 ? "productive" : avgScore >= 60 ? "moderate" : "degraded",
        summary:        `Multi-env productivity: score=${avgScore} coord=${coordination.level} continuity=${continuity.level} replays=${replay.count}`,
    };
}

module.exports = { crossToolCoordinationScore, workspaceContinuityScore, replayDiscoverabilityScore, executionClarityScore, reduceOperatorFatigue, deploymentSequencingClarity, multiEnvProductivitySummary };
