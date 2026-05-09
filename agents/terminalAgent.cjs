"use strict";
/**
 * Terminal Agent — executes whitelisted shell commands safely.
 *
 * Security layers:
 *   1. BLOCKED_PATTERNS checked first — instant reject
 *   2. ALLOWED_PREFIXES whitelist — only known-safe base commands
 *   3. 10-second execution timeout
 *   4. Output capped at 4000 chars
 *   5. Runs in project root, not arbitrary paths
 */

const { exec } = require("child_process");
const path      = require("path");

const WORK_DIR   = path.join(__dirname, "..");   // project root
const TIMEOUT_MS = 10_000;
const MAX_OUTPUT = 4000;

// ── Blocked patterns — checked before whitelist ──────────────────
const BLOCKED = [
    /\brm\b/,
    /\bsudo\b/,
    /\bchmod\b/,
    /\bchown\b/,
    /\bmkfs\b/,
    /\bdd\b\s+if=/,
    /\bshutdown\b/,
    /\breboot\b/,
    /\bhalt\b/,
    /\bpoweroff\b/,
    /\bkill\b/,
    /\bpkill\b/,
    /\bkillall\b/,
    /\|\s*(bash|sh|zsh|fish|ksh|csh)/,  // pipe to shell
    /curl[^|]*\|/,                        // curl pipe
    /wget[^|]*\|/,                        // wget pipe
    /`/,                                  // backtick subshell
    /\$\(/,                               // $() subshell
    />\s*\//,                             // redirect to absolute path
    />>\s*\//,
    /\/etc\//,
    /\/var\//,
    /\/usr\//,
    /\/bin\//,
    /\/sbin\//,
    /\/dev\//,
    /\/sys\//,
    /\/proc\//,
    /\.\.\//,                             // path traversal
    /eval\s/,
    /exec\s/,
    /source\s/,
    /\benv\b.*=/,
    /export\s+\w+=.*(PASSWORD|SECRET|TOKEN|KEY)/i,
];

// ── Allowed command prefixes (base command must match one) ────────
const ALLOWED_PREFIXES = [
    "pwd",
    "ls",
    "mkdir",
    "rmdir",       // only empty dirs
    "touch",
    "cat",
    "echo",
    "whoami",
    "hostname",
    "date",
    "uname",
    "which",
    "where",
    "type",
    "env",
    "printenv",
    "git status",
    "git log",
    "git diff",
    "git branch",
    "git show",
    "git remote",
    "git fetch",
    "git stash",
    "npm install",
    "npm run",
    "npm list",
    "npm ls",
    "npm --version",
    "npm -v",
    "npm test",
    "npm audit",
    "node --version",
    "node -v",
    "node -e",
    "npx",
    "python --version",
    "python3 --version",
    "python -V",
    "python3 -V",
];

function _isBlocked(cmd) {
    const lower = cmd.toLowerCase().trim();
    return BLOCKED.some(p => p.test(lower));
}

function _isAllowed(cmd) {
    const lower = cmd.toLowerCase().trim();
    return ALLOWED_PREFIXES.some(prefix => lower === prefix || lower.startsWith(prefix + " "));
}

function _run(command, cwd) {
    return new Promise((resolve) => {
        const child = exec(command, { cwd, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            const out    = (stdout || "").slice(0, MAX_OUTPUT);
            const errOut = (stderr || "").slice(0, 500);
            resolve({ stdout: out, stderr: errOut, exitCode: err?.code ?? 0, killed: err?.killed || false });
        });
        // Belt-and-suspenders: kill if still running after timeout
        setTimeout(() => { try { child.kill(); } catch { /* already done */ } }, TIMEOUT_MS + 500);
    });
}

async function run(command) {
    if (!command || !command.trim()) {
        return { success: false, command, error: "Empty command" };
    }

    const cmd = command.trim();

    // Security check 1: block list
    if (_isBlocked(cmd)) {
        console.log(`[TerminalAgent] BLOCKED: "${cmd}"`);
        return {
            success: false,
            command: cmd,
            error:   `Command blocked by security policy: "${cmd.slice(0, 60)}"`,
            blocked: true
        };
    }

    // Security check 2: whitelist
    if (!_isAllowed(cmd)) {
        console.log(`[TerminalAgent] NOT WHITELISTED: "${cmd}"`);
        return {
            success: false,
            command: cmd,
            error:   `Command not in whitelist: "${cmd.split(" ")[0]}". Allowed: ${ALLOWED_PREFIXES.slice(0, 8).join(", ")}...`,
            blocked: true
        };
    }

    console.log(`[TerminalAgent] exec: "${cmd}" in ${WORK_DIR}`);
    const result = await _run(cmd, WORK_DIR);

    const output = result.stdout || result.stderr || "(no output)";
    const success = result.exitCode === 0 && !result.killed;

    console.log(`[TerminalAgent] exit=${result.exitCode} killed=${result.killed} output_len=${output.length}`);

    return {
        success,
        command: cmd,
        stdout:  result.stdout,
        stderr:  result.stderr,
        output,
        exitCode: result.exitCode,
        result:  success
            ? `$ ${cmd}\n${output}`
            : `$ ${cmd}\nExit ${result.exitCode}${result.stderr ? "\n" + result.stderr.slice(0, 200) : ""}`,
        timedOut: result.killed
    };
}

module.exports = { run };
