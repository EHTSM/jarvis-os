"use strict";
/**
 * ODI X V1 — Visual Intelligence Evolution routes
 * All new endpoints mount at /odi/x/*
 *
 * Services:
 *   visualReasoningEngine    /odi/x/reasoning/*
 *   designQualityEngine      /odi/x/quality/*
 *   designBenchmarkEngine    /odi/x/benchmark/*
 *   designPredictionEngine   /odi/x/predict/*
 *   designEvolutionEngine    /odi/x/evolution/*
 *   designIntelligenceDashboard /odi/x/dashboard/*
 */

const router = require("express").Router();

const _try = fn => { try { return fn(); } catch { return null; } };
const vr  = () => require("../services/visualReasoningEngine.cjs");
const dqe = () => require("../services/designQualityEngine.cjs");
const dbe = () => require("../services/designBenchmarkEngine.cjs");
const dpe = () => require("../services/designPredictionEngine.cjs");
const dee = () => require("../services/designEvolutionEngine.cjs");
const did = () => require("../services/designIntelligenceDashboard.cjs");

// ── Visual Reasoning Engine ───────────────────────────────────────────────────

router.post("/odi/x/reasoning/analyze", async (req, res) => {
  try {
    const { pageUrl, screenshotPath, domData, layoutData, componentData, accessData } = req.body;
    const result = await vr().analyze(pageUrl, { screenshotPath, domData, layoutData, componentData, accessData });
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/reasoning/analyses", (req, res) => {
  try {
    const limit = req.query.limit ? +req.query.limit : 50;
    res.json(vr().listAnalyses({ limit }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/reasoning/analyses/:id", (req, res) => {
  try {
    const a = vr().getAnalysis(req.params.id);
    if (!a) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, analysis: a });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/reasoning/stats", (req, res) => {
  try { res.json({ ok: true, stats: vr().getStats() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Design Quality Engine ─────────────────────────────────────────────────────

router.post("/odi/x/quality/score", async (req, res) => {
  try {
    const { pageUrl, domData, layoutData, componentData, accessData, tokenData, responsiveData } = req.body;
    const result = await dqe().score(pageUrl, { domData, layoutData, componentData, accessData, tokenData, responsiveData });
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/quality/scores", (req, res) => {
  try {
    const limit   = req.query.limit ? +req.query.limit : 50;
    const pageUrl = req.query.pageUrl || null;
    res.json(dqe().listScores({ pageUrl, limit }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/quality/scores/:id", (req, res) => {
  try {
    const s = dqe().getScore(req.params.id);
    if (!s) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, score: s });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/quality/history", (req, res) => {
  try {
    const pageUrl = req.query.pageUrl || null;
    const limit   = req.query.limit ? +req.query.limit : 20;
    res.json(dqe().getHistory(pageUrl, limit));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/quality/trend", (req, res) => {
  try {
    const { pageUrl, dimension } = req.query;
    res.json(dqe().getTrend(pageUrl, dimension));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/quality/stats", (req, res) => {
  try { res.json({ ok: true, stats: dqe().getStats() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Design Benchmark Engine ───────────────────────────────────────────────────

router.post("/odi/x/benchmark/compare-versions", async (req, res) => {
  try {
    const { pageUrl, currentScore, previousScore } = req.body;
    const result = await dbe().compareVersions(pageUrl, { currentScore, previousScore });
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post("/odi/x/benchmark/compare-baseline", async (req, res) => {
  try {
    const { pageUrl, currentScore } = req.body;
    const result = await dbe().compareToBaseline(pageUrl, { currentScore });
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post("/odi/x/benchmark/patch-result", (req, res) => {
  try {
    const { patchId, pageUrl, beforeScore, afterScore, applied } = req.body;
    res.json(dbe().recordPatchResult({ patchId, pageUrl, beforeScore, afterScore, applied }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/benchmark/patch-success-rate", (req, res) => {
  try { res.json(dbe().getPatchSuccessRate()); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/benchmark/detect-regression", async (req, res) => {
  try {
    const result = await dbe().detectRegression(req.query.pageUrl);
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/benchmark/list", (req, res) => {
  try {
    const { pageUrl, type, limit } = req.query;
    res.json(dbe().listBenchmarks({ pageUrl, type, limit: limit ? +limit : 50 }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/benchmark/:id", (req, res) => {
  try {
    const b = dbe().getBenchmark(req.params.id);
    if (!b) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, benchmark: b });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/benchmark/baseline/get", (req, res) => {
  try { res.json({ ok: true, baseline: dbe().getBaseline() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put("/odi/x/benchmark/baseline", (req, res) => {
  try { res.json(dbe().setBaseline(req.body)); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/benchmark/stats/summary", (req, res) => {
  try { res.json({ ok: true, stats: dbe().getStats() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Design Prediction Engine ──────────────────────────────────────────────────

router.post("/odi/x/predict", async (req, res) => {
  try {
    const { pageUrl, qualityScore, reasoningAnalysis, accessData, responsiveData } = req.body;
    const result = await dpe().predict(pageUrl, { qualityScore, reasoningAnalysis, accessData, responsiveData });
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/predict/list", (req, res) => {
  try {
    const { pageUrl, limit } = req.query;
    res.json(dpe().listPredictions({ pageUrl, limit: limit ? +limit : 50 }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/predict/:id", (req, res) => {
  try {
    const p = dpe().getPrediction(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, prediction: p });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/predict/stats/summary", (req, res) => {
  try { res.json({ ok: true, stats: dpe().getStats() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Design Evolution Engine ───────────────────────────────────────────────────

router.post("/odi/x/evolution/run", async (req, res) => {
  try {
    const { pageUrl, skipApply } = req.body;
    const result = await dee().runEvolutionCycle(pageUrl, { skipApply });
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/evolution/debt", (req, res) => {
  try {
    const result = dee().getDebtReport(req.query.pageUrl);
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/evolution/trend", (req, res) => {
  try {
    const { pageUrl, limit } = req.query;
    res.json(dee().getQualityTrend(pageUrl, { limit: limit ? +limit : 20 }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/evolution/status", (req, res) => {
  try { res.json(dee().getEvolutionStatus()); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/evolution/cycles", (req, res) => {
  try {
    const { pageUrl, limit } = req.query;
    res.json(dee().listCycles({ pageUrl, limit: limit ? +limit : 50 }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/evolution/cycles/:id", (req, res) => {
  try {
    const c = dee().getCycle(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, cycle: c });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/evolution/stats", (req, res) => {
  try { res.json({ ok: true, stats: dee().getStats() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Design Intelligence Dashboard ─────────────────────────────────────────────

router.get("/odi/x/dashboard", (req, res) => {
  try { res.json(did().getDashboard()); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/dashboard/page", (req, res) => {
  try {
    const result = did().getPageView(req.query.pageUrl);
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/odi/x/dashboard/health", (req, res) => {
  try { res.json(did().getODIHealth()); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
