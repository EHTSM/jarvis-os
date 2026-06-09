"use strict";
/**
 * Phase 602 — Real Deployment Workflow Engine
 *
 * Operator-grade deployment sessions with full lifecycle:
 * open → preflight → approve → execute → monitor → verify → close/rollback.
 *
 * Integrates: deploymentAssist (577), deploymentPipeline, executionTimeline (582),
 *             executionConfidence (575), dailyEngineeringValidation (580).
 *
 * All destructive steps require explicit operator approval.
 * State: data/deploy-workflow-engine.json
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH    = path.join(__dirname, "../../data/deploy-workflow-engine.json");
const MAX_SESSIONS  = 30;
const SESSION_TTL   = 48 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { sessions: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - SESSION_TTL;
    db.sessions  = db.sessions.filter(s => s.startedAt > cutoff).slice(0, MAX_SESSIONS);
}

// ── Deployment phases ─────────────────────────────────────────────────────────

const DEPLOY_PHASES = ["preflight", "approved", "executing", "monitoring", "verifying", "completed", "failed", "rolled-back"];

// ── Session lifecycle ─────────────────────────────────────────────────────────

function openDeployment(opts = {}) {
    const { pipelineName = "standard-deploy", operatorId = null, sessionId = null, notes = "", environment = "production" } = opts;

    const da   = _tryRequire("./deploymentAssist.cjs");
    const conf = _tryRequire("./executionConfidence.cjs");

    // Run preflight immediately
    let preflight = null, depCheck = null, readiness = null, confidence = null;
    if (da) {
        try { preflight  = da.preflightSummary(pipelineName); } catch {}
        try { depCheck   = da.dependencyIntegrityCheck();     } catch {}
        try { readiness  = da.runtimeReadiness();             } catch {}
        try { const stale = da.staleDeploymentCheck(); if (stale.stale) return { ok: false, error: "Stale deployment detected — resolve before opening new deployment", stale }; } catch {}
    }
    if (conf && preflight) {
        try { confidence = conf.deploymentConfidence({ preflightOk: preflight.ready, envClear: depCheck?.ok, priorSuccesses: 0, priorFailures: 0 }); } catch {}
    }

    if (preflight && preflight.blockers.length > 0) {
        return { ok: false, error: "Preflight blockers must be resolved before deployment", blockers: preflight.blockers, preflight };
    }

    const db  = _load(); _prune(db);
    const id  = crypto.randomUUID();

    const session = {
        id,
        pipelineName,
        environment,
        operatorId,
        sessionId:    sessionId || id,
        notes:        (notes || "").slice(0, 300),
        status:       "open",
        phase:        "preflight",
        startedAt:    Date.now(),
        lastActivityAt: Date.now(),
        preflight,
        depCheck,
        readiness,
        confidence:   confidence?.score || null,
        approvedAt:   null,
        executedAt:   null,
        completedAt:  null,
        runId:        null,
        rollbackTriggered: false,
        events:       [{ ts: Date.now(), event: "opened", detail: `Pipeline: ${pipelineName}` }],
    };

    db.sessions.unshift(session);
    _save(db);

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.recordDeployment(pipelineName, "preflight", null, session.sessionId);

    return {
        ok:           true,
        deploymentId: id,
        pipelineName,
        environment,
        phase:        "preflight",
        preflightReady: preflight?.ready ?? null,
        confidence:   confidence?.score || null,
        warnings:     preflight?.warnings || [],
        requiresApproval: true,
    };
}

/**
 * Operator explicitly approves a deployment.
 */
function approveDeployment(deploymentId, { operatorId = null, approved = false } = {}) {
    if (!approved) return { ok: false, error: "Explicit approval required: pass { approved: true }" };

    const db  = _load();
    const idx = db.sessions.findIndex(s => s.id === deploymentId);
    if (idx === -1) return { ok: false, error: "deployment not found" };

    const session = db.sessions[idx];
    if (session.phase !== "preflight") return { ok: false, error: `Cannot approve: already in phase '${session.phase}'` };

    session.phase      = "approved";
    session.approvedAt = Date.now();
    session.approvedBy = operatorId;
    session.events.push({ ts: Date.now(), event: "approved", detail: `Approved by ${operatorId || "operator"}` });
    session.lastActivityAt = Date.now();
    db.sessions[idx]   = session;
    _save(db);

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.recordDeployment(session.pipelineName, "approved", null, session.sessionId);

    return { ok: true, deploymentId, phase: "approved", approvedAt: new Date(session.approvedAt).toISOString() };
}

/**
 * Record deployment execution start.
 */
function recordExecutionStart(deploymentId, { runId = null } = {}) {
    const db  = _load();
    const idx = db.sessions.findIndex(s => s.id === deploymentId);
    if (idx === -1) return { ok: false, error: "deployment not found" };

    const session = db.sessions[idx];
    if (session.phase !== "approved") return { ok: false, error: `Cannot execute: phase is '${session.phase}' not 'approved'` };

    session.phase       = "executing";
    session.executedAt  = Date.now();
    session.runId       = runId;
    session.events.push({ ts: Date.now(), event: "execution-started", detail: `runId: ${runId}` });
    session.lastActivityAt = Date.now();
    db.sessions[idx]    = session;
    _save(db);

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.recordDeployment(session.pipelineName, "executing", runId, session.sessionId);

    return { ok: true, deploymentId, phase: "executing", runId };
}

/**
 * Record a monitoring event during deployment.
 */
function recordMonitorEvent(deploymentId, event = "") {
    const db  = _load();
    const idx = db.sessions.findIndex(s => s.id === deploymentId);
    if (idx === -1) return { ok: false };
    const session = db.sessions[idx];
    session.phase = "monitoring";
    session.events.push({ ts: Date.now(), event: "monitor", detail: (event || "").slice(0, 200) });
    session.lastActivityAt = Date.now();
    db.sessions[idx] = session;
    _save(db);
    return { ok: true };
}

/**
 * Complete a deployment successfully.
 */
function completeDeployment(deploymentId, { success = true, notes = "" } = {}) {
    const db  = _load();
    const idx = db.sessions.findIndex(s => s.id === deploymentId);
    if (idx === -1) return { ok: false, error: "deployment not found" };

    const session      = db.sessions[idx];
    session.phase      = success ? "completed" : "failed";
    session.status     = "closed";
    session.completedAt= Date.now();
    session.durationMs = session.completedAt - session.startedAt;
    session.success    = success;
    session.closingNotes = (notes || "").slice(0, 300);
    session.events.push({ ts: Date.now(), event: success ? "completed" : "failed", detail: notes });
    db.sessions[idx]   = session;
    _save(db);

    // Record metrics
    const dv = _tryRequire("./dailyEngineeringValidation.cjs");
    if (dv) try { dv.recordDeployment({ success, rollback: false }); } catch {}

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.recordDeployment(session.pipelineName, success ? "completed" : "failed", session.runId, session.sessionId);

    // Record pattern to operator memory
    const mem = _tryRequire("./operatorWorkflowMemory.cjs");
    if (mem && success) {
        try { mem.recordDeployPattern({ pipelineName: session.pipelineName, environment: session.environment, successRate: 1, avgDurationMs: session.durationMs }); } catch {}
    }

    return { ok: true, deploymentId, success, durationMs: session.durationMs };
}

/**
 * Trigger rollback on a deployment.
 */
function triggerRollback(deploymentId, { approved = false, reason = "" } = {}) {
    if (!approved) return { ok: false, error: "Explicit approval required for rollback" };

    const db  = _load();
    const idx = db.sessions.findIndex(s => s.id === deploymentId);
    if (idx === -1) return { ok: false, error: "deployment not found" };

    const session             = db.sessions[idx];
    session.phase             = "rolled-back";
    session.status            = "closed";
    session.rollbackTriggered = true;
    session.rollbackAt        = Date.now();
    session.rollbackReason    = (reason || "").slice(0, 300);
    session.events.push({ ts: Date.now(), event: "rollback", detail: reason });
    db.sessions[idx]          = session;
    _save(db);

    const dv = _tryRequire("./dailyEngineeringValidation.cjs");
    if (dv) try { dv.recordDeployment({ success: false, rollback: true }); } catch {}

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.recordDeployment(session.pipelineName, "rolled-back", session.runId, session.sessionId);

    return { ok: true, deploymentId, phase: "rolled-back", reason };
}

// ── Query ─────────────────────────────────────────────────────────────────────

function getDeployment(deploymentId) {
    const db = _load(); _prune(db);
    return db.sessions.find(s => s.id === deploymentId) || null;
}

function listDeployments({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.sessions
        .filter(s => !status || s.status === status)
        .slice(0, limit)
        .map(s => ({ id: s.id, pipelineName: s.pipelineName, environment: s.environment, phase: s.phase, success: s.success, confidence: s.confidence, startedAt: s.startedAt, durationMs: s.durationMs || null }));
}

module.exports = { openDeployment, approveDeployment, recordExecutionStart, recordMonitorEvent, completeDeployment, triggerRollback, getDeployment, listDeployments };
