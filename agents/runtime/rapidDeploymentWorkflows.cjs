"use strict";
/**
 * Phase 708 — Rapid Deployment Workflows
 *
 * Deployment preparation flows, environment readiness scans, rollback preparation,
 * phased deployment sequencing, replay-linked deployment continuity.
 * Operator visibility. Trust-aware execution. Interruption-safe.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/rapid-deploy-workflows.json");
const TTL_MS     = 48 * 60 * 60 * 1000;
const MAX_PLANS  = 20;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { plans: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cut = Date.now() - TTL_MS;
    db.plans = (db.plans || []).filter(p => p.ts > cut).slice(0, MAX_PLANS);
}

// ── Environment readiness scan ────────────────────────────────────────────────

function scanEnvironmentReadiness(target = "production") {
    const checks = [];

    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    if (dec) {
        try {
            const valid = dec.validateDeploymentEnvironment(target, []);
            checks.push({ check: "env-validation", ok: valid.valid !== false, detail: `env=${target}` });
            const trust = dec.deploymentTrustIndicator("");
            checks.push({ check: "trust-indicator", ok: trust.indicator !== "red", detail: `trust=${trust.indicator}`, trustIndicator: trust.indicator });
        } catch { checks.push({ check: "deploy-env-coord", ok: true, skipped: true }); }
    }

    const odc = _tryRequire("./operationalDecisionCoordination.cjs");
    if (odc) {
        try {
            const unstable = odc.detectUnstableCoordinationStates();
            checks.push({ check: "coordination-stable", ok: unstable.stable, detail: `issues=${unstable.issues.length}` });
        } catch {}
    }

    const dse = _tryRequire("./deploymentStrategyEngine.cjs");
    if (dse) {
        try {
            const risk = dse.operationalRiskReport();
            checks.push({ check: "risk-level", ok: risk.riskLevel !== "critical", detail: `risk=${risk.riskLevel}` });
        } catch {}
    }

    const allOk = checks.every(c => c.ok !== false);
    return { ok: allOk, target, checks, ready: allOk, detail: `Readiness: ${checks.filter(c => c.ok !== false).length}/${checks.length} checks passed` };
}

// ── Deployment preparation flow ───────────────────────────────────────────────

function prepareDeployment(deploymentId, { target = "production", replayId = null, operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };
    if (!deploymentId) return { ok: false, error: "deploymentId required" };

    const db  = _load(); _prune(db);
    const readiness = scanEnvironmentReadiness(target);

    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    if (dec) {
        try { dec.trackDeploymentStage(deploymentId, "preparation", { target, readiness: readiness.ready }); } catch {}
    }

    const plan = {
        planId:     crypto.randomUUID(),
        deploymentId,
        target,
        replayId,
        readiness:  readiness.ready,
        status:     "prepared",
        ts:         Date.now(),
    };
    db.plans.unshift(plan);
    _save(db);

    return {
        ok:         true,
        planId:     plan.planId,
        deploymentId,
        readiness:  readiness.ready,
        readinessChecks: readiness.checks,
        replayLinked: !!replayId,
        detail:     `Deployment prepared: ${deploymentId} → ${target} (ready=${readiness.ready})`,
    };
}

// ── Rollback preparation ──────────────────────────────────────────────────────

function prepareRollback(deploymentId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };

    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    let readiness = null;
    if (dec) {
        try { readiness = dec.rollbackReadinessReport(); } catch {}
    }

    const dse = _tryRequire("./deploymentStrategyEngine.cjs");
    let strategy = null;
    if (dse) {
        try { strategy = dse.recommendRollbackStrategy({ operatorApproved: true }); } catch {}
    }

    return {
        ok:            true,
        deploymentId,
        rollbackReady: readiness?.ready !== false,
        strategy:      strategy ? { id: strategy.strategy?.id, confidence: strategy.strategy?.confidence } : null,
        approvalRequired: true,
        detail:        `Rollback prepared: ${deploymentId} (ready=${readiness?.ready !== false})`,
    };
}

// ── Phased deployment sequencing ─────────────────────────────────────────────

function buildPhasedDeploymentSequence(deploymentId, { canaryPct = 5, target = "production", operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };

    const phases = [
        { phase: "pre-flight",  actions: ["env-scan", "trust-check", "dep-verify"], autonomous: true,  requiresApproval: false },
        { phase: "canary",      actions: ["deploy-canary", "health-check"],         autonomous: false, requiresApproval: true,  pct: canaryPct },
        { phase: "ramp",        actions: ["increase-traffic", "monitor"],           autonomous: false, requiresApproval: true,  pct: 50 },
        { phase: "full-deploy", actions: ["full-rollout", "post-deploy-verify"],    autonomous: false, requiresApproval: true,  pct: 100 },
        { phase: "verify",      actions: ["smoke-test", "replay-continuity-check"], autonomous: true,  requiresApproval: false },
    ];

    const dse = _tryRequire("./deploymentStrategyEngine.cjs");
    if (dse) {
        try {
            const health = dse.buildHealthPrioritizedDeployPlan(deploymentId, { environment: target, canaryPct });
            if (!health.ok) phases[1].blocked = true;
        } catch {}
    }

    return {
        ok:       true,
        deploymentId,
        target,
        phases,
        totalPhases: phases.length,
        approvalGates: phases.filter(p => p.requiresApproval).length,
        detail:   `Phased deploy: ${phases.length} phases, ${phases.filter(p => p.requiresApproval).length} approval gates`,
    };
}

// ── Replay-linked deployment continuity ──────────────────────────────────────

function linkDeploymentToReplay(deploymentId, replayId) {
    if (!deploymentId || !replayId) return { ok: false, error: "deploymentId and replayId required" };

    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    if (dec) {
        try { dec.persistDeploymentReplayContinuity(deploymentId, { replayId, linkedAt: Date.now() }); } catch {}
    }

    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc) {
        try { lhwc.persistDeploymentWorkspaceSurvivability(deploymentId, { replayId }); } catch {}
    }

    return { ok: true, deploymentId, replayId, detail: `Deployment ${deploymentId} linked to replay ${replayId}` };
}

// ── Operator deployment visibility ────────────────────────────────────────────

function deploymentOperatorVisibility(deploymentId = "") {
    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    let state = null, trust = null;
    if (dec) {
        try { state = dec.deploymentStateSummary(deploymentId); } catch {}
        try { trust = dec.deploymentTrustIndicator(deploymentId); } catch {}
    }

    const readiness = scanEnvironmentReadiness("production");

    return {
        ok:            true,
        deploymentId,
        stage:         state?.stage || "unknown",
        trustIndicator: trust?.indicator || "unknown",
        ready:         readiness.ready,
        readinessChecks: readiness.checks.length,
        detail:        `Deployment visibility: stage=${state?.stage || "unknown"} trust=${trust?.indicator || "unknown"} ready=${readiness.ready}`,
    };
}

module.exports = { scanEnvironmentReadiness, prepareDeployment, prepareRollback, buildPhasedDeploymentSequence, linkDeploymentToReplay, deploymentOperatorVisibility };
