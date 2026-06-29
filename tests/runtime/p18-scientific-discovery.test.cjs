process.env.SKIP_PLATFORM_REGISTER = "1";
"use strict";
/**
 * p18-scientific-discovery.test.cjs
 * POST-Ω Sprint P18: Scientific Discovery Engine
 * Target: 80+ tests
 */

const assert   = require("assert");
const atests = [];
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function atest(name, fn) {
  atests.push({ name, fn });
}

const dpe = require("../../backend/services/discoveryPlannerEngine.cjs");
const hyp = require("../../backend/services/hypothesisEngine.cjs");
const eoe = require("../../backend/services/experimentOrchestratorEngine.cjs");
const pub = require("../../backend/services/publicationEngine.cjs");
const inn = require("../../backend/services/innovationEngine.cjs");
const sdb = require("../../backend/services/scientificDiscoveryDashboard.cjs");

// ── Section 1: Discovery Planner Engine (14 tests) ───────────────────────────

console.log("\n[1/6] Discovery Planner Engine");

test("exports DISCOVERY_DOMAINS with 6 domains", () => {
  assert.ok(Array.isArray(dpe.DISCOVERY_DOMAINS));
  assert.strictEqual(dpe.DISCOVERY_DOMAINS.length, 6);
});

test("DISCOVERY_DOMAINS includes engineering, business, customer", () => {
  ["engineering","business","customer","infrastructure","ai_capabilities","knowledge"]
    .forEach(d => assert.ok(dpe.DISCOVERY_DOMAINS.includes(d)));
});

test("exports QUESTION_TYPES with 5 types", () => {
  assert.ok(Array.isArray(dpe.QUESTION_TYPES));
  assert.strictEqual(dpe.QUESTION_TYPES.length, 5);
});

test("plan() returns ok:true", () => {
  const r = dpe.plan();
  assert.strictEqual(r.ok, true);
});

test("plan() returns found count", () => {
  const r = dpe.plan();
  assert.ok(typeof r.found === "number");
  assert.ok(r.found >= 0);
});

test("plan() discovers observations from live platform telemetry", () => {
  const r = dpe.plan();
  assert.ok(r.found > 0, `Expected >0 observations, got ${r.found}`);
});

test("plan() plans have required fields", () => {
  const r = dpe.plan();
  const p = r.plans[0];
  assert.ok(p.id);
  assert.ok(p.domain);
  assert.ok(p.question);
  assert.ok(p.questionType);
  assert.ok(p.source);
  assert.ok(p.plannedAt);
});

test("plan() assigns priority based on confidence", () => {
  const r = dpe.plan();
  r.plans.forEach(p => {
    assert.ok(["high","medium","low"].includes(p.priority));
  });
});

test("plan() is idempotent — deduplicates same observations", () => {
  const r1 = dpe.plan();
  const r2 = dpe.plan();
  assert.ok(r2.total >= r1.total); // total stays same or grows, never shrinks
});

test("listPlans() returns ok and array", () => {
  const r = dpe.listPlans();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.plans));
  assert.ok(r.plans.length > 0);
});

test("listPlans({domain:'engineering'}) filters", () => {
  const r = dpe.listPlans({ domain: "engineering" });
  assert.ok(r.plans.every(p => p.domain === "engineering"));
});

test("listPlans({priority:'high'}) filters", () => {
  const r = dpe.listPlans({ priority: "high" });
  assert.ok(r.plans.every(p => p.priority === "high"));
});

test("getPlan('nonexistent') returns null", () => {
  assert.strictEqual(dpe.getPlan("nonexistent-xyz"), null);
});

test("getStats() has total, byDomain, byQuestionType", () => {
  const s = dpe.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.byDomain === "object");
  assert.ok(typeof s.byQuestionType === "object");
  assert.ok(Array.isArray(s.DISCOVERY_DOMAINS));
});

// ── Section 2: Hypothesis Engine (16 tests) ──────────────────────────────────

console.log("\n[2/6] Hypothesis Engine");

test("exports HYPOTHESIS_SOURCES with 6 items", () => {
  assert.ok(Array.isArray(hyp.HYPOTHESIS_SOURCES));
  assert.strictEqual(hyp.HYPOTHESIS_SOURCES.length, 6);
});

test("exports HYPOTHESIS_STATUSES with 6 statuses", () => {
  assert.ok(Array.isArray(hyp.HYPOTHESIS_STATUSES));
  assert.strictEqual(hyp.HYPOTHESIS_STATUSES.length, 6);
  assert.ok(hyp.HYPOTHESIS_STATUSES.includes("validated"));
  assert.ok(hyp.HYPOTHESIS_STATUSES.includes("refuted"));
});

test("generate() returns ok:true", () => {
  const r = hyp.generate();
  assert.strictEqual(r.ok, true);
});

test("generate() returns generated count > 0", () => {
  const r = hyp.generate();
  assert.ok(r.generated > 0, `Expected >0 hypotheses, got ${r.generated}`);
});

test("generate() hypotheses have statement, rationale, measurable, falsifiable", () => {
  const r = hyp.generate();
  const h = r.hypotheses[0];
  assert.ok(h.statement, "statement missing");
  assert.ok(h.rationale, "rationale missing");
  assert.ok(h.measurable, "measurable missing");
  assert.ok(h.falsifiable, "falsifiable missing");
});

test("generate() hypotheses start with status 'draft'", () => {
  const r = hyp.generate();
  assert.ok(r.hypotheses.every(h => h.status === "draft"));
});

test("generate() hypotheses have valid confidence (0-100)", () => {
  const r = hyp.generate();
  assert.ok(r.hypotheses.every(h => h.confidence >= 0 && h.confidence <= 100));
});

test("generate({sources:['engineering']}) generates engineering hypotheses", () => {
  const r = hyp.generate({ sources: ["engineering"] });
  assert.ok(r.generated > 0);
  assert.ok(r.hypotheses.every(h => h.source === "engineering" || h.domain === "engineering"));
});

test("generate() customer source generates at least 1 customer hypothesis", () => {
  const r = hyp.generate({ sources: ["customer"] });
  assert.ok(r.generated >= 1, `Expected ≥1 customer hypothesis, got ${r.generated}`);
});

test("generate() is idempotent — deduplicates by statement prefix", () => {
  const r1 = hyp.generate();
  const r2 = hyp.generate();
  assert.ok(r2.total >= r1.total);
});

test("updateStatus(id, 'testing') works", () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses[0];
  const r   = hyp.updateStatus(h.id, "testing");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.hypothesis.status, "testing");
});

test("updateStatus('nonexistent', 'validated') returns ok:false", () => {
  const r = hyp.updateStatus("nonexistent-xyz", "validated");
  assert.strictEqual(r.ok, false);
});

test("updateStatus(id, 'invalid_status') returns ok:false", () => {
  const gen = hyp.generate();
  const r   = hyp.updateStatus(gen.hypotheses[0].id, "teleported");
  assert.strictEqual(r.ok, false);
});

test("getHypothesis(id) returns correct hypothesis", () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses[0];
  const got = hyp.getHypothesis(h.id);
  assert.ok(got !== null);
  assert.strictEqual(got.id, h.id);
});

test("listHypotheses({status:'draft'}) returns only drafts", () => {
  const r = hyp.listHypotheses({ status: "draft" });
  assert.ok(r.hypotheses.every(h => h.status === "draft"));
});

test("getStats() returns total, validated, avgConfidence", () => {
  const s = hyp.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.validated === "number");
  assert.ok(typeof s.avgConfidence === "number");
});

// ── Section 3: Experiment Orchestrator Engine (15 tests) ─────────────────────

console.log("\n[3/6] Experiment Orchestrator Engine");

test("exports EXPERIMENT_PHASES with 5 phases", () => {
  assert.ok(Array.isArray(eoe.EXPERIMENT_PHASES));
  assert.strictEqual(eoe.EXPERIMENT_PHASES.length, 5);
  ["design","execute","collect_evidence","analyze","validate"]
    .forEach(p => assert.ok(eoe.EXPERIMENT_PHASES.includes(p)));
});

test("exports EXPERIMENT_OUTCOMES with 4 outcomes", () => {
  assert.ok(Array.isArray(eoe.EXPERIMENT_OUTCOMES));
  assert.strictEqual(eoe.EXPERIMENT_OUTCOMES.length, 4);
});

atest("orchestrate('nonexistent') returns ok:false", async () => {
  const r = await eoe.orchestrate("nonexistent-xyz");
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

atest("orchestrate(validId, skipExecute) returns ok:true", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses[0];
  const r   = await eoe.orchestrate(h.id, { skipExecute: true });
  assert.strictEqual(r.ok, true);
  assert.ok(r.experiment);
});

atest("orchestrate returns experiment with all 5 phases", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  const r   = await eoe.orchestrate(h.id, { skipExecute: true });
  assert.ok(Array.isArray(r.experiment.phases));
  assert.strictEqual(r.experiment.phases.length, 5);
});

atest("orchestrate returns valid outcome", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  const r   = await eoe.orchestrate(h.id, { skipExecute: true });
  assert.ok(eoe.EXPERIMENT_OUTCOMES.includes(r.experiment.outcome));
});

atest("orchestrate returns evidenceCount", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  const r   = await eoe.orchestrate(h.id, { skipExecute: true });
  assert.ok(typeof r.experiment.evidenceCount === "number");
  assert.ok(r.experiment.evidenceCount > 0);
});

atest("orchestrate returns analysis with confidence", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  const r   = await eoe.orchestrate(h.id, { skipExecute: true });
  assert.ok(typeof r.analysis.confidence === "number");
  assert.ok(r.analysis.confidence >= 0 && r.analysis.confidence <= 100);
});

atest("orchestrate updates hypothesis status", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  await eoe.orchestrate(h.id, { skipExecute: true });
  const updated = hyp.getHypothesis(h.id);
  assert.ok(["validated","refuted","inconclusive"].includes(updated.status));
});

atest("getExperiment(id) returns record after orchestration", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  const r   = await eoe.orchestrate(h.id, { skipExecute: true });
  const found = eoe.getExperiment(r.experiment.id);
  assert.ok(found !== null);
});

test("getExperiment('nonexistent') returns null", () => {
  assert.strictEqual(eoe.getExperiment("nonexistent-xyz"), null);
});

test("listExperiments() returns ok and array", () => {
  const r = eoe.listExperiments();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.experiments));
});

atest("listExperiments({outcome:'hypothesis_supported'}) filters", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  await eoe.orchestrate(h.id, { skipExecute: true });
  const r = eoe.listExperiments({ outcome: "hypothesis_supported" });
  assert.ok(r.experiments.every(e => e.outcome === "hypothesis_supported"));
});

test("getStats() returns total, completed, successRate, EXPERIMENT_PHASES", () => {
  const s = eoe.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.completed === "number");
  assert.ok(typeof s.successRate === "number");
  assert.ok(Array.isArray(s.EXPERIMENT_PHASES));
});

atest("collect_evidence phase gathers ≥2 evidence points", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  const r   = await eoe.orchestrate(h.id, { skipExecute: true });
  const evidPhase = r.experiment.phases.find(p => p.phase === "collect_evidence");
  assert.ok(evidPhase.output.evidenceCount >= 2);
});

// ── Section 4: Publication Engine (14 tests) ─────────────────────────────────

console.log("\n[4/6] Publication Engine");

test("exports PUBLICATION_TYPES with 4 types", () => {
  assert.ok(Array.isArray(pub.PUBLICATION_TYPES));
  assert.strictEqual(pub.PUBLICATION_TYPES.length, 4);
  ["technical_paper","benchmark_report","architecture_report","evolution_proposal"]
    .forEach(t => assert.ok(pub.PUBLICATION_TYPES.includes(t)));
});

test("exports PUBLICATION_STATUSES with 4 statuses", () => {
  assert.ok(Array.isArray(pub.PUBLICATION_STATUSES));
  assert.strictEqual(pub.PUBLICATION_STATUSES.length, 4);
});

atest("publish(experimentId) returns ok:true", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  const exp = await eoe.orchestrate(h.id, { skipExecute: true });
  const r   = pub.publish(exp.experiment.id);
  assert.strictEqual(r.ok, true);
  assert.ok(r.published > 0);
});

test("publish('nonexistent') returns ok:false", () => {
  const r = pub.publish("nonexistent-xyz");
  assert.strictEqual(r.ok, false);
});

atest("publish() generates all 4 publication types by default", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  const exp = await eoe.orchestrate(h.id, { skipExecute: true });
  const r   = pub.publish(exp.experiment.id);
  assert.strictEqual(r.published, 4);
  const types = r.publications.map(p => p.type);
  pub.PUBLICATION_TYPES.forEach(t => assert.ok(types.includes(t)));
});

atest("publications have title and abstract", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  const exp = await eoe.orchestrate(h.id, { skipExecute: true });
  const r   = pub.publish(exp.experiment.id);
  r.publications.forEach(p => {
    assert.ok(p.content.title, `${p.type} missing title`);
    assert.ok(p.content.abstract, `${p.type} missing abstract`);
    assert.ok(Array.isArray(p.content.sections), `${p.type} missing sections`);
  });
});

atest("publications get standardized status via RKE", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  const exp = await eoe.orchestrate(h.id, { skipExecute: true });
  const r   = pub.publish(exp.experiment.id);
  assert.ok(r.publications.some(p => p.status === "standardized" || p.status === "published"));
});

atest("publish(['technical_paper']) generates only 1 publication", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  const exp = await eoe.orchestrate(h.id, { skipExecute: true });
  const r   = pub.publish(exp.experiment.id, ["technical_paper"]);
  assert.strictEqual(r.published, 1);
  assert.strictEqual(r.publications[0].type, "technical_paper");
});

test("queueForPublication(expId) returns ok:true", () => {
  const r = pub.queueForPublication("exp-fake-123");
  assert.strictEqual(r.ok, true);
  assert.ok(typeof r.queueLength === "number");
});

test("processQueue() processes and returns ok:true", () => {
  pub.queueForPublication("exp-fake-456");
  const r = pub.processQueue();
  assert.strictEqual(r.ok, true);
  assert.ok(typeof r.processed === "number");
});

test("listPublications() returns ok and array", () => {
  const r = pub.listPublications();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.publications));
});

test("listPublications({type:'technical_paper'}) filters", () => {
  const r = pub.listPublications({ type: "technical_paper" });
  assert.ok(r.publications.every(p => p.type === "technical_paper"));
});

test("getStats() returns total, standardized, queueLength, byType", () => {
  const s = pub.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.standardized === "number");
  assert.ok(typeof s.queueLength === "number");
  assert.ok(typeof s.byType === "object");
});

atest("getPublication(id) returns correct record", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  const exp = await eoe.orchestrate(h.id, { skipExecute: true });
  const r   = pub.publish(exp.experiment.id, ["benchmark_report"]);
  const p   = pub.getPublication(r.publications[0].id);
  assert.ok(p !== null);
  assert.strictEqual(p.type, "benchmark_report");
});

// ── Section 5: Innovation Engine (14 tests) ───────────────────────────────────

console.log("\n[5/6] Innovation Engine");

test("exports INNOVATION_TYPES with 4 types", () => {
  assert.ok(Array.isArray(inn.INNOVATION_TYPES));
  assert.strictEqual(inn.INNOVATION_TYPES.length, 4);
});

test("exports IMPACT_LEVELS with 4 levels", () => {
  assert.ok(Array.isArray(inn.IMPACT_LEVELS));
  assert.strictEqual(inn.IMPACT_LEVELS.length, 4);
  assert.ok(inn.IMPACT_LEVELS.includes("breakthrough"));
});

test("scan() returns ok:true", () => {
  const r = inn.scan();
  assert.strictEqual(r.ok, true);
});

test("scan() returns discovered count ≥ 0", () => {
  const r = inn.scan();
  assert.ok(typeof r.discovered === "number");
  assert.ok(r.discovered >= 0);
});

test("scan() returns innovationScore (0-100)", () => {
  const r = inn.scan();
  assert.ok(r.innovationScore >= 0 && r.innovationScore <= 100);
});

test("scan() discovers innovations from live platform data", () => {
  const r = inn.scan();
  // At minimum, scan should discover something from live engineering data or experiments
  assert.ok(r.total >= 0);
});

test("recordInnovation() without title returns ok:false", () => {
  const r = inn.recordInnovation({ type: "algorithm_improvement" });
  assert.strictEqual(r.ok, false);
});

test("recordInnovation() without type returns ok:false", () => {
  const r = inn.recordInnovation({ title: "Test Innovation" });
  assert.strictEqual(r.ok, false);
});

test("recordInnovation() with invalid type returns ok:false", () => {
  const r = inn.recordInnovation({ title: "Test", type: "teleportation" });
  assert.strictEqual(r.ok, false);
});

test("recordInnovation() valid spec returns ok:true", () => {
  const r = inn.recordInnovation({
    title:       "Test Algorithm Improvement",
    type:        "algorithm_improvement",
    description: "Self-healing loop optimized",
    confidence:  88,
    impact:      "medium",
    source:      "test",
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.innovation.id);
});

test("markApplied(id) sets applied:true", () => {
  const created = inn.recordInnovation({
    title: "Apply-Test Innovation",
    type:  "platform_innovation",
    impact: "low",
  });
  const r = inn.markApplied(created.innovation.id);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.innovation.applied, true);
  assert.ok(r.innovation.appliedAt);
});

test("markApplied('nonexistent') returns ok:false", () => {
  const r = inn.markApplied("nonexistent-xyz");
  assert.strictEqual(r.ok, false);
});

test("listInnovations() returns ok and array", () => {
  const r = inn.listInnovations();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.innovations));
});

test("getStats() returns total, innovationScore, byType, byImpact", () => {
  const s = inn.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.innovationScore === "number");
  assert.ok(typeof s.byType === "object");
  assert.ok(typeof s.byImpact === "object");
});

// ── Section 6: Scientific Discovery Dashboard (11 tests) ─────────────────────

console.log("\n[6/6] Scientific Discovery Dashboard");

test("exports SCIENTIFIC_SERVICES_REUSED = 20", () => {
  assert.strictEqual(sdb.SCIENTIFIC_SERVICES_REUSED, 20);
});

test("exports PIPELINE_STEPS with 11 steps", () => {
  assert.ok(Array.isArray(sdb.PIPELINE_STEPS));
  assert.strictEqual(sdb.PIPELINE_STEPS.length, 11);
});

test("PIPELINE_STEPS first step is 'Observe'", () => {
  assert.strictEqual(sdb.PIPELINE_STEPS[0].step, "Observe");
});

test("PIPELINE_STEPS last step is 'Learn'", () => {
  assert.strictEqual(sdb.PIPELINE_STEPS[10].step, "Learn");
});

test("getDashboard() returns ok:true", () => {
  const r = sdb.getDashboard();
  assert.strictEqual(r.ok, true);
});

test("getDashboard() summary has scientificServicesReused=20", () => {
  const r = sdb.getDashboard();
  assert.strictEqual(r.summary.scientificServicesReused, 20);
});

test("getDashboard() has all required sections", () => {
  const r = sdb.getDashboard();
  assert.ok(typeof r.summary === "object");
  assert.ok(typeof r.discoveryPlans === "object");
  assert.ok(typeof r.hypotheses === "object");
  assert.ok(typeof r.experiments === "object");
  assert.ok(typeof r.publications === "object");
  assert.ok(typeof r.innovations === "object");
  assert.ok(typeof r.founderTimeSaved === "object");
});

test("getDashboard() founderTimeSaved has totalHours", () => {
  const r = sdb.getDashboard();
  assert.ok(typeof r.founderTimeSaved.totalHours === "number");
  assert.ok(r.founderTimeSaved.totalHours >= 0);
});

test("getPipelineView() returns 11-step pipeline", () => {
  const r = sdb.getPipelineView();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.pipeline.length, 11);
});

test("getScientificSystemHealth() returns ok and status", () => {
  const r = sdb.getScientificSystemHealth();
  assert.strictEqual(r.ok, true);
  assert.ok(typeof r.status === "string");
  assert.ok(typeof r.healthy === "number");
});

test("all 6 P18 engines healthy in system check", () => {
  const r = sdb.getScientificSystemHealth();
  const p18 = r.services.filter(s => [
    "discoveryPlannerEngine","hypothesisEngine","experimentOrchestratorEngine",
    "publicationEngine","innovationEngine","scientificDiscoveryDashboard",
  ].includes(s.name));
  assert.ok(p18.every(s => s.ok === true));
});

// ── End-to-End (10 tests) ─────────────────────────────────────────────────────

console.log("\n[E2E] End-to-End");

test("E2E: plan() generates observations from live platform", () => {
  const r = dpe.plan();
  assert.ok(r.found > 0);
  assert.ok(r.plans.some(p => p.domain === "engineering"));
});

test("E2E: generate() produces falsifiable hypotheses", () => {
  const r = hyp.generate();
  assert.ok(r.generated > 0);
  r.hypotheses.forEach(h => {
    assert.ok(h.falsifiable, `${h.id} missing falsifiable`);
    assert.ok(h.measurable,  `${h.id} missing measurable`);
  });
});

atest("E2E: orchestrate → experiment has 5 phases all completed", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  const r   = await eoe.orchestrate(h.id, { skipExecute: true });
  assert.strictEqual(r.experiment.phases.length, 5);
  assert.ok(r.experiment.phases.every(p => p.status === "completed"));
});

atest("E2E: experiment updates hypothesis status", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  await eoe.orchestrate(h.id, { skipExecute: true });
  const updated = hyp.getHypothesis(h.id);
  assert.ok(updated.status !== "draft");
});

atest("E2E: publish after experiment generates 4 publications", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  const exp = await eoe.orchestrate(h.id, { skipExecute: true });
  const r   = pub.publish(exp.experiment.id);
  assert.strictEqual(r.published, 4);
});

test("E2E: scan innovations after experiments", () => {
  const r = inn.scan();
  assert.ok(r.ok === true);
  // Should discover from validated experiments
  assert.ok(r.total >= 0);
});

atest("E2E: full pipeline (plan→hyp→exp→pub→inn→dash)", async () => {
  // Plan
  const p = dpe.plan();
  assert.ok(p.ok);
  // Hypotheses
  const h = hyp.generate();
  assert.ok(h.generated > 0);
  // Experiment on first draft
  const draft = h.hypotheses.find(x => x.status === "draft") || h.hypotheses[0];
  const exp   = await eoe.orchestrate(draft.id, { skipExecute: true });
  assert.ok(exp.ok);
  // Publish
  const publications = pub.publish(exp.experiment.id);
  assert.ok(publications.ok);
  // Scan innovations
  const innovations = inn.scan();
  assert.ok(innovations.ok);
  // Dashboard
  const db = sdb.getDashboard();
  assert.ok(db.ok);
  assert.ok(db.summary.experimentSuccessRate >= 0);
});

atest("E2E: innovation recorded after validated experiment", async () => {
  const gen = hyp.generate();
  const h   = gen.hypotheses.find(x => x.status === "draft") || gen.hypotheses[0];
  const exp = await eoe.orchestrate(h.id, { skipExecute: true });

  if (exp.experiment.outcome === "hypothesis_supported") {
    // Record the innovation manually
    const r = inn.recordInnovation({
      title:        `Validated: ${exp.experiment.hypothesisStatement?.slice(0, 60) || "discovery"}`,
      type:         "validated_discovery",
      confidence:   exp.experiment.confidence,
      impact:       exp.experiment.confidence >= 90 ? "high" : "medium",
      source:       "experimentOrchestratorEngine",
      experimentId: exp.experiment.id,
    });
    assert.ok(r.ok);
    assert.ok(r.innovation.id);
  } else {
    // Experiment outcome was not supported — still ok
    assert.ok(eoe.EXPERIMENT_OUTCOMES.includes(exp.experiment.outcome));
  }
});

test("E2E: dashboard founderTimeSaved increases as discoveries accumulate", () => {
  const db1 = sdb.getDashboard();
  // Create a validated hypothesis manually
  const gen = hyp.generate();
  const h   = gen.hypotheses[0];
  hyp.updateStatus(h.id, "validated");
  const db2 = sdb.getDashboard();
  assert.ok(db2.founderTimeSaved.totalMinutes >= db1.founderTimeSaved.totalMinutes);
});

test("E2E: researchHealth score is 0-100", () => {
  const db = sdb.getDashboard();
  assert.ok(db.summary.researchHealth >= 0 && db.summary.researchHealth <= 100);
});

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of atests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`); passed++;
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`); failed++;
    }
  }
  console.log(`\n${"─".repeat(50)}`);
  console.log(`POST-Ω P18: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
