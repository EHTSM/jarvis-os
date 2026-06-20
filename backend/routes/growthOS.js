"use strict";
/**
 * Growth Operating System — G1
 * All routes under /growth/*
 * 10 modules: Email, SMS, WhatsApp, Push, Automation, Audience, Analytics, Templates, Dashboard, Benchmark
 */

const router          = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const g               = require("../services/growthOS.cjs");

router.use(requireAuth);

function _account(req) { return req.user?.accountId || req.user?.id || "unknown"; }

// ══════════════════════════════════════════════════════════════════
// MODULE 1: Email Marketing OS
// ══════════════════════════════════════════════════════════════════

// Campaigns
router.get("/growth/email/campaigns",        (req, res) => {
  try { res.json({ ok: true, campaigns: g.listEmailCampaigns(req.query.status) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/email/campaigns",       (req, res) => {
  try {
    const c = g.createEmailCampaign(req.body || {});
    res.json({ ok: true, campaign: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/growth/email/campaigns/:id",  (req, res) => {
  try {
    const c = g.updateEmailCampaign(req.params.id, req.body || {});
    res.json({ ok: true, campaign: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/email/campaigns/:id/send", (req, res) => {
  try {
    const c = g.sendEmailCampaign(req.params.id);
    res.json({ ok: true, campaign: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sequences
router.get("/growth/email/sequences",        (req, res) => {
  try { res.json({ ok: true, sequences: g.listSequences() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/email/sequences",       (req, res) => {
  try {
    const s = g.createSequence(req.body || {});
    res.json({ ok: true, sequence: s });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/growth/email/sequences/:id",    (req, res) => {
  try {
    const s = g.getSequence(req.params.id);
    if (!s) return res.status(404).json({ error: "Sequence not found" });
    res.json({ ok: true, sequence: s });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 2: SMS Marketing OS
// ══════════════════════════════════════════════════════════════════

router.get("/growth/sms/campaigns",          (req, res) => {
  try { res.json({ ok: true, campaigns: g.listSMSCampaigns(req.query.status) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/sms/campaigns",         (req, res) => {
  try {
    const c = g.createSMSCampaign(req.body || {});
    res.json({ ok: true, campaign: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/sms/campaigns/:id/send",(req, res) => {
  try {
    const c = g.sendSMSCampaign(req.params.id);
    res.json({ ok: true, campaign: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/sms/otp",               (req, res) => {
  try {
    const { to, otp } = req.body || {};
    if (!to) return res.status(400).json({ error: "to required" });
    const result = g.sendOTP(to, otp || Math.floor(100000 + Math.random() * 900000).toString());
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 3: WhatsApp Business OS
// ══════════════════════════════════════════════════════════════════

router.get("/growth/whatsapp/campaigns",           (req, res) => {
  try { res.json({ ok: true, campaigns: g.listWhatsAppCampaigns(req.query.status) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/whatsapp/broadcasts",         (req, res) => {
  try {
    const c = g.createWhatsAppBroadcast(req.body || {});
    res.json({ ok: true, campaign: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/whatsapp/broadcasts/:id/send",(req, res) => {
  try {
    const c = g.sendWhatsAppBroadcast(req.params.id);
    res.json({ ok: true, campaign: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/whatsapp/broadcasts/:id/sync-crm", (req, res) => {
  try {
    const result = g.syncWhatsAppCRM(req.params.id);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 4: Push Notification Center
// ══════════════════════════════════════════════════════════════════

router.post("/growth/push/register",         (req, res) => {
  try {
    const { token, platform } = req.body || {};
    if (!token) return res.status(400).json({ error: "token required" });
    const result = g.registerPushToken(_account(req), token, platform || "web");
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/push/send",             (req, res) => {
  try {
    const { title, body } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: "title and body required" });
    const result = g.sendPushNotification(req.body);
    res.json({ ok: true, campaign: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/growth/push/campaigns",         (req, res) => {
  try { res.json({ ok: true, campaigns: g.listPushCampaigns() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 5: Marketing Automation Builder
// ══════════════════════════════════════════════════════════════════

router.get("/growth/automations",            (req, res) => {
  try { res.json({ ok: true, automations: g.listAutomations() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/automations",           (req, res) => {
  try {
    const a = g.createAutomation(req.body || {});
    res.json({ ok: true, automation: a });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/growth/automations/:id",      (req, res) => {
  try {
    const a = g.updateAutomation(req.params.id, req.body || {});
    res.json({ ok: true, automation: a });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/automations/:id/trigger",(req, res) => {
  try {
    const result = g.triggerAutomation(req.params.id, req.body || {});
    res.json({ ok: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/growth/automations/meta/triggers",(req, res) => {
  try { res.json({ ok: true, triggers: g.getTriggerTypes(), actions: g.getActionTypes() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 6: Audience Manager
// ══════════════════════════════════════════════════════════════════

router.get("/growth/audiences",              (req, res) => {
  try { res.json({ ok: true, audiences: g.listAudiences(req.query.type) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/audiences",             (req, res) => {
  try {
    const a = g.createAudience(req.body || {});
    res.json({ ok: true, audience: a });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/growth/audiences/:id",          (req, res) => {
  try {
    const a = g.getAudience(req.params.id);
    if (!a) return res.status(404).json({ error: "Audience not found" });
    res.json({ ok: true, audience: a });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/growth/audiences/:id",        (req, res) => {
  try {
    const a = g.updateAudience(req.params.id, req.body || {});
    res.json({ ok: true, audience: a });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/audiences/:id/add",     (req, res) => {
  try {
    const { memberIds } = req.body || {};
    if (!Array.isArray(memberIds)) return res.status(400).json({ error: "memberIds array required" });
    const a = g.addToAudience(req.params.id, memberIds);
    res.json({ ok: true, audience: a });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/audiences/:id/remove",  (req, res) => {
  try {
    const { memberIds } = req.body || {};
    if (!Array.isArray(memberIds)) return res.status(400).json({ error: "memberIds array required" });
    const a = g.removeFromAudience(req.params.id, memberIds);
    res.json({ ok: true, audience: a });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/audiences/:id/sync-crm",(req, res) => {
  try {
    const a = g.syncCRMToAudience(req.params.id);
    res.json({ ok: true, audience: a });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 7: Campaign Analytics
// ══════════════════════════════════════════════════════════════════

router.get("/growth/analytics",              (req, res) => {
  try { res.json({ ok: true, analytics: g.getOverallAnalytics() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/growth/analytics/:campaignId",  (req, res) => {
  try {
    const a = g.getCampaignAnalytics(req.params.campaignId);
    if (!a) return res.status(404).json({ error: "Campaign not found" });
    res.json({ ok: true, analytics: a });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/analytics/:campaignId/conversion", (req, res) => {
  try {
    const { revenue, contactId } = req.body || {};
    const result = g.recordConversion(req.params.campaignId, { revenue, contactId });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 8: Template Marketplace
// ══════════════════════════════════════════════════════════════════

router.get("/growth/templates",              (req, res) => {
  try {
    const list = g.listTemplates(req.query.type, req.query.category);
    res.json({ ok: true, templates: list, count: list.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/growth/templates/:id",          (req, res) => {
  try {
    const t = g.getTemplate(req.params.id);
    if (!t) return res.status(404).json({ error: "Template not found" });
    res.json({ ok: true, template: t });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/growth/templates",             (req, res) => {
  try {
    const t = g.createTemplate(req.body || {});
    res.json({ ok: true, template: t });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 9: Growth Dashboard
// ══════════════════════════════════════════════════════════════════

router.get("/growth/dashboard",              (req, res) => {
  try { res.json({ ok: true, dashboard: g.getGrowthDashboard() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 10: Commercial Benchmark
// ══════════════════════════════════════════════════════════════════

router.get("/growth/benchmark",              (req, res) => {
  try {
    const result = g.runBenchmark();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
