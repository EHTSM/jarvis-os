"use strict";
/**
 * Phase 611 — Deployment Survivability Engine
 *
 * Ensures deployments survive partial failures: pre-deploy snapshots,
 * rollback detection, phased deployment state, survivability score.
 * Integrates with deployWorkflowEngine (602) without replacing it.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH   = path.join(__dirname, "../../data/deployment-survivability-engine.json");
const MAX_SNAPSHOTS = 20;
const SNAPSHOT_TTL  = 7 * 24 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { snapshots: [], phasedStates: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - SNAPSHOT_TTL;
    db.snapshots    = (db.snapshots    || []).filter(s => s.createdAt > cutoff).slice(0, MAX_SNAPSHOTS);
    db.phasedStates = (db.phasedStates || []).filter(s => s.createdAt > cutoff).slice(0, 50);
}

// ── Pre-deploy snapshot ───────────────────────────────────────────────────────

function captureSnapshot(deploymentId, { pipelineName = "", environment = "production", notes = "" } = {}) {
    if (!deploymentId) return { ok: false, error: "deploymentId required" };

    const db         = _load(); _prune(db);
    const snapshotId = crypto.randomUUID();

    const dv  = _tryRequire("./dailyEngineeringValidation.cjs");
    const tl  = _tryRequire("./operationalTrustLayer.cjs");

    let todayMetrics = null, trustScore = null;
    if (dv)  try { todayMetrics = dv.todayReport(); } catch {}
    if (tl)  try { trustScore   = tl.getTrustScore(); } catch {}

    db.snapshots.unshift({
        id:           snapshotId,
        deploymentId,
        pipelineName: (pipelineName || "").slice(0, 100),
        environment,
        notes:        (notes || "").slice(0, 200),
        todayMetrics,
        trustScore:   trustScore?.score || null,
        nodeVersion:  process.version,
        capturedAt:   Date.now(),
        createdAt:    Date.now(),
    });
    _save(db);
    return { ok: true, snapshotId, deploymentId };
}

function getSnapshot(deploymentId) {
    const db = _load(); _prune(db);
    return db.snapshots.find(s => s.deploymentId === deploymentId) || null;
}

// ── Phased deployment state ───────────────────────────────────────────────────

const PHASES = ["canary", "staged", "full"];

function initPhasedDeployment(deploymentId, { pipelineName = "", phases = PHASES } = {}) {
    const db       = _load(); _prune(db);
    const existing = db.phasedStates.findIndex(s => s.deploymentId === deploymentId);
    if (existing >= 0) return { ok: false, error: "Phased state already exists for this deployment" };

    db.phasedStates.unshift({
        deploymentId,
        pipelineName:  (pipelineName || "").slice(0, 100),
        phases:        phases.map(p => ({ name: p, status: "pending", startedAt: null, completedAt: null })),
        currentPhase:  0,
        createdAt:     Date.now(),
        lastActivityAt: Date.now(),
    });
    _save(db);
    return { ok: true, deploymentId, phases };
}

function advancePhase(deploymentId, { success = true, operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, error: "operator approval required to advance phase" };
    const db  = _load(); _prune(db);
    const idx = db.phasedStates.findIndex(s => s.deploymentId === deploymentId);
    if (idx === -1) return { ok: false, error: "phased deployment not found" };

    const state = db.phasedStates[idx];
    const phase = state.phases[state.currentPhase];
    if (!phase) return { ok: false, error: "all phases complete" };

    phase.status      = success ? "completed" : "failed";
    phase.completedAt = Date.now();

    if (success && state.currentPhase < state.phases.length - 1) {
        state.currentPhase++;
        state.phases[state.currentPhase].status    = "active";
        state.phases[state.currentPhase].startedAt = Date.now();
    }
    state.lastActivityAt = Date.now();
    db.phasedStates[idx] = state;
    _save(db);

    return {
        ok:             true,
        deploymentId,
        completedPhase: phase.name,
        nextPhase:      state.phases[state.currentPhase]?.name || "all-complete",
        allComplete:    state.currentPhase >= state.phases.length - 1 && success,
    };
}

// ── Rollback recommendation ───────────────────────────────────────────────────

function rollbackRecommendation(deploymentId) {
    const snapshot = getSnapshot(deploymentId);
    const dwe      = _tryRequire("./deployWorkflowEngine.cjs");
    let deployment  = null;
    if (dwe) try { deployment = dwe.getDeployment(deploymentId); } catch {}

    if (!deployment) return { ok: false, error: "deployment not found" };

    const shouldRollback =
        deployment.phase === "failed" ||
        (deployment.phase === "executing" && Date.now() - deployment.executedAt > 30 * 60 * 1000);

    return {
        ok:                true,
        deploymentId,
        shouldRollback,
        reason:            shouldRollback ? "Deployment failed or execution stalled >30min" : "Deployment appears healthy",
        snapshotAvailable: !!snapshot,
        snapshotAge:       snapshot ? Math.round((Date.now() - snapshot.capturedAt) / 60000) + "min" : null,
    };
}

// ── Survivability score ───────────────────────────────────────────────────────

function survivabilityScore() {
    const db  = _load(); _prune(db);
    const dwe = _tryRequire("./deployWorkflowEngine.cjs");

    let deployments = [];
    if (dwe) try { deployments = dwe.listDeployments({ limit: 30 }); } catch {}

    const completed  = deployments.filter(d => d.phase === "completed").length;
    const failed     = deployments.filter(d => d.phase === "failed").length;
    const rolledBack = deployments.filter(d => d.phase === "rolled-back").length;
    const total      = deployments.length;

    const successRate      = total > 0 ? completed / total : 1;
    const snapshotCoverage = db.snapshots.length > 0 ? Math.min(1, db.snapshots.length / Math.max(total, 1)) : 0.5;

    const score = Math.min(95, Math.round((successRate * 0.6 + snapshotCoverage * 0.4) * 100));
    return {
        score,
        grade:     score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : "D",
        total,
        completed,
        failed,
        rolledBack,
        snapshots: db.snapshots.length,
        summary:   `Deployment survivability: ${score}/95`,
    };
}

module.exports = { captureSnapshot, getSnapshot, initPhasedDeployment, advancePhase, rollbackRecommendation, survivabilityScore };
