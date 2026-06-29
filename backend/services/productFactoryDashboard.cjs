"use strict";
/**
 * productFactoryDashboard.cjs — POST-Ω P12 Autonomous Product Factory
 *
 * Pure aggregation dashboard — no new runtime, no new scheduler.
 * Surfaces: product progress, architecture health, reuse ratio,
 *           engineering progress, validation status, release readiness,
 *           founder time saved.
 *
 * Reuses: all 5 P12 engines + 22 existing platform services.
 *
 * Storage: none (read-only aggregation)
 */

const _try  = fn => { try { return fn(); } catch { return null; } };

// ── P12 services ──────────────────────────────────────────────────────────────
const _ppe  = () => _try(() => require("./productPlannerEngine.cjs"));
const _pae  = () => _try(() => require("./productArchitectureEngine.cjs"));
const _pasm = () => _try(() => require("./productAssemblyEngine.cjs"));
const _pve  = () => _try(() => require("./productValidationEngine.cjs"));
const _pre  = () => _try(() => require("./productReleaseEngine.cjs"));

// ── Reused platform services ──────────────────────────────────────────────────
const _srev = () => _try(() => require("./selfReviewEngine.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _em   = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _ben  = () => _try(() => require("./benchmarkEngine.cjs"));
const _pb   = () => _try(() => require("./productionBibleEngine.cjs"));
const _dv   = () => _try(() => require("./deploymentValidator.cjs"));
const _wfm  = () => _try(() => require("./workforceManager.cjs"));
const _wsm  = () => _try(() => require("./workspaceMesh.cjs"));
const _exe  = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _apr  = () => _try(() => require("./approvalEngine.cjs"));
const _dt   = () => _try(() => require("./digitalTwinEngine.cjs"));
const _mo   = () => _try(() => require("./missionOrchestrator.cjs"));
const _rp   = () => _try(() => require("./researchPlanner.cjs"));
const _cle  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _oaiX = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _odiX = () => _try(() => require("./visualReasoningEngine.cjs"));
const _okbX = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _oseX = () => _try(() => require("./evolutionReasoningEngine.cjs"));
const _cbp  = () => _try(() => require("./companyBlueprintEngine.cjs"));
const _cwb  = () => _try(() => require("./companyWorkspaceBuilder.cjs"));
const _clc  = () => _try(() => require("./companyLifecycleEngine.cjs"));
const _fwr  = () => _try(() => require("./founderWorkRegistry.cjs"));

const PRODUCT_SERVICES_REUSED = 22;

// ── Dashboard sections ────────────────────────────────────────────────────────

function _getProductProgress() {
  const planStats = _ppe()?.getStats?.() || { total: 0, completed: 0 };
  const asmStats  = _pasm()?.getStats?.() || { total: 0, completed: 0 };
  const valStats  = _pve()?.getStats?.() || { total: 0, passed: 0, avgScore: 0 };
  const relStats  = _pre()?.getStats?.() || { total: 0, released: 0, minutesSaved: 0 };

  return {
    plansCreated:        planStats.total,
    plansApproved:       planStats.completed,
    assembliesCompleted: asmStats.completed,
    validationsPassed:   valStats.passed,
    validationAvgScore:  valStats.avgScore,
    releasesReady:       relStats.released,
    totalMinutesSaved:   relStats.minutesSaved + (asmStats.minutesSaved || 0),
  };
}

function _getArchitectureHealth() {
  const archStats = _pae()?.getStats?.() || { total: 0, avgReuseRatio: 0 };
  const review    = _srev()?.getLatestReview?.() || null;
  const sieStats  = _sie()?.getStatistics?.() || null;

  return {
    architecturesDesigned:  archStats.total,
    avgReuseRatio:          archStats.avgReuseRatio,
    platformServicesAvail:  Object.values(_pae()?.PLATFORM_LAYERS || {})
      .reduce((s, l) => s + l.services.length, 0),
    newServicesCreated:     6,
    architecturalHealth:    review?.scores?.architecture || 0,
    autonomyScore:          review?.scores?.autonomy     || 0,
    technicalDebtPoints:    review?.debtPoints           || 0,
    engineeringMaturity:    Math.round((sieStats?.improvementScores?.engineeringMaturity || 0) * 100),
  };
}

function _getEngineeringProgress() {
  const emStats   = _em()?.getStatistics?.() || {};
  const benStats  = _ben()?.getStats?.()     || {};
  const wfStats   = _wfm()?.getStats?.()     || { totalMissions: 0 };
  const exeStats  = _exe()?.getStats?.()     || { total: 0, succeeded: 0 };

  return {
    knowledgeItems:         emStats.totalEntries   || 0,
    benchmarkRuns:          benStats.totalRuns      || 0,
    missionCount:           wfStats.totalMissions   || 0,
    executionsSucceeded:    exeStats.succeeded      || 0,
    executionsTotal:        exeStats.total          || 0,
    successRate:            exeStats.total > 0
      ? Math.round((exeStats.succeeded / exeStats.total) * 100) : 0,
  };
}

function _getValidationStatus() {
  const valStats = _pve()?.getStats?.() || { total: 0, passed: 0, failed: 0, avgScore: 0 };
  const dvReport = _try(() => _dv()?.getLastReport?.()) || null;
  const bibleWfs = _try(() => _pb()?.getBible?.()?.workflows?.length) || 0;

  return {
    total:            valStats.total,
    passed:           valStats.passed,
    failed:           valStats.failed,
    avgScore:         valStats.avgScore,
    dimensions:       valStats.VALIDATION_DIMENSIONS || [],
    deployCheckScore: dvReport?.score || null,
    bibleWorkflows:   bibleWfs,
  };
}

function _getReleaseReadiness() {
  const relStats = _pre()?.getStats?.() || { total: 0, released: 0, pendingApproval: 0 };
  const aprStats = _apr()?.getStats?.() || { total: 0 };
  const dtStats  = _dt()?.getStats?.()  || { decisions: 0 };
  const moStats  = _mo()?.getStatistics?.() || { total: 0, running: 0 };

  return {
    releasesTotal:      relStats.total,
    releasesReady:      relStats.released,
    pendingApproval:    relStats.pendingApproval,
    approvalSessions:   aprStats.total,
    twinDecisions:      dtStats.decisions,
    activeMissions:     moStats.running || 0,
  };
}

function _getFounderTimeSaved() {
  const planStats  = _ppe()?.getStats?.()  || {};
  const relStats   = _pre()?.getStats?.()  || { minutesSaved: 0 };
  const asmStats   = _pasm()?.getStats?.() || { minutesSaved: 0 };
  const valStats   = _pve()?.getStats?.()  || {};

  const fromPlanning       = (planStats.total || 0) * 45;
  const fromAssembly       = asmStats.minutesSaved || 0;
  const fromValidation     = (valStats.passed || 0) * 30;
  const fromRelease        = relStats.minutesSaved || 0;
  const fromPlatformReuse  = (planStats.total || 0) * 60; // per-product reuse savings

  const totalMinutes = fromPlanning + fromAssembly + fromValidation + fromRelease + fromPlatformReuse;

  return {
    totalMinutes,
    totalHours:  Math.round(totalMinutes / 60 * 10) / 10,
    bySource: {
      planning:      fromPlanning,
      assembly:      fromAssembly,
      validation:    fromValidation,
      release:       fromRelease,
      platformReuse: fromPlatformReuse,
    },
    perProduct: Math.round(totalMinutes / Math.max(1, planStats.total || 1)),
  };
}

// ── Main dashboard ────────────────────────────────────────────────────────────

function getDashboard() {
  const productProgress     = _getProductProgress();
  const architectureHealth  = _getArchitectureHealth();
  const engineeringProgress = _getEngineeringProgress();
  const validationStatus    = _getValidationStatus();
  const releaseReadiness    = _getReleaseReadiness();
  const founderTimeSaved    = _getFounderTimeSaved();

  return {
    ok: true,
    summary: {
      productServicesReused:  PRODUCT_SERVICES_REUSED,
      plansCreated:           productProgress.plansCreated,
      releasesReady:          productProgress.releasesReady,
      avgValidationScore:     productProgress.validationAvgScore,
      avgReuseRatio:          architectureHealth.avgReuseRatio,
      engineeringSuccessRate: engineeringProgress.successRate,
      founderHoursSaved:      founderTimeSaved.totalHours,
      minutesSavedPerProduct: founderTimeSaved.perProduct,
      architecturalDuplication: Math.max(0, 100 - architectureHealth.avgReuseRatio),
    },
    productProgress,
    architectureHealth,
    engineeringProgress,
    validationStatus,
    releaseReadiness,
    founderTimeSaved,
    generatedAt: new Date().toISOString(),
  };
}

// ── Per-product view ──────────────────────────────────────────────────────────

function getProductView(planId) {
  if (!planId) return { ok: false, error: "planId required" };

  const plan       = _ppe()?.getPlan?.(planId) || null;
  const arch       = _pae()?.getArchitectureForPlan?.(planId) || null;
  const assembly   = _pasm()?.getAssemblyForPlan?.(planId)   || null;
  const validation = _pve()?.getValidationForPlan?.(planId)  || null;
  const release    = _pre()?.getReleaseForPlan?.(planId)     || null;

  if (!plan) return { ok: false, error: `plan not found: ${planId}` };

  const pipeline = {
    plan:       { status: plan.status,       done: !!plan.status },
    arch:       { status: arch?.status,      done: !!arch },
    assembly:   { status: assembly?.status,  done: assembly?.status === "completed" },
    validation: { status: validation?.status,done: !!validation },
    release:    { status: release?.status,   done: release?.status === "ready" },
  };

  const stagesDone = Object.values(pipeline).filter(s => s.done).length;

  return {
    ok: true,
    planId,
    objective:      plan.objective,
    complexity:     plan.complexity?.level,
    reuseRatio:     arch?.reuseRatio || 0,
    validationScore:validation?.overallScore || null,
    productionReady:validation?.productionReady || false,
    version:        release?.version || null,
    minutesSaved:   (plan.minutesSaved || 0) + (assembly?.minutesSaved || 0) + (release?.minutesSaved || 0),
    pipeline,
    stagesDone,
    stagesTotal:    5,
    completionPct:  Math.round((stagesDone / 5) * 100),
  };
}

// ── Health check (22 + 6 services) ───────────────────────────────────────────

function getProductFactoryHealth() {
  const checks = [
    // P12 services
    { name: "productPlannerEngine",      ok: !!_ppe() },
    { name: "productArchitectureEngine", ok: !!_pae() },
    { name: "productAssemblyEngine",     ok: !!_pasm() },
    { name: "productValidationEngine",   ok: !!_pve() },
    { name: "productReleaseEngine",      ok: !!_pre() },
    { name: "productFactoryDashboard",   ok: true },
    // Platform services reused
    { name: "selfReviewEngine",          ok: !!_srev() },
    { name: "selfImprovementEngine",     ok: !!_sie() },
    { name: "engineeringMemoryEngine",   ok: !!_em() },
    { name: "benchmarkEngine",           ok: !!_ben() },
    { name: "productionBibleEngine",     ok: !!_pb() },
    { name: "deploymentValidator",       ok: !!_dv() },
    { name: "workforceManager",          ok: !!_wfm() },
    { name: "workspaceMesh",             ok: !!_wsm() },
    { name: "autonomousExecutionEngine", ok: !!_exe() },
    { name: "approvalEngine",            ok: !!_apr() },
    { name: "digitalTwinEngine",         ok: !!_dt() },
    { name: "missionOrchestrator",       ok: !!_mo() },
    { name: "researchPlanner",           ok: !!_rp() },
    { name: "continuousLearningEngine",  ok: !!_cle() },
    { name: "engineeringReasoningEngine",ok: !!_oaiX() },
    { name: "visualReasoningEngine",     ok: !!_odiX() },
    { name: "knowledgeReasoningEngine",  ok: !!_okbX() },
    { name: "evolutionReasoningEngine",  ok: !!_oseX() },
    { name: "companyBlueprintEngine",    ok: !!_cbp() },
    { name: "companyWorkspaceBuilder",   ok: !!_cwb() },
    { name: "companyLifecycleEngine",    ok: !!_clc() },
    { name: "founderWorkRegistry",       ok: !!_fwr() },
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
  PRODUCT_SERVICES_REUSED,
  getDashboard,
  getProductView,
  getProductFactoryHealth,
};
