"use strict";
/**
 * Phase 693 — Terminal Coordination Intelligence
 *
 * Process-aware execution, chained runtime coordination, validation-linked shell flows,
 * dependency-aware restart ordering, replay-safe terminal recovery.
 * Bounded retries. Explainable. Operator visibility.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/terminal-coord-intel.json");
const MAX_CHAINS  = 50;
const TTL_MS      = 12 * 60 * 60 * 1000;
const MAX_RETRIES = 2;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { chains: [], processes: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.chains    = (db.chains    || []).filter(c => c.ts > cutoff).slice(0, MAX_CHAINS);
    db.processes = (db.processes || []).filter(p => p.ts > cutoff).slice(0, 50);
}

// ── Process-aware execution ───────────────────────────────────────────────────

function registerProcess(pid, opts = {}) {
    const { name = "", command = "", status = "running" } = opts;
    const db  = _load(); _prune(db);
    const idx = db.processes.findIndex(p => p.pid === pid);
    const record = { pid, name: name.slice(0, 100), command: command.slice(0, 200), status, ts: Date.now() };
    if (idx >= 0) { db.processes[idx] = record; }
    else          { db.processes.unshift(record); }
    _save(db);
    return { ok: true, pid, name, status };
}

function checkProcessConflicts(command = "") {
    const db  = _load(); _prune(db);
    const cmd = command.toLowerCase();
    const conflicts = db.processes.filter(p => {
        if (p.status !== "running") return false;
        // Port conflicts
        const portMatch = cmd.match(/:(\d{4,5})/);
        if (portMatch && p.command.includes(`:${portMatch[1]}`)) return true;
        // Same command
        if (p.command.toLowerCase().includes(cmd.split(" ")[0])) return true;
        return false;
    });

    return {
        ok:        conflicts.length === 0,
        conflicts: conflicts.map(p => ({ pid: p.pid, name: p.name, command: p.command })),
        safe:      conflicts.length === 0,
        warning:   conflicts.length > 0 ? `${conflicts.length} process conflict(s) detected` : null,
    };
}

// ── Chained runtime coordination ──────────────────────────────────────────────

function buildRuntimeChain(chainId, steps = [], { replayId = null } = {}) {
    if (!chainId) return { ok: false, error: "chainId required" };
    if (!steps.length) return { ok: false, error: "steps required" };

    const db  = _load(); _prune(db);
    const idx = db.chains.findIndex(c => c.chainId === chainId);

    const chain = {
        chainId,
        replayId,
        steps: steps.map((s, i) => ({
            index:      i,
            command:    (s.command || s).slice(0, 200),
            validation: s.validation || null,
            maxRetries: MAX_RETRIES,
            retryCount: 0,
            status:     "pending",
            requiresApproval: s.requiresApproval || false,
        })),
        currentStep: idx >= 0 ? db.chains[idx].currentStep : 0,
        status:      "pending",
        ts:          Date.now(),
    };

    if (idx >= 0) { db.chains[idx] = chain; }
    else          { db.chains.unshift(chain); }
    _save(db);

    return {
        ok:              true,
        chainId,
        stepCount:       chain.steps.length,
        requiresApproval: chain.steps.some(s => s.requiresApproval),
        firstStep:       chain.steps[0],
    };
}

function advanceChainStep(chainId, { succeeded = true, operatorApproved = false } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.chains.findIndex(c => c.chainId === chainId);
    if (idx === -1) return { ok: false, error: "Chain not found" };

    const chain = db.chains[idx];
    const step  = chain.steps[chain.currentStep];
    if (!step) return { ok: false, error: "No current step" };

    if (step.requiresApproval && !operatorApproved) return { ok: false, requiresApproval: true, step: step.command };

    if (!succeeded) {
        step.retryCount++;
        if (step.retryCount >= MAX_RETRIES) { step.status = "failed"; chain.status = "failed"; }
        db.chains[idx] = chain;
        _save(db);
        return { ok: false, chainId, step: step.command, retryCount: step.retryCount, failed: step.status === "failed" };
    }

    step.status      = "completed";
    step.completedAt = Date.now();
    chain.currentStep++;
    if (chain.currentStep >= chain.steps.length) chain.status = "completed";
    db.chains[idx] = chain;
    _save(db);

    const nextStep = chain.steps[chain.currentStep] || null;
    return { ok: true, chainId, completedStep: step.command, nextStep: nextStep?.command || null, status: chain.status };
}

// ── Validation-linked shell flows ─────────────────────────────────────────────

function buildValidationLinkedFlow(commands = [], validations = {}) {
    const steps = commands.map((cmd, i) => ({
        index:    i,
        command:  cmd,
        validation: validations[i] || validations[cmd] || null,
        checkpoint: i > 0,
    }));

    return {
        ok:    true,
        steps,
        hasValidations: Object.keys(validations).length > 0,
        explainer: `Validation-linked flow: ${steps.length} commands, ${steps.filter(s => s.validation).length} validated`,
    };
}

// ── Dependency-aware restart ordering ────────────────────────────────────────

function planRestartOrder(services = [], deps = {}) {
    const dae = _tryRequire("./dependencyAwareExecution.cjs");
    let order = services;

    if (dae && Object.keys(deps).length > 0) {
        try {
            const graphName = `restart-${Date.now()}`;
            dae.registerDependencyGraph(graphName, deps);
            const execOrder = dae.getExecutionOrder(graphName);
            if (execOrder.ok && !execOrder.hasCycle) order = execOrder.order.filter(s => services.includes(s));
        } catch {}
    }

    return {
        ok:     true,
        order,
        deps,
        plan: order.map((svc, i) => ({ order: i + 1, service: svc, action: "restart", validation: `health-check-${svc}` })),
        explainer: `Restart order: ${order.join(" → ")}`,
    };
}

// ── Replay-safe terminal recovery ─────────────────────────────────────────────

function recoverTerminalReplay(replayId = "", { chainId = null } = {}) {
    if (!replayId) return { ok: false, error: "replayId required" };

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    let isDup  = false;
    if (lhec) { try { isDup = lhec.isDuplicateRecovery(`term-recovery:${replayId}`); } catch {} }
    if (isDup) return { ok: false, duplicate: true, error: "Terminal replay recovery blocked in dedup window" };

    const db    = _load(); _prune(db);
    const chain = chainId ? db.chains.find(c => c.chainId === chainId) : null;
    const resumeFrom = chain?.currentStep || 0;

    return {
        ok:          true,
        replayId,
        chainId,
        resumeFrom,
        pendingSteps: chain ? chain.steps.length - resumeFrom : 0,
        stale:        chain ? (Date.now() - chain.ts) > 4 * 60 * 60 * 1000 : false,
        approvalRequired: true,
    };
}

module.exports = { registerProcess, checkProcessConflicts, buildRuntimeChain, advanceChainStep, buildValidationLinkedFlow, planRestartOrder, recoverTerminalReplay };
