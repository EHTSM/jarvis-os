"use strict";
/**
 * Phase 610 — Debugging Session Continuity
 *
 * Persists and restores debug session state across interruptions:
 * error context, root causes, step progress, editor context, hypothesis log.
 * Operator can resume a debug session days later with full context.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/debug-session-continuity.json");
const MAX_SESSIONS = 50;
const SESSION_TTL  = 14 * 24 * 60 * 60 * 1000; // 14 days

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { sessions: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - SESSION_TTL;
    db.sessions  = (db.sessions || []).filter(s => s.savedAt > cutoff).slice(0, MAX_SESSIONS);
}

// ── Save session state ────────────────────────────────────────────────────────

function saveSessionState(sessionId, state = {}) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const db  = _load(); _prune(db);
    const idx = db.sessions.findIndex(s => s.sessionId === sessionId);

    const record = {
        sessionId,
        goal:         (state.goal         || "").slice(0, 200),
        errors:       (state.errors        || []).slice(0, 20).map(e => (e || "").slice(0, 300)),
        rootCauses:   (state.rootCauses    || []).slice(0, 10),
        hypotheses:   (state.hypotheses    || []).slice(0, 20).map(h => (h || "").slice(0, 200)),
        currentStep:  state.currentStep    || 0,
        completedSteps: state.completedSteps || [],
        editorContext: state.editorContext  || null,
        notes:        (state.notes         || "").slice(0, 500),
        status:       state.status         || "active",
        savedAt:      Date.now(),
    };

    if (idx >= 0) { db.sessions[idx] = record; }
    else          { db.sessions.unshift(record); }
    db.sessions = db.sessions.slice(0, MAX_SESSIONS);
    _save(db);

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.record("session", { sessionId, event: "continuity-saved", step: record.currentStep });

    return { ok: true, sessionId, savedAt: record.savedAt };
}

// ── Restore session state ─────────────────────────────────────────────────────

function restoreSessionState(sessionId) {
    const db     = _load(); _prune(db);
    const record = db.sessions.find(s => s.sessionId === sessionId);
    if (!record) return { ok: false, error: "No saved state for session" };

    // Also restore editor context if available
    const vscm = _tryRequire("./vscodeExecutionMaturity.cjs");
    if (vscm && record.editorContext) {
        try { vscm.setEditorContext(sessionId, record.editorContext); } catch {}
    }

    // Also restore to debug workflow engine if session is open
    const dwe = _tryRequire("./debugWorkflowEngine.cjs");
    let activeSession = null;
    if (dwe) {
        try { activeSession = dwe.getSession(sessionId); } catch {}
    }

    return {
        ok:            true,
        sessionId,
        record,
        age:           Math.round((Date.now() - record.savedAt) / 60000) + "min ago",
        activeSession: activeSession ? { phase: activeSession.phase, status: activeSession.status } : null,
    };
}

// ── Hypothesis tracking ───────────────────────────────────────────────────────

function addHypothesis(sessionId, hypothesis = "", { confidence = 50 } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.sessions.findIndex(s => s.sessionId === sessionId);
    if (idx === -1) return { ok: false, error: "session not found — save state first" };

    db.sessions[idx].hypotheses = [...(db.sessions[idx].hypotheses || []), {
        text:       (hypothesis || "").slice(0, 200),
        confidence: Math.min(95, Math.max(0, confidence)),
        addedAt:    Date.now(),
        resolved:   false,
    }].slice(0, 20);
    db.sessions[idx].savedAt = Date.now();
    _save(db);
    return { ok: true, sessionId, hypothesisCount: db.sessions[idx].hypotheses.length };
}

function resolveHypothesis(sessionId, hypothesisText = "") {
    const db  = _load(); _prune(db);
    const idx = db.sessions.findIndex(s => s.sessionId === sessionId);
    if (idx === -1) return { ok: false, error: "session not found" };
    const hIdx = (db.sessions[idx].hypotheses || []).findIndex(h => h.text === hypothesisText);
    if (hIdx === -1) return { ok: false, error: "hypothesis not found" };
    db.sessions[idx].hypotheses[hIdx].resolved = true;
    db.sessions[idx].savedAt = Date.now();
    _save(db);
    return { ok: true, sessionId, resolved: hypothesisText };
}

// ── Continuity summary ────────────────────────────────────────────────────────

function continuitySummary(sessionId) {
    const db     = _load(); _prune(db);
    const record = db.sessions.find(s => s.sessionId === sessionId);
    if (!record) return { ok: false, error: "No continuity data" };

    const unresolvedHypotheses = (record.hypotheses || []).filter(h => !h.resolved);

    return {
        ok:                 true,
        sessionId,
        goal:               record.goal,
        age:                Math.round((Date.now() - record.savedAt) / 60000) + "min ago",
        errorCount:         record.errors.length,
        rootCauseCount:     record.rootCauses.length,
        currentStep:        record.currentStep,
        completedSteps:     record.completedSteps.length,
        unresolvedHypotheses: unresolvedHypotheses.length,
        topHypothesis:      unresolvedHypotheses[0]?.text || null,
        notes:              record.notes,
        status:             record.status,
    };
}

function listContinuity({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.sessions
        .filter(s => !status || s.status === status)
        .slice(0, limit)
        .map(s => ({ sessionId: s.sessionId, goal: s.goal, status: s.status, currentStep: s.currentStep, savedAt: s.savedAt, age: Math.round((Date.now() - s.savedAt) / 60000) + "min" }));
}

module.exports = { saveSessionState, restoreSessionState, addHypothesis, resolveHypothesis, continuitySummary, listContinuity };
