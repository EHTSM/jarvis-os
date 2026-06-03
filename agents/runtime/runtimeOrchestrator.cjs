"use strict";
/**
 * runtimeOrchestrator — main entry point for the runtime layer.
 *
 * Public API:
 *   dispatch(input, options)  — synchronous: plan + execute, return results
 *   queue(input, priority)    — async: enqueue for background drain
 *   drainQueue()              — pop one item from priorityQueue and execute it
 *   status()                  — live diagnostics snapshot
 *   registerAgent(config)     — register an agent at runtime
 *
 * The drainQueue() is called externally (e.g., by autonomousLoop) or
 * via the periodic drain interval started inside this module.
 */

const fs       = require("fs");
const path     = require("path");
const logger   = require("../../backend/utils/logger");
const registry = require("./agentRegistry.cjs");
const pq       = require("./priorityQueue.cjs");
const engine   = require("./executionEngine.cjs");
const history  = require("./executionHistory.cjs");
const memory   = require("./memoryContext.cjs");

// ── Crash snapshot — write per-dispatch, delete on clean completion ────
const SNAPSHOT_DIR = path.join(__dirname, "../../data/snapshots");
function _snapshotWrite(taskId, input) {
    try {
        if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
        fs.writeFileSync(
            path.join(SNAPSHOT_DIR, `${taskId}.json`),
            JSON.stringify({ taskId, input: input.slice(0, 200), startedAt: new Date().toISOString() })
        );
    } catch { /* non-fatal */ }
}
function _snapshotDelete(taskId) {
    try { fs.unlinkSync(path.join(SNAPSHOT_DIR, `${taskId}.json`)); } catch { /* already gone */ }
}
// On startup: log any orphaned snapshots from a previous crash
try {
    if (fs.existsSync(SNAPSHOT_DIR)) {
        const orphans = fs.readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith(".json"));
        if (orphans.length > 0) {
            logger.warn(`[Runtime] ${orphans.length} orphaned crash snapshot(s) detected — likely interrupted by a prior crash:`);
            for (const f of orphans) {
                try {
                    const snap = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), "utf8"));
                    logger.warn(`  - taskId=${snap.taskId} startedAt=${snap.startedAt} input="${snap.input}"`);
                    fs.unlinkSync(path.join(SNAPSHOT_DIR, f));
                } catch { /* ignore malformed */ }
            }
        }
    }
} catch { /* non-fatal */ }

// Lazy-load planner — avoids circular deps at require time
let _planner = null;
function _getPlanner() {
    if (!_planner) {
        try { _planner = require("../planner.cjs"); } catch { _planner = null; }
    }
    return _planner;
}

// ── Execution resource governor ──────────────────────────────────
// Hard caps on concurrent dispatches and per-minute quota.
// Separate from throttle (which is queue-pressure-based) — this is absolute.
const _governor = {
    MAX_CONCURRENT: 10,      // absolute max in-flight dispatches
    MAX_PER_MINUTE: 120,     // absolute max dispatches per minute (2/s burst ceiling)
    _active:        0,
    _minuteTicks:   [],

    acquire() {
        const now = Date.now();
        this._minuteTicks = this._minuteTicks.filter(t => now - t < 60_000);
        if (this._active >= this.MAX_CONCURRENT)
            return { ok: false, reason: "max_concurrent_reached", active: this._active };
        if (this._minuteTicks.length >= this.MAX_PER_MINUTE)
            return { ok: false, reason: "per_minute_quota_exceeded", rate: this._minuteTicks.length };
        // Memory pressure gate — reject new work when heap is critically high
        const heapMb = process.memoryUsage().heapUsed / 1_048_576;
        if (heapMb > 450)
            return { ok: false, reason: "memory_pressure", heapMb: Math.round(heapMb) };
        // Browser backpressure — reduce concurrency if browser adapter is degraded
        try {
            const ba = require("./adapters/browserExecutionAdapter.cjs");
            const bm = ba.getAdapterMetrics?.();
            if (bm && !bm.driverHealthy && this._active >= Math.floor(this.MAX_CONCURRENT / 2))
                return { ok: false, reason: "browser_backpressure", consecutiveErrors: bm.consecutiveErrors };
        } catch {}
        this._active++;
        this._minuteTicks.push(now);
        return { ok: true };
    },

    release() {
        if (this._active > 0) this._active--;
    },

    stats() {
        return { active: this._active, ratePerMin: this._minuteTicks.length,
                 maxConcurrent: this.MAX_CONCURRENT, maxPerMin: this.MAX_PER_MINUTE };
    },
};

// ── Adaptive throttle ─────────────────────────────────────────────
// Tracks dispatch rate and queue pressure. When pressure is high,
// new dispatches are rejected until the queue drains below threshold.
// Escalation: NORMAL → WARN → THROTTLE → BLOCK
const _throttle = {
    windowMs:       60_000,    // 1-minute sliding window
    maxPerWindow:   60,        // max dispatches before rate-capping
    _ticks:         [],        // timestamps of recent dispatches

    QUEUE_WARN:     10,        // queue depth → warn level
    QUEUE_THROTTLE: 25,        // queue depth → throttle drain to 10s interval
    QUEUE_BLOCK:    50,        // queue depth → block new sync dispatches

    level: "normal",           // "normal" | "warn" | "throttle" | "block"

    tick() {
        const now = Date.now();
        this._ticks = this._ticks.filter(t => now - t < this.windowMs);
        this._ticks.push(now);
        this._updateLevel();
    },

    _updateLevel() {
        const qSize     = pq.size();
        const rateOver  = this._ticks.length >= this.maxPerWindow;
        if (qSize >= this.QUEUE_BLOCK || (rateOver && qSize >= this.QUEUE_THROTTLE)) {
            this.level = "block";
        } else if (qSize >= this.QUEUE_THROTTLE || rateOver) {
            this.level = "throttle";
        } else if (qSize >= this.QUEUE_WARN) {
            this.level = "warn";
        } else {
            this.level = "normal";
        }
    },

    check() {
        this._updateLevel();
        return this.level;
    },

    rate() { return this._ticks.length; },
};

// ── Drain interval ────────────────────────────────────────────────
// Process queued background tasks every 5s normally, 10s when throttled.
let _drainRef    = null;
let _drainFast   = true;
function _ensureDrainLoop() {
    if (_drainRef) return;
    _drainRef = setInterval(async () => {
        const level = _throttle.check();
        // Slow drain when throttled to let queue pressure ease
        if (level === "throttle" && _drainFast) {
            _drainFast = false;
            clearInterval(_drainRef); _drainRef = null;
            _drainRef = setInterval(async () => {
                if (pq.size() > 0) await drainQueue();
                if (_throttle.check() === "normal") { _resetDrainFast(); }
            }, 10_000).unref();
            return;
        }
        if (pq.size() > 0) await drainQueue();
    }, 5_000).unref();
}

function _resetDrainFast() {
    if (_drainFast) return;
    _drainFast = true;
    clearInterval(_drainRef); _drainRef = null;
    _ensureDrainLoop();
}

// ── Planner wrapper ───────────────────────────────────────────────
function _plan(input) {
    const planner = _getPlanner();
    if (planner?.plannerAgent) {
        try { return planner.plannerAgent(input); } catch { /* fall through */ }
    }
    // Minimal fallback: single AI task
    return [{ type: "ai", label: input, payload: { query: input }, input }];
}

/**
 * Dispatch: plan the input, execute all sub-tasks, return aggregated result.
 * Blocks until all tasks complete (or fail with retries exhausted).
 *
 * @param {string} input   — user/system input
 * @param {object} options — { taskId, timeoutMs, retries, priority }
 * @returns {Promise<{ success, tasks, results, reply, durationMs }>}
 */
async function dispatch(input, options = {}) {
    // Quarantine mode check — soft block, no slots consumed
    try {
        const gov = require("./control/runtimeEmergencyGovernor.cjs");
        if (gov.isQuarantineActive?.() && !options._internal) {
            return { success: false, error: "quarantine_active", reason: "runtime in quarantine — new dispatches blocked" };
        }
    } catch {}

    // Resource governor — hard cap before throttle check
    const govCheck = _governor.acquire();
    if (!govCheck.ok && !options._internal) {
        logger.warn(`[Runtime] dispatch REJECTED by governor — ${govCheck.reason}`);
        return { success: false, error: govCheck.reason, ...govCheck };
    }

    // Adaptive throttle — queue-pressure-based rejection
    const throttleLevel = _throttle.check();
    if (throttleLevel === "block" && !options._internal) {
        if (govCheck.ok) _governor.release();
        logger.warn(`[Runtime] dispatch BLOCKED — queue=${pq.size()} rate=${_throttle.rate()}/min`);
        return { success: false, error: "runtime_overloaded", throttleLevel, queueSize: pq.size() };
    }
    _throttle.tick();
    try { require("./driftMonitor.cjs").recordExecStarted(); } catch {}

    const t0     = Date.now();
    const taskId = options.taskId || `disp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    let settled  = [];
    let tasks    = [];

    try {
        tasks       = _plan(input);
        const ctx   = memory.getContextForTask(input, tasks[0]?.type || "ai");

        logger.info(`[Runtime] dispatch — ${tasks.length} task(s) from input "${input.slice(0, 60)}"`);
        _snapshotWrite(taskId, input);

        for (const task of tasks) {
            try {
                logger.info(`[Runtime] executing task ${task.type} sequentially`);
                const result = await engine.executeTask(
                    { ...task, input },
                    { ...options, taskId, context: ctx }
                );
                settled.push(result);
            } catch (err) {
                settled.push({ success: false, error: err?.message || "unhandled_error", taskType: task.type });
            }
        }
    } finally {
        _snapshotDelete(taskId);
        _governor.release();
        try { require("./driftMonitor.cjs").recordExecFinished(); } catch {}
    }

    const allOk  = settled.every(r => r.success);
    const reply  = settled.map(r => r.result?.message || r.result?.result || r.error || "").filter(Boolean).join("\n").trim();
    const durationMs = Date.now() - t0;

    memory.recordExecution(input, tasks, settled, {
        agentId:     settled[0]?.agentId || "runtime",
        durationMs,
        success:     allOk,
    });

    logger.info(`[Runtime] dispatch done in ${durationMs}ms — success=${allOk}`);
    return { success: allOk, tasks, results: settled, reply, durationMs, taskId };
}

/**
 * Queue an input for background execution.
 * @param {string} input
 * @param {number} priority — use pq.PRIORITY.*
 * @returns {number} queue entry id
 */
function queue(input, priority = pq.PRIORITY.NORMAL) {
    const id = pq.enqueue({ input }, priority);
    _ensureDrainLoop();
    logger.info(`[Runtime] queued id=${id} priority=${priority} — "${input.slice(0, 60)}"`);
    return id;
}

/**
 * Drain one item from the priority queue and execute it.
 * Called by the internal drain loop and by external callers (autonomousLoop).
 */
async function drainQueue() {
    const entry = pq.dequeue();
    if (!entry) return null;
    logger.info(`[Runtime] draining queue id=${entry.id} waitMs=${Date.now() - entry.enqueuedAt}`);
    try {
        return await dispatch(entry.task.input);
    } catch (err) {
        logger.error(`[Runtime] drain error for id=${entry.id}: ${err.message}`);
        return null;
    }
}

/**
 * Register an agent with the registry.
 * Convenience wrapper so callers import only this module.
 */
function registerAgent(config) {
    return registry.register(config);
}

/**
 * Live diagnostics snapshot.
 * @returns {{ queue, agents, history, uptime }}
 */
function status() {
    const memUsage = process.memoryUsage();
    const histStats = history.stats();
    
    // Runaway detection: 5+ failures of same input in last 50 tasks
    const recent50 = history.recent(50);
    const failed   = recent50.filter(e => !e.success);
    const counts   = {};
    failed.forEach(e => { counts[e.input] = (counts[e.input] || 0) + 1; });
    const runaway  = Object.values(counts).some(v => v >= 5);

    return {
        queue:   { size: pq.size(), items: pq.snapshot() },
        agents:  registry.listAll(),
        history: histStats,
        uptime:  process.uptime(),
        runaway,
        throttle: {
            level:     _throttle.level,
            ratePerMin: _throttle.rate(),
            queueSize:  pq.size(),
        },
        governor: _governor.stats(),
        vitals: {
            memRSS: Math.round(memUsage.rss / 1024 / 1024),
            memHeap: Math.round(memUsage.heapUsed / 1024 / 1024),
            cpuLoad: process.cpuUsage().user / 1000000,
        }
    };
}

// ── Self-healing sweep ────────────────────────────────────────────
// Runs every 60s. Detects and recovers from common drift conditions.
const _healLog = [];
const MAX_HEAL_LOG = 50;

function _selfHeal() {
    const actions = [];
    try {
        // 1. Reconcile stale "running" tasks in taskQueue
        try {
            const tq = require("../../agents/taskQueue.cjs");
            const stale = tq.getAll().filter(t => t.status === "running");
            if (stale.length > 0) {
                stale.forEach(t => tq.fail ? tq.fail(t.id, "stale_running_recovered") : null);
                actions.push(`reconciled ${stale.length} stale running task(s)`);
            }
        } catch {}

        // 2. Check drift monitor exec active count vs actual queue size
        try {
            const dm = require("./driftMonitor.cjs");
            const rpt = dm.getDriftReport();
            if (rpt.execDrift > 20) {
                actions.push(`exec drift=${rpt.execDrift} — counters may be skewed`);
            }
        } catch {}

        // 3. Reduce throttle if queue has drained and level is still high
        const currentLevel = _throttle.check();
        if (currentLevel === "block" && pq.size() < _throttle.QUEUE_WARN) {
            _throttle._ticks = [];  // reset rate window — queue cleared
            _throttle._updateLevel();
            actions.push(`throttle reset: queue drained to ${pq.size()}`);
        }

        // 4. Prune oversized event times array (memory guard)
        if (_throttle._ticks.length > 500) {
            _throttle._ticks = _throttle._ticks.slice(-100);
            actions.push("pruned oversized throttle tick array");
        }

        // 5. Force-kill overdue orphan processes
        try {
            const plc = require("./adapters/processLifecycleAdapter.cjs");
            const killed = plc.forceKillOverdue();
            if (killed.length > 0) actions.push(`force-killed ${killed.length} orphan process(es)`);
        } catch {}

        // 6. Orphan queue detection — queue items with no corresponding history entry
        //    for > 5 minutes are likely stuck. Log them; don't auto-fail (operator decision).
        try {
            const tq  = require("../../agents/taskQueue.cjs");
            const pqs = pq.snapshot();
            const now = Date.now();
            const stuckQueue = pqs.filter(e => e.enqueuedAt && now - e.enqueuedAt > 5 * 60_000);
            if (stuckQueue.length > 0)
                actions.push(`${stuckQueue.length} queue item(s) waiting >5min`);
        } catch {}

        // 7. Duplicate execution detection — governor active count vs drift monitor active count
        try {
            const dm  = require("./driftMonitor.cjs");
            const rpt = dm.getDriftReport();
            const govActive = _governor._active;
            if (Math.abs(rpt.execActive - govActive) > 5)
                actions.push(`exec count mismatch: governor=${govActive} drift=${rpt.execActive}`);
        } catch {}

        // 8. Governor active count can't exceed MAX_CONCURRENT — reset if corrupted
        if (_governor._active > _governor.MAX_CONCURRENT * 2) {
            _governor._active = 0;
            actions.push("governor active count reset (was above ceiling)");
        }

        if (actions.length > 0) {
            const entry = { ts: new Date().toISOString(), actions };
            _healLog.push(entry);
            if (_healLog.length > MAX_HEAL_LOG) _healLog.shift();
            logger.info(`[Runtime:Heal] ${actions.join("; ")}`);
        }
    } catch (err) {
        logger.warn(`[Runtime:Heal] sweep error: ${err.message}`);
    }
}

setInterval(_selfHeal, 60_000).unref();

// ── Phase 112: Long-session background cleanup (every 12h) ───────────────────
// Prunes oversized history, cleans orphaned snapshots older than 1h,
// resets drift counters to prevent counter overflow in ultra-long sessions.
const TWELVE_HOURS = 12 * 60 * 60_000;
setInterval(() => {
    try {
        // 1. Prune orphaned crash snapshots older than 1h
        if (fs.existsSync(SNAPSHOT_DIR)) {
            const cutoff = Date.now() - 60 * 60_000;
            for (const f of fs.readdirSync(SNAPSHOT_DIR)) {
                try {
                    const fp   = path.join(SNAPSHOT_DIR, f);
                    const stat = fs.statSync(fp);
                    if (stat.mtimeMs < cutoff) fs.unlinkSync(fp);
                } catch {}
            }
        }

        // 2. Trim execution history to prevent unbounded growth
        try { history.prune?.(); } catch {}

        // 3. Soft-reset drift counters (keep totals but compact time-windowed arrays)
        try { require("./driftMonitor.cjs").reset?.(); } catch {}

        // 4. Request GC hint if available
        try { if (typeof global.gc === "function") global.gc(); } catch {}

        logger.info("[Runtime] 12h long-session cleanup complete");
    } catch (err) {
        logger.warn(`[Runtime] 12h cleanup error: ${err.message}`);
    }
}, TWELVE_HOURS).unref();

function getHealLog() { return _healLog.slice(-20); }

module.exports = { dispatch, queue, drainQueue, registerAgent, status, getHealLog };
