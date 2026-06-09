"use strict";
/**
 * Phase 758 — Engineering Productivity Acceleration
 *
 * Improves debugging speed, deployment prep, workspace restoration,
 * replay discoverability, recovery usability, execution responsiveness.
 * Reduces operator fatigue, workflow clutter, repetitive work.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function debuggingSpeedScore() {
    let score = 100;
    const factors = [];

    const rdf = _tryRequire("./rapidDebuggingFlows.cjs");
    if (rdf) {
        try {
            const h = rdf.debuggingFlowHealth?.();
            if (h && h.storm) { score -= 30; factors.push({ factor: "debugging-storm", impact: -30 }); }
        } catch {}
    }

    const rdse = _tryRequire("./realDebugSessionExperience.cjs");
    if (!rdse) { score -= 15; factors.push({ factor: "debug-session-unavailable", impact: -15 }); }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "fast" : score >= 60 ? "moderate" : "slow", factors };
}

function deploymentPrepScore() {
    let score = 100;
    const factors = [];

    const dee = _tryRequire("./deploymentExecutionExperience.cjs");
    if (!dee) { score -= 20; factors.push({ factor: "deploy-experience-unavailable", impact: -20 }); }

    const dpm = _tryRequire("./deploymentProductivityMaturity.cjs");
    if (dpm) {
        try {
            const r = dpm.operationalTrustReport("");
            if (r.trustScore < 60) { score -= 20; factors.push({ factor: "low-deploy-trust", score: r.trustScore, impact: -20 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "ready" : score >= 60 ? "moderate" : "blocked", factors };
}

function workspaceRestorationScore() {
    let score = 100;
    const factors = [];

    const wee = _tryRequire("./engineeringWorkspaceExperience.cjs");
    if (wee) {
        try {
            const s = wee.workspaceExperienceSummary();
            if (s.freshWorkspaces === 0) { score -= 20; factors.push({ factor: "no-fresh-workspaces", impact: -20 }); }
        } catch {}
    }

    const iwr = _tryRequire("./instantWorkspaceRestoration.cjs");
    if (!iwr) { score -= 10; factors.push({ factor: "instant-restore-unavailable", impact: -10 }); }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "instant" : score >= 60 ? "moderate" : "slow", factors };
}

function replayDiscoverabilityScore() {
    let score = 100;
    const factors = [];

    const lss = _tryRequire("./longSessionSurvivability.cjs");
    if (lss) {
        try {
            const d = lss.assessSurvivabilityDurability();
            if (!d.durable) { score -= 25; factors.push({ factor: "replay-not-durable", impact: -25 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "discoverable" : score >= 60 ? "partial" : "fragmented", factors };
}

function productivityAccelerationReport() {
    const debug    = debuggingSpeedScore();
    const deploy   = deploymentPrepScore();
    const workspace = workspaceRestorationScore();
    const replay   = replayDiscoverabilityScore();

    const avgScore = Math.round((debug.score + deploy.score + workspace.score + replay.score) / 4);
    const fatigue  = avgScore < 60 ? "high" : avgScore < 80 ? "moderate" : "low";

    return {
        ok:        avgScore >= 60,
        avgScore,
        debug:     { score: debug.score, level: debug.level },
        deploy:    { score: deploy.score, level: deploy.level },
        workspace: { score: workspace.score, level: workspace.level },
        replay:    { score: replay.score, level: replay.level },
        fatigue,
        summary:   `Productivity acceleration: score=${avgScore} debug=${debug.level} deploy=${deploy.level} fatigue=${fatigue}`,
    };
}

module.exports = { debuggingSpeedScore, deploymentPrepScore, workspaceRestorationScore, replayDiscoverabilityScore, productivityAccelerationReport };
