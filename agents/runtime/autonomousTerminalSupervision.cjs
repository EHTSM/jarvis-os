"use strict";
/**
 * Phase 634 — Autonomous Terminal Supervision
 *
 * Autonomous command supervision with validation checkpoints, process health
 * verification, recovery-aware chains, restart coordination.
 * PREVENTS: runaway shell, hidden process resurrection, unsafe retries.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH       = path.join(__dirname, "../../data/autonomous-terminal-supervision.json");
const MAX_SUPERVISED   = 50;
const SUP_TTL          = 24 * 60 * 60 * 1000;
const MAX_AUTO_RETRIES = 2;
const STALE_MS         = 30 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { processes: [], checkpoints: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - SUP_TTL;
    db.processes  = (db.processes || []).filter(p => p.registeredAt > cutoff).slice(0, MAX_SUPERVISED);
    db.checkpoints = (db.checkpoints || []).slice(-200);
}

// ── Process registration ──────────────────────────────────────────────────────

function registerProcess(opts = {}) {
    const { name = "", pid = null, command = "", sessionId = null } = opts;
    if (!name) return { ok: false, error: "name required" };

    const db  = _load(); _prune(db);
    const pid_ = pid || `auto-${Date.now()}`;

    const existing = db.processes.findIndex(p => p.name === name && p.status === "running");
    if (existing >= 0) {
        db.processes[existing].lastHeartbeat = Date.now();
        _save(db);
        return { ok: true, processId: db.processes[existing].id, existing: true };
    }

    const processId = crypto.randomUUID();
    db.processes.unshift({
        id:           processId,
        name,
        pid:          pid_,
        command:      (command || "").slice(0, 200),
        sessionId,
        status:       "running",
        restartCount: 0,
        autoRetries:  0,
        lastHeartbeat: Date.now(),
        registeredAt: Date.now(),
        stale:        false,
    });
    _save(db);
    return { ok: true, processId, name };
}

function heartbeat(processId, { outputLine = "" } = {}) {
    const db  = _load();
    const idx = db.processes.findIndex(p => p.id === processId);
    if (idx === -1) return { ok: false };

    db.processes[idx].lastHeartbeat = Date.now();
    db.processes[idx].stale         = false;

    if (outputLine) {
        db.checkpoints.push({ processId, line: (outputLine || "").slice(0, 200), ts: Date.now() });
        db.checkpoints = db.checkpoints.slice(-200);
    }
    _save(db);
    return { ok: true };
}

// ── Validation checkpoint ─────────────────────────────────────────────────────

function saveValidationCheckpoint(processId, { label = "", passed = true, detail = "" } = {}) {
    const db = _load();
    db.checkpoints.push({
        processId,
        type:   "validation",
        label:  (label || "").slice(0, 100),
        passed,
        detail: (detail || "").slice(0, 200),
        ts:     Date.now(),
    });
    db.checkpoints = db.checkpoints.slice(-200);
    _save(db);
    return { ok: true, processId, label, passed };
}

function getValidationHistory(processId, { limit = 10 } = {}) {
    const db = _load();
    return (db.checkpoints || [])
        .filter(c => c.processId === processId && c.type === "validation")
        .slice(-limit)
        .reverse();
}

// ── Health verification ───────────────────────────────────────────────────────

function verifyProcessHealth(processId) {
    const db = _load();
    const p  = db.processes.find(x => x.id === processId);
    if (!p) return { ok: false, error: "process not found" };

    const staleMsAgo   = Date.now() - p.lastHeartbeat;
    const isStale      = staleMsAgo > STALE_MS;
    const isRunaway    = p.restartCount > 5 && staleMsAgo < STALE_MS;
    const recentChecks = (db.checkpoints || []).filter(c => c.processId === processId && c.type === "validation" && Date.now() - c.ts < 60 * 60 * 1000);
    const checksPassed = recentChecks.filter(c => c.passed).length;

    return {
        ok:          !isStale && !isRunaway,
        processId,
        name:        p.name,
        status:      p.status,
        stale:       isStale,
        runaway:     isRunaway,
        restartCount: p.restartCount,
        autoRetries: p.autoRetries,
        recentChecksPassed: `${checksPassed}/${recentChecks.length}`,
        lastHeartbeat: p.lastHeartbeat,
    };
}

// ── Recovery-aware restart ────────────────────────────────────────────────────

function requestRestart(processId, { approved = false, reason = "" } = {}) {
    if (!approved) return { ok: false, error: "Restart requires operator approval" };

    const db  = _load(); _prune(db);
    const idx = db.processes.findIndex(p => p.id === processId);
    if (idx === -1) return { ok: false, error: "process not found" };

    const p = db.processes[idx];
    if (p.restartCount >= 5) {
        return { ok: false, error: `Process '${p.name}' has restarted ${p.restartCount} times — manual investigation required` };
    }

    p.restartCount++;
    p.lastHeartbeat = Date.now();
    p.stale         = false;
    p.lastRestartAt = Date.now();
    p.lastRestartReason = (reason || "").slice(0, 200);
    db.processes[idx] = p;
    _save(db);

    return { ok: true, processId, name: p.name, restartCount: p.restartCount };
}

function autoRetry(processId) {
    const db  = _load(); _prune(db);
    const idx = db.processes.findIndex(p => p.id === processId);
    if (idx === -1) return { ok: false, error: "process not found" };

    const p = db.processes[idx];
    if (p.autoRetries >= MAX_AUTO_RETRIES) {
        return { ok: false, error: `Auto-retry limit (${MAX_AUTO_RETRIES}) reached for '${p.name}' — requires approval` };
    }

    p.autoRetries++;
    db.processes[idx] = p;
    _save(db);

    return { ok: true, processId, autoRetries: p.autoRetries, limit: MAX_AUTO_RETRIES };
}

// ── Stale detection ───────────────────────────────────────────────────────────

function detectStale() {
    const db    = _load(); _prune(db);
    const stale = db.processes.filter(p => p.status === "running" && Date.now() - p.lastHeartbeat > STALE_MS);
    const runaway = db.processes.filter(p => p.restartCount > 5);

    // Mark stale
    stale.forEach(p => {
        const idx = db.processes.findIndex(x => x.id === p.id);
        if (idx >= 0) db.processes[idx].stale = true;
    });
    if (stale.length > 0) _save(db);

    return { staleCount: stale.length, runawayCount: runaway.length, stale: stale.map(p => ({ id: p.id, name: p.name, staleMins: Math.round((Date.now() - p.lastHeartbeat) / 60000) })) };
}

function stopProcess(processId) {
    const db  = _load(); _prune(db);
    const idx = db.processes.findIndex(p => p.id === processId);
    if (idx === -1) return { ok: false };

    db.processes[idx].status   = "stopped";
    db.processes[idx].stoppedAt = Date.now();
    _save(db);
    return { ok: true, processId };
}

function listProcesses({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.processes
        .filter(p => !status || p.status === status)
        .slice(0, limit)
        .map(p => ({ id: p.id, name: p.name, status: p.status, stale: p.stale, restartCount: p.restartCount, registeredAt: p.registeredAt }));
}

module.exports = { registerProcess, heartbeat, saveValidationCheckpoint, getValidationHistory, verifyProcessHealth, requestRestart, autoRetry, detectStale, stopProcess, listProcesses };
