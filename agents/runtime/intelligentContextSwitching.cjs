"use strict";
/**
 * Phase 745 — Intelligent Context Switching
 *
 * Manages operator context transitions between workstreams: debugging,
 * deployment, code review, incident response. Preserves state, surfaces
 * relevant context when switching, prevents context bleed.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const DATA_FILE     = path.join(__dirname, "../../data/intelligent-context-switching.json");
const MAX_CONTEXTS  = 20;
const STALE_MS      = 8 * 60 * 60 * 1000;
const VALID_TYPES   = ["debugging", "deployment", "code-review", "incident", "monitoring"];

function _load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
    catch { return { contexts: [], activeContextId: null }; }
}
function _save(db) {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {}
}

function saveContext(contextId, type, state = {}) {
    if (!contextId || !type) return { ok: false, error: "contextId and type required" };
    if (!VALID_TYPES.includes(type)) return { ok: false, error: `Invalid type. Valid: ${VALID_TYPES.join(", ")}` };

    const db  = _load();
    const now = Date.now();
    const existing = db.contexts.find(c => c.contextId === contextId);

    if (existing) {
        existing.state    = state;
        existing.type     = type;
        existing.savedAt  = now;
    } else {
        db.contexts.push({ contextId, type, state, savedAt: now, createdAt: now });
        if (db.contexts.length > MAX_CONTEXTS) db.contexts = db.contexts.slice(-MAX_CONTEXTS);
    }
    _save(db);
    return { ok: true, contextId, type };
}

function switchContext(toContextId, { operatorApproved = false } = {}) {
    if (!toContextId) return { ok: false, error: "toContextId required" };

    const db  = _load();
    const now = Date.now();
    const ctx = db.contexts.find(c => c.contextId === toContextId);

    if (!ctx) return { ok: false, error: `Context '${toContextId}' not found` };
    if (now - ctx.savedAt > STALE_MS) return { ok: false, error: `Context '${toContextId}' is stale (>${STALE_MS / 3600000}h)`, stale: true };

    const prevContextId = db.activeContextId;
    db.activeContextId  = toContextId;
    _save(db);

    return {
        ok:          true,
        from:        prevContextId,
        to:          toContextId,
        type:        ctx.type,
        statePreview: Object.keys(ctx.state).slice(0, 5),
        summary:     `Switched context: ${prevContextId || "none"} → ${toContextId} (${ctx.type})`,
    };
}

function getActiveContext() {
    const db = _load();
    if (!db.activeContextId) return { ok: true, context: null, active: false };

    const ctx = db.contexts.find(c => c.contextId === db.activeContextId);
    if (!ctx) return { ok: true, context: null, active: false };

    const now   = Date.now();
    const stale = now - ctx.savedAt > STALE_MS;

    return {
        ok:      true,
        active:  !stale,
        stale,
        context: stale ? null : ctx,
        contextId: ctx.contextId,
        type:    ctx.type,
        age:     now - ctx.savedAt,
    };
}

function listContexts() {
    const db  = _load();
    const now = Date.now();
    return {
        ok:       true,
        active:   db.activeContextId,
        count:    db.contexts.length,
        contexts: db.contexts.map(c => ({
            contextId: c.contextId,
            type:      c.type,
            stale:     now - c.savedAt > STALE_MS,
            age:       now - c.savedAt,
            active:    c.contextId === db.activeContextId,
        })),
    };
}

function pruneStaleContexts() {
    const db  = _load();
    const now = Date.now();
    const before = db.contexts.length;
    db.contexts = db.contexts.filter(c => now - c.savedAt <= STALE_MS);
    if (db.activeContextId && !db.contexts.find(c => c.contextId === db.activeContextId)) db.activeContextId = null;
    _save(db);
    return { ok: true, removed: before - db.contexts.length, remaining: db.contexts.length };
}

module.exports = { saveContext, switchContext, getActiveContext, listContexts, pruneStaleContexts };
