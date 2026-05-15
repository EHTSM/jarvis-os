"use strict";
/**
 * PHASE 3 — Memory + Resource Stability
 * Detects heap leaks in key modules by measuring heap before/after
 * repeated operations. Flags if heap grows > configured threshold.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// ── helpers ──────────────────────────────────────────────────────────────────

function heapMB() {
    return process.memoryUsage().heapUsed / 1_048_576;
}

// Run fn N times, return heap delta in MB
async function measureLeak(fn, iterations, gcBetween = true) {
    if (gcBetween && global.gc) global.gc();
    const before = heapMB();
    for (let i = 0; i < iterations; i++) await fn(i);
    if (gcBetween && global.gc) global.gc();
    const after = heapMB();
    return after - before;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("Phase 3 — Memory Stability", { concurrency: 1 }, () => {

    it("baseline heap usage is below 400 MB on start", () => {
        const mb = heapMB();
        assert.ok(mb < 400, `Heap already at ${mb.toFixed(1)}MB on test start — possible pre-existing leak`);
    });

    it("taskQueue: 500 add+delete cycles leave heap growth < 20 MB", async () => {
        const tq = require("../../agents/taskQueue.cjs");
        const delta = await measureLeak(async (i) => {
            const t = tq.addTask({ input: `mem-test-${i}`, type: "auto" });
            tq.deleteTask(t.id);
        }, 500);
        assert.ok(delta < 20, `taskQueue add+delete leaked ${delta.toFixed(1)}MB over 500 iterations`);
    });

    it("taskQueue: 200 getAll() calls leave heap growth < 10 MB", async () => {
        const tq = require("../../agents/taskQueue.cjs");
        const delta = await measureLeak(() => {
            tq.getAll();
        }, 200);
        assert.ok(delta < 10, `taskQueue.getAll() leaked ${delta.toFixed(1)}MB over 200 calls`);
    });

    it("taskQueue: 200 getHealthReport() calls leave heap growth < 10 MB", async () => {
        const tq = require("../../agents/taskQueue.cjs");
        const delta = await measureLeak(() => {
            tq.getHealthReport();
        }, 200);
        assert.ok(delta < 10, `getHealthReport() leaked ${delta.toFixed(1)}MB over 200 calls`);
    });

    it("supervisor: 100 filesystem read routes leave heap growth < 15 MB", async () => {
        const supervisor = require("../../agents/runtime/adapters/executionAdapterSupervisor.cjs");
        const delta = await measureLeak(async () => {
            try {
                await supervisor.routeExecution({
                    adapterType: "filesystem",
                    command:     "read",
                    filePath:    "package.json"
                });
            } catch { /* read may fail in sandbox — we're testing memory, not correctness */ }
        }, 100);
        assert.ok(delta < 15, `supervisor filesystem leaked ${delta.toFixed(1)}MB over 100 calls`);
    });

    it("supervisor: getRecentExecutions() doesn't grow unbounded after 200 calls", async () => {
        const supervisor = require("../../agents/runtime/adapters/executionAdapterSupervisor.cjs");
        if (global.gc) global.gc();
        const before = heapMB();
        for (let i = 0; i < 200; i++) supervisor.getRecentExecutions(50);
        if (global.gc) global.gc();
        const delta = heapMB() - before;
        assert.ok(delta < 10, `getRecentExecutions() leaked ${delta.toFixed(1)}MB`);
    });

    it("parser: 1000 parse calls leave heap growth < 5 MB", async () => {
        const { parseCommand } = require("../../backend/utils/parser.js");
        const inputs = [
            "hello", "run ls -la", "create file test.txt with hello",
            "buy now", "add lead John", "what is the weather"
        ];
        const delta = await measureLeak((i) => {
            parseCommand(inputs[i % inputs.length]);
        }, 1000);
        assert.ok(delta < 5, `parser leaked ${delta.toFixed(1)}MB over 1000 calls`);
    });

    it("heap under 400 MB after all memory tests", () => {
        if (global.gc) global.gc();
        const mb = heapMB();
        assert.ok(mb < 400, `Heap at ${mb.toFixed(1)}MB after memory tests — potential leak`);
    });

});
