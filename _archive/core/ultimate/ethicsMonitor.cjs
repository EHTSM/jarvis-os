"use strict";
const { ultimateLog, isKillSwitchActive, uid, NOW, ok, fail, blocked, killed } = require("./_ultimateStore.cjs");

const AGENT = "ethicsMonitor";

// ── Ethics policy rules ───────────────────────────────────────────
// Each rule: { id, description, test(action, context) → boolean violation }
const ETHICS_RULES = [
    {
        id:          "no_human_replacement",
        description: "System must assist humans, never replace or eliminate human roles without explicit consent",
        test: (action) => /replace.*(human|person|worker|employee|staff)/i.test(action) || /eliminate.*job/i.test(action)
    },
    {
        id:          "no_deception",
        description: "System must not deceive users, fabricate data, or misrepresent its nature as an AI",
        test: (action) => /deceiv|fabricat|fake.*report|lie.*user|hide.*from.*user/i.test(action)
    },
    {
        id:          "no_surveillance_without_consent",
        description: "No covert user surveillance, tracking without knowledge, or privacy invasion",
        test: (action) => /covert.*track|spy.*user|monitor.*without.*consent|secret.*log/i.test(action)
    },
    {
        id:          "no_discriminatory_targeting",
        description: "No action that discriminates by race, gender, religion, age, disability, or protected characteristic",
        test: (action) => /target.*race|discriminat|exclude.*based.*on|profil.*ethnic/i.test(action)
    },
    {
        id:          "no_unilateral_financial_action",
        description: "No autonomous financial transactions above safe threshold without explicit user approval",
        test: (action, ctx) => /transfer.*fund|charge.*account|execute.*payment/i.test(action) && !ctx.userApproved
    },
    {
        id:          "no_autonomous_escalation",
        description: "System must not grant itself elevated privileges or expand its own permissions",
        test: (action) => /grant.*self|escalat.*own.*priv|expand.*own.*access|self.*admin/i.test(action)
    },
    {
        id:          "no_harmful_content",
        description: "Must not generate or distribute harmful, violent, or exploitative content",
        test: (action) => /generat.*weapon|exploit.*minor|creat.*malware|distribut.*illegal/i.test(action)
    },
    {
        id:          "transparency_required",
        description: "All AI decisions affecting users must be explainable and auditable",
        test: (action, ctx) => ctx.requiresExplanation && !ctx.explanationProvided
    }
];

// ── Validate an action against all ethics rules ───────────────────
function validate({ action, context = {}, goal = "" }) {
    if (!action) return fail(AGENT, "action is required");
    if (isKillSwitchActive()) return killed(AGENT);

    const violations = [];
    const checks     = [];

    for (const rule of ETHICS_RULES) {
        let violated = false;
        try { violated = rule.test(action, context); } catch {}
        checks.push({ ruleId: rule.id, description: rule.description, violated });
        if (violated) violations.push({ ruleId: rule.id, description: rule.description });
    }

    const status = violations.length === 0 ? "approved" : "ethics_violation";

    const report = {
        validationId: uid("eth"),
        action,
        goal,
        status,
        totalRules:   ETHICS_RULES.length,
        passed:       ETHICS_RULES.length - violations.length,
        violations,
        checks,
        recommendation: violations.length === 0
            ? "Action passes all ethics policies. Proceed."
            : `Action violates ${violations.length} ethics rule(s). Do not proceed.`,
        validatedAt:  NOW()
    };

    ultimateLog(AGENT, violations.length > 0 ? "ETHICS_VIOLATION" : "ethics_passed",
        { action: action.slice(0,100), violationCount: violations.length }, violations.length > 0 ? "WARN" : "INFO");

    if (violations.length > 0) {
        return {
            success:    false,
            type:       "ultimate",
            agent:      AGENT,
            status:     "ethics_violation",
            error:      `⚠️ ETHICS VIOLATION: ${violations.map(v => v.ruleId).join(", ")}`,
            data:       report,
            timestamp:  NOW()
        };
    }

    return ok(AGENT, report);
}

// ── Get the full rule catalog ─────────────────────────────────────
function getRules() {
    return ok(AGENT, { rules: ETHICS_RULES.map(r => ({ id: r.id, description: r.description })), totalRules: ETHICS_RULES.length });
}

// ── Audit: check a batch of past actions ─────────────────────────
function auditBatch({ actions = [], context = {} }) {
    if (!Array.isArray(actions) || actions.length === 0) return fail(AGENT, "actions array required");
    const results = actions.map(action => ({ action, ...validate({ action, context }) }));
    const failCount = results.filter(r => !r.success).length;
    ultimateLog(AGENT, "batch_audit_complete", { total: actions.length, violations: failCount }, "INFO");
    return ok(AGENT, { total: actions.length, violations: failCount, results });
}

module.exports = { validate, getRules, auditBatch };
