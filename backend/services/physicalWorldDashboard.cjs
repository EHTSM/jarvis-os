"use strict";
/**
 * physicalWorldDashboard.cjs — POST-Ω P17 Physical World Integration
 *
 * Surfaces: Connected Devices, Device Health, Automation Coverage,
 *   Offline Devices, Execution Success, Founder Time Saved.
 *
 * Reuses all 5 P17 engines + 20 existing platform services.
 */

const _try = fn => { try { return fn(); } catch { return null; } };

// ── P17 engines ───────────────────────────────────────────────────────────────
const _dreg  = () => _try(() => require("./deviceRegistryEngine.cjs"));
const _dorch = () => _try(() => require("./deviceOrchestrationEngine.cjs"));
const _ase   = () => _try(() => require("./automationScenarioEngine.cjs"));
const _dhe   = () => _try(() => require("./deviceHealthEngine.cjs"));
const _pwf   = () => _try(() => require("./physicalWorkflowEngine.cjs"));

// ── Existing platform services (20) ──────────────────────────────────────────
const _exe   = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _app   = () => _try(() => require("./approvalEngine.cjs"));
const _wm    = () => _try(() => require("./workspaceMesh.cjs"));
const _wf    = () => _try(() => require("./workforceManager.cjs"));
const _dt    = () => _try(() => require("./digitalTwinEngine.cjs"));
const _kfe   = () => _try(() => require("./knowledgeFederationEngine.cjs"));
const _sie   = () => _try(() => require("./selfImprovementEngine.cjs"));
const _obi   = () => _try(() => require("./businessReasoningEngine.cjs"));
const _er    = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _okb   = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _ose   = () => _try(() => require("./evolutionReasoningEngine.cjs"));
const _eb    = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _rde   = () => _try(() => require("./revenueDiscoveryEngine.cjs"));
const _cal   = () => _try(() => require("./capitalAllocationEngine.cjs"));
const _ian   = () => _try(() => require("./investmentAnalysisEngine.cjs"));
const _pfs   = () => _try(() => require("./portfolioStrategyEngine.cjs"));
const _rsk   = () => _try(() => require("./riskAssessmentEngine.cjs"));
const _iat   = () => _try(() => require("./investmentAutomationEngine.cjs"));
const _che   = () => _try(() => require("./customerHealthEngine.cjs"));
const _rev   = () => _try(() => require("./revenueOS.cjs"));

const PHYSICAL_SERVICES_REUSED = 20;

// ── Section builders ──────────────────────────────────────────────────────────

function _getConnectedDevices() {
  try {
    const s = _dreg()?.getStats?.() || {};
    return {
      total:   s.total  || 0,
      online:  s.online || 0,
      offline: s.offline || 0,
      byAdapter: s.byAdapter || {},
    };
  } catch { return { total: 0, online: 0, offline: 0, byAdapter: {} }; }
}

function _getDeviceHealth() {
  try {
    const s = _dhe()?.getStats?.() || {};
    return {
      avgHealthScore: s.avgHealthScore || 100,
      critical:       s.critical       || 0,
      degraded:       s.degraded       || 0,
      healthy:        s.healthy        || 0,
      HEALTH_DIMENSIONS: s.HEALTH_DIMENSIONS || [],
    };
  } catch { return { avgHealthScore: 100 }; }
}

function _getAutomationCoverage() {
  try {
    const s = _ase()?.getStats?.() || {};
    return {
      totalScenarios:  s.total      || 0,
      builtinScenarios: s.builtins  || 0,
      executions:       s.executions || 0,
      minutesSaved:     s.minutesSaved || 0,
      byTrigger:        s.byTrigger || {},
    };
  } catch { return { totalScenarios: 0 }; }
}

function _getOrchestrationMetrics() {
  try {
    const s = _dorch()?.getStats?.() || {};
    return {
      totalOrchestrations: s.total    || 0,
      succeeded:           s.succeeded || 0,
      failed:              s.failed    || 0,
      avgDevicesPerOrch:   s.avgDevicesPerOrch || 0,
      successRate:         s.total > 0 ? Math.round((s.succeeded / s.total) * 100) : 0,
    };
  } catch { return { totalOrchestrations: 0, successRate: 0 }; }
}

function _getWorkflowMetrics() {
  try {
    const s = _pwf()?.getStats?.() || {};
    return {
      totalWorkflows:       s.total    || 0,
      succeeded:            s.succeeded || 0,
      avgStagesCompleted:   s.avgStagesCompleted || 0,
      WORKFLOW_STAGES:      s.WORKFLOW_STAGES || [],
    };
  } catch { return { totalWorkflows: 0 }; }
}

function _getFounderTimeSaved() {
  try {
    const orchStats  = _dorch()?.getStats?.() || {};
    const aseStats   = _ase()?.getStats?.()   || {};
    const pwfStats   = _pwf()?.getStats?.()   || {};
    const dheStats   = _dhe()?.getStats?.()   || {};

    const fromScenarios    = aseStats.minutesSaved || 0;
    const fromOrchestration = (orchStats.total || 0) * 15;  // 15min per manual orchestration
    const fromWorkflows    = (pwfStats.total || 0) * 30;
    const fromHealthScans  = (dheStats.total || 0) * 5;

    const total = fromScenarios + fromOrchestration + fromWorkflows + fromHealthScans;
    return {
      totalMinutes: total,
      totalHours:   Math.round(total / 60 * 10) / 10,
      bySource: {
        scenarios:    fromScenarios,
        orchestration: fromOrchestration,
        workflows:    fromWorkflows,
        healthScans:  fromHealthScans,
      },
    };
  } catch { return { totalMinutes: 0, totalHours: 0, bySource: {} }; }
}

// ── Main dashboard ────────────────────────────────────────────────────────────

function getDashboard() {
  const connectedDevices    = _getConnectedDevices();
  const deviceHealth        = _getDeviceHealth();
  const automationCoverage  = _getAutomationCoverage();
  const orchestrationMetrics = _getOrchestrationMetrics();
  const workflowMetrics     = _getWorkflowMetrics();
  const founderTimeSaved    = _getFounderTimeSaved();

  return {
    ok: true,
    summary: {
      physicalServicesReused: PHYSICAL_SERVICES_REUSED,
      connectedDevices:       connectedDevices.total,
      onlineDevices:          connectedDevices.online,
      offlineDevices:         connectedDevices.offline,
      avgDeviceHealthScore:   deviceHealth.avgHealthScore,
      automationScenarios:    automationCoverage.totalScenarios,
      executionSuccessRate:   orchestrationMetrics.successRate,
      founderHoursSaved:      founderTimeSaved.totalHours,
    },
    connectedDevices,
    deviceHealth,
    automationCoverage,
    orchestrationMetrics,
    workflowMetrics,
    founderTimeSaved,
    generatedAt: new Date().toISOString(),
  };
}

// ── Pipeline view ─────────────────────────────────────────────────────────────

function getPipelineView() {
  const regStats  = _dreg()?.getStats?.()  || {};
  const dheStats  = _dhe()?.getStats?.()   || {};
  const orchStats = _dorch()?.getStats?.() || {};
  const wfStats   = _pwf()?.getStats?.()   || {};
  const aseStats  = _ase()?.getStats?.()   || {};

  return {
    ok: true,
    pipeline: [
      { step: "Discover",  engine: "deviceRegistryEngine",       items: regStats.total,    status: regStats.total > 0 ? "active" : "idle" },
      { step: "Register",  engine: "deviceRegistryEngine",       items: regStats.total,    status: regStats.total > 0 ? "active" : "idle" },
      { step: "Verify",    engine: "deviceRegistryEngine",       items: regStats.byStatus?.online, status: "active" },
      { step: "Assign",    engine: "workforceManager",           items: null,              status: "delegated" },
      { step: "Execute",   engine: "deviceOrchestrationEngine",  items: orchStats.total,   status: orchStats.total > 0 ? "active" : "idle" },
      { step: "Monitor",   engine: "deviceHealthEngine",         items: dheStats.total,    status: "active" },
      { step: "Recover",   engine: "physicalWorkflowEngine",     items: null,              status: "delegated" },
      { step: "Measure",   engine: "deviceOrchestrationEngine",  items: orchStats.succeeded, status: "active" },
      { step: "Learn",     engine: "selfImprovementEngine",      items: null,              status: "delegated" },
    ],
  };
}

// ── System health ─────────────────────────────────────────────────────────────

function getPhysicalSystemHealth() {
  const checks = [
    // P17 engines
    { name: "deviceRegistryEngine",       ok: !!_dreg() },
    { name: "deviceOrchestrationEngine",  ok: !!_dorch() },
    { name: "automationScenarioEngine",   ok: !!_ase() },
    { name: "deviceHealthEngine",         ok: !!_dhe() },
    { name: "physicalWorkflowEngine",     ok: !!_pwf() },
    { name: "physicalWorldDashboard",     ok: true },
    // Existing platform services (20)
    { name: "autonomousExecutionEngine",  ok: !!_exe() },
    { name: "approvalEngine",             ok: !!_app() },
    { name: "workspaceMesh",              ok: !!_wm() },
    { name: "workforceManager",           ok: !!_wf() },
    { name: "digitalTwinEngine",          ok: !!_dt() },
    { name: "knowledgeFederationEngine",  ok: !!_kfe() },
    { name: "selfImprovementEngine",      ok: !!_sie() },
    { name: "businessReasoningEngine",    ok: !!_obi() },
    { name: "engineeringReasoningEngine", ok: !!_er() },
    { name: "knowledgeReasoningEngine",   ok: !!_okb() },
    { name: "evolutionReasoningEngine",   ok: !!_ose() },
    { name: "engineeringBenchmarkEngine", ok: !!_eb() },
    { name: "revenueDiscoveryEngine",     ok: !!_rde() },
    { name: "capitalAllocationEngine",    ok: !!_cal() },
    { name: "investmentAnalysisEngine",   ok: !!_ian() },
    { name: "portfolioStrategyEngine",    ok: !!_pfs() },
    { name: "riskAssessmentEngine",       ok: !!_rsk() },
    { name: "investmentAutomationEngine", ok: !!_iat() },
    { name: "customerHealthEngine",       ok: !!_che() },
    { name: "revenueOS",                  ok: !!_rev() },
  ];

  const seen    = new Set();
  const deduped = checks.filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true; });
  const healthy  = deduped.filter(c => c.ok).length;
  const degraded = deduped.filter(c => !c.ok).length;

  return {
    ok: true, total: deduped.length, healthy, degraded,
    status:   degraded === 0 ? "operational" : degraded < 5 ? "degraded" : "critical",
    services: deduped,
  };
}

module.exports = {
  PHYSICAL_SERVICES_REUSED,
  getDashboard,
  getPipelineView,
  getPhysicalSystemHealth,
};
