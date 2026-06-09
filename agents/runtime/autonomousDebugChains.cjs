"use strict";
/**
 * Phase 616 — Safe Autonomous Debug Chains
 *
 * Bounded autonomous debug execution: log inspection, dep verification,
 * runtime restart, validation, replay-linked recovery.
 * Every step is advisory or explicitly approved. Max depth = 8 steps.
 * Operator can interrupt at any point.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH   = path.join(__dirname, "../../data/autonomous-debug-chains.json");
const MAX_CHAINS   = 30;
const CHAIN_TTL    = 24 * 60 * 60 * 1000;
const MAX_DEPTH    = 8;

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

const AUTONOMOUS_STEPS = {
    "check-runtime-dashboard":   { label: "Check runtime dashboard",      safe: true, autonomousOk: true,  action: "GET /api/runtime/dashboard" },
    "check-runtime-pressure":    { label: "Check runtime pressure",       safe: true, autonomousOk: true,  action: "GET /api/runtime/pressure" },
    "inspect-env-health":        { label: "Inspect environment health",    safe: true, autonomousOk: true,  action: "GET /api/runtime/env-health/report" },
    "verify-dependencies":       { label: "Verify dependencies",           safe: true, autonomousOk: true,  action: "GET /api/runtime/bootstrap/deps" },
    "check-trust-score":         { label: "Check trust score",             safe: true, autonomousOk: true,  action: "GET /api/runtime/trust/score" },
    "inspect-survivability":     { label: "Inspect survivability",         safe: true, autonomousOk: true,  action: "GET /api/runtime/survivability/score" },
    "check-active-debug-sessions": { label: "Check active debug sessions", safe: true, autonomousOk: true,  action: "GET /api/runtime/debug-workflow/active" },
    "check-open-deployments":    { label: "Check open deployments",        safe: true, autonomousOk: true,  action: "GET /api/runtime/deploy-workflow?status=open" },
    "propose-recovery-plan":     { label: "Propose recovery plan",         safe: true, autonomousOk: true,  action: "advisory" },
    "verify-health-endpoint":    { label: "Verify health endpoint",        safe: true, autonomousOk: true,  action: "GET /health" },
    "runtime-restart":           { label: "Recommend runtime restart",     safe: false, autonomousOk: false, requiresApproval: true, action: "ADVISORY: pm2 restart all" },
    "apply-recovery-patch":      { label: "Apply recovery patch",          safe: false, autonomousOk: false, requiresApproval: true, action: "REQUIRES APPROVAL" },
};

// ── Chain planner ─────────────────────────────────────────────────────────────

function planDebugChain(goal = "", sessionId = null) {
    const g = goal.toLowerCase();

    let steps = ["check-runtime-dashboard", "check-runtime-pressure", "inspect-env-health"];

    if (/dep|package|install|module/i.test(g))   steps.push("verify-dependencies");
    if (/trust|confidence/i.test(g))             steps.push("check-trust-score");
    if (/session|debug|open/i.test(g))           steps.push("check-active-debug-sessions");
    if (/deploy/i.test(g))                       steps.push("check-open-deployments");

    steps.push("propose-recovery-plan");
    steps.push("verify-health-endpoint");

    // Cap at MAX_DEPTH
    steps = steps.slice(0, MAX_DEPTH);

    const chainId = crypto.randomUUID();
    const db      = _load(); _prune(db);

    const chain = {
        id:          chainId,
        goal:        (goal || "").slice(0, 200),
        sessionId,
        steps:       steps.map((s, i) => ({
            order:            i,
            key:              s,
            ...AUTONOMOUS_STEPS[s],
            status:           "pending",
            result:           null,
            executedAt:       null,
        })),
        status:      "planned",
        currentStep: 0,
        startedAt:   Date.now(),
        completedAt: null,
        interrupted: false,
        operatorInterruptAt: null,
    };

    db.chains.unshift(chain);
    _save(db);

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.record("chain", { chainId, goal, event: "autonomous-debug-planned", sessionId });

    return { ok: true, chainId, stepCount: steps.length, steps: chain.steps };
}

// ── Step execution ────────────────────────────────────────────────────────────

function executeStep(chainId, stepOrder, { operatorApproved = false, result = null } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.chains.findIndex(c => c.id === chainId);
    if (idx === -1) return { ok: false, error: "chain not found" };

    const chain = db.chains[idx];
    if (chain.interrupted) return { ok: false, error: "chain was interrupted by operator" };

    const step = chain.steps[stepOrder];
    if (!step) return { ok: false, error: `step ${stepOrder} not found` };

    if (!step.autonomousOk && !operatorApproved) {
        return { ok: false, requiresApproval: true, stepLabel: step.label, action: step.action };
    }

    step.status    = "completed";
    step.result    = result || { status: "advisory", note: "Operator should verify this step manually" };
    step.executedAt = Date.now();

    chain.currentStep   = Math.max(chain.currentStep, stepOrder + 1);
    chain.status        = chain.currentStep >= chain.steps.length ? "completed" : "executing";
    if (chain.status === "completed") chain.completedAt = Date.now();

    db.chains[idx] = chain;
    _save(db);

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.record("chain", { chainId, step: step.key, event: "step-executed" });

    return { ok: true, chainId, stepOrder, status: step.status, nextStep: chain.steps[chain.currentStep] || null };
}

// ── Interrupt / cancel ────────────────────────────────────────────────────────

function interruptChain(chainId, { reason = "" } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.chains.findIndex(c => c.id === chainId);
    if (idx === -1) return { ok: false, error: "chain not found" };

    db.chains[idx].interrupted          = true;
    db.chains[idx].status               = "interrupted";
    db.chains[idx].operatorInterruptAt  = Date.now();
    db.chains[idx].interruptReason      = (reason || "").slice(0, 200);
    _save(db);

    return { ok: true, chainId, interrupted: true, reason };
}

// ── Query ─────────────────────────────────────────────────────────────────────

function getChain(chainId) {
    const db = _load(); _prune(db);
    return db.chains.find(c => c.id === chainId) || null;
}

function listChains({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.chains
        .filter(c => !status || c.status === status)
        .slice(0, limit)
        .map(c => ({ id: c.id, goal: c.goal, status: c.status, currentStep: c.currentStep, total: c.steps.length, startedAt: c.startedAt }));
}

module.exports = { planDebugChain, executeStep, interruptChain, getChain, listChains, AUTONOMOUS_STEPS };
