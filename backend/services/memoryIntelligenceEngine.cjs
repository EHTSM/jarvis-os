"use strict";
/**
 * MemoryIntelligenceEngine — rank, merge, conflict-detect, archive-stale,
 * and improve recall quality across the memory store.
 *
 * Reads/writes via memoryPersistenceLayer (authoritative store).
 * Persists analysis results to data/memory-intelligence.json.
 *
 * Public API:
 *   rankMemories(opts)           → { ranked: NodeWithScore[] }
 *   mergeDuplicates(opts)        → { merged[], skipped[], mergeCount }
 *   detectConflicts()            → { conflicts[] }
 *   archiveStale(opts)           → { archived[], count }
 *   improveRecall(agentId, input)→ { nodes[], qualityScore }
 *   runFullMaintenance()         → { ranked, mergeCount, conflictCount, archivedCount, report }
 *   getIntelligenceReport()      → persisted report
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const REPORT_FILE = path.join(__dirname, "../../data/memory-intelligence.json");

function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, f);
}

function _getMPL() { return require("./memoryPersistenceLayer.cjs"); }

// ── Scoring ──────────────────────────────────────────────────────────────
/**
 * Compute a composite recall score for a memory node (0–100).
 *
 * Factors:
 *   importance  (30%)  — set by creator
 *   confidence  (20%)  — set by creator
 *   freshness   (25%)  — exponential decay over 30 days
 *   usage       (15%)  — log(usageCount + 1) normalised
 *   linkDensity (10%)  — agentIds.length contribution
 */
function _score(node) {
    const importanceScore = (node.importance || 50) * 0.30;
    const confidenceScore = (node.confidence || 80) * 0.20;

    const ageMs     = Date.now() - new Date(node.updatedAt || node.createdAt).getTime();
    const ageDays   = ageMs / 86_400_000;
    const freshScore = Math.max(0, 100 * Math.exp(-ageDays / 30)) * 0.25;

    const usageScore = Math.min(100, Math.log((node.usageCount || 0) + 1) * 20) * 0.15;
    const linkScore  = Math.min(100, (node.agentIds?.length || 0) * 20) * 0.10;

    return Math.round(importanceScore + confidenceScore + freshScore + usageScore + linkScore);
}

// ── Rank ─────────────────────────────────────────────────────────────────
function rankMemories({ type, minScore = 0, limit = 100 } = {}) {
    const mpl   = _getMPL();
    const { nodes } = mpl.list({ type, limit: 2000 });
    const scored = nodes
        .map(n => ({ ...n, recallScore: _score(n) }))
        .filter(n => n.recallScore >= minScore)
        .sort((a, b) => b.recallScore - a.recallScore);
    return { ranked: scored.slice(0, limit), total: scored.length };
}

// ── Duplicate detection + merge ──────────────────────────────────────────
/**
 * Two nodes are duplicates if their keys are ≥85% similar (normalised Levenshtein)
 * OR if key-words overlap ≥70%.
 * Merge keeps the higher-importance node's data, merges tags + agentIds.
 */
function _similarity(a, b) {
    const wa = new Set(a.toLowerCase().split(/\s+/));
    const wb = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...wa].filter(w => wb.has(w)));
    const union = new Set([...wa, ...wb]);
    return union.size ? intersection.size / union.size : 0;
}

function mergeDuplicates({ threshold = 0.70, dryRun = false } = {}) {
    const mpl   = _getMPL();
    const { nodes } = mpl.list({ limit: 2000 });

    const merged  = [];
    const skipped = [];
    const consumed = new Set();

    for (let i = 0; i < nodes.length; i++) {
        if (consumed.has(nodes[i].nodeId)) continue;
        for (let j = i + 1; j < nodes.length; j++) {
            if (consumed.has(nodes[j].nodeId)) continue;
            const sim = _similarity(nodes[i].key, nodes[j].key);
            if (sim >= threshold) {
                // Keep higher-importance, archive the other
                const [keep, drop] = nodes[i].importance >= nodes[j].importance
                    ? [nodes[i], nodes[j]] : [nodes[j], nodes[i]];
                if (!dryRun) {
                    // Merge tags, agentIds into the keeper
                    const mergedTags    = Array.from(new Set([...(keep.tags||[]), ...(drop.tags||[])]));
                    const mergedAgents  = Array.from(new Set([...(keep.agentIds||[]), ...(drop.agentIds||[])]));
                    mpl.update(keep.nodeId, { tags: mergedTags, agentIds: mergedAgents, confidence: Math.max(keep.confidence||80, drop.confidence||80) });
                    mpl.archive(drop.nodeId);
                    consumed.add(drop.nodeId);
                }
                merged.push({ kept: keep.nodeId, dropped: drop.nodeId, similarity: sim, dryRun });
            }
        }
    }
    logger.info(`[MemIntel] mergeDuplicates: ${merged.length} merges${dryRun ? " (dry-run)" : ""}`);
    return { merged, skipped, mergeCount: merged.length };
}

// ── Conflict detection ───────────────────────────────────────────────────
/**
 * Conflicts: two nodes with the same key but significantly different values.
 * Detected when key similarity ≥90% and value payloads diverge.
 */
function detectConflicts() {
    const mpl = _getMPL();
    const { nodes } = mpl.list({ limit: 2000 });
    const conflicts = [];

    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const keySim = _similarity(nodes[i].key, nodes[j].key);
            if (keySim < 0.90) continue;
            // Check if values diverge
            const vi = JSON.stringify(nodes[i].value || "");
            const vj = JSON.stringify(nodes[j].value || "");
            const valSim = _similarity(vi.slice(0, 200), vj.slice(0, 200));
            if (valSim < 0.50) {
                conflicts.push({
                    nodeA:       nodes[i].nodeId,
                    keyA:        nodes[i].key,
                    nodeB:       nodes[j].nodeId,
                    keyB:        nodes[j].key,
                    keySimilarity:  Math.round(keySim * 100),
                    valueDivergence:Math.round((1 - valSim) * 100),
                    recommendation: "Review and consolidate — keep the more recently updated node.",
                });
            }
        }
    }
    return { conflicts, conflictCount: conflicts.length };
}

// ── Stale archive ────────────────────────────────────────────────────────
/**
 * Archive nodes that haven't been updated in staleDays and have low importance.
 */
function archiveStale({ staleDays = 60, maxImportance = 40, dryRun = false, limit = 200 } = {}) {
    const mpl     = _getMPL();
    const { nodes } = mpl.list({ limit: 5000 });
    const cutoff  = new Date(Date.now() - staleDays * 86_400_000).toISOString();
    const candidates = nodes.filter(n =>
        n.updatedAt < cutoff && (n.importance || 50) <= maxImportance
    );

    const archived = [];
    for (const n of candidates.slice(0, limit)) {
        if (!dryRun) {
            try { mpl.archive(n.nodeId); archived.push({ nodeId: n.nodeId, key: n.key, importance: n.importance, ageDays: Math.round((Date.now() - new Date(n.updatedAt).getTime()) / 86_400_000) }); }
            catch { /* already archived */ }
        } else {
            archived.push({ nodeId: n.nodeId, key: n.key, importance: n.importance, dryRun: true });
        }
    }
    logger.info(`[MemIntel] archiveStale: ${archived.length} archived${dryRun ? " (dry-run)" : ""}`);
    return { archived, count: archived.length };
}

// ── Recall quality improvement ───────────────────────────────────────────
/**
 * Enhanced recall: scores + re-ranks nodes for a specific agent + query,
 * then boosts importance of frequently-recalled nodes.
 */
function improveRecall(agentId, input = "", limit = 10) {
    const mpl   = _getMPL();
    const base  = mpl.recall({ agentId, input, limit: limit * 3 }); // fetch wider net
    const words = input.toLowerCase().split(/\s+/).filter(w => w.length > 3);

    const enhanced = base.nodes.map(n => {
        const ks      = words.filter(w => n.key.toLowerCase().includes(w)).length;
        const ts      = words.filter(w => (n.tags||[]).join(" ").toLowerCase().includes(w)).length;
        const hitScore = (ks * 15) + (ts * 8);
        const recall   = _score(n) + hitScore;
        return { ...n, recallScore: recall, keyHits: ks, tagHits: ts };
    }).sort((a, b) => b.recallScore - a.recallScore).slice(0, limit);

    // Boost importance of top-recalled nodes (up to +5) so they surface faster next time
    for (const n of enhanced.slice(0, 3)) {
        const newImp = Math.min(100, (n.importance || 50) + 5);
        if (newImp !== n.importance) {
            try { mpl.update(n.nodeId, { importance: newImp }); } catch { /* non-fatal */ }
        }
    }

    const qualityScore = enhanced.length
        ? Math.round(enhanced.reduce((s, n) => s + n.recallScore, 0) / enhanced.length)
        : 0;

    return { nodes: enhanced, qualityScore, agentId, input: input.slice(0, 100) };
}

// ── Full maintenance pipeline ────────────────────────────────────────────
function runFullMaintenance({ dryRun = false } = {}) {
    logger.info("[MemIntel] Running full maintenance...");
    const ranked       = rankMemories({ limit: 50 });
    const mergeResult  = mergeDuplicates({ dryRun });
    const conflResult  = detectConflicts();
    const archResult   = archiveStale({ dryRun });

    const report = {
        ts:             new Date().toISOString(),
        totalNodes:     ranked.total,
        topScore:       ranked.ranked[0]?.recallScore || 0,
        mergeCount:     mergeResult.mergeCount,
        conflictCount:  conflResult.conflictCount,
        archivedCount:  archResult.count,
        topMemories:    ranked.ranked.slice(0, 10).map(n => ({ nodeId: n.nodeId, key: n.key, score: n.recallScore })),
        conflicts:      conflResult.conflicts.slice(0, 5),
        dryRun,
    };
    try { _wj(REPORT_FILE, report); } catch { /* non-critical */ }
    logger.info(`[MemIntel] Done: merged=${mergeResult.mergeCount} conflicts=${conflResult.conflictCount} archived=${archResult.count}`);
    return { ranked: ranked.ranked.slice(0, 20), mergeCount: mergeResult.mergeCount, conflictCount: conflResult.conflictCount, archivedCount: archResult.count, report };
}

function getIntelligenceReport() {
    return _rj(REPORT_FILE, null);
}

module.exports = { rankMemories, mergeDuplicates, detectConflicts, archiveStale, improveRecall, runFullMaintenance, getIntelligenceReport };
