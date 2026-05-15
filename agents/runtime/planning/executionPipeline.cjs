"use strict";
/**
 * executionPipeline — integrates all planning modules into a single execution flow.
 *
 * run(task, context?, opts?)
 *   → Promise<{ executionId, approved, blocked, blockReasons[], strategy,
 *               checkpoints{}, metadata{}, auditId, result? }>
 *
 * Stages: decompose → simulate → score → select_strategy → verify → approve → execute
 *
 * reset()   — resets sequence counter and all sub-module state
 */

const gd    = require("./goalDecomposer.cjs");
const ps    = require("./planSimulator.cjs");
const fsc   = require("./feasibilityScorer.cjs");
const ss    = require("./strategySelector.cjs");
const pev   = require("./preExecutionVerifier.cjs");
const eb    = require("./executionBlocker.cjs");
const sr    = require("./strategyRouter.cjs");
const cs    = require("./checkpointStore.cjs");
const em    = require("./executionMetadata.cjs");
const hooks = require("./planningHooks.cjs");
const audit = require("./executionAudit.cjs");

let _seq = 0;

function _genId(taskId) {
    return `exec-${taskId ?? "task"}-${++_seq}`;
}

function _collectCheckpoints(executionId) {
    const out = {};
    for (const cp of cs.list(executionId)) out[cp.stage] = cp;
    return out;
}

function _simulateExecution(plan, strategy, routeConf) {
    const steps = plan.executionOrder ?? [];
    return {
        mode:          strategy,
        dryRun:        routeConf.dryRun,
        isolated:      routeConf.isolation,
        stepsPlanned:  steps,
        stepsExecuted: routeConf.dryRun ? [] : steps,
        rollbackReady: routeConf.rollbackRequired,
        checkpointed:  routeConf.checkpoints,
        simulatedOnly: routeConf.dryRun,
        completedAt:   new Date().toISOString(),
    };
}

// ── run ───────────────────────────────────────────────────────────────

async function run(task, context = {}, opts = {}) {
    const executionId = opts.executionId ?? _genId(task.id);

    hooks.emit("planning_started", { executionId, taskId: task.id, ts: new Date().toISOString() });

    // ── Stage 1: Decompose ────────────────────────────────────────────
    const decomp = gd.decompose(task);
    const plan   = decomp.plan;
    cs.store(executionId, "decompose", {
        status:   "complete",
        feasible: plan.feasible,
        steps:    plan.steps?.length ?? 0,
    });

    // ── Stage 2: Simulate ─────────────────────────────────────────────
    const simResult = await ps.simulate(plan, context);
    cs.store(executionId, "simulate", {
        status:       "complete",
        passed:       simResult.passed,
        blockerCount: simResult.blockers.length,
    });
    hooks.emit("simulation_completed", {
        executionId, passed: simResult.passed, blockers: simResult.blockers.length,
    });

    // ── Stage 3: Score ────────────────────────────────────────────────
    const feasibility = fsc.score(plan, simResult);
    cs.store(executionId, "score", {
        status:       "complete",
        feasibility:  feasibility.feasibility,
        confidence:   feasibility.confidence,
        repairProb:   feasibility.repairProbability,
        rollbackProb: feasibility.rollbackProbability,
    });

    // ── Stage 4: Select strategy ──────────────────────────────────────
    const stratResult = ss.select(plan, feasibility, simResult);
    cs.store(executionId, "select_strategy", {
        status:   "complete",
        strategy: stratResult.strategy,
        reason:   stratResult.reason,
    });
    hooks.emit("strategy_selected", { executionId, strategy: stratResult.strategy, reason: stratResult.reason });

    // ── Stage 5: Pre-execution verification ───────────────────────────
    const verifyResult = await pev.verify(plan, context);
    cs.store(executionId, "verify", {
        status:        "complete",
        passed:        verifyResult.passed,
        failures:      verifyResult.failures.length,
        rollbackReady: stratResult.strategy === "rollback_first",
    });
    hooks.emit("verification_completed", { executionId, passed: verifyResult.passed });

    // ── Stage 6: Approve / Block ──────────────────────────────────────
    const blockDecision = eb.shouldBlock(plan, feasibility, simResult);

    if (!verifyResult.passed) {
        const vBlock = eb.shouldBlockVerification(verifyResult);
        if (vBlock.blocked) {
            blockDecision.blocked = true;
            blockDecision.reasons = [...blockDecision.reasons, ...vBlock.reasons];
        }
    }

    em.record(executionId, {
        strategy:            stratResult.strategy,
        feasibilityScore:    feasibility.feasibility,
        simBlockers:         simResult.blockers,
        repairProbability:   feasibility.repairProbability,
        rollbackProbability: feasibility.rollbackProbability,
        confidence:          feasibility.confidence,
    });

    if (blockDecision.blocked) {
        cs.store(executionId, "approve", {
            status:     "blocked",
            reasons:    blockDecision.reasons,
            confidence: feasibility.confidence,
        });
        hooks.emit("execution_blocked", { executionId, reasons: blockDecision.reasons });

        audit.record(executionId, {
            taskId:              task.id,
            executionPath:       cs.list(executionId).map(c => c.stage),
            strategyChosen:      stratResult.strategy,
            blockingReasons:     blockDecision.reasons,
            verificationResults: verifyResult,
            ts:                  new Date().toISOString(),
        });

        return {
            executionId,
            approved:     false,
            blocked:      true,
            blockReasons: blockDecision.reasons,
            strategy:     stratResult.strategy,
            checkpoints:  _collectCheckpoints(executionId),
            metadata:     em.get(executionId),
            auditId:      executionId,
        };
    }

    cs.store(executionId, "approve", {
        status:        "approved",
        strategy:      stratResult.strategy,
        confidence:    feasibility.confidence,
        rollbackReady: stratResult.strategy === "rollback_first",
    });
    hooks.emit("execution_approved", { executionId, strategy: stratResult.strategy });

    // ── Stage 7: Route + execute ──────────────────────────────────────
    const routeConf  = sr.routeConfig(stratResult.strategy);
    const execResult = _simulateExecution(plan, stratResult.strategy, routeConf);

    cs.store(executionId, "execute", {
        status:   "complete",
        strategy: stratResult.strategy,
        dryRun:   routeConf.dryRun,
        steps:    execResult.stepsExecuted.length,
    });

    audit.record(executionId, {
        taskId:              task.id,
        executionPath:       cs.list(executionId).map(c => c.stage),
        strategyChosen:      stratResult.strategy,
        blockingReasons:     [],
        verificationResults: verifyResult,
        ts:                  new Date().toISOString(),
    });

    return {
        executionId,
        approved:     true,
        blocked:      false,
        blockReasons: [],
        strategy:     stratResult.strategy,
        checkpoints:  _collectCheckpoints(executionId),
        metadata:     em.get(executionId),
        auditId:      executionId,
        result:       execResult,
    };
}

// ── reset ─────────────────────────────────────────────────────────────
// Resets pipeline sequence and all sub-module state.

function reset() {
    _seq = 0;
    cs.reset();
    em.reset();
    hooks.reset();
    audit.reset();
}

module.exports = { run, reset };
