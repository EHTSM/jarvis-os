"use strict";
/**
 * Phase 543 — Terminal Execution Hardening
 *
 * Chained shell execution, macro survivability, sequential command validation,
 * rollback-aware execution, runtime interruption recovery.
 *
 * Process isolation, bounded retries, execution visibility.
 * Pure recording + validation layer — does not exec arbitrary shell.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const EXEC_LOG_PATH = path.join(__dirname, "../../data/terminal-exec-log.json");
const MAX_ENTRIES   = 300;
const TTL_MS        = 7 * 24 * 60 * 60 * 1000;
const MAX_RETRIES   = 3;

// ── Blocked command patterns ──────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
    /rm\s+-rf\s+\/(?!\w)/,           // rm -rf /
    />\s*\/dev\/sda/,                 // disk write
    /mkfs\./,                         // format disk
    /dd\s+if=/,                       // dd
    /:\(\)\{.*\|.*&\}/,              // fork bomb
    /curl\s+.*\|\s*(ba)?sh/,         // curl-pipe-sh
    /wget\s+.*\|\s*(ba)?sh/,         // wget-pipe-sh
    /chmod\s+777\s+\//,              // chmod 777 /
];

const CAUTION_PATTERNS = [
    /rm\s+-r/,
    /git\s+push\s+--force/,
    /git\s+reset\s+--hard/,
    /npm\s+run\s+deploy/,
    /docker\s+rm/,
    /pkill|killall/,
];

function _load() {
    try {
        const raw = JSON.parse(fs.readFileSync(EXEC_LOG_PATH, "utf8"));
        const now = Date.now();
        return raw.filter(e => now - e.ts < TTL_MS);
    } catch { return []; }
}

function _save(entries) {
    try { fs.writeFileSync(EXEC_LOG_PATH, JSON.stringify(entries.slice(-MAX_ENTRIES), null, 2)); } catch {}
}

function _id() { return `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

// ── Command validation ────────────────────────────────────────────────────────

function validateCommand(cmd) {
    if (!cmd || typeof cmd !== "string") return { safe: false, level: "BLOCKED", reason: "empty command" };

    for (const pat of BLOCKED_PATTERNS) {
        if (pat.test(cmd)) return { safe: false, level: "BLOCKED", reason: `matches destructive pattern: ${pat.source.slice(0, 40)}` };
    }
    for (const pat of CAUTION_PATTERNS) {
        if (pat.test(cmd)) return { safe: true, level: "CAUTION", reason: `potentially destructive: ${pat.source.slice(0, 40)}` };
    }
    return { safe: true, level: "SAFE", reason: "command passed validation" };
}

// ── Macro / chain definition ──────────────────────────────────────────────────

/**
 * Validates a sequence of commands as a macro.
 * Returns: { ok, commands, blocked, caution, safe, rollbackPlan }
 */
function validateMacro(commands = [], opts = {}) {
    if (!Array.isArray(commands) || commands.length === 0) return { ok: false, error: "commands array required" };
    if (commands.length > 20) return { ok: false, error: "macro too long (max 20 commands)" };

    const results = commands.map((cmd, i) => ({ index: i, cmd, ...validateCommand(cmd) }));
    const blocked = results.filter(r => r.level === "BLOCKED");
    const caution = results.filter(r => r.level === "CAUTION");
    const safe    = results.filter(r => r.level === "SAFE");

    const rollbackPlan = opts.rollbackCommands
        ? opts.rollbackCommands.map((cmd, i) => ({ step: i, cmd, ...validateCommand(cmd) }))
        : null;

    return {
        ok:           blocked.length === 0,
        totalCommands: commands.length,
        blocked:      blocked.length,
        caution:      caution.length,
        safe:         safe.length,
        results,
        rollbackPlan,
        recommendation: blocked.length > 0
            ? "Macro blocked — remove destructive commands"
            : caution.length > 0
            ? "Macro requires operator confirmation before execution"
            : "Macro safe to execute",
    };
}

// ── Execution recording ───────────────────────────────────────────────────────

function recordExecution(cmd, result, opts = {}) {
    if (!cmd) return { ok: false, error: "cmd required" };
    const validation = validateCommand(cmd);
    if (!validation.safe) return { ok: false, error: validation.reason, level: validation.level };

    const entries = _load();
    const entry = {
        id:        _id(),
        cmd:       cmd.slice(0, 500),
        status:    result.status || "unknown",
        exitCode:  result.exitCode ?? null,
        sessionId: opts.sessionId || null,
        macroId:   opts.macroId   || null,
        retryOf:   opts.retryOf   || null,
        attempt:   opts.attempt   || 1,
        ts:        Date.now(),
    };
    entries.push(entry);
    _save(entries);
    return { ok: true, id: entry.id };
}

// ── Retry orchestration ───────────────────────────────────────────────────────

function retryPlan(execId) {
    const entries = _load();
    const original = entries.find(e => e.id === execId);
    if (!original) return { ok: false, error: "execution not found" };
    if (original.status === "success") return { ok: false, error: "execution already succeeded" };

    const attempts = entries.filter(e => e.retryOf === execId || e.id === execId);
    if (attempts.length >= MAX_RETRIES) return {
        ok: false,
        error: `max retries (${MAX_RETRIES}) reached`,
        attempts: attempts.length,
    };

    return {
        ok:         true,
        execId,
        cmd:        original.cmd,
        attempt:    attempts.length + 1,
        maxRetries: MAX_RETRIES,
        recommendation: "Re-run command with corrected context",
    };
}

// ── Interruption recovery ─────────────────────────────────────────────────────

function interruptionRecovery(sessionId) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const entries = _load().filter(e => e.sessionId === sessionId);
    const inProgress = entries.filter(e => e.status === "running" || e.status === "unknown");
    const failed     = entries.filter(e => e.status === "failed" || e.status === "error");
    const lastEntry  = entries[entries.length - 1];

    const hints = [];
    if (inProgress.length > 0) hints.push(`${inProgress.length} command(s) were in-progress at interruption`);
    if (failed.length > 0)     hints.push(`${failed.length} command(s) failed before interruption`);
    if (lastEntry)             hints.push(`Last recorded command: ${lastEntry.cmd.slice(0, 60)}`);

    return {
        ok:         true,
        sessionId,
        totalCommands: entries.length,
        inProgress: inProgress.length,
        failed:     failed.length,
        lastCommand: lastEntry ? { id: lastEntry.id, cmd: lastEntry.cmd, status: lastEntry.status } : null,
        hints,
        recoveryRecommendation: inProgress.length > 0
            ? "Check running processes before re-executing"
            : failed.length > 0
            ? "Review failed commands and retry with corrected context"
            : "Session appears clean — safe to resume",
    };
}

// ── Execution history ─────────────────────────────────────────────────────────

function executionHistory({ sessionId, macroId, limit = 20, status } = {}) {
    let entries = _load();
    if (sessionId) entries = entries.filter(e => e.sessionId === sessionId);
    if (macroId)   entries = entries.filter(e => e.macroId   === macroId);
    if (status)    entries = entries.filter(e => e.status    === status);
    return { count: entries.length, entries: entries.slice(-limit) };
}

module.exports = {
    validateCommand, validateMacro,
    recordExecution, retryPlan,
    interruptionRecovery, executionHistory,
    BLOCKED_PATTERNS, CAUTION_PATTERNS, MAX_RETRIES,
};
