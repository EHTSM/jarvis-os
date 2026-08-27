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
 *
 * Mission 60A: executeTask() routes via
 * agentRegistry.findForCapability(router.resolveCapability(task.type)) —
 * it looks up the RESOLVED capability, never the raw task.type. This test
 * originally registered its synthetic agents under capabilities
 * "honesty_probe"/"honesty_probe_ok", which are not in taskRouter.cjs's
 * TASK_TYPE_MAP, so resolveCapability() fell back to the generic "ai"
 * capability for both — meaning findForCapability("ai") never matched
 * either registered agent (no "ai" agent is registered in this bare
 * process), and both dispatches silently fell through to the legacy
 * executor path instead of the registered-agent branch this test exists
 * to verify. Fixed by using real, already-mapped task.type values —
 * "web_search" (→"browser") and "open_app" (→"desktop") — matching the
 * established, working pattern 06-retry.test.cjs already uses (real
 * mapped task.type, unique capability, registered test agent for that
 * exact capability). No assertion was weakened — the same success/result/
 * error/agentId checks still run, now against the branch they were
 * written to test.
 */
const { describe, it, before } = require("node:test");
const assert       = require("node:assert/strict");
const orchestrator = require("../../agents/runtime/runtimeOrchestrator.cjs");
const engine       = require("../../agents/runtime/executionEngine.cjs");
const router       = require("../../agents/runtime/taskRouter.cjs");

const RUN = `honesty-${Date.now().toString(36)}`;

// Real task.type values already mapped by taskRouter.cjs's TASK_TYPE_MAP —
// resolveCapability() must actually route to these agents' own
// capabilities, not silently collapse to the "ai" fallback.
const SOFT_FAIL_TASK_TYPE = "web_search";
const GENUINE_TASK_TYPE   = "open_app";

before(() => {
    assert.equal(router.resolveCapability(SOFT_FAIL_TASK_TYPE), "browser",
        `test setup: taskRouter.cjs must still map "${SOFT_FAIL_TASK_TYPE}" to "browser" — if this changed, update SOFT_FAIL_TASK_TYPE above to another mapped type`);
    assert.equal(router.resolveCapability(GENUINE_TASK_TYPE), "desktop",
        `test setup: taskRouter.cjs must still map "${GENUINE_TASK_TYPE}" to "desktop" — if this changed, update GENUINE_TASK_TYPE above to another mapped type`);

    // A registered agent whose handler does NOT throw but reports its own
    // failure via result.success === false — the exact shape terminalAgent/
    // the "ai" agent use in production for allowlist blocks / missing
    // credentials.
    orchestrator.registerAgent({
        id: `${RUN}-soft-failer`, capabilities: ["browser"], maxConcurrent: 2,
        handler: async () => ({ success: false, error: "simulated_blocked_command" }),
    });
    orchestrator.registerAgent({
        id: `${RUN}-genuine`, capabilities: ["desktop"], maxConcurrent: 2,
        handler: async () => ({ success: true, message: "genuinely fine" }),
    });
});

describe("RUNTIME-1 — executeTask() honours a registered agent's own reported failure", () => {
    it("executeTask() reports success:false (not true) when the handler resolves with {success:false} instead of throwing", async () => {
        const r = await engine.executeTask(
            { type: SOFT_FAIL_TASK_TYPE, payload: {}, input: "probe" },
            { retries: 1 }
        );
        assert.equal(r.success, false, "executeTask() must not report success:true for a handler-reported soft failure");
        assert.equal(r.result.success, false, "the original handler result must still be attached, not nulled");
        assert.match(r.error, /simulated_blocked_command/);
        assert.equal(r.agentId, `${RUN}-soft-failer`, "agentId must still be attributed, not nulled");
    });

    it("executeTask() still reports success:true for a genuinely successful handler on a different capability (no false negative introduced)", async () => {
        const r = await engine.executeTask(
            { type: GENUINE_TASK_TYPE, payload: {}, input: "probe-ok" },
            { retries: 1 }
        );
        assert.equal(r.success, true);
        assert.equal(r.result.message, "genuinely fine");
    });
});
