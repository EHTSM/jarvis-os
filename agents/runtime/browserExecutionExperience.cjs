"use strict";
/**
 * Phase 756 — Browser Execution Experience
 *
 * Replay-linked browser continuity, authenticated-session restoration,
 * extraction visibility, workflow-aware browsing, form safety visibility.
 */

const fs   = require("fs");
const path = require("path");

const DATA_FILE    = path.join(__dirname, "../../data/browser-execution-experience.json");
const MAX_SESSIONS = 20;
const STALE_MS     = 2 * 60 * 60 * 1000;
const DEDUP_MS     = 5 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return { sessions: [] }; }
}
function _save(db) { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {} }

function saveBrowserSession(sessionId, context = {}) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const db  = _load();
    const now = Date.now();

    const dup = db.sessions.find(s => s.sessionId === sessionId && now - s.savedAt < DEDUP_MS);
    if (dup) return { ok: true, duplicate: true, sessionId };

    const existing = db.sessions.find(s => s.sessionId === sessionId);
    if (existing) {
        existing.context = context;
        existing.savedAt = now;
    } else {
        db.sessions.push({ sessionId, context, savedAt: now });
        if (db.sessions.length > MAX_SESSIONS) db.sessions = db.sessions.slice(-MAX_SESSIONS);
    }
    _save(db);
    return { ok: true, sessionId };
}

function restoreBrowserSession(sessionId) {
    const db  = _load();
    const now = Date.now();
    const s   = db.sessions.find(x => x.sessionId === sessionId);
    if (!s) return { ok: false, error: "session not found" };
    if (now - s.savedAt > STALE_MS) return { ok: false, stale: true, error: "session stale (>2h)" };
    return { ok: true, sessionId, context: s.context, age: now - s.savedAt };
}

function replayLinkedBrowserContinuity(replayId) {
    if (!replayId) return { ok: false, error: "replayId required" };
    const db  = _load();
    const now = Date.now();
    const sessions = db.sessions.filter(s => s.context?.replayId === replayId && now - s.savedAt <= STALE_MS);

    if (sessions.length === 0) return { ok: false, error: "no fresh sessions for replay", replayId };
    if (sessions.length > 1) return { ok: false, error: "duplicate replay sessions detected", replayId, count: sessions.length };

    return { ok: true, replayId, sessionId: sessions[0].sessionId, context: sessions[0].context };
}

function extractionVisibility(sessionId) {
    const db = _load();
    const s  = db.sessions.find(x => x.sessionId === sessionId);
    if (!s) return { ok: false, error: "session not found" };
    const extractions = s.context?.extractions || [];
    return {
        ok: true,
        sessionId,
        extractionCount: extractions.length,
        extractions: extractions.slice(0, 10),
        safe: extractions.every(e => !e.sensitive),
    };
}

function formSafetyCheck(sessionId, formAction) {
    if (!sessionId || !formAction) return { ok: false, error: "sessionId and formAction required" };
    const risky = ["submit-payment", "delete-account", "bulk-delete", "admin-action"].some(a => formAction.includes(a));
    return {
        ok:               true,
        sessionId,
        formAction,
        risky,
        requiresApproval: risky,
        summary:          `Form action '${formAction}': ${risky ? "RISKY — requires approval" : "safe"}`,
    };
}

module.exports = { saveBrowserSession, restoreBrowserSession, replayLinkedBrowserContinuity, extractionVisibility, formSafetyCheck };
