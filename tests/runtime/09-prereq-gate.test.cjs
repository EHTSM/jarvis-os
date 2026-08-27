"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const prereqGate = require("../../agents/runtime/prerequisiteGate.cjs");

describe("prerequisite gate", () => {
    beforeEach(() => {
        prereqGate.resetGateState();
    });

    it("blocks execution after repeated prerequisite failures", async () => {
        const aiService = {
            async getAIStatus() {
                return { providers: [{ id: "openai", health: { ok: false, reason: "fail" } }] };
            }
        };

        const gitRunner = async () => {
            throw new Error("git unavailable");
        };

        const first = await prereqGate.checkPrerequisites({ aiService, gitRunner });
        const second = await prereqGate.checkPrerequisites({ aiService, gitRunner });
        const third = await prereqGate.checkPrerequisites({ aiService, gitRunner });
        const fourth = await prereqGate.checkPrerequisites({ aiService, gitRunner });

        assert.equal(first.ok, false);
        assert.equal(second.ok, false);
        assert.equal(third.ok, false);
        assert.equal(fourth.blocked, true);
        assert.equal(fourth.ok, false);
        assert.ok(fourth.reasons.some(r => r.includes("AI") || r.includes("git")));
    });

    it("passes when ai and git are healthy", async () => {
        const aiService = {
            async getAIStatus() {
                return { providers: [{ id: "openai", health: { ok: true } }] };
            }
        };
        const gitRunner = async () => true;

        const result = await prereqGate.checkPrerequisites({ aiService, gitRunner });

        assert.equal(result.ok, true);
        assert.equal(result.blocked, false);
        assert.deepEqual(result.reasons, []);
    });
});
