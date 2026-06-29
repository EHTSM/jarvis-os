"use strict";
/**
 * knowledgeNetworkDashboard.cjs — POST-Ω P14 Universal Knowledge Network
 *
 * Pure aggregation dashboard — surfaces:
 *   Knowledge Coverage, Connected Sources, Cross-domain Links,
 *   Knowledge Freshness, Knowledge Confidence, Federation Health,
 *   Founder Time Saved.
 *
 * Reuses all 5 P14 engines + 25 existing platform services.
 */

const _try = fn => { try { return fn(); } catch { return null; } };

// ── P14 engines ───────────────────────────────────────────────────────────────
const _kfe  = () => _try(() => require("./knowledgeFederationEngine.cjs"));
const _kcor = () => _try(() => require("./knowledgeCorrelationEngine.cjs"));
const _kde  = () => _try(() => require("./knowledgeDiscoveryEngine.cjs"));
const _kgov = () => _try(() => require("./knowledgeGovernanceEngine.cjs"));
const _kex  = () => _try(() => require("./knowledgeExchangeEngine.cjs"));

// ── Existing knowledge platform ───────────────────────────────────────────────
const _kg   = () => _try(() => require("./knowledgeGraph.cjs"));
const _kre  = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _kqe  = () => _try(() => require("./knowledgeQualityEngine.cjs"));
const _kbe  = () => _try(() => require("./knowledgeBenchmarkEngine.cjs"));
const _kpe  = () => _try(() => require("./knowledgePredictionEngine.cjs"));
const _kev  = () => _try(() => require("./knowledgeEvolutionEngine.cjs"));
const _kid  = () => _try(() => require("./knowledgeIntelligenceDashboard.cjs"));
const _rke  = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _ako  = () => _try(() => require("./autonomousKnowledgeOrg.cjs"));
const _cle  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _eme  = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _mm   = () => _try(() => require("./missionMemory.cjs"));
const _pb   = () => _try(() => require("./productionBibleEngine.cjs"));
const _fwr  = () => _try(() => require("./founderWorkRegistry.cjs"));
const _err  = () => _try(() => require("./engineeringRuleRegistry.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _sre  = () => _try(() => require("./selfReviewEngine.cjs"));
const _mce  = () => _try(() => require("./marketplaceCatalogEngine.cjs"));
const _ppe  = () => _try(() => require("./productPlannerEngine.cjs"));
const _cje  = () => _try(() => require("./customerJourneyEngine.cjs"));
const _bp   = () => _try(() => require("./companyBlueprintEngine.cjs"));
const _wfm  = () => _try(() => require("./workforceManager.cjs"));
const _oai  = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _obi  = () => _try(() => require("./businessReasoningEngine.cjs"));
const _dt   = () => _try(() => require("./digitalTwinEngine.cjs"));

const KNOWLEDGE_SERVICES_REUSED = 25;

// ── Section builders ──────────────────────────────────────────────────────────

function _getKnowledgeCoverage() {
  const fedStats  = _kfe()?.getStats?.() || { totalSources: 0, healthySources: 0, coveragePct: 0 };
  const discStats = _kde()?.getStats?.() || { total: 0, byCategory: {} };
  return {
    totalSources:     fedStats.totalSources || 0,
    healthySources:   fedStats.healthySources || 0,
    coveragePct:      fedStats.coveragePct || 0,
    totalDiscoveries: discStats.total || 0,
    byDomain:         fedStats.byDomain || {},
  };
}

function _getConnectedSources() {
  const fedStats = _kfe()?.getStats?.() || {};
  return {
    total:     fedStats.totalSources || 0,
    healthy:   fedStats.healthySources || 0,
    degraded:  (fedStats.totalSources || 0) - (fedStats.healthySources || 0),
    totalItems: fedStats.totalItems || 0,
    byDomain:  fedStats.byDomain || {},
    lastFederated: fedStats.lastFederated || null,
  };
}

function _getCrossDomainLinks() {
  const corStats = _kcor()?.getStats?.() || { total: 0, byType: {}, avgStrength: 0 };
  const exStats  = _kex()?.getStats?.() || { total: 0, itemsExchanged: 0 };
  return {
    totalCorrelations:  corStats.total || 0,
    avgStrength:        corStats.avgStrength || 0,
    byCorrelationType:  corStats.byType || {},
    totalExchanges:     exStats.total || 0,
    itemsExchanged:     exStats.itemsExchanged || 0,
    exchangeChannels:   exStats.EXCHANGE_CHANNELS || 0,
  };
}

function _getKnowledgeFreshness() {
  const govHealth = _kgov()?.getGovernanceHealth?.() || {};
  const govStats  = _kgov()?.getStats?.() || {};
  return {
    avgFreshness:  govHealth.avgFreshness || 0,
    staleItems:    govHealth.staleItems   || 0,
    governed:      govHealth.governed     || 0,
    healthScore:   govHealth.healthScore  || 0,
    byOwner:       govStats.byOwner       || {},
  };
}

function _getKnowledgeConfidence() {
  const govHealth = _kgov()?.getGovernanceHealth?.() || {};
  const kqeStats  = _kqe()?.getStats?.() || {};
  const kreStats  = _kre()?.getStats?.() || {};
  return {
    avgConfidence:  govHealth.avgConfidence || 0,
    lowConfidence:  govHealth.lowConfidence || 0,
    kqeAvgScore:    kqeStats.avgScore       || 0,
    kreAvgScore:    kreStats.avgScore       || 0,
    reviewScore:    _sre()?.getLatestReview?.()?.overall || 0,
  };
}

function _getFederationHealth() {
  const fed = _kfe()?.getStats?.() || {};
  const gov = _kgov()?.getGovernanceHealth?.() || {};
  const cor = _kcor()?.getStats?.() || {};
  return {
    federationCoverage: fed.coveragePct    || 0,
    governanceHealth:   gov.healthScore    || 0,
    correlationStrength: cor.avgStrength   || 0,
    totalKnowledgeItems: fed.totalItems    || 0,
    status: (fed.coveragePct || 0) >= 80 ? "operational" :
            (fed.coveragePct || 0) >= 50 ? "degraded" : "critical",
  };
}

function _getFounderTimeSaved() {
  const exStats   = _kex()?.getStats?.()  || { minutesSaved: 0 };
  const discStats = _kde()?.getStats?.() || { total: 0 };
  const govStats  = _kgov()?.getStats?.() || { total: 0 };
  const fedStats  = _kfe()?.getStats?.() || { totalItems: 0 };

  const fromExchange     = exStats.minutesSaved    || 0;
  const fromDiscovery    = (discStats.total || 0)  * 30; // 30min per manual discovery avoided
  const fromGovernance   = (govStats.total  || 0)  * 10; // 10min per manual governance task avoided
  const fromFederation   = (fedStats.totalSources || 0) * 20; // 20min per source manually checked

  const total = fromExchange + fromDiscovery + fromGovernance + fromFederation;
  return {
    totalMinutes: total,
    totalHours:   Math.round(total / 60 * 10) / 10,
    bySource: {
      exchange:   fromExchange,
      discovery:  fromDiscovery,
      governance: fromGovernance,
      federation: fromFederation,
    },
  };
}

// ── Main dashboard ────────────────────────────────────────────────────────────

function getDashboard() {
  const knowledgeCoverage  = _getKnowledgeCoverage();
  const connectedSources   = _getConnectedSources();
  const crossDomainLinks   = _getCrossDomainLinks();
  const knowledgeFreshness = _getKnowledgeFreshness();
  const knowledgeConfidence= _getKnowledgeConfidence();
  const federationHealth   = _getFederationHealth();
  const founderTimeSaved   = _getFounderTimeSaved();

  return {
    ok: true,
    summary: {
      knowledgeServicesReused:  KNOWLEDGE_SERVICES_REUSED,
      totalSources:             connectedSources.total,
      healthySources:           connectedSources.healthy,
      coveragePct:              knowledgeCoverage.coveragePct,
      totalKnowledgeItems:      connectedSources.totalItems,
      totalCorrelations:        crossDomainLinks.totalCorrelations,
      totalDiscoveries:         knowledgeCoverage.totalDiscoveries,
      avgConfidence:            knowledgeConfidence.avgConfidence,
      founderHoursSaved:        founderTimeSaved.totalHours,
      federationStatus:         federationHealth.status,
    },
    knowledgeCoverage,
    connectedSources,
    crossDomainLinks,
    knowledgeFreshness,
    knowledgeConfidence,
    federationHealth,
    founderTimeSaved,
    generatedAt: new Date().toISOString(),
  };
}

// ── Network pipeline view ─────────────────────────────────────────────────────

function getPipelineView() {
  const fedStats  = _kfe()?.getStats?.()  || {};
  const corStats  = _kcor()?.getStats?.() || {};
  const discStats = _kde()?.getStats?.()  || {};
  const govStats  = _kgov()?.getStats?.() || {};
  const exStats   = _kex()?.getStats?.()  || {};

  return {
    ok: true,
    pipeline: [
      { step: "Discover",   engine: "knowledgeFederationEngine",    items: fedStats.totalSources,   status: fedStats.healthySources > 0 ? "active" : "idle" },
      { step: "Normalize",  engine: "knowledgeGovernanceEngine",    items: govStats.total,          status: govStats.total > 0 ? "active" : "idle" },
      { step: "Correlate",  engine: "knowledgeCorrelationEngine",   items: corStats.total,          status: corStats.total > 0 ? "active" : "idle" },
      { step: "Link",       engine: "knowledgeCorrelationEngine",   items: corStats.total,          status: corStats.avgStrength > 0 ? "active" : "idle" },
      { step: "Govern",     engine: "knowledgeGovernanceEngine",    items: govStats.total,          status: govStats.avgConfidence > 0 ? "active" : "idle" },
      { step: "Publish",    engine: "knowledgeDiscoveryEngine",     items: discStats.total,         status: discStats.total > 0 ? "active" : "idle" },
      { step: "Share",      engine: "knowledgeExchangeEngine",      items: exStats.itemsExchanged,  status: exStats.total > 0 ? "active" : "idle" },
      { step: "Learn",      engine: "continuousLearningEngine",     items: null, status: "delegated" },
      { step: "Improve",    engine: "selfImprovementEngine",        items: null, status: "delegated" },
    ],
  };
}

// ── System health ─────────────────────────────────────────────────────────────

function getNetworkSystemHealth() {
  const checks = [
    // P14 engines
    { name: "knowledgeFederationEngine",   ok: !!_kfe() },
    { name: "knowledgeCorrelationEngine",  ok: !!_kcor() },
    { name: "knowledgeDiscoveryEngine",    ok: !!_kde() },
    { name: "knowledgeGovernanceEngine",   ok: !!_kgov() },
    { name: "knowledgeExchangeEngine",     ok: !!_kex() },
    { name: "knowledgeNetworkDashboard",   ok: true },
    // Existing knowledge services
    { name: "knowledgeGraph",              ok: !!_kg() },
    { name: "knowledgeReasoningEngine",    ok: !!_kre() },
    { name: "knowledgeQualityEngine",      ok: !!_kqe() },
    { name: "knowledgeBenchmarkEngine",    ok: !!_kbe() },
    { name: "knowledgePredictionEngine",   ok: !!_kpe() },
    { name: "knowledgeEvolutionEngine",    ok: !!_kev() },
    { name: "knowledgeIntelligenceDash",   ok: !!_kid() },
    { name: "researchKnowledgeEngine",     ok: !!_rke() },
    { name: "autonomousKnowledgeOrg",      ok: !!_ako() },
    { name: "continuousLearningEngine",    ok: !!_cle() },
    { name: "engineeringMemoryEngine",     ok: !!_eme() },
    { name: "missionMemory",               ok: !!_mm() },
    { name: "productionBibleEngine",       ok: !!_pb() },
    { name: "founderWorkRegistry",         ok: !!_fwr() },
    { name: "engineeringRuleRegistry",     ok: !!_err() },
    { name: "selfImprovementEngine",       ok: !!_sie() },
    { name: "selfReviewEngine",            ok: !!_sre() },
    { name: "marketplaceCatalogEngine",    ok: !!_mce() },
    { name: "productPlannerEngine",        ok: !!_ppe() },
    { name: "customerJourneyEngine",       ok: !!_cje() },
    { name: "companyBlueprintEngine",      ok: !!_bp() },
    { name: "workforceManager",            ok: !!_wfm() },
    { name: "engineeringReasoningEngine",  ok: !!_oai() },
    { name: "businessReasoningEngine",     ok: !!_obi() },
    { name: "digitalTwinEngine",           ok: !!_dt() },
  ];

  const healthy  = checks.filter(c => c.ok).length;
  const degraded = checks.filter(c => !c.ok).length;

  return {
    ok: true,
    total:   checks.length,
    healthy, degraded,
    status:  degraded === 0 ? "operational" : degraded < 5 ? "degraded" : "critical",
    services: checks,
  };
}

module.exports = {
  KNOWLEDGE_SERVICES_REUSED,
  getDashboard,
  getPipelineView,
  getNetworkSystemHealth,
};
