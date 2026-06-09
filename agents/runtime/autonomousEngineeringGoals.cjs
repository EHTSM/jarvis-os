"use strict";
/**
 * Phase 633 — Autonomous Engineering Goals
 *
 * Higher-level goals: "stabilize backend", "prepare release",
 * "repair dev environment", "restore deployment", "recover browser workflows".
 * Generates bounded plans, explains reasoning, validates results, summarizes outcomes.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/autonomous-eng-goals.json");
const MAX_GOALS  = 50;
const GOAL_TTL   = 48 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { goals: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - GOAL_TTL;
    db.goals = (db.goals || []).filter(g => g.createdAt > cutoff).slice(0, MAX_GOALS);
}

// ── Goal definitions ──────────────────────────────────────────────────────────

const GOAL_MAP = [
    {
        pattern:   /stabilize.*(backend|server|api)/i,
        name:      "stabilize-backend",
        automation:"startup-restore",
        chain:     "runtime-recovery-full",
        reasoning: "Backend instability — restoring environment and running runtime recovery chain.",
        validationSteps: ["GET /health", "GET /api/runtime/dashboard"],
        successCriteria: "Health endpoint returns 200 and runtime dashboard shows no critical pressure",
    },
    {
        pattern:   /prepare.*(release|ship|version)/i,
        name:      "prepare-release",
        automation:"deployment-prep",
        chain:     "deploy-preflight-full",
        reasoning: "Release preparation — running full deployment pre-flight and dependency check.",
        validationSteps: ["GET /api/runtime/bootstrap/deps", "GET /api/runtime/trust/score"],
        successCriteria: "Dependencies verified, trust score >= 55, no open deployments blocking",
    },
    {
        pattern:   /repair.*(dev|development|environment|env)/i,
        name:      "repair-dev-environment",
        automation:"startup-restore",
        chain:     "dep-repair-full",
        reasoning: "Development environment repair — bootstrap hardening and dependency repair chain.",
        validationSteps: ["GET /api/runtime/bootstrap/plan", "GET /api/runtime/env-health/report"],
        successCriteria: "Bootstrap plan shows no issues, environment health >= 80%",
    },
    {
        pattern:   /restore.*(deploy|deployment)/i,
        name:      "restore-deployment",
        automation:"deployment-prep",
        chain:     "deploy-preflight-full",
        reasoning: "Deployment restoration — checking for stale sessions and running pre-flight.",
        validationSteps: ["GET /api/runtime/deploy-workflow?status=open", "GET /api/runtime/deploy-survivability/score"],
        successCriteria: "No stale open deployments, survivability score >= 60",
    },
    {
        pattern:   /recover.*(browser|web|ui)/i,
        name:      "recover-browser-workflows",
        automation:"health-scan",
        chain:     "env-bootstrap-full",
        reasoning: "Browser workflow recovery — checking auth sessions and workflow maturity.",
        validationSteps: ["GET /api/runtime/browser-maturity/report", "GET /api/runtime/auto-browser?status=interrupted"],
        successCriteria: "Browser health grade >= B, interrupted sessions recovered",
    },
    {
        pattern:   /debug|investigate|diagnose/i,
        name:      "debug-session",
        automation:"debug-init",
        chain:     "full-debug-session",
        reasoning: "Debug investigation — validation-first approach with full debug session init.",
        validationSteps: ["GET /api/runtime/debug-workflow/active", "GET /api/runtime/dashboard/status"],
        successCriteria: "Debug session opened, root causes identified",
    },
];

const DEFAULT_GOAL = {
    name:      "general-health-check",
    automation:"health-scan",
    chain:     "env-bootstrap-full",
    reasoning: "No specific goal matched — running general health scan and environment bootstrap.",
    validationSteps: ["GET /api/runtime/dashboard/status", "GET /api/runtime/trust/score"],
    successCriteria: "Platform health nominal",
};

function _match(goalText) {
    for (const g of GOAL_MAP) {
        if (g.pattern.test(goalText)) return g;
    }
    return DEFAULT_GOAL;
}

// ── Goal lifecycle ────────────────────────────────────────────────────────────

function startGoal(opts = {}) {
    const { goal = "", sessionId = null, operatorId = null } = opts;
    if (!goal) return { ok: false, error: "goal required" };

    const matched = _match(goal);
    const goalId  = crypto.randomUUID();
    const db      = _load(); _prune(db);

    // Check trust
    const tl = _tryRequire("./operationalTrustLayer.cjs");
    let trustScore = null;
    if (tl) { try { trustScore = tl.getTrustScore().score; } catch {} }

    // Start automation if available
    const dea = _tryRequire("./dailyEngineeringAutomation.cjs");
    let automationRunId = null;
    if (dea && matched.automation) {
        try {
            const run = dea.startAutomation(matched.automation, { sessionId });
            automationRunId = run.runId || null;
        } catch {}
    }

    // Plan autonomous debug chain
    const adc = _tryRequire("./autonomousDebugChains.cjs");
    let chainId = null;
    if (adc) {
        try {
            const c = adc.planDebugChain(goal, sessionId);
            chainId = c.chainId || null;
        } catch {}
    }

    const record = {
        id:              goalId,
        goal:            (goal || "").slice(0, 200),
        matchedGoal:     matched.name,
        automation:      matched.automation,
        chain:           matched.chain,
        reasoning:       matched.reasoning,
        validationSteps: matched.validationSteps,
        successCriteria: matched.successCriteria,
        automationRunId,
        chainId,
        sessionId,
        operatorId,
        trustScore,
        status:          "active",
        outcomes:        [],
        validationResults: [],
        createdAt:       Date.now(),
        completedAt:     null,
    };

    db.goals.unshift(record);
    _save(db);

    const tline = _tryRequire("./executionTimeline.cjs");
    if (tline) tline.record("chain", { goalId, goal: matched.name, event: "autonomous-goal-started", sessionId });

    return {
        ok:              true,
        goalId,
        matchedGoal:     matched.name,
        chain:           matched.chain,
        automation:      matched.automation,
        automationRunId,
        chainId,
        reasoning:       matched.reasoning,
        validationSteps: matched.validationSteps,
        successCriteria: matched.successCriteria,
        trustScore,
    };
}

function recordValidation(goalId, { step = "", passed = true, detail = "" } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.goals.findIndex(g => g.id === goalId);
    if (idx === -1) return { ok: false, error: "goal not found" };

    db.goals[idx].validationResults.push({ step, passed, detail: (detail || "").slice(0, 200), ts: Date.now() });
    _save(db);
    return { ok: true, goalId };
}

function completeGoal(goalId, { success = true, outcome = "", notes = "" } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.goals.findIndex(g => g.id === goalId);
    if (idx === -1) return { ok: false, error: "goal not found" };

    const g = db.goals[idx];
    g.outcomes.push({ outcome: (outcome || "").slice(0, 300), success, notes: (notes || "").slice(0, 200), ts: Date.now() });
    g.status      = success ? "completed" : "failed";
    g.completedAt = Date.now();
    db.goals[idx] = g;
    _save(db);

    const tl = _tryRequire("./operationalTrustLayer.cjs");
    if (tl) tl.recordSignal(success ? "recovery-success" : "recovery-fail", { sessionId: g.sessionId, detail: outcome });

    const ete = _tryRequire("./executionTrustEvolution.cjs");
    if (ete) ete.recordTrustEvent(success ? "chain-completed" : "chain-failed", { detail: g.matchedGoal });

    return { ok: true, goalId, status: g.status, durationMs: g.completedAt - g.createdAt };
}

function goalSummary(goalId) {
    const db   = _load(); _prune(db);
    const g    = db.goals.find(x => x.id === goalId);
    if (!g) return { ok: false, error: "goal not found" };

    const valPassed = g.validationResults.filter(v => v.passed).length;
    return {
        ok:             true,
        goalId,
        goal:           g.goal,
        matchedGoal:    g.matchedGoal,
        reasoning:      g.reasoning,
        successCriteria: g.successCriteria,
        validationPass: `${valPassed}/${g.validationResults.length}`,
        outcomes:       g.outcomes.map(o => o.outcome),
        status:         g.status,
        durationMs:     g.completedAt ? g.completedAt - g.createdAt : null,
    };
}

function listGoals({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.goals
        .filter(g => !status || g.status === status)
        .slice(0, limit)
        .map(g => ({ id: g.id, goal: g.goal, matchedGoal: g.matchedGoal, status: g.status, createdAt: g.createdAt }));
}

module.exports = { startGoal, recordValidation, completeGoal, goalSummary, listGoals, GOAL_MAP };
