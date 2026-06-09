"use strict";
/**
 * Phase 623 — Engineering Memory Evolution
 *
 * Improves: recovery-chain prioritization, debugging replay intelligence,
 * deployment workflow recall, environment-specific learning, stale-memory pruning.
 * Bounded memory. Deduplication. Replay-safe persistence.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH   = path.join(__dirname, "../../data/engineering-memory-evolution.json");
const MAX_MEMORIES = 200;
const MEMORY_TTL   = 21 * 24 * 60 * 60 * 1000; // 21 days
const STALE_TTL    = 7 * 24 * 60 * 60 * 1000;   // memories unused for 7d are candidates for pruning

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { memories: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - MEMORY_TTL;
    db.memories  = (db.memories || []).filter(m => m.updatedAt > cutoff).slice(0, MAX_MEMORIES);
}

function _fp(type, key) {
    return crypto.createHash("md5").update(`${type}:${key}`).digest("hex").slice(0, 12);
}

// ── Memory types ──────────────────────────────────────────────────────────────
// recovery-chain, debug-replay, deployment-workflow, environment-pattern, outcome-insight

function upsertMemory(opts = {}) {
    const { type = "outcome-insight", key = "", content = {}, tags = [], confidence = 50, sessionId = null } = opts;
    if (!key) return { ok: false, error: "key required" };

    const fp  = _fp(type, key);
    const db  = _load(); _prune(db);
    const idx = db.memories.findIndex(m => m.fp === fp);

    const record = {
        fp,
        type,
        key:        (key || "").slice(0, 100),
        content:    JSON.stringify(content).slice(0, 2000),
        tags:       (tags || []).slice(0, 10),
        confidence: Math.min(95, Math.max(0, confidence)),
        sessionId,
        hitCount:   idx >= 0 ? (db.memories[idx].hitCount || 0) : 0,
        createdAt:  idx >= 0 ? db.memories[idx].createdAt : Date.now(),
        updatedAt:  Date.now(),
    };

    if (idx >= 0) { db.memories[idx] = record; }
    else          { db.memories.unshift(record); }
    _save(db);

    return { ok: true, fp, type, key, isNew: idx === -1 };
}

// ── Query with prioritization ─────────────────────────────────────────────────

function query(searchText = "", { type = null, limit = 10, minConfidence = 0 } = {}) {
    const db  = _load(); _prune(db);
    const now = Date.now();

    return db.memories
        .filter(m => {
            if (type && m.type !== type) return false;
            if (m.confidence < minConfidence) return false;
            if (!searchText) return true;
            const needle = searchText.toLowerCase();
            return m.key.toLowerCase().includes(needle) ||
                   m.content.toLowerCase().includes(needle) ||
                   (m.tags || []).some(t => t.toLowerCase().includes(needle));
        })
        .map(m => {
            // Score: confidence + recency + hit count
            const ageDays   = (now - m.updatedAt) / (24 * 60 * 60 * 1000);
            const recency   = Math.max(0, 1 - ageDays / 21);
            const score     = m.confidence * 0.5 + recency * 30 + (m.hitCount || 0) * 2;
            return { ...m, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(m => ({ fp: m.fp, type: m.type, key: m.key, confidence: m.confidence, hitCount: m.hitCount, score: Math.round(m.score), updatedAt: m.updatedAt }));
}

// ── Hit tracking ──────────────────────────────────────────────────────────────

function recordHit(fp) {
    const db  = _load(); _prune(db);
    const idx = db.memories.findIndex(m => m.fp === fp);
    if (idx === -1) return { ok: false };
    db.memories[idx].hitCount = (db.memories[idx].hitCount || 0) + 1;
    db.memories[idx].lastHit  = Date.now();
    _save(db);
    return { ok: true, fp, hitCount: db.memories[idx].hitCount };
}

// ── Stale-memory pruning ──────────────────────────────────────────────────────

function pruneStaleMemories({ dryRun = true } = {}) {
    const db     = _load();
    const cutoff = Date.now() - STALE_TTL;
    const stale  = db.memories.filter(m => {
        const lastAccess = Math.max(m.updatedAt, m.lastHit || 0);
        return lastAccess < cutoff && (m.hitCount || 0) < 2 && m.confidence < 60;
    });

    if (!dryRun) {
        const fps = new Set(stale.map(m => m.fp));
        db.memories = db.memories.filter(m => !fps.has(m.fp));
        _save(db);
    }

    return { ok: true, staleCount: stale.length, pruned: !dryRun, keys: stale.slice(0, 10).map(m => m.key) };
}

// ── Recovery chain prioritization ────────────────────────────────────────────

function prioritizeRecoveryChains(errorText = "") {
    const db = _load(); _prune(db);
    const candidates = db.memories.filter(m => m.type === "recovery-chain");

    const now    = Date.now();
    const scored = candidates.map(m => {
        let content = {};
        try { content = JSON.parse(m.content); } catch {}
        const errorMatch = content.errorPattern && errorText.toLowerCase().includes((content.errorPattern || "").toLowerCase()) ? 20 : 0;
        const ageDays    = (now - m.updatedAt) / (24 * 60 * 60 * 1000);
        const recency    = Math.max(0, 1 - ageDays / 14) * 15;
        const score      = m.confidence * 0.5 + errorMatch + recency + (m.hitCount || 0) * 3;
        return { fp: m.fp, key: m.key, confidence: m.confidence, score: Math.round(score), chainName: content.chainName || m.key };
    }).sort((a, b) => b.score - a.score).slice(0, 5);

    return { ok: true, chains: scored };
}

// ── Deployment workflow recall ────────────────────────────────────────────────

function recallDeploymentWorkflow(pipelineName = "") {
    const db   = _load(); _prune(db);
    const mems = db.memories.filter(m => m.type === "deployment-workflow");
    const match = mems.find(m => m.key.toLowerCase().includes(pipelineName.toLowerCase())) || mems[0] || null;
    if (!match) return { ok: false, error: "No deployment workflow memories" };

    recordHit(match.fp);
    let content = {};
    try { content = JSON.parse(match.content); } catch {}
    return { ok: true, fp: match.fp, key: match.key, confidence: match.confidence, content };
}

// ── Memory stats ──────────────────────────────────────────────────────────────

function memoryStats() {
    const db = _load(); _prune(db);
    const byType = {};
    db.memories.forEach(m => { byType[m.type] = (byType[m.type] || 0) + 1; });
    const stale = pruneStaleMemories({ dryRun: true });

    return {
        total:    db.memories.length,
        byType,
        stale:    stale.staleCount,
        capacity: MAX_MEMORIES,
        usage:    Math.round(db.memories.length / MAX_MEMORIES * 100) + "%",
    };
}

module.exports = { upsertMemory, query, recordHit, pruneStaleMemories, prioritizeRecoveryChains, recallDeploymentWorkflow, memoryStats };
