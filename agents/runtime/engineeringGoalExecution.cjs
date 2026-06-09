"use strict";
/**
 * Phase 618 — Engineering Goal Execution
 *
 * High-level goal → bounded execution chain → validated outcome → summary.
 * Goals: "stabilize frontend", "prepare deployment", "repair dependencies",
 *        "restore runtime", "verify production health".
 *
 * JARVIS generates execution plan, explains reasoning, validates outcomes.
 * No unsafe execution — all destructive steps require approval.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/engineering-goal-execution.json");
const MAX_GOALS   = 50;
const GOAL_TTL    = 48 * 60 * 60 * 1000;

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

// ── Goal catalog ──────────────────────────────────────────────────────────────

const GOAL_PATTERNS = [
    {
        pattern:  /stabilize.*(frontend|ui|react|vite)/i,
        name:     "stabilize-frontend",
        chain:    "full-debug-session",
        steps:    ["check-runtime-dashboard", "inspect-env-health", "check-active-debug-sessions", "verify-health-endpoint"],
        reasoning: "Frontend instability detected — checking runtime, env, and active debug state before proposing recovery.",
        outcome:   "Frontend health confirmed or recovery plan generated.",
    },
    {
        pattern:  /prepare.*(deploy|release|ship)/i,
        name:     "prepare-deployment",
        chain:    "deploy-preflight-full",
        steps:    ["check-runtime-dashboard", "check-trust-score", "verify-dependencies", "check-open-deployments", "verify-health-endpoint"],
        reasoning: "Deployment preparation — verifying trust, dependencies, and runtime readiness before pre-flight.",
        outcome:   "Deployment readiness assessed, pre-flight report generated.",
    },
    {
        pattern:  /repair.*(dep|package|install|module|npm)/i,
        name:     "repair-dependencies",
        chain:    "dep-repair-full",
        steps:    ["verify-dependencies", "inspect-env-health", "check-runtime-dashboard"],
        reasoning: "Dependency repair — scanning for missing or broken modules.",
        outcome:   "Dependency issues identified, repair steps provided.",
    },
    {
        pattern:  /restore.*(runtime|server|backend|api)/i,
        name:     "restore-runtime",
        chain:    "runtime-recovery-full",
        steps:    ["check-runtime-dashboard", "check-runtime-pressure", "inspect-env-health", "inspect-survivability", "propose-recovery-plan"],
        reasoning: "Runtime restoration — checking system pressure and survivability before recommending restart.",
        outcome:   "Runtime state assessed, recovery plan proposed.",
    },
    {
        pattern:  /verify.*(prod|production|health|status)/i,
        name:     "verify-production-health",
        chain:    "env-bootstrap-full",
        steps:    ["check-runtime-dashboard", "check-trust-score", "inspect-survivability", "verify-health-endpoint"],
        reasoning: "Production health verification — checking all signal sources before confirming production state.",
        outcome:   "Production health report generated.",
    },
    {
        pattern:  /debug|investigate|diagnose|troubleshoot/i,
        name:     "debug-session",
        chain:    "full-debug-session",
        steps:    ["check-runtime-dashboard", "check-runtime-pressure", "inspect-env-health", "check-active-debug-sessions", "propose-recovery-plan"],
        reasoning: "Debug investigation — systematic check of runtime, environment, and existing debug state.",
        outcome:   "Debug context built, recovery plan proposed.",
    },
];

const DEFAULT_GOAL = {
    name:      "general-engineering",
    chain:     "env-bootstrap-full",
    steps:     ["check-runtime-dashboard", "inspect-env-health", "verify-health-endpoint"],
    reasoning: "General engineering check — validating environment baseline.",
    outcome:   "Environment baseline assessed.",
};

function _matchGoal(goalText) {
    for (const g of GOAL_PATTERNS) {
        if (g.pattern.test(goalText)) return g;
    }
    return DEFAULT_GOAL;
}

// ── Goal execution ────────────────────────────────────────────────────────────

function executeGoal(opts = {}) {
    const { goal = "", sessionId = null, operatorId = null } = opts;
    if (!goal) return { ok: false, error: "goal required" };

    const matched  = _matchGoal(goal);
    const goalId   = crypto.randomUUID();
    const db       = _load(); _prune(db);

    // Check trust gate
    const tl = _tryRequire("./operationalTrustLayer.cjs");
    let trustScore = null;
    if (tl) {
        const gate = tl.gateOperation("deploy");
        trustScore = gate.score;
    }

    // Plan autonomous debug chain
    const adc   = _tryRequire("./autonomousDebugChains.cjs");
    let chainResult = null;
    if (adc) {
        try { chainResult = adc.planDebugChain(goal, sessionId); } catch {}
    }

    const record = {
        id:         goalId,
        goal:       (goal || "").slice(0, 200),
        matchedGoal: matched.name,
        chainName:   matched.chain,
        sessionId,
        operatorId,
        steps:       matched.steps,
        reasoning:   matched.reasoning,
        expectedOutcome: matched.outcome,
        trustScore,
        chainId:     chainResult?.chainId || null,
        status:      "active",
        outcomes:    [],
        createdAt:   Date.now(),
        completedAt: null,
    };

    db.goals.unshift(record);
    _save(db);

    const tline = _tryRequire("./executionTimeline.cjs");
    if (tline) tline.record("chain", { goalId, goal: matched.name, event: "goal-execution-started", sessionId });

    return {
        ok:             true,
        goalId,
        matchedGoal:    matched.name,
        chainName:      matched.chain,
        reasoning:      matched.reasoning,
        expectedOutcome: matched.outcome,
        steps:          matched.steps,
        chainId:        chainResult?.chainId || null,
        trustScore,
    };
}

// ── Outcome recording ─────────────────────────────────────────────────────────

function recordOutcome(goalId, { outcome = "", success = true, notes = "" } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.goals.findIndex(g => g.id === goalId);
    if (idx === -1) return { ok: false, error: "goal not found" };

    db.goals[idx].outcomes.push({ outcome: (outcome || "").slice(0, 300), success, notes: (notes || "").slice(0, 200), ts: Date.now() });
    if (success) { db.goals[idx].status = "completed"; db.goals[idx].completedAt = Date.now(); }
    _save(db);

    const tl = _tryRequire("./operationalTrustLayer.cjs");
    if (tl) tl.recordSignal(success ? "recovery-success" : "recovery-fail", { sessionId: db.goals[idx].sessionId, detail: outcome });

    return { ok: true, goalId, status: db.goals[idx].status };
}

// ── Summary ───────────────────────────────────────────────────────────────────

function goalSummary(goalId) {
    const db   = _load(); _prune(db);
    const goal = db.goals.find(g => g.id === goalId);
    if (!goal) return { ok: false, error: "goal not found" };

    const successCount = goal.outcomes.filter(o => o.success).length;
    return {
        ok:             true,
        goalId,
        goal:           goal.goal,
        matchedGoal:    goal.matchedGoal,
        reasoning:      goal.reasoning,
        expectedOutcome: goal.expectedOutcome,
        actualOutcomes: goal.outcomes.map(o => o.outcome),
        successRate:    goal.outcomes.length > 0 ? Math.round(successCount / goal.outcomes.length * 100) + "%" : "pending",
        status:         goal.status,
        durationMs:     goal.completedAt ? goal.completedAt - goal.createdAt : null,
    };
}

function listGoals({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.goals
        .filter(g => !status || g.status === status)
        .slice(0, limit)
        .map(g => ({ id: g.id, goal: g.goal, matchedGoal: g.matchedGoal, status: g.status, createdAt: g.createdAt }));
}

module.exports = { executeGoal, recordOutcome, goalSummary, listGoals, GOAL_PATTERNS };
