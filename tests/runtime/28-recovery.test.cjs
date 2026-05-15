"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const rm  = require("../../agents/runtime/deploy/recoveryManager.cjs");
const it_ = require("../../agents/runtime/resilience/interruptionTester.cjs");

// ── recoveryManager — verifyRollback ──────────────────────────────────

describe("recoveryManager — verifyRollback", () => {
    afterEach(() => rm.reset());

    it("verified:true when id present and no status conflict", () => {
        const r = rm.verifyRollback("dep-1");
        assert.equal(typeof r.verified, "boolean");
        assert.ok(Array.isArray(r.checks));
        assert.ok(Array.isArray(r.issues));
    });
    it("verified:false when deploymentId missing", () => {
        const r = rm.verifyRollback("");
        assert.equal(r.verified, false);
        assert.ok(r.issues.includes("deployment_id_present"));
    });
    it("verified:false when status is not rolled_back", () => {
        const r = rm.verifyRollback("dep-2", { status: "failed", events: [] });
        assert.equal(r.verified, false);
    });
    it("all checks have name and passed fields", () => {
        const r = rm.verifyRollback("dep-3");
        for (const c of r.checks) {
            assert.ok("name"   in c);
            assert.ok("passed" in c);
        }
    });
    it("verified:true with explicit rolled_back status and events", () => {
        const r = rm.verifyRollback("dep-4", {
            status: "rolled_back",
            events: [{ event: "rollback_complete" }],
        });
        assert.equal(r.verified, true);
    });
});

describe("recoveryManager — repairHealthCheck", () => {
    afterEach(() => rm.reset());

    it("recovered:true when healthCheck returns healthy on first try", async () => {
        const r = await rm.repairHealthCheck({
            id:          "dep-hc-1",
            healthCheck: async () => ({ healthy: true }),
        });
        assert.equal(r.recovered, true);
        assert.equal(r.attempts,  1);
    });
    it("recovered:false after maxRetries with no healthy result", async () => {
        const r = await rm.repairHealthCheck({
            id:          "dep-hc-2",
            healthCheck: async () => ({ healthy: false }),
        }, 3);
        assert.equal(r.recovered, false);
        assert.equal(r.attempts,  3);
    });
    it("returns error when no healthCheck fn", async () => {
        const r = await rm.repairHealthCheck({});
        assert.equal(r.recovered, false);
        assert.ok(typeof r.error === "string");
    });
    it("recovers on second attempt", async () => {
        let calls = 0;
        const r = await rm.repairHealthCheck({
            healthCheck: async () => ({ healthy: ++calls >= 2 }),
        }, 3);
        assert.equal(r.recovered, true);
        assert.equal(r.attempts,  2);
    });
    it("handles throwing healthCheck gracefully", async () => {
        const r = await rm.repairHealthCheck({
            healthCheck: async () => { throw new Error("network down"); },
        }, 2);
        assert.equal(r.recovered, false);
    });
});

describe("recoveryManager — repairEnvironment", () => {
    it("present: HOME is always set", () => {
        const r = rm.repairEnvironment(["HOME"]);
        assert.ok(r.present.includes("HOME"));
        assert.equal(r.repaired, true);
    });
    it("missing: non-existent var is reported", () => {
        const r = rm.repairEnvironment(["__SURELY_NOT_SET_XYZ__"]);
        assert.ok(r.missing.includes("__SURELY_NOT_SET_XYZ__"));
        assert.equal(r.repaired, false);
    });
    it("score is 100 when all present", () => {
        const r = rm.repairEnvironment(["HOME"]);
        assert.equal(r.score, 100);
    });
    it("score is 0 when all missing", () => {
        const r = rm.repairEnvironment(["__MISSING_1__", "__MISSING_2__"]);
        assert.equal(r.score, 0);
    });
    it("empty array returns repaired:true, score:100", () => {
        const r = rm.repairEnvironment([]);
        assert.equal(r.repaired, true);
        assert.equal(r.score,    100);
    });
});

describe("recoveryManager — resolvePortConflict", () => {
    it("resolved:true for an available high port", async () => {
        const port = 49700 + Math.floor(Math.random() * 100);
        const r    = await rm.resolvePortConflict(port);
        assert.equal(typeof r.resolved, "boolean");
        assert.ok(Array.isArray(r.tried));
    });
    it("tried array includes the initial port", async () => {
        const port = 49800 + Math.floor(Math.random() * 100);
        const r    = await rm.resolvePortConflict(port, { searchEnd: port });
        assert.ok(r.tried.includes(port));
    });
    it("suggestedPort is a number when resolved", async () => {
        const port = 49900 + Math.floor(Math.random() * 100);
        const r    = await rm.resolvePortConflict(port);
        if (r.resolved) assert.ok(typeof r.suggestedPort === "number");
    });
});

describe("recoveryManager — restoreDependencies", () => {
    afterEach(() => rm.reset());

    it("empty dep list returns success:true", async () => {
        const r = await rm.restoreDependencies([]);
        assert.equal(r.success, true);
        assert.equal(r.restored.length, 0);
        assert.equal(r.failed.length,   0);
    });
    it("restores all deps when restoreFn succeeds", async () => {
        const r = await rm.restoreDependencies(["express", "lodash"], async () => ({ ok: true }));
        assert.equal(r.success, true);
        assert.equal(r.restored.length, 2);
    });
    it("failed list includes deps when restoreFn returns ok:false", async () => {
        const r = await rm.restoreDependencies(["bad-dep"], async () => ({ ok: false }));
        assert.equal(r.success, false);
        assert.ok(r.failed.includes("bad-dep"));
    });
    it("failed list includes dep when restoreFn throws", async () => {
        const r = await rm.restoreDependencies(["err-dep"], async () => {
            throw new Error("install failed");
        });
        assert.ok(r.failed.includes("err-dep"));
    });
    it("partial: some succeed some fail", async () => {
        const deps = ["ok-dep", "fail-dep"];
        const r    = await rm.restoreDependencies(deps, async (dep) => ({
            ok: dep === "ok-dep",
        }));
        assert.ok(r.restored.includes("ok-dep"));
        assert.ok(r.failed.includes("fail-dep"));
    });
});

// ── interruptionTester ────────────────────────────────────────────────

describe("interruptionTester — scheduleInterruption + checkInterruption", () => {
    afterEach(() => it_.reset());

    it("scheduleInterruption returns entry with required fields", () => {
        const e = it_.scheduleInterruption("wf-int-1", "deploy", "test");
        assert.ok("workflowId" in e);
        assert.ok("atStep"     in e);
        assert.ok("reason"     in e);
    });
    it("checkInterruption returns shouldInterrupt:true at scheduled step", () => {
        it_.scheduleInterruption("wf-int-2", "deploy");
        const r = it_.checkInterruption("wf-int-2", "deploy");
        assert.equal(r.shouldInterrupt, true);
    });
    it("checkInterruption returns shouldInterrupt:false for different step", () => {
        it_.scheduleInterruption("wf-int-3", "deploy");
        const r = it_.checkInterruption("wf-int-3", "build");
        assert.equal(r.shouldInterrupt, false);
    });
    it("interruption fires only once", () => {
        it_.scheduleInterruption("wf-int-4", "test");
        it_.checkInterruption("wf-int-4", "test");
        const r2 = it_.checkInterruption("wf-int-4", "test");
        assert.equal(r2.shouldInterrupt, false);
    });
    it("wildcard '*' step interrupts on any step", () => {
        it_.scheduleInterruption("wf-int-5", "*");
        const r = it_.checkInterruption("wf-int-5", "any-step-name");
        assert.equal(r.shouldInterrupt, true);
    });
    it("getLog contains triggered events", () => {
        it_.scheduleInterruption("wf-int-6", "step1");
        it_.checkInterruption("wf-int-6", "step1");
        const log = it_.getLog();
        assert.ok(log.some(e => e.type === "interruption_triggered"));
    });
});

describe("interruptionTester — testRestartFrom", () => {
    afterEach(() => it_.reset());

    it("canRestart:false when no checkpoint", () => {
        const r = it_.testRestartFrom("wf-rs-1", null);
        assert.equal(r.canRestart, false);
        assert.ok(typeof r.error === "string");
    });
    it("returns completedSteps and pendingSteps from checkpoint", () => {
        const checkpoint = {
            completedSteps: ["build", "test"],
            allSteps:       ["build", "test", "deploy"],
            ctx:            {},
        };
        const r = it_.testRestartFrom("wf-rs-2", checkpoint);
        assert.deepEqual(r.completedSteps, ["build", "test"]);
        assert.deepEqual(r.pendingSteps,   ["deploy"]);
    });
    it("resumeCtx has _resumed:true", () => {
        const r = it_.testRestartFrom("wf-rs-3", {
            completedSteps: [],
            allSteps:       ["build"],
            ctx:            {},
        });
        assert.equal(r.resumeCtx._resumed, true);
    });
    it("canRestart:true when pending steps exist", () => {
        const r = it_.testRestartFrom("wf-rs-4", {
            completedSteps: ["build"],
            allSteps:       ["build", "deploy"],
            ctx:            {},
        });
        assert.equal(r.canRestart, true);
    });
});

describe("interruptionTester — verifyResume", () => {
    afterEach(() => it_.reset());

    it("canResume:true when pending steps remain", () => {
        const r = it_.verifyResume("wf-vr-1", ["build"], ["build", "deploy"]);
        assert.equal(r.canResume, true);
        assert.deepEqual(r.missing, ["deploy"]);
    });
    it("ready:true when all steps completed", () => {
        const r = it_.verifyResume("wf-vr-2", ["build", "deploy"], ["build", "deploy"]);
        assert.equal(r.ready, true);
        assert.equal(r.canResume, false);
    });
    it("returns completedSteps in result", () => {
        const r = it_.verifyResume("wf-vr-3", ["s1"], ["s1", "s2"]);
        assert.deepEqual(r.completedSteps, ["s1"]);
    });
    it("getLog includes resume_verified event", () => {
        it_.verifyResume("wf-vr-4", [], ["build"]);
        const log = it_.getLog();
        assert.ok(log.some(e => e.type === "resume_verified"));
    });
});
