"use strict";
/**
 * Phase 748 — Platform Intelligence UX
 *
 * Ensures intelligence surfaces are calm, readable, and non-overwhelming.
 * Measures: signal-to-noise ratio, action queue clarity, context coherence,
 * alert volume appropriateness.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function signalNoiseScore() {
    let score = 100;
    const factors = [];

    const psa = _tryRequire("./platformSignalAggregation.cjs");
    if (psa) {
        try {
            const agg = psa.aggregateSignals({ maxAge: 60 * 60 * 1000 });
            const noiseRatio = agg.total > 0 ? agg.warningCount / agg.total : 0;
            if (noiseRatio > 0.7) { score -= 25; factors.push({ factor: "high-warning-ratio", ratio: noiseRatio, impact: -25 }); }
            if (agg.criticalCount > 5) { score -= 20; factors.push({ factor: "critical-flood", count: agg.criticalCount, impact: -20 }); }
        } catch {}
    }

    const iaf = _tryRequire("./intelligentAlertFiltering.cjs");
    if (iaf) {
        try {
            const stats = iaf.alertFilteringStats();
            if (stats.suppressionRate < 20 && stats.total > 20) { score -= 10; factors.push({ factor: "low-suppression", rate: stats.suppressionRate, impact: -10 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "clean" : score >= 60 ? "moderate" : "noisy", factors };
}

function actionQualityScore() {
    let score = 100;
    const factors = [];

    const ois = _tryRequire("./operatorIntelligenceSurface.cjs");
    if (ois) {
        try {
            const actions = ois.operatorActionQueue();
            if (actions.count > 10) { score -= 20; factors.push({ factor: "action-overflow", count: actions.count, impact: -20 }); }
            if (actions.count === 0) { score -= 5; factors.push({ factor: "empty-action-queue", impact: -5 }); }
        } catch {}
    }

    const owo = _tryRequire("./operatorWorkflowOrchestration.cjs");
    if (owo) {
        try {
            const active = owo.listActiveWorkflows();
            if (active.count > 5) { score -= 15; factors.push({ factor: "too-many-active-workflows", count: active.count, impact: -15 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "focused" : score >= 60 ? "moderate" : "cluttered", factors };
}

function contextCoherenceScore() {
    let score = 100;
    const factors = [];

    const ics = _tryRequire("./intelligentContextSwitching.cjs");
    if (ics) {
        try {
            const ctx = ics.getActiveContext();
            if (!ctx.active) { score -= 10; factors.push({ factor: "no-active-context", impact: -10 }); }
            if (ctx.stale)   { score -= 20; factors.push({ factor: "stale-active-context", impact: -20 }); }
        } catch {}
    }

    const aoc = _tryRequire("./adaptiveOperatorContext.cjs");
    if (aoc) {
        try {
            const ctx = aoc.getOperatorContext();
            if (!ctx.focusActive) { score -= 5; factors.push({ factor: "no-focus", impact: -5 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "coherent" : score >= 60 ? "partial" : "fragmented", factors };
}

function intelligenceUXReport() {
    const noise     = signalNoiseScore();
    const actions   = actionQualityScore();
    const coherence = contextCoherenceScore();

    const avgScore = Math.round((noise.score + actions.score + coherence.score) / 3);

    return {
        ok:        avgScore >= 60,
        avgScore,
        noise:     { score: noise.score, level: noise.level },
        actions:   { score: actions.score, level: actions.level },
        coherence: { score: coherence.score, level: coherence.level },
        calmness:  { level: avgScore >= 80 ? "calm" : avgScore >= 60 ? "moderate" : "overwhelming" },
        summary:   `Intelligence UX: score=${avgScore} noise=${noise.level} actions=${actions.level} coherence=${coherence.level}`,
    };
}

module.exports = { signalNoiseScore, actionQualityScore, contextCoherenceScore, intelligenceUXReport };
