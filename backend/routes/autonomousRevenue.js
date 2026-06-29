"use strict";
/**
 * autonomousRevenue.js — POST-Ω P15 Autonomous Revenue Engine
 * Routes: /revenue-engine/*
 *
 * Discovery:    POST /revenue-engine/discover
 *               GET  /revenue-engine/opportunities, /revenue-engine/opportunity/:id
 *               GET  /revenue-engine/opportunities/type/:type
 *               GET  /revenue-engine/discovery/stats
 *
 * Optimization: POST /revenue-engine/optimize
 *               GET  /revenue-engine/optimizations, /revenue-engine/optimization/:id
 *               GET  /revenue-engine/optimization/stats
 *
 * Pricing:      POST /revenue-engine/pricing/recommend
 *               GET  /revenue-engine/pricing/recommendations
 *               GET  /revenue-engine/pricing/recommendation/:id
 *               GET  /revenue-engine/pricing/discount/:scenario
 *               GET  /revenue-engine/pricing/stats
 *
 * Forecast:     POST /revenue-engine/forecast, POST /revenue-engine/forecast/all
 *               GET  /revenue-engine/forecasts, /revenue-engine/forecast/:id
 *               GET  /revenue-engine/forecast/cashflow
 *               GET  /revenue-engine/forecast/stats
 *
 * Automation:   POST /revenue-engine/automate/:action
 *               POST /revenue-engine/pipeline/run
 *               GET  /revenue-engine/automations, /revenue-engine/automation/:id
 *               GET  /revenue-engine/automation/stats
 *
 * Dashboard:    GET  /revenue-engine/dashboard
 *               GET  /revenue-engine/pipeline
 *               GET  /revenue-engine/health
 */

const router = require("express").Router();

const rde = () => require("../services/revenueDiscoveryEngine.cjs");
const roe = () => require("../services/revenueOptimizationEngine.cjs");
const pie = () => require("../services/pricingIntelligenceEngine.cjs");
const rfe = () => require("../services/revenueForecastEngine.cjs");
const rae = () => require("../services/revenueAutomationEngine.cjs");
const rdb = () => require("../services/revenueDashboard.cjs");

function ok(res, data)           { res.json({ ok: true, ...data }); }
function err(res, msg, code=400) { res.status(code).json({ ok: false, error: msg }); }

// ── Discovery ─────────────────────────────────────────────────────────────────

router.post("/revenue-engine/discover", (req, res) => {
  ok(res, rde().discover());
});

router.get("/revenue-engine/discovery/stats", (req, res) => {
  ok(res, rde().getStats());
});

router.get("/revenue-engine/opportunities/type/:type", (req, res) => {
  ok(res, rde().listOpportunities({ type: req.params.type }));
});

router.get("/revenue-engine/opportunity/:id", (req, res) => {
  const o = rde().getOpportunity(req.params.id);
  if (!o) return err(res, "opportunity not found", 404);
  ok(res, { opportunity: o });
});

router.get("/revenue-engine/opportunities", (req, res) => {
  const { type, priority, minValue, limit } = req.query;
  ok(res, rde().listOpportunities({ type, priority,
    minValue: minValue ? parseInt(minValue) : undefined,
    limit: limit ? parseInt(limit) : 50,
  }));
});

// ── Optimization ──────────────────────────────────────────────────────────────

router.post("/revenue-engine/optimize", (req, res) => {
  ok(res, roe().optimize());
});

router.get("/revenue-engine/optimization/stats", (req, res) => {
  ok(res, roe().getStats());
});

router.get("/revenue-engine/optimization/:id", (req, res) => {
  const o = roe().getOptimization(req.params.id);
  if (!o) return err(res, "optimization not found", 404);
  ok(res, { optimization: o });
});

router.get("/revenue-engine/optimizations", (req, res) => {
  const { dimension, priority, limit } = req.query;
  ok(res, roe().listOptimizations({ dimension, priority, limit: limit ? parseInt(limit) : 50 }));
});

// ── Pricing ───────────────────────────────────────────────────────────────────

router.post("/revenue-engine/pricing/recommend", (req, res) => {
  const { accountId, plan, context } = req.body || {};
  ok(res, pie().recommend({ accountId, plan, context }));
});

router.get("/revenue-engine/pricing/stats", (req, res) => {
  ok(res, pie().getStats());
});

router.get("/revenue-engine/pricing/discount/:scenario", (req, res) => {
  const r = pie().getDiscountOffer(req.params.scenario);
  if (!r.ok) return err(res, r.error);
  res.json(r);
});

router.get("/revenue-engine/pricing/recommendation/:id", (req, res) => {
  const r = pie().getRecommendation(req.params.id);
  if (!r) return err(res, "recommendation not found", 404);
  ok(res, { recommendation: r });
});

router.get("/revenue-engine/pricing/recommendations", (req, res) => {
  const { strategy, limit } = req.query;
  ok(res, pie().listRecommendations({ strategy, limit: limit ? parseInt(limit) : 50 }));
});

// ── Forecast ──────────────────────────────────────────────────────────────────

router.post("/revenue-engine/forecast/all", (req, res) => {
  ok(res, rfe().forecastAll());
});

router.post("/revenue-engine/forecast", (req, res) => {
  const { model } = req.body || {};
  const r = rfe().forecast(model || "base");
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.get("/revenue-engine/forecast/stats", (req, res) => {
  ok(res, rfe().getStats());
});

router.get("/revenue-engine/forecast/cashflow", (req, res) => {
  ok(res, rfe().getCashFlowProjection());
});

router.get("/revenue-engine/forecast/:id", (req, res) => {
  const f = rfe().getForecast(req.params.id);
  if (!f) return err(res, "forecast not found", 404);
  ok(res, { forecast: f });
});

router.get("/revenue-engine/forecasts", (req, res) => {
  const { model, limit } = req.query;
  ok(res, rfe().listForecasts({ model, limit: limit ? parseInt(limit) : 20 }));
});

// ── Automation ────────────────────────────────────────────────────────────────

router.post("/revenue-engine/pipeline/run", async (req, res) => {
  const { skipExecute } = req.body || {};
  const r = await rae().runRevenuePipeline({ skipExecute: skipExecute !== false });
  ok(res, r);
});

router.post("/revenue-engine/automate/:action", async (req, res) => {
  const { params, skipExecute } = req.body || {};
  const r = await rae().automate(req.params.action, params || {}, { skipExecute: skipExecute !== false });
  if (!r.ok) return err(res, r.error);
  ok(res, { automation: r.automation });
});

router.get("/revenue-engine/automation/stats", (req, res) => {
  ok(res, rae().getStats());
});

router.get("/revenue-engine/automation/:id", (req, res) => {
  const a = rae().getAutomation(req.params.id);
  if (!a) return err(res, "automation not found", 404);
  ok(res, { automation: a });
});

router.get("/revenue-engine/automations", (req, res) => {
  const { action, status, limit } = req.query;
  ok(res, rae().listAutomations({ action, status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get("/revenue-engine/dashboard", (req, res) => {
  ok(res, rdb().getDashboard());
});

router.get("/revenue-engine/pipeline", (req, res) => {
  ok(res, rdb().getPipelineView());
});

router.get("/revenue-engine/health", (req, res) => {
  ok(res, rdb().getRevenueSystemHealth());
});

module.exports = router;
