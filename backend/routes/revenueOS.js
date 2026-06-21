"use strict";
/**
 * Growth Operating System — G4
 * Revenue Operating System
 * All routes under /revenue/*
 *
 * 10 modules: Revenue Dashboard, Subscription Lifecycle, Upgrade Intelligence,
 *             Customer Success, Churn Prevention, Revenue Forecasting,
 *             Affiliate & Partner, Finance Center, Executive Revenue Center, Benchmark
 */

const router          = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const g               = require("../services/revenueOS.cjs");

router.use(requireAuth);

function _ok(res, data)           { res.json({ ok: true, ...data }); }
function _err(res, e, code = 500) { res.status(code).json({ error: e.message || e }); }

// ══════════════════════════════════════════════════════════════════
// MODULE 1: Revenue Dashboard
// ══════════════════════════════════════════════════════════════════

router.get("/revenue/dashboard",            (req, res) => {
  try { _ok(res, { dashboard: g.getRevenueDashboard(), plans: g.PLANS, planLTV: g.PLAN_LTV }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 2: Subscription Lifecycle
// ══════════════════════════════════════════════════════════════════

router.get("/revenue/subscriptions/:accountId", (req, res) => {
  try { _ok(res, { subscription: g.getSubscriptionRecord(req.params.accountId), transitions: g.LIFECYCLE_TRANSITIONS }); }
  catch (e) { _err(res, e); }
});

router.post("/revenue/subscriptions/:accountId/upgrade", (req, res) => {
  try {
    const { plan } = req.body || {};
    if (!plan) return res.status(400).json({ error: "plan required" });
    _ok(res, g.upgradeSubscription(req.params.accountId, plan));
  } catch (e) { _err(res, e); }
});

router.post("/revenue/subscriptions/:accountId/pause",   (req, res) => {
  try {
    const { pauseUntil } = req.body || {};
    _ok(res, g.pauseSubscription(req.params.accountId, pauseUntil));
  } catch (e) { _err(res, e); }
});

router.post("/revenue/subscriptions/:accountId/cancel",  (req, res) => {
  try {
    const { reason } = req.body || {};
    _ok(res, g.cancelSubscription(req.params.accountId, reason));
  } catch (e) { _err(res, e); }
});

router.post("/revenue/subscriptions/:accountId/reactivate", (req, res) => {
  try {
    const { plan } = req.body || {};
    _ok(res, g.reactivateSubscription(req.params.accountId, plan));
  } catch (e) { _err(res, e); }
});

router.get("/revenue/lifecycle/events",      (req, res) => {
  try { _ok(res, { events: g.listLifecycleEvents(req.query.accountId, Number(req.query.limit) || 50) }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 3: Upgrade Intelligence
// ══════════════════════════════════════════════════════════════════

router.get("/revenue/upgrade/detect/:accountId", (req, res) => {
  try {
    const signals = req.query.signals ? req.query.signals.split(",") : [];
    _ok(res, { intelligence: g.detectUpgradeMoment(req.params.accountId, signals), upgradeSignals: g.UPGRADE_SIGNALS });
  } catch (e) { _err(res, e); }
});

router.post("/revenue/upgrade/signal",       (req, res) => {
  try {
    const { accountId, signalId, meta } = req.body || {};
    if (!accountId || !signalId) return res.status(400).json({ error: "accountId and signalId required" });
    _ok(res, { result: g.recordUpgradeSignal(accountId, signalId, meta || {}) });
  } catch (e) { _err(res, e); }
});

router.get("/revenue/upgrade/signals",       (req, res) => {
  try { _ok(res, { signals: g.listUpgradeSignals(req.query.accountId), definitions: g.UPGRADE_SIGNALS, prompts: g.UPGRADE_PROMPTS }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 4: Customer Success Automation
// ══════════════════════════════════════════════════════════════════

router.get("/revenue/success/health/:accountId", (req, res) => {
  try { _ok(res, { health: g.getCustomerHealth(req.params.accountId), playbooks: g.SUCCESS_PLAYBOOKS }); }
  catch (e) { _err(res, e); }
});

router.post("/revenue/success/health/:accountId/note", (req, res) => {
  try {
    const { note } = req.body || {};
    if (!note) return res.status(400).json({ error: "note required" });
    _ok(res, { health: g.addHealthNote(req.params.accountId, note) });
  } catch (e) { _err(res, e); }
});

router.post("/revenue/success/reminder",     (req, res) => {
  try {
    const { accountId, daysOut } = req.body || {};
    if (!accountId) return res.status(400).json({ error: "accountId required" });
    _ok(res, { reminder: g.sendRenewalReminder(accountId, daysOut || 30) });
  } catch (e) { _err(res, e); }
});

router.get("/revenue/success/health",        (req, res) => {
  try {
    const min = req.query.minScore !== undefined ? Number(req.query.minScore) : undefined;
    const max = req.query.maxScore !== undefined ? Number(req.query.maxScore) : undefined;
    _ok(res, { accounts: g.listCustomerHealth(min, max) });
  } catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 5: Churn Prevention
// ══════════════════════════════════════════════════════════════════

router.get("/revenue/churn/detect/:accountId", (req, res) => {
  try {
    const signals = req.query.signals ? req.query.signals.split(",") : [];
    _ok(res, { risk: g.detectChurnRisk(req.params.accountId, signals), churnSignals: g.CHURN_SIGNALS });
  } catch (e) { _err(res, e); }
});

router.get("/revenue/churn/risks",           (req, res) => {
  try { _ok(res, { risks: g.listChurnRisks(req.query.level), templates: g.WINBACK_TEMPLATES }); }
  catch (e) { _err(res, e); }
});

router.post("/revenue/churn/winback",        (req, res) => {
  try {
    const { accountId, templateId } = req.body || {};
    if (!accountId) return res.status(400).json({ error: "accountId required" });
    _ok(res, { campaign: g.createWinBackCampaign(accountId, templateId || "wbt_1") });
  } catch (e) { _err(res, e); }
});

router.post("/revenue/churn/exit-survey",    (req, res) => {
  try {
    const { accountId, ...data } = req.body || {};
    if (!accountId) return res.status(400).json({ error: "accountId required" });
    _ok(res, { survey: g.submitExitSurvey(accountId, data) });
  } catch (e) { _err(res, e); }
});

router.get("/revenue/churn/exit-surveys",    (req, res) => {
  try { _ok(res, { surveys: g.listExitSurveys() }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 6: Revenue Forecasting
// ══════════════════════════════════════════════════════════════════

router.post("/revenue/forecast",             (req, res) => {
  try { _ok(res, { forecast: g.runForecast(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/revenue/forecast/simulate",    (req, res) => {
  try { _ok(res, { simulation: g.simulateScenario(req.body || {}), assumptions: g.SCENARIOS }); }
  catch (e) { _err(res, e); }
});

router.get("/revenue/forecasts",             (req, res) => {
  try { _ok(res, { forecasts: g.listForecasts() }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 7: Affiliate & Partner Center
// ══════════════════════════════════════════════════════════════════

router.get("/revenue/affiliates",            (req, res) => {
  try { _ok(res, { affiliates: g.listAffiliates(req.query.tier, req.query.status), analytics: g.getAffiliateAnalytics(), tiers: g.AFFILIATE_TIERS }); }
  catch (e) { _err(res, e); }
});

router.post("/revenue/affiliates",           (req, res) => {
  try { _ok(res, { affiliate: g.createAffiliate(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/revenue/affiliates/:id/conversion", (req, res) => {
  try { _ok(res, g.recordAffiliateConversion(req.params.id, req.body || {})); }
  catch (e) { _err(res, e); }
});

router.post("/revenue/affiliates/:id/payout", (req, res) => {
  try { _ok(res, g.processAffiliatePayout(req.params.id)); }
  catch (e) { _err(res, e, 400); }
});

router.get("/revenue/affiliates/analytics", (req, res) => {
  try { _ok(res, { analytics: g.getAffiliateAnalytics() }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 8: Finance Center
// ══════════════════════════════════════════════════════════════════

router.get("/revenue/finance/invoices",      (req, res) => {
  try { _ok(res, { invoices: g.listInvoices(req.query.accountId, req.query.status) }); }
  catch (e) { _err(res, e); }
});

router.post("/revenue/finance/invoices",     (req, res) => {
  try { _ok(res, { invoice: g.generateInvoice(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/revenue/finance/invoices/:id/pay", (req, res) => {
  try { _ok(res, { invoice: g.markInvoicePaid(req.params.id) }); }
  catch (e) { _err(res, e); }
});

router.get("/revenue/finance/credit-notes",  (req, res) => {
  try { _ok(res, { creditNotes: g.listCreditNotes(req.query.accountId) }); }
  catch (e) { _err(res, e); }
});

router.post("/revenue/finance/refund",       (req, res) => {
  try { _ok(res, { creditNote: g.issueRefund(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.get("/revenue/finance/report",        (req, res) => {
  try { _ok(res, { report: g.getRevenueReport(req.query.period || "monthly"), taxRates: g.TAX_RATES }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 9: Executive Revenue Center
// ══════════════════════════════════════════════════════════════════

router.get("/revenue/executive",             (req, res) => {
  try { _ok(res, { dashboard: g.getExecutiveRevenueDashboard() }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 10: Commercial Benchmark
// ══════════════════════════════════════════════════════════════════

router.get("/revenue/benchmark",             (req, res) => {
  try { _ok(res, g.runBenchmark()); }
  catch (e) { _err(res, e); }
});

module.exports = router;
