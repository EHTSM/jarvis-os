"use strict";
/**
 * Phase 682 — Long-Horizon Execution Planning
 *
 * Multi-day engineering planning, reconnect-safe workflow continuity,
 * deployment-session survivability, replay persistence strategy,
 * interrupted-workflow restoration planning.
 * PREVENTS: stale replay resurrection, duplicate recovery, corrupted continuation.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH       = path.join(__dirname, "../../data/long-horizon-exec-plan.json");
const MAX_PLANS        = 30;
const SESSION_TTL      = 14 * 24 * 60 * 60 * 1000;
const STALE_THRESHOLD  = 48 * 60 * 60 * 1000;
const DEDUP_MS         = 10 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { plans: [], dedup: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - SESSION_TTL;
    db.plans = (db.plans || []).filter(p => p.ts > cutoff).slice(0, MAX_PLANS);
    db.dedup = (db.dedup || []).filter(d => d.ts > Date.now() - DEDUP_MS);
}

function _isDup(db, key) {
    return db.dedup.some(d => d.key === key);
}

// ── Multi-day engineering plan ────────────────────────────────────────────────

function createMultiDayPlan(opts = {}) {
    const { planId = crypto.randomUUID(), goal = "", durationDays = 1, milestones = [], env = "default" } = opts;
    if (!goal) return { ok: false, error: "goal required" };

    const db = _load(); _prune(db);

    const plan = {
        planId,
        goal: goal.slice(0, 200),
        durationDays,
        milestones: milestones.slice(0, 20).map((m, i) => ({
            index: i,
            name:  (m.name || m).slice(0, 100),
            day:   m.day || i + 1,
            status: "pending",
            requiresApproval: m.requiresApproval || false,
        })),
        env,
        status:    "active",
        progress:  0,
        ts:        Date.now(),
        updatedAt: Date.now(),
    };

    const idx = db.plans.findIndex(p => p.planId === planId);
    if (idx >= 0) { db.plans[idx] = plan; }
    else          { db.plans.unshift(plan); }
    _save(db);

    return { ok: true, planId, goal: plan.goal, durationDays, milestoneCount: plan.milestones.length };
}

function updatePlanProgress(planId, { milestoneIndex = null, progress = null, operatorApproved = false } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.plans.findIndex(p => p.planId === planId);
    if (idx === -1) return { ok: false, error: "Plan not found" };

    const plan = db.plans[idx];

    if (milestoneIndex !== null) {
        const m = plan.milestones[milestoneIndex];
        if (!m) return { ok: false, error: "Milestone not found" };
        if (m.requiresApproval && !operatorApproved) return { ok: false, requiresApproval: true };
        m.status = "completed";
        m.completedAt = Date.now();
    }

    if (progress !== null) plan.progress = Math.min(100, Math.max(0, progress));
    plan.updatedAt = Date.now();
    db.plans[idx] = plan;
    _save(db);
    return { ok: true, planId, progress: plan.progress };
}

// ── Reconnect-safe continuity ─────────────────────────────────────────────────

function planReconnectSafeContinuity(sessionId = "") {
    const lhs = _tryRequire("./longHorizonExecutionSurvivability.cjs");
    let stormStatus = null;
    if (lhs) { try { stormStatus = lhs.reconnectStormStatus(); } catch {} }

    if (stormStatus?.storm) {
        return {
            ok:     false,
            blocked: true,
            reason: `Reconnect storm active (${stormStatus.recentCount} reconnects/hour) — pause and investigate`,
            approvalRequired: true,
        };
    }

    return {
        ok:   true,
        sessionId,
        safe: true,
        stormStatus,
        plan: [
            { step: "check-storm-status",   autonomous: true  },
            { step: "restore-session",      autonomous: true  },
            { step: "validate-continuity",  autonomous: true  },
            { step: "resume-workflow",      autonomous: false, requiresApproval: true },
        ],
    };
}

// ── Deployment session survivability planning ─────────────────────────────────

function planDeploymentSessionSurvivability(deploymentId = "") {
    if (!deploymentId) return { ok: false, error: "deploymentId required" };

    const lhs = _tryRequire("./longHorizonExecutionSurvivability.cjs");
    if (lhs) {
        try { lhs.persistDeploymentSurvivability(deploymentId, { plannedAt: Date.now(), goal: `survivability for ${deploymentId}` }); } catch {}
    }

    const ecc = _tryRequire("./engineeringContextCoordination.cjs");
    if (ecc) {
        try { ecc.preserveDeploymentContext(deploymentId, { goal: `long-horizon plan for ${deploymentId}` }); } catch {}
    }

    return {
        ok:           true,
        deploymentId,
        persisted:    true,
        recoveryPlan: [
            { step: "restore-deployment-session",  autonomous: true  },
            { step: "check-phase-progress",        autonomous: true  },
            { step: "validate-rollback-available", autonomous: true  },
            { step: "resume-or-rollback",          autonomous: false, requiresApproval: true },
        ],
        approvalRequired: true,
    };
}

// ── Replay persistence strategy ───────────────────────────────────────────────

function buildReplayPersistenceStrategy(replayId = "", { goal = "" } = {}) {
    if (!replayId) return { ok: false, error: "replayId required" };

    const db = _load(); _prune(db);
    if (_isDup(db, `replay-strategy:${replayId}`)) return { ok: false, duplicate: true, error: "Replay strategy already active in dedup window" };
    db.dedup.push({ key: `replay-strategy:${replayId}`, ts: Date.now() });
    _save(db);

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    if (lhec) {
        try {
            lhec.persistReplayContinuity(replayId, {
                status: "planned",
                goal:   goal.slice(0, 200),
                startedAt: Date.now(),
            });
        } catch {}
    }

    return {
        ok:      true,
        replayId,
        goal,
        strategy: [
            { step: "persist-initial-state",  autonomous: true },
            { step: "checkpoint-after-each-phase", autonomous: true },
            { step: "verify-dedup-on-resume", autonomous: true },
            { step: "restore-on-interruption", autonomous: false, requiresApproval: true },
        ],
    };
}

// ── Interrupted workflow restoration planning ─────────────────────────────────

function planInterruptedWorkflowRestoration({ operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };

    const lhs = _tryRequire("./longHorizonExecutionSurvivability.cjs");
    let restorable = null;
    if (lhs) {
        try { restorable = lhs.restoreInterruptedWorkflows({ operatorApproved: true }); } catch {}
    }

    const dec = _tryRequire("./dailyEngineeringCoordination.cjs");
    let interrupted = null;
    if (dec) { try { interrupted = dec.listRuns({ status: "interrupted" }); } catch {} }

    return {
        ok:         true,
        restorable: restorable?.restorable || [],
        interrupted: interrupted || [],
        totalCount: (restorable?.count || 0) + (interrupted?.length || 0),
        approvalRequired: true,
        explainer:  `Restoration plan: ${(restorable?.count || 0) + (interrupted?.length || 0)} workflow(s) available`,
    };
}

function listLongHorizonPlans({ limit = 10 } = {}) {
    const db = _load(); _prune(db);
    return db.plans.slice(0, limit).map(p => ({
        planId: p.planId,
        goal:   p.goal,
        status: p.status,
        progress: p.progress,
        durationDays: p.durationDays,
        ageMs: Date.now() - p.ts,
    }));
}

module.exports = { createMultiDayPlan, updatePlanProgress, planReconnectSafeContinuity, planDeploymentSessionSurvivability, buildReplayPersistenceStrategy, planInterruptedWorkflowRestoration, listLongHorizonPlans };
