"use strict";
/**
 * businessDataService.cjs — Phase B1: Business OS Data Layer
 *
 * JSON-file storage for business entities:
 *   data/biz-leads.json        — leads (full CRM schema)
 *   data/biz-contacts.json     — contacts
 *   data/biz-opportunities.json — sales pipeline deals
 *   data/biz-campaigns.json    — marketing campaigns
 *   data/biz-revenue.json      — revenue records
 *
 * Same pattern as missionMemory.cjs — no new runtime, no new DB.
 * Each entity store is: { version: 1, items: [], updatedAt }
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "../../data");

function _uid(prefix) {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

// ── Generic store I/O ─────────────────────────────────────────────────────────

function _readStore(file) {
    const p = path.join(DATA_DIR, file);
    try {
        if (!fs.existsSync(p)) return { version: 1, items: [] };
        const raw = fs.readFileSync(p, "utf-8").trim();
        const d   = raw ? JSON.parse(raw) : { version: 1, items: [] };
        if (!Array.isArray(d.items)) d.items = [];
        return d;
    } catch { return { version: 1, items: [] }; }
}

function _writeStore(file, store) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    store.updatedAt = new Date().toISOString();
    fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(store, null, 2));
}

// ── Generic CRUD helpers ──────────────────────────────────────────────────────
//
// Org scoping is additive and opt-in, matching secretVault.cjs's approach:
// every record MAY carry an `orgId` field, but nothing before this change
// wrote one, so pre-existing CRM data (leads/contacts/opps/campaigns/revenue
// created before multi-tenancy) has no orgId at all. Passing an `orgId` to
// _create stamps it on new records going forward; passing one to _list/_get/
// _update/_remove scopes the operation to that org's records only. Omitting
// orgId anywhere (the default, and the only thing every existing call site in
// business.js does today) preserves the exact pre-org-scoping behavior:
// every record is visible/writable, regardless of orgId field. This means
// existing single-tenant installs and already-created CRM records are
// completely unaffected; org isolation only activates for callers that
// explicitly pass an orgId.

function _list(file, filterFn, limit = 100, orgId = null) {
    const { items } = _readStore(file);
    let scoped = orgId ? items.filter(i => i.orgId === orgId) : items;
    const filtered = filterFn ? scoped.filter(filterFn) : scoped;
    return { items: filtered.slice(0, limit), total: filtered.length };
}

function _get(file, id, orgId = null) {
    const { items } = _readStore(file);
    const rec = items.find(i => i.id === id) || null;
    if (!rec) return null;
    if (orgId && rec.orgId !== orgId) return null; // exists, but not in this org's scope
    return rec;
}

function _create(file, data, orgId = null) {
    const store = _readStore(file);
    const record = { ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (orgId) record.orgId = orgId;
    store.items.push(record);
    _writeStore(file, store);
    return record;
}

function _update(file, id, patch, orgId = null) {
    const store = _readStore(file);
    const idx   = store.items.findIndex(i => i.id === id);
    if (idx === -1) throw new Error(`Not found: ${id}`);
    if (orgId && store.items[idx].orgId !== orgId) throw Object.assign(new Error(`Not found: ${id}`), { status: 404 });
    store.items[idx] = { ...store.items[idx], ...patch, updatedAt: new Date().toISOString() };
    _writeStore(file, store);
    return store.items[idx];
}

function _remove(file, id, orgId = null) {
    const store = _readStore(file);
    const target = store.items.find(i => i.id === id);
    if (!target) throw new Error(`Not found: ${id}`);
    if (orgId && target.orgId !== orgId) throw Object.assign(new Error(`Not found: ${id}`), { status: 404 });
    store.items = store.items.filter(i => i.id !== id);
    _writeStore(file, store);
    return { deleted: true, id };
}

// ── Files ─────────────────────────────────────────────────────────────────────
const F_LEADS   = "biz-leads.json";
const F_CONTACTS = "biz-contacts.json";
const F_OPPS    = "biz-opportunities.json";
const F_CAMPS   = "biz-campaigns.json";
const F_REV     = "biz-revenue.json";

// ── LEADS ─────────────────────────────────────────────────────────────────────

const LEAD_STATUSES = new Set(["new", "contacted", "qualified", "disqualified", "converted"]);

function listLeads({ status, source, assignee, minScore, limit = 50, orgId } = {}) {
    return _list(F_LEADS, l => {
        if (status && l.status !== status) return false;
        if (source && l.source !== source) return false;
        if (assignee && l.assignee !== assignee) return false;
        if (minScore && (l.score || 0) < Number(minScore)) return false;
        return true;
    }, limit, orgId || null);
}

function getLead(id, orgId = null) {
    return _get(F_LEADS, id, orgId);
}

function createLead({ name, email, phone, company, source, score, assignee, tags, notes, orgId } = {}) {
    if (!name && !email && !phone) throw new Error("name, email, or phone required");
    const lead = {
        id:         _uid("lead"),
        name:       name || null,
        email:      email || null,
        phone:      phone || null,
        company:    company || null,
        source:     source || "manual",
        score:      score || 0,
        status:     "new",
        assignee:   assignee || null,
        tags:       tags || [],
        notes:      notes || null,
        missionId:  null,
    };
    return _create(F_LEADS, lead, orgId || null);
}

function updateLead(id, patch, orgId = null) {
    if (patch.status && !LEAD_STATUSES.has(patch.status)) throw new Error(`Invalid status: ${patch.status}`);
    return _update(F_LEADS, id, patch, orgId);
}

function qualifyLead(id, opts = {}, orgId = null) {
    return _update(F_LEADS, id, { status: "qualified", qualifiedAt: new Date().toISOString(), ...opts }, orgId);
}

function disqualifyLead(id, reason = "", orgId = null) {
    return _update(F_LEADS, id, { status: "disqualified", disqualifyReason: reason, disqualifiedAt: new Date().toISOString() }, orgId);
}

function deleteLead(id, orgId = null) {
    return _remove(F_LEADS, id, orgId);
}

// ── CONTACTS ──────────────────────────────────────────────────────────────────

function listContacts({ company, search, limit = 50, orgId } = {}) {
    const q = search?.toLowerCase();
    return _list(F_CONTACTS, c => {
        if (company && c.company !== company) return false;
        if (q && !`${c.name} ${c.email} ${c.company}`.toLowerCase().includes(q)) return false;
        return true;
    }, limit, orgId || null);
}

function getContact(id, orgId = null) { return _get(F_CONTACTS, id, orgId); }

function createContact({ name, email, phone, company, title, tags, notes, leadId, orgId } = {}) {
    if (!name && !email) throw new Error("name or email required");
    const contact = {
        id:      _uid("cnt"),
        name:    name || null,
        email:   email || null,
        phone:   phone || null,
        company: company || null,
        title:   title || null,
        tags:    tags || [],
        notes:   notes || null,
        leadId:  leadId || null,
    };
    return _create(F_CONTACTS, contact, orgId || null);
}

function updateContact(id, patch, orgId = null) { return _update(F_CONTACTS, id, patch, orgId); }
function deleteContact(id, orgId = null)        { return _remove(F_CONTACTS, id, orgId); }

// ── OPPORTUNITIES ─────────────────────────────────────────────────────────────

const OPP_STAGES = ["prospect", "qualified", "proposal", "negotiation", "closed-won", "closed-lost"];

function listOpportunities({ stage, assignee, minValue, limit = 50, orgId } = {}) {
    return _list(F_OPPS, o => {
        if (stage && o.stage !== stage) return false;
        if (assignee && o.assignee !== assignee) return false;
        if (minValue && (o.value || 0) < Number(minValue)) return false;
        return true;
    }, limit, orgId || null);
}

function getOpportunity(id, orgId = null) { return _get(F_OPPS, id, orgId); }

function createOpportunity({ title, value, currency, stage, contactId, leadId, company, assignee, campaignId, tags, notes, orgId } = {}) {
    if (!title) throw new Error("title required");
    const opp = {
        id:         _uid("opp"),
        title,
        value:      value || 0,
        currency:   currency || "USD",
        stage:      stage || "prospect",
        contactId:  contactId || null,
        leadId:     leadId || null,
        company:    company || null,
        assignee:   assignee || null,
        campaignId: campaignId || null,
        tags:       tags || [],
        notes:      notes || null,
        missionId:  null,
        history:    [],
    };
    return _create(F_OPPS, opp, orgId || null);
}

function updateOpportunity(id, patch, orgId = null) { return _update(F_OPPS, id, patch, orgId); }

function advanceStage(id, stage, orgId = null) {
    if (!OPP_STAGES.includes(stage)) throw new Error(`Invalid stage: ${stage}. Must be one of: ${OPP_STAGES.join(", ")}`);
    const opp = _get(F_OPPS, id, orgId);
    if (!opp) throw new Error(`Opportunity not found: ${id}`);
    const entry = { from: opp.stage, to: stage, at: new Date().toISOString() };
    return _update(F_OPPS, id, { stage, history: [...(opp.history || []), entry] }, orgId);
}

function closeWon(id, opts = {}, orgId = null) {
    const opp = _get(F_OPPS, id, orgId);
    if (!opp) throw new Error(`Opportunity not found: ${id}`);
    const entry = { from: opp.stage, to: "closed-won", at: new Date().toISOString(), ...opts };
    return _update(F_OPPS, id, { stage: "closed-won", closedAt: new Date().toISOString(), closedWonAt: new Date().toISOString(), history: [...(opp.history || []), entry] }, orgId);
}

function closeLost(id, reason = "", orgId = null) {
    const opp = _get(F_OPPS, id, orgId);
    if (!opp) throw new Error(`Opportunity not found: ${id}`);
    const entry = { from: opp.stage, to: "closed-lost", at: new Date().toISOString(), reason };
    return _update(F_OPPS, id, { stage: "closed-lost", closedAt: new Date().toISOString(), lostReason: reason, history: [...(opp.history || []), entry] }, orgId);
}

// ── CAMPAIGNS ─────────────────────────────────────────────────────────────────

function listCampaigns({ status, channel, limit = 20, orgId } = {}) {
    return _list(F_CAMPS, c => {
        if (status && c.status !== status) return false;
        if (channel && c.channel !== channel) return false;
        return true;
    }, limit, orgId || null);
}

function getCampaign(id, orgId = null) { return _get(F_CAMPS, id, orgId); }

function createCampaign({ name, channel, budget, startDate, endDate, goals, tags, notes, orgId } = {}) {
    if (!name) throw new Error("name required");
    const camp = {
        id:        _uid("camp"),
        name,
        channel:   channel || "email",
        budget:    budget || 0,
        startDate: startDate || null,
        endDate:   endDate || null,
        goals:     goals || [],
        tags:      tags || [],
        notes:     notes || null,
        status:    "active",
        events:    [],
        metrics:   { impressions: 0, clicks: 0, conversions: 0, revenue: 0 },
    };
    return _create(F_CAMPS, camp, orgId || null);
}

function updateCampaign(id, patch, orgId = null) { return _update(F_CAMPS, id, patch, orgId); }

function recordCampaignEvent(id, { type, value = 1 } = {}, orgId = null) {
    const camp = _get(F_CAMPS, id, orgId);
    if (!camp) throw new Error(`Campaign not found: ${id}`);
    const event = { type, value, at: new Date().toISOString() };
    const metrics = { ...camp.metrics };
    if (type === "impression")  metrics.impressions  = (metrics.impressions  || 0) + value;
    if (type === "click")       metrics.clicks       = (metrics.clicks       || 0) + value;
    if (type === "conversion")  metrics.conversions  = (metrics.conversions  || 0) + value;
    if (type === "revenue")     metrics.revenue      = (metrics.revenue      || 0) + value;
    return _update(F_CAMPS, id, { events: [...(camp.events || []), event], metrics }, orgId);
}

function completeCampaign(id, opts = {}, orgId = null) {
    return _update(F_CAMPS, id, { status: "completed", completedAt: new Date().toISOString(), ...opts }, orgId);
}

// ── REVENUE ───────────────────────────────────────────────────────────────────

function listRevenue({ type, dateFrom, dateTo, oppId, limit = 50, orgId } = {}) {
    return _list(F_REV, r => {
        if (type && r.type !== type) return false;
        if (oppId && r.oppId !== oppId) return false;
        if (dateFrom && new Date(r.recordedAt) < new Date(dateFrom)) return false;
        if (dateTo && new Date(r.recordedAt) > new Date(dateTo)) return false;
        return true;
    }, limit, orgId || null);
}

function recordRevenue({ amount, currency, type, source, description, contactId, oppId, campaignId, recordedAt, orgId } = {}) {
    if (!amount || isNaN(amount)) throw new Error("amount (number) required");
    const rev = {
        id:          _uid("rev"),
        amount:      Number(amount),
        currency:    currency || "USD",
        type:        type || "one-time",
        source:      source || "manual",
        description: description || null,
        contactId:   contactId || null,
        oppId:       oppId || null,
        campaignId:  campaignId || null,
        recordedAt:  recordedAt || new Date().toISOString(),
    };
    return _create(F_REV, rev, orgId || null);
}

function getRevenueStats({ dateFrom, dateTo, currency, orgId } = {}) {
    const all = listRevenue({ dateFrom, dateTo, limit: 10000, orgId }).items;
    const cur = currency || "USD";
    const inCurrency = all.filter(r => !currency || r.currency === cur);
    const total      = inCurrency.reduce((s, r) => s + r.amount, 0);
    const byType     = {};
    const bySource   = {};
    const byMonth    = {};
    for (const r of inCurrency) {
        byType[r.type]     = (byType[r.type]   || 0) + r.amount;
        bySource[r.source] = (bySource[r.source] || 0) + r.amount;
        const mo = (r.recordedAt || "").slice(0, 7);
        byMonth[mo] = (byMonth[mo] || 0) + r.amount;
    }
    return { total, currency: cur, count: inCurrency.length, byType, bySource, byMonth };
}

// ── Dashboard aggregate ───────────────────────────────────────────────────────

// A.6 business-owner-journey finding: getDashboard() only ever counted
// leads from this file's own biz-leads.json store. The CRM UI a founder
// actually uses (ContactsV2.jsx → POST /crm/lead) writes to a completely
// separate store — crmService.js's data/leads.json — so a real lead added
// through the CRM never appeared in Reports/Executive Dashboard leads
// counts, confirmed live: added one real contact via Contacts → still
// showed "TOTAL LEADS: 0" while the same page's Pipeline Breakdown
// (a different, correctly-wired widget) showed "Hot: 1". Two independent
// lead stores already exist in this codebase; recovering crmService's own
// real getStats(orgId) here — additive, merged into the existing leads
// aggregate — is the minimal fix, not a data-model merge or new storage.
function _crmLeadStats(orgId) {
    try {
        const crm = require("./crmService.js");
        return crm.getStats(orgId);
    } catch { return { total: 0, new: 0, hot: 0 }; }
}

function getDashboard(orgId = null) {
    const leads = listLeads({ limit: 1000, orgId });
    const opps  = listOpportunities({ limit: 1000, orgId });
    const camps = listCampaigns({ limit: 100, orgId });
    const rev   = listRevenue({ limit: 1000, orgId });
    const crmLeads = _crmLeadStats(orgId);

    const totalRevenue    = rev.items.reduce((s, r) => s + r.amount, 0);
    const openOpps        = opps.items.filter(o => !["closed-won", "closed-lost"].includes(o.stage));
    const pipelineValue   = openOpps.reduce((s, o) => s + (o.value || 0), 0);
    const wonThisMonth    = opps.items.filter(o => o.stage === "closed-won" && (o.closedAt || "").startsWith(new Date().toISOString().slice(0, 7)));

    return {
        leads: {
            total:     leads.total + crmLeads.total,
            new:       leads.items.filter(l => l.status === "new").length + crmLeads.new,
            qualified: leads.items.filter(l => l.status === "qualified").length + (crmLeads.hot || 0),
        },
        opportunities: { total: opps.total, open: openOpps.length, pipelineValue, wonThisMonth: wonThisMonth.length },
        campaigns:     { total: camps.total, active: camps.items.filter(c => c.status === "active").length },
        revenue:       { total: totalRevenue + (crmLeads.revenue || 0), count: rev.total },
    };
}

function getPipelineSummary(orgId = null) {
    const opps = listOpportunities({ limit: 1000, orgId });
    const summary = {};
    for (const stage of ["prospect", "qualified", "proposal", "negotiation", "closed-won", "closed-lost"]) {
        const stageOpps = opps.items.filter(o => o.stage === stage);
        summary[stage] = { count: stageOpps.length, value: stageOpps.reduce((s, o) => s + (o.value || 0), 0) };
    }
    return summary;
}

function getDailySummary(orgId = null) {
    const today = new Date().toISOString().slice(0, 10);
    const leads = listLeads({ limit: 1000, orgId }).items.filter(l => (l.createdAt || "").startsWith(today));
    const rev   = listRevenue({ dateFrom: today + "T00:00:00Z", limit: 1000, orgId });
    return {
        date:        today,
        newLeads:    leads.length,
        revenue:     rev.items.reduce((s, r) => s + r.amount, 0),
    };
}

function getWeeklySummary(orgId = null) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const leads   = listLeads({ limit: 1000, orgId }).items.filter(l => (l.createdAt || "") >= weekAgo);
    const won     = listOpportunities({ limit: 1000, orgId }).items.filter(o => o.stage === "closed-won" && (o.closedAt || "") >= weekAgo);
    const rev     = listRevenue({ dateFrom: weekAgo, limit: 1000, orgId });
    return {
        weekStart:    weekAgo.slice(0, 10),
        newLeads:     leads.length,
        dealsWon:     won.length,
        revenue:      rev.items.reduce((s, r) => s + r.amount, 0),
    };
}

function globalSearch(q, limit = 20, orgId = null) {
    const ql = (q || "").toLowerCase();
    if (!ql) return { results: [] };
    const hits = [];
    const push = (type, item, label) => hits.push({ type, id: item.id, label, createdAt: item.createdAt });

    for (const l of listLeads({ limit: 500, orgId }).items) {
        if (`${l.name} ${l.email} ${l.phone} ${l.company}`.toLowerCase().includes(ql)) push("lead", l, l.name || l.email);
    }
    for (const c of listContacts({ limit: 500, orgId }).items) {
        if (`${c.name} ${c.email} ${c.company}`.toLowerCase().includes(ql)) push("contact", c, c.name || c.email);
    }
    for (const o of listOpportunities({ limit: 500, orgId }).items) {
        if (`${o.title} ${o.company}`.toLowerCase().includes(ql)) push("opportunity", o, o.title);
    }
    for (const c of listCampaigns({ limit: 100, orgId }).items) {
        if (`${c.name} ${c.channel}`.toLowerCase().includes(ql)) push("campaign", c, c.name);
    }

    return { results: hits.slice(0, limit), total: hits.length };
}

module.exports = {
    // Leads
    listLeads, getLead, createLead, updateLead, qualifyLead, disqualifyLead, deleteLead,
    // Contacts
    listContacts, getContact, createContact, updateContact, deleteContact,
    // Opportunities
    listOpportunities, getOpportunity, createOpportunity, updateOpportunity, advanceStage, closeWon, closeLost,
    // Campaigns
    listCampaigns, getCampaign, createCampaign, updateCampaign, recordCampaignEvent, completeCampaign,
    // Revenue
    listRevenue, recordRevenue, getRevenueStats,
    // Aggregates
    getDashboard, getPipelineSummary, getDailySummary, getWeeklySummary, globalSearch,
};
