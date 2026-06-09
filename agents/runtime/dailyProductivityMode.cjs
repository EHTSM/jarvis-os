"use strict";
/**
 * Phase 592 — Daily Engineering Productivity Mode
 *
 * Optimizes: debugging continuity, deployment workflows, patch readability,
 *            execution visibility, replay navigation, workflow discoverability.
 *
 * Reduces: operational clutter, warning fatigue, replay overload.
 * Integrates calmness, memory, timeline, and validation for daily operator use.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Daily operator briefing ───────────────────────────────────────────────────

/**
 * Generate a concise daily briefing for the operator.
 * Surfaces: yesterday's stats, ready-to-run chains, any blockers.
 */
function dailyBriefing(sessionId = null) {
    const dv   = _tryRequire("./dailyEngineeringValidation.cjs");
    const da   = _tryRequire("./deploymentAssist.cjs");
    const ec   = _tryRequire("./engineeringChains.cjs");
    const mem  = _tryRequire("./operatorWorkflowMemory.cjs");
    const tl   = _tryRequire("./executionTimeline.cjs");
    const calm = _tryRequire("./executionCalmness.cjs");

    const sections = {};

    // Yesterday's metrics
    if (dv) {
        try { sections.metrics = dv.todayReport(); } catch {}
    }

    // Deploy readiness
    if (da) {
        try {
            const dep = da.dependencyIntegrityCheck();
            const rr  = da.runtimeReadiness();
            sections.deployStatus = { depOk: dep.ok, runtimeReady: rr.ready, issues: rr.issues.length };
        } catch {}
    }

    // Available chains
    if (ec) {
        try { sections.availableChains = ec.listChains().map(c => c.name); } catch {}
    }

    // Memory suggestions
    if (mem) {
        try { sections.memorySuggestions = mem.stats(); } catch {}
    }

    // Timeline recent
    if (tl) {
        try { sections.recentActivity = tl.recentSummary(10); } catch {}
    }

    // Calmness config
    if (calm && sessionId) {
        try { sections.calmnessConfig = calm.getConfig(sessionId); } catch {}
    }

    return { sessionId, generatedAt: Date.now(), ...sections };
}

// ── Workflow discoverability ──────────────────────────────────────────────────

/**
 * Suggest workflows relevant to the operator's current goal.
 */
function discoverWorkflows(goal = "") {
    const ec   = _tryRequire("./engineeringChains.cjs");
    const pce  = _tryRequire("./productivityChainEngine.cjs");
    const mem  = _tryRequire("./operatorWorkflowMemory.cjs");
    const bwe  = _tryRequire("./browserWorkflowEngine.cjs");
    const tw   = _tryRequire("./terminalWorkflows.cjs");

    const lower     = goal.toLowerCase();
    const results   = { goal, chains: [], sequences: [], browserWorkflows: [], memoryMatches: [] };

    if (ec) {
        try {
            const all = ec.listChains();
            results.chains = all.filter(c => c.name.includes(lower.split(" ")[0]) || lower.length === 0).slice(0, 5);
        } catch {}
    }

    if (tw) {
        try { results.sequences = tw.listSequences().slice(0, 5); } catch {}
    }

    if (bwe) {
        try {
            results.browserWorkflows = Object.entries(bwe.WORKFLOW_CATALOG || {}).map(([name, d]) => ({ name, desc: d.desc })).slice(0, 4);
        } catch {}
    }

    if (mem && goal) {
        try { results.memoryMatches = mem.suggest(goal); } catch {}
    }

    return results;
}

// ── Patch readability formatter ───────────────────────────────────────────────

/**
 * Format a patch batch for operator review — clean, minimal, focused.
 */
function formatPatchForReview(batch) {
    if (!batch) return { formatted: "No batch provided" };
    const lines = [
        `Batch: ${batch.id}`,
        `Files: ${batch.fileCount || 0}`,
        `Status: ${batch.status}`,
        `Proposed: ${batch.proposedAt ? new Date(batch.proposedAt).toISOString() : "unknown"}`,
        "",
    ];

    (batch.files || []).forEach((f, i) => {
        lines.push(`[${i + 1}] ${f.filePath}`);
        lines.push(`    Reason: ${f.reason || "(no reason)"}`);
        lines.push(`    +${f.linesAdded || 0} lines  -${f.linesRemoved || 0} lines  ~${f.linesChanged || 0} changes`);
        if (f.preview) {
            lines.push("    Preview:");
            f.preview.split("\n").slice(0, 10).forEach(l => lines.push(`      ${l}`));
        }
        lines.push("");
    });

    return { formatted: lines.join("\n"), fileCount: batch.fileCount || 0 };
}

// ── Replay navigator ──────────────────────────────────────────────────────────

/**
 * Navigate replays for an operator — lists recent, groups by goal.
 */
function replayNavigator(limit = 20) {
    const tl = _tryRequire("./executionTimeline.cjs");
    if (!tl) return { available: false };

    const replays = tl.search({ type: "replay", limit });
    const byGoal  = {};

    for (const r of replays) {
        const key = (r.meta?.goal || "unknown").slice(0, 50);
        if (!byGoal[key]) byGoal[key] = [];
        byGoal[key].push({ id: r.id, replayId: r.replayId, ts: r.ts });
    }

    return {
        total:   replays.length,
        byGoal,
        recent:  replays.slice(0, 5),
    };
}

// ── Clutter reduction ─────────────────────────────────────────────────────────

/**
 * Filter a list of alerts/events to show only high-signal items.
 * Suppresses: monitoring noise, repeated low-priority items.
 */
function filterClutter(items = [], sessionId = null) {
    const calm = _tryRequire("./executionCalmness.cjs");
    if (!calm) return { items, filtered: 0 };

    let filtered = 0;
    const kept   = items.filter(item => {
        const level    = item.severity || item.level || "info";
        if (!calm.shouldShowLog(sessionId || "default", level)) { filtered++; return false; }
        const evalResult = calm.evaluateWarning(sessionId || "default", item.key || item.message || JSON.stringify(item).slice(0, 60), level);
        if (!evalResult.show) { filtered++; return false; }
        return true;
    });

    return { items: kept, original: items.length, filtered };
}

module.exports = { dailyBriefing, discoverWorkflows, formatPatchForReview, replayNavigator, filterClutter };
