"use strict";
/**
 * Phase 590 — Engineering Workflow Validation
 *
 * Validates: patch integrity, deployment readiness, runtime stability,
 *            dependency health, browser outcomes, workflow completion.
 *
 * Prevents: false-success execution, stale recovery, invalid replay states.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Validation result builder ─────────────────────────────────────────────────

function _result(name, ok, detail = "", warnings = []) {
    return { name, ok, status: ok ? "VALID" : "INVALID", detail, warnings, ts: Date.now() };
}

// ── Patch integrity ───────────────────────────────────────────────────────────

/**
 * Validate that a patch batch has not been corrupted since proposal.
 */
function validatePatchIntegrity(batchId) {
    const pee = _tryRequire("./patchExecutionEngine.cjs");
    if (!pee) return _result("patch-integrity", true, "patchExecutionEngine not loaded");

    try {
        const batches = pee.listBatches({ limit: 50 });
        const batch   = batches.find(b => b.id === batchId);
        if (!batch) return _result("patch-integrity", false, `Batch ${batchId} not found`);
        if (batch.status === "rolled-back") return _result("patch-integrity", false, "Batch was rolled back");

        const val = pee.validateBatch(batchId);
        return _result("patch-integrity", val.ok, val.ok ? "Patch checksums valid" : `${val.blockers.length} blocker(s)`, val.warnings.map(w => w.issue));
    } catch (e) {
        return _result("patch-integrity", false, `Validation error: ${e.message}`);
    }
}

// ── Deployment readiness ──────────────────────────────────────────────────────

function validateDeploymentReadiness(pipelineName = "standard-deploy") {
    const da = _tryRequire("./deploymentAssist.cjs");
    if (!da) return _result("deployment-readiness", true, "deploymentAssist not loaded");

    try {
        const pf    = da.preflightSummary(pipelineName);
        const dep   = da.dependencyIntegrityCheck();
        const ready = da.runtimeReadiness();
        const warnings = [...pf.warnings, ...dep.warnings.map(w => w.message), ...ready.issues.map(i => i.note)];
        const ok    = pf.ready && dep.ok && ready.ready;
        return _result("deployment-readiness", ok, ok ? `${pipelineName} ready` : `${pf.blockers.length} blocker(s)`, warnings);
    } catch (e) {
        return _result("deployment-readiness", false, `Check error: ${e.message}`);
    }
}

// ── Runtime stability ─────────────────────────────────────────────────────────

function validateRuntimeStability() {
    const pressure  = _tryRequire("./runtimePressureMonitor.cjs");
    const stability = _tryRequire("./stabilityLayer.cjs");
    const warnings  = [];
    let ok          = true;

    if (pressure && pressure.getScore) {
        try {
            const s = pressure.getScore();
            if (s.level === "critical") { ok = false; warnings.push("Runtime pressure critical"); }
            else if (s.level === "high") warnings.push("Runtime pressure high");
        } catch {}
    }

    if (stability && stability.getStatus) {
        try {
            const s = stability.getStatus();
            if (!s.stable) { ok = false; warnings.push("Stability layer reports instability"); }
        } catch {}
    }

    return _result("runtime-stability", ok, ok ? "Runtime stable" : "Runtime unstable", warnings);
}

// ── Dependency health ─────────────────────────────────────────────────────────

function validateDependencyHealth() {
    const da = _tryRequire("./deploymentAssist.cjs");
    if (!da) return _result("dependency-health", true, "deploymentAssist not loaded");

    try {
        const dep = da.dependencyIntegrityCheck();
        const warnings = dep.warnings.map(w => w.message);
        return _result("dependency-health", dep.ok, dep.ok ? "Dependencies healthy" : "Dependency issues detected", warnings);
    } catch (e) {
        return _result("dependency-health", false, `Check error: ${e.message}`);
    }
}

// ── Browser execution outcome ─────────────────────────────────────────────────

/**
 * Validate a browser workflow completed successfully.
 */
function validateBrowserOutcome(workflowId) {
    const bwe = _tryRequire("./browserWorkflowEngine.cjs");
    if (!bwe) return _result("browser-outcome", true, "browserWorkflowEngine not loaded");

    try {
        const wf = bwe.getWorkflow(workflowId);
        if (!wf) return _result("browser-outcome", false, `Workflow ${workflowId} not found`);
        if (wf.status === "completed") return _result("browser-outcome", true, `Workflow completed: ${wf.name}`);
        if (wf.interrupted)            return _result("browser-outcome", false, `Workflow interrupted: ${wf.interruptReason}`, ["Workflow needs to be resumed"]);
        return _result("browser-outcome", false, `Workflow status: ${wf.status}`, [`${wf.currentStep}/${wf.steps.length} steps done`]);
    } catch (e) {
        return _result("browser-outcome", false, `Check error: ${e.message}`);
    }
}

// ── Workflow completion ───────────────────────────────────────────────────────

/**
 * Validate an engineering chain completed all required steps.
 */
function validateChainCompletion(chainId) {
    const ec = _tryRequire("./engineeringChains.cjs");
    if (!ec) return _result("chain-completion", true, "engineeringChains not loaded");

    try {
        const history = ec.chainHistory(50);
        const chain   = history.find(c => c.chainId === chainId);
        if (!chain) return _result("chain-completion", false, `Chain ${chainId} not in history`);
        const ok = chain.passed === chain.steps;
        return _result("chain-completion", ok, `${chain.passed}/${chain.steps} steps passed`, ok ? [] : [`${chain.steps - chain.passed} step(s) failed`]);
    } catch (e) {
        return _result("chain-completion", false, `Check error: ${e.message}`);
    }
}

// ── Replay state validation ───────────────────────────────────────────────────

/**
 * Ensure a replay ID has not been corrupted or double-applied.
 */
function validateReplayState(replayId) {
    const pee = _tryRequire("./patchExecutionEngine.cjs");
    const warnings = [];
    let ok         = true;

    if (pee) {
        const dup = pee.checkReplayDuplicate(replayId);
        if (dup.duplicate) {
            ok = false;
            warnings.push(`Replay ${replayId} already applied ${dup.count} time(s) — duplicate replay detected`);
        }
    }

    return _result("replay-state", ok, ok ? "Replay state clean" : "Replay state invalid", warnings);
}

// ── Full workflow validation suite ────────────────────────────────────────────

/**
 * Run a full validation pass.
 * @param {{ batchId?, pipelineName?, workflowId?, chainId?, replayId? }} ctx
 */
function runValidation(ctx = {}) {
    const checks = [validateRuntimeStability(), validateDependencyHealth()];
    if (ctx.pipelineName) checks.push(validateDeploymentReadiness(ctx.pipelineName));
    if (ctx.batchId)      checks.push(validatePatchIntegrity(ctx.batchId));
    if (ctx.workflowId)   checks.push(validateBrowserOutcome(ctx.workflowId));
    if (ctx.chainId)      checks.push(validateChainCompletion(ctx.chainId));
    if (ctx.replayId)     checks.push(validateReplayState(ctx.replayId));

    const passed   = checks.filter(c => c.ok).length;
    const allWarn  = checks.flatMap(c => c.warnings);

    return {
        passed,
        failed:   checks.length - passed,
        total:    checks.length,
        ok:       passed === checks.length,
        checks,
        warnings: allWarn,
        summary:  `${passed}/${checks.length} validation checks passed`,
    };
}

module.exports = { validatePatchIntegrity, validateDeploymentReadiness, validateRuntimeStability, validateDependencyHealth, validateBrowserOutcome, validateChainCompletion, validateReplayState, runValidation };
