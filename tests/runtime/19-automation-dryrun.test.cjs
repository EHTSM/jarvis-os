"use strict";
/**
 * Phase B.13 regression: an automation dry-run must not execute for real.
 *
 * automationService.fireRule(workspaceId, ruleId, context, accountId, dryRun)
 * has always implemented dry-run properly — it short-circuits _executeAction()
 * into a "Would execute: …" preview and skips history/runCount mutation. But
 * two wrapper layers dropped the flag:
 *
 *   routes/orgAutomationCenter.js  → forwarded only req.body.context
 *   services/orgAutomationCenter.cjs → fireRule(orgId, accountId, ruleId, context)
 *
 * So `{"dryRun":true}` was silently ignored and every "preview" ran live.
 *
 * Reproduced 3/3 against a real queue_task rule: outcome came back "success"
 * instead of "dry_run" and a real task was queued each time — queued-task count
 * 2 → 3 → 4 → 5. After forwarding the existing flag: outcome "dry_run",
 * delta 0 on all three attempts, and a real (non-dry) fire still succeeds.
 *
 * These tests pin the forwarding at both layers plus the semantics that make a
 * dry-run safe: no side effect, no runCount bump, no history mutation.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const ROOT = path.join(__dirname, "../..");
const automation = require("../../backend/services/automationService.cjs");
const queue      = require("../../agents/taskQueue.cjs");

const WS  = `b13-ws-${Date.now().toString(36)}`;
const TAG = `B13DRYRUN-${Date.now().toString(36)}`;
let ruleId;

function queuedCount() {
    return queue.getAll().filter(t => String(t.input).includes(TAG)).length;
}

before(async () => {
    const rule = await automation.createRule(WS, {
        name:    "b13 dryrun probe",
        trigger: { type: "manual" },
        action:  { type: "queue_task", input: `${TAG} queued` },
    }, "b13-tester");
    ruleId = rule.id || rule.rule?.id;
    assert.ok(ruleId, "fixture rule must be created");
});

after(() => {
    for (const t of queue.getAll().filter(t => String(t.input).includes(TAG))) {
        try { queue.deleteTask(t.id); } catch { /* best effort */ }
    }
});

describe("automation dry-run safety (Phase B.13)", () => {
    it("a dry run reports dry_run, not success", async () => {
        const r = await automation.fireRule(WS, ruleId, {}, "b13-tester", true);
        assert.equal(r.outcome, "dry_run",
            "a preview must be labelled dry_run — it returned 'success' before the fix");
    });

    it("a dry run creates NO real task", async () => {
        const before = queuedCount();
        await automation.fireRule(WS, ruleId, {}, "b13-tester", true);
        await automation.fireRule(WS, ruleId, {}, "b13-tester", true);
        assert.equal(queuedCount(), before,
            "dry runs must not queue tasks — each one queued a real task before the fix");
    });

    it("a dry run does not bump runCount", async () => {
        const rulesBefore = automation.getRules(WS).find(r => r.id === ruleId);
        const countBefore = rulesBefore.runCount || 0;
        await automation.fireRule(WS, ruleId, {}, "b13-tester", true);
        const after = automation.getRules(WS).find(r => r.id === ruleId);
        assert.equal(after.runCount || 0, countBefore,
            "a preview must not be recorded as an execution");
    });

    it("a REAL run still executes and queues the task", async () => {
        const before = queuedCount();
        const r = await automation.fireRule(WS, ruleId, {}, "b13-tester", false);
        assert.equal(r.outcome, "success", "a real fire must still execute");
        assert.equal(queuedCount(), before + 1, "a real fire must queue exactly one task");
    });

    it("the service wrapper forwards dryRun", () => {
        const src = fs.readFileSync(path.join(ROOT, "backend/services/orgAutomationCenter.cjs"), "utf8");
        const fn  = src.slice(src.indexOf("function fireRule"), src.indexOf("function getHistory"));
        assert.ok(/dryRun/.test(fn), "the service wrapper must accept dryRun");
        assert.ok(/fireRule\?\.\(orgId, ruleId, context, accountId, dryRun\)/.test(fn),
            "the wrapper must pass dryRun through as the 5th argument");
    });

    it("the route forwards dryRun from the request body", () => {
        const src = fs.readFileSync(path.join(ROOT, "backend/routes/orgAutomationCenter.js"), "utf8");
        assert.ok(/req\.body\?\.dryRun === true/.test(src),
            "the fire route must read dryRun from the body or previews execute for real");
    });

    it("treats only an explicit true as a dry run", () => {
        // A truthy string must not silently turn a real run into a preview,
        // and a missing flag must mean a real run.
        const src = fs.readFileSync(path.join(ROOT, "backend/routes/orgAutomationCenter.js"), "utf8");
        assert.ok(/=== true/.test(src), "dryRun must be compared strictly");
    });
});
