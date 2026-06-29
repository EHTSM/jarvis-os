"use strict";
/**
 * autonomousInvestment.js — POST-Ω P16 Autonomous Investment Engine
 * Routes: /investment/*
 *
 * Capital:    POST /investment/allocate
 *             GET  /investment/allocation, /investment/allocation/:id
 *             GET  /investment/allocations
 *             GET  /investment/capital/stats
 *
 * Analysis:   POST /investment/analyze
 *             GET  /investment/analyses, /investment/analysis/:id
 *             GET  /investment/analysis/type/:type
 *             GET  /investment/analysis/stats
 *
 * Portfolio:  POST /investment/strategize
 *             GET  /investment/strategy, /investment/strategy/:id
 *             GET  /investment/strategies
 *             GET  /investment/portfolio/stats
 *
 * Risk:       POST /investment/assess
 *             GET  /investment/risk, /investment/risk/:id
 *             GET  /investment/risks
 *             GET  /investment/risk/stats
 *
 * Automation: POST /investment/recommend/:type
 *             POST /investment/pipeline/run
 *             GET  /investment/recommendations, /investment/recommendation/:id
 *             GET  /investment/automation/stats
 *
 * Dashboard:  GET  /investment/dashboard
 *             GET  /investment/pipeline
 *             GET  /investment/health
 */

const router = require("express").Router();

const cal = () => require("../services/capitalAllocationEngine.cjs");
const ian = () => require("../services/investmentAnalysisEngine.cjs");
const pfs = () => require("../services/portfolioStrategyEngine.cjs");
const rsk = () => require("../services/riskAssessmentEngine.cjs");
const iat = () => require("../services/investmentAutomationEngine.cjs");
const idb = () => require("../services/investmentDashboard.cjs");

function ok(res, data)           { res.json({ ok: true, ...data }); }
function err(res, msg, code=400) { res.status(code).json({ ok: false, error: msg }); }

// ── Capital Allocation ────────────────────────────────────────────────────────

router.post("/investment/allocate", (req, res) => {
  const { totalBudget, context } = req.body || {};
  ok(res, cal().allocate(totalBudget || 100000, context || {}));
});

router.get("/investment/capital/stats", (req, res) => {
  ok(res, cal().getStats());
});

router.get("/investment/allocation", (req, res) => {
  const a = cal().getCurrentAllocation();
  if (!a) return err(res, "no allocation yet — POST /investment/allocate first", 404);
  ok(res, { allocation: a });
});

router.get("/investment/allocation/:id", (req, res) => {
  const a = cal().getAllocation(req.params.id);
  if (!a) return err(res, "allocation not found", 404);
  ok(res, { allocation: a });
});

router.get("/investment/allocations", (req, res) => {
  const { limit } = req.query;
  ok(res, cal().listAllocations({ limit: limit ? parseInt(limit) : 20 }));
});

// ── Investment Analysis ───────────────────────────────────────────────────────

router.post("/investment/analyze", (req, res) => {
  ok(res, ian().analyze());
});

router.get("/investment/analysis/stats", (req, res) => {
  ok(res, ian().getStats());
});

router.get("/investment/analysis/type/:type", (req, res) => {
  ok(res, ian().listAnalyses({ type: req.params.type }));
});

router.get("/investment/analysis/:id", (req, res) => {
  const a = ian().getAnalysis(req.params.id);
  if (!a) return err(res, "analysis not found", 404);
  ok(res, { analysis: a });
});

router.get("/investment/analyses", (req, res) => {
  const { type, limit } = req.query;
  ok(res, ian().listAnalyses({ type, limit: limit ? parseInt(limit) : 50 }));
});

// ── Portfolio Strategy ────────────────────────────────────────────────────────

router.post("/investment/strategize", (req, res) => {
  const { mode, totalBudget } = req.body || {};
  ok(res, pfs().strategize(mode || "balanced", totalBudget || 100000));
});

router.get("/investment/portfolio/stats", (req, res) => {
  ok(res, pfs().getStats());
});

router.get("/investment/strategy", (req, res) => {
  const s = pfs().getCurrentStrategy();
  if (!s) return err(res, "no strategy yet — POST /investment/strategize first", 404);
  ok(res, { strategy: s });
});

router.get("/investment/strategy/:id", (req, res) => {
  const s = pfs().getStrategy(req.params.id);
  if (!s) return err(res, "strategy not found", 404);
  ok(res, { strategy: s });
});

router.get("/investment/strategies", (req, res) => {
  const { mode, limit } = req.query;
  ok(res, pfs().listStrategies({ mode, limit: limit ? parseInt(limit) : 20 }));
});

// ── Risk Assessment ───────────────────────────────────────────────────────────

router.post("/investment/assess", (req, res) => {
  ok(res, rsk().assess());
});

router.get("/investment/risk/stats", (req, res) => {
  ok(res, rsk().getStats());
});

router.get("/investment/risk", (req, res) => {
  const a = rsk().getCurrentAssessment();
  if (!a) return err(res, "no assessment yet — POST /investment/assess first", 404);
  ok(res, { assessment: a });
});

router.get("/investment/risk/:id", (req, res) => {
  const a = rsk().getAssessment(req.params.id);
  if (!a) return err(res, "assessment not found", 404);
  ok(res, { assessment: a });
});

router.get("/investment/risks", (req, res) => {
  const { level, limit } = req.query;
  ok(res, rsk().listAssessments({ level, limit: limit ? parseInt(limit) : 20 }));
});

// ── Investment Automation ─────────────────────────────────────────────────────

router.post("/investment/pipeline/run", async (req, res) => {
  const r = await iat().runInvestmentPipeline({ skipExecute: false });
  ok(res, r);
});

router.post("/investment/recommend/:type", async (req, res) => {
  const r = await iat().recommend(req.params.type, req.body || {});
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.get("/investment/automation/stats", (req, res) => {
  ok(res, iat().getStats());
});

router.get("/investment/recommendation/:id", (req, res) => {
  const r = iat().getRecommendation(req.params.id);
  if (!r) return err(res, "recommendation not found", 404);
  ok(res, { recommendation: r });
});

router.get("/investment/recommendations", (req, res) => {
  const { type, status, limit } = req.query;
  ok(res, iat().listRecommendations({ type, status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get("/investment/dashboard", (req, res) => {
  ok(res, idb().getDashboard());
});

router.get("/investment/pipeline", (req, res) => {
  ok(res, idb().getPipelineView());
});

router.get("/investment/health", (req, res) => {
  ok(res, idb().getInvestmentSystemHealth());
});

module.exports = router;
