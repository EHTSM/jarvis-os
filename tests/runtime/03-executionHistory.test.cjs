"use strict";
const { describe, it, before } = require("node:test");
const assert  = require("node:assert/strict");
const history = require("../../agents/runtime/executionHistory.cjs");

// Helper — build a minimal valid history entry
function entry(overrides = {}) {
    return {
        agentId:    "test-agent",
        taskType:   "ai",
        taskId:     "t-" + Math.random().toString(36).slice(2),
        success:    true,
        durationMs: 100,
        input:      "test input",
        output:     "test output",
        ...overrides,
    };
}

describe("executionHistory", () => {

    describe("record() and recent()", () => {
        it("recent() returns empty array before any records", () => {
            // Fresh module in fresh process — ring is empty
            const r = history.recent(1);
            assert.ok(Array.isArray(r));
        });
        it("recorded entry appears in recent()", () => {
            history.record(entry({ agentId: "agent-A", taskType: "web_search" }));
            const r = history.recent(10);
            const found = r.find(e => e.agentId === "agent-A" && e.taskType === "web_search");
            assert.ok(found, "recorded entry not found in recent()");
        });
        it("recent() returns newest first", () => {
            history.record(entry({ agentId: "order-test", taskType: "first"  }));
            history.record(entry({ agentId: "order-test", taskType: "second" }));
            const r = history.recent(10).filter(e => e.agentId === "order-test");
            assert.equal(r[0].taskType, "second");
            assert.equal(r[1].taskType, "first");
        });
        it("recent(n) respects the n limit", () => {
            for (let i = 0; i < 5; i++) history.record(entry());
            const r = history.recent(2);
            assert.ok(r.length <= 2);
        });
    });

    describe("byAgent()", () => {
        it("returns entries for matching agentId only", () => {
            history.record(entry({ agentId: "agent-X", taskType: "terminal" }));
            history.record(entry({ agentId: "agent-Y", taskType: "dev"      }));
            const r = history.byAgent("agent-X");
            assert.ok(r.every(e => e.agentId === "agent-X"),
                "byAgent() returned entry with wrong agentId");
        });
        it("returns empty array for unknown agentId", () => {
            const r = history.byAgent("does-not-exist-xyz");
            assert.ok(Array.isArray(r));
            assert.equal(r.length, 0);
        });
    });

    describe("byType()", () => {
        it("returns entries for matching taskType only", () => {
            history.record(entry({ agentId: "type-test", taskType: "type-alpha" }));
            history.record(entry({ agentId: "type-test", taskType: "type-beta"  }));
            const r = history.byType("type-alpha");
            assert.ok(r.every(e => e.taskType === "type-alpha"),
                "byType() returned entry with wrong taskType");
        });
        it("returns empty array for unknown type", () => {
            const r = history.byType("type-does-not-exist-xyz");
            assert.equal(r.length, 0);
        });
    });

    describe("stats()", () => {
        before(() => {
            // Record two successes and one failure for predictable stats
            history.record(entry({ agentId: "stats-test", success: true,  durationMs: 200 }));
            history.record(entry({ agentId: "stats-test", success: true,  durationMs: 400 }));
            history.record(entry({ agentId: "stats-test", success: false, durationMs: 50  }));
        });
        it("stats() returns required fields", () => {
            const s = history.stats();
            assert.ok("total"        in s);
            assert.ok("succeeded"    in s);
            assert.ok("failed"       in s);
            assert.ok("successRate"  in s);
            assert.ok("avgDurationMs" in s);
            assert.ok("uniqueAgents" in s);
            assert.ok("uniqueTypes"  in s);
        });
        it("successRate is between 0 and 1", () => {
            const { successRate } = history.stats();
            assert.ok(successRate >= 0 && successRate <= 1,
                `successRate ${successRate} out of range`);
        });
        it("succeeded + failed == total", () => {
            const { total, succeeded, failed } = history.stats();
            assert.equal(succeeded + failed, total);
        });
        it("avgDurationMs is a non-negative number", () => {
            const { avgDurationMs } = history.stats();
            assert.equal(typeof avgDurationMs, "number");
            assert.ok(avgDurationMs >= 0);
        });
    });

    describe("entry shape", () => {
        it("stored entry has required fields", () => {
            history.record(entry({ agentId: "shape-test", taskType: "shape-check" }));
            const r = history.byAgent("shape-test");
            const e = r[0];
            assert.ok(e, "entry not found");
            assert.ok("agentId"    in e);
            assert.ok("taskType"   in e);
            assert.ok("taskId"     in e);
            assert.ok("success"    in e);
            assert.ok("durationMs" in e);
            assert.ok("ts"         in e);
        });
        it("input/output are capped at 120 chars", () => {
            const long = "x".repeat(300);
            history.record(entry({ agentId: "cap-test", taskType: "cap-check", input: long, output: long }));
            const r = history.byAgent("cap-test")[0];
            assert.ok(r.input.length  <= 120);
            assert.ok(r.output.length <= 120);
        });
    });
});
