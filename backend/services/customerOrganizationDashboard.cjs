"use strict";
/**
 * customerOrganizationDashboard.cjs — POST-Ω P11 Autonomous Customer Organization
 *
 * Pure aggregation dashboard. No own storage.
 *
 * Displays:
 *   Customer Health, Journey Stage, Renewal Forecast, Churn Risk,
 *   Expansion Opportunities, Support Status, Success Score, Founder Time Saved
 *
 * Aggregates 6 new P11 services + 18+ existing services.
 */

const _try = fn => { try { return fn(); } catch { return null; } };

// P11 services
const _cje  = () => _try(() => require("./customerJourneyEngine.cjs"));
const _che  = () => _try(() => require("./customerHealthEngine.cjs"));
const _cse  = () => _try(() => require("./customerSuccessEngine.cjs"));
const _csup = () => _try(() => require("./customerSupportEngine.cjs"));
const _cae  = () => _try(() => require("./customerAutomationEngine.cjs"));

// Existing services
const _crm  = () => _try(() => require("./crmService.js"));
const _rev  = () => _try(() => require("./revenueOS.cjs"));
const _cs   = () => _try(() => require("./customerSuccess.cjs"));
const _cle  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _ana  = () => _try(() => require("./analyticsService.cjs"));
const _obi  = () => _try(() => require("./businessIntelligenceDashboard.cjs"));
const _okb  = () => _try(() => require("./knowledgeIntelligenceDashboard.cjs"));
const _ose  = () => _try(() => require("./evolutionIntelligenceDashboard.cjs"));
const _exe  = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _apr  = () => _try(() => require("./approvalEngine.cjs"));
const _wm   = () => _try(() => require("./workspaceMesh.cjs"));
const _wos  = () => _try(() => require("./workforceManager.cjs"));
const _dtw  = () => _try(() => require("./digitalTwinEngine.cjs"));
const _fp   = () => _try(() => require("./founderProfileEngine.cjs"));
const _cf   = () => _try(() => require("./companyFactory.cjs"));
const _rpl  = () => _try(() => require("./researchPlanner.cjs"));
const _ent  = () => _try(() => require("./enterpriseOrg.cjs"));
const _plt  = () => _try(() => require("./platformOrg.cjs"));

const CUSTOMER_SERVICES_REUSED = 18;

function getDashboard() {
  // P11 service stats
  const journeyStats  = _cje()?.getStats?.()     || {};
  const healthStats   = _che()?.getStats?.()     || {};
  const successStats  = _cse()?.getStats?.()     || {};
  const supportStats  = _csup()?.getStats?.()    || {};
  const autoStats     = _cae()?.getStats?.()     || {};

  // Existing service data
  const crmStats     = _try(() => _crm()?.getStats?.())                 || {};
  const revExec      = _try(() => _rev()?.getExecutiveRevenueDashboard?.()) || {};
  const csOverview   = _try(() => _cs()?.getOverview?.())               || {};
  const churnRisks   = _try(() => _rev()?.listChurnRisks?.({ limit: 100 })) || [];
  const forecasts    = _try(() => _rev()?.listForecasts?.({ limit: 1 })) || [];
  const healthList   = _try(() => _che()?.listHealthRecords?.({ limit: 10 })) || {};
  const atRiskList   = (healthList?.records || []).filter(r => r.risk === "critical" || r.risk === "high");

  // Stage distribution from journey engine
  const stageDist   = _cje()?.getStageDistribution?.() || {};
  const byStage     = stageDist.stages || {};

  // Revenue snapshot
  const retention   = revExec?.retention || {};
  const revenue     = revExec?.revenue   || {};

  // OBI X business intelligence
  const obiDash     = _try(() => _obi()?.getDashboard?.()) || {};

  // Automation efficiency
  const autoMinSaved = autoStats.minutesSaved || 0;
  const successMS    = supportStats.minutesSaved || 0;
  const totalMS      = autoMinSaved + successMS;

  const founderTimeSaved = {
    totalMinutes: totalMS,
    totalHours:   +(totalMS / 60).toFixed(1),
    bySource: {
      automations: autoMinSaved,
      support:     successMS,
    },
  };

  const summary = {
    customerServicesReused:  CUSTOMER_SERVICES_REUSED,
    totalCustomers:          journeyStats.total || crmStats.total || 0,
    avgHealthScore:          healthStats.avgScore || 0,
    atRiskCount:             healthStats.atRisk || 0,
    churnRiskCount:          churnRisks.length,
    expansionOpportunities:  0, // computed below
    renewalForecast30d:      forecasts[0]?.projections?.["30d"]?.mrr || null,
    supportTicketsOpen:      (supportStats.total || 0) - (supportStats.resolved || 0),
    successScore:            csOverview.avgHealthScore || healthStats.avgScore || 0,
    automationsExecuted:     autoStats.executed || 0,
    churnPrevented:          successStats.churnPrevented || 0,
    byStage,
  };

  // Expansion opportunities = high health + paid customers
  const expRecords = (healthList?.records || []).filter(r => r.overall >= 70 && r.risk === "low");
  summary.expansionOpportunities = expRecords.length;

  return {
    ok: true,
    summary,
    customerHealth: {
      avg:       healthStats.avgScore || 0,
      atRisk:    healthStats.atRisk || 0,
      critical:  atRiskList.filter(r => r.risk === "critical").length,
      high:      atRiskList.filter(r => r.risk === "high").length,
      topAtRisk: atRiskList.slice(0, 5),
    },
    journeyStages:   byStage,
    renewalForecast: {
      mrr30d: forecasts[0]?.projections?.["30d"]?.mrr || null,
      mrr90d: forecasts[0]?.projections?.["90d"]?.mrr || null,
      churnRate: retention?.churnRate || 0,
    },
    churnRisk: {
      total:     churnRisks.length,
      atRisk:    retention?.atRiskCount || 0,
      detections: churnRisks.slice(0, 5),
    },
    expansionOpportunities: {
      count:      expRecords.length,
      customers:  expRecords.slice(0, 5).map(r => r.customerId),
    },
    support: {
      open:      (supportStats.total || 0) - (supportStats.resolved || 0),
      resolved:  supportStats.resolved || 0,
      automated: supportStats.automated || 0,
    },
    successScore:    csOverview.avgHealthScore || healthStats.avgScore || 0,
    businessIntelligence: obiDash.summary || {},
    founderTimeSaved,
  };
}

function getCustomerView(customerId) {
  if (!customerId) return { ok: false, error: "customerId required" };

  const health   = _che()?.getHealthRecord?.(customerId)    || null;
  const journey  = _cje()?.getJourney?.(customerId)         || null;
  const plan     = _cse()?.getPlan?.(customerId)            || null;
  const tickets  = _csup()?.listTickets?.({ customerId, limit: 5 })?.tickets || [];
  const autos    = _cae()?.listAutomations?.({ customerId, limit: 5 })?.automations || [];
  const prediction = _cse()?.predict?.(customerId) || null;

  return {
    ok: true,
    customerId,
    health:      health   ? { score: health.overall, grade: health.grade, risk: health.risk, alerts: health.alerts } : null,
    journey:     journey  ? { stage: journey.stage, nextStage: journey.nextStage, daysInCRM: journey.daysInCRM } : null,
    successPlan: plan     ? { actions: plan.actions?.slice(0, 3), predictions: { churn: plan.predictions?.churn?.probability } } : null,
    openTickets: tickets.filter(t => t.status === "open").length,
    recentAutomations: autos.slice(0, 3),
    predictions: prediction ? {
      churnProb:      prediction.churn?.probability,
      expansionReady: prediction.expansion?.probability > 0.5,
      renewalProb:    prediction.renewal?.probability,
    } : null,
  };
}

function getCustomerOrganizationHealth() {
  const services = [
    // P11 services
    { name: "customerJourneyEngine",       ok: !!_cje()?.getStats },
    { name: "customerHealthEngine",        ok: !!_che()?.getStats },
    { name: "customerSuccessEngine",       ok: !!_cse()?.getStats },
    { name: "customerSupportEngine",       ok: !!_csup()?.getStats },
    { name: "customerAutomationEngine",    ok: !!_cae()?.getStats },
    { name: "customerOrganizationDashboard", ok: true },

    // Existing reused services (18)
    { name: "crmService",                  ok: !!_crm()?.getStats },
    { name: "revenueOS",                   ok: !!_rev()?.getRevenueDashboard },
    { name: "customerSuccess",             ok: !!_cs()?.getOverview },
    { name: "continuousLearningEngine",    ok: !!_cle()?.getStats },
    { name: "analyticsService",            ok: !!_ana()?.getExecutive },
    { name: "businessIntelligenceDashboard", ok: !!_obi()?.getDashboard },
    { name: "knowledgeIntelligenceDashboard",ok: !!_okb()?.getDashboard },
    { name: "evolutionIntelligenceDashboard",ok: !!_ose()?.getDashboard },
    { name: "autonomousExecutionEngine",   ok: !!_exe()?.getStats },
    { name: "approvalEngine",              ok: !!_apr()?.getStats },
    { name: "workspaceMesh",               ok: !!_wm()?.getStats },
    { name: "workforceManager",            ok: !!_wos()?.getStats },
    { name: "digitalTwinEngine",           ok: !!_dtw()?.getStats },
    { name: "founderProfileEngine",        ok: !!_fp()?.getStats },
    { name: "companyFactory",              ok: !!_cf()?.listBlueprints },
    { name: "researchPlanner",             ok: !!_rpl()?.getStats },
    { name: "enterpriseOrg",              ok: !!_ent()?.getOrgStatus },
    { name: "platformOrg",               ok: !!_plt()?.getOrgStatus },
  ];

  const healthy = services.filter(s => s.ok).length;
  return {
    ok: true,
    total:    services.length,
    healthy,
    degraded: services.length - healthy,
    services,
    status:   healthy === services.length ? "operational"
            : healthy > services.length * 0.8 ? "degraded" : "critical",
  };
}

module.exports = { getDashboard, getCustomerView, getCustomerOrganizationHealth, CUSTOMER_SERVICES_REUSED };
