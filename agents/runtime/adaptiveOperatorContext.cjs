"use strict";
/**
 * Phase 739 — Adaptive Operator Context
 *
 * Maintains a lightweight context model of the operator's current focus,
 * active environment, and recent actions to provide contextually relevant
 * intelligence without requiring explicit re-statement.
 */

const fs   = require("fs");
const path = require("path");

const DATA_FILE      = path.join(__dirname, "../../data/adaptive-operator-context.json");
const CONTEXT_TTL    = 4 * 60 * 60 * 1000;   // 4h context window
const MAX_ACTIONS    = 50;
const FOCUS_TIMEOUT  = 30 * 60 * 1000;         // 30min inactivity resets focus

function _load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
    catch { return { focus: null, env: null, actions: [], updatedAt: 0 }; }
}
function _save(db) {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {}
}

function setOperatorFocus(focus, env = null) {
    if (!focus || typeof focus !== "string") return { ok: false, error: "focus required" };
    const db = _load();
    db.focus = focus;
    if (env) db.env = env;
    db.updatedAt = Date.now();
    _save(db);
    return { ok: true, focus, env: db.env };
}

function recordOperatorAction(action, context = {}) {
    if (!action) return { ok: false, error: "action required" };
    const db = _load();
    db.actions.push({ action, context, ts: Date.now() });
    if (db.actions.length > MAX_ACTIONS) db.actions = db.actions.slice(-MAX_ACTIONS);
    db.updatedAt = Date.now();
    _save(db);
    return { ok: true, action };
}

function getOperatorContext() {
    const db  = _load();
    const now = Date.now();

    const focusActive = db.focus && (now - db.updatedAt < FOCUS_TIMEOUT);
    const recentActions = db.actions.filter(a => now - a.ts < CONTEXT_TTL);

    const actionFrequency = {};
    recentActions.forEach(a => { actionFrequency[a.action] = (actionFrequency[a.action] || 0) + 1; });
    const topActions = Object.entries(actionFrequency).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a, c]) => ({ action: a, count: c }));

    return {
        ok:            true,
        focus:         focusActive ? db.focus : null,
        env:           db.env,
        focusActive,
        recentActions: recentActions.slice(-10),
        topActions,
        contextAge:    now - db.updatedAt,
        summary:       `Operator context: focus=${focusActive ? db.focus : "none"} env=${db.env || "unknown"} recentActions=${recentActions.length}`,
    };
}

function inferOperatorIntent() {
    const ctx = getOperatorContext();
    const intents = [];

    if (ctx.focus) {
        if (ctx.focus.includes("deploy")) intents.push({ intent: "deployment", confidence: 90 });
        else if (ctx.focus.includes("debug")) intents.push({ intent: "debugging", confidence: 90 });
        else if (ctx.focus.includes("review")) intents.push({ intent: "code-review", confidence: 85 });
        else intents.push({ intent: ctx.focus, confidence: 70 });
    }

    if (ctx.topActions.length > 0) {
        const topAction = ctx.topActions[0].action;
        if (topAction.includes("deploy") && !intents.some(i => i.intent === "deployment"))
            intents.push({ intent: "deployment", confidence: 60 });
        if (topAction.includes("debug") && !intents.some(i => i.intent === "debugging"))
            intents.push({ intent: "debugging", confidence: 60 });
    }

    return {
        ok:      true,
        intents,
        primary: intents[0] || null,
        summary: `Intent: ${intents[0]?.intent || "unknown"} (${intents[0]?.confidence || 0}%)`,
    };
}

function clearOperatorContext() {
    _save({ focus: null, env: null, actions: [], updatedAt: 0 });
    return { ok: true };
}

module.exports = { setOperatorFocus, recordOperatorAction, getOperatorContext, inferOperatorIntent, clearOperatorContext };
