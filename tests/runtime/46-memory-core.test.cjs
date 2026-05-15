"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const ms  = require("../../agents/runtime/memory/executionMemoryStore.cjs");
const wfp = require("../../agents/runtime/memory/workflowFingerprint.cjs");
const dst = require("../../agents/runtime/memory/dependencyStabilityTracker.cjs");
const ea  = require("../../agents/runtime/memory/executionAnalytics.cjs");

// ── executionMemoryStore ──────────────────────────────────────────────

describe("executionMemoryStore", () => {
    afterEach(() => ms.reset());

    describe("record", () => {
        it("stamps id and ts on each entry", () => {
            const e = ms.record({ success: true, taskId: "t1" });
            assert.ok(e.id.startsWith("mem-"));
            assert.ok(!isNaN(Date.parse(e.ts)));
        });

        it("defaults retryCount to 0 and rollbackTriggered to false", () => {
            const e = ms.record({ success: true });
            assert.equal(e.retryCount, 0);
            assert.equal(e.rollbackTriggered, false);
        });

        it("preserves provided fields", () => {
            const e = ms.record({ success: false, taskId: "t2", strategy: "staged", durationMs: 500 });
            assert.equal(e.taskId, "t2");
            assert.equal(e.durationMs, 500);
        });

        it("sequential ids increment", () => {
            const a = ms.record({ success: true });
            const b = ms.record({ success: true });
            assert.ok(a.id < b.id);
        });
    });

    describe("getSuccessful + getFailed", () => {
        it("getSuccessful returns only success:true entries", () => {
            ms.record({ success: true  });
            ms.record({ success: false });
            ms.record({ success: true  });
            assert.equal(ms.getSuccessful().length, 2);
        });

        it("getFailed returns only success:false entries", () => {
            ms.record({ success: true  });
            ms.record({ success: false });
            assert.equal(ms.getFailed().length, 1);
        });

        it("limit parameter slices from the end", () => {
            for (let i = 0; i < 5; i++) ms.record({ success: true });
            assert.equal(ms.getSuccessful(3).length, 3);
        });
    });

    describe("getRecoveryPatterns", () => {
        it("returns only rollbackTriggered entries", () => {
            ms.record({ success: false, rollbackTriggered: true  });
            ms.record({ success: false, rollbackTriggered: false });
            assert.equal(ms.getRecoveryPatterns().length, 1);
        });
    });

    describe("getRetryPatterns", () => {
        it("returns entries with retryCount > 0", () => {
            ms.record({ success: true,  retryCount: 2 });
            ms.record({ success: false, retryCount: 0 });
            assert.equal(ms.getRetryPatterns().length, 1);
        });
    });

    describe("getDependencyFailures", () => {
        it("returns failed entries with dep/install in failureReason", () => {
            ms.record({ success: false, failureReason: "package install failed" });
            ms.record({ success: false, failureReason: "network error" });
            ms.record({ success: false, failureReason: "dependency missing" });
            assert.equal(ms.getDependencyFailures().length, 2);
        });

        it("does not return success entries even with dep in reason", () => {
            ms.record({ success: true, failureReason: "dependency missing" });
            assert.equal(ms.getDependencyFailures().length, 0);
        });
    });

    describe("getDurationHistory", () => {
        it("returns all entries with durationMs", () => {
            ms.record({ success: true, durationMs: 100, taskId: "a" });
            ms.record({ success: true, durationMs: 200, taskId: "b" });
            ms.record({ success: true });   // no durationMs — excluded
            assert.equal(ms.getDurationHistory().length, 2);
        });

        it("filters by taskId when given", () => {
            ms.record({ success: true, durationMs: 100, taskId: "a" });
            ms.record({ success: true, durationMs: 200, taskId: "b" });
            assert.equal(ms.getDurationHistory("a").length, 1);
        });
    });

    describe("getAll", () => {
        it("returns a copy of all entries", () => {
            ms.record({ success: true });
            ms.record({ success: false });
            const all = ms.getAll();
            assert.equal(all.length, 2);
            all.push({ fake: true });
            assert.equal(ms.getAll().length, 2);  // copy, not reference
        });
    });
});

// ── workflowFingerprint ───────────────────────────────────────────────

describe("workflowFingerprint", () => {
    describe("generate", () => {
        it("returns an 8-char hex string", () => {
            const fp = wfp.generate({ steps: ["a", "b"] });
            assert.ok(typeof fp === "string" && fp.length === 8);
            assert.ok(/^[0-9a-f]{8}$/.test(fp));
        });

        it("same workflow produces same fingerprint (deterministic)", () => {
            const w = { steps: ["install", "build", "test"], category: "ci" };
            assert.equal(wfp.generate(w), wfp.generate(w));
        });

        it("different step order changes fingerprint", () => {
            const fp1 = wfp.generate({ steps: ["a", "b"] });
            const fp2 = wfp.generate({ steps: ["b", "a"] });
            // sorted internally — same fingerprint
            assert.equal(fp1, fp2);
        });

        it("different category changes fingerprint", () => {
            const fp1 = wfp.generate({ steps: ["a"], category: "ci" });
            const fp2 = wfp.generate({ steps: ["a"], category: "deploy" });
            assert.notEqual(fp1, fp2);
        });

        it("different steps change fingerprint", () => {
            const fp1 = wfp.generate({ steps: ["a", "b"] });
            const fp2 = wfp.generate({ steps: ["a", "c"] });
            assert.notEqual(fp1, fp2);
        });

        it("accepts object steps with id field", () => {
            const fp = wfp.generate({ steps: [{ id: "install" }, { id: "build" }] });
            assert.ok(/^[0-9a-f]{8}$/.test(fp));
        });
    });

    describe("match", () => {
        it("returns true for equal fingerprints", () => {
            const fp = wfp.generate({ steps: ["x"] });
            assert.ok(wfp.match(fp, fp));
        });

        it("returns false for different fingerprints", () => {
            const fp1 = wfp.generate({ steps: ["x"] });
            const fp2 = wfp.generate({ steps: ["y"] });
            assert.ok(!wfp.match(fp1, fp2));
        });
    });

    describe("describe", () => {
        it("includes step count and fingerprint", () => {
            const label = wfp.describe({ steps: ["a", "b"], category: "test" });
            assert.ok(label.includes("2steps"));
            assert.ok(label.includes("test"));
        });
    });
});

// ── dependencyStabilityTracker ────────────────────────────────────────

describe("dependencyStabilityTracker", () => {
    afterEach(() => dst.reset());

    describe("record + getStability", () => {
        it("unknown dep has stability 1.0", () => {
            assert.equal(dst.getStability("ghost").stability, 1.0);
        });

        it("all successes → stability 1.0", () => {
            dst.record("npm", { type: "install_success" });
            dst.record("npm", { type: "install_success" });
            assert.equal(dst.getStability("npm").stability, 1.0);
        });

        it("all failures → stability 0.0", () => {
            dst.record("api", { type: "api_failure" });
            dst.record("api", { type: "api_failure" });
            assert.equal(dst.getStability("api").stability, 0);
        });

        it("mixed → stability is success/(success+failure)", () => {
            dst.record("tool", { type: "tool_success" });
            dst.record("tool", { type: "tool_failure" });
            assert.equal(dst.getStability("tool").stability, 0.5);
        });

        it("counts failures and successes correctly", () => {
            dst.record("x", { type: "install_success" });
            dst.record("x", { type: "install_failure" });
            dst.record("x", { type: "install_failure" });
            const s = dst.getStability("x");
            assert.equal(s.successes, 1);
            assert.equal(s.failures, 2);
        });

        it("env_inconsistency counts as failure", () => {
            dst.record("env", { type: "env_inconsistency" });
            assert.equal(dst.getStability("env").failures, 1);
        });
    });

    describe("isUnstable + getUnstable", () => {
        it("isUnstable false for stable dep", () => {
            dst.record("ok", { type: "tool_success" });
            assert.ok(!dst.isUnstable("ok"));
        });

        it("isUnstable true when stability < threshold", () => {
            dst.record("bad", { type: "api_failure" });
            dst.record("bad", { type: "api_failure" });
            assert.ok(dst.isUnstable("bad"));
        });

        it("getUnstable returns ids below threshold", () => {
            dst.record("a", { type: "tool_failure" });
            dst.record("a", { type: "tool_failure" });
            dst.record("b", { type: "tool_success" });
            const unstable = dst.getUnstable();
            assert.ok(unstable.includes("a"));
            assert.ok(!unstable.includes("b"));
        });
    });

    describe("getAll", () => {
        it("returns stability for every tracked dep", () => {
            dst.record("x", { type: "install_success" });
            dst.record("y", { type: "api_failure" });
            const all = dst.getAll();
            assert.ok("x" in all && "y" in all);
        });
    });
});

// ── executionAnalytics ────────────────────────────────────────────────

describe("executionAnalytics", () => {
    describe("compute", () => {
        it("empty entries returns zero report", () => {
            const r = ea.compute([]);
            assert.equal(r.totalExecutions, 0);
            assert.equal(r.successRate, 0);
        });

        it("all successes → successRate 1.0", () => {
            const r = ea.compute([
                { success: true, retryCount: 0, rollbackTriggered: false },
                { success: true, retryCount: 0, rollbackTriggered: false },
            ]);
            assert.equal(r.successRate, 1);
        });

        it("rollbackFrequency computed correctly", () => {
            const r = ea.compute([
                { success: false, rollbackTriggered: true  },
                { success: true,  rollbackTriggered: false },
            ]);
            assert.equal(r.rollbackFrequency, 0.5);
        });

        it("avgRetries computed from retry entries only", () => {
            const r = ea.compute([
                { success: true,  retryCount: 0 },
                { success: false, retryCount: 4 },
            ]);
            assert.equal(r.avgRetries, 4);  // only retryCount>0 entries averaged
        });

        it("workflowStability = clean-run fraction", () => {
            const r = ea.compute([
                { success: true,  retryCount: 0, rollbackTriggered: false },
                { success: true,  retryCount: 2, rollbackTriggered: false },
                { success: false, retryCount: 0, rollbackTriggered: false },
            ]);
            assert.equal(r.workflowStability, Math.round(1/3 * 1000) / 1000);
        });

        it("avgDurationMs is average of entries with durationMs", () => {
            const r = ea.compute([
                { success: true, durationMs: 100 },
                { success: true, durationMs: 200 },
                { success: true },  // no durationMs
            ]);
            assert.equal(r.avgDurationMs, 150);
        });

        it("topStrategies sorted by count descending", () => {
            const r = ea.compute([
                { success: true, strategy: "direct" },
                { success: true, strategy: "direct" },
                { success: true, strategy: "staged"  },
            ]);
            assert.equal(r.topStrategies[0].strategy, "direct");
            assert.equal(r.topStrategies[0].count, 2);
        });
    });

    describe("summary", () => {
        it("returns a string with key stats", () => {
            const r  = ea.compute([{ success: true, retryCount: 0, rollbackTriggered: false, durationMs: 100 }]);
            const s  = ea.summary(r);
            assert.ok(typeof s === "string");
            assert.ok(s.includes("total=1"));
            assert.ok(s.includes("success="));
        });
    });

    describe("byFingerprint", () => {
        it("groups reports by fingerprint", () => {
            const entries = [
                { success: true,  fingerprint: "aaaa0001" },
                { success: false, fingerprint: "aaaa0001" },
                { success: true,  fingerprint: "bbbb0002" },
            ];
            const map = ea.byFingerprint(entries);
            assert.ok(map.has("aaaa0001"));
            assert.ok(map.has("bbbb0002"));
            assert.equal(map.get("aaaa0001").totalExecutions, 2);
            assert.equal(map.get("bbbb0002").totalExecutions, 1);
        });
    });
});
