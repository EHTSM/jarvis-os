"use strict";
/**
 * executionSandbox — security validation and execution isolation.
 *
 * validateCommand(command, policy?)
 *   → { allowed, reason?, label? }
 *   policy: "default" | "strict" | "permissive"
 *
 * createSandboxEnv(baseEnv, allowedVars?)   → filtered env object
 * createSandboxCwd(executionId)             → isolated tmp directory path (creates it)
 * cleanup(executionId)                      → remove sandbox directory
 * BLOCKED_PATTERNS
 */

const fs   = require("fs");
const os   = require("os");
const path = require("path");

// ── Security patterns ─────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
    // Filesystem destruction
    { pattern: /rm\s+-[a-z]*r[a-z]*f\s+\//i,         label: "destructive_rm_root",  severity: "critical" },
    { pattern: /rm\s+-[a-z]*f[a-z]*\s+\//i,           label: "force_rm_root",        severity: "critical" },
    { pattern: />\s*\/dev\/sd/,                        label: "disk_overwrite",       severity: "critical" },
    { pattern: /\bdd\b.*\bif=/,                        label: "dd_disk_write",        severity: "critical" },
    // Privilege escalation
    { pattern: /\bsudo\b/,                             label: "sudo",                 severity: "critical" },
    { pattern: /\bsu\s+-/,                             label: "su_root",              severity: "critical" },
    { pattern: /\bchroot\b/,                           label: "chroot",               severity: "critical" },
    // Unsafe network execution
    { pattern: /curl[^|]+\|\s*(bash|sh)\b/,            label: "curl_pipe_shell",      severity: "critical" },
    { pattern: /wget[^|]+\|\s*(bash|sh)\b/,            label: "wget_pipe_shell",      severity: "critical" },
    // Recursive deletion beyond /
    { pattern: /\bfind\s+.*-delete\b/,                 label: "find_delete",          severity: "high" },
    // Unrestricted shell execution
    { pattern: /\bexec\s+bash\b|\bexec\s+sh\b/,       label: "exec_shell",           severity: "high" },
    // Dangerous chmod/chown
    { pattern: /chmod\s+-R\s+777\b/,                   label: "insecure_chmod_r",     severity: "high" },
    { pattern: /chmod\s+777\b/,                        label: "insecure_chmod",       severity: "medium" },
    // SQL destruction
    { pattern: /DROP\s+TABLE/i,                        label: "sql_drop_table",       severity: "high" },
    { pattern: /TRUNCATE\s+TABLE/i,                    label: "sql_truncate",         severity: "medium" },
];

const CRITICAL = BLOCKED_PATTERNS.filter(p => p.severity === "critical");
const HIGH_UP  = BLOCKED_PATTERNS.filter(p => p.severity === "critical" || p.severity === "high");

// ── validateCommand ───────────────────────────────────────────────────

function validateCommand(command = "", policy = "default") {
    const patterns = policy === "strict"      ? BLOCKED_PATTERNS
                   : policy === "permissive"  ? CRITICAL
                   :                            HIGH_UP;    // default

    for (const { pattern, label, severity } of patterns) {
        if (pattern.test(command)) {
            return { allowed: false, reason: `blocked: ${label} (${severity})`, label, severity };
        }
    }
    return { allowed: true };
}

// ── Env isolation ─────────────────────────────────────────────────────

const ALLOWED_EXACT    = new Set(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "PWD", "LANG", "SHELL"]);
const ALLOWED_PREFIXES = ["NODE_", "LC_", "npm_config_"];

function createSandboxEnv(baseEnv = {}, allowedVars = []) {
    const extra = new Set(allowedVars);
    const env   = {};
    for (const [key, val] of Object.entries(baseEnv)) {
        if (ALLOWED_EXACT.has(key)
            || ALLOWED_PREFIXES.some(p => key.startsWith(p))
            || extra.has(key)) {
            env[key] = val;
        }
    }
    return env;
}

// ── Working directory isolation ───────────────────────────────────────

function createSandboxCwd(executionId) {
    const dir = path.join(os.tmpdir(), `jarvis-sandbox-${executionId}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function cleanup(executionId) {
    const dir = path.join(os.tmpdir(), `jarvis-sandbox-${executionId}`);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

module.exports = {
    validateCommand,
    createSandboxEnv,
    createSandboxCwd,
    cleanup,
    BLOCKED_PATTERNS,
    ALLOWED_EXACT,
    ALLOWED_PREFIXES,
};
