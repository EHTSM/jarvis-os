"use strict";
/**
 * executionSandboxManager — isolated execution contexts with workspace bounds,
 * quota enforcement, capability scoping, and lifecycle management.
 *
 * createSandbox(spec)              → { created, sandboxId }
 * allocateExecution(spec)          → { allocated, sandboxId, remaining }
 * releaseExecution(spec)           → { released, sandboxId }
 * validateSandboxBounds(spec)      → { valid, violations }
 * terminateSandbox(spec)           → { terminated, sandboxId }
 * quarantineSandbox(spec)          → { quarantined, sandboxId }
 * getSandboxState(sandboxId)       → SandboxRecord | null
 * getSandboxMetrics()              → SandboxMetrics
 * reset()
 *
 * Lifecycle: active → exhausted (quota full) | terminated | quarantined
 * Quarantine and terminated are terminal — no further allocations allowed.
 */

const SANDBOX_STATES   = ["active", "exhausted", "terminated", "quarantined"];
const TERMINAL_STATES  = new Set(["terminated", "quarantined"]);
const DEFAULT_QUOTA    = 50;
const DEFAULT_TIMEOUT  = 5000;
const MAX_TIMEOUT      = 30000;
const DEFAULT_WORKSPACE = "/workspace";

let _sandboxes = new Map();   // sandboxId → SandboxRecord
let _counter   = 0;

// ── createSandbox ─────────────────────────────────────────────────────

function createSandbox(spec = {}) {
    const {
        workflowId      = null,
        sourceSubsystem = null,
        workspaceRoot   = DEFAULT_WORKSPACE,
        capabilities    = [],
        maxExecutions   = DEFAULT_QUOTA,
        timeoutMs       = DEFAULT_TIMEOUT,
    } = spec;

    if (!workflowId)      return { created: false, reason: "workflowId_required" };
    if (!sourceSubsystem) return { created: false, reason: "sourceSubsystem_required" };

    const clampedTimeout = Math.min(timeoutMs, MAX_TIMEOUT);
    const sandboxId      = `sandbox-${++_counter}`;

    _sandboxes.set(sandboxId, {
        sandboxId, workflowId, sourceSubsystem,
        workspaceRoot, capabilities: [...capabilities],
        maxExecutions, timeoutMs: clampedTimeout,
        usedExecutions: 0,
        activeExecutions: new Set(),
        state: "active",
        createdAt: new Date().toISOString(),
        terminatedAt: null,
    });

    return { created: true, sandboxId, workspaceRoot, capabilities, maxExecutions, timeoutMs: clampedTimeout };
}

// ── allocateExecution ─────────────────────────────────────────────────

function allocateExecution(spec = {}) {
    const { sandboxId = null, executionId = null } = spec;
    if (!sandboxId)   return { allocated: false, reason: "sandboxId_required" };
    if (!executionId) return { allocated: false, reason: "executionId_required" };

    const sb = _sandboxes.get(sandboxId);
    if (!sb) return { allocated: false, reason: "sandbox_not_found", sandboxId };
    if (TERMINAL_STATES.has(sb.state))
        return { allocated: false, reason: `sandbox_${sb.state}`, sandboxId };
    if (sb.state === "exhausted")
        return { allocated: false, reason: "sandbox_quota_exhausted", sandboxId };

    sb.usedExecutions++;
    sb.activeExecutions.add(executionId);

    if (sb.usedExecutions >= sb.maxExecutions) sb.state = "exhausted";

    const remaining = sb.maxExecutions - sb.usedExecutions;
    return { allocated: true, sandboxId, executionId, remaining, state: sb.state };
}

// ── releaseExecution ──────────────────────────────────────────────────

function releaseExecution(spec = {}) {
    const { sandboxId = null, executionId = null } = spec;
    if (!sandboxId)   return { released: false, reason: "sandboxId_required" };
    if (!executionId) return { released: false, reason: "executionId_required" };

    const sb = _sandboxes.get(sandboxId);
    if (!sb) return { released: false, reason: "sandbox_not_found", sandboxId };

    sb.activeExecutions.delete(executionId);
    return { released: true, sandboxId, executionId, activeCount: sb.activeExecutions.size };
}

// ── validateSandboxBounds ─────────────────────────────────────────────

function validateSandboxBounds(spec = {}) {
    const { sandboxId = null, path = null, capability = null } = spec;
    const violations = [];

    if (!sandboxId) return { valid: false, violations: ["sandboxId_required"] };

    const sb = _sandboxes.get(sandboxId);
    if (!sb) return { valid: false, violations: ["sandbox_not_found"] };

    if (TERMINAL_STATES.has(sb.state) || sb.state === "exhausted")
        violations.push(`sandbox_not_active: ${sb.state}`);

    if (path) {
        if (path.includes("../"))
            violations.push("path_traversal_detected");
        if (!path.startsWith(sb.workspaceRoot) && path.startsWith("/"))
            violations.push(`path_outside_workspace: ${path}`);
    }

    if (capability && sb.capabilities.length > 0 && !sb.capabilities.includes(capability))
        violations.push(`capability_not_in_scope: ${capability}`);

    return { valid: violations.length === 0, violations, sandboxId };
}

// ── terminateSandbox ──────────────────────────────────────────────────

function terminateSandbox(spec = {}) {
    const { sandboxId = null } = spec;
    if (!sandboxId) return { terminated: false, reason: "sandboxId_required" };

    const sb = _sandboxes.get(sandboxId);
    if (!sb) return { terminated: false, reason: "sandbox_not_found", sandboxId };
    if (sb.state === "quarantined")
        return { terminated: false, reason: "cannot_terminate_quarantined", sandboxId };
    if (sb.state === "terminated")
        return { terminated: false, reason: "already_terminated", sandboxId };

    sb.state        = "terminated";
    sb.terminatedAt = new Date().toISOString();
    return { terminated: true, sandboxId, previousActiveCount: sb.activeExecutions.size };
}

// ── quarantineSandbox ─────────────────────────────────────────────────

function quarantineSandbox(spec = {}) {
    const { sandboxId = null } = spec;
    if (!sandboxId) return { quarantined: false, reason: "sandboxId_required" };

    const sb = _sandboxes.get(sandboxId);
    if (!sb) return { quarantined: false, reason: "sandbox_not_found", sandboxId };
    if (sb.state === "quarantined")
        return { quarantined: false, reason: "already_quarantined", sandboxId };

    const prev  = sb.state;
    sb.state    = "quarantined";
    sb.terminatedAt = new Date().toISOString();
    return { quarantined: true, sandboxId, previousState: prev };
}

// ── getSandboxState ───────────────────────────────────────────────────

function getSandboxState(sandboxId) {
    if (!sandboxId) return null;
    const sb = _sandboxes.get(sandboxId);
    if (!sb) return null;
    return {
        sandboxId:       sb.sandboxId,
        workflowId:      sb.workflowId,
        workspaceRoot:   sb.workspaceRoot,
        capabilities:    [...sb.capabilities],
        maxExecutions:   sb.maxExecutions,
        usedExecutions:  sb.usedExecutions,
        activeCount:     sb.activeExecutions.size,
        state:           sb.state,
        timeoutMs:       sb.timeoutMs,
        createdAt:       sb.createdAt,
        terminatedAt:    sb.terminatedAt,
    };
}

// ── getSandboxMetrics ─────────────────────────────────────────────────

function getSandboxMetrics() {
    const all = [..._sandboxes.values()];
    const byState = {};
    for (const s of SANDBOX_STATES) byState[s] = 0;
    for (const sb of all) byState[sb.state] = (byState[sb.state] ?? 0) + 1;

    return {
        totalSandboxes:      all.length,
        activeSandboxes:     byState.active,
        exhaustedSandboxes:  byState.exhausted,
        terminatedSandboxes: byState.terminated,
        quarantinedSandboxes: byState.quarantined,
        byState,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _sandboxes = new Map();
    _counter   = 0;
}

module.exports = {
    SANDBOX_STATES, DEFAULT_QUOTA, DEFAULT_TIMEOUT, DEFAULT_WORKSPACE,
    createSandbox, allocateExecution, releaseExecution,
    validateSandboxBounds, terminateSandbox, quarantineSandbox,
    getSandboxState, getSandboxMetrics, reset,
};
