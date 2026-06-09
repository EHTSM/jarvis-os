"use strict";
/**
 * Phase 588 — Advanced Terminal Supervision
 *
 * Long-running process supervision, streaming output stabilization,
 * process restart visibility, execution checkpoint recovery,
 * command-chain replay.
 *
 * Prevents: runaway terminal loops, stale process resurrection,
 *           hidden command execution.
 */

const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH     = path.join(__dirname, "../../data/terminal-supervisor.json");
const MAX_PROCESSES  = 50;
const RUNAWAY_MS     = 60 * 60 * 1000; // 1h

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { processes: [], checkpoints: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}

// ── Process registry ──────────────────────────────────────────────────────────

/**
 * Register a long-running process for supervision.
 */
function registerProcess(opts = {}) {
    const { name, cmd, pid = null, sessionId = null } = opts;
    if (!name || !cmd) return { ok: false, error: "name and cmd required" };

    const db   = _load();
    const proc = {
        id:          crypto.randomUUID(),
        name:        (name || "").slice(0, 100),
        cmd:         (cmd  || "").slice(0, 500),
        pid,
        sessionId,
        status:      "running",
        startedAt:   Date.now(),
        lastSeenAt:  Date.now(),
        restartCount:0,
        outputLines: [],
        stale:       false,
    };
    db.processes.unshift(proc);
    db.processes = db.processes.slice(0, MAX_PROCESSES);
    _save(db);
    return { ok: true, processId: proc.id, name };
}

/**
 * Update heartbeat for a supervised process.
 */
function heartbeat(processId, { outputLine = null } = {}) {
    const db  = _load();
    const idx = db.processes.findIndex(p => p.id === processId);
    if (idx === -1) return { ok: false, error: "process not found" };

    const proc       = db.processes[idx];
    proc.lastSeenAt  = Date.now();
    proc.stale       = false;

    if (outputLine) {
        proc.outputLines = [outputLine.slice(0, 200), ...(proc.outputLines || [])].slice(0, 50);
    }

    db.processes[idx] = proc;
    _save(db);
    return { ok: true };
}

/**
 * Mark a process as restarted.
 */
function recordRestart(processId, { newPid = null, reason = "" } = {}) {
    const db  = _load();
    const idx = db.processes.findIndex(p => p.id === processId);
    if (idx === -1) return { ok: false, error: "process not found" };

    const proc         = db.processes[idx];
    proc.restartCount  = (proc.restartCount || 0) + 1;
    proc.lastRestartAt = Date.now();
    proc.lastRestartReason = (reason || "").slice(0, 200);
    if (newPid) proc.pid = newPid;
    proc.status        = "running";
    db.processes[idx]  = proc;
    _save(db);

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.record("session", { label: `Process restarted: ${proc.name} (×${proc.restartCount})`, sessionId: proc.sessionId });

    return { ok: true, restartCount: proc.restartCount };
}

/**
 * Mark a process as stopped.
 */
function stopProcess(processId, { reason = "" } = {}) {
    const db  = _load();
    const idx = db.processes.findIndex(p => p.id === processId);
    if (idx === -1) return { ok: false, error: "process not found" };
    db.processes[idx].status    = "stopped";
    db.processes[idx].stoppedAt = Date.now();
    db.processes[idx].stopReason = (reason || "").slice(0, 200);
    _save(db);
    return { ok: true };
}

// ── Runaway detection ─────────────────────────────────────────────────────────

/**
 * Detect stale/runaway processes.
 * Stale: running but no heartbeat for >30min.
 * Runaway: running for >1h with >5 restarts.
 */
function detectRunaway() {
    const db   = _load();
    const now  = Date.now();
    const STALE_MS = 30 * 60 * 1000;

    const stale   = [];
    const runaway = [];

    for (const proc of db.processes) {
        if (proc.status !== "running") continue;
        const age       = now - (proc.startedAt || now);
        const heartbeat = now - (proc.lastSeenAt || now);
        if (heartbeat > STALE_MS) stale.push({ id: proc.id, name: proc.name, staleSec: Math.round(heartbeat / 1000) });
        if (age > RUNAWAY_MS && (proc.restartCount || 0) > 5) runaway.push({ id: proc.id, name: proc.name, ageMin: Math.round(age / 60000), restarts: proc.restartCount });
    }

    return { stale, runaway, clean: stale.length === 0 && runaway.length === 0 };
}

// ── Output stabilization ──────────────────────────────────────────────────────

/**
 * Stabilize streaming output: deduplicate repeated lines, collapse noise.
 */
function stabilizeOutput(lines = []) {
    if (!Array.isArray(lines) || lines.length === 0) return { lines: [], collapsed: 0 };

    const seen      = new Map();
    const result    = [];
    let collapsed   = 0;

    for (const line of lines) {
        const key = line.trim().slice(0, 80);
        const cnt = (seen.get(key) || 0) + 1;
        seen.set(key, cnt);

        if (cnt === 1) {
            result.push(line);
        } else if (cnt === 3) {
            result.push(`... [line repeated ${cnt} times, suppressing further]`);
            collapsed++;
        } else if (cnt > 3) {
            collapsed++;
        } else {
            result.push(line);
        }
    }

    return { lines: result, original: lines.length, collapsed };
}

// ── Checkpoints ───────────────────────────────────────────────────────────────

function saveCheckpoint(sessionId, step, context = {}) {
    const db = _load();
    const existing = db.checkpoints.findIndex(c => c.sessionId === sessionId);
    const record   = { sessionId, step, context, savedAt: Date.now() };
    if (existing >= 0) db.checkpoints[existing] = record;
    else db.checkpoints.unshift(record);
    db.checkpoints = db.checkpoints.slice(0, 100);
    _save(db);
    return { ok: true, sessionId, step };
}

function loadCheckpoint(sessionId) {
    const db = _load();
    return db.checkpoints.find(c => c.sessionId === sessionId) || null;
}

// ── Command-chain replay ──────────────────────────────────────────────────────

const _replayLog = new Map(); // replayId -> [steps]

/**
 * Record a command step for replay capability.
 */
function recordReplayStep(replayId, cmd, result) {
    if (!replayId) return;
    if (!_replayLog.has(replayId)) _replayLog.set(replayId, []);
    const steps = _replayLog.get(replayId);
    steps.push({ cmd: (cmd || "").slice(0, 200), result, ts: Date.now() });
    _replayLog.set(replayId, steps.slice(0, 50));
}

function getReplayLog(replayId) {
    return _replayLog.get(replayId) || [];
}

// ── Process list ──────────────────────────────────────────────────────────────

function listProcesses({ status = null, sessionId = null } = {}) {
    const db = _load();
    return db.processes
        .filter(p => (!status || p.status === status) && (!sessionId || p.sessionId === sessionId))
        .map(p => ({ ...p, outputLines: undefined }));
}

function getProcess(processId) {
    const db = _load();
    return db.processes.find(p => p.id === processId) || null;
}

module.exports = { registerProcess, heartbeat, recordRestart, stopProcess, detectRunaway, stabilizeOutput, saveCheckpoint, loadCheckpoint, recordReplayStep, getReplayLog, listProcesses, getProcess };
