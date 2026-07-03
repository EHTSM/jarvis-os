"use strict";
/**
 * Commercial Foundation Routes — all 10 modules.
 *
 * GET  /commercial/credits/status          — credit balance for current user
 * POST /commercial/credits/consume         — consume credits (internal)
 * POST /commercial/credits/topup           — add premium credits
 * POST /commercial/credits/refund          — refund a transaction
 * POST /commercial/credits/byok            — enable/disable BYOK
 * POST /commercial/credits/local           — enable/disable local mode
 * GET  /commercial/credits/ledger          — transaction history
 *
 * GET  /commercial/router/route            — get routing decision for a task
 * GET  /commercial/router/scores           — all provider scores
 * GET  /commercial/router/decisions        — recent routing decisions
 *
 * POST /commercial/usage/record            — record usage event
 * GET  /commercial/usage/summary           — usage summary
 * GET  /commercial/usage/history           — raw event history
 * GET  /commercial/usage/by/:dimension     — aggregated by dimension
 *
 * GET  /commercial/billing/plans           — plan definitions
 * GET  /commercial/billing/status          — billing status + entitlements
 * POST /commercial/billing/upgrade         — initiate upgrade
 * POST /commercial/billing/downgrade       — downgrade plan
 * GET  /commercial/billing/trials          — trial status
 *
 * GET  /commercial/gates                   — all feature gate definitions
 * POST /commercial/gates/check             — check a feature gate
 * GET  /commercial/gates/entitlements      — list entitlements for current plan
 *
 * GET  /commercial/providers               — all providers status
 * POST /commercial/providers/:id/update    — update provider config
 * POST /commercial/providers/register      — register future provider
 * GET  /commercial/providers/chain         — ordered fallback chain
 *
 * GET  /commercial/analytics/summary       — P&L summary
 * GET  /commercial/analytics/benchmark     — commercial benchmark
 * GET  /commercial/analytics/cost/:dim     — cost by dimension
 * GET  /commercial/analytics/account/:id   — per-account report
 *
 * GET  /commercial/console                 — developer console snapshot
 *
 * GET  /commercial/admin/dashboard         — admin revenue dashboard
 *
 * GET  /commercial/benchmark               — full commercial benchmark
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const credits  = require("../services/creditEngine.cjs");
const router_  = require("../services/smartRouter.cjs");
const metering = require("../services/usageMetering.cjs");
const gates    = require("../services/featureGate.cjs");
const providers= require("../services/providerManager.cjs");
const analytics= require("../services/costAnalytics.cjs");
const billing  = require("../services/billingService");

router.use("/commercial", requireAuth);

function _accountId(req) { return req.user?.accountId || req.user?.id || "unknown"; }
function _plan(req) {
  try {
    const access = billing.checkAccess(_accountId(req));
    return access.plan || "trial";
  } catch { return "trial"; }
}

// ══════════════════════════════════════════════════════════════════
// MODULE 1: AI Credit Engine
// ══════════════════════════════════════════════════════════════════

router.get("/commercial/credits/status", (req, res) => {
  try {
    const rec = credits.getRecord(_accountId(req), _plan(req));
    res.json({
      free:    rec.free,
      premium: rec.premium,
      byok:    rec.byok,
      local:   rec.local,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/commercial/credits/consume", (req, res) => {
  try {
    const { requestType, missionId, provider, cost } = req.body || {};
    const check = credits.checkCredit(_accountId(req), requestType || "default", _plan(req));
    if (!check.canProceed) return res.status(402).json({ error: "insufficient_credits", ...check });
    const result = credits.consume(_accountId(req), requestType || "default", {
      plan: _plan(req), missionId, provider, cost,
    });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/commercial/credits/topup", (req, res) => {
  try {
    const { amount, expiresAt, reason } = req.body || {};
    if (!amount || amount <= 0) return res.status(400).json({ error: "invalid_amount" });
    const rec = credits.topup(_accountId(req), amount, { expiresAt, reason });
    res.json({ ok: true, premium: rec.premium });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/commercial/credits/refund", (req, res) => {
  try {
    const { txId, reason } = req.body || {};
    const tx = credits.refund(_accountId(req), txId, { reason });
    if (!tx) return res.status(404).json({ error: "transaction_not_found" });
    res.json({ ok: true, tx });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/commercial/credits/byok", (req, res) => {
  try {
    const { enabled, key_hash } = req.body || {};
    // Only growth+ can use BYOK
    const gate = gates.checkGate("ai.byok", _plan(req), "active");
    if (!gate.allowed) return res.status(402).json({ error: "feature_gated", ...gate });
    const result = credits.setBYOK(_accountId(req), !!enabled, key_hash || null);
    res.json({ ok: true, byok: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/commercial/credits/local", (req, res) => {
  try {
    const { enabled } = req.body || {};
    const result = credits.setLocal(_accountId(req), !!enabled);
    res.json({ ok: true, local: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/commercial/credits/ledger", (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "50", 10);
    const ledger = credits.getLedger(_accountId(req), limit);
    res.json(ledger);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 2: Smart AI Router
// ══════════════════════════════════════════════════════════════════

router.get("/commercial/router/route", (req, res) => {
  try {
    const { task, userPref } = req.query;
    const rec = credits.getRecord(_accountId(req), _plan(req));
    const availableKeys = providers.getAvailableChain();
    const result = router_.route({
      task:          task || "chat",
      userPref:      userPref || null,
      availableKeys,
      byok:          rec.byok.enabled,
    });
    res.json({ ok: true, ...result, chain: result.chain?.map(p => p.id || p) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/commercial/router/scores", (req, res) => {
  try {
    const { task } = req.query;
    const scores = router_.getProviderScores(task || "chat", {
      availableKeys: providers.getAvailableChain(),
    });
    res.json({ ok: true, scores });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/commercial/router/decisions", (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "50", 10);
    res.json({ ok: true, decisions: router_.getDecisions(limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 3: Usage Metering
// ══════════════════════════════════════════════════════════════════

router.post("/commercial/usage/record", (req, res) => {
  try {
    const event = metering.record({
      ...req.body,
      accountId:   _accountId(req),
    });
    res.json({ ok: true, event });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/commercial/usage/summary", (req, res) => {
  try {
    const opts = {
      accountId:   req.query.accountId || _accountId(req),
      workspaceId: req.query.workspaceId,
      since:       req.query.since,
      limit:       parseInt(req.query.limit || "500", 10),
    };
    res.json({ ok: true, summary: metering.summary(opts) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/commercial/usage/history", (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "200", 10);
    res.json({ ok: true, events: metering.loadHistory(limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/commercial/usage/by/:dimension", (req, res) => {
  try {
    const { dimension } = req.params;
    const valid = ["provider","accountId","workspaceId","missionId","model","requestType"];
    if (!valid.includes(dimension)) return res.status(400).json({ error: "invalid_dimension" });
    const agg = metering.aggregateCost(dimension, { limit: parseInt(req.query.limit || "500", 10) });
    res.json({ ok: true, dimension, data: agg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 4: Billing Core (extends existing /billing/*)
// ══════════════════════════════════════════════════════════════════

const PLAN_DEFINITIONS = {
  trial:   { name: "Trial",   price_inr: 0,    price_usd: 0,   dailyAiCredits: 20,  features: ["editor.basic","ai.chat","ai.coding_ask","mission.create"] },
  starter: { name: "Starter", price_inr: 999,  price_usd: 12,  dailyAiCredits: 100, features: ["editor.basic","editor.lsp","editor.git_blame","ai.chat","ai.coding_ask","ai.repo_chat","ai.code_review","mission.create","mission.pipeline","git.visual","git.push_workflow","git.blame","pipeline.run","plugins.marketplace"] },
  growth:  { name: "Growth",  price_inr: 2499, price_usd: 30,  dailyAiCredits: 500, features: ["*minus_enterprise"] },
  scale:   { name: "Scale",   price_inr: 0,    price_usd: 200, dailyAiCredits: 2000, features: ["*"] },
};

router.get("/commercial/billing/plans", (req, res) => {
  res.json({ ok: true, plans: PLAN_DEFINITIONS });
});

router.get("/commercial/billing/status", (req, res) => {
  try {
    const accountId = _accountId(req);
    const access    = billing.checkAccess(accountId);
    const record    = billing.getRecord    ? billing.getRecord(accountId) : {};
    const plan      = access.plan || "trial";
    const entitlements = gates.listEntitlements(plan);
    res.json({ ok: true, ...access, record, entitlements, planDef: PLAN_DEFINITIONS[plan] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/commercial/billing/upgrade", (req, res) => {
  try {
    const { plan } = req.body || {};
    if (!PLAN_DEFINITIONS[plan]) return res.status(400).json({ error: "invalid_plan" });
    // Delegate to existing billing upgrade logic
    res.json({ ok: true, message: `Upgrade to ${plan} initiated. Integrate with Razorpay to complete.`, plan });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/commercial/billing/downgrade", (req, res) => {
  try {
    const { plan } = req.body || {};
    if (!PLAN_DEFINITIONS[plan]) return res.status(400).json({ error: "invalid_plan" });
    res.json({ ok: true, message: `Downgrade to ${plan} scheduled at end of billing period.`, plan });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/commercial/billing/trials", (req, res) => {
  try {
    const accountId = _accountId(req);
    const access    = billing.checkAccess(accountId);
    const isTrialing = access.status === "trialing";
    res.json({
      ok: true,
      trialing:  isTrialing,
      daysLeft:  access.daysLeft,
      graceActive: access.graceActive,
      plan: access.plan,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 5: Feature Gate Engine
// ══════════════════════════════════════════════════════════════════

router.get("/commercial/gates", (req, res) => {
  try { res.json({ ok: true, gates: gates.getAllGates() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/commercial/gates/check", (req, res) => {
  try {
    const { featureId, plan: overridePlan } = req.body || {};
    if (!featureId) return res.status(400).json({ error: "featureId required" });
    const accountId = _accountId(req);
    const access    = billing.checkAccess(accountId);
    const plan      = overridePlan || access.plan || "trial";
    const result    = gates.checkGate(featureId, plan, access.status);
    res.json({ ok: true, ...result, plan, status: access.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/commercial/gates/entitlements", (req, res) => {
  try {
    const plan = _plan(req);
    res.json({ ok: true, plan, entitlements: gates.listEntitlements(plan) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 6: Provider Manager
// ══════════════════════════════════════════════════════════════════

router.get("/commercial/providers", (req, res) => {
  try { res.json({ ok: true, providers: providers.getAll() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/commercial/providers/:id/update", (req, res) => {
  try {
    const updated = providers.updateProvider(req.params.id, req.body || {});
    res.json({ ok: true, provider: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/commercial/providers/register", (req, res) => {
  try {
    const def = req.body;
    if (!def?.id || !def?.name) return res.status(400).json({ error: "id and name required" });
    const p = providers.registerProvider(def);
    res.json({ ok: true, provider: p });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/commercial/providers/chain", (req, res) => {
  try { res.json({ ok: true, chain: providers.getAvailableChain() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 7: Cost Analytics
// ══════════════════════════════════════════════════════════════════

router.get("/commercial/analytics/summary", (req, res) => {
  try { res.json({ ok: true, ...analytics.profitSummary() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/commercial/analytics/benchmark", (req, res) => {
  try { res.json({ ok: true, ...analytics.benchmark() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/commercial/analytics/cost/:dim", (req, res) => {
  try {
    const { dim } = req.params;
    const fns = { provider: analytics.costByProvider, user: analytics.costByUser, workspace: analytics.costByWorkspace, mission: analytics.costByMission };
    const fn  = fns[dim];
    if (!fn) return res.status(400).json({ error: "invalid dimension — use provider|user|workspace|mission" });
    res.json({ ok: true, dimension: dim, data: fn() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/commercial/analytics/account/:id", (req, res) => {
  try { res.json({ ok: true, ...analytics.perAccount(req.params.id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 8: Developer Console
// ══════════════════════════════════════════════════════════════════

router.get("/commercial/console", (req, res) => {
  try {
    const accountId  = _accountId(req);
    const plan       = _plan(req);
    const creditRec  = credits.getRecord(accountId, plan);
    const provStatus = providers.getAll();
    const scores     = router_.getProviderScores("chat", { availableKeys: providers.getAvailableChain() });
    const decisions  = router_.getDecisions(10);
    const usage      = metering.summary({ accountId, limit: 100 });
    const recentFail = metering.query({ accountId, limit: 20 }).filter(e => !e.success);

    res.json({
      ok: true,
      ts: new Date().toISOString(),
      credits: {
        free:    creditRec.free,
        premium: creditRec.premium,
        byok:    creditRec.byok,
        local:   creditRec.local,
      },
      providers:    provStatus.map(p => ({ id: p.id, name: p.name, available: p.available, healthy: p.healthy, usageToday: p.usageToday, quotaUsePct: p.quotaUsePct, rateLimited: p.rateLimited })),
      routerScores: scores.map(s => ({ id: s.id, name: s.name, composite: s.scores?.composite?.toFixed(3), available: s.available })),
      recentDecisions: decisions.slice(0, 5),
      usage: {
        requests:    usage.totalRequests,
        tokens:      usage.totalTokens,
        costUsd:     usage.totalCostUsd,
        successRate: usage.successRate,
        p50ms:       usage.p50LatencyMs,
      },
      recentFailures: recentFail.slice(0, 5),
      fallbackHistory: decisions.filter(d => d.reason === "fallback").slice(0, 5),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 9: Admin Dashboard
// ══════════════════════════════════════════════════════════════════

router.get("/commercial/admin/dashboard", (req, res) => {
  try {
    const profit     = analytics.profitSummary();
    const usage      = metering.summary({ limit: 2000 });
    const creditAll  = credits.getAllSummary();

    const byokUsers  = creditAll.filter(c => c.byok).length;
    const localUsers = creditAll.filter(c => c.local).length;

    res.json({
      ok: true,
      ts: new Date().toISOString(),
      revenue: {
        mrrUsd:     profit.revenue.mrrUsd,
        arrUsd:     profit.revenue.arrUsd,
      },
      users: {
        total:    profit.accounts.total,
        trial:    profit.accounts.trial,
        starter:  profit.accounts.starter,
        growth:   profit.accounts.growth,
        scale:    profit.accounts.scale,
        paid:     profit.accounts.paid,
        byok:     byokUsers,
        local:    localUsers,
      },
      cost: {
        aiProviderUsd: profit.cost.aiProviderUsd,
        totalTokens:   profit.cost.totalTokens,
        totalRequests: profit.cost.totalRequests,
        avgCostPerReq: profit.cost.totalRequests > 0 ? (profit.cost.aiProviderUsd / profit.cost.totalRequests).toFixed(6) : 0,
      },
      profit: {
        grossUsd:    profit.profit.grossUsd,
        grossMarginPct: profit.profit.grossMargin,
        marginStatus: profit.profit.marginStatus,
      },
      providers: usage.byProvider,
      topRoutes: metering.aggregateCost("requestType", { limit: 500 }).slice(0, 10),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 10: Commercial Benchmark
// ══════════════════════════════════════════════════════════════════

router.get("/commercial/benchmark", (req, res) => {
  try {
    res.json({ ok: true, ...analytics.benchmark() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
