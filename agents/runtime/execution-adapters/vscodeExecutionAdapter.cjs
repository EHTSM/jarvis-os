"use strict";
/**
 * vscodeExecutionAdapter — VS Code workspace-aware editor operations.
 *
 * navigateFile(spec)        → { navigated, executionId, path, line }
 * editFile(spec)            → { edited, executionId, path, changesApplied }
 * scanWorkspace(spec)       → { scanned, executionId, fileCount }
 * captureEditorState(spec)  → { captured, executionId, state }
 * getExecutionLog()         → ExecutionRecord[]
 * getAdapterMetrics()       → AdapterMetrics
 * reset()
 *
 * Safety: edit operations denied for sensitive paths (.env, .pem, .key).
 * Write ops require operator+. Read/navigate ops are observer-permitted.
 */

const EDIT_DENY_PATTERNS = [
    /\.env$/i,
    /\.pem$/i,
    /\.key$/i,
    /\.p12$/i,
    /secret/i,
    /password/i,
    /credential/i,
    /id_rsa/,
    /authorized_keys/,
];

const AUTHORITY_RANK = {
    observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4,
};

let _execLog = [];
let _counter = 0;

function _log(op, path, executionId, outcome) {
    _execLog.push({ executionId, op, path: path ?? null, outcome, ts: new Date().toISOString() });
}

function _validateEditPath(path) {
    for (const pattern of EDIT_DENY_PATTERNS) {
        if (pattern.test(path))
            return { valid: false, reason: "edit_path_denied_by_policy", path };
    }
    return { valid: true };
}

// ── navigateFile ──────────────────────────────────────────────────────

function navigateFile(spec = {}) {
    const { path = null, line = null, workflowId = null, authorityLevel = "observer" } = spec;
    if (!path) return { navigated: false, reason: "path_required" };

    const executionId = `vsc-exec-${++_counter}`;
    _log("navigate", path, executionId, "ok");

    return {
        navigated: true, executionId, path,
        line: line ?? 1,
        workflowId, authorityLevel,
    };
}

// ── editFile ──────────────────────────────────────────────────────────

function editFile(spec = {}) {
    const {
        path           = null,
        changes        = [],
        workflowId     = null,
        authorityLevel = null,
        dryRun         = false,
    } = spec;

    if (!path) return { edited: false, reason: "path_required" };
    if (!authorityLevel || (AUTHORITY_RANK[authorityLevel] ?? -1) < AUTHORITY_RANK.operator)
        return { edited: false, reason: "insufficient_authority_for_edit", required: "operator" };

    const pathCheck = _validateEditPath(path);
    if (!pathCheck.valid) return { edited: false, reason: pathCheck.reason, path };

    const executionId = `vsc-exec-${++_counter}`;

    if (dryRun) {
        return {
            edited: false, dryRun: true, executionId, path,
            preview: `[dry-run: would apply ${changes.length} change(s) to ${path}]`,
            workflowId,
        };
    }

    _log("edit", path, executionId, "ok");
    return {
        edited: true, executionId, path,
        changesApplied: changes.length,
        workflowId, authorityLevel,
    };
}

// ── scanWorkspace ─────────────────────────────────────────────────────

function scanWorkspace(spec = {}) {
    const { workspaceRoot = "/workspace", workflowId = null, authorityLevel = "observer" } = spec;
    const executionId = `vsc-exec-${++_counter}`;
    _log("scan", workspaceRoot, executionId, "ok");
    return {
        scanned: true, executionId, workspaceRoot,
        fileCount: 42,
        workflowId, authorityLevel,
    };
}

// ── captureEditorState ────────────────────────────────────────────────

function captureEditorState(spec = {}) {
    const { workflowId = null, authorityLevel = "observer" } = spec;
    const executionId = `vsc-exec-${++_counter}`;
    _log("capture_state", null, executionId, "ok");

    return {
        captured: true, executionId,
        state: {
            openFiles:  ["[simulated open file]"],
            activeFile: "[simulated active file]",
            cursorLine: 1,
        },
        workflowId, authorityLevel,
    };
}

// ── getExecutionLog ───────────────────────────────────────────────────

function getExecutionLog() {
    return [..._execLog];
}

// ── getAdapterMetrics ─────────────────────────────────────────────────

function getAdapterMetrics() {
    const byOp = {};
    for (const r of _execLog) byOp[r.op] = (byOp[r.op] ?? 0) + 1;
    return {
        totalExecutions: _execLog.length,
        byOperation:     byOp,
        adapterType:     "vscode",
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _execLog = [];
    _counter = 0;
}

module.exports = {
    EDIT_DENY_PATTERNS,
    navigateFile, editFile, scanWorkspace, captureEditorState,
    getExecutionLog, getAdapterMetrics, reset,
};
