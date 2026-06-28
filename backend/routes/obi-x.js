"use strict";
/**
 * OBI X V1 — Autonomous Business Intelligence Evolution
 * Routes: /business/x/*
 *
 * Sections:
 *   reasoning  — /business/x/reasoning/*
 *   quality    — /business/x/quality/*
 *   benchmark  — /business/x/benchmark/*
 *   predict    — /business/x/predict/*
 *   evolution  — /business/x/evolution/*
 *   dashboard  — /business/x/dashboard/*
 */

const router = require("express").Router();
const _try   = fn => { try { return fn(); } catch { return null; } };
const _bre   = () => _try(() => require("../services/businessReasoningEngine.cjs"));
const _bqe   = () => _try(() => require("../services/businessQualityEngine.cjs"));
const _bbe   = () => _try(() => require("../services/businessBenchmarkEngine.cjs"));
const _bpe   = () => _try(() => require("../services/businessPredictionEngine.cjs"));
const _bee   = () => _try(() => require("../services/businessEvolutionEngine.cjs"));
const _bid   = () => _try(() => require("../services/businessIntelligenceDashboard.cjs"));

function ok(res, data)     { res.json({ ok: true, ...data }); }
function err(res, msg, code = 400) { res.status(code).json({ ok: false, error: msg }); }
function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { err(res, e.message, 500); }
  };
}

// ── Reasoning ─────────────────────────────────────────────────────────────────

router.post("/business/x/reasoning/analyze", wrap(async (req, res) => {
  const { context, revenueData, dealsData, campaignData } = req.body;
  const r = await _bre()?.analyze?.(context, { revenueData, dealsData, campaignData });
  if (!r?.ok) return err(res, r?.error || "analyze failed");
  ok(res, { analysis: r.analysis });
}));

router.get("/business/x/reasoning/:id", wrap(async (req, res) => {
  const a = _bre()?.getAnalysis?.(req.params.id);
  if (!a) return err(res, "analysis not found", 404);
  ok(res, { analysis: a });
}));

router.get("/business/x/reasoning", wrap(async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const r = _bre()?.listAnalyses?.({ limit });
  ok(res, r);
}));

router.get("/business/x/reasoning/stats", wrap(async (req, res) => {
  ok(res, _bre()?.getStats?.() || {});
}));

// ── Quality ───────────────────────────────────────────────────────────────────

router.post("/business/x/quality/score", wrap(async (req, res) => {
  const { context, reasoningAnalysis, rawData } = req.body;
  const r = await _bqe()?.score?.(context, { reasoningAnalysis, rawData });
  if (!r?.ok) return err(res, r?.error || "score failed");
  ok(res, { score: r.score });
}));

router.get("/business/x/quality/:id", wrap(async (req, res) => {
  const s = _bqe()?.getScore?.(req.params.id);
  if (!s) return err(res, "score not found", 404);
  ok(res, { score: s });
}));

router.get("/business/x/quality", wrap(async (req, res) => {
  const { context, limit } = req.query;
  const r = _bqe()?.listScores?.({ context, limit: parseInt(limit) || 50 });
  ok(res, r);
}));

router.get("/business/x/quality/history/:context", wrap(async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const r = _bqe()?.getHistory?.(req.params.context, limit);
  ok(res, r);
}));

router.get("/business/x/quality/trend/:context", wrap(async (req, res) => {
  const r = _bqe()?.getTrend?.(req.params.context, req.query.dimension);
  ok(res, r);
}));

router.get("/business/x/quality/stats", wrap(async (req, res) => {
  ok(res, _bqe()?.getStats?.() || {});
}));

// ── Benchmark ─────────────────────────────────────────────────────────────────

router.get("/business/x/benchmark/baseline", wrap(async (req, res) => {
  ok(res, { baseline: _bbe()?.getBaseline?.(), BUSINESS_BASELINE: _bbe()?.BUSINESS_BASELINE });
}));

router.post("/business/x/benchmark/baseline", wrap(async (req, res) => {
  const r = _bbe()?.setBaseline?.(req.body);
  ok(res, r);
}));

router.post("/business/x/benchmark/compare-versions", wrap(async (req, res) => {
  const { context, currentScore, previousScore } = req.body;
  const r = await _bbe()?.compareVersions?.(context, { currentScore, previousScore });
  if (!r?.ok) return err(res, r?.error || "compare failed");
  ok(res, { benchmark: r.benchmark });
}));

router.post("/business/x/benchmark/compare-baseline", wrap(async (req, res) => {
  const { context, currentScore } = req.body;
  const r = await _bbe()?.compareToBaseline?.(context, { currentScore });
  if (!r?.ok) return err(res, r?.error || "compare failed");
  ok(res, { benchmark: r.benchmark });
}));

router.post("/business/x/benchmark/compare-quarter", wrap(async (req, res) => {
  const { context, quarter } = req.body;
  const r = await _bbe()?.compareQuarter?.(context, { quarter });
  ok(res, { benchmark: r?.benchmark });
}));

router.post("/business/x/benchmark/improvement-result", wrap(async (req, res) => {
  const r = _bbe()?.recordImprovementResult?.(req.body);
  ok(res, r);
}));

router.get("/business/x/benchmark/improvement-rate", wrap(async (req, res) => {
  ok(res, _bbe()?.getImprovementSuccessRate?.() || {});
}));

router.post("/business/x/benchmark/detect-regression", wrap(async (req, res) => {
  const r = _bbe()?.detectRegression?.(req.body.context);
  ok(res, r);
}));

router.get("/business/x/benchmark/:id", wrap(async (req, res) => {
  const b = _bbe()?.getBenchmark?.(req.params.id);
  if (!b) return err(res, "benchmark not found", 404);
  ok(res, { benchmark: b });
}));

router.get("/business/x/benchmark", wrap(async (req, res) => {
  const { context, type, limit } = req.query;
  const r = _bbe()?.listBenchmarks?.({ context, type, limit: parseInt(limit) || 50 });
  ok(res, r);
}));

router.get("/business/x/benchmark/stats", wrap(async (req, res) => {
  ok(res, _bbe()?.getStats?.() || {});
}));

// ── Predict ───────────────────────────────────────────────────────────────────

router.post("/business/x/predict", wrap(async (req, res) => {
  const { context, qualityScore, reasoningAnalysis } = req.body;
  const r = await _bpe()?.predict?.(context, { qualityScore, reasoningAnalysis });
  if (!r?.ok) return err(res, r?.error || "predict failed");
  ok(res, { prediction: r.prediction });
}));

router.get("/business/x/predict/:id", wrap(async (req, res) => {
  const p = _bpe()?.getPrediction?.(req.params.id);
  if (!p) return err(res, "prediction not found", 404);
  ok(res, { prediction: p });
}));

router.get("/business/x/predict", wrap(async (req, res) => {
  const { context, limit } = req.query;
  const r = _bpe()?.listPredictions?.({ context, limit: parseInt(limit) || 50 });
  ok(res, r);
}));

router.get("/business/x/predict/stats", wrap(async (req, res) => {
  ok(res, _bpe()?.getStats?.() || {});
}));

// ── Evolution ─────────────────────────────────────────────────────────────────

router.post("/business/x/evolution/run", wrap(async (req, res) => {
  const { context, skipExecute } = req.body;
  const r = await _bee()?.runEvolutionCycle?.(context, { skipExecute });
  if (!r?.ok) return err(res, r?.error || "evolution cycle failed");
  ok(res, r);
}));

router.get("/business/x/evolution/status", wrap(async (req, res) => {
  ok(res, _bee()?.getEvolutionStatus?.() || {});
}));

router.get("/business/x/evolution/debt/:context", wrap(async (req, res) => {
  const r = _bee()?.getDebtReport?.(req.params.context);
  ok(res, r);
}));

router.get("/business/x/evolution/trend/:context", wrap(async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const r = _bee()?.getQualityTrend?.(req.params.context, { limit });
  ok(res, r);
}));

router.get("/business/x/evolution/:id", wrap(async (req, res) => {
  const c = _bee()?.getCycle?.(req.params.id);
  if (!c) return err(res, "cycle not found", 404);
  ok(res, { cycle: c });
}));

router.get("/business/x/evolution", wrap(async (req, res) => {
  const { context, limit } = req.query;
  const r = _bee()?.listCycles?.({ context, limit: parseInt(limit) || 50 });
  ok(res, r);
}));

router.get("/business/x/evolution/stats", wrap(async (req, res) => {
  ok(res, _bee()?.getStats?.() || {});
}));

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get("/business/x/dashboard", wrap(async (req, res) => {
  ok(res, _bid()?.getDashboard?.() || { ok: false, error: "dashboard unavailable" });
}));

router.get("/business/x/dashboard/context/:ctx", wrap(async (req, res) => {
  const r = _bid()?.getContextView?.(req.params.ctx);
  ok(res, r);
}));

router.get("/business/x/dashboard/health", wrap(async (req, res) => {
  ok(res, _bid()?.getBusinessHealth?.() || {});
}));

module.exports = router;
