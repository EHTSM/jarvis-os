"use strict";
/**
 * Phase 501 — Advanced Workflow Suggestions
 *
 * Suggests: next logical recovery step, validation chain,
 * deployment preparation, environment stabilization, replayable patterns.
 *
 * Bounded (max 5), operator-approved (annotated with approvalLevel),
 * explainable (reason field on every suggestion).
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const MAX_SUGGESTIONS = 5;

// ── Suggestion strategies ─────────────────────────────────────────────────────

function _fromWorkflowLibrary(goal, pressureLevel) {
    const lib = _tryRequire("./workflowLibrary.cjs");
    if (!lib) return [];
    return lib.searchWorkflows(goal, { limit: 5 }).map(w => ({
        type:          "library-workflow",
        workflowId:    w.id,
        name:          w.name,
        category:      w.category,
        approvalLevel: w.steps && w.steps.length > 0
            ? (w.steps.some(s => s.approvalLevel === "CRITICAL") ? "CRITICAL" : w.steps.some(s => s.approvalLevel === "CAUTION") ? "CAUTION" : "SAFE")
            : "SAFE",
        reason:        `Matches goal "${goal}" — category: ${w.category}`,
        confidence:    pressureLevel === "high" ? 60 : 75,
        replayable:    true,
    }));
}

function _fromRecoveryMemory(goal) {
    const rm = _tryRequire("./executionRecoveryMemory.cjs");
    if (!rm || !rm.query) return [];
    try {
        return rm.query({ limit: 100 })
            .filter(e => e.type === "validated-path" && e.confidence >= 60)
            .filter(e => goal && (e.chainName || "").toLowerCase().includes(goal.toLowerCase().split(" ")[0]))
            .slice(0, 3)
            .map(e => ({
                type:          "validated-path",
                chainName:     e.chainName,
                name:          `Replay: ${e.chainName}`,
                approvalLevel: "CAUTION",
                reason:        `Previously validated with confidence ${e.confidence}% — replayable`,
                confidence:    e.confidence,
                replayable:    true,
            }));
    } catch { return []; }
}

function _fromAnalytics(goal) {
    const analytics = _tryRequire("./operationalAnalytics.cjs");
    if (!analytics) return [];
    try {
        const summary = analytics.summary();
        const chains  = summary.chains || {};
        return Object.entries(chains)
            .filter(([name]) => name.toLowerCase().includes(goal.toLowerCase().split(" ")[0]))
            .filter(([, stats]) => (stats.successRate || 0) > 0.7 && stats.runs > 2)
            .slice(0, 2)
            .map(([name, stats]) => ({
                type:          "high-success-chain",
                chainName:     name,
                name:          `Proven: ${name}`,
                approvalLevel: "CAUTION",
                reason:        `${Math.round((stats.successRate || 0) * 100)}% success rate across ${stats.runs} runs`,
                confidence:    Math.round((stats.successRate || 0) * 100),
                replayable:    true,
            }));
    } catch { return []; }
}

function _nextRecoveryStep(goal, sessionState) {
    const suggestions = [];
    const g = goal.toLowerCase();

    if (sessionState === "blocked") {
        suggestions.push({ type: "recovery-step", name: "Unblock session", approvalLevel: "CAUTION",
            reason: "Session is blocked — run diagnostics chain", confidence: 80, replayable: false,
            action: "GET /api/runtime/dashboard" });
    }

    if (g.includes("deploy")) {
        suggestions.push({ type: "deployment-prep", name: "Deployment preflight", approvalLevel: "SAFE",
            reason: "Deployment goal detected — run preflight check first", confidence: 85, replayable: false,
            action: "GET /api/runtime/deployments/preflight/standard-deploy" });
    }

    if (g.includes("recover") || g.includes("restore") || g.includes("fix")) {
        suggestions.push({ type: "validation", name: "Post-recovery validation", approvalLevel: "SAFE",
            reason: "After recovery — validate system health", confidence: 80, replayable: false,
            action: "GET /api/runtime/dashboard" });
    }

    return suggestions;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate bounded, explainable workflow suggestions.
 * @param {{ goal, sessionId?, sessionState?, pressureLevel? }} context
 */
function suggest(context = {}) {
    const { goal = "", sessionId, sessionState = "active", pressureLevel = "nominal" } = context;
    if (!goal.trim()) return [];

    const fromLib      = _fromWorkflowLibrary(goal, pressureLevel);
    const fromMemory   = _fromRecoveryMemory(goal);
    const fromAnalytics = _fromAnalytics(goal);
    const nextSteps    = _nextRecoveryStep(goal, sessionState);

    const all = [...nextSteps, ...fromMemory, ...fromAnalytics, ...fromLib]
        .sort((a, b) => b.confidence - a.confidence);

    // Dedupe by name
    const seen = new Set();
    const deduped = all.filter(s => { if (seen.has(s.name)) return false; seen.add(s.name); return true; });

    return deduped.slice(0, MAX_SUGGESTIONS);
}

/**
 * Suggest the single most likely next step.
 */
function nextStep(goal, sessionState = "active") {
    const suggestions = suggest({ goal, sessionState });
    return suggestions[0] || null;
}

module.exports = { suggest, nextStep };
