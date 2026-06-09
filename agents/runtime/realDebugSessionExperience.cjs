"use strict";
/**
 * Phase 751 — Real Debug Session Experience
 *
 * Guided debug initialization, runtime-failure walkthroughs,
 * replay-linked continuity, dependency-aware flows, validation-first recovery.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const DATA_FILE   = path.join(__dirname, "../../data/real-debug-session.json");
const MAX_SESSIONS = 30;
const STALE_MS    = 8 * 60 * 60 * 1000;
const DEDUP_MS    = 5 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return { sessions: [] }; }
}
function _save(db) { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {} }

const DEBUG_PHASES = ["validate-env", "classify-failure", "identify-scope", "operator-review", "apply-recovery", "verify-resolution"];

function startDebugSession(sessionId, errorContext = {}) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const db  = _load();
    if (db.sessions.find(s => s.sessionId === sessionId)) return { ok: false, error: "session already exists" };

    const session = {
        sessionId,
        errorContext,
        phase: 0,
        phases: DEBUG_PHASES,
        status: "active",
        startedAt: Date.now(),
        updatedAt: Date.now(),
        replayId: errorContext.replayId || null,
        history: [{ phase: DEBUG_PHASES[0], ts: Date.now() }],
    };
    db.sessions.push(session);
    if (db.sessions.length > MAX_SESSIONS) db.sessions = db.sessions.slice(-MAX_SESSIONS);
    _save(db);

    return { ok: true, sessionId, currentPhase: DEBUG_PHASES[0], requiresApproval: DEBUG_PHASES[0] === "operator-review" };
}

function advanceDebugSession(sessionId, { operatorApproved = false } = {}) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const db = _load();
    const s  = db.sessions.find(x => x.sessionId === sessionId);
    if (!s) return { ok: false, error: "session not found" };
    if (s.status === "completed") return { ok: false, error: "session already completed" };

    const cur = s.phases[s.phase];
    if (cur === "operator-review" && !operatorApproved) {
        return { ok: false, requiresApproval: true, phase: cur, message: "Operator review required before recovery" };
    }

    s.history.push({ phase: cur, completedAt: Date.now() });
    s.phase++;
    s.updatedAt = Date.now();

    if (s.phase >= s.phases.length) {
        s.status = "completed";
        _save(db);
        return { ok: true, sessionId, status: "completed" };
    }

    const next = s.phases[s.phase];
    s.history.push({ phase: next, ts: Date.now() });
    _save(db);
    return { ok: true, sessionId, completedPhase: cur, nextPhase: next, requiresApproval: next === "operator-review" };
}

function getDebugSessionStatus(sessionId) {
    const db = _load();
    const s  = db.sessions.find(x => x.sessionId === sessionId);
    if (!s) return { ok: false, error: "session not found" };
    const now = Date.now();
    return {
        ok: true, sessionId, status: s.status,
        currentPhase: s.phases[s.phase] || "done",
        phaseIndex: s.phase, totalPhases: s.phases.length,
        stale: now - s.updatedAt > STALE_MS,
        replayId: s.replayId,
    };
}

function restoreDebugSession(sessionId) {
    const db  = _load();
    const now = Date.now();
    const s   = db.sessions.find(x => x.sessionId === sessionId);
    if (!s) return { ok: false, error: "session not found" };
    if (now - s.updatedAt > STALE_MS) return { ok: false, error: "session stale — restart required", stale: true };
    if (s.status === "completed") return { ok: false, error: "session already completed" };
    return { ok: true, sessionId, currentPhase: s.phases[s.phase], phaseIndex: s.phase, errorContext: s.errorContext };
}

function debugSessionWalkthrough(errorType) {
    const guides = {
        "crash":      ["Check recent deployments", "Inspect crash logs", "Identify failing symbol", "Review dependency chain", "Apply targeted fix"],
        "timeout":    ["Profile slow paths", "Check external calls", "Review DB queries", "Identify bottleneck", "Apply optimization"],
        "auth-fail":  ["Verify token validity", "Check auth config", "Inspect middleware chain", "Review session state", "Reissue credentials"],
        "build-fail": ["Check dependency versions", "Review compilation errors", "Validate config files", "Run targeted build", "Verify output"],
    };
    const steps = guides[errorType] || ["Classify error", "Identify scope", "Review logs", "Apply fix", "Verify"];
    return { ok: true, errorType, steps, requiresApproval: true, summary: `Walkthrough: ${steps.length} steps for '${errorType}'` };
}

module.exports = { startDebugSession, advanceDebugSession, getDebugSessionStatus, restoreDebugSession, debugSessionWalkthrough };
