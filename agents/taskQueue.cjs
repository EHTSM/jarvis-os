"use strict";
/**
 * Persistent task queue — disk-backed, survives restarts.
 * States: pending → running → completed | failed
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const logger = require("../backend/utils/logger");

const QUEUE_FILE = path.join(__dirname, "../data/task-queue.json");
let _counter = Date.now();
let _lastPulse = Date.now(); // Internal heartbeat

// ── SQLite Shadow-Write Layer ─────────────────────────────────────────────
// Passive mirror. If SQLite fails, runtime continues with JSON authoritative.
function _shadowUpsert(task) {
    try {
        const { getDB } = require("../backend/db/sqlite.cjs");
        const db = getDB();
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO tasks (
                id, input, type, status, retries, max_retries, retry_delay,
                scheduled_for, recurring_cron, created_at, started_at, completed_at,
                last_error, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            task.id, task.input, task.type, task.status, task.retries || 0,
            task.maxRetries || 3, task.retryDelay || 15000,
            task.scheduledFor, task.recurringCron, task.createdAt,
            task.startedAt, task.completedAt, task.lastError,
            JSON.stringify(task.metadata || {})
        );
    } catch (err) {
        // FAIL-SAFE: Shadow failure must never crash the main task loop.
        logger.warn(`[SQLite Shadow] Upsert failed for ${task.id}: ${err.message}`);
    }
}

function _shadowDelete(id) {
    try {
        const { getDB } = require("../backend/db/sqlite.cjs");
        const db = getDB();
        db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    } catch (err) {
        logger.warn(`[SQLite Shadow] Delete failed for ${id}: ${err.message}`);
    }
}
// ──────────────────────────────────────────────────────────────────────────


// Read-through cache keyed on the file's mtime — _load() is called from 10
// sites in this file plus getAll()/getQueue() are called directly from
// dozens of read-only sites across the runtime (missionOrchestrator's
// 3-second stage-monitor poll loop chief among them: every actively-
// monitored mission stage re-reads and re-parses the entire queue file on
// every single poll tick). mtime is updated by every _save() call (via
// renameSync, which always produces a fresh mtime) regardless of which
// process wrote it, so a stale cached read across processes is not
// possible — any real write anywhere invalidates it. Same pattern already
// verified correct in missionMemory.cjs's _loadMissions().
let _queueCache = null; // { mtimeMs, tasks }

function _load() {
    let mtimeMs;
    try { mtimeMs = fs.statSync(QUEUE_FILE).mtimeMs; }
    catch { mtimeMs = null; } // file doesn't exist yet — fall through to the reset path below

    if (mtimeMs !== null && _queueCache && _queueCache.mtimeMs === mtimeMs) {
        return _queueCache.tasks;
    }

    try {
        const raw = fs.readFileSync(QUEUE_FILE, "utf8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        if (mtimeMs !== null) _queueCache = { mtimeMs, tasks: parsed };
        return parsed;
    } catch (err) {
        // Corrupt file mid-session — back up and reset so the queue stays alive
        try {
            const backup = QUEUE_FILE + ".bak." + Date.now();
            fs.copyFileSync(QUEUE_FILE, backup);
            fs.writeFileSync(QUEUE_FILE, "[]");
            logger.warn(`[TaskQueue] queue file corrupt — reset to [] (backup: ${backup})`);
        } catch { /* disk error — nothing to do */ }
        return [];
    }
}

// Final Production Integration mission, Blocker #6 fix — same real
// cross-process tmp-path collision as missionMemory.cjs's _saveMissions,
// reproduced during stress testing: a live server process and a second
// process writing task-queue.json around the same time could each target
// the identical literal ".tmp" path, and the first rename() would consume
// it before the second call's renameSync ran, producing a genuine ENOENT.
// Per-call-unique tmp filename (pid + random suffix, same pattern already
// used by organizationService.cjs/secretVault.cjs/missionMemory.cjs this
// session) eliminates that specific crash/corruption class.
function _save(tasks) {
    const dir = path.dirname(QUEUE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${QUEUE_FILE}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2));
    fs.renameSync(tmp, QUEUE_FILE);  // atomic on POSIX — prevents partial-write corruption
}

/**
 * Add a new task to the queue.
 * @param {object} opts
 * @param {string}  opts.input          - natural-language command to execute
 * @param {string}  [opts.type]         - hint label (terminal/dev/research/browser)
 * @param {string}  [opts.scheduledFor] - ISO timestamp (defaults to now)
 * @param {string}  [opts.recurringCron]- cron pattern for recurring tasks
 * @param {number}  [opts.maxRetries]   - default 3
 * @param {number}  [opts.retryDelay]   - ms between retries, default 15000
 */
function addTask({ input, type = "auto", scheduledFor, recurringCron, maxRetries = 3, retryDelay = 15000 }) {
    const tasks = _load();
    const task = {
        id:            `tq_${++_counter}`,
        input,
        type,
        status:        "pending",
        retries:       0,
        maxRetries,
        retryDelay,
        scheduledFor:  scheduledFor || new Date().toISOString(),
        recurringCron: recurringCron || null,
        createdAt:     new Date().toISOString(),
        startedAt:     null,
        completedAt:   null,
        lastError:     null,
        executionLog:  []
    };
    tasks.push(task);
    _save(tasks);
    _shadowUpsert(task); // Passive mirror
    if (process.env.DEBUG === "1") {
  const logger = require("../backend/utils/logger");
  logger.debug(`[TaskQueue] added ${task.id} type="${task.type}" scheduledFor=${task.scheduledFor}`);
}
    try {
        require("./runtime/runtimeEventBus.cjs").emit("task:added", {
            id: task.id, input: task.input.slice(0, 80), type: task.type,
            status: task.status, createdAt: task.createdAt
        });
    } catch { /* non-critical */ }
    return task;
}

/** Return all tasks whose scheduledFor is now or in the past and status=pending. */
function getDuePending() {
    _lastPulse = Date.now();
    const now = Date.now();
    return _load().filter(t =>
        t.status === "pending" &&
        new Date(t.scheduledFor).getTime() <= now
    );
}

/** Update fields on a task by id. Persists immediately. */
function update(id, fields) {
    const tasks = _load();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    Object.assign(tasks[idx], fields);
    _save(tasks);
    const t = tasks[idx];
    _shadowUpsert(t); // Passive mirror
    try {
        require("./runtime/runtimeEventBus.cjs").emit("task:updated", {
            id: t.id, status: t.status, type: t.type,
            input: (t.input || "").slice(0, 80)
        });
    } catch { /* non-critical */ }
    return t;
}

/** Return all tasks (full history). */
function getAll() { return _load(); }

/** On startup: reset "running" tasks back to "pending" (crash recovery). */
function recoverStale() {
    const tasks = _load();
    let changed = 0;
    for (const t of tasks) {
        if (t.status === "running") {
            t.status = "pending";
            t.executionLog.push({ ts: new Date().toISOString(), event: "recovered — was running on crash" });
            _shadowUpsert(t); // Mirror recovery state
            changed++;
        }
    }
    if (changed > 0) {
        _save(tasks);
        console.log(`[TaskQueue] recovered ${changed} stale running task(s) → pending`);
    }

    // Re-mirror any task whose SQLite row disagrees with the JSON authority.
    //
    // Phase B.6: _save() (JSON, authoritative) and _shadowUpsert() (SQLite
    // mirror) are two separate writes, not one transaction. A crash in the
    // window between them leaves the mirror permanently behind — reproduced
    // deterministically, and observed for real on 10 tasks after the Phase B.5
    // crash drills (JSON=completed while SQLite still said pending/running).
    // Nothing repaired it: the loop above only re-mirrors tasks that are
    // "running" in JSON, so a completed/pending disagreement was never
    // revisited and survived every subsequent boot.
    //
    // This reconciles on the existing startup path using the existing
    // _shadowUpsert — no new storage, no schema change, and JSON stays the
    // single source of truth (the mirror is corrected toward JSON, never the
    // reverse). Tasks present in SQLite but absent from JSON are left alone:
    // pruneOldTasks() intentionally trims JSON to the last 50 terminal tasks
    // while the mirror retains history, so that difference is by design.
    try {
        const { getDB } = require("../backend/db/sqlite.cjs");
        const rows = getDB().prepare("SELECT id, status FROM tasks").all();
        const mirrored = new Map(rows.map(r => [r.id, r.status]));
        let resynced = 0;
        for (const t of tasks) {
            const m = mirrored.get(t.id);
            if (m !== undefined && m !== t.status) {
                _shadowUpsert(t);
                resynced++;
            }
        }
        if (resynced > 0) {
            console.log(`[TaskQueue] re-mirrored ${resynced} task(s) whose SQLite status had drifted from JSON`);
        }
    } catch (err) {
        // FAIL-SAFE: the mirror is non-authoritative — never block startup on it.
        try { require("../backend/utils/logger").warn(`[TaskQueue] mirror reconcile skipped: ${err.message}`); } catch { /* ignore */ }
    }
}

/**
 * Prune old terminal tasks to keep disk file bounded.
 * Keeps all pending/running tasks, all recurring tasks, and the most recent
 * `keepCompleted` completed/failed/cancelled tasks.
 */
function pruneOldTasks(keepCompleted = 50) {
    const tasks = _load();
    const active    = tasks.filter(t => t.status === "pending" || t.status === "running");
    const recurring = tasks.filter(t => t.recurringCron && t.status !== "cancelled");
    const terminal  = tasks
        .filter(t => !t.recurringCron && t.status !== "pending" && t.status !== "running")
        .sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt))
        .slice(0, keepCompleted);

    const kept = [...new Map([...active, ...recurring, ...terminal].map(t => [t.id, t])).values()];
    const pruned = tasks.length - kept.length;
    if (pruned > 0) {
        // Sync SQLite pruning
        const keptIds = new Set(kept.map(k => k.id));
        tasks.forEach(t => {
            if (!keptIds.has(t.id)) _shadowDelete(t.id);
        });

        _save(kept);
        console.log(`[TaskQueue] pruned ${pruned} old completed/failed task(s) — ${kept.length} remain`);
    }
    return pruned;
}

/**
 * Abandon tasks that have been "pending" longer than maxAgeHours.
 * Guards against queue rot when the executor silently can't handle a task type.
 * Returns count of tasks abandoned.
 */
function abandonStuckTasks(maxAgeHours = 2) {
    const tasks   = _load();
    const cutoff  = Date.now() - maxAgeHours * 3_600_000;
    let   changed = 0;
    for (const t of tasks) {
        if (t.status !== "pending") continue;
        if (new Date(t.scheduledFor || t.createdAt).getTime() > cutoff) continue;
        // Never abandon recurring tasks — they reschedule far into the future by design
        if (t.recurringCron) continue;
        t.status    = "failed";
        t.lastError = `Abandoned — stuck in pending for >${maxAgeHours}h`;
        t.completedAt = new Date().toISOString();
        t.executionLog = [...(t.executionLog || []), {
            ts: new Date().toISOString(),
            event: "abandoned",
            reason: `Pending >${maxAgeHours}h without execution`
        }];
        _shadowUpsert(t); // Mirror abandonment
        changed++;
    }
    if (changed > 0) {
        _save(tasks);
        console.log(`[TaskQueue] abandoned ${changed} stuck task(s) older than ${maxAgeHours}h`);
    }
    return changed;
}

/**
 * Hard-delete a task by id (for permanent removal, not just cancel).
 */
function deleteTask(id) {
    const tasks = _load();
    const before = tasks.length;
    const kept   = tasks.filter(t => t.id !== id);
    if (kept.length < before) { 
        _save(kept); 
        _shadowDelete(id); // Mirror deletion
        return true; 
    }
    return false;
}

/**
 * Return a queue health snapshot: counts by status, oldest-pending age, failure rate.
 */
function getHealthReport() {
    const tasks = _load();
    const now   = Date.now();
    const counts = { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    let   oldestPendingMs = 0;
    let   failedLast24h  = 0;

    // Wait-time and exec-time accumulators per type
    // waitMs = startedAt - scheduledFor (time in queue before execution)
    // execMs = completedAt - startedAt  (actual execution duration)
    const _typeWait = {};   // type → { count, totalMs }
    const _typeExec = {};   // type → { count, totalMs }

    for (const t of tasks) {
        counts[t.status] = (counts[t.status] || 0) + 1;
        if (t.status === "pending") {
            const age = now - new Date(t.scheduledFor || t.createdAt).getTime();
            if (age > oldestPendingMs) oldestPendingMs = age;
        }
        if (t.status === "failed" && t.completedAt) {
            if ((now - new Date(t.completedAt).getTime()) < 86_400_000) failedLast24h++;
        }

        const type = t.type || "auto";
        if (t.startedAt && (t.scheduledFor || t.createdAt)) {
            const waitMs = new Date(t.startedAt).getTime() - new Date(t.scheduledFor || t.createdAt).getTime();
            if (waitMs >= 0) {
                if (!_typeWait[type]) _typeWait[type] = { count: 0, totalMs: 0 };
                _typeWait[type].count++;
                _typeWait[type].totalMs += waitMs;
            }
        }
        if (t.startedAt && t.completedAt) {
            const execMs = new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime();
            if (execMs >= 0) {
                if (!_typeExec[type]) _typeExec[type] = { count: 0, totalMs: 0 };
                _typeExec[type].count++;
                _typeExec[type].totalMs += execMs;
            }
        }
    }

    const timing = Object.keys({ ..._typeWait, ..._typeExec }).map(type => ({
        type,
        avg_wait_ms: _typeWait[type]
            ? Math.round(_typeWait[type].totalMs / _typeWait[type].count) : null,
        avg_exec_ms: _typeExec[type]
            ? Math.round(_typeExec[type].totalMs / _typeExec[type].count) : null
    }));

    const total = tasks.length || 1;
    return {
        counts,
        total:             tasks.length,
        oldestPendingMins: Math.round(oldestPendingMs / 60_000),
        failedLast24h,
        failureRate:       Math.round(((counts.failed || 0) / total) * 100),
        healthy:           (counts.pending || 0) <= 20 && oldestPendingMs < 3_600_000,
        timing
    };
}

module.exports = {
    addTask, getDuePending, update, getAll,
    recoverStale, pruneOldTasks,
    abandonStuckTasks, deleteTask, getHealthReport
};
