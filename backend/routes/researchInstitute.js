"use strict";
/**
 * routes/researchInstitute.js — POST-Ω Sprint P10 Autonomous Research Institute
 * Routes at /research/*
 */

const router = require("express").Router();

const planner  = require("../services/researchPlanner.cjs");
const knowledge= require("../services/researchKnowledgeEngine.cjs");
const bench    = require("../services/benchmarkEngine.cjs");
const exp      = require("../services/experimentManager.cjs");
const pub      = require("../services/researchPublicationEngine.cjs");
const dash     = require("../services/researchDashboard.cjs");

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get( "/research/dashboard",              (req, res) => res.json(dash.getDashboard()));
router.get( "/research/score",                  (req, res) => res.json(dash.getResearchScore()));
router.get( "/research/benchmarks/view",        (req, res) => res.json(dash.getBenchmarkView(req.query)));

// ── Research Planner ──────────────────────────────────────────────────────────
router.post("/research/plans",                  (req, res) => res.json(planner.createPlan(req.body || {})));
router.get( "/research/plans",                  (req, res) => res.json(planner.listPlans(req.query)));
router.get( "/research/plans/backlog",          (req, res) => res.json(planner.getBacklog(req.query)));
router.get( "/research/plans/stats",            (req, res) => res.json(planner.getStats()));
router.get( "/research/plans/:id",              (req, res) => {
  const p = planner.getPlan(req.params.id);
  res.json(p ? { ok: true, plan: p } : { ok: false, error: "not found" });
});
router.post("/research/plans/:id/run",          async (req, res) => res.json(await planner.runPipeline(req.params.id)));
router.post("/research/observe",                (req, res) => res.json(planner.observe()));
router.post("/research/discover",               async (req, res) => res.json(await planner.autoDiscover()));
router.get( "/research/domains",                (req, res) => res.json({ ok: true, domains: planner.RESEARCH_DOMAINS }));
router.get( "/research/pipeline/steps",         (req, res) => res.json({ ok: true, steps: planner.PIPELINE_STEPS }));

// ── Research Knowledge Engine ─────────────────────────────────────────────────
router.post("/research/knowledge/findings",     (req, res) => res.json(knowledge.indexFinding(req.body || {})));
router.get( "/research/knowledge/findings",     (req, res) => res.json(knowledge.getFindings(req.query)));
router.post("/research/knowledge/recommendations", (req, res) => res.json(knowledge.generateRecommendations(req.body || {})));
router.get( "/research/knowledge/recommendations", (req, res) => res.json(knowledge.getRecommendations(req.query)));
router.get( "/research/knowledge/radar",        (req, res) => res.json(knowledge.getRadar(req.query)));
router.post("/research/knowledge/radar",        (req, res) => res.json(knowledge.addRadarEntry(req.body || {})));
router.patch("/research/knowledge/radar/:name", (req, res) => res.json(knowledge.updateRadarEntry(req.params.name, req.body || {})));
router.post("/research/knowledge/publish",      (req, res) => res.json(knowledge.publishKnowledge(req.body || {})));
router.post("/research/knowledge/compare",      (req, res) => res.json(knowledge.compareArchitectures(req.body?.options || [])));
router.get( "/research/knowledge/stats",        (req, res) => res.json(knowledge.getStats()));

// ── Benchmark Engine ──────────────────────────────────────────────────────────
router.post("/research/benchmarks/run",         async (req, res) => {
  const { target, planId, iterations, config } = req.body || {};
  res.json(await bench.runBenchmark(target, { planId, iterations, config }));
});
router.post("/research/benchmarks/run-all",     async (req, res) => res.json(await bench.runAll(req.body || {})));
router.get( "/research/benchmarks",             (req, res) => res.json(bench.listRuns(req.query)));
router.get( "/research/benchmarks/stats",       (req, res) => res.json(bench.getStats()));
router.get( "/research/benchmarks/targets",     (req, res) => res.json({ ok: true, targets: bench.BENCHMARK_TARGETS }));
router.get( "/research/benchmarks/baseline",    (req, res) => res.json({ ok: true, baseline: bench.getBaseline() }));
router.get( "/research/benchmarks/:id",         (req, res) => {
  const r = bench.getRun(req.params.id);
  res.json(r ? { ok: true, run: r } : { ok: false, error: "not found" });
});
router.get( "/research/benchmarks/target/:t/history", (req, res) => res.json(bench.getHistory(req.params.t, +(req.query.limit || 20))));
router.get( "/research/benchmarks/target/:t/trend",   (req, res) => res.json(bench.getTrend(req.params.t, req.query)));
router.post("/research/benchmarks/compare",     (req, res) => res.json(bench.compareStrategies(req.body?.strategies || [])));

// ── Experiment Manager ────────────────────────────────────────────────────────
router.post("/research/experiments",            (req, res) => res.json(exp.design(req.body || {})));
router.get( "/research/experiments",            (req, res) => res.json(exp.listExperiments(req.query)));
router.get( "/research/experiments/stats",      (req, res) => res.json(exp.getStats()));
router.get( "/research/experiments/types",      (req, res) => res.json({ ok: true, types: exp.EXPERIMENT_TYPES }));
router.get( "/research/experiments/:id",        (req, res) => {
  const e = exp.getExperiment(req.params.id);
  res.json(e ? { ok: true, experiment: e } : { ok: false, error: "not found" });
});
router.post("/research/experiments/:id/run",    async (req, res) => res.json(await exp.run(req.params.id)));
router.post("/research/experiments/:id/validate", (req, res) => res.json(exp.validate(req.params.id, req.body || {})));
router.post("/research/experiments/:id/replay", async (req, res) => res.json(await exp.replay(req.params.id)));

// ── Publication Engine ────────────────────────────────────────────────────────
router.post("/research/publications/paper",     (req, res) => res.json(pub.generatePaper(req.body || {})));
router.post("/research/publications/benchmark-report", (req, res) => res.json(pub.generateBenchmarkReport(req.body || {})));
router.post("/research/publications/evolution", (req, res) => res.json(pub.proposeEvolution(req.body || {})));
router.post("/research/publications/digest",    (req, res) => res.json(pub.generateDigest()));
router.get( "/research/publications",           (req, res) => res.json(pub.listPublications(req.query)));
router.get( "/research/publications/stats",     (req, res) => res.json(pub.getStats()));
router.get( "/research/publications/evolution-queue", (req, res) => res.json(pub.getEvolutionQueue(req.query)));
router.get( "/research/publications/:id",       (req, res) => {
  const p = pub.getPublication(req.params.id);
  res.json(p ? { ok: true, publication: p } : { ok: false, error: "not found" });
});

module.exports = router;
