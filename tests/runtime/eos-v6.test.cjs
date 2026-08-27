"use strict";
/**
 * EOS Level 6 — Executive Operating System Test Suite
 * 70 tests: state, workflow, agents
 * Run: node tests/runtime/eos-v6.test.cjs
 */

const assert = require("assert");
const path   = require("path");

const results = [];
function test(name, fn) { results.push({ name, fn }); }

const st  = require(path.join(__dirname, "../../backend/services/executiveState.cjs"));
const wf  = require(path.join(__dirname, "../../backend/services/executiveWorkflow.cjs"));
const org = require(path.join(__dirname, "../../backend/services/executiveOrg.cjs"));

const TS = Date.now();

// ─── executiveState: Goals ────────────────────────────────────────────────────
test("currentQuarter returns Q-string", () => assert.ok(st.currentQuarter().includes("Q")));

test("createGoal ok:true", () => {
  const r = st.createGoal({ title: `GoalA ${TS}`, description: "test", priority: "high" });
  assert.ok(r.ok, r.error);
  assert.ok(r.goal.id.startsWith("egoal_"));
  assert.strictEqual(r.goal.status, "active");
});

test("createGoal duplicate => ok:false", () => {
  const t = `DupGoal ${TS}`;
  st.createGoal({ title: t, description: "d" });
  assert.ok(!st.createGoal({ title: t, description: "d" }).ok);
});

test("createGoal requires title", () => assert.ok(!st.createGoal({}).ok));

test("listGoals returns array", () => assert.ok(Array.isArray(st.listGoals())));

test("listGoals filters by status", () => {
  assert.ok(st.listGoals({ status: "active" }).every(g => g.status === "active"));
});

test("getGoal by id", () => {
  const r = st.createGoal({ title: `GetGoal ${TS}`, description: "d" });
  assert.ok(st.getGoal(r.goal.id)?.id === r.goal.id);
});

test("updateGoal patches field", () => {
  const r = st.createGoal({ title: `UpdGoal ${TS}`, description: "d" });
  const u = st.updateGoal(r.goal.id, { priority: "critical" });
  assert.ok(u.goal.priority === "critical");
});

// ─── executiveState: Strategies ──────────────────────────────────────────────
test("createStrategy ok:true", () => {
  const g = st.createGoal({ title: `StratGoal ${TS}`, description: "d" });
  const r = st.createStrategy({ goalId: g.goal.id, title: `Strat ${TS}`, orgTargets: ["engineering","business"] });
  assert.ok(r.ok, r.error);
  assert.ok(r.strategy.id.startsWith("estrat_"));
});

test("createStrategy requires goalId + title", () => {
  assert.ok(!st.createStrategy({ title: "no goal" }).ok);
});

test("listStrategies filters by goalId", () => {
  const g = st.createGoal({ title: `StratGoal2 ${TS}`, description: "d" });
  st.createStrategy({ goalId: g.goal.id, title: `StratB ${TS}` });
  const list = st.listStrategies({ goalId: g.goal.id });
  assert.ok(list.every(s => s.goalId === g.goal.id));
});

// ─── executiveState: Executive Missions ──────────────────────────────────────
test("createExecMission ok:true", () => {
  const g = st.createGoal({ title: `MissGoal ${TS}`, description: "d" });
  const r = st.createExecMission({ goalId: g.goal.id, title: `ExMiss ${TS}`, orgTargets: ["engineering"] });
  assert.ok(r.ok, r.error);
  assert.ok(r.mission.id.startsWith("emiss_"));
});

test("createExecMission requires title", () => assert.ok(!st.createExecMission({}).ok));

test("listExecMissions filters by goalId", () => {
  const g = st.createGoal({ title: `MissGoalB ${TS}`, description: "d" });
  st.createExecMission({ goalId: g.goal.id, title: `ExMissB ${TS}`, orgTargets: ["business"] });
  const list = st.listExecMissions({ goalId: g.goal.id });
  assert.ok(list.every(m => m.goalId === g.goal.id));
});

test("updateExecMission ok:true", () => {
  const g = st.createGoal({ title: `MissGoalC ${TS}`, description: "d" });
  const m = st.createExecMission({ goalId: g.goal.id, title: `ExMissC ${TS}` });
  const u = st.updateExecMission(m.mission.id, { status: "completed" });
  assert.ok(u.ok && u.mission.status === "completed");
});

// ─── executiveState: Decisions ────────────────────────────────────────────────
test("recordDecision ok:true", () => {
  const r = st.recordDecision({ title: `DecA ${TS}`, chosen: "option_a", type: "strategic", deptId: "eos_decision" });
  assert.ok(r.ok, r.error);
  assert.ok(r.decision.id.startsWith("edec_"));
});

test("recordDecision requires title + chosen", () => assert.ok(!st.recordDecision({ type: "strategic" }).ok));

test("listDecisions returns array", () => assert.ok(Array.isArray(st.listDecisions())));

// ─── executiveState: Approvals ────────────────────────────────────────────────
test("requestApproval ok:true", () => {
  const r = st.requestApproval({ title: `ApprA ${TS}`, requiredBy: "eos_approval" });
  assert.ok(r.ok, r.error);
  assert.ok(r.approval.id.startsWith("eappr_"));
  assert.strictEqual(r.approval.status, "pending");
});

test("requestApproval autoApprove=true sets approved", () => {
  const r = st.requestApproval({ title: `AutoAppr ${TS}`, autoApprove: true });
  assert.ok(r.ok && r.approval.status === "approved");
});

test("resolveApproval sets approved", () => {
  const a = st.requestApproval({ title: `ResolveAppr ${TS}` });
  const r = st.resolveApproval(a.approval.id, { approved: true, resolvedBy: "test" });
  assert.ok(r.ok && r.approval.status === "approved");
});

test("listApprovals filters by status", () => {
  assert.ok(st.listApprovals({ status: "pending" }).every(a => a.status === "pending"));
});

// ─── executiveState: Risks ────────────────────────────────────────────────────
test("raiseRisk ok:true", () => {
  const r = st.raiseRisk({ title: `RiskA ${TS}`, severity: "high", source: "test" });
  assert.ok(r.ok, r.error);
  assert.ok(r.risk.id.startsWith("erisk_"));
  assert.strictEqual(r.risk.status, "active");
});

test("raiseRisk requires title", () => assert.ok(!st.raiseRisk({}).ok));

test("resolveRisk sets resolved", () => {
  const r = st.raiseRisk({ title: `RiskB ${TS}`, severity: "low" });
  const rr = st.resolveRisk(r.risk.id, { resolution: "fixed" });
  assert.ok(rr.ok && rr.risk.status === "resolved");
});

test("listRisks filters by status", () => {
  assert.ok(st.listRisks({ status: "active" }).every(r => r.status === "active"));
});

// ─── executiveState: Timelines ────────────────────────────────────────────────
test("createTimeline ok:true", () => {
  const g = st.createGoal({ title: `TLGoal ${TS}`, description: "d" });
  const r = st.createTimeline({ goalId: g.goal.id, title: `TL ${TS}`, phases: [{ name: "Phase 1", orgTarget: "engineering" }] });
  assert.ok(r.ok, r.error);
  assert.ok(r.timeline.id.startsWith("etl_"));
  assert.ok(r.timeline.phases.length === 1);
});

test("advanceTimeline changes phase status", () => {
  const g = st.createGoal({ title: `TLGoalB ${TS}`, description: "d" });
  const tl = st.createTimeline({ goalId: g.goal.id, title: `TLB ${TS}`, phases: [{ name: "P1" }, { name: "P2" }] });
  const ph = tl.timeline.phases[0];
  const r = st.advanceTimeline(tl.timeline.id, ph.id);
  assert.ok(r.ok && r.phase.status === "active");
});

// ─── executiveState: Policies ─────────────────────────────────────────────────
test("createPolicy ok:true", () => {
  const r = st.createPolicy({ title: `PolA ${TS}`, scope: "global", rules: [], enabled: true });
  assert.ok(r.ok, r.error);
  assert.ok(r.policy.id.startsWith("epol_"));
});

test("createPolicy duplicate enabled => ok:false", () => {
  const t = `DupPol ${TS}`;
  st.createPolicy({ title: t, scope: "global", enabled: true });
  assert.ok(!st.createPolicy({ title: t, scope: "global", enabled: true }).ok);
});

test("listPolicies returns array", () => assert.ok(Array.isArray(st.listPolicies())));

test("evaluatePolicy returns violations array", () => {
  const r = st.evaluatePolicy({ budget: 0, activeOrgs: 3 });
  assert.ok(r.ok && Array.isArray(r.violations));
});

// ─── executiveState: Budgets ──────────────────────────────────────────────────
test("createBudget ok:true", () => {
  const g = st.createGoal({ title: `BudGoal ${TS}`, description: "d" });
  const r = st.createBudget({ goalId: g.goal.id, title: `Bud ${TS}`, totalUsd: 5000 });
  assert.ok(r.ok, r.error);
  assert.ok(r.budget.remainingUsd === 5000);
});

test("allocateBudget reduces remaining", () => {
  const g = st.createGoal({ title: `BudGoalB ${TS}`, description: "d" });
  const b = st.createBudget({ goalId: g.goal.id, title: `BudB ${TS}`, totalUsd: 1000 });
  const r = st.allocateBudget(b.budget.id, { orgTarget: "engineering", amountUsd: 300 });
  assert.ok(r.ok && r.budget.remainingUsd === 700);
});

test("allocateBudget rejects over-budget", () => {
  const g = st.createGoal({ title: `BudGoalC ${TS}`, description: "d" });
  const b = st.createBudget({ goalId: g.goal.id, title: `BudC ${TS}`, totalUsd: 100 });
  assert.ok(!st.allocateBudget(b.budget.id, { orgTarget: "engineering", amountUsd: 500 }).ok);
});

// ─── executiveState: Allocations ─────────────────────────────────────────────
test("allocateResource ok:true", () => {
  const r = st.allocateResource({ orgTarget: "engineering", resource: "agent_capacity", amount: 1 });
  assert.ok(r.ok && r.allocation.id.startsWith("ealloc_"));
});

test("releaseResource sets released", () => {
  const a = st.allocateResource({ orgTarget: "knowledge", resource: "compute" });
  const r = st.releaseResource(a.allocation.id);
  assert.ok(r.ok && r.allocation.status === "released");
});

// ─── executiveState: Memory + Reports + KPIs ─────────────────────────────────
test("addMemory ok:true", () => {
  const r = st.addMemory({ deptId: "eos_orchestrator", type: "signal", title: `Mem ${TS}` });
  assert.ok(r.ok && r.entry.id.startsWith("emem_"));
});

test("listMemory returns array", () => assert.ok(Array.isArray(st.listMemory({ deptId: "eos_orchestrator" }))));

test("createReport ok:true", () => {
  const r = st.createReport({ title: `Rpt ${TS}`, deptId: "eos_orchestrator", type: "executive", summary: "test" });
  assert.ok(r.ok && r.report.id.startsWith("erpt_"));
});

test("listReports returns array", () => assert.ok(Array.isArray(st.listReports({ deptId: "eos_orchestrator" }))));

test("getKpi has deptId field", () => assert.ok("deptId" in st.getKpi("eos_orchestrator")));
test("getAllKpis non-empty array", () => assert.ok(st.getAllKpis().length > 0));

// ─── executiveState: Health + Dashboard ──────────────────────────────────────
test("getGlobalHealth returns score 0–100", () => {
  const h = st.getGlobalHealth();
  assert.ok(h && typeof h.score === "number" && h.score >= 0 && h.score <= 100);
});

test("getDashboard has required shape", () => {
  const d = st.getDashboard();
  assert.ok(d && typeof d.goals.total === "number");
  assert.ok(typeof d.missions.total === "number");
  assert.ok(typeof d.health.score === "number");
  assert.ok(d.orgStatus !== undefined);
});

test("syncOrgStatus returns orgStatus object", () => {
  const r = st.syncOrgStatus();
  assert.ok(r && typeof r === "object" && r.orgStatus !== undefined);
});

// ─── executiveState: Recoveries + Capabilities ───────────────────────────────
test("createRecovery ok:true", () => {
  const r = st.createRecovery({ failedOrg: "engineering", reason: "test", recoveryPlan: ["step1"] });
  assert.ok(r.ok && r.recovery.id.startsWith("erec_"));
});

test("resolveRecovery sets resolved", () => {
  const r = st.createRecovery({ failedOrg: "business", reason: "test" });
  const rr = st.resolveRecovery(r.recovery.id, { success: true });
  assert.ok(rr.ok && rr.recovery.status === "resolved");
});

test("registerCapability ok:true", () => {
  const r = st.registerCapability({ orgTarget: "engineering", capability: `cap_${TS}`, description: "test" });
  assert.ok(r.ok && r.capability.id.startsWith("ecap_"));
});

test("registerCapability is idempotent (updates confidence)", () => {
  const cap = `idem_${TS}`;
  st.registerCapability({ orgTarget: "knowledge", capability: cap, confidence: 70 });
  const r = st.registerCapability({ orgTarget: "knowledge", capability: cap, confidence: 90 });
  assert.ok(r.ok && r.capability.confidence === 90);
});

// ─── executiveWorkflow ────────────────────────────────────────────────────────
test("processCommand creates goal", () => {
  const r = wf.processCommand(`Launch Test ${TS}`, { priority: "high" });
  assert.ok(r.ok && (r.goal || r.reused), `got: ${JSON.stringify(r)}`);
});

test("processCommand deduplicates same command", () => {
  const cmd = `Dedup Command ${TS}`;
  wf.processCommand(cmd);
  const r = wf.processCommand(cmd);
  assert.ok(r.ok); // returns existing goal
});

test("buildStrategy creates strategy for goal", () => {
  const gr = wf.processCommand(`BldStrat ${TS}`);
  const r = wf.buildStrategy(gr.goal.id);
  assert.ok(r.ok || r.reused);
  assert.ok(r.strategy?.id);
});

test("dispatchToEngineering returns dispatched array", () => {
  const gr = wf.processCommand(`DispEng ${TS}`);
  const r = wf.dispatchToEngineering(gr.goal.id);
  assert.ok(r.ok && Array.isArray(r.dispatched));
});

test("dispatchToBusiness returns dispatched array", () => {
  const gr = wf.processCommand(`DispBiz ${TS}`);
  const r = wf.dispatchToBusiness(gr.goal.id);
  assert.ok(r.ok && Array.isArray(r.dispatched));
});

test("dispatchToKnowledge returns dispatched array", () => {
  const gr = wf.processCommand(`DispKnow ${TS}`);
  const r = wf.dispatchToKnowledge(gr.goal.id);
  assert.ok(r.ok && Array.isArray(r.dispatched));
});

test("dispatchToEvolution returns dispatched array", () => {
  const gr = wf.processCommand(`DispEvo ${TS}`);
  const r = wf.dispatchToEvolution(gr.goal.id);
  assert.ok(r.ok && Array.isArray(r.dispatched));
});

test("dispatchToODI returns dispatched array", () => {
  const gr = wf.processCommand(`DispODI ${TS}`);
  const r = wf.dispatchToODI(gr.goal.id);
  assert.ok(r.ok && Array.isArray(r.dispatched));
});

test("triggerDeployment returns ok:true", () => {
  const gr = wf.processCommand(`Deploy ${TS}`);
  const r = wf.triggerDeployment(gr.goal.id);
  assert.ok(r.ok);
});

test("validateOutcomes returns passed + healthScore", () => {
  const gr = wf.processCommand(`Validate ${TS}`);
  const r = wf.validateOutcomes(gr.goal.id);
  assert.ok(r.ok && typeof r.healthScore === "number" && typeof r.passed === "boolean");
});

test("generateReport returns report with id", () => {
  const gr = wf.processCommand(`Report ${TS}`);
  const r = wf.generateReport(gr.goal.id);
  assert.ok(r.ok && r.report.id.startsWith("erpt_"));
});

test("prioritizeGoals returns prioritized array", () => {
  const r = wf.prioritizeGoals();
  assert.ok(r.ok && Array.isArray(r.prioritized));
});

test("coordinatorSync returns ok:true + health", () => {
  const r = wf.coordinatorSync();
  assert.ok(r.ok && r.health && typeof r.health.score === "number");
});

test("bootstrapCapabilities registers capabilities", () => {
  const r = wf.bootstrapCapabilities();
  assert.ok(r.ok && r.registered > 0);
});

test("bootstrapPolicies creates policies", () => {
  const r = wf.bootstrapPolicies();
  assert.ok(r.ok);
});

test("learnFromGoal does not throw", () => {
  const gr = wf.processCommand(`Learn ${TS}`);
  assert.doesNotThrow(() => wf.learnFromGoal(gr.goal.id));
});

test("runFullPipeline resolves with steps", async () => {
  const r = await wf.runFullPipeline(`Full Pipeline ${TS}`, { priority: "high" });
  assert.ok(r.ok, `got: ${r.error}`);
  assert.ok(Array.isArray(r.steps) && r.steps.length >= 9);
  assert.ok(r.goalId);
  assert.ok(r.reportId);
});

// ─── executiveOrg ─────────────────────────────────────────────────────────────
test("EOS_ORG has 20 departments",     () => assert.strictEqual(org.EOS_ORG.length, 20));
test("All dept IDs start with eos_",   () => assert.ok(org.EOS_ORG.every(d => d.id.startsWith("eos_"))));

test("All depts have required fields", () => {
  for (const d of org.EOS_ORG) {
    assert.ok(d.id && d.role && d.label && d.description, `${d.id} missing fields`);
    assert.ok(d.intervalMs > 0, `${d.id} bad intervalMs`);
    assert.ok(typeof d.tickFn === "function", `${d.id} missing tickFn`);
  }
});

test("register() ok:true count:20", () => {
  const r = org.register();
  assert.ok(r.ok && r.count === 20, `got count=${r.count}`);
});

test("register() idempotent",           () => assert.ok(org.register().ok));
test("getOrgStatus returns 20 entries", () => assert.strictEqual(org.getOrgStatus().length, 20));

test("getOrgSummary total=20 + dashboard", () => {
  const r = org.getOrgSummary();
  assert.ok(r.total === 20 && r.dashboard);
});

test("eos_orchestrator in org status",  () => assert.ok(org.getOrgStatus().find(a => a.id === "eos_orchestrator")));
test("eos_health in org status",        () => assert.ok(org.getOrgStatus().find(a => a.id === "eos_health")));
test("eos_coordinator in org status",   () => assert.ok(org.getOrgStatus().find(a => a.id === "eos_coordinator")));

// ─── Integration smoke ────────────────────────────────────────────────────────
test("Full goal→report smoke test", async () => {
  const r = await wf.runFullPipeline(`Smoke Test ${TS}`, { priority: "critical" });
  assert.ok(r.ok, r.error);
  const goal = st.getGoal(r.goalId);
  assert.ok(goal, "Goal should exist after pipeline");
  const missions = st.listExecMissions({ goalId: r.goalId });
  assert.ok(missions.length >= 5, `Expected ≥5 missions, got ${missions.length}`);
  const decisions = st.listDecisions({ goalId: r.goalId });
  assert.ok(decisions.length >= 1, "Should have at least 1 decision");
  const reports = st.listReports({ deptId: "eos_orchestrator" });
  assert.ok(reports.length >= 1, "Should have at least 1 report");
});

test("Dashboard reflects pipeline", () => {
  const d = st.getDashboard();
  assert.ok(d.goals.total > 0 && d.missions.total > 0);
});

// ─── Runner ───────────────────────────────────────────────────────────────────
async function runAll() {
  let passed = 0, failed = 0;
  const errors = [];
  for (const { name, fn } of results) {
    try {
      const r = fn();
      if (r && typeof r.then === "function") await r;
      passed++;
    } catch (e) {
      failed++;
      errors.push({ name, error: e.message });
    }
  }
  const total = passed + failed;
  console.log(`\n${"═".repeat(60)}`);
  console.log(`EOS LEVEL 6 TEST RESULTS`);
  console.log(`${"═".repeat(60)}`);
  console.log(`Passed: ${passed}/${total}`);
  if (errors.length > 0) {
    console.log(`\nFailed tests:`);
    for (const e of errors) console.log(`  ✗ ${e.name}: ${e.error}`);
  } else {
    console.log(`\nAll tests passed!`);
  }
  console.log(`${"═".repeat(60)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll();
