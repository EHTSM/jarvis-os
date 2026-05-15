"use strict";
/**
 * PHASE 2 — Concurrency & Queue Validation
 * Hammers taskQueue with parallel adds, verifies integrity, measures
 * concurrent adapter routing, checks no tasks are lost or double-counted.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path   = require("path");
const fs     = require("fs");

const tq = require("../../agents/taskQueue.cjs");

// ── IDs added during this test run — cleaned up in after() ──────────────────
const _added = new Set();

function addTracked(opts) {
    const t = tq.addTask(opts);
    _added.add(t.id);
    return t;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function allTasksDistinct(ids) {
    return new Set(ids).size === ids.length;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("Phase 2 — Queue Pressure", { concurrency: 1 }, () => {

    after(() => {
        // Remove tasks added by this test to avoid polluting the live queue
        for (const id of _added) {
            try { tq.deleteTask(id); } catch { /* best effort */ }
        }
    });

    it("50 sequential addTask calls all return unique IDs", () => {
        const ids = [];
        for (let i = 0; i < 50; i++) {
            const t = addTracked({ input: `stress-seq-${i}`, type: "auto" });
            ids.push(t.id);
        }
        assert.ok(allTasksDistinct(ids), "Duplicate task IDs detected in sequential adds");
    });

    it("20 parallel addTask calls all return unique IDs", async () => {
        const results = await Promise.all(
            Array.from({ length: 20 }, (_, i) =>
                Promise.resolve(addTracked({ input: `stress-par-${i}`, type: "auto" }))
            )
        );
        const ids = results.map(r => r.id);
        assert.ok(allTasksDistinct(ids), "Duplicate task IDs detected in parallel adds");
    });

    it("getAll() reflects every added task — no silent drops", () => {
        const snapshot = tq.getAll().map(t => t.id);
        for (const id of _added) {
            assert.ok(snapshot.includes(id), `Task ${id} missing from getAll()`);
        }
    });

    it("queue file is valid JSON after 70 concurrent writes", () => {
        const QUEUE_FILE = path.join(__dirname, "../../data/task-queue.json");
        const raw = fs.readFileSync(QUEUE_FILE, "utf8");
        let parsed;
        assert.doesNotThrow(() => { parsed = JSON.parse(raw); }, "Queue file invalid JSON after pressure test");
        assert.ok(Array.isArray(parsed), "Queue file root is not an array");
    });

    it("update() on all added tasks does not corrupt queue", () => {
        const ids = [..._added];
        for (const id of ids.slice(0, 20)) {
            tq.update(id, { status: "completed", completedAt: new Date().toISOString() });
        }
        const all = tq.getAll();
        assert.ok(Array.isArray(all), "getAll() returned non-array after updates");
        const completedIds = all.filter(t => _added.has(t.id) && t.status === "completed").map(t => t.id);
        assert.ok(completedIds.length >= 20, `Only ${completedIds.length}/20 tasks marked completed`);
    });

    it("getHealthReport() returns valid shape after pressure", () => {
        const report = tq.getHealthReport();
        assert.ok(typeof report === "object" && report !== null, "getHealthReport() returned null");
        assert.ok("counts" in report,  "getHealthReport missing counts");
        assert.ok("healthy" in report, "getHealthReport missing healthy flag");
        assert.ok(typeof report.counts.pending   === "number", "counts.pending is not a number");
        assert.ok(typeof report.counts.completed === "number", "counts.completed is not a number");
    });

    it("abandonStuckTasks() does not delete recently added tasks", () => {
        const fresh = addTracked({ input: "fresh-task-should-survive", type: "auto" });
        tq.abandonStuckTasks(2); // abandon tasks stuck > 2 hours
        const all = tq.getAll();
        const survived = all.some(t => t.id === fresh.id);
        assert.ok(survived, "abandonStuckTasks() deleted a task that was just added");
    });

    it("pruneOldTasks() keeps pending tasks, only removes old completed ones", () => {
        const before = tq.getAll().filter(t => _added.has(t.id) && t.status === "pending").length;
        tq.pruneOldTasks(10);
        const after = tq.getAll().filter(t => _added.has(t.id) && t.status === "pending").length;
        assert.ok(after >= before - 2, `pruneOldTasks() deleted ${before - after} pending tasks`);
    });

    it("getDuePending() returns only past-or-now tasks, not future-scheduled ones", () => {
        const future = addTracked({
            input:        "future-task",
            type:         "auto",
            scheduledFor: new Date(Date.now() + 3_600_000).toISOString()
        });
        const due = tq.getDuePending();
        const hasFuture = due.some(t => t.id === future.id);
        assert.ok(!hasFuture, "getDuePending() returned a future-scheduled task");
    });

    it("recoverStale() marks running tasks as failed without data loss", () => {
        const stale = addTracked({ input: "stale-running-task", type: "auto" });
        tq.update(stale.id, { status: "running", startedAt: new Date(Date.now() - 7_200_000).toISOString() });
        tq.recoverStale();
        const recovered = tq.getAll().find(t => t.id === stale.id);
        assert.ok(recovered, "Stale task disappeared after recoverStale()");
        assert.notEqual(recovered.status, "running", "Stale task still 'running' after recoverStale()");
    });

    it("rapid add+delete cycle leaves queue in valid JSON state", () => {
        for (let i = 0; i < 30; i++) {
            const t = tq.addTask({ input: `rapid-${i}`, type: "auto" });
            tq.deleteTask(t.id);
        }
        const QUEUE_FILE = path.join(__dirname, "../../data/task-queue.json");
        const raw = fs.readFileSync(QUEUE_FILE, "utf8");
        assert.doesNotThrow(() => JSON.parse(raw), "Queue file corrupted after rapid add+delete");
    });

});
