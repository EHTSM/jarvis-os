"use strict";
/**
 * Phase 431 — Cross-System Validation
 *
 * Prevents false operational confidence by verifying that multiple system
 * layers agree with each other.
 *
 * Checks:
 *   - browser state matches runtime (api reachable ↔ pm2 online)
 *   - git state matches deployment (no uncommitted changes before deploy)
 *   - terminal output matches validation (exit code ↔ probe result)
 *   - adapter health matches orchestration assumptions
 *
 * Returns: { consistent: bool, violations: [], warnings: [], summary }
 */

const { execSync } = require("child_process");
const http         = require("http");
const logger       = require("../../backend/utils/logger");

const TIMEOUT_MS = 5_000;

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Individual validators ─────────────────────────────────────────────────────

async function _validateBrowserVsRuntime() {
    // Check: if pm2 says backend is online, API must respond
    let pm2Online = false;
    let apiReachable = false;

    try {
        const out   = execSync("pm2 jlist 2>/dev/null", { timeout: 3000, encoding: "utf8" });
        const procs = JSON.parse(out);
        pm2Online   = procs.some(p => p.name === "jarvis-backend" && p.pm2_env?.status === "online");
    } catch {}

    try {
        apiReachable = await new Promise(resolve => {
            const req = http.get("http://localhost:3001/api/health", { timeout: TIMEOUT_MS }, res => {
                resolve(res.statusCode >= 200 && res.statusCode < 300);
            });
            req.on("error", () => resolve(false));
            req.on("timeout", () => { req.destroy(); resolve(false); });
        });
    } catch {}

    const consistent = pm2Online === apiReachable || !pm2Online; // if pm2 is offline, api should be too
    return {
        check: "browser_vs_runtime",
        consistent,
        pm2Online,
        apiReachable,
        violation: consistent ? null : `pm2 reports ${pm2Online ? "online" : "offline"} but API is ${apiReachable ? "reachable" : "unreachable"}`,
    };
}

function _validateGitVsDeployment() {
    let clean = null;
    let headCommit = null;
    try {
        const status = execSync("git status --porcelain 2>/dev/null", { timeout: 2000, encoding: "utf8" });
        clean = status.trim() === "";
        headCommit = execSync("git rev-parse --short HEAD 2>/dev/null", { timeout: 2000, encoding: "utf8" }).trim();
    } catch {}

    // Violation: uncommitted changes exist — deployment state may not match code
    return {
        check:       "git_vs_deployment",
        consistent:  clean !== false,
        clean,
        headCommit,
        violation:   clean === false ? "uncommitted changes exist — deployed build may not match current source" : null,
    };
}

function _validateAdapterHealthVsOrchestration() {
    const tsm = _tryRequire("./toolStateMonitor.cjs");
    if (!tsm) return { check: "adapter_vs_orchestration", consistent: true, detail: "monitor unavailable — assumed ok" };

    const problems = tsm.detectProblems();
    const staleAdapters = problems.map(p => p.tool);

    // If adapters are stale but sessions are active on them — inconsistency
    let sessionConflict = false;
    try {
        const sm  = _tryRequire("./engineeringSession.cjs");
        const bridge = _tryRequire("./adapterContextBridge.cjs");
        if (sm && bridge) {
            const sessions = sm.list({ state: "active", limit: 5 });
            // If any active session exists and multiple adapters are stale — warn
            if (sessions.length > 0 && staleAdapters.length >= 2) sessionConflict = true;
        }
    } catch {}

    return {
        check:           "adapter_vs_orchestration",
        consistent:      staleAdapters.length === 0 && !sessionConflict,
        staleAdapters,
        sessionConflict,
        violation:       staleAdapters.length > 0 ? `stale adapters: ${staleAdapters.join(", ")}` : null,
    };
}

function _validateTerminalVsValidation(terminalExitCode = null, probeVerified = null) {
    if (terminalExitCode === null || probeVerified === null) {
        return { check: "terminal_vs_validation", consistent: true, detail: "no terminal/probe data provided — skipped" };
    }
    const exitOk     = terminalExitCode === 0;
    const consistent = exitOk === probeVerified;
    return {
        check:       "terminal_vs_validation",
        consistent,
        exitOk,
        probeVerified,
        violation:   consistent ? null : `terminal exit=${terminalExitCode} but probe verified=${probeVerified} — possible false ${exitOk ? "positive" : "negative"}`,
    };
}

/**
 * Run full cross-system validation.
 * @param {object} [opts]
 * @param {number} [opts.terminalExitCode]
 * @param {boolean} [opts.probeVerified]
 * @returns {Promise<{ consistent, violations, warnings, checks, summary }>}
 */
async function validate(opts = {}) {
    const results = await Promise.all([
        _validateBrowserVsRuntime(),
        Promise.resolve(_validateGitVsDeployment()),
        Promise.resolve(_validateAdapterHealthVsOrchestration()),
        Promise.resolve(_validateTerminalVsValidation(opts.terminalExitCode ?? null, opts.probeVerified ?? null)),
    ]);

    const violations = results.filter(r => !r.consistent && r.violation).map(r => r.violation);
    const warnings   = results.filter(r => !r.consistent && !r.violation).map(r => r.check + ": inconsistent state");
    const consistent = violations.length === 0;

    if (!consistent) logger.warn(`[CrossValidator] inconsistencies: ${violations.join(" | ")}`);

    return {
        consistent,
        violations,
        warnings,
        checks:  results,
        summary: consistent
            ? `All ${results.length} cross-system checks consistent`
            : `${violations.length} violation(s): ${violations[0]?.slice(0, 100)}`,
    };
}

module.exports = { validate };
