"use strict";
/**
 * runtimeExecutionAdapterManager — central coordinator for the execution
 * adapter layer. Manages lifecycle, routing, cancellation, quarantine,
 * and dry-run validation for all adapter-backed executions.
 *
 * submitExecution(spec)      → { submitted, executionId, adapterType, lifecycleState }
 * advanceExecution(spec)     → { advanced, executionId, oldState, newState }
 * cancelExecution(spec)      → { cancelled, executionId, previousState }
 * quarantineExecution(spec)  → { quarantined, executionId }
 * validateExecution(spec)    → { valid, violations }
 * getExecution(executionId)  → ExecutionRecord | null
 * getExecutionMetrics()      → ExecutionMetrics
 * configure(config)          → { configured } — wire optional integration modules
 * reset()
 *
 * Integration modules (all optional, injected via configure()):
 *   policyEngine   — runtimeExecutionPolicyEngine
 *   sandboxManager — executionSandboxManager
 *   circuitBreaker — executionCircuitBreaker
 *   auditLedger    — executionAuditLedger
 *   riskAnalyzer   — executionRiskAnalyzer
 *
 * Lifecycle:
 *   requested → validated → authorized → sandboxed → executing →
 *   verified → completed | failed → (any) quarantined (terminal)
 *   requested/validated/authorized/sandboxed → cancelled (terminal)
 */

const EXECUTION_LIFECYCLE = [
    "requested", "validated", "authorized", "sandboxed",
    "executing", "verified", "completed", "failed",
    "quarantined", "cancelled",
];

const VALID_TRANSITIONS = {
    requested:   ["validated",  "quarantined", "cancelled"],
    validated:   ["authorized", "quarantined", "cancelled"],
    authorized:  ["sandboxed",  "quarantined", "cancelled"],
    sandboxed:   ["executing",  "quarantined", "cancelled"],
    executing:   ["verified",   "failed",      "quarantined", "cancelled"],
    verified:    ["completed",  "quarantined"],
    failed:      ["quarantined"],
    completed:   [],
    quarantined: [],
    cancelled:   [],
};

const TERMINAL_STATES = new Set(["completed", "quarantined", "cancelled"]);

// Map capability → adapterType for auto-resolution
const CAPABILITY_ADAPTER_MAP = {
    execute_command:    "terminal",
    dry_run:            "terminal",
    read_file:          "filesystem",
    write_file:         "filesystem",
    list_directory:     "filesystem",
    delete_file:        "filesystem",
    git_status:         "git",
    git_diff:           "git",
    git_branch:         "git",
    git_commit:         "git",
    git_checkout:       "git",
    navigate_file:      "vscode",
    edit_file:          "vscode",
    scan_workspace:     "vscode",
    capture_state:      "vscode",
    inspect_container:  "docker",
    list_containers:    "docker",
    get_logs:           "docker",
    navigate_url:       "browser",
    capture_screenshot: "browser",
};

const ADAPTER_CAPABILITY_MAP = {
    terminal:   ["execute_command", "dry_run"],
    filesystem: ["read_file", "write_file", "list_directory", "delete_file"],
    git:        ["git_status", "git_diff", "git_branch", "git_commit", "git_checkout"],
    vscode:     ["navigate_file", "edit_file", "scan_workspace", "capture_state"],
    docker:     ["inspect_container", "list_containers", "get_logs"],
    browser:    ["navigate_url", "capture_screenshot"],
};

let _executions       = new Map();
let _counter          = 0;
let _integrationConfig = null;   // set via configure()

// ── configure ─────────────────────────────────────────────────────────

function configure(config = {}) {
    _integrationConfig = {
        policyEngine:   config.policyEngine   ?? null,
        sandboxManager: config.sandboxManager ?? null,
        circuitBreaker: config.circuitBreaker ?? null,
        auditLedger:    config.auditLedger    ?? null,
        riskAnalyzer:   config.riskAnalyzer   ?? null,
    };
    return { configured: true, integrations: Object.keys(_integrationConfig).filter(k => _integrationConfig[k] !== null) };
}

// ── submitExecution ───────────────────────────────────────────────────

function submitExecution(spec = {}) {
    const {
        workflowId      = null,
        sourceSubsystem = null,
        adapterType     = null,
        capability      = null,
        authorityLevel  = null,
        payload         = {},
        dryRun          = false,
        replayId        = null,
        correlationId   = null,
        timeoutMs       = 5000,
    } = spec;

    if (!workflowId)      return { submitted: false, reason: "workflowId_required" };
    if (!sourceSubsystem) return { submitted: false, reason: "sourceSubsystem_required" };
    if (!authorityLevel)  return { submitted: false, reason: "authorityLevel_required" };
    if (!capability)      return { submitted: false, reason: "capability_required" };

    const resolvedAdapter = adapterType ?? CAPABILITY_ADAPTER_MAP[capability];
    if (!resolvedAdapter)
        return { submitted: false, reason: "no_adapter_for_capability", capability };

    const adapterCaps = ADAPTER_CAPABILITY_MAP[resolvedAdapter] ?? [];
    if (!adapterCaps.includes(capability))
        return { submitted: false, reason: "capability_not_supported_by_adapter", capability, adapterType: resolvedAdapter };

    const ig = _integrationConfig;

    // ── Integration checks (only when configured) ─────────────────────

    let riskScore   = 0;
    let trustScore  = payload.trustScore ?? 1.0;
    const resolvedCorrelation = correlationId ?? `mgr-exec-${_counter + 1}`;

    if (ig) {
        // 1. Circuit breaker
        if (ig.circuitBreaker) {
            const cb = ig.circuitBreaker.isAllowed({ adapterType: resolvedAdapter });
            if (!cb.allowed) {
                ig.auditLedger?.appendEvent({
                    adapterType: resolvedAdapter, operation: capability,
                    authorityLevel, workflowId, correlationId: resolvedCorrelation,
                    outcome: "circuit_breaker_blocked", riskScore,
                });
                return { submitted: false, reason: "circuit_breaker_open", adapterType: resolvedAdapter, breakerState: cb.breakerState };
            }
        }

        // 2. Risk analysis
        if (ig.riskAnalyzer && capability === "execute_command" && payload.command) {
            const ra = ig.riskAnalyzer.analyzeCommandRisk({ command: payload.command });
            riskScore = ra.riskScore;
        }

        // 3. Policy evaluation
        if (ig.policyEngine) {
            const pe = ig.policyEngine.evaluatePolicy({
                adapterType: resolvedAdapter, operation: capability,
                authorityLevel, riskScore, trustScore,
                sandboxActive: !!payload.sandboxId,
            });
            if (!pe.allowed) {
                ig.auditLedger?.appendEvent({
                    adapterType: resolvedAdapter, operation: capability,
                    authorityLevel, workflowId, correlationId: resolvedCorrelation,
                    outcome: "policy_denied", policyDecision: pe.reason, riskScore,
                });
                return { submitted: false, reason: "policy_denied", policyReason: pe.reason };
            }
        }

        // 4. Audit submission
        ig.auditLedger?.appendEvent({
            adapterType: resolvedAdapter, operation: capability,
            authorityLevel, workflowId, correlationId: resolvedCorrelation,
            outcome: "submitted", riskScore,
        });
    }

    const executionId = `mgr-exec-${++_counter}`;
    const record = {
        executionId, workflowId, sourceSubsystem,
        adapterType: resolvedAdapter, capability,
        authorityLevel, payload, dryRun, replayId,
        correlationId: correlationId ?? executionId,
        timeoutMs, lifecycleState: "requested",
        riskScore,
        stateHistory: [{ state: "requested", ts: new Date().toISOString() }],
        submittedAt: new Date().toISOString(),
    };
    _executions.set(executionId, record);

    return {
        submitted: true, executionId, workflowId,
        adapterType: resolvedAdapter, capability,
        lifecycleState: "requested", riskScore,
    };
}

// ── advanceExecution ──────────────────────────────────────────────────

function advanceExecution(spec = {}) {
    const { executionId = null, newState = null, reason = "lifecycle_advance" } = spec;
    if (!executionId) return { advanced: false, reason: "executionId_required" };
    if (!newState)    return { advanced: false, reason: "newState_required" };
    if (!EXECUTION_LIFECYCLE.includes(newState))
        return { advanced: false, reason: `invalid_lifecycle_state: ${newState}` };

    const record = _executions.get(executionId);
    if (!record) return { advanced: false, reason: "execution_not_found", executionId };

    const current = record.lifecycleState;
    const allowed = VALID_TRANSITIONS[current] ?? [];
    if (!allowed.includes(newState))
        return { advanced: false, reason: "invalid_transition", currentState: current, newState, allowed };

    record.lifecycleState = newState;
    record.stateHistory.push({ state: newState, reason, ts: new Date().toISOString() });

    return { advanced: true, executionId, oldState: current, newState };
}

// ── cancelExecution ───────────────────────────────────────────────────

function cancelExecution(spec = {}) {
    const { executionId = null, reason = "cancelled" } = spec;
    if (!executionId) return { cancelled: false, reason: "executionId_required" };

    const record = _executions.get(executionId);
    if (!record) return { cancelled: false, reason: "execution_not_found", executionId };

    if (TERMINAL_STATES.has(record.lifecycleState))
        return { cancelled: false, reason: `execution_already_terminal: ${record.lifecycleState}`, executionId };

    const current = record.lifecycleState;
    const allowed = VALID_TRANSITIONS[current] ?? [];
    if (!allowed.includes("cancelled"))
        return { cancelled: false, reason: "cancel_not_allowed_from_state", currentState: current };

    record.lifecycleState = "cancelled";
    record.stateHistory.push({ state: "cancelled", reason, ts: new Date().toISOString() });

    return { cancelled: true, executionId, previousState: current };
}

// ── quarantineExecution ───────────────────────────────────────────────

function quarantineExecution(spec = {}) {
    const { executionId = null, reason = "quarantine_enforced" } = spec;
    if (!executionId) return { quarantined: false, reason: "executionId_required" };

    const record = _executions.get(executionId);
    if (!record) return { quarantined: false, reason: "execution_not_found", executionId };
    if (record.lifecycleState === "quarantined")
        return { quarantined: false, reason: "already_quarantined", executionId };
    if (record.lifecycleState === "completed")
        return { quarantined: false, reason: "cannot_quarantine_completed", executionId };

    const prev = record.lifecycleState;
    record.lifecycleState = "quarantined";
    record.stateHistory.push({ state: "quarantined", reason, ts: new Date().toISOString() });

    return { quarantined: true, executionId, previousState: prev };
}

// ── validateExecution ─────────────────────────────────────────────────

function validateExecution(spec = {}) {
    const {
        adapterType    = null,
        capability     = null,
        authorityLevel = null,
        sandboxed      = true,
    } = spec;

    const violations = [];
    if (!adapterType)    violations.push("adapterType_required");
    if (!capability)     violations.push("capability_required");
    if (!authorityLevel) violations.push("authorityLevel_required");
    if (!sandboxed)      violations.push("execution_must_be_sandboxed");

    if (adapterType && capability) {
        const caps = ADAPTER_CAPABILITY_MAP[adapterType];
        if (!caps) violations.push(`unknown_adapter_type: ${adapterType}`);
        else if (!caps.includes(capability))
            violations.push(`capability_not_supported_by_adapter: ${adapterType}/${capability}`);
    }

    return { valid: violations.length === 0, violations, adapterType, capability };
}

// ── getExecution ──────────────────────────────────────────────────────

function getExecution(executionId) {
    if (!executionId) return null;
    return _executions.get(executionId) ?? null;
}

// ── getExecutionMetrics ───────────────────────────────────────────────

function getExecutionMetrics() {
    const all      = [..._executions.values()];
    const byState  = {};
    for (const s of EXECUTION_LIFECYCLE) byState[s] = 0;
    for (const e of all) byState[e.lifecycleState] = (byState[e.lifecycleState] ?? 0) + 1;

    const byAdapter = {};
    for (const e of all) byAdapter[e.adapterType] = (byAdapter[e.adapterType] ?? 0) + 1;

    return {
        totalExecutions:  all.length,
        completedCount:   byState.completed,
        failedCount:      byState.failed,
        quarantinedCount: byState.quarantined,
        cancelledCount:   byState.cancelled,
        activeCount:      all.filter(e => !TERMINAL_STATES.has(e.lifecycleState) && e.lifecycleState !== "failed").length,
        byState,
        byAdapter,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _executions        = new Map();
    _counter           = 0;
    _integrationConfig = null;
}

module.exports = {
    EXECUTION_LIFECYCLE, VALID_TRANSITIONS,
    CAPABILITY_ADAPTER_MAP, ADAPTER_CAPABILITY_MAP,
    configure,
    submitExecution, advanceExecution, cancelExecution,
    quarantineExecution, validateExecution,
    getExecution, getExecutionMetrics, reset,
};
