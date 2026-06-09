"use strict";
/**
 * Phase 601 — Real Debugging Workflow Engine
 *
 * Operator-grade debugging sessions with full lifecycle:
 * open → ingest errors → cluster → root-cause → plan → execute steps → verify → close.
 *
 * Integrates: debuggingFlows (437), debugAssistMode (576), debuggingMode (515),
 *             executionTimeline (582), engineeringContextMemory (578).
 *
 * All step execution is advisory — no unsafe shell execution.
 * State: data/debug-workflow-engine.json
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/debug-workflow-engine.json");
const MAX_SESSIONS = 50;
const SESSION_TTL  = 24 * 60 * 60 * 1000; // 24h

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

// ── Session lifecycle ─────────────────────────────────────────────────────────

/**
 * Open a new debugging session.
 */
function openSession(opts = {}) {
    const { goal = "", operatorId = null, sessionId = null, projectName = null } = opts;
    if (!goal) return { ok: false, error: "goal required — describe what you are debugging" };

    const db   = _load();
    _prune(db);

    // Plan the flow
    const flows  = _tryRequire("./debuggingFlows.cjs");
    const plan   = flows ? flows.planDebug(goal) : { flowName: "debug-backend", flow: null };
    const assist = _tryRequire("./debugAssistMode.cjs");

    const id     = crypto.randomUUID();
    const session = {
        id,
        goal:         (goal || "").slice(0, 200),
        operatorId,
        sessionId:    sessionId || id,
        projectName,
        flowName:     plan.flowName,
        flow:         plan.flow,
        status:       "open",
        phase:        "collecting",   // collecting → analyzing → planning → executing → verifying → closed
        startedAt:    Date.now(),
        lastActivityAt: Date.now(),
        errors:       [],
        rootCauses:   [],
        recoveryPlan: null,
        steps:        [],
        stepResults:  [],
        resolved:     false,
        confidence:   0,
    };

    db.sessions.unshift(session);
    _save(db);

    // Activate debug assist mode
    if (assist) try { assist.activate(session.sessionId, goal); } catch {}

    // Timeline
    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.recordDebug(goal, "opened", session.sessionId);

    return { ok: true, sessionId: id, flowName: plan.flowName, flowSteps: plan.flow?.steps?.length || 0, phase: "collecting" };
}

/**
 * Ingest errors into an open session and advance to analysis.
 */
function ingestErrors(sessionId, errors = []) {
    const db  = _load();
    const idx = db.sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) return { ok: false, error: "session not found" };

    const session = db.sessions[idx];
    if (session.status !== "open") return { ok: false, error: `Session is ${session.status}` };

    session.errors = [...(session.errors || []), ...errors.map(e => (e || "").slice(0, 500))].slice(0, 50);
    session.lastActivityAt = Date.now();

    // Auto-analyze
    const assist = _tryRequire("./debugAssistMode.cjs");
    if (assist) {
        errors.forEach(e => { try { assist.ingestError(e); } catch {} });
        session.rootCauses = assist.rootCauseSuggestions(session.errors);
        session.depIssues  = assist.detectDependencyIssues(session.errors);
        session.recoveryPlan = assist.recoveryPlan(session.rootCauses, session.goal);
    }

    session.phase = "analyzing";
    db.sessions[idx] = session;
    _save(db);

    return { ok: true, sessionId, errorCount: session.errors.length, rootCauses: session.rootCauses, recoveryPlan: session.recoveryPlan };
}

/**
 * Build the execution plan for a session (moves to planning phase).
 */
function buildPlan(sessionId) {
    const db  = _load();
    const idx = db.sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) return { ok: false, error: "session not found" };

    const session = db.sessions[idx];
    const flows   = _tryRequire("./debuggingFlows.cjs");
    const flow    = flows && session.flowName ? flows.getFlow(session.flowName) : null;

    const steps = [];

    // Validation-first: always check runtime state first
    steps.push({ order: 0, type: "validate",  label: "Check runtime dashboard",     action: "GET /api/runtime/dashboard",         required: true });
    steps.push({ order: 1, type: "validate",  label: "Check pressure",              action: "GET /api/runtime/pressure",          required: true });

    // Flow-derived steps
    if (flow) {
        flow.steps.forEach((s, i) => steps.push({ order: i + 2, type: "inspect", label: s.label, action: s.cmd, approvalLevel: s.approvalLevel || "SAFE", required: false }));
    }

    // Root-cause-derived steps
    (session.rootCauses || []).forEach((c, i) => {
        steps.push({ order: steps.length, type: "recovery", label: `Fix: ${c.cause}`, action: c.fix, confidence: c.confidence, requiresApproval: true });
    });

    // Verify step
    steps.push({ order: steps.length, type: "verify", label: "Verify health post-recovery", action: "curl -s http://localhost:5050/health", required: true });

    session.steps  = steps;
    session.phase  = "planning";
    db.sessions[idx] = session;
    _save(db);

    return { ok: true, sessionId, stepCount: steps.length, steps };
}

/**
 * Record the result of a step execution.
 */
function recordStepResult(sessionId, stepOrder, result = {}) {
    const db  = _load();
    const idx = db.sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) return { ok: false, error: "session not found" };

    const session = db.sessions[idx];
    session.stepResults = [...(session.stepResults || [])].filter(r => r.order !== stepOrder);
    session.stepResults.push({ order: stepOrder, result, ts: Date.now() });
    session.lastActivityAt = Date.now();
    session.phase = "executing";
    db.sessions[idx] = session;
    _save(db);
    return { ok: true, sessionId, stepOrder };
}

/**
 * Close a debugging session with outcome.
 */
function closeSession(sessionId, { resolved = false, notes = "" } = {}) {
    const db  = _load();
    const idx = db.sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) return { ok: false, error: "session not found" };

    const session    = db.sessions[idx];
    session.status   = "closed";
    session.phase    = "closed";
    session.resolved = resolved;
    session.notes    = (notes || "").slice(0, 500);
    session.closedAt = Date.now();
    session.durationMs = session.closedAt - session.startedAt;

    const stepsDone  = (session.stepResults || []).length;
    const stepsTotal = (session.steps || []).length;
    session.confidence = stepsTotal > 0 ? Math.round(stepsDone / stepsTotal * 100) : 0;

    db.sessions[idx] = session;
    _save(db);

    // Record to memory + timeline + daily validation
    const mem = _tryRequire("./engineeringContextMemory.cjs");
    if (mem && resolved) {
        try { mem.recordDebugChain({ chainName: session.flowName, errorPattern: session.errors[0] || "", resolution: notes, confidence: session.confidence, sessionId }); } catch {}
    }
    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.recordDebug(session.goal, resolved ? "resolved" : "closed-unresolved", sessionId);

    const dv = _tryRequire("./dailyEngineeringValidation.cjs");
    if (dv) try { dv.recordDebuggingSession({ resolved, durationMs: session.durationMs }); } catch {}

    // Deactivate debug assist
    const assist = _tryRequire("./debugAssistMode.cjs");
    if (assist) try { assist.deactivate(); } catch {}

    return { ok: true, sessionId, resolved, durationMs: session.durationMs, confidence: session.confidence };
}

// ── Query ─────────────────────────────────────────────────────────────────────

function getSession(sessionId) {
    const db = _load(); _prune(db);
    return db.sessions.find(s => s.id === sessionId) || null;
}

function listSessions({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.sessions
        .filter(s => !status || s.status === status)
        .slice(0, limit)
        .map(s => ({ id: s.id, goal: s.goal, status: s.status, phase: s.phase, flowName: s.flowName, resolved: s.resolved, startedAt: s.startedAt, durationMs: s.durationMs || null }));
}

function activeSessions() { return listSessions({ status: "open" }); }

module.exports = { openSession, ingestErrors, buildPlan, recordStepResult, closeSession, getSession, listSessions, activeSessions };
