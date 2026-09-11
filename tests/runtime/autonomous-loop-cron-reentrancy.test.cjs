"use strict";
/**
 * Queue/Worker/Background Execution Audit (2026-08-22).
 *
 * agents/autonomousLoop.cjs's _registerCron() callback had no in-flight
 * guard for its own task id — unlike _tick()'s _dispatching guard, which
 * only prevents the 10s POLL loop from re-entering itself. cron.schedule()
 * fires on its own independent timer regardless of whether the PREVIOUS
 * fire's _runTask() for the same recurring task is still awaiting.
 * _runTask() can run several planner sub-tasks sequentially, each
 * individually timeout-capped at TASK_TIMEOUT_MS (30s) — so a 2-3-subtask
 * recurring job can genuinely exceed a tight cron interval. A client-
 * supplied recurringCron via authenticated POST /tasks has no minimum-
 * interval floor (any pattern cron.validate() accepts, including
 * once-a-minute or tighter, is honored as-is).
 *
 * Live-reproduced pre-fix with the real node-cron dependency: a 1s cron
 * interval driving a simulated 1.8s task produced maxConcurrent:2 — two
 * genuinely overlapping invocations, both calling taskQueue.update(task.id,
 * ...) concurrently (a real duplicate-execution / duplicate-write risk:
 * double CRM write, double message send, double mission dispatch, depending
 * on what the recurring task's input decomposes into).
 *
 * Same duplicate-execution bug class already fixed twice in this codebase
 * for browserScheduler._inFlight and contentScheduler._processingIds (see
 * reports/SCHEDULER-RELIABILITY-RECOVERY-AUDIT.md) — this closes the one
 * instance that mission's own sweep missed, in the primary task-queue
 * worker loop itself, reusing the identical in-flight-Set pattern.
 *
 * Fix: agents/autonomousLoop.cjs's _cronInFlight Set, checked and claimed
 * before calling _runTask inside the cron callback, released in `finally`.
 */

const test = require("node:test");
const assert = require("node:assert");
const cron = require("node-cron");

test("cron callback with no in-flight guard allows overlapping execution (baseline reproduction)", async () => {
    let concurrent = 0, maxConcurrent = 0;
    async function fakeRunTask() {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise(r => setTimeout(r, 1800));
        concurrent--;
    }
    const job = cron.schedule("* * * * * *", () => { fakeRunTask(); });
    await new Promise(r => setTimeout(r, 6000));
    job.stop();
    await new Promise(r => setTimeout(r, 2500));
    assert.ok(maxConcurrent > 1, `expected genuine overlap in the unguarded baseline, got maxConcurrent=${maxConcurrent}`);
});

test("in-flight Set guard (autonomousLoop.cjs's actual fix pattern) prevents overlap for the same task id", async () => {
    let concurrent = 0, maxConcurrent = 0, skipped = 0;
    const inFlight = new Set();
    const TASK_ID = "recurring-task-under-test";

    async function fakeRunTask() {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise(r => setTimeout(r, 1800));
        concurrent--;
    }

    // Mirrors _registerCron's fixed callback exactly.
    const job = cron.schedule("* * * * * *", async () => {
        if (inFlight.has(TASK_ID)) { skipped++; return; }
        inFlight.add(TASK_ID);
        try { await fakeRunTask(); } finally { inFlight.delete(TASK_ID); }
    });

    await new Promise(r => setTimeout(r, 6000));
    job.stop();
    await new Promise(r => setTimeout(r, 2500));

    assert.strictEqual(maxConcurrent, 1, `expected no overlap with the in-flight guard, got maxConcurrent=${maxConcurrent}`);
    assert.ok(skipped > 0, "expected at least one cron fire to be skipped while the prior run was still in flight");
});

test("in-flight guard releases on error, so a later fire is never permanently blocked", async () => {
    const inFlight = new Set();
    const TASK_ID = "recurring-task-error-case";
    let ranCount = 0;

    async function runOnce(shouldThrow) {
        if (inFlight.has(TASK_ID)) return false;
        inFlight.add(TASK_ID);
        try {
            ranCount++;
            if (shouldThrow) throw new Error("simulated task failure");
        } finally {
            inFlight.delete(TASK_ID);
        }
        return true;
    }

    await assert.rejects(() => runOnce(true));
    assert.strictEqual(inFlight.has(TASK_ID), false, "guard must be released even when the task throws");

    const ran = await runOnce(false);
    assert.strictEqual(ran, true, "a subsequent fire must be able to run after the guard was released by the finally block");
    assert.strictEqual(ranCount, 2);
});
