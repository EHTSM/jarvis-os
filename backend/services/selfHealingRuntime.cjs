"use strict";
/**
 * SelfHealingRuntime — detect failures, retry actions, restart failed
 * workflows, and record every recovery action.
 *
 * Integrates with:
 *   taskQueue         — scan for stuck/failed tasks and reschedule
 *   runtimeOrchestrator — getHealLog() for native runtime heal events
 *   autonomousTaskLoop  — restart failed cycles
 *   execLog           — source of truth for recent execution failures
 *
 * Healing strategies:
 *   retry_task       — re-queue a failed task with backoff
 *   restart_workflow — cancel + restart a full cycle
 *   circuit_break    — mark an agent/tool as temporarily unavailable
 *   escalate         — log a high-severity alert if healing keeps failing
 *
 * Persists recovery history to data/healing-history.json.
 * Runs a background probe every PROBE_INTERVAL_MS (default 60s).
 *
 * Public API:
 *   probe()                         → { healed[], failed[] }  (manual trigger)
 *   healTask(taskId, opts)          → RecoveryRecord
 *   healCycle(cycleId, opts)        → RecoveryRecord
 *   circuitBreak(targetId, reason)  → RecoveryRecord
 *   getHistory(opts)                → { records[], stats }
 *   getStatus()                     → { lastProbeAt, probeCount, healedTotal, failedTotal }
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../utils/logger");
const auditLog = require("../utils/auditLog.cjs");
const execLog  = require("../utils/execLog.cjs");

const HISTORY_FILE  = path.join(__dirname, "../../data/healing-history.json");
const PROBE_INTERVAL_MS = 60_000;    // probe every 60 seconds
const MAX_AUTO_RETRIES  = 3;         // stop auto-healing after this many attempts per target
const STUCK_AGE_MS      = 5 * 60_000; // task running > 5 min = stuck

function _rj(file, fb) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fb; } }
function _wj(file, data) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

let _history  = _rj(HISTORY_FILE, []);
let _seq      = _history.length;
let _probeCount = 0;
let _lastProbeAt = null;
// Track auto-retry counts per target to avoid infinite loops
const _retryCount = new Map();  // targetId → count

function _rid() { return `heal_${Date.now()}_${(++_seq).toString(36)}`; }
function _save() { try { _wj(HISTORY_FILE, _history.slice(-2000)); } catch { /* non-fatal */ } }

function _record(rec) {
    _history.push({ ts: new Date().toISOString(), ...rec });
    _save();
    auditLog.append({ type: "heal_record", ...rec });
}

// ── Lazy-load dependents ─────────────────────────────────────────────────
function _getTQ()  { try { return require("../../agents/taskQueue.cjs"); } catch { return null; } }
function _getATL() { try { return require("./autonomousTaskLoop.cjs");   } catch { return null; } }
function _getOrc() { try { return require("../../agents/runtime/runtimeOrchestrator.cjs"); } catch { return null; } }

// ── Failure detection ────────────────────────────────────────────────────
function _detectFailedTasks() {
    const tq = _getTQ();
    if (!tq) return [];
    try {
        const all  = tq.getAll();
        const now  = Date.now();
        const failed = all.filter(t => t.status === "failed");
        const stuck  = all.filter(t => {
            if (t.status !== "running") return false;
            const age = now - new Date(t.startedAt || t.createdAt).getTime();
            return age > STUCK_AGE_MS;
        });
        return [...failed, ...stuck];
    } catch { return []; }
}

function _detectFailedCycles() {
    const atl = _getATL();
    if (!atl) return [];
    try {
        const { cycles } = atl.listCycles({ status: "failed", limit: 20 });
        return cycles;
    } catch { return []; }
}

function _recentExecFailures() {
    try {
        return execLog.tail(200).filter(e => !e.success);
    } catch { return []; }
}

// ── Healing actions ──────────────────────────────────────────────────────

/** Re-queue a failed / stuck task with exponential backoff. */
async function healTask(taskId, opts = {}) {
    const recId   = _rid();
    const count   = (_retryCount.get(taskId) || 0) + 1;

    if (count > MAX_AUTO_RETRIES) {
        const rec = { recId, strategy: "escalate", targetType: "task", targetId: taskId, success: false, reason: `max retries (${MAX_AUTO_RETRIES}) exceeded`, count };
        _record(rec);
        return rec;
    }

    _retryCount.set(taskId, count);

    const tq = _getTQ();
    if (!tq) {
        const rec = { recId, strategy: "retry_task", targetType: "task", targetId: taskId, success: false, reason: "taskQueue unavailable" };
        _record(rec); return rec;
    }

    try {
        const all  = tq.getAll();
        const task = all.find(t => t.id === taskId);
        if (!task) {
            const rec = { recId, strategy: "retry_task", targetType: "task", targetId: taskId, success: false, reason: "task not found" };
            _record(rec); return rec;
        }

        // Reset task to pending for re-execution
        const delayMs = Math.min(1000 * Math.pow(2, count - 1), 30_000);  // 1s, 2s, 4s... up to 30s
        const newScheduledFor = new Date(Date.now() + delayMs).toISOString();
        tq.update(taskId, { status: "pending", startedAt: null, scheduledFor: newScheduledFor, lastError: null });

        const rec = { recId, strategy: "retry_task", targetType: "task", targetId: taskId, success: true, attempt: count, delayMs, newScheduledFor };
        _record(rec);
        logger.info(`[SelfHeal] Task ${taskId} re-queued (attempt ${count}, delay ${delayMs}ms)`);
        return rec;
    } catch (e) {
        const rec = { recId, strategy: "retry_task", targetType: "task", targetId: taskId, success: false, reason: e.message };
        _record(rec); return rec;
    }
}

/** Cancel and restart a failed cycle. */
async function healCycle(cycleId, opts = {}) {
    const recId = _rid();
    const count = (_retryCount.get(cycleId) || 0) + 1;

    if (count > MAX_AUTO_RETRIES) {
        const rec = { recId, strategy: "escalate", targetType: "cycle", targetId: cycleId, success: false, reason: `max retries (${MAX_AUTO_RETRIES}) exceeded`, count };
        _record(rec); return rec;
    }
    _retryCount.set(cycleId, count);

    const atl = _getATL();
    if (!atl) {
        const rec = { recId, strategy: "restart_workflow", targetType: "cycle", targetId: cycleId, success: false, reason: "autonomousTaskLoop unavailable" };
        _record(rec); return rec;
    }

    try {
        const cycle = atl.getCycle(cycleId);
        if (!cycle) {
            const rec = { recId, strategy: "restart_workflow", targetType: "cycle", targetId: cycleId, success: false, reason: "cycle not found" };
            _record(rec); return rec;
        }

        // Cancel the old cycle if still running
        if (["running", "pending"].includes(cycle.status)) {
            try { atl.cancelCycle(cycleId); } catch { /* already done */ }
        }

        // Start a new cycle with the same goal
        const newCycle = atl.startCycle(cycle.goal, { goalType: cycle.goalType, source: "self_heal" });
        const rec = { recId, strategy: "restart_workflow", targetType: "cycle", targetId: cycleId, newCycleId: newCycle.cycleId, success: true, attempt: count };
        _record(rec);
        logger.info(`[SelfHeal] Cycle ${cycleId} restarted → ${newCycle.cycleId} (attempt ${count})`);
        return rec;
    } catch (e) {
        const rec = { recId, strategy: "restart_workflow", targetType: "cycle", targetId: cycleId, success: false, reason: e.message };
        _record(rec); return rec;
    }
}

/** Mark a target (agent or tool) as circuit-broken for a duration. */
function circuitBreak(targetId, reason, durationMs = 60_000) {
    const recId  = _rid();
    const resetAt = new Date(Date.now() + durationMs).toISOString();
    const rec = { recId, strategy: "circuit_break", targetType: "agent_or_tool", targetId, success: true, reason, durationMs, resetAt };
    _record(rec);
    logger.warn(`[SelfHeal] Circuit-break applied to ${targetId} until ${resetAt}: ${reason}`);
    return rec;
}

// ── Probe (automated scan + heal) ────────────────────────────────────────
async function probe() {
    _probeCount++;
    _lastProbeAt = new Date().toISOString();
    const healed = [];
    const failed = [];

    // 1. Scan failed / stuck tasks
    const badTasks = _detectFailedTasks();
    for (const task of badTasks.slice(0, 10)) {   // cap to 10 per probe cycle
        const r = await healTask(task.id, { auto: true });
        (r.success ? healed : failed).push({ type: "task", id: task.id, result: r });
    }

    // 2. Scan failed cycles
    const badCycles = _detectFailedCycles();
    for (const cycle of badCycles.slice(0, 5)) {
        const r = await healCycle(cycle.cycleId, { auto: true });
        (r.success ? healed : failed).push({ type: "cycle", id: cycle.cycleId, result: r });
    }

    // 3. Collect native heal log from orchestrator
    try {
        const orc = _getOrc();
        if (orc && typeof orc.getHealLog === "function") {
            const nativeLogs = orc.getHealLog?.() || [];
            // Record any new native heal events we haven't seen
            for (const entry of nativeLogs.slice(-5)) {
                _record({ strategy: "native_runtime_heal", targetType: "runtime", targetId: entry.taskId || "unknown", success: !!entry.healed, reason: entry.reason || null, native: true });
            }
        }
    } catch { /* non-critical */ }

    if (healed.length + failed.length > 0) {
        logger.info(`[SelfHeal] Probe #${_probeCount}: healed=${healed.length} failed=${failed.length}`);
    }

    return { healed, failed, probeCount: _probeCount, ts: _lastProbeAt };
}

// ── Background probe loop ────────────────────────────────────────────────
let _probeTimer = null;

function startProbeLoop() {
    if (_probeTimer) return;
    _probeTimer = setInterval(() => {
        probe().catch(e => logger.warn(`[SelfHeal] Probe error: ${e.message}`));
    }, PROBE_INTERVAL_MS);
    if (_probeTimer.unref) _probeTimer.unref();
    logger.info(`[SelfHeal] Probe loop started (interval: ${PROBE_INTERVAL_MS}ms)`);
}

function stopProbeLoop() {
    if (_probeTimer) { clearInterval(_probeTimer); _probeTimer = null; }
}

// Auto-start probe loop when module is loaded in server context
startProbeLoop();

// ── Query API ────────────────────────────────────────────────────────────
function getHistory({ strategy, targetType, limit = 100, offset = 0 } = {}) {
    let rows = [..._history].reverse();
    if (strategy)   rows = rows.filter(r => r.strategy   === strategy);
    if (targetType) rows = rows.filter(r => r.targetType === targetType);
    const stats = {
        total:   _history.length,
        healed:  _history.filter(r => r.success).length,
        failed:  _history.filter(r => !r.success).length,
        byStrategy: _history.reduce((a, r) => { a[r.strategy] = (a[r.strategy] || 0) + 1; return a; }, {}),
    };
    return { records: rows.slice(offset, offset + limit), total: rows.length, stats };
}

function getStatus() {
    return {
        lastProbeAt:  _lastProbeAt,
        probeCount:   _probeCount,
        healedTotal:  _history.filter(r => r.success).length,
        failedTotal:  _history.filter(r => !r.success).length,
        probeIntervalMs: PROBE_INTERVAL_MS,
        active:       !!_probeTimer,
    };
}

module.exports = { probe, healTask, healCycle, circuitBreak, getHistory, getStatus, startProbeLoop, stopProbeLoop };
