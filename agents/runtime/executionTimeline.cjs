"use strict";
/**
 * Phase 582 — Advanced Execution Timeline
 *
 * Searchable, replay-aware timeline tracking:
 *   - patch application history
 *   - deployment transitions
 *   - debugging flows
 *   - replay-linked execution
 *   - recovery-chain progression
 *
 * State: data/execution-timeline.json
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

const TL_PATH    = path.join(__dirname, "../../data/execution-timeline.json");
const MAX_EVENTS = 500;

const EVENT_TYPES = new Set(["patch", "deployment", "debug", "replay", "recovery", "session", "chain", "error", "validation"]);

function _load() {
    try { return JSON.parse(fs.readFileSync(TL_PATH, "utf8")); }
    catch { return { events: [] }; }
}

function _save(db) {
    try { fs.mkdirSync(path.dirname(TL_PATH), { recursive: true }); fs.writeFileSync(TL_PATH, JSON.stringify(db, null, 2)); } catch {}
}

// ── Event recording ───────────────────────────────────────────────────────────

/**
 * Record any timeline event.
 * @param {string} type — one of EVENT_TYPES
 * @param {object} payload — event-specific data
 */
function record(type, payload = {}) {
    if (!EVENT_TYPES.has(type)) type = "session";
    const db    = _load();
    const event = {
        id:        crypto.randomUUID(),
        type,
        ts:        Date.now(),
        sessionId: payload.sessionId || null,
        replayId:  payload.replayId  || null,
        label:     (payload.label    || type).slice(0, 120),
        meta:      _sanitize(payload),
    };
    db.events.unshift(event);
    db.events = db.events.slice(0, MAX_EVENTS);
    _save(db);
    return event.id;
}

// Convenience recorders
function recordPatch(patchId, filePath, status, sessionId = null) {
    return record("patch", { label: `Patch ${status}: ${path.basename(filePath)}`, patchId, filePath, status, sessionId });
}

function recordDeployment(pipelineName, state, runId = null, sessionId = null) {
    return record("deployment", { label: `Deploy ${state}: ${pipelineName}`, pipelineName, state, runId, sessionId });
}

function recordDebug(goal, outcome, sessionId = null) {
    return record("debug", { label: `Debug: ${(goal || "").slice(0, 60)} → ${outcome}`, goal, outcome, sessionId });
}

function recordReplay(replayId, goal, result, sessionId = null) {
    return record("replay", { label: `Replay: ${(goal || "").slice(0, 60)}`, replayId, goal, result, sessionId });
}

function recordRecovery(chainName, outcome, sessionId = null) {
    return record("recovery", { label: `Recovery: ${chainName} → ${outcome}`, chainName, outcome, sessionId });
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Search timeline events.
 * @param {{ q?, type?, sessionId?, replayId?, since?, limit? }} opts
 */
function search(opts = {}) {
    const { q = "", type = null, sessionId = null, replayId = null, since = 0, limit = 50 } = opts;
    const db    = _load();
    const lower = q.toLowerCase();

    return db.events
        .filter(e => {
            if (since     && e.ts < since)          return false;
            if (type      && e.type !== type)        return false;
            if (sessionId && e.sessionId !== sessionId) return false;
            if (replayId  && e.replayId  !== replayId)  return false;
            if (lower && !e.label.toLowerCase().includes(lower) && !JSON.stringify(e.meta).toLowerCase().includes(lower)) return false;
            return true;
        })
        .slice(0, limit);
}

/**
 * Get a replay-linked execution thread (all events for a replayId).
 */
function replayThread(replayId) {
    return search({ replayId, limit: 100 });
}

/**
 * Get a session's full timeline.
 */
function sessionThread(sessionId, limit = 100) {
    return search({ sessionId, limit });
}

/**
 * Recent events summary for dashboard.
 */
function recentSummary(limit = 20) {
    const db     = _load();
    const events = db.events.slice(0, limit);
    const byType = {};
    for (const e of events) byType[e.type] = (byType[e.type] || 0) + 1;
    return { total: db.events.length, recent: events.length, byType, latestAt: events[0]?.ts || null };
}

// ── Recovery-chain progression ────────────────────────────────────────────────

/**
 * Build a recovery chain progression view for a session.
 */
function recoveryProgression(sessionId) {
    const events = search({ sessionId, type: "recovery", limit: 50 });
    return events.map(e => ({
        ts:        e.ts,
        chainName: e.meta?.chainName || "unknown",
        outcome:   e.meta?.outcome   || "unknown",
        label:     e.label,
    })).sort((a, b) => a.ts - b.ts);
}

function _sanitize(payload) {
    const { sessionId, replayId, label, ...rest } = payload;
    return rest;
}

module.exports = { record, recordPatch, recordDeployment, recordDebug, recordReplay, recordRecovery, search, replayThread, sessionThread, recentSummary, recoveryProgression };
