"use strict";
/**
 * AI Response Cache — exact-match caching for chat completions.
 *
 * No response cache existed anywhere in the AI stack before this — every
 * identical repeated request (same provider, same model, same messages,
 * same temperature) re-hit the real provider API and re-incurred real cost,
 * even for something as simple as a user re-sending the same question or a
 * UI component re-fetching the same prompt on remount.
 *
 * Cache key: sha256(provider + model + temperature + JSON(messages)).
 * Deliberately exact-match, not semantic/fuzzy — a fuzzy cache risks serving
 * a wrong answer for a similar-but-different question, which is worse than
 * no caching at all for anything cost-sensitive. TTL-based expiry, in-memory
 * (process-local, same lifetime tradeoff as usageMetering's ring buffer —
 * resets on restart, which is acceptable for a request-dedup cache, not a
 * durable store).
 *
 * Storage: in-memory only (Map). No new persistent storage — a cache is by
 * definition disposable; persisting it would just be a second, staler copy
 * of usageMetering's ledger for no benefit.
 */

const crypto = require("crypto");

const DEFAULT_TTL_MS = 5 * 60_000; // 5 minutes
const MAX_ENTRIES     = 500;       // bound memory; evict oldest on overflow

const _store = new Map(); // key -> { value, expiresAt, hits, createdAt }
let _hits = 0;
let _misses = 0;

function _key(provider, model, messages, temperature) {
  const payload = JSON.stringify({ provider, model, temperature: temperature ?? 0.7, messages });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function _evictExpired() {
  const now = Date.now();
  for (const [k, v] of _store.entries()) {
    if (v.expiresAt <= now) _store.delete(k);
  }
}

function _evictOldestIfFull() {
  if (_store.size < MAX_ENTRIES) return;
  const oldestKey = _store.keys().next().value; // Map preserves insertion order
  if (oldestKey) _store.delete(oldestKey);
}

/**
 * Look up a cached response. Returns null on miss or expiry.
 */
function get(provider, model, messages, temperature) {
  _evictExpired();
  const k = _key(provider, model, messages, temperature);
  const entry = _store.get(k);
  if (!entry) { _misses++; return null; }
  if (entry.expiresAt <= Date.now()) { _store.delete(k); _misses++; return null; }
  entry.hits++;
  _hits++;
  return { ...entry.value, cached: true, cacheHits: entry.hits };
}

/**
 * Store a response for later exact-match retrieval.
 */
function set(provider, model, messages, temperature, value, ttlMs = DEFAULT_TTL_MS) {
  _evictExpired();
  _evictOldestIfFull();
  const k = _key(provider, model, messages, temperature);
  _store.set(k, { value, expiresAt: Date.now() + ttlMs, hits: 0, createdAt: Date.now() });
  return k;
}

function clear() {
  _store.clear();
}

function stats() {
  _evictExpired();
  const total = _hits + _misses;
  return {
    entries: _store.size,
    maxEntries: MAX_ENTRIES,
    hits: _hits,
    misses: _misses,
    hitRate: total ? parseFloat((_hits / total).toFixed(4)) : 0,
  };
}

module.exports = { get, set, clear, stats, DEFAULT_TTL_MS };
