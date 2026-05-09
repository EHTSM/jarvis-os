"use strict";
const { LIMITS, ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, blocked, killed } = require("./_ultimateStore.cjs");

const AGENT = "safetyLockAI";

// ── Risk factor weights ───────────────────────────────────────────
const RISK_FACTORS = {
    irreversible:          30,   // action cannot be undone
    external_api_write:    25,   // writes to external systems
    financial_transaction: 25,   // involves money movement
    multi_system:          15,   // touches >1 integrated system
    data_deletion:         30,   // deletes user or system data
    autonomous_loop:       20,   // initiates another autonomous loop
    high_concurrency:      10,   // spawns many concurrent tasks
    pii_access:            20,   // accesses personal identifiable info
    admin_action:          35,   // requests admin-level privileges
    unverified_source:     15    // data from unverified external source
};

// ── Score a proposed action ───────────────────────────────────────
function scoreRisk({ action, flags = [], context = {} }) {
    if (!action) return fail(AGENT, "action is required");

    let score = 0;
    const triggered = [];

    for (const flag of flags) {
        if (RISK_FACTORS[flag] !== undefined) {
            score += RISK_FACTORS[flag];
            triggered.push({ factor: flag, weight: RISK_FACTORS[flag] });
        }
    }

    // context-based auto-detection
    const actionLower = (action || "").toLowerCase();
    if (/delete|remove|drop|destroy|purge/.test(actionLower)) { score += RISK_FACTORS.data_deletion; triggered.push({ factor: "data_deletion_detected", weight: RISK_FACTORS.data_deletion }); }
    if (/payment|transfer|charge|invoice|money|fund/.test(actionLower)) { score += RISK_FACTORS.financial_transaction; triggered.push({ factor: "financial_detected", weight: RISK_FACTORS.financial_transaction }); }
    if (/admin|root|override|bypass|sudo/.test(actionLower)) { score += RISK_FACTORS.admin_action; triggered.push({ factor: "admin_detected", weight: RISK_FACTORS.admin_action }); }

    score = Math.min(100, score); // cap at 100

    const verdict = score >= LIMITS.CRITICAL_RISK_SCORE ? "critical_block"
                  : score >= LIMITS.MAX_RISK_SCORE       ? "needs_admin_approval"
                  : "approved";

    const assessment = {
        assessmentId:   uid("risk"),
        action,
        riskScore:      score,
        verdict,
        triggered,
        maxAllowedScore: LIMITS.MAX_RISK_SCORE,
        criticalThreshold: LIMITS.CRITICAL_RISK_SCORE,
        recommendation: score >= LIMITS.CRITICAL_RISK_SCORE
            ? "Action is CRITICAL risk. Blocked regardless of approval."
            : score >= LIMITS.MAX_RISK_SCORE
            ? "Elevated risk. Requires explicit admin approval before execution."
            : "Risk within acceptable limits. Proceed through standard pipeline.",
        assessedAt: NOW()
    };

    ultimateLog(AGENT, "risk_assessed", { action, riskScore: score, verdict }, score >= LIMITS.MAX_RISK_SCORE ? "WARN" : "INFO");
    return ok(AGENT, assessment, verdict === "approved" ? "approved" : "pending_review");
}

// ── Hard gate: call before executing any action ───────────────────
function gate({ action, flags = [], adminApproved = false, context = {} }) {
    if (!action) return fail(AGENT, "action is required");

    // Kill switch always wins
    if (isKillSwitchActive()) return killed(AGENT);

    const assessment = scoreRisk({ action, flags, context });
    if (!assessment.success) return assessment;

    const { riskScore, verdict } = assessment.data;

    if (verdict === "critical_block") {
        return blocked(AGENT, `Risk score ${riskScore}/100 exceeds critical threshold (${LIMITS.CRITICAL_RISK_SCORE}). Action permanently blocked.`, riskScore);
    }

    if (verdict === "needs_admin_approval" && adminApproved !== true) {
        return blocked(AGENT, `Risk score ${riskScore}/100 requires admin approval. Set adminApproved:true after human authorisation.`, riskScore);
    }

    ultimateLog(AGENT, "gate_passed", { action, riskScore, adminApproved }, "INFO");
    return ok(AGENT, { action, riskScore, verdict: "passed", adminApproved, gatedAt: NOW() });
}

// ── Concurrent task limiter ───────────────────────────────────────
function checkConcurrency(currentCount) {
    if (currentCount >= LIMITS.MAX_CONCURRENT_TASKS) {
        return blocked(AGENT, `Max concurrent tasks (${LIMITS.MAX_CONCURRENT_TASKS}) reached. Queue new tasks when capacity frees.`, 0);
    }
    return ok(AGENT, { currentCount, maxAllowed: LIMITS.MAX_CONCURRENT_TASKS, available: LIMITS.MAX_CONCURRENT_TASKS - currentCount });
}

// ── Loop guard ────────────────────────────────────────────────────
function checkLoopDepth(currentDepth) {
    if (currentDepth >= LIMITS.MAX_EXECUTION_LOOPS) {
        return blocked(AGENT, `Max execution loop depth (${LIMITS.MAX_EXECUTION_LOOPS}) reached. Preventing runaway recursion.`, 0);
    }
    return ok(AGENT, { currentDepth, maxAllowed: LIMITS.MAX_EXECUTION_LOOPS });
}

module.exports = { scoreRisk, gate, checkConcurrency, checkLoopDepth, RISK_FACTORS };
