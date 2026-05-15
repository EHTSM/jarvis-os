"use strict";
const { describe, it, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");

const ha = require("../../agents/runtime/humanApproval.cjs");
const ml = require("../../agents/runtime/memoryLeakDetector.cjs");
const cr = require("../../agents/runtime/checkpointRecovery.cjs");
const ce = require("../../agents/runtime/chaosEngine.cjs");
const rb = require("../../agents/runtime/recoveryBenchmark.cjs");

// ── humanApproval ─────────────────────────────────────────────────────────

describe("humanApproval — request lifecycle", () => {
    afterEach(() => ha.reset());

    it("requestApproval creates a pending entry", () => {
        const e = ha.requestApproval("a1", "deploy", { env: "prod" });
        assert.equal(e.status,  "pending");
        assert.equal(e.action,  "deploy");
        assert.deepEqual(e.detail, { env: "prod" });
    });
    it("requestApproval is idempotent for same id", () => {
        ha.requestApproval("a1", "x");
        const e2 = ha.requestApproval("a1", "y");
        assert.equal(e2.action, "x");  // first wins
    });
    it("pendingApprovals lists pending", () => {
        ha.requestApproval("a1", "deploy");
        ha.requestApproval("a2", "rollback");
        const list = ha.pendingApprovals();
        assert.ok(list.some(a => a.id === "a1"));
        assert.ok(list.some(a => a.id === "a2"));
    });
    it("getApproval returns null for unknown id", () => {
        assert.equal(ha.getApproval("nope"), null);
    });
});

describe("humanApproval — approve / deny / override", () => {
    afterEach(() => ha.reset());

    it("approve() resolves waitForApproval to approved=true", async () => {
        ha.requestApproval("a1", "push");
        setTimeout(() => ha.approve("a1", "looks good"), 10);
        const r = await ha.waitForApproval("a1", 500);
        assert.equal(r.approved, true);
        assert.equal(r.reason,   "looks good");
    });
    it("deny() resolves waitForApproval to approved=false", async () => {
        ha.requestApproval("a1", "rm");
        setTimeout(() => ha.deny("a1", "too risky"), 10);
        const r = await ha.waitForApproval("a1", 500);
        assert.equal(r.approved, false);
    });
    it("override() force-approves", async () => {
        ha.requestApproval("a1", "force");
        setTimeout(() => ha.override("a1", "admin"), 10);
        const r = await ha.waitForApproval("a1", 500);
        assert.equal(r.approved, true);
        assert.ok(r.overridden);
    });
    it("waitForApproval times out when not decided", async () => {
        ha.requestApproval("a1", "timeout-test");
        const r = await ha.waitForApproval("a1", 50);
        assert.equal(r.approved, false);
        assert.equal(r.reason,   "approval_timeout");
    });
    it("approve() returns false for unknown id", () => {
        assert.equal(ha.approve("nope"), false);
    });
    it("deny() returns false for unknown id", () => {
        assert.equal(ha.deny("nope"), false);
    });
    it("getApproval returns status without internal fields", () => {
        ha.requestApproval("a1", "act");
        const safe = ha.getApproval("a1");
        assert.ok(!("resolve" in safe));
        assert.ok(!("promise" in safe));
        assert.equal(safe.status, "pending");
    });
});

describe("humanApproval — pause / resume", () => {
    afterEach(() => ha.reset());

    it("fresh workflow is not paused", () => {
        assert.equal(ha.isPaused("wf1"), false);
    });
    it("pause() marks workflow as paused", () => {
        ha.pause("wf1");
        assert.equal(ha.isPaused("wf1"), true);
    });
    it("resume() unpauses workflow", () => {
        ha.pause("wf1");
        ha.resume("wf1");
        assert.equal(ha.isPaused("wf1"), false);
    });
    it("waitIfPaused resolves immediately when not paused", async () => {
        const t0 = Date.now();
        await ha.waitIfPaused("wf1");
        assert.ok(Date.now() - t0 < 200);
    });
    it("waitIfPaused resolves after resume", async () => {
        ha.pause("wf1");
        setTimeout(() => ha.resume("wf1"), 30);
        const t0 = Date.now();
        await ha.waitIfPaused("wf1", 20);
        assert.ok(Date.now() - t0 < 300);
        assert.equal(ha.isPaused("wf1"), false);
    });
});

// ── memoryLeakDetector ─────────────────────────────────────────────────────

describe("memoryLeakDetector — snapshots", () => {
    afterEach(() => ml.reset());

    it("snapshot() returns heap data", () => {
        const s = ml.snapshot();
        assert.ok(typeof s.heapUsed  === "number");
        assert.ok(typeof s.heapTotal === "number");
        assert.ok(s.pressure >= 0 && s.pressure <= 1);
    });
    it("checkNow() returns snapshot + leak detection", () => {
        const r = ml.checkNow();
        assert.ok("heapUsed"       in r);
        assert.ok("leakSuspected"  in r);
    });
    it("getHistory() returns array of snapshots", () => {
        ml.snapshot();
        ml.snapshot();
        assert.ok(ml.getHistory().length >= 2);
    });
    it("startMonitoring returns true first time", () => {
        assert.equal(ml.startMonitoring(10_000), true);
    });
    it("startMonitoring returns false when already running", () => {
        ml.startMonitoring(10_000);
        assert.equal(ml.startMonitoring(10_000), false);
    });
    it("stopMonitoring returns true when running", () => {
        ml.startMonitoring(10_000);
        assert.equal(ml.stopMonitoring(), true);
    });
    it("stopMonitoring returns false when not running", () => {
        assert.equal(ml.stopMonitoring(), false);
    });
});

describe("memoryLeakDetector — leak detection", () => {
    afterEach(() => ml.reset());

    it("detectLeak returns insufficient_samples when < SAMPLE_WINDOW", () => {
        const r = ml.detectLeak([{ heapUsed: 100 }, { heapUsed: 200 }]);
        assert.equal(r.leakSuspected, false);
        assert.equal(r.reason, "insufficient_samples");
    });
    it("detectLeak returns leakSuspected=false for stable memory", () => {
        const stable = [
            { heapUsed: 100_000_000 },
            { heapUsed: 101_000_000 },
            { heapUsed: 100_500_000 },
            { heapUsed: 102_000_000 },
            { heapUsed: 99_000_000  },
        ];
        const r = ml.detectLeak(stable);
        assert.equal(r.leakSuspected, false);
    });
    it("detectLeak returns leakSuspected=true for monotonically growing heap", () => {
        const growing = [
            { heapUsed: 100_000_000 },
            { heapUsed: 115_000_000 },
            { heapUsed: 130_000_000 },
            { heapUsed: 145_000_000 },
            { heapUsed: 160_000_000 },
        ];
        const r = ml.detectLeak(growing);
        assert.equal(r.leakSuspected, true);
        assert.ok(r.growthPct > 0);
    });
    it("detectLeak provides growthPct", () => {
        const r = ml.detectLeak([
            { heapUsed: 100 },
            { heapUsed: 110 },
            { heapUsed: 120 },
            { heapUsed: 130 },
            { heapUsed: 140 },
        ]);
        assert.ok(typeof r.growthPct === "number");
    });
});

// ── checkpointRecovery ─────────────────────────────────────────────────────

describe("checkpointRecovery — validate", () => {
    const TMP_ID = `test-cr-${Date.now()}`;
    const DIR    = path.join(__dirname, "../../data/workflow-checkpoints");
    const FILE   = path.join(DIR, `${TMP_ID}.json`);

    after(() => { try { fs.unlinkSync(FILE); } catch { /* ok */ } });

    it("validate() returns invalid for non-existent checkpoint", () => {
        const r = cr.validate("does-not-exist-xyz");
        assert.equal(r.valid, false);
    });
    it("validate() returns valid for a well-formed checkpoint", () => {
        fs.mkdirSync(DIR, { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify({
            id: TMP_ID, name: "test", status: "running",
            startedAt: new Date().toISOString(), steps: [],
        }), "utf8");
        const r = cr.validate(TMP_ID);
        assert.equal(r.valid, true);
        assert.equal(r.issues.length, 0);
    });
    it("validate() catches missing required fields", () => {
        fs.writeFileSync(FILE, JSON.stringify({ id: TMP_ID }), "utf8");
        const r = cr.validate(TMP_ID);
        assert.equal(r.valid, false);
        assert.ok(r.issues.length > 0);
    });
    it("validate() catches invalid JSON", () => {
        fs.writeFileSync(FILE, "{ bad json }", "utf8");
        const r = cr.validate(TMP_ID);
        assert.equal(r.valid, false);
        assert.ok(r.issues.some(i => i.includes("parse")));
    });
    it("validate() catches invalid status", () => {
        fs.writeFileSync(FILE, JSON.stringify({
            id: TMP_ID, name: "t", status: "banana",
            startedAt: new Date().toISOString(), steps: [],
        }), "utf8");
        const r = cr.validate(TMP_ID);
        assert.equal(r.valid, false);
    });
});

describe("checkpointRecovery — repair", () => {
    const TMP_ID = `test-cr-repair-${Date.now()}`;
    const DIR    = path.join(__dirname, "../../data/workflow-checkpoints");
    const FILE   = path.join(DIR, `${TMP_ID}.json`);

    after(() => { try { fs.unlinkSync(FILE); } catch { /* ok */ } });

    it("repair() returns already_valid for good checkpoint", () => {
        fs.mkdirSync(DIR, { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify({
            id: TMP_ID, name: "test", status: "completed",
            startedAt: new Date().toISOString(), steps: [],
        }), "utf8");
        const r = cr.repair(TMP_ID);
        assert.equal(r.repaired, false);
        assert.equal(r.reason,   "already_valid");
    });
    it("repair() fixes missing fields and writes file", () => {
        fs.writeFileSync(FILE, JSON.stringify({ id: TMP_ID }), "utf8");
        const r = cr.repair(TMP_ID);
        assert.equal(r.repaired, true);
        assert.ok(r.changes.length > 0);
        const fixed = JSON.parse(fs.readFileSync(FILE, "utf8"));
        assert.ok(Array.isArray(fixed.steps));
        assert.ok(typeof fixed.startedAt === "string");
    });
    it("repair() returns unparseable_json for corrupt JSON", () => {
        fs.writeFileSync(FILE, "GARBAGE", "utf8");
        const r = cr.repair(TMP_ID);
        assert.equal(r.repaired, false);
        assert.equal(r.reason,   "unparseable_json");
    });
});

describe("checkpointRecovery — scanAll / purgeCorrupted", () => {
    it("scanAll() returns total/valid/corrupted shape", () => {
        const r = cr.scanAll();
        assert.ok(typeof r.total     === "number");
        assert.ok(typeof r.valid     === "number");
        assert.ok(Array.isArray(r.corrupted));
    });
    it("purgeCorrupted() returns removed array", () => {
        const r = cr.purgeCorrupted();
        assert.ok(Array.isArray(r.removed));
        assert.ok(typeof r.count === "number");
    });
});

// ── chaosEngine ────────────────────────────────────────────────────────────

describe("chaosEngine — injection", () => {
    afterEach(() => ce.reset());

    it("injectFailure creates injection entry", () => {
        const r = ce.injectFailure("wf1", "step1");
        assert.equal(r.injected, "failure");
        assert.equal(r.workflowId, "wf1");
    });
    it("injectLatency creates injection entry", () => {
        const r = ce.injectLatency("wf1", "step1", 50);
        assert.equal(r.injected, "latency");
        assert.equal(r.delayMs,  50);
    });
    it("wrapStep throws on failure injection (probability=1)", async () => {
        ce.injectFailure("wf1", "boom");
        const step    = { name: "boom", execute: async () => ({ ok: true }) };
        const wrapped = ce.wrapStep(step, "wf1");
        await assert.rejects(() => wrapped.execute({}), /chaos/);
    });
    it("wrapStep passes through when no injection", async () => {
        const step    = { name: "safe", execute: async () => ({ ok: true }) };
        const wrapped = ce.wrapStep(step, "wf-no-inj");
        const r       = await wrapped.execute({});
        assert.equal(r.ok, true);
    });
    it("wrapStep stops injecting after maxHits", async () => {
        ce.injectFailure("wf1", "limited", { maxHits: 1 });
        const step    = { name: "limited", execute: async () => ({ ok: true }) };
        const wrapped = ce.wrapStep(step, "wf1");
        await assert.rejects(() => wrapped.execute({}));   // hit 1 = throws
        const r = await wrapped.execute({});               // hit 2 = passes through
        assert.equal(r.ok, true);
    });
    it("chaosReport lists active injections", () => {
        ce.injectFailure("wf1", "s1");
        ce.injectLatency("wf1", "s2", 200);
        const rep = ce.chaosReport();
        assert.ok("wf1" in rep);
        assert.ok(rep.wf1.s1.failure !== null);
        assert.equal(rep.wf1.s2.latency, 200);
    });
    it("clearInjections removes all for workflow", () => {
        ce.injectFailure("wf1", "s1");
        ce.clearInjections("wf1");
        const rep = ce.chaosReport();
        assert.ok(!("wf1" in rep));
    });
    it("injectLatency adds measurable delay", async () => {
        ce.injectLatency("wf1", "slow", 50);
        const step    = { name: "slow", execute: async () => ({ ok: true }) };
        const wrapped = ce.wrapStep(step, "wf1");
        const t0  = Date.now();
        await wrapped.execute({});
        assert.ok(Date.now() - t0 >= 40);
    });
});

// ── recoveryBenchmark ─────────────────────────────────────────────────────

describe("recoveryBenchmark", () => {
    it("benchmarkRecovery returns required shape", async () => {
        const r = await rb.benchmarkRecovery("bench-step", "unknown", 2);
        assert.ok(typeof r.stepName    === "string");
        assert.ok(typeof r.failureType === "string");
        assert.ok(typeof r.runs        === "number");
        assert.ok(typeof r.successRate === "number");
        assert.ok(typeof r.avgMs       === "number");
        assert.ok(typeof r.p50Ms       === "number");
        assert.ok(typeof r.p95Ms       === "number");
        assert.ok(Array.isArray(r.results));
        assert.equal(r.results.length, 2);
    });
    it("benchmarkRecovery successRate is 0–1", async () => {
        const r = await rb.benchmarkRecovery("bench-step2", "syntax", 2);
        assert.ok(r.successRate >= 0 && r.successRate <= 1);
    });
    it("benchmarkWorkflow returns required shape", async () => {
        const steps = [{ name: "ok-step", execute: async () => ({ done: true }) }];
        const r     = await rb.benchmarkWorkflow("bench-wf", steps, 2);
        assert.ok(typeof r.name        === "string");
        assert.ok(typeof r.successRate === "number");
        assert.ok(typeof r.avgMs       === "number");
        assert.ok(Array.isArray(r.results));
    });
    it("benchmarkWorkflow all-success gives successRate=1", async () => {
        const steps = [{ name: "pass", execute: async () => ({ done: true }) }];
        const r     = await rb.benchmarkWorkflow("bench-pass", steps, 3);
        assert.equal(r.successRate, 1);
    });
});
