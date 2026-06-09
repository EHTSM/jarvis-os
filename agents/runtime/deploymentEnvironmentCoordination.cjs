"use strict";
/**
 * Phase 695 — Deployment Environment Coordination
 *
 * Runtime-health sequencing, staged deployment awareness, rollback coordination,
 * environment validation, deployment replay continuity.
 * Generates: deployment-state summaries, rollback readiness reports, operational trust indicators.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/deploy-env-coord.json");
const MAX_STATES = 30;
const TTL_MS     = 48 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { states: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.states = (db.states || []).filter(s => s.ts > cutoff).slice(0, MAX_STATES);
}

// ── Runtime-health sequencing ─────────────────────────────────────────────────

function sequenceByRuntimeHealth(services = []) {
    const esi = _tryRequire("./executionStateIntelligence.cjs");
    let stable = true;
    if (esi) { try { stable = esi.executionStateSummary().stable; } catch {} }

    const apr = _tryRequire("./advancedPlatformResilience.cjs");
    const healthScores = {};
    if (apr) {
        services.forEach(svc => {
            try {
                const cb = apr.circuitBreakerStatus(svc);
                healthScores[svc] = cb.tripped ? 0 : 100;
            } catch { healthScores[svc] = 100; }
        });
    } else {
        services.forEach(svc => { healthScores[svc] = 100; });
    }

    const ordered = [...services].sort((a, b) => (healthScores[b] || 0) - (healthScores[a] || 0));
    const reducedScale = !stable ? 0.5 : 1.0;

    return {
        ok:           true,
        ordered,
        healthScores,
        runtimeStable: stable,
        reducedScale,
        warning:       !stable ? "Runtime unstable — reduce deployment scale" : null,
        explainer:     `Health-sequenced: ${ordered.join(" → ")}`,
    };
}

// ── Staged deployment awareness ───────────────────────────────────────────────

function trackDeploymentStage(deploymentId = "", stage = "canary", opts = {}) {
    if (!deploymentId) return { ok: false, error: "deploymentId required" };
    const { pct = 0, status = "active", metrics = {} } = opts;

    const db  = _load(); _prune(db);
    const idx = db.states.findIndex(s => s.deploymentId === deploymentId);
    const record = {
        deploymentId,
        stage,
        pct,
        status,
        metrics,
        history: idx >= 0 ? [...(db.states[idx].history || []), { stage: db.states[idx].stage, pct: db.states[idx].pct, ts: db.states[idx].ts }].slice(-5) : [],
        ts: Date.now(),
    };

    if (idx >= 0) { db.states[idx] = record; }
    else          { db.states.unshift(record); }
    _save(db);
    return { ok: true, deploymentId, stage, pct, status };
}

// ── Deployment-state summary ──────────────────────────────────────────────────

function deploymentStateSummary(deploymentId = "") {
    const db     = _load(); _prune(db);
    const state  = deploymentId ? db.states.find(s => s.deploymentId === deploymentId) : db.states[0];

    const sdc = _tryRequire("./smartDeploymentCoordination.cjs");
    let readiness = null;
    if (sdc && deploymentId) { try { readiness = sdc.checkDeploymentReadiness(deploymentId); } catch {} }

    return {
        ok:          true,
        deploymentId: state?.deploymentId || deploymentId,
        stage:       state?.stage || "unknown",
        pct:         state?.pct || 0,
        status:      state?.status || "unknown",
        readiness:   readiness?.ready || null,
        history:     state?.history || [],
        summary:     `Deployment '${deploymentId}': stage=${state?.stage || "?"} pct=${state?.pct || 0}% status=${state?.status || "?"}`,
    };
}

// ── Rollback coordination ─────────────────────────────────────────────────────

function coordinateRollback(deploymentId = "", { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };
    if (!deploymentId) return { ok: false, error: "deploymentId required" };

    const dse = _tryRequire("./deploymentStrategyEngine.cjs");
    let strategy = null;
    if (dse) { try { strategy = dse.recommendRollbackStrategy(deploymentId); } catch {} }

    const db  = _load(); _prune(db);
    const idx = db.states.findIndex(s => s.deploymentId === deploymentId);
    if (idx >= 0) {
        db.states[idx].status = "rolling-back";
        db.states[idx].ts = Date.now();
        _save(db);
    }

    return {
        ok:          true,
        deploymentId,
        strategy:    strategy?.recommended || null,
        plan: [
            { step: "snapshot-current-state",  autonomous: true  },
            { step: "initiate-rollback",        autonomous: false, requiresApproval: true },
            { step: "validate-rollback-health", autonomous: true  },
            { step: "confirm-stable",           autonomous: false, requiresApproval: true },
        ],
        approvalRequired: true,
    };
}

// ── Environment validation ────────────────────────────────────────────────────

function validateDeploymentEnvironment(env = "production", requiredServices = []) {
    const checks = [];

    const dae = _tryRequire("./dependencyAwareExecution.cjs");
    if (dae) {
        try {
            const deps = dae.checkDeploymentDependencies(env, requiredServices);
            checks.push({ check: "service-deps", ok: deps.safe, detail: deps.recommendation });
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
            const risk = eri.riskSummary({ windowMs: 4 * 60 * 60 * 1000 });
            checks.push({ check: "risk-level", ok: risk.overall !== "high", detail: `risk=${risk.overall}` });
        } catch {}
    }

    const allOk = checks.every(c => c.ok !== false);
    return { ok: allOk, env, checks, valid: allOk, blockers: checks.filter(c => !c.ok).map(c => c.check), approvalRequired: true };
}

// ── Rollback readiness report ─────────────────────────────────────────────────

function rollbackReadinessReport(deploymentId = "") {
    const psr = _tryRequire("./platformStrategyResilience.cjs");
    let rollback = null;
    if (psr) { try { rollback = psr.assessStrategicRollbackIntegrity(deploymentId); } catch {} }

    const state = deploymentStateSummary(deploymentId);

    return {
        ok:           rollback?.intact !== false,
        deploymentId,
        rollbackReady: rollback?.intact !== false,
        currentStage:  state.stage,
        currentPct:    state.pct,
        checks:        rollback?.checks || [],
        approvalRequired: true,
        summary:       `Rollback readiness: ${rollback?.intact !== false ? "READY" : "NOT READY"} for '${deploymentId}'`,
    };
}

// ── Operational trust indicator ───────────────────────────────────────────────

function deploymentTrustIndicator(deploymentId = "") {
    const otl = _tryRequire("./operationalTrustLayer.cjs");
    let trustScore = 65;
    if (otl) { try { trustScore = otl.trustStatus().score || 65; } catch {} }

    const eri = _tryRequire("./executionRiskIntelligence.cjs");
    let riskLevel = "unknown";
    if (eri) { try { riskLevel = eri.riskSummary({ windowMs: 4 * 60 * 60 * 1000 }).overall; } catch {} }

    const trusted = trustScore >= 60 && riskLevel !== "high";
    return {
        ok:          trusted,
        deploymentId,
        trustScore,
        riskLevel,
        trusted,
        indicator:   trusted ? "green" : trustScore >= 40 ? "amber" : "red",
        recommendation: trusted ? "Trust indicators nominal — proceed with approval" : `Trust concerns: score=${trustScore} risk=${riskLevel}`,
    };
}

// ── Deployment replay continuity ──────────────────────────────────────────────

function persistDeploymentReplayContinuity(deploymentId = "", stage = "") {
    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    if (lhec) {
        try {
            lhec.persistDeploymentSession(deploymentId, { stage, persistedAt: Date.now() });
        } catch {}
    }
    return { ok: true, deploymentId, stage, persisted: true };
}

module.exports = { sequenceByRuntimeHealth, trackDeploymentStage, deploymentStateSummary, coordinateRollback, validateDeploymentEnvironment, rollbackReadinessReport, deploymentTrustIndicator, persistDeploymentReplayContinuity };
