"use strict";
/**
 * Phase 430 — Engineering Context Snapshots
 *
 * Persists the full engineering state for reconnect continuity and session restoration.
 * Captures: active session, runtime conditions, adapter map, workflow chains,
 *           validation state, recovery context.
 *
 * File: data/context-snapshot.json — single file, overwritten on each capture.
 * Lightweight — meant to be read on reconnect to restore operator context.
 */

const fs   = require("fs");
const path = require("path");

const SNAPSHOT_PATH = path.join(__dirname, "../../data/context-snapshot.json");
const SNAPSHOT_TTL  = 4 * 60 * 60_000; // 4h — snapshots older than this are stale on read

function _tryRequire(p) { try { return require(p); } catch { return null; } }

/**
 * Capture and persist the full engineering context snapshot.
 * @param {string|null} sessionId — current active session, if any
 * @returns {object} the snapshot written
 */
function capture(sessionId = null) {
    const snap = { ts: Date.now(), sessionId };

    // Active session
    try {
        const sm = _tryRequire("./engineeringSession.cjs");
        if (sm && sessionId) snap.session = sm.summary(sessionId);
        snap.allSessions = sm ? sm.list({ limit: 5 }) : [];
    } catch {}

    // Runtime conditions
    try {
        const pm  = _tryRequire("./runtimePressureMonitor.cjs");
        snap.pressure = pm ? pm.snapshot() : null;
    } catch {}

    // Adapter map
    try {
        const tsm = _tryRequire("./toolStateMonitor.cjs");
        snap.adapters = tsm ? { states: tsm.query(), problems: tsm.detectProblems() } : null;
    } catch {}

    // Recovery context from adapterContextBridge
    try {
        const bridge = _tryRequire("./adapterContextBridge.cjs");
        snap.recoveryContext = (bridge && sessionId) ? bridge.snapshot(sessionId) : null;
    } catch {}

    // Last known goal
    try {
        const gt = _tryRequire("./operationalGoalTracker.cjs");
        snap.goal = (gt && sessionId) ? gt.evaluateGoal(sessionId) : null;
    } catch {}

    // Health matrix
    try {
        const hm = _tryRequire("./operationalHealthMatrix.cjs");
        snap.health = hm ? hm.compute() : null;
    } catch {}

    // Memory
    const m = process.memoryUsage();
    snap.process = { heapMb: Math.round(m.heapUsed / 1_048_576), uptime: Math.round(process.uptime()) };

    // Write
    try {
        const dir = path.dirname(SNAPSHOT_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2));
    } catch {}

    return snap;
}

/**
 * Load the most recent snapshot.
 * Returns null if snapshot is missing, corrupt, or older than TTL.
 */
function load() {
    try {
        const raw  = fs.readFileSync(SNAPSHOT_PATH, "utf8");
        const snap = JSON.parse(raw);
        if (!snap.ts || Date.now() - snap.ts > SNAPSHOT_TTL) return null; // stale
        return snap;
    } catch { return null; }
}

/**
 * Check if a valid (non-stale) snapshot exists.
 * @returns {{ exists: boolean, ageMs: number|null, sessionId: string|null }}
 */
function status() {
    try {
        const raw  = fs.readFileSync(SNAPSHOT_PATH, "utf8");
        const snap = JSON.parse(raw);
        const ageMs = Date.now() - (snap.ts || 0);
        return { exists: true, ageMs, stale: ageMs > SNAPSHOT_TTL, sessionId: snap.sessionId || null };
    } catch { return { exists: false, ageMs: null, stale: true, sessionId: null }; }
}

/** Delete the snapshot (called when session is abandoned). */
function clear() {
    try { fs.unlinkSync(SNAPSHOT_PATH); return true; } catch { return false; }
}

module.exports = { capture, load, status, clear };
