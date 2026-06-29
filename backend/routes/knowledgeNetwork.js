"use strict";
/**
 * knowledgeNetwork.js — POST-Ω P14 Universal Knowledge Network
 * Routes: /knowledge-net/*
 *
 * Federation:   POST /knowledge-net/federate
 *               GET  /knowledge-net/sources, /knowledge-net/source/:id
 *               GET  /knowledge-net/sources/domain/:domain
 *               GET  /knowledge-net/federation/stats
 *
 * Correlation:  POST /knowledge-net/correlate
 *               GET  /knowledge-net/correlations, /knowledge-net/correlation/:id
 *               GET  /knowledge-net/correlations/type/:type
 *               GET  /knowledge-net/correlation/stats
 *
 * Discovery:    POST /knowledge-net/discover
 *               GET  /knowledge-net/discoveries, /knowledge-net/discovery/:id
 *               GET  /knowledge-net/discoveries/category/:category
 *               GET  /knowledge-net/discovery/stats
 *
 * Governance:   POST /knowledge-net/govern
 *               POST /knowledge-net/govern/:sourceId
 *               POST /knowledge-net/policy
 *               GET  /knowledge-net/governance/records, /knowledge-net/governance/record/:sourceId
 *               GET  /knowledge-net/governance/health, /knowledge-net/policies
 *               GET  /knowledge-net/governance/stats
 *
 * Exchange:     POST /knowledge-net/exchange/:channelId
 *               POST /knowledge-net/exchange/all
 *               GET  /knowledge-net/exchanges, /knowledge-net/exchange/:id
 *               GET  /knowledge-net/exchange/stats
 *
 * Dashboard:    GET  /knowledge-net/dashboard
 *               GET  /knowledge-net/pipeline
 *               GET  /knowledge-net/health
 *
 * Pipeline:     POST /knowledge-net/pipeline/run
 */

const router = require("express").Router();

const kfe  = () => require("../services/knowledgeFederationEngine.cjs");
const kcor = () => require("../services/knowledgeCorrelationEngine.cjs");
const kde  = () => require("../services/knowledgeDiscoveryEngine.cjs");
const kgov = () => require("../services/knowledgeGovernanceEngine.cjs");
const kex  = () => require("../services/knowledgeExchangeEngine.cjs");
const knd  = () => require("../services/knowledgeNetworkDashboard.cjs");

function ok(res, data)           { res.json({ ok: true, ...data }); }
function err(res, msg, code=400) { res.status(code).json({ ok: false, error: msg }); }

// ── Federation ────────────────────────────────────────────────────────────────

router.post("/knowledge-net/federate", (req, res) => {
  ok(res, kfe().federate());
});

router.get("/knowledge-net/federation/stats", (req, res) => {
  ok(res, kfe().getStats());
});

router.get("/knowledge-net/sources/domain/:domain", (req, res) => {
  ok(res, kfe().listSources({ domain: req.params.domain }));
});

router.get("/knowledge-net/source/:id", (req, res) => {
  const s = kfe().getSource(req.params.id);
  if (!s) return err(res, "source not found", 404);
  ok(res, { source: s });
});

router.get("/knowledge-net/sources", (req, res) => {
  const { domain, healthy } = req.query;
  const h = healthy !== undefined ? healthy === "true" : undefined;
  ok(res, kfe().listSources({ domain, healthy: h }));
});

// ── Correlation ───────────────────────────────────────────────────────────────

router.post("/knowledge-net/correlate", (req, res) => {
  ok(res, kcor().correlate());
});

router.get("/knowledge-net/correlation/stats", (req, res) => {
  ok(res, kcor().getStats());
});

router.get("/knowledge-net/correlations/type/:type", (req, res) => {
  ok(res, kcor().listCorrelations({ type: req.params.type }));
});

router.get("/knowledge-net/correlation/:id", (req, res) => {
  const c = kcor().getCorrelation(req.params.id);
  if (!c) return err(res, "correlation not found", 404);
  ok(res, { correlation: c });
});

router.get("/knowledge-net/correlations", (req, res) => {
  const { type, sourceId, limit } = req.query;
  ok(res, kcor().listCorrelations({ type, sourceId, limit: limit ? parseInt(limit) : 50 }));
});

// ── Discovery ─────────────────────────────────────────────────────────────────

router.post("/knowledge-net/discover", (req, res) => {
  ok(res, kde().discover());
});

router.get("/knowledge-net/discovery/stats", (req, res) => {
  ok(res, kde().getStats());
});

router.get("/knowledge-net/discoveries/category/:category", (req, res) => {
  ok(res, kde().listDiscoveries({ category: req.params.category }));
});

router.get("/knowledge-net/discovery/:id", (req, res) => {
  const d = kde().getDiscovery(req.params.id);
  if (!d) return err(res, "discovery not found", 404);
  ok(res, { discovery: d });
});

router.get("/knowledge-net/discoveries", (req, res) => {
  const { category, source, minValue, limit } = req.query;
  ok(res, kde().listDiscoveries({
    category, source,
    minValue: minValue ? parseInt(minValue) : undefined,
    limit: limit ? parseInt(limit) : 50,
  }));
});

// ── Governance ────────────────────────────────────────────────────────────────

router.post("/knowledge-net/govern", (req, res) => {
  ok(res, kgov().governAll());
});

router.post("/knowledge-net/govern/:sourceId", (req, res) => {
  const r = kgov().governRecord(req.params.sourceId, req.body || {});
  if (!r.ok) return err(res, r.error);
  ok(res, { record: r.record });
});

router.post("/knowledge-net/policy", (req, res) => {
  const r = kgov().addPolicy(req.body || {});
  if (!r.ok) return err(res, r.error);
  ok(res, { policy: r.policy });
});

router.get("/knowledge-net/governance/stats", (req, res) => {
  ok(res, kgov().getStats());
});

router.get("/knowledge-net/governance/health", (req, res) => {
  ok(res, kgov().getGovernanceHealth());
});

router.get("/knowledge-net/policies", (req, res) => {
  ok(res, kgov().listPolicies());
});

router.get("/knowledge-net/governance/record/:sourceId", (req, res) => {
  const r = kgov().getRecord(req.params.sourceId);
  if (!r) return err(res, "record not found", 404);
  ok(res, { record: r });
});

router.get("/knowledge-net/governance/records", (req, res) => {
  const { domain, minConfidence, minFreshness, limit } = req.query;
  ok(res, kgov().listRecords({
    domain,
    minConfidence: minConfidence ? parseInt(minConfidence) : undefined,
    minFreshness:  minFreshness  ? parseInt(minFreshness)  : undefined,
    limit: limit ? parseInt(limit) : 50,
  }));
});

// ── Exchange ──────────────────────────────────────────────────────────────────

router.post("/knowledge-net/exchange/all", (req, res) => {
  ok(res, kex().runAllChannels({ context: req.body?.context }));
});

router.post("/knowledge-net/exchange/:channelId", (req, res) => {
  const r = kex().exchange(req.params.channelId, { context: req.body?.context });
  if (!r.ok) return err(res, r.error);
  ok(res, { exchange: r.exchange });
});

router.get("/knowledge-net/exchange/stats", (req, res) => {
  ok(res, kex().getStats());
});

router.get("/knowledge-net/exchanges", (req, res) => {
  const { channelId, from, to, limit } = req.query;
  ok(res, kex().listExchanges({ channelId, from, to, limit: limit ? parseInt(limit) : 50 }));
});

router.get("/knowledge-net/exchange/:id", (req, res) => {
  const e = kex().getExchange(req.params.id);
  if (!e) return err(res, "exchange not found", 404);
  ok(res, { exchange: e });
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get("/knowledge-net/dashboard", (req, res) => {
  ok(res, knd().getDashboard());
});

router.get("/knowledge-net/pipeline", (req, res) => {
  ok(res, knd().getPipelineView());
});

router.get("/knowledge-net/health", (req, res) => {
  ok(res, knd().getNetworkSystemHealth());
});

// ── Full pipeline: federate → govern → correlate → discover → exchange ────────

router.post("/knowledge-net/pipeline/run", (req, res) => {
  const fed   = kfe().federate();
  const gov   = kgov().governAll();
  const cor   = kcor().correlate();
  const disc  = kde().discover();
  const exAll = kex().runAllChannels();

  ok(res, {
    pipeline: "complete",
    steps: {
      federate:  { sources: fed.totalSources,    healthy: fed.healthySources },
      govern:    { governed: gov.governed,        avgConfidence: gov.avgConfidence },
      correlate: { found: cor.found,              total: cor.total },
      discover:  { found: disc.found,             total: disc.total },
      exchange:  { channels: exAll.total,         items: exAll.totalItemsExchanged },
    },
    totalKnowledgeItems: fed.totalItems || 0,
    founderMinutesSaved: exAll.totalMinutesSaved || 0,
  });
});

module.exports = router;
