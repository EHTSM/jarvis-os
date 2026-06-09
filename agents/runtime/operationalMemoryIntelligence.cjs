"use strict";
/**
 * Phase 652 — Operational Memory Intelligence
 *
 * Repeated-failure clustering, successful-recovery prioritization,
 * deployment-pattern recall, environment-specific workflow learning,
 * stale-memory cleanup. Bounded. Replay-safe. Dedup-suppressed.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/operational-memory-intel.json");
const MAX_ENTRIES = 300;
const TTL_MS      = 21 * 24 * 60 * 60 * 1000;
const STALE_TTL   = 7 * 24 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { memories: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.memories = (db.memories || []).filter(m => m.updatedAt > cutoff).slice(0, MAX_ENTRIES);
}
function _fp(type, key) { return crypto.createHash("md5").update(`${type}:${key}`).digest("hex").slice(0, 12); }

// ── Memory types ──────────────────────────────────────────────────────────────
// failure-cluster | recovery-success | deploy-pattern | env-workflow | debug-pattern

function upsert(opts = {}) {
    const { type = "debug-pattern", key = "", payload = {}, confidence = 60, outcome = null } = opts;
    if (!key) return { ok: false, error: "key required" };

    const fp  = _fp(type, key);
    const db  = _load(); _prune(db);
    const idx = db.memories.findIndex(m => m.fp === fp);

    const entry = {
        fp,
        type,
        key:        (key || "").slice(0, 100),
        payload:    JSON.stringify(payload).slice(0, 2000),
        confidence: Math.min(95, Math.max(0, confidence)),
        outcome:    outcome || null,
        hitCount:   idx >= 0 ? (db.memories[idx].hitCount || 0) : 0,
        successCount: idx >= 0 ? (db.memories[idx].successCount || 0) + (outcome === "success" ? 1 : 0) : (outcome === "success" ? 1 : 0),
        createdAt:  idx >= 0 ? db.memories[idx].createdAt : Date.now(),
        updatedAt:  Date.now(),
        lastHitAt:  null,
    };

    if (idx >= 0) { db.memories[idx] = entry; }
    else          { db.memories.unshift(entry); }
    _save(db);
    return { ok: true, fp, type, new: idx === -1 };
}

function hit(fp) {
    const db  = _load();
    const idx = db.memories.findIndex(m => m.fp === fp);
    if (idx === -1) return { ok: false };
    db.memories[idx].hitCount  = (db.memories[idx].hitCount || 0) + 1;
    db.memories[idx].lastHitAt = Date.now();
    _save(db);
    return { ok: true, fp, hitCount: db.memories[idx].hitCount };
}

// ── Recall ────────────────────────────────────────────────────────────────────

function recall(query = "", { type = null, limit = 10, minConfidence = 40, preferSuccessful = false } = {}) {
    const db  = _load(); _prune(db);
    const now = Date.now();

    return db.memories
        .filter(m => {
            if (type && m.type !== type) return false;
            if (m.confidence < minConfidence) return false;
            if (!query) return true;
            const q = query.toLowerCase();
            return m.key.toLowerCase().includes(q) || m.payload.toLowerCase().includes(q);
        })
        .map(m => {
            const ageDays    = (now - m.updatedAt) / 86400000;
            const recency    = Math.max(0, 1 - ageDays / 21) * 20;
            const hitBonus   = Math.min(20, (m.hitCount || 0) * 3);
            const succBonus  = preferSuccessful ? Math.min(15, (m.successCount || 0) * 5) : 0;
            const score      = m.confidence * 0.6 + recency + hitBonus + succBonus;
            let payload = {};
            try { payload = JSON.parse(m.payload); } catch {}
            return { fp: m.fp, type: m.type, key: m.key, confidence: m.confidence, score: Math.round(score), hitCount: m.hitCount, successCount: m.successCount, outcome: m.outcome, payload };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

// ── Failure clustering ────────────────────────────────────────────────────────

function clusterFailures(errorText = "") {
    const results = recall(errorText, { type: "failure-cluster", limit: 5, minConfidence: 35 });
    const clusters = results.map(r => ({ ...r, relatedCount: r.hitCount || 1 }));
    return { ok: true, clusters, count: clusters.length, insight: clusters.length > 0 ? `${clusters.length} known failure cluster(s) match` : "No known clusters" };
}

// ── Successful recovery recall ─────────────────────────────────────────────────

function recallSuccessfulRecoveries(errorText = "") {
    const results = recall(errorText, { type: "recovery-success", limit: 5, minConfidence: 50, preferSuccessful: true });
    return { ok: true, recoveries: results, count: results.length, topRecovery: results[0] || null };
}

// ── Deployment pattern recall ─────────────────────────────────────────────────

function recallDeploymentPattern(pipelineName = "") {
    const results = recall(pipelineName, { type: "deploy-pattern", limit: 5, minConfidence: 45 });
    return { ok: true, patterns: results, count: results.length };
}

// ── Environment-specific workflow learning ────────────────────────────────────

function recallEnvWorkflow(envContext = "") {
    const results = recall(envContext, { type: "env-workflow", limit: 5 });
    return { ok: true, workflows: results, count: results.length };
}

// ── Stale memory cleanup ──────────────────────────────────────────────────────

function cleanupStaleMemories({ dryRun = true } = {}) {
    const db     = _load();
    const cutoff = Date.now() - STALE_TTL;
    const stale  = db.memories.filter(m => {
        const lastAccess = Math.max(m.updatedAt, m.lastHitAt || 0);
        return lastAccess < cutoff && (m.hitCount || 0) < 3 && m.confidence < 55;
    });

    if (!dryRun) {
        const fps = new Set(stale.map(m => m.fp));
        db.memories = db.memories.filter(m => !fps.has(m.fp));
        _save(db);
    }
    return { ok: true, staleCount: stale.length, pruned: !dryRun, dryRun };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function stats() {
    const db = _load(); _prune(db);
    const byType = {};
    db.memories.forEach(m => { byType[m.type] = (byType[m.type] || 0) + 1; });
    const successRate = db.memories.filter(m => m.outcome === "success").length;
    return {
        ok:      true,
        total:   db.memories.length,
        byType,
        successEntries: successRate,
        capacity: MAX_ENTRIES,
        usage:   `${Math.round(db.memories.length / MAX_ENTRIES * 100)}%`,
    };
}

module.exports = { upsert, hit, recall, clusterFailures, recallSuccessfulRecoveries, recallDeploymentPattern, recallEnvWorkflow, cleanupStaleMemories, stats };
