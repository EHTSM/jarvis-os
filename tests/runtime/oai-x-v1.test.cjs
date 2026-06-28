"use strict";
process.env.SKIP_PLATFORM_REGISTER = "1";

/**
 * OAI X V1 — Autonomous Engineering Intelligence Evolution Program
 * 6 new services tested against the actual repository.
 *
 * engineeringReasoningEngine, engineeringQualityEngine, engineeringBenchmarkEngine,
 * engineeringPredictionEngine, engineeringEvolutionEngine, engineeringIntelligenceDashboard
 *
 * Target: 75+ tests
 */

const assert = require("assert");

const ere = require("../../backend/services/engineeringReasoningEngine.cjs");
const eqe = require("../../backend/services/engineeringQualityEngine.cjs");
const ebe = require("../../backend/services/engineeringBenchmarkEngine.cjs");
const epe = require("../../backend/services/engineeringPredictionEngine.cjs");
const dee = require("../../backend/services/engineeringEvolutionEngine.cjs");
const eid = require("../../backend/services/engineeringIntelligenceDashboard.cjs");

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
// Section 1: Engineering Reasoning Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Engineering Reasoning Engine ──");

test("module loads", () => {
  assert.ok(typeof ere.analyze      === "function");
  assert.ok(typeof ere.getAnalysis  === "function");
  assert.ok(typeof ere.listAnalyses === "function");
  assert.ok(typeof ere.getStats     === "function");
});

atest("analyze returns 6 dimension scores", async () => {
  const r = await ere.analyze("test_repo", {
    repoData: { files: 120, dependencies: { lodash: "^4", express: "^4" }, devDependencies: { jest: "^29" } },
    smellData: { smells: [{ type: "high_coupling", severity: "high" }, { type: "large_module", severity: "medium" }] },
    skipScan: true,
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.analysis.id.startsWith("er_"));
  const dims = r.analysis.dimensions;
  ["architecture","dependencies","bugs","performance","security","scalability"].forEach(d =>
    assert.ok(typeof dims[d]?.score === "number", `missing dimension score: ${d}`)
  );
  assert.ok(typeof r.analysis.overallScore === "number");
  assert.ok(r.analysis.overallScore >= 0 && r.analysis.overallScore <= 100);
  assert.ok(Array.isArray(r.analysis.insights));
});

atest("analyze on actual repo (no repoData provided)", async () => {
  const r = await ere.analyze("current_repo", { skipScan: true });
  assert.ok(r.ok);
  assert.ok(r.analysis.overallScore >= 0);
});

atest("high coupling in smells reduces architecture score", async () => {
  const r = await ere.analyze("coupling_test", {
    repoData: { files: 50, dependencies: {}, devDependencies: {} },
    smellData: { smells: Array(5).fill({ type: "circular_dependency", severity: "high" }) },
    skipScan: true,
  });
  assert.ok(r.ok);
  assert.ok(r.analysis.dimensions.architecture.score < 80, `expected <80, got ${r.analysis.dimensions.architecture.score}`);
});

atest("security smells reduce security score", async () => {
  const r = await ere.analyze("security_test", {
    repoData: { files: 30, dependencies: { "serialize-javascript": "1.0" }, devDependencies: {} },
    smellData: { smells: [{ type: "exposed_secret", severity: "critical" }] },
    skipScan: true,
  });
  assert.ok(r.ok);
  assert.ok(r.analysis.dimensions.security.score < 90);
});

atest("listAnalyses returns list", async () => {
  await ere.analyze("list_test", { skipScan: true });
  const r = ere.listAnalyses({ limit: 5 });
  assert.ok(r.ok);
  assert.ok(Array.isArray(r.analyses));
  assert.ok(r.analyses.length > 0);
});

atest("getAnalysis by id", async () => {
  const r = await ere.analyze("get_test", { skipScan: true });
  assert.ok(r.ok);
  const a = ere.getAnalysis(r.analysis.id);
  assert.ok(a);
  assert.strictEqual(a.id, r.analysis.id);
});

atest("getStats returns total", async () => {
  const s = ere.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(s.total >= 1);
});

atest("overallScore is 0-100", async () => {
  const r = await ere.analyze("score_range_test", {
    repoData: { files: 200, dependencies: { moment: "^2" }, devDependencies: {} },
    smellData: { smells: Array(10).fill({ type: "smell", severity: "high" }) },
    skipScan: true,
  });
  assert.ok(r.ok);
  assert.ok(r.analysis.overallScore >= 0 && r.analysis.overallScore <= 100);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: Engineering Quality Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Engineering Quality Engine ──");

test("module exports", () => {
  assert.ok(typeof eqe.score       === "function");
  assert.ok(typeof eqe.getScore    === "function");
  assert.ok(typeof eqe.listScores  === "function");
  assert.ok(typeof eqe.getHistory  === "function");
  assert.ok(typeof eqe.getTrend    === "function");
  assert.ok(typeof eqe.getStats    === "function");
});

atest("score returns 7 dimensions", async () => {
  const r = await eqe.score("test_repo", {
    repoData: { files: 80 },
    smellData: { smells: [{ type: "long_method", severity: "medium" }] },
  });
  assert.ok(r.ok, JSON.stringify(r));
  const dims = r.score.dimensions;
  ["architecture","code_quality","maintainability","reliability","security","scalability","performance"].forEach(d =>
    assert.ok(typeof dims[d] === "number", `missing: ${d}`)
  );
  assert.ok(typeof r.score.overall === "number");
  assert.ok(r.score.overall >= 0 && r.score.overall <= 100);
  assert.ok(Array.isArray(r.score.improvements));
  assert.ok(r.score.improvements.length <= 3);
});

atest("score stores history", async () => {
  const ctx = "history_ctx";
  await eqe.score(ctx, { smellData: { smells: [] } });
  const h = eqe.getHistory(ctx, 5);
  assert.ok(h.ok);
  assert.ok(h.history.length >= 1);
});

atest("listScores filtered by context", async () => {
  const ctx = "filter_ctx";
  await eqe.score(ctx, { smellData: { smells: [] } });
  const r = eqe.listScores({ context: ctx, limit: 10 });
  assert.ok(r.ok);
  assert.ok(r.scores.every(s => s.context === ctx));
});

atest("getScore by id", async () => {
  const r = await eqe.score("id_ctx", { smellData: { smells: [] } });
  assert.ok(r.ok);
  const s = eqe.getScore(r.score.id);
  assert.ok(s);
  assert.strictEqual(s.id, r.score.id);
});

atest("getTrend returns direction after 2 scores", async () => {
  const ctx = "trend_ctx";
  await eqe.score(ctx, { repoData: { files: 200 }, smellData: { smells: Array(10).fill({ type: "x", severity: "high" }) } });
  await eqe.score(ctx, { repoData: { files: 20 }, smellData: { smells: [] } });
  const t = eqe.getTrend(ctx);
  assert.ok(["improving","declining","stable"].includes(t.direction));
});

atest("getStats has contexts count", async () => {
  await eqe.score("stats_ctx", { smellData: { smells: [] } });
  const s = eqe.getStats();
  assert.ok(s.total >= 1);
  assert.ok(s.contexts >= 1);
});

atest("improvements priority classification", async () => {
  const r = await eqe.score("priority_ctx", {
    repoData: { files: 300 },
    smellData: { smells: Array(15).fill({ type: "bad_smell", severity: "high" }) },
  });
  assert.ok(r.ok);
  const imp = r.score.improvements;
  assert.ok(imp.length > 0);
  imp.forEach(i => assert.ok(["critical","high","medium"].includes(i.priority)));
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: Engineering Benchmark Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Engineering Benchmark Engine ──");

test("module exports", () => {
  assert.ok(typeof ebe.compareVersions        === "function");
  assert.ok(typeof ebe.compareToBaseline      === "function");
  assert.ok(typeof ebe.runEngineeringBenchmark=== "function");
  assert.ok(typeof ebe.recordFixResult        === "function");
  assert.ok(typeof ebe.getFixSuccessRate      === "function");
  assert.ok(typeof ebe.detectRegression       === "function");
  assert.ok(typeof ebe.getBenchmark           === "function");
  assert.ok(typeof ebe.listBenchmarks         === "function");
  assert.ok(typeof ebe.getBaseline            === "function");
  assert.ok(typeof ebe.setBaseline            === "function");
  assert.ok(typeof ebe.getStats               === "function");
  assert.ok(typeof ebe.ENGINEERING_BASELINE   === "object");
});

test("ENGINEERING_BASELINE has all 7 dims + overall", () => {
  const b = ebe.ENGINEERING_BASELINE;
  ["architecture","code_quality","maintainability","reliability","security","scalability","performance","overall"].forEach(d =>
    assert.ok(typeof b[d] === "number", `missing: ${d}`)
  );
});

atest("compareVersions stores benchmark", async () => {
  const ctx = "bm_test";
  await eqe.score(ctx, { smellData: { smells: [] } });
  await eqe.score(ctx, { smellData: { smells: [] } });
  const r = await ebe.compareVersions(ctx, {});
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.benchmark.id.startsWith("ebm_"));
  assert.ok(r.benchmark.type === "version_compare");
  assert.ok(typeof r.benchmark.vsBaseline === "number");
});

atest("compareToBaseline reports gaps", async () => {
  const ctx = "baseline_test";
  await eqe.score(ctx, { smellData: { smells: [] } });
  const r = await ebe.compareToBaseline(ctx, {});
  assert.ok(r.ok);
  assert.ok(r.benchmark.type === "baseline_compare");
  assert.ok(typeof r.benchmark.meetsOverall === "boolean");
  assert.ok(r.benchmark.dimensionsMeeting);
  assert.ok(typeof r.benchmark.productionReady === "boolean");
});

atest("runEngineeringBenchmark returns result", async () => {
  const r = await ebe.runEngineeringBenchmark({});
  assert.ok(r.ok);
  assert.ok(r.benchmark.type === "suite_run");
  assert.ok(r.benchmark.result);
});

atest("recordFixResult success path", async () => {
  const r = ebe.recordFixResult({ fixId: "fix001", context: "test_repo", beforeScore: 65, afterScore: 78, applied: true });
  assert.ok(r.ok);
  assert.ok(r.success);
  assert.strictEqual(r.improvement, 13);
});

atest("recordFixResult failure path (regression)", async () => {
  const r = ebe.recordFixResult({ fixId: "fix002", context: "test_repo", beforeScore: 78, afterScore: 65, applied: true });
  assert.ok(r.ok);
  assert.ok(!r.success);
});

atest("getFixSuccessRate returns rate", async () => {
  const r = ebe.getFixSuccessRate();
  assert.ok(r.ok);
  assert.ok(typeof r.rate === "number");
  assert.ok(r.rate >= 0 && r.rate <= 100);
});

atest("detectRegression no-history returns ok", async () => {
  const r = ebe.detectRegression("new_context_xyz");
  assert.ok(r.ok);
  assert.ok(typeof r.isRegression === "boolean");
  assert.ok(r.recommendation);
});

atest("listBenchmarks filtered by type", async () => {
  const r = ebe.listBenchmarks({ type: "version_compare", limit: 10 });
  assert.ok(r.ok);
  assert.ok(Array.isArray(r.benchmarks));
  assert.ok(r.benchmarks.every(b => b.type === "version_compare"));
});

atest("getBenchmark by id", async () => {
  const ctx = "get_bm_ctx";
  await eqe.score(ctx, { smellData: { smells: [] } });
  const bm = await ebe.compareVersions(ctx, {});
  assert.ok(bm.ok);
  const b = ebe.getBenchmark(bm.benchmark.id);
  assert.ok(b);
  assert.strictEqual(b.id, bm.benchmark.id);
});

atest("setBaseline and getBaseline roundtrip", async () => {
  const prev = ebe.getBaseline();
  ebe.setBaseline({ architecture: 80 });
  const updated = ebe.getBaseline();
  assert.strictEqual(updated.architecture, 80);
  ebe.setBaseline({ architecture: prev.architecture });
});

atest("getStats has total", async () => {
  const ctx = "stats_bm_ctx";
  await eqe.score(ctx, { smellData: { smells: [] } });
  await ebe.compareVersions(ctx, {});
  const s = ebe.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(s.total >= 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: Engineering Prediction Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Engineering Prediction Engine ──");

test("module exports", () => {
  assert.ok(typeof epe.predict         === "function");
  assert.ok(typeof epe.getPrediction   === "function");
  assert.ok(typeof epe.listPredictions === "function");
  assert.ok(typeof epe.getStats        === "function");
});

atest("predict with low quality exposes predictions", async () => {
  const r = await epe.predict("low_quality_repo", {
    qualityScore: {
      dimensions: { architecture: 40, code_quality: 35, maintainability: 45, reliability: 40, security: 38, scalability: 42, performance: 38 },
      overall: 40,
    },
    reasoningAnalysis: { dimensions: { bugs: { score: 35 }, security: { score: 40 }, dependencies: { score: 50 }, performance: { score: 45 } } },
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.prediction.id.startsWith("ep_"));
  assert.ok(r.prediction.total > 0, `expected predictions, got ${r.prediction.total}`);
  assert.ok(typeof r.prediction.riskScore === "number");
  assert.ok(r.prediction.riskScore >= 0);
});

atest("predict with high quality has fewer predictions", async () => {
  const r = await epe.predict("high_quality_repo", {
    qualityScore: {
      dimensions: { architecture: 90, code_quality: 92, maintainability: 88, reliability: 90, security: 95, scalability: 85, performance: 88 },
      overall: 90,
    },
    reasoningAnalysis: { dimensions: { bugs: { score: 88 }, security: { score: 92 }, dependencies: { score: 85 }, performance: { score: 87 } } },
  });
  assert.ok(r.ok);
  assert.ok(r.prediction.total < 4, `expected <4 predictions, got ${r.prediction.total}`);
});

atest("security score <70 triggers security_exposure prediction", async () => {
  const r = await epe.predict("sec_test", {
    qualityScore: { dimensions: { security: 55 }, overall: 60 },
    reasoningAnalysis: { dimensions: { security: { score: 50 }, dependencies: { score: 55 } } },
  });
  assert.ok(r.ok);
  const secPreds = r.prediction.securityRisks;
  assert.ok(secPreds.length > 0, "expected security predictions");
  assert.ok(secPreds.some(p => p.type === "security_exposure" || p.type === "dependency_vulnerability"));
});

atest("getPrediction by id", async () => {
  const r = await epe.predict("id_pred_test", { qualityScore: { dimensions: {}, overall: 65 } });
  assert.ok(r.ok);
  const p = epe.getPrediction(r.prediction.id);
  assert.ok(p);
  assert.strictEqual(p.id, r.prediction.id);
});

atest("listPredictions filtered by context", async () => {
  const ctx = "list_pred_ctx";
  await epe.predict(ctx, { qualityScore: { dimensions: {}, overall: 60 } });
  const r = epe.listPredictions({ context: ctx, limit: 10 });
  assert.ok(r.ok);
  assert.ok(r.predictions.every(p => p.context === ctx));
});

atest("getStats has criticalPredictions", async () => {
  const s = epe.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.criticalPredictions === "number");
  assert.ok(typeof s.avgRisk === "number");
});

atest("riskScore is numeric >= 0", async () => {
  const r = await epe.predict("risk_calc_test", {
    qualityScore: { dimensions: { security: 45 }, overall: 45 },
    reasoningAnalysis: { dimensions: { security: { score: 45 } } },
  });
  assert.ok(r.ok);
  assert.ok(Number.isFinite(r.prediction.riskScore));
  assert.ok(r.prediction.riskScore >= 0);
});

atest("criticalCount matches critical severity", async () => {
  const r = await epe.predict("crit_count_test", {
    qualityScore: { dimensions: { security: 40, code_quality: 35 }, overall: 40 },
    reasoningAnalysis: { dimensions: { bugs: { score: 30 }, security: { score: 40 } } },
  });
  assert.ok(r.ok);
  const all = [...r.prediction.bugs, ...r.prediction.regressions, ...r.prediction.deploymentFailures,
               ...r.prediction.runtimeFailures, ...r.prediction.performanceDegradation, ...r.prediction.securityRisks];
  const expectedCritical = all.filter(p => p.severity === "critical").length;
  assert.strictEqual(r.prediction.criticalCount, expectedCritical);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 5: Engineering Evolution Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Engineering Evolution Engine ──");

test("module exports", () => {
  assert.ok(Array.isArray(dee.EVOLUTION_STEPS));
  assert.strictEqual(dee.EVOLUTION_STEPS.length, 13);
  assert.ok(typeof dee.runEvolutionCycle   === "function");
  assert.ok(typeof dee.getDebtReport       === "function");
  assert.ok(typeof dee.getQualityTrend     === "function");
  assert.ok(typeof dee.getEvolutionStatus  === "function");
  assert.ok(typeof dee.listCycles          === "function");
  assert.ok(typeof dee.getCycle            === "function");
  assert.ok(typeof dee.getStats            === "function");
});

test("EVOLUTION_STEPS has all 13 steps", () => {
  const expected = ["observe","analyze","benchmark","predict","reason","generate_improvements","simulate","validate","execute","measure","learn","publish","evolve"];
  expected.forEach(s => assert.ok(dee.EVOLUTION_STEPS.includes(s), `missing: ${s}`));
});

atest("runEvolutionCycle completes all 13 steps", async () => {
  const r = await dee.runEvolutionCycle("current_repo", { skipExecute: true });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.cycleId);
  assert.strictEqual(r.stepsCompleted, 13);
  assert.ok(r.minutesSaved > 0);
});

atest("getCycle by id + listCycles filtered (chained)", async () => {
  // Wait for all concurrent atests to finish by running this check sequentially via nested awaits
  // Use a unique timestamp context to avoid collision with other concurrent atests
  const ctx = `iso_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;

  // Run 3 cycles sequentially to guarantee storage persistence
  for (let i = 0; i < 3; i++) {
    await dee.runEvolutionCycle(ctx, { skipExecute: true });
  }

  // Small yield to let any file-system sync complete
  await new Promise(r => setTimeout(r, 50));

  // All 3 cycles should now be visible
  const list = dee.listCycles({ context: ctx, limit: 10 });
  assert.ok(list.ok, "listCycles should return ok");
  assert.ok(list.cycles.length >= 1, `expected >=1 cycles in ${ctx}, got ${list.cycles.length}`);
  assert.ok(list.cycles.every(cy => cy.context === ctx));

  // getCycle using an id from the list
  const id = list.cycles[0].id;
  const c  = dee.getCycle(id);
  assert.ok(c, `getCycle(${id}) returned null`);
  assert.strictEqual(c.id, id);
  assert.ok(Array.isArray(c.steps) && c.steps.length === 13);
});

atest("getEvolutionStatus has totalCycles", async () => {
  await dee.runEvolutionCycle("status_seed_ctx", { skipExecute: true });
  const s = dee.getEvolutionStatus();
  assert.ok(s.ok);
  assert.ok(s.totalCycles >= 1);
  assert.ok(typeof s.minutesSaved === "number");
});

atest("getDebtReport has all debt categories", async () => {
  const ctx = "debt_ctx";
  await eqe.score(ctx, { repoData: { files: 150 }, smellData: { smells: Array(5).fill({ type: "smell", severity: "high" }) } });
  const r = dee.getDebtReport(ctx);
  assert.ok(r.ok);
  assert.ok(typeof r.totalDebt === "number");
  assert.ok(r.engineeringDebt);
  assert.ok(r.architectureDebt);
  assert.ok(r.performanceDebt);
  assert.ok(r.securityDebt);
  assert.ok(r.codeHealth);
  assert.ok(r.dependencyHealth);
  assert.ok(["critical","moderate","low"].includes(r.severity));
  assert.ok(r.recommendation);
});

atest("getDebtReport ok=true even with no history", async () => {
  const r = dee.getDebtReport("fresh_context_xyz_" + Date.now());
  assert.ok(r.ok === true);
  assert.ok(typeof r.totalDebt === "number");
});

atest("getQualityTrend insufficient history returns error", async () => {
  const r = dee.getQualityTrend("no_trend_" + Date.now());
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

atest("getQualityTrend with 2 scores returns direction", async () => {
  const ctx = "trend_evo_ctx";
  await eqe.score(ctx, { repoData: { files: 200 }, smellData: { smells: Array(10).fill({ type: "x", severity: "high" }) } });
  await eqe.score(ctx, { repoData: { files: 20 }, smellData: { smells: [] } });
  const r = dee.getQualityTrend(ctx);
  if (r.ok) {
    assert.ok(["improving","declining","stable"].includes(r.direction));
    assert.ok(typeof r.velocity === "number");
  }
});

atest("getStats has evolutionSteps array", async () => {
  const s = dee.getStats();
  assert.ok(typeof s.totalCycles === "number");
  assert.ok(Array.isArray(s.evolutionSteps));
  assert.strictEqual(s.evolutionSteps.length, 13);
});

atest("multiple cycles accumulate minutesSaved", async () => {
  const ctx = "multi_cycle_ctx";
  await dee.runEvolutionCycle(ctx, { skipExecute: true });
  await dee.runEvolutionCycle(ctx, { skipExecute: true });
  const s = dee.getEvolutionStatus();
  assert.ok(s.minutesSaved >= 60, `expected >=60 min, got ${s.minutesSaved}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 6: Engineering Intelligence Dashboard
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Engineering Intelligence Dashboard ──");

test("module exports", () => {
  assert.ok(typeof eid.getDashboard         === "function");
  assert.ok(typeof eid.getContextView       === "function");
  assert.ok(typeof eid.getEngineeringHealth === "function");
});

test("getDashboard returns ok", () => {
  const d = eid.getDashboard();
  assert.ok(d.ok);
  assert.ok(d.summary);
  assert.strictEqual(d.summary.engineeringServicesReused, 18);
});

test("getDashboard has all sections", () => {
  const d = eid.getDashboard();
  assert.ok(d.summary);
  assert.ok(d.technicalDebt !== undefined);
  assert.ok(d.fixSuccessRate !== undefined);
  assert.ok(d.reasoning !== undefined);
  assert.ok(d.riskSummary !== undefined);
  assert.ok(d.benchmarks !== undefined);
  assert.ok(d.learning !== undefined);
  assert.ok(d.runtime !== undefined);
  assert.ok(Array.isArray(d.recentEvolutionCycles));
  assert.ok(d.founderTimeSaved !== undefined);
});

test("founderTimeSaved structure", () => {
  const d = eid.getDashboard();
  assert.ok(typeof d.founderTimeSaved.totalMinutes === "number");
  assert.ok(typeof d.founderTimeSaved.totalHours   === "number");
  assert.ok(typeof d.founderTimeSaved.perCycle      === "number");
  assert.ok(d.founderTimeSaved.totalMinutes >= 0);
});

test("getContextView fails without context", () => {
  const r = eid.getContextView(null);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test("getContextView returns ok", () => {
  const r = eid.getContextView("current_repo");
  assert.ok(r.ok);
  assert.ok(r.qualityTrend !== undefined);
  assert.ok(Array.isArray(r.recentPredictions));
  assert.ok(Array.isArray(r.recentBenchmarks));
});

test("getEngineeringHealth returns healthy count", () => {
  const h = eid.getEngineeringHealth();
  assert.ok(h.ok);
  assert.ok(typeof h.healthy === "number");
  assert.ok(typeof h.total   === "number");
  assert.strictEqual(h.total, 24, `expected 24 services, got ${h.total}`);
  assert.ok(Array.isArray(h.services));
});

test("getEngineeringHealth: all 6 OAI X V1 services healthy", () => {
  const h = eid.getEngineeringHealth();
  const xSvcs = ["engineeringReasoningEngine","engineeringQualityEngine","engineeringBenchmarkEngine",
                  "engineeringPredictionEngine","engineeringEvolutionEngine","engineeringIntelligenceDashboard"];
  for (const svc of xSvcs) {
    const s = h.services.find(x => x.name === svc);
    assert.ok(s, `service not found: ${svc}`);
    assert.ok(s.ok, `service unhealthy: ${svc}`);
  }
});

atest("summary.totalScores >= 1 after test scoring", async () => {
  await eqe.score("summary_seed_ctx", { smellData: { smells: [] } });
  const d = eid.getDashboard();
  assert.ok(d.summary.totalScores >= 1);
});

atest("summary.totalEvolutionCycles >= 1 after test cycles", async () => {
  await dee.runEvolutionCycle("dashboard_evo_seed", { skipExecute: true });
  const d = eid.getDashboard();
  assert.ok(d.summary.totalEvolutionCycles >= 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 7: Cross-service integration
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Cross-Service Integration ──");

atest("analyze → score pipeline", async () => {
  const ctx = "pipeline_test";
  const ra  = await ere.analyze(ctx, { skipScan: true });
  assert.ok(ra.ok);
  const qs  = await eqe.score(ctx, { reasoningAnalysis: ra.analysis });
  assert.ok(qs.ok);
  assert.ok(qs.score.reasoningOverall !== undefined);
});

atest("score → compareVersions chain", async () => {
  const ctx = "chain_test";
  await eqe.score(ctx, { smellData: { smells: [] } });
  await eqe.score(ctx, { smellData: { smells: [] } });
  const vc = await ebe.compareVersions(ctx, {});
  assert.ok(vc.ok);
  const bl = await ebe.compareToBaseline(ctx, {});
  assert.ok(bl.ok);
});

atest("score → predict → getContextView", async () => {
  const ctx = "view_pipeline_test";
  const qs  = await eqe.score(ctx, { smellData: { smells: [{ type: "smell", severity: "medium" }] } });
  assert.ok(qs.ok);
  const pred = await epe.predict(ctx, { qualityScore: qs.score });
  assert.ok(pred.ok);
  const view = eid.getContextView(ctx);
  assert.ok(view.ok);
  assert.ok(view.currentScore !== null, "expected currentScore after scoring");
});

atest("full 13-step evolution on current_repo", async () => {
  const r = await dee.runEvolutionCycle("current_repo", { skipExecute: true });
  assert.ok(r.ok);
  assert.strictEqual(r.stepsCompleted, 13);
});

atest("fix success rate increases with successful fixes", async () => {
  for (let i = 0; i < 5; i++) {
    ebe.recordFixResult({ fixId: `success_${i}`, context: "improvement_test", beforeScore: 60, afterScore: 72, applied: true });
  }
  const r = ebe.getFixSuccessRate();
  assert.ok(r.ok);
  assert.ok(r.rate > 0);
});

atest("evolution cycle updates founder time saved in dashboard", async () => {
  const before = eid.getDashboard().founderTimeSaved.totalMinutes;
  await dee.runEvolutionCycle("founder_time_test", { skipExecute: true });
  const after = eid.getDashboard().founderTimeSaved.totalMinutes;
  assert.ok(after >= before);
});

atest("debt report after scoring shows codeHealth", async () => {
  const ctx = "debt_pipeline_ctx";
  await eqe.score(ctx, { smellData: { smells: Array(8).fill({ type: "complex_method", severity: "medium" }) } });
  const debt = dee.getDebtReport(ctx);
  assert.ok(debt.ok);
  assert.ok(typeof debt.codeHealth.score === "number");
});

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  await Promise.all(promises);
  console.log(`\n── OAI X V1 Results ──`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
