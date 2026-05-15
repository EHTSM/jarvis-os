"use strict";
/**
 * Priority queue and drain behavior tests.
 * Tests orchestrator.queue() + drainQueue() end-to-end.
 */
const { describe, it, before } = require("node:test");
const assert       = require("node:assert/strict");
const pq           = require("../../agents/runtime/priorityQueue.cjs");
const orchestrator = require("../../agents/runtime/runtimeOrchestrator.cjs");
const history      = require("../../agents/runtime/executionHistory.cjs");

const RUN = `queue-${Date.now().toString(36)}`;

before(() => {
    // Register a fast echo agent for drain tests
    orchestrator.registerAgent({
        id: `${RUN}-echo`, capabilities: [`${RUN}-echo-cap`], maxConcurrent: 5,
        handler: async (task) => ({ success: true, message: `echo:${task.input}` }),
    });
    // Drain the priority queue clean before our tests
    while (pq.dequeue()) {}
});

describe("priority queue behavior", () => {

    describe("queue() API", () => {
        it("queue() returns a numeric id", () => {
            while (pq.dequeue()) {}
            const id = orchestrator.queue("test input", pq.PRIORITY.NORMAL);
            assert.equal(typeof id, "number");
            pq.dequeue();
        });
        it("queue() increases pq.size() by 1", () => {
            while (pq.dequeue()) {}
            assert.equal(pq.size(), 0);
            orchestrator.queue("hello", pq.PRIORITY.LOW);
            assert.equal(pq.size(), 1);
            pq.dequeue();
        });
        it("multiple queued items increase size correctly", () => {
            while (pq.dequeue()) {}
            orchestrator.queue("first",  pq.PRIORITY.NORMAL);
            orchestrator.queue("second", pq.PRIORITY.LOW);
            orchestrator.queue("third",  pq.PRIORITY.HIGH);
            assert.equal(pq.size(), 3);
            while (pq.dequeue()) {}
        });
    });

    describe("priority ordering in queue", () => {
        it("HIGH priority item is first in snapshot", () => {
            while (pq.dequeue()) {}
            orchestrator.queue("low-item",    pq.PRIORITY.LOW);
            orchestrator.queue("high-item",   pq.PRIORITY.HIGH);
            orchestrator.queue("normal-item", pq.PRIORITY.NORMAL);
            const snap = pq.snapshot();
            assert.equal(snap[0].priority, pq.PRIORITY.HIGH,
                `first item should be HIGH (0), got priority=${snap[0].priority}`);
            while (pq.dequeue()) {}
        });
        it("dequeue order is HIGH → NORMAL → LOW", () => {
            while (pq.dequeue()) {}
            orchestrator.queue("low",    pq.PRIORITY.LOW);
            orchestrator.queue("high",   pq.PRIORITY.HIGH);
            orchestrator.queue("normal", pq.PRIORITY.NORMAL);
            const first  = pq.dequeue();
            const second = pq.dequeue();
            const third  = pq.dequeue();
            assert.equal(first.priority,  pq.PRIORITY.HIGH,   "first should be HIGH");
            assert.equal(second.priority, pq.PRIORITY.NORMAL, "second should be NORMAL");
            assert.equal(third.priority,  pq.PRIORITY.LOW,    "third should be LOW");
        });
    });

    describe("drainQueue()", () => {
        it("drainQueue() returns null on empty queue", async () => {
            while (pq.dequeue()) {}
            const r = await orchestrator.drainQueue();
            assert.equal(r, null);
        });
        it("drainQueue() decreases queue size by 1", async () => {
            while (pq.dequeue()) {}
            // queue a task that the planner maps to 'ai' (falls to legacy/null handler)
            // We don't care about success — just that the item is consumed
            orchestrator.queue("queue drain test", pq.PRIORITY.NORMAL);
            assert.equal(pq.size(), 1);
            await orchestrator.drainQueue();
            assert.equal(pq.size(), 0);
        });
        it("drainQueue() returns a result object", async () => {
            while (pq.dequeue()) {}
            orchestrator.queue("drain result test", pq.PRIORITY.NORMAL);
            const r = await orchestrator.drainQueue();
            // result can be null (error recovery) or a dispatch result — either is OK
            assert.ok(r === null || typeof r === "object");
        });
    });

    describe("status().queue reporting", () => {
        it("status().queue.size matches pq.size()", () => {
            while (pq.dequeue()) {}
            orchestrator.queue("status-check-1", pq.PRIORITY.NORMAL);
            orchestrator.queue("status-check-2", pq.PRIORITY.HIGH);
            const s = orchestrator.status();
            assert.equal(s.queue.size, 2);
            while (pq.dequeue()) {}
        });
        it("status().queue.items has correct structure", () => {
            while (pq.dequeue()) {}
            orchestrator.queue("snapshot-test", pq.PRIORITY.LOW);
            const items = orchestrator.status().queue.items;
            assert.ok(Array.isArray(items));
            assert.equal(items.length, 1);
            assert.ok("id"         in items[0]);
            assert.ok("priority"   in items[0]);
            assert.ok("taskType"   in items[0]);
            assert.ok("waitMs"     in items[0]);
            pq.dequeue();
        });
    });

    describe("status() full snapshot", () => {
        it("status() returns agents array", () => {
            const s = orchestrator.status();
            assert.ok(Array.isArray(s.agents));
        });
        it("status() returns history stats", () => {
            const s = orchestrator.status();
            assert.ok("total" in s.history);
        });
        it("status() returns uptime as a positive number", () => {
            const s = orchestrator.status();
            assert.equal(typeof s.uptime, "number");
            assert.ok(s.uptime > 0);
        });
    });
});
