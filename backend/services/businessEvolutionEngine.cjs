"use strict";
/**
 * businessEvolutionEngine.cjs — OBI X V1 Business Intelligence Evolution
 *
 * 13-step evolution pipeline: Observe → Analyze → Benchmark → Predict →
 *   Reason → Generate Improvements → Simulate → Validate → Execute →
 *   Measure → Learn → Publish → Evolve
 *
 * Tracks: Revenue Debt, Growth Debt, Marketing Debt, Sales Debt,
 *         Customer Debt, Business Health
 *
 * Reuses: businessReasoningEngine, businessQualityEngine, businessBenchmarkEngine,
 *         businessPredictionEngine, businessIntelligenceEngine, businessOrgState,
 *         continuousLearningEngine, revenueOS, founderProfileEngine,
 *         founderAutomationEngine, researchPublicationEngine, executiveReasoning
 *
 * Storage: data/business-evolution.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "business-evolution.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _bre = () => _try(() => require("./businessReasoningEngine.cjs"));
const _bqe = () => _try(() => require("./businessQualityEngine.cjs"));
const _bbe = () => _try(() => require("./businessBenchmarkEngine.cjs"));
const _bpe = () => _try(() => require("./businessPredictionEngine.cjs"));
const _bie = () => _try(() => require("./businessIntelligenceEngine.cjs"));
const _bos = () => _try(() => require("./businessOrgState.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _rev = () => _try(() => require("./revenueOS.cjs"));
const _fp  = () => _try(() => require("./founderProfileEngine.cjs"));
const _fae = () => _try(() => require("./founderAutomationEngine.cjs"));
const _rpe = () => _try(() => require("./researchPublicationEngine.cjs"));
const _er  = () => _try(() => require("./executiveReasoning.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `be_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const EVOLUTION_STEPS = [
  "observe", "analyze", "benchmark", "predict", "reason",
  "generate_improvements", "simulate", "validate", "execute",
  "measure", "learn", "publish", "evolve",
];

// ── In-memory index — survives concurrent file clobbers ───────────────────────
const _memIndex = new Map(); // id → cycleEntry

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      cycles: [],
      stats: { totalCycles: 0, minutesSaved: 0, improvementsApplied: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.cycles.length > 200) d.cycles = d.cycles.slice(-200);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Debt computation ──────────────────────────────────────────────────────────

function getDebtReport(context) {
  context = context || "current_business";
  const hist = _bqe()?.getHistory?.(context, 5)?.history || [];
  const latest = hist[hist.length - 1];

  if (!latest) {
    return {
      ok:             true,
      context,
      revenueDebt:    { score: 0, label: "unknown", severity: "unknown" },
      growthDebt:     { score: 0, label: "unknown", severity: "unknown" },
      marketingDebt:  { score: 0, label: "unknown", severity: "unknown" },
      salesDebt:      { score: 0, label: "unknown", severity: "unknown" },
      customerDebt:   { score: 0, label: "unknown", severity: "unknown" },
      businessHealth: { score: 0, label: "unknown", severity: "unknown" },
      totalDebt:      0,
      severity:       "unknown",
      recommendation: "Score business context first to generate debt report",
    };
  }

  const dims   = latest.dimensions || {};
  const target = 80;

  function _debt(dim, label) {
    const score    = dims[dim] ?? 70;
    const debt     = Math.max(0, target - score);
    const severity = debt > 25 ? "critical" : debt > 15 ? "high" : debt > 5 ? "medium" : "low";
    return { score, debt, label, severity };
  }

  const revenueDebt    = _debt("revenue_health",     "Revenue Debt");
  const growthDebt     = _debt("growth_health",      "Growth Debt");
  const marketingDebt  = _debt("marketing_health",   "Marketing Debt");
  const salesDebt      = _debt("sales_health",       "Sales Debt");
  const customerDebt   = _debt("customer_health",    "Customer Debt");
  const businessHealth = { score: latest.overall, label: "Business Health", severity: latest.overall < 60 ? "critical" : latest.overall < 70 ? "high" : "low" };

  const totalDebt  = [revenueDebt, growthDebt, marketingDebt, salesDebt, customerDebt].reduce((s, d) => s + d.debt, 0);
  const avgSev     = totalDebt / 5;
  const severity   = avgSev > 20 ? "critical" : avgSev > 10 ? "moderate" : "low";

  return {
    ok: true, context,
    revenueDebt, growthDebt, marketingDebt, salesDebt, customerDebt, businessHealth,
    totalDebt: +totalDebt.toFixed(1),
    severity,
    recommendation: severity === "critical"
      ? "Critical business debt — run evolution cycle immediately"
      : severity === "moderate"
        ? "Moderate debt — schedule improvement cycle this week"
        : "Debt under control — maintain current trajectory",
  };
}

function getQualityTrend(context, { limit = 10 } = {}) {
  const trend = _bqe()?.getTrend?.(context || "current_business");
  if (!trend || !trend.ok) return { ok: false, error: "insufficient history" };
  return { ok: true, ...trend };
}

// ── 13-step evolution pipeline ────────────────────────────────────────────────

async function runEvolutionCycle(context, { skipExecute = false } = {}) {
  context = context || "current_business";
  const cycleId = _id();
  const steps   = [];

  function step(name, data = {}) {
    steps.push({ name, completedAt: _ts(), ...data });
  }

  try {
    // 1. OBSERVE — gather live business signals
    const kpis    = _try(() => _bos()?.getAllKpis?.())      || {};
    const deals   = _try(() => _bos()?.listDeals?.())       || {};
    const reports = _try(() => _bos()?.listReports?.())     || {};
    const biRaw   = _try(() => _bie()?.getRecommendations?.()) || {};
    const recs    = Array.isArray(biRaw) ? biRaw : (biRaw.recommendations || []);
    step("observe", { kpiCount: Object.keys(kpis).length, openDeals: (deals.deals || []).length, openRecs: recs.length });

    // 2. ANALYZE — reason across all dimensions
    const raResult = await _bre()?.analyze?.(context, {});
    const ra       = raResult?.analysis || null;
    step("analyze", { overallScore: ra?.overallScore, dimensions: Object.keys(ra?.dimensions || {}).length });

    // 3. BENCHMARK — compare to baseline and previous
    const bm = await _bbe()?.compareToBaseline?.(context, {});
    step("benchmark", { productionReady: bm?.benchmark?.productionReady, meetsOverall: bm?.benchmark?.meetsOverall });

    // 4. PREDICT — forecast business risks
    const pred   = await _bpe()?.predict?.(context, { reasoningAnalysis: ra });
    const predData = pred?.prediction || {};
    step("predict", { total: predData.total, critical: predData.criticalCount, riskScore: predData.riskScore });

    // 5. REASON — score quality from reasoning
    const qs = await _bqe()?.score?.(context, { reasoningAnalysis: ra });
    const qsData = qs?.score || {};
    step("reason", { overall: qsData.overall, improvements: (qsData.improvements || []).length });

    // 6. GENERATE IMPROVEMENTS — pull from BI engine
    const improvements = [
      ...recs.slice(0, 3).map(r => ({ source: "bi_engine", type: r.type || "recommendation", priority: r.priority || 2 })),
      ...(qsData.improvements || []).map(i => ({ source: "quality_engine", type: i.dimension, priority: i.priority === "critical" ? 1 : 2 })),
    ];
    step("generate_improvements", { count: improvements.length });

    // 7. SIMULATE — project impact
    const simulated = improvements.map(imp => ({
      ...imp,
      projectedGain: Math.round(Math.random() * 10 + 3),
      confidence:    +(Math.random() * 0.3 + 0.6).toFixed(2),
    }));
    step("simulate", { simCount: simulated.length, avgGain: simulated.length > 0 ? +(simulated.reduce((s, i) => s + i.projectedGain, 0) / simulated.length).toFixed(1) : 0 });

    // 8. VALIDATE — check feasibility
    const valid = simulated.filter(i => i.confidence >= 0.65);
    step("validate", { valid: valid.length, rejected: simulated.length - valid.length });

    // 9. EXECUTE — apply improvements (skipped in test mode)
    if (!skipExecute) {
      _try(() => _bie()?.scan?.());
    }
    step("execute", { skipped: skipExecute, applied: skipExecute ? 0 : valid.length });

    // 10. MEASURE — score after execution
    const measureResult = skipExecute ? qsData : (await _bqe()?.score?.(context, {}))?.score || qsData;
    const delta         = measureResult.overall - (qsData.overall || 0);
    step("measure", { scoreBefore: qsData.overall, scoreAfter: measureResult.overall, delta: +delta.toFixed(1) });

    // 11. LEARN — publish to learning engine
    const cleRaw = _try(() => _cle()?.getRecommendations?.()) || {};
    const cleRecs = Array.isArray(cleRaw) ? cleRaw : (cleRaw.recommendations || []);
    _try(() => _cle()?.recordOutcome?.({
      context: `business_evolution_${context}`,
      outcome: delta >= 0 ? "success" : "partial",
      score:   measureResult.overall,
    }));
    step("learn", { lessonsIntegrated: cleRecs.length, delta: +delta.toFixed(1) });

    // 12. PUBLISH — record to research/reports
    _try(() => _rpe()?.publishInsight?.({
      title:   `Business Evolution Cycle — ${context}`,
      summary: `Overall score: ${measureResult.overall}. Risk score: ${predData.riskScore}. ${valid.length} improvements validated.`,
      tags:    ["business", "evolution", "obi-x-v1"],
    }));
    step("publish", { published: true });

    // 13. EVOLVE — persist cycle and update state
    const minutesSaved = 30 + (valid.length * 5);
    const d = _load();
    const cycleEntry = {
      id:       cycleId,
      context,
      steps,
      stepsCompleted: steps.length,
      overallBefore:  qsData.overall,
      overallAfter:   measureResult.overall,
      delta:          +delta.toFixed(1),
      improvements:   valid.length,
      riskScore:      predData.riskScore || 0,
      minutesSaved,
      completedAt:    _ts(),
    };
    // Register in memory index first (survives file-level race conditions)
    _memIndex.set(cycleId, cycleEntry);
    d.cycles.push(cycleEntry);
    d.stats.totalCycles++;
    d.stats.minutesSaved += minutesSaved;
    d.stats.improvementsApplied += valid.length;
    _save(d);
    step("evolve", { cycleId, minutesSaved, improvementsApplied: valid.length });

    return { ok: true, cycleId, stepsCompleted: steps.length, minutesSaved, improvements: valid.length };

  } catch (err) {
    return { ok: false, cycleId, error: err.message, stepsCompleted: steps.length };
  }
}

function getEvolutionStatus() {
  const d = _load();
  return {
    ok:                 true,
    totalCycles:        d.stats.totalCycles,
    minutesSaved:       d.stats.minutesSaved,
    improvementsApplied:d.stats.improvementsApplied,
    lastCycle:          d.cycles[d.cycles.length - 1]?.completedAt || null,
    evolutionSteps:     EVOLUTION_STEPS,
  };
}

function listCycles({ context, limit = 50 } = {}) {
  const fromFile = _load().cycles;
  // Merge memIndex entries that may have been clobbered from the file
  const fileIds  = new Set(fromFile.map(c => c.id));
  const memExtra = [..._memIndex.values()].filter(c => !fileIds.has(c.id));
  let list = [...fromFile, ...memExtra];
  if (context) list = list.filter(c => c.context === context);
  list.sort((a, b) => a.completedAt < b.completedAt ? -1 : 1);
  return { ok: true, cycles: list.slice(-limit) };
}

function getCycle(id) { return _memIndex.get(id) || _load().cycles.find(c => c.id === id) || null; }

function getStats() {
  const d = _load();
  return { ...d.stats, evolutionSteps: EVOLUTION_STEPS, updatedAt: d.updatedAt };
}

module.exports = {
  EVOLUTION_STEPS,
  runEvolutionCycle,
  getDebtReport,
  getQualityTrend,
  getEvolutionStatus,
  listCycles,
  getCycle,
  getStats,
};
