"use strict";
/**
 * runtimeSecurityGuard — command-level security enforcement.
 *
 * checkCommand(command, opts)               → SecurityResult
 * detectPrivilegeEscalation(command)        → EscalationResult
 * checkFilesystemBoundary(path, opts)       → BoundaryResult
 * checkRecursion(executionId, callStack)    → RecursionResult
 * validateSignature(executionId, signature) → SignatureResult
 * getSecurityReport()                       → SecurityReport
 * reset()
 */

const ALLOWED_BASE_COMMANDS = new Set([
    "echo", "git", "node", "npm", "ls", "cat", "pwd", "which", "env",
    "grep", "find", "head", "tail", "wc", "sort", "uniq", "true", "false",
]);

const DANGEROUS_PATTERNS = [
    { pattern: /rm\s+(-[a-z]*f[a-z]*\s+|--force\s+)/,   label: "destructive_delete",   severity: "critical" },
    { pattern: /\bsudo\b/,                                label: "privilege_escalation", severity: "critical" },
    { pattern: /curl[^|]*\|[^|]*bash/,                   label: "remote_code_execution",severity: "critical" },
    { pattern: /wget[^|]*\|[^|]*sh/,                     label: "remote_code_execution",severity: "critical" },
    { pattern: /:\(\)\s*\{[^}]*\}/,                      label: "fork_bomb",            severity: "critical" },
    { pattern: />\s*\/etc\//,                             label: "system_file_write",    severity: "critical" },
    { pattern: />\s*\/proc\//,                            label: "kernel_write",         severity: "critical" },
    { pattern: /DROP\s+TABLE/i,                           label: "sql_injection",        severity: "critical" },
    { pattern: /DELETE\s+FROM[^;]+WHERE\s+1\s*=/i,       label: "sql_injection",        severity: "critical" },
    { pattern: /eval\s*\(/,                               label: "code_injection",       severity: "high" },
    { pattern: /new\s+Function\s*\(/,                    label: "code_injection",       severity: "high" },
    { pattern: /chmod\s+(777|a\+[rwx]+)/,                label: "permission_escalation",severity: "high" },
    { pattern: /chown\s+-R/,                              label: "ownership_change",     severity: "high" },
    { pattern: /\/bin\/sh\s+-c/,                          label: "shell_injection",      severity: "high" },
    { pattern: /git\s+push\s+.*--force/,                 label: "force_push",           severity: "medium" },
    { pattern: /git\s+reset\s+--hard/,                   label: "hard_reset",           severity: "medium" },
    { pattern: /npm\s+publish/,                           label: "package_publish",      severity: "medium" },
];

const PRIVILEGE_PATTERNS = [
    /\bsudo\b/,
    /\bsu\b\s/,
    /chmod\s+[u+]?s/,
    /chown\s+-R/,
    /setuid/,
    /setgid/,
];

const MAX_RECURSION_DEPTH = 10;

let _callStacks = new Map();   // executionId → string[]
let _violations = [];

// ── checkCommand ──────────────────────────────────────────────────────

function checkCommand(command, opts = {}) {
    if (typeof command !== "string" || !command.trim()) {
        return { allowed: false, blocked: true, reason: "invalid_command", violations: [] };
    }

    const violations = [];
    for (const { pattern, label, severity } of DANGEROUS_PATTERNS) {
        if (pattern.test(command)) violations.push({ label, severity });
    }

    const baseCmd    = command.trim().split(/\s+/)[0];
    const unlisted   = !ALLOWED_BASE_COMMANDS.has(baseCmd);
    const hasCritical = violations.some(v => v.severity === "critical");
    const blocked    = hasCritical || (unlisted && !opts.allowUnlisted);

    if (blocked) {
        _violations.push({
            type:       "command_blocked",
            command:    command.slice(0, 200),
            violations,
            ts:         new Date().toISOString(),
        });
    }

    return { allowed: !blocked, blocked, violations, baseCmd, unlisted };
}

// ── detectPrivilegeEscalation ─────────────────────────────────────────

function detectPrivilegeEscalation(command) {
    if (typeof command !== "string") return { detected: false, patterns: [] };
    const matched = PRIVILEGE_PATTERNS.filter(p => p.test(command)).map(p => p.source);
    const detected = matched.length > 0;
    if (detected) {
        _violations.push({
            type:    "privilege_escalation",
            command: command.slice(0, 200),
            ts:      new Date().toISOString(),
        });
    }
    return { detected, patterns: matched, severity: detected ? "critical" : null };
}

// ── checkFilesystemBoundary ───────────────────────────────────────────

function checkFilesystemBoundary(filePath, opts = {}) {
    if (typeof filePath !== "string") return { allowed: false, reason: "invalid_path" };
    const allowedRoot = opts.allowedRoot ?? process.cwd();

    // Check for path traversal attempts
    const hasTraversal = filePath.includes("../") || filePath.includes("..\\");

    // Resolve absolute path naively (without filesystem access)
    const resolved = filePath.startsWith("/") ? filePath : `${allowedRoot}/${filePath}`;
    const withinBoundary = resolved.startsWith(allowedRoot) && !hasTraversal;

    const allowed = withinBoundary;
    if (!allowed) {
        _violations.push({
            type:        "filesystem_boundary_violation",
            path:        filePath,
            allowedRoot,
            hasTraversal,
            ts:          new Date().toISOString(),
        });
    }
    return { allowed, path: filePath, allowedRoot, hasTraversal, withinBoundary };
}

// ── checkRecursion ────────────────────────────────────────────────────

function checkRecursion(executionId, callStack = []) {
    if (!_callStacks.has(executionId)) _callStacks.set(executionId, []);
    const existing = _callStacks.get(executionId);

    // Merge unique frames
    const merged = [...new Set([...existing, ...callStack])];
    _callStacks.set(executionId, merged);

    const depth    = merged.length;
    const exceeded = depth > MAX_RECURSION_DEPTH;

    if (exceeded) {
        _violations.push({
            type:        "recursion_limit_exceeded",
            executionId,
            depth,
            limit:       MAX_RECURSION_DEPTH,
            ts:          new Date().toISOString(),
        });
    }
    return { safe: !exceeded, depth, limit: MAX_RECURSION_DEPTH, exceeded };
}

// ── validateSignature ─────────────────────────────────────────────────

function validateSignature(executionId, signature) {
    if (!executionId || !signature) {
        return { valid: false, reason: "missing_fields" };
    }
    if (typeof signature !== "string" || signature.length < 8) {
        return { valid: false, reason: "invalid_signature_format" };
    }
    if (/^0+$/.test(signature)) {
        _violations.push({ type: "invalid_signature", executionId, ts: new Date().toISOString() });
        return { valid: false, reason: "signature_tampered" };
    }
    return { valid: true, executionId, signatureLength: signature.length };
}

// ── getSecurityReport ─────────────────────────────────────────────────

function getSecurityReport() {
    const critical = _violations.filter(v =>
        v.type === "privilege_escalation" ||
        v.type === "filesystem_boundary_violation" ||
        v.type === "invalid_signature" ||
        v.type === "recursion_limit_exceeded" ||
        (v.violations ?? []).some(x => x.severity === "critical")
    );
    return {
        violations:     [..._violations],
        violationCount: _violations.length,
        criticalCount:  critical.length,
        ts:             new Date().toISOString(),
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _callStacks = new Map();
    _violations = [];
}

module.exports = {
    ALLOWED_BASE_COMMANDS, DANGEROUS_PATTERNS, MAX_RECURSION_DEPTH,
    checkCommand, detectPrivilegeEscalation, checkFilesystemBoundary,
    checkRecursion, validateSignature, getSecurityReport, reset,
};
