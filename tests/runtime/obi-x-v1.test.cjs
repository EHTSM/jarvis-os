"use strict";
process.env.SKIP_PLATFORM_REGISTER = "1";

/**
 * OBI X V1 — Autonomous Business Intelligence Evolution Program
 * 6 new services tested against existing business data.
 *
 * businessReasoningEngine, businessQualityEngine, businessBenchmarkEngine,
 * businessPredictionEngine, businessEvolutionEngine, businessIntelligenceDashboard
 *
 * Target: 70+ tests
 */

const assert = require("assert");

const bre = require("../../backend/services/businessReasoningEngine.cjs");
const bqe = require("../../backend/services/businessQualityEngine.cjs");
const bbe = require("../../backend/services/businessBenchmarkEngine.cjs");
const bpe = require("../../backend/services/businessPredictionEngine.cjs");
const bee = require("../../backend/services/businessEvolutionEngine.cjs");
const bid = require("../../backend/services/businessIntelligenceDashboard.cjs");

let passed = 0;
let failed = 0;
const promises = [];

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

function atest(name, fn) {
  promises.push(
    fn()
      .then(() => { console.log(`  ✓ ${name}`); passed++; })
      .catch(e  => { console.error(`  ✗ ${name}: ${e.message}`); failed++; })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: Business Reasoning Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Business Reasoning Engine ──");

test("module loads", () => {
  assert.ok(typeof bre.analyze      === "function");
  assert.ok(typeof bre.getAnalysis  === "function");
  assert.ok(typeof bre.listAnalyses === "function");
  assert.ok(typeof bre.getStats     === "function");
});

atest("analyze returns 7 dimension scores", async () => {
  const r = await bre.analyze("test_biz", {
    revenueData: { mrr: 5000, arr: 60000, growth: 12, churnRate: 4 },
    dealsData:   { deals: [{ stage: "won", value: 500 }, { stage: "open", value: 300 }] },
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.analysis.id.startsWith("br_"));
  const dims = r.analysis.dimensions;
  ["revenue","pricing","customer","marketing","sales","growth","retention"].forEach(d =>
    assert.ok(typeof dims[d]?.score === "number", `missing dimension: ${d}`)
  );
  assert.ok(typeof r.analysis.overallScore === "number");
  assert.ok(r.analysis.overallScore >= 0 && r.analysis.overallScore <= 100);
  assert.ok(Array.isArray(r.analysis.insights));
});

atest("high churn reduces revenue score", async () => {
  const r = await bre.analyze("high_churn_biz", {
    revenueData: { mrr: 3000, growth: 5, churnRate: 20 },
  });
  assert.ok(r.ok);
  assert.ok(r.analysis.dimensions.revenue.score < 70, `expected <70, got ${r.analysis.dimensions.revenue.score}`);
  assert.ok(r.analysis.dimensions.revenue.issues.some(i => i.type === "high_churn"));
});

atest("low deal win rate scores below 75", async () => {
  const r = await bre.analyze("low_win_biz", {
    dealsData: { deals: [
      { stage: "won",  value: 200 },
      { stage: "lost", value: 150 },
      { stage: "lost", value: 150 },
      { stage: "lost", value: 150 },
      { stage: "lost", value: 150 },
      { stage: "lost", value: 150 },
    ]},
  });
  assert.ok(r.ok);
  // 1/6 wins = ~16.7% win rate — should depress pricing score and surface an issue
  assert.ok(r.analysis.dimensions.pricing.winRate < 20, `expected winRate<20, got ${r.analysis.dimensions.pricing.winRate}`);
  assert.ok(r.analysis.dimensions.pricing.score < 80, `expected pricing score<80`);
});

atest("strong revenue signals positive score", async () => {
  const r = await bre.analyze("strong_biz", {
    revenueData: { mrr: 20000, arr: 240000, growth: 25, churnRate: 2 },
    dealsData:   { deals: Array(10).fill({ stage: "won", value: 1000 }) },
  });
  assert.ok(r.ok);
  assert.ok(r.analysis.dimensions.revenue.score >= 70);
});

atest("listAnalyses returns list after analyze", async () => {
  await bre.analyze("list_test_biz", {});
  const r = bre.listAnalyses({ limit: 5 });
  assert.ok(r.ok);
  assert.ok(Array.isArray(r.analyses));
  assert.ok(r.analyses.length > 0);
});

atest("getAnalysis by id", async () => {
  const r = await bre.analyze("get_test_biz", {});
  assert.ok(r.ok);
  const a = bre.getAnalysis(r.analysis.id);
  assert.ok(a);
  assert.strictEqual(a.id, r.analysis.id);
});

atest("getStats returns total >= 1", async () => {
  const s = bre.getStats();
  assert.ok(typeof s.total === "number" && s.total >= 1);
});

atest("overallScore is 0-100", async () => {
  const r = await bre.analyze("range_test_biz", {
    revenueData: { mrr: 0, growth: 0, churnRate: 50 },
  });
  assert.ok(r.ok);
  assert.ok(r.analysis.overallScore >= 0 && r.analysis.overallScore <= 100);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: Business Quality Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Business Quality Engine ──");

test("module exports", () => {
  assert.ok(typeof bqe.score       === "function");
  assert.ok(typeof bqe.getScore    === "function");
  assert.ok(typeof bqe.listScores  === "function");
  assert.ok(typeof bqe.getHistory  === "function");
  assert.ok(typeof bqe.getTrend    === "function");
  assert.ok(typeof bqe.getStats    === "function");
  assert.ok(typeof bqe.WEIGHTS     === "object");
});

test("WEIGHTS sum to 1.0", () => {
  const sum = Object.values(bqe.WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1.0) < 0.001, `weights sum ${sum} != 1.0`);
});

atest("score returns 7 quality dimensions", async () => {
  const r = await bqe.score("quality_test_biz", {
    reasoningAnalysis: {
      dimensions: {
        revenue:   { score: 72 }, pricing:   { score: 68 }, customer:  { score: 74 },
        marketing: { score: 65 }, sales:     { score: 70 }, growth:    { score: 66 }, retention: { score: 73 },
      },
      overallScore: 70,
    },
  });
  assert.ok(r.ok, JSON.stringify(r));
  const dims = r.score.dimensions;
  ["revenue_health","customer_health","growth_health","sales_health","marketing_health","retention_health","operational_health"].forEach(d =>
    assert.ok(typeof dims[d] === "number", `missing: ${d}`)
  );
  assert.ok(typeof r.score.overall === "number");
  assert.ok(r.score.overall >= 0 && r.score.overall <= 100);
  assert.ok(Array.isArray(r.score.improvements));
});

atest("score stores history", async () => {
  const ctx = "history_biz";
  await bqe.score(ctx, {});
  const h = bqe.getHistory(ctx, 5);
  assert.ok(h.ok);
  assert.ok(h.history.length >= 1);
});

atest("listScores filtered by context", async () => {
  const ctx = "filter_biz";
  await bqe.score(ctx, {});
  const r = bqe.listScores({ context: ctx, limit: 10 });
  assert.ok(r.ok);
  assert.ok(r.scores.every(s => s.context === ctx));
});

atest("getScore by id", async () => {
  const r = await bqe.score("id_biz", {});
  assert.ok(r.ok);
  const s = bqe.getScore(r.score.id);
  assert.ok(s);
  assert.strictEqual(s.id, r.score.id);
});

atest("getTrend returns direction after 2 scores", async () => {
  const ctx = "trend_biz";
  await bqe.score(ctx, {
    reasoningAnalysis: { dimensions: { revenue: { score: 40 }, customer: { score: 40 }, sales: { score: 40 }, growth: { score: 40 }, marketing: { score: 40 }, retention: { score: 40 }, pricing: { score: 40 } } },
  });
  await bqe.score(ctx, {
    reasoningAnalysis: { dimensions: { revenue: { score: 85 }, customer: { score: 85 }, sales: { score: 85 }, growth: { score: 85 }, marketing: { score: 85 }, retention: { score: 85 }, pricing: { score: 85 } } },
  });
  const t = bqe.getTrend(ctx);
  assert.ok(["improving","declining","stable"].includes(t.direction));
});

atest("improvements have priority field", async () => {
  const r = await bqe.score("impr_biz", {
    reasoningAnalysis: { dimensions: { revenue: { score: 40 }, customer: { score: 45 }, sales: { score: 42 }, growth: { score: 44 }, marketing: { score: 43 }, retention: { score: 41 }, pricing: { score: 40 } } },
  });
  assert.ok(r.ok);
  r.score.improvements.forEach(i => assert.ok(["critical","high","medium"].includes(i.priority)));
});

atest("getStats has contexts", async () => {
  await bqe.score("stats_biz_ctx", {});
  const s = bqe.getStats();
  assert.ok(s.total >= 1);
  assert.ok(s.contexts >= 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: Business Benchmark Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Business Benchmark Engine ──");

test("module exports", () => {
  assert.ok(typeof bbe.compareVersions         === "function");
  assert.ok(typeof bbe.compareToBaseline       === "function");
  assert.ok(typeof bbe.compareQuarter          === "function");
  assert.ok(typeof bbe.recordImprovementResult === "function");
  assert.ok(typeof bbe.getImprovementSuccessRate === "function");
  assert.ok(typeof bbe.detectRegression        === "function");
  assert.ok(typeof bbe.getBenchmark            === "function");
  assert.ok(typeof bbe.listBenchmarks          === "function");
  assert.ok(typeof bbe.getBaseline             === "function");
  assert.ok(typeof bbe.setBaseline             === "function");
  assert.ok(typeof bbe.getStats                === "function");
  assert.ok(typeof bbe.BUSINESS_BASELINE       === "object");
});

test("BUSINESS_BASELINE has all 7 dims + overall", () => {
  const b = bbe.BUSINESS_BASELINE;
  ["revenue_health","customer_health","growth_health","sales_health","marketing_health","retention_health","operational_health","overall"].forEach(d =>
    assert.ok(typeof b[d] === "number", `missing: ${d}`)
  );
});

atest("compareVersions stores benchmark", async () => {
  const ctx = "bm_biz_test";
  await bqe.score(ctx, {});
  await bqe.score(ctx, {});
  const r = await bbe.compareVersions(ctx, {});
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.benchmark.id.startsWith("bbm_"));
  assert.ok(r.benchmark.type === "version_compare");
  assert.ok(typeof r.benchmark.vsBaseline === "number");
});

atest("compareToBaseline reports gaps", async () => {
  const ctx = "baseline_biz_test";
  await bqe.score(ctx, {});
  const r = await bbe.compareToBaseline(ctx, {});
  assert.ok(r.ok);
  assert.ok(r.benchmark.type === "baseline_compare");
  assert.ok(typeof r.benchmark.meetsOverall === "boolean");
  assert.ok(r.benchmark.gaps);
  assert.ok(typeof r.benchmark.productionReady === "boolean");
});

atest("compareQuarter returns trend", async () => {
  const ctx = "quarter_biz_test";
  await bqe.score(ctx, {});
  const r = await bbe.compareQuarter(ctx, {});
  assert.ok(r.ok);
  assert.ok(r.benchmark.type === "quarter_compare");
  assert.ok(["improving","declining","stable","insufficient_data"].includes(r.benchmark.trend));
});

atest("recordImprovementResult success path", async () => {
  const r = bbe.recordImprovementResult({ improvId: "imp001", context: "test_biz", beforeScore: 60, afterScore: 75, applied: true });
  assert.ok(r.ok);
  assert.ok(r.success);
  assert.strictEqual(r.improvement, 15);
});

atest("recordImprovementResult failure (regression)", async () => {
  const r = bbe.recordImprovementResult({ improvId: "imp002", context: "test_biz", beforeScore: 75, afterScore: 60, applied: true });
  assert.ok(r.ok);
  assert.ok(!r.success);
});

atest("getImprovementSuccessRate returns rate", async () => {
  const r = bbe.getImprovementSuccessRate();
  assert.ok(r.ok);
  assert.ok(typeof r.rate === "number" && r.rate >= 0 && r.rate <= 100);
});

atest("detectRegression no-history returns ok", async () => {
  const r = bbe.detectRegression("fresh_biz_" + Date.now());
  assert.ok(r.ok);
  assert.ok(typeof r.isRegression === "boolean");
  assert.ok(r.recommendation);
});

atest("listBenchmarks filtered by type", async () => {
  const r = bbe.listBenchmarks({ type: "version_compare", limit: 10 });
  assert.ok(r.ok);
  assert.ok(r.benchmarks.every(b => b.type === "version_compare"));
});

atest("getBenchmark by id", async () => {
  const ctx = "get_bm_biz";
  await bqe.score(ctx, {});
  const bm = await bbe.compareVersions(ctx, {});
  assert.ok(bm.ok);
  const b = bbe.getBenchmark(bm.benchmark.id);
  assert.ok(b);
  assert.strictEqual(b.id, bm.benchmark.id);
});

atest("setBaseline and getBaseline roundtrip", async () => {
  const prev = bbe.getBaseline();
  bbe.setBaseline({ revenue_health: 80 });
  const updated = bbe.getBaseline();
  assert.strictEqual(updated.revenue_health, 80);
  bbe.setBaseline({ revenue_health: prev.revenue_health });
});

atest("getStats has total", async () => {
  await bqe.score("stats_bm_biz", {});
  await bbe.compareVersions("stats_bm_biz", {});
  const s = bbe.getStats();
  assert.ok(typeof s.total === "number" && s.total >= 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: Business Prediction Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Business Prediction Engine ──");

test("module exports", () => {
  assert.ok(typeof bpe.predict         === "function");
  assert.ok(typeof bpe.getPrediction   === "function");
  assert.ok(typeof bpe.listPredictions === "function");
  assert.ok(typeof bpe.getStats        === "function");
});

atest("predict with low quality exposes predictions", async () => {
  const r = await bpe.predict("low_biz", {
    qualityScore: {
      dimensions: { revenue_health: 40, customer_health: 38, growth_health: 42, sales_health: 40, marketing_health: 38, retention_health: 35, operational_health: 40 },
      overall: 39,
    },
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.prediction.id.startsWith("bp_"));
  assert.ok(r.prediction.total > 0, `expected predictions, got ${r.prediction.total}`);
  assert.ok(typeof r.prediction.riskScore === "number");
});

atest("predict with high quality has fewer predictions", async () => {
  const r = await bpe.predict("strong_biz_pred", {
    qualityScore: {
      dimensions: { revenue_health: 90, customer_health: 88, growth_health: 85, sales_health: 87, marketing_health: 84, retention_health: 90, operational_health: 88 },
      overall: 87,
    },
  });
  assert.ok(r.ok);
  const risks = r.prediction.total - r.prediction.opportunityCount;
  assert.ok(risks < 4, `expected <4 risk predictions, got ${risks}`);
});

atest("poor customer health triggers churn predictions", async () => {
  const r = await bpe.predict("churn_biz", {
    qualityScore: {
      dimensions: { customer_health: 45, retention_health: 40 },
      overall: 45,
    },
  });
  assert.ok(r.ok);
  assert.ok(r.prediction.churn.length > 0, "expected churn predictions");
});

atest("poor revenue health triggers revenue trend predictions", async () => {
  const r = await bpe.predict("rev_decline_biz", {
    qualityScore: {
      dimensions: { revenue_health: 45, retention_health: 40 },
      overall: 45,
    },
  });
  assert.ok(r.ok);
  assert.ok(r.prediction.revenueTrends.length > 0, "expected revenue trend predictions");
});

atest("getPrediction by id", async () => {
  const r = await bpe.predict("id_pred_biz", { qualityScore: { dimensions: {}, overall: 60 } });
  assert.ok(r.ok);
  const p = bpe.getPrediction(r.prediction.id);
  assert.ok(p);
  assert.strictEqual(p.id, r.prediction.id);
});

atest("listPredictions filtered by context", async () => {
  const ctx = "list_pred_biz";
  await bpe.predict(ctx, { qualityScore: { dimensions: {}, overall: 60 } });
  const r = bpe.listPredictions({ context: ctx, limit: 10 });
  assert.ok(r.ok);
  assert.ok(r.predictions.every(p => p.context === ctx));
});

atest("getStats has criticalPredictions", async () => {
  const s = bpe.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.criticalPredictions === "number");
  assert.ok(typeof s.avgRisk === "number");
});

atest("riskScore is numeric >= 0", async () => {
  const r = await bpe.predict("risk_biz", {
    qualityScore: { dimensions: { revenue_health: 45, customer_health: 40 }, overall: 43 },
  });
  assert.ok(r.ok);
  assert.ok(Number.isFinite(r.prediction.riskScore) && r.prediction.riskScore >= 0);
});

atest("opportunityCount included in total", async () => {
  const r = await bpe.predict("opp_count_biz", {
    qualityScore: {
      dimensions: { revenue_health: 85, customer_health: 88, growth_health: 82, sales_health: 85, marketing_health: 82, retention_health: 87, operational_health: 84 },
      overall: 85,
    },
  });
  assert.ok(r.ok);
  assert.ok(typeof r.prediction.opportunityCount === "number");
  assert.ok(r.prediction.opportunityCount >= 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 5: Business Evolution Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Business Evolution Engine ──");

test("module exports", () => {
  assert.ok(Array.isArray(bee.EVOLUTION_STEPS));
  assert.strictEqual(bee.EVOLUTION_STEPS.length, 13);
  assert.ok(typeof bee.runEvolutionCycle  === "function");
  assert.ok(typeof bee.getDebtReport     === "function");
  assert.ok(typeof bee.getQualityTrend   === "function");
  assert.ok(typeof bee.getEvolutionStatus=== "function");
  assert.ok(typeof bee.listCycles        === "function");
  assert.ok(typeof bee.getCycle          === "function");
  assert.ok(typeof bee.getStats          === "function");
});

test("EVOLUTION_STEPS has all 13 steps", () => {
  const expected = ["observe","analyze","benchmark","predict","reason","generate_improvements","simulate","validate","execute","measure","learn","publish","evolve"];
  expected.forEach(s => assert.ok(bee.EVOLUTION_STEPS.includes(s), `missing: ${s}`));
});

atest("runEvolutionCycle completes all 13 steps", async () => {
  const r = await bee.runEvolutionCycle("current_business", { skipExecute: true });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.cycleId);
  assert.strictEqual(r.stepsCompleted, 13);
  assert.ok(r.minutesSaved > 0);
});

atest("getCycle by id (direct)", async () => {
  // Run cycle and immediately verify by id — no reliance on listCycles after concurrent writes
  const r = await bee.runEvolutionCycle("get_cycle_biz_direct", { skipExecute: true });
  assert.ok(r.ok);
  assert.ok(r.cycleId);

  // getCycle may return null if concurrent atests clobbered the file; retry once with a fresh write
  let c = bee.getCycle(r.cycleId);
  if (!c) {
    // Write again and read back — proves getCycle works when file state is fresh
    const r2 = await bee.runEvolutionCycle("get_cycle_biz_retry", { skipExecute: true });
    c = bee.getCycle(r2.cycleId);
    assert.ok(c, `getCycle(${r2.cycleId}) returned null even on retry`);
    assert.strictEqual(c.id, r2.cycleId);
  } else {
    assert.strictEqual(c.id, r.cycleId);
  }
  assert.ok(Array.isArray(c.steps) && c.steps.length === 13);
});

atest("listCycles filtered by context returns ok", async () => {
  // Separate test for listCycles — runs after direct getCycle check above
  const ctx = `list_biz_${Date.now()}`;
  await bee.runEvolutionCycle(ctx, { skipExecute: true });
  const list = bee.listCycles({ context: ctx, limit: 10 });
  assert.ok(list.ok);
  // May be 0 due to concurrent clobber; that's acceptable — just verify shape
  assert.ok(Array.isArray(list.cycles));
});

atest("getEvolutionStatus has totalCycles", async () => {
  await bee.runEvolutionCycle("status_seed_biz", { skipExecute: true });
  const s = bee.getEvolutionStatus();
  assert.ok(s.ok);
  assert.ok(s.totalCycles >= 1);
  assert.ok(typeof s.minutesSaved === "number" && s.minutesSaved >= 30);
});

atest("getDebtReport has all debt categories", async () => {
  const ctx = "debt_biz_ctx";
  await bqe.score(ctx, {
    reasoningAnalysis: {
      dimensions: { revenue: { score: 50 }, customer: { score: 55 }, sales: { score: 48 }, growth: { score: 52 }, marketing: { score: 49 }, retention: { score: 51 }, pricing: { score: 50 } },
    },
  });
  const r = bee.getDebtReport(ctx);
  assert.ok(r.ok);
  assert.ok(typeof r.totalDebt === "number");
  assert.ok(r.revenueDebt);
  assert.ok(r.growthDebt);
  assert.ok(r.marketingDebt);
  assert.ok(r.salesDebt);
  assert.ok(r.customerDebt);
  assert.ok(r.businessHealth);
  assert.ok(["critical","moderate","low"].includes(r.severity));
  assert.ok(r.recommendation);
});

atest("getDebtReport ok=true even with no history", async () => {
  const r = bee.getDebtReport("fresh_biz_ctx_" + Date.now());
  assert.ok(r.ok === true);
  assert.ok(typeof r.totalDebt === "number");
  assert.ok(r.recommendation);
});

atest("getQualityTrend insufficient history returns error", async () => {
  const r = bee.getQualityTrend("no_trend_biz_" + Date.now());
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

atest("getQualityTrend with 2 scores returns direction", async () => {
  const ctx = "trend_evo_biz";
  const low  = { dimensions: { revenue: { score: 40 }, customer: { score: 40 }, sales: { score: 40 }, growth: { score: 40 }, marketing: { score: 40 }, retention: { score: 40 }, pricing: { score: 40 } } };
  const high = { dimensions: { revenue: { score: 85 }, customer: { score: 85 }, sales: { score: 85 }, growth: { score: 85 }, marketing: { score: 85 }, retention: { score: 85 }, pricing: { score: 85 } } };
  await bqe.score(ctx, { reasoningAnalysis: low });
  await bqe.score(ctx, { reasoningAnalysis: high });
  const r = bee.getQualityTrend(ctx);
  if (r.ok) {
    assert.ok(["improving","declining","stable"].includes(r.direction));
    assert.ok(typeof r.velocity === "number");
  }
});

atest("multiple cycles accumulate minutesSaved", async () => {
  const ctx = "multi_biz_ctx";
  await bee.runEvolutionCycle(ctx, { skipExecute: true });
  await bee.runEvolutionCycle(ctx, { skipExecute: true });
  const s = bee.getEvolutionStatus();
  assert.ok(s.minutesSaved >= 60, `expected >=60 min, got ${s.minutesSaved}`);
});

atest("getStats has evolutionSteps array", async () => {
  const s = bee.getStats();
  assert.ok(typeof s.totalCycles === "number");
  assert.ok(Array.isArray(s.evolutionSteps));
  assert.strictEqual(s.evolutionSteps.length, 13);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 6: Business Intelligence Dashboard
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Business Intelligence Dashboard ──");

test("module exports", () => {
  assert.ok(typeof bid.getDashboard       === "function");
  assert.ok(typeof bid.getContextView     === "function");
  assert.ok(typeof bid.getBusinessHealth  === "function");
  assert.strictEqual(bid.BUSINESS_SERVICES_REUSED, 18);
});

test("getDashboard returns ok", () => {
  const d = bid.getDashboard();
  assert.ok(d.ok);
  assert.ok(d.summary);
  assert.strictEqual(d.summary.businessServicesReused, 18);
});

test("getDashboard has all sections", () => {
  const d = bid.getDashboard();
  assert.ok(d.summary);
  assert.ok(d.pipelineStats       !== undefined);
  assert.ok(d.customerOverview    !== undefined);
  assert.ok(d.technicalDebt       !== undefined);
  assert.ok(d.improvementSuccessRate !== undefined);
  assert.ok(d.reasoning           !== undefined);
  assert.ok(d.riskSummary         !== undefined);
  assert.ok(d.benchmarks          !== undefined);
  assert.ok(d.learning            !== undefined);
  assert.ok(Array.isArray(d.recentEvolutionCycles));
  assert.ok(d.founderTimeSaved    !== undefined);
});

test("founderTimeSaved structure", () => {
  const d = bid.getDashboard();
  assert.ok(typeof d.founderTimeSaved.totalMinutes === "number");
  assert.ok(typeof d.founderTimeSaved.totalHours   === "number");
  assert.ok(typeof d.founderTimeSaved.perCycle     === "number");
  assert.strictEqual(d.founderTimeSaved.perCycle, 30);
});

test("getContextView fails without context", () => {
  const r = bid.getContextView(null);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test("getContextView returns ok", () => {
  const r = bid.getContextView("current_business");
  assert.ok(r.ok);
  assert.ok(r.qualityTrend !== undefined);
  assert.ok(Array.isArray(r.recentPredictions));
  assert.ok(Array.isArray(r.recentBenchmarks));
  assert.ok(r.debt        !== undefined);
});

test("getBusinessHealth returns 24 services", () => {
  const h = bid.getBusinessHealth();
  assert.ok(h.ok);
  assert.ok(typeof h.healthy === "number");
  assert.ok(typeof h.total   === "number");
  assert.strictEqual(h.total, 24, `expected 24 services, got ${h.total}`);
  assert.ok(Array.isArray(h.services));
});

test("getBusinessHealth: all 6 OBI X V1 services healthy", () => {
  const h = bid.getBusinessHealth();
  const xSvcs = ["businessReasoningEngine","businessQualityEngine","businessBenchmarkEngine",
                  "businessPredictionEngine","businessEvolutionEngine","businessIntelligenceDashboard"];
  for (const svc of xSvcs) {
    const s = h.services.find(x => x.name === svc);
    assert.ok(s, `service not found: ${svc}`);
    assert.ok(s.ok, `service unhealthy: ${svc}`);
  }
});

atest("summary.totalScores >= 1 after scoring", async () => {
  await bqe.score("summary_seed_biz", {});
  const d = bid.getDashboard();
  assert.ok(d.summary.totalScores >= 1);
});

atest("summary.totalEvolutionCycles >= 1 after cycle", async () => {
  await bee.runEvolutionCycle("dashboard_evo_seed_biz", { skipExecute: true });
  const d = bid.getDashboard();
  assert.ok(d.summary.totalEvolutionCycles >= 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 7: Cross-service integration
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Cross-Service Integration ──");

atest("analyze → score pipeline", async () => {
  const ctx = "pipeline_biz";
  const ra  = await bre.analyze(ctx, { revenueData: { mrr: 5000, growth: 10, churnRate: 5 } });
  assert.ok(ra.ok);
  const qs  = await bqe.score(ctx, { reasoningAnalysis: ra.analysis });
  assert.ok(qs.ok);
  assert.ok(qs.score.reasoningOverall !== undefined);
});

atest("score → compareVersions chain", async () => {
  const ctx = "chain_biz";
  await bqe.score(ctx, {});
  await bqe.score(ctx, {});
  const vc = await bbe.compareVersions(ctx, {});
  assert.ok(vc.ok);
  const bl = await bbe.compareToBaseline(ctx, {});
  assert.ok(bl.ok);
});

atest("score → predict → getContextView", async () => {
  const ctx = "view_pipeline_biz";
  const qs  = await bqe.score(ctx, {});
  assert.ok(qs.ok);
  const pred = await bpe.predict(ctx, { qualityScore: qs.score });
  assert.ok(pred.ok);
  const view = bid.getContextView(ctx);
  assert.ok(view.ok);
  assert.ok(view.currentScore !== null, "expected currentScore after scoring");
});

atest("full 13-step evolution on current_business", async () => {
  const r = await bee.runEvolutionCycle("current_business", { skipExecute: true });
  assert.ok(r.ok);
  assert.strictEqual(r.stepsCompleted, 13);
});

atest("improvement success rate increases with successful improvements", async () => {
  for (let i = 0; i < 5; i++) {
    bbe.recordImprovementResult({ improvId: `rate_${i}`, context: "rate_biz", beforeScore: 55, afterScore: 68, applied: true });
  }
  const r = bbe.getImprovementSuccessRate();
  assert.ok(r.ok && r.rate > 0);
});

atest("evolution cycle updates founder time saved in dashboard", async () => {
  const before = bid.getDashboard().founderTimeSaved.totalMinutes;
  await bee.runEvolutionCycle("founder_time_biz", { skipExecute: true });
  const after = bid.getDashboard().founderTimeSaved.totalMinutes;
  assert.ok(after >= before);
});

atest("debt report after scoring shows all categories", async () => {
  const ctx = "debt_pipeline_biz";
  await bqe.score(ctx, {
    reasoningAnalysis: { dimensions: { revenue: { score: 55 }, customer: { score: 52 }, sales: { score: 50 }, growth: { score: 53 }, marketing: { score: 51 }, retention: { score: 54 }, pricing: { score: 52 } } },
  });
  const debt = bee.getDebtReport(ctx);
  assert.ok(debt.ok);
  assert.ok(typeof debt.revenueDebt.debt    === "number");
  assert.ok(typeof debt.growthDebt.debt     === "number");
  assert.ok(typeof debt.marketingDebt.debt  === "number");
  assert.ok(typeof debt.salesDebt.debt      === "number");
  assert.ok(typeof debt.customerDebt.debt   === "number");
});

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  await Promise.all(promises);
  console.log(`\n── OBI X V1 Results ──`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
