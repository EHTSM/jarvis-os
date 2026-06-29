"use strict";
/**
 * productArchitectureEngine.cjs — POST-Ω P12 Autonomous Product Factory
 *
 * Converts a product plan into a concrete platform architecture:
 * selects existing capabilities, defines layers, computes reuse ratio,
 * generates component map.
 *
 * Reuses: engineeringReasoningEngine (OAI X), visualReasoningEngine (ODI X),
 *         knowledgeReasoningEngine (OKB X), evolutionReasoningEngine (OSE X),
 *         companyBlueprintEngine, selfReviewEngine, benchmarkEngine.
 *
 * Storage: data/product-architectures.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "product-architectures.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _oai = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _odi = () => _try(() => require("./visualReasoningEngine.cjs"));
const _okb = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _ose = () => _try(() => require("./evolutionReasoningEngine.cjs"));
const _cbp = () => _try(() => require("./companyBlueprintEngine.cjs"));
const _srev= () => _try(() => require("./selfReviewEngine.cjs"));
const _ppe = () => _try(() => require("./productPlannerEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `pa_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Platform layer catalogue ──────────────────────────────────────────────────

const PLATFORM_LAYERS = {
  foundation: {
    label:    "Foundation",
    services: ["authMiddleware", "billingService", "accountsRouter", "jwtService"],
  },
  data: {
    label:    "Data Layer",
    services: ["fileStorage (JSON)", "metricsService", "agentRunsStore"],
  },
  intelligence: {
    label:    "Intelligence Layer",
    services: ["engineeringReasoningEngine", "knowledgeReasoningEngine", "evolutionReasoningEngine", "visualReasoningEngine"],
  },
  orchestration: {
    label:    "Orchestration Layer",
    services: ["missionOrchestrator", "workforceManager", "autonomousExecutionEngine", "approvalEngine"],
  },
  workspace: {
    label:    "Workspace Layer",
    services: ["workspaceMesh", "computerController", "companyWorkspaceBuilder"],
  },
  design: {
    label:    "Design Layer",
    services: ["designSystemAI", "continuousDesignObserver", "uxOptimizer", "brandIntelligence"],
  },
  engineering: {
    label:    "Engineering Layer",
    services: ["autonomousEngineeringPipeline", "selfImprovementEngine", "engineeringMemoryEngine", "selfReviewEngine"],
  },
  knowledge: {
    label:    "Knowledge Layer",
    services: ["knowledgeGraph", "continuousLearningEngine", "researchPlanner", "engineeringMemory"],
  },
  deployment: {
    label:    "Deployment Layer",
    services: ["deploymentValidator", "productionBibleEngine", "founderAutomationEngine", "productionInfra"],
  },
};

// ── Reuse score ───────────────────────────────────────────────────────────────

function _computeReuseRatio(selectedLayers, dependencies) {
  const totalPlatformServices = Object.values(PLATFORM_LAYERS)
    .reduce((s, l) => s + l.services.length, 0);
  const usedServices = selectedLayers
    .reduce((s, l) => s + (PLATFORM_LAYERS[l]?.services?.length || 0), 0);
  const reuseRatio = Math.min(1.0, usedServices / totalPlatformServices);
  const duplicationScore = Math.max(0, 100 - Math.round(reuseRatio * 100));
  return { reuseRatio: Math.round(reuseRatio * 100), usedServices, totalPlatformServices, duplicationScore };
}

// ── Layer selection ───────────────────────────────────────────────────────────

function _selectLayers(plan) {
  const text  = `${plan.objective} ${plan.requirements.join(" ")}`.toLowerCase();
  const layers = new Set(["foundation", "data", "intelligence", "engineering", "deployment"]);

  if (plan.dependencies.some(d => d.id === "workspace"))    layers.add("workspace");
  if (plan.dependencies.some(d => d.id === "design")  || /ui|ux|visual|interface/.test(text)) layers.add("design");
  if (plan.dependencies.some(d => d.id === "knowledge"))    layers.add("knowledge");
  if (plan.dependencies.some(d => d.id === "missions") || plan.dependencies.some(d => d.id === "workforce")) layers.add("orchestration");

  return [...layers];
}

// ── Component map ─────────────────────────────────────────────────────────────

function _buildComponentMap(selectedLayers, plan) {
  const components = [];
  selectedLayers.forEach(layerId => {
    const layer = PLATFORM_LAYERS[layerId];
    if (!layer) return;
    layer.services.forEach(svc => {
      components.push({ layer: layerId, service: svc, reused: true, new: false });
    });
  });

  // Add new P12 services (part of product factory itself)
  ["productPlannerEngine", "productArchitectureEngine", "productAssemblyEngine",
   "productValidationEngine", "productReleaseEngine", "productFactoryDashboard"].forEach(svc => {
    components.push({ layer: "product_factory", service: svc, reused: false, new: true });
  });

  return components;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { architectures: [], stats: { total: 0, avgReuseRatio: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.architectures.length > 200) d.architectures = d.architectures.slice(-200);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Core: design ─────────────────────────────────────────────────────────────

function design(planId, { skipReasoning = false } = {}) {
  const plan = _ppe()?.getPlan?.(planId);
  if (!plan) return { ok: false, error: `plan not found: ${planId}` };

  const id   = _id();

  // Layer selection
  const selectedLayers = _selectLayers(plan);

  // Reuse computation
  const reuseData = _computeReuseRatio(selectedLayers, plan.dependencies);

  // Component map
  const componentMap = _buildComponentMap(selectedLayers, plan);

  // Intelligence reasoning from X-layer
  const reasoning = {};
  if (!skipReasoning) {
    try {
      const oaiAnalysis = _oai()?.analyze?.({ context: planId, objective: plan.objective });
      if (oaiAnalysis?.ok) reasoning.engineering = { score: oaiAnalysis.analysis?.dimensions?.architectural || 70, source: "OAI X" };
    } catch {}
    try {
      const okbAnalysis = _okb()?.analyze?.({ context: planId, query: plan.objective });
      if (okbAnalysis?.ok) reasoning.knowledge = { score: okbAnalysis.analysis?.dimensions?.knowledge_quality || 65, source: "OKB X" };
    } catch {}
    try {
      const oseAnalysis = _ose()?.analyze?.({ context: planId });
      if (oseAnalysis?.ok) reasoning.evolution = { score: oseAnalysis.analysis?.dimensions?.capability || 70, source: "OSE X" };
    } catch {}
  }

  // Blueprint generation (reuse companyBlueprintEngine)
  let blueprint = null;
  try {
    const bpResult = _cbp()?.generateBlueprint?.({
      name:        `product_${planId}`,
      description: plan.objective,
      domain:      "product",
      founder:     "autonomous_factory",
    });
    if (bpResult?.ok) blueprint = { id: bpResult.blueprint?.id, templateId: bpResult.blueprint?.templateId };
  } catch {}

  // Self-review for architecture health
  let reviewScore = null;
  try {
    const rev = _srev()?.getLatestReview?.();
    if (rev?.overall) reviewScore = rev.overall;
  } catch {}

  const architecture = {
    id, planId,
    selectedLayers,
    componentMap,
    reuseRatio:         reuseData.reuseRatio,
    duplicationScore:   reuseData.duplicationScore,
    usedServices:       reuseData.usedServices,
    totalServices:      reuseData.totalPlatformServices,
    newServicesCreated: 6, // the 6 P12 services
    blueprint,
    reasoning,
    reviewScore,
    complexity:  plan.complexity?.level || "medium",
    status:      "designed",
    createdAt:   _ts(),
    updatedAt:   _ts(),
  };

  const d = _load();
  d.architectures.push(architecture);
  const all = d.architectures;
  d.stats = {
    total:         all.length,
    avgReuseRatio: Math.round(all.reduce((s, a) => s + (a.reuseRatio || 0), 0) / all.length),
  };
  _save(d);

  return { ok: true, architecture };
}

function getArchitecture(id)     { return _load().architectures.find(a => a.id === id) || null; }
function getArchitectureForPlan(planId) { return _load().architectures.filter(a => a.planId === planId).pop() || null; }
function listArchitectures({ limit = 50 } = {}) {
  const list = _load().architectures;
  return { ok: true, architectures: list.slice(-limit).reverse(), total: list.length };
}
function getStats()              {
  const d = _load();
  return { ...d.stats, PLATFORM_LAYERS: Object.keys(PLATFORM_LAYERS), updatedAt: d.updatedAt };
}

module.exports = {
  PLATFORM_LAYERS, design,
  getArchitecture, getArchitectureForPlan, listArchitectures, getStats,
};
