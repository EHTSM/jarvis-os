"use strict";
/**
 * MemoryPersistenceLayer — save, load, update, archive memory nodes.
 *
 * Backed by data/memory-store.json (already used by shared-memory tooling)
 * and data/memory-archive.json for archived nodes.
 *
 * Public API:
 *   save(node)                    → { nodeId, saved: true }
 *   load(nodeId)                  → node | null
 *   update(nodeId, patch)         → updated node | null
 *   archive(nodeId)               → { nodeId, archived: true }
 *   list({ type, tag, minImportance, limit, offset }) → { nodes[], total }
 *   search(query)                 → { nodes[] }
 *   stats()                       → { total, byType, archived, avgImportance }
 *   recall({ agentId, input })    → { nodes[] }  — agent context injection
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const logger = require("../utils/logger");

const STORE_FILE   = path.join(__dirname, "../../data/memory-store.json");
const ARCHIVE_FILE = path.join(__dirname, "../../data/memory-archive.json");
const INDEX_FILE   = path.join(__dirname, "../../data/memory-index.json");

let _seq = Date.now();
function _id() { return `mem_${Date.now()}_${(++_seq).toString(36)}`; }

// ── I/O helpers ─────────────────────────────────────────────────────────
function _readJson(file, fallback = []) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { return fallback; }
}
function _writeJson(file, data) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Persistence Sweep (2026-08-20): the tmp filename used to be a fixed
    // `${file}.tmp` shared by every caller of this one helper across all 3
    // backing files (STORE_FILE/ARCHIVE_FILE/INDEX_FILE) — crash-mid-write
    // corruption risk regardless of concurrency (a SIGKILL during the write
    // syscall could leave a truncated/torn file, since the old fixed tmp
    // path itself was never a unique, collision-proof staging file). Same
    // fix already applied to secretVault.cjs's VAULT_FILE/AUDIT_FILE/
    // HISTORY_FILE this mission: a unique per-call tmp name (pid + random)
    // makes every write independent; renameSync() is still what makes the
    // real file's replacement atomic (a reader/subsequent boot never
    // observes a partially-written file).
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

// ── In-memory cache ──────────────────────────────────────────────────────
// Memory-store.json may hold an array or object — normalise to Map<nodeId, node>
function _initStore() {
    const raw = _readJson(STORE_FILE, []);
    const map = new Map();
    const items = Array.isArray(raw) ? raw : Object.values(raw);
    for (const n of items) {
        if (n && n.nodeId) map.set(n.nodeId, n);
    }
    return map;
}

let _store   = _initStore();              // Map<nodeId, MemoryNode>
let _archive = new Map(
    (_readJson(ARCHIVE_FILE, [])).map(n => [n.nodeId, n])
);

// _store/_archive previously had no cap at all — every tick's saveTypedMemory()
// call added a node and neither this file nor memoryIntelligenceEngine's
// archiveStale() (60-day staleness window, so effectively inert on any
// realistic uptime) ever removed anything from _archive. Grew to 11,000+
// archive entries / 7MB+, re-serialized in full on every single save() —
// a steady, compounding memory + I/O leak. Cap both, evicting lowest-importance
// then oldest first so frequently-recalled/important nodes survive longest.
const MAX_STORE_NODES   = 2000;
const MAX_ARCHIVE_NODES = 2000;

// Phase B.10: eviction ordered by importance alone silently destroyed every
// NEW memory once the store was full.
//
// Measured on the live store: 2000/2000 nodes with a MINIMUM importance of 95
// (1918 of them written at exactly 95 by the autonomous RCA-playbook writer —
// 640 for circuit_breaker_open_media and 639 for ai_service_timeout alone).
// saveTypedMemory() defaults to importance 60, so any newly-learned memory was
// the lowest-ranked node in the map and was evicted inside the very same
// _persist() call that saved it. Reproduced deterministically: save() returned
// { saved: true } while the node was already unreadable, with a hard cutoff at
// importance >= 95. Retrieval measured recall@8 = 0/3 for three memories that
// had just been written "successfully".
//
// Two independent problems, both fixed here without changing the storage
// engine, the cap, or the schema:
//
//  1. A brand-new node could never win eviction against a saturated store.
//     Nodes are now protected for a short grace window after creation, so a
//     just-written memory always survives long enough to be read back. Beyond
//     that window the original importance/age ordering applies unchanged.
//
//  2. Eviction never considered recency of USE, so a node recalled seconds ago
//     ranked identically to one never read. usageCount/lastUsedAt are already
//     maintained by load() — they are now part of the ordering, which is what
//     the surrounding comment ("frequently-recalled/important nodes survive
//     longest") always claimed but did not implement.
const EVICTION_GRACE_MS = 60_000;   // a new node is never evicted for 60s

function _evictOverflow(map, maxSize) {
    if (map.size <= maxSize) return;
    const now = Date.now();
    const _ms = (ts) => { const t = Date.parse(ts || ""); return Number.isNaN(t) ? 0 : t; };

    const candidates = Array.from(map.values())
        .filter(n => (now - _ms(n.createdAt)) > EVICTION_GRACE_MS);

    // If everything is inside the grace window the store is being written to
    // faster than the window allows; fall back to the full set so the cap is
    // still honoured rather than growing unbounded.
    const pool = candidates.length ? candidates : Array.from(map.values());

    const over = Math.min(map.size - maxSize, pool.length);
    const sorted = pool.sort((a, b) =>
        (a.importance || 0) - (b.importance || 0) ||
        (a.usageCount  || 0) - (b.usageCount  || 0) ||
        _ms(a.lastUsedAt) - _ms(b.lastUsedAt)      ||
        _ms(a.updatedAt) - _ms(b.updatedAt));

    for (let i = 0; i < over; i++) map.delete(sorted[i].nodeId);
}

function _persist() {
    _evictOverflow(_store,   MAX_STORE_NODES);
    _evictOverflow(_archive, MAX_ARCHIVE_NODES);
    try { _writeJson(STORE_FILE,   Array.from(_store.values()));   } catch (e) { logger.warn(`[Memory] persist store failed: ${e.message}`); }
    try { _writeJson(ARCHIVE_FILE, Array.from(_archive.values())); } catch (e) { logger.warn(`[Memory] persist archive failed: ${e.message}`); }
    _rebuildIndex();
}

function _rebuildIndex() {
    try {
        const idx = {};
        for (const n of _store.values()) {
            (n.tags || []).forEach(t => { if (!idx[t]) idx[t] = []; idx[t].push(n.nodeId); });
        }
        _writeJson(INDEX_FILE, idx);
    } catch { /* non-critical */ }
}

// ── Schema ───────────────────────────────────────────────────────────────
/**
 * MemoryNode shape:
 * {
 *   nodeId     : string   (auto)
 *   key        : string   — human label
 *   value      : any      — the actual data
 *   type       : string   — entity|procedure|goal|metric|insight|technical|person
 *   tags       : string[]
 *   importance : number   0–100
 *   confidence : number   0–100
 *   agentIds   : string[] — which agents may read/write this node
 *   createdAt  : ISO string
 *   updatedAt  : ISO string
 *   expiresAt  : ISO string | null
 *   usageCount : number
 *   lastUsedAt : ISO string | null
 * }
 */

function _defaults(partial) {
    const now = new Date().toISOString();
    return {
        nodeId:     partial.nodeId     || _id(),
        key:        partial.key        || "untitled",
        value:      partial.value      ?? null,
        type:       partial.type       || "insight",
        tags:       Array.isArray(partial.tags) ? partial.tags : [],
        importance: Number.isFinite(partial.importance) ? Math.min(100, Math.max(0, partial.importance)) : 50,
        confidence: Number.isFinite(partial.confidence) ? Math.min(100, Math.max(0, partial.confidence)) : 80,
        agentIds:   Array.isArray(partial.agentIds) ? partial.agentIds : [],
        createdAt:  partial.createdAt  || now,
        updatedAt:  now,
        expiresAt:  partial.expiresAt  || null,
        usageCount: partial.usageCount || 0,
        lastUsedAt: partial.lastUsedAt || null,
    };
}

/** Save a new memory node (idempotent on nodeId). */
function save(node) {
    const full = _defaults(node);
    _store.set(full.nodeId, full);
    _persist();
    return { nodeId: full.nodeId, saved: true };
}

/** Load one node by ID. Updates usageCount + lastUsedAt on access. */
function load(nodeId) {
    const node = _store.get(nodeId);
    if (!node) return null;
    node.usageCount  = (node.usageCount || 0) + 1;
    node.lastUsedAt  = new Date().toISOString();
    _store.set(nodeId, node);
    _persist();
    return { ...node };
}

/** Update a node's fields. */
function update(nodeId, patch) {
    const node = _store.get(nodeId);
    if (!node) return null;
    const updated = {
        ...node,
        ...patch,
        nodeId,                           // immutable
        createdAt: node.createdAt,        // immutable
        updatedAt: new Date().toISOString(),
    };
    _store.set(nodeId, _defaults(updated));
    _persist();
    return { ...updated };
}

/** Move node to archive (removed from active store). */
function archive(nodeId) {
    const node = _store.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    _archive.set(nodeId, { ...node, archivedAt: new Date().toISOString() });
    _store.delete(nodeId);
    _persist();
    return { nodeId, archived: true };
}

/** List active nodes with optional filters. */
function list({ type, tag, minImportance = 0, limit = 100, offset = 0, agentId } = {}) {
    let nodes = Array.from(_store.values());
    if (type)          nodes = nodes.filter(n => n.type === type);
    if (tag)           nodes = nodes.filter(n => (n.tags || []).includes(tag));
    if (minImportance) nodes = nodes.filter(n => (n.importance || 0) >= minImportance);
    if (agentId)       nodes = nodes.filter(n => n.agentIds.length === 0 || n.agentIds.includes(agentId));

    // Sort by importance desc then updatedAt desc
    nodes.sort((a, b) => (b.importance - a.importance) || b.updatedAt.localeCompare(a.updatedAt));
    return { nodes: nodes.slice(offset, offset + limit), total: nodes.length };
}

/** Simple keyword search over key + tags + stringified value. */
function search(query) {
    if (!query) return list();
    const q = query.toLowerCase();
    const nodes = Array.from(_store.values()).filter(n => {
        const haystack = [n.key, ...( n.tags || []), JSON.stringify(n.value || "")].join(" ").toLowerCase();
        return haystack.includes(q);
    });
    nodes.sort((a, b) => b.importance - a.importance);
    return { nodes: nodes.slice(0, 50), total: nodes.length };
}

/** Stats snapshot. */
function stats() {
    const all  = Array.from(_store.values());
    const byType = {};
    for (const n of all) { byType[n.type] = (byType[n.type] || 0) + 1; }
    const avgImportance = all.length
        ? Math.round(all.reduce((s, n) => s + (n.importance || 0), 0) / all.length)
        : 0;
    return {
        total: all.length,
        archived: _archive.size,
        byType,
        avgImportance,
        avgConfidence: all.length
            ? Math.round(all.reduce((s, n) => s + (n.confidence || 0), 0) / all.length)
            : 0,
        staleCount: all.filter(n => {
            const ageMs = Date.now() - new Date(n.updatedAt).getTime();
            return ageMs > 30 * 24 * 3600_000; // 30 days
        }).length,
    };
}

/**
 * Agent context recall — given an agent + input, return relevant memory nodes.
 * Simple keyword + importance ranking.
 */
function recall({ agentId, input = "", limit = 10 } = {}) {
    const words   = input.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    let   nodes   = Array.from(_store.values()).filter(
        n => n.agentIds.length === 0 || n.agentIds.includes(agentId)
    );

    // Relevance must outrank importance. The previous score was
    // `importance + hits * 10`, so a single keyword hit was worth only 10 points
    // — on the live store (1918 of 2000 nodes written at importance >= 95 by the
    // autonomous RCA writer) an EXACT keyword match at importance 88 scored 98 and
    // lost to completely unrelated nodes sitting at importance 100. Measured:
    // recall@10 = 0/3 for exact-keyword queries against memories written seconds
    // earlier, and a known exact match ranked #82 of 1946.
    //
    // Rank by match count FIRST, then by importance as the tie-breaker within an
    // equal number of matches. A node that matches nothing can no longer displace
    // a node that matches the query, regardless of importance. Nothing about
    // storage, the cap, the schema, or agent scoping changes — only the ordering.
    // `_score` is preserved for callers/telemetry that already read it.
    const scored = nodes.map(n => {
        const haystack = [n.key, ...(n.tags || [])].join(" ").toLowerCase();
        const hits     = words.filter(w => haystack.includes(w)).length;
        return { ...n, _hits: hits, _score: n.importance + hits * 10 };
    });

    scored.sort((a, b) =>
        (b._hits - a._hits) ||
        ((b.importance || 0) - (a.importance || 0)) ||
        ((b.usageCount || 0) - (a.usageCount || 0)));

    return { nodes: scored.slice(0, limit).map(n => { const c = { ...n }; delete c._score; delete c._hits; return c; }) };
}

module.exports = { save, load, update, archive, list, search, stats, recall };
