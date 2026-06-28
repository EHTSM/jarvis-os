"use strict";
/**
 * knowledgePredictionEngine.cjs — OKB X V1 Knowledge Intelligence Evolution
 *
 * Predicts knowledge problems before they become critical:
 *   - missing knowledge
 *   - stale knowledge
 *   - contradictions
 *   - future knowledge demand
 *   - research opportunities
 *   - documentation gaps
 *
 * Reuses: knowledgeQualityEngine, knowledgeReasoningEngine, akoState,
 *         engineeringMemoryEngine, continuousLearningEngine,
 *         memoryIntelligenceEngine, graphReasoningEngine, missionMemory
 *
 * Storage: data/knowledge-predictions.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "knowledge-predictions.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _kqe = () => _try(() => require("./knowledgeQualityEngine.cjs"));
const _kre = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _ako = () => _try(() => require("./akoState.cjs"));
const _em  = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _mi  = () => _try(() => require("./memoryIntelligenceEngine.cjs"));
const _gr  = () => _try(() => require("./graphReasoningEngine.cjs"));
const _mm  = () => _try(() => require("./missionMemory.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `kp_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Prediction functions ──────────────────────────────────────────────────────

function _predictMissingKnowledge(qualScore) {
  const preds  = [];
  const comp   = qualScore?.dimensions?.completeness ?? 55;
  const conn   = qualScore?.dimensions?.connectivity ?? 50;

  if (comp < 40)  preds.push({ type: "critical_gap",          likelihood: 0.90, severity: "critical", description: `Completeness ${comp} — critical knowledge domains undocumented` });
  if (comp < 60)  preds.push({ type: "coverage_gap",          likelihood: 0.80, severity: "high",     description: "Knowledge coverage below 60% — decision-making impaired" });
  if (conn < 40)  preds.push({ type: "isolated_knowledge",    likelihood: 0.75, severity: "high",     description: "Knowledge nodes poorly connected — cross-functional learning blocked" });
  return preds;
}

function _predictStaleKnowledge(qualScore, miReport) {
  const preds  = [];
  const fresh  = qualScore?.dimensions?.freshness ?? 70;
  const stale  = miReport?.staleMemories || 0;

  if (fresh < 50)  preds.push({ type: "mass_staleness",       likelihood: 0.90, severity: "critical", description: `Knowledge freshness ${fresh} — majority of knowledge outdated` });
  if (fresh < 70)  preds.push({ type: "knowledge_drift",      likelihood: 0.75, severity: "high",     description: "Knowledge drifting from current practice — will degrade decisions" });
  if (stale > 30)  preds.push({ type: "archive_required",     likelihood: 0.80, severity: "high",     description: `${stale} stale memories must be archived or refreshed` });
  return preds;
}

function _predictContradictions(qualScore, graphGaps) {
  const preds    = [];
  const consist  = qualScore?.dimensions?.consistency ?? 75;
  const gaps     = Array.isArray(graphGaps) ? graphGaps.length : (graphGaps?.gaps?.length || 0);

  if (consist < 60)  preds.push({ type: "knowledge_conflict",   likelihood: 0.85, severity: "critical", description: "Multiple contradictions detected — conflicting signals in decision chain" });
  if (consist < 75)  preds.push({ type: "partial_conflict",     likelihood: 0.70, severity: "high",     description: "Partial contradictions in knowledge base — reconciliation needed" });
  if (gaps > 5)      preds.push({ type: "graph_contradiction",  likelihood: 0.75, severity: "high",     description: `${gaps} knowledge gaps create likely contradiction paths` });
  return preds;
}

function _predictFutureKnowledgeDemand(missionStats, akoKpis) {
  const preds   = [];
  const total   = missionStats?.total || 0;
  const kpiList = Array.isArray(akoKpis) ? akoKpis : [];
  const captured= kpiList.reduce((s, k) => s + (k.itemsCapured || k.itemsCaptured || 0), 0);

  if (total > 10 && captured < total * 2) {
    preds.push({ type: "demand_outpacing_supply", likelihood: 0.75, severity: "high", description: "Mission volume growing faster than knowledge capture rate" });
  }
  if (total > 20) {
    preds.push({ type: "knowledge_scaling_risk", likelihood: 0.65, severity: "medium", description: "Organization at scale — knowledge management needs automation" });
  }
  return preds;
}

function _predictResearchOpportunities(qualScore, rkeStats) {
  const preds   = [];
  const useful  = qualScore?.dimensions?.usefulness ?? 55;
  const findings= (rkeStats && typeof rkeStats === 'object') ? (rkeStats?.totalFindings || 0) : 0;

  if (useful < 50)  preds.push({ type: "low_utility",              likelihood: 0.80, severity: "high",   description: "Knowledge usefulness below 50 — most knowledge not actionable" });
  if (findings < 5) preds.push({ type: "research_deficit",         likelihood: 0.75, severity: "high",   description: "Fewer than 5 research findings — knowledge base lacks scientific grounding" });
  if (useful >= 75) preds.push({ type: "research_opportunity",     likelihood: 0.65, severity: "info",   description: "High usefulness — ready for advanced research programs" });
  return preds;
}

function _predictDocumentationGaps(qualScore) {
  const preds   = [];
  const explain = qualScore?.dimensions?.explainability ?? 50;
  const conf    = qualScore?.dimensions?.confidence ?? 50;

  if (explain < 50) preds.push({ type: "poor_documentation",    likelihood: 0.85, severity: "high",   description: `Explainability ${explain} — knowledge not documented well enough to transfer` });
  if (conf < 40)    preds.push({ type: "low_confidence_docs",   likelihood: 0.80, severity: "critical", description: "Confidence critically low — knowledge claims unverified and undocumented" });
  if (explain < 65) preds.push({ type: "documentation_gap",     likelihood: 0.70, severity: "medium", description: "Documentation gaps will slow onboarding and knowledge transfer" });
  return preds;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { predictions: [], stats: { total: 0, criticalPredictions: 0, avgRisk: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.predictions.length > 300) d.predictions = d.predictions.slice(-300);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Main predict ──────────────────────────────────────────────────────────────

async function predict(context, { qualityScore, reasoningAnalysis } = {}) {
  context = context || "current_knowledge";

  const hist = _kqe()?.getHistory?.(context, 1)?.history || [];
  const qs   = qualityScore    || hist[hist.length - 1] || { dimensions: {}, overall: 58 };

  const miReport   = _try(() => _mi()?.getIntelligenceReport?.())  || {};
  const graphGaps  = _try(() => _gr()?.findKnowledgeGaps?.())      || {};
  const missionStats = _try(() => _mm()?.getMissionStats?.())      || {};
  const akoKpis    = _try(() => _ako()?.getAllKpis?.())             || [];
  const rkeStats   = _try(() => require("./researchKnowledgeEngine.cjs").getStats?.()) || {};

  const missing       = _predictMissingKnowledge(qs);
  const stale         = _predictStaleKnowledge(qs, miReport);
  const contradictions= _predictContradictions(qs, graphGaps);
  const demand        = _predictFutureKnowledgeDemand(missionStats, akoKpis);
  const research      = _predictResearchOpportunities(qs, rkeStats);
  const docGaps       = _predictDocumentationGaps(qs);

  const all = [...missing, ...stale, ...contradictions, ...demand, ...research, ...docGaps];
  const riskItems = all.filter(p => p.severity !== "info");
  const riskScore = riskItems.length > 0
    ? Math.round(riskItems.reduce((s, p) => s + p.likelihood * (p.severity === "critical" ? 1.5 : p.severity === "high" ? 1.0 : 0.5), 0) / riskItems.length * 100)
    : 5;

  const d = _load();
  const entry = {
    id:             _id(),
    context,
    missingKnowledge:    missing,
    staleKnowledge:      stale,
    contradictions,
    futureKnowledgeDemand: demand,
    researchOpportunities: research,
    documentationGaps:   docGaps,
    total:          all.length,
    criticalCount:  all.filter(p => p.severity === "critical").length,
    opportunityCount: all.filter(p => p.severity === "info").length,
    riskScore,
    predictedAt:    _ts(),
  };

  d.predictions.push(entry);
  d.stats.total++;
  d.stats.criticalPredictions += entry.criticalCount;
  const recent = d.predictions.slice(-20);
  d.stats.avgRisk = +(recent.reduce((s, p) => s + p.riskScore, 0) / recent.length).toFixed(1);
  _save(d);

  return { ok: true, prediction: entry };
}

function getPrediction(id) { return _load().predictions.find(p => p.id === id) || null; }
function listPredictions({ context, limit = 50 } = {}) {
  let preds = _load().predictions;
  if (context) preds = preds.filter(p => p.context === context);
  return { ok: true, predictions: preds.slice(-limit) };
}
function getStats() { return { ..._load().stats, updatedAt: _load().updatedAt }; }

module.exports = { predict, getPrediction, listPredictions, getStats };
