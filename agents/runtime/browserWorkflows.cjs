"use strict";
/**
 * Phase 574 — AI-Assisted Browser Operations
 *
 * Extraction-flow assistance, authenticated-session awareness,
 * replay-linked browsing, operational form automation, workflow guidance.
 *
 * Requirements: operator visibility, replay-safe actions, interruption-safe execution.
 */

const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Session awareness ─────────────────────────────────────────────────────────

const _activeSessions = new Map(); // sessionId -> BrowserSession

/**
 * Register an active browser session.
 */
function registerSession(sessionId, { url = "", authenticated = false, replayId = null } = {}) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const session = {
        id:            sessionId,
        url:           (url || "").slice(0, 300),
        authenticated,
        replayId,
        startedAt:     Date.now(),
        actionCount:   0,
        interrupted:   false,
        lastActionAt:  null,
    };
    _activeSessions.set(sessionId, session);
    return { ok: true, sessionId };
}

function getSession(sessionId) { return _activeSessions.get(sessionId) || null; }

function markInterrupted(sessionId) {
    const s = _activeSessions.get(sessionId);
    if (s) { s.interrupted = true; _activeSessions.set(sessionId, s); }
}

function recordAction(sessionId, actionType) {
    const s = _activeSessions.get(sessionId);
    if (s) {
        s.actionCount++;
        s.lastActionAt = Date.now();
        s.lastAction   = actionType;
        _activeSessions.set(sessionId, s);
    }
}

function listSessions() {
    return [..._activeSessions.values()];
}

// ── Extraction flow assistance ────────────────────────────────────────────────

/**
 * Build an extraction plan for a given URL pattern / goal.
 * @param {{ url, goal, authenticated, sessionId }} opts
 */
function extractionPlan(opts = {}) {
    const { url = "", goal = "", authenticated = false, sessionId = null } = opts;
    const lower  = goal.toLowerCase();
    const steps  = [];

    // Auth guard
    if (authenticated) {
        steps.push({ step: 1, action: "verify-session", note: "Confirm authenticated session is active before extraction", safe: true });
    } else {
        steps.push({ step: 1, action: "check-public-access", note: "Verify URL is publicly accessible", safe: true });
    }

    // Navigation
    steps.push({ step: steps.length + 1, action: "navigate", url, note: "Navigate to target URL", safe: true });

    // Wait for load
    steps.push({ step: steps.length + 1, action: "wait-for-load", note: "Wait for page DOMContentLoaded", safe: true });

    // Extraction strategy
    if (/table|list|row|data/i.test(lower)) {
        steps.push({ step: steps.length + 1, action: "extract-table", selector: "table, [role=grid], ul.list", note: "Extract tabular data", safe: true });
    }
    if (/form|input|submit/i.test(lower)) {
        steps.push({ step: steps.length + 1, action: "extract-form-fields", note: "Map form inputs before interacting", safe: true });
    }
    if (/pdf|download|file/i.test(lower)) {
        steps.push({ step: steps.length + 1, action: "intercept-download", note: "Intercept download response — requires operator approval", safe: false, requiresApproval: true });
    }

    // Always: screenshot for operator visibility
    steps.push({ step: steps.length + 1, action: "screenshot", note: "Capture page state for operator review", safe: true });

    return {
        url,
        goal,
        steps,
        authenticated,
        sessionId,
        replaySafe:       true,
        requiresApproval: steps.some(s => s.requiresApproval),
    };
}

// ── Form automation guidance ──────────────────────────────────────────────────

/**
 * Suggest safe form interaction steps.
 * Never auto-submits without explicit approval.
 */
function formAutomationGuide(formDescriptor = {}) {
    const { fields = [], submitUrl = "", requiresLogin = false } = formDescriptor;
    const steps = [];

    if (requiresLogin) {
        steps.push({ step: 1, action: "authenticate", note: "Log in before form interaction", requiresApproval: true });
    }

    fields.forEach((f, i) => {
        steps.push({ step: steps.length + 1, action: "fill-field", field: f.name || `field_${i}`, type: f.type || "text", note: `Fill field: ${f.name || i}`, safe: true });
    });

    // Preview before submit
    steps.push({ step: steps.length + 1, action: "preview-values", note: "Review all field values before submission", safe: true });
    steps.push({ step: steps.length + 1, action: "submit-BLOCKED", note: "Submission requires explicit operator approval — do not auto-submit", requiresApproval: true, safe: false });

    return { steps, submitBlocked: true, requiresApproval: true };
}

// ── Replay-safe action wrapper ────────────────────────────────────────────────

/**
 * Wrap a browser action for replay safety.
 * Checks if replayId is present and action is idempotent before proceeding.
 */
function replaySafeAction(action, { replayId = null, idempotent = true, sessionId = null } = {}) {
    if (!idempotent && replayId) {
        return {
            proceed: false,
            reason:  "Non-idempotent action skipped during replay to prevent duplicate side-effects",
            action,
            replayId,
        };
    }
    recordAction(sessionId, action);
    return { proceed: true, action, replayId };
}

// ── Interruption-safe checkpoint ──────────────────────────────────────────────

/**
 * Record a checkpoint so a browser session can resume after interruption.
 */
const _checkpoints = new Map();

function saveCheckpoint(sessionId, step, state = {}) {
    _checkpoints.set(sessionId, { sessionId, step, state, savedAt: Date.now() });
    return { ok: true, sessionId, step };
}

function loadCheckpoint(sessionId) {
    return _checkpoints.get(sessionId) || null;
}

module.exports = {
    registerSession, getSession, markInterrupted, recordAction, listSessions,
    extractionPlan, formAutomationGuide, replaySafeAction,
    saveCheckpoint, loadCheckpoint,
};
