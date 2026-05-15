"use strict";
/**
 * capabilityPolicies — execution policy definitions and validation.
 *
 * POLICIES           — map of policy name → { level, allowedOps[] }
 * getLevel(policy)   → number  (−1 if unknown)
 * isValidPolicy(p)   → boolean
 * canEscalate(from, to) → boolean  (true when to.level ≤ from.level)
 * getAllowedOps(p)    → string[]
 * isOpAllowed(op, p) → boolean
 */

const POLICIES = {
    restricted:      { level: 0, allowedOps: [] },
    readonly:        { level: 1, allowedOps: ["read", "list", "status", "diff", "log"] },
    workspace_write: { level: 2, allowedOps: ["read", "list", "status", "diff", "log", "write", "create", "commit"] },
    shell_execute:   { level: 3, allowedOps: ["read", "list", "status", "diff", "log", "write", "create", "commit", "exec", "spawn", "test"] },
    network_access:  { level: 4, allowedOps: ["read", "list", "status", "diff", "log", "write", "create", "commit", "exec", "spawn", "test", "fetch", "install", "publish"] },
};

function getLevel(policy)              { return POLICIES[policy]?.level ?? -1; }
function isValidPolicy(policy)         { return policy in POLICIES; }
function canEscalate(fromPolicy, to)   { return getLevel(to) <= getLevel(fromPolicy); }
function getAllowedOps(policy)          { return [...(POLICIES[policy]?.allowedOps ?? [])]; }
function isOpAllowed(op, policy)       { return POLICIES[policy]?.allowedOps.includes(op) ?? false; }

module.exports = { POLICIES, getLevel, isValidPolicy, canEscalate, getAllowedOps, isOpAllowed };
