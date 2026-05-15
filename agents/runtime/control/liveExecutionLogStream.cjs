"use strict";

// Bounded, ordered log stream for live execution events.
// Supports streaming subscriptions, filtering, and retention management.

const MAX_ENTRIES       = 20000;
const MAX_SUBSCRIPTIONS = 200;
const MAX_AUDIT         = 1000;

const LOG_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);
const LEVEL_RANK = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 };

let _counter       = 0;
let _entries       = [];   // ordered newest-first
let _subscriptions = new Map(); // subId → subscription record
let _auditLog      = [];

function _audit(entry) {
  _auditLog.unshift(Object.freeze(entry));
  if (_auditLog.length > MAX_AUDIT) _auditLog.length = MAX_AUDIT;
}

function appendLog({ executionId, level = "info", message, subsystem = null, metadata = {} } = {}) {
  if (!executionId) return { appended: false, reason: "missing_execution_id" };
  if (!message)     return { appended: false, reason: "missing_message" };
  if (!LOG_LEVELS.has(level)) return { appended: false, reason: "invalid_log_level" };

  const entryId = `log-${++_counter}`;
  const now     = new Date().toISOString();
  const entry   = Object.freeze({
    entryId, executionId, level, message,
    subsystem:  subsystem ?? null,
    metadata:   Object.freeze({ ...metadata }),
    timestamp:  now,
    seq:        _counter,
  });

  _entries.unshift(entry);
  if (_entries.length > MAX_ENTRIES) _entries.length = MAX_ENTRIES;

  // Fan-out to matching subscriptions (errors isolated)
  for (const [, sub] of _subscriptions) {
    if (_matchesFilter(entry, sub.filter)) {
      try { sub.handler(entry); } catch (_) {}
    }
  }

  return { appended: true, entryId, seq: _counter };
}

function _matchesFilter(entry, filter = {}) {
  if (filter.executionId && entry.executionId !== filter.executionId) return false;
  if (filter.subsystem   && entry.subsystem   !== filter.subsystem)   return false;
  if (filter.minLevel && LEVEL_RANK[entry.level] < LEVEL_RANK[filter.minLevel]) return false;
  return true;
}

function subscribe(handler, { filter = {}, label = "" } = {}) {
  if (typeof handler !== "function") return { subscribed: false, reason: "handler_not_function" };
  if (_subscriptions.size >= MAX_SUBSCRIPTIONS) return { subscribed: false, reason: "subscription_limit_reached" };

  const subId = `sub-${++_counter}`;
  _subscriptions.set(subId, { subId, handler, filter, label, createdAt: new Date().toISOString() });
  _audit({ auditId: `lsa-${_counter}`, subId, action: "subscribe", label, timestamp: new Date().toISOString() });
  return { subscribed: true, subId };
}

function unsubscribe(subId) {
  if (!_subscriptions.has(subId)) return { unsubscribed: false, reason: "subscription_not_found" };
  _subscriptions.delete(subId);
  _audit({ auditId: `lsa-${++_counter}`, subId, action: "unsubscribe", timestamp: new Date().toISOString() });
  return { unsubscribed: true, subId };
}

// Query log entries with optional filter + pagination
function queryLogs({ executionId = null, subsystem = null, minLevel = null, limit = 100, afterSeq = 0 } = {}) {
  let results = _entries;

  if (executionId) results = results.filter(e => e.executionId === executionId);
  if (subsystem)   results = results.filter(e => e.subsystem   === subsystem);
  if (minLevel)    results = results.filter(e => LEVEL_RANK[e.level] >= (LEVEL_RANK[minLevel] ?? 0));
  if (afterSeq > 0) results = results.filter(e => e.seq > afterSeq);

  return results.slice(0, limit);
}

function getLogEntry(entryId) {
  const e = _entries.find(e => e.entryId === entryId);
  if (!e) return { found: false };
  return { found: true, ...e };
}

// Prune entries older than cutoffMs milliseconds from now
function pruneOldEntries({ maxAgeMs = 3600000, nowMs = Date.now() } = {}) {
  const cutoff   = new Date(nowMs - maxAgeMs).toISOString();
  const before   = _entries.length;
  _entries       = _entries.filter(e => e.timestamp >= cutoff);
  const pruned   = before - _entries.length;
  return { pruned, remaining: _entries.length };
}

function getStreamMetrics() {
  const byLevel = {};
  for (const e of _entries) byLevel[e.level] = (byLevel[e.level] ?? 0) + 1;
  return {
    totalEntries:     _entries.length,
    subscriptions:    _subscriptions.size,
    maxEntries:       MAX_ENTRIES,
    byLevel,
    newestSeq:        _entries[0]?.seq ?? 0,
    oldestSeq:        _entries[_entries.length - 1]?.seq ?? 0,
  };
}

function getAuditLog(limit = 100) { return _auditLog.slice(0, limit); }

function reset() {
  _counter       = 0;
  _entries       = [];
  _subscriptions = new Map();
  _auditLog      = [];
}

module.exports = {
  appendLog, subscribe, unsubscribe, queryLogs, getLogEntry,
  pruneOldEntries, getStreamMetrics, getAuditLog, reset,
  LOG_LEVELS: Array.from(LOG_LEVELS),
  MAX_ENTRIES,
};
