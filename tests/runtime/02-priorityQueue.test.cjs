"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const pq = require("../../agents/runtime/priorityQueue.cjs");

describe("priorityQueue", () => {

    describe("empty state", () => {
        it("dequeue on empty returns null", () => {
            // drain anything left from previous subtests
            while (pq.dequeue()) {}
            assert.equal(pq.dequeue(), null);
        });
        it("peek on empty returns null", () => {
            while (pq.dequeue()) {}
            assert.equal(pq.peek(), null);
        });
        it("size on empty returns 0", () => {
            while (pq.dequeue()) {}
            assert.equal(pq.size(), 0);
        });
    });

    describe("single item", () => {
        it("enqueue returns a numeric id", () => {
            while (pq.dequeue()) {}
            const id = pq.enqueue({ type: "ai" }, pq.PRIORITY.NORMAL);
            assert.equal(typeof id, "number");
            pq.dequeue();
        });
        it("dequeued entry contains original task", () => {
            while (pq.dequeue()) {}
            pq.enqueue({ type: "terminal", input: "pwd" }, pq.PRIORITY.NORMAL);
            const entry = pq.dequeue();
            assert.equal(entry.task.type, "terminal");
            assert.equal(entry.task.input, "pwd");
        });
        it("size becomes 1 after enqueue, 0 after dequeue", () => {
            while (pq.dequeue()) {}
            pq.enqueue({ type: "ai" }, pq.PRIORITY.NORMAL);
            assert.equal(pq.size(), 1);
            pq.dequeue();
            assert.equal(pq.size(), 0);
        });
    });

    describe("priority ordering", () => {
        it("HIGH is dequeued before NORMAL", () => {
            while (pq.dequeue()) {}
            pq.enqueue({ label: "normal" }, pq.PRIORITY.NORMAL);
            pq.enqueue({ label: "high"   }, pq.PRIORITY.HIGH);
            const first = pq.dequeue();
            assert.equal(first.task.label, "high");
            pq.dequeue();
        });
        it("NORMAL is dequeued before LOW", () => {
            while (pq.dequeue()) {}
            pq.enqueue({ label: "low"    }, pq.PRIORITY.LOW);
            pq.enqueue({ label: "normal" }, pq.PRIORITY.NORMAL);
            const first = pq.dequeue();
            assert.equal(first.task.label, "normal");
            pq.dequeue();
        });
        it("HIGH > NORMAL > LOW ordering with 3 items", () => {
            while (pq.dequeue()) {}
            pq.enqueue({ label: "low"    }, pq.PRIORITY.LOW);
            pq.enqueue({ label: "normal" }, pq.PRIORITY.NORMAL);
            pq.enqueue({ label: "high"   }, pq.PRIORITY.HIGH);
            assert.equal(pq.dequeue().task.label, "high");
            assert.equal(pq.dequeue().task.label, "normal");
            assert.equal(pq.dequeue().task.label, "low");
        });
        it("FIFO within same priority level", () => {
            while (pq.dequeue()) {}
            pq.enqueue({ label: "first"  }, pq.PRIORITY.NORMAL);
            pq.enqueue({ label: "second" }, pq.PRIORITY.NORMAL);
            assert.equal(pq.dequeue().task.label, "first");
            assert.equal(pq.dequeue().task.label, "second");
        });
    });

    describe("remove()", () => {
        it("returns false for unknown id", () => {
            assert.equal(pq.remove(999999), false);
        });
        it("removes an enqueued item by id", () => {
            while (pq.dequeue()) {}
            const id = pq.enqueue({ label: "to-remove" }, pq.PRIORITY.NORMAL);
            assert.equal(pq.remove(id), true);
            assert.equal(pq.size(), 0);
        });
    });

    describe("snapshot()", () => {
        it("returns array with correct shape", () => {
            while (pq.dequeue()) {}
            pq.enqueue({ type: "dev" }, pq.PRIORITY.HIGH);
            const snap = pq.snapshot();
            assert.ok(Array.isArray(snap));
            assert.equal(snap.length, 1);
            assert.ok("id"         in snap[0]);
            assert.ok("priority"   in snap[0]);
            assert.ok("enqueuedAt" in snap[0]);
            assert.ok("waitMs"     in snap[0]);
            assert.ok("taskType"   in snap[0]);
            assert.equal(snap[0].taskType, "dev");
            pq.dequeue();
        });
    });

    describe("PRIORITY constants", () => {
        it("HIGH=0, NORMAL=1, LOW=2", () => {
            assert.equal(pq.PRIORITY.HIGH,   0);
            assert.equal(pq.PRIORITY.NORMAL, 1);
            assert.equal(pq.PRIORITY.LOW,    2);
        });
    });
});
