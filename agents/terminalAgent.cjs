"use strict";
/**
 * Terminal Agent — executes whitelisted commands via safe-exec (no shell).
 *
 * Security is enforced entirely by safe-exec:
 *   - spawn(shell:false) — no shell parsing
 *   - Allowlist: ~25 safe executables
 *   - Argument pattern validation (no traversal, no $(), no backtick)
 *   - CWD restricted to project root
 *   - Environment sanitized (secrets stripped)
 *   - Hard timeout kill + output cap
 *
 * Public API: run(commandString) → { success, command, stdout, stderr, output, exitCode, result, timedOut }
 */

const path     = require("path");
const safeExec = require("../backend/core/safe-exec");

const WORK_DIR = path.resolve(__dirname, "..");   // project root

/**
 * Parse a command string into [cmd, ...args] by whitespace.
 * Handles simple commands with flags (e.g. "git log --oneline -10").
 * Does not handle quoted arguments — safe-exec allowlist rejects anything
 * complex enough to need quoting anyway.
 */
function _tokenize(commandStr) {
    return commandStr.trim().split(/\s+/).filter(Boolean);
}

async function run(command) {
    if (!command || !command.trim()) {
        return { success: false, command, error: "Empty command" };
    }

    const cmd = command.trim();
    const tokens = _tokenize(cmd);
    const exe    = tokens[0];
    const args   = tokens.slice(1);

    // Validate before spawning (gives caller a clean error without a process spawn)
    const check = safeExec.validate(exe, args);
    if (!check.ok) {
        console.log(`[TerminalAgent] BLOCKED: "${cmd}" — ${check.reason}`);
        return {
            success: false,
            command: cmd,
            error:   `Command blocked: ${check.reason}`,
            blocked: true
        };
    }

    console.log(`[TerminalAgent] run: "${cmd}" in ${WORK_DIR}`);
    const r = await safeExec.run(exe, args, { cwd: WORK_DIR });

    if (r.blocked) {
        console.log(`[TerminalAgent] BLOCKED at exec: "${cmd}" — ${r.reason}`);
        return { success: false, command: cmd, error: `Blocked: ${r.reason}`, blocked: true };
    }

    const output  = r.stdout || r.stderr || "(no output)";
    const success = r.ok;

    console.log(`[TerminalAgent] exit=${r.exitCode} timedOut=${r.timedOut} dur=${r.durationMs}ms`);

    return {
        success,
        command:  cmd,
        stdout:   r.stdout,
        stderr:   r.stderr,
        output,
        exitCode: r.exitCode,
        result: success
            ? `$ ${cmd}\n${output}`
            : `$ ${cmd}\nExit ${r.exitCode}${r.stderr ? "\n" + r.stderr.slice(0, 200) : ""}`,
        timedOut: r.timedOut
    };
}

module.exports = { run };
