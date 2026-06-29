"use strict";
/**
 * evolutionReasoningEngine.cjs — OSE X V1 Self-Evolution Intelligence
 *
 * 7-dimensional reasoning engine for platform self-evolution.
 * Reads live data from AEO, selfImprovement, selfReview, CLE, experimentManager.
 *
 * Dimensions:
 *   architectural  — structural evolution health
 *   capability     — gap vs. target capability set
 *   workflow       — pipeline efficiency signals
 *   agent          — agent fleet performance
 *   runtime        — execution quality from healing/retry data
 *   quality        — code + design quality signals
 *   organizational — org-level maturity score
 *
 * Storage: data/evolution-reasoning.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "evolution-reasoning.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _aeo = () => _try(() => require("./aeoState.cjs"));
const _sie = () => _try(() => require("./selfImprovementEngine.cjs"));
const _sre = () => _try(() => require("./selfReviewEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _exp = () => _try(() => require("./experimentManager.cjs"));
const _ile = () => _try(() => require("./improvementLoopEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `er_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

function _clamp(v) { return Math.min(100, Math.max(0, Math.round(v))); }

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { analyses: [], stats: { total: 0, avgScore: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.analyses.length > 300) d.analyses = d.analyses.slice(-300);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Dimension scorers ─────────────────────────────────────────────────────────

function _scoreArchitectural(aeoKpis) {
  const kpis = Array.isArray(aeoKpis) ? aeoKpis : [];
  const total        = kpis.reduce((s, k) => s + (k.evolutionsProposed || 0), 0);
  const applied      = kpis.reduce((s, k) => s + (k.evolutionsApplied  || 0), 0);
  const kept         = kpis.reduce((s, k) => s + (k.evolutionsKept     || 0), 0);
  const reverted     = kpis.reduce((s, k) => s + (k.evolutionsReverted || 0), 0);
  const applyRate    = total > 0 ? (applied / total) * 100 : 50;
  const keepRate     = applied > 0 ? (kept / applied) * 100 : 50;
  const revertRate   = applied > 0 ? (reverted / applied) * 100 : 0;
  const score = _clamp(applyRate * 0.3 + keepRate * 0.5 - revertRate * 0.2);
  const issues = [];
  if (applyRate < 30) issues.push({ severity: "high",   code: "low_apply_rate",  msg: `Only ${applyRate.toFixed(0)}% of evolutions applied` });
  if (keepRate < 50)  issues.push({ severity: "medium", code: "low_keep_rate",   msg: `Only ${keepRate.toFixed(0)}% of applied evolutions kept` });
  if (revertRate > 20)issues.push({ severity: "high",   code: "high_revert_rate",msg: `${revertRate.toFixed(0)}% revert rate is concerning` });
  return { score, issues, applyRate: +applyRate.toFixed(1), keepRate: +keepRate.toFixed(1), revertRate: +revertRate.toFixed(1) };
}

function _scoreCapability(sieStats) {
  const scores = sieStats?.improvementScores || {};
  const fields = ["learningVelocity","predictionAccuracy","repairSuccess","autonomousSuccess","engineeringMaturity","repositoryHealth","knowledgeGrowth"];
  const raw = fields.map(f => Math.min(100, scores[f] || 0));
  const avg = raw.length ? raw.reduce((a, b) => a + b, 0) / raw.length : 50;
  const score = _clamp(avg);
  const issues = [];
  if ((scores.predictionAccuracy || 0) < 30)  issues.push({ severity: "high",   code: "low_prediction_accuracy", msg: "Prediction accuracy below 30%" });
  if ((scores.autonomousSuccess  || 0) < 30)  issues.push({ severity: "high",   code: "low_autonomous_success",  msg: "Autonomous success rate below 30%" });
  if ((scores.learningVelocity   || 0) > 500) issues.push({ severity: "info",   code: "high_learning_velocity",  msg: "High learning velocity — ensure quality over quantity" });
  return { score, issues, scores };
}

function _scoreWorkflow(aeoKpis) {
  const kpis = Array.isArray(aeoKpis) ? aeoKpis : [];
  const validated = kpis.reduce((s, k) => s + (k.improvementsValidated || 0), 0);
  const tasks     = kpis.reduce((s, k) => s + (k.tasksCompleted        || 0), 0);
  const score = _clamp(Math.min(100, validated * 0.15 + tasks * 0.05 + 40));
  const issues = [];
  if (validated === 0) issues.push({ severity: "medium", code: "no_validations", msg: "No improvements validated yet" });
  return { score, issues, validated, tasksCompleted: tasks };
}

function _scoreAgent(sieStats) {
  const pending = sieStats?.pendingPatterns || 0;
  const cycles  = sieStats?.evolutionCycles  || 0;
  // More pending patterns without cycles = backlog growing
  const backlogPenalty = pending > 10 && cycles === 0 ? 20 : 0;
  const score = _clamp(60 + cycles * 5 - backlogPenalty);
  const issues = [];
  if (pending > 15 && cycles === 0) issues.push({ severity: "high",   code: "pattern_backlog", msg: `${pending} patterns pending, 0 cycles run` });
  if (cycles === 0) issues.push({ severity: "medium", code: "no_evolution_cycles", msg: "Self improvement has not run a cycle yet" });
  return { score, issues, pendingPatterns: pending, evolutionCycles: cycles };
}

function _scoreRuntime(sieStats) {
  const rs = sieStats?.improvementScores || {};
  const repair   = Math.min(100, rs.repairSuccess    || 0);
  const maturity = Math.min(100, rs.engineeringMaturity || 0);
  const score = _clamp(repair * 0.6 + maturity * 0.4);
  const issues = [];
  if (repair < 50)  issues.push({ severity: "high",   code: "low_repair_success",    msg: "Runtime repair success below 50%" });
  if (maturity < 50)issues.push({ severity: "medium", code: "low_eng_maturity",       msg: "Engineering maturity below 50" });
  return { score, issues, repairSuccess: repair, engineeringMaturity: maturity };
}

function _scoreQuality(review) {
  const scores = review?.scores || {};
  const vals = Object.values(scores).filter(v => typeof v === "number");
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 50;
  const debt = review?.debtPoints || 0;
  const score = _clamp(avg - debt * 0.5);
  const issues = [];
  if (debt > 30)       issues.push({ severity: "high",   code: "high_debt",       msg: `${debt} debt points outstanding` });
  if (avg < 50)        issues.push({ severity: "high",   code: "low_review_score", msg: `Average review score ${avg.toFixed(0)} below 50` });
  return { score, issues, avgReviewScore: +avg.toFixed(1), debtPoints: debt };
}

function _scoreOrganizational(aeoKpis, expStats) {
  const kpis     = Array.isArray(aeoKpis) ? aeoKpis : [];
  const reports  = kpis.reduce((s, k) => s + (k.reportsGenerated || 0), 0);
  const memory   = kpis.reduce((s, k) => s + (k.memoryEntries    || 0), 0);
  const expTotal = expStats?.total || 0;
  const score    = _clamp(40 + Math.min(30, reports * 2) + Math.min(20, memory * 0.1) + Math.min(10, expTotal));
  const issues   = [];
  if (reports === 0) issues.push({ severity: "medium", code: "no_reports",     msg: "No AEO reports generated" });
  if (memory  === 0) issues.push({ severity: "low",    code: "no_evo_memory",  msg: "No evolution memory entries" });
  return { score, issues, reports, memoryEntries: memory, experiments: expTotal };
}

// ── Weights ───────────────────────────────────────────────────────────────────
const WEIGHTS = {
  architectural:  0.20,
  capability:     0.20,
  workflow:       0.15,
  agent:          0.15,
  runtime:        0.15,
  quality:        0.10,
  organizational: 0.05,
};

// ── Main analyze ──────────────────────────────────────────────────────────────

async function analyze(context, opts = {}) {
  context = context || "current_evolution";

  const aeoKpis  = _try(() => _aeo()?.getAllKpis?.()) || [];
  const sieStats = _try(() => _sie()?.getStatistics?.()) || {};
  const review   = _try(() => _sre()?.getLatestReview?.()) || {};
  const expStats = _try(() => _exp()?.getStats?.()) || {};

  const archDim  = _scoreArchitectural(aeoKpis);
  const capDim   = _scoreCapability(sieStats);
  const wfDim    = _scoreWorkflow(aeoKpis);
  const agentDim = _scoreAgent(sieStats);
  const rtDim    = _scoreRuntime(sieStats);
  const qualDim  = _scoreQuality(review);
  const orgDim   = _scoreOrganizational(aeoKpis, expStats);

  const dimensions = {
    architectural:  archDim,
    capability:     capDim,
    workflow:       wfDim,
    agent:          agentDim,
    runtime:        rtDim,
    quality:        qualDim,
    organizational: orgDim,
  };

  const overallScore = _clamp(
    Object.entries(WEIGHTS).reduce((sum, [k, w]) => sum + (dimensions[k].score * w), 0)
  );

  const allIssues = Object.entries(dimensions).flatMap(([dim, d]) =>
    (d.issues || []).map(i => ({ ...i, dimension: dim }))
  );
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  allIssues.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

  const id = _id();
  const entry = {
    id, context, overallScore,
    dimensions: Object.fromEntries(Object.entries(dimensions).map(([k, v]) => [k, { score: v.score }])),
    issues: allIssues,
    reviewOverall: review?.overall || null,
    pendingPatterns: sieStats?.pendingPatterns || 0,
    createdAt: _ts(),
  };

  const d = _load();
  d.analyses.push(entry);
  const scores = d.analyses.map(a => a.overallScore);
  d.stats = { total: d.analyses.length, avgScore: +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) };
  _save(d);

  return { ok: true, analysis: { ...entry, dimensions, issues: allIssues } };
}

function getAnalysis(id) { return _load().analyses.find(a => a.id === id) || null; }

function listAnalyses({ limit = 50 } = {}) {
  const d = _load();
  return { ok: true, analyses: d.analyses.slice(-limit) };
}

function getStats() { return { ...(_load().stats), updatedAt: _load().updatedAt }; }

module.exports = { analyze, getAnalysis, listAnalyses, getStats, WEIGHTS };
