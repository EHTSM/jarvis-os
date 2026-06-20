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

function _ok(res, data)   { res.json({ ok: true, ...data }); }
function _err(res, e, code = 500) { res.status(code).json({ error: e.message || e }); }

// ══════════════════════════════════════════════════════════════════
// MODULE 1: Email Marketing OS
// ══════════════════════════════════════════════════════════════════

router.get("/growth/email/campaigns",            (req, res) => {
  try { _ok(res, { campaigns: g.listEmailCampaigns(req.query.status) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/email/campaigns",           (req, res) => {
  try { _ok(res, { campaign: g.createEmailCampaign(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.patch("/growth/email/campaigns/:id",      (req, res) => {
  try { _ok(res, { campaign: g.updateEmailCampaign(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/email/campaigns/:id/send",  (req, res) => {
  try { _ok(res, { campaign: g.sendEmailCampaign(req.params.id) }); }
  catch (e) { _err(res, e); }
});

router.get("/growth/email/sequences",            (req, res) => {
  try { _ok(res, { sequences: g.listSequences() }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/email/sequences",           (req, res) => {
  try { _ok(res, { sequence: g.createSequence(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.patch("/growth/email/sequences/:id",      (req, res) => {
  try { _ok(res, { sequence: g.updateSequence(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.get("/growth/email/sequences/:id",        (req, res) => {
  try {
    const s = g.getSequence(req.params.id);
    if (!s) return res.status(404).json({ error: "Sequence not found" });
    _ok(res, { sequence: s });
  } catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 2: SMS Marketing OS
// ══════════════════════════════════════════════════════════════════

router.get("/growth/sms/campaigns",              (req, res) => {
  try { _ok(res, { campaigns: g.listSMSCampaigns(req.query.status) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/sms/campaigns",             (req, res) => {
  try { _ok(res, { campaign: g.createSMSCampaign(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.patch("/growth/sms/campaigns/:id",        (req, res) => {
  try { _ok(res, { campaign: g.updateSMSCampaign(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/sms/campaigns/:id/send",    (req, res) => {
  try { _ok(res, { campaign: g.sendSMSCampaign(req.params.id) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/sms/campaigns/:id/schedule",(req, res) => {
  try {
    const { scheduledAt } = req.body || {};
    if (!scheduledAt) return res.status(400).json({ error: "scheduledAt required" });
    _ok(res, { campaign: g.scheduleSMSCampaign(req.params.id, scheduledAt) });
  } catch (e) { _err(res, e); }
});

router.post("/growth/sms/otp",                   (req, res) => {
  try {
    const { to, otp } = req.body || {};
    if (!to) return res.status(400).json({ error: "to required" });
    _ok(res, g.sendOTP(to, otp || Math.floor(100000 + Math.random() * 900000).toString()));
  } catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 3: WhatsApp Business OS
// ══════════════════════════════════════════════════════════════════

router.get("/growth/whatsapp/campaigns",               (req, res) => {
  try { _ok(res, { campaigns: g.listWhatsAppCampaigns(req.query.status) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/whatsapp/broadcasts",             (req, res) => {
  try { _ok(res, { campaign: g.createWhatsAppBroadcast(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/whatsapp/broadcasts/:id/send",    (req, res) => {
  try { _ok(res, { campaign: g.sendWhatsAppBroadcast(req.params.id) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/whatsapp/broadcasts/:id/sync-crm",(req, res) => {
  try { _ok(res, g.syncWhatsAppCRM(req.params.id)); }
  catch (e) { _err(res, e); }
});

// WA Flows
router.get("/growth/whatsapp/flows",                   (req, res) => {
  try { _ok(res, { flows: g.listWAFlows() }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/whatsapp/flows",                  (req, res) => {
  try { _ok(res, { flow: g.createWAFlow(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.patch("/growth/whatsapp/flows/:id",             (req, res) => {
  try { _ok(res, { flow: g.updateWAFlow(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

// WA Auto-replies
router.get("/growth/whatsapp/auto-replies",            (req, res) => {
  try { _ok(res, { rules: g.listAutoReplyRules() }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/whatsapp/auto-replies",           (req, res) => {
  try { _ok(res, { rule: g.createAutoReplyRule(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 4: Push Notification Center
// ══════════════════════════════════════════════════════════════════

router.post("/growth/push/register",             (req, res) => {
  try {
    const { token, platform } = req.body || {};
    if (!token) return res.status(400).json({ error: "token required" });
    const accountId = req.user?.accountId || req.user?.id || "unknown";
    _ok(res, g.registerPushToken(accountId, token, platform || "web"));
  } catch (e) { _err(res, e); }
});

router.post("/growth/push/send",                 (req, res) => {
  try {
    const { title, body } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: "title and body required" });
    _ok(res, { campaign: g.sendPushNotification(req.body) });
  } catch (e) { _err(res, e); }
});

router.get("/growth/push/campaigns",             (req, res) => {
  try { _ok(res, { campaigns: g.listPushCampaigns() }); }
  catch (e) { _err(res, e); }
});

router.get("/growth/push/triggers",              (req, res) => {
  try { _ok(res, { rules: g.listPushTriggerRules() }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/push/triggers",             (req, res) => {
  try { _ok(res, { rule: g.createPushTriggerRule(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 5: Marketing Automation Builder
// ══════════════════════════════════════════════════════════════════

router.get("/growth/automations",                (req, res) => {
  try { _ok(res, { automations: g.listAutomations() }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/automations",               (req, res) => {
  try { _ok(res, { automation: g.createAutomation(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.patch("/growth/automations/:id",          (req, res) => {
  try { _ok(res, { automation: g.updateAutomation(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/automations/:id/trigger",   (req, res) => {
  try { _ok(res, { result: g.triggerAutomation(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.get("/growth/automations/meta/triggers",  (req, res) => {
  try { _ok(res, { triggers: g.getTriggerTypes(), actions: g.getActionTypes() }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 6: Audience Manager
// ══════════════════════════════════════════════════════════════════

router.get("/growth/audiences",                  (req, res) => {
  try { _ok(res, { audiences: g.listAudiences(req.query.type) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/audiences",                 (req, res) => {
  try { _ok(res, { audience: g.createAudience(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.get("/growth/audiences/:id",              (req, res) => {
  try {
    const a = g.getAudience(req.params.id);
    if (!a) return res.status(404).json({ error: "Audience not found" });
    _ok(res, { audience: a });
  } catch (e) { _err(res, e); }
});

router.patch("/growth/audiences/:id",            (req, res) => {
  try { _ok(res, { audience: g.updateAudience(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/audiences/:id/add",         (req, res) => {
  try {
    const { memberIds } = req.body || {};
    if (!Array.isArray(memberIds)) return res.status(400).json({ error: "memberIds array required" });
    _ok(res, { audience: g.addToAudience(req.params.id, memberIds) });
  } catch (e) { _err(res, e); }
});

router.post("/growth/audiences/:id/remove",      (req, res) => {
  try {
    const { memberIds } = req.body || {};
    if (!Array.isArray(memberIds)) return res.status(400).json({ error: "memberIds array required" });
    _ok(res, { audience: g.removeFromAudience(req.params.id, memberIds) });
  } catch (e) { _err(res, e); }
});

router.post("/growth/audiences/:id/sync-crm",    (req, res) => {
  try { _ok(res, { audience: g.syncCRMToAudience(req.params.id) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/audiences/:id/evaluate",    (req, res) => {
  try { _ok(res, { audience: g.evaluateDynamicAudience(req.params.id) }); }
  catch (e) { _err(res, e); }
});

router.get("/growth/tags",                       (req, res) => {
  try { _ok(res, { tags: g.listTags() }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/tags",                      (req, res) => {
  try {
    const { name, color } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    _ok(res, { tag: g.createTag(name, color) });
  } catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 7: Campaign Analytics
// ══════════════════════════════════════════════════════════════════

router.get("/growth/analytics",                  (req, res) => {
  try { _ok(res, { analytics: g.getOverallAnalytics() }); }
  catch (e) { _err(res, e); }
});

router.get("/growth/analytics/:campaignId",      (req, res) => {
  try {
    const a = g.getCampaignAnalytics(req.params.campaignId);
    if (!a) return res.status(404).json({ error: "Campaign not found" });
    _ok(res, { analytics: a });
  } catch (e) { _err(res, e); }
});

router.post("/growth/analytics/:campaignId/conversion", (req, res) => {
  try {
    const { revenue, contactId } = req.body || {};
    _ok(res, g.recordConversion(req.params.campaignId, { revenue, contactId }));
  } catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 8: Template Marketplace
// ══════════════════════════════════════════════════════════════════

router.get("/growth/templates",                  (req, res) => {
  try {
    const list = g.listTemplates(req.query.type, req.query.category);
    _ok(res, { templates: list, count: list.length });
  } catch (e) { _err(res, e); }
});

router.get("/growth/templates/:id",              (req, res) => {
  try {
    const t = g.getTemplate(req.params.id);
    if (!t) return res.status(404).json({ error: "Template not found" });
    _ok(res, { template: t });
  } catch (e) { _err(res, e); }
});

router.post("/growth/templates",                 (req, res) => {
  try { _ok(res, { template: g.createTemplate(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.patch("/growth/templates/:id",            (req, res) => {
  try { _ok(res, { template: g.updateTemplate(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 9: Growth Dashboard
// ══════════════════════════════════════════════════════════════════

router.get("/growth/dashboard",                  (req, res) => {
  try { _ok(res, { dashboard: g.getGrowthDashboard() }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 10: Commercial Benchmark
// ══════════════════════════════════════════════════════════════════

router.get("/growth/benchmark",                  (req, res) => {
  try { _ok(res, g.runBenchmark()); }
  catch (e) { _err(res, e); }
});

module.exports = router;
