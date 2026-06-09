"use strict";
/**
 * Phase 625 — Long-Horizon Session Continuity
 *
 * Multi-day engineering continuity: reconnect-safe execution, runtime restoration,
 * replay continuity, deployment-session persistence.
 * PREVENTS: stale workflow resurrection, replay-chain corruption, duplicate recovery.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH    = path.join(__dirname, "../../data/long-horizon-continuity.json");
const MAX_SESSIONS  = 20;
const SESSION_TTL   = 14 * 24 * 60 * 60 * 1000; // 14 days
const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;  // 48h without activity

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { sessions: [], reconnects: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - SESSION_TTL;
    db.sessions  = (db.sessions || []).filter(s => s.updatedAt > cutoff).slice(0, MAX_SESSIONS);
    db.reconnects = (db.reconnects || []).slice(-100);
}

// ── Session persistence ───────────────────────────────────────────────────────

function persistSession(sessionId, state = {}) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const db  = _load(); _prune(db);
    const idx = db.sessions.findIndex(s => s.sessionId === sessionId);

    const record = {
        sessionId,
        goal:             (state.goal            || "").slice(0, 200),
        activeWorkflows:  (state.activeWorkflows  || []).slice(0, 10),
        activeDebugId:    state.activeDebugId     || null,
        activeDeployId:   state.activeDeployId    || null,
        activeReplayId:   state.activeReplayId    || null,
        activeAutomation: state.activeAutomation  || null,
        projectName:      state.projectName       || null,
        notes:            (state.notes            || "").slice(0, 500),
        checkpoints:      (state.checkpoints      || []).slice(-20),
        createdAt:        idx >= 0 ? db.sessions[idx].createdAt : Date.now(),
        updatedAt:        Date.now(),
    };

    if (idx >= 0) { db.sessions[idx] = record; }
    else          { db.sessions.unshift(record); }
    _save(db);

    return { ok: true, sessionId, updatedAt: record.updatedAt };
}

function restoreSession(sessionId) {
    const db     = _load(); _prune(db);
    const record = db.sessions.find(s => s.sessionId === sessionId);
    if (!record) return { ok: false, error: "No persisted session found" };

    const ageMs     = Date.now() - record.updatedAt;
    const isStale   = ageMs > STALE_THRESHOLD_MS;
    const ageSummary = ageMs < 60000 ? "just now" : ageMs < 3600000 ? Math.round(ageMs / 60000) + "min ago" : Math.round(ageMs / 3600000) + "h ago";

    // Stale workflow resurrection prevention
    if (isStale) {
        return {
            ok:       false,
            stale:    true,
            sessionId,
            age:      ageSummary,
            error:    `Session is ${ageSummary} old — workflows may be stale. Force-restore with { forceRestore: true }`,
            record,
        };
    }

    return { ok: true, sessionId, record, age: ageSummary, isStale: false };
}

function forceRestoreSession(sessionId) {
    const db     = _load(); _prune(db);
    const record = db.sessions.find(s => s.sessionId === sessionId);
    if (!record) return { ok: false, error: "No persisted session found" };

    const ageMs  = Date.now() - record.updatedAt;
    const age    = ageMs < 3600000 ? Math.round(ageMs / 60000) + "min" : Math.round(ageMs / 3600000) + "h";

    // Log reconnect
    db.reconnects.push({ sessionId, age, forcedAt: Date.now() });
    _save(db);

    return { ok: true, sessionId, record, age, forced: true, warning: ageMs > STALE_THRESHOLD_MS ? "Workflows may need re-validation before use" : null };
}

// ── Reconnect safety ──────────────────────────────────────────────────────────

function recordReconnect(sessionId, { fromOfflineMs = 0 } = {}) {
    const db = _load();
    db.reconnects = [...(db.reconnects || []), {
        sessionId,
        fromOfflineMs,
        ts: Date.now(),
    }].slice(-100);
    _save(db);

    // Detect reconnect storm
    const recentReconnects = db.reconnects.filter(r => r.sessionId === sessionId && Date.now() - r.ts < 5 * 60 * 1000);
    const isStorm = recentReconnects.length >= 5;

    return { ok: true, sessionId, reconnectCount: recentReconnects.length, stormDetected: isStorm };
}

// ── Replay continuity ─────────────────────────────────────────────────────────

function validateReplayContinuity(replayId) {
    const ers = _tryRequire("./executionReplaySystem.cjs");
    if (!ers) return { ok: false, error: "executionReplaySystem unavailable" };

    const replay = ers.getReplay(replayId);
    if (!replay) return { ok: false, error: "replay not found", replayId };

    const ageDays = (Date.now() - replay.createdAt) / (24 * 60 * 60 * 1000);
    const stale   = ageDays > 7;

    return {
        ok:       !stale,
        replayId,
        name:     replay.name,
        ageDays:  Math.round(ageDays * 10) / 10,
        stale,
        warning:  stale ? `Replay is ${Math.round(ageDays)} days old — steps may no longer apply` : null,
        replayCount: replay.replayCount,
    };
}

// ── Duplicate recovery prevention ────────────────────────────────────────────

const _recoveryLog = new Map(); // key -> ts
const DEDUP_MS     = 10 * 60 * 1000;

function isDuplicateRecovery(key) {
    const ts = _recoveryLog.get(key);
    if (ts && Date.now() - ts < DEDUP_MS) return true;
    _recoveryLog.set(key, Date.now());
    return false;
}

// ── Long-horizon health ───────────────────────────────────────────────────────

function longHorizonHealth() {
    const db   = _load(); _prune(db);
    const sessions = db.sessions;

    const activeSessions = sessions.filter(s => Date.now() - s.updatedAt < 24 * 60 * 60 * 1000);
    const staleSessions  = sessions.filter(s => Date.now() - s.updatedAt > STALE_THRESHOLD_MS);

    const recentReconnects = (db.reconnects || []).filter(r => Date.now() - r.ts < 60 * 60 * 1000).length;
    const reconnectStorm   = recentReconnects >= 10;

    return {
        ok:                !reconnectStorm,
        totalSessions:     sessions.length,
        activeSessions:    activeSessions.length,
        staleSessions:     staleSessions.length,
        recentReconnects,
        reconnectStorm,
        warning:           reconnectStorm ? "Reconnect storm detected — investigate connectivity" : null,
        summary:           `Sessions: ${activeSessions.length} active / ${staleSessions.length} stale`,
    };
}

function listSessions({ limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.sessions
        .slice(0, limit)
        .map(s => ({ sessionId: s.sessionId, goal: s.goal, updatedAt: s.updatedAt, age: Math.round((Date.now() - s.updatedAt) / 60000) + "min" }));
}

module.exports = { persistSession, restoreSession, forceRestoreSession, recordReconnect, validateReplayContinuity, isDuplicateRecovery, longHorizonHealth, listSessions };
