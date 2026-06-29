"use strict";
/**
 * scientificDiscoveryDashboard.cjs — POST-Ω P18 Scientific Discovery Engine
 *
 * Dashboard: Research Health, Validated Hypotheses, Experiment Success Rate,
 *            Innovation Score, Publication Queue, Founder Time Saved.
 *
 * Storage: read-only aggregate; no own data file.
 *
 * Reuses (direct): discoveryPlannerEngine, hypothesisEngine,
 *   experimentOrchestratorEngine, publicationEngine, innovationEngine + 20 existing.
 */

const _try = fn => { try { return fn(); } catch { return null; } };

const _dpe = () => _try(() => require("./discoveryPlannerEngine.cjs"));
const _hyp = () => _try(() => require("./hypothesisEngine.cjs"));
const _eoe = () => _try(() => require("./experimentOrchestratorEngine.cjs"));
const _pub = () => _try(() => require("./publicationEngine.cjs"));
const _inn = () => _try(() => require("./innovationEngine.cjs"));

// existing reused
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _eb   = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _rke  = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _kfe  = () => _try(() => require("./knowledgeFederationEngine.cjs"));
const _ose  = () => _try(() => require("./evolutionReasoningEngine.cjs"));
const _obi  = () => _try(() => require("./businessReasoningEngine.cjs"));
const _okb  = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _oai  = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _twin = () => _try(() => require("./digitalTwinEngine.cjs"));
const _aee  = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _wf   = () => _try(() => require("./workforceManager.cjs"));
const _ana  = () => _try(() => require("./analyticsService.cjs"));
const _odi  = () => _try(() => require("./odi/visionQaEngine.cjs"));
const _cle  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _eme  = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _dtw  = () => _try(() => require("./digitalTwinEngine.cjs"));
const _rio  = () => _try(() => require("./researchInstituteDashboard.cjs"));

// P18 services reused from prior sprints
const SCIENTIFIC_SERVICES_REUSED = 20;

const PIPELINE_STEPS = [
  { step: "Observe",              engine: "discoveryPlannerEngine",        description: "Collect platform telemetry signals" },
  { step: "Question",             engine: "discoveryPlannerEngine",        description: "Convert observations to research questions" },
  { step: "Generate Hypothesis",  engine: "hypothesisEngine",              description: "Build testable, falsifiable hypotheses" },
  { step: "Design Experiment",    engine: "experimentOrchestratorEngine",  description: "Design experiment and control groups" },
  { step: "Execute",              engine: "experimentOrchestratorEngine",  description: "Run experiment via Autonomous Execution Engine" },
  { step: "Collect Evidence",     engine: "experimentOrchestratorEngine",  description: "Gather evidence from platform sources" },
  { step: "Analyze",              engine: "experimentOrchestratorEngine",  description: "Analyze evidence support ratio" },
  { step: "Validate",             engine: "experimentOrchestratorEngine",  description: "Validate or refute hypothesis" },
  { step: "Publish",              engine: "publicationEngine",             description: "Generate scientific publications" },
  { step: "Standardize",         engine: "publicationEngine",             description: "Index into research knowledge engine" },
  { step: "Learn",               engine: "innovationEngine",              description: "Record validated innovations and promote rules" },
];

function getDashboard() {
  // Discovery plans
  const dpeStats = _dpe()?.getStats?.() || { total: 0, byDomain: {} };

  // Hypotheses
  const hypStats = _hyp()?.getStats?.() || { total: 0, validated: 0, refuted: 0, avgConfidence: 0 };

  // Experiments
  const eoeStats = _eoe()?.getStats?.() || { total: 0, completed: 0, supported: 0, successRate: 0 };

  // Publications
  const pubStats = _pub()?.getStats?.() || { total: 0, published: 0, standardized: 0, queueLength: 0, byType: {} };

  // Innovations
  const innStats = _inn()?.getStats?.() || { total: 0, innovationScore: 0, breakthroughs: 0 };

  // Research health: composite
  const totalPlans   = dpeStats.total || 1;
  const validatedPct = hypStats.total > 0 ? Math.round(hypStats.validated / hypStats.total * 100) : 0;
  const researchHealth = Math.round(
    (validatedPct * 0.30) +
    (Math.min(100, (eoeStats.successRate || 0)) * 0.30) +
    (Math.min(100, innStats.innovationScore || 0) * 0.20) +
    (Math.min(100, (pubStats.standardized / Math.max(pubStats.total, 1)) * 100) * 0.20)
  );

  // Founder time saved: each validated hypothesis = 60min research time saved
  // Each publication = 90min writing time saved
  // Each innovation applied = 120min implementation research saved
  const innApplied = _inn()?.listInnovations?.({ applied: true, limit: 1000 }) || { total: 0 };
  const founderMinutesSaved =
    (hypStats.validated || 0) * 60 +
    (pubStats.standardized || 0) * 90 +
    (innApplied.total || 0) * 120;

  return {
    ok: true,
    summary: {
      scientificServicesReused: SCIENTIFIC_SERVICES_REUSED,
      researchHealth,
      totalObservations:    totalPlans,
      hypothesesGenerated:  hypStats.total,
      validatedHypotheses:  hypStats.validated,
      experimentsRun:       eoeStats.total,
      experimentSuccessRate: eoeStats.successRate || 0,
      innovationScore:      innStats.innovationScore,
      breakthroughs:        innStats.breakthroughs,
      publicationsGenerated: pubStats.total,
      publicationQueue:     pubStats.queueLength,
    },
    discoveryPlans: {
      total:    dpeStats.total,
      byDomain: dpeStats.byDomain || {},
    },
    hypotheses: {
      total:         hypStats.total,
      validated:     hypStats.validated,
      refuted:       hypStats.refuted,
      avgConfidence: hypStats.avgConfidence || 0,
      bySource:      hypStats.bySource || {},
    },
    experiments: {
      total:       eoeStats.total,
      completed:   eoeStats.completed,
      supported:   eoeStats.supported,
      successRate: eoeStats.successRate || 0,
    },
    publications: {
      total:        pubStats.total,
      standardized: pubStats.standardized,
      queueLength:  pubStats.queueLength,
      byType:       pubStats.byType || {},
    },
    innovations: {
      total:           innStats.total,
      innovationScore: innStats.innovationScore,
      breakthroughs:   innStats.breakthroughs,
      byType:          innStats.byType || {},
      byImpact:        innStats.byImpact || {},
    },
    founderTimeSaved: {
      totalMinutes:   founderMinutesSaved,
      totalHours:     Math.round(founderMinutesSaved / 60 * 10) / 10,
      breakdown: {
        validatedHypotheses: (hypStats.validated || 0) * 60,
        publications:        (pubStats.standardized || 0) * 90,
        appliedInnovations:  (innApplied.total || 0) * 120,
      },
    },
  };
}

function getPipelineView() {
  return {
    ok:       true,
    pipeline: PIPELINE_STEPS,
    total:    PIPELINE_STEPS.length,
  };
}

function getScientificSystemHealth() {
  const services = [
    // P18 engines
    { name: "discoveryPlannerEngine",       svc: _dpe()  },
    { name: "hypothesisEngine",             svc: _hyp()  },
    { name: "experimentOrchestratorEngine", svc: _eoe()  },
    { name: "publicationEngine",            svc: _pub()  },
    { name: "innovationEngine",             svc: _inn()  },
    { name: "scientificDiscoveryDashboard", svc: { getStats: () => ({}) } },
    // existing reused
    { name: "selfImprovementEngine",        svc: _sie()  },
    { name: "engineeringBenchmarkEngine",   svc: _eb()   },
    { name: "researchKnowledgeEngine",      svc: _rke()  },
    { name: "knowledgeFederationEngine",    svc: _kfe()  },
    { name: "evolutionReasoningEngine",     svc: _ose()  },
    { name: "businessReasoningEngine",      svc: _obi()  },
    { name: "knowledgeReasoningEngine",     svc: _okb()  },
    { name: "engineeringReasoningEngine",   svc: _oai()  },
    { name: "digitalTwinEngine",            svc: _twin() },
    { name: "autonomousExecutionEngine",    svc: _aee()  },
    { name: "workforceManager",             svc: _wf()   },
    { name: "analyticsService",             svc: _ana()  },
  ];

  const dedup = new Map(services.map(s => [s.name, s]));
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
  SCIENTIFIC_SERVICES_REUSED,
  PIPELINE_STEPS,
  getDashboard,
  getPipelineView,
  getScientificSystemHealth,
};
