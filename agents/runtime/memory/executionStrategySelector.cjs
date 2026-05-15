"use strict";
/**
 * executionStrategySelector — choose execution strategy from memory + context.
 *
 * STRATEGIES   — ['safe','fast','recovery_first','sandbox']
 *
 * select(context)  → strategy string
 *
 * context:
 *   sandboxRequired   boolean   — forces sandbox
 *   successRate       0–1|null  — null = unknown
 *   rollbackRate      0–1       — how often this fingerprint has rolled back
 *   depStability      0–1       — overall dependency stability
 *   complexity        0–1       — workflow complexity
 *   fingerprint       string    — for history look-up
 *   entries           array     — execution memory entries
 *
 * Selection rules (priority order):
 *   1. sandboxRequired              → sandbox
 *   2. rollbackRate > 0.3 OR successRate < 0.3   → recovery_first
 *   3. depStability < 0.6           → safe
 *   4. successRate ≥ 0.85 AND complexity < 0.5 AND rollbackRate < 0.1 → fast
 *   5. default                      → safe
 */

const STRATEGIES = ["safe", "fast", "recovery_first", "sandbox"];

function select(context = {}) {
    const {
        sandboxRequired = false,
        successRate     = null,
        rollbackRate    = 0,
        depStability    = 1.0,
        complexity      = 0,
    } = context;

    if (sandboxRequired) return "sandbox";

    if (rollbackRate > 0.3 || (successRate !== null && successRate < 0.3)) return "recovery_first";

    if (depStability < 0.6) return "safe";

    if (successRate !== null && successRate >= 0.85 && complexity < 0.5 && rollbackRate < 0.1) return "fast";

    return "safe";
}

module.exports = { select, STRATEGIES };
