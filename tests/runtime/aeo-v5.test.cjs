"use strict";
/**
 * AEO Level 5 — Autonomous Evolution Organization Test Suite
 * Run: node tests/runtime/aeo-v5.test.cjs
 */

const assert = require("assert");
const path   = require("path");

const results = [];
function test(name, fn) { results.push({ name, fn }); }

const st  = require(path.join(__dirname, "../../backend/services/aeoState.cjs"));
const wf  = require(path.join(__dirname, "../../backend/services/aeoWorkflow.cjs"));
const org = require(path.join(__dirname, "../../backend/services/autonomousEvolutionOrg.cjs"));

const TS = Date.now();

// ─── aeoState: Objectives ─────────────────────────────────────────────────────
test("currentQuarter returns Q-string", () => { assert.ok(st.currentQuarter().includes("Q")); });

test("createObjective ok:true", () => {
  const r = st.createObjective({ title: `ObjA ${TS}`, deptId: "aeo_ceo", kpis: ["evolutions_kept"] });
  assert.ok(r.ok, r.error); assert.ok(r.objective.id.startsWith("aeobj_"));
});

test("createObjective duplicate => ok:false", () => {
  const t = `DupObj ${TS}`;
  st.createObjective({ title: t, deptId: "aeo_ceo", kpis: [] });
  assert.ok(!st.createObjective({ title: t, deptId: "aeo_ceo", kpis: [] }).ok);
});

test("listObjectives returns array", () => { assert.ok(Array.isArray(st.listObjectives())); });

// ─── aeoState: Evolutions ─────────────────────────────────────────────────────
test("proposeEvolution ok:true valid type", () => {
  const r = st.proposeEvolution({ title: `EvoA ${TS}`, description: "d", type: "quality", target: "engineering", deptId: "aeo_quality", confidence: 75, impact: 65 });
  assert.ok(r.ok, r.error); assert.strictEqual(r.evolution.status, "proposed");
});

test("proposeEvolution requires title", () => { assert.ok(!st.proposeEvolution({ type: "quality", deptId: "aeo_quality" }).ok); });

test("proposeEvolution rejects invalid type", () => {
  assert.ok(!st.proposeEvolution({ title: `BadType ${TS}`, description: "test", type: "nonexistent", deptId: "aeo_quality" }).ok);
});

test("getEvolution by id", () => {
  const r = st.proposeEvolution({ title: `GetById ${TS}`, description: "test", type: "runtime", target: "runtime", deptId: "aeo_runtime", confidence: 80, impact: 70 });
  assert.ok(st.getEvolution(r.evolution.id).id === r.evolution.id);
});

test("listEvolutions filters by status", () => {
  const list = st.listEvolutions({ status: "proposed" });
  assert.ok(Array.isArray(list) && list.every(e => e.status === "proposed"));
});

test("listEvolutions filters by type", () => {
  assert.ok(st.listEvolutions({ type: "quality" }).every(e => e.type === "quality"));
});

test("updateEvolution patches confidence", () => {
  const r = st.proposeEvolution({ title: `UpdEvo ${TS}`, description: "test", type: "workflow", target: "runtime", deptId: "aeo_workflow", confidence: 72, impact: 60 });
  assert.ok(st.updateEvolution(r.evolution.id, { confidence: 90 }).evolution?.confidence === 90);
});

test("applyEvolution fails on non-approved", () => {
  const r = st.proposeEvolution({ title: `AppFail ${TS}`, description: "test", type: "agent", target: "runtime", deptId: "aeo_agent", confidence: 80, impact: 70 });
  assert.ok(!st.applyEvolution(r.evolution.id).ok);
});

test("applyEvolution succeeds when approved", () => {
  const r = st.proposeEvolution({ title: `AppOK ${TS}`, description: "test", type: "reliability", target: "runtime", deptId: "aeo_reliability", confidence: 85, impact: 75 });
  st.updateEvolution(r.evolution.id, { status: "approved" });
  const ar = st.applyEvolution(r.evolution.id, { beforeMetrics: { velocity: 5 } });
  assert.ok(ar.ok, ar.error); assert.strictEqual(ar.evolution.status, "applied");
});

test("measureEvolution computes numeric impact", () => {
  const r = st.proposeEvolution({ title: `MeasA ${TS}`, description: "test", type: "performance", target: "runtime", deptId: "aeo_performance", confidence: 80, impact: 70 });
  st.updateEvolution(r.evolution.id, { status: "approved" });
  st.applyEvolution(r.evolution.id, { beforeMetrics: { velocity: 5, quality: 80 } });
  const mr = st.measureEvolution(r.evolution.id, { afterMetrics: { velocity: 7, quality: 90 } });
  assert.ok(mr.ok, mr.error); assert.ok(typeof mr.impactMeasured === "number");
});

test("keepEvolution sets status=kept", () => {
  const r = st.proposeEvolution({ title: `KeepA ${TS}`, description: "test", type: "cost", target: "runtime", deptId: "aeo_cost", confidence: 85, impact: 75 });
  st.updateEvolution(r.evolution.id, { status: "approved" });
  st.applyEvolution(r.evolution.id, { beforeMetrics: { cost: 1000 } });
  st.measureEvolution(r.evolution.id, { afterMetrics: { cost: 800 } });
  const kr = st.keepEvolution(r.evolution.id);
  assert.ok(kr.ok, kr.error); assert.strictEqual(kr.evolution.status, "kept");
});

test("revertEvolution sets status=reverted", () => {
  const r = st.proposeEvolution({ title: `RevA ${TS}`, description: "test", type: "security", target: "engineering", deptId: "aeo_security", confidence: 88, impact: 80 });
  st.updateEvolution(r.evolution.id, { status: "approved" });
  st.applyEvolution(r.evolution.id, { beforeMetrics: { score: 90 } });
  st.measureEvolution(r.evolution.id, { afterMetrics: { score: 80 } });
  const rr = st.revertEvolution(r.evolution.id, { reason: "test" });
  assert.ok(rr.ok, rr.error); assert.strictEqual(rr.evolution.status, "reverted");
});

// ─── aeoState: Experiments / Tasks / Memory / Reports / KPIs ─────────────────
test("runExperiment returns id", () => {
  const r = st.runExperiment({ name: `ExpA ${TS}`, type: "capability", payload: {}, deptId: "aeo_experimentation" });
  assert.ok(r.ok, r.error); assert.ok(r.experiment.id.startsWith("aexp_"));
});

test("listExperiments returns array", () => { assert.ok(Array.isArray(st.listExperiments({}))); });

test("createTask returns planned task", () => {
  const r = st.createTask({ title: `TskA ${TS}`, deptId: "aeo_quality", type: "validate" });
  assert.ok(r.ok, r.error); assert.strictEqual(r.task.status, "planned");
});

test("claimTask sets in_progress", () => {
  const r = st.createTask({ title: `ClaimA ${TS}`, deptId: "aeo_workflow", type: "observe" });
  const cr = st.claimTask("aeo_workflow", r.task.id);
  assert.ok(cr.ok, cr.error); assert.strictEqual(cr.task.status, "in_progress");
});

test("claimTask wrong dept => ok:false", () => {
  const r = st.createTask({ title: `WrongClaim ${TS}`, deptId: "aeo_quality", type: "validate" });
  assert.ok(!st.claimTask("aeo_coordinator", r.task.id).ok);
});

test("completeTask sets done", () => {
  const r = st.createTask({ title: `ComplA ${TS}`, deptId: "aeo_cost", type: "evolution" });
  st.claimTask("aeo_cost", r.task.id);
  const cr = st.completeTask(r.task.id, { completedBy: "aeo_cost", outcome: "done" });
  assert.ok(cr.ok, cr.error); assert.strictEqual(cr.task.status, "done");
});

test("listTasks filters by deptId", () => {
  assert.ok(st.listTasks({ deptId: "aeo_quality" }).every(t => t.deptId === "aeo_quality"));
});

test("addMemory ok:true", () => {
  const r = st.addMemory({ deptId: "aeo_ceo", type: "signal", title: `MemA ${TS}`, detail: "test" });
  assert.ok(r.ok, r.error); assert.ok((r.memory || r.entry)?.id?.startsWith("aemem_"));
});

test("listMemory returns array", () => { assert.ok(Array.isArray(st.listMemory({ deptId: "aeo_ceo" }))); });

test("createReport ok:true", () => {
  const r = st.createReport({ title: `RptA ${TS}`, deptId: "aeo_coordinator", type: "sync", data: {}, summary: "test" });
  assert.ok(r.ok, r.error); assert.ok(r.report.id.startsWith("aerpt_"));
});

test("listReports returns array", () => { assert.ok(Array.isArray(st.listReports({ deptId: "aeo_coordinator" }))); });

test("getKpi has deptId field", () => { assert.ok("deptId" in st.getKpi("aeo_ceo")); });

test("getAllKpis non-empty array", () => { assert.ok(st.getAllKpis().length > 0); });

test("updateKpi persists", () => {
  st.updateKpi("aeo_quality", { improvementsValidated: 99 });
  assert.ok((st.getKpi("aeo_quality").improvementsValidated || 0) >= 99);
});

test("detectWeaknesses returns array with source+title", () => {
  const r = st.detectWeaknesses();
  assert.ok(Array.isArray(r));
  if (r.length > 0) { assert.ok(r[0].title && r[0].source); }
});

test("getDashboard has required shape", () => {
  const d = st.getDashboard();
  assert.ok(typeof d.evolutions.total === "number" && typeof d.experiments.total === "number");
});

test("getHistory only kept/reverted", () => {
  assert.ok(st.getHistory().every(e => ["kept","reverted"].includes(e.status)));
});

// ─── aeoWorkflow ──────────────────────────────────────────────────────────────
test("ceoCreateObjective returns objective or null", () => {
  const r = wf.ceoCreateObjective({ title: `WFObjA ${TS}` });
  assert.ok(r === null || r?.id);
});

test("observeWeaknesses returns array", () => {
  const obj = st.listObjectives({ status: "active" })[0];
  assert.ok(Array.isArray(wf.observeWeaknesses(obj?.id)));
});

test("analyzePatterns returns array", () => { assert.ok(Array.isArray(wf.analyzePatterns())); });

test("proposeFromWeakness returns evo or null", () => {
  const w = { title: "Weakness", source: "engineering_smells", severity: "high", detail: "test" };
  const r = wf.proposeFromWeakness(w, null);
  assert.ok(r === null || r?.id);
});

test("autoValidateProposed returns counts", () => {
  const r = wf.autoValidateProposed({ minConfidence: 65, minImpact: 50 });
  assert.ok(typeof r.validated === "number" && typeof r.rejected === "number");
});

test("validateEvolution rejects low-confidence", () => {
  const e = st.proposeEvolution({ title: `LowC ${TS}`, description: "test", type: "workflow", target: "runtime", deptId: "aeo_workflow", confidence: 40, impact: 30 });
  assert.ok(!wf.validateEvolution(e.evolution.id, { minConfidence: 65, minImpact: 50 }).passes);
});

test("validateEvolution passes high-confidence", () => {
  const e = st.proposeEvolution({ title: `HiC ${TS}`, description: "test", type: "runtime", target: "runtime", deptId: "aeo_runtime", confidence: 85, impact: 75 });
  assert.ok(wf.validateEvolution(e.evolution.id, { minConfidence: 65, minImpact: 50 }).passes);
});

test("simulateEvolution on proposed => ok:false", () => {
  const e = st.proposeEvolution({ title: `SimFail ${TS}`, description: "test", type: "agent", target: "runtime", deptId: "aeo_agent", confidence: 80, impact: 70 });
  assert.ok(!wf.simulateEvolution(e.evolution.id).ok);
});

test("simulateEvolution on validated creates experiment", () => {
  const e = st.proposeEvolution({ title: `SimOK ${TS}`, description: "test", type: "capability", target: "runtime", deptId: "aeo_capability", confidence: 80, impact: 70 });
  wf.validateEvolution(e.evolution.id, { minConfidence: 65, minImpact: 50 });
  const r = wf.simulateEvolution(e.evolution.id);
  assert.ok(r.ok, r.error); assert.ok(r.experiment?.id);
});

test("approveEvolutions returns array", () => {
  assert.ok(Array.isArray(wf.approveEvolutions({ minConfidence: 65 }).approved));
});

test("applyEvolution on approved ok:true", () => {
  const e = st.proposeEvolution({ title: `AppWF ${TS}`, description: "test", type: "model", target: "runtime", deptId: "aeo_model", confidence: 82, impact: 72 });
  st.updateEvolution(e.evolution.id, { status: "approved" });
  assert.ok(wf.applyEvolution(e.evolution.id).ok);
});

test("measureEvolution after apply numeric impact", () => {
  const e = st.proposeEvolution({ title: `MeasWF ${TS}`, description: "test", type: "learning", target: "knowledge", deptId: "aeo_learning", confidence: 80, impact: 68 });
  st.updateEvolution(e.evolution.id, { status: "approved" });
  wf.applyEvolution(e.evolution.id);
  const r = wf.measureEvolution(e.evolution.id);
  assert.ok(r.ok, r.error); assert.ok(typeof r.impactMeasured === "number");
});

test("proposePerformanceEvolution no throw", () => { assert.doesNotThrow(() => wf.proposePerformanceEvolution(null)); });
test("proposeCostEvolution no throw",       () => { assert.doesNotThrow(() => wf.proposeCostEvolution(null)); });

test("recordEvolutionLesson no throw", () => {
  const e = st.proposeEvolution({ title: `LsnWF ${TS}`, description: "test", type: "quality", target: "engineering", deptId: "aeo_quality", confidence: 80, impact: 70 });
  st.updateEvolution(e.evolution.id, { status: "kept", impactMeasured: 15 });
  assert.doesNotThrow(() => wf.recordEvolutionLesson(e.evolution.id));
});

test("coordinatorSync ok:true with dashboard", () => {
  const r = wf.coordinatorSync();
  assert.ok(r.ok && r.dashboard);
});

// ─── autonomousEvolutionOrg ───────────────────────────────────────────────────
test("AEO_ORG has 20 departments",     () => { assert.strictEqual(org.AEO_ORG.length, 20); });
test("All dept IDs start with aeo_",  () => { assert.ok(org.AEO_ORG.every(d => d.id.startsWith("aeo_"))); });

test("All depts have required fields", () => {
  for (const d of org.AEO_ORG) {
    assert.ok(d.id && d.role && d.label && d.description, `${d.id} missing fields`);
    assert.ok(d.intervalMs > 0, `${d.id} bad intervalMs`);
    assert.ok(typeof d.tickFn === "function", `${d.id} missing tickFn`);
  }
});

test("register() ok:true count:20", () => {
  const r = org.register();
  assert.ok(r.ok && r.count === 20, `got count=${r.count}`);
});

test("register() idempotent",           () => { assert.ok(org.register().ok); });
test("getOrgStatus returns 20 entries", () => { assert.strictEqual(org.getOrgStatus().length, 20); });

test("getOrgSummary total=20 + dashboard", () => {
  const r = org.getOrgSummary();
  assert.ok(r.total === 20 && r.dashboard);
});

test("aeo_ceo in org status",            () => { assert.ok(org.getOrgStatus().find(a => a.id === "aeo_ceo")); });
test("aeo_coordinator in org status",    () => { assert.ok(org.getOrgStatus().find(a => a.id === "aeo_coordinator")); });
test("aeo_self_assessment in org status",() => { assert.ok(org.getOrgStatus().find(a => a.id === "aeo_self_assessment")); });

// ─── Integration smoke ────────────────────────────────────────────────────────
test("Full lifecycle propose→validate→approve→apply→measure auto-keeps/reverts", () => {
  const e = st.proposeEvolution({ title: `Lifecycle ${TS}`, description: "test", type: "workflow", target: "runtime", deptId: "aeo_workflow", confidence: 82, impact: 72 });
  wf.validateEvolution(e.evolution.id, { minConfidence: 65, minImpact: 50 });
  st.updateEvolution(e.evolution.id, { status: "approved" });
  wf.applyEvolution(e.evolution.id);
  wf.measureEvolution(e.evolution.id);
  const final = st.getEvolution(e.evolution.id);
  assert.ok(["kept","reverted"].includes(final.status), `Unexpected: ${final.status}`);
});

test("Dashboard shows non-zero evolutions after lifecycle", () => {
  assert.ok(st.getDashboard().evolutions.total > 0);
});

test("History non-empty after lifecycle test", () => {
  assert.ok(st.getHistory().length > 0);
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
  console.log(`AEO LEVEL 5 TEST RESULTS`);
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
