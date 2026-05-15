"use strict";
/**
 * runtimeIsolationManager — execution sandbox boundaries and tenant isolation.
 *
 * createScope(executionId, tenantId, opts)   → ScopeResult
 * closeScope(executionId)                    → CloseResult
 * validateScope(executionId)                 → ValidationResult
 * checkMemoryBudget(executionId, bytes)      → BudgetResult
 * detectContamination(executionId, data)     → ContaminationResult
 * getTenantScopes(tenantId)                  → Scope[]
 * getIsolationReport()                       → IsolationReport
 * reset()
 */

let _scopes        = new Map();   // executionId → Scope
let _tenants       = new Map();   // tenantId → Set<executionId>
let _closed        = new Set();   // closed executionIds
let _contaminations = [];
let _violations    = [];

const MAX_SCOPES_PER_TENANT = 50;

// ── createScope ───────────────────────────────────────────────────────

function createScope(executionId, tenantId = "default", opts = {}) {
    if (!executionId) return { created: false, reason: "missing_execution_id" };
    if (_scopes.has(executionId)) return { created: false, reason: "already_exists", executionId };

    const tenantSet = _tenants.get(tenantId);
    if (tenantSet && tenantSet.size >= MAX_SCOPES_PER_TENANT) {
        return { created: false, reason: "tenant_scope_limit_exceeded", tenantId };
    }

    const scope = {
        executionId,
        tenantId,
        createdAt:         new Date().toISOString(),
        memoryBudgetBytes: opts.memoryBudgetBytes ?? 52428800,  // 50 MB
        allocatedBytes:    0,
        state:             "active",
        tags:              opts.tags ?? [],
        context:           {},
    };
    _scopes.set(executionId, scope);
    if (!_tenants.has(tenantId)) _tenants.set(tenantId, new Set());
    _tenants.get(tenantId).add(executionId);
    return { created: true, executionId, tenantId, scope };
}

// ── closeScope ────────────────────────────────────────────────────────

function closeScope(executionId) {
    const scope = _scopes.get(executionId);
    if (!scope)                    return { closed: false, reason: "not_found" };
    if (scope.state === "closed")  return { closed: false, reason: "already_closed" };

    scope.state    = "closed";
    scope.closedAt = new Date().toISOString();
    _closed.add(executionId);

    const tenantSet = _tenants.get(scope.tenantId);
    if (tenantSet) tenantSet.delete(executionId);

    return {
        closed:      true,
        executionId,
        tenantId:    scope.tenantId,
        durationMs:  Date.now() - new Date(scope.createdAt).getTime(),
    };
}

// ── validateScope ─────────────────────────────────────────────────────

function validateScope(executionId) {
    if (_closed.has(executionId)) {
        _violations.push({ type: "closed_scope_access", executionId, ts: new Date().toISOString() });
        return { valid: false, reason: "scope_closed", leak: true, executionId };
    }
    const scope = _scopes.get(executionId);
    if (!scope) return { valid: false, reason: "not_found", executionId };
    return { valid: true, executionId, tenantId: scope.tenantId, state: scope.state };
}

// ── checkMemoryBudget ─────────────────────────────────────────────────

function checkMemoryBudget(executionId, requestedBytes) {
    const scope = _scopes.get(executionId);
    if (!scope)                        return { allowed: false, reason: "not_found" };
    if (scope.state !== "active")      return { allowed: false, reason: "scope_not_active" };

    const projected = scope.allocatedBytes + requestedBytes;
    if (projected > scope.memoryBudgetBytes) {
        _violations.push({
            type:        "memory_budget_exceeded",
            executionId,
            requested:   requestedBytes,
            allocated:   scope.allocatedBytes,
            budget:      scope.memoryBudgetBytes,
            ts:          new Date().toISOString(),
        });
        return {
            allowed:        false,
            reason:         "budget_exceeded",
            allocatedBytes: scope.allocatedBytes,
            budgetBytes:    scope.memoryBudgetBytes,
        };
    }
    scope.allocatedBytes += requestedBytes;
    return {
        allowed:        true,
        allocatedBytes: scope.allocatedBytes,
        remainingBytes: scope.memoryBudgetBytes - scope.allocatedBytes,
    };
}

// ── detectContamination ───────────────────────────────────────────────

function detectContamination(executionId, data) {
    const scope = _scopes.get(executionId);
    if (!scope) return { contaminated: false, reason: "scope_not_found" };

    const dataStr    = typeof data === "string" ? data : JSON.stringify(data ?? "");
    const foreignIds = [];

    for (const [otherId] of _scopes) {
        if (otherId !== executionId && dataStr.includes(otherId)) foreignIds.push(otherId);
    }
    for (const otherId of _closed) {
        if (otherId !== executionId && !foreignIds.includes(otherId) && dataStr.includes(otherId)) {
            foreignIds.push(otherId);
        }
    }

    const contaminated = foreignIds.length > 0;
    if (contaminated) {
        const record = { victimId: executionId, sourceIds: foreignIds, detectedAt: new Date().toISOString() };
        _contaminations.push(record);
        _violations.push({ type: "cross_task_contamination", ...record });
    }
    return { contaminated, foreignIds, executionId };
}

// ── getTenantScopes ───────────────────────────────────────────────────

function getTenantScopes(tenantId) {
    const ids = [...(_tenants.get(tenantId) ?? [])];
    return ids.map(id => _scopes.get(id)).filter(Boolean);
}

// ── getIsolationReport ────────────────────────────────────────────────

function getIsolationReport() {
    const all = [..._scopes.values()];
    return {
        activeScopes:   all.filter(s => s.state === "active").length,
        closedScopes:   all.filter(s => s.state === "closed").length,
        totalScopes:    _scopes.size,
        tenants:        _tenants.size,
        contaminations: [..._contaminations],
        violations:     [..._violations],
        ts:             new Date().toISOString(),
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _scopes         = new Map();
    _tenants        = new Map();
    _closed         = new Set();
    _contaminations = [];
    _violations     = [];
}

module.exports = {
    MAX_SCOPES_PER_TENANT,
    createScope, closeScope, validateScope, checkMemoryBudget,
    detectContamination, getTenantScopes, getIsolationReport, reset,
};
