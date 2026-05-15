"use strict";
/**
 * capabilityAdapter — normalize execution and enforce contracts.
 *
 * execute(capabilityId, input, opts?)
 *   opts: { context?, permissionContext? }
 *   → Promise<{ success, output, durationMs, capabilityId, attempts, error?, blocked? }>
 *
 * stepsToCapabilities(steps)
 *   → [{stepId, capabilityId, input}]  strips steps without capabilityId
 *
 * reset()   — clears registry, telemetry, persistence
 */

const reg  = require("./capabilityRegistry.cjs");
const perm = require("./capabilityPermissions.cjs");
const con  = require("./capabilityContracts.cjs");
const tele = require("./capabilityTelemetry.cjs");
const pers = require("./capabilityPersistence.cjs");
const ret  = require("../execution/retryEngine.cjs");

async function execute(capabilityId, input = {}, opts = {}) {
    const startMs = Date.now();
    const cap = reg.get(capabilityId);

    if (!cap) {
        tele.emit("capability_blocked", { capabilityId, reason: "not_registered" });
        pers.record(capabilityId, { input, success: false, policy: null, durationMs: 0, failureReason: "not_registered", policyDecision: "blocked" });
        return { success: false, output: null, durationMs: 0, capabilityId, attempts: 0, error: `Capability "${capabilityId}" not registered`, blocked: true };
    }

    // Permission check
    if (opts.permissionContext) {
        const check = perm.isAllowed(capabilityId, opts.permissionContext, cap.policy);
        if (!check.allowed) {
            tele.emit("capability_blocked", { capabilityId, reason: check.reason, policy: cap.policy });
            pers.record(capabilityId, { input, success: false, policy: cap.policy, durationMs: 0, failureReason: check.reason, policyDecision: "blocked" });
            return { success: false, output: null, durationMs: 0, capabilityId, attempts: 0, error: `Blocked: ${check.reason}`, blocked: true };
        }
    }

    const contract = cap.contract ?? con.DEFAULT_CONTRACT;

    // Input validation
    const inputVal = con.validateInput(contract, input);
    if (!inputVal.valid) {
        const msg = `Input validation failed: ${inputVal.errors.join("; ")}`;
        tele.emit("capability_failed", { capabilityId, reason: "invalid_input", errors: inputVal.errors });
        pers.record(capabilityId, { input, success: false, policy: cap.policy, durationMs: 0, failureReason: "invalid_input" });
        return { success: false, output: null, durationMs: 0, capabilityId, attempts: 0, error: msg, blocked: false };
    }

    tele.emit("capability_started", { capabilityId, policy: cap.policy });

    // Execute with retry (handler errors are caught; fn always resolves)
    const retPolicy = { maxRetries: 0, ...contract.retryPolicy };
    const retResult = await ret.executeWithRetry(
        async () => {
            try {
                const output = await Promise.resolve(cap.handler(input, opts.context ?? {}));
                return { exitCode: 0, stdout: "", stderr: "", _output: output };
            } catch (err) {
                return { exitCode: 1, stdout: "", stderr: err.message, _error: err };
            }
        },
        { ...retPolicy, retryableExitCodes: retPolicy.retryableExitCodes ?? [1] }
    );

    const durationMs = Date.now() - startMs;
    const rawOutput  = retResult.result?._output ?? null;

    if (!retResult.success) {
        const handlerErr = retResult.result?._error;
        const errMsg = handlerErr?.message ?? retResult.result?.stderr ?? "execution failed";
        tele.emit("capability_failed", { capabilityId, durationMs, attempts: retResult.attempts, error: errMsg });
        pers.record(capabilityId, { input, output: null, policy: cap.policy, durationMs, success: false, failureReason: errMsg });
        return { success: false, output: null, durationMs, capabilityId, attempts: retResult.attempts, error: errMsg, blocked: false };
    }

    // Output validation
    const outputVal = con.validateOutput(contract, rawOutput ?? {});
    if (!outputVal.valid) {
        const msg = `Output validation failed: ${outputVal.errors.join("; ")}`;
        tele.emit("capability_failed", { capabilityId, reason: "invalid_output", errors: outputVal.errors });
        pers.record(capabilityId, { input, output: rawOutput, policy: cap.policy, durationMs, success: false, failureReason: "invalid_output" });
        return { success: false, output: rawOutput, durationMs, capabilityId, attempts: retResult.attempts, error: msg, blocked: false };
    }

    tele.emit("capability_completed", { capabilityId, durationMs, attempts: retResult.attempts });
    pers.record(capabilityId, { input, output: rawOutput, policy: cap.policy, durationMs, success: true });
    return { success: true, output: rawOutput, durationMs, capabilityId, attempts: retResult.attempts, error: null, blocked: false };
}

function stepsToCapabilities(steps = []) {
    return steps
        .filter(s => s.capabilityId)
        .map(s => ({ stepId: s.id, capabilityId: s.capabilityId, input: s.capabilityInput ?? {} }));
}

function reset() {
    reg.reset();
    tele.reset();
    pers.reset();
}

module.exports = { execute, stepsToCapabilities, reset };
