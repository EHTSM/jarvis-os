"use strict";
/**
 * Phase 451 — Multi-Operator Session Model
 *
 * Extends engineeringSession with operator ownership, isolated history,
 * workflow attribution, and cross-session contamination prevention.
 *
 * Operator identity: string token (not auth — that's the auth layer's job).
 * Session isolation: each session is scoped to its operatorId.
 * Cross-session reads are blocked by default.
 *
 * Built on top of engineeringSession — does NOT replace it.
 * Adds an operator index file: data/operator-sessions.json
 */

const fs      = require("fs");
const path    = require("path");
const session = require("./engineeringSession.cjs");

const INDEX_PATH = path.join(__dirname, "../../data/operator-sessions.json");
const MAX_OPERATORS = 20;

// ── Operator index ─────────────────────────────────────────────────────────────
function _loadIndex() {
    try { return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")); }
    catch { return {}; } // { operatorId: { sessionIds: [], label, createdAt } }
}

function _saveIndex(idx) {
    try {
        const dir = path.dirname(INDEX_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2));
    } catch {}
}

function _registerSession(operatorId, sessionId) {
    const idx = _loadIndex();
    if (!idx[operatorId]) idx[operatorId] = { sessionIds: [], label: operatorId, createdAt: Date.now() };
    if (!idx[operatorId].sessionIds.includes(sessionId)) {
        idx[operatorId].sessionIds.unshift(sessionId);
        idx[operatorId].sessionIds = idx[operatorId].sessionIds.slice(0, 20); // max 20 per operator
    }
    // Cap total operators
    const ops = Object.keys(idx);
    if (ops.length > MAX_OPERATORS) {
        // Remove oldest operator entry (by createdAt)
        const oldest = ops.sort((a, b) => (idx[a].createdAt || 0) - (idx[b].createdAt || 0))[0];
        delete idx[oldest];
    }
    _saveIndex(idx);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Create a session owned by a specific operator.
 * @param {string} operatorId — unique operator identifier
 * @param {string} goal
 * @param {object} meta
 */
function createSession(operatorId, goal, meta = {}) {
    if (!operatorId) throw new Error("operatorId required");
    const s = session.create(goal, { ...meta, operatorId, triggeredBy: operatorId });
    _registerSession(operatorId.slice(0, 64), s.id);
    return s;
}

/**
 * Get a session only if it belongs to the operator.
 * @param {string} operatorId
 * @param {string} sessionId
 */
function getSession(operatorId, sessionId) {
    const s = session.get(sessionId);
    if (!s) return null;
    // Enforce ownership — if meta.operatorId is set it must match; if unset, session is unowned (deny cross-operator access)
    const owner = s.meta?.operatorId;
    if (owner !== operatorId) return null;
    return s;
}

/**
 * List sessions for a specific operator.
 * @param {string} operatorId
 * @param {object} opts
 */
function listSessions(operatorId, { state, limit = 10 } = {}) {
    const idx = _loadIndex();
    const entry = idx[operatorId];
    if (!entry) return [];
    return entry.sessionIds
        .map(id => session.get(id))
        .filter(Boolean)
        .filter(s => !state || s.state === state)
        .slice(0, Math.min(limit, 20))
        .map(s => ({
            id:                  s.id,
            goal:                s.goal,
            state:               s.state,
            createdAt:           s.createdAt,
            updatedAt:           s.updatedAt,
            workflowCount:       s.workflows?.length ?? 0,
            executionConfidence: s.executionConfidence ?? 100,
            degradationState:    s.degradationState || "healthy",
        }));
}

/**
 * List all operators with session counts.
 */
function listOperators() {
    const idx = _loadIndex();
    return Object.entries(idx).map(([id, entry]) => ({
        operatorId:   id,
        label:        entry.label,
        sessionCount: entry.sessionIds.length,
        createdAt:    entry.createdAt,
    }));
}

/**
 * Get operator-attributed execution history summary.
 * @param {string} operatorId
 */
function operatorSummary(operatorId) {
    const sessions = listSessions(operatorId, { limit: 20 });
    const active   = sessions.filter(s => s.state === "active").length;
    const completed = sessions.filter(s => s.state === "completed").length;
    const totalWf  = sessions.reduce((n, s) => n + (s.workflowCount || 0), 0);
    return { operatorId, sessionCount: sessions.length, active, completed, totalWorkflows: totalWf, sessions };
}

module.exports = { createSession, getSession, listSessions, listOperators, operatorSummary };
