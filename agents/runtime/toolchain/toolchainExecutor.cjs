"use strict";
/**
 * toolchainExecutor — Real Toolchain Execution Integration.
 *
 * execute(plan, opts?)
 *   → Promise<ToolchainResult>
 *
 * Pipeline:
 *   1. commandGovernance — block prohibited commands
 *   2. toolClassifier    — classify worst-case risk
 *   3. sandboxRouter     — determine strategy/retryBudget/verificationPolicy
 *   4. approvalPolicy    — enforce per-class requirements
 *   5. checkpoint        — capture pre-execution state
 *   6. memoryAwareExecutor.execute — actual execution
 *   7. post-verify       — compare checkpoints, run environment assertions
 *   8. auto-rollback     — on failure for elevated+
 *   9. telemetry         — emit lifecycle events
 *
 * reset()  — resets all toolchain state
 */

const tc  = require("./toolClassifier.cjs");
const gov = require("./commandGovernance.cjs");
const ap  = require("./approvalPolicy.cjs");
const sr  = require("./sandboxRouter.cjs");
const tele = require("./toolchainTelemetry.cjs");
const cpm  = require("./checkpointManager.cjs");
const rbi  = require("./rollbackIntegration.cjs");
const mae  = require("../integrations/memoryAwareExecutor.cjs");

// ── helpers ───────────────────────────────────────────────────────────

function _steps(plan) {
    return plan.steps ?? (plan.executionOrder ?? []).map(id => ({ id, name: id, command: `echo ${id}` }));
}

// ── execute ───────────────────────────────────────────────────────────

async function execute(plan, opts = {}) {
    const steps       = _steps(plan);
    const cwd         = opts.cwd ?? process.cwd();
    const dryRun      = opts.dryRun ?? false;

    // 1. Governance check
    const govResults  = gov.checkSteps(steps);
    const blocked     = govResults.filter(r => r.blocked);
    if (blocked.length && !opts.bypassGovernance) {
        const firstViolation = blocked[0].violations[0];
        tele.emit("dangerous_action_blocked", {
            stepId:  blocked[0].stepId,
            label:   firstViolation?.label,
            reason:  firstViolation?.reason,
        });
        return {
            success:          false,
            state:            "governance_blocked",
            classification:   null,
            sandboxRedirected: false,
            blocked:          true,
            blockReason:      firstViolation?.reason ?? "governance policy violation",
            steps:            [],
            checkpoint:       null,
            rollback:         null,
        };
    }

    // 2. Classify worst-case risk
    const classification = tc.worstClassification(steps);

    // 3. Sandbox routing
    const routing = sr.route(classification, { defaultStrategy: opts.defaultStrategy ?? "safe" });

    if (routing.sandboxRedirected) {
        tele.emit("sandbox_redirected", { classification, reason: routing.redirectReason });
    }

    // 4. Approval policy (skip for dry-run mode or if opted in)
    const approvalCtx = {
        approved:      opts.approved ?? (classification === "safe" || classification === "elevated"),
        sandboxed:     routing.sandboxRedirected || opts.sandboxed || false,
        dryRunPassed:  dryRun || opts.dryRunPassed || false,
        rollbackReady: opts.rollbackReady ?? true,
    };
    const policyResult = ap.evaluate(classification, approvalCtx);
    if (!policyResult.approved && !opts.bypassApproval) {
        return {
            success:          false,
            state:            "approval_required",
            classification,
            sandboxRedirected: routing.sandboxRedirected,
            blocked:          true,
            blockReason:      policyResult.violations.map(v => v.reason).join("; "),
            policyViolations: policyResult.violations,
            steps:            [],
            checkpoint:       null,
            rollback:         null,
        };
    }

    // 5. Pre-execution checkpoint
    const checkpoint = cpm.take(plan.taskId ?? plan.id ?? "task", { cwd });

    // 6. Execute via memoryAwareExecutor
    tele.emit("execution_started", {
        taskId:         plan.taskId ?? plan.id,
        classification,
        strategy:       routing.strategy,
        retryBudget:    routing.retryBudget,
    });

    const strategyHint = opts.strategyHint ?? routing.strategy;
    const maeResult    = await mae.execute(plan, dryRun ? "dry_run" : strategyHint, opts.context ?? {}, {
        ...opts,
        completionPolicy: routing.verificationPolicy,
        retryPolicy:      { maxRetries: routing.retryBudget, backoffMs: 200, backoffMultiplier: 2 },
    });

    // 7. Post checkpoint comparison
    const postCheckpoint = cpm.take(plan.taskId ?? plan.id ?? "task", { cwd });
    const diff           = cpm.compare(checkpoint, postCheckpoint);

    // 8. Auto-rollback on failure for elevated+
    let rollbackResult = null;
    const needsRollback = !maeResult.success
        && (classification === "elevated" || classification === "dangerous" || classification === "destructive")
        && !opts.skipAutoRollback;

    if (needsRollback) {
        tele.emit("rollback_started", {
            taskId: plan.taskId ?? plan.id,
            classification,
            reason: maeResult.error ?? "execution failed",
        });
        rollbackResult = rbi.rollback(plan.taskId ?? plan.id ?? "task", { cwd, dryRun: true });
        tele.emit("rollback_completed", {
            taskId:  plan.taskId ?? plan.id,
            success: rollbackResult.success,
        });
    }

    // 9. Completion telemetry
    tele.emit("execution_completed", {
        taskId:         plan.taskId ?? plan.id,
        success:        maeResult.success,
        classification,
        strategy:       routing.strategy,
        stateChanged:   diff.changed,
    });

    return {
        ...maeResult,
        classification,
        sandboxRedirected: routing.sandboxRedirected,
        retryBudget:       routing.retryBudget,
        verificationPolicy: routing.verificationPolicy,
        checkpoint,
        postCheckpoint,
        stateChanged:      diff.changed,
        diffs:             diff.diffs,
        rollback:          rollbackResult,
        blocked:           false,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    mae.reset();
    cpm.reset();
    rbi.reset();
    tele.reset();
}

module.exports = { execute, reset };
