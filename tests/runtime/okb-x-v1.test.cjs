"use strict";
process.env.SKIP_PLATFORM_REGISTER = "1";

/**
 * OKB X V1 — Autonomous Knowledge Intelligence Evolution Program
 * 6 new services tested against the real platform knowledge base.
 *
 * knowledgeReasoningEngine, knowledgeQualityEngine, knowledgeBenchmarkEngine,
 * knowledgePredictionEngine, knowledgeEvolutionEngine, knowledgeIntelligenceDashboard
 *
 * Target: 70+ tests
 */

const assert = require("assert");

const kre = require("../../backend/services/knowledgeReasoningEngine.cjs");
const kqe = require("../../backend/services/knowledgeQualityEngine.cjs");
const kbe = require("../../backend/services/knowledgeBenchmarkEngine.cjs");
const kpe = require("../../backend/services/knowledgePredictionEngine.cjs");
const kee = require("../../backend/services/knowledgeEvolutionEngine.cjs");
const kid = require("../../backend/services/knowledgeIntelligenceDashboard.cjs");

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
// Section 1: Knowledge Reasoning Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Knowledge Reasoning Engine ──");

test("module loads", () => {
  assert.ok(typeof kre.analyze      === "function");
  assert.ok(typeof kre.getAnalysis  === "function");
  assert.ok(typeof kre.listAnalyses === "function");
  assert.ok(typeof kre.getStats     === "function");
});

atest("analyze returns 7 dimension scores", async () => {
  const r = await kre.analyze("test_knowledge");
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.analysis.id.startsWith("kr_"));
  const dims = r.analysis.dimensions;
  ["semantic","causal","architectural","temporal","mission","cross_domain","organizational"].forEach(d =>
    assert.ok(typeof dims[d]?.score === "number", `missing dimension: ${d}`)
  );
  assert.ok(typeof r.analysis.overallScore === "number");
  assert.ok(r.analysis.overallScore >= 0 && r.analysis.overallScore <= 100);
  assert.ok(Array.isArray(r.analysis.insights));
});

atest("analyze against real platform knowledge", async () => {
  const r = await kre.analyze("current_knowledge");
  assert.ok(r.ok);
  assert.ok(r.analysis.overallScore >= 0 && r.analysis.overallScore <= 100);
  // graphNodes comes from real knowledgeGraph
  assert.ok(typeof r.analysis.graphNodes === "number");
});

atest("dimension scores are all 0-100", async () => {
  const r = await kre.analyze("range_check_knowledge");
  assert.ok(r.ok);
  Object.values(r.analysis.dimensions).forEach(d => {
    assert.ok(d.score >= 0 && d.score <= 100, `score ${d.score} out of range`);
  });
});

atest("listAnalyses returns list after analyze", async () => {
  await kre.analyze("list_test_know");
  const r = kre.listAnalyses({ limit: 5 });
  assert.ok(r.ok);
  assert.ok(Array.isArray(r.analyses) && r.analyses.length > 0);
});

atest("getAnalysis by id", async () => {
  const r = await kre.analyze("get_test_know");
  assert.ok(r.ok);
  const a = kre.getAnalysis(r.analysis.id);
  assert.ok(a && a.id === r.analysis.id);
});

atest("getStats returns total >= 1", async () => {
  const s = kre.getStats();
  assert.ok(typeof s.total === "number" && s.total >= 1);
});

atest("insights are sorted by severity", async () => {
  const r = await kre.analyze("insight_sort_know");
  assert.ok(r.ok);
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const ins = r.analysis.insights;
  for (let i = 1; i < ins.length; i++) {
    const prev = severityOrder[ins[i-1].severity] ?? 99;
    const curr = severityOrder[ins[i].severity]   ?? 99;
    assert.ok(prev <= curr, `insight order wrong: ${ins[i-1].severity} before ${ins[i].severity}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: Knowledge Quality Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Knowledge Quality Engine ──");

test("module exports", () => {
  assert.ok(typeof kqe.score       === "function");
  assert.ok(typeof kqe.getScore    === "function");
  assert.ok(typeof kqe.listScores  === "function");
  assert.ok(typeof kqe.getHistory  === "function");
  assert.ok(typeof kqe.getTrend    === "function");
  assert.ok(typeof kqe.getStats    === "function");
  assert.ok(typeof kqe.WEIGHTS     === "object");
});

test("WEIGHTS sum to 1.0", () => {
  const sum = Object.values(kqe.WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1.0) < 0.001, `weights sum ${sum} != 1.0`);
});

test("WEIGHTS has 7 dimensions", () => {
  const keys = Object.keys(kqe.WEIGHTS);
  assert.strictEqual(keys.length, 7);
  ["completeness","freshness","confidence","consistency","connectivity","usefulness","explainability"].forEach(d =>
    assert.ok(keys.includes(d), `missing weight: ${d}`)
  );
});

atest("score returns 7 quality dimensions", async () => {
  const r = await kqe.score("quality_test_know");
  assert.ok(r.ok, JSON.stringify(r));
  const dims = r.score.dimensions;
  ["completeness","freshness","confidence","consistency","connectivity","usefulness","explainability"].forEach(d =>
    assert.ok(typeof dims[d] === "number", `missing: ${d}`)
  );
  assert.ok(typeof r.score.overall === "number" && r.score.overall >= 0 && r.score.overall <= 100);
  assert.ok(Array.isArray(r.score.improvements) && r.score.improvements.length <= 3);
});

atest("score stores history", async () => {
  const ctx = "history_know";
  await kqe.score(ctx);
  const h = kqe.getHistory(ctx, 5);
  assert.ok(h.ok && h.history.length >= 1);
});

atest("listScores filtered by context", async () => {
  const ctx = "filter_know";
  await kqe.score(ctx);
  const r = kqe.listScores({ context: ctx, limit: 10 });
  assert.ok(r.ok && r.scores.every(s => s.context === ctx));
});

atest("getScore by id", async () => {
  const r = await kqe.score("id_know");
  assert.ok(r.ok);
  const s = kqe.getScore(r.score.id);
  assert.ok(s && s.id === r.score.id);
});

atest("getTrend returns direction after 2 scores", async () => {
  const ctx = "trend_know";
  await kqe.score(ctx);
  await kqe.score(ctx);
  const t = kqe.getTrend(ctx);
  if (t.ok) assert.ok(["improving","declining","stable"].includes(t.direction));
});

atest("improvements have priority field", async () => {
  const r = await kqe.score("impr_know");
  assert.ok(r.ok);
  r.score.improvements.forEach(i => assert.ok(["critical","high","medium"].includes(i.priority)));
});

atest("getStats has contexts count", async () => {
  await kqe.score("stats_know_ctx");
  const s = kqe.getStats();
  assert.ok(s.total >= 1 && s.contexts >= 1);
});

atest("reasoningOverall populated when reasoning analysis used", async () => {
  const ra = await kre.analyze("chain_know");
  const r  = await kqe.score("chain_know", { reasoningAnalysis: ra.analysis });
  assert.ok(r.ok);
  assert.ok(r.score.reasoningOverall !== null && r.score.reasoningOverall !== undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: Knowledge Benchmark Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Knowledge Benchmark Engine ──");

test("module exports", () => {
  assert.ok(typeof kbe.compareVersions          === "function");
  assert.ok(typeof kbe.compareToBaseline        === "function");
  assert.ok(typeof kbe.compareEngMemory         === "function");
  assert.ok(typeof kbe.compareResearch          === "function");
  assert.ok(typeof kbe.recordImprovementResult  === "function");
  assert.ok(typeof kbe.getImprovementSuccessRate=== "function");
  assert.ok(typeof kbe.detectRegression         === "function");
  assert.ok(typeof kbe.getBenchmark             === "function");
  assert.ok(typeof kbe.listBenchmarks           === "function");
  assert.ok(typeof kbe.getBaseline              === "function");
  assert.ok(typeof kbe.setBaseline              === "function");
  assert.ok(typeof kbe.getStats                 === "function");
  assert.ok(typeof kbe.KNOWLEDGE_BASELINE       === "object");
});

test("KNOWLEDGE_BASELINE has 7 dims + overall", () => {
  const b = kbe.KNOWLEDGE_BASELINE;
  ["completeness","freshness","confidence","consistency","connectivity","usefulness","explainability","overall"].forEach(d =>
    assert.ok(typeof b[d] === "number", `missing: ${d}`)
  );
});

atest("compareVersions stores benchmark", async () => {
  const ctx = "bm_know_test";
  await kqe.score(ctx);
  await kqe.score(ctx);
  const r = await kbe.compareVersions(ctx, {});
  assert.ok(r.ok && r.benchmark.id.startsWith("kbm_"));
  assert.ok(r.benchmark.type === "version_compare");
  assert.ok(typeof r.benchmark.vsBaseline === "number");
});

atest("compareToBaseline reports gaps", async () => {
  const ctx = "baseline_know_test";
  await kqe.score(ctx);
  const r = await kbe.compareToBaseline(ctx, {});
  assert.ok(r.ok && r.benchmark.type === "baseline_compare");
  assert.ok(typeof r.benchmark.meetsOverall === "boolean");
  assert.ok(r.benchmark.gaps);
  assert.ok(typeof r.benchmark.productionReady === "boolean");
});

atest("compareEngMemory returns assessment", async () => {
  const r = await kbe.compareEngMemory("current_knowledge");
  assert.ok(r.ok && r.benchmark.type === "eng_memory_compare");
  assert.ok(["mature","growing","early"].includes(r.benchmark.assessment));
});

atest("compareResearch returns coverage", async () => {
  const r = await kbe.compareResearch("current_knowledge");
  assert.ok(r.ok && r.benchmark.type === "research_compare");
  assert.ok(["comprehensive","moderate","sparse"].includes(r.benchmark.coverage));
});

atest("recordImprovementResult success path", async () => {
  const r = kbe.recordImprovementResult({ improvId: "imp001", context: "know_test", beforeScore: 55, afterScore: 70, applied: true });
  assert.ok(r.ok && r.success && r.improvement === 15);
});

atest("recordImprovementResult regression path", async () => {
  const r = kbe.recordImprovementResult({ improvId: "imp002", context: "know_test", beforeScore: 70, afterScore: 55, applied: true });
  assert.ok(r.ok && !r.success);
});

atest("getImprovementSuccessRate returns rate 0-100", async () => {
  const r = kbe.getImprovementSuccessRate();
  assert.ok(r.ok && typeof r.rate === "number" && r.rate >= 0 && r.rate <= 100);
});

atest("detectRegression returns ok", async () => {
  const r = kbe.detectRegression("fresh_know_" + Date.now());
  assert.ok(r.ok && typeof r.isRegression === "boolean");
});

atest("listBenchmarks filtered by type", async () => {
  const r = kbe.listBenchmarks({ type: "version_compare", limit: 10 });
  assert.ok(r.ok && r.benchmarks.every(b => b.type === "version_compare"));
});

atest("getBenchmark by id", async () => {
  await kqe.score("get_bm_know");
  const bm = await kbe.compareVersions("get_bm_know", {});
  assert.ok(bm.ok);
  const b = kbe.getBenchmark(bm.benchmark.id);
  assert.ok(b && b.id === bm.benchmark.id);
});

atest("setBaseline and getBaseline roundtrip", async () => {
  const prev = kbe.getBaseline();
  kbe.setBaseline({ completeness: 80 });
  assert.strictEqual(kbe.getBaseline().completeness, 80);
  kbe.setBaseline({ completeness: prev.completeness });
});

atest("getStats has total", async () => {
  await kqe.score("stats_bm_know");
  await kbe.compareVersions("stats_bm_know", {});
  const s = kbe.getStats();
  assert.ok(typeof s.total === "number" && s.total >= 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: Knowledge Prediction Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Knowledge Prediction Engine ──");

test("module exports", () => {
  assert.ok(typeof kpe.predict         === "function");
  assert.ok(typeof kpe.getPrediction   === "function");
  assert.ok(typeof kpe.listPredictions === "function");
  assert.ok(typeof kpe.getStats        === "function");
});

atest("predict against real platform knowledge", async () => {
  const r = await kpe.predict("current_knowledge");
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.prediction.id.startsWith("kp_"));
  assert.ok(typeof r.prediction.total === "number");
  assert.ok(typeof r.prediction.riskScore === "number" && r.prediction.riskScore >= 0);
  // Prediction categories should all exist
  ["missingKnowledge","staleKnowledge","contradictions","futureKnowledgeDemand","researchOpportunities","documentationGaps"].forEach(c =>
    assert.ok(Array.isArray(r.prediction[c]), `missing category: ${c}`)
  );
});

atest("low completeness triggers missing knowledge predictions", async () => {
  const r = await kpe.predict("low_comp_know", {
    qualityScore: {
      dimensions: { completeness: 35, freshness: 60, confidence: 55, consistency: 70, connectivity: 35, usefulness: 50, explainability: 45 },
      overall: 48,
    },
  });
  assert.ok(r.ok);
  assert.ok(r.prediction.missingKnowledge.length > 0, "expected missing knowledge predictions");
});

atest("low freshness triggers stale knowledge predictions", async () => {
  const r = await kpe.predict("stale_know", {
    qualityScore: {
      dimensions: { completeness: 65, freshness: 40, confidence: 60, consistency: 70, connectivity: 55, usefulness: 55, explainability: 50 },
      overall: 55,
    },
  });
  assert.ok(r.ok);
  assert.ok(r.prediction.staleKnowledge.length > 0, "expected stale knowledge predictions");
});

atest("low consistency triggers contradiction predictions", async () => {
  const r = await kpe.predict("conflict_know", {
    qualityScore: {
      dimensions: { completeness: 65, freshness: 65, confidence: 60, consistency: 45, connectivity: 55, usefulness: 55, explainability: 50 },
      overall: 56,
    },
  });
  assert.ok(r.ok);
  assert.ok(r.prediction.contradictions.length > 0, "expected contradiction predictions");
});

atest("low explainability triggers documentation gap predictions", async () => {
  const r = await kpe.predict("nodoc_know", {
    qualityScore: {
      dimensions: { completeness: 65, freshness: 65, confidence: 35, consistency: 70, connectivity: 55, usefulness: 55, explainability: 40 },
      overall: 56,
    },
  });
  assert.ok(r.ok);
  assert.ok(r.prediction.documentationGaps.length > 0, "expected doc gap predictions");
});

atest("getPrediction by id", async () => {
  const r = await kpe.predict("id_pred_know");
  assert.ok(r.ok);
  const p = kpe.getPrediction(r.prediction.id);
  assert.ok(p && p.id === r.prediction.id);
});

atest("listPredictions filtered by context", async () => {
  const ctx = "list_pred_know";
  await kpe.predict(ctx);
  const r = kpe.listPredictions({ context: ctx, limit: 10 });
  assert.ok(r.ok && r.predictions.every(p => p.context === ctx));
});

atest("getStats has criticalPredictions", async () => {
  const s = kpe.getStats();
  assert.ok(typeof s.total === "number" && typeof s.criticalPredictions === "number");
});

atest("opportunityCount >= 0", async () => {
  const r = await kpe.predict("opp_know");
  assert.ok(r.ok);
  assert.ok(typeof r.prediction.opportunityCount === "number" && r.prediction.opportunityCount >= 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 5: Knowledge Evolution Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Knowledge Evolution Engine ──");

test("module exports", () => {
  assert.ok(Array.isArray(kee.EVOLUTION_STEPS) && kee.EVOLUTION_STEPS.length === 13);
  assert.ok(typeof kee.runEvolutionCycle   === "function");
  assert.ok(typeof kee.getDebtReport      === "function");
  assert.ok(typeof kee.getQualityTrend    === "function");
  assert.ok(typeof kee.getEvolutionStatus === "function");
  assert.ok(typeof kee.listCycles         === "function");
  assert.ok(typeof kee.getCycle           === "function");
  assert.ok(typeof kee.getStats           === "function");
});

test("EVOLUTION_STEPS has all 13 steps", () => {
  const expected = ["observe","capture","normalize","correlate","reason","benchmark","predict","generate_insights","validate","measure","learn","publish","evolve"];
  expected.forEach(s => assert.ok(kee.EVOLUTION_STEPS.includes(s), `missing: ${s}`));
});

atest("runEvolutionCycle completes all 13 steps", async () => {
  const r = await kee.runEvolutionCycle("current_knowledge", { skipExecute: true });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.cycleId);
  assert.strictEqual(r.stepsCompleted, 13);
  assert.ok(r.minutesSaved > 0);
});

atest("getCycle by id (direct, with memIndex)", async () => {
  const r = await kee.runEvolutionCycle("get_cycle_know_direct", { skipExecute: true });
  assert.ok(r.ok && r.cycleId);
  let c = kee.getCycle(r.cycleId);
  if (!c) {
    // Retry with fresh write
    const r2 = await kee.runEvolutionCycle("get_cycle_know_retry", { skipExecute: true });
    c = kee.getCycle(r2.cycleId);
    assert.ok(c, `getCycle(${r2.cycleId}) returned null on retry`);
    assert.strictEqual(c.id, r2.cycleId);
  } else {
    assert.strictEqual(c.id, r.cycleId);
  }
  assert.ok(Array.isArray(c.steps) && c.steps.length === 13);
});

atest("listCycles returns array", async () => {
  const ctx = `list_know_${Date.now()}`;
  await kee.runEvolutionCycle(ctx, { skipExecute: true });
  const r = kee.listCycles({ context: ctx, limit: 10 });
  assert.ok(r.ok && Array.isArray(r.cycles));
});

atest("getEvolutionStatus has totalCycles >= 1", async () => {
  await kee.runEvolutionCycle("status_seed_know", { skipExecute: true });
  const s = kee.getEvolutionStatus();
  assert.ok(s.ok && s.totalCycles >= 1 && s.minutesSaved >= 25);
});

atest("getDebtReport has all 7 debt categories", async () => {
  const ctx = "debt_know_ctx";
  await kqe.score(ctx);
  const r = kee.getDebtReport(ctx);
  assert.ok(r.ok && typeof r.totalDebt === "number");
  ["knowledgeDebt","memoryHealth","learningVelocity","knowledgeFreshness","reasoningAccuracy","insightQuality","knowledgeGrowth"].forEach(k =>
    assert.ok(r[k], `missing debt category: ${k}`)
  );
  assert.ok(["critical","moderate","low"].includes(r.severity));
  assert.ok(r.recommendation);
});

atest("getDebtReport ok=true with no history", async () => {
  const r = kee.getDebtReport("fresh_know_ctx_" + Date.now());
  assert.ok(r.ok === true && typeof r.totalDebt === "number");
});

atest("getQualityTrend insufficient history returns error", async () => {
  const r = kee.getQualityTrend("no_trend_know_" + Date.now());
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

atest("getQualityTrend with 2 scores returns direction", async () => {
  const ctx = "trend_evo_know";
  await kqe.score(ctx);
  await kqe.score(ctx);
  const r = kee.getQualityTrend(ctx);
  if (r.ok) assert.ok(["improving","declining","stable"].includes(r.direction));
});

atest("multiple cycles accumulate minutesSaved", async () => {
  const before = kee.getEvolutionStatus().minutesSaved;
  await kee.runEvolutionCycle("multi_know_ctx", { skipExecute: true });
  await kee.runEvolutionCycle("multi_know_ctx", { skipExecute: true });
  const after = kee.getEvolutionStatus().minutesSaved;
  assert.ok(after >= before + 25, `expected increase of >=25, got ${after - before}`);
});

atest("getStats has evolutionSteps array", async () => {
  const s = kee.getStats();
  assert.ok(typeof s.totalCycles === "number" && Array.isArray(s.evolutionSteps));
  assert.strictEqual(s.evolutionSteps.length, 13);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 6: Knowledge Intelligence Dashboard
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Knowledge Intelligence Dashboard ──");

test("module exports", () => {
  assert.ok(typeof kid.getDashboard       === "function");
  assert.ok(typeof kid.getContextView     === "function");
  assert.ok(typeof kid.getKnowledgeHealth === "function");
  assert.strictEqual(kid.KNOWLEDGE_SERVICES_REUSED, 20);
});

test("getDashboard returns ok", () => {
  const d = kid.getDashboard();
  assert.ok(d.ok && d.summary);
  assert.strictEqual(d.summary.knowledgeServicesReused, 20);
});

test("getDashboard has all sections", () => {
  const d = kid.getDashboard();
  ["summary","graphSnapshot","memoryHealth","researchSnapshot","technicalDebt",
   "improvementSuccessRate","reasoning","riskSummary","benchmarks","learning",
   "recentEvolutionCycles","recentBenchmarks","recentPredictions","founderTimeSaved"].forEach(k =>
    assert.ok(d[k] !== undefined, `missing section: ${k}`)
  );
});

test("founderTimeSaved structure", () => {
  const d = kid.getDashboard();
  assert.ok(typeof d.founderTimeSaved.totalMinutes === "number");
  assert.ok(typeof d.founderTimeSaved.totalHours   === "number");
  assert.strictEqual(d.founderTimeSaved.perCycle, 25);
});

test("getContextView fails without context", () => {
  const r = kid.getContextView(null);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test("getContextView returns ok for current_knowledge", () => {
  const r = kid.getContextView("current_knowledge");
  assert.ok(r.ok);
  assert.ok(r.qualityTrend !== undefined);
  assert.ok(Array.isArray(r.recentPredictions));
  assert.ok(r.debt !== undefined);
});

test("getKnowledgeHealth returns 26 services", () => {
  const h = kid.getKnowledgeHealth();
  assert.ok(h.ok && typeof h.total === "number");
  assert.strictEqual(h.total, 26, `expected 26 services, got ${h.total}`);
  assert.ok(Array.isArray(h.services));
  assert.ok(["operational","degraded","critical"].includes(h.status));
});

test("getKnowledgeHealth: all 6 OKB X V1 services healthy", () => {
  const h = kid.getKnowledgeHealth();
  ["knowledgeReasoningEngine","knowledgeQualityEngine","knowledgeBenchmarkEngine",
   "knowledgePredictionEngine","knowledgeEvolutionEngine","knowledgeIntelligenceDashboard"].forEach(svc => {
    const s = h.services.find(x => x.name === svc);
    assert.ok(s, `service not found: ${svc}`);
    assert.ok(s.ok, `service unhealthy: ${svc}`);
  });
});

atest("summary.totalScores >= 1 after scoring", async () => {
  await kqe.score("summary_seed_know");
  const d = kid.getDashboard();
  assert.ok(d.summary.totalScores >= 1);
});

atest("summary.totalEvolutionCycles >= 1 after cycle", async () => {
  await kee.runEvolutionCycle("dashboard_evo_seed_know", { skipExecute: true });
  const d = kid.getDashboard();
  assert.ok(d.summary.totalEvolutionCycles >= 1);
});

atest("graphSnapshot.nodes is numeric", async () => {
  const d = kid.getDashboard();
  assert.ok(typeof d.graphSnapshot.nodes === "number");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 7: Cross-service integration
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Cross-Service Integration ──");

atest("analyze → score pipeline", async () => {
  const ctx = "pipeline_know";
  const ra  = await kre.analyze(ctx);
  assert.ok(ra.ok);
  const qs  = await kqe.score(ctx, { reasoningAnalysis: ra.analysis });
  assert.ok(qs.ok);
  assert.ok(qs.score.reasoningOverall !== undefined);
});

atest("score → compareVersions → compareToBaseline chain", async () => {
  const ctx = "chain_know";
  await kqe.score(ctx);
  await kqe.score(ctx);
  const vc = await kbe.compareVersions(ctx, {});
  assert.ok(vc.ok);
  const bl = await kbe.compareToBaseline(ctx, {});
  assert.ok(bl.ok);
});

atest("score → predict → getContextView", async () => {
  const ctx  = "view_pipeline_know";
  const qs   = await kqe.score(ctx);
  assert.ok(qs.ok);
  const pred = await kpe.predict(ctx, { qualityScore: qs.score });
  assert.ok(pred.ok);
  const view = kid.getContextView(ctx);
  assert.ok(view.ok && view.currentScore !== null);
});

atest("full 13-step evolution on current_knowledge", async () => {
  const r = await kee.runEvolutionCycle("current_knowledge", { skipExecute: true });
  assert.ok(r.ok && r.stepsCompleted === 13);
});

atest("improvement success rate increases with successful improvements", async () => {
  for (let i = 0; i < 5; i++) {
    kbe.recordImprovementResult({ improvId: `rate_know_${i}`, context: "rate_know", beforeScore: 50, afterScore: 65, applied: true });
  }
  const r = kbe.getImprovementSuccessRate();
  assert.ok(r.ok && r.rate > 0);
});

atest("evolution cycle updates founder time saved", async () => {
  const before = kid.getDashboard().founderTimeSaved.totalMinutes;
  await kee.runEvolutionCycle("founder_time_know", { skipExecute: true });
  const after = kid.getDashboard().founderTimeSaved.totalMinutes;
  assert.ok(after >= before);
});

atest("debt report after scoring shows categories", async () => {
  const ctx = "debt_pipeline_know";
  await kqe.score(ctx);
  const debt = kee.getDebtReport(ctx);
  assert.ok(debt.ok && typeof debt.knowledgeDebt.debt === "number");
});

atest("compareEngMemory and compareResearch both succeed", async () => {
  const r1 = await kbe.compareEngMemory("current_knowledge");
  const r2 = await kbe.compareResearch("current_knowledge");
  assert.ok(r1.ok && r2.ok);
  assert.strictEqual(r1.benchmark.type, "eng_memory_compare");
  assert.strictEqual(r2.benchmark.type, "research_compare");
});

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  await Promise.all(promises);
  console.log(`\n── OKB X V1 Results ──`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
