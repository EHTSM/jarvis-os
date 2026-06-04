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

const fs   = require("fs");
const path = require("path");
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
    const tmp = file + ".tmp";
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

function _persist() {
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

    // Score each node: importance + keyword matches
    const scored = nodes.map(n => {
        const haystack = [n.key, ...(n.tags || [])].join(" ").toLowerCase();
        const hits     = words.filter(w => haystack.includes(w)).length;
        return { ...n, _score: n.importance + hits * 10 };
    });

    scored.sort((a, b) => b._score - a._score);
    return { nodes: scored.slice(0, limit).map(n => { const c = { ...n }; delete c._score; return c; }) };
}

module.exports = { save, load, update, archive, list, search, stats, recall };
