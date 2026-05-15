"use strict";
/**
 * repairOrchestrator — deterministic repair attempt ordering with verification loops.
 *
 * planRepairs(errorType, context?)
 *   → [{ repairId, strategy, confidence, estimatedMs }] ordered highest-confidence first
 *
 * executeRepair(plan, ctx, verifyFn, opts?)
 *   → { succeeded, repairId, strategy, attempts, durationMs, verifyResult }
 *   Tries each repair in plan order; stops at first that passes verifyFn.
 *
 * recordOutcome(errorType, repairId, success)   — update historical win rate
 * getStats(errorType)                           → success rates by repairId
 * reset()
 */

const memory = require("../failureMemory.cjs");
const pcl    = require("../patternCluster.cjs");

// Built-in repair strategies per error type
const REPAIR_CATALOG = {
    syntax_error:     ["syntax-add-brace", "syntax-remove-trailing-comma", "syntax-fix-semicolons"],
    type_error:       ["type-add-guard",   "type-coerce-value",            "type-check-null"],
    module_not_found: ["missing-create-stub", "missing-scan-alternatives", "missing-install-dep"],
    enoent:           ["missing-create-stub", "missing-create-dir"],
    timeout:          ["timeout-extend",   "timeout-retry-backoff"],
    econnrefused:     ["network-retry-backoff", "network-check-host"],
    reference_error:  ["type-add-guard",   "missing-create-stub"],
    oom:              ["memory-reduce-batch", "memory-force-gc"],
    generic_error:    ["unknown-log-and-wait"],
};

const DEFAULT_CONFIDENCE = 0.40;
const FALLBACK_STRATEGY  = "unknown-log-and-wait";

function _getStrategies(errorType) {
    return REPAIR_CATALOG[errorType] || REPAIR_CATALOG.generic_error;
}

function _strategyConfidence(errorType, strategy) {
    const snap = memory.snapshot();
    const data = snap?.[errorType]?.[strategy];
    if (!data || data.attempts < 2) return DEFAULT_CONFIDENCE;
    return parseFloat((data.successes / data.attempts).toFixed(3));
}

function planRepairs(errorType, context = {}) {
    const strategies = _getStrategies(errorType);

    const plan = strategies.map(strategy => ({
        repairId:    `${errorType}::${strategy}`,
        strategy,
        confidence:  _strategyConfidence(errorType, strategy),
        estimatedMs: 200,
    }));

    // Highest confidence first; break ties alphabetically for determinism
    plan.sort((a, b) =>
        b.confidence - a.confidence ||
        a.strategy.localeCompare(b.strategy)
    );

    return plan;
}

async function executeRepair(plan, ctx, verifyFn, opts = {}) {
    const maxAttempts = opts.maxAttempts ?? plan.length;
    const t0          = Date.now();

    for (let i = 0; i < Math.min(maxAttempts, plan.length); i++) {
        const { repairId, strategy } = plan[i];

        // Set repair context
        ctx._repairStrategy = strategy;
        ctx._repairAttempt  = i + 1;

        let verifyResult = null;
        try {
            verifyResult = await Promise.resolve(verifyFn(ctx, strategy));
        } catch (e) {
            verifyResult = { passed: false, error: e.message };
        }

        const passed = verifyResult?.passed ?? verifyResult === true;
        recordOutcome(repairId.split("::")[0], repairId, passed);

        if (passed) {
            return {
                succeeded:   true,
                repairId,
                strategy,
                attempts:    i + 1,
                durationMs:  Date.now() - t0,
                verifyResult,
            };
        }
    }

    return {
        succeeded:   false,
        repairId:    null,
        strategy:    null,
        attempts:    Math.min(maxAttempts, plan.length),
        durationMs:  Date.now() - t0,
        verifyResult: null,
    };
}

// In-memory win rate overlay (augments failureMemory)
const _stats = new Map();   // `${errorType}::${repairId}` → { attempts, successes }

function recordOutcome(errorType, repairId, success) {
    const key = `${errorType}::${repairId}`;
    if (!_stats.has(key)) _stats.set(key, { attempts: 0, successes: 0 });
    const s = _stats.get(key);
    s.attempts++;
    if (success) s.successes++;
    memory.recordOutcome(errorType, repairId, success);
}

function getStats(errorType) {
    const result = {};
    for (const [key, val] of _stats) {
        if (key.startsWith(`${errorType}::`)) {
            const repairId = key.slice(errorType.length + 2);
            result[repairId] = {
                ...val,
                successRate: val.attempts > 0
                    ? parseFloat((val.successes / val.attempts).toFixed(3))
                    : 0,
            };
        }
    }
    return result;
}

function reset() { _stats.clear(); }

module.exports = { planRepairs, executeRepair, recordOutcome, getStats, reset, REPAIR_CATALOG };
