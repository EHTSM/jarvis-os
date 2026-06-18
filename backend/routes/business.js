"use strict";
/**
 * business.js — Phase B1: Business Operating System routes
 *
 * Business entities are missions. Two layers in one file:
 *
 * Layer 1 — CRM Data (businessDataService.cjs → JSON files)
 *   Leads, Contacts, Opportunities, Campaigns, Revenue
 *   Full CRUD matching businessApi.js in the frontend.
 *
 * Layer 2 — Mission Integration (businessEntityModel.cjs)
 *   Entity → Mission mapping; executes on existing Mission Runtime.
 *   No duplicate runtime, memory, or execution engine.
 *
 * Routes (all require auth):
 *   GET    /business/dashboard
 *   GET    /business/pipeline
 *   GET    /business/pipeline/:entityType
 *   GET    /business/stages/:entityType
 *   GET    /business/rules
 *   GET    /business/summary/daily
 *   GET    /business/summary/weekly
 *   GET    /business/stats
 *   GET    /business/search
 *   GET    /business/missions
 *   POST   /business/mission
 *   POST   /business/lead/mission
 *
 *   GET    /business/leads
 *   GET    /business/leads/:id
 *   POST   /business/leads
 *   PATCH  /business/leads/:id
 *   DELETE /business/leads/:id
 *   POST   /business/leads/:id/qualify
 *   POST   /business/leads/:id/disqualify
 *   PATCH  /business/leads/:phone/stage
 *   POST   /business/leads/qualify             (shorthand for CRM leads)
 *
 *   GET    /business/contacts
 *   GET    /business/contacts/:id
 *   POST   /business/contacts
 *   PATCH  /business/contacts/:id
 *   DELETE /business/contacts/:id
 *
 *   GET    /business/opportunities
 *   GET    /business/opportunities/:id
 *   POST   /business/opportunities
 *   PATCH  /business/opportunities/:id
 *   POST   /business/opportunities/:id/advance
 *   POST   /business/opportunities/:id/close-won
 *   POST   /business/opportunities/:id/close-lost
 *
 *   GET    /business/campaigns
 *   GET    /business/campaigns/:id
 *   POST   /business/campaigns
 *   PATCH  /business/campaigns/:id
 *   POST   /business/campaigns/:id/event
 *   POST   /business/campaigns/:id/complete
 *
 *   GET    /business/revenue
 *   POST   /business/revenue
 *   GET    /business/revenue/stats
 *
 *   GET    /business/deals           (alias for mission-layer deals)
 *   POST   /business/deals
 *   GET    /business/marketing/tasks
 *   POST   /business/marketing/tasks
 *   GET    /business/customers
 *   POST   /business/customers
 *   GET    /business/operations
 *   POST   /business/operations
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const logger = require("../utils/logger");

function _bds()  { try { return require("../services/businessDataService.cjs");  } catch { return null; } }
function _bem()  { try { return require("../services/businessEntityModel.cjs");  } catch { return null; } }
function _bma()  { try { return require("../services/businessMissionAutomation.cjs"); } catch { return null; } }

function _ok(res, data)   { res.json({ success: true, ...data }); }
function _err(res, e, status = 500) {
    const msg = e?.message || String(e);
    logger.warn(`[Business] ${msg}`);
    res.status(status).json({ success: false, error: msg });
}
function _svc(res, fn) {
    try {
        const svc = fn();
        if (!svc) return res.status(503).json({ success: false, error: "Service unavailable" });
        return svc;
    } catch (e) { _err(res, e); return null; }
}

// ── Dashboard & aggregates ────────────────────────────────────────────────────

router.get("/business/dashboard", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        _ok(res, bds.getDashboard());
    } catch (e) { _err(res, e); }
});

router.get("/business/pipeline", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        const bem = _bem();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const pipeline = bds.getPipelineSummary();
        const bizMissions = bem?.getPipelineSummary?.() || {};
        const rules = bem?.getBusinessRules?.() || [];
        _ok(res, { pipeline, bizMissions, ruleCount: rules.length });
    } catch (e) { _err(res, e); }
});

router.get("/business/pipeline/:entityType", requireAuth, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const { entityType } = req.params;
        const missions = bem.listBusinessMissions({ entityType, limit: 100 });
        const stages   = bem.getPipelineStages(entityType);
        const byStage  = {};
        for (const s of stages) byStage[s.id] = [];
        for (const m of missions.missions) {
            const stage = m.metadata?.stage || "unknown";
            if (!byStage[stage]) byStage[stage] = [];
            byStage[stage].push(m);
        }
        _ok(res, { entityType, stages, byStage, total: missions.total });
    } catch (e) { _err(res, e); }
});

router.get("/business/stages/:entityType", requireAuth, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        _ok(res, { entityType: req.params.entityType, stages: bem.getPipelineStages(req.params.entityType) });
    } catch (e) { _err(res, e); }
});

router.get("/business/rules", requireAuth, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        _ok(res, { rules: bem.getBusinessRules() });
    } catch (e) { _err(res, e); }
});

router.get("/business/summary/daily", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        _ok(res, bds.getDailySummary());
    } catch (e) { _err(res, e); }
});

router.get("/business/summary/weekly", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        _ok(res, bds.getWeeklySummary());
    } catch (e) { _err(res, e); }
});

router.get("/business/stats", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const dash = bds.getDashboard();
        const rev  = bds.getRevenueStats({});
        _ok(res, { ...dash, revenue: rev });
    } catch (e) { _err(res, e); }
});

router.get("/business/search", requireAuth, (req, res) => {
    try {
        const bds   = _bds();
        const q     = req.query.q || "";
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        _ok(res, bds.globalSearch(q, limit));
    } catch (e) { _err(res, e); }
});

// ── Business missions (mission-layer) ─────────────────────────────────────────

router.get("/business/missions", requireAuth, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const { entityType, status, limit } = req.query;
        const result = bem.listBusinessMissions({ entityType, status, limit: limit ? parseInt(limit, 10) : 50 });
        _ok(res, result);
    } catch (e) { _err(res, e); }
});

router.post("/business/mission", requireAuth, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const { entityType, entity, priority } = req.body;
        if (!entityType) return res.status(400).json({ success: false, error: "entityType required" });
        if (!entity || typeof entity !== "object") return res.status(400).json({ success: false, error: "entity object required" });
        const mission = bem.createBusinessMission(entityType, entity, { priority });
        _ok(res, { mission });
    } catch (e) { _err(res, e); }
});

router.post("/business/lead/mission", requireAuth, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const { name, phone, email, source, priority } = req.body;
        if (!name && !phone && !email) return res.status(400).json({ success: false, error: "name, phone, or email required" });
        const mission = bem.createBusinessMission("lead", { name, phone, email, source, status: "new" }, { priority });
        _ok(res, { mission });
    } catch (e) { _err(res, e); }
});

// ── Leads ─────────────────────────────────────────────────────────────────────

router.get("/business/leads", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { status, source, assignee, minScore, limit } = req.query;
        const result = bds.listLeads({ status, source, assignee, minScore, limit: limit ? parseInt(limit, 10) : 50 });
        _ok(res, { leads: result.items, total: result.total });
    } catch (e) { _err(res, e); }
});

router.get("/business/leads/:id", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const lead = bds.getLead(req.params.id);
        if (!lead) return res.status(404).json({ success: false, error: "Lead not found" });
        _ok(res, { lead });
    } catch (e) { _err(res, e); }
});

router.post("/business/leads", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const lead = bds.createLead(req.body);
        _ok(res, { lead });
    } catch (e) { _err(res, e, 400); }
});

router.patch("/business/leads/:id", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const lead = bds.updateLead(req.params.id, req.body);
        _ok(res, { lead });
    } catch (e) { _err(res, e, e.message.includes("Not found") ? 404 : 400); }
});

router.delete("/business/leads/:id", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        _ok(res, bds.deleteLead(req.params.id));
    } catch (e) { _err(res, e, 404); }
});

router.post("/business/leads/:id/qualify", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const lead = bds.qualifyLead(req.params.id, req.body);
        _ok(res, { lead });
    } catch (e) { _err(res, e, e.message.includes("Not found") ? 404 : 400); }
});

router.post("/business/leads/:id/disqualify", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { reason } = req.body;
        const lead = bds.disqualifyLead(req.params.id, reason);
        _ok(res, { lead });
    } catch (e) { _err(res, e, e.message.includes("Not found") ? 404 : 400); }
});

// Qualify from old CRM phone-based leads (compat route)
router.post("/business/leads/qualify", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        const bem = _bem();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { phone, priority } = req.body;
        if (!phone) return res.status(400).json({ success: false, error: "phone required" });
        // Attempt to find lead by phone
        const all = bds.listLeads({ limit: 1000 });
        const lead = all.items.find(l => String(l.phone || "").replace(/\D/g, "") === String(phone).replace(/\D/g, ""));
        if (!lead) return res.status(404).json({ success: false, error: "Lead not found" });
        const updated = bds.qualifyLead(lead.id, {});
        const mission = bem?.createBusinessMission("lead", { ...updated, status: "qualified" }, { priority });
        _ok(res, { lead: updated, mission: mission || null });
    } catch (e) { _err(res, e); }
});

router.patch("/business/leads/:phone/stage", requireAuth, (req, res) => {
    try {
        const bds  = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { stage } = req.body;
        if (!stage) return res.status(400).json({ success: false, error: "stage required" });
        const phone = decodeURIComponent(req.params.phone);
        const all   = bds.listLeads({ limit: 1000 });
        const lead  = all.items.find(l => String(l.phone || "").replace(/\D/g, "") === String(phone).replace(/\D/g, "") || l.id === phone);
        if (!lead) return res.status(404).json({ success: false, error: "Lead not found" });
        const updated = bds.updateLead(lead.id, { status: stage });
        _ok(res, { lead: updated });
    } catch (e) { _err(res, e); }
});

// ── Contacts ──────────────────────────────────────────────────────────────────

router.get("/business/contacts", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { company, search, limit } = req.query;
        const result = bds.listContacts({ company, search, limit: limit ? parseInt(limit, 10) : 50 });
        _ok(res, { contacts: result.items, total: result.total });
    } catch (e) { _err(res, e); }
});

router.get("/business/contacts/:id", requireAuth, (req, res) => {
    try {
        const bds     = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const contact = bds.getContact(req.params.id);
        if (!contact) return res.status(404).json({ success: false, error: "Contact not found" });
        _ok(res, { contact });
    } catch (e) { _err(res, e); }
});

router.post("/business/contacts", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const contact = bds.createContact(req.body);
        _ok(res, { contact });
    } catch (e) { _err(res, e, 400); }
});

router.patch("/business/contacts/:id", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const contact = bds.updateContact(req.params.id, req.body);
        _ok(res, { contact });
    } catch (e) { _err(res, e, e.message.includes("Not found") ? 404 : 400); }
});

router.delete("/business/contacts/:id", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        _ok(res, bds.deleteContact(req.params.id));
    } catch (e) { _err(res, e, 404); }
});

// ── Opportunities ─────────────────────────────────────────────────────────────

router.get("/business/opportunities", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { stage, assignee, minValue, limit } = req.query;
        const result = bds.listOpportunities({ stage, assignee, minValue, limit: limit ? parseInt(limit, 10) : 50 });
        _ok(res, { opportunities: result.items, total: result.total });
    } catch (e) { _err(res, e); }
});

router.get("/business/opportunities/:id", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const opp = bds.getOpportunity(req.params.id);
        if (!opp) return res.status(404).json({ success: false, error: "Opportunity not found" });
        _ok(res, { opportunity: opp });
    } catch (e) { _err(res, e); }
});

router.post("/business/opportunities", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const opp = bds.createOpportunity(req.body);
        _ok(res, { opportunity: opp });
    } catch (e) { _err(res, e, 400); }
});

router.patch("/business/opportunities/:id", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const opp = bds.updateOpportunity(req.params.id, req.body);
        _ok(res, { opportunity: opp });
    } catch (e) { _err(res, e, e.message.includes("Not found") ? 404 : 400); }
});

router.post("/business/opportunities/:id/advance", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { stage } = req.body;
        if (!stage) return res.status(400).json({ success: false, error: "stage required" });
        const opp = bds.advanceStage(req.params.id, stage);
        _ok(res, { opportunity: opp });
    } catch (e) { _err(res, e, e.message.includes("Not found") ? 404 : 400); }
});

router.post("/business/opportunities/:id/close-won", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const opp = bds.closeWon(req.params.id, req.body);
        _ok(res, { opportunity: opp });
    } catch (e) { _err(res, e, e.message.includes("Not found") ? 404 : 400); }
});

router.post("/business/opportunities/:id/close-lost", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { reason } = req.body;
        const opp = bds.closeLost(req.params.id, reason);
        _ok(res, { opportunity: opp });
    } catch (e) { _err(res, e, e.message.includes("Not found") ? 404 : 400); }
});

// ── Campaigns ─────────────────────────────────────────────────────────────────

router.get("/business/campaigns", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { status, channel, limit } = req.query;
        const result = bds.listCampaigns({ status, channel, limit: limit ? parseInt(limit, 10) : 20 });
        _ok(res, { campaigns: result.items, total: result.total });
    } catch (e) { _err(res, e); }
});

router.get("/business/campaigns/:id", requireAuth, (req, res) => {
    try {
        const bds  = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const camp = bds.getCampaign(req.params.id);
        if (!camp) return res.status(404).json({ success: false, error: "Campaign not found" });
        _ok(res, { campaign: camp });
    } catch (e) { _err(res, e); }
});

router.post("/business/campaigns", requireAuth, (req, res) => {
    try {
        const bds  = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const camp = bds.createCampaign(req.body);
        _ok(res, { campaign: camp });
    } catch (e) { _err(res, e, 400); }
});

router.patch("/business/campaigns/:id", requireAuth, (req, res) => {
    try {
        const bds  = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const camp = bds.updateCampaign(req.params.id, req.body);
        _ok(res, { campaign: camp });
    } catch (e) { _err(res, e, e.message.includes("Not found") ? 404 : 400); }
});

router.post("/business/campaigns/:id/event", requireAuth, (req, res) => {
    try {
        const bds  = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const camp = bds.recordCampaignEvent(req.params.id, req.body);
        _ok(res, { campaign: camp });
    } catch (e) { _err(res, e, e.message.includes("Not found") ? 404 : 400); }
});

router.post("/business/campaigns/:id/complete", requireAuth, (req, res) => {
    try {
        const bds  = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const camp = bds.completeCampaign(req.params.id, req.body);
        _ok(res, { campaign: camp });
    } catch (e) { _err(res, e, e.message.includes("Not found") ? 404 : 400); }
});

// ── Revenue ───────────────────────────────────────────────────────────────────

router.get("/business/revenue", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { type, dateFrom, dateTo, oppId, limit } = req.query;
        const result = bds.listRevenue({ type, dateFrom, dateTo, oppId, limit: limit ? parseInt(limit, 10) : 50 });
        _ok(res, { revenue: result.items, total: result.total });
    } catch (e) { _err(res, e); }
});

router.post("/business/revenue", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const rev = bds.recordRevenue(req.body);
        _ok(res, { revenue: rev });
    } catch (e) { _err(res, e, 400); }
});

router.get("/business/revenue/stats", requireAuth, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { dateFrom, dateTo, currency } = req.query;
        _ok(res, bds.getRevenueStats({ dateFrom, dateTo, currency }));
    } catch (e) { _err(res, e); }
});

// ── Mission-layer aliases (deals / marketing / customers / ops) ───────────────

router.get("/business/deals", requireAuth, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const result = bem.listBusinessMissions({ entityType: "deal", status: req.query.status, limit: 100 });
        _ok(res, result);
    } catch (e) { _err(res, e); }
});

router.post("/business/deals", requireAuth, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const { name, title, description, value, stage, priority } = req.body;
        if (!name && !title) return res.status(400).json({ success: false, error: "name or title required" });
        const entity = { id: `deal_${Date.now()}`, name: name || title, title, description, value, stage };
        const mission = bem.createBusinessMission("deal", entity, { priority });
        _ok(res, { mission });
    } catch (e) { _err(res, e, 400); }
});

router.get("/business/marketing/tasks", requireAuth, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const result = bem.listBusinessMissions({ entityType: "marketing_task", status: req.query.status, limit: 100 });
        _ok(res, result);
    } catch (e) { _err(res, e); }
});

router.post("/business/marketing/tasks", requireAuth, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const { title, campaign, channel, priority, subtasks } = req.body;
        if (!title) return res.status(400).json({ success: false, error: "title required" });
        const entity = { id: `mtask_${Date.now()}`, title, campaign, channel, subtasks };
        const mission = bem.createBusinessMission("marketing_task", entity, { priority });
        _ok(res, { mission });
    } catch (e) { _err(res, e, 400); }
});

router.get("/business/customers", requireAuth, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const result = bem.listBusinessMissions({ entityType: "customer", status: req.query.status, limit: 100 });
        _ok(res, result);
    } catch (e) { _err(res, e); }
});

router.post("/business/customers", requireAuth, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const { name, phone, email, plan, status, action, priority } = req.body;
        if (!name && !phone && !email) return res.status(400).json({ success: false, error: "name, phone, or email required" });
        const entity = { id: phone || email || `cust_${Date.now()}`, name, phone, email, plan, status: status || "active", action };
        const mission = bem.createBusinessMission("customer", entity, { priority });
        _ok(res, { mission });
    } catch (e) { _err(res, e, 400); }
});

router.get("/business/operations", requireAuth, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const result = bem.listBusinessMissions({ entityType: "operation", status: req.query.status, limit: 100 });
        _ok(res, result);
    } catch (e) { _err(res, e); }
});

router.post("/business/operations", requireAuth, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const { title, name, category, steps, priority } = req.body;
        if (!title && !name) return res.status(400).json({ success: false, error: "title or name required" });
        const entity = { id: `op_${Date.now()}`, title: title || name, category, steps: steps || [] };
        const mission = bem.createBusinessMission("operation", entity, { priority });
        _ok(res, { mission });
    } catch (e) { _err(res, e, 400); }
});

// ── Automation routes (Phase B2) ──────────────────────────────────────────────

// GET  /business/automation/templates          — list all workflow templates
// GET  /business/automation/templates/:type    — single template + steps
// GET  /business/automation/capabilities       — list registered capabilities
// POST /business/automation/run                — run full template for entity
// POST /business/automation/step               — run single step
// GET  /business/automation/status/:missionId  — execution status for mission

router.get("/business/automation/templates", requireAuth, (req, res) => {
    try {
        const bma = _bma();
        if (!bma) return _err(res, new Error("automation unavailable"), 503);
        bma.init();
        _ok(res, { templates: bma.listTemplates() });
    } catch (e) { _err(res, e); }
});

router.get("/business/automation/templates/:entityType", requireAuth, (req, res) => {
    try {
        const bma = _bma();
        if (!bma) return _err(res, new Error("automation unavailable"), 503);
        const tpl = bma.getTemplate(req.params.entityType);
        if (!tpl) return res.status(404).json({ success: false, error: `No template for entityType: ${req.params.entityType}` });
        _ok(res, { template: tpl });
    } catch (e) { _err(res, e); }
});

router.get("/business/automation/capabilities", requireAuth, (req, res) => {
    try {
        const bma = _bma();
        if (!bma) return _err(res, new Error("automation unavailable"), 503);
        bma.init();
        _ok(res, { capabilities: bma.listCapabilities() });
    } catch (e) { _err(res, e); }
});

router.post("/business/automation/run", requireAuth, async (req, res) => {
    try {
        const bma = _bma();
        if (!bma) return _err(res, new Error("automation unavailable"), 503);
        const { entityType, entity, missionId, priority, failFast } = req.body;
        if (!entityType) return res.status(400).json({ success: false, error: "entityType required" });
        if (!entity || typeof entity !== "object") return res.status(400).json({ success: false, error: "entity object required" });
        const result = await bma.runTemplate(entityType, entity, { missionId, priority, failFast });
        _ok(res, result);
    } catch (e) { _err(res, e); }
});

router.post("/business/automation/step", requireAuth, async (req, res) => {
    try {
        const bma = _bma();
        if (!bma) return _err(res, new Error("automation unavailable"), 503);
        const { entityType, stepName, entity, missionId } = req.body;
        if (!entityType || !stepName) return res.status(400).json({ success: false, error: "entityType and stepName required" });
        if (!entity || typeof entity !== "object") return res.status(400).json({ success: false, error: "entity object required" });
        const result = await bma.runStep(entityType, stepName, entity, missionId);
        _ok(res, result);
    } catch (e) { _err(res, e); }
});

router.get("/business/automation/status/:missionId", requireAuth, (req, res) => {
    try {
        const bma = _bma();
        if (!bma) return _err(res, new Error("automation unavailable"), 503);
        _ok(res, bma.getAutomationStatus(req.params.missionId));
    } catch (e) { _err(res, e); }
});

module.exports = router;
