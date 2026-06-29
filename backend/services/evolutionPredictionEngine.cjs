"use strict";
/**
 * evolutionPredictionEngine.cjs — OSE X V1 Self-Evolution Intelligence
 *
 * Predicts future evolution risks and opportunities:
 *   futureBottlenecks       — where the platform will slow down
 *   capabilityGaps          — missing capabilities before next level
 *   technicalDebtGrowth     — debt trajectory if nothing changes
 *   optimizationOpportunities — high-ROI improvements available now
 *   platformMaturity        — projected maturity level in N cycles
 *
 * Storage: data/evolution-predictions.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "evolution-predictions.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _sie = () => _try(() => require("./selfImprovementEngine.cjs"));
const _sre = () => _try(() => require("./selfReviewEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _aeo = () => _try(() => require("./aeoState.cjs"));
const _ile = () => _try(() => require("./improvementLoopEngine.cjs"));
const _exp = () => _try(() => require("./experimentManager.cjs"));
const _be  = () => _try(() => require("./benchmarkEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `ep_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { predictions: [], stats: { total: 0, criticalPredictions: 0, avgRisk: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.predictions.length > 200) d.predictions = d.predictions.slice(-200);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Predictors ────────────────────────────────────────────────────────────────

function _predictBottlenecks(sieStats, review, qualityScore) {
  const results = [];
  const scores  = review?.scores || {};
  const qs      = qualityScore?.dimensions || {};

  if ((scores.autonomy || 0) < 50 || (qs.autonomy_maturity || 100) < 40) {
    results.push({
      area: "autonomy", severity: "critical",
      prediction: "Platform will stall on autonomous decisions requiring founder approval",
      probability: 0.88, timeframe: "next 2 weeks",
      mitigation: "Increase threshold in founderTwin + enable more POST-Ω autonomous execution paths",
    });
  }
  if ((scores.performance || 0) < 60) {
    results.push({
      area: "performance", severity: "high",
      prediction: "Execution latency will degrade as agent count grows",
      probability: 0.72, timeframe: "next month",
      mitigation: "Run benchmarkEngine.runAll() and optimize slow paths",
    });
  }
  if ((sieStats?.pendingPatterns || 0) > 20) {
    results.push({
      area: "pattern_backlog", severity: "medium",
      prediction: `${sieStats.pendingPatterns} patterns pending — backlog will cause quality drift`,
      probability: 0.65, timeframe: "next sprint",
      mitigation: "Run selfImprovementEngine.runEvolutionCycle() to promote patterns",
    });
  }
  return results;
}

function _predictCapabilityGaps(sieStats, aeoKpis) {
  const results = [];
  const kpis    = Array.isArray(aeoKpis) ? aeoKpis : [];
  const rs      = sieStats?.improvementScores || {};

  if ((rs.predictionAccuracy || 0) < 40) {
    results.push({
      area: "prediction_accuracy", severity: "high",
      prediction: "Platform cannot predict its own failures — blind spots will multiply",
      probability: 0.80,
      mitigation: "Enable prediction feedback loop: record outcome per prediction",
    });
  }
  if ((rs.autonomousSuccess || 0) < 20) {
    results.push({
      area: "autonomous_execution", severity: "high",
      prediction: "Autonomous execution capability is critically underdeveloped",
      probability: 0.85,
      mitigation: "Route more Class A workflows through P3 autonomousExecution engine",
    });
  }
  const memEntries = kpis.reduce((s, k) => s + (k.memoryEntries || 0), 0);
  if (memEntries < 5) {
    results.push({
      area: "evolution_memory", severity: "medium",
      prediction: "Without evolution memory, improvements will regress after sprints",
      probability: 0.60,
      mitigation: "Wire aeoState.addMemory() into each completed evolution pipeline",
    });
  }
  return results;
}

function _predictDebtGrowth(review, cleStats) {
  const results  = [];
  const debt     = review?.debtPoints || 0;
  const openRecs = cleStats?.openRecs || 0;

  if (debt > 20) {
    const projectedDebt = Math.round(debt * 1.3);
    results.push({
      area: "technical_debt", severity: "high",
      prediction: `Debt will grow to ~${projectedDebt} points if unaddressed`,
      currentDebt: debt, projectedDebt, probability: 0.78, timeframe: "30 days",
      mitigation: "Address top 3 recommendations from selfReviewEngine each week",
    });
  }
  if (openRecs > 10) {
    results.push({
      area: "lesson_backlog", severity: "medium",
      prediction: `${openRecs} unactioned lessons will cause repeated failures`,
      probability: 0.70,
      mitigation: "Action open CLE recommendations — focus on high-priority items",
    });
  }
  return results;
}

function _predictOptimizationOpportunities(sieStats, ileStats) {
  const results = [];
  const top     = sieStats?.topPendingPattern;
  const rs      = sieStats?.improvementScores || {};

  if (top) {
    results.push({
      area: "pattern_promotion", severity: "info",
      prediction: "Top pattern can be promoted for immediate improvement",
      confidence: top.confidence,
      pattern: top.pattern,
      action: top.action,
      estimatedGain: Math.round(top.confidence * 15),
    });
  }
  if ((rs.repositoryHealth || 0) < 50) {
    results.push({
      area: "repository_health", severity: "info",
      prediction: "Repository health improvements will yield 10-20% velocity gain",
      estimatedGain: 15, probability: 0.65,
      action: "Run ACP-10 engineeringMemory analysis on low-health files",
    });
  }
  const kept    = ileStats?.kept    || 0;
  const reverted= ileStats?.reverted || 0;
  if (reverted > kept && kept + reverted > 0) {
    results.push({
      area: "improvement_selection", severity: "info",
      prediction: "Improvement selection quality is low — more are reverted than kept",
      estimatedGain: 20,
      action: "Tighten pre-validation criteria in improvementLoopEngine",
    });
  }
  return results;
}

function _predictPlatformMaturity(sieStats, review) {
  const results = [];
  const overall = review?.overall || 0;
  const cycles  = sieStats?.evolutionCycles || 0;
  const projected = Math.min(100, overall + cycles * 2 + 10);

  results.push({
    area: "platform_maturity", severity: "info",
    prediction: `Platform projected to reach maturity score ${projected} in next 5 cycles`,
    currentScore: overall, projectedScore: projected, cyclesAnalyzed: cycles,
    confidence: 0.70,
  });
  return results;
}

// ── Main predict ──────────────────────────────────────────────────────────────

async function predict(context, { qualityScore, reasoningAnalysis } = {}) {
  context = context || "current_evolution";

  const sieStats = _try(() => _sie()?.getStatistics?.()) || {};
  const aeoKpis  = _try(() => _aeo()?.getAllKpis?.())    || [];
  const review   = _try(() => _sre()?.getLatestReview?.()) || {};
  const cleRaw   = _try(() => _cle()?.getRecommendations?.()) || {};
  const cleRecs  = Array.isArray(cleRaw) ? cleRaw : (cleRaw.recommendations || []);
  const cleStats = { ..._try(() => _cle()?.getStats?.()) || {}, openRecs: cleRecs.filter(r => r.status === "open").length };
  const ileStats = _try(() => _ile()?.getStats?.()) || {};

  const futureBottlenecks       = _predictBottlenecks(sieStats, review, qualityScore);
  const capabilityGaps          = _predictCapabilityGaps(sieStats, aeoKpis);
  const technicalDebtGrowth     = _predictDebtGrowth(review, cleStats);
  const optimizationOpportunities = _predictOptimizationOpportunities(sieStats, ileStats);
  const platformMaturity        = _predictPlatformMaturity(sieStats, review);

  const all = [
    ...futureBottlenecks, ...capabilityGaps, ...technicalDebtGrowth,
    ...optimizationOpportunities, ...platformMaturity,
  ];

  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  all.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

  const criticals      = all.filter(p => p.severity === "critical").length;
  const highs          = all.filter(p => p.severity === "high").length;
  const opportunityCount = all.filter(p => p.severity === "info").length;
  const riskScore      = Math.min(100, criticals * 25 + highs * 10 + all.filter(p=>p.severity==="medium").length*5);

  const id    = _id();
  const entry = {
    id, context,
    futureBottlenecks, capabilityGaps, technicalDebtGrowth,
    optimizationOpportunities, platformMaturity,
    total: all.length, criticalCount: criticals, highCount: highs, opportunityCount, riskScore,
    createdAt: _ts(),
  };

  const d = _load();
  d.predictions.push(entry);
  const allRisk = d.predictions.map(p => p.riskScore);
  const allCrit = d.predictions.reduce((s, p) => s + p.criticalCount, 0);
  d.stats = { total: d.predictions.length, criticalPredictions: allCrit, avgRisk: +(allRisk.reduce((a,b)=>a+b,0)/allRisk.length).toFixed(1) };
  _save(d);

  return { ok: true, prediction: entry };
}

function getPrediction(id) { return _load().predictions.find(p => p.id === id) || null; }

function listPredictions({ context, limit = 50 } = {}) {
  let preds = _load().predictions;
  if (context) preds = preds.filter(p => p.context === context);
  return { ok: true, predictions: preds.slice(-limit) };
}

function getStats() { return { ...(_load().stats), updatedAt: _load().updatedAt }; }

module.exports = { predict, getPrediction, listPredictions, getStats };
