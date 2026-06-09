"use strict";
/**
 * Phase 589 — Real Browser Workflow Execution
 *
 * Workflow-linked browsing, authenticated continuity, replay-safe extraction,
 * operational form automation, browser recovery flows.
 *
 * Requirements: operator visibility, interruption-safe, replay continuity.
 */

const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/browser-workflow-engine.json");

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { workflows: [], sessions: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}

// ── Workflow definition ───────────────────────────────────────────────────────

const WORKFLOW_CATALOG = {
    "crm-extraction": {
        desc:         "Extract CRM leads from authenticated admin panel",
        steps:        ["authenticate", "navigate-leads", "extract-table", "screenshot"],
        authenticated: true,
        replaySafe:    true,
    },
    "payment-status-check": {
        desc:         "Check payment status from payment gateway",
        steps:        ["authenticate", "navigate-payments", "extract-table", "screenshot"],
        authenticated: true,
        replaySafe:    true,
    },
    "public-api-probe": {
        desc:         "Probe a public API endpoint and extract response",
        steps:        ["navigate", "extract-json", "screenshot"],
        authenticated: false,
        replaySafe:    true,
    },
    "form-submit-guided": {
        desc:         "Guided form submission (requires explicit operator approval per field + submit)",
        steps:        ["navigate", "map-fields", "fill-fields-guided", "preview-values", "submit-REQUIRES-APPROVAL"],
        authenticated: false,
        replaySafe:    false,
    },
};

// ── Workflow session lifecycle ────────────────────────────────────────────────

function startWorkflow(workflowName, { sessionId = null, url = "", operatorId = null, replayId = null } = {}) {
    const def = WORKFLOW_CATALOG[workflowName];
    if (!def) return { ok: false, error: `Unknown workflow: ${workflowName}`, available: Object.keys(WORKFLOW_CATALOG) };

    const wfId = crypto.randomUUID();
    const db   = _load();

    const wf = {
        id:            wfId,
        name:          workflowName,
        url:           (url || "").slice(0, 300),
        sessionId,
        operatorId,
        replayId,
        status:        "active",
        authenticated: def.authenticated,
        currentStep:   0,
        steps:         def.steps,
        actionLog:     [],
        startedAt:     Date.now(),
        lastActionAt:  null,
        interrupted:   false,
    };

    db.workflows.unshift(wf);
    db.workflows = db.workflows.slice(0, 100);
    _save(db);

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.record("session", { label: `Browser workflow started: ${workflowName}`, sessionId, replayId });

    return { ok: true, workflowId: wfId, name: workflowName, steps: def.steps, requiresAuth: def.authenticated };
}

function advanceStep(workflowId, { result = null, operatorApproved = false } = {}) {
    const db  = _load();
    const idx = db.workflows.findIndex(w => w.id === workflowId);
    if (idx === -1) return { ok: false, error: "workflow not found" };

    const wf        = db.workflows[idx];
    const stepName  = wf.steps[wf.currentStep];

    // Submit step requires operator approval
    if ((stepName || "").includes("REQUIRES-APPROVAL") && !operatorApproved) {
        return { ok: false, error: `Step '${stepName}' requires explicit operator approval`, requiresApproval: true, stepName };
    }

    wf.actionLog.push({ step: stepName, result: result ? JSON.stringify(result).slice(0, 200) : null, ts: Date.now() });
    wf.lastActionAt  = Date.now();
    wf.currentStep   = Math.min(wf.currentStep + 1, wf.steps.length);

    const done       = wf.currentStep >= wf.steps.length;
    if (done) wf.status = "completed";

    db.workflows[idx] = wf;
    _save(db);

    return { ok: true, workflowId, nextStep: done ? null : wf.steps[wf.currentStep], progress: `${wf.currentStep}/${wf.steps.length}`, done };
}

function interruptWorkflow(workflowId, { reason = "" } = {}) {
    const db  = _load();
    const idx = db.workflows.findIndex(w => w.id === workflowId);
    if (idx === -1) return { ok: false };
    db.workflows[idx].interrupted    = true;
    db.workflows[idx].status         = "interrupted";
    db.workflows[idx].interruptReason = (reason || "").slice(0, 200);
    _save(db);
    return { ok: true, workflowId, resumeFromStep: db.workflows[idx].steps[db.workflows[idx].currentStep] };
}

function resumeWorkflow(workflowId) {
    const db  = _load();
    const wf  = db.workflows.find(w => w.id === workflowId);
    if (!wf || wf.status !== "interrupted") return { ok: false, error: "workflow not interrupted or not found" };
    return { ok: true, workflowId, resumeAtStep: wf.steps[wf.currentStep], currentStep: wf.currentStep, totalSteps: wf.steps.length };
}

// ── Authenticated session continuity ──────────────────────────────────────────

const _authSessions = new Map();

function recordAuthSession(sessionId, { domain = "", cookieCount = 0, expiresAt = null } = {}) {
    _authSessions.set(sessionId, { sessionId, domain, cookieCount, expiresAt, recordedAt: Date.now() });
    return { ok: true, sessionId };
}

function isSessionValid(sessionId) {
    const s = _authSessions.get(sessionId);
    if (!s) return { valid: false, reason: "session not registered" };
    if (s.expiresAt && Date.now() > s.expiresAt) return { valid: false, reason: "session expired" };
    return { valid: true, sessionId, domain: s.domain };
}

// ── Browser recovery flow ─────────────────────────────────────────────────────

/**
 * Recovery plan when a browser workflow fails or gets stuck.
 */
function browserRecoveryPlan(workflowId, errorType = "unknown") {
    const steps = [
        { order: 1, action: "screenshot-current-state", note: "Capture current page for operator review", safe: true },
        { order: 2, action: "clear-cookies",            note: "Clear session cookies to reset auth state", requiresApproval: true },
        { order: 3, action: "reload-page",              note: "Reload and retry from last checkpoint", safe: true },
    ];

    if (errorType === "auth-failure") {
        steps.unshift({ order: 0, action: "re-authenticate", note: "Re-authenticate — session likely expired", requiresApproval: true });
    }
    if (errorType === "timeout") {
        steps.unshift({ order: 0, action: "increase-timeout", note: "Increase wait timeout and retry", safe: true });
    }

    return { workflowId, errorType, steps, operatorVisibility: true };
}

// ── Query ─────────────────────────────────────────────────────────────────────

function listWorkflows({ status = null, sessionId = null } = {}) {
    const db = _load();
    return db.workflows.filter(w => (!status || w.status === status) && (!sessionId || w.sessionId === sessionId))
        .map(w => ({ id: w.id, name: w.name, status: w.status, currentStep: w.currentStep, totalSteps: w.steps.length, startedAt: w.startedAt }));
}

function getWorkflow(workflowId) {
    const db = _load();
    return db.workflows.find(w => w.id === workflowId) || null;
}

module.exports = { startWorkflow, advanceStep, interruptWorkflow, resumeWorkflow, recordAuthSession, isSessionValid, browserRecoveryPlan, listWorkflows, getWorkflow, WORKFLOW_CATALOG };
