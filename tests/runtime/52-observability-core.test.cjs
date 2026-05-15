"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const mc  = require("../../agents/runtime/observability/metricsCollector.cjs");
const bd  = require("../../agents/runtime/observability/bottleneckDetector.cjs");
const hs  = require("../../agents/runtime/observability/healthScorer.cjs");
const ad  = require("../../agents/runtime/observability/anomalyDetector.cjs");

afterEach(() => mc.reset());

// ── helpers ───────────────────────────────────────────────────────────

function _result(success, durationMs = 100, steps = 2, retries = 0, rollback = false, strategy = "safe") {
    return {
        executionId:      `exec-${Math.random().toString(36).slice(2,8)}`,
        success,
        state:            success ? "completed" : "failed",
        strategy,
        totalDurationMs:  durationMs,
        rollbackTriggered: rollback,
        steps: Array.from({ length: steps }, (_, i) => ({
            id: `s${i}`, state: success ? "completed" : "failed", attempts: 1 + (i === 0 ? retries : 0),
        })),
        _integration: {
            fingerprint: "fp-test",
            strategy,
            memoryEntry: { retryCount: retries },
        },
    };
}

function _entry(fp, success, retries = 0, rollback = false, durationMs = 100, strategy = "safe") {
    return {
        fingerprint: fp,
        success,
        retryCount: retries,
        rollbackTriggered: rollback,
        durationMs,
        strategy,
        stepsSpawned: 2,
        ts: new Date().toISOString(),
    };
}

// ── metricsCollector ──────────────────────────────────────────────────

describe("metricsCollector – record", () => {
    it("records an entry and returns it", () => {
        const r = mc.record(_result(true));
        assert.ok(typeof r.executionId === "string" || r.executionId === null);
        assert.ok(typeof r.durationMs === "number");
    });

    it("getAll returns recorded entries", () => {
        mc.record(_result(true));
        mc.record(_result(false));
        assert.equal(mc.getAll().length, 2);
    });

    it("entry has ts field", () => {
        mc.record(_result(true));
        assert.ok("ts" in mc.getAll()[0]);
    });

    it("entry tracks rollbackTriggered", () => {
        mc.record(_result(true, 100, 2, 0, true));
        assert.ok(mc.getAll()[0].rollbackTriggered);
    });

    it("entry tracks stepsSpawned", () => {
        mc.record(_result(true, 100, 3));
        assert.equal(mc.getAll()[0].stepsSpawned, 3);
    });

    it("entry tracks heapUsedBytes as number", () => {
        mc.record(_result(true));
        assert.ok(typeof mc.getAll()[0].heapUsedBytes === "number");
    });

    it("reset clears all records", () => {
        mc.record(_result(true));
        mc.reset();
        assert.equal(mc.getAll().length, 0);
    });
});

describe("metricsCollector – getSummary", () => {
    it("empty summary has totalExecutions 0", () => {
        assert.equal(mc.getSummary().totalExecutions, 0);
    });

    it("successRate is correct", () => {
        mc.record(_result(true));
        mc.record(_result(false));
        assert.equal(mc.getSummary().successRate, 0.5);
    });

    it("avgDurationMs is correct", () => {
        mc.record(_result(true,  200));
        mc.record(_result(false, 400));
        assert.equal(mc.getSummary().avgDurationMs, 300);
    });

    it("rollbackFrequency is correct", () => {
        mc.record(_result(true, 100, 2, 0, true));
        mc.record(_result(true, 100, 2, 0, false));
        assert.equal(mc.getSummary().rollbackFrequency, 0.5);
    });

    it("totalRetries sums all retryCount values", () => {
        mc.record(_result(true, 100, 2, 2));
        mc.record(_result(true, 100, 2, 1));
        assert.equal(mc.getSummary().totalRetries, 3);
    });

    it("summary includes avgHeapUsedMB as number", () => {
        mc.record(_result(true));
        assert.ok(typeof mc.getSummary().avgHeapUsedMB === "number");
    });
});

// ── bottleneckDetector ────────────────────────────────────────────────

describe("bottleneckDetector – detectSlowWorkflows", () => {
    it("detects workflow exceeding threshold", () => {
        const entries = [_entry("fp-slow", true, 0, false, 9000)];
        const r = bd.detectSlowWorkflows(entries, 5000);
        assert.ok(r.some(x => x.fingerprint === "fp-slow"));
    });

    it("does not flag workflow under threshold", () => {
        const entries = [_entry("fp-fast", true, 0, false, 1000)];
        assert.equal(bd.detectSlowWorkflows(entries, 5000).length, 0);
    });

    it("includes avgDurationMs in result", () => {
        const entries = [_entry("fp1", true, 0, false, 6000), _entry("fp1", true, 0, false, 8000)];
        const r = bd.detectSlowWorkflows(entries, 5000);
        assert.ok(r[0].avgDurationMs >= 6000);
    });
});

describe("bottleneckDetector – detectUnstableTools", () => {
    it("flags dep with stability below threshold", () => {
        const depStab = { "pkg-a": { stability: 0.3 } };
        const r = bd.detectUnstableTools(depStab, 0.7);
        assert.ok(r.some(x => x.depId === "pkg-a"));
    });

    it("does not flag stable dep", () => {
        const depStab = { "pkg-b": { stability: 0.95 } };
        assert.equal(bd.detectUnstableTools(depStab, 0.7).length, 0);
    });
});

describe("bottleneckDetector – detectRetryHeavySteps", () => {
    it("detects fingerprint with avg retries above threshold", () => {
        const entries = [
            _entry("fp-retry", true,  3),
            _entry("fp-retry", false, 4),
        ];
        const r = bd.detectRetryHeavySteps(entries, 2);
        assert.ok(r.some(x => x.fingerprint === "fp-retry"));
    });

    it("does not flag low-retry fingerprint", () => {
        const entries = [_entry("fp-ok", true, 0)];
        assert.equal(bd.detectRetryHeavySteps(entries, 2).length, 0);
    });
});

describe("bottleneckDetector – detectRollbackZones", () => {
    it("flags fingerprint with high rollback rate", () => {
        const entries = [
            _entry("fp-rb", false, 0, true),
            _entry("fp-rb", false, 0, true),
            _entry("fp-rb", true,  0, false),
        ];
        const r = bd.detectRollbackZones(entries, 0.3);
        assert.ok(r.some(x => x.fingerprint === "fp-rb"));
    });

    it("needs at least 2 entries", () => {
        const entries = [_entry("fp-one", false, 0, true)];
        assert.equal(bd.detectRollbackZones(entries, 0.3).length, 0);
    });
});

describe("bottleneckDetector – detectMemoryPressure", () => {
    it("detects pressure when heapMB exceeds threshold", () => {
        const r = bd.detectMemoryPressure({ avgHeapUsedMB: 300 }, 200);
        assert.ok(r.length > 0);
        assert.ok(r[0].pressure);
    });

    it("returns empty when within threshold", () => {
        const r = bd.detectMemoryPressure({ avgHeapUsedMB: 100 }, 200);
        assert.equal(r.length, 0);
    });
});

describe("bottleneckDetector – detectAll", () => {
    it("returns all 6 bottleneck categories", () => {
        const r = bd.detectAll([], {}, {});
        assert.ok("slowWorkflows"   in r);
        assert.ok("unstableTools"   in r);
        assert.ok("retryHeavySteps" in r);
        assert.ok("blockingDeps"    in r);
        assert.ok("rollbackZones"   in r);
        assert.ok("memoryPressure"  in r);
    });
});

// ── healthScorer ──────────────────────────────────────────────────────

describe("healthScorer – scoreWorkflowStability", () => {
    it("returns score 100 for empty entries", () => {
        assert.equal(hs.scoreWorkflowStability([]).score, 100);
    });

    it("all-success history has high score", () => {
        const entries = Array.from({ length: 5 }, () => _entry("fp", true, 0, false));
        const r = hs.scoreWorkflowStability(entries);
        assert.ok(r.score >= 75, `expected >=75, got ${r.score}`);
    });

    it("all-failure history has low score", () => {
        const entries = Array.from({ length: 5 }, () => _entry("fp", false, 2, true));
        const r = hs.scoreWorkflowStability(entries);
        assert.ok(r.score < 60, `expected <60, got ${r.score}`);
    });

    it("includes grade field", () => {
        const r = hs.scoreWorkflowStability([]);
        assert.ok(["A","B","C","D","F"].includes(r.grade));
    });
});

describe("healthScorer – scoreDependencyReliability", () => {
    it("returns score 100 for no deps", () => {
        assert.equal(hs.scoreDependencyReliability({}).score, 100);
    });

    it("all-stable deps score high", () => {
        const r = hs.scoreDependencyReliability({ "a": { stability: 1.0 }, "b": { stability: 0.95 } });
        assert.ok(r.score >= 90);
    });

    it("unstable dep reduces score", () => {
        const r = hs.scoreDependencyReliability({ "a": { stability: 0.3 } });
        assert.ok(r.score < 60);
    });
});

describe("healthScorer – scoreRecoveryEfficiency", () => {
    it("returns 100 for no history", () => {
        assert.equal(hs.scoreRecoveryEfficiency([]).score, 100);
    });

    it("returns 100 when no rollbacks occurred", () => {
        const entries = [_entry("fp", true, 0, false)];
        assert.equal(hs.scoreRecoveryEfficiency(entries).score, 100);
    });

    it("rollback followed by success increases score", () => {
        const entries = [_entry("fp", false, 0, true), _entry("fp", true, 0, false)];
        const r = hs.scoreRecoveryEfficiency(entries);
        assert.ok(r.score > 0);
    });
});

describe("healthScorer – score (overall)", () => {
    it("returns overall, workflowStability, dependencyReliability, recoveryEfficiency, trustStability", () => {
        const r = hs.score([], {});
        assert.ok("overall"               in r);
        assert.ok("workflowStability"     in r);
        assert.ok("dependencyReliability" in r);
        assert.ok("recoveryEfficiency"    in r);
        assert.ok("trustStability"        in r);
    });

    it("overall score is 0–100", () => {
        const entries = [_entry("fp", true), _entry("fp", false)];
        const r = hs.score(entries, {});
        assert.ok(r.overall.score >= 0 && r.overall.score <= 100);
    });

    it("overall grade is A–F", () => {
        const r = hs.score([], {});
        assert.ok(["A","B","C","D","F"].includes(r.overall.grade));
    });

    it("empty history produces full-health A score", () => {
        const r = hs.score([], {});
        assert.equal(r.overall.grade, "A");
    });
});

// ── anomalyDetector ───────────────────────────────────────────────────

describe("anomalyDetector – detectRetrySpike", () => {
    it("detects spike when avg retries > threshold in window", () => {
        const entries = Array.from({ length: 5 }, () => _entry("fp", false, 5));
        const r = ad.detectRetrySpike(entries, { window: 5, threshold: 3 });
        assert.ok(r.detected);
    });

    it("no spike for low retries", () => {
        const entries = [_entry("fp", true, 0)];
        const r = ad.detectRetrySpike(entries, { window: 5, threshold: 3 });
        assert.ok(!r.detected);
    });

    it("returns anomaly with type retry_spike", () => {
        const entries = Array.from({ length: 3 }, () => _entry("fp", false, 5));
        const r = ad.detectRetrySpike(entries, { window: 3, threshold: 2 });
        if (r.detected) assert.equal(r.anomalies[0].type, "retry_spike");
    });
});

describe("anomalyDetector – detectExcessiveSpawning", () => {
    it("detects when total steps in window > threshold", () => {
        const entries = Array.from({ length: 3 }, () => ({ stepsSpawned: 10, ts: new Date().toISOString(), fingerprint: "fp" }));
        const r = ad.detectExcessiveSpawning(entries, { window: 3, threshold: 20 });
        assert.ok(r.detected);
    });

    it("no detection for low spawning", () => {
        const entries = [{ stepsSpawned: 2, ts: new Date().toISOString(), fingerprint: "fp" }];
        const r = ad.detectExcessiveSpawning(entries, { window: 5, threshold: 20 });
        assert.ok(!r.detected);
    });
});

describe("anomalyDetector – detectRepeatedLoops", () => {
    it("detects loop when same fp executes many times in short window", () => {
        const now = new Date().toISOString();
        const entries = Array.from({ length: 4 }, () => ({ fingerprint: "fp-loop", ts: now, success: true }));
        const r = ad.detectRepeatedLoops(entries, "fp-loop", { window: 4, threshold: 3, loopWindowMs: 60000 });
        assert.ok(r.detected);
    });

    it("no loop for different fingerprints", () => {
        const entries = [
            { fingerprint: "fp-a", ts: new Date().toISOString() },
            { fingerprint: "fp-b", ts: new Date().toISOString() },
        ];
        assert.ok(!ad.detectRepeatedLoops(entries, "fp-a", { window: 5, threshold: 3 }).detected);
    });
});

describe("anomalyDetector – detectRollbackCycles", () => {
    it("detects cycle when rollback rate exceeds threshold", () => {
        const entries = [
            _entry("fp-cyc", false, 0, true),
            _entry("fp-cyc", false, 0, true),
            _entry("fp-cyc", false, 0, true),
        ];
        const r = ad.detectRollbackCycles(entries, "fp-cyc", { threshold: 0.5 });
        assert.ok(r.detected);
    });

    it("no cycle for single entry", () => {
        const entries = [_entry("fp-one", false, 0, true)];
        assert.ok(!ad.detectRollbackCycles(entries, "fp-one", { threshold: 0.5 }).detected);
    });
});

describe("anomalyDetector – detectExecutionDrift", () => {
    it("detects drift when 3+ strategies used for same fingerprint", () => {
        const entries = [
            _entry("fp-drift", true, 0, false, 100, "safe"),
            _entry("fp-drift", true, 0, false, 100, "fast"),
            _entry("fp-drift", true, 0, false, 100, "sandbox"),
        ];
        const r = ad.detectExecutionDrift(entries, "fp-drift", { window: 5 });
        assert.ok(r.detected);
    });

    it("no drift for single strategy", () => {
        const entries = [
            _entry("fp-stable", true, 0, false, 100, "safe"),
            _entry("fp-stable", true, 0, false, 100, "safe"),
        ];
        assert.ok(!ad.detectExecutionDrift(entries, "fp-stable", { window: 5 }).detected);
    });
});

describe("anomalyDetector – detectAll", () => {
    it("returns detected, count, anomalies, severity", () => {
        const r = ad.detectAll([]);
        assert.ok("detected"  in r);
        assert.ok("count"     in r);
        assert.ok("anomalies" in r);
        assert.ok("severity"  in r);
    });

    it("empty entries → not detected", () => {
        assert.ok(!ad.detectAll([]).detected);
    });

    it("severity is none for no anomalies", () => {
        assert.equal(ad.detectAll([]).severity, "none");
    });
});
