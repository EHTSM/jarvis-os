"use strict";
/**
 * adapterPermissionBridge — authority-level enforcement bridge between
 * principals and adapter operations.
 *
 * grantAdapterPermission(spec)  → { granted, permissionId }
 * revokeAdapterPermission(spec) → { revoked, permissionId }
 * checkAdapterPermission(spec)  → { allowed, reason }
 * validateExecution(spec)       → { valid, violations }
 * getPermissionMetrics()        → PermissionMetrics
 * reset()
 *
 * Deny-by-default: execution blocked unless an active grant exists and
 * the caller's authority meets the per-operation minimum.
 */

const AUTHORITY_RANK = {
    observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4,
};

// Minimum required authority per adapter:operation
const ADAPTER_MIN_AUTHORITY = {
    "terminal:execute_command":  "operator",
    "terminal:dry_run":          "observer",
    "filesystem:read_file":      "observer",
    "filesystem:write_file":     "operator",
    "filesystem:list_directory": "observer",
    "filesystem:delete_file":    "controller",
    "git:git_status":            "observer",
    "git:git_diff":              "observer",
    "git:git_branch":            "observer",
    "git:git_commit":            "operator",
    "git:git_checkout":          "operator",
    "vscode:navigate_file":      "observer",
    "vscode:edit_file":          "operator",
    "vscode:scan_workspace":     "observer",
    "vscode:capture_state":      "observer",
    "docker:inspect_container":  "observer",
    "docker:list_containers":    "observer",
    "docker:get_logs":           "observer",
    "browser:navigate_url":      "operator",
    "browser:capture_screenshot":"observer",
};

let _permissions = new Map();   // permissionId → PermissionRecord
let _counter     = 0;

// ── grantAdapterPermission ────────────────────────────────────────────

function grantAdapterPermission(spec = {}) {
    const {
        principalId    = null,
        adapterType    = null,
        operation      = null,
        authorityLevel = null,
        workflowId     = null,
    } = spec;

    if (!principalId)    return { granted: false, reason: "principalId_required" };
    if (!adapterType)    return { granted: false, reason: "adapterType_required" };
    if (!operation)      return { granted: false, reason: "operation_required" };
    if (!authorityLevel) return { granted: false, reason: "authorityLevel_required" };
    if (!(authorityLevel in AUTHORITY_RANK))
        return { granted: false, reason: `invalid_authority_level: ${authorityLevel}` };

    const key      = `${adapterType}:${operation}`;
    const required = ADAPTER_MIN_AUTHORITY[key];
    if (required && (AUTHORITY_RANK[authorityLevel] ?? -1) < (AUTHORITY_RANK[required] ?? 0))
        return { granted: false, reason: "insufficient_authority", required, provided: authorityLevel };

    const permissionId = `aperm-${++_counter}`;
    _permissions.set(permissionId, {
        permissionId, principalId, adapterType, operation,
        authorityLevel, workflowId,
        revoked: false, grantedAt: new Date().toISOString(),
    });

    return { granted: true, permissionId, principalId, adapterType, operation };
}

// ── revokeAdapterPermission ───────────────────────────────────────────

function revokeAdapterPermission(spec = {}) {
    const { permissionId = null } = spec;
    if (!permissionId) return { revoked: false, reason: "permissionId_required" };
    const rec = _permissions.get(permissionId);
    if (!rec) return { revoked: false, reason: "permission_not_found" };
    rec.revoked = true;
    return { revoked: true, permissionId };
}

// ── checkAdapterPermission ────────────────────────────────────────────

function checkAdapterPermission(spec = {}) {
    const {
        principalId    = null,
        adapterType    = null,
        operation      = null,
        authorityLevel = null,
    } = spec;

    if (!principalId || !adapterType || !operation)
        return { allowed: false, reason: "principalId_adapterType_operation_required" };

    // Authority floor check
    const key      = `${adapterType}:${operation}`;
    const required = ADAPTER_MIN_AUTHORITY[key];
    if (required) {
        const callerRank   = AUTHORITY_RANK[authorityLevel] ?? -1;
        const requiredRank = AUTHORITY_RANK[required];
        if (callerRank < requiredRank)
            return { allowed: false, reason: "insufficient_authority", required, provided: authorityLevel };
    }

    // Active grant check (deny-by-default)
    const grant = [..._permissions.values()].find(
        p => !p.revoked && p.principalId === principalId &&
             p.adapterType === adapterType && p.operation === operation
    );
    if (!grant)
        return { allowed: false, reason: "no_active_permission", principalId, adapterType, operation };

    return { allowed: true, permissionId: grant.permissionId, principalId, adapterType, operation };
}

// ── validateExecution ─────────────────────────────────────────────────

function validateExecution(spec = {}) {
    const {
        adapterType    = null,
        operation      = null,
        authorityLevel = null,
        sandboxed      = true,
    } = spec;

    const violations = [];
    if (!adapterType)    violations.push("adapterType_required");
    if (!operation)      violations.push("operation_required");
    if (!authorityLevel) violations.push("authorityLevel_required");
    if (!sandboxed)      violations.push("execution_must_be_sandboxed");

    if (authorityLevel && !(authorityLevel in AUTHORITY_RANK))
        violations.push(`invalid_authority_level: ${authorityLevel}`);

    if (adapterType && operation) {
        const key      = `${adapterType}:${operation}`;
        const required = ADAPTER_MIN_AUTHORITY[key];
        if (required && (AUTHORITY_RANK[authorityLevel] ?? -1) < (AUTHORITY_RANK[required] ?? 0))
            violations.push(`insufficient_authority: need ${required}, have ${authorityLevel}`);
    }

    return { valid: violations.length === 0, violations };
}

// ── getPermissionMetrics ──────────────────────────────────────────────

function getPermissionMetrics() {
    const all = [..._permissions.values()];
    const byAdapter = {};
    for (const p of all) byAdapter[p.adapterType] = (byAdapter[p.adapterType] ?? 0) + 1;
    return {
        totalGranted:  all.length,
        activeCount:   all.filter(p => !p.revoked).length,
        revokedCount:  all.filter(p => p.revoked).length,
        byAdapter,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _permissions = new Map();
    _counter     = 0;
}

module.exports = {
    AUTHORITY_RANK, ADAPTER_MIN_AUTHORITY,
    grantAdapterPermission, revokeAdapterPermission,
    checkAdapterPermission, validateExecution,
    getPermissionMetrics, reset,
};
