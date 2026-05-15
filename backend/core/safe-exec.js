"use strict";
/**
 * safe-exec — centralized shell execution with allowlist, env sanitization,
 * timeout kill, and output cap.
 *
 * Uses spawn(shell:false) to prevent shell injection.
 * Every execution is logged (duration, exit code, blocked/ok).
 *
 * Usage:
 *   const { run } = require("./safe-exec");
 *   const result = await run("git", ["status"]);
 *   const result = await run("node", ["-e", "console.log(1)"], { timeoutMs: 5000 });
 */

const { spawn }  = require("child_process");
const path       = require("path");
const logger     = require("../utils/logger");

// ── Configuration ─────────────────────────────────────────────────────────

const PROJECT_ROOT    = path.resolve(__dirname, "../..");
const DEFAULT_TIMEOUT = 15_000;   // 15s
const MAX_TIMEOUT     = 60_000;   // 60s hard cap
const MAX_OUTPUT      = 128_000;  // 128KB per stream

// Commands that may be executed. Arguments are NOT restricted here —
// the caller must sanitize arguments. CWD is restricted to PROJECT_ROOT.
const ALLOWLIST = new Set([
    "echo", "printf", "ls", "cat", "head", "tail", "grep", "find",
    "pwd", "whoami", "uname", "date", "which", "env", "printenv",
    "wc", "sort", "uniq", "tr", "cut", "diff", "stat",
    "basename", "dirname", "realpath", "test", "true", "false",
    "node", "npm", "npx",
    "git",
    "python", "python3",
]);

// Argument fragments that are always blocked regardless of command.
// Checked against each argument string (not full command — no shell parsing needed
// because we use spawn with shell:false and pass arguments as an array).
const BLOCKED_ARG_PATTERNS = [
    /\.\.\/\.\./,          // multi-level path traversal
    /\/etc\//,             // system config
    /\/var\//,             // system var (logs, data, etc.)
    /\/usr\//,             // system binaries
    /\/bin\//,             // system binaries
    /\/sbin\//,            // system binaries
    /\/dev\//,             // devices
    /\/sys\//,             // kernel
    /\/proc\//,            // process info
    /\$\(/,                // command substitution in arguments
    /`/,                   // backtick substitution
    /^--exec$/,            // find --exec (used for injection via find)
    /^-exec$/,
];

// Commands that are never allowed regardless of the ALLOWLIST.
const BLOCKED_COMMANDS = new Set([
    "rm", "rmdir", "sudo", "su", "sh", "bash", "zsh", "fish", "ksh",
    "chmod", "chown", "chgrp", "mkfs", "dd", "curl", "wget",
    "nc", "ncat", "netcat", "telnet", "ssh", "scp", "rsync",
    "kill", "pkill", "killall",
    "shutdown", "reboot", "halt", "poweroff",
    "crontab", "at", "systemctl", "service",
    "iptables", "ufw",
    "apt", "apt-get", "yum", "dnf", "brew", "pip", "pip3",
    "docker", "kubectl",
    "passwd", "useradd", "userdel", "usermod",
    "eval", "exec",
]);

// Env vars that are NEVER passed to child processes.
// Child processes should not have access to secrets.
const ENV_STRIP_PATTERNS = [
    /TOKEN/i,
    /SECRET/i,
    /KEY/i,
    /PASSWORD/i,
    /HASH/i,
    /CREDENTIAL/i,
    /API_KEY/i,
    /JWT/i,
    /AUTH/i,
    /COOKIE/i,
];

/**
 * Sanitize the process environment before passing to a child.
 * Strips all secret-bearing variables. Provides a minimal, safe env.
 */
function _sanitizeEnv(extraEnv = {}) {
    const safe = {};
    // Pass only a small set of safe system vars
    const PASS_THROUGH = ["PATH", "HOME", "USER", "LANG", "TERM", "TZ", "NODE_ENV"];
    for (const key of PASS_THROUGH) {
        if (process.env[key]) safe[key] = process.env[key];
    }
    // Merge caller-supplied env, but strip secret patterns
    for (const [k, v] of Object.entries(extraEnv)) {
        if (ENV_STRIP_PATTERNS.some(p => p.test(k))) continue;
        safe[k] = String(v);
    }
    return safe;
}

/**
 * Validate command and arguments before spawn.
 * Returns { ok, reason } — reason is set if rejected.
 */
function validate(cmd, args = []) {
    if (!cmd || typeof cmd !== "string") return { ok: false, reason: "invalid_command_type" };

    const base = cmd.trim().toLowerCase();
    if (!base) return { ok: false, reason: "empty_command" };

    // Blocked commands — highest priority
    if (BLOCKED_COMMANDS.has(base)) {
        return { ok: false, reason: `blocked_command: ${base}` };
    }

    // Allowlist check
    if (!ALLOWLIST.has(base)) {
        return { ok: false, reason: `command_not_allowlisted: ${base}` };
    }

    // Argument validation
    if (!Array.isArray(args)) return { ok: false, reason: "args_must_be_array" };
    for (const arg of args) {
        const a = String(arg);
        for (const pattern of BLOCKED_ARG_PATTERNS) {
            if (pattern.test(a)) {
                return { ok: false, reason: `blocked_argument_pattern: ${a.slice(0, 60)}` };
            }
        }
    }

    return { ok: true };
}

/**
 * Execute a command safely.
 *
 * @param {string}   cmd           — executable name (no path, no shell)
 * @param {string[]} args          — argument array (NOT a shell string)
 * @param {object}   opts
 * @param {string}   opts.cwd      — working directory (defaults to project root; must be under project root)
 * @param {number}   opts.timeoutMs
 * @param {object}   opts.env      — extra env vars (secrets are stripped before passing)
 * @param {string}   opts.requestId — for log correlation
 *
 * @returns {Promise<{ok, stdout, stderr, exitCode, timedOut, blocked, reason, durationMs}>}
 */
async function run(cmd, args = [], opts = {}) {
    const {
        cwd:       rawCwd   = PROJECT_ROOT,
        timeoutMs: rawTimeout = DEFAULT_TIMEOUT,
        env:       extraEnv = {},
        requestId  = "-",
    } = opts;

    const timeoutMs = Math.min(rawTimeout, MAX_TIMEOUT);

    // ── Resolve and validate CWD ──────────────────────────────────────
    const cwd = path.resolve(rawCwd);
    if (!cwd.startsWith(PROJECT_ROOT)) {
        const result = { ok: false, blocked: true, reason: `cwd_outside_project: ${cwd}`,
            stdout: "", stderr: "", exitCode: null, timedOut: false, durationMs: 0 };
        logger.warn(`[SafeExec] [${requestId}] BLOCKED cwd=${cwd} — outside project root`);
        return result;
    }

    // ── Validate command ──────────────────────────────────────────────
    const v = validate(cmd, args);
    if (!v.ok) {
        const result = { ok: false, blocked: true, reason: v.reason,
            stdout: "", stderr: "", exitCode: null, timedOut: false, durationMs: 0 };
        logger.warn(`[SafeExec] [${requestId}] BLOCKED cmd="${cmd}" reason=${v.reason}`);
        return result;
    }

    const env = _sanitizeEnv(extraEnv);
    const t0  = Date.now();

    return new Promise((resolve) => {
        let stdout  = "";
        let stderr  = "";
        let killed  = false;
        let settled = false;

        const child = spawn(cmd, args, {
            cwd,
            env,
            shell:   false,  // CRITICAL — prevents shell injection
            stdio:   ["ignore", "pipe", "pipe"],
        });

        const timer = setTimeout(() => {
            if (settled) return;
            killed = true;
            try {
                // Kill process group to catch any child processes spawned by the command
                process.kill(-child.pid, "SIGKILL");
            } catch {
                try { child.kill("SIGKILL"); } catch { /* already dead */ }
            }
        }, timeoutMs);

        child.stdout.on("data", (chunk) => {
            if (stdout.length < MAX_OUTPUT) stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk) => {
            if (stderr.length < MAX_OUTPUT) stderr += chunk.toString();
        });

        child.on("close", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            const durationMs = Date.now() - t0;
            const ok = !killed && code === 0;

            logger.info(
                `[SafeExec] [${requestId}] ${ok ? "OK" : "FAIL"} ` +
                `cmd="${cmd}" args=${JSON.stringify(args.slice(0, 3))} ` +
                `exit=${code} dur=${durationMs}ms timedOut=${killed}`
            );

            resolve({ ok, stdout, stderr, exitCode: code, timedOut: killed, blocked: false, reason: null, durationMs });
        });

        child.on("error", (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const durationMs = Date.now() - t0;
            logger.warn(`[SafeExec] [${requestId}] ERROR cmd="${cmd}": ${err.message}`);
            resolve({ ok: false, stdout, stderr, exitCode: null, timedOut: false, blocked: false, reason: err.message, durationMs });
        });
    });
}

module.exports = { run, validate, ALLOWLIST, BLOCKED_COMMANDS, PROJECT_ROOT };
