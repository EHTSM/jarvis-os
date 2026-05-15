"use strict";
/**
 * sandboxBridge — sandbox constraints and checkpoint enforcement for risky executions.
 *
 * shouldSandbox(capability, context)           → SandboxDecision
 * applySandboxConstraints(budget, capability)  → ConstrainedBudget
 * createSandboxContext(execId, capability, ctx)→ SandboxContext
 * checkpointRequired(capability, context)      → boolean
 * validateSandboxExit(sandboxId, result)       → ExitValidation
 * getSandboxStats()                            → Stats
 * reset()
 */

// Classification → sandbox constraints
const SANDBOX_CONSTRAINTS = {
    safe: {
        requiresSandbox:      false,
        retryMultiplier:      1.0,
        verificationStrict:   false,
        checkpointRequired:   false,
        maxParallel:          10,
    },
    elevated: {
        requiresSandbox:      false,
        retryMultiplier:      0.8,
        verificationStrict:   false,
        checkpointRequired:   false,
        maxParallel:          5,
    },
    dangerous: {
        requiresSandbox:      true,
        retryMultiplier:      0.5,    // cut retries in half
        verificationStrict:   true,
        checkpointRequired:   true,
        maxParallel:          2,
    },
    destructive: {
        requiresSandbox:      true,
        retryMultiplier:      0.2,    // almost no retries
        verificationStrict:   true,
        checkpointRequired:   true,
        maxParallel:          1,
    },
};

// Additional triggers for auto-sandboxing
const AUTO_SANDBOX_TRIGGERS = {
    pressureThreshold:    0.60,   // sandbox all elevated+ when pressure is high
    healthThreshold:      0.50,   // sandbox all elevated+ when health is degraded
    anomalyThreshold:     2,      // sandbox when 2+ active anomalies
};

let _sandboxContexts = new Map();   // sandboxId → SandboxContext
let _counter         = 0;

// ── shouldSandbox ─────────────────────────────────────────────────────

function shouldSandbox(capability = {}, context = {}) {
    const classification = capability.classification ?? "safe";
    const constraints    = SANDBOX_CONSTRAINTS[classification] ?? SANDBOX_CONSTRAINTS.safe;
    const reasons        = [];

    let sandbox = constraints.requiresSandbox;
    if (sandbox) reasons.push(`classification_${classification}_requires_sandbox`);

    // Auto-sandbox triggers
    const pressure    = context.pressure    ?? 0;
    const health      = context.health      ?? 1;
    const anomalies   = context.anomalyCount ?? 0;

    if (!sandbox && classification !== "safe") {
        if (pressure >= AUTO_SANDBOX_TRIGGERS.pressureThreshold) {
            sandbox = true;
            reasons.push(`auto_sandbox_pressure: ${pressure.toFixed(2)} >= ${AUTO_SANDBOX_TRIGGERS.pressureThreshold.toFixed(2)}`);
        }
        if (health < AUTO_SANDBOX_TRIGGERS.healthThreshold) {
            sandbox = true;
            reasons.push(`auto_sandbox_health: ${health.toFixed(2)} < ${AUTO_SANDBOX_TRIGGERS.healthThreshold.toFixed(2)}`);
        }
        if (anomalies >= AUTO_SANDBOX_TRIGGERS.anomalyThreshold) {
            sandbox = true;
            reasons.push(`auto_sandbox_anomalies: ${anomalies} active anomalies`);
        }
    }

    if (!sandbox) reasons.push(`no_sandbox_required: ${classification} under nominal conditions`);

    return {
        sandbox,
        classification,
        reasons:            reasons.join("; "),
        verificationStrict: sandbox || constraints.verificationStrict,
        checkpointRequired: sandbox || constraints.checkpointRequired,
    };
}

// ── applySandboxConstraints ───────────────────────────────────────────

function applySandboxConstraints(budget = {}, capability = {}) {
    const classification = capability.classification ?? "safe";
    const constraints    = SANDBOX_CONSTRAINTS[classification] ?? SANDBOX_CONSTRAINTS.safe;
    const sandboxed      = budget.sandboxed ?? constraints.requiresSandbox;

    const maxRetries    = Math.max(1, Math.floor((budget.maxRetries ?? 3) * constraints.retryMultiplier));
    // Compress timeout for sandboxed executions (cap at 2x standard)
    const timeoutMs     = sandboxed
        ? Math.min(budget.timeoutMs ?? 10000, 30000)   // hard cap at 30s in sandbox
        : budget.timeoutMs ?? 10000;
    const memoryUnits   = Math.max(1, Math.floor((budget.memoryUnits ?? 5) * constraints.retryMultiplier));

    return {
        maxRetries,
        timeoutMs,
        memoryUnits,
        sandboxed,
        verificationStrict: constraints.verificationStrict || sandboxed,
        checkpointRequired: constraints.checkpointRequired || sandboxed,
        maxParallel:        constraints.maxParallel,
        originalMaxRetries: budget.maxRetries ?? 3,
        constraintApplied:  constraints.retryMultiplier < 1.0,
    };
}

// ── createSandboxContext ──────────────────────────────────────────────

function createSandboxContext(execId, capability = {}, ctx = {}) {
    const sandboxId  = `sbx-${++_counter}`;
    const decision   = shouldSandbox(capability, ctx);
    const budget     = applySandboxConstraints(ctx.budget ?? {}, capability);

    const context = {
        sandboxId,
        execId,
        capId:              capability.capId,
        classification:     capability.classification ?? "safe",
        isolation:          decision.sandbox ? "sandboxed" : (ctx.isolation ?? "standard"),
        budget,
        verificationStrict: decision.verificationStrict,
        checkpointRequired: decision.checkpointRequired,
        status:             "active",   // active | exited | aborted
        createdAt:          new Date().toISOString(),
        exitedAt:           null,
        exitReason:         null,
    };

    _sandboxContexts.set(sandboxId, context);
    return { sandboxId, ...context };
}

// ── checkpointRequired ────────────────────────────────────────────────

function checkpointRequired(capability = {}, context = {}) {
    const decision = shouldSandbox(capability, context);
    return decision.checkpointRequired;
}

// ── validateSandboxExit ───────────────────────────────────────────────

function validateSandboxExit(sandboxId, result = {}) {
    const ctx = _sandboxContexts.get(sandboxId);
    if (!ctx) return { valid: false, reason: "sandbox_not_found" };

    const exitCode    = result.exitCode   ?? 0;
    const verified    = result.verified   ?? false;
    const clean       = result.clean      ?? true;

    const violations  = [];
    if (ctx.verificationStrict && !verified) violations.push("strict_verification_failed");
    if (exitCode !== 0)                       violations.push(`non_zero_exit: ${exitCode}`);
    if (!clean)                               violations.push("sandbox_state_dirty");

    ctx.status    = violations.length > 0 ? "exited_with_violations" : "exited";
    ctx.exitedAt  = new Date().toISOString();
    ctx.exitReason = violations.length > 0 ? violations.join("; ") : "clean_exit";

    return {
        valid:      violations.length === 0,
        sandboxId,
        violations,
        exitReason: ctx.exitReason,
    };
}

// ── getSandboxStats ───────────────────────────────────────────────────

function getSandboxStats() {
    const all      = [..._sandboxContexts.values()];
    const active   = all.filter(s => s.status === "active").length;
    const exited   = all.filter(s => s.status === "exited").length;
    const violated = all.filter(s => s.status === "exited_with_violations").length;
    return {
        total:     all.length,
        active,
        exited,
        violated,
        cleanRate: all.length > 0 ? +(exited / all.length).toFixed(3) : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _sandboxContexts = new Map();
    _counter         = 0;
}

module.exports = {
    SANDBOX_CONSTRAINTS, AUTO_SANDBOX_TRIGGERS,
    shouldSandbox, applySandboxConstraints, createSandboxContext,
    checkpointRequired, validateSandboxExit, getSandboxStats, reset,
};
