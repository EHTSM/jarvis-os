"use strict";
/**
 * Phase 752 — Deployment Execution Experience
 *
 * Staged deployment execution, rollback walkthroughs, readiness validation,
 * replay-linked continuity, operator-visible progression.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const DATA_FILE    = path.join(__dirname, "../../data/deployment-execution-experience.json");
const MAX_DEPLOYS  = 30;
const STALE_MS     = 12 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return { deployments: [] }; }
}
function _save(db) { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {} }

const DEPLOY_STAGES = [
    { name: "pre-flight-check",     requiresApproval: false },
    { name: "canary-deploy",        requiresApproval: true  },
    { name: "health-gate",          requiresApproval: false },
    { name: "ramp-50pct",           requiresApproval: true  },
    { name: "full-rollout",         requiresApproval: true  },
    { name: "post-deploy-verify",   requiresApproval: false },
];

function startDeploymentSession(deploymentId, context = {}) {
    if (!deploymentId) return { ok: false, error: "deploymentId required" };
    const db = _load();
    if (db.deployments.find(d => d.deploymentId === deploymentId)) return { ok: false, error: "deployment already exists" };

    const dep = {
        deploymentId, context,
        stage: 0, stages: DEPLOY_STAGES,
        status: "active",
        startedAt: Date.now(), updatedAt: Date.now(),
        replayId: context.replayId || null,
        history: [{ stage: DEPLOY_STAGES[0].name, ts: Date.now() }],
    };
    db.deployments.push(dep);
    if (db.deployments.length > MAX_DEPLOYS) db.deployments = db.deployments.slice(-MAX_DEPLOYS);
    _save(db);

    return { ok: true, deploymentId, currentStage: DEPLOY_STAGES[0].name, requiresApproval: DEPLOY_STAGES[0].requiresApproval };
}

function advanceDeploymentStage(deploymentId, { operatorApproved = false } = {}) {
    if (!deploymentId) return { ok: false, error: "deploymentId required" };
    const db = _load();
    const d  = db.deployments.find(x => x.deploymentId === deploymentId);
    if (!d) return { ok: false, error: "deployment not found" };
    if (d.status === "completed") return { ok: false, error: "deployment already completed" };
    if (d.status === "rolled-back") return { ok: false, error: "deployment was rolled back" };

    const curStage = DEPLOY_STAGES[d.stage];
    if (curStage.requiresApproval && !operatorApproved) {
        return { ok: false, requiresApproval: true, stage: curStage.name, message: `Stage '${curStage.name}' requires operator approval` };
    }

    d.history.push({ stage: curStage.name, completedAt: Date.now() });
    d.stage++;
    d.updatedAt = Date.now();

    if (d.stage >= DEPLOY_STAGES.length) {
        d.status = "completed";
        _save(db);
        return { ok: true, deploymentId, status: "completed" };
    }

    const next = DEPLOY_STAGES[d.stage];
    d.history.push({ stage: next.name, ts: Date.now() });
    _save(db);
    return { ok: true, deploymentId, completedStage: curStage.name, nextStage: next.name, requiresApproval: next.requiresApproval };
}

function rollbackDeployment(deploymentId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true, message: "Rollback requires operator approval" };
    const db = _load();
    const d  = db.deployments.find(x => x.deploymentId === deploymentId);
    if (!d) return { ok: false, error: "deployment not found" };
    d.status    = "rolled-back";
    d.updatedAt = Date.now();
    d.history.push({ stage: "rollback", ts: Date.now() });
    _save(db);
    return { ok: true, deploymentId, status: "rolled-back" };
}

function deploymentReadinessSummary(deploymentId = "") {
    const dpm = _tryRequire("./deploymentProductivityMaturity.cjs");
    if (!dpm) return { ok: false, reason: "deployment module unavailable" };
    try {
        const trust = dpm.operationalTrustReport(deploymentId);
        const ready = trust.trustScore >= 60;
        return { ok: true, ready, trustScore: trust.trustScore, level: trust.level, reason: ready ? "Ready for deployment" : `Trust too low (${trust.trustScore})` };
    } catch (e) { return { ok: false, error: e.message }; }
}

function getDeploymentProgress(deploymentId) {
    const db = _load();
    const d  = db.deployments.find(x => x.deploymentId === deploymentId);
    if (!d) return { ok: false, error: "deployment not found" };
    const now = Date.now();
    return {
        ok: true, deploymentId, status: d.status,
        currentStage: DEPLOY_STAGES[d.stage]?.name || "done",
        stageIndex: d.stage, totalStages: DEPLOY_STAGES.length,
        progress: Math.round((d.stage / DEPLOY_STAGES.length) * 100),
        stale: now - d.updatedAt > STALE_MS,
        replayId: d.replayId,
    };
}

module.exports = { startDeploymentSession, advanceDeploymentStage, rollbackDeployment, deploymentReadinessSummary, getDeploymentProgress };
