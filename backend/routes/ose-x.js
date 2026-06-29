"use strict";
/**
 * OSE X V1 — Autonomous Self-Evolution Intelligence
 * Routes: /evolution/x/*
 */

const router = require("express").Router();
const _try   = fn => { try { return fn(); } catch { return null; } };
const _ere   = () => _try(() => require("../services/evolutionReasoningEngine.cjs"));
const _eqe   = () => _try(() => require("../services/evolutionQualityEngine.cjs"));
const _ebe   = () => _try(() => require("../services/evolutionBenchmarkEngine.cjs"));
const _epe   = () => _try(() => require("../services/evolutionPredictionEngine.cjs"));
const _eee   = () => _try(() => require("../services/evolutionEvolutionEngine.cjs"));
const _eid   = () => _try(() => require("../services/evolutionIntelligenceDashboard.cjs"));

function ok(res, data)     { res.json({ ok: true, ...data }); }
function err(res, msg, code = 400) { res.status(code).json({ ok: false, error: msg }); }
function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { err(res, e.message, 500); }
  };
}

// ── Reasoning ─────────────────────────────────────────────────────────────────
router.post("/evolution/x/reasoning/analyze", wrap(async (req, res) => {
  const { context } = req.body;
  const r = await _ere()?.analyze?.(context, req.body);
  if (!r?.ok) return err(res, r?.error || "analyze failed");
  ok(res, { analysis: r.analysis });
}));
router.get("/evolution/x/reasoning/:id", wrap(async (req, res) => {
  const a = _ere()?.getAnalysis?.(req.params.id);
  if (!a) return err(res, "analysis not found", 404);
  ok(res, { analysis: a });
}));
router.get("/evolution/x/reasoning", wrap(async (req, res) => {
  ok(res, _ere()?.listAnalyses?.({ limit: parseInt(req.query.limit) || 50 }));
}));
router.get("/evolution/x/reasoning/stats", wrap(async (req, res) => {
  ok(res, _ere()?.getStats?.() || {});
}));

// ── Quality ───────────────────────────────────────────────────────────────────
router.post("/evolution/x/quality/score", wrap(async (req, res) => {
  const { context, reasoningAnalysis } = req.body;
  const r = await _eqe()?.score?.(context, { reasoningAnalysis });
  if (!r?.ok) return err(res, r?.error || "score failed");
  ok(res, { score: r.score });
}));
router.get("/evolution/x/quality/:id", wrap(async (req, res) => {
  const s = _eqe()?.getScore?.(req.params.id);
  if (!s) return err(res, "score not found", 404);
  ok(res, { score: s });
}));
router.get("/evolution/x/quality", wrap(async (req, res) => {
  const { context, limit } = req.query;
  ok(res, _eqe()?.listScores?.({ context, limit: parseInt(limit) || 50 }));
}));
router.get("/evolution/x/quality/history/:context", wrap(async (req, res) => {
  ok(res, _eqe()?.getHistory?.(req.params.context, parseInt(req.query.limit) || 10));
}));
router.get("/evolution/x/quality/trend/:context", wrap(async (req, res) => {
  ok(res, _eqe()?.getTrend?.(req.params.context, req.query.dimension));
}));
router.get("/evolution/x/quality/stats", wrap(async (req, res) => {
  ok(res, _eqe()?.getStats?.() || {});
}));

// ── Benchmark ─────────────────────────────────────────────────────────────────
router.get("/evolution/x/benchmark/baseline", wrap(async (req, res) => {
  ok(res, { baseline: _ebe()?.getBaseline?.(), EVOLUTION_BASELINE: _ebe()?.EVOLUTION_BASELINE });
}));
router.post("/evolution/x/benchmark/baseline", wrap(async (req, res) => {
  ok(res, _ebe()?.setBaseline?.(req.body));
}));
router.post("/evolution/x/benchmark/compare-versions", wrap(async (req, res) => {
  const r = await _ebe()?.compareVersions?.(req.body.context, req.body);
  if (!r?.ok) return err(res, r?.error || "compare failed");
  ok(res, { benchmark: r.benchmark });
}));
router.post("/evolution/x/benchmark/compare-baseline", wrap(async (req, res) => {
  const r = await _ebe()?.compareToBaseline?.(req.body.context, req.body);
  if (!r?.ok) return err(res, r?.error || "compare failed");
  ok(res, { benchmark: r.benchmark });
}));
router.post("/evolution/x/benchmark/compare-cycles", wrap(async (req, res) => {
  ok(res, await _ebe()?.comparePreviousCycles?.(req.body.context));
}));
router.post("/evolution/x/benchmark/compare-research", wrap(async (req, res) => {
  ok(res, await _ebe()?.compareResearchRecommendations?.(req.body.context));
}));
router.post("/evolution/x/benchmark/improvement-result", wrap(async (req, res) => {
  ok(res, _ebe()?.recordImprovementResult?.(req.body));
}));
router.get("/evolution/x/benchmark/improvement-rate", wrap(async (req, res) => {
  ok(res, _ebe()?.getImprovementSuccessRate?.() || {});
}));
router.post("/evolution/x/benchmark/detect-regression", wrap(async (req, res) => {
  ok(res, _ebe()?.detectRegression?.(req.body.context));
}));
router.get("/evolution/x/benchmark/:id", wrap(async (req, res) => {
  const b = _ebe()?.getBenchmark?.(req.params.id);
  if (!b) return err(res, "benchmark not found", 404);
  ok(res, { benchmark: b });
}));
router.get("/evolution/x/benchmark", wrap(async (req, res) => {
  const { context, type, limit } = req.query;
  ok(res, _ebe()?.listBenchmarks?.({ context, type, limit: parseInt(limit) || 50 }));
}));
router.get("/evolution/x/benchmark/stats", wrap(async (req, res) => {
  ok(res, _ebe()?.getStats?.() || {});
}));

// ── Predict ───────────────────────────────────────────────────────────────────
router.post("/evolution/x/predict", wrap(async (req, res) => {
  const { context, qualityScore, reasoningAnalysis } = req.body;
  const r = await _epe()?.predict?.(context, { qualityScore, reasoningAnalysis });
  if (!r?.ok) return err(res, r?.error || "predict failed");
  ok(res, { prediction: r.prediction });
}));
router.get("/evolution/x/predict/:id", wrap(async (req, res) => {
  const p = _epe()?.getPrediction?.(req.params.id);
  if (!p) return err(res, "prediction not found", 404);
  ok(res, { prediction: p });
}));
router.get("/evolution/x/predict", wrap(async (req, res) => {
  const { context, limit } = req.query;
  ok(res, _epe()?.listPredictions?.({ context, limit: parseInt(limit) || 50 }));
}));
router.get("/evolution/x/predict/stats", wrap(async (req, res) => {
  ok(res, _epe()?.getStats?.() || {});
}));

// ── Evolution ─────────────────────────────────────────────────────────────────
router.post("/evolution/x/evolution/run", wrap(async (req, res) => {
  const { context, skipExecute } = req.body;
  const r = await _eee()?.runEvolutionCycle?.(context, { skipExecute });
  if (!r?.ok) return err(res, r?.error || "evolution failed");
  ok(res, r);
}));
router.get("/evolution/x/evolution/status", wrap(async (req, res) => {
  ok(res, _eee()?.getEvolutionStatus?.() || {});
}));
router.get("/evolution/x/evolution/debt/:context", wrap(async (req, res) => {
  ok(res, _eee()?.getDebtReport?.(req.params.context));
}));
router.get("/evolution/x/evolution/trend/:context", wrap(async (req, res) => {
  ok(res, _eee()?.getQualityTrend?.(req.params.context, { limit: parseInt(req.query.limit) || 10 }));
}));
router.get("/evolution/x/evolution/:id", wrap(async (req, res) => {
  const c = _eee()?.getCycle?.(req.params.id);
  if (!c) return err(res, "cycle not found", 404);
  ok(res, { cycle: c });
}));
router.get("/evolution/x/evolution", wrap(async (req, res) => {
  const { context, limit } = req.query;
  ok(res, _eee()?.listCycles?.({ context, limit: parseInt(limit) || 50 }));
}));
router.get("/evolution/x/evolution/stats", wrap(async (req, res) => {
  ok(res, _eee()?.getStats?.() || {});
}));

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get("/evolution/x/dashboard", wrap(async (req, res) => {
  ok(res, _eid()?.getDashboard?.() || { ok: false, error: "dashboard unavailable" });
}));
router.get("/evolution/x/dashboard/context/:ctx", wrap(async (req, res) => {
  ok(res, _eid()?.getContextView?.(req.params.ctx));
}));
router.get("/evolution/x/dashboard/health", wrap(async (req, res) => {
  ok(res, _eid()?.getEvolutionHealth?.() || {});
}));

module.exports = router;
