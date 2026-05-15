"use strict";
/**
 * strategySelector — deterministically choose execution strategy.
 *
 * select(plan, feasibilityResult, simResult?)
 *   → { strategy, reason, params }
 *
 * Priority order (first match wins):
 *   rollback_first → sandbox → dry_run → staged → direct
 */

const STRATEGIES = ["rollback_first", "sandbox", "dry_run", "staged", "direct"];

function select(plan = {}, feasibility = {}, simResult = {}) {
    const confidence  = feasibility.confidence          ?? 0;
    const rollbackP   = feasibility.rollbackProbability ?? 0;
    const blockers    = simResult.blockers?.length       ?? 0;
    const hasUnsafe   = (simResult.issues ?? []).some(i => i.type === "unsafe_command");
    const hasPortConf = (simResult.issues ?? []).some(i => i.type === "port_conflict");
    const hasNoTool   = (simResult.issues ?? []).some(i => i.type === "unavailable_tool");

    const hasDeployStep = (plan.steps ?? []).some(s =>
        (s.tags ?? []).includes("deploy") ||
        s.id?.includes("deploy") ||
        s.name?.toLowerCase().includes("deploy")
    );

    // Rule 1: rollback_first — deploy steps present with meaningful rollback risk
    if (hasDeployStep && rollbackP >= 0.15) {
        return {
            strategy: "rollback_first",
            reason:   `deploy step present, rollbackProbability=${rollbackP.toFixed(2)}`,
            params:   { requiresRollbackPlan: true, rollbackProbability: rollbackP },
        };
    }

    // Rule 2: sandbox — unsafe commands or critically low confidence
    if (hasUnsafe || confidence < 30) {
        return {
            strategy: "sandbox",
            reason:   hasUnsafe ? "unsafe command patterns detected"
                                : `confidence=${confidence} critically low`,
            params:   { isolated: true, allowWrite: false },
        };
    }

    // Rule 3: dry_run — unknown tools, port conflicts, or low confidence
    if (hasNoTool || hasPortConf || confidence < 50) {
        return {
            strategy: "dry_run",
            reason:   hasNoTool  ? "unavailable tools detected"
                    : hasPortConf ? "port conflicts detected"
                    :               `confidence=${confidence} below threshold`,
            params:   { simulate: true, execute: false },
        };
    }

    // Rule 4: staged — warnings present or moderate confidence
    if (blockers === 0 && ((simResult.warnings?.length ?? 0) > 0 || confidence < 75)) {
        return {
            strategy: "staged",
            reason:   `confidence=${confidence} moderate or warnings present`,
            params:   { checkpointAfterEach: true, pauseOnWarning: true },
        };
    }

    // Rule 5: direct — high confidence, clean sim
    return {
        strategy: "direct",
        reason:   `confidence=${confidence} high, no blockers`,
        params:   { parallel: false },
    };
}

module.exports = { select, STRATEGIES };
