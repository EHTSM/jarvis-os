"use strict";
/**
 * marketplaceDashboard.cjs — POST-Ω P13 Autonomous Marketplace
 *
 * Pure aggregation dashboard — no new runtime, no new scheduler.
 * Surfaces: marketplace health, published assets, asset quality,
 *           top downloads, certification status, automation coverage,
 *           founder time saved.
 *
 * Reuses: all 5 P13 engines + 24 existing platform services.
 */

const _try  = fn => { try { return fn(); } catch { return null; } };

// ── P13 services ──────────────────────────────────────────────────────────────
const _mce  = () => _try(() => require("./marketplaceCatalogEngine.cjs"));
const _mre  = () => _try(() => require("./marketplaceRecommendationEngine.cjs"));
const _mce2 = () => _try(() => require("./marketplaceCertificationEngine.cjs"));
const _mae  = () => _try(() => require("./marketplaceAutomationEngine.cjs"));
const _mee  = () => _try(() => require("./marketplaceEconomyEngine.cjs"));

// ── Reused platform services ──────────────────────────────────────────────────
const _ms   = () => _try(() => require("./marketplaceService.cjs"));
const _bm   = () => _try(() => require("./browserMarketplace.cjs"));
const _mm   = () => _try(() => require("./modelMarketplace.cjs"));
const _sdk  = () => _try(() => require("./pluginSDK.cjs"));
const _pm   = () => _try(() => require("./pluginManagerService.cjs"));
const _bp   = () => _try(() => require("./companyBlueprintEngine.cjs"));
const _bt   = () => _try(() => require("./businessTemplateEngine.cjs"));
const _cf   = () => _try(() => require("./companyFactory.cjs"));
const _ppe  = () => _try(() => require("./productPlannerEngine.cjs"));
const _pae  = () => _try(() => require("./productArchitectureEngine.cjs"));
const _srev = () => _try(() => require("./selfReviewEngine.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _ben  = () => _try(() => require("./benchmarkEngine.cjs"));
const _pb2  = () => _try(() => require("./productionBibleEngine.cjs"));
const _dv   = () => _try(() => require("./deploymentValidator.cjs"));
const _cle  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _oai  = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _obi  = () => _try(() => require("./businessReasoningEngine.cjs"));
const _okb  = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _ose  = () => _try(() => require("./evolutionReasoningEngine.cjs"));
const _odi  = () => _try(() => require("./visualReasoningEngine.cjs"));
const _fwr  = () => _try(() => require("./founderWorkRegistry.cjs"));
const _exe  = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _wfm  = () => _try(() => require("./workforceManager.cjs"));

const MARKETPLACE_SERVICES_REUSED = 24;

// ── Sections ──────────────────────────────────────────────────────────────────

function _getMarketplaceHealth() {
  const catStats  = _mce()?.getStats?.()  || { total: 0, byType: {}, published: 0 };
  const recStats  = _mre()?.getStats?.()  || { total: 0, avgRelevance: 0 };
  const certStats = _mce2()?.getStats?.() || { total: 0, avgScore: 0, byLevel: {} };
  const autoStats = _mae()?.getStats?.()  || { total: 0, executed: 0, minutesSaved: 0 };

  return {
    totalAssets:         catStats.total,
    publishedAssets:     catStats.published,
    recommendationSessions: recStats.total,
    avgRecommendationScore: recStats.avgRelevance,
    certifiedAssets:     certStats.total,
    avgCertScore:        certStats.avgScore,
    automationsRun:      autoStats.executed,
    automationMinutesSaved: autoStats.minutesSaved,
    byType:              catStats.byType || {},
  };
}

function _getAssetQuality() {
  const certStats = _mce2()?.getStats?.() || { byLevel: {}, avgScore: 0, total: 0 };
  const srevData  = _srev()?.getLatestReview?.() || null;

  return {
    avgCertScore:   certStats.avgScore,
    byLevel:        certStats.byLevel || {},
    platformReview: {
      overall:      srevData?.overall || 0,
      security:     srevData?.scores?.security || 0,
      reliability:  srevData?.scores?.reliability || 0,
      architecture: srevData?.scores?.architecture || 0,
    },
    totalCertified: certStats.total,
  };
}

function _getTopDownloads() {
  const tops = _mee()?.getTopAssets?.({ by: "downloads", limit: 10 }) || { assets: [] };
  return tops.assets || [];
}

function _getAutomationCoverage() {
  const autoStats = _mae()?.getStats?.() || { total: 0, executed: 0, minutesSaved: 0 };
  const catStats  = _mce()?.getStats?.() || { total: 0 };
  const coverage  = catStats.total > 0
    ? Math.round((autoStats.total / catStats.total) * 100) : 0;

  return {
    automationsTotal:    autoStats.total,
    automationsExecuted: autoStats.executed,
    coveragePct:         coverage,
    minutesSaved:        autoStats.minutesSaved,
    actions:             autoStats.AUTOMATION_ACTIONS || [],
  };
}

function _getFounderTimeSaved() {
  const autoStats = _mae()?.getStats?.()  || { minutesSaved: 0 };
  const ecoSnap   = _mee()?.getStats?.()  || { totalROIMinutes: 0 };
  const certStats = _mce2()?.getStats?.() || { total: 0 };
  const catStats  = _mce()?.getStats?.()  || { total: 0 };

  const fromAutomation  = autoStats.minutesSaved || 0;
  const fromROI         = ecoSnap.totalROIMinutes || 0;
  const fromCertification = (certStats.total || 0) * 20; // 20min per manual cert avoided
  const fromDiscovery   = (catStats.total || 0) * 5;  // 5min per manual asset discovery avoided

  const total = fromAutomation + fromROI + fromCertification + fromDiscovery;
  return {
    totalMinutes: total,
    totalHours:   Math.round(total / 60 * 10) / 10,
    bySource: {
      automation:    fromAutomation,
      assetROI:      fromROI,
      certification: fromCertification,
      discovery:     fromDiscovery,
    },
  };
}

// ── Main dashboard ────────────────────────────────────────────────────────────

function getDashboard() {
  const marketplaceHealth  = _getMarketplaceHealth();
  const assetQuality       = _getAssetQuality();
  const topDownloads       = _getTopDownloads();
  const certificationStatus= _mce2()?.getStats?.()  || {};
  const automationCoverage = _getAutomationCoverage();
  const founderTimeSaved   = _getFounderTimeSaved();

  return {
    ok: true,
    summary: {
      marketplaceServicesReused: MARKETPLACE_SERVICES_REUSED,
      totalAssets:               marketplaceHealth.totalAssets,
      publishedAssets:           marketplaceHealth.publishedAssets,
      avgCertScore:              assetQuality.avgCertScore,
      automationCoveragePct:     automationCoverage.coveragePct,
      founderHoursSaved:         founderTimeSaved.totalHours,
      assetTypes:                Object.keys(marketplaceHealth.byType || {}).length,
    },
    marketplaceHealth,
    assetQuality,
    topDownloads,
    certificationStatus,
    automationCoverage,
    founderTimeSaved,
    generatedAt: new Date().toISOString(),
  };
}

// ── Asset detail view ─────────────────────────────────────────────────────────

function getAssetView(assetId) {
  if (!assetId) return { ok: false, error: "assetId required" };
  const asset = _mce()?.getAsset?.(assetId) || null;
  if (!asset)   return { ok: false, error: `asset not found: ${assetId}` };

  const cert   = _mce2()?.getCertificationForAsset?.(assetId) || null;
  const econ   = _mee()?.getAssetEconomy?.(assetId) || null;
  const recs   = _mre()?.listRecommendations?.({ limit: 5 }) || { recommendations: [] };
  const autoH  = _mae()?.listAutomations?.({ assetType: asset.type, limit: 5 }) || { automations: [] };

  return {
    ok: true, assetId,
    asset,
    certification:      cert,
    economy:            econ,
    recentRecommendations: recs.recommendations.length,
    recentAutomations:  autoH.automations.length,
  };
}

// ── Health check (5 P13 + 24 existing) ───────────────────────────────────────

function getMarketplaceSystemHealth() {
  const checks = [
    // P13 services
    { name: "marketplaceCatalogEngine",       ok: !!_mce() },
    { name: "marketplaceRecommendationEngine",ok: !!_mre() },
    { name: "marketplaceCertificationEngine", ok: !!_mce2() },
    { name: "marketplaceAutomationEngine",    ok: !!_mae() },
    { name: "marketplaceEconomyEngine",       ok: !!_mee() },
    { name: "marketplaceDashboard",           ok: true },
    // Existing platform services
    { name: "marketplaceService",             ok: !!_ms() },
    { name: "browserMarketplace",             ok: !!_bm() },
    { name: "modelMarketplace",               ok: !!_mm() },
    { name: "pluginSDK",                      ok: !!_sdk() },
    { name: "pluginManagerService",           ok: !!_pm() },
    { name: "companyBlueprintEngine",         ok: !!_bp() },
    { name: "businessTemplateEngine",         ok: !!_bt() },
    { name: "companyFactory",                 ok: !!_cf() },
    { name: "productPlannerEngine",           ok: !!_ppe() },
    { name: "productArchitectureEngine",      ok: !!_pae() },
    { name: "selfReviewEngine",               ok: !!_srev() },
    { name: "selfImprovementEngine",          ok: !!_sie() },
    { name: "benchmarkEngine",               ok: !!_ben() },
    { name: "productionBibleEngine",          ok: !!_pb2() },
    { name: "deploymentValidator",            ok: !!_dv() },
    { name: "continuousLearningEngine",       ok: !!_cle() },
    { name: "engineeringReasoningEngine",     ok: !!_oai() },
    { name: "businessReasoningEngine",        ok: !!_obi() },
    { name: "knowledgeReasoningEngine",       ok: !!_okb() },
    { name: "evolutionReasoningEngine",       ok: !!_ose() },
    { name: "visualReasoningEngine",          ok: !!_odi() },
    { name: "founderWorkRegistry",            ok: !!_fwr() },
    { name: "autonomousExecutionEngine",      ok: !!_exe() },
    { name: "workforceManager",              ok: !!_wfm() },
  ];

  const healthy  = checks.filter(c => c.ok).length;
  const degraded = checks.filter(c => !c.ok).length;

  return {
    ok:      true,
    total:   checks.length,
    healthy, degraded,
    status:  degraded === 0 ? "operational" : degraded < 5 ? "degraded" : "critical",
    services: checks,
  };
}

module.exports = {
  MARKETPLACE_SERVICES_REUSED,
  getDashboard,
  getAssetView,
  getMarketplaceSystemHealth,
};
