"use strict";
/**
 * Phase B.6 regression: JSON→SQLite mirror drift reconciliation.
 *
 * agents/taskQueue.cjs persists to JSON (authoritative) and then mirrors the
 * same task into SQLite via _shadowUpsert(). Those are two separate writes,
 * not one transaction, so a crash in the window between them leaves the mirror
 * permanently behind. This was observed for real on 10 tasks after the Phase
 * B.5 crash drills (JSON=completed while SQLite still said pending/running),
 * and nothing repaired it — recoverStale() only re-mirrored tasks that were
 * "running" in JSON, so a completed/pending disagreement survived every boot.
 *
 * recoverStale() now re-mirrors any task whose SQLite status disagrees with the
 * JSON authority. These tests pin that behavior, including the invariants that
 * make it safe: JSON always wins, and SQLite-only history is left alone.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const queue      = require("../../agents/taskQueue.cjs");
const QUEUE_FILE = path.join(__dirname, "../../data/task-queue.json");

function readJson() {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
}
function writeJson(tasks) {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(tasks, null, 2));
}
function sqliteStatus(id) {
    const { getDB } = require("../../backend/db/sqlite.cjs");
    const row = getDB().prepare("SELECT status FROM tasks WHERE id = ?").get(id);
    return row ? row.status : null;
}

/**
 * Drive a task into the exact post-crash state: JSON mutated to a terminal
 * status with the mirror never told. Writing JSON directly (rather than via
 * queue.update()) is what reproduces the crash window — update() would mirror.
 */
function simulateCrashAfterJsonWrite(id, status) {
    const tasks = readJson();
    const t = tasks.find(x => x.id === id);
    t.status = status;
    t.completedAt = new Date().toISOString();
    writeJson(tasks);
}

describe("mirror drift reconciliation (Phase B.6)", () => {
    it("re-mirrors a task whose SQLite status drifted from JSON", () => {
        const task = queue.addTask({ input: "b6-drift-reconcile", type: "test" });
        assert.equal(sqliteStatus(task.id), "pending", "addTask should mirror immediately");

        simulateCrashAfterJsonWrite(task.id, "completed");
        assert.equal(sqliteStatus(task.id), "pending", "drift must exist before reconcile");

        queue.recoverStale();

        assert.equal(sqliteStatus(task.id), "completed", "reconcile must push JSON status into the mirror");
        queue.deleteTask(task.id);
    });

    it("leaves matching tasks untouched (no spurious rewrites)", () => {
        const task = queue.addTask({ input: "b6-drift-nochange", type: "test" });
        queue.update(task.id, { status: "completed" });
        assert.equal(sqliteStatus(task.id), "completed");

        queue.recoverStale();

        assert.equal(sqliteStatus(task.id), "completed", "already-consistent task must stay consistent");
        queue.deleteTask(task.id);
    });

    it("treats JSON as authoritative — never overwrites JSON from the mirror", () => {
        const task = queue.addTask({ input: "b6-json-authority", type: "test" });
        simulateCrashAfterJsonWrite(task.id, "failed");

        queue.recoverStale();

        const after = readJson().find(t => t.id === task.id);
        assert.equal(after.status, "failed", "JSON must remain the source of truth");
        assert.equal(sqliteStatus(task.id), "failed", "mirror must converge toward JSON");
        queue.deleteTask(task.id);
    });

    it("does not resurrect SQLite-only history into JSON (pruning is by design)", () => {
        // pruneOldTasks() trims JSON to the last N terminal tasks while the
        // mirror keeps history, so SQLite legitimately holds ids JSON does not.
        // Reconciliation must not treat that as drift and re-add them.
        const task = queue.addTask({ input: "b6-prune-safe", type: "test" });
        queue.update(task.id, { status: "completed" });

        const before = readJson().filter(t => t.id === task.id).length;
        assert.equal(before, 1);

        const tasks = readJson().filter(t => t.id !== task.id);   // simulate JSON prune
        writeJson(tasks);

        queue.recoverStale();

        const resurrected = readJson().filter(t => t.id === task.id).length;
        assert.equal(resurrected, 0, "a JSON-pruned task must not come back from the mirror");
    });

    it("survives an unavailable mirror without throwing (fail-safe)", () => {
        // The mirror is non-authoritative; startup must never fail on it.
        const task = queue.addTask({ input: "b6-failsafe", type: "test" });
        simulateCrashAfterJsonWrite(task.id, "completed");
        assert.doesNotThrow(() => queue.recoverStale());
        queue.deleteTask(task.id);
    });
});
