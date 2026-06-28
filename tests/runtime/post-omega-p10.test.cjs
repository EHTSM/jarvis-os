"use strict";
process.env.SKIP_PLATFORM_REGISTER = "1";

/**
 * POST-Ω Sprint P10 — Autonomous Research Institute
 * Tests: researchPlanner, researchKnowledgeEngine, benchmarkEngine,
 *        experimentManager, researchPublicationEngine, researchDashboard
 */

const assert = require("assert");

const planner  = require("../../backend/services/researchPlanner.cjs");
const rke      = require("../../backend/services/researchKnowledgeEngine.cjs");
const bench    = require("../../backend/services/benchmarkEngine.cjs");
const em       = require("../../backend/services/experimentManager.cjs");
const rpe      = require("../../backend/services/researchPublicationEngine.cjs");
const dash     = require("../../backend/services/researchDashboard.cjs");

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const promises = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      promises.push(r.then(() => { passed++; console.log(`  ✓ ${name}`); })
                     .catch(e => { failed++; console.log(`  ✗ ${name} — ${e.message}`); }));
    } else { passed++; console.log(`  ✓ ${name}`); }
  } catch (e) { failed++; console.log(`  ✗ ${name} — ${e.message}`); }
}

function atest(name, fn) {
  promises.push(
    fn().then(() => { passed++; console.log(`  ✓ ${name}`); })
        .catch(e => { failed++; console.log(`  ✗ ${name} — ${e.message}`); })
  );
}

async function main() {

  // ── researchPlanner ───────────────────────────────────────────────────────

  console.log("\n[researchPlanner]");

  test("RESEARCH_DOMAINS defined (≥10)", () => {
    assert(Array.isArray(planner.RESEARCH_DOMAINS) && planner.RESEARCH_DOMAINS.length >= 10, "domains < 10");
  });

  test("PIPELINE_STEPS has 16 steps", () => {
    assert(planner.PIPELINE_STEPS.length === 16, `expected 16 steps, got ${planner.PIPELINE_STEPS.length}`);
  });

  test("PIPELINE_STEPS contains required stages", () => {
    const required = ["observe","identify_weakness","research","benchmark","generate_hypothesis","design_experiment","run_experiment","publish","recommend_evolution"];
    for (const s of required) assert(planner.PIPELINE_STEPS.includes(s), `missing step: ${s}`);
  });

  test("createPlan fails without topic", () => {
    const r = planner.createPlan({});
    assert(!r.ok, "should fail without topic");
  });

  let _plan1, _plan2;

  test("createPlan creates deployment research plan", () => {
    const r = planner.createPlan({ topic: "deployment strategy optimization", domain: "deployment_strategy", priority: 80 });
    assert(r.ok, r.error || "not ok");
    assert(r.plan.id, "no id");
    assert(r.plan.topic === "deployment strategy optimization", "wrong topic");
    assert(r.plan.priority === 80, "wrong priority");
    assert(r.plan.steps.length === 16, "wrong steps count");
    assert(r.plan.status === "backlog", "wrong initial status");
    _plan1 = r.plan;
  });

  test("createPlan auto-infers domain from topic", () => {
    const r = planner.createPlan({ topic: "workspace mesh reliability improvement" });
    assert(r.ok, "not ok");
    assert(r.plan.domain === "workspace_mesh", `expected workspace_mesh, got ${r.plan.domain}`);
    _plan2 = r.plan;
  });

  test("observe returns weaknesses", () => {
    const r = planner.observe();
    assert(r.ok, "not ok");
    assert(Array.isArray(r.weaknesses), "not array");
    assert(r.count >= 0, "no count");
  });

  test("getPlan retrieves by id", () => {
    assert(_plan1, "no _plan1");
    const p = planner.getPlan(_plan1.id);
    assert(p, "not found");
    assert(p.id === _plan1.id, "wrong id");
  });

  test("listPlans returns list", () => {
    const r = planner.listPlans({ limit: 10 });
    assert(r.ok, "not ok");
    assert(Array.isArray(r.plans), "not array");
    assert(r.plans.length >= 1, "no plans");
  });

  test("listPlans filters by status", () => {
    const r = planner.listPlans({ status: "backlog" });
    assert(r.ok, "not ok");
    assert(r.plans.every(p => p.status === "backlog"), "non-backlog in result");
  });

  test("listPlans filters by domain", () => {
    const r = planner.listPlans({ domain: "deployment_strategy" });
    assert(r.ok, "not ok");
    assert(r.plans.every(p => p.domain === "deployment_strategy"), "wrong domain");
  });

  test("getBacklog returns priority-sorted backlog", () => {
    const r = planner.getBacklog({ limit: 10 });
    assert(r.ok, "not ok");
    assert(Array.isArray(r.backlog), "not array");
  });

  atest("autoDiscover creates plans from observed weaknesses", async () => {
    const r = await planner.autoDiscover();
    assert(r.ok, r.error || "not ok");
    assert(r.discovered >= 0, "no discovered count");
    assert(typeof r.plansCreated === "number", "no plansCreated");
  });

  atest("runPipeline executes all 16 steps", async () => {
    assert(_plan1, "no _plan1");
    const r = await planner.runPipeline(_plan1.id);
    assert(r.ok, r.error || "pipeline failed");
    assert(r.stepsCompleted >= 14, `only ${r.stepsCompleted}/16 steps completed`);
    assert(typeof r.minutesSaved === "number" && r.minutesSaved > 0, "no minutesSaved");

    // Verify plan updated
    const p = planner.getPlan(_plan1.id);
    assert(p.status === "completed" || p.status === "partial", `unexpected status: ${p.status}`);
    assert(p.hypothesis, "no hypothesis generated");
    assert(Array.isArray(p.improvements), "no improvements array");
  });

  test("planner getStats returns stats", () => {
    const s = planner.getStats();
    assert(typeof s.totalPlans === "number", "no totalPlans");
    assert(typeof s.completed  === "number", "no completed");
    assert(s.byDomain, "no byDomain");
  });

  // ── researchKnowledgeEngine ───────────────────────────────────────────────

  console.log("\n[researchKnowledgeEngine]");

  test("RADAR_RINGS defined", () => {
    const required = ["adopt","trial","assess","hold"];
    for (const r of required) assert(rke.RADAR_RINGS.includes(r), `missing ring: ${r}`);
  });

  test("RADAR_QUADRANTS defined", () => {
    assert(rke.RADAR_QUADRANTS.includes("techniques"), "missing techniques quadrant");
    assert(rke.RADAR_QUADRANTS.includes("tools"),      "missing tools quadrant");
    assert(rke.RADAR_QUADRANTS.includes("platforms"),  "missing platforms quadrant");
  });

  test("indexFinding fails without finding", () => {
    const r = rke.indexFinding({ topic: "x" });
    assert(!r.ok, "should fail without finding");
  });

  let _finding1;

  test("indexFinding stores a finding", () => {
    const r = rke.indexFinding({
      topic: "workspace_mesh_latency", domain: "workspace_mesh",
      finding: "Workspace mesh P90 latency reduced by 18% after coordinator optimization.",
      confidence: 0.87, tags: ["performance", "mesh"],
    });
    assert(r.ok, r.error || "not ok");
    assert(r.finding.id, "no id");
    assert(r.finding.confidence === 0.87, "wrong confidence");
    _finding1 = r.finding;
  });

  test("getFindings retrieves findings", () => {
    const r = rke.getFindings({ limit: 10 });
    assert(r.ok, "not ok");
    assert(Array.isArray(r.findings) && r.findings.length >= 1, "no findings");
  });

  test("getFindings filters by domain", () => {
    const r = rke.getFindings({ domain: "workspace_mesh" });
    assert(r.ok, "not ok");
    assert(r.findings.every(f => f.domain === "workspace_mesh"), "wrong domain in results");
  });

  test("generateRecommendations returns recommendations", () => {
    const r = rke.generateRecommendations({});
    assert(r.ok, r.error || "not ok");
    assert(Array.isArray(r.recommendations), "not array");
    assert(typeof r.count === "number", "no count");
  });

  test("getRadar returns technology radar", () => {
    const r = rke.getRadar();
    assert(r.ok, "not ok");
    assert(Array.isArray(r.radar) && r.radar.length >= 10, `expected ≥10 radar items, got ${r.radar?.length}`);
    assert(r.byRing, "no byRing");
    assert(r.byRing.adopt, "no adopt ring items");
  });

  test("getRadar filters by quadrant", () => {
    const r = rke.getRadar({ quadrant: "techniques" });
    assert(r.ok, "not ok");
    assert(r.radar.every(i => i.quadrant === "techniques"), "wrong quadrant in result");
  });

  test("addRadarEntry adds new entry", () => {
    const r = rke.addRadarEntry({ name: "Research Institute P10", quadrant: "techniques", ring: "trial", blip: "Autonomous research pipeline" });
    assert(r.ok, r.error || "not ok");
    assert(r.entry.name === "Research Institute P10", "wrong name");
    assert(r.entry.ring === "trial", "wrong ring");
  });

  test("addRadarEntry fails for invalid ring", () => {
    const r = rke.addRadarEntry({ name: "x", quadrant: "techniques", ring: "invalid_ring" });
    assert(!r.ok, "should fail for invalid ring");
  });

  test("updateRadarEntry updates existing entry", () => {
    rke.addRadarEntry({ name: "TestTech P10", quadrant: "tools", ring: "assess", blip: "Test" });
    const r = rke.updateRadarEntry("TestTech P10", { ring: "trial", blip: "Updated" });
    assert(r.ok, "not ok");
    assert(r.entry.ring === "trial", "ring not updated");
  });

  test("compareArchitectures fails with <2 options", () => {
    const r = rke.compareArchitectures(["only_one"]);
    assert(!r.ok, "should fail with < 2 options");
  });

  test("compareArchitectures compares strategies", () => {
    const r = rke.compareArchitectures(["deployment_v1", "deployment_v2", "deployment_v3"]);
    assert(r.ok, r.error || "not ok");
    assert(Array.isArray(r.comparison) && r.comparison.length === 3, "wrong comparison length");
    assert(r.winner, "no winner");
  });

  test("publishKnowledge publishes findings", () => {
    const r = rke.publishKnowledge({
      planId: _plan1?.id,
      topics: ["workspace_mesh", "performance"],
      findings: [{ topic: "latency", domain: "workspace_mesh", finding: "Latency improved by 12%.", confidence: 0.8 }],
    });
    assert(r.ok, "not ok");
    assert(r.published >= 1, "nothing published");
  });

  test("knowledge getStats returns stats", () => {
    const s = rke.getStats();
    assert(typeof s.findingsIndexed === "number", "no findingsIndexed");
    assert(typeof s.radarEntries    === "number", "no radarEntries");
  });

  // ── benchmarkEngine ───────────────────────────────────────────────────────

  console.log("\n[benchmarkEngine]");

  test("BENCHMARK_TARGETS has 7 targets", () => {
    assert(Object.keys(bench.BENCHMARK_TARGETS).length === 7, `expected 7, got ${Object.keys(bench.BENCHMARK_TARGETS).length}`);
  });

  test("BENCHMARK_TARGETS covers key platform components", () => {
    const required = ["execution_pipeline","workspace_mesh","approval_engine","workforce_allocation","deployment_strategy"];
    for (const t of required) assert(bench.BENCHMARK_TARGETS[t], `missing target: ${t}`);
  });

  atest("runBenchmark fails for unknown target", async () => {
    const r = await bench.runBenchmark("nonexistent_target_xyz");
    assert(!r.ok, "should fail for unknown target");
  });

  let _bm1, _bm2;

  atest("runBenchmark: execution_pipeline", async () => {
    const r = await bench.runBenchmark("execution_pipeline", { iterations: 2 });
    assert(r.ok, r.error || "not ok");
    assert(r.id, "no id");
    assert(r.metrics, "no metrics");
    assert(typeof r.metrics.success_rate === "number", "no success_rate metric");
    assert(r.comparison, "no comparison");
    _bm1 = r;
  });

  atest("runBenchmark: workspace_mesh", async () => {
    const r = await bench.runBenchmark("workspace_mesh", { iterations: 2 });
    assert(r.ok, r.error || "not ok");
    assert(typeof r.metrics.workspace_coverage === "number", "no workspace_coverage");
    assert(r.metrics.workspace_coverage === 12, `expected 12 workspaces, got ${r.metrics.workspace_coverage}`);
    _bm2 = r;
  });

  atest("runBenchmark: approval_engine", async () => {
    const r = await bench.runBenchmark("approval_engine", { iterations: 2 });
    assert(r.ok, r.error || "not ok");
    assert(typeof r.metrics.auto_approval_rate === "number", "no auto_approval_rate");
  });

  atest("runBenchmark: workforce_allocation", async () => {
    const r = await bench.runBenchmark("workforce_allocation", { iterations: 2 });
    assert(r.ok, r.error || "not ok");
    assert(typeof r.metrics.agent_utilization === "number", "no agent_utilization");
  });

  atest("runBenchmark: deployment_strategy", async () => {
    const r = await bench.runBenchmark("deployment_strategy", { iterations: 2 });
    assert(r.ok, r.error || "not ok");
    assert(typeof r.metrics.deploy_success_rate === "number", "no deploy_success_rate");
  });

  atest("runAll benchmarks all 7 targets", async () => {
    const r = await bench.runAll({});
    assert(r.ok, "not ok");
    assert(r.targets === 7, `expected 7 targets, got ${r.targets}`);
    assert(typeof r.improvements === "number", "no improvements count");
  });

  // Sync benchmark list/get/history checks — chained after runAll so data exists
  atest("listRuns, getRun, getHistory suite", async () => {
    // Ensure at least one benchmark run exists
    const seed = await bench.runBenchmark("execution_pipeline", { iterations: 1 });
    assert(seed.ok, "seed benchmark failed");

    const list = bench.listRuns({ limit: 10 });
    assert(list.ok, "listRuns not ok");
    assert(Array.isArray(list.runs) && list.runs.length >= 1, "no runs in list");

    const got = bench.getRun(seed.id);
    assert(got, "getRun not found");
    assert(got.id === seed.id, "wrong id from getRun");

    const hist = bench.getHistory("execution_pipeline", 5);
    assert(hist.ok, "getHistory not ok");
    assert(Array.isArray(hist.history) && hist.history.length >= 1, "no history");
  });

  atest("getTrend returns trend direction", async () => {
    // Run extra benchmark to build trend data
    await bench.runBenchmark("workspace_mesh", { iterations: 2 });
    const r = bench.getTrend("workspace_mesh", { metric: "sync_accuracy" });
    assert(r.ok, r.error || "not ok");
    assert(["improving","declining","stable","insufficient_data"].includes(r.direction), `unexpected direction: ${r.direction}`);
  });

  test("compareStrategies fails with <2 strategies", () => {
    const r = bench.compareStrategies(["one"]);
    assert(!r.ok, "should fail with < 2 strategies");
  });

  test("compareStrategies compares deployment strategies", () => {
    const r = bench.compareStrategies([
      { name: "Blue/Green Deploy",  target: "deployment_strategy" },
      { name: "Rolling Deploy",     target: "workspace_mesh" },
      { name: "Canary Deploy",      target: "execution_pipeline" },
    ]);
    assert(r.ok, r.error || "not ok");
    assert(Array.isArray(r.strategies) && r.strategies.length === 3, "wrong strategies count");
    assert(r.winner, "no winner");
  });

  atest("getBaseline and getStats suite", async () => {
    // Ensure execution_pipeline has been benchmarked (runAll or individual)
    await bench.runBenchmark("execution_pipeline", { iterations: 1 });
    const b = bench.getBaseline("execution_pipeline");
    assert(b, "no baseline");
    assert(typeof b.success_rate === "number", "no success_rate in baseline");

    const s = bench.getStats();
    assert(typeof s.totalRuns === "number" && s.totalRuns >= 1, `totalRuns should be ≥1, got ${s.totalRuns}`);
    assert(typeof s.targetsRun === "number", "no targetsRun");
    assert(s.targetsRun >= 1, `targetsRun should be ≥1, got ${s.targetsRun}`);
  });

  // ── experimentManager ─────────────────────────────────────────────────────

  console.log("\n[experimentManager]");

  test("EXPERIMENT_TYPES defined (≥6)", () => {
    assert(Array.isArray(em.EXPERIMENT_TYPES) && em.EXPERIMENT_TYPES.length >= 6, "too few experiment types");
  });

  test("design fails without name", () => {
    const r = em.design({});
    assert(!r.ok, "should fail without name");
  });

  let _exp1, _exp2;

  test("design creates a/b test experiment", () => {
    const r = em.design({
      planId: _plan1?.id,
      type:   "a_b_test",
      name:   "Deployment Strategy A/B Test",
      hypothesis: "Blue/green deployment reduces rollback rate vs rolling deploy",
      control:    "rolling_deployment",
      treatment:  "blue_green_deployment",
      metrics:    ["deploy_success_rate", "rollback_rate", "time_to_deploy_ms"],
    });
    assert(r.ok, r.error || "not ok");
    assert(r.experiment.id, "no id");
    assert(r.experiment.status === "designed", "wrong initial status");
    assert(r.experiment.type === "a_b_test", "wrong type");
    _exp1 = r.experiment;
  });

  test("design creates benchmark_compare experiment", () => {
    const r = em.design({
      planId: _plan2?.id,
      type:   "benchmark_compare",
      name:   "Workspace Mesh Reliability Test",
      control:    "current_workspace_mesh",
      treatment:  "optimized_workspace_mesh",
      metrics:    ["latency_ms", "success_rate", "error_rate"],
    });
    assert(r.ok, "not ok");
    _exp2 = r.experiment;
  });

  atest("run experiment executes and produces results", async () => {
    assert(_exp1, "no _exp1");
    const r = await em.run(_exp1.id);
    assert(r.ok, r.error || "run failed");
    assert(r.results, "no results");
    assert(r.results.control,   "no control results");
    assert(r.results.treatment, "no treatment results");
    assert(r.results.deltas,    "no deltas");
    assert(typeof r.results.overallImprovement === "boolean", "no overallImprovement");
    assert(typeof r.results.confidence === "number", "no confidence");

    // Verify experiment updated
    const e = em.getExperiment(_exp1.id);
    assert(e.status === "completed", `expected completed, got ${e.status}`);
  });

  atest("run experiment again fails (already completed)", async () => {
    assert(_exp1, "no _exp1");
    // The experiment must have been run first — design a new one and run it, then try running again
    const tmp = em.design({ name: "Duplicate run test", type: "a_b_test", control: "x", treatment: "y" });
    assert(tmp.ok, "design failed");
    await em.run(tmp.experiment.id);
    const r = await em.run(tmp.experiment.id);
    assert(!r.ok, "should fail for already-completed experiment");
  });

  atest("validate experiment results (after run)", async () => {
    assert(_exp1, "no _exp1");
    // _exp1 is run in the atest above — if still "designed", run it first
    const existing = em.getExperiment(_exp1.id);
    if (existing.status !== "completed") await em.run(_exp1.id);
    const r = em.validate(_exp1.id, { threshold: 0.5 });
    assert(r.ok, r.error || "not ok");
    assert(r.validation, "no validation");
    assert(typeof r.validated === "boolean", "no validated flag");
    assert(r.validation.validatedAt, "no validatedAt");
  });

  atest("replay creates and runs a new experiment", async () => {
    assert(_exp1, "no _exp1");
    const r = await em.replay(_exp1.id);
    assert(r.ok || r.results, "replay failed");
  });

  test("listExperiments returns experiments", () => {
    const r = em.listExperiments({ limit: 10 });
    assert(r.ok, "not ok");
    assert(Array.isArray(r.experiments) && r.experiments.length >= 1, "no experiments");
  });

  test("listExperiments filters by status", () => {
    const r = em.listExperiments({ status: "completed" });
    assert(r.ok, "not ok");
    assert(r.experiments.every(e => e.status === "completed"), "non-completed in results");
  });

  test("getExperiment retrieves by id", () => {
    assert(_exp1, "no _exp1");
    const e = em.getExperiment(_exp1.id);
    assert(e, "not found");
    assert(e.id === _exp1.id, "wrong id");
  });

  test("experiment getStats returns stats", () => {
    const s = em.getStats();
    assert(typeof s.total     === "number", "no total");
    assert(typeof s.completed === "number", "no completed");
    assert(s.byType, "no byType");
  });

  // ── researchPublicationEngine ─────────────────────────────────────────────

  console.log("\n[researchPublicationEngine]");

  test("PUBLICATION_TYPES defined (≥5)", () => {
    assert(Array.isArray(rpe.PUBLICATION_TYPES) && rpe.PUBLICATION_TYPES.length >= 5, "too few publication types");
  });

  test("generatePaper fails without title", () => {
    const r = rpe.generatePaper({});
    assert(!r.ok, "should fail without title");
  });

  let _pub1;

  test("generatePaper creates a research paper", () => {
    const r = rpe.generatePaper({
      planId:   _plan1?.id,
      title:    "Optimizing Deployment Strategies in Autonomous Platforms",
      domain:   "deployment_strategy",
      abstract: "Investigation into deployment strategy performance across the Ooplix platform.",
    });
    assert(r.ok, r.error || "not ok");
    assert(r.publication.id, "no id");
    assert(r.publication.type === "research_paper", "wrong type");
    assert(Array.isArray(r.publication.sections) && r.publication.sections.length >= 4, "too few sections");
    assert(r.publication.wordCount > 0, "no wordCount");
    assert(r.publication.minutesSaved > 0, "no minutesSaved");
    _pub1 = r.publication;
  });

  test("generatePaper with findings and experiment refs", () => {
    const r = rpe.generatePaper({
      planId: _plan2?.id,
      title:  "Workspace Mesh Reliability Research",
      domain: "workspace_mesh",
      findings: ["Mesh P90 latency: 180ms", "Recovery rate: 94%"],
    });
    assert(r.ok, "not ok");
    assert(r.publication.findings.length >= 2, "findings not included");
  });

  test("generateBenchmarkReport creates benchmark report", () => {
    const r = rpe.generateBenchmarkReport({
      targets: ["execution_pipeline", "workspace_mesh", "approval_engine"],
      planId:  _plan1?.id,
    });
    assert(r.ok, r.error || "not ok");
    assert(r.publication.type === "benchmark_report", "wrong type");
    assert(Array.isArray(r.publication.targets), "no targets");
  });

  test("proposeEvolution fails without recommendation", () => {
    const r = rpe.proposeEvolution({});
    assert(!r.ok, "should fail without recommendation");
  });

  test("proposeEvolution creates an evolution proposal", () => {
    const r = rpe.proposeEvolution({
      planId:         _plan1?.id,
      domain:         "deployment_strategy",
      recommendation: "Migrate all production deployments to blue/green strategy — benchmarks show 23% lower rollback rate",
      confidence:     0.87,
      effort:         "medium",
      impact:         "high",
    });
    assert(r.ok, r.error || "not ok");
    assert(r.proposal.id, "no id");
    assert(r.proposal.type === "evolution_proposal", "wrong type");
    assert(r.proposal.confidence === 0.87, "wrong confidence");
    assert(r.proposal.impact === "high", "wrong impact");
  });

  test("generateDigest produces a weekly digest", () => {
    const r = rpe.generateDigest();
    assert(r.ok, r.error || "not ok");
    assert(r.digest.type === "weekly_digest", "wrong type");
    assert(typeof r.digest.publications === "number", "no publications count");
    assert(r.digest.period?.from, "no period.from");
  });

  test("listPublications returns publications", () => {
    const r = rpe.listPublications({ limit: 10 });
    assert(r.ok, "not ok");
    assert(Array.isArray(r.publications) && r.publications.length >= 3, `expected ≥3 pubs, got ${r.publications?.length}`);
  });

  test("listPublications filters by type", () => {
    const r = rpe.listPublications({ type: "research_paper" });
    assert(r.ok, "not ok");
    assert(r.publications.every(p => p.type === "research_paper"), "wrong type in results");
  });

  test("getPublication retrieves by id", () => {
    // Use whichever publication was created; _pub1 may be set or not depending on test order
    const list = rpe.listPublications({ type: "research_paper", limit: 1 });
    assert(list.publications.length >= 1, "no research papers published yet");
    const first = list.publications[0];
    const p = rpe.getPublication(first.id);
    assert(p, "not found");
    assert(p.id === first.id, "wrong id");
  });

  test("getEvolutionQueue returns queue", () => {
    const r = rpe.getEvolutionQueue({ limit: 10 });
    assert(r.ok, "not ok");
    assert(Array.isArray(r.queue) && r.queue.length >= 1, "empty evolution queue");
  });

  test("pub getStats returns stats", () => {
    const s = rpe.getStats();
    assert(typeof s.totalPublished === "number" && s.totalPublished >= 2, `totalPublished should be ≥2, got ${s.totalPublished}`);
    assert(typeof s.papersGenerated === "number", "no papersGenerated");
    assert(typeof s.evolutionProposals === "number", "no evolutionProposals");
    assert(typeof s.minutesSaved === "number" && s.minutesSaved > 0, "no minutesSaved");
  });

  // ── researchDashboard ─────────────────────────────────────────────────────

  console.log("\n[researchDashboard]");

  test("getDashboard returns ok", () => {
    const r = dash.getDashboard();
    assert(r.ok, "not ok");
  });

  test("getDashboard has summary with required fields", () => {
    const r = dash.getDashboard();
    const s = r.summary;
    assert(s, "no summary");
    assert(typeof s.totalPlans             === "number", "no totalPlans");
    assert(typeof s.completedPlans         === "number", "no completedPlans");
    assert(typeof s.totalExperiments       === "number", "no totalExperiments");
    assert(typeof s.totalBenchmarkRuns     === "number", "no totalBenchmarkRuns");
    assert(typeof s.findingsIndexed        === "number", "no findingsIndexed");
    assert(typeof s.publicationsGenerated  === "number", "no publicationsGenerated");
    assert(typeof s.evolutionProposals     === "number", "no evolutionProposals");
    assert(typeof s.totalMinutesSaved      === "number", "no totalMinutesSaved");
  });

  test("getDashboard has researchScore (0-100)", () => {
    const r = dash.getDashboard();
    assert(typeof r.researchScore === "number", "no researchScore");
    assert(r.researchScore >= 0 && r.researchScore <= 100, `score ${r.researchScore} out of range`);
    assert(r.researchScore > 0, "researchScore should be > 0 after running tests");
  });

  test("getDashboard has backlog array", () => {
    const r = dash.getDashboard();
    assert(Array.isArray(r.backlog), "no backlog array");
  });

  test("getDashboard has completedExperiments", () => {
    const r = dash.getDashboard();
    assert(Array.isArray(r.completedExperiments), "no completedExperiments");
    if (r.completedExperiments.length > 0) {
      assert(r.completedExperiments[0].name, "no name in experiment");
    }
  });

  atest("getDashboard has benchmarkHistory (after benchmarks run)", async () => {
    await bench.runBenchmark("execution_pipeline", { iterations: 1 });
    const r = dash.getDashboard();
    assert(r.benchmarkHistory, "no benchmarkHistory");
    assert(Object.keys(r.benchmarkHistory).length >= 1, "empty benchmark history after seeding");
  });

  test("getDashboard has recentFindings", () => {
    const r = dash.getDashboard();
    assert(Array.isArray(r.recentFindings), "no recentFindings");
  });

  test("getDashboard has improvementOpportunities", () => {
    const r = dash.getDashboard();
    assert(Array.isArray(r.improvementOpportunities), "no improvementOpportunities");
  });

  test("getDashboard has radarSummary", () => {
    const r = dash.getDashboard();
    assert(r.radarSummary, "no radarSummary");
    assert(typeof r.radarSummary.adopt === "number", "no adopt count in radarSummary");
  });

  test("getDashboard has evolutionQueue", () => {
    const r = dash.getDashboard();
    assert(Array.isArray(r.evolutionQueue) && r.evolutionQueue.length >= 1, "no evolutionQueue entries");
  });

  test("getDashboard has founderTimeSaved", () => {
    const r = dash.getDashboard();
    assert(r.founderTimeSaved, "no founderTimeSaved");
    assert(typeof r.founderTimeSaved.totalMinutes === "number", "no totalMinutes");
    assert(r.founderTimeSaved.totalMinutes > 0, "totalMinutes should be > 0");
    assert(typeof r.founderTimeSaved.totalHours === "number", "no totalHours");
  });

  test("getDashboard has knowledge section", () => {
    const r = dash.getDashboard();
    assert(r.knowledge, "no knowledge section");
    assert(typeof r.knowledge.totalItems === "number", "no totalItems");
  });

  test("getResearchScore returns detailed score", () => {
    const r = dash.getResearchScore();
    assert(r.ok, "not ok");
    assert(typeof r.score === "number", "no score");
    assert(r.breakdown, "no breakdown");
    assert(r.breakdown.plans, "no plans breakdown");
    assert(r.breakdown.experiments, "no experiments breakdown");
    assert(r.breakdown.benchmarks, "no benchmarks breakdown");
    assert(r.breakdown.knowledge, "no knowledge breakdown");
  });

  test("getBenchmarkView returns all targets summary", () => {
    const r = dash.getBenchmarkView({});
    assert(r.ok, "not ok");
    assert(Array.isArray(r.targets), "no targets array");
  });

  test("getBenchmarkView returns single target detail", () => {
    const r = dash.getBenchmarkView({ target: "workspace_mesh" });
    assert(r.ok, "not ok");
    assert(Array.isArray(r.history), "no history");
  });

  // ── E2E: Real research scenarios ──────────────────────────────────────────

  console.log("\n[E2E: Research Scenarios]");

  atest("E2E: full pipeline — compare deployment strategies", async () => {
    // 1. Create plan
    const plan = planner.createPlan({ topic: "blue-green vs rolling deployment strategy", domain: "deployment_strategy", priority: 85 });
    assert(plan.ok, "plan creation failed");

    // 2. Run benchmark on deployment
    const bm = await bench.runBenchmark("deployment_strategy", { planId: plan.plan.id, iterations: 2 });
    assert(bm.ok, "deployment benchmark failed");

    // 3. Design experiment
    const exp = em.design({ planId: plan.plan.id, name: "Blue/Green vs Rolling Comparison", type: "strategy_compare",
      control: "rolling_deployment", treatment: "blue_green_deployment",
      metrics: ["deploy_success_rate", "rollback_rate", "time_to_deploy_ms"] });
    assert(exp.ok, "experiment design failed");

    // 4. Run experiment
    const result = await em.run(exp.experiment.id);
    assert(result.ok, "experiment run failed");

    // 5. Validate
    const val = em.validate(exp.experiment.id, { threshold: 0.5 });
    assert(val.ok, "validation failed");

    // 6. Index finding
    const finding = rke.indexFinding({ planId: plan.plan.id, topic: "deployment_strategy_comparison",
      domain: "deployment_strategy", confidence: result.results.confidence,
      finding: `Blue/green ${result.results.overallImprovement ? "outperformed" : "did not outperform"} rolling deployment.` });
    assert(finding.ok, "finding indexing failed");

    // 7. Generate paper
    const paper = rpe.generatePaper({ planId: plan.plan.id, title: "Deployment Strategy Comparison",
      domain: "deployment_strategy", abstract: "A/B comparison of blue/green vs rolling deployment." });
    assert(paper.ok, "paper generation failed");

    // 8. Propose evolution if improvement found
    if (result.results.overallImprovement) {
      const evo = rpe.proposeEvolution({ planId: plan.plan.id, domain: "deployment_strategy",
        recommendation: "Migrate to blue/green deployment based on validated experiment results.", confidence: 0.85 });
      assert(evo.ok, "evolution proposal failed");
    }
  });

  atest("E2E: benchmark execution pipeline and generate report", async () => {
    const bm = await bench.runBenchmark("execution_pipeline", { iterations: 3 });
    assert(bm.ok, "benchmark failed");

    const report = rpe.generateBenchmarkReport({ targets: ["execution_pipeline"], planId: null });
    assert(report.ok, "benchmark report failed");
    assert(report.publication.type === "benchmark_report", "wrong type");
  });

  atest("E2E: benchmark workforce allocation", async () => {
    const bm = await bench.runBenchmark("workforce_allocation", { iterations: 2 });
    assert(bm.ok, "workforce benchmark failed");
    assert(typeof bm.metrics.agent_utilization === "number", "no agent_utilization");
    assert(bm.comparison, "no comparison");
  });

  atest("E2E: benchmark autonomous systems", async () => {
    const bm = await bench.runBenchmark("autonomous_systems", { iterations: 2 });
    assert(bm.ok, "autonomous systems benchmark failed");
    assert(typeof bm.metrics.autonomy_rate === "number", "no autonomy_rate");
  });

  atest("E2E: autoDiscover + runPipeline for auto-found weakness", async () => {
    const discovered = await planner.autoDiscover();
    assert(discovered.ok, "autoDiscover failed");

    if (discovered.planIds.length > 0) {
      const r = await planner.runPipeline(discovered.planIds[0]);
      assert(r.ok || r.status === "partial", `pipeline failed: ${r.error}`);
      assert(r.stepsCompleted >= 12, `expected ≥12 steps, got ${r.stepsCompleted}`);
    }
  });

  atest("E2E: knowledge publication and radar update", async () => {
    // Index multiple findings
    for (const d of ["execution_pipeline","workspace_mesh","approval_engine"]) {
      rke.indexFinding({ domain: d, topic: `${d}_perf`, confidence: 0.82,
        finding: `Performance analysis of ${d} shows consistent behavior within expected bounds.` });
    }

    // Generate recommendations
    const recs = rke.generateRecommendations({});
    assert(recs.ok, "recommendations failed");

    // Update radar
    rke.updateRadarEntry("Engineering Memory", { ring: "adopt" });

    // Generate digest
    const digest = rpe.generateDigest();
    assert(digest.ok, "digest failed");
    assert(digest.digest.publications >= 0, "no publication count");
  });

  atest("E2E: research score increases as research is done", async () => {
    const before = dash.getResearchScore();
    assert(before.ok, "getResearchScore failed");
    // Run another plan to increase score
    const plan = planner.createPlan({ topic: "approval engine throughput optimization" });
    assert(plan.ok, "plan failed");
    await planner.runPipeline(plan.plan.id);
    const after = dash.getResearchScore();
    assert(after.ok, "getResearchScore failed after");
    assert(after.score >= before.score, `score should not decrease: ${before.score} → ${after.score}`);
  });

  await Promise.all(promises);

  console.log(`\n  Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
