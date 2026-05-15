"use strict";
/**
 * recoveryEngine — adaptive failure recovery for autonomous workflows.
 *
 * Responsibilities:
 *   classifyFailure   — map any Error to one of 8 failure types with confidence
 *   getStrategies     — return sorted recovery strategies, confidence blended with memory
 *   attemptRecovery   — execute the best available strategy, record outcome
 *   shouldGiveUp      — intelligent stop: prevents infinite retry loops
 *   computeHealthScore — 0–100 score for a completed/failed workflow result
 *
 * Integrates with failureMemory.cjs to continuously adjust strategy confidence
 * from observed success rates.
 */

const memory  = require("./failureMemory.cjs");
const logger  = require("../../backend/utils/logger");
// Lazy-load costModel to avoid circular deps at module evaluation time
let _costModel;
function _getCostModel() {
    if (!_costModel) _costModel = require("./costModel.cjs");
    return _costModel;
}

// ── Failure type constants ────────────────────────────────────────────

const F = Object.freeze({
    SYNTAX:          "syntax",
    DEPENDENCY:      "dependency",
    TIMEOUT:         "timeout",
    PERMISSION:      "permission",
    MISSING_FILE:    "missing_file",
    PROCESS_FAILURE: "process_failure",
    NETWORK:         "network",
    PORT_CONFLICT:   "port_conflict",
    UNKNOWN:         "unknown",
});

// ── Failure classifier ────────────────────────────────────────────────

function classifyFailure(error, context = {}) {
    const msg  = (error?.message || String(error)).toLowerCase();
    const code = error?.code  || "";
    const name = error?.name  || "";

    // Port conflict — check before PERMISSION since EADDRINUSE can look similar
    if (code === "EADDRINUSE" || /address already in use|eaddrinuse|port.*in use|port.*taken/i.test(msg))
        return { type: F.PORT_CONFLICT, confidence: 0.95, msg };

    // Syntax
    if (name === "SyntaxError" || /syntaxerror|unexpected token|unexpected end of input|missing [)}\]]/i.test(msg))
        return { type: F.SYNTAX, confidence: 0.95, msg };

    // Dependency / module resolution
    if (code === "MODULE_NOT_FOUND" || /cannot find module|failed to resolve|is not installed|module.*not found/i.test(msg))
        return { type: F.DEPENDENCY, confidence: 0.92, msg };

    // Permission
    if (["EACCES", "EPERM"].includes(code) || /permission denied|access denied|operation not permitted/i.test(msg))
        return { type: F.PERMISSION, confidence: 0.93, msg };

    // Missing file
    if (code === "ENOENT" || /no such file|enoent|file not found|does not exist/i.test(msg))
        return { type: F.MISSING_FILE, confidence: 0.92, msg };

    // Network — check before Timeout (ETIMEDOUT overlaps)
    if (["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ENETUNREACH", "EHOSTUNREACH"].includes(code)
        || /connection refused|network error|fetch failed|socket hang up|dns lookup failed|econnrefused/i.test(msg))
        return { type: F.NETWORK, confidence: 0.88, msg };

    // Timeout
    if (code === "ETIMEDOUT" || /timeout|timed out|exceeded.*time limit|operation.*timed/i.test(msg))
        return { type: F.TIMEOUT, confidence: 0.90, msg };

    // Process failure
    if (/exit code [^0]|non-zero exit|process.*failed|spawn.*error|exited with [^0]/i.test(msg))
        return { type: F.PROCESS_FAILURE, confidence: 0.82, msg };

    return { type: F.UNKNOWN, confidence: 0.40, msg };
}

// ── Strategy catalog ──────────────────────────────────────────────────
//
// Each strategy:
//   id          — unique identifier (used in memory keys)
//   desc        — human-readable description
//   confidence  — prior probability of success (0–1)
//   action      — async (ctx, classification, attempt) → void (throws on failure)

const STRATEGIES = {

    [F.SYNTAX]: [
        {
            id: "syntax-add-brace",
            desc: "append missing closing braces",
            confidence: 0.72,
            action: async (ctx) => {
                const file = ctx._lastFile;
                if (!file) throw new Error("no _lastFile in ctx");
                const { readFileSync, writeFileSync } = require("fs");
                const src    = readFileSync(file, "utf8");
                const opens  = (src.match(/\{/g) || []).length;
                const closes = (src.match(/\}/g) || []).length;
                if (opens <= closes) throw new Error("brace counts balanced — different syntax issue");
                writeFileSync(file, src + "\n" + "}".repeat(opens - closes), "utf8");
            },
        },
        {
            id: "syntax-fix-semicolons",
            desc: "append missing semicolons to statement-like lines",
            confidence: 0.50,
            action: async (ctx) => {
                const file = ctx._lastFile;
                if (!file) throw new Error("no _lastFile in ctx");
                const { readFileSync, writeFileSync } = require("fs");
                const src   = readFileSync(file, "utf8");
                // Lines that look like statements but are missing terminator
                const fixed = src.replace(
                    /^([ \t]*(?:return|throw|const |let |var )[^{;\n]+[^{;,\n])\s*$/gim,
                    "$1;"
                );
                if (fixed === src) throw new Error("no semicolon insertions made");
                writeFileSync(file, fixed, "utf8");
            },
        },
        {
            id: "syntax-remove-trailing-comma",
            desc: "remove trailing commas before closing brackets",
            confidence: 0.55,
            action: async (ctx) => {
                const file = ctx._lastFile;
                if (!file) throw new Error("no _lastFile in ctx");
                const { readFileSync, writeFileSync } = require("fs");
                const src   = readFileSync(file, "utf8");
                const fixed = src.replace(/,(\s*[}\]])/g, "$1");
                if (fixed === src) throw new Error("no trailing commas found");
                writeFileSync(file, fixed, "utf8");
            },
        },
    ],

    [F.DEPENDENCY]: [
        {
            id: "dep-npm-install",
            desc: "run npm install to restore all dependencies",
            confidence: 0.80,
            action: async (ctx) => {
                const { spawnSync } = require("child_process");
                const cwd = ctx._projectPath || process.cwd();
                const r = spawnSync("npm", ["install"], { cwd, encoding: "utf8", timeout: 60_000 });
                if (r.status !== 0) throw new Error(`npm install failed: ${(r.stderr || r.stdout || "").slice(0, 200)}`);
            },
        },
        {
            id: "dep-extract-and-install",
            desc: "extract missing package name from error and install it",
            confidence: 0.68,
            action: async (ctx, cl) => {
                const match = cl.msg.match(/cannot find module ['"]([^'"]+)['"]/i);
                if (!match) throw new Error("cannot extract package name from error message");
                let pkg = match[1];
                // Keep scoped packages whole (@scope/name), strip subpath from unscoped
                if (!pkg.startsWith("@")) pkg = pkg.split("/")[0];
                if (pkg.startsWith(".") || pkg.startsWith("/")) throw new Error("relative/absolute path — not an npm package");
                const { spawnSync } = require("child_process");
                const cwd = ctx._projectPath || process.cwd();
                const r = spawnSync("npm", ["install", "--save", pkg], { cwd, encoding: "utf8", timeout: 60_000 });
                if (r.status !== 0) throw new Error(`npm install ${pkg} failed: ${(r.stderr || "").slice(0, 200)}`);
                ctx._installedPackage = pkg;
            },
        },
    ],

    [F.TIMEOUT]: [
        {
            id: "timeout-exponential-wait",
            desc: "exponential backoff wait then allow retry",
            confidence: 0.65,
            action: async (ctx, cl, attempt) => {
                const ms = Math.min(500 * (2 ** (attempt || 0)), 8_000);
                await new Promise(r => setTimeout(r, ms).unref());
            },
        },
        {
            id: "timeout-increase-limit",
            desc: "double timeout threshold stored in context",
            confidence: 0.50,
            action: async (ctx) => {
                ctx._timeoutMs = (ctx._timeoutMs || 5_000) * 2;
            },
        },
    ],

    [F.PERMISSION]: [
        {
            id: "perm-chmod-file",
            desc: "chmod 644 the target file",
            confidence: 0.65,
            action: async (ctx) => {
                const file = ctx._lastFile;
                if (!file) throw new Error("no _lastFile in ctx");
                require("fs").chmodSync(file, 0o644);
            },
        },
        {
            id: "perm-use-tmpdir",
            desc: "redirect output path to /tmp",
            confidence: 0.45,
            action: async (ctx) => {
                ctx._outputPath = require("path").join(require("os").tmpdir(), `jarvis-out-${Date.now()}`);
            },
        },
    ],

    [F.MISSING_FILE]: [
        {
            id: "missing-create-stub",
            desc: "create missing file as empty CommonJS stub",
            confidence: 0.70,
            action: async (ctx, cl) => {
                // Try to extract a file path from the error message
                const match = cl.msg.match(/(?:enoent|no such file)[^'"\n]*['"]([^'"]+)['"]/i)
                    || cl.msg.match(/['"]([^'"]+\.(js|cjs|mjs|json|ts))['"]/i);
                if (!match) throw new Error("cannot extract file path from error message");
                const file = match[1];
                if (file.startsWith("http") || file.includes("node_modules")) {
                    throw new Error("path points to external resource — not creating");
                }
                const { mkdirSync, writeFileSync, existsSync } = require("fs");
                const dir = require("path").dirname(file);
                if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
                if (!existsSync(file)) writeFileSync(file, '"use strict";\nmodule.exports = {};\n', "utf8");
                ctx._createdFile = file;
            },
        },
        {
            id: "missing-scan-alternatives",
            desc: "scan project for similarly-named alternative files",
            confidence: 0.48,
            action: async (ctx, cl) => {
                const match = cl.msg.match(/['"]([^'"]+)['"]/);
                if (!match) throw new Error("cannot extract path from error message");
                const wanted = require("path").basename(match[1]).toLowerCase().replace(/\.[^.]+$/, "");
                if (!wanted || wanted.length < 2) throw new Error("name too short to scan for");
                const cwd    = ctx._projectPath || process.cwd();
                const { spawnSync } = require("child_process");
                const r = spawnSync("find", [".", "-name", `*${wanted}*`, "-maxdepth", "4"], {
                    cwd, encoding: "utf8", timeout: 5_000,
                });
                const found = (r.stdout || "").trim().split("\n").filter(Boolean);
                ctx._alternativeFiles = found;
                if (found.length === 0) throw new Error("no alternative files found");
            },
        },
    ],

    [F.PROCESS_FAILURE]: [
        {
            id: "proc-flag-restart",
            desc: "flag process for restart on next iteration",
            confidence: 0.58,
            action: async (ctx) => { ctx._processRestart = true; },
        },
        {
            id: "proc-check-exit-code",
            desc: "surface exit code for diagnosis",
            confidence: 0.42,
            action: async (ctx, cl) => {
                const match = cl.msg.match(/exit code (\d+)/i);
                const code  = match ? parseInt(match[1]) : -1;
                ctx._lastExitCode = code;
                if (code === 127) throw new Error("exit 127: command not found (dependency issue)");
                if (code === 126) throw new Error("exit 126: not executable (permission issue)");
            },
        },
    ],

    [F.NETWORK]: [
        {
            id: "network-wait-retry",
            desc: "wait 2 s for transient network issue to resolve",
            confidence: 0.70,
            action: async () => {
                await new Promise(r => setTimeout(r, 2_000).unref());
            },
        },
        {
            id: "network-offline-mode",
            desc: "set offline flag so steps can skip network calls",
            confidence: 0.48,
            action: async (ctx) => { ctx._offlineMode = true; },
        },
    ],

    [F.PORT_CONFLICT]: [
        {
            id: "port-find-free",
            desc: "scan for a free port and write it to ctx._port",
            confidence: 0.85,
            action: async (ctx, cl) => {
                const m    = cl.msg.match(/port (\d+)/i) || cl.msg.match(/:(\d{4,5})/);
                const base = m ? parseInt(m[1]) : 3000;
                const net  = require("net");
                const port = await new Promise((resolve, reject) => {
                    let p = base + 1;
                    const tryNext = () => {
                        if (p > base + 100) return reject(new Error("no free port in range"));
                        const s = net.createServer();
                        s.once("error", () => { p++; tryNext(); });
                        s.once("listening", () => s.close(() => resolve(p)));
                        s.listen(p, "127.0.0.1");
                    };
                    tryNext();
                });
                ctx._port = port;
            },
        },
        {
            id: "port-kill-occupant",
            desc: "identify and kill process occupying the port",
            confidence: 0.52,
            action: async (ctx, cl) => {
                const m = cl.msg.match(/port (\d+)/i) || cl.msg.match(/:(\d{4,5})/);
                if (!m) throw new Error("cannot extract port from error message");
                const port = parseInt(m[1]);
                const { spawnSync } = require("child_process");
                const lsof = spawnSync("lsof", ["-ti", `:${port}`], { encoding: "utf8", timeout: 3_000 });
                const pid  = (lsof.stdout || "").trim();
                if (!pid) throw new Error(`no process found on port ${port}`);
                const kill = spawnSync("kill", ["-9", pid], { encoding: "utf8", timeout: 3_000 });
                if (kill.status !== 0) throw new Error(`kill ${pid} failed`);
                ctx._killedPid = parseInt(pid);
            },
        },
    ],

    [F.UNKNOWN]: [
        {
            id: "unknown-log-and-wait",
            desc: "log failure details and wait 1 s before retry",
            confidence: 0.28,
            action: async (ctx) => {
                ctx._unknownErrors = (ctx._unknownErrors || 0) + 1;
                await new Promise(r => setTimeout(r, 1_000).unref());
            },
        },
    ],
};

// ── Confidence blending ───────────────────────────────────────────────
// When enough historical data exists, blend prior confidence with observed
// success rate. More samples → more weight to history (capped at 70%).

function _adjustedConfidence(baseConf, failureType, strategyId) {
    const rate = memory.getSuccessRate(failureType, strategyId); // null if < 3 samples
    const n    = memory.getAttemptCount(failureType, strategyId);
    if (rate === null) return baseConf;
    const histWeight = Math.min(n / 20, 0.70);
    return baseConf * (1 - histWeight) + rate * histWeight;
}

// ── Strategy selection ────────────────────────────────────────────────

/**
 * Returns available strategies for a classification, sorted by effective
 * confidence (highest first), excluding already-used strategy IDs.
 */
function getStrategies(classification, usedIds = []) {
    const catalog = STRATEGIES[classification.type] || STRATEGIES[F.UNKNOWN];
    return catalog
        .filter(s => !usedIds.includes(s.id))
        .map(s => ({
            ...s,
            effectiveConfidence: _adjustedConfidence(s.confidence, classification.type, s.id),
        }))
        .sort((a, b) => b.effectiveConfidence - a.effectiveConfidence);
}

// ── Intelligent stop ──────────────────────────────────────────────────

const MAX_RECOVERY_ATTEMPTS  = 6;
const MIN_CONFIDENCE_THRESHOLD = 0.15;

/**
 * Decides whether to abandon recovery for the current step.
 * Returns { stop: boolean, reason?: string }.
 */
function shouldGiveUp(opts = {}) {
    const { totalAttempts = 0, usedStrategies = [], classification = {}, consecutiveFails = 0 } = opts;

    if (totalAttempts >= MAX_RECOVERY_ATTEMPTS)
        return { stop: true,  reason: "max_attempts_reached" };

    if (consecutiveFails >= 3)
        return { stop: true,  reason: "three_consecutive_recovery_failures" };

    const remaining = getStrategies({ type: classification.type || F.UNKNOWN }, usedStrategies);

    if (remaining.length === 0)
        return { stop: true,  reason: "no_strategies_remaining" };

    if (remaining[0].effectiveConfidence < MIN_CONFIDENCE_THRESHOLD)
        return { stop: true,  reason: "confidence_below_threshold" };

    return { stop: false };
}

// ── Core recovery attempt ─────────────────────────────────────────────

/**
 * Classifies the error, picks the highest-confidence untried strategy,
 * executes it, records the outcome in failureMemory, and returns a
 * structured result.
 *
 * @param {Error}  error
 * @param {object} ctx              — shared workflow context (may be mutated by strategy)
 * @param {{ stepName, usedStrategies, attempt }} opts
 * @returns {Promise<RecoveryResult>}
 */
async function attemptRecovery(error, ctx, opts = {}) {
    const { stepName = "unknown", usedStrategies = [], attempt = 1 } = opts;
    const cl = classifyFailure(error, ctx);

    logger.info(
        `[Recovery] "${stepName}" — type=${cl.type} conf=${cl.confidence.toFixed(2)} msg="${cl.msg.slice(0, 80)}"`
    );

    // Cost-rank: sort by expected value (confidence × (1−risk) / normalizedCost)
    const rawStrategies = getStrategies(cl, usedStrategies);
    const strategies    = _getCostModel().rankByCost(rawStrategies);
    if (strategies.length === 0) {
        logger.warn(`[Recovery] "${stepName}" — no strategies available for ${cl.type}`);
        return { recovered: false, reason: "no_strategies_available", classification: cl, strategyId: null };
    }

    const strategy = strategies[0];
    const evStr    = strategy.expectedValue != null ? ` ev=${strategy.expectedValue.toFixed(3)}` : "";
    logger.info(`[Recovery] "${stepName}" — trying "${strategy.id}" (conf=${strategy.effectiveConfidence.toFixed(2)}${evStr})`);

    const t0 = Date.now();
    try {
        await strategy.action(ctx, cl, attempt);
        const ms = Date.now() - t0;
        memory.recordOutcome(cl.type, strategy.id, true);
        logger.info(`[Recovery] "${stepName}" — "${strategy.id}" SUCCEEDED (${ms}ms)`);
        return {
            recovered:         true,
            strategyId:        strategy.id,
            strategyDesc:      strategy.desc,
            classification:    cl,
            durationMs:        ms,
            confidence:        strategy.effectiveConfidence,
        };
    } catch (recovErr) {
        const ms = Date.now() - t0;
        memory.recordOutcome(cl.type, strategy.id, false);
        logger.warn(`[Recovery] "${stepName}" — "${strategy.id}" FAILED: ${recovErr.message} (${ms}ms)`);
        return {
            recovered:      false,
            strategyId:     strategy.id,
            reason:         recovErr.message,
            classification: cl,
            durationMs:     ms,
            confidence:     strategy.effectiveConfidence,
        };
    }
}

// ── Workflow health scoring ───────────────────────────────────────────

/**
 * Produces a 0–100 health score for a workflow result.
 *
 * Scoring:
 *   +50  base completion score (proportional to steps completed)
 *   +40  clean-run base (always added, then penalties subtract from it)
 *   +10  bonus for zero failures and zero skips
 *   -15  per failed step  (capped at -30)
 *   -20  max penalty for excess retries
 */
function computeHealthScore(workflowResult) {
    if (!workflowResult) return 0;
    const steps = workflowResult.stepDetails || [];
    if (steps.length === 0) return 100;

    const total       = steps.length;
    const completed   = steps.filter(s => s.status === "completed").length;
    const failed      = steps.filter(s => s.status === "failed").length;
    const skipped     = steps.filter(s => s.status === "skipped").length;
    const totalAttempts = steps.reduce((sum, s) => sum + (s.attempts || 1), 0);

    const completionScore = (completed / total) * 50;
    const failPenalty     = Math.min(failed * 15, 30);
    const retryPenalty    = Math.min(((totalAttempts - total) / total) * 20, 20);
    const cleanBonus      = (failed === 0 && skipped === 0) ? 10 : 0;

    return Math.round(Math.min(100, Math.max(0, 40 + completionScore - failPenalty - retryPenalty + cleanBonus)));
}

// ── Verified outcome recording ────────────────────────────────────────

/**
 * Record a verified recovery outcome — called when the step itself succeeds
 * AFTER a recovery was applied. Counts double-weight because step success
 * is independent proof the fix worked, not just that the patch ran.
 *
 * @param {string}  failureType
 * @param {string}  strategyId
 * @param {boolean} success
 */
function recordVerifiedOutcome(failureType, strategyId, success) {
    if (!failureType || !strategyId) return;
    memory.recordOutcome(failureType, strategyId, success);  // primary record
    memory.recordOutcome(failureType, strategyId, success);  // verification bonus (2× weight)
}

// ── Exports ───────────────────────────────────────────────────────────

module.exports = {
    F,
    FAILURE_TYPES: F,
    classifyFailure,
    getStrategies,
    attemptRecovery,
    shouldGiveUp,
    computeHealthScore,
    recordVerifiedOutcome,
    MAX_RECOVERY_ATTEMPTS,
    MIN_CONFIDENCE_THRESHOLD,
};
