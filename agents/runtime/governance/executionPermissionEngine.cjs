"use strict";
/**
 * executionPermissionEngine — deny-by-default permission grants, action
 * authorization checks, and permission lifecycle management.
 *
 * grantPermission(spec)       → { granted, permId, principalId, action }
 * checkPermission(spec)       → { allowed, permId, reason }
 * revokePermission(spec)      → { revoked, permId }
 * listPermissions(principalId) → Permission[]
 * getPermissionMetrics()      → PermissionMetrics
 * reset()
 *
 * Deny-by-default: access is DENIED unless an explicit, active grant exists.
 * Sensitive actions (quarantine, govern, root_access) require elevated authority.
 */

const PERMITTED_ACTIONS = [
    "observe", "schedule", "execute", "admit",
    "degrade", "isolate", "failover", "quarantine",
    "govern",  "root_access",
];

const SENSITIVE_ACTIONS = new Set(["quarantine", "govern", "root_access"]);

let _permissions = new Map();   // permId → PermRecord
let _permIndex   = new Map();   // `${principalId}:${action}` → permId
let _counter     = 0;

// ── grantPermission ───────────────────────────────────────────────────

function grantPermission(spec = {}) {
    const {
        principalId      = null,
        action           = null,
        scope            = "global",
        grantingAuthority = null,
        expiresAt        = null,
    } = spec;

    if (!principalId) return { granted: false, reason: "principalId_required" };
    if (!action)      return { granted: false, reason: "action_required" };
    if (!PERMITTED_ACTIONS.includes(action))
        return { granted: false, reason: `invalid_action: ${action}` };
    if (action === "root_access" && grantingAuthority !== "root-runtime")
        return { granted: false, reason: "root_access_requires_root_runtime_authority" };

    const key = `${principalId}:${action}`;
    if (_permIndex.has(key)) {
        const existing = _permissions.get(_permIndex.get(key));
        if (existing && existing.active)
            return { granted: false, reason: "permission_already_granted", permId: existing.permId };
    }

    const permId = `perm-${++_counter}`;
    const record = {
        permId, principalId, action, scope,
        grantingAuthority, expiresAt,
        active: true, grantedAt: new Date().toISOString(),
    };
    _permissions.set(permId, record);
    _permIndex.set(key, permId);

    return { granted: true, permId, principalId, action, scope };
}

// ── checkPermission ───────────────────────────────────────────────────

function checkPermission(spec = {}) {
    const { principalId = null, action = null } = spec;
    if (!principalId) return { allowed: false, reason: "principalId_required" };
    if (!action)      return { allowed: false, reason: "action_required" };

    const key    = `${principalId}:${action}`;
    const permId = _permIndex.get(key);

    // Deny-by-default
    if (!permId) return { allowed: false, reason: "no_permission_grant", principalId, action };

    const rec = _permissions.get(permId);
    if (!rec || !rec.active)
        return { allowed: false, reason: "permission_revoked", permId, principalId, action };

    if (rec.expiresAt && new Date(rec.expiresAt) < new Date())
        return { allowed: false, reason: "permission_expired", permId, principalId, action };

    return { allowed: true, permId, principalId, action, scope: rec.scope };
}

// ── revokePermission ──────────────────────────────────────────────────

function revokePermission(spec = {}) {
    const { permId = null } = spec;
    if (!permId) return { revoked: false, reason: "permId_required" };

    const rec = _permissions.get(permId);
    if (!rec)        return { revoked: false, reason: "permission_not_found" };
    if (!rec.active) return { revoked: false, reason: "permission_already_revoked" };

    rec.active    = false;
    rec.revokedAt = new Date().toISOString();
    _permIndex.delete(`${rec.principalId}:${rec.action}`);

    return { revoked: true, permId, principalId: rec.principalId, action: rec.action };
}

// ── listPermissions ───────────────────────────────────────────────────

function listPermissions(principalId) {
    if (!principalId) return [];
    return [..._permissions.values()]
        .filter(p => p.principalId === principalId && p.active);
}

// ── getPermissionMetrics ──────────────────────────────────────────────

function getPermissionMetrics() {
    const all    = [..._permissions.values()];
    const active = all.filter(p => p.active);
    const byAction = {};
    for (const a of PERMITTED_ACTIONS) byAction[a] = 0;
    for (const p of active) byAction[p.action] = (byAction[p.action] ?? 0) + 1;

    return {
        totalGrants:   all.length,
        activeGrants:  active.length,
        revokedGrants: all.length - active.length,
        sensitiveGrants: active.filter(p => SENSITIVE_ACTIONS.has(p.action)).length,
        byAction,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _permissions = new Map();
    _permIndex   = new Map();
    _counter     = 0;
}

module.exports = {
    PERMITTED_ACTIONS, SENSITIVE_ACTIONS,
    grantPermission, checkPermission, revokePermission,
    listPermissions, getPermissionMetrics, reset,
};
