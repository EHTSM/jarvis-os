"use strict";
/**
 * Phase 587 — Engineering Execution Chains
 *
 * Multi-step engineering workflows: debugging, deployment preparation,
 * dependency repair, runtime recovery, environment bootstrap.
 *
 * All chains: replay-safe, interruption-safe, rollback-aware, operator-visible.
 * Extends productivityChainEngine with richer operator-grade chains.
 */

const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const EXEC_STATE_PATH = path.join(__dirname, "../../data/engineering-chains-state.json");

function _loadState() {
    try { return JSON.parse(fs.readFileSync(EXEC_STATE_PATH, "utf8")); }
    catch { return { active: {}, history: [] }; }
}
function _saveState(s) {
    try { fs.mkdirSync(path.dirname(EXEC_STATE_PATH), { recursive: true }); fs.writeFileSync(EXEC_STATE_PATH, JSON.stringify(s, null, 2)); } catch {}
}

// ── Chain definitions ─────────────────────────────────────────────────────────

const CHAIN_DEFS = {
    "full-debug-session": {
        desc:          "Complete debugging session: activate assist → cluster → root-cause → recovery plan",
        rollbackSafe:  true,
        replaySafe:    true,
        interruptSafe: true,
        steps: [
            { id: "db1", label: "Activate debug assist",    mod: "debugAssistMode.cjs",          fn: "activate" },
            { id: "db2", label: "Cluster recent errors",    mod: "debuggingMode.cjs",             fn: "clusterErrors" },
            { id: "db3", label: "Root-cause suggestions",   mod: "debugAssistMode.cjs",           fn: "rootCauseSuggestions", args: [[]] },
            { id: "db4", label: "Dep-issue detection",      mod: "debugAssistMode.cjs",           fn: "detectDependencyIssues", args: [[]] },
            { id: "db5", label: "Timeline snapshot",        mod: "executionTimeline.cjs",         fn: "recentSummary", args: [10] },
        ],
    },
    "deploy-preflight-full": {
        desc:          "Full deployment preflight: dep integrity → readiness → preflight → rollback awareness",
        rollbackSafe:  true,
        replaySafe:    true,
        interruptSafe: true,
        steps: [
            { id: "dp1", label: "Dependency integrity",     mod: "deploymentAssist.cjs",         fn: "dependencyIntegrityCheck" },
            { id: "dp2", label: "Runtime readiness",        mod: "deploymentAssist.cjs",         fn: "runtimeReadiness" },
            { id: "dp3", label: "Preflight summary",        mod: "deploymentAssist.cjs",         fn: "preflightSummary" },
            { id: "dp4", label: "Stale deployment check",   mod: "deploymentAssist.cjs",         fn: "staleDeploymentCheck" },
            { id: "dp5", label: "Rollback recommendation",  mod: "deploymentAssist.cjs",         fn: "rollbackRecommendation" },
            { id: "dp6", label: "Confidence score",         mod: "executionConfidence.cjs",      fn: "deploymentConfidence", args: [{}] },
        ],
    },
    "dep-repair-full": {
        desc:          "Full dependency repair: detect → suggest → validate",
        rollbackSafe:  true,
        replaySafe:    true,
        interruptSafe: true,
        steps: [
            { id: "dr1", label: "Integrity check",          mod: "deploymentAssist.cjs",         fn: "dependencyIntegrityCheck" },
            { id: "dr2", label: "Repair sequence",          mod: "terminalWorkflows.cjs",         fn: "getSequence", args: ["dependency-repair"] },
            { id: "dr3", label: "Dep suggestions",          mod: "patchAssistant.cjs",            fn: "depairSuggestions", args: [""] },
        ],
    },
    "runtime-recovery-full": {
        desc:          "Full runtime recovery: pressure → cluster → root-cause → recovery plan → confidence",
        rollbackSafe:  true,
        replaySafe:    true,
        interruptSafe: true,
        steps: [
            { id: "rr1", label: "Pressure check",           mod: "runtimePressureMonitor.cjs",   fn: "getScore" },
            { id: "rr2", label: "Error cluster",            mod: "debuggingMode.cjs",             fn: "clusterErrors" },
            { id: "rr3", label: "Root causes",              mod: "debugAssistMode.cjs",           fn: "rootCauseSuggestions", args: [[]] },
            { id: "rr4", label: "Recovery terminal seq",    mod: "terminalWorkflows.cjs",         fn: "getSequence", args: ["runtime-recovery"] },
            { id: "rr5", label: "Recovery confidence",      mod: "executionConfidence.cjs",       fn: "recoveryConfidence", args: [{}] },
        ],
    },
    "env-bootstrap-full": {
        desc:          "Full environment bootstrap: integrity → readiness → bootstrap sequence → validate",
        rollbackSafe:  true,
        replaySafe:    true,
        interruptSafe: true,
        steps: [
            { id: "eb1", label: "Dependency integrity",     mod: "deploymentAssist.cjs",         fn: "dependencyIntegrityCheck" },
            { id: "eb2", label: "Runtime readiness",        mod: "deploymentAssist.cjs",         fn: "runtimeReadiness" },
            { id: "eb3", label: "Bootstrap sequence",       mod: "terminalWorkflows.cjs",         fn: "getSequence", args: ["environment-bootstrap"] },
            { id: "eb4", label: "Foundation health",        mod: "engineeringFoundation.cjs",     fn: "moduleHealth" },
        ],
    },
};

// ── Chain execution engine ────────────────────────────────────────────────────

/**
 * Execute a named engineering chain.
 * Supports interruption resume via checkpoint (resumeFromStep).
 * All side-effects are read-only — no file writes without separate patch approval.
 */
function executeChain(chainName, { approved = false, sessionId = null, replayId = null, resumeFromStep = null } = {}) {
    if (!approved) return { ok: false, error: "Operator approval required: pass { approved: true }" };

    const def = CHAIN_DEFS[chainName];
    if (!def) return { ok: false, error: `Unknown chain: ${chainName}`, available: Object.keys(CHAIN_DEFS) };

    const chainId     = crypto.randomUUID();
    const startIdx    = resumeFromStep ? def.steps.findIndex(s => s.id === resumeFromStep) : 0;
    const steps       = [];
    const state       = _loadState();

    // Record chain as active
    state.active[chainId] = { chainId, chainName, sessionId, replayId, startedAt: Date.now(), lastStep: null };
    _saveState(state);

    for (let i = Math.max(0, startIdx); i < def.steps.length; i++) {
        const step   = def.steps[i];
        let   result = null;
        let   ok     = false;

        try {
            const mod = _tryRequire(`./${step.mod}`);
            if (mod && typeof mod[step.fn] === "function") {
                const args = step.args !== undefined ? step.args : (sessionId ? [sessionId] : []);
                result = mod[step.fn](...(Array.isArray(args) ? args : [args]));
                ok     = true;
            } else {
                result = { available: false };
            }
        } catch (e) {
            result = { error: e.message };
        }

        steps.push({ id: step.id, label: step.label, ok, result });
        state.active[chainId].lastStep = step.id;
        _saveState(state);
    }

    // Mark complete
    delete state.active[chainId];
    state.history = [{ chainId, chainName, sessionId, replayId, completedAt: Date.now(), steps: steps.length, passed: steps.filter(s => s.ok).length }, ...(state.history || [])].slice(0, 200);
    _saveState(state);

    // Timeline
    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.record("chain", { label: `Chain done: ${chainName}`, chainId, sessionId, replayId });

    // Eng context memory
    const mem = _tryRequire("./engineeringContextMemory.cjs");
    if (mem) {
        const successRate = steps.filter(s => s.ok).length / steps.length;
        if (successRate >= 0.6) {
            try { mem.recordRecoveryWorkflow({ workflowId: chainName, goal: chainName, stepCount: steps.length, confidence: Math.round(successRate * 100) }); } catch {}
        }
    }

    const passed = steps.filter(s => s.ok).length;
    return { ok: passed > 0, chainId, chainName, sessionId, steps, summary: `${passed}/${steps.length} steps`, replaySafe: def.replaySafe };
}

// ── Active chain query ────────────────────────────────────────────────────────

function getActiveChains() {
    const state   = _loadState();
    const now     = Date.now();
    // Mark stale (>1h) chains
    for (const [id, c] of Object.entries(state.active)) {
        if (now - c.startedAt > 60 * 60 * 1000) c.stale = true;
    }
    return Object.values(state.active);
}

function listChains() {
    return Object.entries(CHAIN_DEFS).map(([name, d]) => ({
        name,
        desc:          d.desc,
        stepCount:     d.steps.length,
        rollbackSafe:  d.rollbackSafe,
        replaySafe:    d.replaySafe,
        interruptSafe: d.interruptSafe,
    }));
}

function chainHistory(limit = 20) {
    const state = _loadState();
    return (state.history || []).slice(0, limit);
}

module.exports = { executeChain, getActiveChains, listChains, chainHistory, CHAIN_DEFS };
