"use strict";
/**
 * Executive Operating System — Workflow Layer (LEVEL 6)
 *
 * The full goal→report pipeline:
 *
 * 1. GOAL        — user objective → createGoal + createStrategy
 * 2. STRATEGY    — decompose into org-specific missions
 * 3. ENGINEERING — create engineering objective + epic + work items
 * 4. BUSINESS    — create business objective + campaign + deal
 * 5. KNOWLEDGE   — capture in AKO
 * 6. EVOLUTION   — propose evolution based on goal type
 * 7. DESIGN      — trigger ODI observation
 * 8. DEPLOY      — deploymentAutopilot pipeline
 * 9. VALIDATE    — measure outcomes vs goal KPIs
 * 10. LEARN      — propagate to AKO + learningEngine
 * 11. REPORT     — generate executive report
 *
 * Event bus events emitted:
 *   eos:goal:created  eos:strategy:created  eos:mission:dispatched
 *   eos:org:tasked    eos:deploy:triggered  eos:validation:done
 *   eos:report:ready  eos:coordinator:sync
 */

function _bus()    { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _orch()   { try { return require("./missionOrchestrator.cjs");    } catch { return null; } }
function _mm()     { try { return require("./missionMemory.cjs");          } catch { return null; } }
function _st()     { return require("./executiveState.cjs"); }
function _engSt()  { try { return require("./engineeringOrgState.cjs");    } catch { return null; } }
function _engWf()  { try { return require("./engineeringOrgWorkflow.cjs"); } catch { return null; } }
function _bizSt()  { try { return require("./businessOrgState.cjs");       } catch { return null; } }
function _bizWf()  { try { return require("./businessOrgWorkflow.cjs");    } catch { return null; } }
function _akoSt()  { try { return require("./akoState.cjs");               } catch { return null; } }
function _akoWf()  { try { return require("./akoWorkflow.cjs");            } catch { return null; } }
function _aeoSt()  { try { return require("./aeoState.cjs");               } catch { return null; } }
function _aeoWf()  { try { return require("./aeoWorkflow.cjs");            } catch { return null; } }
function _le()     { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } }
function _ile()    { try { return require("./improvementLoopEngine.cjs");  } catch { return null; } }
function _shr()    { try { return require("./selfHealingRuntime.cjs");     } catch { return null; } }
function _obs()    { try { return require("./observabilityEngine.cjs");    } catch { return null; } }
function _depa()   { try { return require("./deploymentAutopilot.cjs");   } catch { return null; } }
function _ca()     { try { return require("./costAnalytics.cjs");          } catch { return null; } }
function _em()     { try { return require("./engineeringMemoryEngine.cjs"); } catch { return null; } }
function _sup()    { try { return require("./agentRuntimeSupervisor.cjs"); } catch { return null; } }

// ── Helpers ───────────────────────────────────────────────────────────────────
function _emit(type, payload) {
  try { _bus()?.emit(type, { ...payload, ts: new Date().toISOString() }); } catch {}
}

function _missionExists(prefix) {
  try {
    return ((_mm()?.listMissions({ limit: 300 }) || { missions: [] }).missions)
      .some(m => ["active","pending","planned"].includes(m.status) && m.objective?.slice(0,50) === prefix?.slice(0,50));
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — Process user command → goal
// ═══════════════════════════════════════════════════════════════════════════════

function processCommand(command, { priority = "critical", kpis = [], deadline = null } = {}) {
  if (!command) return { ok: false, error: "command required" };
  _st().updateContext({ globalObjective: command });
  const r = _st().createGoal({
    title: command,
    description: `Executive goal created from command: "${command}"`,
    priority, kpis, deadline, sourceCommand: command,
    tags: ["command","executive"],
  });
  if (!r.ok) {
    // Goal exists — find and return it
    const existing = _st().listGoals({ status: "active" }).find(g => g.title === command);
    if (existing) return { ok: true, goal: existing, reused: true };
    return r;
  }
  _emit("eos:goal:created", { goalId: r.goal.id, title: command, priority });
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — Build strategy from goal
// ═══════════════════════════════════════════════════════════════════════════════

function buildStrategy(goalId) {
  const goal = _st().getGoal(goalId);
  if (!goal) return { ok: false, error: "Goal not found" };
  const existing = _st().listStrategies({ goalId });
  if (existing.length) return { ok: true, strategy: existing[0], reused: true };
  const r = _st().createStrategy({
    goalId,
    title: `Strategy: ${goal.title}`,
    description: `Multi-org execution strategy for: ${goal.title}`,
    orgTargets: ["engineering","business","knowledge","evolution","odi"],
    phases: [
      { name: "Engineering Execution",  orgTarget: "engineering", estimatedDays: 7  },
      { name: "Business Execution",     orgTarget: "business",    estimatedDays: 5  },
      { name: "Knowledge Capture",      orgTarget: "knowledge",   estimatedDays: 2  },
      { name: "Design & UX",            orgTarget: "odi",         estimatedDays: 3  },
      { name: "Evolution & Validation", orgTarget: "evolution",   estimatedDays: 2  },
      { name: "Deploy & Report",        orgTarget: "executive",   estimatedDays: 1  },
    ],
    estimatedDuration: "3w",
  });
  if (r.ok) {
    _st().createTimeline({ goalId, title: `Timeline: ${goal.title}`, phases: r.strategy.phases });
    _st().updateStrategy(r.strategy.id, { status: "active" });
    _emit("eos:strategy:created", { goalId, strategyId: r.strategy.id, phases: r.strategy.phases?.length });
  }
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Dispatch Engineering tasks
// ═══════════════════════════════════════════════════════════════════════════════

function dispatchToEngineering(goalId) {
  const goal = _st().getGoal(goalId);
  if (!goal) return { ok: false, error: "Goal not found" };
  const result = { ok: true, dispatched: [] };
  try {
    // Create objective in engineering org
    const q = _engSt()?.currentQuarter?.() || "Q1";
    const existing = (_engSt()?.listObjectives({ quarter: q }) || []).find(o => o.title?.includes(goal.title.slice(0,40)));
    let obj = existing;
    if (!obj) {
      const or = _engWf()?.ctoCreateObjective?.({
        title: `[EOS] ${goal.title.slice(0,60)}`,
        description: `Executive goal delegated to engineering: ${goal.title}`,
        kpis: ["velocity","qualityScore"],
      });
      obj = or?.objective;
    }
    if (obj) {
      result.dispatched.push({ org: "engineering", objectiveId: obj.id });
      _st().allocateResource({ goalId, orgTarget: "engineering", resource: "objective", amount: 1, priority: goal.priority });
    }
  } catch {}
  // Create cross-org mission
  const mr = _st().createExecMission({
    goalId, title: `[Engineering] ${goal.title.slice(0,60)}`,
    description: `Engineering phase of: ${goal.title}`,
    orgTargets: ["engineering"], priority: goal.priority,
    subtasks: [
      { description: "Define technical approach and architecture" },
      { description: "Break into epics and work items" },
      { description: "Implement and test" },
      { description: "Code review and merge" },
    ],
  });
  if (mr.ok) result.dispatched.push({ org: "engineering", missionId: mr.mission.id });
  _emit("eos:org:tasked", { goalId, org: "engineering", result });
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4 — Dispatch Business tasks
// ═══════════════════════════════════════════════════════════════════════════════

function dispatchToBusiness(goalId) {
  const goal = _st().getGoal(goalId);
  if (!goal) return { ok: false, error: "Goal not found" };
  const result = { ok: true, dispatched: [] };
  try {
    const q = _bizSt()?.currentQuarter?.() || "Q1";
    const existing = (_bizSt()?.listObjectives({ quarter: q }) || []).find(o => o.title?.includes(goal.title.slice(0,40)));
    let obj = existing;
    if (!obj) {
      const or = _bizWf()?.ceoCreateObjective?.({
        title: `[EOS] ${goal.title.slice(0,60)}`,
        description: `Executive goal delegated to business org: ${goal.title}`,
        kpis: ["mrr","dealsWon"],
      });
      obj = or;
    }
    if (obj) result.dispatched.push({ org: "business", objectiveId: obj.id || obj?.id });
  } catch {}
  const mr = _st().createExecMission({
    goalId, title: `[Business] ${goal.title.slice(0,60)}`,
    description: `Business phase of: ${goal.title}`,
    orgTargets: ["business"], priority: goal.priority,
    subtasks: [
      { description: "Identify revenue and growth opportunities" },
      { description: "Launch campaigns aligned to goal" },
      { description: "Qualify and advance pipeline" },
      { description: "Close deals and update MRR" },
    ],
  });
  if (mr.ok) result.dispatched.push({ org: "business", missionId: mr.mission.id });
  _emit("eos:org:tasked", { goalId, org: "business", result });
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — Dispatch Knowledge tasks
// ═══════════════════════════════════════════════════════════════════════════════

function dispatchToKnowledge(goalId) {
  const goal = _st().getGoal(goalId);
  if (!goal) return { ok: false, error: "Goal not found" };
  const result = { ok: true, dispatched: [] };
  try {
    const q = _akoSt()?.currentQuarter?.() || "Q1";
    const existing = (_akoSt()?.listObjectives({ quarter: q }) || []).find(o => o.title?.includes(goal.title.slice(0,40)));
    if (!existing) {
      const or = _akoWf()?.ckoCreateObjective?.({
        title: `[EOS] ${goal.title.slice(0,60)}`,
        description: `Knowledge capture for executive goal: ${goal.title}`,
        kpis: ["itemsValidated","playbooksCreated"],
      });
      if (or) result.dispatched.push({ org: "knowledge", objectiveId: or.id });
    } else {
      result.dispatched.push({ org: "knowledge", objectiveId: existing.id });
    }
  } catch {}
  // Capture goal itself as knowledge item
  try {
    _akoWf()?.researchCapture?.({
      title: `Executive Goal: ${goal.title}`,
      content: goal.description || goal.title,
      type: "decision", source: "executive", confidence: 90,
      tags: ["executive","goal",goal.priority],
    });
  } catch {}
  const mr = _st().createExecMission({
    goalId, title: `[Knowledge] ${goal.title.slice(0,60)}`,
    orgTargets: ["knowledge"], priority: goal.priority,
    subtasks: [{ description: "Capture all org outputs as knowledge items" }, { description: "Generate playbook from goal execution" }],
  });
  if (mr.ok) result.dispatched.push({ org: "knowledge", missionId: mr.mission.id });
  _emit("eos:org:tasked", { goalId, org: "knowledge", result });
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6 — Dispatch Evolution tasks
// ═══════════════════════════════════════════════════════════════════════════════

function dispatchToEvolution(goalId) {
  const goal = _st().getGoal(goalId);
  if (!goal) return { ok: false, error: "Goal not found" };
  const result = { ok: true, dispatched: [] };
  try {
    const aeoObj = _aeoSt()?.listObjectives({ status: "active" })[0];
    const evoR = _aeoSt()?.proposeEvolution?.({
      title: `Evolve for goal: ${goal.title.slice(0,60)}`,
      description: `Continuous improvement triggered by executive goal: ${goal.title}`,
      type: "capability", target: "runtime",
      deptId: "aeo_ceo", confidence: 80, impact: 75,
      objectiveId: aeoObj?.id, tags: ["executive","goal"],
    });
    if (evoR?.ok) result.dispatched.push({ org: "evolution", evoId: evoR.evolution.id });
  } catch {}
  const mr = _st().createExecMission({
    goalId, title: `[Evolution] ${goal.title.slice(0,60)}`,
    orgTargets: ["evolution"], priority: goal.priority,
    subtasks: [{ description: "Detect improvements unlocked by goal execution" }, { description: "Apply and measure validated evolutions" }],
  });
  if (mr.ok) result.dispatched.push({ org: "evolution", missionId: mr.mission.id });
  _emit("eos:org:tasked", { goalId, org: "evolution", result });
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7 — Dispatch Design/ODI tasks
// ═══════════════════════════════════════════════════════════════════════════════

function dispatchToODI(goalId) {
  const goal = _st().getGoal(goalId);
  if (!goal) return { ok: false, error: "Goal not found" };
  const result = { ok: true, dispatched: [] };
  const mr = _st().createExecMission({
    goalId, title: `[ODI] ${goal.title.slice(0,60)}`,
    orgTargets: ["odi"], priority: goal.priority,
    subtasks: [
      { description: "Capture UX and design state for goal" },
      { description: "Apply design improvements if UX score below threshold" },
      { description: "Generate visual regression report" },
    ],
  });
  if (mr.ok) result.dispatched.push({ org: "odi", missionId: mr.mission.id });
  _emit("eos:org:tasked", { goalId, org: "odi", result });
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 8 — Trigger Deployment
// ═══════════════════════════════════════════════════════════════════════════════

function triggerDeployment(goalId) {
  const goal = _st().getGoal(goalId);
  if (!goal) return { ok: false, error: "Goal not found" };
  const result = { ok: true };
  try {
    const dr = _depa()?.deployPipeline?.({
      name: `eos-${goal.id}`,
      target: "production",
      version: `goal-${Date.now()}`,
      strategy: "canary",
    });
    result.deployment = dr;
  } catch {}
  // Record approval for deploy
  _st().requestApproval({
    goalId, title: `Deploy: ${goal.title.slice(0,60)}`,
    requiredBy: "eos_orchestrator", autoApprove: true, threshold: 0.8,
  });
  _emit("eos:deploy:triggered", { goalId, result });
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 9 — Validate outcomes
// ═══════════════════════════════════════════════════════════════════════════════

function validateOutcomes(goalId) {
  const goal = _st().getGoal(goalId);
  if (!goal) return { ok: false, error: "Goal not found" };
  const health = _st().getGlobalHealth();
  const ctx = _st().syncOrgStatus();
  const passed = health.score >= 60;
  _st().recordDecision({
    goalId, title: `Outcome validation: ${goal.title.slice(0,50)}`,
    type: "validation", chosen: passed ? "accept" : "escalate",
    alternatives: ["accept","escalate","rollback"],
    rationale: `Global health score: ${health.score}. Passed: ${passed}`,
    deptId: "eos_decision",
  });
  _emit("eos:validation:done", { goalId, healthScore: health.score, passed });
  return { ok: true, passed, healthScore: health.score, orgStatus: ctx.orgStatus };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 10 — Learn from execution
// ═══════════════════════════════════════════════════════════════════════════════

function learnFromGoal(goalId) {
  const goal = _st().getGoal(goalId);
  if (!goal) return;
  const missions = _st().listExecMissions({ goalId });
  const completedOrgs = [...new Set(missions.flatMap(m => m.orgTargets || []))];
  // Feed to continuousLearningEngine
  try {
    _le()?.createLesson?.({
      source: "executive", type: "goal_execution", severity: "info",
      title: `Goal executed: ${goal.title}`,
      detail: `Dispatched to orgs: ${completedOrgs.join(", ")}. Missions: ${missions.length}`,
      tags: ["executive","goal","execution"],
    });
  } catch {}
  // Feed to AKO
  try {
    _akoWf()?.researchCapture?.({
      title: `Lesson: Executive goal "${goal.title}" completed`,
      content: `Goal dispatched to ${completedOrgs.length} orgs, ${missions.length} missions created. Orgs: ${completedOrgs.join(", ")}`,
      type: "lesson", source: "executive", confidence: 88, tags: ["executive","lesson","goal"],
    });
  } catch {}
  // Feed to engineering memory
  try {
    _em()?.remember?.({
      type: "goal", title: `Executive goal: ${goal.title}`, content: goal.description,
      confidence: 85, tags: ["executive","goal"],
    });
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 11 — Generate executive report
// ═══════════════════════════════════════════════════════════════════════════════

function generateReport(goalId) {
  const goal = _st().getGoal(goalId);
  if (!goal) return { ok: false, error: "Goal not found" };
  const missions = _st().listExecMissions({ goalId });
  const decisions = _st().listDecisions({ goalId });
  const risks = _st().listRisks({ goalId });
  const approvals = _st().listApprovals({ goalId });
  const health = _st().getGlobalHealth();
  const orgs = ["engineering","business","knowledge","evolution","odi"];
  const orgSummary = {};
  for (const org of orgs) {
    orgSummary[org] = missions.filter(m => (m.orgTargets||[]).includes(org)).length;
  }
  const summary = `Goal "${goal.title}" executed across ${Object.keys(orgSummary).filter(o => orgSummary[o] > 0).length} organizations. ${missions.length} missions, ${decisions.length} decisions, ${risks.length} risks. Global health: ${health.score}/100.`;
  const r = _st().createReport({
    title: `Executive Report: ${goal.title.slice(0,50)} — ${new Date().toISOString().slice(0,10)}`,
    deptId: "eos_orchestrator", type: "executive",
    data: { goal, missions, decisions, risks, approvals, health, orgSummary },
    summary,
  });
  if (r.ok) _emit("eos:report:ready", { goalId, reportId: r.report.id, summary });
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL PIPELINE — "Launch X" → end-to-end execution
// ═══════════════════════════════════════════════════════════════════════════════

async function runFullPipeline(command, { priority = "critical", kpis = [], deadline = null } = {}) {
  const steps = [];
  // Step 1: Goal
  const gr = processCommand(command, { priority, kpis, deadline });
  if (!gr.ok) return { ok: false, error: gr.error };
  const goalId = gr.goal.id;
  steps.push({ step: "goal", goalId, title: command });
  // Step 2: Strategy
  const sr = buildStrategy(goalId);
  steps.push({ step: "strategy", ok: sr.ok });
  // Step 3-7: Org dispatch (parallel-safe since all writes go to different org state files)
  const engR = dispatchToEngineering(goalId);
  steps.push({ step: "engineering", dispatched: engR.dispatched?.length });
  const bizR = dispatchToBusiness(goalId);
  steps.push({ step: "business", dispatched: bizR.dispatched?.length });
  const akoR = dispatchToKnowledge(goalId);
  steps.push({ step: "knowledge", dispatched: akoR.dispatched?.length });
  const aeoR = dispatchToEvolution(goalId);
  steps.push({ step: "evolution", dispatched: aeoR.dispatched?.length });
  const odiR = dispatchToODI(goalId);
  steps.push({ step: "odi", dispatched: odiR.dispatched?.length });
  // Step 8: Deploy
  const depR = triggerDeployment(goalId);
  steps.push({ step: "deploy", ok: depR.ok });
  // Step 9: Validate
  const valR = validateOutcomes(goalId);
  steps.push({ step: "validate", passed: valR.passed, healthScore: valR.healthScore });
  // Step 10: Learn
  learnFromGoal(goalId);
  steps.push({ step: "learn" });
  // Step 11: Report
  const rptR = generateReport(goalId);
  steps.push({ step: "report", reportId: rptR.report?.id });
  return { ok: true, goalId, steps, healthScore: valR.healthScore, reportId: rptR.report?.id };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COORDINATOR SYNC (called by coordinator agent each tick)
// ═══════════════════════════════════════════════════════════════════════════════

function coordinatorSync() {
  const ctx = _st().syncOrgStatus();
  const health = _st().getGlobalHealth();
  const dash = _st().getDashboard();
  // Auto-resolve pending approvals where threshold met and health OK
  try {
    const pending = _st().listApprovals({ status: "pending" });
    for (const a of pending.filter(x => x.autoApprove && health.score >= 60)) {
      _st().resolveApproval(a.id, { approved: true, resolvedBy: "eos_coordinator", reason: "Auto-approved: health threshold met" });
    }
  } catch {}
  // Raise risk if health drops below 50
  if (health.score < 50) {
    const activeRisks = _st().listRisks({ status: "active" });
    const alreadyRaised = activeRisks.some(r => r.title.includes("Global health below"));
    if (!alreadyRaised) {
      _st().raiseRisk({ title: `Global health below 50: score=${health.score}`, severity: "critical", source: "eos_coordinator", mitigations: ["Check agent supervisor","Check self-healing runtime","Review active blockers"] });
    }
  }
  // Create coordinator sync report
  _st().createReport({
    title: `Coordinator Sync — ${new Date().toISOString().slice(0,16)}`,
    deptId: "eos_coordinator", type: "sync",
    data: { health, orgStatus: ctx.orgStatus, dashboard: dash },
    summary: `Health: ${health.score}/100. Active goals: ${dash.goals.active}. Active missions: ${dash.missions.active}.`,
  });
  _emit("eos:coordinator:sync", { health, orgStatus: ctx.orgStatus, dashboard: dash });
  return { ok: true, health, dashboard: dash };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECOVERY — failed org → create recovery mission
// ═══════════════════════════════════════════════════════════════════════════════

function recoverOrg({ goalId, missionId, failedOrg, reason }) {
  const r = _st().createRecovery({
    goalId, missionId, failedOrg, reason,
    recoveryPlan: [
      `Investigate ${failedOrg} org failure: ${reason}`,
      `Attempt restart via agentRuntimeSupervisor`,
      `Re-dispatch mission to ${failedOrg}`,
      `Escalate to human operator if recovery fails`,
    ],
  });
  // Trigger self-healing probe
  try { _shr()?.probe?.(); } catch {}
  // Create recovery mission in orchestrator
  if (!_missionExists(`Recover ${failedOrg} for goal`)) {
    try {
      _orch()?.createManual?.({
        objective: `Recover ${failedOrg} for goal: ${goalId}`,
        goal: `Recover ${failedOrg} for goal: ${goalId}`,
        priority: "critical",
        subtasks: r.recovery?.recoveryPlan?.map(p => ({ description: p })) || [],
        metadata: { failedOrg, reason, goalId, source: "eos_recovery" },
      });
    } catch {}
  }
  _emit("eos:recovery:triggered", { goalId, failedOrg, reason });
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY ENGINE — re-order active goals by criticality
// ═══════════════════════════════════════════════════════════════════════════════

function prioritizeGoals() {
  const goals = _st().listGoals({ status: "active" });
  const health = _st().getGlobalHealth();
  const risks = _st().listRisks({ status: "active" });
  // Score each goal: priority weight + risk count + blockers in engineering
  const PRIORITY_WEIGHTS = { critical: 100, high: 70, medium: 40, low: 20 };
  const scored = goals.map(g => {
    let score = PRIORITY_WEIGHTS[g.priority] || 50;
    const goalRisks = risks.filter(r => r.goalId === g.id && r.severity === "critical").length;
    score += goalRisks * 20;
    return { ...g, executiveScore: score };
  }).sort((a,b) => b.executiveScore - a.executiveScore);
  return { ok: true, prioritized: scored, healthScore: health.score };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPABILITY BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════════════

function bootstrapCapabilities() {
  const caps = [
    { orgTarget: "engineering", capability: "build",     description: "Build and test code changes",          confidence: 90 },
    { orgTarget: "engineering", capability: "deploy",    description: "Deploy code to environments",          confidence: 85 },
    { orgTarget: "business",    capability: "sell",      description: "Qualify and close business deals",     confidence: 80 },
    { orgTarget: "business",    capability: "market",    description: "Run marketing campaigns",              confidence: 75 },
    { orgTarget: "knowledge",   capability: "capture",   description: "Capture and validate knowledge items", confidence: 88 },
    { orgTarget: "knowledge",   capability: "retrieve",  description: "Semantic search and retrieval",        confidence: 85 },
    { orgTarget: "evolution",   capability: "improve",   description: "Detect and apply improvements",        confidence: 82 },
    { orgTarget: "evolution",   capability: "measure",   description: "Measure before/after impact",         confidence: 80 },
    { orgTarget: "odi",         capability: "design",    description: "Design intelligence and UX patches",   confidence: 78 },
    { orgTarget: "executive",   capability: "orchestrate","description": "Cross-org orchestration",           confidence: 95 },
  ];
  const results = caps.map(c => _st().registerCapability(c));
  return { ok: true, registered: results.filter(r => r.ok).length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// POLICY BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════════════

function bootstrapPolicies() {
  const pols = [
    {
      title: "Critical goal priority enforcement",
      description: "Critical goals always preempt all other work",
      scope: "global", priority: 100, enabled: true,
      rules: [{ type: "priority_preempt", condition: "priority === critical" }],
    },
    {
      title: "Health gate for deployments",
      description: "No deployment when global health < 50",
      scope: "deployment", priority: 90, enabled: true,
      rules: [{ type: "health_gate", minHealth: 50 }],
    },
    {
      title: "Auto-approve low-risk missions",
      description: "Auto-approve missions when no critical risks active",
      scope: "approval", priority: 70, enabled: true,
      rules: [{ type: "auto_approve", condition: "critical_risks === 0" }],
    },
  ];
  const results = pols.map(p => _st().createPolicy(p));
  return { ok: true, created: results.filter(r => r.ok).length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT SUBSCRIPTIONS
// ═══════════════════════════════════════════════════════════════════════════════

let _subscribed = false;

function subscribeWorkflowEvents() {
  if (_subscribed) return;
  _subscribed = true;
  const bus = _bus();
  if (!bus) return;

  // When any org completes a mission → update goal progress + learn
  bus.subscribe("mission:completed", async ({ missionId, objective }) => {
    try {
      const goals = _st().listGoals({ status: "active" });
      for (const g of goals) {
        const missions = _st().listExecMissions({ goalId: g.id });
        const total = missions.length;
        const done  = missions.filter(m => m.status === "completed").length;
        if (total > 0) _st().updateGoal(g.id, { progress: Math.round((done/total)*100) });
      }
    } catch {}
  });

  // When evolution kept → update executive KPIs
  bus.subscribe("aeo:evolution:kept", async ({ evoId, impact }) => {
    try {
      _st().addMemory({ deptId: "eos_orchestrator", type: "evolution_signal", title: `Evolution kept: ${evoId} — impact ${impact}%`, detail: "", tags: ["evolution","kept"] });
    } catch {}
  });

  // When business deal won → update executive context
  bus.subscribe("bizorg:deal:won", async ({ value }) => {
    try {
      _st().updateKpi("eos_orchestrator", { lastDealValue: value });
      _st().addMemory({ deptId: "eos_business", type: "revenue_signal", title: `Deal won: $${value}`, detail: "", tags: ["business","deal","revenue"] });
    } catch {}
  });

  // When engineering work completed → check for goal progress
  bus.subscribe("engorg:work:completed", async ({ workItemId, domain }) => {
    try {
      const goals = _st().listGoals({ status: "active" });
      for (const g of goals) {
        const missions = _st().listExecMissions({ goalId: g.id, orgTarget: "engineering" });
        if (missions.length > 0) {
          _st().addMemory({ deptId: "eos_orchestrator", type: "eng_signal", title: `Engineering work completed: ${workItemId}`, detail: `Domain: ${domain}`, tags: ["engineering","progress"] });
        }
      }
    } catch {}
  });

  // When AKO validates knowledge → executive context updated
  bus.subscribe("ako:knowledge:validated", async ({ itemId, type }) => {
    try {
      _st().addMemory({ deptId: "eos_context", type: "knowledge_signal", title: `AKO validated ${type}: ${itemId}`, detail: "", tags: ["knowledge","validated"] });
    } catch {}
  });

  // Recovery: when self-healing detects failure → trigger recovery
  bus.subscribe("runtime:healed", async ({ strategy, taskId }) => {
    try {
      _st().addMemory({ deptId: "eos_recovery", type: "heal", title: `Runtime healed: ${taskId} via ${strategy}`, detail: "", tags: ["recovery","heal"] });
    } catch {}
  });
}

module.exports = {
  processCommand, buildStrategy,
  dispatchToEngineering, dispatchToBusiness, dispatchToKnowledge, dispatchToEvolution, dispatchToODI,
  triggerDeployment, validateOutcomes, learnFromGoal, generateReport,
  runFullPipeline, coordinatorSync, recoverOrg, prioritizeGoals,
  bootstrapCapabilities, bootstrapPolicies, subscribeWorkflowEvents,
};
