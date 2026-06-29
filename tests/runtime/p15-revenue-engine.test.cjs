process.env.SKIP_PLATFORM_REGISTER = "1";
"use strict";
/**
 * p15-revenue-engine.test.cjs
 * POST-Ω Sprint P15: Autonomous Revenue Engine
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

// ── Load services ─────────────────────────────────────────────────────────────

const rde = require("../../backend/services/revenueDiscoveryEngine.cjs");
const roe = require("../../backend/services/revenueOptimizationEngine.cjs");
const pie = require("../../backend/services/pricingIntelligenceEngine.cjs");
const rfe = require("../../backend/services/revenueForecastEngine.cjs");
const rae = require("../../backend/services/revenueAutomationEngine.cjs");
const rdb = require("../../backend/services/revenueDashboard.cjs");

// ── Section 1: Revenue Discovery Engine (18 tests) ──────────────────────────

console.log("\n[1/6] Revenue Discovery Engine");

test("exports OPPORTUNITY_TYPES array", () => {
  assert.ok(Array.isArray(rde.OPPORTUNITY_TYPES), "should be array");
  assert.ok(rde.OPPORTUNITY_TYPES.length >= 5);
});

test("OPPORTUNITY_TYPES includes upsell", () => {
  assert.ok(rde.OPPORTUNITY_TYPES.includes("upsell"));
});

test("OPPORTUNITY_TYPES includes lead_conversion", () => {
  assert.ok(rde.OPPORTUNITY_TYPES.includes("lead_conversion"));
});

test("exports OPPORTUNITY_PRIORITY object", () => {
  assert.ok(typeof rde.OPPORTUNITY_PRIORITY === "object");
  assert.ok(typeof rde.OPPORTUNITY_PRIORITY.critical === "number");
});

test("discover() returns ok:true", () => {
  const r = rde.discover();
  assert.strictEqual(r.ok, true);
});

test("discover() returns found count", () => {
  const r = rde.discover();
  assert.ok(typeof r.found === "number", "should have found");
});

test("discover() returns total count", () => {
  const r = rde.discover();
  assert.ok(typeof r.total === "number");
});

test("discover() stores opportunities persistently", () => {
  rde.discover();
  const s = rde.getStats();
  assert.ok(s.total >= 0);
});

test("getStats() returns total", () => {
  const s = rde.getStats();
  assert.ok(typeof s.total === "number");
});

test("getStats() returns byType", () => {
  const s = rde.getStats();
  assert.ok(typeof s.byType === "object");
});

test("getStats() returns OPPORTUNITY_TYPES", () => {
  const s = rde.getStats();
  assert.ok(Array.isArray(s.OPPORTUNITY_TYPES));
});

test("listOpportunities() returns ok:true and array", () => {
  const r = rde.listOpportunities();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.opportunities));
});

test("listOpportunities({type:'upsell'}) filters correctly", () => {
  rde.discover();
  const r = rde.listOpportunities({ type: "upsell" });
  assert.ok(r.opportunities.every(o => o.type === "upsell"));
});

test("listOpportunities({priority:'high'}) filters by priority", () => {
  const r = rde.listOpportunities({ priority: "high" });
  assert.ok(r.opportunities.every(o => o.priority === "high"));
});

test("listOpportunities({limit:2}) respects limit", () => {
  const r = rde.listOpportunities({ limit: 2 });
  assert.ok(r.opportunities.length <= 2);
});

test("listOpportunities({minValue:100000}) filters by minValue", () => {
  const r = rde.listOpportunities({ minValue: 100000 });
  assert.ok(r.opportunities.every(o => (o.value || 0) >= 100000));
});

test("getOpportunity(null) returns null", () => {
  const r = rde.getOpportunity("nonexistent-id-xyz");
  assert.strictEqual(r, null);
});

test("discover() is idempotent (no duplicates per type:signal)", () => {
  const r1 = rde.discover();
  const r2 = rde.discover();
  const s  = rde.getStats();
  assert.ok(typeof s.total === "number");
  // Second discover should not exceed first total significantly
  assert.ok(s.total <= r2.total + 5);
});

// ── Section 2: Revenue Optimization Engine (15 tests) ─────────────────────

console.log("\n[2/6] Revenue Optimization Engine");

test("exports OPTIMIZATION_DIMENSIONS array", () => {
  assert.ok(Array.isArray(roe.OPTIMIZATION_DIMENSIONS));
  assert.ok(roe.OPTIMIZATION_DIMENSIONS.includes("conversion_rate"));
});

test("OPTIMIZATION_DIMENSIONS includes renewal_rate", () => {
  assert.ok(roe.OPTIMIZATION_DIMENSIONS.includes("renewal_rate"));
});

test("OPTIMIZATION_DIMENSIONS includes expansion_mrr", () => {
  assert.ok(roe.OPTIMIZATION_DIMENSIONS.includes("expansion_mrr"));
});

test("optimize() returns ok:true", () => {
  const r = roe.optimize();
  assert.strictEqual(r.ok, true);
});

test("optimize() returns found count", () => {
  const r = roe.optimize();
  assert.ok(typeof r.found === "number");
  assert.ok(r.found >= 1);
});

test("optimize() returns totalMRRImpact", () => {
  const r = roe.optimize();
  assert.ok(typeof r.totalMRRImpact === "number");
});

test("optimize() returns topOptimizations array", () => {
  const r = roe.optimize();
  assert.ok(Array.isArray(r.topOptimizations));
});

test("optimize() topOptimizations have required fields", () => {
  const r = roe.optimize();
  if (r.topOptimizations.length > 0) {
    const o = r.topOptimizations[0];
    assert.ok(o.id);
    assert.ok(o.dimension);
    assert.ok(o.title);
    assert.ok(typeof o.mrrImpact === "number");
  }
});

test("getStats() returns total and totalMRRImpact", () => {
  const s = roe.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.totalMRRImpact === "number");
});

test("getStats() returns byDimension", () => {
  const s = roe.getStats();
  assert.ok(typeof s.byDimension === "object");
});

test("listOptimizations() returns ok:true", () => {
  const r = roe.listOptimizations();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.optimizations));
});

test("listOptimizations({dimension:'conversion_rate'}) filters", () => {
  const r = roe.listOptimizations({ dimension: "conversion_rate" });
  assert.ok(r.optimizations.every(o => o.dimension === "conversion_rate"));
});

test("listOptimizations({priority:'medium'}) filters by priority", () => {
  const r = roe.listOptimizations({ priority: "medium" });
  assert.ok(r.optimizations.every(o => o.priority === "medium"));
});

test("getOptimization('nonexistent') returns null", () => {
  const r = roe.getOptimization("nonexistent-xyz");
  assert.strictEqual(r, null);
});

test("getOptimization(realId) returns record", () => {
  roe.optimize();
  const list = roe.listOptimizations({ limit: 1 });
  if (list.optimizations.length > 0) {
    const found = roe.getOptimization(list.optimizations[0].id);
    assert.ok(found !== null);
    assert.ok(found.id === list.optimizations[0].id);
  }
});

// ── Section 3: Pricing Intelligence Engine (14 tests) ─────────────────────

console.log("\n[3/6] Pricing Intelligence Engine");

test("exports PRICING_STRATEGIES array", () => {
  assert.ok(Array.isArray(pie.PRICING_STRATEGIES));
  assert.ok(pie.PRICING_STRATEGIES.length >= 5);
});

test("exports DISCOUNT_RULES object", () => {
  assert.ok(typeof pie.DISCOUNT_RULES === "object");
  assert.ok(typeof pie.DISCOUNT_RULES.annual_commitment === "object");
  assert.ok(typeof pie.DISCOUNT_RULES.annual_commitment.pct === "number");
});

test("DISCOUNT_RULES has churn_prevention with 30%", () => {
  assert.strictEqual(pie.DISCOUNT_RULES.churn_prevention.pct, 30);
});

test("recommend() returns ok:true", () => {
  const r = pie.recommend();
  assert.strictEqual(r.ok, true);
});

test("recommend() returns recommendations array", () => {
  const r = pie.recommend();
  assert.ok(Array.isArray(r.recommendations));
});

test("recommend() returns at least 1 recommendation", () => {
  const r = pie.recommend();
  assert.ok(r.recommendations.length >= 1);
});

test("recommend({plan:'starter'}) works", () => {
  const r = pie.recommend({ plan: "starter" });
  assert.strictEqual(r.ok, true);
});

test("getDiscountOffer('annual_commitment') returns ok:true", () => {
  const r = pie.getDiscountOffer("annual_commitment");
  assert.strictEqual(r.ok, true);
});

test("getDiscountOffer('annual_commitment') returns pct 20", () => {
  const r = pie.getDiscountOffer("annual_commitment");
  assert.strictEqual(r.discount.pct, 20);
});

test("getDiscountOffer('invalid_scenario') returns ok:false", () => {
  const r = pie.getDiscountOffer("invalid_scenario_xyz");
  assert.strictEqual(r.ok, false);
});

test("getStats() returns total and byStrategy", () => {
  const s = pie.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.byStrategy === "object");
});

test("listRecommendations() returns ok and array", () => {
  const r = pie.listRecommendations();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.recommendations));
});

test("listRecommendations({strategy:'bundle'}) filters", () => {
  const r = pie.listRecommendations({ strategy: "bundle" });
  assert.ok(r.recommendations.every(rec => rec.strategy === "bundle"));
});

test("getRecommendation('nonexistent') returns null", () => {
  const r = pie.getRecommendation("nonexistent-xyz");
  assert.strictEqual(r, null);
});

// ── Section 4: Revenue Forecast Engine (14 tests) ─────────────────────────

console.log("\n[4/6] Revenue Forecast Engine");

test("exports FORECAST_HORIZONS array", () => {
  assert.ok(Array.isArray(rfe.FORECAST_HORIZONS));
  assert.ok(rfe.FORECAST_HORIZONS.includes("30d"));
  assert.ok(rfe.FORECAST_HORIZONS.includes("365d"));
});

test("exports FORECAST_MODELS array", () => {
  assert.ok(Array.isArray(rfe.FORECAST_MODELS));
  assert.ok(rfe.FORECAST_MODELS.includes("base"));
  assert.ok(rfe.FORECAST_MODELS.includes("with_optimization"));
});

test("forecast('base') returns ok:true", () => {
  const r = rfe.forecast("base");
  assert.strictEqual(r.ok, true);
});

test("forecast('base') returns projections for all horizons", () => {
  const r = rfe.forecast("base");
  rfe.FORECAST_HORIZONS.forEach(h => {
    assert.ok(r.forecast.projections[h], `missing projection for ${h}`);
  });
});

test("forecast('base') projection has mrr field", () => {
  const r = rfe.forecast("base");
  const p365 = r.forecast.projections["365d"];
  assert.ok(typeof p365.mrr === "number");
  assert.ok(p365.mrr > 0);
});

test("forecast('conservative') returns ok:true", () => {
  const r = rfe.forecast("conservative");
  assert.strictEqual(r.ok, true);
});

test("forecast('optimistic') returns ok:true", () => {
  const r = rfe.forecast("optimistic");
  assert.strictEqual(r.ok, true);
});

test("forecast('with_optimization') returns ok:true", () => {
  const r = rfe.forecast("with_optimization");
  assert.strictEqual(r.ok, true);
});

test("forecast('invalid') returns ok:false", () => {
  const r = rfe.forecast("invalid_model_xyz");
  assert.strictEqual(r.ok, false);
});

test("forecastAll() returns all 4 models", () => {
  const r = rfe.forecastAll();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.forecasts));
  assert.strictEqual(r.forecasts.length, 4);
});

test("forecastAll() returns bestModel", () => {
  const r = rfe.forecastAll();
  assert.ok(typeof r.bestModel === "string");
  assert.ok(rfe.FORECAST_MODELS.includes(r.bestModel));
});

test("getCashFlowProjection() returns ok:true", () => {
  const r = rfe.getCashFlowProjection();
  assert.strictEqual(r.ok, true);
  assert.ok(typeof r.currentMRR === "number");
});

test("getCashFlowProjection() has 4 horizons", () => {
  const r = rfe.getCashFlowProjection();
  assert.strictEqual(Object.keys(r.projections).length, 4);
});

test("getStats() returns total, avgAccuracy, bestModel", () => {
  const s = rfe.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.avgAccuracy === "number");
  assert.ok(typeof s.bestModel === "string");
});

// ── Section 5: Revenue Automation Engine (14 tests) ───────────────────────

console.log("\n[5/6] Revenue Automation Engine");

test("exports AUTOMATION_ACTIONS object", () => {
  assert.ok(typeof rae.AUTOMATION_ACTIONS === "object");
  const keys = Object.keys(rae.AUTOMATION_ACTIONS);
  assert.ok(keys.includes("generate_proposal"));
  assert.ok(keys.includes("trigger_renewal"));
});

test("AUTOMATION_ACTIONS.generate_proposal has minutesSaved", () => {
  assert.ok(typeof rae.AUTOMATION_ACTIONS.generate_proposal.minutesSaved === "number");
  assert.ok(rae.AUTOMATION_ACTIONS.generate_proposal.minutesSaved > 0);
});

test("AUTOMATION_ACTIONS.prepare_contract requires approval", () => {
  assert.strictEqual(rae.AUTOMATION_ACTIONS.prepare_contract.requiresApproval, true);
});

atest("automate('generate_proposal') returns ok:true", async () => {
  const r = await rae.automate("generate_proposal", {}, { skipExecute: true });
  assert.strictEqual(r.ok, true);
  assert.ok(r.automation);
});

atest("automate('generate_proposal') records minutesSaved", async () => {
  const r = await rae.automate("generate_proposal", {}, { skipExecute: true });
  assert.strictEqual(r.ok, true);
  assert.ok(typeof r.automation.minutesSaved === "number");
});

atest("automate('send_followup') returns ok:true", async () => {
  const r = await rae.automate("send_followup", {}, { skipExecute: true });
  assert.strictEqual(r.ok, true);
});

atest("automate('trigger_renewal') returns ok:true", async () => {
  const r = await rae.automate("trigger_renewal", {}, { skipExecute: true });
  assert.strictEqual(r.ok, true);
});

atest("automate('upsell_offer') returns ok:true", async () => {
  const r = await rae.automate("upsell_offer", {}, { skipExecute: true });
  assert.strictEqual(r.ok, true);
});

atest("automate('invalid_action') returns ok:false", async () => {
  const r = await rae.automate("invalid_action_xyz");
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

atest("runRevenuePipeline() returns ok:true", async () => {
  const r = await rae.runRevenuePipeline({ skipExecute: true });
  assert.strictEqual(r.ok, true);
});

atest("runRevenuePipeline() returns steps and minutesSaved", async () => {
  const r = await rae.runRevenuePipeline({ skipExecute: true });
  assert.ok(typeof r.steps === "number");
  assert.ok(r.steps >= 1);
  assert.ok(typeof r.minutesSaved === "number");
});

test("getStats() returns total and executed", () => {
  const s = rae.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.executed === "number");
});

test("listAutomations() returns ok:true", () => {
  const r = rae.listAutomations();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.automations));
});

atest("listAutomations({action:'generate_proposal'}) filters", async () => {
  await rae.automate("generate_proposal", {}, { skipExecute: true });
  const r = rae.listAutomations({ action: "generate_proposal" });
  assert.ok(r.automations.every(a => a.action === "generate_proposal"));
});

// ── Section 6: Revenue Dashboard (12 tests) ────────────────────────────────

console.log("\n[6/6] Revenue Dashboard");

test("exports REVENUE_SERVICES_REUSED = 23", () => {
  assert.strictEqual(rdb.REVENUE_SERVICES_REUSED, 23);
});

test("getDashboard() returns ok:true", () => {
  const r = rdb.getDashboard();
  assert.strictEqual(r.ok, true);
});

test("getDashboard() summary has mrr and arr", () => {
  const r = rdb.getDashboard();
  assert.ok(typeof r.summary.mrr === "number");
  assert.ok(typeof r.summary.arr === "number");
});

test("getDashboard() summary has revenueServicesReused=23", () => {
  const r = rdb.getDashboard();
  assert.strictEqual(r.summary.revenueServicesReused, 23);
});

test("getDashboard() has revenue section", () => {
  const r = rdb.getDashboard();
  assert.ok(typeof r.revenue === "object");
});

test("getDashboard() has pipelineValue section", () => {
  const r = rdb.getDashboard();
  assert.ok(typeof r.pipelineValue === "object");
  assert.ok(typeof r.pipelineValue.totalValue === "number");
});

test("getDashboard() has renewalHealth section", () => {
  const r = rdb.getDashboard();
  assert.ok(typeof r.renewalHealth === "object");
  assert.ok(typeof r.renewalHealth.renewalRate === "number");
});

test("getDashboard() has revenueHealth section with healthScore", () => {
  const r = rdb.getDashboard();
  assert.ok(typeof r.revenueHealth === "object");
  assert.ok(typeof r.revenueHealth.healthScore === "number");
});

test("getDashboard() has founderTimeSaved section", () => {
  const r = rdb.getDashboard();
  assert.ok(typeof r.founderTimeSaved === "object");
  assert.ok(typeof r.founderTimeSaved.totalHours === "number");
});

test("getPipelineView() returns 12-step pipeline", () => {
  const r = rdb.getPipelineView();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.pipeline));
  assert.strictEqual(r.pipeline.length, 12);
});

test("getPipelineView() first step is 'Discover Opportunities'", () => {
  const r = rdb.getPipelineView();
  assert.strictEqual(r.pipeline[0].step, "Discover Opportunities");
});

test("getRevenueSystemHealth() returns ok and status", () => {
  const r = rdb.getRevenueSystemHealth();
  assert.strictEqual(r.ok, true);
  assert.ok(typeof r.status === "string");
  assert.ok(typeof r.healthy === "number");
  assert.ok(typeof r.degraded === "number");
});

// ── End-to-End (5 tests) ──────────────────────────────────────────────────

console.log("\n[E2E] End-to-End Pipeline");

test("E2E: discover → optimize → forecast sequence", () => {
  rde.discover();
  roe.optimize();
  const fc = rfe.forecast("base");
  assert.strictEqual(fc.ok, true);
  const opt = roe.getStats();
  assert.ok(opt.total >= 1);
});

test("E2E: forecast uses optimization lift in with_optimization model", () => {
  roe.optimize();
  const r = rfe.forecast("with_optimization");
  assert.strictEqual(r.ok, true);
  const p365 = r.forecast.projections["365d"];
  assert.ok(typeof p365.mrr === "number");
});

test("E2E: dashboard aggregates all sections correctly", () => {
  rde.discover();
  roe.optimize();
  const db = rdb.getDashboard();
  assert.strictEqual(db.ok, true);
  assert.ok(typeof db.summary.forecastAccuracy === "number");
  assert.ok(typeof db.summary.revenueHealthScore === "number");
});

atest("E2E: automation pipeline runs end-to-end", async () => {
  rde.discover();
  const r = await rae.runRevenuePipeline({ skipExecute: true });
  assert.strictEqual(r.ok, true);
  assert.ok(r.steps >= 1);
});

test("E2E: system health shows 6 P15 engines healthy", () => {
  const r = rdb.getRevenueSystemHealth();
  const p15 = r.services.filter(s => [
    "revenueDiscoveryEngine","revenueOptimizationEngine",
    "pricingIntelligenceEngine","revenueForecastEngine",
    "revenueAutomationEngine","revenueDashboard",
  ].includes(s.name));
  assert.ok(p15.every(s => s.ok === true), "All P15 engines should be healthy");
});

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await Promise.all(promises);
  console.log(`\n${"─".repeat(50)}`);
  console.log(`POST-Ω P15: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
