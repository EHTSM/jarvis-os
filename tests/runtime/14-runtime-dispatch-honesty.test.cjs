"use strict";
/**
 * Runtime OS verification pass (2026-08-15) — RUNTIME-1.
 *
 * executionEngine.executeTask()'s registered-agent branch unconditionally
 * returned { success:true } whenever agent.handler() resolved without
 * throwing — even when the handler's own returned object said
 * { success:false, error }. This is the exact shape terminalAgent uses for
 * an allowlist/blocked-command rejection and the "ai" agent uses when no
 * provider credentials are configured (both live-reproduced against a real
 * running server — bootstrapRuntime.cjs registers both as real registered
 * agents at boot — this pass; see reports/OS-RUNTIME-SECURITY.md /
 * OS-RUNTIME-FINAL.md for the live evidence). The sibling "no registered
 * agent" (legacy executor) branch just below already carried this exact
 * honesty check (`softFailed`) — this branch was the one place still
 * missing it, which made runtimeOrchestrator.dispatch()'s aggregate
 * `success` (and CommandCenter.jsx's dispatch bar, which reads that field
 * directly to decide whether to show a green "Done." state) report a false
 * positive for a genuinely blocked/failed command.
 *
 * This unit test exercises executeTask() directly against a synthetic
 * registered agent (a bare `node --test` process does not load
 * bootstrapRuntime.cjs, so the real terminal/ai agents are not registered
 * here — the live end-to-end reproduction against the real terminal agent
 * on a running server is documented in this pass's OS-RUNTIME reports, not
 * re-encoded here as a unit test to avoid a process-boot dependency).
 *
 * Fix: the registered-agent branch now also checks result.success===false
 * and reports failure (recordFailure() on the agent, not recordSuccess()),
 * mirroring the legacy branch's own established pattern — no new
 * failure-detection concept invented.
 */
const { describe, it, before } = require("node:test");
const assert       = require("node:assert/strict");
const orchestrator = require("../../agents/runtime/runtimeOrchestrator.cjs");
const engine       = require("../../agents/runtime/executionEngine.cjs");

const RUN = `honesty-${Date.now().toString(36)}`;

before(() => {
    // A registered agent whose handler does NOT throw but reports its own
    // failure via result.success === false — the exact shape terminalAgent/
    // the "ai" agent use in production for allowlist blocks / missing
    // credentials.
    orchestrator.registerAgent({
        id: `${RUN}-soft-failer`, capabilities: ["honesty_probe"], maxConcurrent: 2,
        handler: async () => ({ success: false, error: "simulated_blocked_command" }),
    });
    orchestrator.registerAgent({
        id: `${RUN}-genuine`, capabilities: ["honesty_probe_ok"], maxConcurrent: 2,
        handler: async () => ({ success: true, message: "genuinely fine" }),
    });
});

describe("RUNTIME-1 — executeTask() honours a registered agent's own reported failure", () => {
    it("executeTask() reports success:false (not true) when the handler resolves with {success:false} instead of throwing", async () => {
        const r = await engine.executeTask(
            { type: "honesty_probe", payload: {}, input: "probe" },
            { retries: 1 }
        );
        assert.equal(r.success, false, "executeTask() must not report success:true for a handler-reported soft failure");
        assert.equal(r.result.success, false, "the original handler result must still be attached, not nulled");
        assert.match(r.error, /simulated_blocked_command/);
        assert.equal(r.agentId, `${RUN}-soft-failer`, "agentId must still be attributed, not nulled");
    });

    it("executeTask() still reports success:true for a genuinely successful handler on a different capability (no false negative introduced)", async () => {
        const r = await engine.executeTask(
            { type: "honesty_probe_ok", payload: {}, input: "probe-ok" },
            { retries: 1 }
        );
        assert.equal(r.success, true);
        assert.equal(r.result.message, "genuinely fine");
    });
});
