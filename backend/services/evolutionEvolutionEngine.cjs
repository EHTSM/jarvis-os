"use strict";
/**
 * evolutionEvolutionEngine.cjs — OSE X V1 Self-Evolution Intelligence
 *
 * 13-step self-evolution pipeline:
 *   Observe → Detect Weakness → Reason → Benchmark → Predict →
 *   Generate Improvements → Prioritize → Simulate → Validate →
 *   Execute → Measure → Learn → Evolve
 *
 * Tracks: Evolution Debt, Optimization Debt, Autonomy Maturity,
 *         Improvement Velocity, Experiment Success, Platform Evolution Score
 *
 * Storage: data/evolution-evolution.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "evolution-evolution.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _aeo = () => _try(() => require("./aeoState.cjs"));
const _aew = () => _try(() => require("./aeoWorkflow.cjs"));
const _sie = () => _try(() => require("./selfImprovementEngine.cjs"));
const _sre = () => _try(() => require("./selfReviewEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _ile = () => _try(() => require("./improvementLoopEngine.cjs"));
const _exp = () => _try(() => require("./experimentManager.cjs"));
const _rpl = () => _try(() => require("./researchPlanner.cjs"));
const _ere = () => _try(() => require("./evolutionReasoningEngine.cjs"));
const _eqe = () => _try(() => require("./evolutionQualityEngine.cjs"));
const _ebe = () => _try(() => require("./evolutionBenchmarkEngine.cjs"));
const _epe = () => _try(() => require("./evolutionPredictionEngine.cjs"));

function _ts()    { return new Date().toISOString(); }
function _id()    { return `ee_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const EVOLUTION_STEPS = [
  "observe",
  "detect_weakness",
  "reason",
  "benchmark",
  "predict",
  "generate_improvements",
  "prioritize",
  "simulate",
  "validate",
  "execute",
  "measure",
  "learn",
  "evolve",
];

// ── In-memory index — concurrent-safe ─────────────────────────────────────────
const _memIndex = new Map();

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      cycles: [],
      stats: { totalCycles: 0, minutesSaved: 0, improvementsGenerated: 0, platformEvolutionScore: 0 },
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

// ── Debt report ───────────────────────────────────────────────────────────────

function getDebtReport(context) {
  context = context || "current_evolution";
  const hist   = _eqe()?.getHistory?.(context, 5)?.history || [];
  const latest = hist[hist.length - 1];

  if (!latest) {
    return {
      ok: true, context,
      evolutionDebt:       { score: 0, debt: 0, label: "Evolution Debt",        severity: "unknown" },
      optimizationDebt:    { score: 0, debt: 0, label: "Optimization Debt",     severity: "unknown" },
      autonomyMaturity:    { score: 0, debt: 0, label: "Autonomy Maturity",      severity: "unknown" },
      improvementVelocity: { score: 0, debt: 0, label: "Improvement Velocity",   severity: "unknown" },
      experimentSuccess:   { score: 0, debt: 0, label: "Experiment Success",     severity: "unknown" },
      platformScore:       { score: 0, debt: 0, label: "Platform Evolution Score",severity: "unknown" },
      totalDebt: 0, severity: "unknown",
      recommendation: "Score evolution context first to generate debt report",
    };
  }

  const dims   = latest.dimensions || {};
  const full   = _eqe()?.getScore?.(latest.id);
  const fdims  = full?.dimensions  || dims;
  const target = 70;

  function _debt(key, label) {
    const score    = typeof fdims[key] === "number" ? fdims[key] : (latest.overall || 50);
    const debt     = Math.max(0, target - score);
    const severity = debt > 25 ? "critical" : debt > 15 ? "high" : debt > 5 ? "medium" : "low";
    return { score, debt, label, severity };
  }

  const evolutionDebt       = _debt("adaptability",            "Evolution Debt");
  const optimizationDebt    = _debt("optimization_efficiency", "Optimization Debt");
  const autonomyMaturity    = _debt("autonomy_maturity",       "Autonomy Maturity");
  const improvementVelocity = _debt("improvement_velocity",    "Improvement Velocity");
  const experimentSuccess   = _debt("execution_quality",       "Experiment Success");
  const platformScore       = _debt("architectural_stability", "Platform Evolution Score");

  const debts    = [evolutionDebt, optimizationDebt, autonomyMaturity, improvementVelocity, experimentSuccess];
  const totalDebt= debts.reduce((s, d) => s + d.debt, 0);
  const avg      = totalDebt / debts.length;
  const severity = avg > 20 ? "critical" : avg > 10 ? "moderate" : "low";

  return {
    ok: true, context,
    evolutionDebt, optimizationDebt, autonomyMaturity,
    improvementVelocity, experimentSuccess, platformScore,
    totalDebt: +totalDebt.toFixed(1), severity,
    recommendation: severity === "critical"
      ? "Critical evolution debt — run evolution cycle immediately"
      : severity === "moderate"
      ? "Moderate debt — schedule self-evolution this week"
      : "Evolution debt under control — maintain current trajectory",
  };
}

function getQualityTrend(context, { limit = 10 } = {}) {
  const trend = _eqe()?.getTrend?.(context || "current_evolution");
  if (!trend || !trend.ok) return { ok: false, error: "insufficient history" };
  return { ok: true, ...trend };
}

// ── 13-step pipeline ──────────────────────────────────────────────────────────

async function runEvolutionCycle(context, { skipExecute = false } = {}) {
  context = context || "current_evolution";
  const cycleId = _id();
  const steps   = [];

  function step(name, data = {}) {
    steps.push({ name, completedAt: _ts(), ...data });
  }

  try {
    // 1. OBSERVE — gather live evolution signals
    const aeoKpis   = _try(() => _aeo()?.getAllKpis?.()) || [];
    const kpis      = Array.isArray(aeoKpis) ? aeoKpis : [];
    const proposed  = kpis.reduce((s, k) => s + (k.evolutionsProposed || 0), 0);
    const applied   = kpis.reduce((s, k) => s + (k.evolutionsApplied  || 0), 0);
    const sieStats  = _try(() => _sie()?.getStatistics?.()) || {};
    step("observe", { evolutionsProposed: proposed, evolutionsApplied: applied, pendingPatterns: sieStats.pendingPatterns || 0 });

    // 2. DETECT WEAKNESS — AEO weakness detector + self review
    const weaknesses = _try(() => _aeo()?.detectWeaknesses?.()) || [];
    const review     = _try(() => _sre()?.getLatestReview?.())  || {};
    const debtPoints = review.debtPoints || 0;
    step("detect_weakness", { aeoWeaknesses: weaknesses.length, debtPoints });

    // 3. REASON — 7-dim reasoning analysis
    const raResult  = await _ere()?.analyze?.(context, {});
    const ra        = raResult?.analysis || null;
    step("reason", { overallScore: ra?.overallScore, dimensions: Object.keys(ra?.dimensions || {}).length });

    // 4. BENCHMARK — compare to baseline
    const bm = await _ebe()?.compareToBaseline?.(context, {});
    step("benchmark", { productionReady: bm?.benchmark?.productionReady, meetsOverall: bm?.benchmark?.meetsOverall });

    // 5. PREDICT — forecast risks
    const qs         = await _eqe()?.score?.(context, { reasoningAnalysis: ra });
    const qsData     = qs?.score || {};
    const pred       = await _epe()?.predict?.(context, { qualityScore: qsData, reasoningAnalysis: ra });
    const predData   = pred?.prediction || {};
    step("predict", { total: predData.total, critical: predData.criticalCount, riskScore: predData.riskScore });

    // 6. GENERATE IMPROVEMENTS — extract from quality improvements + SIE patterns
    const improvements = qsData.improvements || [];
    const topPattern   = sieStats.topPendingPattern;
    if (topPattern) {
      improvements.push({
        dimension: "agent", priority: "high",
        action: topPattern.action,
        confidence: topPattern.confidence / 100,
        projectedGain: Math.round((topPattern.confidence / 100) * 15),
      });
    }
    step("generate_improvements", { count: improvements.length });

    // 7. PRIORITIZE — rank by projected gain
    improvements.sort((a, b) => (b.projectedGain || 0) - (a.projectedGain || 0));
    const prioritized = improvements.slice(0, 5);
    step("prioritize", { selected: prioritized.length });

    // 8. SIMULATE — AEO simulation (if available)
    if (!skipExecute) {
      const evo = _try(() => _aeo()?.listEvolutions?.({ status: "proposed", limit: 1 }));
      const first = (evo?.evolutions || [])[0];
      if (first) _try(() => _aew()?.simulateEvolution?.(first.id));
    }
    step("simulate", { skipped: skipExecute });

    // 9. VALIDATE — confidence filter
    const valid = prioritized.filter(i => (i.confidence || 0.5) >= 0.60);
    step("validate", { valid: valid.length, rejected: prioritized.length - valid.length });

    // 10. EXECUTE — apply via improvementLoopEngine
    if (!skipExecute && valid.length > 0) {
      _try(() => _ile()?.apply?.({ context, improvements: valid }));
    }
    step("execute", { skipped: skipExecute, improvements: valid.length });

    // 11. MEASURE — score after
    const qs2     = skipExecute ? qsData : ((await _eqe()?.score?.(context, {}))?.score || qsData);
    const delta   = (qs2.overall || 0) - (qsData.overall || 0);
    step("measure", { scoreBefore: qsData.overall, scoreAfter: qs2.overall, delta: +delta.toFixed(1) });

    // 12. LEARN — CLE lesson recording
    _try(() => _cle()?.recordOutcome?.({
      context: `evolution_cycle_${context}`,
      outcome: delta >= 0 ? "success" : "partial",
      score:   qs2.overall,
    }));
    const cleRaw = _try(() => _cle()?.getRecommendations?.()) || {};
    const cleLen = (Array.isArray(cleRaw) ? cleRaw : (cleRaw.recommendations || [])).length;
    step("learn", { lessonsIntegrated: cleLen });

    // 13. EVOLVE — persist
    const minutesSaved = 30 + (valid.length * 5);
    const d = _load();
    const cycleEntry = {
      id:       cycleId,
      context,
      steps,
      stepsCompleted: steps.length,
      overallBefore: qsData.overall,
      overallAfter:  qs2.overall,
      delta:    +delta.toFixed(1),
      improvements: valid.length,
      riskScore: predData.riskScore || 0,
      debtPoints,
      minutesSaved,
      completedAt: _ts(),
    };

    _memIndex.set(cycleId, cycleEntry);
    d.cycles.push(cycleEntry);
    d.stats.totalCycles++;
    d.stats.minutesSaved        += minutesSaved;
    d.stats.improvementsGenerated+= valid.length;
    d.stats.platformEvolutionScore = qs2.overall || d.stats.platformEvolutionScore;
    _save(d);
    step("evolve", { cycleId, minutesSaved });

    return { ok: true, cycleId, stepsCompleted: steps.length, minutesSaved, improvements: valid.length };

  } catch (err) {
    return { ok: false, cycleId, error: err.message, stepsCompleted: steps.length };
  }
}

function getEvolutionStatus() {
  const d = _load();
  return {
    ok:                     true,
    totalCycles:            d.stats.totalCycles,
    minutesSaved:           d.stats.minutesSaved,
    improvementsGenerated:  d.stats.improvementsGenerated,
    platformEvolutionScore: d.stats.platformEvolutionScore,
    lastCycle:              d.cycles[d.cycles.length - 1]?.completedAt || null,
    evolutionSteps:         EVOLUTION_STEPS,
  };
}

function getCycle(id) { return _memIndex.get(id) || _load().cycles.find(c => c.id === id) || null; }

function listCycles({ context, limit = 50 } = {}) {
  const fromFile = _load().cycles;
  const fileIds  = new Set(fromFile.map(c => c.id));
  const memExtra = [..._memIndex.values()].filter(c => !fileIds.has(c.id));
  let list = [...fromFile, ...memExtra];
  if (context) list = list.filter(c => c.context === context);
  list.sort((a, b) => a.completedAt < b.completedAt ? -1 : 1);
  return { ok: true, cycles: list.slice(-limit) };
}

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
