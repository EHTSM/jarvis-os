"use strict";
/**
 * Phase 596 — Platform Performance Pass
 *
 * Optimizes: replay rendering, workflow loading, execution responsiveness,
 *            browser operation speed, session restoration, runtime visibility.
 *
 * Techniques: lazy loading, result caching, batch aggregation, TTL-bounded caches.
 */

const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Result cache ──────────────────────────────────────────────────────────────

const _cache    = new Map();  // key -> { result, ts, hits }
const CACHE_TTL = new Map([
    ["replay",     30 * 1000],   // replays: 30s
    ["workflow",   15 * 1000],   // workflows: 15s
    ["foundation", 60 * 1000],   // foundation health: 60s
    ["dashboard",  10 * 1000],   // dashboard: 10s
    ["memory",     45 * 1000],   // memory stats: 45s
    ["default",    20 * 1000],
]);

function _cacheKey(type, id) {
    return `${type}:${id || ""}`;
}

function cachedGet(type, id, fetchFn) {
    const key  = _cacheKey(type, id);
    const ttl  = CACHE_TTL.get(type) || CACHE_TTL.get("default");
    const now  = Date.now();
    const hit  = _cache.get(key);
    if (hit && now - hit.ts < ttl) {
        hit.hits++;
        _cache.set(key, hit);
        return { ...hit.result, _cached: true, _cacheAge: now - hit.ts };
    }
    const result = fetchFn();
    _cache.set(key, { result, ts: now, hits: 0 });
    return result;
}

function invalidate(type, id = null) {
    if (id) {
        _cache.delete(_cacheKey(type, id));
    } else {
        for (const k of _cache.keys()) { if (k.startsWith(`${type}:`)) _cache.delete(k); }
    }
}

function cacheStats() {
    const entries = [..._cache.entries()].map(([k, v]) => ({ key: k, age: Date.now() - v.ts, hits: v.hits }));
    return { size: _cache.size, entries: entries.slice(0, 20) };
}

// ── Replay rendering optimization ────────────────────────────────────────────

/**
 * Paginate timeline events for efficient replay rendering.
 * Returns a page of events with cursor for next page.
 */
function paginateTimeline(opts = {}) {
    const { type = null, sessionId = null, page = 0, pageSize = 20 } = opts;
    const tl = _tryRequire("./executionTimeline.cjs");
    if (!tl) return { events: [], total: 0, page, hasMore: false };

    return cachedGet("replay", `${type}:${sessionId}:${page}`, () => {
        const events = tl.search({ type, sessionId, limit: (page + 1) * pageSize + 1 });
        const start  = page * pageSize;
        const slice  = events.slice(start, start + pageSize);
        return { events: slice, page, pageSize, hasMore: events.length > start + pageSize };
    });
}

// ── Workflow loading optimization ─────────────────────────────────────────────

/**
 * Load workflow list with caching.
 */
function loadWorkflows(cached = true) {
    const loader = () => {
        const ec  = _tryRequire("./engineeringChains.cjs");
        const pce = _tryRequire("./productivityChainEngine.cjs");
        return {
            engineeringChains:  ec  ? ec.listChains()  : [],
            productivityChains: pce ? pce.listChains() : [],
        };
    };
    if (!cached) return loader();
    return cachedGet("workflow", "all", loader);
}

// ── Foundation health (cached) ────────────────────────────────────────────────

function loadFoundationHealth(cached = true) {
    const loader = () => {
        const ef = _tryRequire("./engineeringFoundation.cjs");
        return ef ? ef.foundationHealth() : { ok: false, error: "engineeringFoundation not loaded" };
    };
    if (!cached) return loader();
    return cachedGet("foundation", "health", loader);
}

// ── Session restoration speed ─────────────────────────────────────────────────

/**
 * Fast session restore: load checkpoint + recent timeline in one call.
 */
function fastSessionRestore(sessionId) {
    const ts  = _tryRequire("./terminalSupervisor.cjs");
    const tl  = _tryRequire("./executionTimeline.cjs");
    const si  = _tryRequire("./sessionIntelligenceEngine.cjs");

    const start = Date.now();
    const result = {
        checkpoint:  ts  ? ts.loadCheckpoint(sessionId) : null,
        recentEvents:tl  ? tl.sessionThread(sessionId, 10) : [],
        intelligence:si  ? si.getSessionIntelligence(sessionId) : null,
        restoredInMs:0,
    };
    result.restoredInMs = Date.now() - start;
    return result;
}

// ── Execution responsiveness measurement ──────────────────────────────────────

/**
 * Measure latency of core platform operations.
 */
function measureResponsiveness() {
    const timings = {};

    const time = (name, fn) => {
        const t = Date.now();
        try { fn(); } catch {}
        timings[name] = Date.now() - t;
    };

    time("foundation-health",   () => loadFoundationHealth(false));
    time("workflow-load",       () => loadWorkflows(false));
    time("cache-stats",         () => cacheStats());

    const avg = Object.values(timings).reduce((s, v) => s + v, 0) / Object.keys(timings).length;
    return { timings, avgMs: Math.round(avg), fast: avg < 50 };
}

// ── Memory pressure cleanup ───────────────────────────────────────────────────

/**
 * Prune expired cache entries to free memory.
 */
function pruneExpiredCache() {
    const now     = Date.now();
    let   pruned  = 0;
    for (const [k, v] of _cache) {
        const type = k.split(":")[0];
        const ttl  = CACHE_TTL.get(type) || CACHE_TTL.get("default");
        if (now - v.ts > ttl * 3) { _cache.delete(k); pruned++; }
    }
    return { pruned, remaining: _cache.size };
}

module.exports = { cachedGet, invalidate, cacheStats, paginateTimeline, loadWorkflows, loadFoundationHealth, fastSessionRestore, measureResponsiveness, pruneExpiredCache };
