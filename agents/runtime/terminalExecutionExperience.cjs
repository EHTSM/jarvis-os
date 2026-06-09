"use strict";
/**
 * Phase 755 — Terminal Execution Experience
 *
 * Workflow-linked shell execution, replay-aware command history,
 * runtime-state-aware sequencing, dependency-recovery flows,
 * interruption-safe shell continuity.
 */

const fs   = require("fs");
const path = require("path");

const DATA_FILE    = path.join(__dirname, "../../data/terminal-execution-experience.json");
const MAX_COMMANDS = 200;
const STALE_MS     = 4 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return { commands: [], sessions: [] }; }
}
function _save(db) { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {} }

function recordCommand(command, context = {}) {
    if (!command) return { ok: false, error: "command required" };
    const db = _load();
    db.commands.push({ command, context, ts: Date.now() });
    if (db.commands.length > MAX_COMMANDS) db.commands = db.commands.slice(-MAX_COMMANDS);
    _save(db);
    return { ok: true, command };
}

function replayAwareCommandHistory(replayId, { maxAge = STALE_MS } = {}) {
    if (!replayId) return { ok: false, error: "replayId required" };
    const db  = _load();
    const now = Date.now();
    const cmds = db.commands.filter(c => c.context?.replayId === replayId && now - c.ts <= maxAge);
    return { ok: true, replayId, count: cmds.length, commands: cmds.map(c => c.command) };
}

function suggestNextCommand(currentState = {}) {
    const suggestions = [];

    if (currentState.lastFailed)     suggestions.push({ cmd: "npm run test -- --verbose", reason: "check failing tests" });
    if (currentState.deployPending)  suggestions.push({ cmd: "npm run build", reason: "build before deploy" });
    if (currentState.depsOutdated)   suggestions.push({ cmd: "npm install", reason: "update dependencies" });
    if (currentState.debugActive)    suggestions.push({ cmd: "node --inspect-brk", reason: "attach debugger" });
    if (suggestions.length === 0)    suggestions.push({ cmd: "npm run lint", reason: "code quality check" });

    return { ok: true, suggestions: suggestions.slice(0, 3) };
}

function startShellSession(sessionId, context = {}) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const db = _load();
    if (db.sessions.find(s => s.sessionId === sessionId)) return { ok: false, error: "session exists" };
    db.sessions.push({ sessionId, context, startedAt: Date.now(), updatedAt: Date.now(), status: "active" });
    if (db.sessions.length > 20) db.sessions = db.sessions.slice(-20);
    _save(db);
    return { ok: true, sessionId };
}

function restoreShellSession(sessionId) {
    const db  = _load();
    const s   = db.sessions.find(x => x.sessionId === sessionId);
    if (!s) return { ok: false, error: "session not found" };
    const now = Date.now();
    if (now - s.updatedAt > STALE_MS) return { ok: false, stale: true, error: "session stale" };
    const history = db.commands.filter(c => c.context?.sessionId === sessionId && now - c.ts <= STALE_MS);
    return { ok: true, sessionId, context: s.context, recentCommands: history.slice(-10).map(c => c.command) };
}

function terminalExperienceSummary() {
    const db  = _load();
    const now = Date.now();
    const recentCmds = db.commands.filter(c => now - c.ts <= 60 * 60 * 1000).length;
    const activeSess = db.sessions.filter(s => s.status === "active" && now - s.updatedAt <= STALE_MS).length;
    return { ok: true, recentCommands: recentCmds, activeSessions: activeSess, totalCommands: db.commands.length, summary: `Terminal: ${recentCmds} recent commands, ${activeSess} active sessions` };
}

module.exports = { recordCommand, replayAwareCommandHistory, suggestNextCommand, startShellSession, restoreShellSession, terminalExperienceSummary };
