"use strict";
/**
 * memoryAwareExecutor — experience-driven autonomous execution wrapper.
 *
 * execute(plan, strategyHint?, context?, opts?)
 *   → Promise<ExecutionResult & { _integration: IntegrationMetadata }>
 *
 * Wraps agents/runtime/execution/runtimeExecutor.execute() with:
 *   • Pre:  fingerprint → memory lookup → danger check → strategy/retry selection → confidence
 *   • Exec: runtimeExecutor (unchanged)
 *   • Post: hallucination detection → verification → completion policy → trust score →
 *           dep tracking → memory recording → integrity snapshot → telemetry
 *
 * opts (in addition to runtimeExecutor opts):
 *   strategyHint        — override strategy selection
 *   forceExecute        — skip danger checks
 *   sandboxRequired     — force sandbox strategy
 *   completionPolicy    — 'strict'|'lenient'|'disabled' (default lenient)
 *   expectedOutput      — passed to verifyOutput
 *   requiredArtifacts   — paths checked by hallucinationDetector
 *   taskId              — stored in memory entry
 *   rejectThreshold     — consecutive-failure count before blocking (default 3)
 *   includeGit          — include git status in integrity snapshot (default false)
 *
 * reset()  — resets all integration state (memory, telemetry, snapshots, deps, decay)
 */

const re   = require("../execution/runtimeExecutor.cjs");
const lc   = require("./executionLifecycle.cjs");
const mem  = require("../memory/executionMemoryStore.cjs");
const dst  = require("../memory/dependencyStabilityTracker.cjs");
const ttele = require("../trust/trustTelemetry.cjs");
const isn  = require("../trust/integritySnapshot.cjs");
const td   = require("../trust/trustDecay.cjs");

// ── _buildBlockedResult ───────────────────────────────────────────────

function _buildBlockedResult(plan, preCtx) {
    return {
        executionId:       `blocked-${plan.taskId ?? plan.id ?? "task"}`,
        success:           false,
        state:             "blocked",
        strategy:          null,
        steps:             [],
        stepsPlanned:      plan.executionOrder ?? [],
        stepsExecuted:     [],
        totalDurationMs:   0,
        rollbackTriggered: false,
        cancelled:         false,
        error:             preCtx.reason ?? "blocked by memory safety policy",
        completedAt:       new Date().toISOString(),
        mode:              null,
        dryRun:            false,
        isolated:          false,
        rollbackReady:     false,
        checkpointed:      false,
        simulatedOnly:     false,
        _integration: {
            fingerprint:   preCtx.fingerprint,
            strategy:      null,
            confidence:    0,
            trustScore:    0,
            trustGrade:    "F",
            hallucination: { safe: true, detections: [], severity: "none" },
            verification:  { verified: false, issues: ["execution blocked before start"] },
            completion:    { enforced: true, passed: false, finalState: "blocked", reasons: [preCtx.reason ?? "blocked"] },
            retryPolicy:   null,
            analytics:     null,
            blocked:       true,
        },
    };
}

// ── execute ───────────────────────────────────────────────────────────

async function execute(plan, strategyHint = null, context = {}, opts = {}) {
    const entries = mem.getAll();
    const depStab = dst.getAll();

    // ── Pre-execution ──────────────────────────────────────────────────
    const preCtx = lc.preExecution(plan, entries, depStab, {
        strategyHint,
        sandboxRequired:          opts.sandboxRequired           ?? false,
        forceExecute:             opts.forceExecute              ?? false,
        rejectThreshold:          opts.rejectThreshold           ?? 3,
        consecutiveFailThreshold: opts.consecutiveFailThreshold  ?? 3,
    });

    if (preCtx.blocked) {
        ttele.emit("trust_decrease", { fingerprint: preCtx.fingerprint, reason: "blocked", confidence: 0 });
        return _buildBlockedResult(plan, preCtx);
    }

    ttele.emit("trust_increase", {
        fingerprint: preCtx.fingerprint,
        confidence:  preCtx.confidence,
        strategy:    preCtx.strategy,
        phase:       "pre_execution",
    });

    // ── Execute ────────────────────────────────────────────────────────
    const result = await re.execute(plan, preCtx.strategy, context, {
        ...opts,
        retryPolicy: preCtx.retryPolicy,
    });

    // ── Post-execution ─────────────────────────────────────────────────
    const post = lc.postExecution(result, preCtx, {
        taskId:             opts.taskId            ?? plan.taskId ?? plan.id ?? null,
        completionPolicy:   opts.completionPolicy  ?? "lenient",
        expectedOutput:     opts.expectedOutput    ?? null,
        requiredArtifacts:  opts.requiredArtifacts ?? [],
        plan,
    });

    // Persist dep stability updates
    for (const { depId, type } of post.depUpdates) {
        dst.record(depId, { type });
    }

    // Apply trust decay on failure
    if (!post.completion.passed) {
        td.addFailure(preCtx.fingerprint, "workflow");
    }

    // Persist memory entry
    mem.record(post.memoryEntry);

    // Integrity snapshot (skip git by default to keep tests fast)
    isn.snapshot(result.executionId, {
        cwd:        opts.cwd       ?? process.cwd(),
        includeGit: opts.includeGit ?? false,
    });

    // Trust telemetry
    if (post.completion.passed) {
        ttele.emit("trust_increase",       { fingerprint: preCtx.fingerprint, score: post.trustScore.score });
        ttele.emit("verification_success", { fingerprint: preCtx.fingerprint });
    } else {
        ttele.emit("trust_decrease",       { fingerprint: preCtx.fingerprint, score: post.trustScore.score });
        ttele.emit("verification_failure", { fingerprint: preCtx.fingerprint, issues: post.verification.issues });
    }

    if (!post.hallucination.safe) {
        ttele.emit("hallucination_detected", {
            fingerprint: preCtx.fingerprint,
            detections:  post.hallucination.detections,
            severity:    post.hallucination.severity,
        });
    }

    return {
        ...result,
        _integration: {
            fingerprint:   preCtx.fingerprint,
            strategy:      preCtx.strategy,
            confidence:    post.calibrated.confidence,
            trustScore:    post.trustScore.score,
            trustGrade:    post.trustScore.grade,
            hallucination: post.hallucination,
            verification:  post.verification,
            completion:    post.completion,
            retryPolicy:   preCtx.retryPolicy,
            analytics:     post.analytics,
            blocked:       false,
        },
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    mem.reset();
    dst.reset();
    ttele.reset();
    isn.reset();
    td.resetDecay();
    re.reset();
}

module.exports = { execute, reset };
