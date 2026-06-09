"use strict";
/**
 * Phase 579 — AI Productivity Chains
 *
 * Replayable, operator-approved, interruption-safe productivity chains.
 * Chain types: debugging startup, environment bootstrap, deployment preparation,
 *              dependency verification, runtime stabilization.
 *
 * All chains require operator approval. Chains are recorded to replay memory.
 */

const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Chain catalog ─────────────────────────────────────────────────────────────

const CHAIN_CATALOG = {
    "debug-startup": {
        description: "Start a debugging session with full context loading",
        steps: [
            { id: "s1", action: "activate-debug-assist",  module: "debugAssistMode.cjs",   fn: "activate",          params: {}, note: "Activate debugging assist mode" },
            { id: "s2", action: "dashboard-snapshot",     module: "operatorDashboard.cjs",  fn: "snapshot",          params: {}, note: "Capture current dashboard state" },
            { id: "s3", action: "pressure-check",         module: "runtimePressureMonitor.cjs", fn: "getScore",      params: {}, note: "Check runtime pressure" },
            { id: "s4", action: "cluster-errors",         module: "debuggingMode.cjs",      fn: "clusterErrors",     params: {}, note: "Cluster recent errors" },
            { id: "s5", action: "suggest-recovery",       module: "debugAssistMode.cjs",    fn: "rootCauseSuggestions", params: {}, note: "Generate root-cause suggestions" },
        ],
        replayable: true,
        interruptSafe: true,
    },
    "env-bootstrap": {
        description: "Verify and bootstrap the runtime environment",
        steps: [
            { id: "s1", action: "check-dependencies",    module: "deploymentAssist.cjs",   fn: "dependencyIntegrityCheck", params: {}, note: "Check dependency integrity" },
            { id: "s2", action: "runtime-readiness",     module: "deploymentAssist.cjs",   fn: "runtimeReadiness",         params: {}, note: "Check runtime readiness" },
            { id: "s3", action: "suggest-terminal-seq",  module: "terminalWorkflows.cjs",  fn: "getSequence", params: { name: "environment-bootstrap" }, note: "Suggest bootstrap command sequence" },
        ],
        replayable: true,
        interruptSafe: true,
    },
    "deploy-preparation": {
        description: "Full pre-deployment preparation workflow",
        steps: [
            { id: "s1", action: "dependency-check",      module: "deploymentAssist.cjs",   fn: "dependencyIntegrityCheck", params: {}, note: "Dependency integrity check" },
            { id: "s2", action: "runtime-readiness",     module: "deploymentAssist.cjs",   fn: "runtimeReadiness",         params: {}, note: "Runtime readiness check" },
            { id: "s3", action: "preflight",             module: "deploymentAssist.cjs",   fn: "preflightSummary",         params: {}, note: "Run preflight validation" },
            { id: "s4", action: "stale-check",           module: "deploymentAssist.cjs",   fn: "staleDeploymentCheck",     params: {}, note: "Check for stale deployment states" },
            { id: "s5", action: "rollback-awareness",    module: "deploymentAssist.cjs",   fn: "rollbackRecommendation",   params: {}, note: "Assess rollback readiness" },
        ],
        replayable: true,
        interruptSafe: true,
    },
    "dependency-verification": {
        description: "Verify all runtime dependencies are healthy",
        steps: [
            { id: "s1", action: "integrity-check",       module: "deploymentAssist.cjs",   fn: "dependencyIntegrityCheck", params: {}, note: "Run integrity check" },
            { id: "s2", action: "terminal-repair-seq",   module: "terminalWorkflows.cjs",  fn: "getSequence", params: { name: "dependency-repair" }, note: "Get repair sequence if needed" },
        ],
        replayable: true,
        interruptSafe: true,
    },
    "runtime-stabilization": {
        description: "Stabilize a degraded runtime environment",
        steps: [
            { id: "s1", action: "pressure-check",        module: "runtimePressureMonitor.cjs", fn: "getScore",      params: {}, note: "Measure runtime pressure" },
            { id: "s2", action: "cluster-errors",        module: "debuggingMode.cjs",      fn: "clusterErrors",     params: {}, note: "Identify error clusters" },
            { id: "s3", action: "root-causes",           module: "debugAssistMode.cjs",    fn: "rootCauseSuggestions", params: {}, note: "Identify root causes" },
            { id: "s4", action: "recovery-sequence",     module: "terminalWorkflows.cjs",  fn: "getSequence", params: { name: "runtime-recovery" }, note: "Get recovery command sequence" },
            { id: "s5", action: "confidence-score",      module: "executionConfidence.cjs", fn: "recoveryConfidence", params: {}, note: "Score recovery confidence" },
        ],
        replayable: true,
        interruptSafe: true,
    },
};

// ── Chain execution ───────────────────────────────────────────────────────────

/**
 * Execute a named chain. Each step calls the relevant module's fn.
 * Interruption-safe: records checkpoint after each completed step.
 * Returns { ok, chainId, steps: [{ id, action, result, ok }], summary }
 */
function executeChain(chainName, { approved = false, sessionId = null, resumeFromStep = null } = {}) {
    if (!approved) return { ok: false, error: "Operator approval required: pass { approved: true }" };

    const def = CHAIN_CATALOG[chainName];
    if (!def) return { ok: false, error: `Unknown chain: ${chainName}`, available: Object.keys(CHAIN_CATALOG) };

    const chainId  = crypto.randomUUID();
    const steps    = [];
    const startIdx = resumeFromStep ? def.steps.findIndex(s => s.id === resumeFromStep) : 0;

    for (let i = startIdx; i < def.steps.length; i++) {
        const step   = def.steps[i];
        let result   = null;
        let stepOk   = false;

        try {
            const mod = _tryRequire(`./${step.module}`);
            if (mod && typeof mod[step.fn] === "function") {
                const arg = step.params?.name ? step.params.name : (sessionId || undefined);
                result  = mod[step.fn](arg);
                stepOk  = true;
            } else {
                result = { available: false, note: `${step.module}::${step.fn} not accessible` };
                stepOk = false;
            }
        } catch (e) {
            result = { error: e.message };
            stepOk = false;
        }

        steps.push({ id: step.id, action: step.action, note: step.note, ok: stepOk, result });

        // Checkpoint after each step for interruption safety
        _saveCheckpoint(chainId, chainName, step.id, sessionId);
    }

    // Record to context memory
    const ctxMem = _tryRequire("./engineeringContextMemory.cjs");
    if (ctxMem) {
        try {
            ctxMem.recordOutcome({
                sessionId,
                goal:          `chain:${chainName}`,
                successRate:   steps.filter(s => s.ok).length / steps.length,
                workflowCount: steps.length,
            });
        } catch {}
    }

    const successCount = steps.filter(s => s.ok).length;
    return {
        ok:        successCount > 0,
        chainId,
        chainName,
        steps,
        summary:   `${successCount}/${steps.length} steps completed`,
        replayable: def.replayable,
    };
}

const _checkpoints = new Map();
function _saveCheckpoint(chainId, chainName, lastStepId, sessionId) {
    _checkpoints.set(chainId, { chainId, chainName, lastStepId, sessionId, savedAt: Date.now() });
}

function listChains() {
    return Object.entries(CHAIN_CATALOG).map(([name, def]) => ({
        name,
        description:   def.description,
        stepCount:     def.steps.length,
        replayable:    def.replayable,
        interruptSafe: def.interruptSafe,
    }));
}

function getChain(name) {
    const def = CHAIN_CATALOG[name];
    if (!def) return null;
    return { name, ...def };
}

module.exports = { executeChain, listChains, getChain, CHAIN_CATALOG };
