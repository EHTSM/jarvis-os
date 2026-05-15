"use strict";
/**
 * planVerifier — gate keeper that blocks execution for unsafe/unconfident plans.
 *
 * verify(plan, feasibilityResult, simResult)
 *   → { approved, blocked, reasons[], riskLevel, recommendation }
 *
 * Blocks if:
 *   - confidence < BLOCK_CONFIDENCE (40)
 *   - totalRisk  > BLOCK_RISK       (70)
 *   - cyclic dependencies detected
 *   - unsafe execution chain (critical-severity unsafe commands)
 *   - plan.feasible === false
 */

const pr = require("./planningRules.cjs");

const { BLOCK_CONFIDENCE, BLOCK_RISK } = pr.THRESHOLDS;

function verify(plan = {}, feasibility = {}, simResult = {}) {
    const reasons    = [];
    const confidence = feasibility.confidence ?? 100;
    const totalRisk  = plan.totalRisk         ?? 0;
    const blockers   = simResult.blockers     ?? [];

    const hasCycle  = blockers.some(b => b.type === "circular_dependency");
    const hasUnsafe = blockers.some(b => b.type === "unsafe_command") ||
                      (simResult.issues ?? []).some(i =>
                          i.type === "unsafe_command" && i.severity === "blocker");

    if (confidence < BLOCK_CONFIDENCE) {
        reasons.push({
            code:    "low_confidence",
            message: `Confidence ${confidence} is below minimum ${BLOCK_CONFIDENCE}`,
        });
    }

    if (totalRisk > BLOCK_RISK) {
        reasons.push({
            code:    "high_risk",
            message: `Risk ${totalRisk} exceeds maximum ${BLOCK_RISK}`,
        });
    }

    if (hasCycle) {
        const msgs = blockers.filter(b => b.type === "circular_dependency").map(b => b.message);
        reasons.push({
            code:    "cyclic_dependency",
            message: `Cyclic dependencies: ${msgs.join("; ")}`,
        });
    }

    if (hasUnsafe) {
        reasons.push({
            code:    "unsafe_execution",
            message: "Unsafe command patterns in execution chain",
        });
    }

    if (!plan.feasible) {
        const detail = plan.cycleError ?? (plan.validationErrors ?? []).join("; ") ?? "unknown";
        reasons.push({
            code:    "plan_not_feasible",
            message: `Plan not feasible: ${detail}`,
        });
    }

    const blocked       = reasons.length > 0;
    const riskLevel     = totalRisk >= 70 ? "critical"
                        : totalRisk >= 40 ? "high"
                        : totalRisk >= 20 ? "medium"
                        :                   "low";
    const recommendation = blocked
        ? `Fix ${reasons.length} blocking issue(s): ${reasons.map(r => r.code).join(", ")}`
        : "Plan approved for execution";

    return { approved: !blocked, blocked, reasons, riskLevel, recommendation };
}

module.exports = { verify, BLOCK_CONFIDENCE, BLOCK_RISK };
