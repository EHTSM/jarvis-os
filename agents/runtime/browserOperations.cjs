"use strict";
/**
 * Phase 544 — Real Browser Operation Mode
 *
 * Authenticated session continuity, replay-safe browser actions,
 * extraction workflows, tab-state continuity, workflow-linked browsing.
 *
 * Prevents: duplicate form execution, stale-page replay, unsafe automation loops.
 * Models browser context for safety — no live browser dependency.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const SESSION_PATH = path.join(__dirname, "../../data/browser-sessions.json");
const MAX_SESSIONS = 50;
const SESSION_TTL  = 8 * 60 * 60 * 1000;   // 8h
const ACTION_TTL   = 24 * 60 * 60 * 1000;  // 24h
const MAX_ACTIONS  = 500;

// ── Persistence ───────────────────────────────────────────────────────────────

function _load() {
    try {
        const raw = JSON.parse(fs.readFileSync(SESSION_PATH, "utf8"));
        return {
            sessions: (raw.sessions || []).filter(s => Date.now() - s.createdAt < SESSION_TTL),
            actions:  (raw.actions  || []).filter(a => Date.now() - a.ts       < ACTION_TTL),
        };
    } catch { return { sessions: [], actions: [] }; }
}

function _save(data) {
    try {
        fs.writeFileSync(SESSION_PATH, JSON.stringify({
            sessions: data.sessions.slice(-MAX_SESSIONS),
            actions:  data.actions.slice(-MAX_ACTIONS),
        }, null, 2));
    } catch {}
}

function _id()        { return `bsess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }
function _actionKey(sessionId, action, url) {
    return crypto.createHash("md5").update(`${sessionId}:${action}:${url}`).digest("hex").slice(0, 12);
}

// ── Browser session management ────────────────────────────────────────────────

function createSession(opts = {}) {
    const data = _load();
    const sess = {
        id:          _id(),
        operatorId:  opts.operatorId  || "default",
        workflowId:  opts.workflowId  || null,
        baseUrl:     opts.baseUrl     || null,
        authenticated: opts.authenticated || false,
        tabs:        [],
        createdAt:   Date.now(),
        updatedAt:   Date.now(),
    };
    data.sessions.push(sess);
    _save(data);
    return { ok: true, session: sess };
}

function getSession(sessionId) {
    return _load().sessions.find(s => s.id === sessionId) || null;
}

function updateSession(sessionId, updates) {
    const data = _load();
    const sess = data.sessions.find(s => s.id === sessionId);
    if (!sess) return { ok: false, error: "session not found" };
    Object.assign(sess, updates, { updatedAt: Date.now() });
    _save(data);
    return { ok: true, session: sess };
}

// ── Tab state continuity ──────────────────────────────────────────────────────

function saveTabState(sessionId, tab) {
    if (!sessionId || !tab || !tab.url) return { ok: false, error: "sessionId and tab.url required" };
    const data = _load();
    const sess = data.sessions.find(s => s.id === sessionId);
    if (!sess) return { ok: false, error: "session not found" };

    const existing = sess.tabs.findIndex(t => t.id === tab.id);
    if (existing >= 0) {
        sess.tabs[existing] = { ...sess.tabs[existing], ...tab, updatedAt: Date.now() };
    } else {
        if (sess.tabs.length >= 10) sess.tabs.shift(); // max 10 tabs
        sess.tabs.push({ ...tab, savedAt: Date.now() });
    }
    sess.updatedAt = Date.now();
    _save(data);
    return { ok: true };
}

function getTabState(sessionId) {
    const sess = _load().sessions.find(s => s.id === sessionId);
    return sess ? { ok: true, tabs: sess.tabs } : { ok: false, error: "session not found" };
}

// ── Action recording with idempotency ─────────────────────────────────────────

const SAFE_ACTIONS    = ["navigate", "extract", "scroll", "screenshot", "read"];
const CAUTION_ACTIONS = ["click", "hover", "select"];
const BLOCKED_ACTIONS = ["submit-form", "purchase", "delete", "confirm-payment"];

function validateAction(action) {
    if (BLOCKED_ACTIONS.includes(action)) return { safe: false, level: "BLOCKED", reason: `action "${action}" requires explicit operator approval` };
    if (CAUTION_ACTIONS.includes(action)) return { safe: true,  level: "CAUTION", reason: `action "${action}" modifies page state` };
    if (SAFE_ACTIONS.includes(action))    return { safe: true,  level: "SAFE",    reason: "read-only action" };
    return { safe: true, level: "CAUTION", reason: "unknown action type — treat with caution" };
}

function recordAction(sessionId, action, url, opts = {}) {
    if (!sessionId || !action) return { ok: false, error: "sessionId and action required" };
    const validation = validateAction(action);
    if (!validation.safe) return { ok: false, level: "BLOCKED", error: validation.reason };

    const key  = _actionKey(sessionId, action, url || "");
    const data = _load();

    // Duplicate prevention — same action+URL within 30s
    const recent = data.actions.find(a => a.key === key && Date.now() - a.ts < 30_000);
    if (recent) return { ok: false, duplicate: true, error: "duplicate action within 30s", lastAt: new Date(recent.ts).toISOString() };

    const entry = {
        key,
        sessionId,
        action,
        url:        (url || "").slice(0, 200),
        level:      validation.level,
        workflowId: opts.workflowId || null,
        replayId:   opts.replayId   || null,
        ts:         Date.now(),
    };
    data.actions.push(entry);
    _save(data);
    return { ok: true, key, level: validation.level };
}

// ── Extraction workflows ──────────────────────────────────────────────────────

function recordExtraction(sessionId, url, extractedFields, opts = {}) {
    if (!sessionId || !url) return { ok: false, error: "sessionId and url required" };
    return recordAction(sessionId, "extract", url, opts);
}

// ── Stale-page detection ──────────────────────────────────────────────────────

function checkPageFreshness(sessionId, tabId, maxAgeMs = 5 * 60_000) {
    const sess = _load().sessions.find(s => s.id === sessionId);
    if (!sess) return { fresh: false, reason: "session not found" };
    const tab  = sess.tabs.find(t => t.id === tabId);
    if (!tab)  return { fresh: false, reason: "tab not found" };
    const age  = Date.now() - (tab.updatedAt || tab.savedAt || 0);
    return {
        fresh:  age < maxAgeMs,
        ageMs:  age,
        ageMins: Math.round(age / 60_000),
        reason: age < maxAgeMs ? "page state is fresh" : `page state is ${Math.round(age / 60_000)} minutes old`,
    };
}

// ── Session list / cleanup ────────────────────────────────────────────────────

function listSessions({ operatorId, workflowId } = {}) {
    let sessions = _load().sessions;
    if (operatorId) sessions = sessions.filter(s => s.operatorId === operatorId);
    if (workflowId) sessions = sessions.filter(s => s.workflowId === workflowId);
    return sessions;
}

function closeSession(sessionId) {
    const data = _load();
    const idx  = data.sessions.findIndex(s => s.id === sessionId);
    if (idx < 0) return { ok: false, error: "session not found" };
    data.sessions.splice(idx, 1);
    _save(data);
    return { ok: true };
}

module.exports = {
    createSession, getSession, updateSession,
    saveTabState, getTabState,
    validateAction, recordAction, recordExtraction,
    checkPageFreshness, listSessions, closeSession,
    SAFE_ACTIONS, CAUTION_ACTIONS, BLOCKED_ACTIONS,
};
