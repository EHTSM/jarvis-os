"use strict";
/**
 * Phase 648 — Adaptive Workflow Chains
 *
 * Conditional recovery steps, runtime-aware branching, validation-triggered actions,
 * replay-safe adaptation, bounded rerouting.
 * PREVENTS: uncontrolled chain growth, recursive loops, unsafe branching.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/adaptive-workflow-chains.json");
const MAX_CHAINS  = 100;
const CHAIN_TTL   = 24 * 60 * 60 * 1000;
const MAX_DEPTH   = 8;
const MAX_BRANCHES = 3;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { chains: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - CHAIN_TTL;
    db.chains = (db.chains || []).filter(c => c.startedAt > cutoff).slice(0, MAX_CHAINS);
}

// ── Step catalog ──────────────────────────────────────────────────────────────

const ADAPTIVE_STEPS = {
    "validate-health":       { safe: true,  autonomous: true,  label: "Validate runtime health" },
    "check-trust":           { safe: true,  autonomous: true,  label: "Check trust score" },
    "scan-environment":      { safe: true,  autonomous: true,  label: "Scan environment" },
    "restart-server":        { safe: false, autonomous: false, label: "Restart server",          requiresApproval: true },
    "repair-dependencies":   { safe: false, autonomous: false, label: "Repair dependencies",     requiresApproval: true },
    "apply-patch":           { safe: false, autonomous: false, label: "Apply patch",             requiresApproval: true },
    "rollback-deploy":       { safe: false, autonomous: false, label: "Roll back deployment",    requiresApproval: true },
    "run-tests":             { safe: true,  autonomous: true,  label: "Run validation tests" },
    "check-logs":            { safe: true,  autonomous: true,  label: "Check recent logs" },
    "validate-deps":         { safe: true,  autonomous: true,  label: "Validate dependencies" },
    "check-ports":           { safe: true,  autonomous: true,  label: "Check port availability" },
    "notify-operator":       { safe: true,  autonomous: true,  label: "Notify operator" },
};

// ── Branch conditions ─────────────────────────────────────────────────────────

function evaluateBranchCondition(condition = {}, context = {}) {
    const { type, threshold, field } = condition;
    const value = context[field];
    if (value === undefined) return false;
    switch (type) {
        case "lt":    return value < threshold;
        case "lte":   return value <= threshold;
        case "gt":    return value > threshold;
        case "gte":   return value >= threshold;
        case "eq":    return value === threshold;
        case "truthy": return !!value;
        case "falsy":  return !value;
        default:       return false;
    }
}

// ── Chain creation ────────────────────────────────────────────────────────────

function createChain(opts = {}) {
    const { goal = "", baseSteps = [], branches = [], sessionId = null, replayId = null } = opts;
    if (!goal) return { ok: false, error: "goal required" };
    if (baseSteps.length > MAX_DEPTH) return { ok: false, error: `Max ${MAX_DEPTH} base steps allowed` };
    if (branches.length > MAX_BRANCHES) return { ok: false, error: `Max ${MAX_BRANCHES} branches allowed` };

    // Validate all steps are in catalog
    const allSteps = [...baseSteps, ...branches.flatMap(b => b.steps || [])];
    const unknown  = allSteps.filter(s => !ADAPTIVE_STEPS[s]);
    if (unknown.length > 0) return { ok: false, error: `Unknown steps: ${unknown.join(", ")}` };

    const chainId = crypto.randomUUID();
    const db = _load(); _prune(db);

    const chain = {
        chainId,
        goal:        (goal || "").slice(0, 200),
        sessionId,
        replayId,
        baseSteps:   baseSteps.map((s, i) => ({ order: i, step: s, status: "pending", result: null, ...ADAPTIVE_STEPS[s] })),
        branches:    branches.slice(0, MAX_BRANCHES).map((b, i) => ({
            branchId:  `br_${i}`,
            condition: b.condition || {},
            steps:     (b.steps || []).slice(0, MAX_DEPTH - baseSteps.length).map((s, j) => ({ order: j, step: s, status: "pending", ...ADAPTIVE_STEPS[s] })),
            activated: false,
            label:     (b.label || `Branch ${i}`).slice(0, 100),
        })),
        currentStep:    0,
        activeBranch:   null,
        depth:          0,
        status:         "running",
        interrupted:    false,
        startedAt:      Date.now(),
        completedAt:    null,
    };

    db.chains.unshift(chain);
    _save(db);

    return { ok: true, chainId, goal, stepCount: baseSteps.length, branchCount: branches.length };
}

// ── Step execution ────────────────────────────────────────────────────────────

function executeStep(chainId, stepOrder, { approved = false, result = null, context = {} } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.chains.findIndex(c => c.chainId === chainId);
    if (idx === -1) return { ok: false, error: "chain not found" };

    const chain = db.chains[idx];
    if (chain.status !== "running") return { ok: false, error: `Chain is ${chain.status}` };
    if (chain.depth >= MAX_DEPTH)   return { ok: false, error: "Max execution depth reached" };

    const steps = chain.activeBranch !== null
        ? chain.branches.find(b => b.branchId === chain.activeBranch)?.steps || chain.baseSteps
        : chain.baseSteps;

    const step = steps[stepOrder];
    if (!step) return { ok: false, error: "step not found" };
    if (step.requiresApproval && !approved) return { ok: false, requiresApproval: true, stepLabel: step.label };

    step.status  = "completed";
    step.result  = result ? JSON.stringify(result).slice(0, 300) : null;
    chain.currentStep = stepOrder + 1;
    chain.depth++;

    // Evaluate branches after each step
    let branchActivated = null;
    if (chain.activeBranch === null && context && Object.keys(context).length > 0) {
        for (const branch of chain.branches) {
            if (!branch.activated && evaluateBranchCondition(branch.condition, context)) {
                branch.activated = true;
                chain.activeBranch = branch.branchId;
                branchActivated = branch.branchId;
                chain.currentStep = 0;
                break;
            }
        }
    }

    // Check completion
    const activeSteps = chain.activeBranch !== null
        ? chain.branches.find(b => b.branchId === chain.activeBranch)?.steps || []
        : chain.baseSteps;

    if (chain.currentStep >= activeSteps.length) {
        chain.status      = "completed";
        chain.completedAt = Date.now();
    }

    db.chains[idx] = chain;
    _save(db);

    return {
        ok:             true,
        chainId,
        stepOrder,
        depth:          chain.depth,
        branchActivated,
        status:         chain.status,
        nextStep:       activeSteps[chain.currentStep] || null,
    };
}

// ── Interrupt & resume ────────────────────────────────────────────────────────

function interruptChain(chainId, { reason = "" } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.chains.findIndex(c => c.chainId === chainId);
    if (idx === -1) return { ok: false };
    db.chains[idx].status        = "interrupted";
    db.chains[idx].interrupted   = true;
    db.chains[idx].interruptAt   = Date.now();
    db.chains[idx].interruptReason = (reason || "").slice(0, 200);
    _save(db);
    return { ok: true, chainId, resumeFromStep: db.chains[idx].currentStep };
}

function listChains({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.chains
        .filter(c => !status || c.status === status)
        .slice(0, limit)
        .map(c => ({ chainId: c.chainId, goal: c.goal, status: c.status, depth: c.depth, activeBranch: c.activeBranch, startedAt: c.startedAt }));
}

function getChain(chainId) {
    const db = _load();
    return db.chains.find(c => c.chainId === chainId) || null;
}

module.exports = { createChain, executeStep, interruptChain, listChains, getChain, ADAPTIVE_STEPS, MAX_DEPTH, MAX_BRANCHES };
