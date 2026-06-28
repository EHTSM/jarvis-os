"use strict";
/**
 * OAI X V1 — Engineering Intelligence Evolution routes
 * All endpoints mount at /engineering/x/*
 *
 * Services:
 *   engineeringReasoningEngine     /engineering/x/reasoning/*
 *   engineeringQualityEngine       /engineering/x/quality/*
 *   engineeringBenchmarkEngine     /engineering/x/benchmark/*
 *   engineeringPredictionEngine    /engineering/x/predict/*
 *   engineeringEvolutionEngine     /engineering/x/evolution/*
 *   engineeringIntelligenceDashboard /engineering/x/dashboard/*
 */

const router = require("express").Router();

const ere = () => require("../services/engineeringReasoningEngine.cjs");
const eqe = () => require("../services/engineeringQualityEngine.cjs");
const ebe = () => require("../services/engineeringBenchmarkEngine.cjs");
const epe = () => require("../services/engineeringPredictionEngine.cjs");
const dee = () => require("../services/engineeringEvolutionEngine.cjs");
const eid = () => require("../services/engineeringIntelligenceDashboard.cjs");

// ── Engineering Reasoning Engine ──────────────────────────────────────────────

router.post("/engineering/x/reasoning/analyze", async (req, res) => {
  try {
    const { context, repoData, smellData, skipScan } = req.body;
    const result = await ere().analyze(context, { repoData, smellData, skipScan });
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/reasoning/analyses", (req, res) => {
  try {
    const limit = req.query.limit ? +req.query.limit : 50;
    res.json(ere().listAnalyses({ limit }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/reasoning/analyses/:id", (req, res) => {
  try {
    const a = ere().getAnalysis(req.params.id);
    if (!a) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, analysis: a });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/reasoning/stats", (req, res) => {
  try { res.json({ ok: true, stats: ere().getStats() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Engineering Quality Engine ────────────────────────────────────────────────

router.post("/engineering/x/quality/score", async (req, res) => {
  try {
    const { context, reasoningAnalysis, repoData, smellData } = req.body;
    const result = await eqe().score(context, { reasoningAnalysis, repoData, smellData });
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/quality/scores", (req, res) => {
  try {
    const { context, limit } = req.query;
    res.json(eqe().listScores({ context, limit: limit ? +limit : 50 }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/quality/scores/:id", (req, res) => {
  try {
    const s = eqe().getScore(req.params.id);
    if (!s) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, score: s });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/quality/history", (req, res) => {
  try {
    const { context, limit } = req.query;
    res.json(eqe().getHistory(context, limit ? +limit : 20));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/quality/trend", (req, res) => {
  try {
    const { context, dimension } = req.query;
    res.json(eqe().getTrend(context, dimension));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/quality/stats", (req, res) => {
  try { res.json({ ok: true, stats: eqe().getStats() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Engineering Benchmark Engine ──────────────────────────────────────────────

router.post("/engineering/x/benchmark/compare-versions", async (req, res) => {
  try {
    const { context, currentScore, previousScore } = req.body;
    const result = await ebe().compareVersions(context, { currentScore, previousScore });
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post("/engineering/x/benchmark/compare-baseline", async (req, res) => {
  try {
    const { context, currentScore } = req.body;
    const result = await ebe().compareToBaseline(context, { currentScore });
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post("/engineering/x/benchmark/run-suite", async (req, res) => {
  try {
    const { scenario } = req.body;
    const result = await ebe().runEngineeringBenchmark({ scenario });
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post("/engineering/x/benchmark/fix-result", (req, res) => {
  try {
    const { fixId, context, beforeScore, afterScore, applied } = req.body;
    res.json(ebe().recordFixResult({ fixId, context, beforeScore, afterScore, applied }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/benchmark/fix-success-rate", (req, res) => {
  try { res.json(ebe().getFixSuccessRate()); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/benchmark/detect-regression", (req, res) => {
  try {
    const result = ebe().detectRegression(req.query.context);
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/benchmark/list", (req, res) => {
  try {
    const { context, type, limit } = req.query;
    res.json(ebe().listBenchmarks({ context, type, limit: limit ? +limit : 50 }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/benchmark/:id", (req, res) => {
  try {
    const b = ebe().getBenchmark(req.params.id);
    if (!b) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, benchmark: b });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/benchmark/baseline/get", (req, res) => {
  try { res.json({ ok: true, baseline: ebe().getBaseline() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put("/engineering/x/benchmark/baseline", (req, res) => {
  try { res.json(ebe().setBaseline(req.body)); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/benchmark/stats/summary", (req, res) => {
  try { res.json({ ok: true, stats: ebe().getStats() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Engineering Prediction Engine ─────────────────────────────────────────────

router.post("/engineering/x/predict", async (req, res) => {
  try {
    const { context, qualityScore, reasoningAnalysis } = req.body;
    const result = await epe().predict(context, { qualityScore, reasoningAnalysis });
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/predict/list", (req, res) => {
  try {
    const { context, limit } = req.query;
    res.json(epe().listPredictions({ context, limit: limit ? +limit : 50 }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/predict/:id", (req, res) => {
  try {
    const p = epe().getPrediction(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, prediction: p });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/predict/stats/summary", (req, res) => {
  try { res.json({ ok: true, stats: epe().getStats() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Engineering Evolution Engine ──────────────────────────────────────────────

router.post("/engineering/x/evolution/run", async (req, res) => {
  try {
    const { context, skipExecute } = req.body;
    const result = await dee().runEvolutionCycle(context, { skipExecute });
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/evolution/debt", (req, res) => {
  try { res.json(dee().getDebtReport(req.query.context)); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/evolution/trend", (req, res) => {
  try {
    const { context, limit } = req.query;
    res.json(dee().getQualityTrend(context, { limit: limit ? +limit : 20 }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/evolution/status", (req, res) => {
  try { res.json(dee().getEvolutionStatus()); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/evolution/cycles", (req, res) => {
  try {
    const { context, limit } = req.query;
    res.json(dee().listCycles({ context, limit: limit ? +limit : 50 }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/evolution/cycles/:id", (req, res) => {
  try {
    const c = dee().getCycle(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, cycle: c });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/evolution/stats", (req, res) => {
  try { res.json({ ok: true, stats: dee().getStats() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Engineering Intelligence Dashboard ───────────────────────────────────────

router.get("/engineering/x/dashboard", (req, res) => {
  try { res.json(eid().getDashboard()); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/dashboard/context", (req, res) => {
  try {
    const result = eid().getContextView(req.query.context);
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/engineering/x/dashboard/health", (req, res) => {
  try { res.json(eid().getEngineeringHealth()); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
