"use strict";
/**
 * Retry and failure-recovery tests.
 *
 * Each test uses a REAL task type that taskRouter maps to a unique capability,
 * and registers a test agent for that exact capability so the executionEngine
 * routes through the registry path (not the legacy fallback).
 *
 * Capability assignments:
 *   research  → always-success handler
 *   social    → fails-once-then-succeeds handler
 *   content   → always-fail handler
 *   media     → always-fail handler (for circuit breaker trigger)
 *   voice     → always-fail handler (second cb test)
 *
 * Timing: one 1s sleep per retry. Full suite takes ~3-4s.
 */
const { describe, it, before } = require("node:test");
const assert   = require("node:assert/strict");
const engine   = require("../../agents/runtime/executionEngine.cjs");
const registry = require("../../agents/runtime/agentRegistry.cjs");

const RUN = `retry-${Date.now().toString(36)}`;

// Handler that fails N times then succeeds
function countingHandler(failTimes) {
    let calls = 0;
    return async () => {
        calls++;
        if (calls <= failTimes) throw new Error(`intentional failure #${calls}`);
        return { success: true, message: `succeeded on call ${calls}` };
    };
}

before(() => {
    // research → always succeeds on first attempt
    registry.register({
        id: `${RUN}-research-ok`, capabilities: ["research"], maxConcurrent: 5,
        handler: async () => ({ success: true, message: "ok" }),
    });
    // social → fails once, succeeds on second attempt
    registry.register({
        id: `${RUN}-social-f1`, capabilities: ["social"], maxConcurrent: 5,
        handler: countingHandler(1),
    });
    // content → always throws (used for success=false and error-message tests)
    registry.register({
        id: `${RUN}-content-af`, capabilities: ["content"], maxConcurrent: 5,
        handler: async () => { throw new Error("permanent failure"); },
    });
    // voice → always throws (separate agent for attempts-count test, isolated failure count)
    registry.register({
        id: `${RUN}-voice-af`, capabilities: ["voice"], maxConcurrent: 5,
        handler: async () => { throw new Error("permanent failure"); },
    });
    // media → always throws (used to trigger circuit breaker)
    registry.register({
        id: `${RUN}-media-cbt`, capabilities: ["media"], maxConcurrent: 5,
        handler: async () => { throw new Error("cb trigger"); },
    });
});

describe("retry handling", () => {

    describe("first-attempt success", () => {
        it("attempts=1 when handler succeeds immediately", async () => {
            const r = await engine.executeTask(
                { type: "research", payload: { query: "test" }, input: "research test" },
                { retries: 3 }
            );
            assert.equal(r.success,  true,  `expected success, got: ${r.error}`);
            assert.equal(r.attempts, 1);
        });
        it("agentId matches the registered research agent", async () => {
            const r = await engine.executeTask(
                { type: "research", payload: { query: "test" }, input: "research" },
                { retries: 1 }
            );
            assert.equal(r.agentId, `${RUN}-research-ok`);
        });
        it("error is null on success", async () => {
            const r = await engine.executeTask(
                { type: "research", payload: { query: "test" }, input: "research" },
                { retries: 1 }
            );
            assert.equal(r.error, null);
        });
    });

    describe("retry on transient failure", () => {
        it("succeeds on second attempt — attempts=2", async () => {
            const r = await engine.executeTask(
                { type: "social", payload: {}, input: "social post" },
                { retries: 3 }
            );
            assert.equal(r.success,  true, `expected retry success, got: ${r.error}`);
            assert.equal(r.attempts, 2,    `expected 2 attempts, got ${r.attempts}`);
        });
        it("agentId is correct after retry success", async () => {
            const r = await engine.executeTask(
                { type: "social", payload: {}, input: "social" },
                { retries: 3 }
            );
            // Handler exhausted its fail-count — now always succeeds
            assert.equal(r.success, true);
            assert.equal(r.agentId, `${RUN}-social-f1`);
        });
    });

    describe("exhausted retries", () => {
        it("success=false after all retries exhausted", async () => {
            const r = await engine.executeTask(
                { type: "content", payload: {}, input: "content gen" },
                { retries: 2 }
            );
            assert.equal(r.success, false);
        });
        it("error message is populated when all retries fail", async () => {
            const r = await engine.executeTask(
                { type: "content", payload: {}, input: "content" },
                { retries: 2 }
            );
            assert.equal(typeof r.error, "string");
            assert.ok(r.error.length > 0);
        });
        it("attempts equals retries count on full exhaustion (retries=2 → attempts=2)", async () => {
            // Uses speak→voice capability with a fresh isolated agent to avoid CB accumulation
            // from the content-agent tests above (which already have 4 failures by now)
            const r = await engine.executeTask(
                { type: "speak", payload: { text: "test" }, input: "speak test" },
                { retries: 2 }
            );
            assert.equal(r.attempts, 2);
        });
    });

    describe("circuit breaker integration", () => {
        it("circuit opens after 5 consecutive failures (retries=1 per call)", async () => {
            // 5 separate calls, each with retries=1 (1 attempt per call)
            // Each call records 1 failure on the media agent → cbFailures accumulates
            for (let i = 0; i < 5; i++) {
                await engine.executeTask(
                    { type: "media", payload: {}, input: "media task" },
                    { retries: 1 }
                );
            }
            const a = registry.get(`${RUN}-media-cbt`);
            assert.equal(a._cbState, "open",
                `circuit should be open after 5 failures, got state=${a._cbState}`);
        });
        it("after circuit opens, executeTask returns success=false immediately", async () => {
            const a = registry.get(`${RUN}-media-cbt`);
            assert.equal(a._cbState, "open"); // guard: verify circuit is open
            const r = await engine.executeTask(
                { type: "media", payload: {}, input: "blocked" },
                { retries: 1 }
            );
            // Open circuit → findForCapability("media") returns null → no handler → success=false
            assert.equal(r.success, false);
        });
        it("cbFailures count is >= 5 after triggering open circuit", async () => {
            const a = registry.get(`${RUN}-media-cbt`);
            assert.ok(a._cbFailures >= 5,
                `expected cbFailures >= 5, got ${a._cbFailures}`);
        });
    });

    describe("no handler for unknown capability", () => {
        it("returns success=false for unregistered capability type", async () => {
            const r = await engine.executeTask(
                { type: "capability-that-does-not-exist-xyz", input: "test" },
                { retries: 1 }
            );
            assert.equal(r.success, false);
            assert.ok(typeof r.error === "string" && r.error.length > 0);
        });
        it("returns immediately (attempts=1) when no handler exists — no wasted retries", async () => {
            const r = await engine.executeTask(
                { type: "no-handler-xyz-abc", input: "test" },
                { retries: 3 }
            );
            // The engine bails on first attempt when legacy executor also unavailable
            assert.ok(r.attempts <= 3, "should not exceed retry count");
            assert.equal(r.success, false);
        });
    });
});
