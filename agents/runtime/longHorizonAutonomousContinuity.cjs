"use strict";
/**
 * Phase 639 — Long-Horizon Autonomous Continuity
 *
 * Reconnect-safe execution, multi-day workflow continuity, replay persistence,
 * deployment-session survivability, interrupted-chain restoration.
 * PREVENTS: stale workflow resurrection, replay corruption, duplicate recovery.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH      = path.join(__dirname, "../../data/long-horizon-autonomous.json");
const MAX_SESSIONS    = 30;
const SESSION_TTL     = 14 * 24 * 60 * 60 * 1000;
const STALE_THRESHOLD = 48 * 60 * 60 * 1000;
const DEDUP_MS        = 10 * 60 * 1000;

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

function persistAutonomousSession(sessionId, state = {}) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const db  = _load(); _prune(db);
    const idx = db.sessions.findIndex(s => s.sessionId === sessionId);

    const record = {
        sessionId,
        goal:              (state.goal              || "").slice(0, 200),
        activeFlows:       (state.activeFlows        || []).slice(0, 10),
        activeDebugRunId:  state.activeDebugRunId    || null,
        activeDeployId:    state.activeDeployId      || null,
        activeBrowserOpId: state.activeBrowserOpId   || null,
        activeGoalId:      state.activeGoalId        || null,
        interruptedChains: (state.interruptedChains  || []).slice(0, 5),
        replayIds:         (state.replayIds          || []).slice(0, 10),
        projectName:       state.projectName         || null,
        notes:             (state.notes              || "").slice(0, 400),
        createdAt:         idx >= 0 ? db.sessions[idx].createdAt : Date.now(),
        updatedAt:         Date.now(),
    };

    if (idx >= 0) { db.sessions[idx] = record; }
    else          { db.sessions.unshift(record); }
    _save(db);

    return { ok: true, sessionId, updatedAt: record.updatedAt };
}

function restoreAutonomousSession(sessionId, { force = false } = {}) {
    const db     = _load(); _prune(db);
    const record = db.sessions.find(s => s.sessionId === sessionId);
    if (!record) return { ok: false, error: "No persisted autonomous session found" };

    const ageMs  = Date.now() - record.updatedAt;
    const isStale = ageMs > STALE_THRESHOLD;

    if (isStale && !force) {
        return {
            ok:       false,
            stale:    true,
            sessionId,
            ageMs,
            error:    "Session stale (>48h) — use { force: true } to force-restore",
            record,
        };
    }

    // Restore interrupted chains
    const restoredChains = [];
    if (record.interruptedChains && record.interruptedChains.length > 0) {
        const adc = _tryRequire("./autonomousDebugChains.cjs");
        record.interruptedChains.forEach(chainId => {
            if (adc) {
                try {
                    const chain = adc.getChain(chainId);
                    if (chain && chain.status === "interrupted") restoredChains.push(chainId);
                } catch {}
            }
        });
    }

    db.reconnects.push({ sessionId, ageMs, ts: Date.now(), forced: force });
    _save(db);

    return { ok: true, sessionId, record, ageMs, isStale, restoredChains };
}

// ── Dedup recovery prevention ─────────────────────────────────────────────────

function isDuplicateRecovery(key) {
    const db = _load();
    const existing = (db.dedup || []).find(d => d.key === key);
    if (existing && Date.now() - existing.ts < DEDUP_MS) return true;
    db.dedup = [...(db.dedup || []).filter(d => d.key !== key), { key, ts: Date.now() }];
    _save(db);
    return false;
}

// ── Replay continuity ─────────────────────────────────────────────────────────

function persistReplayContinuity(replayId, state = {}) {
    const db = _load();
    const existing = (db.sessions || []).find(s => s.sessionId === `replay:${replayId}`);
    if (existing) {
        const idx = db.sessions.findIndex(s => s.sessionId === `replay:${replayId}`);
        db.sessions[idx].replayState = state;
        db.sessions[idx].updatedAt   = Date.now();
    } else {
        db.sessions.unshift({ sessionId: `replay:${replayId}`, replayState: state, createdAt: Date.now(), updatedAt: Date.now() });
    }
    db.sessions = db.sessions.slice(0, MAX_SESSIONS);
    _save(db);
    return { ok: true, replayId };
}

function restoreReplayContinuity(replayId) {
    const db = _load();
    const record = db.sessions.find(s => s.sessionId === `replay:${replayId}`);
    if (!record) return { ok: false, error: "No replay continuity found" };

    const stale = Date.now() - record.updatedAt > 7 * 24 * 60 * 60 * 1000;
    return { ok: !stale, replayId, stale, replayState: record.replayState, updatedAt: record.updatedAt };
}

// ── Deployment session survivability ─────────────────────────────────────────

function persistDeploymentSession(deploymentId, state = {}) {
    return persistAutonomousSession(`deploy:${deploymentId}`, { ...state, goal: `deployment:${deploymentId}` });
}

function restoreDeploymentSession(deploymentId) {
    return restoreAutonomousSession(`deploy:${deploymentId}`, { force: false });
}

// ── Continuity health ─────────────────────────────────────────────────────────

function continuityHealth() {
    const db     = _load(); _prune(db);
    const active = db.sessions.filter(s => Date.now() - s.updatedAt < 24 * 60 * 60 * 1000);
    const stale  = db.sessions.filter(s => Date.now() - s.updatedAt > STALE_THRESHOLD);
    const recent = (db.reconnects || []).filter(r => Date.now() - r.ts < 60 * 60 * 1000);
    const storm  = recent.length >= 8;

    return {
        ok:             !storm,
        activeSessions: active.length,
        staleSessions:  stale.length,
        recentReconnects: recent.length,
        storm,
        warning:        storm ? "Reconnect storm detected" : null,
        summary:        `Continuity: ${active.length} active / ${stale.length} stale`,
    };
}

function listSessions({ limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.sessions
        .filter(s => !s.sessionId.startsWith("replay:") && !s.sessionId.startsWith("deploy:"))
        .slice(0, limit)
        .map(s => ({ sessionId: s.sessionId, goal: s.goal, updatedAt: s.updatedAt, ageMins: Math.round((Date.now() - s.updatedAt) / 60000) }));
}

module.exports = { persistAutonomousSession, restoreAutonomousSession, isDuplicateRecovery, persistReplayContinuity, restoreReplayContinuity, persistDeploymentSession, restoreDeploymentSession, continuityHealth, listSessions };
