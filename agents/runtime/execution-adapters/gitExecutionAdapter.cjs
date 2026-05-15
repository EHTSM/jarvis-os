"use strict";
/**
 * gitExecutionAdapter — safe allowlisted git operations.
 *
 * gitStatus(spec)         → { executed, executionId, output }
 * gitDiff(spec)           → { executed, executionId, output }
 * gitBranch(spec)         → { executed, executionId, branches, currentBranch }
 * validateCommit(spec)    → { valid, violations }
 * safeCheckout(spec)      → { checked_out, executionId, branch }
 * getGitExecutionLog()    → GitRecord[]
 * getAdapterMetrics()     → AdapterMetrics
 * reset()
 *
 * Safety: read-only ops are observer-permitted. Write ops require operator+.
 * Force checkout requires governor. Push/reset-hard/force-push blocked.
 */

const SAFE_READ_OPS  = ["status", "diff", "log", "branch", "show", "stash list"];
const SAFE_WRITE_OPS = ["commit", "checkout", "add", "stash"];
const BLOCKED_OPS    = ["push", "reset --hard", "reset --soft", "clean -f", "branch -D", "push --force"];

const COMMIT_DENY_PATTERNS = [
    /password\s*=/i,
    /secret\s*=/i,
    /api[_-]?key\s*=/i,
    /private[_-]key/i,
    /BEGIN\s+(RSA|EC|OPENSSH)\s+PRIVATE/,
    /\.env$/,
    /\.pem$/,
    /\.key$/,
];

const AUTHORITY_RANK = {
    observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4,
};

let _gitLog  = [];
let _counter = 0;

function _log(op, spec, executionId, outcome) {
    _gitLog.push({
        executionId, op,
        workflowId: spec.workflowId ?? null,
        outcome, ts: new Date().toISOString(),
    });
}

// ── gitStatus ─────────────────────────────────────────────────────────

function gitStatus(spec = {}) {
    const { workflowId = null, authorityLevel = "observer" } = spec;
    const executionId = `git-exec-${++_counter}`;
    _log("status", spec, executionId, "ok");
    return {
        executed: true, executionId,
        output: "[simulated] M  src/index.js\n?? new-file.txt",
        workflowId, authorityLevel,
    };
}

// ── gitDiff ───────────────────────────────────────────────────────────

function gitDiff(spec = {}) {
    const { workflowId = null, authorityLevel = "observer", filePath = null } = spec;
    const executionId = `git-exec-${++_counter}`;
    _log("diff", spec, executionId, "ok");
    return {
        executed: true, executionId,
        output: `[simulated diff${filePath ? " for " + filePath : ""}]`,
        workflowId, authorityLevel,
    };
}

// ── gitBranch ─────────────────────────────────────────────────────────

function gitBranch(spec = {}) {
    const { workflowId = null, authorityLevel = "observer" } = spec;
    const executionId = `git-exec-${++_counter}`;
    _log("branch", spec, executionId, "ok");
    return {
        executed: true, executionId,
        branches: ["main", "feature/test"],
        currentBranch: "main",
        workflowId, authorityLevel,
    };
}

// ── validateCommit ────────────────────────────────────────────────────

function validateCommit(spec = {}) {
    const { message = null, files = [], authorityLevel = null } = spec;
    const violations = [];

    if (!message) violations.push("commit_message_required");
    if (!authorityLevel || (AUTHORITY_RANK[authorityLevel] ?? -1) < AUTHORITY_RANK.operator)
        violations.push("insufficient_authority_for_commit");

    if (message) {
        for (const pattern of COMMIT_DENY_PATTERNS) {
            if (pattern.test(message)) {
                violations.push("commit_message_contains_sensitive_data");
                break;
            }
        }
    }

    for (const file of files) {
        if (/\.env$/.test(file) || /\.pem$/.test(file) || /\.key$/.test(file))
            violations.push(`sensitive_file_in_commit: ${file}`);
    }

    return { valid: violations.length === 0, violations, message, files };
}

// ── safeCheckout ──────────────────────────────────────────────────────

function safeCheckout(spec = {}) {
    const { branch = null, workflowId = null, authorityLevel = null, force = false } = spec;

    if (!branch) return { checked_out: false, reason: "branch_required" };
    if (!authorityLevel || (AUTHORITY_RANK[authorityLevel] ?? -1) < AUTHORITY_RANK.operator)
        return { checked_out: false, reason: "insufficient_authority_for_checkout" };
    if (force && (AUTHORITY_RANK[authorityLevel] ?? -1) < AUTHORITY_RANK.governor)
        return { checked_out: false, reason: "force_checkout_requires_governor" };

    const executionId = `git-exec-${++_counter}`;
    _log("checkout", spec, executionId, "ok");
    return { checked_out: true, executionId, branch, workflowId };
}

// ── getGitExecutionLog ────────────────────────────────────────────────

function getGitExecutionLog() {
    return [..._gitLog];
}

// ── getAdapterMetrics ─────────────────────────────────────────────────

function getAdapterMetrics() {
    const byOp = {};
    for (const r of _gitLog) byOp[r.op] = (byOp[r.op] ?? 0) + 1;
    return {
        totalExecutions: _gitLog.length,
        byOperation:     byOp,
        adapterType:     "git",
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _gitLog  = [];
    _counter = 0;
}

module.exports = {
    SAFE_READ_OPS, SAFE_WRITE_OPS, BLOCKED_OPS, COMMIT_DENY_PATTERNS,
    gitStatus, gitDiff, gitBranch, validateCommit, safeCheckout,
    getGitExecutionLog, getAdapterMetrics, reset,
};
