"use strict";
const { describe, it, before, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const rs  = require("../../agents/runtime/benchmark/reliabilityScorer.cjs");
const ra  = require("../../agents/runtime/benchmark/repairAnalytics.cjs");
const oa  = require("../../agents/runtime/benchmark/optimizationAdvisor.cjs");
const hs  = require("../../agents/runtime/benchmark/healthScorer.cjs");
const at  = require("../../agents/runtime/benchmark/adaptiveTuner.cjs");
const bh  = require("../../agents/runtime/benchmark/benchmarkHistory.cjs");
const ca  = require("../../agents/runtime/benchmark/costAnalyzer.cjs");

// ── reliabilityScorer ────────────────────────────────────────────────────────

describe("reliabilityScorer", () => {
    afterEach(() => { bh.reset(); ca.reset(); });

    describe("scoreWorkflow", () => {
        it("returns 50 for unknown workflow (no history)", () => {
            const s = rs.scoreWorkflow("no-such-workflow");
            assert.equal(s, 50);
        });

        it("returns 0–100 for history with varying success rates", () => {
            bh.snapshot("wf-score", { successRate: 0.90, flipRate: 0 });
            bh.snapshot("wf-score", { successRate: 0.85, flipRate: 0 });
            bh.snapshot("wf-score", { successRate: 0.88, flipRate: 0 });
            const s = rs.scoreWorkflow("wf-score");
            assert.ok(s >= 0 && s <= 100, `got ${s}`);
        });

        it("penalises high variance", () => {
            const stableHistory = [
                { metrics: { successRate: 0.90 } },
                { metrics: { successRate: 0.90 } },
                { metrics: { successRate: 0.90 } },
            ];
            const volatileHistory = [
                { metrics: { successRate: 0.10 } },
                { metrics: { successRate: 0.90 } },
                { metrics: { successRate: 0.10 } },
            ];
            const stable   = rs.scoreWorkflow("x", stableHistory);
            const volatile = rs.scoreWorkflow("x", volatileHistory);
            assert.ok(stable > volatile, `stable=${stable} should beat volatile=${volatile}`);
        });

        it("accepts explicit history array (bypasses bh)", () => {
            const hist = [
                { metrics: { successRate: 1.0 } },
                { metrics: { successRate: 1.0 } },
            ];
            const s = rs.scoreWorkflow("any", hist);
            assert.ok(s > 50);
        });
    });

    describe("scoreRepair", () => {
        it("returns 50 for empty repairs array", () => {
            assert.equal(rs.scoreRepair("type_error", []), 50);
        });

        it("returns higher score for all-success repairs", () => {
            const repairs = Array(5).fill({ success: true, retries: 0 });
            const s = rs.scoreRepair("syntax_error", repairs);
            assert.ok(s > 50, `got ${s}`);
        });

        it("penalises high retry count", () => {
            const lowRetry  = [{ success: true, retries: 0 }, { success: true, retries: 0 }];
            const highRetry = [{ success: true, retries: 5 }, { success: true, retries: 5 }];
            assert.ok(rs.scoreRepair("t", lowRetry) > rs.scoreRepair("t", highRetry));
        });

        it("gives sample size bonus for ≥10 repairs", () => {
            const few  = Array(2).fill({ success: true, retries: 0 });
            const many = Array(10).fill({ success: true, retries: 0 });
            assert.ok(rs.scoreRepair("t", many) >= rs.scoreRepair("t", few));
        });

        it("works with repaired flag as well as success flag", () => {
            const repairs = [{ repaired: true, retries: 1 }, { repaired: false, retries: 2 }];
            const s = rs.scoreRepair("t", repairs);
            assert.ok(s >= 0 && s <= 100);
        });
    });

    describe("scorePredictability", () => {
        it("returns 50 for fewer than 2 history entries", () => {
            const hist = [{ metrics: { successRate: 0.8, flipRate: 0 } }];
            assert.equal(rs.scorePredictability("x", hist), 50);
        });

        it("stable consistent history → high predictability", () => {
            const hist = Array(5).fill({ metrics: { successRate: 0.90, flipRate: 0 } });
            const s = rs.scorePredictability("x", hist);
            assert.ok(s > 70, `got ${s}`);
        });

        it("alternating success rates → low predictability", () => {
            const hist = [
                { metrics: { successRate: 0.10, flipRate: 0.50 } },
                { metrics: { successRate: 0.90, flipRate: 0.50 } },
                { metrics: { successRate: 0.10, flipRate: 0.50 } },
                { metrics: { successRate: 0.90, flipRate: 0.50 } },
            ];
            const s = rs.scorePredictability("x", hist);
            assert.ok(s < 50, `got ${s}`);
        });

        it("reads from benchmarkHistory when no explicit history", () => {
            bh.snapshot("pred-wf", { successRate: 0.88, flipRate: 0.02 });
            bh.snapshot("pred-wf", { successRate: 0.89, flipRate: 0.02 });
            const s = rs.scorePredictability("pred-wf");
            assert.ok(s >= 0 && s <= 100);
        });
    });

    describe("scoreRollback", () => {
        it("returns 75 for empty deploy history", () => {
            assert.equal(rs.scoreRollback([]), 75);
        });

        it("returns 100 when no rollbacks were needed", () => {
            const hist = [{ status: "success" }, { status: "success" }];
            assert.equal(rs.scoreRollback(hist), 100);
        });

        it("high verified rollbacks → good score", () => {
            const hist = [
                { rolledBack: true, rollbackVerified: true },
                { rolledBack: true, rollbackVerified: true },
                { rolledBack: true, rollbackVerified: true },
            ];
            const s = rs.scoreRollback(hist);
            assert.ok(s > 50, `got ${s}`);
        });

        it("unverified rollbacks reduce score", () => {
            const allVerified = [
                { rolledBack: true, rollbackVerified: true },
                { rolledBack: true, rollbackVerified: true },
            ];
            const noneVerified = [
                { rolledBack: true, rollbackVerified: false },
                { rolledBack: true, rollbackVerified: false },
            ];
            assert.ok(rs.scoreRollback(allVerified) > rs.scoreRollback(noneVerified));
        });

        it("accepts rollbackSuccess field", () => {
            const hist = [{ rolledBack: true, rollbackSuccess: true }];
            const s = rs.scoreRollback(hist);
            assert.ok(s >= 0 && s <= 100);
        });
    });

    describe("fullScore", () => {
        it("returns all four dimensions + composite + grade", () => {
            const result = rs.fullScore({});
            assert.ok("workflow"       in result);
            assert.ok("repair"         in result);
            assert.ok("predictability" in result);
            assert.ok("rollback"       in result);
            assert.ok("composite"      in result);
            assert.ok("grade"          in result);
        });

        it("composite is within 0–100", () => {
            const result = rs.fullScore({ name: "x", repairs: [], deployHistory: [] });
            assert.ok(result.composite >= 0 && result.composite <= 100);
        });

        it("grade is a valid letter A–F", () => {
            const result = rs.fullScore({});
            assert.ok(["A", "B", "C", "D", "F"].includes(result.grade));
        });

        it("high-quality context produces grade A or B", () => {
            const repairs = Array(10).fill({ success: true, retries: 0 });
            const history = Array(5).fill({ metrics: { successRate: 0.95, flipRate: 0 } });
            const result  = rs.fullScore({
                name: "great-wf",
                history,
                repairs,
                deployHistory: [],
            });
            assert.ok(["A", "B"].includes(result.grade), `grade=${result.grade}`);
        });
    });
});

// ── repairAnalytics ──────────────────────────────────────────────────────────

describe("repairAnalytics", () => {
    afterEach(() => ra.reset());

    describe("record + getStats", () => {
        it("getStats returns null for unknown workflow", () => {
            assert.equal(ra.getStats("unknown"), null);
        });

        it("records events and returns basic stats", () => {
            ra.record("wf-1", 1, true,  200, false);
            ra.record("wf-1", 2, false, 400, true);
            const s = ra.getStats("wf-1");
            assert.equal(s.events, 2);
            assert.ok(s.successRate >= 0 && s.successRate <= 1);
            assert.ok(s.avgAttempts > 0);
            assert.ok(s.avgLatencyMs > 0);
            assert.ok(s.rollbackRate >= 0 && s.rollbackRate <= 1);
            assert.ok(s.efficiencyScore >= 0 && s.efficiencyScore <= 100);
        });

        it("all-success repairs → successRate 1.0", () => {
            ra.record("wf-2", 1, true, 100);
            ra.record("wf-2", 1, true, 100);
            ra.record("wf-2", 1, true, 100);
            assert.equal(ra.getStats("wf-2").successRate, 1.0);
        });

        it("rollbackRate reflects rolledBack flag", () => {
            ra.record("wf-3", 1, true,  100, true);
            ra.record("wf-3", 1, false, 100, false);
            const s = ra.getStats("wf-3");
            assert.equal(s.rollbackRate, 0.5);
        });
    });

    describe("rollbackFrequency", () => {
        it("returns zero rates when no events", () => {
            const r = ra.rollbackFrequency();
            assert.equal(r.totalRepairs, 0);
            assert.equal(r.rollbackRate, 0);
        });

        it("counts rollbacks across all workflows", () => {
            ra.record("a", 1, true,  100, true);
            ra.record("a", 1, true,  100, false);
            ra.record("b", 1, false, 100, true);
            const r = ra.rollbackFrequency();
            assert.equal(r.totalRepairs, 3);
            assert.equal(r.rollbacks, 2);
            assert.ok(r.rollbackRate > 0);
        });
    });

    describe("recoveryEfficiencyScore", () => {
        it("returns 50 for workflow with no events", () => {
            assert.equal(ra.recoveryEfficiencyScore("none"), 50);
        });

        it("perfect repairs → high score", () => {
            ra.record("eff", 1, true, 100, false);
            ra.record("eff", 1, true, 100, false);
            ra.record("eff", 1, true, 100, false);
            const s = ra.recoveryEfficiencyScore("eff");
            assert.ok(s >= 70, `got ${s}`);
        });

        it("many retry attempts reduce score", () => {
            ra.record("high-retry", 5, true, 200, false);
            ra.record("high-retry", 5, true, 200, false);
            const withHighRetry = ra.recoveryEfficiencyScore("high-retry");

            ra.reset();
            ra.record("low-retry", 1, true, 200, false);
            ra.record("low-retry", 1, true, 200, false);
            const withLowRetry = ra.recoveryEfficiencyScore("low-retry");

            assert.ok(withLowRetry > withHighRetry);
        });
    });

    describe("repairVsRetry", () => {
        it("returns zero totals when nothing recorded", () => {
            const r = ra.repairVsRetry();
            assert.equal(r.totalRepairs, 0);
            assert.equal(r.avgAttempts, 0);
            assert.equal(r.retryRate, 0);
        });

        it("distinguishes first-attempt success from retry success", () => {
            ra.record("rv", 1, true,  100); // first attempt success
            ra.record("rv", 3, true,  100); // retry success
            ra.record("rv", 2, false, 100); // retry failure
            const r = ra.repairVsRetry();
            assert.equal(r.totalRepairs, 3);
            assert.equal(r.successOnFirst, 1);
            assert.equal(r.successOnRetry, 1);
            assert.ok(r.retryRate > 0);
        });
    });

    describe("fullReport", () => {
        it("includes all expected keys", () => {
            ra.record("wf-r", 1, true, 100);
            const report = ra.fullReport();
            assert.ok("generatedAt"        in report);
            assert.ok("workflowCount"      in report);
            assert.ok("workflowStats"      in report);
            assert.ok("rollbackFrequency"  in report);
            assert.ok("repairVsRetry"      in report);
        });

        it("workflowCount matches recorded workflows", () => {
            ra.record("x", 1, true, 100);
            ra.record("y", 1, true, 100);
            assert.equal(ra.fullReport().workflowCount, 2);
        });
    });
});

// ── optimizationAdvisor ──────────────────────────────────────────────────────

describe("optimizationAdvisor", () => {
    const UNSTABLE  = oa.UNSTABLE_FLIP;
    const EXPENSIVE = oa.EXPENSIVE_MS;

    describe("analyze", () => {
        it("returns all category arrays + summary", () => {
            const result = oa.analyze([]);
            assert.ok(Array.isArray(result.unstable));
            assert.ok(Array.isArray(result.expensive));
            assert.ok(Array.isArray(result.highRetry));
            assert.ok(Array.isArray(result.deterministic));
            assert.ok("summary" in result);
        });

        it("classifies unstable workflow", () => {
            const results = [{ name: "bad", flipRate: UNSTABLE + 0.01, successRate: 0.70, avgMs: 100 }];
            const r = oa.analyze(results);
            assert.equal(r.unstable.length, 1);
            assert.equal(r.unstable[0].name, "bad");
        });

        it("classifies expensive workflow", () => {
            const results = [{ name: "slow", flipRate: 0, successRate: 0.95, avgMs: EXPENSIVE + 100 }];
            const r = oa.analyze(results);
            assert.equal(r.expensive.length, 1);
        });

        it("classifies deterministic workflow (sr≥0.90, flip≤0.05)", () => {
            const results = [{ name: "great", flipRate: 0.02, successRate: 0.95, avgMs: 100 }];
            const r = oa.analyze(results);
            assert.equal(r.deterministic.length, 1);
        });

        it("healthRate = deterministic / total", () => {
            const results = [
                { name: "good", flipRate: 0.01, successRate: 0.95, avgMs: 100 },
                { name: "bad",  flipRate: 0.50, successRate: 0.50, avgMs: 100 },
            ];
            const r = oa.analyze(results);
            assert.equal(r.summary.total, 2);
            assert.equal(r.summary.healthRate, 0.5);
        });

        it("summary counts are consistent with category arrays", () => {
            const results = [
                { name: "a", flipRate: 0.40, successRate: 0.70, avgMs: 100 },
                { name: "b", flipRate: 0.01, successRate: 0.95, avgMs: 2000 },
            ];
            const r = oa.analyze(results);
            assert.equal(r.summary.unstableCount,  r.unstable.length);
            assert.equal(r.summary.expensiveCount, r.expensive.length);
        });
    });

    describe("getRecommendations", () => {
        it("returns array sorted by priority desc", () => {
            const recs = oa.getRecommendations("wf", {
                flipRate: 0.40, successRate: 0.30, avgMs: 2000,
            });
            assert.ok(Array.isArray(recs));
            for (let i = 1; i < recs.length; i++) {
                assert.ok(recs[i - 1].priority >= recs[i].priority);
            }
        });

        it("unstable workflow gets apply_strict_execution_limits recommendation", () => {
            const recs = oa.getRecommendations("wf", { flipRate: UNSTABLE + 0.01, successRate: 0.70 });
            assert.ok(recs.some(r => r.action === "apply_strict_execution_limits"));
        });

        it("low success rate gets investigate_root_cause recommendation", () => {
            const recs = oa.getRecommendations("wf", { successRate: 0.20, flipRate: 0 });
            assert.ok(recs.some(r => r.action === "investigate_root_cause"));
        });

        it("expensive workflow gets profile_and_optimise recommendation", () => {
            const recs = oa.getRecommendations("wf", { avgMs: EXPENSIVE + 500, successRate: 0.90, flipRate: 0 });
            assert.ok(recs.some(r => r.action === "profile_and_optimise"));
        });

        it("deterministic workflow gets relax_retry_budget recommendation", () => {
            const recs = oa.getRecommendations("wf", { successRate: 0.95, flipRate: 0.02 });
            assert.ok(recs.some(r => r.action === "relax_retry_budget"));
        });

        it("workflow with no repair strategy gets add_repair_strategy", () => {
            const recs = oa.getRecommendations("wf", { repairRate: 0, successRate: 0.70, flipRate: 0 });
            assert.ok(recs.some(r => r.action === "add_repair_strategy"));
        });
    });

    describe("rankByPriority", () => {
        it("returns array sorted by priority desc", () => {
            const results = [
                { name: "stable",   flipRate: 0.01, successRate: 0.95, avgMs: 100 },
                { name: "unstable", flipRate: 0.45, successRate: 0.40, avgMs: 100 },
            ];
            const ranked = oa.rankByPriority(results);
            assert.ok(ranked[0].priority >= ranked[ranked.length - 1].priority);
        });

        it("includes name, priority, topAction, category fields", () => {
            const results = [{ name: "wf", flipRate: 0.40, successRate: 0.60, avgMs: 100 }];
            const ranked  = oa.rankByPriority(results);
            assert.ok("name"      in ranked[0]);
            assert.ok("priority"  in ranked[0]);
            assert.ok("topAction" in ranked[0]);
            assert.ok("category"  in ranked[0]);
        });
    });

    describe("identifyQuickWins", () => {
        it("returns array (empty for clean workflows)", () => {
            const results = [{ name: "clean", flipRate: 0, successRate: 1.0, avgMs: 50 }];
            const wins = oa.identifyQuickWins(results);
            assert.ok(Array.isArray(wins));
        });

        it("detects stabilise_execution_order win (high flip + decent sr)", () => {
            const results = [{ name: "w", flipRate: 0.40, successRate: 0.70, avgMs: 100 }];
            const wins = oa.identifyQuickWins(results);
            assert.ok(wins.some(w => w.action === "stabilise_execution_order"));
        });

        it("detects profile_execution_path win (slow + successful)", () => {
            const results = [{ name: "s", flipRate: 0, successRate: 0.95, avgMs: 1500 }];
            const wins = oa.identifyQuickWins(results);
            assert.ok(wins.some(w => w.action === "profile_execution_path"));
        });

        it("detects add_repair_fallback win (low repairRate + high sr)", () => {
            const results = [{ name: "r", flipRate: 0, successRate: 0.85, avgMs: 100, repairRate: 0.10 }];
            const wins = oa.identifyQuickWins(results);
            assert.ok(wins.some(w => w.action === "add_repair_fallback"));
        });

        it("quick win includes name and expectedGain", () => {
            const results = [{ name: "qw", flipRate: 0.40, successRate: 0.70, avgMs: 100 }];
            const wins = oa.identifyQuickWins(results);
            assert.ok(wins.length > 0);
            assert.ok("name"         in wins[0]);
            assert.ok("expectedGain" in wins[0]);
        });
    });
});

// ── healthScorer ─────────────────────────────────────────────────────────────

describe("healthScorer", () => {
    afterEach(() => { bh.reset(); ca.reset(); });

    describe("score", () => {
        it("returns all expected dimension keys", () => {
            const s = hs.score({});
            assert.ok("determinism"  in s);
            assert.ok("stability"    in s);
            assert.ok("recovery"     in s);
            assert.ok("cost"         in s);
            assert.ok("consistency"  in s);
            assert.ok("composite"    in s);
            assert.ok("grade"        in s);
        });

        it("all scores are 0–100", () => {
            const s = hs.score({ avgFlipRate: 0.5, avgSuccessRate: 0.5, avgRepairRate: 0.5 });
            for (const key of ["determinism", "stability", "recovery", "cost", "consistency", "composite"]) {
                assert.ok(s[key] >= 0 && s[key] <= 100, `${key}=${s[key]}`);
            }
        });

        it("perfect context → high composite and grade A", () => {
            const s = hs.score({
                avgFlipRate:          0,
                avgSuccessRate:       1.0,
                avgRepairRate:        1.0,
                avgCostPerExecution:  0,
                consistentRate:       1.0,
            });
            assert.ok(s.composite >= 90, `got ${s.composite}`);
            assert.equal(s.grade, "A");
        });

        it("worst-case context → grade F", () => {
            const s = hs.score({
                avgFlipRate:          1.0,
                avgSuccessRate:       0,
                avgRepairRate:        0,
                avgCostPerExecution:  1.0,
                consistentRate:       0,
            });
            assert.ok(s.composite < 45, `got ${s.composite}`);
        });

        it("zero flip rate → determinism = 100", () => {
            const s = hs.score({ avgFlipRate: 0 });
            assert.equal(s.determinism, 100);
        });

        it("zero cost → cost score = 100", () => {
            const s = hs.score({ avgCostPerExecution: 0 });
            assert.equal(s.cost, 100);
        });
    });

    describe("scoreFromBenchmarks", () => {
        it("returns valid score for empty array", () => {
            const s = hs.scoreFromBenchmarks([]);
            assert.ok("composite" in s);
            assert.ok(s.composite >= 0 && s.composite <= 100);
        });

        it("returns valid score from benchmark result array", () => {
            const results = [
                { flipRate: 0.05, successRate: 0.90, repairRate: 0.80, avgMs: 200 },
                { flipRate: 0.10, successRate: 0.85, repairRate: 0.75, avgMs: 300 },
            ];
            const s = hs.scoreFromBenchmarks(results);
            assert.ok(s.composite >= 0 && s.composite <= 100);
            assert.ok(["A", "B", "C", "D", "F"].includes(s.grade));
        });

        it("consistentRate uses flipRate ≤ 0.15 threshold", () => {
            // All consistent (flip ≤ 0.15)
            const all = [
                { flipRate: 0.05, successRate: 0.90, repairRate: 0.80, avgMs: 100 },
                { flipRate: 0.10, successRate: 0.90, repairRate: 0.80, avgMs: 100 },
            ];
            // Half inconsistent
            const half = [
                { flipRate: 0.05, successRate: 0.90, repairRate: 0.80, avgMs: 100 },
                { flipRate: 0.50, successRate: 0.90, repairRate: 0.80, avgMs: 100 },
            ];
            const sAll  = hs.scoreFromBenchmarks(all);
            const sHalf = hs.scoreFromBenchmarks(half);
            assert.ok(sAll.consistency >= sHalf.consistency);
        });
    });

    describe("grade", () => {
        it("A for ≥ 90", () => assert.equal(hs.grade(95), "A"));
        it("B for 75–89", () => assert.equal(hs.grade(80), "B"));
        it("C for 60–74", () => assert.equal(hs.grade(65), "C"));
        it("D for 45–59", () => assert.equal(hs.grade(50), "D"));
        it("F for < 45",  () => assert.equal(hs.grade(30), "F"));
    });
});

// ── adaptiveTuner ─────────────────────────────────────────────────────────────

describe("adaptiveTuner", () => {
    afterEach(() => at.reset());

    describe("tune — policies", () => {
        it("standard policy for average metrics", () => {
            const r = at.tune("wf-avg", { successRate: 0.70, flipRate: 0.10, avgMs: 500 });
            assert.equal(r.policy, "standard");
        });

        it("strict policy when flipRate exceeds instability threshold", () => {
            const r = at.tune("wf-flip", { successRate: 0.70, flipRate: at.UNSTABLE_FLIP + 0.01, avgMs: 100 });
            assert.equal(r.policy, "strict");
        });

        it("strict policy when successRate below 0.40", () => {
            const r = at.tune("wf-low-sr", { successRate: 0.30, flipRate: 0.10, avgMs: 100 });
            assert.equal(r.policy, "strict");
        });

        it("relaxed policy when sr ≥ 0.85 and flip ≤ 0.10", () => {
            const r = at.tune("wf-good", { successRate: at.STABLE_SR, flipRate: 0.05, avgMs: 100 });
            assert.equal(r.policy, "relaxed");
        });

        it("strict limits have maxRetries=2", () => {
            const r = at.tune("wf-bad", { successRate: 0.20, flipRate: 0.50, avgMs: 100 });
            assert.equal(r.limits.maxRetries, at.STRICT_LIMITS.maxRetries);
        });

        it("relaxed limits have maxRetries=8", () => {
            const r = at.tune("wf-great", { successRate: 0.90, flipRate: 0.05, avgMs: 100 });
            assert.equal(r.limits.maxRetries, at.STABLE_LIMITS.maxRetries);
        });

        it("result includes changes array", () => {
            const r = at.tune("wf-c", { successRate: 0.30, flipRate: 0.50 });
            assert.ok(Array.isArray(r.changes));
            assert.ok(r.changes.length > 0);
        });
    });

    describe("tune — priorities", () => {
        it("normal priority for standard-performance workflow", () => {
            const r = at.tune("wf-normal", { successRate: 0.70, flipRate: 0.10, avgMs: 200 });
            assert.equal(r.priority, "normal");
        });

        it("optimization priority when avgMs exceeds threshold", () => {
            const r = at.tune("wf-slow", { successRate: 0.70, flipRate: 0.10, avgMs: at.EXPENSIVE_MS + 100 });
            assert.equal(r.priority, "optimization");
        });

        it("high priority for deterministic high-success workflows", () => {
            const r = at.tune("wf-det", { successRate: 0.97, flipRate: 0.02, avgMs: 200 });
            assert.equal(r.priority, "high");
        });

        it("optimization takes precedence over high priority", () => {
            // Expensive AND deterministic → optimization wins
            const r = at.tune("wf-both", { successRate: 0.97, flipRate: 0.02, avgMs: at.EXPENSIVE_MS + 100 });
            assert.equal(r.priority, "optimization");
        });
    });

    describe("getLimits", () => {
        it("returns DEFAULT_LIMITS for unknown workflow", () => {
            const limits = at.getLimits("unknown");
            assert.deepEqual(limits, at.DEFAULT_LIMITS);
        });

        it("returns tuned limits after tune() is called", () => {
            at.tune("wf-lim", { successRate: 0.20, flipRate: 0.50, avgMs: 100 });
            const limits = at.getLimits("wf-lim");
            assert.deepEqual(limits, at.STRICT_LIMITS);
        });
    });

    describe("applyAll", () => {
        it("returns array with one entry per result", () => {
            const results = [
                { name: "a", successRate: 0.90, flipRate: 0.02, avgMs: 100 },
                { name: "b", successRate: 0.30, flipRate: 0.50, avgMs: 100 },
            ];
            const out = at.applyAll(results);
            assert.equal(out.length, 2);
        });

        it("each entry has name, policy, priority, composite, changes", () => {
            const out = at.applyAll([{ name: "x", successRate: 0.80, flipRate: 0.05, avgMs: 100 }]);
            const entry = out[0];
            assert.ok("name"      in entry);
            assert.ok("policy"    in entry);
            assert.ok("priority"  in entry);
            assert.ok("composite" in entry);
            assert.ok("changes"   in entry);
        });

        it("composite defaults to 0 when no score field present", () => {
            const out = at.applyAll([{ name: "no-score", successRate: 0.80, flipRate: 0.05 }]);
            assert.equal(out[0].composite, 0);
        });

        it("uses score.composite when present", () => {
            const out = at.applyAll([{ name: "scored", successRate: 0.80, score: { composite: 72 } }]);
            assert.equal(out[0].composite, 72);
        });

        it("handles empty array", () => {
            assert.deepEqual(at.applyAll([]), []);
        });
    });

    describe("getAll", () => {
        it("returns empty array before any tuning", () => {
            assert.deepEqual(at.getAll(), []);
        });

        it("returns all tuned records after tune() calls", () => {
            at.tune("x", { successRate: 0.80 });
            at.tune("y", { successRate: 0.30 });
            const all = at.getAll();
            assert.equal(all.length, 2);
        });

        it("each record has name, limits, policy, priority, ts", () => {
            at.tune("z", { successRate: 0.70 });
            const [rec] = at.getAll();
            assert.ok("name"     in rec);
            assert.ok("limits"   in rec);
            assert.ok("policy"   in rec);
            assert.ok("priority" in rec);
            assert.ok("ts"       in rec);
        });
    });
});
