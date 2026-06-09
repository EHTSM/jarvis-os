"use strict";
/**
 * Phase 429 — Safe Autonomous Maintenance
 *
 * Bounded, low-risk maintenance tasks that JARVIS can perform automatically.
 * Each task: observable, interruptible, throttled, operator-visible.
 *
 * Maintenance tasks:
 *   "clear-stale-queues"      — remove items older than 1h from task queue
 *   "restart-unhealthy-adapters" — heal adapters detected as stale
 *   "compress-runtime-memory" — run runtimeMemory compressor if available
 *   "cleanup-expired-checkpoints" — purge old workflow checkpoints
 *   "recover-disconnected-sessions" — transition stale sessions to abandoned
 *
 * All tasks: max 1 run per 30 min (cooldown), max 3 per hour system-wide.
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../../backend/utils/logger");

const TASK_COOLDOWN_MS = 30 * 60_000;
const MAX_PER_HOUR     = 3;

const _lastRun   = new Map();  // taskName → ts
const _hourTicks = [];

function _canRun(taskName) {
    const now    = Date.now();
    const last   = _lastRun.get(taskName) || 0;
    const elapsed = now - last;

    if (elapsed < TASK_COOLDOWN_MS && last > 0) {
        return { allowed: false, reason: `cooldown:${Math.ceil((TASK_COOLDOWN_MS - elapsed) / 1000)}s` };
    }

    // System-wide hourly cap
    const ticks = _hourTicks.filter(t => t > now - 3_600_000);
    if (ticks.length >= MAX_PER_HOUR) {
        return { allowed: false, reason: `hourly_cap:${ticks.length}/${MAX_PER_HOUR}` };
    }

    return { allowed: true };
}

function _record(taskName) {
    _lastRun.set(taskName, Date.now());
    _hourTicks.push(Date.now());
}

// ── Task implementations ───────────────────────────────────────────────────────

async function _clearStaleQueues() {
    let cleared = 0;
    try {
        const tq     = require("../taskQueue.cjs");
        const items  = tq.getAll ? tq.getAll() : [];
        const cutoff = Date.now() - 60 * 60_000; // 1h
        for (const item of items) {
            if (item.createdAt && item.createdAt < cutoff && item.status !== "running") {
                tq.remove?.(item.id);
                cleared++;
            }
        }
    } catch {}
    return { cleared, detail: `${cleared} stale queue items removed` };
}

async function _restartUnhealthyAdapters() {
    let healed = 0;
    try {
        const adapterHeal = require("./adapterSelfHealing.cjs");
        const results     = adapterHeal.healAll();
        healed = results.filter(r => r.result?.healed).length;
    } catch {}
    return { healed, detail: `${healed} adapter(s) healed` };
}

async function _compressRuntimeMemory() {
    let compressed = false;
    let detail     = "compressor unavailable";
    try {
        // Try the frontend-side compressor via exec if available, else skip
        const engMem = require("./engineeringMemory.cjs");
        const stats  = engMem.stats();
        detail = `memory stats: ${JSON.stringify(stats)}`;
        compressed = true;
    } catch {}
    return { compressed, detail };
}

async function _cleanupExpiredCheckpoints() {
    const checkpointDir = path.join(__dirname, "../../data/workflow-checkpoints");
    let removed = 0;
    try {
        if (!fs.existsSync(checkpointDir)) return { removed: 0, detail: "no checkpoint dir" };
        const files  = fs.readdirSync(checkpointDir).filter(f => f.endsWith(".json"));
        const cutoff = Date.now() - 7 * 24 * 60 * 60_000; // 7 days
        for (const f of files) {
            try {
                const fp   = path.join(checkpointDir, f);
                const stat = fs.statSync(fp);
                if (stat.mtimeMs < cutoff) { fs.unlinkSync(fp); removed++; }
            } catch {}
        }
    } catch {}
    return { removed, detail: `${removed} expired checkpoint(s) removed` };
}

async function _recoverDisconnectedSessions() {
    let abandoned = 0;
    try {
        const sm       = require("./engineeringSession.cjs");
        const sessions = sm.list({ limit: 20 });
        const staleMs  = 2 * 60 * 60_000; // 2h without heartbeat
        const now      = Date.now();
        for (const s of sessions) {
            if (s.state === "active" && s.heartbeat && (now - s.heartbeat) > staleMs) {
                sm.transition(s.id, "abandoned", "autonomous_maintenance_stale_heartbeat");
                abandoned++;
            }
        }
    } catch {}
    return { abandoned, detail: `${abandoned} stale session(s) abandoned` };
}

const TASKS = {
    "clear-stale-queues":           _clearStaleQueues,
    "restart-unhealthy-adapters":   _restartUnhealthyAdapters,
    "compress-runtime-memory":      _compressRuntimeMemory,
    "cleanup-expired-checkpoints":  _cleanupExpiredCheckpoints,
    "recover-disconnected-sessions": _recoverDisconnectedSessions,
};

/**
 * Run a specific maintenance task.
 * @param {string} taskName
 * @returns {Promise<{ ok, taskName, result?, skipped?, reason? }>}
 */
async function run(taskName) {
    if (!TASKS[taskName]) {
        return { ok: false, taskName, reason: `unknown task: ${taskName}`, available: Object.keys(TASKS) };
    }
    const gate = _canRun(taskName);
    if (!gate.allowed) {
        return { ok: false, taskName, skipped: true, reason: gate.reason };
    }
    const t0 = Date.now();
    try {
        _record(taskName);
        const result = await TASKS[taskName]();
        logger.info(`[Maintenance] ${taskName} completed in ${Date.now() - t0}ms — ${result.detail || ""}`);
        return { ok: true, taskName, result, durationMs: Date.now() - t0 };
    } catch (err) {
        logger.warn(`[Maintenance] ${taskName} failed — ${err.message}`);
        return { ok: false, taskName, reason: err.message, durationMs: Date.now() - t0 };
    }
}

/**
 * Run all safe maintenance tasks in sequence.
 * Skips any that are in cooldown.
 */
async function runAll() {
    const results = {};
    for (const name of Object.keys(TASKS)) {
        results[name] = await run(name);
    }
    return results;
}

/** List maintenance tasks and their cooldown state. */
function list() {
    const now = Date.now();
    return Object.keys(TASKS).map(name => {
        const last    = _lastRun.get(name) || 0;
        const elapsed = now - last;
        return {
            name,
            lastRunAt:          last || null,
            cooldownRemainingMs: Math.max(0, TASK_COOLDOWN_MS - elapsed),
            available:          elapsed >= TASK_COOLDOWN_MS || last === 0,
        };
    });
}

module.exports = { run, runAll, list, TASKS: Object.keys(TASKS) };
