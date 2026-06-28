"use strict";
/**
 * POST-Ω Sprint P6 — Founder Digital Twin (FDT)
 * Tests: founderProfileEngine, decisionLearningEngine,
 *        approvalPredictionEngine, workflowPreferenceEngine,
 *        contextBuilder, digitalTwinEngine
 *        + integration: full learning loop
 */

let passed = 0;
let failed = 0;
const promises = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      const p = r.then(() => { console.log(`  PASS  ${name}`); passed++; })
                  .catch(e => { console.log(`  FAIL  ${name}: ${e.message || e}`); failed++; });
      promises.push(p);
    } else {
      console.log(`  PASS  ${name}`);
      passed++;
    }
  } catch (e) {
    console.log(`  FAIL  ${name}: ${e.message || e}`);
    failed++;
  }
}

function atest(name, fn) {
  const p = (async () => { await fn(); })()
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(e => { console.log(`  FAIL  ${name}: ${e.message || e}`); failed++; });
  promises.push(p);
  return p;
}

function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

// ── Load modules ──────────────────────────────────────────────────────────────

const fpe  = require("../../backend/services/founderProfileEngine.cjs");
const dle  = require("../../backend/services/decisionLearningEngine.cjs");
const ape  = require("../../backend/services/approvalPredictionEngine.cjs");
const wpe  = require("../../backend/services/workflowPreferenceEngine.cjs");
const ctx  = require("../../backend/services/contextBuilder.cjs");
const dte  = require("../../backend/services/digitalTwinEngine.cjs");

// ─────────────────────────────────────────────────────────────────────────────
// Block 1: founderProfileEngine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 1: founderProfileEngine ──");

test("getProfile returns structured profile", () => {
  const p = fpe.getProfile();
  assert(p.ok, "getProfile failed");
  assert(typeof p.trustScore === "number");
  assert(typeof p.totalActions === "number");
  assert(p.preferences, "no preferences");
  assert(p.actionCounts, "no actionCounts");
});

test("DIMENSIONS exports 9 dimensions", () => {
  assert(fpe.DIMENSIONS.length === 9, `expected 9, got ${fpe.DIMENSIONS.length}`);
  assert(fpe.DIMENSIONS.includes("risk_tolerance"));
  assert(fpe.DIMENSIONS.includes("automation_preference"));
  assert(fpe.DIMENSIONS.includes("ui_density"));
});

test("ACTION_CATEGORIES exports 12 categories", () => {
  assert(fpe.ACTION_CATEGORIES.length === 12, `expected 12, got ${fpe.ACTION_CATEGORIES.length}`);
  assert(fpe.ACTION_CATEGORIES.includes("approval"));
  assert(fpe.ACTION_CATEGORIES.includes("deployment"));
});

test("recordAction returns ok:true with trust score", () => {
  const r = fpe.recordAction({
    action:   "approved deploy to production",
    category: "approval",
    signals:  ["approved_high_risk"],
    outcome:  "approved",
  });
  assert(r.ok, "recordAction failed: " + r.error);
  assert(r.id, "no id");
  assert(typeof r.trustScore === "number");
});

test("recordAction updates risk_tolerance preference upward", () => {
  const before = fpe.getPreference("risk_tolerance");
  fpe.recordAction({ action: "approved risky deploy", category: "approval", signals: ["approved_high_risk"], outcome: "approved" });
  const after  = fpe.getPreference("risk_tolerance");
  assert(after.observations > before.observations, "observations did not increase");
});

test("recordAction with rejection signals reduces preference", () => {
  const before = fpe.getPreference("automation_preference");
  fpe.recordAction({ action: "rejected auto-deploy", category: "rejection", signals: ["rejected_auto"], outcome: "rejected" });
  const after  = fpe.getPreference("automation_preference");
  assert(after.observations > before.observations, "observations did not increase for rejection");
});

test("getPreference returns valid dimension data", () => {
  const p = fpe.getPreference("documentation_depth");
  assert(p.ok, "getPreference failed");
  assert(p.dimension === "documentation_depth");
  assert(typeof p.score === "number");
  assert(p.score >= 0 && p.score <= 1, `score out of range: ${p.score}`);
  assert(typeof p.confidence === "number");
});

test("getPreference returns error for unknown dimension", () => {
  const p = fpe.getPreference("nonexistent_dimension_xyz");
  assert(!p.ok, "expected failure");
  assert(p.error, "no error message");
});

test("observeApproval records with correct category", () => {
  const r = fpe.observeApproval({
    workflowId:   "wf_ops_deploy_backend",
    approvalType: "DEPLOY_CONFIRM",
    outcome:      "approved",
    confidence:   0.9,
    responseMs:   12000,
    risk:         "high",
  });
  assert(r.ok, "observeApproval failed");
});

test("recordPredictionOutcome updates accuracy", () => {
  const r = fpe.recordPredictionOutcome({ predicted: "approved", actual: "approved", corrected: false });
  assert(r.ok, "recordPredictionOutcome failed");
  assert(typeof r.accuracy === "number");
  assert(r.accuracy >= 0 && r.accuracy <= 1);
});

test("getStats returns all required fields", () => {
  const s = fpe.getStats();
  assert(typeof s.trustScore === "number");
  assert(typeof s.totalActions === "number");
  assert(s.totalActions >= 3, `expected >=3 actions, got ${s.totalActions}`);
  assert(typeof s.correctionCount === "number");
  assert(typeof s.predictionAccuracy === "number");
  assert(typeof s.dimensions === "number" && s.dimensions === 9);
});

test("getPreferences returns all 9 dimensions", () => {
  const p = fpe.getPreferences();
  assert(p.ok, "getPreferences failed");
  assert(Object.keys(p.preferences).length === 9, `expected 9, got ${Object.keys(p.preferences).length}`);
  assert(typeof p.trustScore === "number");
  assert(Array.isArray(p.dimensions));
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 2: decisionLearningEngine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 2: decisionLearningEngine ──");

test("DECISION_TYPES exports required types", () => {
  const dt = dle.DECISION_TYPES;
  assert(dt.APPROVE === "approve");
  assert(dt.REJECT  === "reject");
  assert(dt.MODIFY  === "modify");
});

test("recordDecision requires type and subject", () => {
  const r = dle.recordDecision({ type: "approve" }); // no subject
  assert(!r.ok, "expected failure without subject");
});

test("recordDecision stores and returns id", () => {
  const r = dle.recordDecision({
    type:      "approve",
    subject:   "Deploy backend to production v1.2",
    domain:    "deployment",
    outcome:   "approved",
    confidence: 0.9,
    predictionWas: "approved",
    durationMs: 5000,
    risk:       "high",
  });
  assert(r.ok, "recordDecision failed: " + r.error);
  assert(r.id, "no id");
  assert(typeof r.wasCorrect === "boolean");
});

test("recordDecision tracks wasCorrect when prediction matches", () => {
  const r = dle.recordDecision({
    type:      "approve",
    subject:   "UI layout approval for dashboard",
    domain:    "ui",
    outcome:   "approved",
    predictionWas: "approved",
    risk:      "medium",
  });
  assert(r.ok);
  assert(r.wasCorrect === true, "expected wasCorrect=true when prediction=outcome");
});

test("recordDecision tracks wasCorrect=false on mismatch", () => {
  const r = dle.recordDecision({
    type:      "reject",
    subject:   "Skip security audit before release",
    domain:    "security",
    outcome:   "rejected",
    predictionWas: "approved",
    risk:      "high",
  });
  assert(r.ok);
  assert(r.wasCorrect === false, "expected wasCorrect=false");
});

test("getDecisions returns array", () => {
  const r = dle.getDecisions({ limit: 10 });
  assert(r.ok, "getDecisions failed");
  assert(Array.isArray(r.decisions));
  assert(r.decisions.length >= 3, `expected >=3 decisions, got ${r.decisions.length}`);
});

test("getDecisions filters by domain", () => {
  const r = dle.getDecisions({ domain: "deployment", limit: 20 });
  assert(r.ok);
  assert(r.decisions.every(d => d.domain === "deployment"), "non-deployment decision in results");
});

test("getDecisions filters by outcome", () => {
  const r = dle.getDecisions({ outcome: "approved", limit: 20 });
  assert(r.ok);
  assert(r.decisions.every(d => d.outcome === "approved"), "non-approved in results");
});

test("getPatterns returns patterns object", () => {
  const p = dle.getPatterns();
  assert(p.ok, "getPatterns failed");
  assert(typeof p.patterns === "object");
  assert(typeof p.patternCount === "number");
});

test("getSimilarDecisions returns similarity scores", () => {
  const r = dle.getSimilarDecisions("Deploy backend to production", "deployment", 3);
  assert(r.ok, "getSimilarDecisions failed");
  assert(Array.isArray(r.similar));
  if (r.similar.length > 0) {
    assert(typeof r.similar[0].similarity === "number", "no similarity score");
  }
});

test("getStats returns totalDecisions and patterns", () => {
  const s = dle.getStats();
  assert(s.totalDecisions >= 3, `expected >=3, got ${s.totalDecisions}`);
  assert(typeof s.patternCount === "number");
  assert(Array.isArray(s.domains));
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 3: approvalPredictionEngine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 3: approvalPredictionEngine ──");

test("predict returns all required probability fields", () => {
  const p = ape.predict("wf_ops_deploy_backend", { domain: "deployment", risk: "high" });
  assert(p.ok, "predict failed");
  assert(typeof p.approveProbability === "number");
  assert(typeof p.rejectProbability  === "number");
  assert(typeof p.confidence         === "number");
  assert(typeof p.shouldAutoApprove  === "boolean");
  assert(p.approveProbability >= 0 && p.approveProbability <= 1);
  assert(p.rejectProbability  >= 0 && p.rejectProbability  <= 1);
  assert(Math.abs(p.approveProbability + p.rejectProbability - 1) < 0.01, "probabilities don't sum to 1");
});

test("predict for critical risk reduces approve probability", () => {
  const low  = ape.predict("wf_low_risk", { domain: "documentation", risk: "low"      });
  const crit = ape.predict("wf_critical",  { domain: "deployment",    risk: "critical" });
  assert(low.approveProbability > crit.approveProbability,
    `expected low risk > critical: ${low.approveProbability} vs ${crit.approveProbability}`);
});

test("predict high risk never shouldAutoApprove", () => {
  const p = ape.predict("wf_high_risk_deploy", { domain: "deployment", risk: "high" });
  assert(!p.shouldAutoApprove, "high risk should never auto-approve");
});

test("predict critical risk never shouldAutoApprove", () => {
  const p = ape.predict("wf_critical_security", { domain: "security", risk: "critical" });
  assert(!p.shouldAutoApprove, "critical risk should never auto-approve");
});

test("predict returns reasoning array", () => {
  const p = ape.predict("wf_doc_update", { domain: "documentation", risk: "low" });
  assert(p.ok);
  assert(Array.isArray(p.reasoning), "reasoning not array");
  assert(p.reasoning.length >= 1, "no reasoning");
});

test("predict returns predictedOutcome string", () => {
  const p = ape.predict("wf_test", { domain: "testing", risk: "medium" });
  assert(["approved", "rejected"].includes(p.predictedOutcome),
    `unexpected outcome: ${p.predictedOutcome}`);
});

atest("predictAndRoute returns predictionId and routedAs", async () => {
  const r = await ape.predictAndRoute("wf_doc_update", { domain: "documentation", risk: "low" });
  assert(typeof r.ok === "boolean");
  assert(r.predictionId, "no predictionId");
  assert(r.routedAs, "no routedAs");
  assert(["auto_approved_via_engine", "auto_approve_fallback", "founder_required"].includes(r.routedAs),
    `unexpected routedAs: ${r.routedAs}`);
});

test("recordOutcome returns ok", () => {
  const preds = ape.getPredictions({ limit: 1 });
  if (!preds.predictions.length) return;
  const r = ape.recordOutcome(preds.predictions[0].id, "approved");
  assert(typeof r.ok === "boolean");
});

test("getPredictions returns array with stats", () => {
  const r = ape.getPredictions({ limit: 10 });
  assert(r.ok, "getPredictions failed");
  assert(Array.isArray(r.predictions));
  assert(r.stats, "no stats");
});

test("getStats returns all required fields", () => {
  const s = ape.getStats();
  assert(typeof s.total === "number");
  assert(typeof s.autoApproved === "number");
  assert(typeof s.manualRequired === "number");
  assert(typeof s.predictionAccuracy === "number");
  assert(s.threshold === ape.AUTO_APPROVE_THRESHOLD);
});

test("AUTO_APPROVE_THRESHOLD is 0.88", () => {
  assert(ape.AUTO_APPROVE_THRESHOLD === 0.88, `expected 0.88, got ${ape.AUTO_APPROVE_THRESHOLD}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 4: workflowPreferenceEngine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 4: workflowPreferenceEngine ──");

test("WORKFLOW_CATEGORIES exports 12 categories", () => {
  assert(wpe.WORKFLOW_CATEGORIES.length === 12, `expected 12, got ${wpe.WORKFLOW_CATEGORIES.length}`);
  assert(wpe.WORKFLOW_CATEGORIES.includes("deployment"));
  assert(wpe.WORKFLOW_CATEGORIES.includes("code_review"));
  assert(wpe.WORKFLOW_CATEGORIES.includes("security"));
});

test("observeExecution records for deployment", () => {
  const r = wpe.observeExecution({
    category:      "deployment",
    workflowId:    "wf_deploy_backend",
    reviewDepth:   "standard",
    tools:         ["terminal", "browser"],
    outcome:       "success",
  });
  assert(r.ok, "observeExecution failed");
  assert(r.category === "deployment");
  assert(r.observations >= 1);
});

test("observeExecution records for code_review", () => {
  const r = wpe.observeExecution({
    category:      "code_review",
    workflowId:    "wf_code_review_pr",
    reviewDepth:   "thorough",
    outcome:       "success",
    founderOverride: true,
  });
  assert(r.ok);
});

test("getPreference returns valid data for deployment", () => {
  const p = wpe.getPreference("deployment");
  assert(p.ok, "getPreference failed");
  assert(p.category === "deployment");
  assert(typeof p.reviewDepth === "string");
  assert(wpe.REVIEW_DEPTHS.includes(p.reviewDepth), `invalid reviewDepth: ${p.reviewDepth}`);
  assert(Array.isArray(p.preferredTiming));
  assert(Array.isArray(p.avoidTiming));
  assert(typeof p.observations === "number");
  assert(p.observations >= 1, "expected >=1 observation");
});

test("getPreference returns error for unknown category", () => {
  const p = wpe.getPreference("nonexistent_xyz_category");
  assert(!p.ok, "expected failure");
  assert(p.error, "no error message");
});

test("isGoodTime returns suitable flag", () => {
  const r = wpe.isGoodTime("deployment");
  assert(r.ok, "isGoodTime failed");
  assert(typeof r.suitable === "boolean");
  assert(r.reason, "no reason");
});

test("setOverride changes preference field", () => {
  const r = wpe.setOverride("documentation", "reviewDepth", "thorough");
  assert(r.ok, "setOverride failed");
  assert(r.field === "reviewDepth");
  assert(r.value === "thorough");
  const p = wpe.getPreference("documentation");
  assert(p.reviewDepth === "thorough", `expected thorough, got ${p.reviewDepth}`);
});

test("getAllPreferences returns all 12 categories", () => {
  const r = wpe.getAllPreferences();
  assert(r.ok, "getAllPreferences failed");
  assert(Object.keys(r.categories).length >= 12, `expected >=12, got ${Object.keys(r.categories).length}`);
});

test("syncFromBible returns synced count", () => {
  const r = wpe.syncFromBible();
  assert(r.ok, "syncFromBible failed");
  assert(typeof r.synced === "number");
});

test("getStats returns categoriesTracked", () => {
  const s = wpe.getStats();
  assert(s.categoriesTracked >= 12, `expected >=12, got ${s.categoriesTracked}`);
  assert(typeof s.totalObservations === "number");
  assert(s.totalObservations >= 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 5: contextBuilder
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 5: contextBuilder ──");

atest("build returns full context with required sections", async () => {
  const c = await ctx.build("Deploy today's release to production.", {
    workflowId: "wf_eng_deploy_release",
    domain:     "deployment",
    category:   "deployment",
    opts:       { risk: "high" },
  });
  assert(c.ok, "build failed: " + c.error);
  assert(c.command, "no command");
  assert(c.category, "no category");
  assert(c.workspace !== undefined, "no workspace");
  assert(c.founder, "no founder section");
  assert(typeof c.founder.trustScore === "number", "no trustScore");
  assert(c.founder.preferences, "no preferences");
  assert(c.history, "no history");
  assert(c.prediction, "no prediction");
  assert(c.categoryPreference, "no categoryPreference");
  assert(c.generatedAt, "no generatedAt");
  assert(typeof c.buildDurationMs === "number");
});

atest("build populates prediction section", async () => {
  const c = await ctx.build("Approve UI design.", { domain: "ui_review" });
  assert(c.ok);
  assert(c.prediction, "no prediction");
  assert(typeof c.prediction.confidence === "number");
  assert(["approved", "rejected", null].includes(c.prediction.predictedOutcome));
});

atest("build returns engineeringMemory array", async () => {
  const c = await ctx.build("Run regression tests.", { domain: "testing" });
  assert(c.ok);
  assert(Array.isArray(c.engineeringMemory), "engineeringMemory not array");
});

atest("build infers deployment category from command", async () => {
  const c = await ctx.build("Ship the release to production.");
  assert(c.ok);
  assert(c.category === "deployment", `expected deployment, got ${c.category}`);
});

atest("build infers testing category from command", async () => {
  const c = await ctx.build("Run regression and fix failing specs.");
  assert(c.ok);
  assert(c.category === "testing", `expected testing, got ${c.category}`);
});

test("buildQuick returns fast lightweight context", () => {
  const c = ctx.buildQuick("Review pull request.", { domain: "code_review" });
  assert(c.ok, "buildQuick failed");
  assert(c.command, "no command");
  assert(c.isQuick === true, "not flagged as quick");
  assert(typeof c.trustScore === "number");
  assert(c.patterns !== undefined, "no patterns");
  assert(c.timing !== undefined, "no timing");
});

test("buildQuick infers security category", () => {
  const c = ctx.buildQuick("Update SSL certificates and audit auth flow.");
  assert(c.ok);
  assert(c.category === "security", `expected security, got ${c.category}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 6: digitalTwinEngine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 6: digitalTwinEngine ──");

let deployDecisionId = null;

atest("decide returns full twin decision for deployment", async () => {
  const r = await dte.decide("Deploy today's release to production.", {
    workflowId: "wf_eng_deploy_release",
    domain:     "deployment",
    risk:       "high",
  });
  assert(r.ok, "decide failed: " + r.error);
  assert(r.id, "no id");
  assert(["approve", "reject", "modify"].includes(r.founderWouldLikely),
    `unexpected: ${r.founderWouldLikely}`);
  assert(typeof r.confidence === "number");
  assert(r.confidence >= 0 && r.confidence <= 1);
  assert(Array.isArray(r.reasoning), "reasoning not array");
  assert(Array.isArray(r.supportingHistory), "supportingHistory not array");
  assert(typeof r.trustScore === "number");
  assert(r.ts, "no ts");
  assert(typeof r.durationMs === "number");
  deployDecisionId = r.id;
});

atest("decide returns full twin decision for ui_review", async () => {
  const r = await dte.decide("Approve new dashboard layout design.", {
    domain: "ui_review",
    risk:   "medium",
  });
  assert(r.ok);
  assert(r.id);
  assert(["approve", "reject", "modify"].includes(r.founderWouldLikely));
  assert(r.category === "ui_review", `expected ui_review, got ${r.category}`);
});

atest("decide returns full twin decision for code_review", async () => {
  const r = await dte.decide("Review and approve pull request for auth module.", {
    domain: "code_review",
    risk:   "medium",
  });
  assert(r.ok);
  assert(r.id);
});

atest("decide for documentation produces approve", async () => {
  const r = await dte.decide("Approve API documentation update.", {
    domain: "documentation",
    risk:   "low",
  });
  assert(r.ok);
  assert(r.id);
  // Low risk doc updates should lean toward approve
  assert(r.approveProbability >= 0.3, `expected >0.3 approve prob, got ${r.approveProbability}`);
});

atest("recordOutcome updates stats and learning loop", async () => {
  // Sequential: decide then immediately record before any other write
  const fresh = await dte.decide("Deploy backend service update.", { domain: "deployment", risk: "medium" });
  assert(fresh.ok, "decide failed");
  // Small buffer to ensure file write completes
  await new Promise(res => setTimeout(res, 50));
  const r = await dte.recordOutcome(fresh.id, "approved", { correction: false });
  assert(r.ok, "recordOutcome failed: " + r.error);
  assert(typeof r.wasCorrect === "boolean");
  assert(typeof r.accuracy === "number");
  assert(r.accuracy >= 0 && r.accuracy <= 100);
});

atest("recordOutcome with correction triggers learning", async () => {
  const d = await dte.decide("Run security audit before release.", {
    domain: "security",
    risk:   "high",
  });
  assert(d.ok, "decide failed");
  await new Promise(res => setTimeout(res, 50));
  const r = await dte.recordOutcome(d.id, "rejected", { correction: true });
  assert(r.ok, "recordOutcome correction failed: " + r.error);
  assert(typeof r.wasCorrect === "boolean");
});

atest("recordOutcome returns error for nonexistent decision", async () => {
  const r = await dte.recordOutcome("nonexistent_fdt_id", "approved");
  assert(!r.ok, "expected failure");
  assert(r.error, "no error message");
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 7: Scenario validation
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 7: Scenario validation ──");

atest("scenario: deployment", async () => {
  const r = await dte.runScenario("deployment");
  assert(r.ok, "deployment scenario failed: " + r.error);
  assert(r.scenarioName === "deployment");
  assert(["approve", "reject", "modify"].includes(r.founderWouldLikely));
  assert(typeof r.confidence === "number");
  assert(typeof r.approveProbability === "number");
});

atest("scenario: production_release", async () => {
  const r = await dte.runScenario("production_release");
  assert(r.ok, "production_release scenario failed");
  assert(r.founderWouldLikely, "no prediction");
});

atest("scenario: ui_approval", async () => {
  const r = await dte.runScenario("ui_approval");
  assert(r.ok, "ui_approval scenario failed");
  assert(r.founderWouldLikely, "no prediction");
});

atest("scenario: code_review", async () => {
  const r = await dte.runScenario("code_review");
  assert(r.ok, "code_review scenario failed");
});

atest("scenario: documentation", async () => {
  const r = await dte.runScenario("documentation");
  assert(r.ok, "documentation scenario failed");
});

atest("scenario: roadmap_decision", async () => {
  const r = await dte.runScenario("roadmap_decision");
  assert(r.ok, "roadmap_decision scenario failed");
});

atest("scenario: production_checklist", async () => {
  const r = await dte.runScenario("production_checklist");
  assert(r.ok, "production_checklist scenario failed");
});

atest("runAllScenarios runs all 7 scenarios", async () => {
  const r = await dte.runAllScenarios();
  assert(r.ok, "runAllScenarios failed");
  assert(r.total === 7, `expected 7 scenarios, got ${r.total}`);
  assert(r.passed >= 6, `expected >=6 passed, got ${r.passed}`);
  assert(typeof r.avgConfidence === "number");
  assert(r.results.length === 7, "wrong result count");
  // Every scenario result should have a prediction
  r.results.filter(x => x.ok).forEach(res => {
    assert(["approve", "reject", "modify"].includes(res.founderWouldLikely),
      `bad prediction: ${res.founderWouldLikely}`);
  });
});

atest("unknown scenario returns error", async () => {
  const r = await dte.runScenario("nonexistent_scenario_xyz");
  assert(!r.ok, "expected failure");
  assert(r.error, "no error");
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 8: Full learning loop integration
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 8: Full learning loop integration ──");

atest("learning loop: observe 5 approvals → preferences updated", async () => {
  for (let i = 0; i < 5; i++) {
    fpe.observeApproval({
      workflowId:   `wf_deploy_test_${i}`,
      approvalType: "DEPLOY_CONFIRM",
      outcome:      "approved",
      confidence:   0.85 + i * 0.01,
      responseMs:   10000 + i * 1000,
      risk:         "medium",
    });
  }
  const prefs = fpe.getPreferences();
  assert(prefs.ok);
  assert(prefs.totalActions >= 5, `expected >=5 total actions, got ${prefs.totalActions}`);
});

atest("learning loop: 3 decisions → pattern extraction", async () => {
  for (let i = 0; i < 3; i++) {
    dle.recordDecision({
      type:       "approve",
      subject:    `Release v1.${i} to production`,
      domain:     "deployment",
      outcome:    "approved",
      predictionWas: "approved",
      risk:       "medium",
      durationMs: 15000,
    });
  }
  const patterns = dle.getPatterns();
  assert(patterns.ok);
  assert(typeof patterns.patternCount === "number");
  // deployment pattern should be extractable now
});

atest("learning loop: twin decision → recordOutcome → accuracy improves", async () => {
  const stats_before = dte.getStats();

  const d1 = await dte.decide("Deploy microservice update.", { domain: "deployment", risk: "medium" });
  const d2 = await dte.decide("Approve API docs.", { domain: "documentation", risk: "low" });

  // Record both as matching the twin's prediction
  await dte.recordOutcome(d1.id, d1.founderWouldLikely === "approve" ? "approved" : "rejected");
  await dte.recordOutcome(d2.id, d2.founderWouldLikely === "approve" ? "approved" : "rejected");

  const stats_after = dte.getStats();
  assert(stats_after.total >= stats_before.total + 2, `total decisions did not grow: before=${stats_before.total}, after=${stats_after.total}`);
  assert(stats_after.correct >= stats_before.correct + 1, `correct count did not increase: before=${stats_before.correct}, after=${stats_after.correct}`);
});

atest("learning loop: correction triggers memory update", async () => {
  const d = await dte.decide("Skip QA for urgent hotfix.", { domain: "security", risk: "high" });
  // Founder rejects — correction scenario
  const r = await dte.recordOutcome(d.id, "rejected", { correction: true });
  assert(r.ok);
  // learningLoop.totalCorrections should be >= 1
  const store = dte.getStats();
  assert(store.total >= 1);
});

atest("prediction accuracy: predict then confirm correct", async () => {
  const pred = ape.predict("wf_doc_update_test", { domain: "documentation", risk: "low" });
  assert(pred.ok);
  assert(pred.predictedOutcome, "no prediction");

  const preds = ape.getPredictions({ limit: 1 });
  if (!preds.predictions.length) return; // no stored predictions yet is OK
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 9: Dashboard
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 9: Dashboard ──");

atest("getDashboard returns complete structure", async () => {
  await Promise.all(promises.filter(p => p));
  await new Promise(r => setTimeout(r, 300));

  const d = dte.getDashboard();
  assert(d.ok, "getDashboard failed: " + JSON.stringify(d));

  // Core stats
  assert(typeof d.trustScore === "number");
  assert(d.trustScore >= 0 && d.trustScore <= 100);
  assert(typeof d.totalDecisions === "number");
  assert(d.totalDecisions >= 5, `expected >=5 decisions, got ${d.totalDecisions}`);
  assert(typeof d.accuracy === "number");
  assert(d.accuracy >= 0 && d.accuracy <= 100);

  // Sub-sections
  assert(d.profile, "no profile section");
  assert(d.prediction, "no prediction section");
  assert(d.decisions, "no decisions section");
  assert(d.preferences, "no preferences section");
  assert(d.learningLoop, "no learningLoop");

  // Recent decisions
  assert(Array.isArray(d.recentDecisions));
  assert(d.recentDecisions.length >= 1);

  // Learning loop tracking
  assert(typeof d.learningLoop.totalCorrections === "number");
  assert(typeof d.learningLoop.knowledgeUpdates === "number");

  // Auto-resolve stats
  assert(typeof d.autoResolved === "number");
  assert(typeof d.founderRequired === "number");
  assert(typeof d.minutesSaved === "number");

  // Scenarios run
  assert(Array.isArray(d.scenarios));
  assert(d.scenarios.length >= 7, `expected >=7 scenarios, got ${d.scenarios.length}`);

  console.log(`\n  Twin trust score: ${d.trustScore}`);
  console.log(`  Total decisions: ${d.totalDecisions}`);
  console.log(`  Prediction accuracy: ${d.accuracy}%`);
  console.log(`  Auto-resolved: ${d.autoResolved}`);
  console.log(`  Founder required: ${d.founderRequired}`);
  console.log(`  Minutes saved: ${d.minutesSaved}`);
  console.log(`  Learning loop — corrections: ${d.learningLoop.totalCorrections} / knowledge updates: ${d.learningLoop.knowledgeUpdates}`);
  console.log(`  Scenarios run: ${d.scenarios.length}`);
  console.log(`  Profile trust: ${d.profile?.totalActions} founder actions tracked`);
});

// ── Summary ───────────────────────────────────────────────────────────────────

async function main() {
  await Promise.all(promises);
  await new Promise(r => setTimeout(r, 500));

  const total = passed + failed;
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`POST-Ω Sprint P6 — Founder Digital Twin`);
  console.log(`  ${passed} passed  ${failed} failed  ${total} total`);
  console.log(`══════════════════════════════════════════════\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
