"use strict";
/**
 * Phase 620 — Autonomous Browser Workflows
 *
 * Bounded browser workflow execution: extraction flows, auth continuity,
 * workflow-linked browsing, recovery-safe actions, replay-linked chains.
 * Operator visibility required. Anti-duplicate protection. Interrupt-safe.
 * Auto-submit permanently blocked.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH   = path.join(__dirname, "../../data/autonomous-browser.json");
const MAX_SESSIONS = 30;
const SESSION_TTL  = 4 * 60 * 60 * 1000; // 4h

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { sessions: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - SESSION_TTL;
    db.sessions = (db.sessions || []).filter(s => s.createdAt > cutoff).slice(0, MAX_SESSIONS);
}

// ── Anti-duplicate guard ──────────────────────────────────────────────────────

const _recentWorkflows = new Map(); // fingerprint -> ts
const DEDUP_WINDOW_MS   = 5 * 60 * 1000;

function _isDuplicate(workflowName, url) {
    const fp  = `${workflowName}:${url}`;
    const ts  = _recentWorkflows.get(fp);
    if (ts && Date.now() - ts < DEDUP_WINDOW_MS) return true;
    _recentWorkflows.set(fp, Date.now());
    return false;
}

// ── Workflow catalog ──────────────────────────────────────────────────────────

const WORKFLOW_CATALOG = {
    "data-extraction": {
        steps: [
            { order: 0, label: "Navigate to URL",         action: "navigate",         safe: true },
            { order: 1, label: "Verify page loaded",       action: "verify-load",      safe: true },
            { order: 2, label: "Screenshot for visibility",action: "screenshot",       safe: true },
            { order: 3, label: "Extract target data",      action: "extract",          safe: true },
            { order: 4, label: "Validate extraction",      action: "validate-extract", safe: true },
        ],
    },
    "auth-check": {
        steps: [
            { order: 0, label: "Navigate to auth page",   action: "navigate",         safe: true },
            { order: 1, label: "Check auth state",         action: "check-auth",       safe: true },
            { order: 2, label: "Screenshot auth status",   action: "screenshot",       safe: true },
        ],
    },
    "health-probe": {
        steps: [
            { order: 0, label: "Probe health endpoint",   action: "navigate",         safe: true },
            { order: 1, label: "Check response status",   action: "check-status",     safe: true },
            { order: 2, label: "Screenshot response",     action: "screenshot",       safe: true },
        ],
    },
    "form-review": {
        steps: [
            { order: 0, label: "Navigate to form",        action: "navigate",         safe: true },
            { order: 1, label: "Screenshot form",         action: "screenshot",       safe: true },
            { order: 2, label: "Review form fields",      action: "inspect-fields",   safe: true },
            { order: 3, label: "SUBMIT BLOCKED — operator must act", action: "submit-BLOCKED", safe: false, blocked: true },
        ],
    },
};

// ── Session lifecycle ─────────────────────────────────────────────────────────

function startSession(opts = {}) {
    const { workflowName = "data-extraction", url = "", sessionId = null, replayId = null, authDomain = null } = opts;

    if (!url) return { ok: false, error: "url required" };
    if (_isDuplicate(workflowName, url)) return { ok: false, duplicate: true, error: "Duplicate workflow — same URL in last 5 minutes" };

    const workflow = WORKFLOW_CATALOG[workflowName];
    if (!workflow) return { ok: false, error: `Unknown workflow: ${workflowName}. Available: ${Object.keys(WORKFLOW_CATALOG).join(", ")}` };

    // Check auth continuity
    const bwm      = _tryRequire("./browserWorkflowMaturity.cjs");
    let authSession = null;
    if (bwm && authDomain) {
        authSession = bwm.getAuthSession(authDomain);
    }

    const sessionDbId = crypto.randomUUID();
    const db          = _load(); _prune(db);

    db.sessions.unshift({
        id:           sessionDbId,
        workflowName,
        url:          (url || "").slice(0, 500),
        sessionId,
        replayId,
        authDomain,
        authValid:    !!authSession,
        steps:        workflow.steps.map(s => ({ ...s, status: "pending", result: null, executedAt: null })),
        currentStep:  0,
        status:       "active",
        interrupted:  false,
        checkpoints:  [],
        createdAt:    Date.now(),
        completedAt:  null,
    });
    _save(db);

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.record("session", { sessionDbId, workflowName, url: url.slice(0, 100), event: "autonomous-browser-started" });

    return {
        ok:          true,
        sessionDbId,
        workflowName,
        stepCount:   workflow.steps.length,
        authValid:   !!authSession,
        steps:       workflow.steps,
    };
}

function advanceStep(sessionDbId, { stepResult = null, operatorApproved = false } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.sessions.findIndex(s => s.id === sessionDbId);
    if (idx === -1) return { ok: false, error: "session not found" };

    const session = db.sessions[idx];
    if (session.interrupted) return { ok: false, error: "session interrupted" };

    const step = session.steps[session.currentStep];
    if (!step) return { ok: false, error: "no more steps", allComplete: true };

    if (step.blocked) {
        return { ok: false, blocked: true, reason: "This step is permanently blocked — operator must take manual action", step: step.label };
    }

    step.status     = "completed";
    step.result     = stepResult || { status: "executed", ts: Date.now() };
    step.executedAt = Date.now();

    session.checkpoints.push({ stepOrder: session.currentStep, ts: Date.now() });
    session.currentStep++;

    if (session.currentStep >= session.steps.length) {
        session.status      = "completed";
        session.completedAt = Date.now();
    }

    db.sessions[idx] = session;
    _save(db);

    return {
        ok:          true,
        sessionDbId,
        completedStep: step.label,
        nextStep:    session.steps[session.currentStep] || null,
        allComplete: session.status === "completed",
    };
}

function interruptSession(sessionDbId, { reason = "" } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.sessions.findIndex(s => s.id === sessionDbId);
    if (idx === -1) return { ok: false, error: "session not found" };

    db.sessions[idx].interrupted   = true;
    db.sessions[idx].status        = "interrupted";
    db.sessions[idx].interruptAt   = Date.now();
    db.sessions[idx].interruptReason = (reason || "").slice(0, 200);
    _save(db);
    return { ok: true, sessionDbId, interrupted: true };
}

function resumeSession(sessionDbId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, error: "operator approval required to resume browser session" };

    const db  = _load(); _prune(db);
    const idx = db.sessions.findIndex(s => s.id === sessionDbId);
    if (idx === -1) return { ok: false, error: "session not found" };

    db.sessions[idx].interrupted = false;
    db.sessions[idx].status      = "active";
    _save(db);

    const session = db.sessions[idx];
    return { ok: true, sessionDbId, currentStep: session.currentStep, nextStep: session.steps[session.currentStep] || null };
}

function listSessions({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.sessions
        .filter(s => !status || s.status === status)
        .slice(0, limit)
        .map(s => ({ id: s.id, workflowName: s.workflowName, status: s.status, currentStep: s.currentStep, total: s.steps.length, authValid: s.authValid, createdAt: s.createdAt }));
}

module.exports = { startSession, advanceStep, interruptSession, resumeSession, listSessions, WORKFLOW_CATALOG };
