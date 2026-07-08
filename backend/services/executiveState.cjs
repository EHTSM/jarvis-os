"use strict";
/**
 * Executive Operating System — State Layer (LEVEL 6)
 *
 * Persistent store at data/eos/
 * Manages: goals, strategies, missions, decisions, approvals,
 *   budgets, policies, risks, timelines, KPIs, context, reports
 *
 * Zero new infrastructure — delegates reads to all 5 org state layers.
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/eos");
const FILES = {
  state:    path.join(DATA_DIR, "state.json"),
  kpis:     path.join(DATA_DIR, "kpis.json"),
  memory:   path.join(DATA_DIR, "memory.json"),
  reports:  path.join(DATA_DIR, "reports.json"),
  context:  path.join(DATA_DIR, "context.json"),
  policies: path.join(DATA_DIR, "policies.json"),
  budgets:  path.join(DATA_DIR, "budgets.json"),
};

// ── Lazy accessors to org layers ──────────────────────────────────────────────
function _engSt()  { try { return require("./engineeringOrgState.cjs");    } catch { return null; } }
function _bizSt()  { try { return require("./businessOrgState.cjs");       } catch { return null; } }
function _akoSt()  { try { return require("./akoState.cjs");               } catch { return null; } }
function _aeoSt()  { try { return require("./aeoState.cjs");               } catch { return null; } }
function _orch()   { try { return require("./missionOrchestrator.cjs");    } catch { return null; } }
function _mm()     { try { return require("./missionMemory.cjs");          } catch { return null; } }
function _sup()    { try { return require("./agentRuntimeSupervisor.cjs"); } catch { return null; } }
function _obs()    { try { return require("./observabilityEngine.cjs");    } catch { return null; } }
function _bus()    { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _ile()    { try { return require("./improvementLoopEngine.cjs");  } catch { return null; } }
function _shr()    { try { return require("./selfHealingRuntime.cjs");     } catch { return null; } }
function _ca()     { try { return require("./costAnalytics.cjs");          } catch { return null; } }
function _ai()     { try { return require("./aiRegistry.cjs");             } catch { return null; } }
function _le()     { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } }
function _depa()   { try { return require("./deploymentAutopilot.cjs");   } catch { return null; } }

// ── Bootstrap data dir ────────────────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULTS = {
  state: {
    goals: [], strategies: [], execMissions: [], decisions: [],
    approvals: [], risks: [], timelines: [], capabilities: [],
    allocations: [], recoveries: [],
  },
  kpis:     {},
  memory:   [],
  reports:  [],
  context:  { globalObjective: null, activeGoals: [], orgStatus: {}, lastSync: null },
  policies: [],
  budgets:  [],
};

const _cache = {};
function _load(key) {
  if (!_cache[key]) {
    try { _cache[key] = JSON.parse(fs.readFileSync(FILES[key], "utf8")); }
    catch { _cache[key] = JSON.parse(JSON.stringify(DEFAULTS[key])); }
  }
  return _cache[key];
}
function _save(key) {
  try { fs.writeFileSync(FILES[key], JSON.stringify(_cache[key], null, 2)); } catch {}
}

function _s()  { return _load("state"); }
function _k()  { return _load("kpis"); }
function _m()  { return _load("memory"); }
function _r()  { return _load("reports"); }
function _ctx(){ return _load("context"); }
function _pol(){ return _load("policies"); }
function _bud(){ return _load("budgets"); }

const _id = p => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

// ── KPI management ────────────────────────────────────────────────────────────
const DEPT_IDS = [
  "eos_planner","eos_goal","eos_priority","eos_coordinator","eos_mission_planner",
  "eos_resource","eos_decision","eos_approval","eos_timeline","eos_risk",
  "eos_policy","eos_budget","eos_capability","eos_health","eos_recovery",
  "eos_dashboard","eos_command","eos_context","eos_state","eos_orchestrator",
];

function _kpi(deptId) {
  const k = _k();
  if (!k[deptId]) {
    k[deptId] = {
      deptId, goalsCreated: 0, missionsCreated: 0, decisionsResolved: 0,
      approvalsGranted: 0, risksResolved: 0, allocations: 0,
      recoveriesSucceeded: 0, reportGenerated: 0,
      lastTickAt: null, tickCount: 0,
    };
    _save("kpis");
  }
  return k[deptId];
}

function currentQuarter() {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.ceil((d.getMonth()+1)/3)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GOALS
// ═══════════════════════════════════════════════════════════════════════════════

const GOAL_STATUS = ["active","paused","completed","cancelled","failed"];

function createGoal({ title, description = "", priority = "high", kpis = [], deadline = null, tags = [], sourceCommand = null } = {}) {
  if (!title) return { ok: false, error: "title required" };
  const s = _s();
  if (s.goals.some(g => g.title === title && !["completed","cancelled","failed"].includes(g.status)))
    return { ok: false, error: "Duplicate active goal" };
  const goal = {
    id: _id("egoal"), title, description, priority, kpis, deadline, tags, sourceCommand,
    status: "active", quarter: currentQuarter(),
    strategyIds: [], missionIds: [], orgTasks: {},
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    completedAt: null, progress: 0,
  };
  s.goals.push(goal);
  _kpi("eos_goal").goalsCreated++;
  _save("state"); _save("kpis");
  return { ok: true, goal };
}

function listGoals({ status, priority, quarter, limit = 50 } = {}) {
  let list = _s().goals;
  if (status)   list = list.filter(g => g.status === status);
  if (priority) list = list.filter(g => g.priority === priority);
  if (quarter)  list = list.filter(g => g.quarter === quarter);
  return list.slice(-limit).reverse();
}

function getGoal(id) { return _s().goals.find(g => g.id === id) || null; }

function updateGoal(id, patch) {
  const g = _s().goals.find(x => x.id === id);
  if (!g) return { ok: false, error: "Not found" };
  Object.assign(g, patch, { updatedAt: new Date().toISOString() });
  _save("state");
  return { ok: true, goal: g };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STRATEGIES
// ═══════════════════════════════════════════════════════════════════════════════

const ORG_TARGETS = ["engineering","business","knowledge","evolution","odi","executive"];

function createStrategy({ goalId, title, description = "", orgTargets = [], phases = [], estimatedDuration = "4w" } = {}) {
  if (!goalId || !title) return { ok: false, error: "goalId and title required" };
  const strategy = {
    id: _id("estrat"), goalId, title, description, orgTargets, phases,
    estimatedDuration, status: "draft",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    approvedAt: null, completedAt: null,
  };
  _s().strategies.push(strategy);
  // Link to goal
  const goal = getGoal(goalId);
  if (goal) { goal.strategyIds = [...(goal.strategyIds||[]), strategy.id]; _save("state"); }
  _save("state");
  return { ok: true, strategy };
}

function listStrategies({ goalId, status } = {}) {
  let list = _s().strategies;
  if (goalId) list = list.filter(s => s.goalId === goalId);
  if (status) list = list.filter(s => s.status === status);
  return list;
}

function updateStrategy(id, patch) {
  const s = _s().strategies.find(x => x.id === id);
  if (!s) return { ok: false, error: "Not found" };
  Object.assign(s, patch, { updatedAt: new Date().toISOString() });
  _save("state");
  return { ok: true, strategy: s };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTIVE MISSIONS (cross-org)
// ═══════════════════════════════════════════════════════════════════════════════

function createExecMission({ goalId, strategyId, title, description = "", orgTargets = [], priority = "high", subtasks = [] } = {}) {
  if (!title) return { ok: false, error: "title required" };
  // Create in missionOrchestrator
  let orchMission = null;
  try {
    const prefix = title.slice(0, 50);
    const existing = (_mm()?.listMissions({ limit: 300 }) || { missions: [] }).missions
      .find(m => ["active","pending","planned"].includes(m.status) && m.objective?.slice(0,50) === prefix);
    if (!existing) {
      orchMission = _orch()?.createManual({
        objective: title, description, priority,
        subtasks: subtasks.map(t => ({ description: t.description || t })),
        metadata: { goalId, strategyId, orgTargets, source: "executive" },
      });
    } else {
      orchMission = existing;
    }
  } catch {}
  const mission = {
    id: _id("emiss"), goalId, strategyId, title, description, orgTargets, priority,
    subtasks, status: "active", orchMissionId: orchMission?.id || null,
    orgResults: {}, completedOrgs: [], failedOrgs: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    completedAt: null,
  };
  _s().execMissions.push(mission);
  if (goalId) {
    const goal = getGoal(goalId);
    if (goal) { goal.missionIds = [...(goal.missionIds||[]), mission.id]; }
  }
  _kpi("eos_mission_planner").missionsCreated++;
  _save("state"); _save("kpis");
  return { ok: true, mission };
}

function listExecMissions({ goalId, status, orgTarget, limit = 50 } = {}) {
  let list = _s().execMissions;
  if (goalId)    list = list.filter(m => m.goalId === goalId);
  if (status)    list = list.filter(m => m.status === status);
  if (orgTarget) list = list.filter(m => (m.orgTargets||[]).includes(orgTarget));
  return list.slice(-limit).reverse();
}

function getExecMission(id) { return _s().execMissions.find(m => m.id === id) || null; }

function updateExecMission(id, patch) {
  const m = _s().execMissions.find(x => x.id === id);
  if (!m) return { ok: false, error: "Not found" };
  Object.assign(m, patch, { updatedAt: new Date().toISOString() });
  _save("state");
  return { ok: true, mission: m };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DECISIONS
// ═══════════════════════════════════════════════════════════════════════════════

function recordDecision({ goalId, missionId, title, description = "", deptId = "eos_decision", type = "strategic", chosen, alternatives = [], rationale = "" } = {}) {
  if (!title || !chosen) return { ok: false, error: "title and chosen required" };
  const decision = {
    id: _id("edec"), goalId, missionId, title, description, deptId, type, chosen, alternatives, rationale,
    status: "resolved", resolvedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  _s().decisions.push(decision);
  _kpi(deptId).decisionsResolved++;
  _save("state"); _save("kpis");
  return { ok: true, decision };
}

function listDecisions({ goalId, type, limit = 50 } = {}) {
  let list = _s().decisions;
  if (goalId) list = list.filter(d => d.goalId === goalId);
  if (type)   list = list.filter(d => d.type === type);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVALS
// ═══════════════════════════════════════════════════════════════════════════════

function requestApproval({ goalId, missionId, title, requiredBy = "eos_orchestrator", autoApprove = false, threshold = 0.8 } = {}) {
  if (!title) return { ok: false, error: "title required" };
  const approval = {
    id: _id("eappr"), goalId, missionId, title, requiredBy,
    status: autoApprove ? "approved" : "pending",
    autoApprove, threshold,
    createdAt: new Date().toISOString(), resolvedAt: autoApprove ? new Date().toISOString() : null,
    resolvedBy: autoApprove ? "auto" : null,
  };
  _s().approvals.push(approval);
  if (autoApprove) _kpi("eos_approval").approvalsGranted++;
  _save("state"); _save("kpis");
  return { ok: true, approval };
}

function resolveApproval(id, { approved = true, resolvedBy = "eos_orchestrator", reason = "" } = {}) {
  const a = _s().approvals.find(x => x.id === id);
  if (!a) return { ok: false, error: "Not found" };
  a.status = approved ? "approved" : "rejected";
  a.resolvedBy = resolvedBy; a.reason = reason;
  a.resolvedAt = new Date().toISOString();
  if (approved) _kpi("eos_approval").approvalsGranted++;
  _save("state"); _save("kpis");
  return { ok: true, approval: a };
}

function listApprovals({ status, goalId } = {}) {
  let list = _s().approvals;
  if (status) list = list.filter(a => a.status === status);
  if (goalId) list = list.filter(a => a.goalId === goalId);
  return list.slice(-50).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// RISKS
// ═══════════════════════════════════════════════════════════════════════════════

const RISK_SEVERITY = ["low","medium","high","critical"];

function raiseRisk({ goalId, missionId, title, description = "", severity = "medium", source = "executive", mitigations = [] } = {}) {
  if (!title) return { ok: false, error: "title required" };
  const risk = {
    id: _id("erisk"), goalId, missionId, title, description, severity, source, mitigations,
    status: "active", createdAt: new Date().toISOString(), resolvedAt: null,
  };
  _s().risks.push(risk);
  _save("state");
  return { ok: true, risk };
}

function resolveRisk(id, { resolution = "" } = {}) {
  const r = _s().risks.find(x => x.id === id);
  if (!r) return { ok: false, error: "Not found" };
  r.status = "resolved"; r.resolution = resolution; r.resolvedAt = new Date().toISOString();
  _kpi("eos_risk").risksResolved++;
  _save("state"); _save("kpis");
  return { ok: true, risk: r };
}

function listRisks({ goalId, status, severity } = {}) {
  let list = _s().risks;
  if (goalId)   list = list.filter(r => r.goalId === goalId);
  if (status)   list = list.filter(r => r.status === status);
  if (severity) list = list.filter(r => r.severity === severity);
  return list.slice(-50).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMELINES
// ═══════════════════════════════════════════════════════════════════════════════

function createTimeline({ goalId, title, phases = [], estimatedEnd = null } = {}) {
  if (!goalId || !title) return { ok: false, error: "goalId and title required" };
  const timeline = {
    id: _id("etl"), goalId, title,
    phases: phases.map((p, i) => ({
      id: _id("etlph"), order: i, name: p.name || p, status: "planned",
      orgTarget: p.orgTarget, estimatedDays: p.estimatedDays || 7,
      startedAt: null, completedAt: null,
    })),
    estimatedEnd, status: "active",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _s().timelines.push(timeline);
  _save("state");
  return { ok: true, timeline };
}

function advanceTimeline(timelineId, phaseId) {
  const tl = _s().timelines.find(t => t.id === timelineId);
  if (!tl) return { ok: false, error: "Not found" };
  const ph = tl.phases.find(p => p.id === phaseId);
  if (!ph) return { ok: false, error: "Phase not found" };
  if (ph.status === "planned") { ph.status = "active"; ph.startedAt = new Date().toISOString(); }
  else if (ph.status === "active") { ph.status = "completed"; ph.completedAt = new Date().toISOString(); }
  tl.updatedAt = new Date().toISOString();
  _save("state");
  return { ok: true, timeline: tl, phase: ph };
}

function listTimelines({ goalId } = {}) {
  let list = _s().timelines;
  if (goalId) list = list.filter(t => t.goalId === goalId);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POLICIES
// ═══════════════════════════════════════════════════════════════════════════════

function createPolicy({ title, description = "", scope = "global", rules = [], priority = 50, enabled = true } = {}) {
  if (!title) return { ok: false, error: "title required" };
  const pol = _pol();
  if (pol.some(p => p.title === title && p.enabled)) return { ok: false, error: "Duplicate active policy" };
  const policy = {
    id: _id("epol"), title, description, scope, rules, priority, enabled,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  pol.push(policy);
  _save("policies");
  return { ok: true, policy };
}

function listPolicies({ scope, enabled } = {}) {
  let list = _pol();
  if (scope !== undefined) list = list.filter(p => p.scope === scope);
  if (enabled !== undefined) list = list.filter(p => p.enabled === enabled);
  return list;
}

function evaluatePolicy(context = {}) {
  const active = _pol().filter(p => p.enabled).sort((a,b) => b.priority - a.priority);
  const violations = [];
  for (const p of active) {
    for (const rule of (p.rules || [])) {
      if (rule.type === "budget_cap" && context.budget > rule.limit) violations.push({ policy: p.id, rule, value: context.budget });
      if (rule.type === "org_limit" && context.activeOrgs > rule.limit) violations.push({ policy: p.id, rule, value: context.activeOrgs });
    }
  }
  return { ok: true, violations, policies: active.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUDGETS
// ═══════════════════════════════════════════════════════════════════════════════

function createBudget({ goalId, title, totalUsd = 0, breakdown = {}, period = "quarter" } = {}) {
  if (!goalId || !title) return { ok: false, error: "goalId and title required" };
  const budget = {
    id: _id("ebdg"), goalId, title, totalUsd, breakdown, period,
    spentUsd: 0, remainingUsd: totalUsd,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _bud().push(budget);
  _save("budgets");
  _kpi("eos_budget").allocations++;
  _save("kpis");
  return { ok: true, budget };
}

function allocateBudget(budgetId, { orgTarget, amountUsd = 0, description = "" } = {}) {
  const b = _bud().find(x => x.id === budgetId);
  if (!b) return { ok: false, error: "Not found" };
  if (amountUsd > b.remainingUsd) return { ok: false, error: "Insufficient budget" };
  b.spentUsd += amountUsd; b.remainingUsd -= amountUsd;
  b.breakdown[orgTarget] = (b.breakdown[orgTarget] || 0) + amountUsd;
  b.updatedAt = new Date().toISOString();
  _save("budgets");
  return { ok: true, budget: b };
}

function listBudgets({ goalId } = {}) {
  let list = _bud();
  if (goalId) list = list.filter(b => b.goalId === goalId);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALLOCATIONS (org resource assignments)
// ═══════════════════════════════════════════════════════════════════════════════

function allocateResource({ goalId, missionId, orgTarget, resource, amount = 1, priority = "high" } = {}) {
  if (!orgTarget || !resource) return { ok: false, error: "orgTarget and resource required" };
  const alloc = {
    id: _id("ealloc"), goalId, missionId, orgTarget, resource, amount, priority,
    status: "active", allocatedAt: new Date().toISOString(), releasedAt: null,
  };
  _s().allocations.push(alloc);
  _kpi("eos_resource").allocations++;
  _save("state"); _save("kpis");
  return { ok: true, allocation: alloc };
}

function releaseResource(allocId) {
  const a = _s().allocations.find(x => x.id === allocId);
  if (!a) return { ok: false, error: "Not found" };
  a.status = "released"; a.releasedAt = new Date().toISOString();
  _save("state");
  return { ok: true, allocation: a };
}

function listAllocations({ goalId, orgTarget, status } = {}) {
  let list = _s().allocations;
  if (goalId)    list = list.filter(a => a.goalId === goalId);
  if (orgTarget) list = list.filter(a => a.orgTarget === orgTarget);
  if (status)    list = list.filter(a => a.status === status);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT (global executive context)
// ═══════════════════════════════════════════════════════════════════════════════

function getContext() { return _ctx(); }

function updateContext(patch) {
  Object.assign(_ctx(), patch, { lastSync: new Date().toISOString() });
  _save("context");
  return _ctx();
}

function syncOrgStatus() {
  const ctx = _ctx();
  ctx.orgStatus = {};
  // Engineering
  try { const d = _engSt()?.getDashboard(); ctx.orgStatus.engineering = { workItems: d?.workItems?.total, velocity: d?.kpis?.velocity || 0 }; } catch {}
  // Business
  try { const d = _bizSt()?.getDashboard(); ctx.orgStatus.business = { mrr: d?.revenue?.mrr, winRate: d?.pipeline?.winRate, deals: d?.pipeline?.total }; } catch {}
  // Knowledge
  try { const d = _akoSt()?.getDashboard(); ctx.orgStatus.knowledge = { items: d?.knowledge?.total, validated: d?.knowledge?.validated, playbooks: d?.playbooks?.total }; } catch {}
  // Evolution
  try { const d = _aeoSt()?.getDashboard(); ctx.orgStatus.evolution = { evolutions: d?.evolutions?.total, kept: d?.evolutions?.kept, avgImpact: d?.evolutions?.avgImpact }; } catch {}
  // Runtime
  try { const s = _shr()?.getStatus?.(); ctx.orgStatus.runtime = { healed: s?.healedTotal, failed: s?.failedTotal }; } catch {}
  // Agent Supervisor
  try { const s = _sup()?.getSupervisorStatus?.(); const agents = _sup()?.listAgents?.() || []; ctx.orgStatus.agents = { total: agents.length, running: agents.filter(a => a.status === "running").length }; } catch {}
  ctx.lastSync = new Date().toISOString();
  _save("context");
  return ctx;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY & REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

// Unbounded — every EOS department tick can call addMemory(), and this store
// was never trimmed. It grew to 99MB+/4M+ entries over time, and the first
// _m() call in a fresh process (the module cache starts empty) parses that
// entire file synchronously — a major contributor to the startup OOM. Cap it
// the same way continuousLearningEngine.cjs caps lessons/recommendations.
const MAX_MEMORY_ENTRIES = 2000;

function addMemory({ deptId, type, title, detail = "", tags = [] } = {}) {
  if (!deptId || !title) return { ok: false, error: "deptId and title required" };
  const entry = { id: _id("emem"), deptId, type, title, detail, tags, createdAt: new Date().toISOString() };
  const mem = _m();
  mem.push(entry);
  if (mem.length > MAX_MEMORY_ENTRIES) mem.splice(0, mem.length - MAX_MEMORY_ENTRIES);
  _save("memory");
  return { ok: true, entry };
}

function listMemory({ deptId, type, limit = 50 } = {}) {
  let list = _m();
  if (deptId) list = list.filter(x => x.deptId === deptId);
  if (type)   list = list.filter(x => x.type === type);
  return list.slice(-limit).reverse();
}

function createReport({ title, deptId = "eos_orchestrator", type = "executive", data = {}, summary = "" } = {}) {
  if (!title || !deptId) return { ok: false, error: "title and deptId required" };
  const report = {
    id: _id("erpt"), title, deptId, type, data, summary,
    createdAt: new Date().toISOString(),
  };
  _r().push(report);
  _kpi(deptId).reportGenerated = (_kpi(deptId).reportGenerated || 0) + 1;
  _save("reports"); _save("kpis");
  return { ok: true, report };
}

function listReports({ deptId, type, limit = 20 } = {}) {
  let list = _r();
  if (deptId) list = list.filter(r => r.deptId === deptId);
  if (type)   list = list.filter(r => r.type === type);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// KPIs
// ═══════════════════════════════════════════════════════════════════════════════

function getKpi(deptId)      { return _kpi(deptId); }
function getAllKpis()         { return Object.values(_k()); }
function updateKpi(deptId, patch) { Object.assign(_kpi(deptId), patch); _save("kpis"); }

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL HEALTH CHECK (aggregates all 5 orgs)
// ═══════════════════════════════════════════════════════════════════════════════

function getGlobalHealth() {
  const health = { score: 100, orgs: {}, risks: [], agents: {}, runtime: {} };
  // Engineering
  try {
    const d = _engSt()?.getDashboard() || {};
    const blockers = (d.blockers?.active || 0);
    health.orgs.engineering = { blockers, velocity: d.kpis?.velocity || 0, score: Math.max(0, 100 - blockers * 10) };
  } catch { health.orgs.engineering = { score: 50 }; }
  // Business
  try {
    const d = _bizSt()?.getDashboard() || {};
    const winRate = d.pipeline?.winRate || 0;
    health.orgs.business = { winRate, mrr: d.revenue?.mrr || 0, score: Math.round(winRate * 100) };
  } catch { health.orgs.business = { score: 50 }; }
  // Knowledge
  try {
    const d = _akoSt()?.getDashboard() || {};
    const ratio = d.knowledge?.total > 0 ? (d.knowledge?.validated || 0) / d.knowledge?.total : 1;
    health.orgs.knowledge = { ratio, total: d.knowledge?.total || 0, score: Math.round(ratio * 100) };
  } catch { health.orgs.knowledge = { score: 50 }; }
  // Evolution
  try {
    const d = _aeoSt()?.getDashboard() || {};
    const keepRate = d.evolutions?.total > 0 ? (d.evolutions?.kept || 0) / d.evolutions?.total : 1;
    health.orgs.evolution = { keepRate, total: d.evolutions?.total || 0, score: Math.round(keepRate * 100) };
  } catch { health.orgs.evolution = { score: 50 }; }
  // Runtime / Agents
  try {
    const agents = _sup()?.listAgents?.() || [];
    const running = agents.filter(a => a.status === "running").length;
    health.agents = { total: agents.length, running, score: agents.length > 0 ? Math.round((running / agents.length) * 100) : 100 };
  } catch { health.agents = { score: 50 }; }
  // Active risks
  health.risks = _s().risks.filter(r => r.status === "active");
  // Compute overall score
  const scores = Object.values(health.orgs).map(o => o.score || 50);
  if (health.agents.score) scores.push(health.agents.score);
  const criticalRisks = health.risks.filter(r => r.severity === "critical").length;
  health.score = Math.min(100, Math.max(0, Math.round(scores.reduce((a,b) => a+b, 0) / scores.length) - criticalRisks * 5));
  return health;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function getDashboard() {
  const s = _s();
  const ctx = syncOrgStatus();
  const health = getGlobalHealth();
  return {
    quarter: currentQuarter(),
    goals: {
      total: s.goals.length,
      active: s.goals.filter(g => g.status === "active").length,
      completed: s.goals.filter(g => g.status === "completed").length,
    },
    strategies: { total: s.strategies.length },
    missions: {
      total: s.execMissions.length,
      active: s.execMissions.filter(m => m.status === "active").length,
      completed: s.execMissions.filter(m => m.status === "completed").length,
    },
    decisions: { total: s.decisions.length },
    approvals: {
      pending: s.approvals.filter(a => a.status === "pending").length,
      approved: s.approvals.filter(a => a.status === "approved").length,
    },
    risks: {
      active: s.risks.filter(r => r.status === "active").length,
      critical: s.risks.filter(r => r.status === "active" && r.severity === "critical").length,
    },
    allocations: { active: s.allocations.filter(a => a.status === "active").length },
    health,
    orgStatus: ctx.orgStatus,
    reports: { total: _r().length },
    context: { globalObjective: ctx.globalObjective, lastSync: ctx.lastSync },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECOVERIES
// ═══════════════════════════════════════════════════════════════════════════════

function createRecovery({ goalId, missionId, failedOrg, reason, recoveryPlan = [] } = {}) {
  const recovery = {
    id: _id("erec"), goalId, missionId, failedOrg, reason, recoveryPlan,
    status: "active", attempts: 0,
    createdAt: new Date().toISOString(), resolvedAt: null,
  };
  _s().recoveries.push(recovery);
  _save("state");
  return { ok: true, recovery };
}

function resolveRecovery(id, { success = true } = {}) {
  const r = _s().recoveries.find(x => x.id === id);
  if (!r) return { ok: false, error: "Not found" };
  r.status = success ? "resolved" : "failed";
  r.resolvedAt = new Date().toISOString();
  if (success) _kpi("eos_recovery").recoveriesSucceeded++;
  _save("state"); _save("kpis");
  return { ok: true, recovery: r };
}

function listRecoveries({ status, goalId } = {}) {
  let list = _s().recoveries;
  if (status) list = list.filter(r => r.status === status);
  if (goalId) list = list.filter(r => r.goalId === goalId);
  return list.slice(-30).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPABILITY REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

function registerCapability({ orgTarget, capability, description = "", confidence = 80 } = {}) {
  if (!orgTarget || !capability) return { ok: false, error: "orgTarget and capability required" };
  const s = _s();
  const existing = s.capabilities.find(c => c.orgTarget === orgTarget && c.capability === capability);
  if (existing) { existing.confidence = confidence; existing.updatedAt = new Date().toISOString(); _save("state"); return { ok: true, capability: existing }; }
  const cap = { id: _id("ecap"), orgTarget, capability, description, confidence, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  s.capabilities.push(cap);
  _save("state");
  return { ok: true, capability: cap };
}

function listCapabilities({ orgTarget, enabled } = {}) {
  let list = _s().capabilities;
  if (orgTarget) list = list.filter(c => c.orgTarget === orgTarget);
  if (enabled !== undefined) list = list.filter(c => c.enabled === enabled);
  return list;
}

module.exports = {
  // Goals
  createGoal, listGoals, getGoal, updateGoal,
  // Strategies
  createStrategy, listStrategies, updateStrategy,
  // Executive missions
  createExecMission, listExecMissions, getExecMission, updateExecMission,
  // Decisions
  recordDecision, listDecisions,
  // Approvals
  requestApproval, resolveApproval, listApprovals,
  // Risks
  raiseRisk, resolveRisk, listRisks,
  // Timelines
  createTimeline, advanceTimeline, listTimelines,
  // Policies
  createPolicy, listPolicies, evaluatePolicy,
  // Budgets
  createBudget, allocateBudget, listBudgets,
  // Allocations
  allocateResource, releaseResource, listAllocations,
  // Context
  getContext, updateContext, syncOrgStatus,
  // Memory + Reports
  addMemory, listMemory, createReport, listReports,
  // KPIs
  getKpi, getAllKpis, updateKpi,
  // Health + Dashboard
  getGlobalHealth, getDashboard,
  // Recoveries
  createRecovery, resolveRecovery, listRecoveries,
  // Capabilities
  registerCapability, listCapabilities,
  // Helpers
  currentQuarter, ORG_TARGETS, DEPT_IDS,
};
