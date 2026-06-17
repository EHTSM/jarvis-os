"use strict";
/**
 * autonomousExecutionRuntime.cjs — I4: Autonomous Execution Runtime
 *
 * Responsible for completing mission stages using existing capabilities.
 * Does NOT observe, decide, store missions, or duplicate any existing system.
 *
 * Authorities respected:
 *   Execution queue     → autonomousLoop / taskQueue  (unchanged)
 *   Agent dispatch      → runtimeOrchestrator.dispatch (unchanged)
 *   Capability routing  → agentRegistry.findForCapability (unchanged)
 *   Execution history   → executionHistory.record  (unchanged)
 *   Mission state       → missionOrchestrator / missionRuntime (unchanged)
 *   Event fan-out       → runtimeEventBus  (unchanged)
 *
 * This runtime owns only:
 *   - Execution record lifecycle (executionId → result)
 *   - Policy enforcement (timeout, retry, rollback)
 *   - Capability resolution per stage
 *   - Verification of stage output
 *   - Artifact collection
 *
 * Capability registry (extensible, not hardcoded):
 *   Capabilities are registered via registerCapability(). Future engineering
 *   capabilities (read_repo, analyze_code, generate_patch, apply_patch,
 *   build, test, rollback, git_commit) can be added without architecture changes.
 *
 * Public API:
 *   start()                           → { started, capabilities }
 *   stop()                            → void
 *   executeStage(opts)                → Promise<executionRecord>
 *   registerCapability(cap)           → void
 *   listCapabilities()                → capability[]
 *   getExecution(executionId)         → executionRecord | null
 *   listExecutions(opts)              → { executions[], total }
 *   getStatistics()                   → stats
 *   retryExecution(executionId)       → Promise<executionRecord>
 *   cancelExecution(executionId)      → executionRecord
 *   rollbackExecution(executionId)    → Promise<executionRecord>
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const logger = require("../utils/logger");

// ── Lazy service loaders ───────────────────────────────────────────────────
function _getBus()    { try { return require("../../agents/runtime/runtimeEventBus.cjs");    } catch { return null; } }
function _getLoop()   { try { return require("../../agents/autonomousLoop.cjs");              } catch { return null; } }
function _getOrch()   { try { return require("../../agents/runtime/runtimeOrchestrator.cjs"); } catch { return null; } }
function _getReg()    { try { return require("../../agents/runtime/agentRegistry.cjs");       } catch { return null; } }
function _getHist()   { try { return require("../../agents/runtime/executionHistory.cjs");    } catch { return null; } }
function _getObs()    { try { return require("./observabilityEngine.cjs");                    } catch { return null; } }
function _getMissOrch(){ try { return require("./missionOrchestrator.cjs");                   } catch { return null; } }
function _getRuleReg() { try { return require("./engineeringRuleRegistry.cjs");               } catch { return null; } }

// ── Paths ──────────────────────────────────────────────────────────────────
const DATA_DIR      = path.join(__dirname, "../../data");
const EXEC_FILE     = path.join(DATA_DIR, "execution-runtime.ndjson");

// ── ID generation ──────────────────────────────────────────────────────────
let _eseq = 0;
function _eid() { return `exec_${Date.now()}_${(++_eseq).toString(36)}`; }

// ── Default policies ───────────────────────────────────────────────────────
const DEFAULT_POLICY = {
    timeoutMs:    60_000,   // 60s per stage
    maxRetries:   2,
    retryDelayMs: 5_000,    // 5s base, doubles per retry
    rollbackEnabled: true,
    parallelMax:  4,        // max parallel stages
};

// ── Capability registry ────────────────────────────────────────────────────
// Each capability: { name, description, handler(context) → Promise<{ output, artifacts, logs }> }
// Handler receives: { input, missionId, stageId, agentId, policy, loopTask }
const _capabilities = new Map();

function registerCapability({ name, description, handler }) {
    if (!name || typeof handler !== "function") throw new Error("registerCapability: name and handler required");
    _capabilities.set(name, { name, description: description || name, handler });
    logger.debug?.(`[ExecRuntime] registered capability: ${name}`);
}

// ── Execution ring buffer (bounded 1 000) ──────────────────────────────────
const RING_SIZE = 1_000;
const _ring     = [];
let   _total    = 0;

function _pushRing(rec) {
    if (_ring.length >= RING_SIZE) _ring.shift();
    _ring.push(rec);
    _total++;
}

// ── Active executions (for cancellation / rollback) ────────────────────────
const _active = new Map();  // executionId → { cancel: fn, record }

// ── Statistics ─────────────────────────────────────────────────────────────
const _stats = {
    started: 0, completed: 0, failed: 0, cancelled: 0,
    retries: 0, rollbacks: 0, timeouts: 0,
    totalDurationMs: 0,
};
let _startedAt = null;

// ── Event helper ───────────────────────────────────────────────────────────
function _emit(type, payload) {
    try { _getBus()?.emit(type, { ...payload, _source: "execution_runtime" }); } catch { /* non-fatal */ }
}

function _obs(name, value, tags = {}) {
    try { _getObs()?.recordMetric(name, value, tags); } catch { /* non-fatal */ }
}

// ── Async NDJSON persist ───────────────────────────────────────────────────
let _pq = [], _pb = false;
function _persist(rec) {
    _pq.push(JSON.stringify(rec) + "\n");
    if (_pb) return;
    _pb = true;
    setImmediate(function _drain() {
        if (!_pq.length) { _pb = false; return; }
        const batch = _pq.splice(0).join("");
        fs.appendFile(EXEC_FILE, batch, "utf8", err => {
            if (err) logger.warn(`[ExecRuntime] persist error: ${err.message}`);
            _pb = false;
            if (_pq.length) setImmediate(_drain);
        });
    });
}

// ── Build execution record ─────────────────────────────────────────────────
function _mkRecord(opts) {
    const now = new Date().toISOString();
    return {
        executionId:         _eid(),
        missionId:           opts.missionId    || null,
        stageId:             opts.stageId      || null,
        capability:          opts.capability   || "unknown",
        assignedAgent:       opts.assignedAgent || null,
        input:               (opts.input        || "").slice(0, 500),
        status:              "running",
        attempts:            0,
        maxAttempts:         (opts.policy?.maxRetries ?? DEFAULT_POLICY.maxRetries) + 1,
        startedAt:           now,
        completedAt:         null,
        duration:            null,
        verificationResult:  "pending",
        rollbackAvailable:   opts.policy?.rollbackEnabled ?? DEFAULT_POLICY.rollbackEnabled,
        rollbackExecutionId: null,
        artifacts:           [],
        logs:                [],
        output:              null,
        error:               null,
        loopTaskIds:         [],
        policy:              { ...DEFAULT_POLICY, ...(opts.policy || {}) },
    };
}

// ── Core: execute one stage ────────────────────────────────────────────────
/**
 * @param {{ missionId, stageId, capability, input, assignedAgent, policy }} opts
 * @returns {Promise<executionRecord>}
 */
async function executeStage(opts = {}) {
    const rec = _mkRecord(opts);
    _pushRing(rec);
    _stats.started++;
    _emit("execution:stage:started", { executionId: rec.executionId, missionId: rec.missionId, stageId: rec.stageId, capability: rec.capability });

    // Cancellation token
    let cancelled = false;
    _active.set(rec.executionId, {
        cancel: () => { cancelled = true; },
        record: rec,
    });

    const policy    = rec.policy;
    const t0        = Date.now();
    let   lastError = null;

    for (let attempt = 1; attempt <= rec.maxAttempts; attempt++) {
        if (cancelled) {
            rec.status = "cancelled";
            rec.error  = "Cancelled during retry";
            break;
        }

        rec.attempts = attempt;
        rec.logs.push({ ts: new Date().toISOString(), msg: `Attempt ${attempt}/${rec.maxAttempts} — capability: ${rec.capability}` });

        try {
            const result = await _runAttempt(rec, policy, cancelled);
            if (result.timedOut) {
                lastError = `Timeout after ${policy.timeoutMs}ms`;
                _stats.timeouts++;
                rec.logs.push({ ts: new Date().toISOString(), msg: `Timeout on attempt ${attempt}` });
            } else if (result.success) {
                rec.output    = result.output;
                rec.artifacts = result.artifacts || [];
                rec.logs.push(...(result.logs || []));
                rec.status             = "completed";
                rec.verificationResult = _verify(rec);
                lastError = null;
                break;
            } else {
                lastError = result.error || "attempt failed";
                rec.logs.push({ ts: new Date().toISOString(), msg: `Attempt ${attempt} failed: ${lastError}` });
                // Non-retriable errors are deterministic — never improve on retry.
                // Break immediately to avoid burning backoff time on guaranteed failures.
                const isNonRetriable = result.nonRetriable || (() => {
                    // Consult rule registry as fallback for capabilities not yet annotated
                    try {
                        const reg = _getRuleReg();
                        if (!reg) return false;
                        const { rule } = reg.classifyError(lastError);
                        return rule?.autoApply && rule?.action === "fail_fast";
                    } catch { return false; }
                })();
                if (isNonRetriable) {
                    rec.logs.push({ ts: new Date().toISOString(), msg: `Non-retriable error — skipping remaining ${rec.maxAttempts - attempt} attempt(s)` });
                    break;
                }
            }
        } catch (err) {
            lastError = err.message;
            rec.logs.push({ ts: new Date().toISOString(), msg: `Attempt ${attempt} threw: ${lastError}` });
        }

        // Retry delay (exponential backoff)
        if (attempt < rec.maxAttempts && !cancelled) {
            _stats.retries++;
            const delay = policy.retryDelayMs * attempt;
            rec.logs.push({ ts: new Date().toISOString(), msg: `Waiting ${delay}ms before retry` });
            await new Promise(r => setTimeout(r, delay));
        }
    }

    // Finalize
    const elapsed = Date.now() - t0;
    rec.completedAt = new Date().toISOString();
    rec.duration    = elapsed;
    _stats.totalDurationMs += elapsed;

    if (rec.status !== "completed" && rec.status !== "cancelled") {
        rec.status = "failed";
        rec.error  = lastError || "all attempts exhausted";
    }

    if (rec.status === "completed") {
        _stats.completed++;
        _obs("execution.stage.completed", 1, { capability: rec.capability });
    } else if (rec.status === "failed") {
        _stats.failed++;
        _obs("execution.stage.failed", 1, { capability: rec.capability });
    } else {
        _stats.cancelled++;
    }

    _active.delete(rec.executionId);
    _persist(rec);

    // Record in executionHistory (existing system)
    try {
        _getHist()?.record({
            agentId:    rec.assignedAgent || "execution_runtime",
            taskType:   `stage_${rec.capability}`,
            taskId:     rec.executionId,
            success:    rec.status === "completed",
            durationMs: rec.duration,
            error:      rec.error,
            input:      rec.input.slice(0, 120),
            output:     (rec.output || "").toString().slice(0, 120),
        });
    } catch { /* non-fatal */ }

    _emit(`execution:stage:${rec.status}`, {
        executionId: rec.executionId,
        missionId:   rec.missionId,
        stageId:     rec.stageId,
        capability:  rec.capability,
        duration:    rec.duration,
        attempts:    rec.attempts,
        verificationResult: rec.verificationResult,
    });

    logger.info(`[ExecRuntime] ${rec.executionId} ${rec.status} in ${elapsed}ms (${rec.attempts} attempt(s))`);
    return { ...rec };
}

// ── Run one attempt ────────────────────────────────────────────────────────
async function _runAttempt(rec, policy, cancelledRef) {
    // Check registered capability handler first
    const capHandler = _capabilities.get(rec.capability);
    if (capHandler) {
        return await Promise.race([
            capHandler.handler({
                input:      rec.input,
                missionId:  rec.missionId,
                stageId:    rec.stageId,
                agentId:    rec.assignedAgent,
                policy,
                executionId: rec.executionId,
            }),
            new Promise(r => setTimeout(() => r({ success: false, timedOut: true, output: null }), policy.timeoutMs)),
        ]);
    }

    // Delegate to runtimeOrchestrator.dispatch (the existing execution authority)
    const orch = _getOrch();
    if (!orch) {
        // Graceful degradation: queue through autonomousLoop directly
        return await _runViaLoop(rec, policy);
    }

    const dispatchPromise = orch.dispatch(rec.input, {
        timeoutMs: policy.timeoutMs,
        retries:   0,  // retries managed by ExecRuntime, not the orchestrator
        _internal: true,
    });

    const result = await Promise.race([
        dispatchPromise,
        new Promise(r => setTimeout(() => r({ success: false, timedOut: true }), policy.timeoutMs)),
    ]);

    if (result.timedOut) return { success: false, timedOut: true, output: null };

    const dispatchError = result.success ? null : (result.error || "dispatch failed");
    return {
        success:      result.success,
        output:       result.reply || result.result || null,
        artifacts:    [],
        logs:         [{ ts: new Date().toISOString(), msg: `dispatch durationMs=${result.durationMs}` }],
        error:        dispatchError,
        // "dispatch failed" means no handler registered — will never succeed on retry
        nonRetriable: !result.success && dispatchError === "dispatch failed",
    };
}

// ── Fallback: autonomousLoop queue ────────────────────────────────────────
async function _runViaLoop(rec, policy) {
    const loop = _getLoop();
    if (!loop) return { success: false, error: "autonomousLoop unavailable", output: null };

    const task = loop.addTask({
        input:      rec.input,
        type:       `exec_${rec.capability}`,
        maxRetries: 0,  // ExecRuntime handles retries
    });
    rec.loopTaskIds.push(task.id);

    // Poll for completion
    const deadline = Date.now() + policy.timeoutMs;
    const POLL_MS  = 2_000;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, POLL_MS));
        const all  = loop.getQueue();
        const t    = all.find(q => q.id === task.id);
        if (!t) return { success: true, output: "task accepted", artifacts: [], logs: [] };
        if (t.status === "completed") return { success: true, output: t.result || "completed", artifacts: [], logs: [] };
        if (t.status === "failed")    return { success: false, error: t.lastError || "loop task failed", output: null };
    }
    return { success: false, timedOut: true, output: null };
}

// ── Verification ───────────────────────────────────────────────────────────
// Deterministic: checks output presence and absence of error markers.
function _verify(rec) {
    if (rec.status !== "completed") return "failed";
    if (!rec.output && rec.artifacts.length === 0) return "no_output";
    const out = (rec.output || "").toString().toLowerCase();
    if (out.includes("error") && out.includes("fatal")) return "output_contains_fatal_error";
    return "passed";
}

// ── Public: retryExecution ────────────────────────────────────────────────
async function retryExecution(executionId) {
    const original = _ring.find(r => r.executionId === executionId);
    if (!original) throw new Error(`Execution not found: ${executionId}`);
    if (original.status === "running") throw new Error("Execution is still running");
    logger.info(`[ExecRuntime] retrying ${executionId}`);
    _stats.retries++;
    return executeStage({
        missionId:     original.missionId,
        stageId:       original.stageId,
        capability:    original.capability,
        input:         original.input,
        assignedAgent: original.assignedAgent,
        policy:        original.policy,
    });
}

// ── Public: cancelExecution ───────────────────────────────────────────────
function cancelExecution(executionId) {
    const entry = _active.get(executionId);
    if (!entry) {
        const rec = _ring.find(r => r.executionId === executionId);
        if (!rec) throw new Error(`Execution not found: ${executionId}`);
        if (["completed", "failed", "cancelled"].includes(rec.status)) {
            throw new Error(`Execution already in terminal state: ${rec.status}`);
        }
    }
    if (entry) {
        entry.cancel();
        entry.record.status = "cancelled";
        entry.record.error  = "Cancelled by operator";
        _active.delete(executionId);
        _stats.cancelled++;
        _emit("execution:stage:cancelled", { executionId });
        return { ...entry.record };
    }
    throw new Error(`Execution not in active set: ${executionId}`);
}

// ── Public: rollbackExecution ─────────────────────────────────────────────
async function rollbackExecution(executionId) {
    const original = _ring.find(r => r.executionId === executionId);
    if (!original) throw new Error(`Execution not found: ${executionId}`);
    if (!original.rollbackAvailable) throw new Error("Rollback not available for this execution");
    if (original.rollbackExecutionId) throw new Error("Already rolled back");

    _stats.rollbacks++;
    logger.info(`[ExecRuntime] rolling back ${executionId}`);
    _emit("execution:stage:rollback:started", { executionId, missionId: original.missionId });

    const rbRec = await executeStage({
        missionId:     original.missionId,
        stageId:       original.stageId ? `${original.stageId}_rollback` : null,
        capability:    `rollback`,
        input:         `Rollback: ${original.input.slice(0, 200)}`,
        assignedAgent: original.assignedAgent,
        policy:        { ...original.policy, rollbackEnabled: false },
    });

    original.rollbackExecutionId = rbRec.executionId;
    original.rollbackAvailable   = false;

    _emit("execution:stage:rollback:completed", { executionId, rollbackExecutionId: rbRec.executionId });
    _obs("execution.rollback", 1, { capability: original.capability });
    return { ...rbRec, _originalExecutionId: executionId };
}

// ── Public: getExecution ──────────────────────────────────────────────────
function getExecution(executionId) {
    return _ring.find(r => r.executionId === executionId) || null;
}

// ── Public: listExecutions ────────────────────────────────────────────────
function listExecutions({ limit = 100, status, missionId, capability, since } = {}) {
    let list = [..._ring];
    if (status)     list = list.filter(r => r.status      === status);
    if (missionId)  list = list.filter(r => r.missionId   === missionId);
    if (capability) list = list.filter(r => r.capability  === capability);
    if (since)      list = list.filter(r => r.startedAt   >= since);
    const total = list.length;
    return { executions: list.slice(-Math.min(limit, 500)).reverse(), total };
}

// ── Public: getStatistics ─────────────────────────────────────────────────
function getStatistics() {
    const active = _active.size;
    const avg    = _stats.completed > 0
        ? Math.round(_stats.totalDurationMs / _stats.completed)
        : 0;
    return {
        running:       _running,
        startedAt:     _startedAt ? new Date(_startedAt).toISOString() : null,
        uptimeSec:     _startedAt ? Math.round((Date.now() - _startedAt) / 1000) : 0,
        activeExecutions:  active,
        capabilities:  _capabilities.size,
        ringFill:      _ring.length,
        ..._stats,
        avgDurationMs: avg,
    };
}

// ── Public: listCapabilities ───────────────────────────────────────────────
function listCapabilities() {
    return [..._capabilities.values()].map(c => ({ name: c.name, description: c.description }));
}

// ── Built-in capability registrations ────────────────────────────────────
// These are registered at startup. Future engineering capabilities are added
// here or via registerCapability() at module load time without code changes.

function _registerBuiltins() {
    // goal_decompose — delegates to runtimeOrchestrator
    registerCapability({
        name:        "goal_decompose",
        description: "Decompose a goal into ordered subtasks using the planner",
        handler: async ctx => {
            const orch = _getOrch();
            if (!orch) return { success: false, error: "orchestrator unavailable", output: null };
            const r = await orch.dispatch(`Decompose into tasks: ${ctx.input}`, { timeoutMs: ctx.policy.timeoutMs, _internal: true });
            return { success: r.success, output: r.reply, artifacts: [], logs: [] };
        },
    });

    // task_plan — delegates to autonomousLoop
    registerCapability({
        name:        "task_plan",
        description: "Create an execution plan for a set of tasks",
        handler: async ctx => {
            const loop = _getLoop();
            if (!loop) return { success: false, error: "loop unavailable", output: null };
            const t = loop.addTask({ input: `Plan: ${ctx.input}`, type: "exec_task_plan" });
            return { success: true, output: `Queued plan task: ${t.id}`, artifacts: [{ type: "task_id", value: t.id }], logs: [] };
        },
    });

    // validation — lightweight deterministic check
    registerCapability({
        name:        "validation",
        description: "Validate that a plan or output meets correctness criteria",
        handler: async ctx => {
            const hasContent = ctx.input && ctx.input.trim().length > 0;
            return {
                success:   hasContent,
                output:    hasContent ? "validation_passed" : "validation_failed_empty_input",
                artifacts: [],
                logs:      [{ ts: new Date().toISOString(), msg: `Validated input length=${ctx.input.length}` }],
                error:     hasContent ? null : "empty input",
            };
        },
    });

    // execution — delegates to runtimeOrchestrator.dispatch
    registerCapability({
        name:        "execution",
        description: "Execute a task through the runtime orchestrator",
        handler: async ctx => {
            const orch = _getOrch();
            if (!orch) return { success: false, error: "orchestrator unavailable", output: null };
            const r = await orch.dispatch(ctx.input, { timeoutMs: ctx.policy.timeoutMs, _internal: true });
            return { success: r.success, output: r.reply, artifacts: [], logs: [], error: r.success ? null : r.error };
        },
    });

    // reporting — emit summary event
    registerCapability({
        name:        "reporting",
        description: "Produce a completion report and publish to runtimeEventBus",
        handler: async ctx => {
            const report = { missionId: ctx.missionId, stageId: ctx.stageId, summary: ctx.input.slice(0, 200), ts: new Date().toISOString() };
            _emit("execution:report", report);
            return { success: true, output: JSON.stringify(report), artifacts: [{ type: "report", value: report }], logs: [] };
        },
    });

    // rollback — undo/revert placeholder (real implementations plug in via registerCapability)
    registerCapability({
        name:        "rollback",
        description: "Rollback execution artifacts (no-op until specific rollback handler registered)",
        handler: async ctx => {
            _emit("execution:rollback:attempt", { input: ctx.input, missionId: ctx.missionId });
            return { success: true, output: "rollback_acknowledged", artifacts: [], logs: [{ ts: new Date().toISOString(), msg: "Rollback noted — no destructive action taken" }] };
        },
    });

    // Future engineering capabilities (placeholders — override with real handlers):
    for (const cap of ["read_repo", "analyze_code", "generate_patch", "apply_patch", "build", "test", "git_commit"]) {
        registerCapability({
            name:        cap,
            description: `Engineering capability: ${cap.replace(/_/g, " ")} (registers slot — implement handler via registerCapability)`,
            handler: async ctx => {
                const loop = _getLoop();
                if (!loop) return { success: false, error: "loop unavailable", output: null };
                const t = loop.addTask({ input: `[${cap}] ${ctx.input}`, type: `exec_${cap}` });
                return { success: true, output: `Queued ${cap} task: ${t.id}`, artifacts: [{ type: "task_id", value: t.id }], logs: [] };
            },
        });
    }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────
let _running = false;

function start() {
    if (_running) return { started: false, reason: "already_running" };
    _running   = true;
    _startedAt = Date.now();
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    _registerBuiltins();
    logger.info(`[ExecRuntime] I4 started — ${_capabilities.size} capabilities registered`);
    return { started: true, capabilities: listCapabilities() };
}

function stop() {
    _running = false;
    // Cancel all active executions gracefully
    for (const [id, entry] of _active) {
        try { entry.cancel(); } catch { /* ok */ }
    }
    _active.clear();
    logger.info("[ExecRuntime] stopped");
}

module.exports = {
    start, stop,
    executeStage, registerCapability, listCapabilities,
    getExecution, listExecutions, getStatistics,
    retryExecution, cancelExecution, rollbackExecution,
};
