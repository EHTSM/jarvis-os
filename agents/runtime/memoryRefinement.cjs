"use strict";
/**
 * Phase 490 — Operator Memory Refinement
 *
 * Improves engineering memory quality: deduplication, noise reduction,
 * quality scoring, pruning of low-value entries, workflow recommendation
 * improvement, and operational continuity scoring.
 *
 * Operates on: engineeringMemory, executionRecoveryMemory, operationalAnalytics.
 * All mutations go through the source module's own persistence.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Memory quality scoring ────────────────────────────────────────────────────

function _scoreMemoryEntry(entry) {
    let score = 0;
    // Confidence contributes most
    if (typeof entry.confidence === "number") score += Math.min(50, entry.confidence * 0.5);
    // Recency
    const ageMs = Date.now() - (entry.ts || entry.recordedAt || 0);
    const ageDays = ageMs / 86_400_000;
    if (ageDays < 7)  score += 20;
    else if (ageDays < 14) score += 10;
    else if (ageDays < 30) score += 5;
    // Has chain/cmd (concrete)
    if (entry.chainName || entry.cmd) score += 15;
    // Has context
    if (entry.context && Object.keys(entry.context).length > 0) score += 10;
    // Success outcome
    if (entry.type === "validated-path" || entry.outcome === "success") score += 10;
    return Math.round(Math.min(100, score));
}

// ── Deduplication ─────────────────────────────────────────────────────────────

/**
 * Find duplicate entries in engineering memory (same chain, similar context).
 * Returns { duplicates: Array<{keep, remove}> }
 */
function findDuplicates() {
    const em = _tryRequire("./engineeringMemory.cjs");
    if (!em || !em.recent) return { duplicates: [], checked: 0 };

    const entries  = em.recent(200);
    const byChain  = {};
    entries.forEach(e => {
        const key = e.chainName || "unknown";
        if (!byChain[key]) byChain[key] = [];
        byChain[key].push(e);
    });

    const duplicates = [];
    for (const [chain, group] of Object.entries(byChain)) {
        if (group.length < 2) continue;
        // Sort by confidence descending — keep the best one
        group.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
        const keep = group[0];
        const remove = group.slice(1).map(e => e.id).filter(Boolean);
        if (remove.length > 0) duplicates.push({ chain, keep: keep.id, remove });
    }

    return { duplicates, checked: entries.length };
}

/**
 * Prune low-quality entries from engineering memory.
 * Removes entries with quality score below threshold.
 * @param {number} minScore — minimum quality score to keep (default 20)
 */
function pruneEngMemory(minScore = 20) {
    const em = _tryRequire("./engineeringMemory.cjs");
    if (!em || !em.recent || !em.forget) return { pruned: 0, reason: "module unavailable" };

    const entries = em.recent(200);
    let pruned = 0;
    for (const e of entries) {
        if (_scoreMemoryEntry(e) < minScore) {
            try { em.forget(e.id); pruned++; } catch {}
        }
    }
    return { pruned, checked: entries.length, threshold: minScore };
}

// ── Noise reduction in recovery memory ───────────────────────────────────────

/**
 * Remove duplicate failed patterns from recovery memory.
 * Keeps only the most recent instance of each cmd-pattern pair.
 */
function dedupeRecoveryMemory() {
    const rm = _tryRequire("./executionRecoveryMemory.cjs");
    if (!rm || !rm.query) return { deduped: 0, reason: "module unavailable" };

    let entries;
    try { entries = rm.query({ limit: 300 }); } catch { return { deduped: 0, reason: "query failed" }; }

    const seen   = new Map();
    let   deduped = 0;

    for (const e of entries) {
        const key = `${e.type}:${e.chainName || e.cmd || "?"}`;
        if (seen.has(key)) {
            // Prefer higher confidence
            const existing = seen.get(key);
            if ((e.confidence || 0) > (existing.confidence || 0)) {
                seen.set(key, e);
            }
            if (rm.remove) { try { rm.remove(existing.id); deduped++; } catch {} }
        } else {
            seen.set(key, e);
        }
    }

    return { deduped, checked: entries.length };
}

// ── Workflow recommendation quality ───────────────────────────────────────────

/**
 * Score workflow recommendations for a given goal.
 * Returns ranked list with quality scores.
 */
function scoreRecommendations(goalText) {
    const lib = _tryRequire("./workflowLibrary.cjs");
    const em  = _tryRequire("./engineeringMemory.cjs");

    const results = [];

    // Workflow library suggestions
    if (lib) {
        const matches = lib.searchWorkflows(goalText, { limit: 10 });
        matches.forEach(w => results.push({
            name:      w.name,
            source:    "workflow-library",
            category:  w.category,
            quality:   w.builtin ? 80 : 60,
            usageCount: w.usageCount || 0,
        }));
    }

    // Engineering memory suggestions
    if (em && em.suggest) {
        try {
            const suggestions = em.suggest(goalText);
            suggestions.forEach(s => results.push({
                name:      s.chainName || s.name,
                source:    "engineering-memory",
                confidence: s.confidence || 0,
                quality:   Math.min(100, (s.confidence || 0) + 20),
                usageCount: s.usageCount || 0,
            }));
        } catch {}
    }

    // Dedupe by name, keep highest quality
    const seen = new Map();
    for (const r of results) {
        const existing = seen.get(r.name);
        if (!existing || r.quality > existing.quality) seen.set(r.name, r);
    }

    return [...seen.values()]
        .sort((a, b) => b.quality - a.quality)
        .slice(0, 10);
}

// ── Operational continuity score ──────────────────────────────────────────────

/**
 * Score the operational continuity of the current runtime.
 * Higher = more likely to maintain continuity in the next session.
 */
function continuitScore() {
    const analytics = _tryRequire("./operationalAnalytics.cjs");
    const em        = _tryRequire("./engineeringMemory.cjs");
    const rm        = _tryRequire("./executionRecoveryMemory.cjs");

    let score = 50; // baseline
    const factors = [];

    if (analytics) {
        try {
            const s = analytics.summary();
            const chains = s.chains || {};
            const totalChains = Object.keys(chains).length;
            const highSuccess = Object.values(chains).filter(c => (c.successRate || 0) > 0.8).length;
            if (totalChains > 0) {
                const ratio = highSuccess / totalChains;
                score += Math.round(ratio * 20);
                factors.push(`${highSuccess}/${totalChains} chains >80% success`);
            }
        } catch {}
    }

    if (em && em.recent) {
        try {
            const entries = em.recent(50);
            const highConf = entries.filter(e => (e.confidence || 0) >= 70).length;
            score += Math.min(15, highConf);
            factors.push(`${highConf} high-confidence memory entries`);
        } catch {}
    }

    if (rm && rm.query) {
        try {
            const paths = rm.query({ limit: 50 }).filter(e => e.type === "validated-path");
            score += Math.min(15, paths.length);
            factors.push(`${paths.length} validated recovery paths`);
        } catch {}
    }

    score = Math.min(100, Math.max(0, score));

    return {
        score,
        label: score >= 80 ? "high" : score >= 60 ? "moderate" : score >= 40 ? "low" : "poor",
        factors,
        recommendation: score < 60
            ? "Run some workflows to build memory before long sessions"
            : "Memory continuity looks good for extended operation",
    };
}

// ── Full memory health report ─────────────────────────────────────────────────

function memoryHealthReport() {
    const dups         = findDuplicates();
    const continuity   = continuitScore();
    const analytics    = _tryRequire("./operationalAnalytics.cjs");
    const analyticsStats = analytics ? analytics.storageStats() : null;

    return {
        duplicateChains:    dups.duplicates.length,
        duplicateDetails:   dups.duplicates,
        continuitScore:     continuity.score,
        continuityLabel:    continuity.label,
        continuityFactors:  continuity.factors,
        analyticsEvents:    analyticsStats ? analyticsStats.total : null,
        recommendation:     continuity.recommendation,
        ts:                 new Date().toISOString(),
    };
}

module.exports = {
    findDuplicates, pruneEngMemory, dedupeRecoveryMemory,
    scoreRecommendations, continuitScore, memoryHealthReport,
    _scoreMemoryEntry,
};
