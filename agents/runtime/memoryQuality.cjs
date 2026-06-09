"use strict";
/**
 * Phase 547 — Advanced Operator Memory Quality
 *
 * Workflow memory quality scoring, debugging replay usefulness,
 * deployment memory chains, recovery prioritization, stale-memory cleanup.
 *
 * Prevents: operational memory spam, duplicate replay chains, noisy workflow history.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Memory quality scoring ────────────────────────────────────────────────────

/**
 * Score a single engineering memory entry (0-100).
 * Higher = more useful to keep.
 */
function scoreMemoryEntry(entry) {
    if (!entry) return 0;
    let score = 50; // baseline

    // Recency: entries < 7 days old get a boost
    const ageDays = (Date.now() - (entry.ts || entry.createdAt || 0)) / (24 * 60 * 60 * 1000);
    if (ageDays < 1)  score += 20;
    else if (ageDays < 7)  score += 10;
    else if (ageDays > 30) score -= 20;

    // Confidence from validation
    if (entry.confidence >= 80) score += 15;
    else if (entry.confidence >= 60) score += 8;
    else if (entry.confidence < 30)  score -= 15;

    // Validated paths are most valuable
    if (entry.type === "validated-path") score += 20;
    if (entry.type === "error" || entry.type === "failure") score -= 10;

    // Has steps defined
    if (Array.isArray(entry.steps) && entry.steps.length > 0) score += 10;

    return Math.max(0, Math.min(100, score));
}

// ── Workflow memory quality ───────────────────────────────────────────────────

function workflowMemoryQuality() {
    const rm = _tryRequire("./executionRecoveryMemory.cjs");
    if (!rm) return { available: false };

    try {
        const entries  = rm.query({ limit: 200 });
        const scored   = entries.map(e => ({ ...e, qualityScore: scoreMemoryEntry(e) }));
        const high     = scored.filter(e => e.qualityScore >= 70).length;
        const medium   = scored.filter(e => e.qualityScore >= 40 && e.qualityScore < 70).length;
        const low      = scored.filter(e => e.qualityScore < 40).length;
        const avgScore = scored.length > 0 ? Math.round(scored.reduce((a, b) => a + b.qualityScore, 0) / scored.length) : 0;

        return {
            available: true,
            total:     scored.length,
            high, medium, low,
            avgScore,
            qualityLabel: avgScore >= 70 ? "excellent" : avgScore >= 50 ? "good" : avgScore >= 30 ? "fair" : "poor",
        };
    } catch (e) {
        return { available: false, error: e.message };
    }
}

// ── Duplicate replay detection ────────────────────────────────────────────────

/**
 * Finds duplicate replay chains (same chainName, similar steps) in recovery memory.
 */
function findDuplicateReplays() {
    const rm = _tryRequire("./executionRecoveryMemory.cjs");
    if (!rm) return { available: false, duplicates: [] };

    try {
        const entries = rm.query({ limit: 200 });
        const byChain = {};
        for (const e of entries) {
            const key = e.chainName || "unknown";
            if (!byChain[key]) byChain[key] = [];
            byChain[key].push(e);
        }

        const duplicates = Object.entries(byChain)
            .filter(([, group]) => group.length > 1)
            .map(([chainName, group]) => {
                const scored = group.map(e => ({ ...e, qualityScore: scoreMemoryEntry(e) }))
                    .sort((a, b) => b.qualityScore - a.qualityScore);
                return {
                    chainName,
                    count:     group.length,
                    keepId:    scored[0].id || null,
                    keepScore: scored[0].qualityScore,
                    prunableIds: scored.slice(1).map(e => e.id).filter(Boolean),
                };
            });

        return { available: true, duplicates, totalDuplicateSets: duplicates.length };
    } catch (e) {
        return { available: false, error: e.message };
    }
}

// ── Deployment memory chain ───────────────────────────────────────────────────

/**
 * Surfaces a chronological chain of deployment events for a pipeline.
 */
function deploymentMemoryChain(pipelineName) {
    const pipeline = _tryRequire("./deploymentPipeline.cjs");
    const forensics = _tryRequire("./runtimeForensics.cjs");
    if (!pipeline) return { available: false };

    try {
        const runs = pipeline.listRuns({ limit: 20 }).filter(r => r.pipeline === pipelineName);
        const events = forensics
            ? forensics.query({ limit: 100 }).filter(e => (e.pipeline === pipelineName) || (e.chain === pipelineName))
            : [];

        const chain = runs.map(r => ({
            runId:      r.id,
            state:      r.state,
            durationMs: r.completedAt ? r.completedAt - r.createdAt : null,
            rolled:     r.rollbackTriggered,
            stages:     (r.stages || []).map(s => ({ name: s.name, state: s.state })),
        }));

        const successRate = runs.length > 0
            ? Math.round(runs.filter(r => r.state === "passed").length / runs.length * 100)
            : null;

        return {
            available:   true,
            pipelineName,
            totalRuns:   runs.length,
            successRate,
            chain,
            recentEvents: events.slice(-10).map(e => ({ type: e.type, summary: e.summary, ts: e.ts })),
        };
    } catch (e) {
        return { available: false, error: e.message };
    }
}

// ── Recovery prioritization ───────────────────────────────────────────────────

/**
 * Rank recovery options by quality score and recent success.
 */
function prioritizeRecovery(chainName) {
    const rm       = _tryRequire("./executionRecoveryMemory.cjs");
    const intel    = _tryRequire("./failureIntelligenceEngine.cjs");
    if (!rm) return { available: false };

    try {
        const entries = rm.query({ limit: 100 }).filter(e => e.chainName === chainName);
        const scored  = entries
            .map(e => ({ ...e, qualityScore: scoreMemoryEntry(e) }))
            .sort((a, b) => b.qualityScore - a.qualityScore);

        const confidence = intel ? intel.recoveryConfidence(chainName) : { confidence: 50 };

        return {
            available:       true,
            chainName,
            options:         scored.slice(0, 5).map(e => ({ type: e.type, qualityScore: e.qualityScore, ts: e.ts, confidence: e.confidence || null })),
            bestOption:      scored[0] || null,
            overallConfidence: confidence.confidence,
            recommendation:  scored.length > 0
                ? `Use highest-scored path (score: ${scored[0].qualityScore})`
                : "No recovery memory — use built-in workflow",
        };
    } catch (e) {
        return { available: false, error: e.message };
    }
}

// ── Stale memory cleanup ──────────────────────────────────────────────────────

function cleanStaleMemory(options = {}) {
    const minScore    = options.minScore    ?? 20;
    const maxAgeDays  = options.maxAgeDays  ?? 30;
    const refinement  = _tryRequire("./memoryRefinement.cjs");
    const cleaned     = [];

    if (refinement) {
        try {
            const pruneResult = refinement.pruneEngMemory(minScore);
            if (pruneResult.removed > 0) cleaned.push({ source: "engineering-memory", removed: pruneResult.removed });
        } catch {}

        try {
            const dedupe = refinement.dedupeRecoveryMemory();
            if (dedupe.removed > 0) cleaned.push({ source: "recovery-memory", removed: dedupe.removed });
        } catch {}
    }

    return {
        ok:      true,
        cleaned,
        totalRemoved: cleaned.reduce((sum, c) => sum + c.removed, 0),
        ts:      new Date().toISOString(),
    };
}

// ── Unified memory quality report ─────────────────────────────────────────────

function memoryQualityReport() {
    return {
        workflowMemory:    workflowMemoryQuality(),
        duplicateReplays:  findDuplicateReplays(),
        ts:                new Date().toISOString(),
    };
}

module.exports = {
    scoreMemoryEntry, workflowMemoryQuality,
    findDuplicateReplays, deploymentMemoryChain,
    prioritizeRecovery, cleanStaleMemory, memoryQualityReport,
};
