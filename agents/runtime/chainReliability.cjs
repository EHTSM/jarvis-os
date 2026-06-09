"use strict";
/**
 * Phase 545 — Execution Chain Reliability
 *
 * Multi-step workflow execution hardening, retry orchestration,
 * rollback visibility, chain verification, interruption-safe continuation.
 *
 * Operator visibility, replay continuity, execution guarantees.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const CHAIN_STATE_PATH = path.join(__dirname, "../../data/chain-reliability.json");
const MAX_CHAINS       = 100;
const TTL_MS           = 7 * 24 * 60 * 60 * 1000;
const MAX_RETRIES      = 3;
const RETRY_BACKOFF_MS = [1000, 3000, 9000]; // exponential backoff schedule (ms)

function _load() {
    try {
        const raw = JSON.parse(fs.readFileSync(CHAIN_STATE_PATH, "utf8"));
        const now = Date.now();
        return (raw || []).filter(c => now - c.createdAt < TTL_MS);
    } catch { return []; }
}

function _save(chains) {
    try { fs.writeFileSync(CHAIN_STATE_PATH, JSON.stringify(chains.slice(-MAX_CHAINS), null, 2)); } catch {}
}

function _id() { return `cr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

// ── Chain execution state ─────────────────────────────────────────────────────

function startChain(chainName, steps, opts = {}) {
    if (!chainName || !Array.isArray(steps) || steps.length === 0) return { ok: false, error: "chainName and steps required" };

    const chains = _load();
    const chain = {
        id:         _id(),
        chainName,
        sessionId:  opts.sessionId  || null,
        operatorId: opts.operatorId || "default",
        steps:      steps.map((s, i) => ({
            index:       i,
            name:        s.name || `step-${i}`,
            cmd:         s.cmd  || null,
            state:       "pending",
            retries:     0,
            rollbackCmd: s.rollbackCmd || null,
            startedAt:   null,
            completedAt: null,
            error:       null,
        })),
        state:      "running",
        currentStep: 0,
        rollbackTriggered: false,
        createdAt:  Date.now(),
        updatedAt:  Date.now(),
    };
    chains.push(chain);
    _save(chains);
    return { ok: true, chain };
}

function recordStepResult(chainId, stepIndex, result) {
    const chains = _load();
    const chain  = chains.find(c => c.id === chainId);
    if (!chain) return { ok: false, error: "chain not found" };

    const step = chain.steps[stepIndex];
    if (!step) return { ok: false, error: "step not found" };

    step.state       = result.success ? "completed" : "failed";
    step.completedAt = Date.now();
    step.error       = result.error || null;

    if (result.success) {
        // Advance to next step
        const next = chain.steps[stepIndex + 1];
        if (next) {
            next.state      = "running";
            next.startedAt  = Date.now();
            chain.currentStep = stepIndex + 1;
        } else {
            chain.state       = "completed";
            chain.completedAt = Date.now();
        }
    } else {
        step.retries++;
        if (step.retries < MAX_RETRIES) {
            step.state = "retrying";
            step.nextRetryAt = Date.now() + (RETRY_BACKOFF_MS[step.retries - 1] || 9000);
        } else {
            chain.state = "failed";
        }
    }

    chain.updatedAt = Date.now();
    _save(chains);
    return { ok: true, chain, step };
}

// ── Rollback orchestration ────────────────────────────────────────────────────

function initiateRollback(chainId) {
    const chains = _load();
    const chain  = chains.find(c => c.id === chainId);
    if (!chain) return { ok: false, error: "chain not found" };
    if (chain.state !== "failed") return { ok: false, error: "rollback only available for failed chains" };

    chain.rollbackTriggered = true;
    chain.state             = "rolling-back";
    chain.updatedAt         = Date.now();

    // Build rollback plan: completed steps in reverse order that have rollbackCmd
    const rollbackSteps = chain.steps
        .filter(s => s.state === "completed" && s.rollbackCmd)
        .reverse()
        .map(s => ({ stepName: s.name, rollbackCmd: s.rollbackCmd }));

    _save(chains);
    return {
        ok:            true,
        chainId,
        rollbackSteps,
        stepsToRollback: rollbackSteps.length,
        warning: rollbackSteps.length === 0 ? "No rollback commands defined for completed steps" : null,
    };
}

// ── Chain verification ────────────────────────────────────────────────────────

/**
 * Verifies a chain definition before execution.
 */
function verifyChain(chainName, steps) {
    if (!chainName) return { ok: false, error: "chainName required" };
    if (!Array.isArray(steps) || steps.length === 0) return { ok: false, error: "steps required" };
    if (steps.length > 20) return { ok: false, error: "chain too long (max 20 steps)" };

    const issues = [];
    const warnings = [];

    steps.forEach((s, i) => {
        if (!s.name) warnings.push(`step ${i}: no name`);
        if (!s.cmd)  warnings.push(`step ${i} "${s.name || i}": no command defined`);
        if (s.destructive && !s.rollbackCmd) issues.push(`step ${i} "${s.name || i}": marked destructive but has no rollbackCmd`);
    });

    const terminal = _tryRequire("./terminalExecutor.cjs");
    const cmdResults = terminal
        ? steps.filter(s => s.cmd).map(s => ({ step: s.name, ...terminal.validateCommand(s.cmd) }))
        : [];
    const blocked = cmdResults.filter(r => r.level === "BLOCKED");
    blocked.forEach(b => issues.push(`step "${b.step}": command blocked — ${b.reason}`));

    return {
        ok:       issues.length === 0,
        chainName,
        steps:    steps.length,
        issues,
        warnings,
        cmdResults,
        recommendation: issues.length > 0
            ? "Fix issues before executing chain"
            : warnings.length > 0
            ? "Review warnings — chain can execute"
            : "Chain verified — ready to execute",
    };
}

// ── Interruption-safe continuation ────────────────────────────────────────────

function findInterruptedChains(sessionId) {
    const chains = _load().filter(c => sessionId ? c.sessionId === sessionId : true);
    const interrupted = chains.filter(c => c.state === "running" || c.state === "retrying");

    return {
        count: interrupted.length,
        chains: interrupted.map(c => {
            const current = c.steps[c.currentStep];
            return {
                id:          c.id,
                chainName:   c.chainName,
                state:       c.state,
                currentStep: c.currentStep,
                currentStepName: current ? current.name : null,
                totalSteps:  c.steps.length,
                sessionId:   c.sessionId,
                ageMins:     Math.round((Date.now() - c.updatedAt) / 60_000),
            };
        }),
    };
}

// ── Visibility ────────────────────────────────────────────────────────────────

function getChainStatus(chainId) {
    const chain = _load().find(c => c.id === chainId);
    if (!chain) return { ok: false, error: "chain not found" };

    const completed = chain.steps.filter(s => s.state === "completed").length;
    const failed    = chain.steps.filter(s => s.state === "failed").length;
    const pending   = chain.steps.filter(s => s.state === "pending").length;

    return {
        ok:        true,
        id:        chain.id,
        chainName: chain.chainName,
        state:     chain.state,
        progress:  { completed, failed, pending, total: chain.steps.length },
        currentStep: chain.steps[chain.currentStep],
        rollbackTriggered: chain.rollbackTriggered,
        durationMs: chain.completedAt ? chain.completedAt - chain.createdAt : Date.now() - chain.createdAt,
    };
}

function listChains({ sessionId, state, limit = 20 } = {}) {
    let chains = _load();
    if (sessionId) chains = chains.filter(c => c.sessionId === sessionId);
    if (state)     chains = chains.filter(c => c.state     === state);
    return chains.slice(-limit).map(c => ({
        id: c.id, chainName: c.chainName, state: c.state,
        steps: c.steps.length, currentStep: c.currentStep,
        rollbackTriggered: c.rollbackTriggered, sessionId: c.sessionId,
    }));
}

module.exports = {
    startChain, recordStepResult, initiateRollback,
    verifyChain, findInterruptedChains, getChainStatus, listChains,
    MAX_RETRIES, RETRY_BACKOFF_MS,
};
