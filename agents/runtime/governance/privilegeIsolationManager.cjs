"use strict";
/**
 * privilegeIsolationManager — privilege isolation domains, zero unsafe
 * authority inheritance, and cross-domain privilege boundary enforcement.
 *
 * createIsolationDomain(spec)        → { created, domainId, name, maxAuthority }
 * assignToDomain(spec)               → { assigned, domainId, principalId }
 * enforcePrivilegeBoundary(spec)     → { enforced, blocked, reason }
 * validatePrivilegeInheritance(spec) → { valid, violations }
 * getIsolationDomainState()          → IsolationDomainState
 * reset()
 *
 * Principle: a domain's maxAuthority caps all principals within it.
 * Child domain maxAuthority must not exceed parent domain maxAuthority.
 * Privilege cannot leak upward through domain boundaries.
 */

const { AUTHORITY_LEVELS, AUTHORITY_RANK } = require("./runtimeAuthorityManager.cjs");

// Minimum authority required to perform each action class
const ACTION_AUTHORITY_MAP = {
    observe:     "observer",
    schedule:    "operator",
    execute:     "operator",
    admit:       "controller",
    degrade:     "controller",
    isolate:     "controller",
    failover:    "governor",
    quarantine:  "governor",
    govern:      "governor",
    root_access: "root-runtime",
};

let _domains     = new Map();   // domainId → DomainRecord
let _assignments = new Map();   // principalId → domainId
let _counter     = 0;

// ── createIsolationDomain ─────────────────────────────────────────────

function createIsolationDomain(spec = {}) {
    const {
        name         = null,
        maxAuthority = "controller",
        parentDomain = null,
    } = spec;

    if (!name) return { created: false, reason: "name_required" };
    if (!AUTHORITY_LEVELS.includes(maxAuthority))
        return { created: false, reason: `invalid_maxAuthority: ${maxAuthority}` };

    // Parent constraint: child cannot exceed parent maxAuthority
    if (parentDomain) {
        const parent = [..._domains.values()].find(d => d.name === parentDomain);
        if (parent && AUTHORITY_RANK[maxAuthority] > AUTHORITY_RANK[parent.maxAuthority])
            return { created: false, reason: "child_cannot_exceed_parent_maxAuthority", parentMax: parent.maxAuthority };
    }

    const domainId = `privdomain-${++_counter}`;
    _domains.set(domainId, {
        domainId, name, maxAuthority, parentDomain,
        memberCount: 0, createdAt: new Date().toISOString(),
    });

    return { created: true, domainId, name, maxAuthority, parentDomain };
}

// ── assignToDomain ────────────────────────────────────────────────────

function assignToDomain(spec = {}) {
    const { principalId = null, domainId = null, currentAuthority = "observer" } = spec;
    if (!principalId) return { assigned: false, reason: "principalId_required" };
    if (!domainId)    return { assigned: false, reason: "domainId_required" };

    const domain = _domains.get(domainId);
    if (!domain) return { assigned: false, reason: "domain_not_found" };

    if (AUTHORITY_RANK[currentAuthority] > AUTHORITY_RANK[domain.maxAuthority])
        return {
            assigned: false, reason: "authority_exceeds_domain_max",
            provided: currentAuthority, domainMax: domain.maxAuthority,
        };

    const prevDomain = _assignments.get(principalId);
    if (prevDomain) _domains.get(prevDomain).memberCount--;

    _assignments.set(principalId, domainId);
    domain.memberCount++;

    return { assigned: true, domainId, principalId, name: domain.name, maxAuthority: domain.maxAuthority };
}

// ── enforcePrivilegeBoundary ──────────────────────────────────────────

function enforcePrivilegeBoundary(spec = {}) {
    const { principalId = null, requestedAction = null, callerAuthority = "observer" } = spec;
    if (!principalId)     return { enforced: false, reason: "principalId_required" };
    if (!requestedAction) return { enforced: false, reason: "requestedAction_required" };

    const domainId = _assignments.get(principalId);
    const domain   = domainId ? _domains.get(domainId) : null;

    // Required authority for this action
    const requiredAuthority = ACTION_AUTHORITY_MAP[requestedAction] ?? "governor";
    const domainMaxAuthority = domain ? domain.maxAuthority : "observer";

    // Domain cap: requested action's required authority must not exceed domain max
    if (AUTHORITY_RANK[requiredAuthority] > AUTHORITY_RANK[domainMaxAuthority]) {
        return {
            enforced: true, blocked: true,
            reason:   "action_exceeds_domain_authority_cap",
            action:   requestedAction,
            required: requiredAuthority,
            domainMax: domainMaxAuthority,
        };
    }

    // Caller authority check
    if (AUTHORITY_RANK[callerAuthority] < AUTHORITY_RANK[requiredAuthority]) {
        return {
            enforced: true, blocked: true,
            reason:   "insufficient_caller_authority",
            action:   requestedAction,
            required: requiredAuthority,
            provided: callerAuthority,
        };
    }

    return { enforced: true, blocked: false, action: requestedAction, callerAuthority, requiredAuthority };
}

// ── validatePrivilegeInheritance ──────────────────────────────────────

function validatePrivilegeInheritance(spec = {}) {
    const { parentDomainName = null, childDomainName = null } = spec;
    if (!parentDomainName) return { valid: false, reason: "parentDomainName_required" };
    if (!childDomainName)  return { valid: false, reason: "childDomainName_required" };

    const parent = [..._domains.values()].find(d => d.name === parentDomainName);
    const child  = [..._domains.values()].find(d => d.name === childDomainName);

    if (!parent) return { valid: false, reason: "parent_domain_not_found" };
    if (!child)  return { valid: false, reason: "child_domain_not_found" };

    const violations = [];
    if (AUTHORITY_RANK[child.maxAuthority] > AUTHORITY_RANK[parent.maxAuthority])
        violations.push({
            type:      "child_exceeds_parent_max_authority",
            child:     child.maxAuthority,
            parent:    parent.maxAuthority,
        });

    return { valid: violations.length === 0, violations, parentDomainName, childDomainName };
}

// ── getIsolationDomainState ───────────────────────────────────────────

function getIsolationDomainState() {
    const domains = [..._domains.values()].map(d => ({
        domainId: d.domainId, name: d.name, maxAuthority: d.maxAuthority,
        memberCount: d.memberCount, parentDomain: d.parentDomain,
    }));
    return {
        totalDomains:    _domains.size,
        totalAssignments: _assignments.size,
        domains,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _domains     = new Map();
    _assignments = new Map();
    _counter     = 0;
}

module.exports = {
    ACTION_AUTHORITY_MAP,
    createIsolationDomain, assignToDomain, enforcePrivilegeBoundary,
    validatePrivilegeInheritance, getIsolationDomainState, reset,
};
