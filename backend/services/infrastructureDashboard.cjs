"use strict";
/**
 * infrastructureDashboard.cjs — POST-Ω P19 Global Infrastructure Orchestrator
 *
 * Dashboard: Infrastructure Health, Deployment Status, Recovery Status,
 *            Cost Efficiency, Global Regions, Resource Utilization, Founder Time Saved.
 *
 * Pipeline steps: Discover→Register→Assess→Plan→Deploy→Monitor→Optimize→Recover→Audit→Learn
 *
 * Reuses (direct): 5 P19 engines + 20 existing services.
 */

const _try = fn => { try { return fn(); } catch { return null; } };

// P19 engines
const _reg  = () => _try(() => require("./infrastructureRegistryEngine.cjs"));
const _plan = () => _try(() => require("./infrastructurePlannerEngine.cjs"));
const _he   = () => _try(() => require("./infrastructureHealthEngine.cjs"));
const _rec  = () => _try(() => require("./infrastructureRecoveryEngine.cjs"));
const _opt  = () => _try(() => require("./infrastructureOptimizationEngine.cjs"));

// Existing reused services
const _aee  = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _mesh = () => _try(() => require("./workspaceMesh.cjs"));
const _cc   = () => _try(() => require("./computerController.cjs"));
const _cf   = () => _try(() => require("./companyFactory.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _eb   = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _rke  = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _ose  = () => _try(() => require("./evolutionReasoningEngine.cjs"));
const _obi  = () => _try(() => require("./businessReasoningEngine.cjs"));
const _oai  = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _cap  = () => _try(() => require("./capitalAllocationEngine.cjs"));
const _risk = () => _try(() => require("./riskAssessmentEngine.cjs"));
const _inv  = () => _try(() => require("./investmentDashboard.cjs"));
const _rev  = () => _try(() => require("./revenueDashboard.cjs"));
const _sci  = () => _try(() => require("./scientificDiscoveryDashboard.cjs"));
const _wf   = () => _try(() => require("./workforceManager.cjs"));
const _twin = () => _try(() => require("./digitalTwinEngine.cjs"));
const _inn  = () => _try(() => require("./innovationEngine.cjs"));
const _dhe  = () => _try(() => require("./deviceHealthEngine.cjs"));
const _pwf  = () => _try(() => require("./physicalWorkflowEngine.cjs"));

const INFRASTRUCTURE_SERVICES_REUSED = 20;

const PIPELINE_STEPS = [
  { step: "Discover",  engine: "infrastructureRegistryEngine",     description: "Discover all infrastructure resources from existing platform data" },
  { step: "Register",  engine: "infrastructureRegistryEngine",     description: "Register resources into unified control plane" },
  { step: "Assess",    engine: "infrastructureHealthEngine",       description: "Assess current health of all registered resources" },
  { step: "Plan",      engine: "infrastructurePlannerEngine",      description: "Generate infrastructure improvement plans" },
  { step: "Deploy",    engine: "infrastructurePlannerEngine",      description: "Execute plans via Autonomous Execution Engine" },
  { step: "Monitor",   engine: "infrastructureHealthEngine",       description: "Continuously monitor CPU/memory/disk/network/SSL/DNS" },
  { step: "Optimize",  engine: "infrastructureOptimizationEngine", description: "Recommend cost, scaling, consolidation, redundancy improvements" },
  { step: "Recover",   engine: "infrastructureRecoveryEngine",     description: "Autonomously restart, rollback, reroute, isolate or escalate" },
  { step: "Audit",     engine: "infrastructureHealthEngine",       description: "Audit compliance, security posture, and change history" },
  { step: "Learn",     engine: "infrastructureOptimizationEngine", description: "Record innovations and promote optimization rules" },
];

function getDashboard() {
  // Registry
  const regStats = _reg()?.getStats?.() || { total: 0, active: 0, byType: {}, byEnvironment: {}, byRegion: {} };

  // Health
  const healthStats = _he()?.getStats?.() || { avgHealthScore: 0, alertCount: 0, byDimension: {}, deployHealth: 80 };

  // Plans
  const planStats = _plan()?.getStats?.() || { total: 0, byPriority: {} };

  // Recovery
  const recStats = _rec()?.getStats?.() || { total: 0, successful: 0, successRate: 0 };

  // Optimization
  const optStats = _opt()?.getStats?.() || { total: 0, estimatedMonthlySavings: 0 };

  // Investment alignment
  const invDb = _inv()?.getDashboard?.() || {};
  const infraBudget = (invDb.capitalAllocation?.allocations || []).find(a => a.category === "infrastructure");

  // Infrastructure health composite score
  const infraHealth = Math.round(
    (healthStats.avgHealthScore || 0) * 0.4 +
    (recStats.successRate || 0) * 0.3 +
    (Math.min(100, ((regStats.active || 0) / Math.max(regStats.total, 1)) * 100)) * 0.3
  );

  // Regions active
  const activeRegions = Object.entries(regStats.byRegion || {})
    .filter(([, v]) => v > 0)
    .map(([k]) => k);

  // Resource utilization
  const utilization = regStats.total > 0
    ? Math.round((regStats.active / regStats.total) * 100)
    : 0;

  // Cost efficiency: how much of infra budget is active vs idle
  const costEfficiency = utilization;

  // Founder time saved:
  // Each recovery = 45 min manual response avoided
  // Each optimization applied = 60 min manual review avoided
  // Each plan executed = 30 min manual planning avoided
  const recoveriesDone   = recStats.total || 0;
  const optimsApplied    = optStats.applied || 0;
  const plansExecuted    = planStats.executed || 0;
  const founderMinutes   = recoveriesDone * 45 + optimsApplied * 60 + plansExecuted * 30;

  return {
    ok: true,
    summary: {
      infrastructureServicesReused: INFRASTRUCTURE_SERVICES_REUSED,
      infraHealth,
      totalResources:    regStats.total,
      activeResources:   regStats.active,
      activeRegions:     activeRegions.length,
      avgHealthScore:    healthStats.avgHealthScore,
      openAlerts:        healthStats.alertCount,
      costEfficiency,
      estimatedMonthlySavings: optStats.estimatedMonthlySavings,
    },
    resourceRegistry: {
      total:       regStats.total,
      active:      regStats.active,
      byType:      regStats.byType,
      byEnvironment: regStats.byEnvironment,
      byRegion:    regStats.byRegion,
    },
    health: {
      avgScore:    healthStats.avgHealthScore,
      alertCount:  healthStats.alertCount,
      byDimension: healthStats.byDimension,
      deployHealth: healthStats.deployHealth,
    },
    plans: {
      total:      planStats.total,
      critical:   (planStats.byPriority || {}).critical || 0,
      high:       (planStats.byPriority || {}).high || 0,
      executed:   planStats.executed || 0,
    },
    recovery: {
      total:       recStats.total,
      successful:  recStats.successful,
      successRate: recStats.successRate,
      byAction:    recStats.byAction,
    },
    optimization: {
      total:                  optStats.total,
      applied:                optStats.applied,
      estimatedMonthlySavings: optStats.estimatedMonthlySavings,
      byType:                 optStats.byType,
    },
    globalRegions: {
      active:  activeRegions,
      count:   activeRegions.length,
    },
    resourceUtilization: { pct: utilization, active: regStats.active, total: regStats.total },
    founderTimeSaved: {
      totalMinutes: founderMinutes,
      totalHours:   Math.round(founderMinutes / 60 * 10) / 10,
      breakdown: {
        autoRecoveries:     recoveriesDone * 45,
        optimizationsApplied: optimsApplied * 60,
        plansExecuted:      plansExecuted * 30,
      },
    },
  };
}

function getPipelineView() {
  return { ok: true, pipeline: PIPELINE_STEPS, total: PIPELINE_STEPS.length };
}

function getInfrastructureSystemHealth() {
  const services = [
    // P19 engines
    { name: "infrastructureRegistryEngine",     svc: _reg()  },
    { name: "infrastructurePlannerEngine",       svc: _plan() },
    { name: "infrastructureHealthEngine",        svc: _he()   },
    { name: "infrastructureRecoveryEngine",      svc: _rec()  },
    { name: "infrastructureOptimizationEngine",  svc: _opt()  },
    { name: "infrastructureDashboard",           svc: { getStats: () => ({}) } },
    // existing reused
    { name: "autonomousExecutionEngine",         svc: _aee()  },
    { name: "workspaceMesh",                     svc: _mesh() },
    { name: "computerController",                svc: _cc()   },
    { name: "companyFactory",                    svc: _cf()   },
    { name: "selfImprovementEngine",             svc: _sie()  },
    { name: "engineeringBenchmarkEngine",        svc: _eb()   },
    { name: "researchKnowledgeEngine",           svc: _rke()  },
    { name: "evolutionReasoningEngine",          svc: _ose()  },
    { name: "businessReasoningEngine",           svc: _obi()  },
    { name: "engineeringReasoningEngine",        svc: _oai()  },
    { name: "capitalAllocationEngine",           svc: _cap()  },
    { name: "riskAssessmentEngine",              svc: _risk() },
    { name: "investmentDashboard",               svc: _inv()  },
    { name: "revenueDashboard",                  svc: _rev()  },
    { name: "scientificDiscoveryDashboard",      svc: _sci()  },
    { name: "workforceManager",                  svc: _wf()   },
    { name: "digitalTwinEngine",                 svc: _twin() },
    { name: "innovationEngine",                  svc: _inn()  },
    { name: "deviceHealthEngine",                svc: _dhe()  },
    { name: "physicalWorkflowEngine",            svc: _pwf()  },
  ];

  const dedup   = new Map(services.map(s => [s.name, s]));
  const checked = [...dedup.values()].map(({ name, svc }) => ({
    name,
    ok:     !!svc,
    status: svc ? "healthy" : "unavailable",
  }));

  const healthy = checked.filter(s => s.ok).length;
  const status  = healthy === checked.length ? "operational"
    : healthy >= checked.length * 0.8         ? "degraded"
    : "critical";

  return { ok: true, status, healthy, total: checked.length, services: checked };
}

module.exports = {
  INFRASTRUCTURE_SERVICES_REUSED,
  PIPELINE_STEPS,
  getDashboard,
  getPipelineView,
  getInfrastructureSystemHealth,
};
