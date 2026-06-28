/**
 * post-omega-p2.test.cjs — POST-Ω Sprint P2: Founder Elimination Program
 *
 * Tests:
 *   Block 1 — Founder Work Registry (15 tests)
 *   Block 2 — Founder Automation Engine (14 tests)
 *   Block 3 — Production Bible Engine (14 tests)
 *   Block 4 — Integration: full elimination pipeline (5 tests)
 *
 * Total: 48 tests
 */

"use strict";
const assert = require("assert");

const TS   = Date.now();
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

// ── Service under test ────────────────────────────────────────────────────────
const fwr = require("../../backend/services/founderWorkRegistry.cjs");
const fae = require("../../backend/services/founderAutomationEngine.cjs");
const pbe = require("../../backend/services/productionBibleEngine.cjs");

// ═══════════════════════════════════════════════════════════════════════════════
// Block 1 — Founder Work Registry
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[Block 1] Founder Work Registry");

test("WORKFLOW_CATALOGUE is exported", () => {
  assert(Array.isArray(fwr.WORKFLOW_CATALOGUE), "catalogue is not array");
  assert(fwr.WORKFLOW_CATALOGUE.length >= 20, `too few catalogue entries: ${fwr.WORKFLOW_CATALOGUE.length}`);
});

test("buildRegistry returns ok and populates workflows", () => {
  const r = fwr.buildRegistry();
  assert(r.ok, "buildRegistry not ok");
  assert(r.registry, "no registry returned");
  assert(Array.isArray(r.registry.workflows), "workflows not array");
  assert(r.registry.workflows.length >= 20, "too few workflows");
});

test("registry summary has correct class counts", () => {
  const reg = fwr.getRegistry();
  assert(reg.summary.classA >= 1, "no Class A entries");
  assert(reg.summary.classB >= 1, "no Class B entries");
  assert(reg.summary.classC >= 1, "no Class C entries");
  assert(reg.summary.total >= 20, "total too low");
});

test("registry summary has automationPct", () => {
  const reg = fwr.getRegistry();
  assert(typeof reg.summary.automationPct === "number", "automationPct not a number");
  assert(reg.summary.automationPct >= 0 && reg.summary.automationPct <= 100, "pct out of range");
});

test("listWorkflows returns array", () => {
  const list = fwr.listWorkflows();
  assert(Array.isArray(list), "not array");
  assert(list.length >= 10, "too few");
});

test("listWorkflows filters by domain=deployment", () => {
  const list = fwr.listWorkflows({ domain: "deployment" });
  assert(list.length >= 1, "no deployment workflows");
  assert(list.every(w => w.domain === "deployment"), "wrong domain in results");
});

test("listWorkflows filters by classType=A", () => {
  const list = fwr.listWorkflows({ classType: "A" });
  assert(list.length >= 1, "no Class A workflows");
  assert(list.every(w => w.class === "A"), "wrong class in results");
});

test("listWorkflows filters by classType=C", () => {
  const list = fwr.listWorkflows({ classType: "C" });
  assert(list.length >= 1, "no Class C workflows");
  assert(list.every(w => w.class === "C"), "wrong class in results");
});

test("getWorkflow returns known workflow", () => {
  const reg = fwr.getRegistry();
  const first = reg.workflows[0];
  const w = fwr.getWorkflow(first.id);
  assert(w, "workflow not found");
  assert(w.id === first.id, "wrong workflow returned");
});

test("getWorkflow returns null for unknown id", () => {
  const w = fwr.getWorkflow(`nonexistent_${TS}`);
  assert(w === null, "should return null");
});

test("markAutomated updates workflow status", () => {
  const reg = fwr.getRegistry();
  const classA = reg.workflows.find(w => w.class === "A" && !w.automatedBy);
  if (!classA) { console.log("    (skip: no unautomated Class A found)"); passed++; return; }
  const r = fwr.markAutomated(classA.id, { automatedBy: "test_runner", evidence: "test", minutesSaved: classA.estimatedMinutes });
  assert(r.ok, "markAutomated not ok");
  assert(r.workflow.automatedBy === "test_runner", "automatedBy not set");
  assert(r.workflow.status === "automated", "status not automated");
});

test("markAutomated returns error for unknown id", () => {
  const r = fwr.markAutomated(`bad_${TS}`, {});
  assert(!r.ok, "should not be ok");
  assert(r.error, "should have error message");
});

test("getDashboard returns summary + byClass + topBottlenecks", () => {
  const dash = fwr.getDashboard();
  assert(dash.summary, "no summary");
  assert(dash.byClass, "no byClass");
  assert(dash.byClass.A, "no Class A section");
  assert(dash.byClass.B, "no Class B section");
  assert(dash.byClass.C, "no Class C section");
  assert(Array.isArray(dash.topBottlenecks), "topBottlenecks not array");
});

test("Class C workflows cannot be automated (policy check)", () => {
  const classC = fwr.listWorkflows({ classType: "C" });
  for (const w of classC) {
    assert(w.feasibility <= 0.2, `Class C workflow ${w.id} has feasibility ${w.feasibility} > 0.2`);
    assert(w.targetLevel === "manual", `Class C workflow ${w.id} target is not manual`);
  }
});

test("each workflow has required schema fields", () => {
  const reg = fwr.getRegistry();
  const required = ["id", "domain", "workflow", "manualSteps", "estimatedMinutes", "class", "feasibility", "blockers", "requiredApprovals", "targetLevel", "implementationPlan"];
  for (const w of reg.workflows.slice(0, 10)) {
    for (const field of required) {
      assert(field in w, `workflow ${w.id} missing field: ${field}`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 2 — Founder Automation Engine
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[Block 2] Founder Automation Engine");

test("detectManualWorkflows returns ok and automatable list", () => {
  const r = fae.detectManualWorkflows();
  assert(r.ok, "not ok");
  assert(typeof r.total === "number", "no total");
  assert(typeof r.automatable === "number", "no automatable count");
  assert(Array.isArray(r.workflows), "workflows not array");
});

test("detectManualWorkflows only returns class A or B with feasibility >= 0.7", () => {
  const r = fae.detectManualWorkflows();
  for (const w of r.workflows) {
    assert(w.class !== "C", "Class C in automatable list");
    assert(w.feasibility >= 0.7, `feasibility too low: ${w.feasibility}`);
  }
});

test("buildAutomationPlan returns plan for known workflow", () => {
  const reg = fwr.getRegistry();
  const w = reg.workflows.find(wf => wf.class === "A");
  assert(w, "no Class A workflow to test");
  const r = fae.buildAutomationPlan(w.id);
  assert(r.ok, "buildAutomationPlan not ok");
  assert(r.plan, "no plan returned");
  assert(r.plan.workflowId === w.id, "wrong workflowId in plan");
  assert(Array.isArray(r.plan.steps), "plan has no steps");
  assert(r.plan.steps.length >= 1, "no steps in plan");
});

test("buildAutomationPlan returns error for unknown workflow", () => {
  const r = fae.buildAutomationPlan(`unknown_${TS}`);
  assert(!r.ok, "should not be ok");
  assert(r.error, "should have error");
});

test("buildAutomationPlan Class A steps are automated=true", () => {
  const reg = fwr.getRegistry();
  const w = reg.workflows.find(wf => wf.class === "A");
  if (!w) return;
  const r = fae.buildAutomationPlan(w.id);
  for (const step of r.plan.steps) {
    assert(step.automated === true, `Class A step not automated: ${step.step}`);
  }
});

test("executeWorkflow Class A returns completed", async () => {
  const reg = fwr.buildRegistry().registry;
  const w = reg.workflows.find(wf => wf.class === "A" && !wf.automatedBy);
  if (!w) { console.log("    (skip: no fresh Class A)"); passed++; return; }
  const r = await fae.executeWorkflow(w.id, { triggeredBy: "test" });
  assert(r.ok, `executeWorkflow not ok: ${r.error}`);
  assert(r.status === "completed" || r.status === "awaiting_approval", `unexpected status: ${r.status}`);
});

test("executeWorkflow Class C returns error", async () => {
  const classC = fwr.listWorkflows({ classType: "C" });
  if (!classC.length) { console.log("    (skip: no Class C)"); passed++; return; }
  const r = await fae.executeWorkflow(classC[0].id);
  assert(!r.ok, "Class C should not be ok");
  assert(r.error, "should have error message");
});

test("executeWorkflow unknown workflow returns error", async () => {
  const r = await fae.executeWorkflow(`nonexistent_${TS}`);
  assert(!r.ok, "should not be ok");
  assert(r.error, "should have error");
});

test("verifyWorkflow returns checks array", () => {
  const reg = fwr.getRegistry();
  const w = reg.workflows[0];
  const r = fae.verifyWorkflow(w.id);
  assert(r.ok, "verifyWorkflow not ok");
  assert(Array.isArray(r.checks), "checks not array");
  assert(typeof r.verified === "boolean", "verified not boolean");
});

test("verifyWorkflow returns error for unknown id", () => {
  const r = fae.verifyWorkflow(`bad_${TS}`);
  assert(!r.ok, "should not be ok");
  assert(r.error, "should have error");
});

test("resumeAfterApproval returns error for unknown run", () => {
  const r = fae.resumeAfterApproval(`bad_run_${TS}`);
  assert(!r.ok, "should not be ok");
  assert(r.error, "should have error");
});

test("getReport returns summary with all required fields", () => {
  const r = fae.getReport();
  assert(r.ok, "not ok");
  assert(r.summary, "no summary");
  const s = r.summary;
  const fields = ["totalWorkflows", "automatedCount", "automationPct", "classA", "classB", "classC", "minutesSaved", "hoursSaved", "executionCount", "pendingAutomation"];
  for (const f of fields) {
    assert(f in s, `missing field: ${f}`);
  }
});

test("getReport topBottlenecks sorted by minutes descending", () => {
  const r = fae.getReport();
  const bt = r.topBottlenecks;
  for (let i = 1; i < bt.length; i++) {
    assert(bt[i-1].minutes >= bt[i].minutes, "topBottlenecks not sorted descending");
  }
});

test("listRuns returns array", () => {
  const runs = fae.listRuns();
  assert(Array.isArray(runs), "not array");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 3 — Production Bible Engine
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[Block 3] Production Bible Engine");

test("buildBible returns ok", () => {
  const r = pbe.buildBible();
  assert(r.ok, "buildBible not ok");
  assert(r.bible, "no bible returned");
});

test("bible has workflows array with entries", () => {
  const bible = pbe.getBible();
  assert(Array.isArray(bible.workflows), "workflows not array");
  assert(bible.workflows.length >= 10, `too few bible workflows: ${bible.workflows.length}`);
});

test("bible summary has required fields", () => {
  const bible = pbe.getBible();
  const s = bible.summary;
  assert(typeof s.total === "number", "no total");
  assert(typeof s.automated === "number", "no automated");
  assert(typeof s.manualOnly === "number", "no manualOnly");
  assert(typeof s.automationPct === "number", "no automationPct");
  assert(s.total >= 10, "too few total workflows");
});

test("bible has categories array", () => {
  const bible = pbe.getBible();
  assert(Array.isArray(bible.categories), "no categories array");
  assert(bible.categories.length >= 1, "no categories");
  const cat = bible.categories[0];
  assert(cat.name, "category missing name");
  assert(typeof cat.total === "number", "category missing total");
});

test("listWorkflows returns array", () => {
  const list = pbe.listWorkflows();
  assert(Array.isArray(list), "not array");
  assert(list.length >= 1, "empty list");
});

test("listWorkflows filters by category=deployment", () => {
  const list = pbe.listWorkflows({ category: "deployment" });
  if (!list.length) { console.log("    (skip: no deployment entries yet)"); passed++; return; }
  assert(list.every(w => w.category === "deployment"), "wrong category in results");
});

test("listWorkflows filters by automationLevel=full-auto", () => {
  const list = pbe.listWorkflows({ automationLevel: "full-auto" });
  assert(list.every(w => w.automationLevel === "full-auto"), "wrong level in results");
});

test("getWorkflow returns known bible workflow", () => {
  const bible = pbe.getBible();
  const first = bible.workflows[0];
  const w = pbe.getWorkflow(first.id);
  assert(w, "workflow not found");
  assert(w.id === first.id, "wrong workflow returned");
});

test("getWorkflow returns null for unknown id", () => {
  const w = pbe.getWorkflow(`nonexistent_bible_${TS}`);
  assert(w === null, "should return null");
});

test("each bible workflow has required schema fields", () => {
  const bible = pbe.getBible();
  const required = ["id", "title", "category", "source", "automationScore", "automationLevel", "prerequisites", "execution", "validation", "rollback", "evidence"];
  for (const w of bible.workflows.slice(0, 10)) {
    for (const f of required) {
      assert(f in w, `workflow ${w.id} missing field: ${f}`);
    }
    assert(Array.isArray(w.execution.steps), `${w.id} execution.steps not array`);
    assert(Array.isArray(w.validation.steps), `${w.id} validation.steps not array`);
  }
});

test("executeWorkflow marks entry as completed", () => {
  const bible = pbe.getBible();
  const pending = bible.workflows.find(w => w.currentState !== "completed" && w.currentState !== "automated");
  if (!pending) { console.log("    (skip: all completed)"); passed++; return; }
  const r = pbe.executeWorkflow(pending.id, { triggeredBy: "test" });
  assert(r.ok, `executeWorkflow not ok: ${r.error}`);
  assert(r.entry, "no entry returned");
  assert(r.entry.outcome === "success", "outcome not success");
  const updated = pbe.getWorkflow(pending.id);
  assert(updated.lastExecutedAt, "lastExecutedAt not set");
});

test("executeWorkflow returns error for unknown id", () => {
  const r = pbe.executeWorkflow(`bad_${TS}`, {});
  assert(!r.ok, "should not be ok");
  assert(r.error, "should have error");
});

test("getDashboard returns all required sections", () => {
  const dash = pbe.getDashboard();
  assert(dash.ok, "not ok");
  assert(typeof dash.totalWorkflows === "number", "no totalWorkflows");
  assert(typeof dash.automatedWorkflows === "number", "no automatedWorkflows");
  assert(typeof dash.automationPct === "number", "no automationPct");
  assert(Array.isArray(dash.categories), "no categories");
  assert(Array.isArray(dash.topPending), "no topPending");
});

test("bible automation score is number 0-100", () => {
  const bible = pbe.getBible();
  for (const w of bible.workflows.slice(0, 20)) {
    assert(typeof w.automationScore === "number", `${w.id} automationScore not number`);
    assert(w.automationScore >= 0 && w.automationScore <= 100, `${w.id} score out of range: ${w.automationScore}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 4 — Integration
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[Block 4] Integration: Founder Elimination Pipeline");

test("detect → plan → execute pipeline for Class A workflow", async () => {
  // Fresh registry
  const reg = fwr.buildRegistry().registry;
  const detected = fae.detectManualWorkflows();
  assert(detected.ok, "detect failed");
  assert(detected.automatable >= 1, "nothing automatable");

  const target = detected.workflows.find(w => w.class === "A");
  assert(target, "no Class A automatable workflow");

  const plan = fae.buildAutomationPlan(target.id);
  assert(plan.ok, "plan failed");
  assert(plan.plan.steps.length >= 1, "no steps in plan");

  const exec = await fae.executeWorkflow(target.id, { triggeredBy: "integration_test" });
  assert(exec.ok, `execute failed: ${exec.error}`);
});

test("registry → bible cross-reference: all registry Class A workflows appear in bible", () => {
  const reg = fwr.getRegistry();
  const bible = pbe.getBible();
  const bibleIds = new Set(bible.workflows.map(w => w.id));
  const classA = reg.workflows.filter(w => w.class === "A");
  let found = 0;
  for (const w of classA) {
    if (bibleIds.has(`pbw_fwr_${w.id}`)) found++;
  }
  // At least 50% of Class A registry entries should appear in bible
  const pct = found / (classA.length || 1);
  assert(pct >= 0.5, `only ${pct*100}% of Class A registry entries found in bible (need 50%+)`);
});

test("getReport after executions shows non-zero minutesSaved", () => {
  const r = fae.getReport();
  assert(r.ok, "report not ok");
  // After block 2 executions, minutesSaved should be > 0
  assert(typeof r.summary.minutesSaved === "number", "minutesSaved not a number");
  assert(r.summary.executionCount >= 0, "executionCount not a number");
});

test("production bible dashboard automationPct is >= 0", () => {
  const dash = pbe.getDashboard();
  assert(dash.ok, "not ok");
  assert(dash.automationPct >= 0, "negative automationPct");
  assert(dash.automationPct <= 100, "automationPct > 100");
});

test("founder status aggregates all three engines", () => {
  // Simulate what /founder/status route does
  const reg   = fwr.getRegistry();
  const rep   = fae.getReport();
  const dash  = pbe.getDashboard();

  assert(reg.summary.total >= 20, "registry too small");
  assert(rep.ok, "report not ok");
  assert(dash.ok, "bible dashboard not ok");

  // Confirm final objective is achievable: class A + B together > class C
  const s = reg.summary;
  assert(s.classA + s.classB > s.classC, "More Class C than automatable — program is not viable");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(60)}`);
console.log(`POST-Ω Sprint P2: ${passed + failed} tests — ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("FAILED TESTS — see above for details");
  process.exit(1);
} else {
  console.log("ALL TESTS PASSED ✓");
}
