"use strict";
/**
 * governanceDecisionEngine — deterministic governance decisions, constitutional
 * rule enforcement, and policy compliance evaluation.
 *
 * submitDecisionRequest(spec)    → { submitted, requestId, decision, blockedBy }
 * evaluateGovernancePolicy(spec) → { evaluated, compliant, violations }
 * applyConstitutionalRule(spec)  → { applied, ruleId, blocked, reason }
 * getDecisionLog()               → DecisionLogEntry[]
 * getDecisionMetrics()           → DecisionMetrics
 * reset()
 *
 * Constitutional rules (non-overridable):
 *   no_privilege_escalation    — cannot grant higher authority than caller's level
 *   no_root_auto_grant         — root-runtime cannot be auto-granted
 *   deny_unsafe_without_approval — critical/restricted requires explicit approval
 *   no_cross_boundary_without_trust — cross-domain needs trust clearance
 */

const { AUTHORITY_RANK } = require("./runtimeAuthorityManager.cjs");
const RISK_RANK = { safe: 0, guarded: 1, elevated: 2, critical: 3, restricted: 4 };

const CONSTITUTIONAL_RULES = {
    no_privilege_escalation: {
        description: "Cannot grant higher authority than caller's current level",
        check: ctx => !ctx.isEscalation || false,
    },
    no_root_auto_grant: {
        description: "root-runtime cannot be granted automatically",
        check: ctx => !(ctx.targetLevel === "root-runtime" && !ctx.explicitRootGrant),
    },
    deny_unsafe_without_approval: {
        description: "critical and restricted risk class requires explicit approval",
        check: ctx => !(RISK_RANK[ctx.riskClass] >= RISK_RANK.critical && !ctx.hasApproval),
    },
    no_cross_boundary_without_trust: {
        description: "Cross-domain execution requires trust boundary clearance",
        check: ctx => !(ctx.crossDomain && !ctx.hasTrustClearance),
    },
};

let _decisions   = [];
let _counter     = 0;

// ── submitDecisionRequest ─────────────────────────────────────────────

function submitDecisionRequest(spec = {}) {
    const {
        principalId      = null,
        action           = null,
        riskClass        = "safe",
        authorityLevel   = "observer",
        hasApproval      = false,
        crossDomain      = false,
        hasTrustClearance = false,
        targetLevel      = null,
        explicitRootGrant = false,
        isEscalation     = false,
    } = spec;

    if (!principalId) return { submitted: false, reason: "principalId_required" };
    if (!action)      return { submitted: false, reason: "action_required" };

    const ctx = {
        principalId, action, riskClass, authorityLevel,
        hasApproval, crossDomain, hasTrustClearance,
        targetLevel, explicitRootGrant, isEscalation,
    };

    const blockedBy = [];
    for (const [ruleName, rule] of Object.entries(CONSTITUTIONAL_RULES)) {
        if (!rule.check(ctx)) blockedBy.push(ruleName);
    }

    const decision  = blockedBy.length === 0 ? "approved" : "blocked";
    const requestId = `req-${++_counter}`;
    _decisions.push({ requestId, principalId, action, riskClass, decision, blockedBy, evaluatedAt: new Date().toISOString() });

    return { submitted: true, requestId, principalId, action, decision, blockedBy };
}

// ── evaluateGovernancePolicy ──────────────────────────────────────────

function evaluateGovernancePolicy(spec = {}) {
    const {
        policy           = {},
        currentAuthority = "observer",
        riskClass        = "safe",
        hasApproval      = false,
    } = spec;

    const {
        name              = "unnamed",
        requiredAuthority = "observer",
        maxRiskClass      = "restricted",
        requiresApproval  = false,
    } = policy;

    const violations = [];

    if (AUTHORITY_RANK[currentAuthority] === undefined ||
        AUTHORITY_RANK[currentAuthority] < AUTHORITY_RANK[requiredAuthority])
        violations.push({ type: "insufficient_authority", required: requiredAuthority, provided: currentAuthority });

    if (RISK_RANK[riskClass] === undefined ||
        RISK_RANK[riskClass] > RISK_RANK[maxRiskClass])
        violations.push({ type: "risk_class_exceeded", max: maxRiskClass, provided: riskClass });

    if (requiresApproval && !hasApproval)
        violations.push({ type: "approval_required", policy: name });

    return {
        evaluated:  true,
        policy:     name,
        compliant:  violations.length === 0,
        violations,
    };
}

// ── applyConstitutionalRule ───────────────────────────────────────────

function applyConstitutionalRule(spec = {}) {
    const { ruleName = null, context = {} } = spec;
    if (!ruleName) return { applied: false, reason: "ruleName_required" };

    const rule = CONSTITUTIONAL_RULES[ruleName];
    if (!rule) return { applied: false, reason: `unknown_rule: ${ruleName}` };

    const passes = rule.check(context);
    const ruleId = `rule-${++_counter}`;

    return {
        applied:     true,
        ruleId,
        ruleName,
        blocked:     !passes,
        reason:      !passes ? rule.description : null,
        description: rule.description,
    };
}

// ── getDecisionLog ────────────────────────────────────────────────────

function getDecisionLog() {
    return [..._decisions];
}

// ── getDecisionMetrics ────────────────────────────────────────────────

function getDecisionMetrics() {
    const approved = _decisions.filter(d => d.decision === "approved").length;
    const blocked  = _decisions.filter(d => d.decision === "blocked").length;
    return {
        totalDecisions: _decisions.length,
        approvedCount:  approved,
        blockedCount:   blocked,
        blockRate:      _decisions.length > 0 ? +(blocked / _decisions.length).toFixed(3) : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _decisions = [];
    _counter   = 0;
}

module.exports = {
    CONSTITUTIONAL_RULES, RISK_RANK,
    submitDecisionRequest, evaluateGovernancePolicy, applyConstitutionalRule,
    getDecisionLog, getDecisionMetrics, reset,
};
