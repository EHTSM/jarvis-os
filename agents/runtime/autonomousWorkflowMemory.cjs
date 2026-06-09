"use strict";
/**
 * Phase 637 — Autonomous Workflow Memory
 *
 * Stable workflow prioritization, debugging-chain intelligence,
 * deployment recovery recall, environment-specific execution memory.
 * Bounded. Replay-safe. Duplicate suppression.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/autonomous-workflow-memory.json");
const MAX_ENTRIES = 250;
const TTL_MS      = 21 * 24 * 60 * 60 * 1000; // 21 days

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { memories: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.memories  = (db.memories || []).filter(m => m.updatedAt > cutoff).slice(0, MAX_ENTRIES);
}
function _fp(type, key) {
    return crypto.createHash("md5").update(`${type}:${key}`).digest("hex").slice(0, 12);
}

// ── Memory types: workflow-pattern, debug-chain, deploy-recovery, env-execution ──

function record(opts = {}) {
    const { type = "workflow-pattern", key = "", payload = {}, confidence = 60, sessionId = null, replayId = null } = opts;
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
        hitCount:   idx >= 0 ? (db.memories[idx].hitCount || 0) : 0,
        sessionId,
        replayId,
        createdAt:  idx >= 0 ? db.memories[idx].createdAt : Date.now(),
        updatedAt:  Date.now(),
        lastHitAt:  null,
    };

    if (idx >= 0) { db.memories[idx] = entry; }
    else          { db.memories.unshift(entry); }
    _save(db);

    return { ok: true, fp, type, key, new: idx === -1 };
}

// ── Prioritized recall ────────────────────────────────────────────────────────

function recall(query = "", { type = null, limit = 10, minConfidence = 40 } = {}) {
    const db  = _load(); _prune(db);
    const now = Date.now();

    const results = db.memories
        .filter(m => {
            if (type && m.type !== type) return false;
            if (m.confidence < minConfidence) return false;
            if (!query) return true;
            const needle = query.toLowerCase();
            return m.key.toLowerCase().includes(needle) || m.payload.toLowerCase().includes(needle);
        })
        .map(m => {
            const ageDays  = (now - m.updatedAt) / (24 * 60 * 60 * 1000);
            const recency  = Math.max(0, 1 - ageDays / 21) * 20;
            const hitBonus = Math.min(20, (m.hitCount || 0) * 3);
            const score    = m.confidence * 0.6 + recency + hitBonus;
            let payload = {};
            try { payload = JSON.parse(m.payload); } catch {}
            return { fp: m.fp, type: m.type, key: m.key, confidence: m.confidence, score: Math.round(score), hitCount: m.hitCount, payload, updatedAt: m.updatedAt };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    return { ok: true, results, count: results.length };
}

function hit(fp) {
    const db  = _load();
    const idx = db.memories.findIndex(m => m.fp === fp);
    if (idx === -1) return { ok: false };
    db.memories[idx].hitCount = (db.memories[idx].hitCount || 0) + 1;
    db.memories[idx].lastHitAt = Date.now();
    _save(db);
    return { ok: true, fp, hitCount: db.memories[idx].hitCount };
}

// ── Workflow pattern recall ───────────────────────────────────────────────────

function recallWorkflowPattern(goal = "") {
    return recall(goal, { type: "workflow-pattern", limit: 5 });
}

// ── Debug chain intelligence ──────────────────────────────────────────────────

function recallDebugChain(errorText = "") {
    const db = _load(); _prune(db);
    const results = recall(errorText, { type: "debug-chain", limit: 5 });

    // Also query engineeringMemoryEvolution
    const eme = _tryRequire("./engineeringMemoryEvolution.cjs");
    let emeChains = null;
    if (eme) {
        try { emeChains = eme.prioritizeRecoveryChains(errorText); } catch {}
    }

    return { ok: true, chains: results.results, emeChains: emeChains?.chains || [] };
}

// ── Deployment recovery recall ────────────────────────────────────────────────

function recallDeployRecovery(pipelineName = "") {
    return recall(pipelineName, { type: "deploy-recovery", limit: 5, minConfidence: 50 });
}

// ── Stale memory cleanup ──────────────────────────────────────────────────────

function cleanupStale({ dryRun = true } = {}) {
    const db   = _load();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const stale  = db.memories.filter(m => {
        const lastAccess = Math.max(m.updatedAt, m.lastHitAt || 0);
        return lastAccess < cutoff && (m.hitCount || 0) < 3 && m.confidence < 55;
    });

    if (!dryRun) {
        const fps = new Set(stale.map(m => m.fp));
        db.memories = db.memories.filter(m => !fps.has(m.fp));
        _save(db);
    }

    return { ok: true, staleCount: stale.length, pruned: !dryRun };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function stats() {
    const db = _load(); _prune(db);
    const byType = {};
    db.memories.forEach(m => { byType[m.type] = (byType[m.type] || 0) + 1; });
    return { total: db.memories.length, byType, capacity: MAX_ENTRIES, usage: Math.round(db.memories.length / MAX_ENTRIES * 100) + "%" };
}

module.exports = { record, recall, hit, recallWorkflowPattern, recallDebugChain, recallDeployRecovery, cleanupStale, stats };
