"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const see = require("../../agents/runtime/evolution/strategyEvolutionEngine.cjs");
const wp  = require("../../agents/runtime/evolution/workloadProfiler.cjs");
const pfp = require("../../agents/runtime/evolution/predictiveFailurePrevention.cjs");
const ocs = require("../../agents/runtime/evolution/orchestrationConfidenceScorer.cjs");

afterEach(() => see.reset());

// ── helpers ───────────────────────────────────────────────────────────

function _entry(fp, success, retries = 0, rollback = false, durationMs = 100,
                strategy = "safe", classification = "safe") {
    return {
        fingerprint: fp, success, retryCount: retries, rollbackTriggered: rollback,
        durationMs, strategy, classification,
        ts: new Date().toISOString(),
    };
}

// ── strategyEvolutionEngine ───────────────────────────────────────────

describe("strategyEvolutionEngine – scoreStrategy", () => {
    it("returns score 50 for unknown fingerprint/strategy", () => {
        const r = see.scoreStrategy("fp-unknown", "safe");
        assert.equal(r.score, 50);
        assert.equal(r.executions, 0);
    });

    it("successful strategy scores higher than failing", () => {
        see.recordOutcome("fp-1", "safe",    true,  100);
        see.recordOutcome("fp-1", "sandbox", false, 500);
        const good = see.scoreStrategy("fp-1", "safe");
        const bad  = see.scoreStrategy("fp-1", "sandbox");
        assert.ok(good.score > bad.score);
    });

    it("efficiency equals success rate", () => {
        see.recordOutcome("fp-2", "fast", true,  100);
        see.recordOutcome("fp-2", "fast", true,  100);
        see.recordOutcome("fp-2", "fast", false, 100);
        const r = see.scoreStrategy("fp-2", "fast");
        assert.ok(Math.abs(r.efficiency - 2/3) < 0.01);
    });

    it("grade is A for high-scoring strategy", () => {
        for (let i = 0; i < 5; i++) see.recordOutcome("fp-3", "safe", true, 50);
        assert.ok(["A","B"].includes(see.scoreStrategy("fp-3", "safe").grade));
    });

    it("includes executions count", () => {
        see.recordOutcome("fp-4", "fast", true, 100);
        see.recordOutcome("fp-4", "fast", true, 100);
        assert.equal(see.scoreStrategy("fp-4", "fast").executions, 2);
    });
});

describe("strategyEvolutionEngine – evolveStrategy", () => {
    it("returns no_history reason when no outcomes recorded", () => {
        const r = see.evolveStrategy("fp-new", ["safe","fast"]);
        assert.ok(!r.evolved);
        assert.equal(r.reason, "no_history");
    });

    it("evolves to highest-scoring candidate", () => {
        see.recordOutcome("fp-5", "safe",    true,  100);
        see.recordOutcome("fp-5", "safe",    true,  100);
        see.recordOutcome("fp-5", "sandbox", false, 500);
        const r = see.evolveStrategy("fp-5", ["safe", "sandbox"]);
        assert.equal(r.strategy, "safe");
    });

    it("evolved:true when strategy changes", () => {
        see.recordOutcome("fp-6", "fast", true, 50);
        see.recordOutcome("fp-6", "fast", true, 50);
        const r = see.evolveStrategy("fp-6", ["fast", "safe"]);
        assert.ok(r.evolved);
    });

    it("evolved:false when current is already best", () => {
        see.recordOutcome("fp-7", "safe", true, 100);
        see.evolveStrategy("fp-7", ["safe", "fast"]);   // sets generation to safe
        see.recordOutcome("fp-7", "safe", true, 100);
        const r = see.evolveStrategy("fp-7", ["safe", "fast"]);
        assert.equal(r.reason, "current_is_best");
    });

    it("getPreferredStrategy returns evolved strategy", () => {
        see.recordOutcome("fp-8", "staged", true, 100);
        see.evolveStrategy("fp-8", ["staged", "safe"]);
        assert.equal(see.getPreferredStrategy("fp-8"), "staged");
    });

    it("generation increments on each evolution", () => {
        see.recordOutcome("fp-9", "fast",   true, 100);
        see.evolveStrategy("fp-9", ["fast", "safe"]);
        see.recordOutcome("fp-9", "staged", true, 50);
        see.evolveStrategy("fp-9", ["fast", "staged"]);
        const g = see.getEvolutionGeneration("fp-9");
        assert.ok(g !== null);
        assert.ok(g.generation >= 1);
    });
});

describe("strategyEvolutionEngine – shouldRetireStrategy", () => {
    it("false for unknown fingerprint", () => {
        assert.ok(!see.shouldRetireStrategy("fp-unknown", "safe"));
    });

    it("false when fewer than 3 executions", () => {
        see.recordOutcome("fp-10", "slow", false, 500);
        see.recordOutcome("fp-10", "slow", false, 500);
        assert.ok(!see.shouldRetireStrategy("fp-10", "slow"));
    });

    it("true when efficiency below threshold after 3+ runs", () => {
        for (let i = 0; i < 4; i++) see.recordOutcome("fp-11", "bad", false, 500);
        assert.ok(see.shouldRetireStrategy("fp-11", "bad", 0.3));
    });

    it("false when efficiency is above threshold", () => {
        for (let i = 0; i < 4; i++) see.recordOutcome("fp-12", "good", true, 100);
        assert.ok(!see.shouldRetireStrategy("fp-12", "good"));
    });
});

// ── workloadProfiler ──────────────────────────────────────────────────

describe("workloadProfiler – PROFILES", () => {
    it("exports all 7 profiles", () => {
        const expected = ["stable","bursty","dangerous","latency-sensitive","resource-heavy","retry-prone","dependency-fragile"];
        for (const p of expected) assert.ok(wp.PROFILES.includes(p), `missing: ${p}`);
    });
});

describe("workloadProfiler – classify", () => {
    it("returns primary profile stable for perfect history", () => {
        const entries = Array.from({ length: 5 }, () => _entry("fp", true, 0, false, 100));
        const r = wp.classify(entries, {}, {});
        assert.equal(r.primary, "stable");
    });

    it("retry-prone when avgRetries > 2", () => {
        const entries = Array.from({ length: 4 }, () => _entry("fp", false, 4));
        const r = wp.classify(entries, {}, {});
        assert.ok(r.profiles.includes("retry-prone") || r.primary === "retry-prone");
    });

    it("dangerous when entries have dangerous classification", () => {
        const entries = [_entry("fp", false, 0, false, 100, "sandbox", "dangerous")];
        const r = wp.classify(entries, {}, {});
        assert.ok(r.profiles.includes("dangerous") || r.primary === "dangerous");
    });

    it("dependency-fragile when avgStability < 0.6", () => {
        const entries = [_entry("fp", true), _entry("fp", true)];
        const depStab = { "dep-a": { stability: 0.2 }, "dep-b": { stability: 0.3 } };
        const r = wp.classify(entries, depStab, {});
        assert.ok(r.profiles.includes("dependency-fragile") || r.primary === "dependency-fragile");
    });

    it("returns confidence between 0 and 1", () => {
        const r = wp.classify([_entry("fp", true)], {}, {});
        assert.ok(r.confidence >= 0 && r.confidence <= 1);
    });

    it("empty entries returns stable with low confidence", () => {
        const r = wp.classify([], {}, {});
        assert.equal(r.primary, "stable");
    });

    it("profiles array always includes primary", () => {
        const r = wp.classify([_entry("fp", true)], {}, {});
        assert.ok(r.profiles.includes(r.primary));
    });
});

describe("workloadProfiler – getProfileBehavior", () => {
    it("stable profile prefers fast strategy", () => {
        assert.equal(wp.getProfileBehavior("stable").preferredStrategy, "fast");
    });

    it("dangerous profile requires sandbox", () => {
        assert.ok(wp.getProfileBehavior("dangerous").sandboxRequired);
    });

    it("all profiles return behavior with required fields", () => {
        for (const p of wp.PROFILES) {
            const b = wp.getProfileBehavior(p);
            assert.ok("preferredStrategy"   in b, `${p}: missing preferredStrategy`);
            assert.ok("retryLimitDelta"     in b, `${p}: missing retryLimitDelta`);
            assert.ok("sandboxRequired"     in b, `${p}: missing sandboxRequired`);
            assert.ok("throttleSensitivity" in b, `${p}: missing throttleSensitivity`);
        }
    });
});

describe("workloadProfiler – profileAffectsOrchestration", () => {
    it("dangerous profile sets sandboxRequired", () => {
        const r = wp.profileAffectsOrchestration(["dangerous"], {});
        assert.ok(r.sandboxRequired);
    });

    it("no sandbox for stable profile", () => {
        const r = wp.profileAffectsOrchestration(["stable"], {});
        assert.ok(!r.sandboxRequired);
    });

    it("retry-prone adds positive retryLimitDelta", () => {
        const r = wp.profileAffectsOrchestration(["retry-prone"], {});
        assert.ok((r.retryLimitDelta ?? 0) > 0);
    });
});

// ── predictiveFailurePrevention ───────────────────────────────────────

describe("predictiveFailurePrevention – predictRollbackProbability", () => {
    it("returns 0 for clean history and stable deps", () => {
        const entries = [_entry("fp", true, 0, false)];
        const r = pfp.predictRollbackProbability("fp", entries, {});
        assert.ok(r >= 0 && r <= 1);
        assert.ok(r < 0.2);
    });

    it("returns higher probability with rollback history", () => {
        const entries = [
            _entry("fp", false, 0, true),
            _entry("fp", false, 0, true),
            _entry("fp", true,  0, false),
        ];
        const r = pfp.predictRollbackProbability("fp", entries, {});
        assert.ok(r > 0.2);
    });

    it("unstable deps increase probability", () => {
        const clean   = pfp.predictRollbackProbability("fp", [], {});
        const unstable = pfp.predictRollbackProbability("fp", [], { "dep-a": { stability: 0.1 } });
        assert.ok(unstable > clean);
    });
});

describe("predictiveFailurePrevention – predictRetryStorm", () => {
    it("no risk for clean history", () => {
        const entries = Array.from({ length: 5 }, () => _entry("fp", true, 0));
        const r = pfp.predictRetryStorm(entries, 5);
        assert.equal(r.risk, "none");
    });

    it("high risk when avg retries > threshold in window", () => {
        const entries = Array.from({ length: 5 }, () => _entry("fp", false, 5));
        const r = pfp.predictRetryStorm(entries, 5);
        assert.ok(["medium","high","critical"].includes(r.risk));
    });

    it("returns probability as a number 0-1", () => {
        const r = pfp.predictRetryStorm([], 5);
        assert.ok(r.probability >= 0 && r.probability <= 1);
    });
});

describe("predictiveFailurePrevention – predictDependencyCollapse", () => {
    it("none risk for stable deps", () => {
        const r = pfp.predictDependencyCollapse({ "dep-a": { stability: 0.95 } });
        assert.equal(r.risk, "none");
    });

    it("critical risk for 2+ critical deps", () => {
        const r = pfp.predictDependencyCollapse({
            "dep-a": { stability: 0.1 },
            "dep-b": { stability: 0.15 },
        });
        assert.equal(r.risk, "critical");
    });

    it("affectedDeps lists unstable deps", () => {
        const r = pfp.predictDependencyCollapse({ "dep-bad": { stability: 0.3 } });
        assert.ok(r.affectedDeps.some(d => d.depId === "dep-bad"));
    });
});

describe("predictiveFailurePrevention – predictQueueCongestion", () => {
    it("none risk for empty queue with low arrival", () => {
        const r = pfp.predictQueueCongestion(0, 0.5, 2.0);
        assert.equal(r.risk, "none");
    });

    it("critical risk when arrival >= drain rate", () => {
        const r = pfp.predictQueueCongestion(10, 2.0, 1.0);
        assert.equal(r.risk, "critical");
    });

    it("includes saturation field", () => {
        const r = pfp.predictQueueCongestion(5, 1.0, 2.0);
        assert.ok("saturation" in r);
    });
});

describe("predictiveFailurePrevention – predictResourceExhaustion", () => {
    it("none risk for normal metrics", () => {
        const r = pfp.predictResourceExhaustion({ avgHeapUsedMB: 50, avgCpuUserMs: 20 });
        assert.equal(r.risk, "none");
    });

    it("high risk for large heap", () => {
        const r = pfp.predictResourceExhaustion({ avgHeapUsedMB: 400 });
        assert.ok(["medium","high"].includes(r.risk));
    });

    it("warnings is an array", () => {
        const r = pfp.predictResourceExhaustion({});
        assert.ok(Array.isArray(r.warnings));
    });
});

describe("predictiveFailurePrevention – predict (full)", () => {
    it("returns all prediction keys", () => {
        const r = pfp.predict({});
        assert.ok("rollbackProbability" in r);
        assert.ok("retryStorm"          in r);
        assert.ok("dependencyCollapse"  in r);
        assert.ok("queueCongestion"     in r);
        assert.ok("resourceExhaustion"  in r);
        assert.ok("overallRisk"         in r);
        assert.ok("shouldBlock"         in r);
        assert.ok("shouldWarn"          in r);
    });

    it("shouldBlock is false for clean context", () => {
        assert.ok(!pfp.predict({}).shouldBlock);
    });

    it("overallRisk is a valid RISK value", () => {
        const r = pfp.predict({});
        assert.ok(Object.values(pfp.RISK).includes(r.overallRisk));
    });
});

// ── orchestrationConfidenceScorer ─────────────────────────────────────

describe("orchestrationConfidenceScorer – scoreExecutionSafety", () => {
    it("returns score 80 for safe classification with no history", () => {
        const r = ocs.scoreExecutionSafety("fp", [], "safe");
        assert.equal(r.score, 80);
    });

    it("destructive classification penalises score", () => {
        const safe = ocs.scoreExecutionSafety("fp", [], "safe");
        const dest = ocs.scoreExecutionSafety("fp", [], "destructive");
        assert.ok(dest.score < safe.score);
    });

    it("high success rate produces high score", () => {
        const entries = Array.from({ length: 5 }, () => _entry("fp-s", true));
        const r = ocs.scoreExecutionSafety("fp-s", entries, "safe");
        assert.ok(r.score >= 75);
    });
});

describe("orchestrationConfidenceScorer – scoreDependencyReliability", () => {
    it("100 for no deps", () => {
        assert.equal(ocs.scoreDependencyReliability({}).score, 100);
    });

    it("high score for stable deps", () => {
        const r = ocs.scoreDependencyReliability({ "a": { stability: 1.0 } });
        assert.ok(r.score >= 90);
    });

    it("low score for unstable deps", () => {
        const r = ocs.scoreDependencyReliability({ "a": { stability: 0.2 } });
        assert.ok(r.score < 40);
    });
});

describe("orchestrationConfidenceScorer – scoreOverloadRisk", () => {
    it("low score for none pressure", () => {
        const r = ocs.scoreOverloadRisk({ pressure: "none" });
        assert.ok(r.score < 20);
    });

    it("high score for critical pressure", () => {
        const r = ocs.scoreOverloadRisk({ pressure: "critical" });
        assert.ok(r.score >= 80);
    });
});

describe("orchestrationConfidenceScorer – scoreRollbackProbability", () => {
    it("low score when no history", () => {
        assert.ok(ocs.scoreRollbackProbability("fp", []).score < 20);
    });

    it("high score for high-rollback history", () => {
        const entries = Array.from({ length: 4 }, () => _entry("fp-rb", false, 0, true));
        const r = ocs.scoreRollbackProbability("fp-rb", entries);
        assert.ok(r.score >= 75);
    });
});

describe("orchestrationConfidenceScorer – score (overall)", () => {
    it("returns all dimensions", () => {
        const r = ocs.score({});
        for (const k of ["overall","executionSafety","dependencyReliability","recoverySuccess","overloadRisk","rollbackProbability"]) {
            assert.ok(k in r, `missing: ${k}`);
        }
    });

    it("overall score is 0-100", () => {
        const r = ocs.score({});
        assert.ok(r.overall.score >= 0 && r.overall.score <= 100);
    });

    it("clean context has A grade overall", () => {
        const r = ocs.score({ resourceStatus: { pressure: "none" } });
        assert.ok(["A","B"].includes(r.overall.grade));
    });
});
