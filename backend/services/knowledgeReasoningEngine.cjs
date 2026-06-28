"use strict";
/**
 * knowledgeReasoningEngine.cjs — OKB X V1 Knowledge Intelligence Evolution
 *
 * 7-dimension reasoning over the platform's organizational knowledge:
 *   semantic, causal, architectural, temporal, mission, cross-domain, organizational
 *
 * Reuses: knowledgeGraph, graphReasoningEngine, engineeringMemoryEngine,
 *         continuousLearningEngine, akoState, missionMemory, researchKnowledgeEngine,
 *         memoryIntelligenceEngine, akoWorkflow
 *
 * Storage: data/knowledge-reasoning.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "knowledge-reasoning.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _kg  = () => _try(() => require("./knowledgeGraph.cjs"));
const _gr  = () => _try(() => require("./graphReasoningEngine.cjs"));
const _em  = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _ako = () => _try(() => require("./akoState.cjs"));
const _mm  = () => _try(() => require("./missionMemory.cjs"));
const _rke = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _mi  = () => _try(() => require("./memoryIntelligenceEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `kr_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Dimension reasoning ───────────────────────────────────────────────────────

function _reasonSemantic(graphStats, kgItems) {
  const nodes       = graphStats?.nodes    || 0;
  const edges       = graphStats?.edges    || 0;
  const density     = nodes > 0 ? Math.min(100, (edges / Math.max(1, nodes)) * 10) : 0;

  let score    = 60;
  const issues = [];

  if (nodes < 10)  { score -= 20; issues.push({ type: "sparse_graph",      severity: "high",   description: `Only ${nodes} knowledge nodes — semantic coverage too thin` }); }
  if (nodes >= 50) { score += 10; }
  if (density < 5) { score -= 10; issues.push({ type: "low_connectivity",  severity: "medium", description: "Knowledge graph poorly connected — semantic links missing" }); }
  if (density > 20){ score += 10; }
  if (kgItems > 100){ score += 5; }

  return { score: Math.max(0, Math.min(100, score)), nodes, edges, density: +density.toFixed(1), issues };
}

function _reasonCausal(graphGaps, cleStats) {
  const gaps  = graphGaps?.gaps?.length   || 0;
  const lessons = cleStats?.totalLessons  || 0;

  let score    = 65;
  const issues = [];

  if (gaps > 10)    { score -= 15; issues.push({ type: "knowledge_gaps",   severity: "high",   description: `${gaps} causal knowledge gaps identified in graph` }); }
  if (gaps > 5)     { score -= 5;  }
  if (lessons < 5)  { score -= 10; issues.push({ type: "low_lessons",      severity: "medium", description: "Fewer than 5 lessons recorded — causal learning immature" }); }
  if (lessons >= 20){ score += 10; }

  return { score: Math.max(0, Math.min(100, score)), gaps, lessons, issues };
}

function _reasonArchitectural(engStats, rkeStats) {
  const items     = engStats?.engineHealth?.knowledge || 0;
  const findings  = rkeStats?.totalFindings           || 0;

  let score    = 65;
  const issues = [];

  if (items < 10)    { score -= 15; issues.push({ type: "thin_eng_memory",  severity: "high",   description: "Engineering memory too sparse for architecture reasoning" }); }
  if (items >= 100)  { score += 10; }
  if (findings < 5)  { score -= 10; issues.push({ type: "few_findings",    severity: "medium", description: "Research findings insufficient for architectural patterns" }); }
  if (findings >= 20){ score += 5;  }

  return { score: Math.max(0, Math.min(100, score)), items, findings, issues };
}

function _reasonTemporal(miReport) {
  const stale     = miReport?.staleMemories  || 0;
  const total     = miReport?.totalMemories  || 0;
  const freshness = total > 0 ? Math.max(0, 100 - (stale / total) * 100) : 70;

  let score    = +freshness.toFixed(1);
  const issues = [];

  if (stale > 20)           { score -= 15; issues.push({ type: "stale_knowledge",   severity: "high",   description: `${stale} stale memory items need refresh` }); }
  if (freshness < 60)       { score -= 10; issues.push({ type: "low_freshness",      severity: "high",   description: `Knowledge freshness ${freshness.toFixed(0)}% — temporal drift detected` }); }
  if (freshness >= 80)      { score += 5;  }

  return { score: Math.max(0, Math.min(100, score)), stale, total, freshness: +freshness.toFixed(1), issues };
}

function _reasonMission(missionStats) {
  const total    = missionStats?.total       || 0;
  const withLearnings = missionStats?.withLearnings || 0;
  const coverage = total > 0 ? (withLearnings / total) * 100 : 0;

  let score    = 65;
  const issues = [];

  if (total < 5)       { score -= 15; issues.push({ type: "few_missions",           severity: "medium", description: "Too few missions to extract knowledge patterns" }); }
  if (coverage < 30)   { score -= 10; issues.push({ type: "low_learning_capture",  severity: "high",   description: `Only ${coverage.toFixed(0)}% of missions captured learnings` }); }
  if (coverage >= 60)  { score += 10; }
  if (total >= 20)     { score += 5;  }

  return { score: Math.max(0, Math.min(100, score)), total, withLearnings, coverage: +coverage.toFixed(1), issues };
}

function _reasonCrossDomain(graphStats, kgRecs) {
  const recs      = kgRecs?.length     || 0;
  const nodeTypes = graphStats?.nodeTypes?.length || 0;

  let score    = 60;
  const issues = [];

  if (nodeTypes < 3)  { score -= 15; issues.push({ type: "narrow_domains",    severity: "high",   description: `Only ${nodeTypes} node types — cross-domain connections limited` }); }
  if (nodeTypes >= 8) { score += 10; }
  if (recs < 3)       { score -= 10; issues.push({ type: "low_cross_recs",   severity: "medium", description: "Few cross-domain recommendations available" }); }
  if (recs >= 10)     { score += 10; }

  return { score: Math.max(0, Math.min(100, score)), recs, nodeTypes, issues };
}

function _reasonOrganizational(akoKpis, playbooks) {
  const kpiList   = Array.isArray(akoKpis) ? akoKpis : [];
  const captured  = kpiList.reduce((s, k) => s + (k.itemsCapured || k.itemsCaptured || 0), 0);
  const validated = kpiList.reduce((s, k) => s + (k.itemsValidated || 0), 0);
  const validRate = captured > 0 ? (validated / captured) * 100 : 0;
  const pbCount   = playbooks?.length || 0;

  let score    = 65;
  const issues = [];

  if (captured < 20)   { score -= 15; issues.push({ type: "low_capture",       severity: "high",   description: `Only ${captured} knowledge items captured across all departments` }); }
  if (validRate < 10)  { score -= 10; issues.push({ type: "low_validation",    severity: "high",   description: `Validation rate ${validRate.toFixed(0)}% — most knowledge unverified` }); }
  if (validRate >= 40) { score += 10; }
  if (pbCount < 3)     { score -= 5;  issues.push({ type: "few_playbooks",    severity: "medium", description: "Fewer than 3 organizational playbooks" }); }
  if (pbCount >= 10)   { score += 5;  }

  return { score: Math.max(0, Math.min(100, score)), captured, validated, validRate: +validRate.toFixed(1), playbooks: pbCount, issues };
}

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

// ── Main analyze ──────────────────────────────────────────────────────────────

async function analyze(context, opts = {}) {
  context = context || "current_knowledge";

  const graphStats   = _try(() => _kg()?.getStats?.())                           || {};
  const graphGaps    = _try(() => _gr()?.findKnowledgeGaps?.())                  || {};
  const engStats     = _try(() => _em()?.getStatistics?.())                      || {};
  const cleStats     = _try(() => { const r = _cle()?.getStats?.(); return r; }) || {};
  const akoKpis      = _try(() => _ako()?.getAllKpis?.())                         || [];
  const playbooks    = _try(() => (_ako()?.listPlaybooks?.())?.playbooks)         || [];
  const missionStats = _try(() => _mm()?.getMissionStats?.())                    || {};
  const rkeStats     = _try(() => _rke()?.getStats?.())                          || {};
  const miReport     = _try(() => _mi()?.getIntelligenceReport?.())              || {};
  const kgItems      = graphStats?.nodes || 0;
  const kgRecs       = _try(() => _gr()?.generateRecommendations?.())            || [];

  const dims = {
    semantic:       _reasonSemantic(graphStats, kgItems),
    causal:         _reasonCausal(graphGaps, cleStats),
    architectural:  _reasonArchitectural(engStats, rkeStats),
    temporal:       _reasonTemporal(miReport),
    mission:        _reasonMission(missionStats),
    cross_domain:   _reasonCrossDomain(graphStats, Array.isArray(kgRecs) ? kgRecs : []),
    organizational: _reasonOrganizational(akoKpis, playbooks),
  };

  const weights = { semantic: 0.20, organizational: 0.20, mission: 0.15, causal: 0.15, architectural: 0.15, temporal: 0.10, cross_domain: 0.05 };
  const overall = Object.entries(weights).reduce((s, [k, w]) => s + (dims[k]?.score || 65) * w, 0);

  const allIssues = Object.values(dims).flatMap(d => d.issues || []);
  const insights  = allIssues
    .sort((a, b) => (a.severity === "critical" ? 0 : a.severity === "high" ? 1 : 2) - (b.severity === "critical" ? 0 : b.severity === "high" ? 1 : 2))
    .slice(0, 5);

  const entry = {
    id:           _id(),
    context,
    dimensions:   dims,
    overallScore: +overall.toFixed(1),
    insights,
    graphNodes:   kgItems,
    playbookCount: playbooks.length,
    analyzedAt:   _ts(),
  };

  const d = _load();
  d.analyses.push(entry);
  d.stats.total++;
  d.stats.avgScore = +(d.analyses.slice(-20).reduce((s, a) => s + a.overallScore, 0) / Math.min(d.analyses.length, 20)).toFixed(1);
  _save(d);

  return { ok: true, analysis: entry };
}

function getAnalysis(id) { return _load().analyses.find(a => a.id === id) || null; }
function listAnalyses({ limit = 50 } = {}) {
  const d = _load();
  return { ok: true, analyses: d.analyses.slice(-limit), total: d.analyses.length };
}
function getStats() { return { ..._load().stats, updatedAt: _load().updatedAt }; }

module.exports = { analyze, getAnalysis, listAnalyses, getStats };
