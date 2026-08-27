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

    it("fails closed during repeated prerequisite failures and recovers after restoration", async () => {
        const failingAi = createAiService(false);
        const first = await prereqGate.checkPrerequisites({ aiService: failingAi, gitRunner: async () => false });
        const second = await prereqGate.checkPrerequisites({ aiService: failingAi, gitRunner: async () => false });
        const third = await prereqGate.checkPrerequisites({ aiService: failingAi, gitRunner: async () => false });
        const blocked = await prereqGate.checkPrerequisites({ aiService: failingAi, gitRunner: async () => false, now: Date.now() + 10_000 });
        const recovered = await prereqGate.checkPrerequisites({ aiService: createAiService(true), gitRunner: async () => true, now: Date.now() + 61_000 });

        assert.equal(first.ok, false);
        assert.equal(second.ok, false);
        assert.equal(third.ok, false);
        assert.equal(blocked.blocked, true);
        assert.equal(recovered.ok, true);
        assert.equal(recovered.blocked, false);

        const dispatchResult = await runtimeOrchestrator.dispatch("hello", { _skipPrereqGate: false, _internal: true });
        assert.equal(dispatchResult.success, false);
        assert.equal(dispatchResult.error, "prerequisites_unavailable");
    });
});
