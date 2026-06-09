"use strict";
/**
 * Phase 762 — Execution UX Refinement
 *
 * Workflow readability, execution calmness, replay navigation,
 * debugging clarity, deployment visibility, operational discoverability.
 * Reduces visual clutter, warning overload, operator fatigue.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function workflowReadabilityScore() {
    let score = 100;
    const factors = [];

    const evm = _tryRequire("./executionVisibilityMaturity.cjs");
    if (evm) {
        try {
            const r = evm.executionVisibilityReport();
            if (!r.ok) { score -= 15; factors.push({ factor: "visibility-issues", impact: -15 }); }
            if (r.recovery?.recommendations > 5) { score -= 10; factors.push({ factor: "too-many-recovery-recs", count: r.recovery.recommendations, impact: -10 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "readable" : score >= 60 ? "moderate" : "cluttered", factors };
}

function calmnessScore() {
    let score = 100;
    const factors = [];

    const lss = _tryRequire("./longSessionSurvivability.cjs");
    if (lss) {
        try {
            const h = lss.survivabilityHealth();
            if (h.storm) { score -= 30; factors.push({ factor: "survivability-storm", impact: -30 }); }
            if (h.staleSessions > 5) { score -= 15; factors.push({ factor: "many-stale-sessions", count: h.staleSessions, impact: -15 }); }
        } catch {}
    }

    const ecc = _tryRequire("./engineeringCommandCenter.cjs");
    if (ecc) {
        try {
            const d = ecc.commandCenterDashboard();
            if (d.storm) { score -= 20; factors.push({ factor: "command-center-storm", impact: -20 }); }
            if ((d.criticalCount || 0) > 3) { score -= 15; factors.push({ factor: "critical-flood", count: d.criticalCount, impact: -15 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "calm" : score >= 60 ? "moderate" : "noisy", factors };
}

function deploymentVisibilityScore() {
    let score = 100;
    const factors = [];

    const dee = _tryRequire("./deploymentExecutionExperience.cjs");
    if (!dee) { score -= 20; factors.push({ factor: "deploy-experience-unavailable", impact: -20 }); }

    const evm = _tryRequire("./executionVisibilityMaturity.cjs");
    if (evm) {
        try {
            const r = evm.rollbackReadinessIndicator();
            if (!r.ready) { score -= 10; factors.push({ factor: "rollback-not-ready", impact: -10 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "visible" : score >= 60 ? "partial" : "opaque", factors };
}

function suppressWarningOverload(warnings = []) {
    if (!Array.isArray(warnings)) return { ok: false, error: "warnings must be array" };
    const SEV_RANK = { critical: 3, warning: 2, info: 1 };
    const seen = new Set();
    const filtered = warnings
        .sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0))
        .filter(w => {
            const key = `${w.source}:${w.check}:${w.severity}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 5);

    return { ok: true, original: warnings.length, filtered: filtered.length, warnings: filtered };
}

function executionUXReport() {
    const readability  = workflowReadabilityScore();
    const calmness     = calmnessScore();
    const visibility   = deploymentVisibilityScore();

    const avgScore = Math.round((readability.score + calmness.score + visibility.score) / 3);

    return {
        ok:           avgScore >= 60,
        avgScore,
        readability:  { score: readability.score, level: readability.level },
        calmness:     { score: calmness.score, level: calmness.level },
        visibility:   { score: visibility.score, level: visibility.level },
        fatigue:      avgScore >= 80 ? "low" : avgScore >= 60 ? "moderate" : "high",
        summary:      `Execution UX: score=${avgScore} readability=${readability.level} calm=${calmness.level} visibility=${visibility.level}`,
    };
}

module.exports = { workflowReadabilityScore, calmnessScore, deploymentVisibilityScore, suppressWarningOverload, executionUXReport };
