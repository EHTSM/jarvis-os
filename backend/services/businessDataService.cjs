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

function _list(file, filterFn, limit = 100) {
    const { items } = _readStore(file);
    const filtered = filterFn ? items.filter(filterFn) : items;
    return { items: filtered.slice(0, limit), total: filtered.length };
}

function _get(file, id) {
    const { items } = _readStore(file);
    return items.find(i => i.id === id) || null;
}

function _create(file, data) {
    const store = _readStore(file);
    store.items.push({ ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    _writeStore(file, store);
    return data;
}

function _update(file, id, patch) {
    const store = _readStore(file);
    const idx   = store.items.findIndex(i => i.id === id);
    if (idx === -1) throw new Error(`Not found: ${id}`);
    store.items[idx] = { ...store.items[idx], ...patch, updatedAt: new Date().toISOString() };
    _writeStore(file, store);
    return store.items[idx];
}

function _remove(file, id) {
    const store = _readStore(file);
    const prev  = store.items.length;
    store.items = store.items.filter(i => i.id !== id);
    if (store.items.length === prev) throw new Error(`Not found: ${id}`);
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

function listLeads({ status, source, assignee, minScore, limit = 50 } = {}) {
    return _list(F_LEADS, l => {
        if (status && l.status !== status) return false;
        if (source && l.source !== source) return false;
        if (assignee && l.assignee !== assignee) return false;
        if (minScore && (l.score || 0) < Number(minScore)) return false;
        return true;
    }, limit);
}

function getLead(id) {
    return _get(F_LEADS, id);
}

function createLead({ name, email, phone, company, source, score, assignee, tags, notes } = {}) {
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
    return _create(F_LEADS, lead);
}

function updateLead(id, patch) {
    if (patch.status && !LEAD_STATUSES.has(patch.status)) throw new Error(`Invalid status: ${patch.status}`);
    return _update(F_LEADS, id, patch);
}

function qualifyLead(id, opts = {}) {
    return _update(F_LEADS, id, { status: "qualified", qualifiedAt: new Date().toISOString(), ...opts });
}

function disqualifyLead(id, reason = "") {
    return _update(F_LEADS, id, { status: "disqualified", disqualifyReason: reason, disqualifiedAt: new Date().toISOString() });
}

function deleteLead(id) {
    return _remove(F_LEADS, id);
}

// ── CONTACTS ──────────────────────────────────────────────────────────────────

function listContacts({ company, search, limit = 50 } = {}) {
    const q = search?.toLowerCase();
    return _list(F_CONTACTS, c => {
        if (company && c.company !== company) return false;
        if (q && !`${c.name} ${c.email} ${c.company}`.toLowerCase().includes(q)) return false;
        return true;
    }, limit);
}

function getContact(id) { return _get(F_CONTACTS, id); }

function createContact({ name, email, phone, company, title, tags, notes, leadId } = {}) {
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
    return _create(F_CONTACTS, contact);
}

function updateContact(id, patch) { return _update(F_CONTACTS, id, patch); }
function deleteContact(id)        { return _remove(F_CONTACTS, id); }

// ── OPPORTUNITIES ─────────────────────────────────────────────────────────────

const OPP_STAGES = ["prospect", "qualified", "proposal", "negotiation", "closed-won", "closed-lost"];

function listOpportunities({ stage, assignee, minValue, limit = 50 } = {}) {
    return _list(F_OPPS, o => {
        if (stage && o.stage !== stage) return false;
        if (assignee && o.assignee !== assignee) return false;
        if (minValue && (o.value || 0) < Number(minValue)) return false;
        return true;
    }, limit);
}

function getOpportunity(id) { return _get(F_OPPS, id); }

function createOpportunity({ title, value, currency, stage, contactId, leadId, company, assignee, campaignId, tags, notes } = {}) {
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
    return _create(F_OPPS, opp);
}

function updateOpportunity(id, patch) { return _update(F_OPPS, id, patch); }

function advanceStage(id, stage) {
    if (!OPP_STAGES.includes(stage)) throw new Error(`Invalid stage: ${stage}. Must be one of: ${OPP_STAGES.join(", ")}`);
    const opp = _get(F_OPPS, id);
    if (!opp) throw new Error(`Opportunity not found: ${id}`);
    const entry = { from: opp.stage, to: stage, at: new Date().toISOString() };
    return _update(F_OPPS, id, { stage, history: [...(opp.history || []), entry] });
}

function closeWon(id, opts = {}) {
    const opp = _get(F_OPPS, id);
    if (!opp) throw new Error(`Opportunity not found: ${id}`);
    const entry = { from: opp.stage, to: "closed-won", at: new Date().toISOString(), ...opts };
    return _update(F_OPPS, id, { stage: "closed-won", closedAt: new Date().toISOString(), closedWonAt: new Date().toISOString(), history: [...(opp.history || []), entry] });
}

function closeLost(id, reason = "") {
    const opp = _get(F_OPPS, id);
    if (!opp) throw new Error(`Opportunity not found: ${id}`);
    const entry = { from: opp.stage, to: "closed-lost", at: new Date().toISOString(), reason };
    return _update(F_OPPS, id, { stage: "closed-lost", closedAt: new Date().toISOString(), lostReason: reason, history: [...(opp.history || []), entry] });
}

// ── CAMPAIGNS ─────────────────────────────────────────────────────────────────

function listCampaigns({ status, channel, limit = 20 } = {}) {
    return _list(F_CAMPS, c => {
        if (status && c.status !== status) return false;
        if (channel && c.channel !== channel) return false;
        return true;
    }, limit);
}

function getCampaign(id) { return _get(F_CAMPS, id); }

function createCampaign({ name, channel, budget, startDate, endDate, goals, tags, notes } = {}) {
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
    return _create(F_CAMPS, camp);
}

function updateCampaign(id, patch) { return _update(F_CAMPS, id, patch); }

function recordCampaignEvent(id, { type, value = 1 } = {}) {
    const camp = _get(F_CAMPS, id);
    if (!camp) throw new Error(`Campaign not found: ${id}`);
    const event = { type, value, at: new Date().toISOString() };
    const metrics = { ...camp.metrics };
    if (type === "impression")  metrics.impressions  = (metrics.impressions  || 0) + value;
    if (type === "click")       metrics.clicks       = (metrics.clicks       || 0) + value;
    if (type === "conversion")  metrics.conversions  = (metrics.conversions  || 0) + value;
    if (type === "revenue")     metrics.revenue      = (metrics.revenue      || 0) + value;
    return _update(F_CAMPS, id, { events: [...(camp.events || []), event], metrics });
}

function completeCampaign(id, opts = {}) {
    return _update(F_CAMPS, id, { status: "completed", completedAt: new Date().toISOString(), ...opts });
}

// ── REVENUE ───────────────────────────────────────────────────────────────────

function listRevenue({ type, dateFrom, dateTo, oppId, limit = 50 } = {}) {
    return _list(F_REV, r => {
        if (type && r.type !== type) return false;
        if (oppId && r.oppId !== oppId) return false;
        if (dateFrom && new Date(r.recordedAt) < new Date(dateFrom)) return false;
        if (dateTo && new Date(r.recordedAt) > new Date(dateTo)) return false;
        return true;
    }, limit);
}

function recordRevenue({ amount, currency, type, source, description, contactId, oppId, campaignId, recordedAt } = {}) {
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
    return _create(F_REV, rev);
}

function getRevenueStats({ dateFrom, dateTo, currency } = {}) {
    const all = listRevenue({ dateFrom, dateTo, limit: 10000 }).items;
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

function getDashboard() {
    const leads = listLeads({ limit: 1000 });
    const opps  = listOpportunities({ limit: 1000 });
    const camps = listCampaigns({ limit: 100 });
    const rev   = listRevenue({ limit: 1000 });

    const totalRevenue    = rev.items.reduce((s, r) => s + r.amount, 0);
    const openOpps        = opps.items.filter(o => !["closed-won", "closed-lost"].includes(o.stage));
    const pipelineValue   = openOpps.reduce((s, o) => s + (o.value || 0), 0);
    const wonThisMonth    = opps.items.filter(o => o.stage === "closed-won" && (o.closedAt || "").startsWith(new Date().toISOString().slice(0, 7)));

    return {
        leads:         { total: leads.total, new: leads.items.filter(l => l.status === "new").length, qualified: leads.items.filter(l => l.status === "qualified").length },
        opportunities: { total: opps.total, open: openOpps.length, pipelineValue, wonThisMonth: wonThisMonth.length },
        campaigns:     { total: camps.total, active: camps.items.filter(c => c.status === "active").length },
        revenue:       { total: totalRevenue, count: rev.total },
    };
}

function getPipelineSummary() {
    const opps = listOpportunities({ limit: 1000 });
    const summary = {};
    for (const stage of ["prospect", "qualified", "proposal", "negotiation", "closed-won", "closed-lost"]) {
        const stageOpps = opps.items.filter(o => o.stage === stage);
        summary[stage] = { count: stageOpps.length, value: stageOpps.reduce((s, o) => s + (o.value || 0), 0) };
    }
    return summary;
}

function getDailySummary() {
    const today = new Date().toISOString().slice(0, 10);
    const leads = listLeads({ limit: 1000 }).items.filter(l => (l.createdAt || "").startsWith(today));
    const rev   = listRevenue({ dateFrom: today + "T00:00:00Z", limit: 1000 });
    return {
        date:        today,
        newLeads:    leads.length,
        revenue:     rev.items.reduce((s, r) => s + r.amount, 0),
    };
}

function getWeeklySummary() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const leads   = listLeads({ limit: 1000 }).items.filter(l => (l.createdAt || "") >= weekAgo);
    const won     = listOpportunities({ limit: 1000 }).items.filter(o => o.stage === "closed-won" && (o.closedAt || "") >= weekAgo);
    const rev     = listRevenue({ dateFrom: weekAgo, limit: 1000 });
    return {
        weekStart:    weekAgo.slice(0, 10),
        newLeads:     leads.length,
        dealsWon:     won.length,
        revenue:      rev.items.reduce((s, r) => s + r.amount, 0),
    };
}

function globalSearch(q, limit = 20) {
    const ql = (q || "").toLowerCase();
    if (!ql) return { results: [] };
    const hits = [];
    const push = (type, item, label) => hits.push({ type, id: item.id, label, createdAt: item.createdAt });

    for (const l of listLeads({ limit: 500 }).items) {
        if (`${l.name} ${l.email} ${l.phone} ${l.company}`.toLowerCase().includes(ql)) push("lead", l, l.name || l.email);
    }
    for (const c of listContacts({ limit: 500 }).items) {
        if (`${c.name} ${c.email} ${c.company}`.toLowerCase().includes(ql)) push("contact", c, c.name || c.email);
    }
    for (const o of listOpportunities({ limit: 500 }).items) {
        if (`${o.title} ${o.company}`.toLowerCase().includes(ql)) push("opportunity", o, o.title);
    }
    for (const c of listCampaigns({ limit: 100 }).items) {
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
