"use strict";
/**
 * Workflow 9: Queue and Execution History
 *
 * Tests: orchestrator.queue(), priorityQueue ordering,
 * executionHistory ring cap, DLQ persistence, execLog tail.
 */
const test   = require("node:test");
const assert = require("node:assert/strict");

const orchestrator = require("../../agents/runtime/runtimeOrchestrator.cjs");
const history      = require("../../agents/runtime/executionHistory.cjs");
const dlq          = require("../../agents/runtime/deadLetterQueue.cjs");
const pq           = require("../../agents/runtime/priorityQueue.cjs");
const bus          = require("../../agents/runtime/runtimeEventBus.cjs");

bus.reset();

// ── Priority Queue ────────────────────────────────────────────────

test("priorityQueue: HIGH enqueued after NORMAL dequeues first", () => {
    const q  = pq; // shared module — use unique inputs to identify
    const id1 = q.enqueue({ input: "normal-task-wf9"  }, 1);  // NORMAL
    const id2 = q.enqueue({ input: "high-task-wf9"    }, 0);  // HIGH
    const id3 = q.enqueue({ input: "low-task-wf9"     }, 2);  // LOW

    const first  = q.dequeue();
    const second = q.dequeue();
    const third  = q.dequeue();

    assert.ok(first,  "should dequeue first item");
    assert.ok(second, "should dequeue second item");
    assert.ok(third,  "should dequeue third item");

    // HIGH (priority=0) should come out first
    const firstInput  = first.task.input;
    const secondInput = second.task.input;
    const thirdInput  = third.task.input;

    assert.ok(firstInput === "high-task-wf9", `expected high first, got: "${firstInput}"`);
    assert.ok(thirdInput === "low-task-wf9",  `expected low last, got: "${thirdInput}"`);
    console.log(`  [pq] order: ${firstInput} → ${secondInput} → ${thirdInput}`);
});

test("orchestrator.queue() returns numeric ID each call", () => {
    const id1 = orchestrator.queue("background task A");
    const id2 = orchestrator.queue("background task B");
    assert.ok(id1 !== null && id1 !== undefined);
    assert.ok(id2 !== null && id2 !== undefined);
    assert.ok(id1 !== id2, "IDs should be distinct");
});

test("orchestrator.status() includes queue size", () => {
    const s = orchestrator.status();
    assert.ok(typeof s.queue.size === "number", "queue.size should be number");
    assert.ok(s.queue.size >= 0);
});

// ── Execution History ─────────────────────────────────────────────

test("executionHistory.record() increments stats.total", () => {
    const before = history.stats().total;
    history.record({ agentId: "wf9-agent", taskType: "wf9-test", success: true, durationMs: 10 });
    const after = history.stats().total;
    assert.ok(after > before, `total should grow: before=${before} after=${after}`);
});

test("executionHistory.recent(1) returns our most recent entry", () => {
    const ts = Date.now();
    history.record({ agentId: "wf9-recent", taskType: "wf9-type", success: true, durationMs: 5, input: `ts-${ts}` });
    const r = history.recent(1);
    assert.ok(r.length >= 1);
    assert.equal(r[0].agentId, "wf9-recent");
    assert.ok(r[0].input?.includes(`${ts}`));
});

test("executionHistory.stats().successRate stays in [0,1]", () => {
    // Add some failures
    for (let i = 0; i < 5; i++) {
        history.record({ agentId: "wf9-fail", taskType: "wf9-fail", success: false, durationMs: 1 });
    }
    const s = history.stats();
    assert.ok(s.successRate >= 0 && s.successRate <= 1, `out of range: ${s.successRate}`);
});

test("executionHistory.getAll() returns array ≤ 500", () => {
    const all = history.getAll();
    assert.ok(Array.isArray(all));
    assert.ok(all.length <= 500);
});

// ── Dead-Letter Queue ─────────────────────────────────────────────

test("DLQ: push and list round-trip", () => {
    const taskId = `dlq-wf9-${Date.now()}`;
    dlq.push({ taskId, taskType: "wf9-dlq", input: "dlq test", error: "test error", attempts: 3 });

    const entries = dlq.list();
    const found   = entries.find(e => e.taskId === taskId);
    assert.ok(found, "pushed entry should be in list");
    assert.equal(found.error, "test error");
    assert.equal(found.attempts, 3);
});

test("DLQ: remove() deletes entry by taskId", () => {
    const taskId = `dlq-wf9-rm-${Date.now()}`;
    dlq.push({ taskId, taskType: "wf9-remove", input: "remove me", error: "err", attempts: 1 });

    const before = dlq.size();
    const removed = dlq.remove(taskId);
    const after   = dlq.size();

    assert.equal(removed, true, "remove should return true");
    assert.ok(after < before, `DLQ should shrink: before=${before} after=${after}`);
    assert.ok(!dlq.list().find(e => e.taskId === taskId), "entry should be gone");
});

test("DLQ: remove() returns false for unknown taskId", () => {
    const removed = dlq.remove("nonexistent-task-id-xyz-999");
    assert.equal(removed, false);
});

test.after(() => bus.reset());
