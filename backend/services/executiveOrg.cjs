"use strict";
/**
 * Executive Operating System — Agent Layer (LEVEL 6)
 *
 * 20 executive department agents registered into agentRuntimeSupervisor.
 * Each coordinates across all 5 org layers without duplicating any of them.
 */

function _sup()    { return require("./agentRuntimeSupervisor.cjs"); }
function _bus()    { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _orch()   { try { return require("./missionOrchestrator.cjs");    } catch { return null; } }
function _mm()     { try { return require("./missionMemory.cjs");          } catch { return null; } }
function _st()     { return require("./executiveState.cjs"); }
function _wf()     { return require("./executiveWorkflow.cjs"); }
function _engSt()  { try { return require("./engineeringOrgState.cjs");    } catch { return null; } }
function _engWf()  { try { return require("./engineeringOrgWorkflow.cjs"); } catch { return null; } }
function _bizSt()  { try { return require("./businessOrgState.cjs");       } catch { return null; } }
function _akoSt()  { try { return require("./akoState.cjs");               } catch { return null; } }
function _akoWf()  { try { return require("./akoWorkflow.cjs");            } catch { return null; } }
function _aeoSt()  { try { return require("./aeoState.cjs");               } catch { return null; } }
function _aeoWf()  { try { return require("./aeoWorkflow.cjs");            } catch { return null; } }
function _le()     { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } }
function _ile()    { try { return require("./improvementLoopEngine.cjs");  } catch { return null; } }
function _shr()    { try { return require("./selfHealingRuntime.cjs");     } catch { return null; } }
function _obs()    { try { return require("./observabilityEngine.cjs");    } catch { return null; } }
function _ca()     { try { return require("./costAnalytics.cjs");          } catch { return null; } }
function _depa()   { try { return require("./deploymentAutopilot.cjs");   } catch { return null; } }

// ── Tick helpers ──────────────────────────────────────────────────────────────
function _setObj(s, label) { s.currentObjective = label; s.lastTickAt = new Date().toISOString(); }
function _activeGoal()     { return _st().listGoals({ status: "active" })[0]; }
function _kpuInc(id, field) { try { const k = _st().getKpi(id); _st().updateKpi(id, { [field]: (k[field]||0)+1, tickCount: (k.tickCount||0)+1, lastTickAt: new Date().toISOString() }); } catch {} }

function _mission(agentId, spec, s) {
  if (!spec.objective?.trim()) return null;
  try {
    const prefix = spec.objective?.slice(0,50);
    const exists = ((_mm()?.listMissions({ limit: 300 }) || { missions: [] }).missions).some(m => ["active","pending","planned"].includes(m.status) && m.objective?.slice(0,50) === prefix);
    if (!exists) {
      const m = _orch()?.createManual({ ...spec, goal: spec.objective, metadata: { ...spec.metadata, autoCreatedBy: agentId } });
      if (m && s) s.missionsCreated = (s.missionsCreated||0)+1;
      return m;
    }
  } catch {}
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TICK IMPLEMENTATIONS (20 departments)
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Global Executive Planner — ensures active goals always have strategies
async function _plannerTick(s) {
  _setObj(s, "Ensuring all active goals have strategies");
  try {
    const goals = _st().listGoals({ status: "active" });
    for (const g of goals.slice(0,3)) {
      const strats = _st().listStrategies({ goalId: g.id });
      if (!strats.length) {
        _wf().buildStrategy(g.id);
        s.v6Strategies = (s.v6Strategies||0)+1;
      }
    }
    s.v6Goals = goals.length;
  } catch {}
  _setObj(s, `${s.v6Goals||0} active goals, ${s.v6Strategies||0} strategies built`);
}

// 2. Executive Goal Engine — creates quarterly executive goal if none active
async function _goalEngineTick(s) {
  _setObj(s, "Monitoring and creating executive goals");
  try {
    const q = _st().currentQuarter();
    const active = _st().listGoals({ status: "active", quarter: q });
    if (!active.length) {
      const r = _st().createGoal({
        title: `Ooplix OS Excellence — ${q}`,
        description: "Continuously improve all 5 org levels and deliver user value",
        priority: "high", kpis: ["healthScore","missionsCompleted","evolutionsKept"],
        tags: ["quarterly","auto"],
      });
      if (r.ok) {
        s.v6AutoGoal = r.goal.id;
        _wf().buildStrategy(r.goal.id);
      }
    }
    s.v6GoalCount = _st().listGoals({ status: "active" }).length;
  } catch {}
  _setObj(s, `${s.v6GoalCount||0} active goals`);
}

// 3. Executive Priority Engine — re-prioritizes goals each tick
async function _priorityEngineTick(s) {
  _setObj(s, "Re-prioritizing active goals");
  try {
    const r = _wf().prioritizeGoals();
    s.v6TopGoal = r.prioritized?.[0]?.title?.slice(0,50);
    s.v6HealthScore = r.healthScore;
    // Update context with top priority
    if (r.prioritized?.[0]) {
      _st().updateContext({ topPriorityGoal: r.prioritized[0].id, globalHealthScore: r.healthScore });
    }
  } catch {}
  _setObj(s, `Top: ${s.v6TopGoal||"none"} | Health: ${s.v6HealthScore||0}`);
}

// 4. Organization Coordinator — syncs all org statuses into executive context
async function _coordinatorTick(s) {
  _setObj(s, "Synchronizing all org statuses");
  try {
    const r = _wf().coordinatorSync();
    s.v6Health = r.health?.score;
    s.v6ActiveMissions = r.dashboard?.missions?.active;
  } catch {}
  _setObj(s, `Health ${s.v6Health||0} | Missions ${s.v6ActiveMissions||0}`);
}

// 5. Cross-Org Mission Planner — dispatches active goals to all orgs
async function _missionPlannerTick(s) {
  _setObj(s, "Dispatching goals to organizations");
  try {
    const goal = _activeGoal();
    if (goal) {
      const missions = _st().listExecMissions({ goalId: goal.id });
      const orgsDispatched = [...new Set(missions.flatMap(m => m.orgTargets||[]))];
      const needed = ["engineering","business","knowledge","evolution","odi"].filter(o => !orgsDispatched.includes(o));
      for (const org of needed.slice(0,2)) {
        if (org === "engineering")  _wf().dispatchToEngineering(goal.id);
        else if (org === "business") _wf().dispatchToBusiness(goal.id);
        else if (org === "knowledge") _wf().dispatchToKnowledge(goal.id);
        else if (org === "evolution") _wf().dispatchToEvolution(goal.id);
        else if (org === "odi")      _wf().dispatchToODI(goal.id);
        s.v6Dispatched = (s.v6Dispatched||0)+1;
      }
    }
  } catch {}
  _setObj(s, `${s.v6Dispatched||0} dispatches total`);
}

// 6. Resource Allocator — allocates org resources to active goals
async function _resourceTick(s) {
  _setObj(s, "Allocating resources to active goals");
  try {
    const goal = _activeGoal();
    if (goal) {
      const existing = _st().listAllocations({ goalId: goal.id, status: "active" });
      const allocatedOrgs = existing.map(a => a.orgTarget);
      const orgs = ["engineering","business","knowledge","evolution","odi"];
      for (const org of orgs.filter(o => !allocatedOrgs.includes(o))) {
        _st().allocateResource({ goalId: goal.id, orgTarget: org, resource: "agent_capacity", amount: 1, priority: goal.priority });
        s.v6Allocations = (s.v6Allocations||0)+1;
      }
    }
    // Observe cost via costAnalytics
    try {
      const cost = _ca()?.profitSummary?.() || {};
      _st().addMemory({ deptId: "eos_resource", type: "cost", title: `Cost: $${cost.totalCost||0} / Revenue: $${cost.totalRevenue||0}`, detail: "", tags: ["cost","resource"] });
    } catch {}
  } catch {}
  _setObj(s, `${s.v6Allocations||0} allocations`);
}

// 7. Autonomous Decision Engine — makes and records key decisions each tick
async function _decisionTick(s) {
  _setObj(s, "Resolving pending decisions autonomously");
  try {
    const goal = _activeGoal();
    const health = _st().getGlobalHealth();
    if (goal && health.score < 60) {
      _st().recordDecision({
        goalId: goal.id, title: `Health recovery decision — score=${health.score}`,
        type: "operational", chosen: "trigger_recovery",
        alternatives: ["pause_goal","escalate_human"],
        rationale: `Health ${health.score} below 60. Triggering self-healing.`,
        deptId: "eos_decision",
      });
      try { _shr()?.probe?.(); } catch {}
      s.v6Decisions = (s.v6Decisions||0)+1;
    }
  } catch {}
  _setObj(s, `${s.v6Decisions||0} decisions made`);
}

// 8. Executive Approval Engine — auto-resolves pending approvals
async function _approvalTick(s) {
  _setObj(s, "Processing pending approvals");
  try {
    const health = _st().getGlobalHealth();
    const pending = _st().listApprovals({ status: "pending" });
    let approved = 0;
    for (const a of pending.slice(0,5)) {
      if (a.autoApprove || health.score >= 60) {
        _st().resolveApproval(a.id, { approved: true, resolvedBy: "eos_approval", reason: `Health=${health.score}` });
        approved++;
      }
    }
    s.v6Approved = (s.v6Approved||0)+approved;
  } catch {}
  _setObj(s, `${s.v6Approved||0} approvals processed`);
}

// 9. Executive Timeline Manager — advances timelines for active goals
async function _timelineTick(s) {
  _setObj(s, "Advancing goal timelines");
  try {
    const goal = _activeGoal();
    if (goal) {
      const timelines = _st().listTimelines({ goalId: goal.id });
      for (const tl of timelines) {
        const activePh = tl.phases.find(p => p.status === "active");
        const plannedPh = tl.phases.find(p => p.status === "planned");
        if (!activePh && plannedPh) {
          _st().advanceTimeline(tl.id, plannedPh.id);
          s.v6PhaseAdvanced = (s.v6PhaseAdvanced||0)+1;
        }
      }
    }
  } catch {}
  _setObj(s, `${s.v6PhaseAdvanced||0} phases advanced`);
}

// 10. Executive Risk Engine — detects and manages risks
async function _riskTick(s) {
  _setObj(s, "Monitoring risks and escalating critical ones");
  try {
    const goal = _activeGoal();
    const health = _st().getGlobalHealth();
    // Detect risks from org health
    if (goal && (health.orgs?.engineering?.blockers || 0) > 5) {
      const activeRisks = _st().listRisks({ goalId: goal.id, status: "active" });
      if (!activeRisks.some(r => r.source === "engineering_blockers")) {
        _st().raiseRisk({ goalId: goal.id, title: `High engineering blocker count: ${health.orgs.engineering.blockers}`, severity: "high", source: "engineering_blockers", mitigations: ["Resolve blockers","Re-assign work items"] });
        s.v6Risks = (s.v6Risks||0)+1;
      }
    }
    // Auto-resolve low risks when health is good
    if (health.score >= 80) {
      const lowRisks = _st().listRisks({ status: "active" }).filter(r => r.severity === "low");
      for (const r of lowRisks.slice(0,3)) {
        _st().resolveRisk(r.id, { resolution: "Auto-resolved: health above 80" });
      }
    }
    s.v6HealthScore = health.score;
  } catch {}
  _setObj(s, `Health ${s.v6HealthScore||0} | ${s.v6Risks||0} risks raised`);
}

// 11. Executive Policy Engine — evaluates policies against current state
async function _policyTick(s) {
  _setObj(s, "Evaluating executive policies");
  try {
    const ctx = _st().getContext();
    const budgets = _st().listBudgets({});
    const totalSpent = budgets.reduce((a,b) => a+(b.spentUsd||0), 0);
    const result = _st().evaluatePolicy({ budget: totalSpent, activeOrgs: Object.keys(ctx.orgStatus||{}).length });
    if (result.violations?.length > 0) {
      _st().addMemory({ deptId: "eos_policy", type: "violation", title: `${result.violations.length} policy violations detected`, detail: JSON.stringify(result.violations).slice(0,200), tags: ["policy","violation"] });
      s.v6Violations = result.violations.length;
    }
    s.v6PoliciesEvaluated = result.policies;
  } catch {}
  _setObj(s, `${s.v6PoliciesEvaluated||0} policies | ${s.v6Violations||0} violations`);
}

// 12. Executive Budget Engine — tracks and allocates budgets
async function _budgetTick(s) {
  _setObj(s, "Tracking executive budgets and costs");
  try {
    const goal = _activeGoal();
    if (goal) {
      const budgets = _st().listBudgets({ goalId: goal.id });
      if (!budgets.length) {
        const r = _st().createBudget({ goalId: goal.id, title: `Budget: ${goal.title.slice(0,40)}`, totalUsd: 10000, period: "quarter" });
        if (r.ok) s.v6BudgetCreated = true;
      }
      // Get cost from costAnalytics
      try {
        const profit = _ca()?.profitSummary?.() || {};
        if (budgets[0] && profit.totalCost > 0) {
          const spendable = Math.min(profit.totalCost, 100);
          _st().allocateBudget(budgets[0].id, { orgTarget: "all", amountUsd: spendable, description: "AI model costs this tick" });
        }
      } catch {}
    }
  } catch {}
  _setObj(s, "Budget tracking active");
}

// 13. Executive Capability Manager — bootstraps and monitors capabilities
async function _capabilityTick(s) {
  _setObj(s, "Managing and verifying organization capabilities");
  try {
    const caps = _st().listCapabilities({});
    if (caps.length === 0) { _wf().bootstrapCapabilities(); s.v6CapsBootstrapped = true; }
    // Check which orgs have capabilities registered
    const orgs = ["engineering","business","knowledge","evolution","odi","executive"];
    const covered = new Set(caps.map(c => c.orgTarget));
    const missing = orgs.filter(o => !covered.has(o));
    for (const org of missing) {
      _st().registerCapability({ orgTarget: org, capability: "operate", description: `Core ${org} capability`, confidence: 70 });
    }
    s.v6Capabilities = caps.length;
  } catch {}
  _setObj(s, `${s.v6Capabilities||0} capabilities registered`);
}

// 14. Executive Health Monitor — monitors global health, escalates if critical
async function _healthMonitorTick(s) {
  _setObj(s, "Monitoring global system health");
  try {
    const health = _st().getGlobalHealth();
    s.v6Health = health.score;
    // Record metric
    try { _obs()?.recordMetric?.("eos.health_score", health.score, { dept: "eos_health" }); } catch {}
    // Escalate if critical
    if (health.score < 40) {
      _mission("eos_health", {
        objective: `CRITICAL: Global health at ${health.score}/100 — immediate intervention required`,
        priority: "critical",
        subtasks: [
          { description: "Audit all failing agents" },
          { description: "Run self-healing probe cycle" },
          { description: "Review critical risks" },
        ],
        metadata: { domain: "health", healthScore: health.score },
      }, s);
    }
    // Log to executive memory
    _st().addMemory({ deptId: "eos_health", type: "health_snapshot", title: `Health: ${health.score}/100`, detail: JSON.stringify({ orgs: health.orgs, agents: health.agents }).slice(0,200), tags: ["health","snapshot"] });
  } catch {}
  _setObj(s, `Health ${s.v6Health||0}/100`);
}

// 15. Executive Recovery Engine — detects and triggers recovery for failed missions
async function _recoveryTick(s) {
  _setObj(s, "Detecting failed missions and triggering recovery");
  try {
    const failed = _st().listExecMissions({ status: "failed" });
    const health = _st().getGlobalHealth();
    for (const m of failed.slice(0,2)) {
      const existing = _st().listRecoveries({ goalId: m.goalId }).find(r => r.missionId === m.id && r.status === "active");
      if (!existing) {
        _wf().recoverOrg({ goalId: m.goalId, missionId: m.id, failedOrg: (m.orgTargets||["unknown"])[0], reason: "Mission failed in previous cycle" });
        s.v6Recoveries = (s.v6Recoveries||0)+1;
      }
    }
    // Probe SHR on low health
    if ((health.score||100) < 60) { try { _shr()?.probe?.(); } catch {} }
  } catch {}
  _setObj(s, `${s.v6Recoveries||0} recoveries triggered`);
}

// 16. Executive Global Dashboard — updates dashboard snapshot each tick
async function _dashboardTick(s) {
  _setObj(s, "Updating executive global dashboard");
  try {
    const dash = _st().getDashboard();
    s.v6DashSnapshot = { goals: dash.goals.active, missions: dash.missions.active, health: dash.health.score };
    try { _bus()?.emit("eos:dashboard:updated", { dashboard: dash, ts: new Date().toISOString() }); } catch {}
  } catch {}
  _setObj(s, `Goals:${s.v6DashSnapshot?.goals||0} Missions:${s.v6DashSnapshot?.missions||0} Health:${s.v6DashSnapshot?.health||0}`);
}

// 17. Executive Command Processor — processes queued executive commands from memory
async function _commandTick(s) {
  _setObj(s, "Processing queued executive commands");
  try {
    // Check for command items in executive memory
    const commands = _st().listMemory({ deptId: "eos_command", type: "queued_command", limit: 3 });
    for (const cmd of commands) {
      if (!cmd.processed) {
        await _wf().runFullPipeline(cmd.title, { priority: "high" });
        cmd.processed = true;
        s.v6Commands = (s.v6Commands||0)+1;
      }
    }
  } catch {}
  _setObj(s, `${s.v6Commands||0} commands processed`);
}

// 18. Executive Context Manager — maintains and syncs global context
async function _contextTick(s) {
  _setObj(s, "Maintaining global executive context");
  try {
    const ctx = _st().syncOrgStatus();
    // Enrich context with lesson counts
    try {
      const lessons = _le()?.getLessons?.({ limit: 5 }) || [];
      _st().updateContext({ recentLessons: lessons.length, lastContextSync: new Date().toISOString() });
    } catch {}
    // Enrich with improvement loop
    try {
      const ileStats = _ile()?.getStats?.() || {};
      _st().updateContext({ ileStats });
    } catch {}
    s.v6ContextOrgs = Object.keys(ctx.orgStatus||{}).length;
  } catch {}
  _setObj(s, `${s.v6ContextOrgs||0} orgs in context`);
}

// 19. Executive State Manager — persists and validates executive state integrity
async function _stateTick(s) {
  _setObj(s, "Validating executive state integrity");
  try {
    const dash = _st().getDashboard();
    // Ensure all active goals have strategies
    const goalsWithoutStrategy = _st().listGoals({ status: "active" })
      .filter(g => !_st().listStrategies({ goalId: g.id }).length);
    for (const g of goalsWithoutStrategy.slice(0,2)) {
      _wf().buildStrategy(g.id);
      s.v6Repaired = (s.v6Repaired||0)+1;
    }
    s.v6StateHealth = { goals: dash.goals.total, missions: dash.missions.total, reports: dash.reports.total };
  } catch {}
  _setObj(s, "State integrity maintained");
}

// 20. Executive Orchestrator — runs full pipeline on new goals, syncs all depts
async function _orchestratorTick(s) {
  _setObj(s, "Orchestrating full executive cycle");
  try {
    // Ensure policies bootstrapped
    const pols = _st().listPolicies({ enabled: true });
    if (!pols.length) _wf().bootstrapPolicies();
    // Ensure capabilities registered
    const caps = _st().listCapabilities({});
    if (!caps.length) _wf().bootstrapCapabilities();
    // Coordinator sync
    const sync = _wf().coordinatorSync();
    s.v6Health = sync.health?.score;
    // Generate periodic executive report
    const goal = _activeGoal();
    if (goal) {
      const recentReports = _st().listReports({ deptId: "eos_orchestrator", limit: 5 });
      const lastReport = recentReports[0];
      const minutesSinceLast = lastReport ? (Date.now() - new Date(lastReport.createdAt).getTime()) / 60000 : 999;
      if (minutesSinceLast > 5) { // report every 5 min max
        _wf().generateReport(goal.id);
        _wf().learnFromGoal(goal.id);
        s.v6Reports = (s.v6Reports||0)+1;
      }
    }
  } catch {}
  _setObj(s, `Orchestrator active | Health ${s.v6Health||0}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEPARTMENT DEFINITIONS (20)
// ═══════════════════════════════════════════════════════════════════════════════

const EOS_ORG = [
  { id: "eos_planner",         role: "eos_planner",         label: "Global Executive Planner",      description: "Ensures all active goals have strategies and dispatches execution plans",    intervalMs: 300_000, tickFn: _plannerTick         },
  { id: "eos_goal",            role: "eos_goal",            label: "Executive Goal Engine",         description: "Creates and monitors executive goals for each quarter",                     intervalMs: 600_000, tickFn: _goalEngineTick      },
  { id: "eos_priority",        role: "eos_priority",        label: "Executive Priority Engine",     description: "Re-prioritizes active goals by criticality, risks and health score",       intervalMs: 180_000, tickFn: _priorityEngineTick  },
  { id: "eos_coordinator",     role: "eos_coordinator",     label: "Organization Coordinator",      description: "Syncs all 5 org statuses into executive context each tick",                intervalMs: 180_000, tickFn: _coordinatorTick     },
  { id: "eos_mission_planner", role: "eos_mission_planner", label: "Cross-Org Mission Planner",    description: "Dispatches active goals to all 5 organizations",                           intervalMs: 300_000, tickFn: _missionPlannerTick  },
  { id: "eos_resource",        role: "eos_resource",        label: "Resource Allocator",            description: "Allocates agent capacity and cost budget to active goals",                 intervalMs: 360_000, tickFn: _resourceTick        },
  { id: "eos_decision",        role: "eos_decision",        label: "Autonomous Decision Engine",    description: "Makes and records operational decisions autonomously",                      intervalMs: 240_000, tickFn: _decisionTick        },
  { id: "eos_approval",        role: "eos_approval",        label: "Executive Approval Engine",     description: "Auto-resolves pending approvals when health thresholds are met",           intervalMs: 180_000, tickFn: _approvalTick        },
  { id: "eos_timeline",        role: "eos_timeline",        label: "Executive Timeline Manager",    description: "Advances goal timelines by progressing planned phases to active",          intervalMs: 360_000, tickFn: _timelineTick        },
  { id: "eos_risk",            role: "eos_risk",            label: "Executive Risk Engine",         description: "Detects, raises and resolves risks from org health signals",               intervalMs: 240_000, tickFn: _riskTick            },
  { id: "eos_policy",          role: "eos_policy",          label: "Executive Policy Engine",       description: "Evaluates policies against current state and flags violations",            intervalMs: 480_000, tickFn: _policyTick          },
  { id: "eos_budget",          role: "eos_budget",          label: "Executive Budget Engine",       description: "Creates and tracks budgets for active goals from cost analytics",          intervalMs: 600_000, tickFn: _budgetTick          },
  { id: "eos_capability",      role: "eos_capability",      label: "Executive Capability Manager",  description: "Bootstraps and monitors capabilities across all 5 organizations",          intervalMs: 600_000, tickFn: _capabilityTick      },
  { id: "eos_health",          role: "eos_health",          label: "Executive Health Monitor",      description: "Monitors global health score, escalates when critical",                    intervalMs: 120_000, tickFn: _healthMonitorTick   },
  { id: "eos_recovery",        role: "eos_recovery",        label: "Executive Recovery Engine",     description: "Detects failed missions and triggers cross-org recovery",                  intervalMs: 240_000, tickFn: _recoveryTick        },
  { id: "eos_dashboard",       role: "eos_dashboard",       label: "Executive Global Dashboard",    description: "Updates and broadcasts executive dashboard snapshot each tick",            intervalMs: 120_000, tickFn: _dashboardTick       },
  { id: "eos_command",         role: "eos_command",         label: "Executive Command Processor",   description: "Processes queued executive commands from memory into full pipelines",      intervalMs: 300_000, tickFn: _commandTick         },
  { id: "eos_context",         role: "eos_context",         label: "Executive Context Manager",     description: "Maintains global context: org status, lessons, improvement loop stats",   intervalMs: 240_000, tickFn: _contextTick         },
  { id: "eos_state",           role: "eos_state",           label: "Executive State Manager",       description: "Validates executive state integrity, repairs missing strategies",          intervalMs: 360_000, tickFn: _stateTick           },
  { id: "eos_orchestrator",    role: "eos_orchestrator",    label: "Executive Orchestrator",        description: "Master orchestrator: policies + capabilities + sync + reports",           intervalMs: 240_000, tickFn: _orchestratorTick    },
];

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

let _registered = false;

function register() {
  if (_registered) return { ok: true, message: "Already registered", count: EOS_ORG.length };
  const sup = _sup();
  try { if (!sup.getSupervisorStatus().started) sup.start(); } catch {}
  const results = [];
  for (const spec of EOS_ORG) {
    const r = sup.registerAgent(spec);
    results.push(r);
  }
  _registered = true;
  try { _wf().subscribeWorkflowEvents?.(); } catch {}
  try { _wf().bootstrapCapabilities?.(); } catch {}
  try { _wf().bootstrapPolicies?.(); } catch {}
  try { _bus()?.emit("eos:registered", { count: EOS_ORG.length, ids: EOS_ORG.map(d => d.id) }); } catch {}
  return { ok: true, count: EOS_ORG.length, registered: results.filter(r => r.ok).length };
}

function getOrgStatus() {
  const sup = _sup();
  return EOS_ORG.map(spec => sup.getAgent(spec.id) || { id: spec.id, role: spec.role, label: spec.label, status: "not_registered" });
}

function getOrgSummary() {
  const status  = getOrgStatus();
  const running = status.filter(a => a.status === "running").length;
  const dash    = _st().getDashboard();
  return { total: status.length, running, dashboard: dash, departments: status };
}

module.exports = { register, getOrgStatus, getOrgSummary, EOS_ORG };
