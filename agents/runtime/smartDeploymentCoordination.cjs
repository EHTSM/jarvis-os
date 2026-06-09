"use strict";
/**
 * Phase 665 — Smart Deployment Coordination
 *
 * Phased deployment sequencing, canary validation, rollback prioritization,
 * runtime readiness ordering, deployment survivability analysis.
 * PREVENTS: unsafe continuation, stale replay, hidden drift.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/smart-deployment-coord.json");
const MAX_PLANS  = 30;
const TTL_MS     = 24 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { plans: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.plans = (db.plans || []).filter(p => p.createdAt > cutoff).slice(0, MAX_PLANS);
}

// ── Deployment readiness check ────────────────────────────────────────────────

function checkDeploymentReadiness(deploymentId = "") {
    const checks = [];

    const otl = _tryRequire("./operationalTrustLayer.cjs");
    if (otl) {
        try {
            const gate = otl.gateOperation("deploy");
            checks.push({ check: "trust-gate", ok: gate.allowed, detail: `score=${gate.score}` });
        } catch { checks.push({ check: "trust-gate", ok: true, detail: "unchecked" }); }
    }

    const eri = _tryRequire("./executionRiskIntelligence.cjs");
    if (eri) {
        try {
            const risk = eri.riskSummary({ windowMs: 24 * 60 * 60 * 1000 });
            checks.push({ check: "risk-level", ok: risk.overall !== "high", detail: `risk=${risk.overall}` });
        } catch {}
    }

    const esi = _tryRequire("./executionStateIntelligence.cjs");
    if (esi) {
        try {
            const state = esi.executionStateSummary();
            checks.push({ check: "execution-state", ok: state.stable, detail: state.summary });
        } catch {}
    }

    const apt = _tryRequire("./advancedPatchTrust.cjs");
    if (apt) {
        try {
            const conf = apt.executionConfidenceSummary();
            checks.push({ check: "patch-trust", ok: conf.ok, detail: `tier=${conf.tier}` });
        } catch {}
    }

    const allOk = checks.every(c => c.ok);
    return {
        ok:       allOk,
        ready:    allOk,
        deploymentId,
        checks,
        failed:   checks.filter(c => !c.ok).map(c => c.check),
        recommendation: allOk ? "Ready to deploy" : `Resolve: ${checks.filter(c => !c.ok).map(c => c.check).join(", ")}`,
    };
}

// ── Phased deployment plan ────────────────────────────────────────────────────

function createPhasedDeploymentPlan(opts = {}) {
    const { deploymentId = "", service = "", version = "", canaryPct = 5 } = opts;
    if (!deploymentId) return { ok: false, error: "deploymentId required" };

    const planId = crypto.randomUUID();
    const db     = _load(); _prune(db);

    const plan = {
        planId,
        deploymentId,
        service,
        version,
        phases: [
            { phase: "canary",  pct: canaryPct,              status: "pending", validationRequired: true,  approvalRequired: true },
            { phase: "staged",  pct: Math.round(canaryPct * 5), status: "pending", validationRequired: true,  approvalRequired: true },
            { phase: "full",    pct: 100,                    status: "pending", validationRequired: true,  approvalRequired: true },
        ],
        currentPhase: 0,
        status:       "pending",
        rollbackAvailable: true,
        createdAt:    Date.now(),
        updatedAt:    Date.now(),
    };

    db.plans.unshift(plan);
    _save(db);

    return { ok: true, planId, deploymentId, phases: plan.phases };
}

function advanceDeploymentPhase(planId, { operatorApproved = false, validationPassed = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true, error: "Operator approval required" };

    const db  = _load(); _prune(db);
    const idx = db.plans.findIndex(p => p.planId === planId);
    if (idx === -1) return { ok: false, error: "Plan not found" };

    const plan  = db.plans[idx];
    const phase = plan.phases[plan.currentPhase];
    if (!phase) return { ok: false, error: "No more phases" };

    if (phase.validationRequired && !validationPassed) return { ok: false, requiresValidation: true, error: "Validation must pass before advancing" };

    phase.status     = "completed";
    phase.completedAt = Date.now();
    plan.currentPhase++;
    plan.updatedAt = Date.now();

    if (plan.currentPhase >= plan.phases.length) {
        plan.status = "completed";
    }

    db.plans[idx] = plan;
    _save(db);

    const nextPhase = plan.phases[plan.currentPhase] || null;
    return { ok: true, planId, completedPhase: phase.phase, nextPhase: nextPhase?.phase || null, status: plan.status };
}

function rollbackDeploymentPlan(planId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };
    const db  = _load(); _prune(db);
    const idx = db.plans.findIndex(p => p.planId === planId);
    if (idx === -1) return { ok: false, error: "Plan not found" };
    db.plans[idx].status    = "rolled-back";
    db.plans[idx].updatedAt = Date.now();
    _save(db);
    return { ok: true, planId, status: "rolled-back" };
}

// ── Canary validation awareness ───────────────────────────────────────────────

function assessCanaryHealth(deploymentId = "", metrics = {}) {
    const { errorRate = 0, latencyMs = 0, healthCheckPassed = true } = metrics;
    const issues = [];

    if (errorRate > 0.05)       issues.push({ signal: "high-error-rate",   errorRate });
    if (latencyMs > 2000)       issues.push({ signal: "high-latency",       latencyMs });
    if (!healthCheckPassed)     issues.push({ signal: "health-check-fail" });

    const healthy  = issues.length === 0;
    const proceed  = healthy;

    return {
        ok:         true,
        healthy,
        proceed,
        issues,
        recommendation: proceed ? "Canary healthy — safe to advance to staged" : `Hold canary — ${issues.length} issue(s)`,
        approvalRequired: !proceed,
    };
}

// ── Deployment survivability analysis ────────────────────────────────────────

function deploymentSurvivabilityAnalysis(deploymentId = "") {
    const db   = _load();
    const plan = db.plans.find(p => p.deploymentId === deploymentId);

    const completedPhases = plan ? plan.phases.filter(p => p.status === "completed").length : 0;
    const totalPhases     = plan ? plan.phases.length : 3;
    const survivability   = Math.round(completedPhases / totalPhases * 100);

    const dse = _tryRequire("./deploymentSurvivabilityEngine.cjs");
    let engineScore = null;
    if (dse) { try { engineScore = dse.survivabilityScore?.(); } catch {} }

    return {
        ok:            true,
        deploymentId,
        survivability,
        completedPhases,
        totalPhases,
        engineScore:   engineScore?.score || null,
        status:        plan?.status || "no-plan",
        rollbackAvailable: plan?.rollbackAvailable !== false,
    };
}

// ── Stale deployment detection ────────────────────────────────────────────────

function detectStaleDeploymentReplays() {
    const db     = _load(); _prune(db);
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    const stale  = db.plans.filter(p => p.status === "pending" && p.updatedAt < cutoff);
    return {
        ok:         stale.length === 0,
        staleCount: stale.length,
        stale:      stale.map(p => ({ planId: p.planId, deploymentId: p.deploymentId, ageHours: Math.round((Date.now() - p.updatedAt) / 3600000) })),
    };
}

module.exports = { checkDeploymentReadiness, createPhasedDeploymentPlan, advanceDeploymentPhase, rollbackDeploymentPlan, assessCanaryHealth, deploymentSurvivabilityAnalysis, detectStaleDeploymentReplays };
