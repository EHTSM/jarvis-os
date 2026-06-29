"use strict";
/**
 * customerSupportEngine.cjs — POST-Ω P11 Autonomous Customer Organization
 *
 * Suggests and automates resolutions for customer support.
 * Reads from: CLE lessons, revenueOS playbooks, customerSuccess, customerHealth.
 *
 * Storage: data/customer-support.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "customer-support.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _rev = () => _try(() => require("./revenueOS.cjs"));
const _cs  = () => _try(() => require("./customerSuccess.cjs"));
const _che = () => _try(() => require("./customerHealthEngine.cjs"));
const _cje = () => _try(() => require("./customerJourneyEngine.cjs"));
const _cse = () => _try(() => require("./customerSuccessEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `cst_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Resolution templates (reuse from CLE + revenueOS) ─────────────────────────

const RESOLUTION_TEMPLATES = {
  onboarding_stuck: {
    title:    "Onboarding Assistance",
    steps:    ["Send personalized onboarding guide", "Schedule 30-min kickoff call", "Assign CSM to monitor progress"],
    automatable: true,
    minutesSaved: 45,
  },
  payment_issue: {
    title:    "Payment Recovery",
    steps:    ["Send payment failure notification", "Offer grace period", "Provide alternative payment link"],
    automatable: true,
    minutesSaved: 20,
  },
  feature_question: {
    title:    "Feature Guidance",
    steps:    ["Send relevant documentation", "Suggest tutorial video", "Offer 15-min demo if needed"],
    automatable: true,
    minutesSaved: 30,
  },
  churn_risk: {
    title:    "Churn Intervention",
    steps:    ["Escalate to founder/CSM within 24h", "Offer concierge support session", "Provide temporary credit extension", "Create custom recovery plan"],
    automatable: false,
    minutesSaved: 120,
  },
  renewal_support: {
    title:    "Renewal Support",
    steps:    ["Send renewal success recap", "Highlight ROI achieved", "Present renewal proposal with next-tier benefits"],
    automatable: true,
    minutesSaved: 40,
  },
  expansion_ready: {
    title:    "Expansion Facilitation",
    steps:    ["Send upgrade benefits summary", "Offer trial of premium features", "Schedule upgrade call"],
    automatable: true,
    minutesSaved: 35,
  },
  generic: {
    title:    "General Support",
    steps:    ["Acknowledge the issue", "Check knowledge base for solution", "Escalate if unresolved in 4h"],
    automatable: false,
    minutesSaved: 15,
  },
};

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      tickets: [],
      resolutions: [],
      stats: { total: 0, resolved: 0, automated: 0, avgResolutionMinutes: 0, minutesSaved: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.tickets.length     > 500) d.tickets     = d.tickets.slice(-500);
  if (d.resolutions.length > 500) d.resolutions = d.resolutions.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Ticket classification ─────────────────────────────────────────────────────

function _classify(issue) {
  const lower = (issue || "").toLowerCase();
  if (/onboard|setup|start|begin|install/.test(lower))             return "onboarding_stuck";
  if (/pay|billing|invoice|charge|card/.test(lower))               return "payment_issue";
  if (/cancel|churn|quit|leave|stop paying|refund/.test(lower))    return "churn_risk";
  if (/feature|how|does|what|how do|use/.test(lower))              return "feature_question";
  if (/renew|renewal|expir|extend/.test(lower))               return "renewal_support";
  if (/upgrade|expand|more|higher|premium/.test(lower))       return "expansion_ready";
  return "generic";
}

// ── CLE-enhanced resolution ───────────────────────────────────────────────────

function _getRelevantLessons(category) {
  const raw  = _try(() => _cle()?.getRecommendations?.()) || {};
  const recs = Array.isArray(raw) ? raw : (raw.recommendations || []);
  return recs.filter(r => r.status === "open").slice(0, 2).map(r => ({
    source: "cle", action: r.action || r.message || "Review open recommendation",
  }));
}

// ── Core functions ────────────────────────────────────────────────────────────

function createTicket({ customerId, issue, severity = "medium" }) {
  if (!customerId) return { ok: false, error: "customerId required" };

  const category = _classify(issue);
  const template = RESOLUTION_TEMPLATES[category] || RESOLUTION_TEMPLATES.generic;
  const health   = _try(() => _che()?.getHealthRecord?.(customerId)) || null;
  const journey  = _try(() => _cje()?.getJourney?.(customerId))     || null;
  const prediction= _try(() => _cse()?.predict?.(customerId))       || null;

  // Escalate severity based on health
  let finalSeverity = severity;
  if (health?.risk === "critical" && severity !== "critical") finalSeverity = "critical";
  if (health?.risk === "high"     && severity === "low")      finalSeverity = "medium";

  const lessonHints  = _getRelevantLessons(category);
  const suggestedResolution = {
    category,
    template:    template.title,
    steps:       template.steps,
    automatable: template.automatable,
    minutesSaved:template.minutesSaved,
    hints:       lessonHints,
    churnRisk:   prediction?.churn?.probability || health?.risk === "critical" ? "high" : "low",
  };

  const id     = _id();
  const ticket = {
    id, customerId,
    issue:    issue || "General support request",
    category, severity: finalSeverity,
    status:   "open",
    stage:    journey?.stage || null,
    health:   health?.overall || null,
    suggestedResolution,
    createdAt: _ts(),
    updatedAt: _ts(),
  };

  const d = _load();
  d.tickets.push(ticket);
  d.stats.total = d.tickets.length;
  _save(d);

  return { ok: true, ticket };
}

function resolveTicket(ticketId, { resolution, automated = false }) {
  const d   = _load();
  const idx = d.tickets.findIndex(t => t.id === ticketId);
  if (idx < 0) return { ok: false, error: "ticket not found" };

  const ticket = d.tickets[idx];
  ticket.status     = "resolved";
  ticket.resolution = resolution || "Resolved via automated workflow";
  ticket.automated  = automated;
  ticket.resolvedAt = _ts();
  ticket.updatedAt  = _ts();

  const template    = RESOLUTION_TEMPLATES[ticket.category] || RESOLUTION_TEMPLATES.generic;
  const minutesSaved= automated ? (template.minutesSaved || 15) : 0;

  d.resolutions.push({ ticketId, customerId: ticket.customerId, category: ticket.category,
    resolution: ticket.resolution, automated, minutesSaved, resolvedAt: ticket.resolvedAt });

  const resolved  = d.tickets.filter(t => t.status === "resolved").length;
  const automatedN= d.resolutions.filter(r => r.automated).length;
  const totalSaved= d.resolutions.reduce((s, r) => s + (r.minutesSaved || 0), 0);
  d.stats = {
    total:    d.tickets.length,
    resolved, automated: automatedN,
    avgResolutionMinutes: d.resolutions.length ? Math.round(totalSaved / d.resolutions.length) : 0,
    minutesSaved: totalSaved,
  };
  _save(d);

  return { ok: true, ticket, minutesSaved };
}

function getSuggestedResolution(issue, customerId) {
  const category = _classify(issue);
  const template = RESOLUTION_TEMPLATES[category] || RESOLUTION_TEMPLATES.generic;
  const health   = customerId ? (_try(() => _che()?.getHealthRecord?.(customerId)) || null) : null;
  return {
    ok: true,
    category,
    template:     template.title,
    steps:        template.steps,
    automatable:  template.automatable,
    minutesSaved: template.minutesSaved,
    customerHealthRisk: health?.risk || "unknown",
  };
}

function getTicket(id)     { return _load().tickets.find(t => t.id === id) || null; }

function listTickets({ customerId, status, severity, limit = 50 } = {}) {
  let tickets = _load().tickets;
  if (customerId) tickets = tickets.filter(t => t.customerId === customerId);
  if (status)     tickets = tickets.filter(t => t.status     === status);
  if (severity)   tickets = tickets.filter(t => t.severity   === severity);
  return { ok: true, tickets: tickets.slice(0, limit) };
}

function getStats() { return { ...(_load().stats), categories: Object.keys(RESOLUTION_TEMPLATES), updatedAt: _load().updatedAt }; }

module.exports = {
  RESOLUTION_TEMPLATES,
  createTicket,
  resolveTicket,
  getSuggestedResolution,
  getTicket,
  listTickets,
  getStats,
};
