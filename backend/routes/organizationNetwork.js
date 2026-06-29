"use strict";
/**
 * organizationNetwork.js — POST-Ω P20 Artificial Organization Network
 * Routes: /org-network/*
 *
 * Registry:      GET  /org-network/orgs
 *                POST /org-network/orgs/register
 *                PUT  /org-network/orgs/:id/status
 *                GET  /org-network/orgs/:id
 *                GET  /org-network/orgs/capability/:capability
 *                GET  /org-network/registry/stats
 *
 * Collaboration: POST /org-network/collaborate
 *                GET  /org-network/collaborations
 *                GET  /org-network/collaborations/:id
 *                GET  /org-network/collaboration/stats
 *                POST /org-network/route
 *
 * Cap Exchange:  POST /org-network/capabilities/discover
 *                GET  /org-network/capabilities
 *                POST /org-network/capabilities/find-best-org
 *                POST /org-network/capabilities/detect-gaps
 *                POST /org-network/capabilities/:capability/resolve-overlap
 *
 * Governance:    POST /org-network/agreements
 *                PUT  /org-network/agreements/:id
 *                GET  /org-network/agreements
 *                GET  /org-network/agreements/:id
 *                GET  /org-network/trust/:orgId
 *                GET  /org-network/trust-network
 *                POST /org-network/compliance/assess
 *                POST /org-network/violations
 *                GET  /org-network/governance/stats
 *
 * Evolution:     POST /org-network/evolve
 *                PUT  /org-network/evolutions/:id/apply
 *                GET  /org-network/evolutions
 *                GET  /org-network/evolutions/:id
 *                GET  /org-network/evolution/stats
 *
 * Dashboard:     GET  /org-network/dashboard
 *                GET  /org-network/pipeline
 *                GET  /org-network/health-system
 *                GET  /org-network/platform-inventory
 *
 * Pipeline:      POST /org-network/pipeline/run
 */

const router = require("express").Router();

const reg    = () => require("../services/organizationRegistryEngine.cjs");
const collab = () => require("../services/organizationCollaborationEngine.cjs");
const cap    = () => require("../services/organizationCapabilityExchangeEngine.cjs");
const gov    = () => require("../services/organizationGovernanceEngine.cjs");
const evo    = () => require("../services/organizationEvolutionEngine.cjs");
const db     = () => require("../services/organizationNetworkDashboard.cjs");

function ok(res, data)           { res.json({ ok: true, ...data }); }
function err(res, msg, code=400) { res.status(code).json({ ok: false, error: msg }); }

// ── Registry ──────────────────────────────────────────────────────────────────

router.post("/org-network/orgs/register", (req, res) => {
  const r = reg().registerOrg(req.body || {});
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.put("/org-network/orgs/:id/status", (req, res) => {
  const { status, trustLevel } = req.body || {};
  if (!status) return err(res, "status is required");
  const r = reg().updateOrgStatus(req.params.id, status, { trustLevel });
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.get("/org-network/registry/stats", (req, res) => {
  ok(res, reg().getStats());
});

router.get("/org-network/orgs/capability/:capability", (req, res) => {
  ok(res, reg().findByCapability(req.params.capability));
});

router.get("/org-network/orgs/:id", (req, res) => {
  const o = reg().getOrg(req.params.id);
  if (!o) return err(res, "org not found", 404);
  ok(res, { org: o });
});

router.get("/org-network/orgs", (req, res) => {
  const { orgType, status, trustLevel, limit } = req.query;
  ok(res, reg().listOrgs({ orgType, status, trustLevel, limit: limit ? parseInt(limit) : 100 }));
});

// ── Collaboration ─────────────────────────────────────────────────────────────

router.post("/org-network/collaborate", async (req, res) => {
  const { fromOrgId, toOrgId, type, payload, skipExecute } = req.body || {};
  if (!fromOrgId || !toOrgId || !type) return err(res, "fromOrgId, toOrgId, type are required");
  const r = await collab().collaborate({ fromOrgId, toOrgId, type, payload, skipExecute });
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.get("/org-network/collaboration/stats", (req, res) => {
  ok(res, collab().getCollaborationStats());
});

router.get("/org-network/collaborations/:id", (req, res) => {
  const c = collab().getCollaboration(req.params.id);
  if (!c) return err(res, "collaboration not found", 404);
  ok(res, { collaboration: c });
});

router.get("/org-network/collaborations", (req, res) => {
  const { fromOrgId, toOrgId, type, status, limit } = req.query;
  ok(res, collab().listCollaborations({ fromOrgId, toOrgId, type, status, limit: limit ? parseInt(limit) : 100 }));
});

router.post("/org-network/route", (req, res) => {
  const { capability, excludeOrgId } = req.body || {};
  if (!capability) return err(res, "capability is required");
  const r = collab().routeToOrg(capability, { excludeOrgId });
  if (!r.ok) return err(res, r.error, 404);
  ok(res, r);
});

// ── Capability Exchange ───────────────────────────────────────────────────────

router.post("/org-network/capabilities/discover", (req, res) => {
  ok(res, cap().discoverCapabilities());
});

router.get("/org-network/capabilities", (req, res) => {
  ok(res, cap().getAllCapabilities());
});

router.post("/org-network/capabilities/find-best-org", (req, res) => {
  const { goal, requiredCapabilities } = req.body || {};
  const r = cap().findBestOrg({ goal, requiredCapabilities: requiredCapabilities || [] });
  if (!r.ok) return err(res, r.error, r.gap ? 422 : 400);
  ok(res, r);
});

router.post("/org-network/capabilities/detect-gaps", (req, res) => {
  ok(res, cap().detectGaps());
});

router.post("/org-network/capabilities/:capability/resolve-overlap", (req, res) => {
  ok(res, cap().resolveOverlap(req.params.capability));
});

// ── Governance ────────────────────────────────────────────────────────────────

router.post("/org-network/agreements", (req, res) => {
  const r = gov().createAgreement(req.body || {});
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.put("/org-network/agreements/:id", (req, res) => {
  const r = gov().updateAgreement(req.params.id, req.body || {});
  if (!r.ok) return err(res, r.error, 404);
  ok(res, r);
});

router.get("/org-network/governance/stats", (req, res) => {
  ok(res, gov().getStats());
});

router.get("/org-network/agreements/:id", (req, res) => {
  const a = gov().getAgreement(req.params.id);
  if (!a) return err(res, "agreement not found", 404);
  ok(res, { agreement: a });
});

router.get("/org-network/agreements", (req, res) => {
  const { fromOrgId, toOrgId, type, status, limit } = req.query;
  ok(res, gov().listAgreements({ fromOrgId, toOrgId, type, status, limit: limit ? parseInt(limit) : 100 }));
});

router.get("/org-network/trust/:orgId", (req, res) => {
  ok(res, gov().getTrustScore(req.params.orgId));
});

router.get("/org-network/trust-network", (req, res) => {
  ok(res, gov().getTrustNetwork());
});

router.post("/org-network/compliance/assess", (req, res) => {
  ok(res, gov().assessCompliance());
});

router.post("/org-network/violations", (req, res) => {
  const r = gov().recordViolation(req.body || {});
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

// ── Evolution ─────────────────────────────────────────────────────────────────

router.post("/org-network/evolve", (req, res) => {
  ok(res, evo().evolve());
});

router.put("/org-network/evolutions/:id/apply", (req, res) => {
  const r = evo().applyEvolution(req.params.id);
  if (!r.ok) return err(res, r.error, 404);
  ok(res, r);
});

router.get("/org-network/evolution/stats", (req, res) => {
  ok(res, evo().getStats());
});

router.get("/org-network/evolutions/:id", (req, res) => {
  const e = evo().getEvolution(req.params.id);
  if (!e) return err(res, "evolution not found", 404);
  ok(res, { evolution: e });
});

router.get("/org-network/evolutions", (req, res) => {
  const { type, status, priority, limit } = req.query;
  ok(res, evo().listEvolutions({ type, status, priority, limit: limit ? parseInt(limit) : 100 }));
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get("/org-network/dashboard", (req, res) => {
  ok(res, db().getDashboard());
});

router.get("/org-network/pipeline", (req, res) => {
  ok(res, db().getPipelineView());
});

router.get("/org-network/health-system", (req, res) => {
  ok(res, db().getNetworkSystemHealth());
});

router.get("/org-network/platform-inventory", (req, res) => {
  ok(res, db().getPlatformInventory());
});

// ── Full Pipeline ─────────────────────────────────────────────────────────────

router.post("/org-network/pipeline/run", async (req, res) => {
  const { skipExecute } = req.body || {};
  const steps = [];

  // 1. Discover Organizations
  const regStats = reg().getStats();
  steps.push({ step: "discover_organizations", ok: true, total: regStats.total, active: regStats.active });

  // 2. Capability Exchange
  const caps = cap().discoverCapabilities();
  steps.push({ step: "capability_exchange", ok: caps.ok, total: caps.total, newlyDiscovered: caps.newlyDiscovered });

  // 3. Capability Gap Detection
  const gaps = cap().detectGaps();
  steps.push({ step: "capability_gaps", ok: gaps.ok, gaps: gaps.total });

  // 4. Trust Network Assessment
  const trust = gov().getTrustNetwork();
  steps.push({ step: "trust_assessment", ok: trust.ok, avgTrustScore: trust.avgTrustScore, totalOrgs: trust.totalOrgs });

  // 5. Compliance Assessment
  const compliance = gov().assessCompliance();
  steps.push({ step: "compliance", ok: compliance.ok, score: compliance.complianceScore, violations: compliance.violationsFound });

  // 6. Network Evolution
  const evolution = evo().evolve();
  steps.push({ step: "evolution", ok: evolution.ok, found: evolution.found, cycles: evolution.cycles });

  // 7. Dashboard
  const dashboard = db().getDashboard();
  steps.push({ step: "network_optimization", ok: dashboard.ok, health: dashboard.summary.collaborationHealth });

  ok(res, {
    pipeline:       "artificial_organization_network",
    stepsCompleted: steps.filter(s => s.ok).length,
    totalSteps:     steps.length,
    steps,
    summary:        dashboard.summary,
  });
});

module.exports = router;
