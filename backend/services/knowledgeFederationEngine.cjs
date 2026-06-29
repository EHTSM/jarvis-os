"use strict";
/**
 * knowledgeFederationEngine.cjs — POST-Ω P14 Universal Knowledge Network
 *
 * Federation layer above every existing knowledge source.
 * Does NOT create storage, vectors, or a graph — federates existing ones.
 *
 * SOURCES (25 existing):
 *   knowledgeGraph, knowledgeReasoningEngine, knowledgeQualityEngine,
 *   knowledgeBenchmarkEngine, knowledgePredictionEngine, knowledgeEvolutionEngine,
 *   knowledgeIntelligenceDashboard, researchKnowledgeEngine, autonomousKnowledgeOrg,
 *   continuousLearningEngine, engineeringMemoryEngine, missionMemory,
 *   productionBibleEngine, founderWorkRegistry, engineeringRuleRegistry,
 *   selfImprovementEngine, selfReviewEngine, marketplaceCatalogEngine,
 *   productPlannerEngine, customerJourneyEngine, companyBlueprintEngine,
 *   workforceManager, engineeringReasoningEngine, businessReasoningEngine,
 *   digitalTwinEngine
 *
 * Storage: data/knowledge-federation.json  (federation index only)
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "knowledge-federation.json");

const _try = fn => { try { return fn(); } catch { return null; } };

// ── Source adapters (lazy) ───────────────────────────────────────────────────
const _kg  = () => _try(() => require("./knowledgeGraph.cjs"));
const _kre = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _kqe = () => _try(() => require("./knowledgeQualityEngine.cjs"));
const _kbe = () => _try(() => require("./knowledgeBenchmarkEngine.cjs"));
const _kpe = () => _try(() => require("./knowledgePredictionEngine.cjs"));
const _kev = () => _try(() => require("./knowledgeEvolutionEngine.cjs"));
const _kid = () => _try(() => require("./knowledgeIntelligenceDashboard.cjs"));
const _rke = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _ako = () => _try(() => require("./autonomousKnowledgeOrg.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _eme = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _mm  = () => _try(() => require("./missionMemory.cjs"));
const _pb  = () => _try(() => require("./productionBibleEngine.cjs"));
const _fwr = () => _try(() => require("./founderWorkRegistry.cjs"));
const _err = () => _try(() => require("./engineeringRuleRegistry.cjs"));
const _sie = () => _try(() => require("./selfImprovementEngine.cjs"));
const _sre = () => _try(() => require("./selfReviewEngine.cjs"));
const _mce = () => _try(() => require("./marketplaceCatalogEngine.cjs"));
const _ppe = () => _try(() => require("./productPlannerEngine.cjs"));
const _cje = () => _try(() => require("./customerJourneyEngine.cjs"));
const _bp  = () => _try(() => require("./companyBlueprintEngine.cjs"));
const _wfm = () => _try(() => require("./workforceManager.cjs"));
const _oai = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _obi = () => _try(() => require("./businessReasoningEngine.cjs"));
const _dt  = () => _try(() => require("./digitalTwinEngine.cjs"));

// ── Source catalogue ─────────────────────────────────────────────────────────

const KNOWLEDGE_SOURCES = [
  { id: "knowledge_graph",             domain: "engineering", name: "Knowledge Graph",              service: "knowledgeGraph" },
  { id: "knowledge_reasoning",         domain: "engineering", name: "Knowledge Reasoning Engine",   service: "knowledgeReasoningEngine" },
  { id: "knowledge_quality",           domain: "engineering", name: "Knowledge Quality Engine",     service: "knowledgeQualityEngine" },
  { id: "knowledge_benchmark",         domain: "engineering", name: "Knowledge Benchmark Engine",   service: "knowledgeBenchmarkEngine" },
  { id: "knowledge_prediction",        domain: "engineering", name: "Knowledge Prediction Engine",  service: "knowledgePredictionEngine" },
  { id: "knowledge_evolution",         domain: "engineering", name: "Knowledge Evolution Engine",   service: "knowledgeEvolutionEngine" },
  { id: "knowledge_intelligence",      domain: "engineering", name: "Knowledge Intelligence Dash",  service: "knowledgeIntelligenceDashboard" },
  { id: "research_knowledge",          domain: "research",    name: "Research Knowledge Engine",    service: "researchKnowledgeEngine" },
  { id: "autonomous_knowledge_org",    domain: "knowledge",   name: "Autonomous Knowledge Org",     service: "autonomousKnowledgeOrg" },
  { id: "continuous_learning",         domain: "engineering", name: "Continuous Learning Engine",   service: "continuousLearningEngine" },
  { id: "engineering_memory",          domain: "engineering", name: "Engineering Memory Engine",    service: "engineeringMemoryEngine" },
  { id: "mission_memory",              domain: "mission",     name: "Mission Memory",               service: "missionMemory" },
  { id: "production_bible",            domain: "operations",  name: "Production Bible Engine",      service: "productionBibleEngine" },
  { id: "founder_work_registry",       domain: "operations",  name: "Founder Work Registry",        service: "founderWorkRegistry" },
  { id: "engineering_rule_registry",   domain: "engineering", name: "Engineering Rule Registry",    service: "engineeringRuleRegistry" },
  { id: "self_improvement",            domain: "engineering", name: "Self Improvement Engine",      service: "selfImprovementEngine" },
  { id: "self_review",                 domain: "engineering", name: "Self Review Engine",           service: "selfReviewEngine" },
  { id: "marketplace_catalog",         domain: "marketplace", name: "Marketplace Catalog Engine",   service: "marketplaceCatalogEngine" },
  { id: "product_planner",             domain: "product",     name: "Product Planner Engine",       service: "productPlannerEngine" },
  { id: "customer_journey",            domain: "customer",    name: "Customer Journey Engine",      service: "customerJourneyEngine" },
  { id: "company_blueprint",           domain: "business",    name: "Company Blueprint Engine",     service: "companyBlueprintEngine" },
  { id: "workforce_manager",           domain: "workforce",   name: "Workforce Manager",            service: "workforceManager" },
  { id: "engineering_reasoning",       domain: "engineering", name: "Engineering Reasoning Engine", service: "engineeringReasoningEngine" },
  { id: "business_reasoning",          domain: "business",    name: "Business Reasoning Engine",    service: "businessReasoningEngine" },
  { id: "digital_twin",                domain: "founder",     name: "Digital Twin Engine",          service: "digitalTwinEngine" },
];

// ── Storage ──────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { index: {}, stats: {}, lastFederated: null, updatedAt: null };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!d.index || typeof d.index !== "object") return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  d.updatedAt = new Date().toISOString();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Live source probe ─────────────────────────────────────────────────────────

function _probeSource(src) {
  const loaders = {
    knowledge_graph:           () => { const s = _kg()?.getStats?.() || {}; return { itemCount: (s.totalEdges||0)+(s.totalNodes||0), healthy: true, meta: s }; },
    knowledge_reasoning:       () => { const s = _kre()?.getStats?.() || {}; return { itemCount: s.total||0, healthy: true, meta: { avgScore: s.avgScore } }; },
    knowledge_quality:         () => { const s = _kqe()?.getStats?.() || {}; return { itemCount: s.total||0, healthy: true, meta: s }; },
    knowledge_benchmark:       () => { const s = _kbe()?.getStats?.() || {}; return { itemCount: s.total||0, healthy: true, meta: s }; },
    knowledge_prediction:      () => { const s = _kpe()?.getStats?.() || {}; return { itemCount: s.total||0, healthy: true, meta: s }; },
    knowledge_evolution:       () => { const s = _kev()?.getStats?.() || {}; return { itemCount: s.total||0, healthy: true, meta: s }; },
    knowledge_intelligence:    () => { const d = _kid()?.getDashboard?.() || {}; return { itemCount: d.summary?.totalKnowledgeItems||0, healthy: !!d.ok, meta: {} }; },
    research_knowledge:        () => { const s = _rke()?.getStats?.() || {}; return { itemCount: (s.findingsIndexed||0)+(s.recommendationsGenerated||0), healthy: true, meta: s }; },
    autonomous_knowledge_org:  () => { const s = _ako()?.getOrgStatus?.() || {}; return { itemCount: s.activeDepartments||0, healthy: true, meta: s }; },
    continuous_learning:       () => { const s = _cle()?.getStats?.() || {}; return { itemCount: s.totalLessons||0, healthy: true, meta: { recs: s.totalRecommendations } }; },
    engineering_memory:        () => { const s = _eme()?.getStatistics?.() || {}; return { itemCount: s.totalItems||0, healthy: true, meta: {} }; },
    mission_memory:            () => { const s = _mm()?.getMissionStats?.() || {}; return { itemCount: s.total||0, healthy: true, meta: s }; },
    production_bible:          () => { const b = _pb()?.getBible?.() || {}; return { itemCount: b.workflows?.length||0, healthy: true, meta: { workflows: b.workflows?.length } }; },
    founder_work_registry:     () => { const r = _fwr()?.getRegistry?.() || {}; return { itemCount: r.workflows?.length||0, healthy: true, meta: {} }; },
    engineering_rule_registry: () => { const s = _err()?.getStats?.() || {}; return { itemCount: s.total||0, healthy: true, meta: s }; },
    self_improvement:          () => { const s = _sie()?.getStatistics?.() || {}; return { itemCount: s.cumulativeStats?.totalLessons||0, healthy: true, meta: { patterns: s.pendingPatterns } }; },
    self_review:               () => { const r = _sre()?.getLatestReview?.() || {}; return { itemCount: r.overall ? 1 : 0, healthy: !!r.overall, meta: { score: r.overall } }; },
    marketplace_catalog:       () => { const s = _mce()?.getStats?.() || {}; return { itemCount: s.total||0, healthy: true, meta: { published: s.published } }; },
    product_planner:           () => { const s = _ppe()?.getStats?.() || {}; return { itemCount: s.total||0, healthy: true, meta: s }; },
    customer_journey:          () => { const s = _cje()?.getStats?.() || {}; return { itemCount: s.total||0, healthy: true, meta: s }; },
    company_blueprint:         () => { const s = _bp()?.getStats?.() || {}; return { itemCount: s.total||0, healthy: true, meta: s }; },
    workforce_manager:         () => { const s = _wfm()?.getStats?.() || {}; return { itemCount: s.total||0, healthy: true, meta: s }; },
    engineering_reasoning:     () => { const s = _oai()?.getStats?.() || {}; return { itemCount: s.total||0, healthy: true, meta: s }; },
    business_reasoning:        () => { const s = _obi()?.getStats?.() || {}; return { itemCount: s.total||0, healthy: true, meta: s }; },
    digital_twin:              () => { const s = _dt()?.getStats?.() || {}; return { itemCount: (s.totalDecisions||0)+(s.totalScenarios||0), healthy: true, meta: s }; },
  };
  try {
    const probe = loaders[src.id];
    if (!probe) return { itemCount: 0, healthy: false, error: "no loader" };
    return probe();
  } catch (e) {
    return { itemCount: 0, healthy: false, error: e.message };
  }
}

// ── Core: federate ────────────────────────────────────────────────────────────

function federate() {
  const d   = _load();
  const ts  = new Date().toISOString();
  let totalItems = 0;
  let healthySources = 0;

  KNOWLEDGE_SOURCES.forEach(src => {
    const probe = _probeSource(src);
    d.index[src.id] = {
      ...src,
      itemCount:   probe.itemCount,
      healthy:     probe.healthy,
      lastProbed:  ts,
      meta:        probe.meta || {},
    };
    totalItems += probe.itemCount;
    if (probe.healthy) healthySources++;
  });

  d.stats = {
    totalSources:   KNOWLEDGE_SOURCES.length,
    healthySources,
    degradedSources: KNOWLEDGE_SOURCES.length - healthySources,
    totalItems,
    coveragePct: Math.round((healthySources / KNOWLEDGE_SOURCES.length) * 100),
    byDomain: _aggregateByDomain(d.index),
  };
  d.lastFederated = ts;
  _save(d);

  return {
    ok:    true,
    totalSources:   KNOWLEDGE_SOURCES.length,
    healthySources,
    totalItems,
    coveragePct: d.stats.coveragePct,
    byDomain: d.stats.byDomain,
    federatedAt: ts,
  };
}

function _aggregateByDomain(index) {
  const byDomain = {};
  Object.values(index).forEach(src => {
    if (!byDomain[src.domain]) byDomain[src.domain] = { sources: 0, items: 0, healthy: 0 };
    byDomain[src.domain].sources++;
    byDomain[src.domain].items += src.itemCount || 0;
    if (src.healthy) byDomain[src.domain].healthy++;
  });
  return byDomain;
}

function getSource(sourceId) {
  const d = _load();
  return d.index[sourceId] || null;
}

function listSources({ domain, healthy } = {}) {
  const d   = _load();
  let srcs  = Object.values(d.index);
  if (domain)           srcs = srcs.filter(s => s.domain === domain);
  if (healthy !== undefined) srcs = srcs.filter(s => s.healthy === healthy);
  return { ok: true, sources: srcs, total: srcs.length };
}

function getStats() {
  const d = _load();
  return {
    ...d.stats,
    KNOWLEDGE_SOURCES: KNOWLEDGE_SOURCES.length,
    lastFederated: d.lastFederated,
    updatedAt: d.updatedAt,
  };
}

module.exports = {
  KNOWLEDGE_SOURCES,
  federate,
  getSource,
  listSources,
  getStats,
};
