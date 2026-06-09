"use strict";
/**
 * Phase 398 — Adapter Context Bridge
 *
 * Shares execution context safely across adapters (terminal, browser, VS Code, runtime).
 * Allows:
 *   - Failing file paths extracted from terminal logs → VS Code open target
 *   - Browser validation state linked to runtime PM2 state
 *   - Deployment readiness linked to git state
 *
 * Context is in-memory, bounded, and session-scoped.
 * No persistent state here — sessions are the persistence layer.
 * Each context entry has a 5-minute TTL to prevent stale bridging.
 */

const CONTEXT_TTL_MS = 5 * 60 * 1000;
const MAX_PER_TYPE   = 20;

// context store: type → [{ value, source, ts, sessionId? }]
const _store = new Map();

const CONTEXT_TYPES = [
    "failing-file",       // file path with errors (terminal → VS Code)
    "error-line",         // { file, line, message } (build errors)
    "git-state",          // { branch, dirty, ahead, conflicts }
    "runtime-health",     // { pm2Status, apiReachable, heapMb }
    "browser-state",      // { url, httpStatus, reachable }
    "last-error",         // raw error string from last failed command
    "dependency-issues",  // list of missing/broken deps
    "build-output",       // last build stdout (truncated)
];

function _clean(type) {
    const now  = Date.now();
    const list = _store.get(type) || [];
    const live = list.filter(e => now - e.ts < CONTEXT_TTL_MS);
    _store.set(type, live.slice(0, MAX_PER_TYPE));
    return live;
}

/**
 * Set context of a given type.
 * @param {string} type     — one of CONTEXT_TYPES
 * @param {*}      value    — context payload
 * @param {string} source   — adapter that produced this: "terminal"|"browser"|"vscode"|"runtime"
 * @param {string} [sessionId]
 */
function set(type, value, source, sessionId) {
    if (!CONTEXT_TYPES.includes(type)) return;
    const list = _clean(type);
    list.unshift({ value, source, ts: Date.now(), sessionId });
    _store.set(type, list.slice(0, MAX_PER_TYPE));
}

/**
 * Get the most recent context entry of a given type.
 * @param {string} type
 * @param {string} [sessionId] — if provided, prefer entries from this session
 * @returns {*} value or null
 */
function get(type, sessionId) {
    const list = _clean(type);
    if (!list.length) return null;
    if (sessionId) {
        const match = list.find(e => e.sessionId === sessionId);
        if (match) return match.value;
    }
    return list[0].value;
}

/** Get all recent entries for a type (up to limit). */
function getAll(type, limit = 5) {
    return _clean(type).slice(0, limit).map(e => ({ value: e.value, source: e.source, ts: e.ts }));
}

/**
 * Extract actionable context from terminal output.
 * Parses common error patterns and stores them in the bridge.
 * @param {string} output — terminal/build stdout
 * @param {string} source — adapter name
 * @param {string} [sessionId]
 * @returns {object} extracted context summary
 */
function extractFromOutput(output, source, sessionId) {
    if (!output) return {};
    const extracted = {};

    // File errors: "src/foo/bar.js:42:5: Error: ..." or "ERROR in ./src/..."
    const fileErrRe = /(?:ERROR in |error\s+)([./\w-]+\.(js|jsx|ts|tsx|cjs)):(\d+)/gi;
    let m;
    const failingFiles = [];
    while ((m = fileErrRe.exec(output)) !== null) {
        failingFiles.push({ file: m[1], line: parseInt(m[3]) });
    }
    if (failingFiles.length) {
        set("failing-file", failingFiles[0].file, source, sessionId);
        set("error-line",   failingFiles[0], source, sessionId);
        extracted.failingFiles = failingFiles.slice(0, 5);
    }

    // Build status
    if (/Compiled successfully/i.test(output)) {
        set("build-output", { status: "success", ts: Date.now() }, source, sessionId);
        extracted.buildSuccess = true;
    } else if (/Failed to compile/i.test(output)) {
        set("build-output", { status: "failed", ts: Date.now() }, source, sessionId);
        extracted.buildFailed = true;
    }

    // Dependency issues
    const unmetRe = /UNMET DEPENDENCY|UNMET PEER DEPENDENCY|missing:?\s+(\S+)/gi;
    const depIssues = [];
    while ((m = unmetRe.exec(output)) !== null) depIssues.push(m[1] || m[0]);
    if (depIssues.length) {
        set("dependency-issues", depIssues, source, sessionId);
        extracted.depIssues = depIssues.slice(0, 10);
    }

    // Last raw error
    const errLine = output.split("\n").find(l => /error:|failed|fatal/i.test(l) && l.length < 300);
    if (errLine) set("last-error", errLine.trim(), source, sessionId);

    return extracted;
}

/**
 * Build VS Code action suggestions from current bridge context.
 * Returns an array of actionable suggestions.
 */
function getVscodeActions(sessionId) {
    const actions = [];
    const failFile = get("failing-file", sessionId);
    const errLine  = get("error-line",   sessionId);
    if (failFile) {
        actions.push({
            type:    "open-file",
            label:   `Open failing file: ${failFile}`,
            cmd:     `code ${failFile}`,
            approvalLevel: "safe",
        });
    }
    if (errLine?.file && errLine?.line) {
        actions.push({
            type:    "jump-to-error",
            label:   `Jump to error: ${errLine.file}:${errLine.line}`,
            cmd:     `code -g ${errLine.file}:${errLine.line}`,
            approvalLevel: "safe",
        });
    }
    return actions;
}

/** Snapshot of all current context (for debugging / session summary). */
function snapshot(sessionId) {
    const result = {};
    for (const type of CONTEXT_TYPES) {
        const val = get(type, sessionId);
        if (val !== null) result[type] = val;
    }
    return result;
}

/** Clear all context for a session (called on session abandon). */
function clearSession(sessionId) {
    for (const type of CONTEXT_TYPES) {
        const list = _store.get(type) || [];
        _store.set(type, list.filter(e => e.sessionId !== sessionId));
    }
}

module.exports = { set, get, getAll, extractFromOutput, getVscodeActions, snapshot, clearSession, CONTEXT_TYPES };
