"use strict";
/**
 * Phase 467 — Auth + Session Hardening
 *
 * Session recovery, multi-window safety, reconnect continuity,
 * stale-session cleanup, and authentication reliability.
 *
 * Prevents: orphaned sessions, runtime desync, duplicate operator state.
 *
 * Works alongside engineeringSession (file-backed) and the existing
 * JWT auth layer. This module adds session-level guards.
 *
 * Stale threshold: session heartbeat older than STALE_MS is orphaned.
 * Orphan recovery: transition to "abandoned" with reason "stale_heartbeat".
 * Duplicate detection: same operatorId + same goal within DEDUP_WINDOW_MS → deduplicated.
 */

const logger  = require("../../backend/utils/logger");
const session = require("./engineeringSession.cjs");

const STALE_MS         = 2 * 60 * 60 * 1000;  // 2h without heartbeat
const DEDUP_WINDOW_MS  = 60 * 1000;             // 1 min

// In-memory multi-window guard: track active sessions per operatorId
const _activeMap = new Map(); // operatorId → Set<sessionId>

function _register(operatorId, sessionId) {
    if (!_activeMap.has(operatorId)) _activeMap.set(operatorId, new Set());
    _activeMap.get(operatorId).add(sessionId);
}

function _deregister(operatorId, sessionId) {
    _activeMap.get(operatorId)?.delete(sessionId);
}

/**
 * Register a session as active for an operator.
 * Detects duplicate active sessions for the same goal.
 * @param {string} operatorId
 * @param {string} sessionId
 * @param {string} goal
 * @returns {{ ok: boolean, duplicate?: string, reason?: string }}
 */
function registerActive(operatorId, sessionId, goal) {
    const active = _activeMap.get(operatorId);
    if (active) {
        // Check for duplicate goal in active sessions
        for (const sid of active) {
            const s = session.get(sid);
            if (!s || s.state !== "active") { _deregister(operatorId, sid); continue; }
            if (s.goal === goal && Math.abs(s.createdAt - Date.now()) < DEDUP_WINDOW_MS) {
                logger.warn(`[SessionHarden] duplicate session detected for operator=${operatorId} goal="${goal.slice(0, 40)}"`);
                return { ok: false, duplicate: sid, reason: "duplicate_active_session" };
            }
        }
    }
    _register(operatorId, sessionId);
    return { ok: true };
}

/** Deregister a session when it transitions out of active. */
function deregisterActive(operatorId, sessionId) {
    _deregister(operatorId, sessionId);
}

/**
 * Recover a stale session: detect orphaned heartbeat and transition to abandoned.
 * Returns the number of sessions recovered.
 */
function recoverStaleSessions() {
    const all      = session.list({ state: "active", limit: 20 });
    const cutoff   = Date.now() - STALE_MS;
    let   recovered = 0;

    for (const s of all) {
        const heartbeat = s.heartbeat || s.updatedAt;
        if (heartbeat < cutoff) {
            session.transition(s.id, "abandoned", "stale_heartbeat");
            // Deregister from all operator maps
            for (const [opId, set] of _activeMap) {
                if (set.has(s.id)) { set.delete(s.id); }
            }
            logger.warn(`[SessionHarden] stale session abandoned: ${s.id} (last heartbeat ${Math.round((Date.now() - heartbeat) / 60_000)}min ago)`);
            recovered++;
        }
    }
    return recovered;
}

/**
 * Multi-window safety check: is this operator already running a session in another window?
 * @param {string} operatorId
 * @returns {{ hasActive: boolean, activeSessions: string[] }}
 */
function checkMultiWindow(operatorId) {
    const active = _activeMap.get(operatorId);
    if (!active || active.size === 0) return { hasActive: false, activeSessions: [] };
    // Filter out sessions that are no longer actually active
    const stillActive = [...active].filter(id => {
        const s = session.get(id);
        return s && s.state === "active";
    });
    // Sync the map
    _activeMap.set(operatorId, new Set(stillActive));
    return { hasActive: stillActive.length > 0, activeSessions: stillActive };
}

/**
 * Reconnect continuity: find the most recent recoverable session for an operator.
 * Returns the session if it was active recently (< STALE_MS), null otherwise.
 * @param {string} operatorId
 * @returns {object|null}
 */
function findRecoverableSession(operatorId) {
    const active = _activeMap.get(operatorId);
    if (!active || active.size === 0) return null;

    const candidates = [...active]
        .map(id => session.get(id))
        .filter(s => s && s.state === "active" && (s.heartbeat || s.updatedAt) > Date.now() - STALE_MS)
        .sort((a, b) => (b.heartbeat || b.updatedAt) - (a.heartbeat || a.updatedAt));

    return candidates[0] || null;
}

/** Diagnostics snapshot. */
function snapshot() {
    const ops = [];
    for (const [opId, set] of _activeMap) {
        ops.push({ operatorId: opId, activeCount: set.size, sessionIds: [...set] });
    }
    return { operators: ops, totalTracked: ops.reduce((n, o) => n + o.activeCount, 0) };
}

module.exports = { registerActive, deregisterActive, recoverStaleSessions, checkMultiWindow, findRecoverableSession, snapshot };
