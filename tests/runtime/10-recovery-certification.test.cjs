"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const prereqGate = require("../../agents/runtime/prerequisiteGate.cjs");
const runtimeOrchestrator = require("../../agents/runtime/runtimeOrchestrator.cjs");

function createAiService(healthy) {
    return {
        async getAIStatus() {
            return { providers: [{ id: "openai", health: { ok: healthy } }] };
        }
    };
}

describe("runtime recovery certification", () => {
    beforeEach(() => {
        prereqGate.resetGateState();
    });

    it("fails closed during repeated prerequisite failures, dispatch() is itself blocked while the gate is blocked, and the gate recovers after restoration", async () => {
        // Mission 60A: this test's own dispatch() call previously ran AFTER
        // the `recovered` check below — but `recovered` uses a healthy mock
        // aiService and a future `now`, which resets prerequisiteGate.cjs's
        // shared _state.blockedUntil to 0 (see checkPrerequisites()'s own
        // `else` branch). By the time dispatch() ran, the gate was already
        // clear, so dispatch()'s internal _checkRuntimeReadiness() evaluated
        // prerequisites fresh against the REAL module-level aiService (not
        // this test's mock — runtimeOrchestrator.cjs's dispatch() has no way
        // to inject one), which genuinely has no reachable AI provider in
        // this environment. dispatch() correctly failed, but via the real
        // legacy-AI-executor's own retry-exhaustion path (error: undefined),
        // never reaching the prerequisites_unavailable short-circuit this
        // test actually meant to exercise — the assertion was testing the
        // wrong moment in the sequence, not a broken gate.
        //
        // Fixed by moving the dispatch() call to right after `blocked` (the
        // gate is still genuinely blocked then — same failingAi state,
        // proven live below) instead of after `recovered`. The post-recovery
        // half of this test's title ("recovers after restoration") is fully
        // covered by the `recovered.ok`/`recovered.blocked` assertions on
        // checkPrerequisites() itself, which are the real, deterministic gate
        // behavior — proving dispatch() ALSO recovers would require
        // injecting a mock aiService into dispatch() itself, a production
        // code change outside this mission's test-only scope.
        const failingAi = createAiService(false);
        const first = await prereqGate.checkPrerequisites({ aiService: failingAi, gitRunner: async () => false });
        const second = await prereqGate.checkPrerequisites({ aiService: failingAi, gitRunner: async () => false });
        const third = await prereqGate.checkPrerequisites({ aiService: failingAi, gitRunner: async () => false });
        const blocked = await prereqGate.checkPrerequisites({ aiService: failingAi, gitRunner: async () => false, now: Date.now() + 10_000 });

        assert.equal(first.ok, false);
        assert.equal(second.ok, false);
        assert.equal(third.ok, false);
        assert.equal(blocked.blocked, true);

        // dispatch() must respect the gate while it is still genuinely
        // blocked — this is the actual "fails closed" contract this test
        // exercises. Real `now` (no time offset), so this runs well within
        // the 60s block window the gate just set.
        const dispatchResult = await runtimeOrchestrator.dispatch("hello", { _skipPrereqGate: false, _internal: true });
        assert.equal(dispatchResult.success, false);
        assert.equal(dispatchResult.error, "prerequisites_unavailable");
        assert.equal(dispatchResult.blocked, true);

        // Gate recovery itself — restoration is real (healthy aiService +
        // healthy gitRunner), not just time passing.
        const recovered = await prereqGate.checkPrerequisites({ aiService: createAiService(true), gitRunner: async () => true, now: Date.now() + 61_000 });
        assert.equal(recovered.ok, true);
        assert.equal(recovered.blocked, false);
    });
});
