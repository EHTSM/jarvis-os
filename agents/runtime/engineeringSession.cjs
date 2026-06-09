"use strict";
/**
 * Phase 396 — Engineering Session Model
 *
 * Persistent engineering sessions. Survive reload, reconnect, adapter restart.
 * Backed by filesystem (data/sessions/). Max 20 concurrent sessions.
 *
 * Session schema:
 *   id, goal, label, state, createdAt, updatedAt,
 *   workflows[],       — chain executions in this session
 *   validationLog[],   — post-step verification outcomes
 *   recoveryLog[],     — recovery attempts + outcomes
 *   timeline[],        — ordered event list (bounded 200)
 *   runtimeState,      — last known snapshot { heapMb, pm2Status, apiReachable }
 *   blockedAt,         — null | timestamp when session entered blocked state
 *   meta               — { tags, triggeredBy }
 *
 * Session states: "active" | "paused" | "blocked" | "completed" | "abandoned"
 */

const fs   = require("fs");
const path = require("path");

const SESSION_DIR  = path.join(__dirname, "../../data/sessions");
const MAX_SESSIONS = 20;
const MAX_TIMELINE = 200;
const MAX_WORKFLOWS = 50;
const SESSION_TTL  = 7 * 24 * 60 * 60 * 1000; // 7 days

function _ensureDir() {
    try { if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true }); } catch {}
}

function _sessionPath(id) { return path.join(SESSION_DIR, `${id}.json`); }

function _listIds() {
    try {
        return fs.readdirSync(SESSION_DIR)
            .filter(f => f.endsWith(".json"))
            .map(f => f.replace(".json", ""));
    } catch { return []; }
}

function _load(id) {
    try { return JSON.parse(fs.readFileSync(_sessionPath(id), "utf8")); } catch { return null; }
}

function _save(session) {
    _ensureDir();
    session.updatedAt = Date.now();
    try { fs.writeFileSync(_sessionPath(session.id), JSON.stringify(session, null, 2)); } catch {}
}

function _evictOldest() {
    const ids = _listIds();
    if (ids.length < MAX_SESSIONS) return;
    const all = ids.map(id => _load(id)).filter(Boolean)
        .sort((a, b) => a.updatedAt - b.updatedAt);
    for (const s of all.slice(0, all.length - MAX_SESSIONS + 1)) {
        try { fs.unlinkSync(_sessionPath(s.id)); } catch {}
    }
}

function _appendTimeline(session, type, detail = {}) {
    session.timeline.push({ type, ts: Date.now(), ...detail });
    if (session.timeline.length > MAX_TIMELINE) session.timeline.shift();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new engineering session.
 * @param {string} goal   — operator goal string e.g. "stabilize frontend after deploy"
 * @param {object} meta   — { tags?, triggeredBy? }
 */
function create(goal, meta = {}) {
    _evictOldest();
    const id = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const session = {
        id,
        goal:      goal.slice(0, 300),
        label:     goal.slice(0, 60),
        state:     "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        heartbeat: Date.now(),    // Phase 406: updated on every mutation — reconnect survival
        workflows:      [],
        validationLog:  [],
        recoveryLog:    [],
        timeline:       [],
        runtimeState:   null,
        blockedAt:      null,
        // Phase 406: execution confidence + degradation state
        executionConfidence: 100,   // 0–100: drops on failures, recovers on success
        degradationState:    "healthy", // "healthy" | "degraded" | "critical"
        activeChain:    null,          // chainName currently running, null if idle
        meta: {
            tags:        meta.tags || [],
            triggeredBy: meta.triggeredBy || "operator",
        },
    };
    _appendTimeline(session, "session-created", { goal: session.goal });
    _save(session);
    return session;
}

/** Load a session by ID. */
function get(id) { return _load(id); }

/**
 * Record a workflow execution within the session.
 * @param {string} sessionId
 * @param {object} workflow — { chainName, goal, steps, result, durationMs }
 */
function recordWorkflow(sessionId, workflow) {
    const s = _load(sessionId);
    if (!s) return false;
    const entry = {
        chainName:  workflow.chainName,
        goal:       (workflow.goal || "").slice(0, 200),
        startedAt:  workflow.startedAt || Date.now(),
        durationMs: workflow.durationMs || null,
        stepCount:  workflow.steps?.length || 0,
        successRate: workflow.steps?.length
            ? Math.round(workflow.steps.filter(st => st.result?.ok !== false).length / workflow.steps.length * 100)
            : null,
        result:     workflow.result || null,
    };
    s.workflows.unshift(entry);
    if (s.workflows.length > MAX_WORKFLOWS) s.workflows.length = MAX_WORKFLOWS;
    _appendTimeline(s, "workflow-recorded", { chainName: entry.chainName, successRate: entry.successRate });
    _save(s);
    return true;
}

/**
 * Record a validation outcome.
 * @param {string} sessionId
 * @param {object} outcome — { cmd, verified, falsePositive, checks, summary }
 */
function recordValidation(sessionId, outcome) {
    const s = _load(sessionId);
    if (!s) return false;
    s.validationLog.unshift({ ...outcome, ts: Date.now() });
    if (s.validationLog.length > 100) s.validationLog.length = 100;
    if (outcome.falsePositive) {
        _appendTimeline(s, "false-positive-detected", { cmd: outcome.cmd?.slice(0, 60) });
    }
    _save(s);
    return true;
}

/**
 * Record a recovery attempt.
 * @param {string} sessionId
 * @param {object} attempt — { cmd, recovered, attempts, error }
 */
function recordRecovery(sessionId, attempt) {
    const s = _load(sessionId);
    if (!s) return false;
    s.recoveryLog.unshift({ ...attempt, ts: Date.now() });
    if (s.recoveryLog.length > 50) s.recoveryLog.length = 50;
    _appendTimeline(s, attempt.recovered ? "recovery-succeeded" : "recovery-failed", {
        cmd: attempt.cmd?.slice(0, 60), attempts: attempt.attempts,
    });
    _save(s);
    return true;
}

/**
 * Update session runtime state snapshot.
 * @param {string} sessionId
 * @param {object} state — { heapMb, pm2Status, apiReachable, activeAdapters }
 */
function updateRuntimeState(sessionId, state) {
    const s = _load(sessionId);
    if (!s) return false;
    s.runtimeState = { ...state, snapshotAt: Date.now() };
    s.heartbeat = Date.now();
    _save(s);
    return true;
}

/**
 * Phase 406: Update execution confidence after a step outcome.
 * success=true  → confidence += 5 (max 100)
 * success=false → confidence -= 20 (min 0)
 * Updates degradationState based on new confidence level.
 */
function updateConfidence(sessionId, success) {
    const s = _load(sessionId);
    if (!s) return false;
    const delta = success ? +5 : -20;
    s.executionConfidence = Math.max(0, Math.min(100, (s.executionConfidence ?? 100) + delta));
    s.degradationState =
        s.executionConfidence >= 70 ? "healthy" :
        s.executionConfidence >= 40 ? "degraded" : "critical";
    s.heartbeat = Date.now();
    if (!success && s.degradationState === "critical") {
        _appendTimeline(s, "confidence-critical", { confidence: s.executionConfidence });
    }
    _save(s);
    return { confidence: s.executionConfidence, degradationState: s.degradationState };
}

/**
 * Phase 406: Mark active chain (set to null when chain finishes).
 */
function setActiveChain(sessionId, chainName) {
    const s = _load(sessionId);
    if (!s) return false;
    s.activeChain = chainName;
    s.heartbeat   = Date.now();
    if (chainName) _appendTimeline(s, "chain-started", { chainName });
    else           _appendTimeline(s, "chain-finished");
    _save(s);
    return true;
}

/**
 * Phase 406: Touch heartbeat — called periodically while session is active.
 * Allows reconnect detection (session with old heartbeat was interrupted).
 */
function heartbeat(sessionId) {
    const s = _load(sessionId);
    if (!s) return false;
    s.heartbeat = Date.now();
    try { fs.writeFileSync(_sessionPath(s.id), JSON.stringify(s, null, 2)); } catch {}
    return true;
}

/**
 * Transition session state.
 * Valid transitions:
 *   active → paused | blocked | completed | abandoned
 *   paused → active | abandoned
 *   blocked → active | abandoned
 */
function transition(sessionId, newState, reason = "") {
    const s = _load(sessionId);
    if (!s) return false;
    const VALID = {
        active:    ["paused", "blocked", "completed", "abandoned"],
        paused:    ["active", "abandoned"],
        blocked:   ["active", "abandoned"],
        completed: [],
        abandoned: [],
    };
    if (!(VALID[s.state] || []).includes(newState)) return false;
    s.state = newState;
    if (newState === "blocked") s.blockedAt = Date.now();
    if (newState === "active")  s.blockedAt = null;
    _appendTimeline(s, `state-${newState}`, { reason: reason.slice(0, 100) });
    _save(s);
    return true;
}

/**
 * List sessions (summaries, newest first).
 * @param {{ state?: string, limit?: number }} opts
 */
function list({ state, limit = 10 } = {}) {
    const now = Date.now();
    return _listIds()
        .map(id => _load(id))
        .filter(Boolean)
        .filter(s => !state || s.state === state)
        .filter(s => now - s.createdAt < SESSION_TTL) // TTL eviction on read
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, Math.min(limit, MAX_SESSIONS))
        .map(s => ({
            id:                  s.id,
            goal:                s.goal,
            state:               s.state,
            createdAt:           s.createdAt,
            updatedAt:           s.updatedAt,
            heartbeat:           s.heartbeat,
            workflowCount:       s.workflows.length,
            recoveryCount:       s.recoveryLog.length,
            blockedAt:           s.blockedAt,
            executionConfidence: s.executionConfidence ?? 100,
            degradationState:    s.degradationState || "healthy",
            activeChain:         s.activeChain || null,
            tags:                s.meta?.tags || [],
        }));
}

/** Get full session with complete timeline. */
function summary(sessionId) {
    const s = _load(sessionId);
    if (!s) return null;
    const recentTimeline = s.timeline.slice(-30).reverse();
    const successfulWorkflows = s.workflows.filter(w => w.successRate === 100).length;
    const failedRecoveries    = s.recoveryLog.filter(r => !r.recovered).length;
    return {
        ...s,
        recentTimeline,
        successfulWorkflows,
        failedRecoveries,
        sessionAgeMs:   Date.now() - s.createdAt,
        isStale:        Date.now() - s.updatedAt > 60 * 60 * 1000, // 1h without update
    };
}

/** Purge sessions older than TTL. */
function purgeExpired() {
    const now = Date.now();
    let removed = 0;
    for (const id of _listIds()) {
        const s = _load(id);
        if (!s || now - s.createdAt > SESSION_TTL) {
            try { fs.unlinkSync(_sessionPath(id)); removed++; } catch {}
        }
    }
    return removed;
}

module.exports = { create, get, recordWorkflow, recordValidation, recordRecovery, updateRuntimeState, updateConfidence, setActiveChain, heartbeat, transition, list, summary, purgeExpired };
