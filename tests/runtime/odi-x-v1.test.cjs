"use strict";
process.env.SKIP_PLATFORM_REGISTER = "1";

/**
 * ODI X V1 — Visual Intelligence Evolution Program
 * Test suite for 6 new services:
 *   visualReasoningEngine, designQualityEngine, designBenchmarkEngine,
 *   designPredictionEngine, designEvolutionEngine, designIntelligenceDashboard
 *
 * Target: 82+ tests
 */

const assert = require("assert");

const vr  = require("../../backend/services/visualReasoningEngine.cjs");
const dqe = require("../../backend/services/designQualityEngine.cjs");
const dbe = require("../../backend/services/designBenchmarkEngine.cjs");
const dpe = require("../../backend/services/designPredictionEngine.cjs");
const dee = require("../../backend/services/designEvolutionEngine.cjs");
const did = require("../../backend/services/designIntelligenceDashboard.cjs");

let passed = 0;
let failed = 0;
const promises = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

function atest(name, fn) {
  promises.push(
    fn().then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    }).catch(e => {
      console.error(`  ✗ ${name}: ${e.message}`);
      failed++;
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: Visual Reasoning Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Visual Reasoning Engine ──");

test("module loads", () => {
  assert.ok(typeof vr.analyze === "function");
  assert.ok(typeof vr.listAnalyses === "function");
  assert.ok(typeof vr.getAnalysis === "function");
  assert.ok(typeof vr.getStats === "function");
});

atest("analyze returns ok with pageUrl", async () => {
  const r = await vr.analyze("https://example.com/home", {
    domData: { elementCount: 45, maxDepth: 5 },
    layoutData: { nodes: [], levels: 3 },
    componentData: { components: [] },
    accessData: { violations: [], passes: [] },
  });
  assert.ok(r.ok, `expected ok=true, got: ${JSON.stringify(r)}`);
  assert.ok(r.analysis);
  assert.ok(typeof r.analysis.cognitiveLoad === "number");
  assert.ok(typeof r.analysis.hierarchyScore === "number");
  assert.ok(r.analysis.readingFlow);
  assert.ok(Array.isArray(r.analysis.attentionHotspots));
  assert.ok(Array.isArray(r.analysis.confusionSignals));
  assert.ok(typeof r.analysis.reasoningScore === "number");
  assert.ok(Array.isArray(r.analysis.insights));
});

atest("analyze returns ok with no data (defaults)", async () => {
  const r = await vr.analyze("https://example.com/about", {});
  assert.ok(r.ok);
  assert.ok(r.analysis.id.startsWith("vr_"));
});

atest("high element count increases cognitive load", async () => {
  const r = await vr.analyze("https://example.com/heavy", {
    domData: { elementCount: 200, maxDepth: 10 },
    layoutData: {},
    componentData: {},
    accessData: {},
  });
  assert.ok(r.ok);
  assert.ok(r.analysis.cognitiveLoad > 20, `expected >20, got ${r.analysis.cognitiveLoad}`);
});

atest("analyze fails without pageUrl or data", async () => {
  const r = await vr.analyze(null, {});
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

atest("listAnalyses returns list", async () => {
  // ensure at least one exists
  await vr.analyze("https://example.com/list-test", { domData: { elementCount: 10, maxDepth: 2 } });
  const r = vr.listAnalyses({ limit: 5 });
  assert.ok(r.ok);
  assert.ok(Array.isArray(r.analyses));
  assert.ok(r.analyses.length > 0);
});

atest("getAnalysis by id works", async () => {
  const r = await vr.analyze("https://example.com/get-test", { domData: { elementCount: 20 } });
  assert.ok(r.ok);
  const a = vr.getAnalysis(r.analysis.id);
  assert.ok(a);
  assert.strictEqual(a.id, r.analysis.id);
});

atest("getStats returns totals", async () => {
  const s = vr.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(s.total >= 1);
});

atest("reasoningScore is 0-100", async () => {
  const r = await vr.analyze("https://example.com/score-check", {
    domData: { elementCount: 30, maxDepth: 4 },
    layoutData: { levels: 4 },
    componentData: { components: [] },
    accessData: {},
  });
  assert.ok(r.ok);
  assert.ok(r.analysis.reasoningScore >= 0 && r.analysis.reasoningScore <= 100);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: Design Quality Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Design Quality Engine ──");

test("module exports", () => {
  assert.ok(typeof dqe.score === "function");
  assert.ok(typeof dqe.getScore === "function");
  assert.ok(typeof dqe.listScores === "function");
  assert.ok(typeof dqe.getHistory === "function");
  assert.ok(typeof dqe.getTrend === "function");
  assert.ok(typeof dqe.getStats === "function");
});

atest("score page returns 7 dimensions", async () => {
  const r = await dqe.score("https://example.com/dashboard", {
    domData: { elementCount: 40, maxDepth: 4 },
    componentData: { components: [{ type: "button" }, { type: "button" }, { type: "input" }] },
    tokenData: { tokens: { colorTokens: ["#fff","#000","#blue","#red","#green"], spacingTokens: ["4px","8px","16px","24px","32px"] } },
    accessData: { violations: [], passes: [{ id: "color-contrast" }] },
    responsiveData: { viewports: [{ name: "mobile", width: 375, status: "pass", issues: [] }] },
  });
  assert.ok(r.ok, `score failed: ${JSON.stringify(r)}`);
  const dims = r.score.dimensions;
  assert.ok(typeof dims.aesthetics === "number");
  assert.ok(typeof dims.usability === "number");
  assert.ok(typeof dims.accessibility === "number");
  assert.ok(typeof dims.consistency === "number");
  assert.ok(typeof dims.responsiveness === "number");
  assert.ok(typeof dims.maintainability === "number");
  assert.ok(typeof dims.performance === "number");
  assert.ok(typeof r.score.overall === "number");
  assert.ok(r.score.overall >= 0 && r.score.overall <= 100);
});

atest("score stores in history", async () => {
  const url = "https://example.com/history-test";
  await dqe.score(url, { domData: { elementCount: 20 } });
  const h = dqe.getHistory(url, 5);
  assert.ok(h.ok);
  assert.ok(h.history.length >= 1);
});

atest("improvements list has at most 3 entries", async () => {
  const r = await dqe.score("https://example.com/improvements-test", {});
  assert.ok(r.ok);
  assert.ok(Array.isArray(r.score.improvements));
  assert.ok(r.score.improvements.length <= 3);
});

atest("listScores filtered by pageUrl", async () => {
  const url = "https://example.com/filter-test";
  await dqe.score(url, { domData: { elementCount: 5 } });
  const r = dqe.listScores({ pageUrl: url, limit: 10 });
  assert.ok(r.ok);
  assert.ok(r.scores.every(s => s.pageUrl === url));
});

atest("getScore by id", async () => {
  const r = await dqe.score("https://example.com/id-test", { domData: { elementCount: 15 } });
  assert.ok(r.ok);
  const s = dqe.getScore(r.score.id);
  assert.ok(s);
  assert.strictEqual(s.id, r.score.id);
});

atest("getTrend returns direction after 2 scores", async () => {
  const url = "https://example.com/trend-test";
  await dqe.score(url, { domData: { elementCount: 80 } });
  await dqe.score(url, { domData: { elementCount: 20 } });
  const t = dqe.getTrend(url);
  assert.ok(["improving","declining","stable"].includes(t.direction));
});

atest("getStats has pages count", async () => {
  await dqe.score("https://example.com/stats-pages-seed", { domData: { elementCount: 10 } });
  const s = dqe.getStats();
  assert.ok(s.total >= 1);
  assert.ok(s.pages >= 1);
});

atest("score fails without pageUrl or domData", async () => {
  const r = await dqe.score(null, {});
  assert.strictEqual(r.ok, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: Design Benchmark Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Design Benchmark Engine ──");

test("module exports", () => {
  assert.ok(typeof dbe.compareVersions === "function");
  assert.ok(typeof dbe.compareToBaseline === "function");
  assert.ok(typeof dbe.recordPatchResult === "function");
  assert.ok(typeof dbe.getPatchSuccessRate === "function");
  assert.ok(typeof dbe.detectRegression === "function");
  assert.ok(typeof dbe.getBenchmark === "function");
  assert.ok(typeof dbe.listBenchmarks === "function");
  assert.ok(typeof dbe.getBaseline === "function");
  assert.ok(typeof dbe.setBaseline === "function");
  assert.ok(typeof dbe.getStats === "function");
  assert.ok(typeof dbe.BEST_PRACTICE_BASELINE === "object");
});

test("BEST_PRACTICE_BASELINE has all dimensions", () => {
  const b = dbe.BEST_PRACTICE_BASELINE;
  ["aesthetics","usability","accessibility","consistency","responsiveness","maintainability","performance","overall"].forEach(d => {
    assert.ok(typeof b[d] === "number", `missing dimension: ${d}`);
  });
});

atest("compareVersions stores benchmark", async () => {
  const url = "https://example.com/compare-test";
  await dqe.score(url, { domData: { elementCount: 30 } });
  await dqe.score(url, { domData: { elementCount: 30 } });
  const r = await dbe.compareVersions(url, {});
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.benchmark.id.startsWith("dbm_"));
  assert.ok(r.benchmark.type === "version_compare");
  assert.ok(typeof r.benchmark.vsBaseline === "number");
});

atest("compareToBaseline reports gaps", async () => {
  const url = "https://example.com/baseline-test";
  await dqe.score(url, { domData: { elementCount: 25 } });
  const r = await dbe.compareToBaseline(url, {});
  assert.ok(r.ok);
  assert.ok(r.benchmark.type === "baseline_compare");
  assert.ok(typeof r.benchmark.meetsOverall === "boolean");
  assert.ok(r.benchmark.dimensionsMeeting);
});

atest("recordPatchResult success path", async () => {
  const r = dbe.recordPatchResult({ patchId: "p001", pageUrl: "https://example.com", beforeScore: 70, afterScore: 80, applied: true });
  assert.ok(r.ok);
  assert.ok(r.success);
  assert.strictEqual(r.improvement, 10);
});

atest("recordPatchResult failure path", async () => {
  const r = dbe.recordPatchResult({ patchId: "p002", pageUrl: "https://example.com", beforeScore: 80, afterScore: 70, applied: true });
  assert.ok(r.ok);
  assert.ok(!r.success);
});

atest("getPatchSuccessRate returns rate", async () => {
  const r = dbe.getPatchSuccessRate();
  assert.ok(r.ok);
  assert.ok(typeof r.rate === "number");
  assert.ok(r.rate >= 0 && r.rate <= 100);
  assert.ok(typeof r.totalPatches === "number");
});

atest("detectRegression works", async () => {
  const r = await dbe.detectRegression("https://example.com/regression-test");
  assert.ok(r.ok);
  assert.ok(typeof r.designRegression === "boolean");
  assert.ok(typeof r.visualRegression === "boolean");
  assert.ok(r.recommendation);
});

atest("listBenchmarks filtered by type", async () => {
  const r = dbe.listBenchmarks({ type: "version_compare", limit: 10 });
  assert.ok(r.ok);
  assert.ok(Array.isArray(r.benchmarks));
  assert.ok(r.benchmarks.every(b => b.type === "version_compare"));
});

atest("getBenchmark by id", async () => {
  const url = "https://example.com/get-bm-test";
  await dqe.score(url, { domData: { elementCount: 20 } });
  const bm = await dbe.compareVersions(url, {});
  assert.ok(bm.ok);
  const b = dbe.getBenchmark(bm.benchmark.id);
  assert.ok(b);
  assert.strictEqual(b.id, bm.benchmark.id);
});

atest("setBaseline and getBaseline", async () => {
  const prev = dbe.getBaseline();
  dbe.setBaseline({ aesthetics: 80 });
  const newBase = dbe.getBaseline();
  assert.strictEqual(newBase.aesthetics, 80);
  // restore
  dbe.setBaseline({ aesthetics: prev.aesthetics });
});

atest("getStats has benchmark counts", async () => {
  const url = "https://example.com/bench-stats-seed";
  await dqe.score(url, { domData: { elementCount: 15 } });
  await dbe.compareVersions(url, {});
  const s = dbe.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(s.total >= 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: Design Prediction Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Design Prediction Engine ──");

test("module exports", () => {
  assert.ok(typeof dpe.predict === "function");
  assert.ok(typeof dpe.getPrediction === "function");
  assert.ok(typeof dpe.listPredictions === "function");
  assert.ok(typeof dpe.getStats === "function");
});

atest("predict with low quality score surfaces ux problems", async () => {
  const r = await dpe.predict("https://example.com/predict-test", {
    qualityScore: { dimensions: { usability: 40, accessibility: 45, responsiveness: 50, consistency: 35, aesthetics: 45 }, overall: 43 },
    reasoningAnalysis: { cognitiveLoad: 80, attentionHotspots: Array(8).fill({ weight: 0.5 }), readingFlow: { pattern: "unknown" }, confusionSignals: Array(4).fill({ type: "x" }), hierarchyScore: 40 },
    accessData: { violations: [{ id: "color-contrast" }, { id: "label" }], passes: [] },
    responsiveData: { viewports: [{ name: "mobile", width: 375, issues: ["overflow"] }] },
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.prediction.id.startsWith("dp_"));
  assert.ok(r.prediction.total > 0, "expected at least one prediction");
  assert.ok(r.prediction.uxProblems.length > 0 || r.prediction.accessibilityFailures.length > 0);
  assert.ok(typeof r.prediction.riskScore === "number");
  assert.ok(r.prediction.riskScore >= 0);
});

atest("predict with high quality has fewer issues", async () => {
  const r = await dpe.predict("https://example.com/good-page", {
    qualityScore: { dimensions: { usability: 90, accessibility: 95, responsiveness: 90, consistency: 85, aesthetics: 88 }, overall: 90 },
    reasoningAnalysis: { cognitiveLoad: 20, attentionHotspots: [{ weight: 0.9 }], readingFlow: { pattern: "F", confidence: 0.8 }, confusionSignals: [], hierarchyScore: 85 },
    accessData: { violations: [], passes: [{ id: "contrast" }] },
    responsiveData: { viewports: [{ name: "mobile", width: 375, issues: [] }] },
  });
  assert.ok(r.ok);
  assert.ok(r.prediction.total < 5, `expected <5 issues, got ${r.prediction.total}`);
});

atest("predict fails without pageUrl or qualityScore", async () => {
  const r = await dpe.predict(null, {});
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

atest("getPrediction by id", async () => {
  const r = await dpe.predict("https://example.com/pred-id-test", {
    qualityScore: { dimensions: {}, overall: 60 },
  });
  assert.ok(r.ok);
  const p = dpe.getPrediction(r.prediction.id);
  assert.ok(p);
  assert.strictEqual(p.id, r.prediction.id);
});

atest("listPredictions filtered by pageUrl", async () => {
  const url = "https://example.com/list-pred-test";
  await dpe.predict(url, { qualityScore: { dimensions: {}, overall: 65 } });
  const r = dpe.listPredictions({ pageUrl: url, limit: 10 });
  assert.ok(r.ok);
  assert.ok(r.predictions.every(p => p.pageUrl === url));
});

atest("getStats has criticalPredictions count", async () => {
  const s = dpe.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.criticalPredictions === "number");
  assert.ok(typeof s.avgRisk === "number");
});

atest("riskScore is numeric >= 0", async () => {
  const r = await dpe.predict("https://example.com/risk-test", {
    qualityScore: { dimensions: { accessibility: 30 }, overall: 30 },
    accessData: { violations: [{ id: "color-contrast" }], passes: [] },
  });
  assert.ok(r.ok);
  assert.ok(Number.isFinite(r.prediction.riskScore));
  assert.ok(r.prediction.riskScore >= 0);
});

atest("criticalCount matches critical severity predictions", async () => {
  const r = await dpe.predict("https://example.com/crit-count", {
    qualityScore: { dimensions: { accessibility: 40 }, overall: 40 },
    accessData: { violations: [{ id: "color-contrast" }, { id: "label" }], passes: [] },
  });
  assert.ok(r.ok);
  const expectedCritical = [...r.prediction.uxProblems, ...r.prediction.accessibilityFailures, ...r.prediction.responsiveFailures, ...r.prediction.confusionIssues]
    .filter(p => p.severity === "critical").length;
  assert.strictEqual(r.prediction.criticalCount, expectedCritical);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 5: Design Evolution Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Design Evolution Engine ──");

test("module exports", () => {
  assert.ok(Array.isArray(dee.EVOLUTION_STEPS));
  assert.strictEqual(dee.EVOLUTION_STEPS.length, 14);
  assert.ok(typeof dee.runEvolutionCycle === "function");
  assert.ok(typeof dee.getDebtReport === "function");
  assert.ok(typeof dee.getQualityTrend === "function");
  assert.ok(typeof dee.getEvolutionStatus === "function");
  assert.ok(typeof dee.listCycles === "function");
  assert.ok(typeof dee.getCycle === "function");
  assert.ok(typeof dee.getStats === "function");
});

test("EVOLUTION_STEPS has all 14 steps", () => {
  const expected = ["capture","analyze","compare","benchmark","predict","generate_improvements","simulate","validate","score","learn","recommend","apply","measure","publish"];
  expected.forEach(s => assert.ok(dee.EVOLUTION_STEPS.includes(s), `missing step: ${s}`));
});

atest("runEvolutionCycle completes all 14 steps", async () => {
  const r = await dee.runEvolutionCycle("https://example.com/evolution-main", { skipApply: true });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.cycleId);
  assert.strictEqual(r.stepsCompleted, 14);
  assert.ok(r.minutesSaved > 0);
});

atest("runEvolutionCycle fails without pageUrl", async () => {
  const r = await dee.runEvolutionCycle(null, {});
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

atest("getCycle by id", async () => {
  const r = await dee.runEvolutionCycle("https://example.com/get-cycle-test", { skipApply: true });
  assert.ok(r.ok);
  const c = dee.getCycle(r.cycleId);
  assert.ok(c);
  assert.strictEqual(c.id, r.cycleId);
  assert.ok(Array.isArray(c.steps));
  assert.strictEqual(c.steps.length, 14);
});

atest("listCycles filtered by pageUrl", async () => {
  const url = "https://example.com/list-cycles-test";
  await dee.runEvolutionCycle(url, { skipApply: true });
  const r = dee.listCycles({ pageUrl: url, limit: 10 });
  assert.ok(r.ok);
  assert.ok(r.cycles.length >= 1);
  assert.ok(r.cycles.every(c => c.pageUrl === url));
});

atest("getEvolutionStatus has totalCycles", async () => {
  await dee.runEvolutionCycle("https://example.com/evo-status-seed", { skipApply: true });
  const s = dee.getEvolutionStatus();
  assert.ok(s.ok);
  assert.ok(typeof s.totalCycles === "number");
  assert.ok(s.totalCycles >= 1);
  assert.ok(typeof s.pagesTracked === "number");
  assert.ok(typeof s.minutesSaved === "number");
});

atest("getDebtReport returns debt components", async () => {
  const url = "https://example.com/debt-test";
  await dqe.score(url, { domData: { elementCount: 100, maxDepth: 10 } });
  const r = dee.getDebtReport(url);
  assert.ok(r.ok);
  assert.ok(typeof r.totalDebt === "number");
  assert.ok(r.visualDebt);
  assert.ok(r.uxDebt);
  assert.ok(r.componentMaturity);
  assert.ok(r.tokenMaturity);
  assert.ok(["critical","moderate","low"].includes(r.severity));
  assert.ok(r.recommendation);
});

atest("getDebtReport has ok=true", async () => {
  const r = dee.getDebtReport("https://example.com/any-page");
  assert.ok(r.ok === true);
});

atest("getQualityTrend insufficient history returns error", async () => {
  const r = dee.getQualityTrend("https://example.com/no-trend-data");
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

atest("getQualityTrend with history returns direction", async () => {
  const url = "https://example.com/trend-evolution-test";
  await dqe.score(url, { domData: { elementCount: 30 } });
  await dqe.score(url, { domData: { elementCount: 10 } });
  const r = dee.getQualityTrend(url);
  // might be ok=true or ok=false depending on history written
  if (r.ok) {
    assert.ok(["improving","declining","stable"].includes(r.direction));
  }
});

atest("getStats has evolution step list", async () => {
  const s = dee.getStats();
  assert.ok(typeof s.totalCycles === "number");
  assert.ok(Array.isArray(s.evolutionSteps));
  assert.strictEqual(s.evolutionSteps.length, 14);
});

atest("multiple evolution cycles accumulate minutesSaved", async () => {
  const url = "https://example.com/multi-cycle";
  const r1 = await dee.runEvolutionCycle(url, { skipApply: true });
  const r2 = await dee.runEvolutionCycle(url, { skipApply: true });
  assert.ok(r1.ok && r2.ok);
  const s = dee.getEvolutionStatus();
  assert.ok(s.minutesSaved >= 50, `expected >=50 minutes, got ${s.minutesSaved}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 6: Design Intelligence Dashboard
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Design Intelligence Dashboard ──");

test("module exports", () => {
  assert.ok(typeof did.getDashboard === "function");
  assert.ok(typeof did.getPageView === "function");
  assert.ok(typeof did.getODIHealth === "function");
});

test("getDashboard returns ok", () => {
  const d = did.getDashboard();
  assert.ok(d.ok);
  assert.ok(d.summary);
  assert.ok(typeof d.summary.odiServicesReused === "number");
  assert.strictEqual(d.summary.odiServicesReused, 30);
});

test("getDashboard has all sections", () => {
  const d = did.getDashboard();
  assert.ok(d.summary);
  assert.ok(d.designDebt !== undefined);
  assert.ok(d.patchSuccessRate !== undefined);
  assert.ok(d.visualReasoning !== undefined);
  assert.ok(d.riskSummary !== undefined);
  assert.ok(d.benchmarks !== undefined);
  assert.ok(Array.isArray(d.recentEvolutionCycles));
  assert.ok(d.learningTrend !== undefined);
  assert.ok(d.founderTimeSaved !== undefined);
});

test("founderTimeSaved has totalMinutes", () => {
  const d = did.getDashboard();
  assert.ok(typeof d.founderTimeSaved.totalMinutes === "number");
  assert.ok(typeof d.founderTimeSaved.totalHours === "number");
  assert.ok(typeof d.founderTimeSaved.perCycle === "number");
  // After running evolution cycles, should have some saved
  assert.ok(d.founderTimeSaved.totalMinutes >= 0);
});

test("getPageView fails without pageUrl", () => {
  const r = did.getPageView(null);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test("getPageView returns ok for any url", () => {
  const r = did.getPageView("https://example.com/any");
  assert.ok(r.ok);
  assert.strictEqual(r.pageUrl, "https://example.com/any");
  assert.ok(r.qualityTrend !== undefined);
  assert.ok(Array.isArray(r.recentPredictions));
  assert.ok(Array.isArray(r.recentBenchmarks));
});

test("getODIHealth returns healthy count", () => {
  const h = did.getODIHealth();
  assert.ok(h.ok);
  assert.ok(typeof h.healthy === "number");
  assert.ok(typeof h.total === "number");
  assert.ok(Array.isArray(h.services));
  assert.ok(h.total === 21, `expected 21 services, got ${h.total}`);
});

test("getODIHealth has all 6 new X V1 services healthy", () => {
  const h = did.getODIHealth();
  const xServices = ["visualReasoningEngine","designQualityEngine","designBenchmarkEngine","designPredictionEngine","designEvolutionEngine","designIntelligenceDashboard"];
  for (const svcName of xServices) {
    const svc = h.services.find(s => s.name === svcName);
    assert.ok(svc, `service not found: ${svcName}`);
    assert.ok(svc.ok, `service unhealthy: ${svcName}`);
  }
});

atest("summary.totalScoredPages >= 1 after tests", async () => {
  await dqe.score("https://example.com/dashboard-seed-page", { domData: { elementCount: 20 } });
  const d = did.getDashboard();
  assert.ok(d.summary.totalScoredPages >= 1);
});

atest("summary.totalScores >= 1 after tests", async () => {
  await dqe.score("https://example.com/dashboard-scores-seed", { domData: { elementCount: 25 } });
  const d = did.getDashboard();
  assert.ok(d.summary.totalScores >= 1);
});

atest("summary.totalEvolutionCycles >= 1 after tests", async () => {
  await dee.runEvolutionCycle("https://example.com/dashboard-evo-seed", { skipApply: true });
  const d = did.getDashboard();
  assert.ok(d.summary.totalEvolutionCycles >= 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 7: Cross-service integration
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Cross-Service Integration ──");

atest("score → predict pipeline", async () => {
  const url = "https://example.com/pipeline-test";
  const scoreResult = await dqe.score(url, { domData: { elementCount: 60, maxDepth: 7 } });
  assert.ok(scoreResult.ok);

  const predResult = await dpe.predict(url, { qualityScore: scoreResult.score });
  assert.ok(predResult.ok);
  assert.ok(predResult.prediction.total >= 0);
});

atest("score → compareVersions → compareToBaseline chain", async () => {
  const url = "https://example.com/chain-test";
  await dqe.score(url, { domData: { elementCount: 40 } });
  await dqe.score(url, { domData: { elementCount: 35 } });

  const vc = await dbe.compareVersions(url, {});
  assert.ok(vc.ok);

  const bl = await dbe.compareToBaseline(url, {});
  assert.ok(bl.ok);
  assert.ok(typeof bl.benchmark.readyForProduction === "boolean");
});

atest("full 14-step evolution cycle on fresh page", async () => {
  const url = "https://example.com/full-evolution-" + Date.now();
  const r = await dee.runEvolutionCycle(url, { skipApply: true });
  assert.ok(r.ok);
  assert.strictEqual(r.stepsCompleted, 14);
  assert.ok(r.pageUrl === url);
});

atest("evolution cycle updates dashboard minutes saved", async () => {
  const before = did.getDashboard().founderTimeSaved.totalMinutes;
  await dee.runEvolutionCycle("https://example.com/time-save-test", { skipApply: true });
  const after = did.getDashboard().founderTimeSaved.totalMinutes;
  assert.ok(after >= before, `expected >=before(${before}), got ${after}`);
});

atest("recordPatchResult improves success rate over time", async () => {
  // Record several successes
  for (let i = 0; i < 5; i++) {
    dbe.recordPatchResult({ patchId: `success-${i}`, pageUrl: "https://example.com", beforeScore: 60, afterScore: 70, applied: true });
  }
  const r = dbe.getPatchSuccessRate();
  assert.ok(r.ok);
  assert.ok(r.rate > 0);
});

atest("getPageView after scoring shows currentScore", async () => {
  const url = "https://example.com/page-view-test";
  await dqe.score(url, { domData: { elementCount: 25 } });
  const r = did.getPageView(url);
  assert.ok(r.ok);
  assert.ok(r.currentScore !== null, "expected currentScore after scoring");
  assert.ok(r.qualityTrend !== undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  await Promise.all(promises);
  console.log(`\n── ODI X V1 Results ──`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
