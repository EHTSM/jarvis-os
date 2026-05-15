"use strict";
/**
 * autonomousWorkflow — run a named sequence of steps with:
 *   retry (exponential backoff per step)
 *   checkpoint (disk-persisted after every step)
 *   resume (re-run picks up where it left off)
 *   rollback (completed steps reversed on fatal failure)
 *   execution history (every step recorded via executionHistory)
 *
 * A Step is a plain object:
 *   {
 *     name:        string
 *     execute:     async (ctx) => any
 *     validate?:   (result, ctx) => boolean
 *     rollback?:   async (ctx) => void
 *     maxRetries?: number          — overrides workflow-level default
 *     optional?:   boolean         — true: failure is logged, not fatal
 *   }
 *
 * Completed step results are injected into the shared ctx object under ctx[step.name],
 * so later steps can read outputs from earlier ones.
 */

const fs         = require("fs");
const path       = require("path");
const logger     = require("../../backend/utils/logger");
const history    = require("./executionHistory.cjs");
const recovery   = require("./recoveryEngine.cjs");
const costModel  = require("./costModel.cjs");
const pcl        = require("./patternCluster.cjs");
const tracer     = require("./tracer.cjs");
const obs        = require("./observability.cjs");

// Wrap tracing/observability calls — never let instrumentation fail a workflow
function _t(fn) { try { return fn(); } catch { return undefined; } }

const CHECKPOINT_DIR = path.join(__dirname, "../../data/workflow-checkpoints");

// ── Checkpoint helpers ────────────────────────────────────────────

function _ensureDir() {
    if (!fs.existsSync(CHECKPOINT_DIR)) fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
}

function _saveCheckpoint(state) {
    try {
        _ensureDir();
        fs.writeFileSync(
            path.join(CHECKPOINT_DIR, `${state.id}.json`),
            JSON.stringify(state, null, 2)
        );
    } catch { /* non-critical — checkpoint is best-effort */ }
}

function loadCheckpoint(id) {
    try {
        return JSON.parse(
            fs.readFileSync(path.join(CHECKPOINT_DIR, `${id}.json`), "utf8")
        );
    } catch { return null; }
}

function _clearCheckpoint(id) {
    try { fs.unlinkSync(path.join(CHECKPOINT_DIR, `${id}.json`)); } catch { /* ok */ }
}

// ── Backoff ───────────────────────────────────────────────────────

function _backoff(attempt) {
    return new Promise(r => setTimeout(r, Math.min(300 * (2 ** (attempt - 1)), 4_000)).unref());
}

// ── Core runner ───────────────────────────────────────────────────

/**
 * @param {string}   name
 * @param {object[]} steps
 * @param {{
 *   id?:         string,
 *   ctx?:        object,
 *   maxRetries?: number,
 *   resume?:     boolean,
 * }} opts
 * @returns {Promise<WorkflowResult>}
 */
async function runWorkflow(name, steps, opts = {}) {
    const id         = opts.id || `${name.replace(/[^a-z0-9]/gi, "-")}-${Date.now().toString(36)}`;
    const maxRetries = opts.maxRetries ?? 2;
    const ctx        = opts.ctx || {};

    // Tracing + observability (non-critical — errors silently ignored)
    const traceId   = _t(() => tracer.createTrace(id, opts.parentTraceId || null));
    const wfSpanId  = _t(() => tracer.startSpan(traceId, `workflow:${name}`));
    const wfStart   = Date.now();
    _t(() => obs.workflowStart(id, name, traceId));

    // Init or resume state from checkpoint
    let state = (opts.resume && loadCheckpoint(id)) || {
        id,
        name,
        startedAt:   new Date().toISOString(),
        completedAt: null,
        status:      "running",
        steps: steps.map(s => ({
            name: s.name, status: "pending", result: null,
            error: null, attempts: 0, completedAt: null, recoveries: 0,
        })),
    };

    _saveCheckpoint(state);
    logger.info(`[Workflow] ${id} — "${name}" starting (${steps.length} steps)`);

    const completed = [];  // track for rollback

    for (let i = 0; i < steps.length; i++) {
        const step      = steps[i];
        const stepState = state.steps[i];

        // Resume: skip already-completed steps, re-populate ctx
        if (stepState.status === "completed") {
            ctx[step.name] = stepState.result;
            completed.push(step);
            logger.info(`[Workflow] ${id} [${i}] "${step.name}" — RESUMED (skipping)`);
            continue;
        }

        const baseRetries = step.maxRetries ?? maxRetries;
        // Recovery can extend the attempt budget up to MAX_RECOVERY_ATTEMPTS beyond base
        let maxAttempts = baseRetries + recovery.MAX_RECOVERY_ATTEMPTS;
        let lastError   = null;
        let usedStrats  = [];
        let consecFails = 0;

        // Per-step span opened once; re-used across attempts
        const stepSpanId = _t(() => tracer.startSpan(traceId, `step:${step.name}`, wfSpanId));

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            stepState.attempts = attempt;
            stepState.status   = "running";
            _saveCheckpoint(state);
            _t(() => tracer.addSpanEvent(traceId, stepSpanId, "attempt", { n: attempt }));

            const t0 = Date.now();
            try {
                logger.info(`[Workflow] ${id} [${i}] "${step.name}" attempt ${attempt}`);

                const result = await step.execute(ctx);

                if (step.validate && !step.validate(result, ctx)) {
                    throw new Error(`Validation failed — "${step.name}"`);
                }

                const ms = Date.now() - t0;
                stepState.status      = "completed";
                stepState.result      = result;
                stepState.error       = null;
                stepState.completedAt = new Date().toISOString();
                ctx[step.name]        = result;
                completed.push(step);

                // Tracing + observability
                _t(() => {
                    tracer.finishSpan(traceId, stepSpanId, "ok", { attempts: attempt, durationMs: ms });
                    obs.stepAttempt(id, step.name, attempt, true);
                });

                // Verified recovery: step succeeded after a repair — double-weight confidence update
                if ((stepState.recoveries || 0) > 0 && stepState._lastStrategyId) {
                    recovery.recordVerifiedOutcome(
                        stepState._lastRecoveryType,
                        stepState._lastStrategyId,
                        true
                    );
                    // Record in pattern cluster for cross-workflow learning
                    pcl.record(stepState._lastRecoveryType, step.name, stepState._lastStrategyId, true);
                    stepState._lastStrategyId = null;
                }

                history.record({
                    agentId:    "workflow",
                    taskType:   `step:${step.name}`,
                    taskId:     `${id}:${i}`,
                    success:    true,
                    durationMs: ms,
                    input:      step.name,
                    output:     JSON.stringify(result || "").slice(0, 120),
                });

                logger.info(`[Workflow] ${id} [${i}] "${step.name}" — OK (${ms}ms)`);
                _saveCheckpoint(state);
                lastError = null;
                break;

            } catch (err) {
                lastError = err;
                const ms  = Date.now() - t0;
                history.record({
                    agentId:    "workflow",
                    taskType:   `step:${step.name}`,
                    taskId:     `${id}:${i}`,
                    success:    false,
                    durationMs: ms,
                    input:      step.name,
                    error:      err.message,
                });
                logger.warn(`[Workflow] ${id} [${i}] "${step.name}" attempt ${attempt} FAILED: ${err.message}`);
                _t(() => obs.stepAttempt(id, step.name, attempt, false));

                // ── Recovery ──────────────────────────────────────────
                _t(() => obs.recoveryAttempt(id, step.name, null, attempt));
                const rec = await recovery.attemptRecovery(err, ctx, {
                    stepName:       step.name,
                    usedStrategies: usedStrats,
                    attempt,
                });
                _t(() => obs.recoveryResult(id, step.name, rec.strategyId, rec.recovered, rec.durationMs));
                usedStrats  = [...usedStrats, rec.strategyId].filter(Boolean);
                consecFails = rec.recovered ? 0 : consecFails + 1;

                if (rec.recovered) {
                    stepState.recoveries        = (stepState.recoveries || 0) + 1;
                    stepState._lastStrategyId   = rec.strategyId;
                    stepState._lastRecoveryType = rec.classification?.type;
                    // Emit recovery span
                    _t(() => {
                        const rSpanId = tracer.startSpan(traceId, `recovery:${rec.strategyId}`, stepSpanId, {
                            stepName:   step.name,
                            strategyId: rec.strategyId,
                        });
                        tracer.finishSpan(traceId, rSpanId, "recovered", { durationMs: rec.durationMs });
                    });
                    // Retry immediately — no backoff needed, context already patched
                    continue;
                }

                // Record failed recovery in pattern cluster
                if (rec.strategyId && rec.classification?.type) {
                    pcl.record(rec.classification.type, step.name, rec.strategyId, false);
                }

                // Intelligent stop: give up if no viable path remains
                const giveUp = recovery.shouldGiveUp({
                    totalAttempts:    attempt,
                    usedStrategies:   usedStrats,
                    classification:   rec.classification,
                    consecutiveFails: consecFails,
                });
                if (giveUp.stop) {
                    logger.warn(`[Workflow] ${id} [${i}] "${step.name}" — recovery gave up: ${giveUp.reason}`);
                    break;
                }

                // Rollback-vs-repair: sometimes rolling back immediately beats more repair attempts
                const rbDecision = costModel.shouldRollback({
                    strategyId:        rec.strategyId,
                    confidence:        rec.confidence ?? 0,
                    previousAttempts:  attempt,
                    alreadyRolledBack: stepState._rolledBack || false,
                    stepHasRollback:   typeof step.rollback === "function",
                });
                if (rbDecision.rollback) {
                    logger.info(`[Workflow] ${id} [${i}] "${step.name}" — early rollback: ${rbDecision.reason}`);
                    if (typeof step.rollback === "function") {
                        try {
                            await step.rollback(ctx);
                            stepState._rolledBack = true;
                        } catch (rbErr) {
                            logger.warn(`[Workflow] ${id} rollback "${step.name}" error: ${rbErr.message}`);
                        }
                    }
                    break;
                }

                // Normal backoff within the base retry budget
                if (attempt < baseRetries) await _backoff(attempt);
            }
        }

        if (lastError) {
            _t(() => {
                tracer.finishSpan(traceId, stepSpanId, "error", { error: lastError.message });
                obs.stepFailed(id, step.name, null, stepState.attempts);
            });

            if (step.optional) {
                // Non-fatal — log, mark skipped, continue to next step
                stepState.status = "skipped";
                stepState.error  = lastError.message;
                ctx[step.name]   = null;
                _saveCheckpoint(state);
                logger.warn(`[Workflow] ${id} [${i}] "${step.name}" — optional step FAILED, continuing`);
                continue;
            }

            // Fatal failure — rollback then abort
            stepState.status = "failed";
            stepState.error  = lastError.message;
            _saveCheckpoint(state);
            logger.error(`[Workflow] ${id} [${i}] "${step.name}" — FATAL (${baseRetries} attempts exhausted)`);

            // Rollback in reverse order
            for (const done of [...completed].reverse()) {
                if (!done.rollback) continue;
                try {
                    await done.rollback(ctx);
                    logger.info(`[Workflow] ${id} rolled back "${done.name}"`);
                } catch (e) {
                    logger.warn(`[Workflow] ${id} rollback "${done.name}" error: ${e.message}`);
                }
            }

            state.status      = "failed";
            state.completedAt = new Date().toISOString();
            _saveCheckpoint(state);

            _t(() => {
                tracer.finishSpan(traceId, wfSpanId, "error", { durationMs: Date.now() - wfStart });
                obs.workflowEnd(id, name, false, Date.now() - wfStart, traceId);
            });
            history.record({ agentId: "workflow", taskType: `workflow:${name}`, taskId: id,
                success: false, durationMs: Date.now() - wfStart, input: name, output: "failed" });

            const result = _buildSummary(state, false, lastError.message);
            result.traceId = traceId || null;
            return result;
        }
    }

    state.status      = "completed";
    state.completedAt = new Date().toISOString();
    _clearCheckpoint(id);
    logger.info(`[Workflow] ${id} — COMPLETED "${name}"`);

    const wfMs = Date.now() - wfStart;
    _t(() => {
        tracer.finishSpan(traceId, wfSpanId, "ok", { durationMs: wfMs });
        obs.workflowEnd(id, name, true, wfMs, traceId);
    });
    history.record({ agentId: "workflow", taskType: `workflow:${name}`, taskId: id,
        success: true, durationMs: wfMs, input: name, output: "completed" });

    const result = _buildSummary(state, true, null);
    result.traceId = traceId || null;
    return result;
}

function _buildSummary(state, success, error) {
    const steps      = state.steps;
    const completed  = steps.filter(s => s.status === "completed").length;
    const failed     = steps.find(s => s.status === "failed");
    const totalMs    = new Date(state.completedAt || Date.now()) - new Date(state.startedAt);
    const stepDetails = steps.map(s => ({
        name:       s.name,
        status:     s.status,
        attempts:   s.attempts,
        recoveries: s.recoveries || 0,
        error:      s.error  || null,
        result:     s.result,
    }));

    return {
        id:          state.id,
        name:        state.name,
        success,
        error:       error || null,
        steps: {
            total:     steps.length,
            completed,
            failed:    steps.filter(s => s.status === "failed").length,
            skipped:   steps.filter(s => s.status === "skipped").length,
        },
        durationMs:  totalMs,
        completedAt: state.completedAt,
        healthScore: recovery.computeHealthScore({ stepDetails }),
        stepDetails,
        summary: success
            ? `"${state.name}" completed ${completed}/${steps.length} steps in ${totalMs}ms`
            : `"${state.name}" FAILED at "${failed?.name}" after ${completed} completed step(s) — ${error}`,
    };
}

module.exports = { runWorkflow, loadCheckpoint };
