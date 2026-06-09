"use strict";
/**
 * Phase 573 — AI-Assisted Terminal Workflows
 *
 * Command-sequence suggestions, validation reminders, rollback-aware
 * recommendations, dependency repair flows, runtime recovery guidance.
 *
 * Prevents: unsafe shell execution, runaway command loops, duplicate macro execution.
 */

const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Safety classification ────────────────────────────────────────────────────

const SAFE_PATTERNS = [
    /^(ls|pwd|cat|echo|which|env|node\s+--version|npm\s+--version|git\s+status|git\s+log|git\s+diff|ps\s+aux|pm2\s+list|pm2\s+status|curl\s+-s)(\s|$)/,
];

const CAUTION_PATTERNS = [
    /^(npm\s+install|npm\s+ci|npm\s+run|git\s+pull|git\s+fetch|git\s+checkout|pm2\s+reload|pm2\s+restart|node\s+)(\s|$)/,
    /^(systemctl\s+(start|stop|restart|reload))(\s|$)/,
];

const DANGEROUS_PATTERNS = [
    /rm\s+-rf/,
    />\s*\/dev\/null.*&&.*rm/,
    /git\s+(push\s+--force|reset\s+--hard)/,
    /chmod\s+777/,
    /curl.*\|\s*(bash|sh)/,
    /eval\s*\(/,
    /while\s+true/,
    /:\(\)\{.*\|.*&\}/,   // fork bomb
    /dd\s+if=/,
    /mkfs/,
];

function classifyCommand(cmd = "") {
    const trimmed = cmd.trim();
    if (DANGEROUS_PATTERNS.some(p => p.test(trimmed)))
        return { level: "BLOCKED",  safe: false, reason: "Dangerous command pattern — blocked" };
    if (SAFE_PATTERNS.some(p => p.test(trimmed)))
        return { level: "SAFE",     safe: true,  reason: "Read-only or inspection command" };
    if (CAUTION_PATTERNS.some(p => p.test(trimmed)))
        return { level: "CAUTION",  safe: false, reason: "State-modifying command — review before running" };
    return { level: "REVIEW",       safe: false, reason: "Unknown command — manual review recommended" };
}

// ── Command sequence builder ──────────────────────────────────────────────────

const SEQUENCES = {
    "debug-backend": [
        { cmd: "pm2 list",                           note: "Check process list",          level: "SAFE" },
        { cmd: "pm2 logs jarvis --lines 50",          note: "Tail recent logs",            level: "SAFE" },
        { cmd: "curl -s http://localhost:5050/health",note: "Health endpoint probe",       level: "SAFE" },
        { cmd: "node --check backend/server.js",     note: "Syntax check entrypoint",     level: "SAFE" },
    ],
    "dependency-repair": [
        { cmd: "node --version",                     note: "Verify Node version",         level: "SAFE" },
        { cmd: "npm --version",                      note: "Verify npm version",          level: "SAFE" },
        { cmd: "npm ci",                             note: "Clean install from lockfile", level: "CAUTION", requiresApproval: true },
        { cmd: "node -e \"require('./backend/server.js')\"", note: "Verify require resolution", level: "CAUTION" },
    ],
    "git-safe-update": [
        { cmd: "git status",                         note: "Check working tree state",    level: "SAFE" },
        { cmd: "git diff --stat",                    note: "Review unstaged changes",     level: "SAFE" },
        { cmd: "git stash",                          note: "Stash local changes",         level: "CAUTION", requiresApproval: true },
        { cmd: "git pull --rebase",                  note: "Pull with rebase",            level: "CAUTION", requiresApproval: true },
        { cmd: "git stash pop",                      note: "Restore stashed changes",     level: "CAUTION", requiresApproval: true },
    ],
    "runtime-recovery": [
        { cmd: "pm2 status",                         note: "Check all PM2 processes",     level: "SAFE" },
        { cmd: "curl -s http://localhost:5050/api/runtime/pressure", note: "Check runtime pressure", level: "SAFE" },
        { cmd: "pm2 restart all",                    note: "Restart all processes",       level: "CAUTION", requiresApproval: true },
        { cmd: "pm2 save",                           note: "Save PM2 process list",       level: "CAUTION" },
    ],
    "environment-bootstrap": [
        { cmd: "node --version",                     note: "Check Node version",          level: "SAFE" },
        { cmd: "npm --version",                      note: "Check npm version",           level: "SAFE" },
        { cmd: "ls .env",                            note: "Verify .env exists",          level: "SAFE" },
        { cmd: "npm ci",                             note: "Install dependencies",        level: "CAUTION", requiresApproval: true },
        { cmd: "npm run build --if-present",         note: "Build frontend if configured",level: "CAUTION", requiresApproval: true },
    ],
};

/**
 * Get a named command sequence.
 * @param {string} name — sequence key
 * @param {{ sessionId? }} opts
 */
function getSequence(name, opts = {}) {
    const seq = SEQUENCES[name];
    if (!seq) return { ok: false, error: `Unknown sequence: ${name}`, available: Object.keys(SEQUENCES) };

    return {
        ok:        true,
        name,
        steps:     seq,
        stepCount: seq.length,
        approvalRequired: seq.some(s => s.requiresApproval),
        sessionId: opts.sessionId || null,
    };
}

function listSequences() {
    return Object.keys(SEQUENCES).map(name => ({
        name,
        steps:           SEQUENCES[name].length,
        approvalRequired: SEQUENCES[name].some(s => s.requiresApproval),
    }));
}

// ── Validation reminder system ────────────────────────────────────────────────

/**
 * After a sequence step, return what validation to run.
 */
function validationReminder(sequenceName, stepIndex) {
    const REMINDERS = {
        "dependency-repair":   { after: 2, reminder: "Run: node -e \"require('./backend/server.js')\" to verify resolution" },
        "git-safe-update":     { after: 3, reminder: "Run: git log --oneline -5 to verify pull succeeded" },
        "runtime-recovery":    { after: 2, reminder: "Run: curl -s http://localhost:5050/health to verify backend is up" },
        "environment-bootstrap":{ after: 3, reminder: "Run: node --check backend/server.js to verify no syntax errors" },
    };
    const r = REMINDERS[sequenceName];
    if (!r || stepIndex < r.after) return null;
    return { reminder: r.reminder, priority: "high" };
}

// ── Anti-loop guard ───────────────────────────────────────────────────────────
// Prevents duplicate macro execution within a session window

const _macroRuns = new Map(); // sessionId -> Map<seqName, lastRunTs>
const MACRO_COOLDOWN_MS = 5 * 60 * 1000;

function checkMacroCooldown(sessionId, sequenceName) {
    if (!sessionId) return { blocked: false };
    if (!_macroRuns.has(sessionId)) _macroRuns.set(sessionId, new Map());
    const runs   = _macroRuns.get(sessionId);
    const last   = runs.get(sequenceName) || 0;
    const elapsed = Date.now() - last;
    if (elapsed < MACRO_COOLDOWN_MS) {
        return { blocked: true, retryAfterMs: MACRO_COOLDOWN_MS - elapsed, reason: `Sequence '${sequenceName}' ran ${Math.round(elapsed / 1000)}s ago — cooldown prevents duplicate execution` };
    }
    runs.set(sequenceName, Date.now());
    return { blocked: false };
}

module.exports = { classifyCommand, getSequence, listSequences, validationReminder, checkMacroCooldown, SEQUENCES };
