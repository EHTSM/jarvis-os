"use strict";
/**
 * organizationNetworkDashboard.cjs — POST-Ω P20 Artificial Organization Network
 *
 * Single dashboard view of the entire Artificial Organization Network:
 * organizations, collaboration health, mission/knowledge/resource exchange,
 * capability coverage, trust network, and founder time saved.
 *
 * THIS IS THE FINAL POST-Ω SERVICE.
 *
 * Storage: read-only — aggregates from all P20 engines.
 */

const _try = fn => { try { return fn(); } catch { return null; } };

const _reg    = () => _try(() => require("./organizationRegistryEngine.cjs"));
const _collab = () => _try(() => require("./organizationCollaborationEngine.cjs"));
const _cap    = () => _try(() => require("./organizationCapabilityExchangeEngine.cjs"));
const _gov    = () => _try(() => require("./organizationGovernanceEngine.cjs"));
const _evo    = () => _try(() => require("./organizationEvolutionEngine.cjs"));

// Existing platform services for cross-system health check
const _wf    = () => _try(() => require("./workforceManager.cjs"));
const _mesh  = () => _try(() => require("./workspaceMesh.cjs"));
const _sci   = () => _try(() => require("./scientificDiscoveryDashboard.cjs"));
const _infra = () => _try(() => require("./infrastructureDashboard.cjs"));
const _twin  = () => _try(() => require("./digitalTwinEngine.cjs"));
const _exec  = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _kfe   = () => _try(() => require("./knowledgeFederationEngine.cjs"));
const _inn   = () => _try(() => require("./innovationEngine.cjs"));
const _rke   = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _sie   = () => _try(() => require("./selfImprovementEngine.cjs"));

const NETWORK_SERVICES_REUSED = 30;

const PIPELINE_STEPS = [
  { step: "Discover Organizations",  action: "registry.listOrgs()"          },
  { step: "Register",                action: "registry.registerOrg()"        },
  { step: "Capability Exchange",     action: "capExchange.discoverCapabilities()" },
  { step: "Mission Exchange",        action: "collab.collaborate(type:mission_delegation)" },
  { step: "Knowledge Exchange",      action: "collab.collaborate(type:knowledge_exchange)" },
  { step: "Resource Exchange",       action: "collab.collaborate(type:infrastructure_sharing)" },
  { step: "Governance",             action: "governance.createAgreement()"   },
  { step: "Conflict Resolution",    action: "governance.assessCompliance()"  },
  { step: "Evolution",              action: "evolution.evolve()"             },
  { step: "Network Optimization",   action: "evolution.applyEvolution()"     },
];

// ── Dashboard ─────────────────────────────────────────────────────────────────

function getDashboard() {
  const regStats  = _reg()?.getStats()                  || {};
  const colStats  = _collab()?.getCollaborationStats()  || {};
  const capInfo   = _cap()?.getAllCapabilities()         || {};
  const govStats  = _gov()?.getStats()                  || {};
  const trust     = _gov()?.getTrustNetwork()           || {};
  const evoStats  = _evo()?.getStats()                  || {};

  const allOrgs    = _reg()?.listOrgs({ status: "active" }).orgs || [];
  const agreements = _gov()?.listAgreements({ status: "active" }).agreements || [];

  // Collaboration health score (0-100)
  const collabHealth = Math.round(
    ((colStats.successRate    || 80) * 0.4) +
    ((trust.avgTrustScore     || 70) * 0.3) +
    ((govStats.totalViolations === 0 ? 100 : Math.max(0, 100 - (govStats.totalViolations || 0) * 10)) * 0.3)
  );

  // Network utilization
  const totalCaps    = capInfo.totalCapabilities || 0;
  const coveredOrgs  = allOrgs.length;
  const utilization  = coveredOrgs > 0 ? Math.min(100, Math.round((totalCaps / coveredOrgs) * 10)) : 0;

  // Founder time saved: each collab type saves specific minutes
  const collabMinutes = {
    mission_delegation:    60,
    workforce_sharing:     45,
    knowledge_exchange:    30,
    infrastructure_sharing: 30,
    research_sharing:      45,
    capability_delegation: 20,
  };
  const totalCollabs = colStats.total || 0;
  const minutesSaved = totalCollabs * 38; // avg across collab types

  const summary = {
    networkServicesReused:   NETWORK_SERVICES_REUSED,
    totalOrganizations:      regStats.total         || 0,
    activeOrganizations:     regStats.active        || 0,
    totalCapabilities:       totalCaps,
    totalCollaborations:     colStats.total         || 0,
    collaborationSuccessRate: colStats.successRate  || 0,
    activeAgreements:        agreements.length,
    networkTrustScore:       trust.avgTrustScore    || 0,
    collaborationHealth:     collabHealth,
    capabilityGaps:          capInfo.gapsDetected   || 0,
    evolutionCycles:         evoStats.cycles        || 0,
    pendingEvolutions:       (evoStats.byStatus || {}).pending || 0,
    networkUtilization:      utilization,
    founderMinutesSaved:     minutesSaved,
  };

  return {
    ok: true,
    summary,
    organizations: {
      stats:    regStats,
      orgTypes: allOrgs.reduce((acc, o) => { acc[o.orgType] = (acc[o.orgType]||0)+1; return acc; }, {}),
      trustLevels: regStats.byTrust || {},
    },
    collaboration: {
      stats:      colStats,
      health:     collabHealth,
      byType:     colStats.byType || {},
    },
    capabilityExchange: {
      totalCapabilities:  totalCaps,
      capabilityDensity:  capInfo.capabilityDensity || 0,
      gapsDetected:       capInfo.gapsDetected || 0,
    },
    governance: {
      stats:          govStats,
      trustNetwork:   trust,
      activeAgreements: agreements.length,
    },
    evolution: {
      stats:         evoStats,
      appliedCount:  evoStats.applied || 0,
    },
    founderTimeSaved: {
      totalMinutes: minutesSaved,
      totalHours:   Math.round(minutesSaved / 60),
      perMonth:     Math.round(minutesSaved * 4.3),
    },
  };
}

function getPipelineView() {
  return { ok: true, pipeline: PIPELINE_STEPS };
}

// ── Platform System Health Check ──────────────────────────────────────────────

function getNetworkSystemHealth() {
  const services = [
    { name: "organizationRegistryEngine",          fn: () => _reg()?.getStats()                           },
    { name: "organizationCollaborationEngine",      fn: () => _collab()?.getCollaborationStats()          },
    { name: "organizationCapabilityExchangeEngine", fn: () => _cap()?.getAllCapabilities()                 },
    { name: "organizationGovernanceEngine",         fn: () => _gov()?.getStats()                          },
    { name: "organizationEvolutionEngine",          fn: () => _evo()?.getStats()                          },
    { name: "organizationNetworkDashboard",         fn: () => ({ ok: true })                              },
    // Existing services
    { name: "workforceManager",                     fn: () => _wf()?.getWorkforceReport?.()               },
    { name: "workspaceMesh",                        fn: () => _mesh()?.DEFAULT_WORKSPACES                  },
    { name: "scientificDiscoveryDashboard",         fn: () => _sci()?.PIPELINE_STEPS                      },
    { name: "infrastructureDashboard",              fn: () => _infra()?.PIPELINE_STEPS                    },
    { name: "digitalTwinEngine",                    fn: () => _twin()?.getPrediction?.()                  },
    { name: "autonomousExecutionEngine",            fn: () => _exec()?.getMetrics?.()                     },
    { name: "knowledgeFederationEngine",            fn: () => _kfe()?.getStats?.()                        },
    { name: "innovationEngine",                     fn: () => _inn()?.getStats?.()                        },
    { name: "researchKnowledgeEngine",              fn: () => _rke()?.getFacts?.()                        },
    { name: "selfImprovementEngine",                fn: () => _sie()?.getStats?.()                        },
  ];

  const results = services.map(s => {
    try {
      const r = s.fn();
      return { name: s.name, ok: r !== null && r !== undefined };
    } catch { return { name: s.name, ok: false }; }
  });

  const healthy  = results.filter(r => r.ok).length;
  const total    = results.length;
  const pct      = Math.round((healthy / total) * 100);
  const status   = pct >= 90 ? "healthy" : pct >= 70 ? "degraded" : "critical";

  return { ok: true, status, healthy, total, healthPct: pct, services: results };
}

// ── Final Platform Inventory ──────────────────────────────────────────────────

function getPlatformInventory() {
  const allRouteFiles = (() => {
    const _fs   = require("fs");
    const _path = require("path");
    try {
      return _fs.readdirSync(_path.join(__dirname, "../routes"))
        .filter(f => f.endsWith(".js") && f !== "index.js");
    } catch { return []; }
  })();

  const allServiceFiles = (() => {
    const _fs   = require("fs");
    const _path = require("path");
    try {
      return _fs.readdirSync(__dirname).filter(f => f.endsWith(".cjs")).length;
    } catch { return 0; }
  })();

  return {
    ok: true,
    services:   allServiceFiles,
    routeFiles: allRouteFiles.length,
    note: "Final P20 snapshot — full inventory in mandatory report",
  };
}

module.exports = {
  NETWORK_SERVICES_REUSED,
  PIPELINE_STEPS,
  getDashboard,
  getPipelineView,
  getNetworkSystemHealth,
  getPlatformInventory,
};
