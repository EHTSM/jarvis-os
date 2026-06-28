"use strict";
/**
 * OKB X V1 — Autonomous Knowledge Intelligence Evolution
 * Routes: /knowledge/x/*
 */

const router = require("express").Router();
const _try   = fn => { try { return fn(); } catch { return null; } };
const _kre   = () => _try(() => require("../services/knowledgeReasoningEngine.cjs"));
const _kqe   = () => _try(() => require("../services/knowledgeQualityEngine.cjs"));
const _kbe   = () => _try(() => require("../services/knowledgeBenchmarkEngine.cjs"));
const _kpe   = () => _try(() => require("../services/knowledgePredictionEngine.cjs"));
const _kee   = () => _try(() => require("../services/knowledgeEvolutionEngine.cjs"));
const _kid   = () => _try(() => require("../services/knowledgeIntelligenceDashboard.cjs"));

function ok(res, data)     { res.json({ ok: true, ...data }); }
function err(res, msg, code = 400) { res.status(code).json({ ok: false, error: msg }); }
function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { err(res, e.message, 500); }
  };
}

// ── Reasoning ─────────────────────────────────────────────────────────────────
router.post("/knowledge/x/reasoning/analyze", wrap(async (req, res) => {
  const { context } = req.body;
  const r = await _kre()?.analyze?.(context, req.body);
  if (!r?.ok) return err(res, r?.error || "analyze failed");
  ok(res, { analysis: r.analysis });
}));
router.get("/knowledge/x/reasoning/:id", wrap(async (req, res) => {
  const a = _kre()?.getAnalysis?.(req.params.id);
  if (!a) return err(res, "analysis not found", 404);
  ok(res, { analysis: a });
}));
router.get("/knowledge/x/reasoning", wrap(async (req, res) => {
  ok(res, _kre()?.listAnalyses?.({ limit: parseInt(req.query.limit) || 50 }));
}));
router.get("/knowledge/x/reasoning/stats", wrap(async (req, res) => {
  ok(res, _kre()?.getStats?.() || {});
}));

// ── Quality ───────────────────────────────────────────────────────────────────
router.post("/knowledge/x/quality/score", wrap(async (req, res) => {
  const { context, reasoningAnalysis } = req.body;
  const r = await _kqe()?.score?.(context, { reasoningAnalysis });
  if (!r?.ok) return err(res, r?.error || "score failed");
  ok(res, { score: r.score });
}));
router.get("/knowledge/x/quality/:id", wrap(async (req, res) => {
  const s = _kqe()?.getScore?.(req.params.id);
  if (!s) return err(res, "score not found", 404);
  ok(res, { score: s });
}));
router.get("/knowledge/x/quality", wrap(async (req, res) => {
  const { context, limit } = req.query;
  ok(res, _kqe()?.listScores?.({ context, limit: parseInt(limit) || 50 }));
}));
router.get("/knowledge/x/quality/history/:context", wrap(async (req, res) => {
  ok(res, _kqe()?.getHistory?.(req.params.context, parseInt(req.query.limit) || 10));
}));
router.get("/knowledge/x/quality/trend/:context", wrap(async (req, res) => {
  ok(res, _kqe()?.getTrend?.(req.params.context, req.query.dimension));
}));
router.get("/knowledge/x/quality/stats", wrap(async (req, res) => {
  ok(res, _kqe()?.getStats?.() || {});
}));

// ── Benchmark ─────────────────────────────────────────────────────────────────
router.get("/knowledge/x/benchmark/baseline", wrap(async (req, res) => {
  ok(res, { baseline: _kbe()?.getBaseline?.(), KNOWLEDGE_BASELINE: _kbe()?.KNOWLEDGE_BASELINE });
}));
router.post("/knowledge/x/benchmark/baseline", wrap(async (req, res) => {
  ok(res, _kbe()?.setBaseline?.(req.body));
}));
router.post("/knowledge/x/benchmark/compare-versions", wrap(async (req, res) => {
  const r = await _kbe()?.compareVersions?.(req.body.context, req.body);
  if (!r?.ok) return err(res, r?.error || "compare failed");
  ok(res, { benchmark: r.benchmark });
}));
router.post("/knowledge/x/benchmark/compare-baseline", wrap(async (req, res) => {
  const r = await _kbe()?.compareToBaseline?.(req.body.context, req.body);
  if (!r?.ok) return err(res, r?.error || "compare failed");
  ok(res, { benchmark: r.benchmark });
}));
router.post("/knowledge/x/benchmark/compare-eng-memory", wrap(async (req, res) => {
  ok(res, await _kbe()?.compareEngMemory?.(req.body.context));
}));
router.post("/knowledge/x/benchmark/compare-research", wrap(async (req, res) => {
  ok(res, await _kbe()?.compareResearch?.(req.body.context));
}));
router.post("/knowledge/x/benchmark/improvement-result", wrap(async (req, res) => {
  ok(res, _kbe()?.recordImprovementResult?.(req.body));
}));
router.get("/knowledge/x/benchmark/improvement-rate", wrap(async (req, res) => {
  ok(res, _kbe()?.getImprovementSuccessRate?.() || {});
}));
router.post("/knowledge/x/benchmark/detect-regression", wrap(async (req, res) => {
  ok(res, _kbe()?.detectRegression?.(req.body.context));
}));
router.get("/knowledge/x/benchmark/:id", wrap(async (req, res) => {
  const b = _kbe()?.getBenchmark?.(req.params.id);
  if (!b) return err(res, "benchmark not found", 404);
  ok(res, { benchmark: b });
}));
router.get("/knowledge/x/benchmark", wrap(async (req, res) => {
  const { context, type, limit } = req.query;
  ok(res, _kbe()?.listBenchmarks?.({ context, type, limit: parseInt(limit) || 50 }));
}));
router.get("/knowledge/x/benchmark/stats", wrap(async (req, res) => {
  ok(res, _kbe()?.getStats?.() || {});
}));

// ── Predict ───────────────────────────────────────────────────────────────────
router.post("/knowledge/x/predict", wrap(async (req, res) => {
  const { context, qualityScore, reasoningAnalysis } = req.body;
  const r = await _kpe()?.predict?.(context, { qualityScore, reasoningAnalysis });
  if (!r?.ok) return err(res, r?.error || "predict failed");
  ok(res, { prediction: r.prediction });
}));
router.get("/knowledge/x/predict/:id", wrap(async (req, res) => {
  const p = _kpe()?.getPrediction?.(req.params.id);
  if (!p) return err(res, "prediction not found", 404);
  ok(res, { prediction: p });
}));
router.get("/knowledge/x/predict", wrap(async (req, res) => {
  const { context, limit } = req.query;
  ok(res, _kpe()?.listPredictions?.({ context, limit: parseInt(limit) || 50 }));
}));
router.get("/knowledge/x/predict/stats", wrap(async (req, res) => {
  ok(res, _kpe()?.getStats?.() || {});
}));

// ── Evolution ─────────────────────────────────────────────────────────────────
router.post("/knowledge/x/evolution/run", wrap(async (req, res) => {
  const { context, skipExecute } = req.body;
  const r = await _kee()?.runEvolutionCycle?.(context, { skipExecute });
  if (!r?.ok) return err(res, r?.error || "evolution failed");
  ok(res, r);
}));
router.get("/knowledge/x/evolution/status", wrap(async (req, res) => {
  ok(res, _kee()?.getEvolutionStatus?.() || {});
}));
router.get("/knowledge/x/evolution/debt/:context", wrap(async (req, res) => {
  ok(res, _kee()?.getDebtReport?.(req.params.context));
}));
router.get("/knowledge/x/evolution/trend/:context", wrap(async (req, res) => {
  ok(res, _kee()?.getQualityTrend?.(req.params.context, { limit: parseInt(req.query.limit) || 10 }));
}));
router.get("/knowledge/x/evolution/:id", wrap(async (req, res) => {
  const c = _kee()?.getCycle?.(req.params.id);
  if (!c) return err(res, "cycle not found", 404);
  ok(res, { cycle: c });
}));
router.get("/knowledge/x/evolution", wrap(async (req, res) => {
  const { context, limit } = req.query;
  ok(res, _kee()?.listCycles?.({ context, limit: parseInt(limit) || 50 }));
}));
router.get("/knowledge/x/evolution/stats", wrap(async (req, res) => {
  ok(res, _kee()?.getStats?.() || {});
}));

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get("/knowledge/x/dashboard", wrap(async (req, res) => {
  ok(res, _kid()?.getDashboard?.() || { ok: false, error: "dashboard unavailable" });
}));
router.get("/knowledge/x/dashboard/context/:ctx", wrap(async (req, res) => {
  ok(res, _kid()?.getContextView?.(req.params.ctx));
}));
router.get("/knowledge/x/dashboard/health", wrap(async (req, res) => {
  ok(res, _kid()?.getKnowledgeHealth?.() || {});
}));

module.exports = router;
