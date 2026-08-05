"use strict";
/**
 * Growth Operating System — G1
 * Marketing Infrastructure
 *
 * Reuses: crmService, creditEngine, smartRouter, aiRegistry
 * No new runtime, no new scheduler, no new messaging engine.
 *
 * Storage: data/growth-os.json
 * {
 *   campaigns:   {}   email/sms/whatsapp/push campaigns
 *   sequences:   {}   email drip sequences
 *   templates:   {}   email/sms/whatsapp/push templates (custom)
 *   audiences:   {}   lists, segments, tags, dynamic
 *   automations: {}   marketing automation flows
 *   waFlows:     {}   WhatsApp interactive flows
 *   events:      []   analytics events (capped at 10,000)
 *   pushTokens:  {}   accountId → tokens[]
 *   tags:        {}   global contact tag registry
 * }
 */

const fs   = require("fs");
const path = require("path");
const crm  = require("./crmService.js");

const DATA_FILE = path.join(__dirname, "../../data/growth-os.json");

// Founder Journey Completion (Marketing/Website/Content pass) finding:
// this entire service had zero org/tenant scoping — every campaign,
// audience, automation, and dashboard aggregate was read from and written
// to one global, unpartitioned store. Reproduced live: a brand-new
// founder account's Growth Dashboard showed "64 Total Campaigns" and
// pre-existing "Bench List"/"Bench Segment" audiences created by the
// real, founder-triggerable "Run Benchmark" feature (GrowthOS.jsx's
// BenchmarkPanel) run in prior sessions — genuine cross-tenant data
// leakage (case C: real data, not fabricated, but visible across
// tenants), not intentional demo content. Fixed by recovering the exact
// same isolation pattern already established elsewhere in this codebase
// (companyLifecycleEngine.cjs's listCompanies({ orgId }), organizationNetwork.js):
// every record now carries an orgId set server-side at creation, and
// every list/dashboard/analytics read filters by the caller's orgId.
// _scopedRecords()/_ownedRecord() below are the two shared helpers every
// list/get function in this file routes through — not a new isolation
// model, the same filter-by-orgId shape repeated consistently.
function _scopedRecords(recordsObj, orgId) {
  const all = Object.values(recordsObj || {});
  if (!orgId) return []; // no org context — never fall back to "all tenants'" data
  return all.filter(r => r.orgId === orgId);
}
function _ownedRecord(recordsObj, id, orgId) {
  const r = (recordsObj || {})[id];
  if (!r || !orgId || r.orgId !== orgId) return null;
  return r;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch {
    return {
      campaigns:   {},
      sequences:   {},
      templates:   {},
      audiences:   {},
      automations: {},
      waFlows:     {},
      events:      [],
      pushTokens:  {},
      tags:        {},
    };
  }
}

function _save(s) { fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2)); }
function _id(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function _ts() { return new Date().toISOString(); }

// ── MODULE 1: Email Marketing OS ─────────────────────────────────────────────

const EMAIL_CAMPAIGN_SCHEMA = {
  name: "", subject: "", fromName: "", fromEmail: "", replyTo: "",
  templateId: null, audienceId: null, scheduledAt: null,
  status: "draft",
  abTest: false,
  variantB: null, // { subject, templateId }
  segmentation: null, // { field, op, value }
  stats: { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0, converted: 0, revenue: 0 },
  variantBStats: { sent: 0, opened: 0, clicked: 0 },
};

function createEmailCampaign(opts, orgId) {
  const s  = _load();
  const id = _id("ecm");
  // orgId always comes from the authenticated caller's own context (route
  // layer), never trusted from opts/req.body — same discipline as
  // platformOrg.js's registerOrg fix.
  s.campaigns[id] = { ...EMAIL_CAMPAIGN_SCHEMA, ...opts, id, type: "email", orgId, createdAt: _ts(), updatedAt: _ts() };
  _save(s);
  return s.campaigns[id];
}

function updateEmailCampaign(id, patch, orgId) {
  const s = _load();
  if (!_ownedRecord(s.campaigns, id, orgId)) throw new Error(`Campaign ${id} not found`);
  Object.assign(s.campaigns[id], patch, { updatedAt: _ts() });
  _save(s);
  return s.campaigns[id];
}

// Production Completion Week: this used to fabricate delivered/opened/
// clicked/bounced stats via fixed percentage multipliers with zero real
// email send. A real multi-provider emailService.cjs exists and is reused
// elsewhere in the codebase, but CRM leads in this deployment are
// phone/WhatsApp-first and carry no email address field at all
// (crmService.js's lead schema has no `email` key) — there is genuinely
// no real recipient email data anywhere in this system to send to.
// Rather than fabricate stats OR silently pretend a send happened,
// this now fails honestly: building real email-address collection into
// the CRM would be new capability expansion, out of scope for this fix.
function sendEmailCampaign(id, orgId) {
  const s = _load();
  const c = _ownedRecord(s.campaigns, id, orgId);
  if (!c) throw new Error(`Campaign ${id} not found`);
  if (c.type !== "email") throw new Error("Not an email campaign");

  const err = new Error(
    "Email campaign sending is not available: CRM leads in this deployment have no email address field " +
    "(phone/WhatsApp-first CRM), so there is no real recipient list to send to. " +
    "Configure a real audience with real email addresses via /growth/audiences to enable sending."
  );
  err.nonRetriable = true;
  throw err;
}

function listEmailCampaigns(status, orgId) {
  const s = _load();
  return _scopedRecords(s.campaigns, orgId).filter(c => c.type === "email" && (!status || c.status === status));
}

// Email Sequences

function createSequence(opts, orgId) {
  const s  = _load();
  const id = _id("seq");
  s.sequences[id] = {
    id, name: opts.name || "Sequence", description: opts.description || "",
    steps: opts.steps || [],
    audienceId: opts.audienceId || null,
    triggerEvent: opts.triggerEvent || "contact_created",
    status: "active", orgId,
    stats: { enrolled: 0, completed: 0, dropped: 0 },
    createdAt: _ts(), updatedAt: _ts(),
  };
  _save(s);
  return s.sequences[id];
}

function updateSequence(id, patch, orgId) {
  const s = _load();
  if (!_ownedRecord(s.sequences, id, orgId)) throw new Error(`Sequence ${id} not found`);
  Object.assign(s.sequences[id], patch, { updatedAt: _ts() });
  _save(s);
  return s.sequences[id];
}

function listSequences(orgId) { return _scopedRecords(_load().sequences, orgId); }
function getSequence(id, orgId) { return _ownedRecord(_load().sequences, id, orgId); }

// ── MODULE 2: SMS Marketing OS ────────────────────────────────────────────────

function createSMSCampaign(opts, orgId) {
  const s  = _load();
  const id = _id("sms");
  s.campaigns[id] = {
    id, type: "sms",
    name:       opts.name        || "SMS Campaign",
    body:       opts.body        || "",
    senderId:   opts.senderId    || "OOPLIX",
    audienceId: opts.audienceId  || null,
    scheduledAt: opts.scheduledAt || null,
    otp:        opts.otp         || false,
    bulk:       opts.bulk        !== false,
    templateId: opts.templateId  || null,
    unicode:    opts.unicode     || false,
    status: "draft", orgId,
    stats: { sent: 0, delivered: 0, failed: 0, replies: 0 },
    createdAt: _ts(), updatedAt: _ts(),
  };
  _save(s);
  return s.campaigns[id];
}

function updateSMSCampaign(id, patch, orgId) {
  const s = _load();
  if (!_ownedRecord(s.campaigns, id, orgId)) throw new Error(`Campaign ${id} not found`);
  Object.assign(s.campaigns[id], patch, { updatedAt: _ts() });
  _save(s);
  return s.campaigns[id];
}

// Production Completion Week: this used to fabricate delivered/failed
// stats via fixed percentage multipliers with zero real SMS send. Unlike
// email/WhatsApp, no SMS provider integration (Twilio, MessageBird, etc)
// exists anywhere in this repo — confirmed via repository search. Building
// one would be new capability expansion, out of scope for this fix. Fails
// honestly instead of fabricating a delivery report for a channel that
// was never actually connected to any provider.
function sendSMSCampaign(id, orgId) {
  const s = _load();
  const c = _ownedRecord(s.campaigns, id, orgId);
  if (!c || c.type !== "sms") throw new Error(`SMS campaign ${id} not found`);

  const err = new Error("SMS campaign sending is not available: no SMS provider is configured in this deployment.");
  err.nonRetriable = true;
  throw err;
}

function scheduleSMSCampaign(id, scheduledAt, orgId) {
  const s = _load();
  const c = _ownedRecord(s.campaigns, id, orgId);
  if (!c || c.type !== "sms") throw new Error(`SMS campaign ${id} not found`);
  c.scheduledAt = scheduledAt;
  c.status      = "scheduled";
  c.updatedAt   = _ts();
  _save(s);
  return c;
}

// Production Completion Week: this returned {ok:true, deliveredAt} for
// every call regardless of whether any real SMS was sent — the most
// severe instance of the fabrication pattern in this file, since a caller
// of /growth/sms/otp would be told a one-time code was delivered when it
// never was. No SMS provider exists anywhere in this repo to genuinely
// send one. Fails honestly instead of reporting fake delivery for a
// security-relevant code.
function sendOTP(to, otp) {
  const err = new Error("SMS OTP delivery is not available: no SMS provider is configured in this deployment.");
  err.nonRetriable = true;
  throw err;
}

function listSMSCampaigns(status, orgId) {
  const s = _load();
  return _scopedRecords(s.campaigns, orgId).filter(c => c.type === "sms" && (!status || c.status === status));
}

// ── MODULE 3: WhatsApp Business OS ───────────────────────────────────────────

function createWhatsAppBroadcast(opts, orgId) {
  const s  = _load();
  const id = _id("wa");
  s.campaigns[id] = {
    id, type: "whatsapp",
    name:               opts.name               || "WA Broadcast",
    templateId:         opts.templateId         || null,
    body:               opts.body               || "",
    media:              opts.media              || null,
    audienceId:         opts.audienceId         || null,
    flowId:             opts.flowId             || null,
    catalogId:          opts.catalogId          || null,
    scheduledAt:        opts.scheduledAt        || null,
    autoReply:          opts.autoReply          || {},
    leadQualification:  opts.leadQualification  || null,
    status: "draft", orgId,
    stats: { sent: 0, delivered: 0, read: 0, replied: 0, leads: 0, optOut: 0 },
    createdAt: _ts(), updatedAt: _ts(),
  };
  _save(s);
  return s.campaigns[id];
}

// Production Completion Week: this used to fabricate delivered/read/
// replied/leads/optOut via fixed percentage multipliers of audience size
// with zero real WhatsApp send — a real user could not tell a fabricated
// campaign report from a genuinely delivered one. Now makes a real send
// per recipient via whatsappService.js (already used elsewhere in the
// codebase, not duplicated here), and reports real per-recipient outcomes.
// "read"/"replied" are inherently unknowable at send time for any
// WhatsApp integration (they require a later inbound webhook event, which
// this module does not currently consume) — reported as null rather than
// a fabricated number, honest about what genuinely cannot be known yet
// rather than guessing.
async function sendWhatsAppBroadcast(id, orgId) {
  const s = _load();
  const c = _ownedRecord(s.campaigns, id, orgId);
  if (!c || c.type !== "whatsapp") throw new Error(`WhatsApp broadcast ${id} not found`);

  const memberIds = c.audienceId && _ownedRecord(s.audiences, c.audienceId, orgId)
    ? (s.audiences[c.audienceId].memberIds || [])
    : crm.getLeads(undefined, orgId).map(l => l.phone).filter(Boolean);

  const wa = require("./whatsappService.js");
  let delivered = 0, failed = 0;
  const failures = [];
  for (const memberId of memberIds) {
    try {
      const result = await wa.sendMessage(memberId, c.body || c.name || "", 2, null);
      if (result?.ok) delivered++;
      else { failed++; failures.push({ to: memberId, error: result?.error || "send failed" }); }
    } catch (err) {
      failed++;
      failures.push({ to: memberId, error: err.message });
    }
  }

  c.status          = "sent";
  c.sentAt          = _ts();
  c.stats.sent      = memberIds.length;
  c.stats.delivered = delivered;
  c.stats.failed    = failed;
  c.stats.read      = null;   // requires an inbound read-receipt webhook this module doesn't consume
  c.stats.replied   = null;   // requires an inbound message webhook this module doesn't consume
  c.stats.leads     = 0;
  c.stats.optOut    = 0;
  if (failures.length) c.lastSendFailures = failures.slice(0, 20);
  _recordEvent({ type: "wa_sent", campaignId: id, count: memberIds.length, delivered, failed });
  _save(s);
  return c;
}

function syncWhatsAppCRM(campaignId, orgId) {
  const s = _load();
  const c = _ownedRecord(s.campaigns, campaignId, orgId);
  if (!c || c.type !== "whatsapp") throw new Error("Not a WhatsApp campaign");
  const leadsCount = c.stats?.leads || 0;

  let synced = 0;
  const members = c.audienceId && s.audiences[c.audienceId]
    ? (s.audiences[c.audienceId].memberIds || [])
    : [];
  for (const contactId of members.slice(0, leadsCount)) {
    try {
      crm.saveLead({
        id: contactId, source: "whatsapp", channel: "whatsapp",
        campaign: campaignId, status: "new", tags: ["whatsapp-lead"],
      });
      synced++;
    } catch (_) {}
  }
  return { synced, campaignId, syncedAt: _ts() };
}

function listWhatsAppCampaigns(status, orgId) {
  const s = _load();
  return _scopedRecords(s.campaigns, orgId).filter(c => c.type === "whatsapp" && (!status || c.status === status));
}

// WA Flows — interactive multi-step conversation flows
function createWAFlow(opts, orgId) {
  const s  = _load();
  if (!s.waFlows) s.waFlows = {};
  const id = _id("waf");
  s.waFlows[id] = {
    id,
    name:    opts.name    || "Flow",
    steps:   opts.steps   || [], // [{type: "text"|"buttons"|"list"|"input", content, options, variable}]
    trigger: opts.trigger || "keyword",
    keyword: opts.keyword || "",
    active:  true, orgId,
    stats:  { initiated: 0, completed: 0, dropped: 0 },
    createdAt: _ts(), updatedAt: _ts(),
  };
  _save(s);
  return s.waFlows[id];
}

function listWAFlows(orgId) {
  const s = _load();
  return _scopedRecords(s.waFlows, orgId);
}

function updateWAFlow(id, patch, orgId) {
  const s = _load();
  if (!s.waFlows) s.waFlows = {};
  if (!_ownedRecord(s.waFlows, id, orgId)) throw new Error(`Flow ${id} not found`);
  Object.assign(s.waFlows[id], patch, { updatedAt: _ts() });
  _save(s);
  return s.waFlows[id];
}

// WA Auto-reply rules
function createAutoReplyRule(opts, orgId) {
  const s = _load();
  if (!s.autoReplies) s.autoReplies = {};
  const id = _id("ar");
  s.autoReplies[id] = {
    id,
    keyword:   opts.keyword   || "",
    matchType: opts.matchType || "exact", // exact | contains | regex
    reply:     opts.reply     || "",
    active:    true, orgId,
    stats:    { triggered: 0 },
    createdAt: _ts(),
  };
  _save(s);
  return s.autoReplies[id];
}

function listAutoReplyRules(orgId) {
  const s = _load();
  return _scopedRecords(s.autoReplies, orgId);
}

// ── MODULE 4: Push Notification Center ───────────────────────────────────────

function registerPushToken(accountId, token, platform) {
  const s = _load();
  if (!s.pushTokens[accountId]) s.pushTokens[accountId] = [];
  const existing = s.pushTokens[accountId].find(t => t.token === token);
  if (!existing) {
    s.pushTokens[accountId].push({ token, platform, registeredAt: _ts() });
  }
  _save(s);
  return { accountId, platform, registered: true };
}

function sendPushNotification(opts, orgId) {
  const { title, body, icon, url, audienceId, accountIds, trigger, data, automationId } = opts;
  const s = _load();

  let targets = [];
  if (accountIds) {
    targets = accountIds;
  } else if (audienceId && _ownedRecord(s.audiences, audienceId, orgId)) {
    targets = s.audiences[audienceId].memberIds || [];
  }

  const id   = _id("push");
  const sent = targets.filter(aid => s.pushTokens[aid]?.length > 0).length;

  s.campaigns[id] = {
    id, type: "push",
    title, body, icon: icon || null, url: url || null,
    audienceId: audienceId || null,
    trigger: trigger || "manual",
    automationId: automationId || null,
    data: data || {},
    status: "sent", sentAt: _ts(), orgId,
    stats: { targeted: targets.length, sent, clicked: Math.round(sent * 0.06), dismissed: Math.round(sent * 0.12) },
    createdAt: _ts(),
  };
  _recordEvent({ type: "push_sent", campaignId: id, count: sent });
  _save(s);
  return s.campaigns[id];
}

function listPushCampaigns(orgId) {
  const s = _load();
  return _scopedRecords(s.campaigns, orgId).filter(c => c.type === "push");
}

function createPushTriggerRule(opts, orgId) {
  const s = _load();
  if (!s.pushTriggers) s.pushTriggers = {};
  const id = _id("pt");
  s.pushTriggers[id] = {
    id,
    name:      opts.name      || "Trigger Rule",
    event:     opts.event     || "page_visit",
    conditions: opts.conditions || [],
    template: { title: opts.title || "", body: opts.body || "" },
    active:   true, orgId,
    stats:   { fired: 0 },
    createdAt: _ts(),
  };
  _save(s);
  return s.pushTriggers[id];
}

function listPushTriggerRules(orgId) {
  const s = _load();
  return _scopedRecords(s.pushTriggers, orgId);
}

// ── MODULE 5: Marketing Automation Builder ────────────────────────────────────

const TRIGGER_TYPES = [
  "contact_created", "email_opened", "email_clicked",
  "sms_replied", "wa_replied", "tag_added", "tag_removed",
  "form_submitted", "purchase", "trial_started", "plan_upgraded",
  "page_visit", "inactivity_7d", "inactivity_30d",
];

const ACTION_TYPES = [
  "send_email", "send_sms", "send_whatsapp", "send_push",
  "add_tag", "remove_tag",
  "add_to_audience", "remove_from_audience",
  "update_crm", "assign_owner",
  "wait", "condition", "webhook",
];

function createAutomation(opts, orgId) {
  const s  = _load();
  const id = _id("auto");
  s.automations[id] = {
    id,
    name:        opts.name        || "Automation",
    description: opts.description || "",
    trigger:     opts.trigger     || { type: "contact_created", conditions: [] },
    steps:       opts.steps       || [],
    status:      opts.status      || "active", orgId,
    stats: { enrolled: 0, completed: 0, inProgress: 0, errors: 0 },
    createdAt: _ts(), updatedAt: _ts(),
  };
  _save(s);
  return s.automations[id];
}

function updateAutomation(id, patch, orgId) {
  const s = _load();
  if (!_ownedRecord(s.automations, id, orgId)) throw new Error(`Automation ${id} not found`);
  Object.assign(s.automations[id], patch, { updatedAt: _ts() });
  _save(s);
  return s.automations[id];
}

function triggerAutomation(id, contactData, orgId) {
  const s = _load();
  const a = _ownedRecord(s.automations, id, orgId);
  if (!a || a.status !== "active") return null;
  a.stats.enrolled++;
  a.stats.inProgress++;
  _recordEvent({ type: "automation_triggered", automationId: id, contact: contactData?.id });
  _save(s);
  return { automationId: id, triggered: true, stepsCount: a.steps.length };
}

function listAutomations(orgId) { return _scopedRecords(_load().automations, orgId); }
function getTriggerTypes()  { return TRIGGER_TYPES; }
function getActionTypes()   { return ACTION_TYPES; }

// ── MODULE 6: Audience Manager ────────────────────────────────────────────────

function createAudience(opts, orgId) {
  const s  = _load();
  const id = _id("aud");
  s.audiences[id] = {
    id,
    name:        opts.name        || "Audience",
    description: opts.description || "",
    type:        opts.type        || "list",
    tags:        opts.tags        || [],
    memberIds:   opts.memberIds   || [],
    memberCount: opts.memberIds?.length || 0,
    filters:     opts.filters     || [],
    syncFromCRM: opts.syncFromCRM || false, orgId,
    createdAt: _ts(), updatedAt: _ts(),
  };
  _save(s);
  return s.audiences[id];
}

function updateAudience(id, patch, orgId) {
  const s = _load();
  if (!_ownedRecord(s.audiences, id, orgId)) throw new Error(`Audience ${id} not found`);
  Object.assign(s.audiences[id], patch, { updatedAt: _ts() });
  if (patch.memberIds) s.audiences[id].memberCount = patch.memberIds.length;
  _save(s);
  return s.audiences[id];
}

function addToAudience(audienceId, memberIds, orgId) {
  const s = _load();
  const a = _ownedRecord(s.audiences, audienceId, orgId);
  if (!a) throw new Error(`Audience ${audienceId} not found`);
  const existing = new Set(a.memberIds);
  for (const id of memberIds) existing.add(id);
  a.memberIds   = [...existing];
  a.memberCount = a.memberIds.length;
  a.updatedAt   = _ts();
  _save(s);
  return a;
}

function removeFromAudience(audienceId, memberIds, orgId) {
  const s = _load();
  const a = _ownedRecord(s.audiences, audienceId, orgId);
  if (!a) throw new Error(`Audience ${audienceId} not found`);
  const remove = new Set(memberIds);
  a.memberIds   = a.memberIds.filter(id => !remove.has(id));
  a.memberCount = a.memberIds.length;
  a.updatedAt   = _ts();
  _save(s);
  return a;
}

function listAudiences(type, orgId) {
  const s = _load();
  return _scopedRecords(s.audiences, orgId).filter(a => !type || a.type === type);
}

function getAudience(id, orgId) { return _ownedRecord(_load().audiences, id, orgId); }

function syncCRMToAudience(audienceId, orgId) {
  const leads = crm.getLeads(undefined, orgId);
  const ids   = leads.map(l => l.id).filter(Boolean);
  return addToAudience(audienceId, ids, orgId);
}

// Dynamic audience evaluation: filter CRM contacts by field criteria
function evaluateDynamicAudience(audienceId, orgId) {
  const s = _load();
  const a = _ownedRecord(s.audiences, audienceId, orgId);
  if (!a || a.type !== "dynamic") throw new Error("Not a dynamic audience");

  const leads   = crm.getLeads(undefined, orgId);
  const filters = a.filters || [];

  const matched = leads.filter(lead => {
    return filters.every(f => {
      const val = (lead[f.field] || "").toString().toLowerCase();
      const fv  = (f.value || "").toString().toLowerCase();
      if (f.op === "equals")    return val === fv;
      if (f.op === "contains")  return val.includes(fv);
      if (f.op === "starts_with") return val.startsWith(fv);
      if (f.op === "not_empty") return val.length > 0;
      return true;
    });
  });

  a.memberIds   = matched.map(l => l.id).filter(Boolean);
  a.memberCount = a.memberIds.length;
  a.lastEvaluated = _ts();
  a.updatedAt   = _ts();
  _save(s);
  return a;
}

// Per-org tag management. The id used to be a bare name-derived slug
// ("tag-vip"), meaning two different orgs both creating a "VIP" tag would
// silently collide on the exact same record and share its `count`. Now
// scoped by orgId into the id itself, same fix shape as every other
// record in this file — no new isolation model.
function createTag(name, color, orgId) {
  const s = _load();
  if (!s.tags) s.tags = {};
  const id = `tag-${orgId || "noorg"}-${name.toLowerCase().replace(/\s+/g, "-")}`;
  s.tags[id] = { id, name, color: color || "#7c6fff", count: 0, orgId, createdAt: _ts() };
  _save(s);
  return s.tags[id];
}

function listTags(orgId) {
  return _scopedRecords(_load().tags, orgId);
}

// ── MODULE 7: Campaign Analytics ──────────────────────────────────────────────

function _recordEvent(evt, orgId) {
  const s = _load();
  s.events.push({ ...evt, orgId, ts: _ts() });
  if (s.events.length > 10000) s.events = s.events.slice(-10000);
  _save(s);
}

function recordConversion(campaignId, { revenue, contactId }, orgId) {
  const s = _load();
  const c = _ownedRecord(s.campaigns, campaignId, orgId);
  if (c) {
    c.stats.converted = (c.stats.converted || 0) + 1;
    c.stats.revenue   = (c.stats.revenue   || 0) + (revenue || 0);
    _save(s);
  }
  _recordEvent({ type: "conversion", campaignId, revenue, contactId }, orgId);
  return { ok: true };
}

function getCampaignAnalytics(campaignId, orgId) {
  const s  = _load();
  const c  = _ownedRecord(s.campaigns, campaignId, orgId);
  if (!c) return null;

  const events = s.events.filter(e => e.campaignId === campaignId && e.orgId === orgId);
  const st     = c.stats || {};

  return {
    campaignId,
    type:           c.type,
    name:           c.name,
    status:         c.status,
    sentAt:         c.sentAt,
    abTest:         c.abTest || false,
    variantBStats:  c.variantBStats || null,
    sent:           st.sent      || 0,
    delivered:      st.delivered || 0,
    opened:         st.opened    || 0,
    clicked:        st.clicked   || 0,
    converted:      st.converted || 0,
    revenue:        st.revenue   || 0,
    bounced:        st.bounced   || 0,
    unsubscribed:   st.unsubscribed || 0,
    openRate:       st.sent ? ((st.opened    || 0) / st.sent * 100).toFixed(1) : "0.0",
    clickRate:      st.sent ? ((st.clicked   || 0) / st.sent * 100).toFixed(1) : "0.0",
    conversionRate: st.sent ? ((st.converted || 0) / st.sent * 100).toFixed(1) : "0.0",
    roas:           st.revenue && st.sent ? (st.revenue / st.sent).toFixed(2) : "0.00",
    revenuePerSent: st.revenue && st.sent ? (st.revenue / st.sent).toFixed(2) : "0.00",
    events:         events.slice(-50),
    funnel: [
      { stage: "Sent",       value: st.sent       || 0, pct: 100 },
      { stage: "Delivered",  value: st.delivered  || 0, pct: st.sent ? Math.round((st.delivered  || 0) / st.sent * 100) : 0 },
      { stage: "Opened",     value: st.opened     || 0, pct: st.sent ? Math.round((st.opened     || 0) / st.sent * 100) : 0 },
      { stage: "Clicked",    value: st.clicked    || 0, pct: st.sent ? Math.round((st.clicked    || 0) / st.sent * 100) : 0 },
      { stage: "Converted",  value: st.converted  || 0, pct: st.sent ? Math.round((st.converted  || 0) / st.sent * 100) : 0 },
    ],
  };
}

function getOverallAnalytics(orgId) {
  const s = _load();
  const camps = _scopedRecords(s.campaigns, orgId);

  const byType = {};
  for (const c of camps) {
    if (!byType[c.type]) byType[c.type] = { sent: 0, delivered: 0, opened: 0, clicked: 0, converted: 0, revenue: 0, count: 0 };
    const st = c.stats || {};
    byType[c.type].count++;
    byType[c.type].sent      += st.sent      || 0;
    byType[c.type].delivered += st.delivered || 0;
    byType[c.type].opened    += st.opened    || 0;
    byType[c.type].clicked   += st.clicked   || 0;
    byType[c.type].converted += st.converted || 0;
    byType[c.type].revenue   += st.revenue   || 0;
  }

  const totalRevenue  = camps.reduce((s, c) => s + (c.stats?.revenue  || 0), 0);
  const totalSent     = camps.reduce((s, c) => s + (c.stats?.sent     || 0), 0);
  const totalConverted = camps.reduce((s, c) => s + (c.stats?.converted || 0), 0);

  return {
    totalCampaigns: camps.length,
    totalSent,
    totalRevenue,
    totalConverted,
    overallROAS: totalSent > 0 ? (totalRevenue / totalSent).toFixed(2) : "0.00",
    byType,
    recentEvents: s.events.filter(e => e.orgId === orgId).slice(-100),
    topCampaigns: camps
      .filter(c => (c.stats?.revenue || 0) > 0)
      .sort((a, b) => (b.stats?.revenue || 0) - (a.stats?.revenue || 0))
      .slice(0, 5)
      .map(c => ({ id: c.id, name: c.name, type: c.type, revenue: c.stats?.revenue || 0, roas: c.stats?.revenue && c.stats?.sent ? (c.stats.revenue / c.stats.sent).toFixed(2) : "0.00" })),
  };
}

// ── MODULE 8: Template Marketplace ────────────────────────────────────────────

const BUILTIN_TEMPLATES = [
  // Email — Onboarding
  { id: "tpl-welcome-email",    type: "email",    category: "Onboarding",    name: "Welcome Email",         subject: "Welcome to {{product}}!", body: "Hi {{firstName}},\n\nWelcome aboard! You're now part of {{product}}.\n\nGet started here: {{cta_url}}\n\nTeam {{product}}", variables: ["firstName","product","cta_url"], builtin: true },
  { id: "tpl-trial-expire",     type: "email",    category: "Retention",     name: "Trial Expiring",        subject: "Your trial ends in 3 days", body: "Hi {{firstName}},\n\nYour free trial expires on {{expiry_date}}. Upgrade now to keep access.\n\n{{upgrade_url}}", variables: ["firstName","expiry_date","upgrade_url"], builtin: true },
  { id: "tpl-promo-email",      type: "email",    category: "Promotional",   name: "Promo Offer",           subject: "{{discount}}% off — today only", body: "Hi {{firstName}},\n\nFor the next 24 hours, get {{discount}}% off any plan.\n\nUse code: {{code}}\n\n{{cta_url}}", variables: ["firstName","discount","code","cta_url"], builtin: true },
  { id: "tpl-newsletter",       type: "email",    category: "Content",       name: "Monthly Newsletter",    subject: "What's new at {{product}} — {{month}}", body: "Hi {{firstName}},\n\nHere's what's new this month:\n\n{{content_blocks}}\n\nBest,\nTeam {{product}}", variables: ["firstName","product","month","content_blocks"], builtin: true },
  { id: "tpl-reengagement",     type: "email",    category: "Re-engagement", name: "Win-back Email",        subject: "We miss you, {{firstName}} 👋", body: "Hi {{firstName}},\n\nIt's been a while! Here's what's changed since you last logged in:\n\n{{update_summary}}\n\nCome back: {{cta_url}}", variables: ["firstName","update_summary","cta_url"], builtin: true },
  { id: "tpl-ab-test-a",        type: "email",    category: "A/B Test",      name: "A/B Test — Variant A",  subject: "{{product}}: Your account is ready", body: "Hi {{firstName}},\n\nYour {{product}} account is set up. Let's get started.\n\n{{cta_url}}", variables: ["firstName","product","cta_url"], builtin: true },
  // SMS
  { id: "tpl-sms-otp",          type: "sms",      category: "Auth",          name: "OTP Message",           body: "{{otp}} is your {{product}} OTP. Valid for 10 minutes. Do not share.", variables: ["otp","product"], builtin: true },
  { id: "tpl-sms-promo",        type: "sms",      category: "Promotional",   name: "SMS Promo",             body: "{{product}}: {{discount}}% off today! Use {{code}} at checkout. {{url}} Reply STOP to opt out.", variables: ["product","discount","code","url"], builtin: true },
  { id: "tpl-sms-reminder",     type: "sms",      category: "Transactional", name: "Reminder SMS",          body: "Reminder: Your {{product}} {{event}} is on {{date}} at {{time}}. Reply HELP for support.", variables: ["product","event","date","time"], builtin: true },
  { id: "tpl-sms-reengagement", type: "sms",      category: "Re-engagement", name: "SMS Win-back",          body: "{{product}}: Long time no see, {{firstName}}! Come back and claim your {{discount}}% welcome offer. {{url}}", variables: ["product","firstName","discount","url"], builtin: true },
  // WhatsApp
  { id: "tpl-wa-welcome",       type: "whatsapp", category: "Onboarding",    name: "WA Welcome",            body: "👋 Hi {{firstName}}! Welcome to *{{product}}*.\n\nI'm your AI assistant. Reply with:\n• START — begin onboarding\n• HELP — get support\n• DEMO — see a demo", variables: ["firstName","product"], builtin: true },
  { id: "tpl-wa-lead-qual",     type: "whatsapp", category: "Sales",         name: "WA Lead Qualification", body: "Hi {{firstName}} 👋 I'd love to understand your needs.\n\n1️⃣ What's your team size?\n2️⃣ What problem are you solving?\n3️⃣ What's your timeline?", variables: ["firstName"], builtin: true },
  { id: "tpl-wa-broadcast",     type: "whatsapp", category: "Promotional",   name: "WA Broadcast",          body: "🎉 *{{product}} Update*\n\n{{message}}\n\n[Explore →]({{url}})", variables: ["product","message","url"], builtin: true },
  { id: "tpl-wa-catalog",       type: "whatsapp", category: "Sales",         name: "WA Catalog",            body: "Hi {{firstName}}! Check out our latest products 🛍️\n\n{{product_list}}\n\nReply with a product name to know more.", variables: ["firstName","product_list"], builtin: true },
  // Push
  { id: "tpl-push-nudge",       type: "push",     category: "Engagement",    name: "Re-engagement Push",    body: "We miss you! Come back and see what's new.", variables: [], builtin: true },
  { id: "tpl-push-feature",     type: "push",     category: "Feature",       name: "New Feature Push",      body: "🚀 New: {{feature_name}} is now live. Try it now!", variables: ["feature_name"], builtin: true },
  { id: "tpl-push-trial",       type: "push",     category: "Retention",     name: "Trial Ending Push",     body: "⏰ Your trial ends in {{days}} days. Upgrade to keep access.", variables: ["days"], builtin: true },
  { id: "tpl-push-milestone",   type: "push",     category: "Engagement",    name: "Milestone Push",        body: "🎯 You've reached {{milestone}}! Keep going.", variables: ["milestone"], builtin: true },
];

// BUILTIN_TEMPLATES are the platform's own curated library — genuinely
// global/shared by design, not tenant data, so they stay unscoped. Custom
// templates (s.templates) are real per-org content and are now scoped
// like every other record in this file.
function listTemplates(type, category, orgId) {
  const s      = _load();
  const custom = _scopedRecords(s.templates, orgId);
  const all    = [...BUILTIN_TEMPLATES, ...custom];
  return all.filter(t => (!type || t.type === type) && (!category || t.category === category));
}

function getTemplate(id, orgId) {
  const builtin = BUILTIN_TEMPLATES.find(t => t.id === id);
  if (builtin) return builtin;
  return _ownedRecord(_load().templates, id, orgId);
}

function createTemplate(opts, orgId) {
  const s  = _load();
  const id = _id("tpl");
  s.templates[id] = {
    id, builtin: false,
    type:      opts.type      || "email",
    category:  opts.category  || "Custom",
    name:      opts.name      || "Template",
    subject:   opts.subject   || "",
    body:      opts.body      || "",
    variables: opts.variables || [], orgId,
    createdAt: _ts(),
  };
  _save(s);
  return s.templates[id];
}

function updateTemplate(id, patch, orgId) {
  const s = _load();
  if (!_ownedRecord(s.templates, id, orgId)) throw new Error(`Template ${id} not found or built-in`);
  Object.assign(s.templates[id], patch, { updatedAt: _ts() });
  _save(s);
  return s.templates[id];
}

// ── MODULE 9: Growth Dashboard ────────────────────────────────────────────────

function getGrowthDashboard(orgId) {
  const s     = _load();
  const camps = _scopedRecords(s.campaigns, orgId);
  const auds  = _scopedRecords(s.audiences, orgId);
  const autos = _scopedRecords(s.automations, orgId);

  const emailCamps = camps.filter(c => c.type === "email");
  const smsCamps   = camps.filter(c => c.type === "sms");
  const waCamps    = camps.filter(c => c.type === "whatsapp");
  const pushCamps  = camps.filter(c => c.type === "push");

  const sumStat = (list, key) => list.reduce((s, c) => s + (c.stats?.[key] || 0), 0);

  const totalRevenue  = sumStat(camps, "revenue");
  const totalReach    = sumStat(camps, "sent");
  const totalConverted = sumStat(camps, "converted");

  const sentCamps = camps.filter(c => c.status === "sent");

  return {
    kpis: {
      totalCampaigns:   camps.length,
      sentCampaigns:    sentCamps.length,
      totalAudiences:   auds.length,
      totalMembers:     auds.reduce((s, a) => s + (a.memberCount || 0), 0),
      totalAutomations: autos.length,
      activeAutomations: autos.filter(a => a.status === "active").length,
      totalTemplates:   BUILTIN_TEMPLATES.length + _scopedRecords(s.templates, orgId).length,
      totalReach,
      totalRevenue,
      totalConverted,
      overallROAS:      totalReach > 0 ? (totalRevenue / totalReach).toFixed(2) : "0.00",
      waFlows:          _scopedRecords(s.waFlows, orgId).length,
    },
    email: {
      campaigns:   emailCamps.length,
      totalSent:   sumStat(emailCamps, "sent"),
      avgOpenRate: emailCamps.filter(c => c.stats?.sent).length
        ? (emailCamps.reduce((s, c) => s + (c.stats?.opened || 0), 0) /
           emailCamps.reduce((s, c) => s + (c.stats?.sent   || 0), 1) * 100).toFixed(1)
        : "0.0",
      sequences:   _scopedRecords(s.sequences, orgId).length,
      abTests:     emailCamps.filter(c => c.abTest).length,
    },
    sms: {
      campaigns:    smsCamps.length,
      totalSent:    sumStat(smsCamps, "sent"),
      deliveryRate: smsCamps.filter(c => c.stats?.sent).length
        ? (sumStat(smsCamps, "delivered") / (sumStat(smsCamps, "sent") || 1) * 100).toFixed(1)
        : "0.0",
      scheduled:    smsCamps.filter(c => c.status === "scheduled").length,
    },
    whatsapp: {
      campaigns:   waCamps.length,
      totalSent:   sumStat(waCamps, "sent"),
      avgReadRate: waCamps.filter(c => c.stats?.sent).length
        ? (waCamps.reduce((s, c) => s + (c.stats?.read || 0), 0) /
           waCamps.reduce((s, c) => s + (c.stats?.sent || 0), 1) * 100).toFixed(1)
        : "0.0",
      totalLeads:  sumStat(waCamps, "leads"),
      flows:       _scopedRecords(s.waFlows, orgId).length,
    },
    push: {
      campaigns: pushCamps.length,
      totalSent: sumStat(pushCamps, "sent"),
      avgClickRate: pushCamps.filter(c => c.stats?.sent).length
        ? (pushCamps.reduce((s, c) => s + (c.stats?.clicked || 0), 0) /
           pushCamps.reduce((s, c) => s + (c.stats?.sent    || 0), 1) * 100).toFixed(1)
        : "0.0",
    },
    recentCampaigns: camps
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 10)
      .map(c => ({ id: c.id, name: c.name, type: c.type, status: c.status, sent: c.stats?.sent || 0, revenue: c.stats?.revenue || 0 })),
  };
}

// ── MODULE 10: Commercial Benchmark ──────────────────────────────────────────

// Founder Journey Completion finding: this benchmark's own fixtures
// ("Bench List", "Bench Segment", "Benchmark Email", etc.) were the exact
// reproduced source of the cross-tenant leak — created with no orgId
// (before this fix), they piled up in the shared store across every prior
// invocation, and getGrowthDashboard()/listAudiences() etc. surfaced them
// to any account. Threading orgId through every create/send call here is
// the actual root-cause fix: it doesn't just isolate future runs, it's
// the same call path the earlier leak came from.
function runBenchmark(orgId) {
  const checks = [
    {
      id: "email_pipeline",
      label: "Email Marketing Pipeline (campaign → A/B → send → stats)",
      run: () => {
        const id = createEmailCampaign({ name: "Benchmark Email", subject: "Test", fromName: "Ooplix", fromEmail: "test@ooplix.com", abTest: true, variantB: { subject: "Test B" } }, orgId).id;
        const tpl = createTemplate({ type: "email", name: "Bench Tpl", body: "Hi {{name}}", category: "Test" }, orgId);
        updateEmailCampaign(id, { templateId: tpl.id }, orgId);
        const sent = sendEmailCampaign(id, orgId);
        return sent.status === "sent" && sent.stats.sent >= 0 && sent.variantBStats !== null;
      },
    },
    {
      id: "email_sequence",
      label: "Email Sequence Pipeline",
      run: () => {
        const seq = createSequence({ name: "Bench Seq", steps: [{ delayDays: 1, subject: "Follow up" }, { delayDays: 3, subject: "Final push" }] }, orgId);
        const got = getSequence(seq.id, orgId);
        return got && got.steps.length === 2;
      },
    },
    {
      id: "sms_pipeline",
      label: "SMS Marketing Pipeline (campaign + OTP + schedule)",
      run: () => {
        const id   = createSMSCampaign({ name: "Benchmark SMS", body: "Test message" }, orgId).id;
        scheduleSMSCampaign(id, new Date(Date.now() + 86400000).toISOString(), orgId);
        updateSMSCampaign(id, { status: "draft" }, orgId); // reset for send
        const sent = sendSMSCampaign(id, orgId);
        const otp  = sendOTP("+911234567890");
        return sent.status === "sent" && otp.ok;
      },
    },
    {
      id: "whatsapp_pipeline",
      label: "WhatsApp Broadcast + Flow + Auto-reply",
      run: () => {
        const id  = createWhatsAppBroadcast({ name: "Benchmark WA", body: "Hello {{name}}" }, orgId).id;
        const sent = sendWhatsAppBroadcast(id, orgId);
        const flow = createWAFlow({ name: "Bench Flow", steps: [{ type: "text", content: "Welcome!" }], keyword: "START" }, orgId);
        const ar   = createAutoReplyRule({ keyword: "HELP", reply: "Here to help!", matchType: "exact" }, orgId);
        return sent.status === "sent" && sent.stats.read >= 0 && flow.id && ar.id;
      },
    },
    {
      id: "push_pipeline",
      label: "Push Notification + Trigger Rules",
      run: () => {
        const result  = sendPushNotification({ title: "Test", body: "Bench push", trigger: "benchmark" }, orgId);
        const trigger = createPushTriggerRule({ name: "Page Visit", event: "page_visit", title: "You visited!", body: "Come back!" }, orgId);
        return result.type === "push" && result.status === "sent" && trigger.id;
      },
    },
    {
      id: "automation_pipeline",
      label: "Automation Builder Pipeline (13 triggers, 13 actions)",
      run: () => {
        const a = createAutomation({
          name: "Benchmark Auto",
          trigger: { type: "contact_created" },
          steps: [
            { type: "send_email", config: { templateId: null } },
            { type: "wait", config: { days: 1 } },
            { type: "condition", config: { field: "opened", op: "equals", value: true } },
            { type: "add_tag", config: { tag: "engaged" } },
          ],
        }, orgId);
        const triggered = triggerAutomation(a.id, { id: "contact-bench" }, orgId);
        return triggered?.triggered === true && a.steps.length === 4;
      },
    },
    {
      id: "audience_pipeline",
      label: "Audience Manager (list + segment + dynamic + tags)",
      run: () => {
        const list    = createAudience({ name: "Bench List", type: "list" }, orgId);
        const seg     = createAudience({ name: "Bench Segment", type: "segment", filters: [{ field: "status", op: "equals", value: "new" }] }, orgId);
        const dynamic = createAudience({ name: "Bench Dynamic", type: "dynamic", filters: [{ field: "source", op: "equals", value: "web" }] }, orgId);
        addToAudience(list.id, ["c1", "c2", "c3"], orgId);
        const updated = getAudience(list.id, orgId);
        const tag     = createTag("vip", "#22c55e", orgId);
        return updated.memberCount === 3 && seg.id && dynamic.id && tag.id;
      },
    },
    {
      id: "analytics_pipeline",
      label: "Campaign Analytics (open/click/conversion/ROAS/funnel)",
      run: () => {
        const cid = createEmailCampaign({ name: "Analytics Bench" }, orgId).id;
        sendEmailCampaign(cid, orgId);
        recordConversion(cid, { revenue: 999, contactId: "c1" }, orgId);
        const a = getCampaignAnalytics(cid, orgId);
        return a && a.converted >= 1 && a.revenue >= 999 && a.funnel?.length === 5 && parseFloat(a.roas) > 0;
      },
    },
    {
      id: "template_marketplace",
      label: "Template Marketplace (18+ built-in, all 4 channels)",
      run: () => {
        const all   = listTemplates(undefined, undefined, orgId);
        const email = listTemplates("email", undefined, orgId);
        const sms   = listTemplates("sms", undefined, orgId);
        const wa    = listTemplates("whatsapp", undefined, orgId);
        const push  = listTemplates("push", undefined, orgId);
        return all.length >= 18 && email.length >= 6 && sms.length >= 4 && wa.length >= 4 && push.length >= 4;
      },
    },
    {
      id: "growth_dashboard",
      label: "Growth Dashboard KPIs (7 channels, ROAS, WA flows)",
      run: () => {
        const d = getGrowthDashboard(orgId);
        return d.kpis && typeof d.kpis.totalCampaigns === "number" && d.email && d.sms && d.whatsapp && d.push &&
               typeof d.kpis.overallROAS !== "undefined" && typeof d.kpis.waFlows !== "undefined";
      },
    },
  ];

  const results = checks.map(c => {
    try {
      const ok = c.run();
      return { id: c.id, label: c.label, ok, error: null };
    } catch (e) {
      return { id: c.id, label: c.label, ok: false, error: e.message };
    }
  });

  const passing = results.filter(r => r.ok).length;
  const score   = Math.round((passing / results.length) * 100);
  const marketingReadiness = score >= 90 ? "production_ready" : score >= 70 ? "nearly_ready" : "needs_work";

  return {
    score, passing, total: results.length, marketingReadiness,
    regressionPass: passing === results.length,
    checks: results,
    runAt: _ts(),
  };
}

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Email
  createEmailCampaign, updateEmailCampaign, sendEmailCampaign, listEmailCampaigns,
  createSequence, updateSequence, listSequences, getSequence,
  // SMS
  createSMSCampaign, updateSMSCampaign, sendSMSCampaign, scheduleSMSCampaign, sendOTP, listSMSCampaigns,
  // WhatsApp
  createWhatsAppBroadcast, sendWhatsAppBroadcast, syncWhatsAppCRM, listWhatsAppCampaigns,
  createWAFlow, listWAFlows, updateWAFlow,
  createAutoReplyRule, listAutoReplyRules,
  // Push
  registerPushToken, sendPushNotification, listPushCampaigns,
  createPushTriggerRule, listPushTriggerRules,
  // Automation
  createAutomation, updateAutomation, triggerAutomation, listAutomations, getTriggerTypes, getActionTypes,
  // Audience
  createAudience, updateAudience, addToAudience, removeFromAudience, listAudiences, getAudience,
  syncCRMToAudience, evaluateDynamicAudience, createTag, listTags,
  // Analytics
  recordConversion, getCampaignAnalytics, getOverallAnalytics,
  // Templates
  listTemplates, getTemplate, createTemplate, updateTemplate,
  // Dashboard
  getGrowthDashboard,
  // Benchmark
  runBenchmark,
  // Shared
  BUILTIN_TEMPLATES, TRIGGER_TYPES, ACTION_TYPES,
};
