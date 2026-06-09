"use strict";
/**
 * Business AI Operating System — CRM, leads, opportunities, campaigns, revenue, summaries.
 *
 * Entry points:
 *
 * Leads:
 *   createLead(opts)            — capture inbound lead
 *   updateLead(leadId, patch)   — edit lead fields
 *   qualifyLead(leadId, opts)   — mark qualified, convert to opportunity
 *   disqualifyLead(leadId, reason)
 *   deleteLead(leadId)          — soft-delete
 *   getLead(leadId)
 *   listLeads(opts)             — filter by status, source, assignee, limit
 *
 * Contacts:
 *   createContact(opts)         — CRM contact record
 *   updateContact(contactId, patch)
 *   deleteContact(contactId)
 *   getContact(contactId)
 *   listContacts(opts)          — filter by company, tag, limit
 *   searchContacts(query)       — keyword search across name / email / company
 *
 * Opportunities:
 *   createOpportunity(opts)     — sales deal
 *   updateOpportunity(oppId, patch)
 *   advanceStage(oppId, stage)  — move through pipeline stages
 *   closeWon(oppId, opts)       — mark closed-won, record revenue
 *   closeLost(oppId, reason)    — mark closed-lost
 *   getOpportunity(oppId)
 *   listOpportunities(opts)     — filter by stage, assignee, minValue, limit
 *
 * Campaigns:
 *   createCampaign(opts)        — marketing campaign
 *   updateCampaign(campaignId, patch)
 *   recordCampaignEvent(campaignId, event) — click / open / conversion / spend
 *   completeCampaign(campaignId, opts)
 *   getCampaign(campaignId)
 *   listCampaigns(opts)         — filter by status, channel, limit
 *
 * Revenue:
 *   recordRevenue(opts)         — log a revenue event
 *   listRevenue(opts)           — filter by type, dateFrom, dateTo, limit
 *   getRevenueStats(opts)       — totals, MRR, by-type breakdown
 *
 * Summaries:
 *   getBusinessDashboard()      — live snapshot: pipeline, leads, revenue, goals
 *   getDailySummary(date)       — daily business activity roll-up
 *   getWeeklySummary(weekStart) — weekly business metrics
 *   getPipelineSummary()        — stage-by-stage opportunity counts + value
 *
 * Stats:
 *   getStats()                  — row counts across all stores
 *
 * Reuses (all fail-safe):
 *   goalEngine.listGoals({ type: "business" })   — business goals on dashboard
 *   goalEngine.getGoalSummary()                  — goal counts
 *   unifiedMemoryEngine.search()                 — cross-namespace memory search
 *   personalOS.getDailySummary()                 — operator context in business daily
 *   lifecycle-reports.json                       — system maturity in summaries
 *
 * No new architecture. No agent army. No AI calls.
 *
 * Storage (all in data/):
 *   business-leads.json          — leads (max 1000)
 *   business-contacts.json       — contacts (max 2000)
 *   business-opportunities.json  — opportunities / deals (max 500)
 *   business-campaigns.json      — campaigns (max 200)
 *   business-revenue.json        — revenue records (max 5000)
 *
 * Lead shape:
 *   { leadId, name, email, phone, company, source, status, score,
 *     assignee, tags[], notes, opportunityId?,
 *     createdAt, updatedAt, qualifiedAt?, disqualifiedAt?, deletedAt? }
 *
 * Contact shape:
 *   { contactId, name, email, phone, company, title, tags[], notes,
 *     leadId?, opportunityIds[], createdAt, updatedAt, deletedAt? }
 *
 * Opportunity shape:
 *   { oppId, title, contactId?, leadId?, company, value, currency,
 *     stage, assignee, tags[], notes, probability,
 *     campaignId?, goalId?,
 *     createdAt, updatedAt, closedAt?, wonAt?, lostAt?,
 *     closeReason? }
 *
 * Campaign shape:
 *   { campaignId, name, channel, status, budget, spent,
 *     startDate, endDate?, goals{}, metrics{},
 *     tags[], notes, createdAt, updatedAt, completedAt? }
 *
 * Revenue record shape:
 *   { revenueId, amount, currency, type, source, description,
 *     contactId?, oppId?, campaignId?,
 *     recordedAt, createdAt }
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");

const LEADS_PATH    = path.join(DATA_DIR, "business-leads.json");
const CONTACTS_PATH = path.join(DATA_DIR, "business-contacts.json");
const OPPS_PATH     = path.join(DATA_DIR, "business-opportunities.json");
const CAMPAIGNS_PATH= path.join(DATA_DIR, "business-campaigns.json");
const REVENUE_PATH  = path.join(DATA_DIR, "business-revenue.json");

const MAX_LEADS    = 1000;
const MAX_CONTACTS = 2000;
const MAX_OPPS     = 500;
const MAX_CAMPAIGNS= 200;
const MAX_REVENUE  = 5000;

// ── Pipeline stages (ordered) ─────────────────────────────────────
const PIPELINE_STAGES = ["prospect", "qualified", "proposal", "negotiation", "closed-won", "closed-lost"];
const STAGE_PROBABILITY = { prospect: 10, qualified: 25, proposal: 50, negotiation: 75, "closed-won": 100, "closed-lost": 0 };

// ── Lazy accessors ────────────────────────────────────────────────
function _ge()  { try { return require("./goalEngine.cjs");           } catch { return null; } }
function _ume() { try { return require("./unifiedMemoryEngine.cjs");  } catch { return null; } }
function _pos() { try { return require("./personalOS.cjs");           } catch { return null; } }

// ── Generic store helpers ─────────────────────────────────────────
function _load(filePath) {
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const d   = JSON.parse(raw);
        return Array.isArray(d) ? d : [];
    } catch { return []; }
}

function _save(filePath, items, max) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(items.slice(0, max), null, 2));
    fs.renameSync(tmp, filePath);
}

let _idCtr = Date.now();
function _uid(prefix) { return `${prefix}_${++_idCtr}`; }
function _now() { return new Date().toISOString(); }

function _readJson(name) {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8")); }
    catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════
// LEADS
// ═══════════════════════════════════════════════════════════════════

/**
 * Capture an inbound lead.
 * @param {object} opts
 * @param {string}  opts.name
 * @param {string}  [opts.email]
 * @param {string}  [opts.phone]
 * @param {string}  [opts.company]
 * @param {string}  [opts.source]    "inbound"|"referral"|"ads"|"event"|"cold"|"other"
 * @param {number}  [opts.score]     1–100 lead score
 * @param {string}  [opts.assignee]
 * @param {string[]} [opts.tags]
 * @param {string}  [opts.notes]
 */
function createLead({ name, email = "", phone = "", company = "", source = "inbound",
                      score = 50, assignee = "", tags = [], notes = "" } = {}) {
    if (!name) return { ok: false, error: "name required" };
    const lead = {
        leadId:          _uid("lead"),
        name:            name.slice(0, 200),
        email:           email.slice(0, 200),
        phone:           phone.slice(0, 50),
        company:         company.slice(0, 200),
        source,
        status:          "new",   // new | contacted | qualified | disqualified | converted
        score:           Math.min(100, Math.max(1, score || 50)),
        assignee,
        tags,
        notes:           notes.slice(0, 1000),
        opportunityId:   null,
        createdAt:       _now(),
        updatedAt:       _now(),
        qualifiedAt:     null,
        disqualifiedAt:  null,
        deletedAt:       null,
    };
    const all = _load(LEADS_PATH);
    all.unshift(lead);
    _save(LEADS_PATH, all, MAX_LEADS);
    return lead;
}

function updateLead(leadId, patch = {}) {
    const all = _load(LEADS_PATH);
    const idx = all.findIndex(l => l.leadId === leadId);
    if (idx === -1) return { ok: false, error: "lead_not_found" };
    const allowed = ["name","email","phone","company","source","status","score","assignee","tags","notes"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _save(LEADS_PATH, all, MAX_LEADS);
    return { ok: true, lead: all[idx] };
}

function qualifyLead(leadId, { notes = "" } = {}) {
    const all = _load(LEADS_PATH);
    const idx = all.findIndex(l => l.leadId === leadId);
    if (idx === -1) return { ok: false, error: "lead_not_found" };
    if (all[idx].deletedAt) return { ok: false, error: "lead_deleted" };
    all[idx].status      = "qualified";
    all[idx].qualifiedAt = _now();
    all[idx].updatedAt   = _now();
    if (notes) all[idx].notes = notes;
    _save(LEADS_PATH, all, MAX_LEADS);
    return { ok: true, lead: all[idx] };
}

function disqualifyLead(leadId, reason = "") {
    const all = _load(LEADS_PATH);
    const idx = all.findIndex(l => l.leadId === leadId);
    if (idx === -1) return { ok: false, error: "lead_not_found" };
    all[idx].status          = "disqualified";
    all[idx].disqualifiedAt  = _now();
    all[idx].updatedAt       = _now();
    if (reason) all[idx].notes = reason;
    _save(LEADS_PATH, all, MAX_LEADS);
    return { ok: true, lead: all[idx] };
}

function deleteLead(leadId) {
    const all = _load(LEADS_PATH);
    const idx = all.findIndex(l => l.leadId === leadId);
    if (idx === -1) return { ok: false, error: "lead_not_found" };
    all[idx].deletedAt = _now();
    all[idx].status    = "deleted";
    all[idx].updatedAt = _now();
    _save(LEADS_PATH, all, MAX_LEADS);
    return { ok: true };
}

function getLead(leadId) {
    return _load(LEADS_PATH).find(l => l.leadId === leadId) || null;
}

/**
 * @param {object} opts
 * @param {string}  [opts.status]
 * @param {string}  [opts.source]
 * @param {string}  [opts.assignee]
 * @param {number}  [opts.minScore]
 * @param {number}  [opts.limit=50]
 */
function listLeads({ status, source, assignee, minScore, limit = 50 } = {}) {
    let items = _load(LEADS_PATH).filter(l => l.status !== "deleted");
    if (status)   items = items.filter(l => l.status === status);
    if (source)   items = items.filter(l => l.source === source);
    if (assignee) items = items.filter(l => l.assignee === assignee);
    if (minScore) items = items.filter(l => l.score >= minScore);
    return items.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// CONTACTS
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {object} opts
 * @param {string}  opts.name
 * @param {string}  [opts.email]
 * @param {string}  [opts.phone]
 * @param {string}  [opts.company]
 * @param {string}  [opts.title]
 * @param {string[]} [opts.tags]
 * @param {string}  [opts.notes]
 * @param {string}  [opts.leadId]
 */
function createContact({ name, email = "", phone = "", company = "", title = "",
                          tags = [], notes = "", leadId } = {}) {
    if (!name) return { ok: false, error: "name required" };
    const contact = {
        contactId:      _uid("cnt"),
        name:           name.slice(0, 200),
        email:          email.slice(0, 200),
        phone:          phone.slice(0, 50),
        company:        company.slice(0, 200),
        title:          title.slice(0, 100),
        tags,
        notes:          notes.slice(0, 1000),
        leadId:         leadId || null,
        opportunityIds: [],
        createdAt:      _now(),
        updatedAt:      _now(),
        deletedAt:      null,
    };
    const all = _load(CONTACTS_PATH);
    all.unshift(contact);
    _save(CONTACTS_PATH, all, MAX_CONTACTS);
    return contact;
}

function updateContact(contactId, patch = {}) {
    const all = _load(CONTACTS_PATH);
    const idx = all.findIndex(c => c.contactId === contactId);
    if (idx === -1) return { ok: false, error: "contact_not_found" };
    const allowed = ["name","email","phone","company","title","tags","notes"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _save(CONTACTS_PATH, all, MAX_CONTACTS);
    return { ok: true, contact: all[idx] };
}

function deleteContact(contactId) {
    const all = _load(CONTACTS_PATH);
    const idx = all.findIndex(c => c.contactId === contactId);
    if (idx === -1) return { ok: false, error: "contact_not_found" };
    all[idx].deletedAt = _now();
    all[idx].updatedAt = _now();
    _save(CONTACTS_PATH, all, MAX_CONTACTS);
    return { ok: true };
}

function getContact(contactId) {
    return _load(CONTACTS_PATH).find(c => c.contactId === contactId) || null;
}

function listContacts({ company, tags, limit = 50 } = {}) {
    let items = _load(CONTACTS_PATH).filter(c => !c.deletedAt);
    if (company) items = items.filter(c => c.company.toLowerCase().includes(company.toLowerCase()));
    if (tags?.length) items = items.filter(c => tags.some(t => c.tags?.includes(t)));
    return items.slice(0, limit);
}

function searchContacts(query, { limit = 20 } = {}) {
    if (!query) return [];
    const q = query.toLowerCase();
    return _load(CONTACTS_PATH)
        .filter(c => !c.deletedAt)
        .filter(c =>
            c.name.toLowerCase().includes(q) ||
            c.email.toLowerCase().includes(q) ||
            c.company.toLowerCase().includes(q) ||
            c.title.toLowerCase().includes(q)
        )
        .slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// OPPORTUNITIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a sales opportunity.
 * @param {object} opts
 * @param {string}  opts.title
 * @param {number}  [opts.value]      deal value in minor units / dollars
 * @param {string}  [opts.currency]   "USD"|"INR"|"EUR"…
 * @param {string}  [opts.stage]      pipeline stage (default "prospect")
 * @param {string}  [opts.contactId]
 * @param {string}  [opts.leadId]
 * @param {string}  [opts.company]
 * @param {string}  [opts.assignee]
 * @param {string}  [opts.campaignId]
 * @param {string}  [opts.goalId]
 * @param {string[]} [opts.tags]
 * @param {string}  [opts.notes]
 */
function createOpportunity({ title, value = 0, currency = "USD", stage = "prospect",
                              contactId, leadId, company = "", assignee = "",
                              campaignId, goalId, tags = [], notes = "" } = {}) {
    if (!title) return { ok: false, error: "title required" };
    const validStage = PIPELINE_STAGES.includes(stage) ? stage : "prospect";
    const opp = {
        oppId:       _uid("opp"),
        title:       title.slice(0, 200),
        value:       Number(value) || 0,
        currency,
        stage:       validStage,
        probability: STAGE_PROBABILITY[validStage],
        contactId:   contactId || null,
        leadId:      leadId    || null,
        company:     company.slice(0, 200),
        assignee,
        campaignId:  campaignId || null,
        goalId:      goalId     || null,
        tags,
        notes:       notes.slice(0, 1000),
        createdAt:   _now(),
        updatedAt:   _now(),
        closedAt:    null,
        wonAt:       null,
        lostAt:      null,
        closeReason: null,
    };
    const all = _load(OPPS_PATH);
    all.unshift(opp);
    _save(OPPS_PATH, all, MAX_OPPS);

    // Link contact
    if (contactId) {
        const contacts = _load(CONTACTS_PATH);
        const ci = contacts.findIndex(c => c.contactId === contactId);
        if (ci !== -1 && !contacts[ci].opportunityIds.includes(opp.oppId)) {
            contacts[ci].opportunityIds.push(opp.oppId);
            contacts[ci].updatedAt = _now();
            _save(CONTACTS_PATH, contacts, MAX_CONTACTS);
        }
    }
    return opp;
}

function updateOpportunity(oppId, patch = {}) {
    const all = _load(OPPS_PATH);
    const idx = all.findIndex(o => o.oppId === oppId);
    if (idx === -1) return { ok: false, error: "opportunity_not_found" };
    const allowed = ["title","value","currency","stage","probability","contactId","company","assignee","campaignId","goalId","tags","notes"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    if (patch.stage && PIPELINE_STAGES.includes(patch.stage) && patch.probability === undefined) {
        all[idx].probability = STAGE_PROBABILITY[patch.stage];
    }
    all[idx].updatedAt = _now();
    _save(OPPS_PATH, all, MAX_OPPS);
    return { ok: true, opportunity: all[idx] };
}

function advanceStage(oppId, stage) {
    if (!PIPELINE_STAGES.includes(stage)) return { ok: false, error: "invalid_stage" };
    const all = _load(OPPS_PATH);
    const idx = all.findIndex(o => o.oppId === oppId);
    if (idx === -1) return { ok: false, error: "opportunity_not_found" };
    all[idx].stage       = stage;
    all[idx].probability = STAGE_PROBABILITY[stage];
    all[idx].updatedAt   = _now();
    _save(OPPS_PATH, all, MAX_OPPS);
    return { ok: true, opportunity: all[idx] };
}

function closeWon(oppId, { notes = "", revenueNote = "" } = {}) {
    const all = _load(OPPS_PATH);
    const idx = all.findIndex(o => o.oppId === oppId);
    if (idx === -1) return { ok: false, error: "opportunity_not_found" };
    const opp = all[idx];
    opp.stage       = "closed-won";
    opp.probability = 100;
    opp.wonAt       = _now();
    opp.closedAt    = _now();
    opp.updatedAt   = _now();
    if (notes) opp.notes = notes;
    _save(OPPS_PATH, all, MAX_OPPS);

    // Auto-record revenue
    if (opp.value > 0) {
        recordRevenue({
            amount:      opp.value,
            currency:    opp.currency,
            type:        "sale",
            source:      "opportunity",
            description: revenueNote || `Won: ${opp.title}`,
            contactId:   opp.contactId,
            oppId:       opp.oppId,
            campaignId:  opp.campaignId,
        });
    }
    return { ok: true, opportunity: opp };
}

function closeLost(oppId, reason = "") {
    const all = _load(OPPS_PATH);
    const idx = all.findIndex(o => o.oppId === oppId);
    if (idx === -1) return { ok: false, error: "opportunity_not_found" };
    all[idx].stage       = "closed-lost";
    all[idx].probability = 0;
    all[idx].lostAt      = _now();
    all[idx].closedAt    = _now();
    all[idx].updatedAt   = _now();
    all[idx].closeReason = reason;
    _save(OPPS_PATH, all, MAX_OPPS);
    return { ok: true, opportunity: all[idx] };
}

function getOpportunity(oppId) {
    return _load(OPPS_PATH).find(o => o.oppId === oppId) || null;
}

function listOpportunities({ stage, assignee, minValue, contactId, campaignId, limit = 50 } = {}) {
    let items = _load(OPPS_PATH);
    if (stage)      items = items.filter(o => o.stage === stage);
    if (assignee)   items = items.filter(o => o.assignee === assignee);
    if (contactId)  items = items.filter(o => o.contactId === contactId);
    if (campaignId) items = items.filter(o => o.campaignId === campaignId);
    if (minValue)   items = items.filter(o => o.value >= minValue);
    return items.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// CAMPAIGNS
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a marketing campaign.
 * @param {object} opts
 * @param {string}  opts.name
 * @param {string}  [opts.channel]    "email"|"social"|"ads"|"seo"|"events"|"content"|"other"
 * @param {number}  [opts.budget]
 * @param {string}  [opts.startDate]  ISO date
 * @param {string}  [opts.endDate]
 * @param {object}  [opts.goals]      { leads: n, conversions: n, revenue: n }
 * @param {string[]} [opts.tags]
 * @param {string}  [opts.notes]
 */
function createCampaign({ name, channel = "other", budget = 0, startDate, endDate,
                           goals = {}, tags = [], notes = "" } = {}) {
    if (!name) return { ok: false, error: "name required" };
    const campaign = {
        campaignId:  _uid("camp"),
        name:        name.slice(0, 200),
        channel,
        status:      "draft",   // draft | active | paused | completed
        budget:      Number(budget) || 0,
        spent:       0,
        startDate:   startDate || null,
        endDate:     endDate   || null,
        goals: {
            leads:       goals.leads       || 0,
            conversions: goals.conversions || 0,
            revenue:     goals.revenue     || 0,
        },
        metrics: {
            impressions:  0,
            clicks:       0,
            opens:        0,
            conversions:  0,
            leadsGen:     0,
            revenue:      0,
            spend:        0,
        },
        tags,
        notes:        notes.slice(0, 1000),
        createdAt:    _now(),
        updatedAt:    _now(),
        completedAt:  null,
    };
    const all = _load(CAMPAIGNS_PATH);
    all.unshift(campaign);
    _save(CAMPAIGNS_PATH, all, MAX_CAMPAIGNS);
    return campaign;
}

function updateCampaign(campaignId, patch = {}) {
    const all = _load(CAMPAIGNS_PATH);
    const idx = all.findIndex(c => c.campaignId === campaignId);
    if (idx === -1) return { ok: false, error: "campaign_not_found" };
    const allowed = ["name","channel","status","budget","startDate","endDate","goals","tags","notes"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _save(CAMPAIGNS_PATH, all, MAX_CAMPAIGNS);
    return { ok: true, campaign: all[idx] };
}

/**
 * Record a campaign event (click, open, conversion, spend, lead, impression).
 * @param {string} campaignId
 * @param {object} event
 * @param {string}  event.type   "impression"|"click"|"open"|"conversion"|"lead"|"spend"|"revenue"
 * @param {number}  [event.value]  amount for spend/revenue
 */
function recordCampaignEvent(campaignId, { type, value = 1 } = {}) {
    const all = _load(CAMPAIGNS_PATH);
    const idx = all.findIndex(c => c.campaignId === campaignId);
    if (idx === -1) return { ok: false, error: "campaign_not_found" };
    const m = all[idx].metrics;
    switch (type) {
        case "impression": m.impressions  += value; break;
        case "click":      m.clicks       += value; break;
        case "open":       m.opens        += value; break;
        case "conversion": m.conversions  += value; break;
        case "lead":       m.leadsGen     += value; break;
        case "spend":      m.spend        += value; all[idx].spent += value; break;
        case "revenue":    m.revenue      += value; break;
        default: return { ok: false, error: "unknown_event_type" };
    }
    all[idx].updatedAt = _now();
    _save(CAMPAIGNS_PATH, all, MAX_CAMPAIGNS);
    return { ok: true, metrics: all[idx].metrics };
}

function completeCampaign(campaignId, { notes = "" } = {}) {
    const all = _load(CAMPAIGNS_PATH);
    const idx = all.findIndex(c => c.campaignId === campaignId);
    if (idx === -1) return { ok: false, error: "campaign_not_found" };
    all[idx].status      = "completed";
    all[idx].completedAt = _now();
    all[idx].updatedAt   = _now();
    if (notes) all[idx].notes = notes;
    _save(CAMPAIGNS_PATH, all, MAX_CAMPAIGNS);
    return { ok: true, campaign: all[idx] };
}

function getCampaign(campaignId) {
    return _load(CAMPAIGNS_PATH).find(c => c.campaignId === campaignId) || null;
}

function listCampaigns({ status, channel, limit = 20 } = {}) {
    let items = _load(CAMPAIGNS_PATH);
    if (status)  items = items.filter(c => c.status  === status);
    if (channel) items = items.filter(c => c.channel === channel);
    return items.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// REVENUE
// ═══════════════════════════════════════════════════════════════════

/**
 * Record a revenue event.
 * @param {object} opts
 * @param {number}  opts.amount
 * @param {string}  [opts.currency]    "USD"|"INR"|"EUR"…
 * @param {string}  [opts.type]        "sale"|"subscription"|"service"|"refund"|"other"
 * @param {string}  [opts.source]      free-text origin
 * @param {string}  [opts.description]
 * @param {string}  [opts.contactId]
 * @param {string}  [opts.oppId]
 * @param {string}  [opts.campaignId]
 * @param {string}  [opts.recordedAt]  ISO — defaults to now
 */
function recordRevenue({ amount, currency = "USD", type = "sale", source = "direct",
                         description = "", contactId, oppId, campaignId, recordedAt } = {}) {
    if (!amount || isNaN(Number(amount))) return { ok: false, error: "amount required" };
    const rec = {
        revenueId:   _uid("rev"),
        amount:      Number(amount),
        currency,
        type,
        source,
        description: description.slice(0, 500),
        contactId:   contactId  || null,
        oppId:       oppId      || null,
        campaignId:  campaignId || null,
        recordedAt:  recordedAt || _now(),
        createdAt:   _now(),
    };
    const all = _load(REVENUE_PATH);
    all.unshift(rec);
    _save(REVENUE_PATH, all, MAX_REVENUE);
    return { ok: true, record: rec };
}

function listRevenue({ type, dateFrom, dateTo, oppId, contactId, limit = 50 } = {}) {
    let items = _load(REVENUE_PATH);
    if (type)      items = items.filter(r => r.type      === type);
    if (oppId)     items = items.filter(r => r.oppId     === oppId);
    if (contactId) items = items.filter(r => r.contactId === contactId);
    if (dateFrom)  items = items.filter(r => r.recordedAt >= dateFrom);
    if (dateTo)    items = items.filter(r => r.recordedAt <= dateTo);
    return items.slice(0, limit);
}

/**
 * Revenue stats: total, by-type breakdown, MRR estimate.
 */
function getRevenueStats({ dateFrom, dateTo, currency } = {}) {
    let items = _load(REVENUE_PATH);
    if (dateFrom)  items = items.filter(r => r.recordedAt >= dateFrom);
    if (dateTo)    items = items.filter(r => r.recordedAt <= dateTo);
    if (currency)  items = items.filter(r => r.currency   === currency);

    const byType = {};
    let total = 0;
    for (const r of items) {
        if (r.type !== "refund") total += r.amount;
        byType[r.type] = (byType[r.type] || 0) + r.amount;
    }

    // MRR estimate: subscription revenue in last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const mrrItems = _load(REVENUE_PATH).filter(r =>
        r.type === "subscription" && r.recordedAt >= thirtyDaysAgo
    );
    const mrr = mrrItems.reduce((s, r) => s + r.amount, 0);

    return { total, byType, mrr, count: items.length };
}

// ═══════════════════════════════════════════════════════════════════
// PIPELINE SUMMARY
// ═══════════════════════════════════════════════════════════════════

function getPipelineSummary() {
    const opps = _load(OPPS_PATH);
    const stages = {};
    for (const s of PIPELINE_STAGES) {
        stages[s] = { count: 0, value: 0 };
    }
    for (const o of opps) {
        if (!stages[o.stage]) continue;
        stages[o.stage].count++;
        stages[o.stage].value += o.value || 0;
    }
    const open = opps.filter(o => !["closed-won","closed-lost"].includes(o.stage));
    const totalPipelineValue = open.reduce((s, o) => s + (o.value || 0), 0);
    const weightedValue = open.reduce((s, o) => s + (o.value || 0) * (o.probability || 0) / 100, 0);
    return { stages, totalPipelineValue, weightedValue, openCount: open.length };
}

// ═══════════════════════════════════════════════════════════════════
// BUSINESS DASHBOARD
// ═══════════════════════════════════════════════════════════════════

function getBusinessDashboard() {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    // Leads
    const allLeads    = _load(LEADS_PATH).filter(l => l.status !== "deleted");
    const newLeads    = allLeads.filter(l => l.status === "new");
    const qualified   = allLeads.filter(l => l.status === "qualified");

    // Opportunities
    const pipeline    = getPipelineSummary();
    const openOpps    = _load(OPPS_PATH).filter(o => !["closed-won","closed-lost"].includes(o.stage));
    const urgentOpps  = openOpps.filter(o => o.probability >= 75).slice(0, 5);

    // Revenue today
    const dayStart    = today + "T00:00:00.000Z";
    const dayEnd      = today + "T23:59:59.999Z";
    const revenueToday = _load(REVENUE_PATH)
        .filter(r => r.recordedAt >= dayStart && r.recordedAt <= dayEnd)
        .reduce((s, r) => s + (r.type !== "refund" ? r.amount : 0), 0);

    // Revenue this month
    const monthStart  = now.slice(0, 7) + "-01T00:00:00.000Z";
    const revenueMonth = _load(REVENUE_PATH)
        .filter(r => r.recordedAt >= monthStart)
        .reduce((s, r) => s + (r.type !== "refund" ? r.amount : 0), 0);

    // Active campaigns
    const activeCampaigns = _load(CAMPAIGNS_PATH).filter(c => c.status === "active").slice(0, 5);

    // Goals (business type)
    const ge        = _ge();
    const bizGoals  = ge ? ge.listGoals({ type: "business", status: "active", limit: 5 }) : [];
    const goalSum   = ge ? ge.getGoalSummary() : null;

    // Recent contacts
    const recentContacts = _load(CONTACTS_PATH).filter(c => !c.deletedAt).slice(0, 5);

    return {
        generatedAt: now,
        leads: {
            total:     allLeads.length,
            new:       newLeads.length,
            qualified: qualified.length,
            topNew:    newLeads.slice(0, 5),
        },
        pipeline,
        urgentOpportunities: urgentOpps,
        revenue: {
            today:     revenueToday,
            thisMonth: revenueMonth,
        },
        campaigns: {
            active: activeCampaigns.length,
            list:   activeCampaigns,
        },
        goals: {
            business: bizGoals.length,
            summary:  goalSum,
            top:      bizGoals.slice(0, 3),
        },
        recentContacts,
    };
}

// ═══════════════════════════════════════════════════════════════════
// DAILY SUMMARY
// ═══════════════════════════════════════════════════════════════════

function getDailySummary(date) {
    const target   = date || new Date().toISOString().slice(0, 10);
    const dayStart = target + "T00:00:00.000Z";
    const dayEnd   = target + "T23:59:59.999Z";

    const allLeads = _load(LEADS_PATH);
    const allOpps  = _load(OPPS_PATH);
    const allRev   = _load(REVENUE_PATH);
    const allCamps = _load(CAMPAIGNS_PATH);

    const leadsToday    = allLeads.filter(l => l.createdAt >= dayStart && l.createdAt <= dayEnd && l.status !== "deleted");
    const qualToday     = allLeads.filter(l => l.qualifiedAt >= dayStart && l.qualifiedAt <= dayEnd);
    const oppsCreated   = allOpps.filter(o => o.createdAt >= dayStart && o.createdAt <= dayEnd);
    const oppsWon       = allOpps.filter(o => o.wonAt >= dayStart && o.wonAt <= dayEnd);
    const oppsLost      = allOpps.filter(o => o.lostAt >= dayStart && o.lostAt <= dayEnd);
    const revenueToday  = allRev.filter(r => r.recordedAt >= dayStart && r.recordedAt <= dayEnd);
    const totalRevToday = revenueToday.reduce((s, r) => s + (r.type !== "refund" ? r.amount : 0), 0);

    const ge         = _ge();
    const bizGoals   = ge ? ge.listGoals({ type: "business", status: "active", limit: 10 }) : [];

    const highlights = [];
    if (leadsToday.length)   highlights.push(`${leadsToday.length} new lead(s) captured`);
    if (qualToday.length)    highlights.push(`${qualToday.length} lead(s) qualified`);
    if (oppsWon.length)      highlights.push(`${oppsWon.length} deal(s) closed-won`);
    if (oppsLost.length)     highlights.push(`${oppsLost.length} deal(s) closed-lost`);
    if (totalRevToday > 0)   highlights.push(`Revenue today: ${totalRevToday}`);
    if (bizGoals.length)     highlights.push(`${bizGoals.length} active business goal(s)`);

    return {
        date:            target,
        generatedAt:     new Date().toISOString(),
        leadsCreated:    leadsToday.length,
        leadsQualified:  qualToday.length,
        oppsCreated:     oppsCreated.length,
        oppsWon:         oppsWon.length,
        oppsLost:        oppsLost.length,
        revenueToday:    totalRevToday,
        revenueEvents:   revenueToday.length,
        activeCampaigns: allCamps.filter(c => c.status === "active").length,
        businessGoals:   bizGoals.length,
        goalList:        bizGoals.slice(0, 3).map(g => ({ goalId: g.goalId, title: g.title, completionPct: g.completionPct })),
        highlights,
    };
}

// ═══════════════════════════════════════════════════════════════════
// WEEKLY SUMMARY
// ═══════════════════════════════════════════════════════════════════

function getWeeklySummary(weekStart) {
    const now = new Date();
    let start;
    if (weekStart) {
        start = new Date(weekStart + "T00:00:00.000Z");
    } else {
        start = new Date(now);
        const day = start.getUTCDay();
        start.setUTCDate(start.getUTCDate() - ((day + 6) % 7));
        start.setUTCHours(0, 0, 0, 0);
    }
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);

    const ws = start.toISOString();
    const we = end.toISOString();

    const allLeads = _load(LEADS_PATH);
    const allOpps  = _load(OPPS_PATH);
    const allRev   = _load(REVENUE_PATH);
    const allCamps = _load(CAMPAIGNS_PATH);

    const leadsThisWeek   = allLeads.filter(l => l.createdAt >= ws && l.createdAt < we && l.status !== "deleted");
    const oppsWon         = allOpps.filter(o => o.wonAt >= ws && o.wonAt < we);
    const oppsLost        = allOpps.filter(o => o.lostAt >= ws && o.lostAt < we);
    const revenueThisWeek = allRev.filter(r => r.recordedAt >= ws && r.recordedAt < we);
    const totalRevWeek    = revenueThisWeek.reduce((s, r) => s + (r.type !== "refund" ? r.amount : 0), 0);
    const campsCompleted  = allCamps.filter(c => c.completedAt >= ws && c.completedAt < we);

    const ge           = _ge();
    const allGoals     = ge ? ge.listGoals({ limit: 50 }) : [];
    const bizGoalsWon  = allGoals.filter(g =>
        g.type === "business" && g.status === "completed" && g.completedAt >= ws && g.completedAt < we
    );

    // Revenue by type this week
    const revByType = {};
    for (const r of revenueThisWeek) {
        revByType[r.type] = (revByType[r.type] || 0) + r.amount;
    }

    // Win rate
    const closed = oppsWon.length + oppsLost.length;
    const winRate = closed > 0 ? Math.round(oppsWon.length / closed * 100) : null;

    const highlights = [];
    if (leadsThisWeek.length)  highlights.push(`${leadsThisWeek.length} new lead(s)`);
    if (oppsWon.length)        highlights.push(`${oppsWon.length} deal(s) won`);
    if (oppsLost.length)       highlights.push(`${oppsLost.length} deal(s) lost`);
    if (totalRevWeek > 0)      highlights.push(`Total revenue: ${totalRevWeek}`);
    if (winRate !== null)       highlights.push(`Win rate: ${winRate}%`);
    if (campsCompleted.length)  highlights.push(`${campsCompleted.length} campaign(s) completed`);
    if (bizGoalsWon.length)    highlights.push(`${bizGoalsWon.length} business goal(s) achieved`);

    return {
        weekStart:           start.toISOString().slice(0, 10),
        weekEnd:             end.toISOString().slice(0, 10),
        generatedAt:         new Date().toISOString(),
        leadsGenerated:      leadsThisWeek.length,
        dealsWon:            oppsWon.length,
        dealsLost:           oppsLost.length,
        winRate,
        totalRevenue:        totalRevWeek,
        revenueByType:       revByType,
        campaignsCompleted:  campsCompleted.length,
        goalsAchieved:       bizGoalsWon.length,
        pipeline:            getPipelineSummary(),
        highlights,
        topDealsWon:         oppsWon.slice(0, 5).map(o => ({ oppId: o.oppId, title: o.title, value: o.value })),
    };
}

// ═══════════════════════════════════════════════════════════════════
// CROSS-STORE SEARCH
// ═══════════════════════════════════════════════════════════════════

function searchBusiness(query, { limit = 20 } = {}) {
    if (!query) return [];
    const q = query.toLowerCase();
    const results = [];

    const leadHits = listLeads({ limit: 200 })
        .filter(l => l.name.toLowerCase().includes(q) || l.company.toLowerCase().includes(q) || l.email.toLowerCase().includes(q))
        .slice(0, 5)
        .map(l => ({ type: "lead", id: l.leadId, title: l.name, company: l.company }));

    const contactHits = searchContacts(query, { limit: 5 })
        .map(c => ({ type: "contact", id: c.contactId, title: c.name, company: c.company }));

    const oppHits = listOpportunities({ limit: 200 })
        .filter(o => o.title.toLowerCase().includes(q) || o.company.toLowerCase().includes(q))
        .slice(0, 5)
        .map(o => ({ type: "opportunity", id: o.oppId, title: o.title, value: o.value, stage: o.stage }));

    const campHits = listCampaigns({ limit: 100 })
        .filter(c => c.name.toLowerCase().includes(q))
        .slice(0, 3)
        .map(c => ({ type: "campaign", id: c.campaignId, title: c.name, status: c.status }));

    results.push(...leadHits, ...contactHits, ...oppHits, ...campHits);

    // Cross-namespace via UME
    const ume = _ume();
    if (ume) {
        try {
            const umeResults = ume.search(query, { limit: limit - results.length });
            results.push(...umeResults.map(r => ({
                type:    r.type,
                id:      r.entityId,
                title:   r.title,
                ns:      r.ns,
                summary: r.summary,
            })));
        } catch { /* non-fatal */ }
    }

    return results.slice(0, limit);
}

// ── Stats ─────────────────────────────────────────────────────────

function getStats() {
    return {
        leads:         _load(LEADS_PATH).filter(l => l.status !== "deleted").length,
        contacts:      _load(CONTACTS_PATH).filter(c => !c.deletedAt).length,
        opportunities: _load(OPPS_PATH).length,
        campaigns:     _load(CAMPAIGNS_PATH).length,
        revenueEvents: _load(REVENUE_PATH).length,
    };
}

module.exports = {
    // Leads
    createLead, updateLead, qualifyLead, disqualifyLead, deleteLead, getLead, listLeads,
    // Contacts
    createContact, updateContact, deleteContact, getContact, listContacts, searchContacts,
    // Opportunities
    createOpportunity, updateOpportunity, advanceStage, closeWon, closeLost,
    getOpportunity, listOpportunities,
    // Campaigns
    createCampaign, updateCampaign, recordCampaignEvent, completeCampaign, getCampaign, listCampaigns,
    // Revenue
    recordRevenue, listRevenue, getRevenueStats,
    // Summaries
    getBusinessDashboard, getDailySummary, getWeeklySummary, getPipelineSummary,
    // Search & Stats
    searchBusiness, getStats,
};
