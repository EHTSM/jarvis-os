"use strict";
/**
 * Phase 677 — Deployment Strategy Engine
 *
 * Phased deployment sequencing, canary-risk analysis, rollback planning,
 * dependency readiness evaluation, runtime-health prioritization.
 * Generates readiness summaries, rollback recommendations, risk reports.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/deployment-strategy.json");
const MAX_PLANS  = 30;
const TTL_MS     = 48 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { strategies: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.strategies = (db.strategies || []).filter(s => s.ts > cutoff).slice(0, MAX_PLANS);
}

// ── Deployment readiness summary ──────────────────────────────────────────────

function deploymentReadinessSummary(deploymentId = "") {
    const checks = [];

    const sdc = _tryRequire("./smartDeploymentCoordination.cjs");
    if (sdc) {
        try {
            const readiness = sdc.checkDeploymentReadiness(deploymentId);
            checks.push({ check: "smart-deploy-readiness", ok: readiness.ready, detail: readiness.recommendation });
        } catch {}
    }

    const dae = _tryRequire("./dependencyAwareExecution.cjs");
    if (dae) {
        try {
            const staleDeps = dae.detectStaleDependencyChains();
            checks.push({ check: "dep-chains", ok: staleDeps.ok, detail: staleDeps.detail });
        } catch {}
    }

    const esi = _tryRequire("./executionStateIntelligence.cjs");
    if (esi) {
        try {
            const state = esi.executionStateSummary();
            checks.push({ check: "execution-state", ok: state.stable, detail: state.summary });
        } catch {}
    }

    const eri = _tryRequire("./executionRiskIntelligence.cjs");
    if (eri) {
        try {
            const risk = eri.deploymentRiskAssessment(deploymentId);
            checks.push({ check: "deployment-risk", ok: risk.ok, detail: `level=${risk.level}` });
        } catch {}
    }

    const allOk = checks.every(c => c.ok !== false);
    return {
        ok:           allOk,
        ready:        allOk,
        deploymentId,
        checks,
        blockers:     checks.filter(c => !c.ok).map(c => c.check),
        recommendation: allOk ? "Deployment ready" : `Resolve: ${checks.filter(c => !c.ok).map(c => c.check).join(", ")}`,
        approvalRequired: true,
    };
}

// ── Canary risk analysis ──────────────────────────────────────────────────────

function analyzeCanaryRisk(deploymentId = "", { errorRate = 0, latencyMs = 0, healthCheckPassed = true, trustScore = 65 } = {}) {
    const risks = [];

    if (errorRate > 0.02)        risks.push({ factor: "error-rate",     value: errorRate,  severity: errorRate > 0.05 ? "critical" : "warning" });
    if (latencyMs > 1500)        risks.push({ factor: "latency",        value: latencyMs,  severity: latencyMs > 3000 ? "critical" : "warning" });
    if (!healthCheckPassed)      risks.push({ factor: "health-check",   value: false,      severity: "critical" });
    if (trustScore < 50)         risks.push({ factor: "low-trust",      value: trustScore, severity: "warning" });

    const critical = risks.filter(r => r.severity === "critical").length;
    const proceed  = critical === 0;

    return {
        ok:          proceed,
        proceed,
        deploymentId,
        risks,
        critical,
        recommendation: proceed
            ? (risks.length > 0 ? "Canary viable — warnings present, monitor closely" : "Canary healthy — safe to advance")
            : `Hold canary — ${critical} critical issue(s)`,
        approvalRequired: !proceed,
    };
}

// ── Rollback strategy recommendation ─────────────────────────────────────────

function recommendRollbackStrategy(deploymentId = "", { operatorApproved = false } = {}) {
    const options = [];

    const sdc = _tryRequire("./smartDeploymentCoordination.cjs");
    if (sdc) {
        try {
            const surv = sdc.deploymentSurvivabilityAnalysis(deploymentId);
            options.push({ id: "phase-rollback", available: surv.rollbackAvailable, survivability: surv.survivability, score: surv.survivability });
        } catch {}
    }

    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    if (arc) {
        try {
            const compared = arc.compareRollbackOptions(options.length > 0 ? options : [{ id: "default-rollback", hasSnapshot: false }]);
            return { ok: true, deploymentId, ...compared, approvalRequired: true };
        } catch {}
    }

    options.push({ id: "manual-rollback", available: true, score: 40 });
    return {
        ok:           true,
        deploymentId,
        ranked:       options.sort((a, b) => (b.score || 0) - (a.score || 0)),
        recommended:  options[0],
        approvalRequired: true,
        explainer:    `Rollback strategy: '${options[0]?.id}' (score=${options[0]?.score || "??"})`,
    };
}

// ── Dependency readiness evaluation ──────────────────────────────────────────

function evaluateDependencyReadiness(deploymentId = "", services = []) {
    const dae = _tryRequire("./dependencyAwareExecution.cjs");
    if (!dae) return { ok: true, skipped: true, reason: "dependencyAwareExecution unavailable" };

    try {
        return { ok: true, ...dae.checkDeploymentDependencies(deploymentId, services) };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── Runtime-health-prioritized deployment plan ────────────────────────────────

function buildHealthPrioritizedDeployPlan(opts = {}) {
    const { deploymentId = "", service = "", version = "", canaryPct = 5 } = opts;
    if (!deploymentId) return { ok: false, error: "deploymentId required" };

    const stratId = crypto.randomUUID();
    const db      = _load(); _prune(db);

    // Gather runtime health score
    const esi = _tryRequire("./executionStateIntelligence.cjs");
    let runtimeStable = true;
    if (esi) { try { runtimeStable = esi.executionStateSummary().stable; } catch {} }

    const adjustedCanaryPct = runtimeStable ? canaryPct : Math.max(1, Math.floor(canaryPct / 2));

    const strategy = {
        stratId,
        deploymentId,
        service,
        version,
        runtimeStable,
        canaryPct: adjustedCanaryPct,
        phases: [
            { phase: "pre-check",  autonomous: true,  requiresApproval: false },
            { phase: "canary",     pct: adjustedCanaryPct, requiresApproval: true  },
            { phase: "staged",     pct: Math.round(adjustedCanaryPct * 5), requiresApproval: true  },
            { phase: "full",       pct: 100,           requiresApproval: true  },
            { phase: "post-check", autonomous: true,  requiresApproval: false },
        ],
        ts: Date.now(),
    };

    db.strategies.unshift(strategy);
    _save(db);

    return {
        ok:       true,
        stratId,
        deploymentId,
        runtimeStable,
        adjustedCanaryPct,
        phases:   strategy.phases,
        warning:  !runtimeStable ? "Canary percentage reduced — runtime unstable" : null,
        approvalRequired: true,
    };
}

// ── Operational risk report ───────────────────────────────────────────────────

function operationalRiskReport(deploymentId = "") {
    const eri = _tryRequire("./executionRiskIntelligence.cjs");
    let riskSummary = null;
    if (eri) { try { riskSummary = eri.riskSummary({ windowMs: 8 * 60 * 60 * 1000 }); } catch {} }

    const readiness = deploymentReadinessSummary(deploymentId);

    return {
        ok:             readiness.ok && riskSummary?.overall !== "high",
        deploymentId,
        riskLevel:      riskSummary?.overall || "unknown",
        riskDomains:    riskSummary?.domains?.map(d => ({ domain: d.domain, level: d.level })) || [],
        readinessOk:    readiness.ready,
        blockers:       readiness.blockers,
        recommendation: readiness.ready && riskSummary?.overall !== "high"
            ? "Deployment strategy clear — proceed with phased plan"
            : `Strategy blocked: risk=${riskSummary?.overall}, blockers=${readiness.blockers.join(", ") || "none"}`,
        approvalRequired: true,
    };
}

module.exports = { deploymentReadinessSummary, analyzeCanaryRisk, recommendRollbackStrategy, evaluateDependencyReadiness, buildHealthPrioritizedDeployPlan, operationalRiskReport };
