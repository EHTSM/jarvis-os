"use strict";
/**
 * Phase 649 — Terminal Execution Intelligence
 *
 * Command outcome analysis, runtime-state-aware execution, dependency-repair
 * prioritization, checkpoint awareness, failure-driven retry selection.
 * Bounded retries. Explainable. Operator-visible.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/terminal-exec-intel.json");
const MAX_HISTORY = 200;
const TTL_MS      = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 2;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { executions: [], checkpoints: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.executions  = (db.executions  || []).filter(e => e.ts > cutoff).slice(0, MAX_HISTORY);
    db.checkpoints = (db.checkpoints || []).slice(-50);
}

// ── Outcome signatures ────────────────────────────────────────────────────────

const OUTCOME_PATTERNS = [
    { id: "success",         pattern: /^0$|exited with code 0/i,                         label: "Success",              retryable: false, repairPath: null },
    { id: "enoent",          pattern: /enoent|command not found|no such file/i,           label: "Missing command/file", retryable: true,  repairPath: "dep-repair" },
    { id: "permission",      pattern: /eacces|permission denied|operation not permitted/i, label: "Permission denied",   retryable: false, repairPath: "permission-fix" },
    { id: "econnrefused",    pattern: /econnrefused|connection refused/i,                 label: "Connection refused",   retryable: true,  repairPath: "restart-server" },
    { id: "timeout",         pattern: /timeout|timed out|etimedout/i,                     label: "Timed out",            retryable: true,  repairPath: "performance-check" },
    { id: "syntax",          pattern: /syntaxerror|unexpected token/i,                    label: "Syntax error",         retryable: false, repairPath: "code-fix" },
    { id: "npm-error",       pattern: /npm err!|npm warn.*peer|missing peer/i,            label: "NPM error",            retryable: true,  repairPath: "dep-repair" },
    { id: "test-fail",       pattern: /fail|error|assertion.*error/i,                     label: "Test/assertion fail",  retryable: false, repairPath: "code-fix" },
    { id: "killed",          pattern: /killed|sigkill|sigterm/i,                          label: "Process killed",       retryable: true,  repairPath: "restart-server" },
];

function analyzeOutcome(output = "", exitCode = null) {
    const text = `${exitCode !== null ? `exit:${exitCode}` : ""} ${output}`.trim();

    if (exitCode === 0) return { id: "success", label: "Success", retryable: false, repairPath: null, confidence: 99 };

    const matches = OUTCOME_PATTERNS.filter(p => p.pattern.test(text)).filter(p => p.id !== "success");
    const primary = matches[0] || { id: "unknown", label: "Unknown failure", retryable: false, repairPath: "general-debug", confidence: 40 };

    return { ...primary, confidence: matches.length > 0 ? 78 : 40, alternatives: matches.slice(1, 2) };
}

// ── Command recording ─────────────────────────────────────────────────────────

function recordExecution(opts = {}) {
    const { command = "", output = "", exitCode = null, sessionId = null, retryCount = 0 } = opts;
    if (!command) return { ok: false, error: "command required" };

    const outcome = analyzeOutcome(output, exitCode);
    const db = _load(); _prune(db);

    db.executions.unshift({
        command:    command.slice(0, 200),
        output:     output.slice(0, 500),
        exitCode,
        outcome,
        sessionId,
        retryCount,
        ts:         Date.now(),
    });
    _save(db);

    return { ok: true, outcome, retryable: outcome.retryable && retryCount < MAX_RETRIES };
}

// ── Retry selection ───────────────────────────────────────────────────────────

function selectRetryStrategy(command = "", failureOutput = "", retryCount = 0) {
    if (retryCount >= MAX_RETRIES) return { ok: false, error: `Max retries (${MAX_RETRIES}) reached`, canRetry: false };

    const outcome = analyzeOutcome(failureOutput);
    const strategies = {
        "dep-repair":        { retry: command, pre: "npm install", reason: "Missing dep — reinstall first" },
        "restart-server":    { retry: command, pre: null,          reason: "Connection issue — retry after brief delay" },
        "performance-check": { retry: command, pre: null,          reason: "Timeout — retry with extended wait" },
        "general-debug":     { retry: command, pre: null,          reason: "Retry with same command" },
    };

    const strategy = strategies[outcome.repairPath || "general-debug"];
    return {
        ok:          true,
        canRetry:    outcome.retryable,
        retryCount:  retryCount + 1,
        maxRetries:  MAX_RETRIES,
        strategy:    strategy || { retry: command, pre: null, reason: "Retry" },
        outcome,
        explainer:   `Retry ${retryCount + 1}/${MAX_RETRIES}: ${strategy?.reason || "retry"} — failure: ${outcome.label}`,
    };
}

// ── Dependency repair prioritization ─────────────────────────────────────────

function prioritizeDependencyRepairs({ windowMs = 4 * 60 * 60 * 1000 } = {}) {
    const db     = _load(); _prune(db);
    const cutoff = Date.now() - windowMs;
    const depFails = db.executions.filter(e => e.ts > cutoff && ["enoent", "npm-error"].includes(e.outcome?.id));

    const commands = [...new Set(depFails.map(e => e.command))];
    const repairs = commands.map(cmd => ({
        command: cmd,
        failCount: depFails.filter(e => e.command === cmd).length,
        suggestedRepair: "npm install",
        approvalRequired: true,
    })).sort((a, b) => b.failCount - a.failCount);

    return { ok: true, repairs, count: repairs.length };
}

// ── Checkpoint awareness ──────────────────────────────────────────────────────

function saveCheckpoint(sessionId, label, { stepOrder = 0, state = {} } = {}) {
    if (!sessionId || !label) return { ok: false, error: "sessionId and label required" };
    const db = _load();
    db.checkpoints.push({ sessionId, label, stepOrder, state, ts: Date.now() });
    db.checkpoints = db.checkpoints.slice(-50);
    _save(db);
    return { ok: true, sessionId, label };
}

function getLastCheckpoint(sessionId) {
    const db = _load();
    const checkpoints = db.checkpoints.filter(c => c.sessionId === sessionId);
    return checkpoints.length > 0 ? { ok: true, ...checkpoints[checkpoints.length - 1] } : { ok: false, error: "No checkpoint" };
}

// ── Runtime-state-aware execution summary ────────────────────────────────────

function executionIntelSummary({ windowMs = 60 * 60 * 1000 } = {}) {
    const db     = _load(); _prune(db);
    const cutoff = Date.now() - windowMs;
    const recent = db.executions.filter(e => e.ts > cutoff);

    const byOutcome = {};
    recent.forEach(e => { byOutcome[e.outcome?.id || "unknown"] = (byOutcome[e.outcome?.id || "unknown"] || 0) + 1; });

    const failures  = recent.filter(e => e.outcome?.id !== "success").length;
    const successes = recent.length - failures;
    const topFail   = Object.entries(byOutcome).filter(([k]) => k !== "success").sort((a, b) => b[1] - a[1])[0];

    return {
        ok:        true,
        total:     recent.length,
        successes,
        failures,
        successRate: recent.length > 0 ? `${Math.round(successes / recent.length * 100)}%` : "no data",
        topFailure: topFail ? { id: topFail[0], count: topFail[1] } : null,
        byOutcome,
    };
}

module.exports = { analyzeOutcome, recordExecution, selectRetryStrategy, prioritizeDependencyRepairs, saveCheckpoint, getLastCheckpoint, executionIntelSummary };
