"use strict";
/**
 * terminalExecutionAdapter — allowlisted command execution with optional
 * controlled real execution mode.
 *
 * executeCommand(spec)   → { executed, executionId, stdout, stderr, exitCode }
 * validateCommand(spec)  → { valid, command, reason }
 * tokenizeArgv(command)  → { valid, tokens, reason }
 * dryRunCommand(spec)    → { dryRun, command, wouldExecute, validation }
 * getExecutionLog()      → ExecutionRecord[]
 * getAdapterMetrics()    → AdapterMetrics
 * reset()
 *
 * Simulation mode (default, realExecution: false):
 *   Deterministic simulated output. No subprocess spawned.
 *
 * Real execution mode (realExecution: true):
 *   Uses child_process.spawnSync with shell:false, strict argv tokenization,
 *   timeout kill-switch, and stdout/stderr truncation.
 *   ONLY for allowlisted commands. NO shell interpolation. NO pipes.
 *   NO redirects. NO chained commands. NO subshells.
 */

const { spawnSync } = require("child_process");

const COMMAND_ALLOWLIST = [
    "ls", "pwd", "echo", "cat", "head", "tail", "grep", "find",
    "git status", "git diff", "git log", "git branch", "git show",
    "node --version", "npm --version", "npm list",
    "docker ps", "docker inspect", "docker logs",
    "env", "date", "whoami", "uname",
];

const DENY_PATTERNS = [
    /rm\s+-[rRfF]/, /rm\s+\//, /sudo/, /chmod\s+777/,
    /curl\s+.*\|\s*(?:sh|bash|zsh)/, /wget\s+.*\|\s*(?:sh|bash|zsh)/,
    /\beval\b/, /&&\s*rm/, /;\s*rm/, /\$\([^)]*\)/, /`[^`]*`/,
    />\s*\/(?!workspace)/, />>\s*\/(?!workspace)/,
    /\bdd\b.*\bof=/, /mkfs/, /fdisk/,
];

// Shell metacharacters blocked in real execution tokenization
const SHELL_META_RE = /[|><;&\n\r`]|\$\(|\$\{|\|\|/;

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS     = 30000;
const MAX_OUTPUT_BYTES   = 65536;   // 64 KB per stream

let _executions = [];
let _counter    = 0;

// ── validateCommand ───────────────────────────────────────────────────

function validateCommand(spec = {}) {
    const { command = null } = spec;
    if (!command) return { valid: false, reason: "command_required" };

    const trimmed = command.trim();

    for (const pattern of DENY_PATTERNS) {
        if (pattern.test(trimmed))
            return { valid: false, reason: "command_matches_deny_pattern", command: trimmed };
    }

    const allowed = COMMAND_ALLOWLIST.some(
        prefix => trimmed === prefix || trimmed.startsWith(prefix + " ")
    );
    if (!allowed)
        return { valid: false, reason: "command_not_in_allowlist", command: trimmed };

    return { valid: true, command: trimmed };
}

// ── tokenizeArgv ──────────────────────────────────────────────────────
// Defense-in-depth for real execution: rejects shell metacharacters
// BEFORE the command string is split into argv tokens.

function tokenizeArgv(command) {
    if (!command) return { valid: false, reason: "command_required" };

    const trimmed = command.trim();

    if (SHELL_META_RE.test(trimmed))
        return { valid: false, reason: "shell_metacharacter_rejected", command: trimmed };

    const tokens = trimmed.split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0)
        return { valid: false, reason: "empty_command" };

    // Belt-and-suspenders: check each token for metacharacters too
    for (const token of tokens) {
        if (SHELL_META_RE.test(token))
            return { valid: false, reason: `unsafe_token: ${token}`, command: trimmed };
    }

    return { valid: true, tokens, command: trimmed };
}

// ── executeCommand ────────────────────────────────────────────────────

function executeCommand(spec = {}) {
    const {
        command        = null,
        workflowId     = null,
        authorityLevel = null,
        timeoutMs      = DEFAULT_TIMEOUT_MS,
        dryRun         = false,
        realExecution  = false,
        correlationId  = null,
    } = spec;

    if (!authorityLevel || authorityLevel === "observer")
        return { executed: false, reason: "insufficient_authority", required: "operator" };

    const validation = validateCommand({ command });
    if (!validation.valid)
        return { executed: false, reason: validation.reason, command };

    const clampedTimeout = Math.min(timeoutMs, MAX_TIMEOUT_MS);
    const executionId    = `term-exec-${++_counter}`;
    const timestamp      = new Date().toISOString();

    if (dryRun) {
        return {
            executed: false, dryRun: true, executionId,
            command: validation.command,
            wouldExecute: true, timeoutMs: clampedTimeout, timestamp,
        };
    }

    // ── Real execution path ───────────────────────────────────────────
    if (realExecution) {
        const tokenResult = tokenizeArgv(validation.command);
        if (!tokenResult.valid)
            return { executed: false, reason: tokenResult.reason, command: validation.command };

        const [cmd, ...args] = tokenResult.tokens;

        const result = spawnSync(cmd, args, {
            shell:     false,
            timeout:   clampedTimeout,
            encoding:  "utf8",
            maxBuffer: MAX_OUTPUT_BYTES * 2,
        });

        // Timeout or spawn error
        if (result.error) {
            const timedOut = result.error.code === "ETIMEDOUT" || result.signal === "SIGTERM";
            const status   = timedOut ? "timeout" : "spawn_error";
            const record   = {
                executionId, command: validation.command,
                workflowId, authorityLevel, correlationId,
                timeoutMs: clampedTimeout, realExecution: true,
                stdout: "", stderr: result.error.message ?? "",
                exitCode: null, status, timestamp,
            };
            _executions.push(record);
            return {
                executed: false, executionId,
                reason: status, command: validation.command,
                timedOut, workflowId, timestamp,
            };
        }

        const stdout = (result.stdout ?? "").slice(0, MAX_OUTPUT_BYTES);
        const stderr = (result.stderr ?? "").slice(0, MAX_OUTPUT_BYTES);
        const exitCode = result.status ?? 0;
        const execStatus = exitCode === 0 ? "completed" : "failed";

        const record = {
            executionId, command: validation.command,
            workflowId, authorityLevel, correlationId,
            timeoutMs: clampedTimeout, realExecution: true,
            stdout, stderr, exitCode, status: execStatus, timestamp,
        };
        _executions.push(record);

        return {
            executed: true, executionId,
            command:  validation.command,
            stdout, stderr, exitCode,
            status:   execStatus,
            realExecution: true,
            workflowId, timestamp,
        };
    }

    // ── Simulation path ───────────────────────────────────────────────
    const record = {
        executionId, command: validation.command,
        workflowId, authorityLevel, correlationId,
        timeoutMs: clampedTimeout, realExecution: false,
        stdout:   `[simulated stdout: ${validation.command}]`,
        stderr:   "",
        exitCode: 0,
        status:   "completed",
        timestamp,
    };
    _executions.push(record);

    return {
        executed: true, executionId,
        command:  record.command,
        stdout:   record.stdout,
        stderr:   record.stderr,
        exitCode: record.exitCode,
        status:   record.status,
        workflowId, timestamp,
    };
}

// ── dryRunCommand ─────────────────────────────────────────────────────

function dryRunCommand(spec = {}) {
    const { command = null, authorityLevel = null } = spec;
    if (!command) return { dryRun: false, reason: "command_required" };

    const validation = validateCommand({ command });
    return {
        dryRun:       true,
        command:      command.trim(),
        wouldExecute: validation.valid,
        validation,
        authorityLevel,
    };
}

// ── getExecutionLog ───────────────────────────────────────────────────

function getExecutionLog() {
    return [..._executions];
}

// ── getAdapterMetrics ─────────────────────────────────────────────────

function getAdapterMetrics() {
    return {
        totalExecutions:  _executions.length,
        completedCount:   _executions.filter(e => e.status === "completed").length,
        failedCount:      _executions.filter(e => e.status === "failed").length,
        realExecutions:   _executions.filter(e => e.realExecution).length,
        adapterType:      "terminal",
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _executions = [];
    _counter    = 0;
}

module.exports = {
    COMMAND_ALLOWLIST, DENY_PATTERNS, SHELL_META_RE,
    DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MAX_OUTPUT_BYTES,
    executeCommand, validateCommand, tokenizeArgv, dryRunCommand,
    getExecutionLog, getAdapterMetrics, reset,
};
