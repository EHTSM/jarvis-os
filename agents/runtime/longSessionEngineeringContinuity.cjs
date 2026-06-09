"use strict";
/**
 * Phase 759 — Long-Session Engineering Continuity
 *
 * Multi-day workspace persistence, reconnect-safe replay continuity,
 * interrupted debugging restoration, deployment-session survivability,
 * execution-state durability.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const DATA_FILE      = path.join(__dirname, "../../data/long-session-engineering-continuity.json");
const SESSION_TTL    = 14 * 24 * 60 * 60 * 1000;  // 14 days
const STALE_THRESH   = 48 * 60 * 60 * 1000;        // 48h
const DEDUP_MS       = 10 * 60 * 1000;
const STORM_THRESH   = 8;
const STORM_WINDOW   = 60 * 60 * 1000;
const MAX_SESSIONS   = 50;

function _load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return { sessions: [], reconnects: [] }; }
}
function _save(db) { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {} }

function _stormCheck(db) {
    const now = Date.now();
    const recent = db.reconnects.filter(r => now - r.ts <= STORM_WINDOW);
    return { storm: recent.length >= STORM_THRESH, count: recent.length };
}

function persistEngineeringSession(sessionId, state = {}) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const db  = _load();
    const now = Date.now();
    const dup = db.sessions.find(s => s.sessionId === sessionId && now - (s.updatedAt || s.createdAt) < DEDUP_MS);
    if (dup) return { ok: true, duplicate: true, sessionId };

    const existing = db.sessions.find(s => s.sessionId === sessionId);
    if (existing) {
        existing.state     = state;
        existing.updatedAt = now;
    } else {
        db.sessions.push({ sessionId, state, createdAt: now, updatedAt: now });
        if (db.sessions.length > MAX_SESSIONS) db.sessions = db.sessions.slice(-MAX_SESSIONS);
    }
    _save(db);
    return { ok: true, sessionId };
}

function restoreEngineeringSession(sessionId, { force = false } = {}) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const db  = _load();
    const now = Date.now();

    const sc = _stormCheck(db);
    if (sc.storm && !force) return { ok: false, storm: true, error: "Reconnect storm detected — restoration blocked" };

    const s = db.sessions.find(x => x.sessionId === sessionId);
    if (!s) return { ok: false, error: "session not found" };

    const age = now - s.updatedAt;
    if (age > SESSION_TTL) return { ok: false, error: "session expired (>14d)" };
    if (age > STALE_THRESH && !force) return { ok: false, stale: true, error: "session stale (>48h) — use force=true to override" };

    db.reconnects.push({ ts: now, sessionId });
    if (db.reconnects.length > 100) db.reconnects = db.reconnects.slice(-100);
    _save(db);

    return { ok: true, sessionId, state: s.state, age };
}

function interruptedDebugRecovery(sessionId) {
    const rdse = _tryRequire("./realDebugSessionExperience.cjs");
    if (!rdse) return { ok: false, reason: "debug session module unavailable" };

    try {
        const status = rdse.getDebugSessionStatus(sessionId);
        if (!status.ok) return { ok: false, error: status.error };
        if (status.status === "completed") return { ok: false, error: "session already completed" };
        if (status.stale) return { ok: false, stale: true, error: "debug session stale" };
        return { ok: true, sessionId, currentPhase: status.currentPhase, resumable: true };
    } catch (e) { return { ok: false, error: e.message }; }
}

function deploymentSessionSurvivability(deploymentId) {
    const dee = _tryRequire("./deploymentExecutionExperience.cjs");
    if (!dee) return { ok: false, reason: "deployment experience module unavailable" };

    try {
        const progress = dee.getDeploymentProgress(deploymentId);
        if (!progress.ok) return { ok: false, error: progress.error };
        if (progress.stale) return { ok: false, stale: true, error: "deployment session stale" };
        return { ok: true, deploymentId, currentStage: progress.currentStage, progress: progress.progress, resumable: progress.status === "active" };
    } catch (e) { return { ok: false, error: e.message }; }
}

function engineeringContinuityHealth() {
    const db  = _load();
    const now = Date.now();
    const sc  = _stormCheck(db);

    const activeSessions = db.sessions.filter(s => now - s.updatedAt <= STALE_THRESH).length;
    const staleSessions  = db.sessions.filter(s => now - s.updatedAt > STALE_THRESH && now - s.updatedAt <= SESSION_TTL).length;

    return {
        ok:             !sc.storm,
        storm:          sc.storm,
        reconnects:     sc.count,
        activeSessions,
        staleSessions,
        summary:        `Engineering continuity: storm=${sc.storm} active=${activeSessions} stale=${staleSessions}`,
    };
}

module.exports = { persistEngineeringSession, restoreEngineeringSession, interruptedDebugRecovery, deploymentSessionSurvivability, engineeringContinuityHealth };
