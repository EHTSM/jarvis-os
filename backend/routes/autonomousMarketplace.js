"use strict";
/**
 * autonomousMarketplace.js — POST-Ω P13 Autonomous Marketplace
 * Routes: /auto-market/*
 *
 * Catalog:         POST /auto-market/discover
 *                  GET  /auto-market/assets, /auto-market/asset/:id
 *                  GET  /auto-market/search, /auto-market/assets/type/:type
 *                  POST /auto-market/publish, POST /auto-market/asset/:id/download
 *                  GET  /auto-market/catalog/stats
 *
 * Recommendation:  POST /auto-market/recommend
 *                  GET  /auto-market/recommendation/:id, /auto-market/recommendations
 *                  GET  /auto-market/recommendation/stats
 *
 * Certification:   POST /auto-market/certify/:assetId, POST /auto-market/certify/batch
 *                  GET  /auto-market/cert/:id, /auto-market/cert/asset/:assetId
 *                  GET  /auto-market/certs, GET /auto-market/cert/stats
 *
 * Automation:      POST /auto-market/automate/:assetId
 *                  POST /auto-market/lifecycle/scan
 *                  GET  /auto-market/automation/:id, /auto-market/automations
 *                  GET  /auto-market/automation/stats
 *
 * Economy:         POST /auto-market/economy/usage/:assetId
 *                  POST /auto-market/economy/rate/:assetId
 *                  GET  /auto-market/economy/snapshot
 *                  GET  /auto-market/economy/asset/:assetId
 *                  GET  /auto-market/economy/top, GET /auto-market/economy/stats
 *
 * Dashboard:       GET  /auto-market/dashboard
 *                  GET  /auto-market/dashboard/asset/:assetId
 *                  GET  /auto-market/health
 */

const router = require("express").Router();

const mce  = () => require("../services/marketplaceCatalogEngine.cjs");
const mre  = () => require("../services/marketplaceRecommendationEngine.cjs");
const mce2 = () => require("../services/marketplaceCertificationEngine.cjs");
const mae  = () => require("../services/marketplaceAutomationEngine.cjs");
const mee  = () => require("../services/marketplaceEconomyEngine.cjs");
const mfd  = () => require("../services/marketplaceDashboard.cjs");

function ok(res, data)           { res.json({ ok: true, ...data }); }
function err(res, msg, code=400) { res.status(code).json({ ok: false, error: msg }); }

// ── Catalog ───────────────────────────────────────────────────────────────────

router.post("/auto-market/discover", (req, res) => {
  const r = mce().discover();
  ok(res, r);
});

router.get("/auto-market/catalog/stats", (req, res) => {
  ok(res, mce().getStats());
});

router.get("/auto-market/assets", (req, res) => {
  const { type, status, tag, limit, offset } = req.query;
  ok(res, mce().listAssets({ type, status, tag,
    limit:  limit  ? parseInt(limit)  : 50,
    offset: offset ? parseInt(offset) : 0,
  }));
});

router.get("/auto-market/assets/type/:type", (req, res) => {
  ok(res, mce().listAssets({ type: req.params.type, limit: 50 }));
});

router.get("/auto-market/search", (req, res) => {
  const { q, type, limit } = req.query;
  ok(res, mce().searchAssets(q || "", { type, limit: limit ? parseInt(limit) : 20 }));
});

router.get("/auto-market/asset/:id", (req, res) => {
  const a = mce().getAsset(req.params.id);
  if (!a) return err(res, "asset not found", 404);
  ok(res, { asset: a });
});

router.post("/auto-market/publish", (req, res) => {
  const r = mce().publishAsset(req.body || {});
  if (!r.ok) return err(res, r.error);
  ok(res, { asset: r.asset });
});

router.post("/auto-market/asset/:id/download", (req, res) => {
  const r = mce().recordDownload(req.params.id);
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

// ── Recommendation ────────────────────────────────────────────────────────────

router.post("/auto-market/recommend", (req, res) => {
  const { objective, tags, projectType, typeFilter, limit } = req.body || {};
  const r = mre().recommend({ objective, tags, projectType, typeFilter, limit: limit || 10 });
  ok(res, r);
});

router.get("/auto-market/recommendation/stats", (req, res) => {
  ok(res, mre().getStats());
});

router.get("/auto-market/recommendation/:id", (req, res) => {
  const r = mre().getRecommendation(req.params.id);
  if (!r) return err(res, "recommendation not found", 404);
  ok(res, { recommendation: r });
});

router.get("/auto-market/recommendations", (req, res) => {
  ok(res, mre().listRecommendations({ limit: parseInt(req.query.limit || "50") }));
});

// ── Certification ─────────────────────────────────────────────────────────────

router.post("/auto-market/certify/:assetId", (req, res) => {
  const r = mce2().certify(req.params.assetId);
  if (!r.ok) return err(res, r.error);
  ok(res, { certification: r.certification });
});

router.post("/auto-market/certify/batch", (req, res) => {
  const { assetIds } = req.body || {};
  if (!Array.isArray(assetIds) || assetIds.length === 0) return err(res, "assetIds array required");
  ok(res, mce2().certifyBatch(assetIds));
});

router.get("/auto-market/cert/stats", (req, res) => {
  ok(res, mce2().getStats());
});

router.get("/auto-market/cert/asset/:assetId", (req, res) => {
  const c = mce2().getCertificationForAsset(req.params.assetId);
  if (!c) return err(res, "certification not found", 404);
  ok(res, { certification: c });
});

router.get("/auto-market/cert/:id", (req, res) => {
  const c = mce2().getCertification(req.params.id);
  if (!c) return err(res, "certification not found", 404);
  ok(res, { certification: c });
});

router.get("/auto-market/certs", (req, res) => {
  const { level, assetType, limit } = req.query;
  ok(res, mce2().listCertifications({ level, assetType, limit: limit ? parseInt(limit) : 50 }));
});

// ── Automation ────────────────────────────────────────────────────────────────

router.post("/auto-market/automate/:assetId", async (req, res) => {
  const { action, context, skipExecute, bumpType } = req.body || {};
  if (!action) return err(res, "action required");
  const r = await mae().automate(req.params.assetId, action, { context, skipExecute, bumpType });
  if (!r.ok) return err(res, r.error);
  ok(res, { automation: r.automation });
});

router.post("/auto-market/lifecycle/scan", async (req, res) => {
  const { skipExecute } = req.body || {};
  const r = await mae().runLifecycleScan({ skipExecute });
  ok(res, r);
});

router.get("/auto-market/automation/stats", (req, res) => {
  ok(res, mae().getStats());
});

router.get("/auto-market/automation/:id", (req, res) => {
  const a = mae().getAutomation(req.params.id);
  if (!a) return err(res, "automation not found", 404);
  ok(res, { automation: a });
});

router.get("/auto-market/automations", (req, res) => {
  const { action, status, assetType, limit } = req.query;
  ok(res, mae().listAutomations({ action, status, assetType, limit: limit ? parseInt(limit) : 50 }));
});

// ── Economy ───────────────────────────────────────────────────────────────────

router.post("/auto-market/economy/usage/:assetId", (req, res) => {
  const { eventType, userId, context } = req.body || {};
  const r = mee().recordUsage(req.params.assetId, { eventType, userId, context });
  if (!r.ok) return err(res, r.error);
  ok(res, { event: r.event });
});

router.post("/auto-market/economy/rate/:assetId", (req, res) => {
  const { rating, comment, userId } = req.body || {};
  const r = mee().rateAsset(req.params.assetId, { rating, comment, userId });
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.get("/auto-market/economy/snapshot", (req, res) => {
  ok(res, mee().getEconomySnapshot());
});

router.get("/auto-market/economy/asset/:assetId", (req, res) => {
  const r = mee().getAssetEconomy(req.params.assetId);
  if (!r.ok) return err(res, r.error, 404);
  res.json(r);
});

router.get("/auto-market/economy/top", (req, res) => {
  const { by, type, limit } = req.query;
  ok(res, mee().getTopAssets({ by, type, limit: limit ? parseInt(limit) : 10 }));
});

router.get("/auto-market/economy/stats", (req, res) => {
  ok(res, mee().getStats());
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get("/auto-market/dashboard", (req, res) => {
  ok(res, mfd().getDashboard());
});

router.get("/auto-market/dashboard/asset/:assetId", (req, res) => {
  const r = mfd().getAssetView(req.params.assetId);
  if (!r.ok) return err(res, r.error, 404);
  res.json(r);
});

router.get("/auto-market/health", (req, res) => {
  ok(res, mfd().getMarketplaceSystemHealth());
});

module.exports = router;
