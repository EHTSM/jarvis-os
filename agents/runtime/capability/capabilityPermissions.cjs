"use strict";
/**
 * capabilityPermissions — allowlist/denylist and escalation enforcement.
 *
 * createContext(opts)                           → permissionContext
 *   opts: { allowlist?, denylist?, maxPolicy? }
 * isAllowed(capabilityId, context, capPolicy?)  → { allowed, reason? }
 * validateEscalation(fromPolicy, toPolicy)      → { allowed, reason? }
 * reset()
 */

const pol = require("./capabilityPolicies.cjs");

const _contexts = new Map();

let _seq = 0;
function createContext(opts = {}) {
    const id = `pctx-${++_seq}`;
    const ctx = {
        id,
        allowlist:  opts.allowlist  ?? null,   // null = allow everything (subject to denylist)
        denylist:   opts.denylist   ?? [],
        maxPolicy:  opts.maxPolicy  ?? "network_access",
        createdAt:  new Date().toISOString(),
    };
    _contexts.set(id, ctx);
    return ctx;
}

function isAllowed(capabilityId, context, capPolicy = null) {
    if (!context) return { allowed: false, reason: "no_context" };

    // Denylist always wins
    if (context.denylist?.includes(capabilityId)) {
        return { allowed: false, reason: "denylisted" };
    }

    // Allowlist: if set, capability must appear in it
    if (context.allowlist !== null && !context.allowlist.includes(capabilityId)) {
        return { allowed: false, reason: "not_allowlisted" };
    }

    // Policy level: capability must not exceed context's maxPolicy
    if (capPolicy && !pol.canEscalate(context.maxPolicy, capPolicy)) {
        return { allowed: false, reason: "policy_exceeds_context" };
    }

    return { allowed: true };
}

function validateEscalation(fromPolicy, toPolicy) {
    if (!pol.isValidPolicy(fromPolicy)) return { allowed: false, reason: "invalid_from_policy" };
    if (!pol.isValidPolicy(toPolicy))   return { allowed: false, reason: "invalid_to_policy" };
    if (!pol.canEscalate(fromPolicy, toPolicy)) {
        return {
            allowed: false,
            reason: `escalation_blocked: ${fromPolicy}(${pol.getLevel(fromPolicy)}) → ${toPolicy}(${pol.getLevel(toPolicy)})`,
        };
    }
    return { allowed: true };
}

function reset() { _contexts.clear(); _seq = 0; }

module.exports = { createContext, isAllowed, validateEscalation, reset };
