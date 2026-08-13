"use strict";
/**
 * Growth Operating System — G1
 * All routes under /growth/*
 * 10 modules: Email, SMS, WhatsApp, Push, Automation, Audience, Analytics, Templates, Dashboard, Benchmark
 */

const router          = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter     = require("../middleware/rateLimiter");
const g               = require("../services/growthOS.cjs");
const crm             = require("../services/crmService");
const { parseCsvRecords } = require("../utils/csvParse.cjs");
const org             = () => require("../services/organizationService.cjs");

router.use("/growth", requireAuth);

// Founder Journey Completion finding: this whole router previously called
// every growthOS.cjs function with no orgId at all — see that service
// file's own header comment for the full cross-tenant leak this caused.
// Resolves the caller's org exactly once per request via
// organizationService.resolveContext(req.user.sub) — the same primary-org
// lookup attachOrg itself uses, and the same pattern already used to fix
// company-factory/dashboard — and stashes it on req.orgId for every route
// below to use. Not a new resolution path.
router.use("/growth", (req, res, next) => {
  try {
    const ctx = org().resolveContext(req.user.sub);
    req.orgId = ctx?.primaryOrg?.orgId || null;
  } catch { req.orgId = null; }
  next();
});

function _ok(res, data)   { res.json({ ok: true, ...data }); }

/**
 * Phase OS-2: mutating routes let the service layer THROW on a missing
 * entity, and every throw landed here as HTTP 500. Measured: PATCH/POST
 * against a nonexistent id returned 500 on 7 of 10 probed endpoints
 * ("Campaign nope-xyz not found", "Audience ... not found", …) while the
 * equivalent GET routes correctly returned 404 — they null-check instead of
 * relying on the throw.
 *
 * A 500 tells a client "the server broke, retry later"; a 404 tells it "that
 * id does not exist, stop". Monitoring and retry logic act on that difference,
 * so a client error reported as a server fault is a truthfulness defect.
 *
 * Classifying by the error the service already raises keeps this to one
 * helper rather than editing 50 call sites, and leaves genuine faults as 500.
 */
function _err(res, e, code) {
  const msg = e && e.message ? e.message : String(e);
  const status = code !== undefined ? code : (/\bnot found\b/i.test(msg) ? 404 : 500);
  res.status(status).json({ error: msg });
}

// ══════════════════════════════════════════════════════════════════
// MODULE 1: Email Marketing OS
// ══════════════════════════════════════════════════════════════════

router.get("/growth/email/campaigns",            (req, res) => {
  try { _ok(res, { campaigns: g.listEmailCampaigns(req.query.status, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/email/campaigns",           (req, res) => {
  try { _ok(res, { campaign: g.createEmailCampaign(req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.patch("/growth/email/campaigns/:id",      (req, res) => {
  try { _ok(res, { campaign: g.updateEmailCampaign(req.params.id, req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/email/campaigns/:id/send",  (req, res) => {
  try { _ok(res, { campaign: g.sendEmailCampaign(req.params.id, req.orgId) }); }
  // A missing campaign is a 404 regardless of the retriable/non-retriable
  // split, which distinguishes provider/config failures (400) from genuine
  // server faults (500) — neither describes "that id does not exist".
  catch (e) { _err(res, e, /\bnot found\b/i.test(e && e.message || "") ? 404 : (e.nonRetriable ? 400 : 500)); }
});

router.get("/growth/email/sequences",            (req, res) => {
  try { _ok(res, { sequences: g.listSequences(req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/email/sequences",           (req, res) => {
  try { _ok(res, { sequence: g.createSequence(req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.patch("/growth/email/sequences/:id",      (req, res) => {
  try { _ok(res, { sequence: g.updateSequence(req.params.id, req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.get("/growth/email/sequences/:id",        (req, res) => {
  try {
    const s = g.getSequence(req.params.id, req.orgId);
    if (!s) return res.status(404).json({ error: "Sequence not found" });
    _ok(res, { sequence: s });
  } catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 2: SMS Marketing OS
// ══════════════════════════════════════════════════════════════════

router.get("/growth/sms/campaigns",              (req, res) => {
  try { _ok(res, { campaigns: g.listSMSCampaigns(req.query.status, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/sms/campaigns",             (req, res) => {
  try { _ok(res, { campaign: g.createSMSCampaign(req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.patch("/growth/sms/campaigns/:id",        (req, res) => {
  try { _ok(res, { campaign: g.updateSMSCampaign(req.params.id, req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/sms/campaigns/:id/send",    (req, res) => {
  try { _ok(res, { campaign: g.sendSMSCampaign(req.params.id, req.orgId) }); }
  // A missing campaign is a 404 regardless of the retriable/non-retriable
  // split, which distinguishes provider/config failures (400) from genuine
  // server faults (500) — neither describes "that id does not exist".
  catch (e) { _err(res, e, /\bnot found\b/i.test(e && e.message || "") ? 404 : (e.nonRetriable ? 400 : 500)); }
});

router.post("/growth/sms/campaigns/:id/schedule",(req, res) => {
  try {
    const { scheduledAt } = req.body || {};
    if (!scheduledAt) return res.status(400).json({ error: "scheduledAt required" });
    _ok(res, { campaign: g.scheduleSMSCampaign(req.params.id, scheduledAt, req.orgId) });
  } catch (e) { _err(res, e); }
});

router.post("/growth/sms/otp",                   (req, res) => {
  try {
    const { to, otp } = req.body || {};
    if (!to) return res.status(400).json({ error: "to required" });
    _ok(res, g.sendOTP(to, otp || Math.floor(100000 + Math.random() * 900000).toString()));
  } catch (e) { _err(res, e, e.nonRetriable ? 400 : 500); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 3: WhatsApp Business OS
// ══════════════════════════════════════════════════════════════════

router.get("/growth/whatsapp/campaigns",               (req, res) => {
  try { _ok(res, { campaigns: g.listWhatsAppCampaigns(req.query.status, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/whatsapp/broadcasts",             (req, res) => {
  try { _ok(res, { campaign: g.createWhatsAppBroadcast(req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/whatsapp/broadcasts/:id/send",    async (req, res) => {
  try { _ok(res, { campaign: await g.sendWhatsAppBroadcast(req.params.id, req.orgId) }); }
  // Matches the email/SMS send routes: a missing broadcast is 404, a
  // non-retriable precondition (no recipients configured) is 400 — a client
  // error the operator can act on, not a server fault.
  catch (e) { _err(res, e, /\bnot found\b/i.test(e && e.message || "") ? 404 : (e.nonRetriable ? 400 : 500)); }
});

router.post("/growth/whatsapp/broadcasts/:id/sync-crm",(req, res) => {
  try { _ok(res, g.syncWhatsAppCRM(req.params.id, req.orgId)); }
  catch (e) { _err(res, e); }
});

// WA Flows
router.get("/growth/whatsapp/flows",                   (req, res) => {
  try { _ok(res, { flows: g.listWAFlows(req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/whatsapp/flows",                  (req, res) => {
  try { _ok(res, { flow: g.createWAFlow(req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.patch("/growth/whatsapp/flows/:id",             (req, res) => {
  try { _ok(res, { flow: g.updateWAFlow(req.params.id, req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

// WA Auto-replies
router.get("/growth/whatsapp/auto-replies",            (req, res) => {
  try { _ok(res, { rules: g.listAutoReplyRules(req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/whatsapp/auto-replies",           (req, res) => {
  try { _ok(res, { rule: g.createAutoReplyRule(req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 4: Push Notification Center
// ══════════════════════════════════════════════════════════════════

router.post("/growth/push/register",             (req, res) => {
  try {
    const { token, platform } = req.body || {};
    if (!token) return res.status(400).json({ error: "token required" });
    const accountId = req.user?.sub || req.user?.accountId || req.user?.id || "unknown";
    _ok(res, g.registerPushToken(accountId, token, platform || "web"));
  } catch (e) { _err(res, e); }
});

router.post("/growth/push/send",                 (req, res) => {
  try {
    const { title, body } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: "title and body required" });
    _ok(res, { campaign: g.sendPushNotification(req.body, req.orgId) });
  } catch (e) { _err(res, e); }
});

router.get("/growth/push/campaigns",             (req, res) => {
  try { _ok(res, { campaigns: g.listPushCampaigns(req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.get("/growth/push/triggers",              (req, res) => {
  try { _ok(res, { rules: g.listPushTriggerRules(req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/push/triggers",             (req, res) => {
  try { _ok(res, { rule: g.createPushTriggerRule(req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 5: Marketing Automation Builder
// ══════════════════════════════════════════════════════════════════

router.get("/growth/automations",                (req, res) => {
  try { _ok(res, { automations: g.listAutomations(req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/automations",               (req, res) => {
  try { _ok(res, { automation: g.createAutomation(req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.patch("/growth/automations/:id",          (req, res) => {
  try { _ok(res, { automation: g.updateAutomation(req.params.id, req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/automations/:id/trigger",   (req, res) => {
  try { _ok(res, { result: g.triggerAutomation(req.params.id, req.body || {}, req.orgId) }); }
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
  try { _ok(res, { audiences: g.listAudiences(req.query.type, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/audiences",                 (req, res) => {
  try { _ok(res, { audience: g.createAudience(req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.get("/growth/audiences/:id",              (req, res) => {
  try {
    const a = g.getAudience(req.params.id, req.orgId);
    if (!a) return res.status(404).json({ error: "Audience not found" });
    _ok(res, { audience: a });
  } catch (e) { _err(res, e); }
});

router.patch("/growth/audiences/:id",            (req, res) => {
  try { _ok(res, { audience: g.updateAudience(req.params.id, req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/audiences/:id/add",         (req, res) => {
  try {
    const { memberIds } = req.body || {};
    if (!Array.isArray(memberIds)) return res.status(400).json({ error: "memberIds array required" });
    _ok(res, { audience: g.addToAudience(req.params.id, memberIds, req.orgId) });
  } catch (e) { _err(res, e); }
});

router.post("/growth/audiences/:id/remove",      (req, res) => {
  try {
    const { memberIds } = req.body || {};
    if (!Array.isArray(memberIds)) return res.status(400).json({ error: "memberIds array required" });
    _ok(res, { audience: g.removeFromAudience(req.params.id, memberIds, req.orgId) });
  } catch (e) { _err(res, e); }
});

// Enterprise Capability Expansion mission — real bulk marketing import.
// Confirmed genuinely absent before this: audiences could only be built
// via POST /growth/audiences/:id/add with an already-known memberIds
// array, or synced from existing CRM leads. There was no way to bring in
// a list of new contacts from a marketing CSV export in one call.
// Composes two existing capabilities rather than inventing a third
// contact store: each CSV row becomes a real CRM lead (crmService.saveLead,
// same dedup-by-phone semantics as the CRM bulk import route), then every
// resulting phone is added to the target audience via the existing
// g.addToAudience — audiences already store phone-shaped memberIds
// wherever CRM-derived (see g.syncCRMToAudience).
router.post("/growth/audiences/:id/import", rateLimiter(5, 15 * 60_000), (req, res) => {
  try {
    const { csv } = req.body || {};
    if (!csv || typeof csv !== "string") return res.status(400).json({ error: "csv (string body) required" });
    const audience = g.getAudience(req.params.id, req.orgId);
    if (!audience) return res.status(404).json({ error: "Audience not found" });

    let records;
    try { records = parseCsvRecords(csv); }
    catch (e) { return res.status(400).json({ error: "Could not parse CSV: " + e.message }); }
    if (!records.length) return res.status(400).json({ error: "CSV contains no data rows" });
    if (records.length > 5000) return res.status(400).json({ error: "Import limited to 5000 rows per request" });

    const userId = req.user.sub || req.user.id || null;
    const results = { imported: 0, duplicates: 0, failed: 0, errors: [] };
    const memberIds = [];

    records.forEach((row, i) => {
      const phoneRaw = row.phone || row.Phone || row.mobile || row.Mobile;
      if (!phoneRaw) { results.failed++; if (results.errors.length < 50) results.errors.push({ row: i + 2, error: "phone required" }); return; }
      const cleanPhone = String(phoneRaw).replace(/\D/g, "");
      if (!cleanPhone || cleanPhone.length < 7) { results.failed++; if (results.errors.length < 50) results.errors.push({ row: i + 2, error: "invalid phone number" }); return; }

      const wasExisting = !!crm.getLead(cleanPhone);
      const { phone: _p, name, ...rest } = row;
      crm.saveLead({ phone: cleanPhone, name, ...rest, userId, status: "new", createdAt: new Date().toISOString() });
      if (wasExisting) results.duplicates++; else results.imported++;
      memberIds.push(cleanPhone);
    });

    const updatedAudience = memberIds.length ? g.addToAudience(req.params.id, memberIds, req.orgId) : audience;
    _ok(res, { totalRows: records.length, ...results, audience: updatedAudience });
  } catch (e) { _err(res, e); }
});

router.post("/growth/audiences/:id/sync-crm",    (req, res) => {
  try { _ok(res, { audience: g.syncCRMToAudience(req.params.id, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/audiences/:id/evaluate",    (req, res) => {
  try { _ok(res, { audience: g.evaluateDynamicAudience(req.params.id, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.get("/growth/tags",                       (req, res) => {
  try { _ok(res, { tags: g.listTags(req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.post("/growth/tags",                      (req, res) => {
  try {
    const { name, color } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    _ok(res, { tag: g.createTag(name, color, req.orgId) });
  } catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 7: Campaign Analytics
// ══════════════════════════════════════════════════════════════════

router.get("/growth/analytics",                  (req, res) => {
  try { _ok(res, { analytics: g.getOverallAnalytics(req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.get("/growth/analytics/:campaignId",      (req, res) => {
  try {
    const a = g.getCampaignAnalytics(req.params.campaignId, req.orgId);
    if (!a) return res.status(404).json({ error: "Campaign not found" });
    _ok(res, { analytics: a });
  } catch (e) { _err(res, e); }
});

router.post("/growth/analytics/:campaignId/conversion", (req, res) => {
  try {
    const { revenue, contactId } = req.body || {};
    _ok(res, g.recordConversion(req.params.campaignId, { revenue, contactId }, req.orgId));
  } catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 8: Template Marketplace
// ══════════════════════════════════════════════════════════════════

router.get("/growth/templates",                  (req, res) => {
  try {
    const list = g.listTemplates(req.query.type, req.query.category, req.orgId);
    _ok(res, { templates: list, count: list.length });
  } catch (e) { _err(res, e); }
});

router.get("/growth/templates/:id",              (req, res) => {
  try {
    const t = g.getTemplate(req.params.id, req.orgId);
    if (!t) return res.status(404).json({ error: "Template not found" });
    _ok(res, { template: t });
  } catch (e) { _err(res, e); }
});

router.post("/growth/templates",                 (req, res) => {
  try { _ok(res, { template: g.createTemplate(req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

router.patch("/growth/templates/:id",            (req, res) => {
  try { _ok(res, { template: g.updateTemplate(req.params.id, req.body || {}, req.orgId) }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 9: Growth Dashboard
// ══════════════════════════════════════════════════════════════════

router.get("/growth/dashboard",                  (req, res) => {
  try { _ok(res, { dashboard: g.getGrowthDashboard(req.orgId) }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 10: Commercial Benchmark
// ══════════════════════════════════════════════════════════════════

router.get("/growth/benchmark",                  (req, res) => {
  try { _ok(res, g.runBenchmark(req.orgId)); }
  catch (e) { _err(res, e); }
});

module.exports = router;
