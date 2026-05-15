"use strict";
const { describe, it, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const os_  = require("../../agents/runtime/trust/operationScorer.cjs");
const et   = require("../../agents/runtime/trust/escalationTrigger.cjs");
const ws   = require("../../agents/runtime/replay/workflowSnapshot.cjs");
const re_  = require("../../agents/runtime/replay/replayEngine.cjs");
const rps  = require("../../agents/runtime/replay/reproducibilityScorer.cjs");
const ob   = require("../../agents/runtime/observe/opBenchmark.cjs");
const egv  = require("../../agents/runtime/observe/executionGraphViewer.cjs");
const rt   = require("../../agents/runtime/observe/repairTimeline.cjs");
const des  = require("../../agents/runtime/observe/deployEventStream.cjs");

// ── operationScorer ───────────────────────────────────────────────────────

describe("operationScorer — scoreOperation", () => {
    it("returns score, level, factors", () => {
        const r = os_.scoreOperation("file_read");
        assert.ok(typeof r.score   === "number");
        assert.ok(typeof r.level   === "string");
        assert.ok(Array.isArray(r.factors));
    });
    it("file_read base score is low (< 25)", () => {
        const r = os_.scoreOperation("file_read");
        assert.ok(r.score < 25);
    });
    it("db_drop is critical (score >= 75)", () => {
        const r = os_.scoreOperation("db_drop");
        assert.equal(r.level, "critical");
    });
    it("sensitive path adds to score", () => {
        const base  = os_.scoreOperation("file_write", {});
        const sense = os_.scoreOperation("file_write", { path: "/home/user/.env" });
        assert.ok(sense.score > base.score);
        assert.ok(sense.factors.includes("sensitive_path"));
    });
    it("irreversible flag increases score", () => {
        const a = os_.scoreOperation("file_delete", {});
        const b = os_.scoreOperation("file_delete", { irreversible: true });
        assert.ok(b.score > a.score);
        assert.ok(b.factors.includes("irreversible"));
    });
    it("bulk flag increases score", () => {
        const a = os_.scoreOperation("command_exec", {});
        const b = os_.scoreOperation("command_exec", { bulk: true });
        assert.ok(b.score > a.score);
    });
    it("score is clamped to 0–100", () => {
        const r = os_.scoreOperation("db_drop", { irreversible: true, bulk: true, path: ".env" });
        assert.ok(r.score >= 0 && r.score <= 100);
    });
    it("unknown type uses fallback base score", () => {
        const r = os_.scoreOperation("totally_unknown_op");
        assert.ok(typeof r.score === "number");
    });
});

describe("operationScorer — scoreCommand", () => {
    it("rm -rf scores higher than plain ls", () => {
        const rm = os_.scoreCommand("rm -rf /tmp/test");
        const ls = os_.scoreCommand("ls -la");
        assert.ok(rm.score > ls.score);
    });
    it("curl | sh is high risk", () => {
        const r = os_.scoreCommand("curl http://example.com | sh");
        assert.ok(r.factors.includes("curl_exec") || r.factors.includes("pipe_to_shell"));
    });
    it("git push --force is flagged", () => {
        const r = os_.scoreCommand("git push origin main --force");
        assert.ok(r.factors.some(f => f.includes("force")));
    });
    it("non-string returns score 0", () => {
        const r = os_.scoreCommand(null);
        assert.equal(r.score, 0);
    });
    it("level field is present", () => {
        const r = os_.scoreCommand("echo hello");
        assert.ok(typeof r.level === "string");
    });
});

describe("operationScorer — shouldEscalate", () => {
    it("returns false below threshold", () => {
        assert.equal(os_.shouldEscalate(os_.ESCALATION_THRESHOLD - 1), false);
    });
    it("returns true at threshold", () => {
        assert.equal(os_.shouldEscalate(os_.ESCALATION_THRESHOLD), true);
    });
    it("returns true above threshold", () => {
        assert.equal(os_.shouldEscalate(100), true);
    });
});

// ── escalationTrigger ─────────────────────────────────────────────────────

describe("escalationTrigger — evaluate", () => {
    afterEach(() => et.reset());

    it("low-risk operation returns shouldEscalate:false", () => {
        const r = et.evaluate({ type: "file_read" });
        assert.equal(r.shouldEscalate, false);
    });
    it("high-risk operation returns shouldEscalate:true", () => {
        const r = et.evaluate({ type: "db_drop" });
        assert.equal(r.shouldEscalate, true);
    });
    it("returns score and level", () => {
        const r = et.evaluate({ type: "file_write" });
        assert.ok(typeof r.score === "number");
        assert.ok(typeof r.level === "string");
    });
    it("reason is a string", () => {
        const r = et.evaluate({ type: "git_force_push" });
        assert.ok(typeof r.reason === "string");
    });
    it("command scoring also used when command provided", () => {
        const r = et.evaluate({ type: "command_exec", command: "rm -rf /tmp/test" });
        assert.ok(typeof r.score === "number");
    });
});

describe("escalationTrigger — trigger (auto-approved low risk)", () => {
    afterEach(() => et.reset());

    it("low-risk operation is auto-approved without blocking", async () => {
        const r = await et.trigger({ type: "file_read" }, {}, { timeoutMs: 500 });
        assert.equal(r.escalated, false);
        assert.equal(r.approved,  true);
    });
    it("auto-approved result has null approvalId", async () => {
        const r = await et.trigger({ type: "file_read" }, {});
        assert.equal(r.approvalId, null);
    });
});

describe("escalationTrigger — getHistory", () => {
    afterEach(() => et.reset());

    it("getHistory returns array", () => {
        assert.ok(Array.isArray(et.getHistory()));
    });
    it("getHistory is empty after reset", () => {
        et.reset();
        assert.equal(et.getHistory().length, 0);
    });
});

// ── workflowSnapshot ──────────────────────────────────────────────────────

describe("workflowSnapshot — capture + store", () => {
    afterEach(() => ws.reset());

    it("capture returns snapshot with required fields", () => {
        const snap = ws.capture("wf-1", "test-wf", [], {}, null);
        assert.ok("snapshotId" in snap);
        assert.ok("workflowId" in snap);
        assert.ok("capturedAt" in snap);
        assert.ok("stepCount"  in snap);
        assert.ok("stepMeta"   in snap);
    });
    it("store returns snapshotId string", () => {
        const snap = ws.capture("wf-2", "stored-wf", [], {}, null);
        const id   = ws.store(snap);
        assert.ok(typeof id === "string");
    });
    it("get() retrieves stored snapshot", () => {
        const snap = ws.capture("wf-3", "get-wf", [], {}, null);
        ws.store(snap);
        const retrieved = ws.get(snap.snapshotId);
        assert.equal(retrieved.snapshotId, snap.snapshotId);
    });
    it("get() returns null for unknown id", () => {
        assert.equal(ws.get("no-such-snap"), null);
    });
    it("list() returns all stored snapshots", () => {
        const s1 = ws.capture("wf-4a", "a", [], {}, null);
        const s2 = ws.capture("wf-4b", "b", [], {}, null);
        ws.store(s1); ws.store(s2);
        assert.equal(ws.list().length, 2);
    });
    it("list(workflowId) filters by workflowId", () => {
        const s1 = ws.capture("target-wf", "a", [], {}, null);
        const s2 = ws.capture("other-wf",  "b", [], {}, null);
        ws.store(s1); ws.store(s2);
        const filtered = ws.list("target-wf");
        assert.equal(filtered.length, 1);
        assert.equal(filtered[0].workflowId, "target-wf");
    });
    it("latest() returns most recent snapshot", () => {
        const s1 = ws.capture("wf-5", "first",  [], {}, null);
        ws.store(s1);
        const s2 = ws.capture("wf-5", "second", [], {}, null);
        ws.store(s2);
        const l = ws.latest("wf-5");
        assert.equal(l.snapshotId, s2.snapshotId);
    });
    it("latest() returns null when no snapshots", () => {
        assert.equal(ws.latest("no-such-wf"), null);
    });
    it("remove() deletes snapshot", () => {
        const snap = ws.capture("wf-6", "rm-wf", [], {}, null);
        ws.store(snap);
        ws.remove(snap.snapshotId);
        assert.equal(ws.get(snap.snapshotId), null);
    });
    it("ctx is serialized (no Functions)", () => {
        const snap = ws.capture("wf-7", "ctx-wf", [], { fn: () => {}, x: 1 }, null);
        assert.equal(snap.ctx.x,  1);
        assert.equal(snap.ctx.fn, undefined);
    });
    it("stepMeta reflects step structure", () => {
        const steps = [
            { name: "s1", execute: () => {}, rollback: () => {} },
            { name: "s2", execute: () => {} },
        ];
        const snap = ws.capture("wf-8", "meta-wf", steps, {}, null);
        assert.equal(snap.stepMeta[0].hasExecute,  true);
        assert.equal(snap.stepMeta[0].hasRollback, true);
        assert.equal(snap.stepMeta[1].hasRollback, false);
    });
});

// ── replayEngine — dryReplay ──────────────────────────────────────────────

describe("replayEngine — dryReplay", () => {
    afterEach(() => ws.reset());

    it("returns replayId, steps, simulatedSuccess", () => {
        const snap = ws.capture("dry-wf", "dry", [], {}, { success: true, stepDetails: [] });
        ws.store(snap);
        const r = re_.dryReplay(snap);
        assert.ok("replayId"         in r);
        assert.ok("steps"            in r);
        assert.ok("simulatedSuccess" in r);
    });
    it("simulatedSuccess matches original result.success", () => {
        const snap = ws.capture("dry-wf-2", "dry2", [], {}, { success: false, stepDetails: [] });
        ws.store(snap);
        const r = re_.dryReplay(snap);
        assert.equal(r.simulatedSuccess, false);
    });
    it("steps array reflects stepMeta", () => {
        const steps = [{ name: "step1", execute: () => {} }];
        const snap  = ws.capture("dry-wf-3", "dry3", steps, {}, { success: true, stepDetails: [] });
        ws.store(snap);
        const r = re_.dryReplay(snap);
        assert.equal(r.steps.length, 1);
        assert.equal(r.steps[0].name, "step1");
    });
    it("replayId starts with 'dry-'", () => {
        const snap = ws.capture("dry-wf-4", "dry4", [], {}, null);
        const r    = re_.dryReplay(snap);
        assert.ok(r.replayId.startsWith("dry-"));
    });
});

// ── reproducibilityScorer ─────────────────────────────────────────────────

describe("reproducibilityScorer — score", () => {
    it("returns insufficient_data for empty workflow", () => {
        const r = rps.score("no-such-workflow-xyz-abc");
        assert.equal(r.verdict, "insufficient_data");
        assert.equal(r.score,   null);
    });
    it("sampleSize is 0 for unknown workflow", () => {
        const r = rps.score("unknown-wf-xyz");
        assert.equal(r.sampleSize, 0);
    });
    it("factors array is present", () => {
        const r = rps.score("no-such-wf");
        assert.ok(Array.isArray(r.factors));
    });
});

// ── opBenchmark ───────────────────────────────────────────────────────────

describe("opBenchmark — trackTask + getTaskStats", () => {
    afterEach(() => ob.reset());

    it("getTaskStats returns null for unknown type", () => {
        assert.equal(ob.getTaskStats("no-such-type"), null);
    });
    it("trackTask creates stats entry", () => {
        ob.trackTask("t1", "build", true, 100);
        const s = ob.getTaskStats("build");
        assert.ok(s !== null);
        assert.equal(s.attempts, 1);
    });
    it("successRate is 1 when all pass", () => {
        ob.trackTask("t1", "deploy", true, 50);
        ob.trackTask("t2", "deploy", true, 60);
        const s = ob.getTaskStats("deploy");
        assert.equal(s.successRate, 1);
    });
    it("successRate is 0 when all fail", () => {
        ob.trackTask("t1", "test", false, 10);
        ob.trackTask("t2", "test", false, 20);
        const s = ob.getTaskStats("test");
        assert.equal(s.successRate, 0);
    });
    it("avgMs is correct", () => {
        ob.trackTask("t1", "bench", true, 100);
        ob.trackTask("t2", "bench", true, 200);
        const s = ob.getTaskStats("bench");
        assert.equal(s.avgMs, 150);
    });
    it("p95Ms is present", () => {
        for (let i = 0; i < 20; i++) ob.trackTask(`t${i}`, "p95-test", true, i * 10);
        const s = ob.getTaskStats("p95-test");
        assert.ok(typeof s.p95Ms === "number");
    });
});

describe("opBenchmark — getRetryEfficiency", () => {
    afterEach(() => ob.reset());

    it("returns required fields with no tasks", () => {
        const r = ob.getRetryEfficiency();
        assert.ok("totalTasks"        in r);
        assert.ok("retriedTasks"      in r);
        assert.ok("retryRate"         in r);
        assert.ok("avgRetriesPerTask" in r);
    });
    it("retryRate is 0 with no retried tasks", () => {
        ob.trackTask("t1", "x", true, 100, { retries: 0 });
        const r = ob.getRetryEfficiency();
        assert.equal(r.retryRate, 0);
    });
    it("retryRate reflects retried tasks", () => {
        ob.trackTask("t1", "x", true, 100, { retries: 2 });
        ob.trackTask("t2", "x", true, 100, { retries: 0 });
        const r = ob.getRetryEfficiency();
        assert.equal(r.retryRate, 0.5);
    });
});

describe("opBenchmark — fullReport", () => {
    afterEach(() => ob.reset());

    it("returns required keys", () => {
        const r = ob.fullReport();
        assert.ok("generatedAt"     in r);
        assert.ok("totalTasks"      in r);
        assert.ok("allStats"        in r);
        assert.ok("retryEfficiency" in r);
        assert.ok("repairStats"     in r);
        assert.ok("overallSuccess"  in r);
    });
    it("overallSuccess is null with no tasks", () => {
        assert.equal(ob.fullReport().overallSuccess, null);
    });
    it("totalTasks matches tracked count", () => {
        ob.trackTask("t1", "a", true, 10);
        ob.trackTask("t2", "b", true, 20);
        assert.equal(ob.fullReport().totalTasks, 2);
    });
});

// ── executionGraphViewer ──────────────────────────────────────────────────

describe("executionGraphViewer — renderParallelGroups", () => {
    it("returns string for valid groups", () => {
        const r = egv.renderParallelGroups([["step1", "step2"], ["step3"]]);
        assert.ok(typeof r === "string");
        assert.ok(r.includes("L1"));
        assert.ok(r.includes("step1"));
    });
    it("returns fallback string for empty array", () => {
        assert.ok(egv.renderParallelGroups([]).includes("no parallel"));
    });
    it("each level is labeled L1, L2, etc.", () => {
        const r = egv.renderParallelGroups([["a"], ["b"], ["c"]]);
        assert.ok(r.includes("L1"));
        assert.ok(r.includes("L2"));
        assert.ok(r.includes("L3"));
    });
});

describe("executionGraphViewer — renderCriticalPath", () => {
    it("formats path with arrows", () => {
        const r = egv.renderCriticalPath({ path: ["s1", "s2", "s3"], length: 3 });
        assert.ok(r.includes("→"));
        assert.ok(r.includes("s1"));
        assert.ok(r.includes("★"));
    });
    it("returns fallback for null input", () => {
        assert.ok(egv.renderCriticalPath(null).includes("no critical path"));
    });
    it("returns fallback for empty path", () => {
        assert.ok(egv.renderCriticalPath({ path: [] }).includes("no critical path"));
    });
});

describe("executionGraphViewer — renderBottlenecks", () => {
    it("formats bottleneck entry", () => {
        const r = egv.renderBottlenecks([{ step: "slow-step", onCriticalPath: true, inDegree: 3, outDegree: 1 }]);
        assert.ok(r.includes("slow-step"));
        assert.ok(r.includes("CRITICAL-PATH"));
    });
    it("returns fallback for empty array", () => {
        assert.ok(egv.renderBottlenecks([]).includes("no bottlenecks"));
    });
});

describe("executionGraphViewer — render", () => {
    it("returns string with header for valid analysis", () => {
        const r = egv.render({
            parallelGroups: [["a", "b"]],
            criticalPath:   { path: ["a", "b"], length: 2 },
            bottlenecks:    [],
            maxParallelism: 2,
        });
        assert.ok(typeof r === "string");
        assert.ok(r.includes("EXECUTION GRAPH"));
        assert.ok(r.includes("Max Parallelism: 2"));
    });
    it("returns fallback for null input", () => {
        assert.ok(egv.render(null).includes("no graph analysis"));
    });
});

// ── repairTimeline ────────────────────────────────────────────────────────

describe("repairTimeline — record + getTimeline", () => {
    afterEach(() => rt.reset());

    it("record returns event with required fields", () => {
        const e = rt.record("wf-rt-1", "parse", 1, "add-brace", true, 50);
        assert.ok("seq"        in e);
        assert.ok("ts"         in e);
        assert.ok("workflowId" in e);
        assert.ok("stepName"   in e);
        assert.ok("strategy"   in e);
        assert.ok("success"    in e);
        assert.ok("durationMs" in e);
    });
    it("getTimeline returns sorted events", () => {
        rt.record("wf-rt-2", "s1", 1, "fix-a", true,  10);
        rt.record("wf-rt-2", "s2", 1, "fix-b", false, 20);
        const tl = rt.getTimeline("wf-rt-2");
        assert.equal(tl.length, 2);
        assert.ok(tl[0].seq < tl[1].seq);
    });
    it("getTimeline returns empty array for unknown workflow", () => {
        assert.deepEqual(rt.getTimeline("no-such-wf"), []);
    });
    it("getAllWorkflows returns recorded workflow ids", () => {
        rt.record("wf-all-1", "s", 1, "x", true, 0);
        rt.record("wf-all-2", "s", 1, "y", true, 0);
        const wfs = rt.getAllWorkflows();
        assert.ok(wfs.includes("wf-all-1"));
        assert.ok(wfs.includes("wf-all-2"));
    });
});

describe("repairTimeline — getSummary", () => {
    afterEach(() => rt.reset());

    it("returns null for workflow with no events", () => {
        assert.equal(rt.getSummary("no-events-wf"), null);
    });
    it("returns correct totals", () => {
        rt.record("wf-sum", "s1", 1, "a", true,  10);
        rt.record("wf-sum", "s2", 1, "b", false, 20);
        rt.record("wf-sum", "s3", 1, "a", true,  30);
        const s = rt.getSummary("wf-sum");
        assert.equal(s.total,     3);
        assert.equal(s.succeeded, 2);
        assert.equal(s.failed,    1);
    });
    it("successRate is correct", () => {
        rt.record("wf-sr", "s", 1, "x", true,  0);
        rt.record("wf-sr", "s", 2, "x", false, 0);
        const s = rt.getSummary("wf-sr");
        assert.equal(s.successRate, 0.5);
    });
    it("strategies breakdown is present", () => {
        rt.record("wf-strat", "s", 1, "fix-a", true,  0);
        rt.record("wf-strat", "s", 2, "fix-a", false, 0);
        const s = rt.getSummary("wf-strat");
        assert.ok("strategies" in s);
        assert.ok("fix-a" in s.strategies);
        assert.equal(s.strategies["fix-a"].attempts, 2);
    });
});

// ── deployEventStream ─────────────────────────────────────────────────────

describe("deployEventStream — emit + getStream", () => {
    afterEach(() => des.reset());

    it("emit returns event entry with required fields", () => {
        const e = des.emit("dep-1", "deploy_start", { env: "prod" });
        assert.ok("seq"          in e);
        assert.ok("ts"           in e);
        assert.ok("deploymentId" in e);
        assert.ok("event"        in e);
        assert.ok("data"         in e);
    });
    it("getStream returns events sorted by seq", () => {
        des.emit("dep-2", "validation_start");
        des.emit("dep-2", "deploy_start");
        des.emit("dep-2", "deploy_complete");
        const stream = des.getStream("dep-2");
        assert.equal(stream.length, 3);
        assert.ok(stream[0].seq < stream[1].seq);
        assert.ok(stream[1].seq < stream[2].seq);
    });
    it("getStream returns [] for unknown deployment", () => {
        assert.deepEqual(des.getStream("no-such-dep"), []);
    });
    it("getAllDeployments includes emitted ids", () => {
        des.emit("dep-all-1", "deploy_start");
        des.emit("dep-all-2", "deploy_start");
        const all = des.getAllDeployments();
        assert.ok(all.includes("dep-all-1"));
        assert.ok(all.includes("dep-all-2"));
    });
    it("DEPLOY_EVENTS is a non-empty array", () => {
        assert.ok(Array.isArray(des.DEPLOY_EVENTS));
        assert.ok(des.DEPLOY_EVENTS.length > 0);
    });
});

describe("deployEventStream — subscribe + unsubscribe", () => {
    afterEach(() => des.reset());

    it("subscriber is called on emit", () => {
        let received = null;
        des.subscribe("dep-sub", e => { received = e; });
        des.emit("dep-sub", "deploy_start");
        assert.ok(received !== null);
        assert.equal(received.event, "deploy_start");
    });
    it("unsubscribed fn is not called", () => {
        let calls = 0;
        const fn = () => { calls++; };
        des.subscribe("dep-unsub", fn);
        des.unsubscribe("dep-unsub", fn);
        des.emit("dep-unsub", "deploy_start");
        assert.equal(calls, 0);
    });
    it("multiple subscribers all receive the event", () => {
        let a = 0, b = 0;
        des.subscribe("dep-multi", () => { a++; });
        des.subscribe("dep-multi", () => { b++; });
        des.emit("dep-multi", "deploy_start");
        assert.equal(a, 1);
        assert.equal(b, 1);
    });
    it("subscriber error does not prevent emit from completing", () => {
        des.subscribe("dep-err", () => { throw new Error("sub error"); });
        assert.doesNotThrow(() => des.emit("dep-err", "deploy_start"));
    });
});
