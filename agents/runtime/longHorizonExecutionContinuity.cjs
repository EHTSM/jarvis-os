"use strict";
/**
 * Phase 654 — Long-Horizon Execution Continuity
 *
 * Multi-day engineering continuity, reconnect-safe replay persistence,
 * interrupted workflow restoration, runtime-state recovery, deployment-session survivability.
 * PREVENTS: stale replay resurrection, duplicate recovery, corrupted continuation.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH      = path.join(__dirname, "../../data/long-horizon-exec-continuity.json");
const MAX_SESSIONS    = 30;
const SESSION_TTL     = 14 * 24 * 60 * 60 * 1000;
const STALE_THRESHOLD = 48 * 60 * 60 * 1000;
const DEDUP_MS        = 10 * 60 * 1000;
const STORM_WINDOW    = 60 * 60 * 1000;
const STORM_THRESHOLD = 8;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { sessions: [], reconnects: [], dedup: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - SESSION_TTL;
    db.sessions  = (db.sessions || []).filter(s => s.updatedAt > cutoff).slice(0, MAX_SESSIONS);
    db.reconnects = (db.reconnects || []).slice(-100);
    db.dedup      = (db.dedup || []).filter(d => Date.now() - d.ts < DEDUP_MS);
}

// ── Session persistence ───────────────────────────────────────────────────────

function persistSession(sessionId, state = {}) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const db  = _load(); _prune(db);
    const idx = db.sessions.findIndex(s => s.sessionId === sessionId);

    const record = {
        sessionId,
        goal:             (state.goal             || "").slice(0, 200),
        activeFlows:      (state.activeFlows       || []).slice(0, 10),
        activeRunId:      state.activeRunId        || null,
        activeChainId:    state.activeChainId      || null,
        activeDeployId:   state.activeDeployId     || null,
        replayIds:        (state.replayIds         || []).slice(0, 10),
        interruptedRuns:  (state.interruptedRuns   || []).slice(0, 5),
        notes:            (state.notes             || "").slice(0, 400),
        createdAt:        idx >= 0 ? db.sessions[idx].createdAt : Date.now(),
        updatedAt:        Date.now(),
    };

    if (idx >= 0) { db.sessions[idx] = record; }
    else          { db.sessions.unshift(record); }
    _save(db);
    return { ok: true, sessionId, updatedAt: record.updatedAt };
}

function restoreSession(sessionId, { force = false } = {}) {
    const db     = _load(); _prune(db);
    const record = db.sessions.find(s => s.sessionId === sessionId);
    if (!record) return { ok: false, error: "No session found" };

    const ageMs   = Date.now() - record.updatedAt;
    const isStale = ageMs > STALE_THRESHOLD;

    if (isStale && !force) {
        return { ok: false, stale: true, sessionId, ageMs, error: "Session stale (>48h) — use { force: true } to restore", record };
    }

    db.reconnects.push({ sessionId, ageMs, ts: Date.now(), forced: force });
    _save(db);
    return { ok: true, sessionId, record, ageMs, isStale };
}

// ── Dedup recovery prevention ─────────────────────────────────────────────────

function isDuplicateRecovery(key) {
    const db = _load();
    const hit = (db.dedup || []).find(d => d.key === key);
    if (hit && Date.now() - hit.ts < DEDUP_MS) return true;
    db.dedup = [...(db.dedup || []).filter(d => d.key !== key), { key, ts: Date.now() }];
    _save(db);
    return false;
}

// ── Replay continuity ─────────────────────────────────────────────────────────

function persistReplayContinuity(replayId, state = {}) {
    const db  = _load();
    const key = `replay:${replayId}`;
    const idx = db.sessions.findIndex(s => s.sessionId === key);
    if (idx >= 0) {
        db.sessions[idx].replayState = state;
        db.sessions[idx].updatedAt   = Date.now();
    } else {
        db.sessions.unshift({ sessionId: key, replayState: state, createdAt: Date.now(), updatedAt: Date.now() });
    }
    db.sessions = db.sessions.slice(0, MAX_SESSIONS);
    _save(db);
    return { ok: true, replayId };
}

function restoreReplayContinuity(replayId) {
    const db     = _load();
    const record = db.sessions.find(s => s.sessionId === `replay:${replayId}`);
    if (!record) return { ok: false, error: "No replay continuity found" };
    const stale = Date.now() - record.updatedAt > 7 * 24 * 60 * 60 * 1000;
    if (stale) return { ok: false, stale: true, replayId, error: "Replay continuity stale (>7d)" };
    return { ok: true, replayId, replayState: record.replayState, updatedAt: record.updatedAt };
}

// ── Deployment session survivability ─────────────────────────────────────────

function persistDeploymentSession(deploymentId, state = {}) {
    return persistSession(`deploy:${deploymentId}`, { ...state, goal: `deployment:${deploymentId}` });
}

function restoreDeploymentSession(deploymentId, { force = false } = {}) {
    return restoreSession(`deploy:${deploymentId}`, { force });
}

// ── Continuity health ─────────────────────────────────────────────────────────

function continuityHealth() {
    const db     = _load(); _prune(db);
    const active = db.sessions.filter(s => Date.now() - s.updatedAt < 24 * 60 * 60 * 1000);
    const stale  = db.sessions.filter(s => Date.now() - s.updatedAt > STALE_THRESHOLD);
    const recent = (db.reconnects || []).filter(r => Date.now() - r.ts < STORM_WINDOW);
    const storm  = recent.length >= STORM_THRESHOLD;

    return {
        ok:              !storm,
        activeSessions:  active.length,
        staleSessions:   stale.length,
        recentReconnects: recent.length,
        storm,
        warning:         storm ? `Reconnect storm: ${recent.length} reconnects in last hour` : null,
        summary:         `Continuity: ${active.length} active / ${stale.length} stale`,
    };
}

function listSessions({ limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.sessions
        .filter(s => !s.sessionId.startsWith("replay:") && !s.sessionId.startsWith("deploy:"))
        .slice(0, limit)
        .map(s => ({ sessionId: s.sessionId, goal: s.goal, updatedAt: s.updatedAt, ageMins: Math.round((Date.now() - s.updatedAt) / 60000) }));
}

module.exports = { persistSession, restoreSession, isDuplicateRecovery, persistReplayContinuity, restoreReplayContinuity, persistDeploymentSession, restoreDeploymentSession, continuityHealth, listSessions };
