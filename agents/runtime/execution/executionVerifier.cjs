"use strict";
/**
 * executionVerifier — verify execution outcomes and detect partial/silent failures.
 *
 * Verification types:
 *   file_exists, file_modified, process_running, port_open,
 *   git_commit_exists, docker_container_alive, browser_navigation,
 *   vscode_workspace_opened
 *
 * verifyExecution(spec)                        → VerificationResult
 * verifyBatch(specs)                           → BatchResult
 * generateVerificationReport(execId)           → Report
 * getVerificationStats()                       → Stats
 * reset()
 */

const VERIFICATION_TYPES = [
    "file_exists",
    "file_modified",
    "process_running",
    "port_open",
    "git_commit_exists",
    "docker_container_alive",
    "browser_navigation",
    "vscode_workspace_opened",
];

const OUTCOMES = { PASSED: "passed", FAILED: "failed", PARTIAL: "partial", SKIPPED: "skipped", ERROR: "error" };

let _results = new Map();   // verificationId → result
let _counter = 0;

// ── verifyExecution ───────────────────────────────────────────────────

function verifyExecution(spec = {}) {
    const { execId, type, expected = {}, actual = {} } = spec;
    const verificationId = `vfy-${++_counter}`;

    if (!VERIFICATION_TYPES.includes(type)) {
        const r = { verificationId, execId: execId ?? null, type, outcome: OUTCOMES.ERROR,
                    reason: `unknown_verification_type: ${type}`, checks: [], passRate: 0,
                    ts: new Date().toISOString() };
        _results.set(verificationId, r);
        return r;
    }

    const checks = _runChecks(type, expected, actual);
    const passed = checks.filter(c => c.passed).length;
    const total  = checks.length;

    const outcome = total === 0          ? OUTCOMES.SKIPPED
                  : passed === total     ? OUTCOMES.PASSED
                  : passed > 0           ? OUTCOMES.PARTIAL
                  :                        OUTCOMES.FAILED;

    const result = {
        verificationId,
        execId:   execId ?? null,
        type,
        outcome,
        checks,
        passRate: total > 0 ? +(passed / total).toFixed(3) : 0,
        expected,
        actual,
        ts:       new Date().toISOString(),
    };

    _results.set(verificationId, result);
    return result;
}

// ── per-type check runners ────────────────────────────────────────────

function _runChecks(type, expected, actual) {
    switch (type) {
        case "file_exists":           return _checkFileExists(expected, actual);
        case "file_modified":         return _checkFileModified(expected, actual);
        case "process_running":       return _checkProcessRunning(expected, actual);
        case "port_open":             return _checkPortOpen(expected, actual);
        case "git_commit_exists":     return _checkGitCommit(expected, actual);
        case "docker_container_alive": return _checkDocker(expected, actual);
        case "browser_navigation":    return _checkBrowser(expected, actual);
        case "vscode_workspace_opened": return _checkVSCode(expected, actual);
        default:                      return [];
    }
}

function _checkFileExists(expected, actual) {
    const checks = [];
    if (expected.path != null)
        checks.push({ check: "file_exists", passed: actual.exists === true,
                      detail: actual.exists ? "file present" : "file missing" });
    if (expected.minSize != null && actual.size != null)
        checks.push({ check: "min_size_met", passed: actual.size >= expected.minSize,
                      detail: `size=${actual.size}, min=${expected.minSize}` });
    return checks;
}

function _checkFileModified(expected, actual) {
    const checks = [];
    if (expected.hashBefore != null && actual.hashAfter != null)
        checks.push({ check: "hash_changed", passed: expected.hashBefore !== actual.hashAfter,
                      detail: expected.hashBefore !== actual.hashAfter ? "hash differs" : "hash unchanged" });
    if (expected.sizeBefore != null && actual.sizeAfter != null)
        checks.push({ check: "size_changed", passed: expected.sizeBefore !== actual.sizeAfter,
                      detail: `${expected.sizeBefore} → ${actual.sizeAfter}` });
    if (actual.modifiedAt != null)
        checks.push({ check: "modified_recently", passed: true, detail: actual.modifiedAt });
    return checks;
}

function _checkProcessRunning(expected, actual) {
    const checks = [];
    if (expected.processName != null)
        checks.push({ check: "process_found", passed: actual.running === true,
                      detail: actual.pid != null ? `pid=${actual.pid}` : "not found" });
    if (expected.pid != null)
        checks.push({ check: "pid_matches", passed: actual.pid === expected.pid,
                      detail: `expected=${expected.pid}, actual=${actual.pid ?? "none"}` });
    return checks;
}

function _checkPortOpen(expected, actual) {
    const checks = [];
    if (expected.port != null)
        checks.push({ check: "port_listening", passed: actual.open === true,
                      detail: `port ${expected.port}` });
    if (expected.protocol != null && actual.protocol != null)
        checks.push({ check: "protocol_matches", passed: actual.protocol === expected.protocol,
                      detail: `expected=${expected.protocol}, actual=${actual.protocol}` });
    return checks;
}

function _checkGitCommit(expected, actual) {
    const checks = [];
    if (expected.commitHash != null)
        checks.push({ check: "commit_exists", passed: actual.found === true,
                      detail: expected.commitHash.slice(0, 8) });
    if (expected.branch != null && actual.branch != null)
        checks.push({ check: "on_correct_branch", passed: actual.branch === expected.branch,
                      detail: actual.branch });
    if (expected.message != null && actual.message != null)
        checks.push({ check: "message_contains", passed: actual.message.includes(expected.message),
                      detail: actual.message.slice(0, 60) });
    return checks;
}

function _checkDocker(expected, actual) {
    const checks = [];
    if (expected.containerName != null)
        checks.push({ check: "container_running", passed: actual.running === true,
                      detail: expected.containerName });
    if (expected.port != null)
        checks.push({ check: "port_bound", passed: actual.portBound === true,
                      detail: `port ${expected.port}` });
    if (expected.healthCheck != null)
        checks.push({ check: "health_check_passed", passed: actual.healthy === true,
                      detail: actual.healthy ? "healthy" : "unhealthy" });
    return checks;
}

function _checkBrowser(expected, actual) {
    const checks = [];
    if (expected.url != null) {
        const matches = actual.currentUrl != null && actual.currentUrl.includes(expected.url);
        checks.push({ check: "url_matches", passed: matches,
                      detail: actual.currentUrl ?? "no url" });
    }
    if (expected.titleContains != null && actual.title != null)
        checks.push({ check: "title_contains", passed: actual.title.includes(expected.titleContains),
                      detail: actual.title });
    if (expected.elementSelector != null)
        checks.push({ check: "element_present", passed: actual.elementFound === true,
                      detail: expected.elementSelector });
    return checks;
}

function _checkVSCode(expected, actual) {
    const checks = [];
    if (expected.workspacePath != null)
        checks.push({ check: "workspace_opened", passed: actual.opened === true,
                      detail: expected.workspacePath });
    if (expected.fileOpen != null)
        checks.push({ check: "file_open_in_editor", passed: actual.fileOpen === true,
                      detail: String(expected.fileOpen) });
    return checks;
}

// ── verifyBatch ───────────────────────────────────────────────────────

function verifyBatch(specs = []) {
    const results = specs.map(spec => verifyExecution(spec));
    const passed  = results.filter(r => r.outcome === OUTCOMES.PASSED).length;
    const failed  = results.filter(r => r.outcome === OUTCOMES.FAILED).length;
    const partial = results.filter(r => r.outcome === OUTCOMES.PARTIAL).length;

    return {
        batchSize: results.length,
        passed,
        failed,
        partial,
        skipped:   results.filter(r => r.outcome === OUTCOMES.SKIPPED).length,
        errors:    results.filter(r => r.outcome === OUTCOMES.ERROR).length,
        passRate:  results.length > 0 ? +(passed / results.length).toFixed(3) : 0,
        results,
    };
}

// ── generateVerificationReport ────────────────────────────────────────

function generateVerificationReport(execId) {
    const relevant = [..._results.values()].filter(v => v.execId === execId);
    if (relevant.length === 0) return { execId, found: false, verifications: [] };

    const passed = relevant.filter(v => v.outcome === OUTCOMES.PASSED).length;
    const failed = relevant.filter(v => v.outcome !== OUTCOMES.PASSED && v.outcome !== OUTCOMES.SKIPPED).length;
    const overall = failed > 0 ? (passed > 0 ? "partial" : "failed") : "passed";

    return {
        execId,
        found:         true,
        verifications: relevant,
        total:         relevant.length,
        passed,
        failed,
        overall,
        passRate:      relevant.length > 0 ? +(passed / relevant.length).toFixed(3) : 0,
        generatedAt:   new Date().toISOString(),
    };
}

// ── getVerificationStats ──────────────────────────────────────────────

function getVerificationStats() {
    const all      = [..._results.values()];
    const byOutcome = {};
    for (const v of all) byOutcome[v.outcome] = (byOutcome[v.outcome] ?? 0) + 1;
    const passed = all.filter(v => v.outcome === OUTCOMES.PASSED).length;
    return {
        total:    all.length,
        byOutcome,
        passRate: all.length > 0 ? +(passed / all.length).toFixed(3) : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _results = new Map();
    _counter = 0;
}

module.exports = {
    VERIFICATION_TYPES, OUTCOMES,
    verifyExecution, verifyBatch,
    generateVerificationReport, getVerificationStats,
    reset,
};
