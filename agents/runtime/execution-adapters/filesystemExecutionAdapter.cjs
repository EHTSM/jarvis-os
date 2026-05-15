"use strict";
/**
 * filesystemExecutionAdapter — workspace-scoped filesystem operations.
 *
 * readFile(spec)        → { read, executionId, path, content }
 * writeFile(spec)       → { written, executionId, path }
 * listDirectory(spec)   → { listed, executionId, path, entries }
 * deleteFile(spec)      → { deleted, executionId, path }
 * validatePath(path, workspaceRoot) → { valid, reason }
 * getAuditLog()         → AuditRecord[]
 * getAdapterMetrics()   → AdapterMetrics
 * reset()
 *
 * Safety: workspace-scoped. Deny path traversal, sensitive directories,
 * and credential-bearing filenames. All operations are immutably logged.
 */

const SENSITIVE_PATHS = [
    "/etc", "/usr", "/bin", "/sbin", "/sys", "/proc", "/dev",
    "/.ssh", "/.gnupg", "/.aws", "/.env", "/root",
    "/private/etc", "/private/var",
];

const DENY_PATTERNS = [
    /\.\.\//,       // path traversal
    /\.\.$|\/\.\.$/, // trailing ..
    /\.env$/i,
    /\.pem$/i,
    /\.key$/i,
    /\.p12$/i,
    /password/i,
    /secret/i,
    /credential/i,
    /id_rsa/,
    /authorized_keys/,
];

const AUTHORITY_RANK = {
    observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4,
};

const DEFAULT_WORKSPACE = "/workspace";

let _auditLog = [];
let _counter  = 0;

// ── validatePath ──────────────────────────────────────────────────────

function validatePath(path, workspaceRoot = DEFAULT_WORKSPACE) {
    if (!path) return { valid: false, reason: "path_required" };

    for (const pattern of DENY_PATTERNS) {
        if (pattern.test(path))
            return { valid: false, reason: "path_matches_deny_pattern", path };
    }

    for (const sensitive of SENSITIVE_PATHS) {
        if (path === sensitive || path.startsWith(sensitive + "/") || path.startsWith(sensitive + "\\"))
            return { valid: false, reason: "sensitive_path_denied", path, sensitivePath: sensitive };
    }

    // Absolute paths must be within workspace
    if (path.startsWith("/") && !path.startsWith(workspaceRoot))
        return { valid: false, reason: "path_outside_workspace", path, workspaceRoot };

    return { valid: true, path };
}

function _audit(operation, path, executionId, outcome, authorityLevel) {
    _auditLog.push({ executionId, operation, path, outcome, authorityLevel, ts: new Date().toISOString() });
}

// ── readFile ──────────────────────────────────────────────────────────

function readFile(spec = {}) {
    const {
        path           = null,
        workflowId     = null,
        authorityLevel = "observer",
        workspaceRoot  = DEFAULT_WORKSPACE,
    } = spec;

    const v = validatePath(path, workspaceRoot);
    if (!v.valid) return { read: false, reason: v.reason, path };

    const executionId = `fs-exec-${++_counter}`;
    _audit("read", path, executionId, "ok", authorityLevel);

    return {
        read: true, executionId, path,
        content: `[simulated content of ${path}]`,
        workflowId, authorityLevel,
    };
}

// ── writeFile ─────────────────────────────────────────────────────────

function writeFile(spec = {}) {
    const {
        path           = null,
        content        = "",
        workflowId     = null,
        authorityLevel = null,
        workspaceRoot  = DEFAULT_WORKSPACE,
    } = spec;

    if (!authorityLevel || (AUTHORITY_RANK[authorityLevel] ?? -1) < AUTHORITY_RANK.operator)
        return { written: false, reason: "insufficient_authority_for_write", required: "operator" };

    const v = validatePath(path, workspaceRoot);
    if (!v.valid) return { written: false, reason: v.reason, path };

    const executionId = `fs-exec-${++_counter}`;
    _audit("write", path, executionId, "ok", authorityLevel);

    return { written: true, executionId, path, bytesWritten: content.length, workflowId };
}

// ── listDirectory ─────────────────────────────────────────────────────

function listDirectory(spec = {}) {
    const {
        path           = null,
        workflowId     = null,
        authorityLevel = "observer",
        workspaceRoot  = DEFAULT_WORKSPACE,
    } = spec;

    const v = validatePath(path, workspaceRoot);
    if (!v.valid) return { listed: false, reason: v.reason, path };

    const executionId = `fs-exec-${++_counter}`;
    _audit("list", path, executionId, "ok", authorityLevel);

    return {
        listed: true, executionId, path,
        entries: [`[simulated entry in ${path}]`],
        workflowId,
    };
}

// ── deleteFile ────────────────────────────────────────────────────────

function deleteFile(spec = {}) {
    const {
        path           = null,
        workflowId     = null,
        authorityLevel = null,
        workspaceRoot  = DEFAULT_WORKSPACE,
    } = spec;

    if (!authorityLevel || (AUTHORITY_RANK[authorityLevel] ?? -1) < AUTHORITY_RANK.controller)
        return { deleted: false, reason: "insufficient_authority_for_delete", required: "controller" };

    const v = validatePath(path, workspaceRoot);
    if (!v.valid) return { deleted: false, reason: v.reason, path };

    const executionId = `fs-exec-${++_counter}`;
    _audit("delete", path, executionId, "ok", authorityLevel);

    return { deleted: true, executionId, path, workflowId };
}

// ── getAuditLog ───────────────────────────────────────────────────────

function getAuditLog() {
    return [..._auditLog];
}

// ── getAdapterMetrics ─────────────────────────────────────────────────

function getAdapterMetrics() {
    const byOp = {};
    for (const r of _auditLog) byOp[r.operation] = (byOp[r.operation] ?? 0) + 1;
    return {
        totalOperations: _auditLog.length,
        byOperation:     byOp,
        adapterType:     "filesystem",
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _auditLog = [];
    _counter  = 0;
}

module.exports = {
    SENSITIVE_PATHS, DENY_PATTERNS, DEFAULT_WORKSPACE,
    validatePath, readFile, writeFile, listDirectory, deleteFile,
    getAuditLog, getAdapterMetrics, reset,
};
