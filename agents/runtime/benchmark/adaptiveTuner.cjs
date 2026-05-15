"use strict";
/**
 * adaptiveTuner — benchmark-driven execution limit tuning.
 *
 * Stable workflows get relaxed retry budgets.
 * Unstable workflows get stricter execution limits.
 * Expensive workflows get optimization_priority flag.
 *
 * tune(name, metrics)      → { limits, priority, changes[], policy }
 * getLimits(name)          → current tuned limits (or DEFAULT_LIMITS)
 * applyAll(results[])      → tune all; returns [{name, policy, composite}]
 * getAll()                 → all tuning records
 * reset()
 */

const el = require("./executionLimits.cjs");

const DEFAULT_LIMITS  = { ...el.DEFAULT_LIMITS };
const STABLE_LIMITS   = { maxRetries: 8, maxDepth: 15, maxRepairLoops: 5, maxExecutionMs: 60_000 };
const STRICT_LIMITS   = { maxRetries: 2, maxDepth:  5, maxRepairLoops: 1, maxExecutionMs: 10_000 };
const STANDARD_LIMITS = { ...DEFAULT_LIMITS };

// Thresholds
const STABLE_SR    = 0.85;
const STABLE_FLIP  = 0.10;
const UNSTABLE_FLIP = 0.30;
const EXPENSIVE_MS  = 1000;

// name → { limits, priority, policy, ts }
const _tuning = new Map();

// ── tune ──────────────────────────────────────────────────────────────

function tune(name, metrics = {}) {
    const sr       = metrics.successRate ?? 0.5;
    const flip     = metrics.flipRate    ?? 0;
    const avgMs    = metrics.avgMs       ?? 0;
    const changes  = [];
    let   policy   = "standard";
    let   limits   = { ...STANDARD_LIMITS };
    let   priority = "normal";

    // Unstable: stricter limits
    if (flip > UNSTABLE_FLIP || sr < 0.40) {
        limits  = { ...STRICT_LIMITS };
        policy  = "strict";
        changes.push({
            reason: flip > UNSTABLE_FLIP
                ? `flipRate=${flip.toFixed(3)} exceeds instability threshold`
                : `successRate=${sr.toFixed(3)} below reliability threshold`,
            applied: "strict_limits",
        });
    }
    // Stable: relaxed limits
    else if (sr >= STABLE_SR && flip <= STABLE_FLIP) {
        limits  = { ...STABLE_LIMITS };
        policy  = "relaxed";
        changes.push({
            reason:  `successRate=${sr.toFixed(3)}, flipRate=${flip.toFixed(3)} — highly reliable`,
            applied: "relaxed_limits",
        });
    }

    // Expensive: optimization priority (on top of other policy)
    if (avgMs > EXPENSIVE_MS) {
        priority = "optimization";
        changes.push({
            reason:  `avgMs=${avgMs}ms exceeds cost threshold`,
            applied: "optimization_priority",
        });
    }

    // High-value deterministic: execution priority
    if (sr >= 0.95 && flip <= 0.05 && priority === "normal") {
        priority = "high";
        changes.push({ reason: "deterministic high-success", applied: "high_priority" });
    }

    const record = { name, limits, priority, policy, changes, ts: new Date().toISOString() };
    _tuning.set(name, record);
    return record;
}

// ── getLimits ─────────────────────────────────────────────────────────

function getLimits(name) {
    return _tuning.get(name)?.limits ?? { ...DEFAULT_LIMITS };
}

// ── applyAll ──────────────────────────────────────────────────────────

function applyAll(results = []) {
    return results.map(r => {
        const t = tune(r.name || "unnamed", r);
        return {
            name:      r.name      || "unnamed",
            policy:    t.policy,
            priority:  t.priority,
            composite: r.score?.composite ?? 0,
            changes:   t.changes,
        };
    });
}

// ── getAll ────────────────────────────────────────────────────────────

function getAll()  { return [..._tuning.values()]; }
function reset()   { _tuning.clear(); }

module.exports = {
    tune,
    getLimits,
    applyAll,
    getAll,
    reset,
    DEFAULT_LIMITS,
    STABLE_LIMITS,
    STRICT_LIMITS,
    STABLE_SR,
    UNSTABLE_FLIP,
    EXPENSIVE_MS,
};
