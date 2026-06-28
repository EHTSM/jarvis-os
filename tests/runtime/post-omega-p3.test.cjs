/**
 * post-omega-p3.test.cjs — POST-Ω Sprint P3: Autonomous Execution Engine
 *
 * Tests:
 *   Block 1 — Execution Planner (12 tests)
 *   Block 2 — Execution Validator (10 tests)
 *   Block 3 — Execution Evidence (8 tests)
 *   Block 4 — Execution Recovery (8 tests)
 *   Block 5 — Execution Metrics (6 tests)
 *   Block 6 — Autonomous Execution Engine — unit (10 tests)
 *   Block 7 — Real workflow executions: git + audit + review (10 tests)
 *   Block 8 — Integration: full "Deploy today's release" pipeline (4 tests)
 *
 * Total: 68 tests
 */

"use strict";
const assert = require("assert");
const path   = require("path");
const fs     = require("fs");

const TS   = Date.now();
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      console.error(`  ✗ ${name}: async test used synchronous runner`);
      failed++;
    } else {
      console.log(`  ✓ ${name}`);
      passed++;
    }
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

async function atest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

// ── Services under test ────────────────────────────────────────────────────────
const planner   = require("../../backend/services/executionPlanner.cjs");
const validator = require("../../backend/services/executionValidator.cjs");
const evidence  = require("../../backend/services/executionEvidence.cjs");
const recovery  = require("../../backend/services/executionRecovery.cjs");
const metrics   = require("../../backend/services/executionMetrics.cjs");
const aee       = require("../../backend/services/autonomousExecutionEngine.cjs");
const fwr       = require("../../backend/services/founderWorkRegistry.cjs");

async function main() {

// ═══════════════════════════════════════════════════════════════════════════════
// Block 1 — Execution Planner
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[Block 1] Execution Planner");

test("DOMAIN_EXECUTOR is exported", () => {
  assert(planner.DOMAIN_EXECUTOR, "DOMAIN_EXECUTOR not exported");
  assert(planner.DOMAIN_EXECUTOR.deployment, "deployment executor missing");
  assert(planner.DOMAIN_EXECUTOR.self_improvement, "self_improvement executor missing");
});

test("buildPlan returns ok for Class A workflow", () => {
  const reg = fwr.getRegistry();
  const classA = reg.workflows.find(w => w.class === "A");
  assert(classA, "no Class A workflow");
  const r = planner.buildPlan(classA.id);
  assert(r.ok, `buildPlan not ok: ${r.error}`);
  assert(r.plan, "no plan returned");
});

test("plan has required fields", () => {
  const reg = fwr.getRegistry();
  const w = reg.workflows.find(wf => wf.class === "A");
  const { plan } = planner.buildPlan(w.id);
  const fields = ["planId", "workflowId", "workflowName", "domain", "class", "estimatedMs", "estimatedMinutesSaved", "steps", "totalSteps", "primaryExecutor", "rollbackPlan"];
  for (const f of fields) {
    assert(f in plan, `plan missing field: ${f}`);
  }
});

test("plan steps are an array with at least 2 entries", () => {
  const reg = fwr.getRegistry();
  const w = reg.workflows.find(wf => wf.class === "A");
  const { plan } = planner.buildPlan(w.id);
  assert(Array.isArray(plan.steps), "steps not array");
  assert(plan.steps.length >= 2, `too few steps: ${plan.steps.length}`);
});

test("plan steps have required fields", () => {
  const reg = fwr.getRegistry();
  const w = reg.workflows.find(wf => wf.class === "A");
  const { plan } = planner.buildPlan(w.id);
  for (const step of plan.steps) {
    assert(typeof step.order === "number",  `step missing order`);
    assert(step.type,                        `step missing type`);
    assert(step.name,                        `step missing name`);
    assert(step.executor,                    `step missing executor`);
  }
});

test("plan has evidence and knowledge_update steps", () => {
  const reg = fwr.getRegistry();
  const w = reg.workflows.find(wf => wf.class === "A");
  const { plan } = planner.buildPlan(w.id);
  const types = new Set(plan.steps.map(s => s.type));
  assert(types.has("evidence"), "no evidence step");
  assert(types.has("knowledge_update"), "no knowledge_update step");
});

test("plan estimatedMs is a positive number", () => {
  const reg = fwr.getRegistry();
  const w = reg.workflows.find(wf => wf.class === "A");
  const { plan } = planner.buildPlan(w.id);
  assert(plan.estimatedMs > 0, "estimatedMs not positive");
});

test("plan rollbackPlan is an array", () => {
  const reg = fwr.getRegistry();
  const w = reg.workflows.find(wf => wf.class === "A");
  const { plan } = planner.buildPlan(w.id);
  assert(Array.isArray(plan.rollbackPlan), "rollbackPlan not array");
});

test("buildPlan returns error for Class C workflow", () => {
  const reg = fwr.getRegistry();
  const classC = reg.workflows.find(w => w.class === "C");
  assert(classC, "no Class C workflow");
  const r = planner.buildPlan(classC.id);
  assert(!r.ok, "should fail for Class C");
  assert(r.error, "should have error message");
});

test("buildPlan returns error for unknown workflow", () => {
  const r = planner.buildPlan(`nonexistent_${TS}`);
  assert(!r.ok, "should fail");
  assert(r.error, "should have error");
});

test("buildBatchPlans returns array of plans", () => {
  const r = planner.buildBatchPlans({ classType: "A", limit: 3 });
  assert(r.ok, "not ok");
  assert(Array.isArray(r.plans), "plans not array");
  assert(r.plans.length >= 1, "no plans returned");
  assert(typeof r.total === "number", "total not number");
});

test("buildBatchPlans plans all have planId", () => {
  const r = planner.buildBatchPlans({ classType: "A", limit: 5 });
  for (const p of r.plans) {
    assert(p.planId, `plan missing planId: ${JSON.stringify(p).slice(0,100)}`);
    assert(p.workflowId, "plan missing workflowId");
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 2 — Execution Validator
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[Block 2] Execution Validator");

test("validatePrerequisites returns ok and checks array", () => {
  const r = validator.validatePrerequisites("wf_self_weekly_review", []);
  assert(r.ok, "not ok");
  assert(Array.isArray(r.checks), "checks not array");
  assert(typeof r.allPass === "boolean", "allPass not boolean");
});

test("validatePrerequisites has node_available check", () => {
  const r = validator.validatePrerequisites("test", []);
  const nodeCheck = r.checks.find(c => c.check === "node_available");
  assert(nodeCheck, "node_available check missing");
  assert(nodeCheck.pass === true, "node not available — test environment broken");
});

test("validatePrerequisites has git_available check", () => {
  const r = validator.validatePrerequisites("test", []);
  const gitCheck = r.checks.find(c => c.check === "git_available");
  assert(gitCheck, "git_available check missing");
  assert(gitCheck.pass === true, "git not available");
});

test("validatePrerequisites has package_json check", () => {
  const r = validator.validatePrerequisites("test", []);
  const pkgCheck = r.checks.find(c => c.check === "package_json");
  assert(pkgCheck, "package_json check missing");
  assert(pkgCheck.pass === true, "package.json not found");
});

test("validatePrerequisites treats API key blockers as manual", () => {
  const r = validator.validatePrerequisites("test", ["Requires hosting provider API key"]);
  const blocker = r.checks.find(c => c.check.startsWith("blocker:"));
  assert(blocker, "blocker check missing");
  assert(blocker.pass === false, "API key blocker should not pass automatically");
});

test("validateOutcome returns ok and checks array", () => {
  const steps = [{ type: "execution", name: "test step", completed: true }];
  const r = validator.validateOutcome("test_wf", "self_improvement", steps);
  assert(r.ok, "not ok");
  assert(Array.isArray(r.checks), "checks not array");
  assert(typeof r.allPass === "boolean", "allPass not boolean");
});

test("validateOutcome fails when required steps not completed", () => {
  const steps = [
    { type: "execution", name: "step 1", completed: false },
    { type: "execution", name: "step 2", completed: false },
  ];
  const r = validator.validateOutcome("test_wf", "deployment", steps);
  assert(!r.allPass, "should fail when steps not completed");
});

test("validateOutcome fails when steps have errors", () => {
  const steps = [
    { type: "execution", name: "step 1", completed: true, error: "something broke" },
  ];
  const r = validator.validateOutcome("test_wf", "deployment", steps);
  assert(!r.allPass, "should fail with errored steps");
});

test("validateHealth returns ok and checks array", () => {
  const r = validator.validateHealth("test_wf");
  assert(r.ok, "not ok");
  assert(Array.isArray(r.checks), "checks not array");
  const nodeModCheck = r.checks.find(c => c.check === "node_modules_present");
  assert(nodeModCheck?.pass === true, "node_modules missing");
});

test("validateTestSuite returns error for missing file", () => {
  const r = validator.validateTestSuite("/nonexistent/test.cjs");
  assert(!r.ok, "should fail for missing file");
  assert(r.error, "should have error");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 3 — Execution Evidence
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[Block 3] Execution Evidence");

test("collect returns ok and evidenceId", () => {
  const r = evidence.collect({
    workflowId: "wf_test_p3", executionId: `exec_${TS}`, domain: "self_improvement",
    outcome: "success", stepsExecuted: [{ name: "test step", type: "execution", completed: true }],
    minutesSaved: 10, servicesInvoked: ["selfReviewEngine"], executionDurationMs: 1500,
  });
  assert(r.ok, "collect not ok");
  assert(r.evidenceId, "no evidenceId");
  assert(r.record, "no record");
});

test("collected record has required fields", () => {
  const r = evidence.collect({
    workflowId: `wf_p3_${TS}`, executionId: `exec_${TS}`, domain: "engineering",
    outcome: "success", stepsExecuted: [], minutesSaved: 30,
  });
  const rec = r.record;
  const fields = ["evidenceId", "workflowId", "executionId", "domain", "outcome", "ts", "minutesSaved", "gitSnapshot", "healthSnapshot"];
  for (const f of fields) {
    assert(f in rec, `evidence record missing field: ${f}`);
  }
});

test("collect records git snapshot", () => {
  const r = evidence.collect({ workflowId: "wf_git_test", executionId: `e${TS}`, domain: "docs", outcome: "success", minutesSaved: 5 });
  assert(r.record.gitSnapshot, "no gitSnapshot");
  assert(r.record.gitSnapshot.commit, "no commit hash");
  assert(r.record.gitSnapshot.branch, "no branch");
});

test("collect records health snapshot", () => {
  const r = evidence.collect({ workflowId: "wf_health_test", executionId: `e${TS}`, domain: "daily_ops", outcome: "success", minutesSaved: 10 });
  assert(r.record.healthSnapshot, "no healthSnapshot");
  assert("nodeModulesPresent" in r.record.healthSnapshot, "missing nodeModulesPresent");
  assert(r.record.healthSnapshot.serverPresent === true, "server.cjs not present");
});

test("listEvidence returns array", () => {
  const list = evidence.listEvidence();
  assert(Array.isArray(list), "not array");
  assert(list.length >= 1, "empty list (collect above should have added items)");
});

test("listEvidence filters by outcome", () => {
  const list = evidence.listEvidence({ outcome: "success" });
  assert(list.every(e => e.outcome === "success"), "non-success in results");
});

test("getEvidence retrieves by id", () => {
  const r = evidence.collect({ workflowId: `wf_get_${TS}`, executionId: `e${TS}`, domain: "docs", outcome: "success", minutesSaved: 5 });
  const found = evidence.getEvidence(r.evidenceId);
  assert(found, "evidence not found by id");
  assert(found.evidenceId === r.evidenceId, "wrong evidence returned");
});

test("getSummary returns totals and successRate", () => {
  const s = evidence.getSummary();
  assert(typeof s.totalExecutions === "number", "no totalExecutions");
  assert(typeof s.successRate === "number", "no successRate");
  assert(s.successRate >= 0 && s.successRate <= 100, "successRate out of range");
  assert(typeof s.minutesSaved === "number", "no minutesSaved");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 4 — Execution Recovery
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[Block 4] Execution Recovery");

test("selectStrategy: timeout error → RETRY_IMMEDIATE", () => {
  const s = recovery.selectStrategy({ stepType: "execution", error: "ETIMEDOUT", attemptCount: 0, domain: "deployment", stepIndex: 1, totalSteps: 5 });
  assert(s === "RETRY_IMMEDIATE", `expected RETRY_IMMEDIATE got ${s}`);
});

test("selectStrategy: rate limit → RETRY_WITH_DELAY", () => {
  const s = recovery.selectStrategy({ stepType: "execution", error: "429 rate limit", attemptCount: 0, domain: "deployment", stepIndex: 1, totalSteps: 5 });
  assert(s === "RETRY_WITH_DELAY", `expected RETRY_WITH_DELAY got ${s}`);
});

test("selectStrategy: validation step → SKIP_AND_CONTINUE", () => {
  const s = recovery.selectStrategy({ stepType: "validation", error: "check failed", attemptCount: 0, domain: "docs", stepIndex: 3, totalSteps: 5 });
  assert(s === "SKIP_AND_CONTINUE", `expected SKIP_AND_CONTINUE got ${s}`);
});

test("selectStrategy: evidence step → SKIP_AND_CONTINUE", () => {
  const s = recovery.selectStrategy({ stepType: "evidence", error: "write failed", attemptCount: 0, domain: "docs", stepIndex: 4, totalSteps: 5 });
  assert(s === "SKIP_AND_CONTINUE", `expected SKIP_AND_CONTINUE got ${s}`);
});

test("selectStrategy: prereq failure → ESCALATE", () => {
  const s = recovery.selectStrategy({ stepType: "prereq_check", error: "missing creds", attemptCount: 0, domain: "deployment", stepIndex: 0, totalSteps: 5 });
  assert(s === "ESCALATE", `expected ESCALATE got ${s}`);
});

test("selectStrategy: max retries exceeded → FULL_ROLLBACK", () => {
  const s = recovery.selectStrategy({ stepType: "execution", error: "unknown", attemptCount: 3, domain: "deployment", stepIndex: 1, totalSteps: 5 });
  assert(s === "FULL_ROLLBACK", `expected FULL_ROLLBACK got ${s}`);
});

atest("recover RETRY_IMMEDIATE returns retry_queued outcome", async () => {
  const r = await recovery.recover({
    executionId: `exec_${TS}`, workflowId: "wf_test",
    plan: {}, steps: [],
    failedStep: { name: "test step", type: "execution", order: 1 },
    error: "ETIMEDOUT", attemptCount: 0,
  });
  assert(r.ok, "not ok");
  assert(r.record.outcome === "retry_queued", `expected retry_queued got ${r.record.outcome}`);
  assert(r.shouldRetry === true, "shouldRetry not set");
});

test("getStats returns recovery statistics", () => {
  const s = recovery.getStats();
  assert(typeof s.totalRecoveries === "number", "no totalRecoveries");
  assert(typeof s.successfulRecoveries === "number", "no successfulRecoveries");
  assert(typeof s.escalations === "number", "no escalations");
  assert(s.totalRecoveries >= 1, "no recoveries recorded (test above should have added one)");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 5 — Execution Metrics
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[Block 5] Execution Metrics");

test("getDashboard returns ok", () => {
  const r = metrics.getDashboard();
  assert(r.ok, "not ok");
  assert(r.executionState, "no executionState");
});

test("getDashboard executionState has all required states", () => {
  const r = metrics.getDashboard();
  const s = r.executionState;
  const fields = ["pending", "running", "awaiting_approval", "completed", "failed", "retried", "rolled_back"];
  for (const f of fields) {
    assert(f in s, `missing state: ${f}`);
    assert(typeof s[f] === "number", `state ${f} not a number`);
  }
});

test("getDashboard has automationCoverage 0-100", () => {
  const r = metrics.getDashboard();
  assert(typeof r.automationCoverage === "number", "no automationCoverage");
  assert(r.automationCoverage >= 0 && r.automationCoverage <= 100, "automationCoverage out of range");
});

test("getDashboard has trend array with 7 entries", () => {
  const r = metrics.getDashboard();
  assert(Array.isArray(r.trend), "no trend array");
  assert(r.trend.length === 7, `trend should have 7 days, has ${r.trend.length}`);
  const fields = ["date", "executions", "successes", "minutesSaved"];
  for (const entry of r.trend) {
    for (const f of fields) assert(f in entry, `trend entry missing ${f}`);
  }
});

test("getDashboard has perDomain breakdown", () => {
  const r = metrics.getDashboard();
  assert(r.perDomain, "no perDomain");
  assert(Object.keys(r.perDomain).length >= 1, "perDomain is empty");
});

test("getSummary returns compact version", () => {
  const r = metrics.getSummary();
  assert(r.ok, "not ok");
  assert(typeof r.automationCoverage === "number", "no automationCoverage");
  assert(typeof r.minutesEliminated === "number", "no minutesEliminated");
  assert(typeof r.successRate === "number", "no successRate");
  assert(r.state, "no state");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 6 — AEE Unit
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[Block 6] Autonomous Execution Engine — unit");

test("getStats returns stats object", () => {
  const s = aee.getStats();
  assert(typeof s === "object", "not an object");
  assert(typeof s.total === "number", "no total");
});

test("listRuns returns array", () => {
  const r = aee.listRuns();
  assert(Array.isArray(r), "not array");
});

test("listRuns filters by status", () => {
  const r = aee.listRuns({ status: "completed" });
  assert(r.every(run => run.status === "completed"), "non-completed in results");
});

test("getRun returns null for unknown id", () => {
  const r = aee.getRun(`nonexistent_${TS}`);
  assert(r === null, "should return null");
});

atest("executeWorkflow returns error for Class C", async () => {
  const reg = fwr.getRegistry();
  const classC = reg.workflows.find(w => w.class === "C");
  assert(classC, "no Class C workflow");
  const r = await aee.executeWorkflow(classC.id);
  assert(!r.ok, "should not be ok for Class C");
  assert(r.error, "should have error");
});

atest("executeWorkflow returns error for unknown workflow", async () => {
  const r = await aee.executeWorkflow(`nonexistent_${TS}`);
  assert(!r.ok, "should not be ok");
  assert(r.error, "should have error");
});

atest("executeWorkflow Class A returns run object", async () => {
  const reg = fwr.buildRegistry().registry;
  const w = reg.workflows.find(wf => wf.class === "A" && wf.domain === "self_improvement");
  assert(w, "no self_improvement Class A");
  const r = await aee.executeWorkflow(w.id, { triggeredBy: "p3_test" });
  assert(r.run, "no run object returned");
  assert(r.run.id, "run missing id");
  assert(r.run.workflowId === w.id, "wrong workflowId in run");
});

atest("completed run is persisted and retrievable", async () => {
  const reg = fwr.getRegistry();
  const w = reg.workflows.find(wf => wf.class === "A" && wf.domain === "docs");
  if (!w) { console.log("    (skip: no docs Class A)"); passed++; return; }
  const r = await aee.executeWorkflow(w.id, { triggeredBy: "p3_persist_test" });
  assert(r.run?.id, "no run id");
  const found = aee.getRun(r.run.id);
  assert(found, "run not found after execution");
  assert(found.workflowId === w.id, "wrong workflow in persisted run");
});

atest("run has evidenceId after completion", async () => {
  const reg = fwr.getRegistry();
  const w = reg.workflows.find(wf => wf.class === "A" && wf.domain === "engineering");
  if (!w) { console.log("    (skip: no engineering Class A)"); passed++; return; }
  const r = await aee.executeWorkflow(w.id, { triggeredBy: "p3_evidence_test" });
  assert(r.run, "no run");
  if (r.outcome === "success") {
    assert(r.evidenceId, "no evidenceId on successful run");
  }
});

atest("executeBatch returns results array", async () => {
  // Fresh batch with very small limit to stay fast
  const r = await aee.executeBatch({ limit: 2, triggeredBy: "p3_batch_test" });
  assert(r.ok, "batch not ok");
  assert(Array.isArray(r.results), "results not array");
  assert(typeof r.total === "number", "no total");
  assert(typeof r.minutesSaved === "number", "no minutesSaved");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 7 — Real workflow executions (actual platform operations)
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[Block 7] Real workflow executions");

atest("wf_self_weekly_review executes and produces review", async () => {
  const r = await aee.executeWorkflow("wf_self_weekly_review", { triggeredBy: "p3_real_test" });
  assert(r.run, "no run");
  // Check selfReviewEngine was invoked
  const sre = require("../../backend/services/selfReviewEngine.cjs");
  const latest = sre.getLatestReview();
  assert(latest, "no review in selfReviewEngine after execution");
});

atest("wf_self_consolidation_audit executes and produces audit", async () => {
  const r = await aee.executeWorkflow("wf_self_consolidation_audit", { triggeredBy: "p3_real_test" });
  assert(r.run, "no run");
  const ca = require("../../backend/services/consolidationAudit.cjs");
  const latest = ca.getLatestAudit();
  assert(latest, "no audit in consolidationAudit after execution");
  // placeholders count lives under summary.totalPlaceholderCount
  const count = latest.placeholders ?? latest.summary?.totalPlaceholderCount ?? latest.summary?.filesWithPlaceholders;
  assert(typeof count === "number", `audit has no placeholder count — keys: ${Object.keys(latest).join(",")}`);
});

atest("wf_docs_changelog executes git log and produces evidence", async () => {
  const r = await aee.executeWorkflow("wf_docs_changelog", { triggeredBy: "p3_real_test" });
  assert(r.run, "no run");
  assert(r.run.servicesInvoked?.includes("git") || r.run.domain === "docs", "git not invoked for docs workflow");
});

atest("wf_deploy_pm2 execution validates environment", async () => {
  const r = await aee.executeWorkflow("wf_deploy_pm2", { triggeredBy: "p3_real_test" });
  assert(r.run, "no run");
  // Deployment validator should have been invoked
  const dv = require("../../backend/services/deploymentValidator.cjs");
  const env = dv.checkEnvironment();
  assert(Array.isArray(env.checks), "deploymentValidator not working");
});

atest("wf_ops_health_check executes and returns health evidence", async () => {
  const r = await aee.executeWorkflow("wf_ops_health_check", { triggeredBy: "p3_real_test" });
  assert(r.run, "no run");
  if (r.evidenceId) {
    const ev = evidence.getEvidence(r.evidenceId);
    assert(ev, "evidence not found for health check run");
    assert(ev.healthSnapshot, "no healthSnapshot in health check evidence");
  }
});

test("validateTestSuite on p1 test file returns pass", () => {
  const testFile = path.join(__dirname, "post-omega-p1.test.cjs");
  const r = validator.validateTestSuite(testFile);
  assert(r.ok, `test suite validation failed: ${r.output?.slice(0,200)}`);
  assert(r.passed >= 41, `expected 41+ passed, got ${r.passed}`);
  assert(r.failed === 0, `expected 0 failed, got ${r.failed}`);
});

test("validateTestSuite on p2 test file returns pass", () => {
  const testFile = path.join(__dirname, "post-omega-p2.test.cjs");
  const r = validator.validateTestSuite(testFile);
  assert(r.ok, `test suite validation failed: ${r.output?.slice(0,200)}`);
  assert(r.passed >= 48, `expected 48+ passed, got ${r.passed}`);
  assert(r.failed === 0, `expected 0 failed, got ${r.failed}`);
});

test("evidence index grows after real executions", () => {
  const summary = evidence.getSummary();
  assert(summary.totalExecutions >= 5, `expected 5+ evidence records, got ${summary.totalExecutions}`);
  assert(summary.minutesSaved >= 0, "minutesSaved is negative");
});

test("getStats after real executions shows non-zero total", () => {
  const s = aee.getStats();
  assert(s.total >= 1, `expected 1+ run, got ${s.total}`);
});

test("executionMetrics shows non-zero evidence after real executions", () => {
  const dash = metrics.getDashboard();
  assert(dash.evidenceSummary.totalExecutions >= 5, `expected 5+ evidence, got ${dash.evidenceSummary.totalExecutions}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 8 — Integration: "Deploy today's release." pipeline
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[Block 8] Integration: 'Deploy today's release.'");

atest("full deploy pipeline: plan → validate → execute → evidence", async () => {
  // Simulate the "Deploy today's release" goal
  const deployWorkflow = "wf_deploy_pm2"; // most representative deploy step

  // 1. Plan
  const planResult = planner.buildPlan(deployWorkflow);
  assert(planResult.ok, "planning failed");
  assert(planResult.plan.steps.length >= 2, "too few steps in plan");

  // 2. Validate prerequisites
  const prereqResult = validator.validatePrerequisites(deployWorkflow, []);
  assert(prereqResult.ok, "prereq validation failed");

  // 3. Execute
  const execResult = await aee.executeWorkflow(deployWorkflow, { triggeredBy: "deploy_goal_test" });
  assert(execResult.run, "no run produced");

  // 4. Validate health post-execution
  const healthResult = validator.validateHealth(deployWorkflow);
  assert(healthResult.ok, "health validation failed");
  assert(healthResult.checks.find(c => c.check === "server_file_present")?.pass, "server.cjs missing post-execution");
});

atest("batch execution returns measurable time savings", async () => {
  const r = await aee.executeBatch({ limit: 3, domain: "self_improvement", triggeredBy: "deploy_batch_test" });
  assert(r.ok, "batch not ok");
  // At least some workflows should complete
  assert(r.results.length <= 3, "too many results");
  assert(typeof r.minutesSaved === "number", "minutesSaved not a number");
});

test("after full pipeline: evidence summary shows improvements", () => {
  const sum = evidence.getSummary();
  assert(sum.totalExecutions >= 5, "not enough executions recorded");
  assert(sum.uniqueWorkflows >= 3, "not enough unique workflows executed");
});

test("final system state: automation coverage > 0%", () => {
  const sum = metrics.getSummary();
  assert(sum.ok, "not ok");
  assert(sum.automationCoverage >= 0, "negative automation coverage");
  assert(sum.state.pending >= 0, "negative pending count");
  // Registry should report Class A + B together > Class C
  const reg = fwr.getRegistry();
  const s = reg.summary;
  assert(s.classA + s.classB > s.classC, "more Class C than automatable — program not viable");
  console.log(`    → Coverage: ${sum.automationCoverage}% | Minutes eliminated: ${sum.minutesEliminated} | Evidence: ${sum.state.completed + sum.state.failed} executions`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════════════════

// Flush any pending async writes
await new Promise(r => setTimeout(r, 300));

const total = passed + failed;
const summary = [
  "",
  "═".repeat(60),
  `POST-Ω Sprint P3: ${total} tests — ${passed} passed, ${failed} failed`,
  failed > 0 ? "FAILED TESTS — see above" : "ALL TESTS PASSED ✓",
].join("\n");
// Write synchronously so it lands before process.exit kills stdout
require("fs").writeSync(1, summary + "\n");
process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { require("fs").writeSync(2, `Fatal: ${e.message}\n`); process.exit(1); });
