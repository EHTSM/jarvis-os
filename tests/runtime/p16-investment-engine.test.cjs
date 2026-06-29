process.env.SKIP_PLATFORM_REGISTER = "1";
"use strict";
/**
 * p16-investment-engine.test.cjs
 * POST-Ω Sprint P16: Autonomous Investment Engine
 * Target: 75+ tests
 */

const assert   = require("assert");
const promises = [];

let passed = 0;
let failed = 0;

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
    Promise.resolve().then(fn).then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    }).catch(e => {
      console.error(`  ✗ ${name}: ${e.message}`);
      failed++;
    })
  );
}

const cal = require("../../backend/services/capitalAllocationEngine.cjs");
const ian = require("../../backend/services/investmentAnalysisEngine.cjs");
const pfs = require("../../backend/services/portfolioStrategyEngine.cjs");
const rsk = require("../../backend/services/riskAssessmentEngine.cjs");
const iat = require("../../backend/services/investmentAutomationEngine.cjs");
const idb = require("../../backend/services/investmentDashboard.cjs");

// ── Section 1: Capital Allocation Engine (15 tests) ──────────────────────────

console.log("\n[1/6] Capital Allocation Engine");

test("exports BUDGET_CATEGORIES array", () => {
  assert.ok(Array.isArray(cal.BUDGET_CATEGORIES));
  assert.ok(cal.BUDGET_CATEGORIES.includes("engineering"));
  assert.ok(cal.BUDGET_CATEGORIES.includes("marketing"));
});

test("exports BASE_ALLOCATION object", () => {
  assert.ok(typeof cal.BASE_ALLOCATION === "object");
  assert.ok(typeof cal.BASE_ALLOCATION.engineering === "number");
});

test("BASE_ALLOCATION ratios sum to ~1.0", () => {
  const sum = Object.values(cal.BASE_ALLOCATION).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1.0) < 0.01, `Sum should be ~1.0, got ${sum}`);
});

test("allocate() returns ok:true", () => {
  const r = cal.allocate(100000);
  assert.strictEqual(r.ok, true);
});

test("allocate() returns allocation record", () => {
  const r = cal.allocate(100000);
  assert.ok(r.allocation);
  assert.ok(r.allocation.id);
});

test("allocate() breakdown has all categories", () => {
  const r = cal.allocate(100000);
  cal.BUDGET_CATEGORIES.forEach(cat => {
    assert.ok(r.allocation.breakdown[cat], `missing category: ${cat}`);
  });
});

test("allocate() breakdown amounts sum to totalBudget", () => {
  const r = cal.allocate(100000);
  const total = Object.values(r.allocation.breakdown).reduce((s, v) => s + (v.amount || 0), 0);
  assert.ok(Math.abs(total - 100000) <= 10, `Expected ~100000, got ${total}`);
});

test("allocate() stores current allocation", () => {
  cal.allocate(100000);
  const c = cal.getCurrentAllocation();
  assert.ok(c !== null);
  assert.ok(c.id);
});

test("getCurrentAllocation() returns most recent", () => {
  cal.allocate(200000);
  const c = cal.getCurrentAllocation();
  assert.strictEqual(c.totalBudget, 200000);
});

test("getAllocation(id) returns correct record", () => {
  const r = cal.allocate(50000);
  const found = cal.getAllocation(r.allocation.id);
  assert.ok(found !== null);
  assert.strictEqual(found.totalBudget, 50000);
});

test("getAllocation('nonexistent') returns null", () => {
  assert.strictEqual(cal.getAllocation("nonexistent-xyz"), null);
});

test("listAllocations() returns ok and array", () => {
  const r = cal.listAllocations();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.allocations));
});

test("listAllocations({limit:2}) respects limit", () => {
  const r = cal.listAllocations({ limit: 2 });
  assert.ok(r.allocations.length <= 2);
});

test("getStats() returns total and BUDGET_CATEGORIES", () => {
  const s = cal.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(Array.isArray(s.BUDGET_CATEGORIES));
});

test("getStats() totalBudgetAllocated is positive", () => {
  const s = cal.getStats();
  assert.ok(s.totalBudgetAllocated > 0);
});

// ── Section 2: Investment Analysis Engine (16 tests) ─────────────────────────

console.log("\n[2/6] Investment Analysis Engine");

test("exports ANALYSIS_TYPES array", () => {
  assert.ok(Array.isArray(ian.ANALYSIS_TYPES));
  assert.ok(ian.ANALYSIS_TYPES.includes("roi"));
  assert.ok(ian.ANALYSIS_TYPES.includes("ltv"));
  assert.ok(ian.ANALYSIS_TYPES.includes("cac"));
});

test("ANALYSIS_TYPES includes payback and cash_efficiency", () => {
  assert.ok(ian.ANALYSIS_TYPES.includes("payback"));
  assert.ok(ian.ANALYSIS_TYPES.includes("cash_efficiency"));
});

test("analyze() returns ok:true", () => {
  const r = ian.analyze();
  assert.strictEqual(r.ok, true);
});

test("analyze() returns found = 6", () => {
  const r = ian.analyze();
  assert.strictEqual(r.found, 6);
});

test("analyze() returns liveMetrics", () => {
  const r = ian.analyze();
  assert.ok(typeof r.liveMetrics === "object");
  assert.ok(typeof r.liveMetrics.mrr === "number");
});

test("analyze() liveMetrics.mrr = 999", () => {
  const r = ian.analyze();
  assert.strictEqual(r.liveMetrics.mrr, 999);
});

test("analyze() returns analyses array with 6 items", () => {
  const r = ian.analyze();
  assert.ok(Array.isArray(r.analyses));
  assert.strictEqual(r.analyses.length, 6);
});

test("roi analysis has value and interpretation", () => {
  const r = ian.analyze();
  const roi = r.analyses.find(a => a.type === "roi");
  assert.ok(roi, "roi analysis missing");
  assert.ok(typeof roi.value === "number");
  assert.ok(typeof roi.interpretation === "string");
});

test("cac analysis has estimatedCAC and benchmark", () => {
  const r = ian.analyze();
  const cac = r.analyses.find(a => a.type === "cac");
  assert.ok(cac, "cac analysis missing");
  assert.ok(typeof cac.value === "number");
  assert.ok(typeof cac.benchmark === "object");
});

test("ltv analysis has value and ltvCACRatio", () => {
  const r = ian.analyze();
  const ltv = r.analyses.find(a => a.type === "ltv");
  assert.ok(ltv, "ltv analysis missing");
  assert.ok(typeof ltv.value === "number");
  assert.ok(typeof ltv.current.ltvCACRatio === "number");
});

test("payback analysis value is in months", () => {
  const r = ian.analyze();
  const pb = r.analyses.find(a => a.type === "payback");
  assert.ok(pb, "payback analysis missing");
  assert.strictEqual(pb.unit, "months");
});

test("getAnalysis('nonexistent') returns null", () => {
  assert.strictEqual(ian.getAnalysis("nonexistent-xyz"), null);
});

test("getAnalysis(realId) returns record", () => {
  ian.analyze();
  const list = ian.listAnalyses({ limit: 1 });
  if (list.analyses.length > 0) {
    const found = ian.getAnalysis(list.analyses[0].id);
    assert.ok(found !== null);
  }
});

test("listAnalyses({type:'roi'}) filters", () => {
  const r = ian.listAnalyses({ type: "roi" });
  assert.ok(r.analyses.every(a => a.type === "roi"));
});

test("getStats() returns total and avgROI", () => {
  const s = ian.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.avgROI === "number");
});

test("getStats() includes byType and ANALYSIS_TYPES", () => {
  const s = ian.getStats();
  assert.ok(typeof s.byType === "object");
  assert.ok(Array.isArray(s.ANALYSIS_TYPES));
});

// ── Section 3: Portfolio Strategy Engine (14 tests) ──────────────────────────

console.log("\n[3/6] Portfolio Strategy Engine");

test("exports PORTFOLIO_DIMENSIONS array", () => {
  assert.ok(Array.isArray(pfs.PORTFOLIO_DIMENSIONS));
  assert.ok(pfs.PORTFOLIO_DIMENSIONS.includes("products"));
  assert.ok(pfs.PORTFOLIO_DIMENSIONS.includes("customers"));
  assert.ok(pfs.PORTFOLIO_DIMENSIONS.includes("ai_capabilities"));
});

test("exports STRATEGY_MODES array", () => {
  assert.ok(Array.isArray(pfs.STRATEGY_MODES));
  assert.ok(pfs.STRATEGY_MODES.includes("balanced"));
  assert.ok(pfs.STRATEGY_MODES.includes("growth"));
});

test("strategize('balanced') returns ok:true", () => {
  const r = pfs.strategize("balanced");
  assert.strictEqual(r.ok, true);
});

test("strategize() returns strategy with all dimensions", () => {
  const r = pfs.strategize("balanced", 100000);
  pfs.PORTFOLIO_DIMENSIONS.forEach(dim => {
    assert.ok(r.strategy.portfolio[dim], `missing dimension: ${dim}`);
  });
});

test("strategize() portfolio budgets sum to ~totalBudget", () => {
  const r = pfs.strategize("balanced", 100000);
  const total = Object.values(r.strategy.portfolio).reduce((s, v) => s + (v.budget || 0), 0);
  assert.ok(Math.abs(total - 100000) <= 500, `Expected ~100000, got ${total}`);
});

test("strategize('growth') allocates more to products", () => {
  const g = pfs.strategize("growth",   100000).strategy.portfolio;
  const b = pfs.strategize("balanced", 100000).strategy.portfolio;
  assert.ok(g.products.budget >= b.products.budget);
});

test("strategize('retention') allocates more to customers", () => {
  const r = pfs.strategize("retention", 100000).strategy;
  assert.ok(r.portfolio.customers.budget >= r.portfolio.products.budget);
});

test("strategize() returns overallScore 0-100", () => {
  const r = pfs.strategize("balanced");
  assert.ok(r.strategy.overallScore >= 0 && r.strategy.overallScore <= 100);
});

test("getCurrentStrategy() returns most recent", () => {
  pfs.strategize("growth", 200000);
  const s = pfs.getCurrentStrategy();
  assert.ok(s !== null);
  assert.strictEqual(s.mode, "growth");
});

test("getStrategy('nonexistent') returns null", () => {
  assert.strictEqual(pfs.getStrategy("nonexistent-xyz"), null);
});

test("listStrategies() returns ok and array", () => {
  const r = pfs.listStrategies();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.strategies));
});

test("listStrategies({mode:'growth'}) filters", () => {
  const r = pfs.listStrategies({ mode: "growth" });
  assert.ok(r.strategies.every(s => s.mode === "growth"));
});

test("getStats() returns total and byMode", () => {
  const s = pfs.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.byMode === "object");
});

test("getStats() includes PORTFOLIO_DIMENSIONS", () => {
  const s = pfs.getStats();
  assert.ok(Array.isArray(s.PORTFOLIO_DIMENSIONS));
});

// ── Section 4: Risk Assessment Engine (14 tests) ─────────────────────────────

console.log("\n[4/6] Risk Assessment Engine");

test("exports RISK_DIMENSIONS array", () => {
  assert.ok(Array.isArray(rsk.RISK_DIMENSIONS));
  assert.ok(rsk.RISK_DIMENSIONS.includes("execution"));
  assert.ok(rsk.RISK_DIMENSIONS.includes("financial"));
  assert.ok(rsk.RISK_DIMENSIONS.includes("strategic"));
});

test("exports RISK_LEVELS object", () => {
  assert.ok(typeof rsk.RISK_LEVELS === "object");
  assert.ok(typeof rsk.RISK_LEVELS.low === "number");
  assert.ok(rsk.RISK_LEVELS.critical > rsk.RISK_LEVELS.low);
});

test("assess() returns ok:true", () => {
  const r = rsk.assess();
  assert.strictEqual(r.ok, true);
});

test("assess() returns overallScore 0-100", () => {
  const r = rsk.assess();
  assert.ok(r.assessment.overallScore >= 0 && r.assessment.overallScore <= 100);
});

test("assess() returns overallLevel string", () => {
  const r = rsk.assess();
  assert.ok(["low","medium","high","critical"].includes(r.assessment.overallLevel));
});

test("assess() returns 5 dimension assessments", () => {
  const r = rsk.assess();
  assert.strictEqual(r.assessment.dimensions.length, 5);
});

test("each dimension has score, level, factors, mitigation", () => {
  const r = rsk.assess();
  r.assessment.dimensions.forEach(d => {
    assert.ok(typeof d.score === "number",     `${d.dimension} missing score`);
    assert.ok(typeof d.level === "string",     `${d.dimension} missing level`);
    assert.ok(Array.isArray(d.factors),        `${d.dimension} missing factors`);
    assert.ok(typeof d.mitigation === "string",`${d.dimension} missing mitigation`);
  });
});

test("assess() returns topRisk dimension name", () => {
  const r = rsk.assess();
  assert.ok(rsk.RISK_DIMENSIONS.includes(r.assessment.topRisk));
});

test("getCurrentAssessment() returns most recent", () => {
  rsk.assess();
  const a = rsk.getCurrentAssessment();
  assert.ok(a !== null);
  assert.ok(a.id);
});

test("getAssessment('nonexistent') returns null", () => {
  assert.strictEqual(rsk.getAssessment("nonexistent-xyz"), null);
});

test("listAssessments() returns ok and array", () => {
  const r = rsk.listAssessments();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.assessments));
});

test("listAssessments({level:'medium'}) filters", () => {
  const r = rsk.listAssessments({ level: "medium" });
  assert.ok(r.assessments.every(a => a.overallLevel === "medium"));
});

test("getStats() returns avgRiskScore", () => {
  const s = rsk.getStats();
  assert.ok(typeof s.avgRiskScore === "number");
});

test("getStats() returns RISK_DIMENSIONS", () => {
  const s = rsk.getStats();
  assert.ok(Array.isArray(s.RISK_DIMENSIONS));
});

// ── Section 5: Investment Automation Engine (14 tests) ───────────────────────

console.log("\n[5/6] Investment Automation Engine");

test("exports AUTOMATION_TYPES object", () => {
  assert.ok(typeof iat.AUTOMATION_TYPES === "object");
  assert.ok(iat.AUTOMATION_TYPES.reallocation);
  assert.ok(iat.AUTOMATION_TYPES.waste_detection);
  assert.ok(iat.AUTOMATION_TYPES.roi_ranking);
});

test("AUTOMATION_TYPES have minutesSaved", () => {
  Object.values(iat.AUTOMATION_TYPES).forEach(t => {
    assert.ok(typeof t.minutesSaved === "number" && t.minutesSaved > 0);
  });
});

atest("recommend('reallocation') returns ok:true", async () => {
  const r = await iat.recommend("reallocation");
  assert.strictEqual(r.ok, true);
  assert.ok(r.recommendation);
});

atest("recommend('waste_detection') returns ok:true", async () => {
  const r = await iat.recommend("waste_detection");
  assert.strictEqual(r.ok, true);
  assert.ok(r.recommendation.wasteItems !== undefined);
});

atest("recommend('underfunded_alert') returns ok:true", async () => {
  const r = await iat.recommend("underfunded_alert");
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.recommendation.underfunded));
});

atest("recommend('roi_ranking') returns ranked initiatives", async () => {
  const r = await iat.recommend("roi_ranking");
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.recommendation.initiatives));
  assert.ok(r.recommendation.initiatives.length > 0);
});

atest("recommend('risk_rebalance') returns ok:true", async () => {
  const r = await iat.recommend("risk_rebalance");
  assert.strictEqual(r.ok, true);
});

atest("recommend('investment_simulate') returns ok:true", async () => {
  const r = await iat.recommend("investment_simulate");
  assert.strictEqual(r.ok, true);
});

atest("recommend('invalid_type') returns ok:false", async () => {
  const r = await iat.recommend("invalid_type_xyz");
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

atest("runInvestmentPipeline() returns ok:true", async () => {
  const r = await iat.runInvestmentPipeline();
  assert.strictEqual(r.ok, true);
  assert.ok(typeof r.steps === "number");
  assert.ok(r.steps >= 4);
});

atest("runInvestmentPipeline() returns minutesSaved > 0", async () => {
  const r = await iat.runInvestmentPipeline();
  assert.ok(r.minutesSaved > 0);
});

test("getStats() returns total, executed, minutesSaved", () => {
  const s = iat.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.executed === "number");
  assert.ok(typeof s.minutesSaved === "number");
});

test("listRecommendations() returns ok and array", () => {
  const r = iat.listRecommendations();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.recommendations));
});

atest("listRecommendations({type:'roi_ranking'}) filters", async () => {
  await iat.recommend("roi_ranking");
  const r = iat.listRecommendations({ type: "roi_ranking" });
  assert.ok(r.recommendations.every(rec => rec.type === "roi_ranking"));
});

// ── Section 6: Investment Dashboard (12 tests) ───────────────────────────────

console.log("\n[6/6] Investment Dashboard");

test("exports INVESTMENT_SERVICES_REUSED = 24", () => {
  assert.strictEqual(idb.INVESTMENT_SERVICES_REUSED, 24);
});

test("getDashboard() returns ok:true", () => {
  const r = idb.getDashboard();
  assert.strictEqual(r.ok, true);
});

test("getDashboard() summary has investmentServicesReused=24", () => {
  const r = idb.getDashboard();
  assert.strictEqual(r.summary.investmentServicesReused, 24);
});

test("getDashboard() summary has avgROI and riskScore", () => {
  const r = idb.getDashboard();
  assert.ok(typeof r.summary.avgROI === "number");
  assert.ok(typeof r.summary.riskScore === "number");
});

test("getDashboard() has capitalAllocation section", () => {
  cal.allocate(100000);
  const r = idb.getDashboard();
  assert.ok(typeof r.capitalAllocation === "object");
});

test("getDashboard() has roiScore section", () => {
  ian.analyze();
  const r = idb.getDashboard();
  assert.ok(typeof r.roiScore === "object");
  assert.ok(typeof r.roiScore.avgROI === "number");
});

test("getDashboard() has riskScore section", () => {
  rsk.assess();
  const r = idb.getDashboard();
  assert.ok(typeof r.riskScore === "object");
});

test("getDashboard() has investmentHealth section with healthScore", () => {
  const r = idb.getDashboard();
  assert.ok(typeof r.investmentHealth === "object");
  assert.ok(typeof r.investmentHealth.healthScore === "number");
});

test("getDashboard() has founderTimeSaved section", () => {
  const r = idb.getDashboard();
  assert.ok(typeof r.founderTimeSaved === "object");
  assert.ok(typeof r.founderTimeSaved.totalHours === "number");
});

test("getPipelineView() returns 12-step pipeline", () => {
  const r = idb.getPipelineView();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.pipeline));
  assert.strictEqual(r.pipeline.length, 12);
});

test("getPipelineView() first step is 'Collect Metrics'", () => {
  const r = idb.getPipelineView();
  assert.strictEqual(r.pipeline[0].step, "Collect Metrics");
});

test("getInvestmentSystemHealth() returns ok and status", () => {
  const r = idb.getInvestmentSystemHealth();
  assert.strictEqual(r.ok, true);
  assert.ok(typeof r.status === "string");
  assert.ok(typeof r.healthy === "number");
});

// ── End-to-End (6 tests) ─────────────────────────────────────────────────────

console.log("\n[E2E] End-to-End Pipeline");

test("E2E: allocate → analyze → strategize → assess sequence", () => {
  cal.allocate(100000);
  ian.analyze();
  pfs.strategize("balanced", 100000);
  const r = rsk.assess();
  assert.strictEqual(r.ok, true);
});

atest("E2E: run full investment pipeline", async () => {
  const r = await iat.runInvestmentPipeline();
  assert.strictEqual(r.ok, true);
  assert.ok(r.minutesSaved >= 300); // sum of 4 automation actions
});

test("E2E: dashboard aggregates all sections", () => {
  const db = idb.getDashboard();
  assert.strictEqual(db.ok, true);
  assert.ok(typeof db.summary.totalBudget === "number");
  assert.ok(typeof db.summary.founderHoursSaved === "number");
});

test("E2E: portfolio budget respects totalBudget", () => {
  const r = pfs.strategize("efficiency", 500000);
  const total = Object.values(r.strategy.portfolio).reduce((s, v) => s + (v.budget || 0), 0);
  assert.ok(Math.abs(total - 500000) <= 2500, `Expected ~500000, got ${total}`);
});

test("E2E: all 6 P16 engines healthy", () => {
  const r = idb.getInvestmentSystemHealth();
  const p16 = r.services.filter(s => [
    "capitalAllocationEngine","investmentAnalysisEngine","portfolioStrategyEngine",
    "riskAssessmentEngine","investmentAutomationEngine","investmentDashboard",
  ].includes(s.name));
  assert.ok(p16.every(s => s.ok === true), "All P16 engines should be healthy");
});

atest("E2E: waste detection finds waste or returns empty list", async () => {
  const r = await iat.recommend("waste_detection");
  assert.strictEqual(r.ok, true);
  assert.ok(typeof r.recommendation.totalWaste === "number");
});

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await Promise.all(promises);
  console.log(`\n${"─".repeat(50)}`);
  console.log(`POST-Ω P16: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
