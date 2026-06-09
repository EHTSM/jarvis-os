"use strict";
/**
 * Phase 594 — Real Engineering Session Intelligence
 *
 * Active-goal tracking, blocked-state awareness, debugging-session continuity,
 * deployment progression awareness, recovery-path guidance.
 *
 * Explainable, low-noise, operator-visible.
 * State: data/session-intelligence.json
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/session-intelligence.json");

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { sessions: {} }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}

// ── Session lifecycle ─────────────────────────────────────────────────────────

function startSession(sessionId, { goal = "", operatorId = null } = {}) {
    const db  = _load();
    db.sessions[sessionId] = {
        id:               sessionId,
        goal:             (goal || "").slice(0, 200),
        operatorId,
        startedAt:        Date.now(),
        lastActivityAt:   Date.now(),
        blocked:          false,
        blockReason:      null,
        phase:            "active",
        deploymentPhase:  null,
        activeChainId:    null,
        debuggingActive:  false,
        recoveryActive:   false,
        eventCount:       0,
        errorCount:       0,
        notes:            [],
    };
    _save(db);
    return { ok: true, sessionId };
}

function updateActivity(sessionId, { eventType = "generic", errorDelta = 0 } = {}) {
    const db  = _load();
    const s   = db.sessions[sessionId];
    if (!s) return { ok: false, error: "session not found" };
    s.lastActivityAt = Date.now();
    s.eventCount     = (s.eventCount || 0) + 1;
    s.errorCount     = (s.errorCount || 0) + errorDelta;
    if (eventType === "debug")      s.debuggingActive  = true;
    if (eventType === "recovery")   s.recoveryActive   = true;
    if (eventType === "deployment") s.deploymentPhase  = "in-progress";
    db.sessions[sessionId] = s;
    _save(db);
    return { ok: true };
}

function markBlocked(sessionId, reason = "") {
    const db = _load();
    const s  = db.sessions[sessionId];
    if (!s) return { ok: false };
    s.blocked     = true;
    s.blockReason = (reason || "").slice(0, 200);
    s.phase       = "blocked";
    db.sessions[sessionId] = s;
    _save(db);
    return { ok: true, sessionId, reason };
}

function clearBlocked(sessionId) {
    const db = _load();
    const s  = db.sessions[sessionId];
    if (!s) return { ok: false };
    s.blocked     = false;
    s.blockReason = null;
    s.phase       = "active";
    db.sessions[sessionId] = s;
    _save(db);
    return { ok: true };
}

// ── Blocked-state awareness ───────────────────────────────────────────────────

/**
 * Generate guidance when a session is blocked.
 */
function blockedStateGuidance(sessionId) {
    const db = _load();
    const s  = db.sessions[sessionId];
    if (!s) return { available: false };
    if (!s.blocked) return { blocked: false };

    const guidance = [];
    const reason   = (s.blockReason || "").toLowerCase();

    if (/deploy|pipeline/.test(reason)) {
        guidance.push({ action: "Check deployment preflight", endpoint: "GET /api/runtime/deploy-assist/preflight", priority: "high" });
        guidance.push({ action: "Review rollback options",    endpoint: "GET /api/runtime/deploy-assist/rollback-recommendation", priority: "medium" });
    }
    if (/dep|module|npm/.test(reason)) {
        guidance.push({ action: "Run dependency integrity check", endpoint: "GET /api/runtime/deploy-assist/dependency-integrity", priority: "high" });
    }
    if (/error|crash|fail/.test(reason)) {
        guidance.push({ action: "Activate debug assist mode", endpoint: "POST /api/runtime/debug-assist/activate", priority: "high" });
        guidance.push({ action: "Get root-cause suggestions", endpoint: "POST /api/runtime/debug-assist/root-causes", priority: "high" });
    }

    if (guidance.length === 0) {
        guidance.push({ action: "Check runtime dashboard", endpoint: "GET /api/runtime/dashboard", priority: "medium" });
    }

    return { blocked: true, sessionId, blockReason: s.blockReason, guidance };
}

// ── Deployment progression awareness ─────────────────────────────────────────

function deploymentProgression(sessionId) {
    const tl = _tryRequire("./executionTimeline.cjs");
    if (!tl) return { available: false };

    const events = tl.search({ sessionId, type: "deployment", limit: 20 });
    const sorted = events.sort((a, b) => (a.ts || 0) - (b.ts || 0));

    return {
        sessionId,
        deploymentCount: events.length,
        states:          sorted.map(e => ({ ts: e.ts, state: e.meta?.state, pipeline: e.meta?.pipelineName })),
        lastState:       sorted[sorted.length - 1]?.meta?.state || null,
    };
}

// ── Recovery-path guidance ────────────────────────────────────────────────────

function recoveryPathGuidance(sessionId, errors = []) {
    const dbg = _tryRequire("./debugAssistMode.cjs");
    const mem = _tryRequire("./operatorWorkflowMemory.cjs");

    const suggestions = dbg ? dbg.rootCauseSuggestions(errors) : [];
    const chains      = dbg ? dbg.recoveryPlan(suggestions, "") : { steps: [] };
    const memMatches  = mem  ? mem.query(errors.join(" "), "recovery-flow", 3) : [];

    return {
        sessionId,
        rootCauses:      suggestions,
        recoveryPlan:    chains,
        memorySuggestions: memMatches,
        explainer:       `${suggestions.length} root cause(s) identified, ${memMatches.length} memory match(es) found`,
    };
}

// ── Session intelligence summary ──────────────────────────────────────────────

function getSessionIntelligence(sessionId) {
    const db   = _load();
    const s    = db.sessions[sessionId];
    if (!s) return { available: false };

    const blocked  = s.blocked ? blockedStateGuidance(sessionId) : null;
    const deplProg = deploymentProgression(sessionId);
    const calm     = _tryRequire("./executionCalmness.cjs");
    const clarity  = calm ? calm.clarityReport(sessionId) : null;

    return {
        sessionId,
        goal:             s.goal,
        phase:            s.phase,
        blocked:          s.blocked,
        guidance:         blocked,
        eventCount:       s.eventCount,
        errorCount:       s.errorCount,
        debuggingActive:  s.debuggingActive,
        recoveryActive:   s.recoveryActive,
        deploymentPhase:  s.deploymentPhase,
        deploymentProgress: deplProg,
        clarityReport:    clarity,
        lastActivityAt:   s.lastActivityAt,
    };
}

function listSessions({ blocked = false } = {}) {
    const db = _load();
    return Object.values(db.sessions)
        .filter(s => !blocked || s.blocked)
        .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))
        .slice(0, 50);
}

module.exports = { startSession, updateActivity, markBlocked, clearBlocked, blockedStateGuidance, deploymentProgression, recoveryPathGuidance, getSessionIntelligence, listSessions };
