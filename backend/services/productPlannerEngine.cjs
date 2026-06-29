"use strict";
/**
 * productPlannerEngine.cjs — POST-Ω P12 Autonomous Product Factory
 *
 * Converts a raw product objective into structured requirements,
 * a roadmap, complexity estimate, dependency graph, and a research
 * brief. Orchestrates: researchPlanner, engineeringMemoryEngine,
 * continuousLearningEngine, founderWorkRegistry, knowledgeReasoningEngine.
 *
 * Storage: data/product-plans.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "product-plans.json");

const _try  = fn => { try { return fn(); } catch { return null; } };
const _rp   = () => _try(() => require("./researchPlanner.cjs"));
const _em   = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _cle  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _fwr  = () => _try(() => require("./founderWorkRegistry.cjs"));
const _knr  = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _dt   = () => _try(() => require("./digitalTwinEngine.cjs"));
const _srev = () => _try(() => require("./selfReviewEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `pp_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Plan pipeline steps ───────────────────────────────────────────────────────

const PLAN_STEPS = [
  "receive_objective",
  "derive_requirements",
  "research",
  "estimate_complexity",
  "identify_dependencies",
  "generate_roadmap",
  "twin_review",
  "finalize",
];

// ── Complexity scoring ────────────────────────────────────────────────────────

function _estimateComplexity(objective, requirements) {
  const text    = `${objective} ${requirements.join(" ")}`.toLowerCase();
  let score     = 30;
  const signals = {
    auth: /auth|login|oauth|sso/.test(text),
    payments: /payment|billing|stripe|invoice/.test(text),
    realtime: /realtime|websocket|live|socket/.test(text),
    mobile: /mobile|ios|android|app/.test(text),
    ml: /ml|ai|model|predict|train/.test(text),
    integration: /integrat|webhook|api|crm|slack/.test(text),
    multitenancy: /tenant|org|team|workspace/.test(text),
  };
  Object.values(signals).forEach(v => { if (v) score += 10; });
  const level = score < 40 ? "low" : score < 60 ? "medium" : score < 80 ? "high" : "complex";
  return { score, level, signals };
}

// ── Requirement derivation ────────────────────────────────────────────────────

function _deriveRequirements(objective) {
  const text = objective.toLowerCase();
  const reqs = ["User authentication and account management", "Core business logic implementation",
    "Data persistence and retrieval", "API endpoints for client consumption",
    "Error handling and input validation"];

  if (/dashboard|report|analytic/.test(text)) reqs.push("Dashboard with real-time analytics");
  if (/notif|email|alert/.test(text))          reqs.push("Notification and email delivery system");
  if (/pay|billing|subscription/.test(text))   reqs.push("Subscription billing and payment processing");
  if (/mobile|app/.test(text))                 reqs.push("Mobile-responsive or native mobile interface");
  if (/search/.test(text))                     reqs.push("Search and filtering capabilities");
  if (/ai|generat|suggest/.test(text))         reqs.push("AI-powered features and suggestions");
  if (/team|collab|share/.test(text))          reqs.push("Team collaboration and access controls");
  if (/integrat|import|export/.test(text))     reqs.push("Third-party integrations and data import/export");
  return reqs;
}

// ── Dependency identification ─────────────────────────────────────────────────

const PLATFORM_CAPABILITIES = [
  { id: "auth",         label: "Authentication",     service: "billingService + authMiddleware" },
  { id: "missions",     label: "Mission Orchestration", service: "missionOrchestrator" },
  { id: "workforce",    label: "Agent Workforce",    service: "workforceManager" },
  { id: "workspace",    label: "Workspace Mesh",     service: "workspaceMesh" },
  { id: "engineering",  label: "Engineering Pipeline", service: "autonomousEngineeringPipeline" },
  { id: "design",       label: "Design Intelligence", service: "odi-x + designSystemAI" },
  { id: "validation",   label: "Build Validation",   service: "deploymentValidator + selfReviewEngine" },
  { id: "knowledge",    label: "Knowledge Base",     service: "knowledgeReasoningEngine" },
  { id: "research",     label: "Research Institute", service: "researchPlanner" },
  { id: "bible",        label: "Production Bible",   service: "productionBibleEngine" },
];

function _identifyDependencies(objective, requirements) {
  const text = `${objective} ${requirements.join(" ")}`.toLowerCase();
  return PLATFORM_CAPABILITIES.filter(cap => {
    if (cap.id === "auth")        return true;
    if (cap.id === "bible")       return true;
    if (cap.id === "validation")  return true;
    if (cap.id === "engineering") return true;
    if (cap.id === "workspace")   return true;
    if (cap.id === "design" && /design|ui|ux|interface|visual/.test(text))  return true;
    if (cap.id === "knowledge" && /document|knowledge|search/.test(text))   return true;
    if (cap.id === "research" && /research|analys|market/.test(text))       return true;
    if (cap.id === "workforce" && /team|agent|autonom/.test(text))          return true;
    if (cap.id === "missions" && /workflow|automat|orchestrat/.test(text))  return true;
    return false;
  });
}

// ── Roadmap generation ────────────────────────────────────────────────────────

function _generateRoadmap(requirements, complexity) {
  const sprintsBase  = Math.max(2, Math.ceil(requirements.length / 3));
  const sprintCount  = complexity.level === "complex" ? sprintsBase + 2
    : complexity.level === "high" ? sprintsBase + 1 : sprintsBase;

  const phases = [
    { phase: 1, label: "Foundation", items: requirements.slice(0, 2), sprintHours: 40 },
    { phase: 2, label: "Core Features", items: requirements.slice(2, 5), sprintHours: 60 },
  ];
  if (requirements.length > 5) {
    phases.push({ phase: 3, label: "Advanced Features", items: requirements.slice(5), sprintHours: 50 });
  }
  phases.push({ phase: phases.length + 1, label: "Validation & Release", items: ["QA + security review", "Documentation", "Production deployment"], sprintHours: 30 });

  const totalHours   = phases.reduce((s, p) => s + p.sprintHours, 0);
  const estimatedDays= Math.ceil(totalHours / 8);
  return { phases, sprints: sprintCount, totalHours, estimatedDays };
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { plans: [], stats: { total: 0, completed: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.plans.length > 200) d.plans = d.plans.slice(-200);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Core: createPlan ─────────────────────────────────────────────────────────

function createPlan({ objective, context = {}, skipResearch = false } = {}) {
  if (!objective) return { ok: false, error: "objective required" };

  const id   = _id();
  const plan = {
    id, objective, status: "planning",
    steps:         {},
    requirements:  [],
    complexity:    null,
    dependencies:  [],
    roadmap:       null,
    researchBrief: null,
    twinDecision:  null,
    platformReuse: 0,
    minutesSaved:  0,
    context,
    createdAt: _ts(),
    updatedAt: _ts(),
  };

  // Step 1: derive requirements
  plan.steps.receive_objective = { done: true, at: _ts() };
  const requirements = _deriveRequirements(objective);
  plan.requirements = requirements;
  plan.steps.derive_requirements = { done: true, count: requirements.length, at: _ts() };

  // Step 2: research (from research planner + engineering memory)
  let researchBrief = { insights: [], similarProblems: [], lessons: [] };
  if (!skipResearch) {
    try {
      const researchPlan = _rp()?.createPlan?.({ title: objective, domain: "engineering", context: { objective } });
      if (researchPlan?.ok && researchPlan.plan?.id) {
        researchBrief.planId = researchPlan.plan.id;
      }
    } catch {}
    try {
      const similar = _em()?.findSimilarProblems?.(objective);
      if (Array.isArray(similar)) researchBrief.similarProblems = similar.slice(0, 5);
    } catch {}
    try {
      const rawCle  = _cle()?.getRecommendations?.() || {};
      const recs    = Array.isArray(rawCle) ? rawCle : (rawCle.recommendations || []);
      researchBrief.lessons = recs.filter(r => r.status === "open").slice(0, 3)
        .map(r => ({ source: "cle", action: r.action || r.message }));
    } catch {}
  }
  plan.researchBrief = researchBrief;
  plan.steps.research = { done: true, insights: researchBrief.similarProblems.length, at: _ts() };

  // Step 3: estimate complexity
  const complexity  = _estimateComplexity(objective, requirements);
  plan.complexity   = complexity;
  plan.steps.estimate_complexity = { done: true, level: complexity.level, score: complexity.score, at: _ts() };

  // Step 4: identify dependencies (platform capabilities to reuse)
  const deps        = _identifyDependencies(objective, requirements);
  plan.dependencies = deps;
  plan.platformReuse= deps.length;
  plan.steps.identify_dependencies = { done: true, count: deps.length, at: _ts() };

  // Step 5: generate roadmap
  const roadmap     = _generateRoadmap(requirements, complexity);
  plan.roadmap      = roadmap;
  plan.minutesSaved = Math.round(roadmap.totalHours * 0.4); // 40% time saved via platform reuse
  plan.steps.generate_roadmap = { done: true, phases: roadmap.phases.length, estimatedDays: roadmap.estimatedDays, at: _ts() };

  // Step 6: digital twin review (decide is async; call best-effort)
  plan.twinDecision = "approve_plan";
  try {
    const dt = _dt();
    if (dt?.decide) {
      // decide(command: string, opts) — fire-and-forget; don't await in sync context
      Promise.resolve(dt.decide(`approve_plan_${id}`, {
        domain:  "product_planning",
        risk:    complexity.level === "complex" ? "high" : "low",
        context: { complexity: complexity.level, requirements: requirements.length },
      })).then(dec => {
        // Update stored plan asynchronously if twin decides differently
        if (dec?.action && /revision|reject/i.test(dec.action)) {
          const d = _load(); const idx = d.plans.findIndex(p => p.id === id);
          if (idx >= 0) { d.plans[idx].twinDecision = dec.action; d.plans[idx].status = "needs_revision"; _save(d); }
        }
      }).catch(() => {});
    }
  } catch {}
  plan.steps.twin_review = { done: true, decision: plan.twinDecision, at: _ts() };

  plan.status    = plan.twinDecision?.startsWith("approve") ? "approved" : "needs_revision";
  plan.steps.finalize = { done: true, status: plan.status, at: _ts() };
  plan.updatedAt = _ts();

  const d = _load();
  d.plans.push(plan);
  d.stats.total = d.plans.length;
  d.stats.completed = d.plans.filter(p => p.status === "approved").length;
  _save(d);

  return { ok: true, plan };
}

function getPlan(id)             { return _load().plans.find(p => p.id === id) || null; }
function listPlans({ limit = 50, status } = {}) {
  let list = _load().plans;
  if (status) list = list.filter(p => p.status === status);
  return { ok: true, plans: list.slice(-limit).reverse(), total: list.length };
}
function updatePlanStatus(id, status) {
  const d = _load(); const idx = d.plans.findIndex(p => p.id === id);
  if (idx < 0) return { ok: false, error: "plan not found" };
  d.plans[idx].status    = status;
  d.plans[idx].updatedAt = _ts();
  _save(d);
  return { ok: true, plan: d.plans[idx] };
}
function getStats()              { return { ...(_load().stats), PLAN_STEPS, updatedAt: _load().updatedAt }; }

module.exports = { PLAN_STEPS, PLATFORM_CAPABILITIES, createPlan, getPlan, listPlans, updatePlanStatus, getStats };
