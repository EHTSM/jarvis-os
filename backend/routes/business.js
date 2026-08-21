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
const { attachOrg, requireOrgMember } = require("../middleware/orgMiddleware.cjs");
const rateLimiter = require("../middleware/rateLimiter");
const logger = require("../utils/logger");

// attachOrg resolves req.org from X-Org-Id header/query/body, or — when none
// is given — auto-resolves the caller's own primary org membership
// (orgMiddleware.cjs attachOrg()). Its auto-resolve path needs req.user, so
// requireAuth must run first here at the router level — previously attachOrg
// ran before any route's own inline requireAuth, so req.user was always
// undefined and auto-resolve silently never worked (attachOrg's own try/catch
// swallowed the resulting no-op). requireOrgMember then enforces that the
// caller is actually a member of whatever org got attached (or holds a
// cross-org grant / enterprise_admin role) before any CRM data route runs.
// This closes the cross-tenant IDOR audited in 100-COMPANY-REALITY-AUDIT.md
// Part 6: routes that previously called businessDataService without an
// orgId loaded/mutated every org's records globally. Every CRM data call
// below must now pass req.org.id — enforced by requireOrgMember rejecting
// requests with no attached org before they reach a handler.
//
// /business/webhook/* is intentionally excluded — those routes are public,
// unauthenticated ingestion endpoints for external systems (see "Public
// webhooks" section below) and must not be gated by requireAuth/attachOrg.
//
// OOPLIX V1 MASTER AUDIT (2026-08-16, invitation-flow audit): this was
// mounted with no path prefix (`router.use((req,res,next)=>{...})`), so —
// since business.js itself is mounted with no prefix at "/" in
// routes/index.js, ahead of ~20 other route files including workspace.js —
// it silently gated EVERY unmatched request that fell through to this point
// in the composed router stack, not just /business/* paths. Live-reproduced:
// GET /invite-preview/:token (workspace.js), explicitly documented in that
// file's own header comment as "Deliberately public (no requireAuth...)" so
// an invitee with no account/session yet can preview an invite before
// signing up, returned 401 Unauthorized — requireAuth was being invoked for
// a route that never calls it, via this exact middleware, confirmed by
// stack-trace instrumentation. Any other not-yet-matched path mounted after
// business.js in routes/index.js was equally exposed to this same
// unintended gate. Scoped to "/business" — every route below already
// declares its own requireAuth/_requireOrg individually (this wrapper's only
// unique purpose, per the comment above, is running attachOrg before that
// per-route requireAuth for the org-scoped CRM routes), so scoping it
// changes nothing for any real /business/* request.
// req.path is mount-relative once scoped to "/business" (Express strips the
// matched prefix), so the webhook exclusion check below must match against
// "/webhook/" — not "/business/webhook/" — verified live: the unscoped
// prefix string never matched post-scoping, which would have silently
// re-broken the public webhook endpoints while fixing the interception bug.
router.use("/business", (req, res, next) => {
    if (req.path.startsWith("/webhook/")) return next();
    return requireAuth(req, res, () => attachOrg(req, res, next));
});

// CRM data routes require an attached, verified org membership. Mission-layer
// routes (missions/deals/marketing/customers/operations — backed by
// businessEntityModel.cjs, not businessDataService.cjs) and webhooks remain
// on requireAuth only, since they are not part of the audited orgId-scoped
// CRM data model and do not accept/return org-scoped records.
function _requireOrg(req, res, next) {
    return requireOrgMember(req, res, next);
}

function _bds()  { try { return require("../services/businessDataService.cjs");  } catch { return null; } }
function _bem()  { try { return require("../services/businessEntityModel.cjs");  } catch { return null; } }
function _bma()  { try { return require("../services/businessMissionAutomation.cjs");   } catch { return null; } }
function _bie()  { try { return require("../services/businessIntelligenceEngine.cjs"); } catch { return null; } }
function _bea()  { try { return require("../services/businessEventAdapter.cjs");      } catch { return null; } }

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

router.get("/business/dashboard", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        _ok(res, bds.getDashboard(req.org.id));
    } catch (e) { _err(res, e); }
});

router.get("/business/pipeline", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        const bem = _bem();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const pipeline = bds.getPipelineSummary(req.org.id);
        // B.21: pass the org through. bds.getPipelineSummary was already
        // org-scoped while this sibling call was not, so the same response
        // mixed one tenant-scoped block with one platform-wide block.
        const bizMissions = bem?.getPipelineSummary?.(req.org.id) || {};
        const rules = bem?.getBusinessRules?.() || [];
        _ok(res, { pipeline, bizMissions, ruleCount: rules.length });
    } catch (e) { _err(res, e); }
});

// Remaining Execution & Tool Authorization Boundary Sweep follow-up
// (Customer-Reachable API / Data-Access Boundary Audit, 2026-08-21):
// this route never passed orgId to listBusinessMissions() at all — every
// authenticated customer received every org's deals/customers/etc pipeline
// data by default, no header forgery even required. Live-reproduced: org B
// (zero relation to org A) called GET /business/pipeline/deal with no
// special headers and received org A's real deal record verbatim. Fixed by
// composing _requireOrg (the same gate business.js's own CRM routes and
// customerOrg.js already use) and threading req.org.id through, matching
// the sibling /business/pipeline route just above, which already does this
// correctly.
router.get("/business/pipeline/:entityType", requireAuth, _requireOrg, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const { entityType } = req.params;
        const missions = bem.listBusinessMissions({ entityType, limit: 100, orgId: req.org.id });
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

router.get("/business/summary/daily", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        _ok(res, bds.getDailySummary(req.org.id));
    } catch (e) { _err(res, e); }
});

router.get("/business/summary/weekly", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        _ok(res, bds.getWeeklySummary(req.org.id));
    } catch (e) { _err(res, e); }
});

router.get("/business/stats", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const dash = bds.getDashboard(req.org.id);
        const rev  = bds.getRevenueStats({ orgId: req.org.id });
        _ok(res, { ...dash, revenue: rev });
    } catch (e) { _err(res, e); }
});

router.get("/business/search", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds   = _bds();
        const q     = req.query.q || "";
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        _ok(res, bds.globalSearch(q, limit, req.org.id));
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

router.get("/business/leads", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { status, source, assignee, minScore, limit } = req.query;
        const result = bds.listLeads({ status, source, assignee, minScore, limit: limit ? parseInt(limit, 10) : 50, orgId: req.org.id });
        _ok(res, { leads: result.items, total: result.total });
    } catch (e) { _err(res, e); }
});

router.get("/business/leads/:id", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const lead = bds.getLead(req.params.id, req.org.id);
        if (!lead) return res.status(404).json({ success: false, error: "Lead not found" });
        _ok(res, { lead });
    } catch (e) { _err(res, e); }
});

router.post("/business/leads", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const lead = bds.createLead({ ...req.body, orgId: req.org.id });
        _ok(res, { lead });
    } catch (e) { _err(res, e, 400); }
});

router.patch("/business/leads/:id", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const lead = bds.updateLead(req.params.id, req.body, req.org.id);
        _ok(res, { lead });
    } catch (e) { _err(res, e, /not found/i.test(e.message) ? 404 : 400); }
});

router.delete("/business/leads/:id", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        _ok(res, bds.deleteLead(req.params.id, req.org.id));
    } catch (e) { _err(res, e, 404); }
});

router.post("/business/leads/:id/qualify", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const lead = bds.qualifyLead(req.params.id, req.body, req.org.id);
        _ok(res, { lead });
    } catch (e) { _err(res, e, /not found/i.test(e.message) ? 404 : 400); }
});

router.post("/business/leads/:id/disqualify", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { reason } = req.body;
        const lead = bds.disqualifyLead(req.params.id, reason, req.org.id);
        _ok(res, { lead });
    } catch (e) { _err(res, e, /not found/i.test(e.message) ? 404 : 400); }
});

// Qualify from old CRM phone-based leads (compat route)
router.post("/business/leads/qualify", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        const bem = _bem();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { phone, priority } = req.body;
        if (!phone) return res.status(400).json({ success: false, error: "phone required" });
        // Attempt to find lead by phone — scoped to the caller's org only
        // (previously unscoped: audited cross-tenant IDOR, see
        // 100-COMPANY-REALITY-AUDIT.md Part 6 / GAP-LIST P0 #1).
        const all = bds.listLeads({ limit: 1000, orgId: req.org.id });
        const lead = all.items.find(l => String(l.phone || "").replace(/\D/g, "") === String(phone).replace(/\D/g, ""));
        if (!lead) return res.status(404).json({ success: false, error: "Lead not found" });
        const updated = bds.qualifyLead(lead.id, {}, req.org.id);
        const mission = bem?.createBusinessMission("lead", { ...updated, status: "qualified" }, { priority });
        _ok(res, { lead: updated, mission: mission || null });
    } catch (e) { _err(res, e); }
});

router.patch("/business/leads/:phone/stage", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds  = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { stage } = req.body;
        if (!stage) return res.status(400).json({ success: false, error: "stage required" });
        const phone = decodeURIComponent(req.params.phone);
        // Scoped to the caller's org only (previously unscoped: audited
        // cross-tenant IDOR, see 100-COMPANY-REALITY-AUDIT.md Part 6 /
        // GAP-LIST P0 #1).
        const all   = bds.listLeads({ limit: 1000, orgId: req.org.id });
        const lead  = all.items.find(l => String(l.phone || "").replace(/\D/g, "") === String(phone).replace(/\D/g, "") || l.id === phone);
        if (!lead) return res.status(404).json({ success: false, error: "Lead not found" });
        const updated = bds.updateLead(lead.id, { status: stage }, req.org.id);
        _ok(res, { lead: updated });
    } catch (e) { _err(res, e); }
});

// ── Contacts ──────────────────────────────────────────────────────────────────

router.get("/business/contacts", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { company, search, limit } = req.query;
        const result = bds.listContacts({ company, search, limit: limit ? parseInt(limit, 10) : 50, orgId: req.org.id });
        _ok(res, { contacts: result.items, total: result.total });
    } catch (e) { _err(res, e); }
});

router.get("/business/contacts/:id", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds     = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const contact = bds.getContact(req.params.id, req.org.id);
        if (!contact) return res.status(404).json({ success: false, error: "Contact not found" });
        _ok(res, { contact });
    } catch (e) { _err(res, e); }
});

router.post("/business/contacts", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const contact = bds.createContact({ ...req.body, orgId: req.org.id });
        _ok(res, { contact });
    } catch (e) { _err(res, e, 400); }
});

router.patch("/business/contacts/:id", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const contact = bds.updateContact(req.params.id, req.body, req.org.id);
        _ok(res, { contact });
    } catch (e) { _err(res, e, /not found/i.test(e.message) ? 404 : 400); }
});

router.delete("/business/contacts/:id", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        _ok(res, bds.deleteContact(req.params.id, req.org.id));
    } catch (e) { _err(res, e, 404); }
});

// ── Opportunities ─────────────────────────────────────────────────────────────

router.get("/business/opportunities", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { stage, assignee, minValue, limit } = req.query;
        const result = bds.listOpportunities({ stage, assignee, minValue, limit: limit ? parseInt(limit, 10) : 50, orgId: req.org.id });
        _ok(res, { opportunities: result.items, total: result.total });
    } catch (e) { _err(res, e); }
});

router.get("/business/opportunities/:id", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const opp = bds.getOpportunity(req.params.id, req.org.id);
        if (!opp) return res.status(404).json({ success: false, error: "Opportunity not found" });
        _ok(res, { opportunity: opp });
    } catch (e) { _err(res, e); }
});

router.post("/business/opportunities", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const opp = bds.createOpportunity({ ...req.body, orgId: req.org.id });
        _ok(res, { opportunity: opp });
    } catch (e) { _err(res, e, 400); }
});

router.patch("/business/opportunities/:id", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const opp = bds.updateOpportunity(req.params.id, req.body, req.org.id);
        _ok(res, { opportunity: opp });
    } catch (e) { _err(res, e, /not found/i.test(e.message) ? 404 : 400); }
});

router.post("/business/opportunities/:id/advance", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { stage } = req.body;
        if (!stage) return res.status(400).json({ success: false, error: "stage required" });
        const opp = bds.advanceStage(req.params.id, stage, req.org.id);
        _ok(res, { opportunity: opp });
    } catch (e) { _err(res, e, /not found/i.test(e.message) ? 404 : 400); }
});

router.post("/business/opportunities/:id/close-won", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const opp = bds.closeWon(req.params.id, req.body, req.org.id);
        _ok(res, { opportunity: opp });
    } catch (e) { _err(res, e, /not found/i.test(e.message) ? 404 : 400); }
});

router.post("/business/opportunities/:id/close-lost", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { reason } = req.body;
        const opp = bds.closeLost(req.params.id, reason, req.org.id);
        _ok(res, { opportunity: opp });
    } catch (e) { _err(res, e, /not found/i.test(e.message) ? 404 : 400); }
});

// ── Campaigns ─────────────────────────────────────────────────────────────────

router.get("/business/campaigns", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { status, channel, limit } = req.query;
        const result = bds.listCampaigns({ status, channel, limit: limit ? parseInt(limit, 10) : 20, orgId: req.org.id });
        _ok(res, { campaigns: result.items, total: result.total });
    } catch (e) { _err(res, e); }
});

router.get("/business/campaigns/:id", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds  = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const camp = bds.getCampaign(req.params.id, req.org.id);
        if (!camp) return res.status(404).json({ success: false, error: "Campaign not found" });
        _ok(res, { campaign: camp });
    } catch (e) { _err(res, e); }
});

router.post("/business/campaigns", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds  = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const camp = bds.createCampaign({ ...req.body, orgId: req.org.id });
        _ok(res, { campaign: camp });
    } catch (e) { _err(res, e, 400); }
});

router.patch("/business/campaigns/:id", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds  = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const camp = bds.updateCampaign(req.params.id, req.body, req.org.id);
        _ok(res, { campaign: camp });
    } catch (e) { _err(res, e, /not found/i.test(e.message) ? 404 : 400); }
});

router.post("/business/campaigns/:id/event", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds  = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const camp = bds.recordCampaignEvent(req.params.id, req.body, req.org.id);
        _ok(res, { campaign: camp });
    } catch (e) { _err(res, e, /not found/i.test(e.message) ? 404 : 400); }
});

router.post("/business/campaigns/:id/complete", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds  = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const camp = bds.completeCampaign(req.params.id, req.body, req.org.id);
        _ok(res, { campaign: camp });
    } catch (e) { _err(res, e, /not found/i.test(e.message) ? 404 : 400); }
});

// ── Revenue ───────────────────────────────────────────────────────────────────

router.get("/business/revenue", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { type, dateFrom, dateTo, oppId, limit } = req.query;
        const result = bds.listRevenue({ type, dateFrom, dateTo, oppId, limit: limit ? parseInt(limit, 10) : 50, orgId: req.org.id });
        _ok(res, { revenue: result.items, total: result.total });
    } catch (e) { _err(res, e); }
});

router.post("/business/revenue", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const rev = bds.recordRevenue({ ...req.body, orgId: req.org.id });
        _ok(res, { revenue: rev });
    } catch (e) { _err(res, e, 400); }
});

router.get("/business/revenue/stats", requireAuth, _requireOrg, (req, res) => {
    try {
        const bds = _bds();
        if (!bds) return _err(res, new Error("bds unavailable"), 503);
        const { dateFrom, dateTo, currency } = req.query;
        _ok(res, bds.getRevenueStats({ dateFrom, dateTo, currency, orgId: req.org.id }));
    } catch (e) { _err(res, e); }
});

// ── Mission-layer aliases (deals / marketing / customers / ops) ───────────────
//
// Customer-Reachable API / Data-Access Boundary Audit (2026-08-21): all 8
// routes below previously ran on requireAuth only, using `req.org?.id ||
// null` as the orgId. Since attachOrg (mounted router-wide above) resolves
// req.org from an ATTACKER-CONTROLLED X-Org-Id header without verifying
// real membership, any authenticated customer could forge that header to
// a foreign org's real id and have it accepted as the scope filter — no
// requireOrgMember gate ever ran to catch the forgery. Live-reproduced:
// org B, with zero relation to org A, sent X-Org-Id: <org A's real id> to
// GET /business/deals and received org A's real deal records verbatim.
// Fixed by composing _requireOrg (requireOrgMember) — the same gate this
// file's own CRM routes (business/leads, /business/dashboard, etc.) and
// customerOrg.js already use — which verifies req.orgRole (real membership,
// set separately by attachOrg from getMemberRole()) before any handler
// runs, and rejects a forged/unowned org id with 404 instead of silently
// scoping to it.

router.get("/business/deals", requireAuth, _requireOrg, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const result = bem.listBusinessMissions({ entityType: "deal", status: req.query.status, limit: 100, orgId: req.org.id });
        _ok(res, result);
    } catch (e) { _err(res, e); }
});

router.post("/business/deals", requireAuth, _requireOrg, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const { name, title, description, value, stage, priority } = req.body;
        if (!name && !title) return res.status(400).json({ success: false, error: "name or title required" });
        const entity = { id: `deal_${Date.now()}`, name: name || title, title, description, value, stage };
        const mission = bem.createBusinessMission("deal", entity, { priority, orgId: req.org.id });
        _ok(res, { mission });
    } catch (e) { _err(res, e, 400); }
});

router.get("/business/marketing/tasks", requireAuth, _requireOrg, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const result = bem.listBusinessMissions({ entityType: "marketing_task", status: req.query.status, limit: 100, orgId: req.org.id });
        _ok(res, result);
    } catch (e) { _err(res, e); }
});

router.post("/business/marketing/tasks", requireAuth, _requireOrg, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const { title, campaign, channel, priority, subtasks } = req.body;
        if (!title) return res.status(400).json({ success: false, error: "title required" });
        const entity = { id: `mtask_${Date.now()}`, title, campaign, channel, subtasks };
        const mission = bem.createBusinessMission("marketing_task", entity, { priority, orgId: req.org.id });
        _ok(res, { mission });
    } catch (e) { _err(res, e, 400); }
});

router.get("/business/customers", requireAuth, _requireOrg, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const result = bem.listBusinessMissions({ entityType: "customer", status: req.query.status, limit: 100, orgId: req.org.id });
        _ok(res, result);
    } catch (e) { _err(res, e); }
});

router.post("/business/customers", requireAuth, _requireOrg, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const { name, phone, email, plan, status, action, priority } = req.body;
        if (!name && !phone && !email) return res.status(400).json({ success: false, error: "name, phone, or email required" });
        const entity = { id: phone || email || `cust_${Date.now()}`, name, phone, email, plan, status: status || "active", action };
        const mission = bem.createBusinessMission("customer", entity, { priority, orgId: req.org.id });
        _ok(res, { mission });
    } catch (e) { _err(res, e, 400); }
});

router.get("/business/operations", requireAuth, _requireOrg, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const result = bem.listBusinessMissions({ entityType: "operation", status: req.query.status, limit: 100, orgId: req.org.id });
        _ok(res, result);
    } catch (e) { _err(res, e); }
});

router.post("/business/operations", requireAuth, _requireOrg, (req, res) => {
    try {
        const bem = _bem();
        if (!bem) return _err(res, new Error("bem unavailable"), 503);
        const { title, name, category, steps, priority } = req.body;
        if (!title && !name) return res.status(400).json({ success: false, error: "title or name required" });
        const entity = { id: `op_${Date.now()}`, title: title || name, category, steps: steps || [] };
        const mission = bem.createBusinessMission("operation", entity, { priority, orgId: req.org.id });
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

// OOPLIX V1 MASTER AUDIT (2026-08-16): these two routes were requireAuth-only
// — unlike every other /business/* CRM route in this file, neither composed
// _requireOrg. businessMissionAutomation.cjs's capability handlers
// (biz:crm:ingest_lead, qualify, closeWon/closeLost, recordCampaignEvent,
// etc.) call bds.updateLead(entity.id, {...}), bds.closeWon(entity.id, ...),
// etc. with NO orgId argument at all — and entity is taken directly from
// req.body, fully caller-controlled. businessDataService.cjs's own _update/
// _get/_remove already correctly reject a mismatched orgId (404), so the
// fix is to require real org membership here (matching every sibling CRM
// route) and thread req.org.id through into the entity object so those
// existing checks actually run instead of being skipped via the missing
// argument. Live-reproduced: an authenticated non-member of the target
// org's real lead could invoke this route with that lead's real ID with no
// membership check at all — masked from being an immediately observable
// mutation only by an unrelated, separate crash bug in
// autonomousExecutionRuntime.cjs's stage-execution entity deserialization
// (documented, not fixed here — out of this authorization audit's scope).
router.post("/business/automation/run", requireAuth, _requireOrg, async (req, res) => {
    try {
        const bma = _bma();
        if (!bma) return _err(res, new Error("automation unavailable"), 503);
        const { entityType, entity, missionId, priority, failFast } = req.body;
        if (!entityType) return res.status(400).json({ success: false, error: "entityType required" });
        if (!entity || typeof entity !== "object") return res.status(400).json({ success: false, error: "entity object required" });
        const result = await bma.runTemplate(entityType, { ...entity, orgId: req.org.id }, { missionId, priority, failFast, orgId: req.org.id });
        _ok(res, result);
    } catch (e) { _err(res, e); }
});

router.post("/business/automation/step", requireAuth, _requireOrg, async (req, res) => {
    try {
        const bma = _bma();
        if (!bma) return _err(res, new Error("automation unavailable"), 503);
        const { entityType, stepName, entity, missionId } = req.body;
        if (!entityType || !stepName) return res.status(400).json({ success: false, error: "entityType and stepName required" });
        if (!entity || typeof entity !== "object") return res.status(400).json({ success: false, error: "entity object required" });
        const result = await bma.runStep(entityType, stepName, { ...entity, orgId: req.org.id }, missionId);
        _ok(res, result);
    } catch (e) { _err(res, e); }
});

// Customer-Reachable API / Data-Access Boundary Audit (2026-08-21): getAutomationStatus()
// has no orgId concept — filters executions by missionId alone. A caller who
// knows/guesses another org's real missionId could read its execution status
// and step logs. Fixed by verifying the mission's own recorded orgId (set at
// creation time by every /business/* mission-layer route above, now that
// they all correctly thread req.org.id through) matches the caller's
// verified org, reusing missionMemory's existing getMission() rather than
// adding a new ownership mechanism.
router.get("/business/automation/status/:missionId", requireAuth, _requireOrg, (req, res) => {
    try {
        const bma = _bma();
        if (!bma) return _err(res, new Error("automation unavailable"), 503);
        const mm = require("../services/missionMemory.cjs");
        const mission = mm.getMission(req.params.missionId);
        if (!mission) return _err(res, new Error("mission not found"), 404);
        if ((mission.metadata?.orgId || null) !== req.org.id) return _err(res, new Error("mission not found"), 404);
        _ok(res, bma.getAutomationStatus(req.params.missionId));
    } catch (e) { _err(res, e); }
});

// ── Intelligence routes (Phase B3) ────────────────────────────────────────────
//
// GET  /business/intelligence/scan             — full scan all entity types
// GET  /business/intelligence/scan/leads       — scan leads only
// GET  /business/intelligence/scan/deals       — scan deals only
// GET  /business/intelligence/scan/customers   — scan customers only
// GET  /business/intelligence/scan/campaigns   — scan campaigns only
// GET  /business/intelligence/health           — business health metrics
// GET  /business/intelligence/rules            — intelligence rule definitions
// GET  /business/intelligence/recommendations  — open recommendations
// POST /business/intelligence/recommendations/:id/dismiss  — dismiss
// POST /business/intelligence/recommendations/:id/accept   — accept + optional mission
// POST /business/intelligence/rules            — register a business rule
// POST /business/intelligence/score            — score a signal for confidence

// Intelligence scan/health routes read across CRM entities (leads/deals/
// customers/campaigns/revenue) via businessIntelligenceEngine.cjs, which
// itself calls businessDataService.cjs — the same org-scoped store as the
// CRM routes above. These previously ran with no orgId at all (a second,
// distinct instance of the cross-tenant IDOR audited in
// 100-COMPANY-REALITY-AUDIT.md Part 6), so they now require org membership
// and pass req.org.id through the same way.
router.get("/business/intelligence/scan", requireAuth, _requireOrg, async (req, res) => {
    try {
        const bie = _bie();
        if (!bie) return _err(res, new Error("intelligence engine unavailable"), 503);
        const dryRun = req.query.dryRun === "true";
        const result = bie.scan({ dryRun, orgId: req.org.id });
        _ok(res, result);
    } catch (e) { _err(res, e); }
});

router.get("/business/intelligence/scan/leads", requireAuth, _requireOrg, (req, res) => {
    try {
        const bie = _bie();
        if (!bie) return _err(res, new Error("intelligence engine unavailable"), 503);
        const result = bie.scanLeads({ dryRun: req.query.dryRun === "true", orgId: req.org.id });
        _ok(res, result);
    } catch (e) { _err(res, e); }
});

router.get("/business/intelligence/scan/deals", requireAuth, _requireOrg, (req, res) => {
    try {
        const bie = _bie();
        if (!bie) return _err(res, new Error("intelligence engine unavailable"), 503);
        _ok(res, bie.scanDeals({ dryRun: req.query.dryRun === "true", orgId: req.org.id }));
    } catch (e) { _err(res, e); }
});

router.get("/business/intelligence/scan/customers", requireAuth, _requireOrg, (req, res) => {
    try {
        const bie = _bie();
        if (!bie) return _err(res, new Error("intelligence engine unavailable"), 503);
        _ok(res, bie.scanCustomers({ dryRun: req.query.dryRun === "true", orgId: req.org.id }));
    } catch (e) { _err(res, e); }
});

router.get("/business/intelligence/scan/campaigns", requireAuth, _requireOrg, (req, res) => {
    try {
        const bie = _bie();
        if (!bie) return _err(res, new Error("intelligence engine unavailable"), 503);
        _ok(res, bie.scanCampaigns({ dryRun: req.query.dryRun === "true", orgId: req.org.id }));
    } catch (e) { _err(res, e); }
});

router.get("/business/intelligence/health", requireAuth, _requireOrg, (req, res) => {
    try {
        const bie = _bie();
        if (!bie) return _err(res, new Error("intelligence engine unavailable"), 503);
        _ok(res, bie.getHealthMetrics({ orgId: req.org.id }));
    } catch (e) { _err(res, e); }
});

router.get("/business/intelligence/rules", requireAuth, (req, res) => {
    try {
        const bie = _bie();
        if (!bie) return _err(res, new Error("intelligence engine unavailable"), 503);
        _ok(res, { rules: bie.listIntelligenceRules() });
    } catch (e) { _err(res, e); }
});

router.get("/business/intelligence/recommendations", requireAuth, (req, res) => {
    try {
        const bie = _bie();
        if (!bie) return _err(res, new Error("intelligence engine unavailable"), 503);
        const { status, limit } = req.query;
        _ok(res, bie.getRecommendations({ status, limit: limit ? parseInt(limit, 10) : 50 }));
    } catch (e) { _err(res, e); }
});

router.post("/business/intelligence/recommendations/:id/dismiss", requireAuth, (req, res) => {
    try {
        const bie = _bie();
        if (!bie) return _err(res, new Error("intelligence engine unavailable"), 503);
        const updated = bie.dismissRecommendation(req.params.id);
        _ok(res, { recommendation: updated });
    } catch (e) { _err(res, e, e.message.includes("not found") ? 404 : 500); }
});

router.post("/business/intelligence/recommendations/:id/accept", requireAuth, (req, res) => {
    try {
        const bie = _bie();
        if (!bie) return _err(res, new Error("intelligence engine unavailable"), 503);
        const updated = bie.acceptRecommendation(req.params.id, req.body || {});
        _ok(res, { recommendation: updated });
    } catch (e) { _err(res, e, e.message.includes("not found") ? 404 : 500); }
});

router.post("/business/intelligence/rules", requireAuth, (req, res) => {
    try {
        const bie = _bie();
        if (!bie) return _err(res, new Error("intelligence engine unavailable"), 503);
        const rule = bie.registerBusinessRule(req.body);
        _ok(res, { rule });
    } catch (e) { _err(res, e, 400); }
});

router.post("/business/intelligence/score", requireAuth, (req, res) => {
    try {
        const bie = _bie();
        if (!bie) return _err(res, new Error("intelligence engine unavailable"), 503);
        const { signal, context } = req.body;
        if (!signal) return res.status(400).json({ success: false, error: "signal object required" });
        _ok(res, bie.scoreSignal(signal, context || {}));
    } catch (e) { _err(res, e); }
});

// ── External Event Integration routes (Phase B4) ──────────────────────────────
//
// Public webhook endpoints (no auth — protected by source validation):
//   POST /business/webhook/form        — website form submission
//   POST /business/webhook/email       — inbound email (SendGrid/Mailgun/Postmark)
//   POST /business/webhook/whatsapp    — WhatsApp Business API
//   POST /business/webhook/telegram    — Telegram bot webhook
//   POST /business/webhook/payment     — payment received
//   POST /business/webhook/calendar    — calendar event (Google/Calendly)
//   POST /business/webhook/:source     — generic webhook (any source)
//
// Authenticated management:
//   POST /business/events/ingest       — manual/API trigger (auth required)
//   GET  /business/events              — event log
//   GET  /business/events/stats        — ingest stats by source/entity
//   GET  /business/events/sources      — list supported sources

// ── Shared webhook handler ────────────────────────────────────────────────────
async function _handleWebhook(source, req, res) {
    try {
        const bea = _bea();
        if (!bea) return res.status(503).json({ success: false, error: "event adapter unavailable" });
        const automate = req.query.automate === "true";
        const result   = await bea.ingest(source, req.body || {}, { automate });
        res.json({ success: true, ...result });
    } catch (e) {
        logger.warn(`[Business/webhook/${source}] ${e.message}`);
        res.status(400).json({ success: false, error: e.message });
    }
}

// ── Public webhooks (no requireAuth — external systems post here) ─────────────
//
// OOPLIX V1 MASTER AUDIT (2026-08-16, A-to-Z backend coverage audit):
// live-reproduced these 7 routes accepting a completely unauthenticated,
// unsigned payload — "protected by source validation" (the comment above)
// only ever meant "the :source string matches a known normalizer key," not
// any cryptographic authenticity check. A forged POST to
// /business/webhook/payment with an arbitrary amount/name/email was
// confirmed live to create a real, active, priority:"high",
// platform-global (orgId: null — the already-documented, deliberately
// out-of-scope multi-tenancy gap from the Business Automation IDOR Audit)
// mission that immediately spawned real autonomous subtasks, indistinguishable
// from a genuine business event, with zero rate limit. That combination
// (free, repeatable, resource-consuming mission creation, no auth, no
// signature, no rate limit) is a real abuse/DoS vector distinct from the
// deferred multi-tenancy question — it does not require knowing which org
// a forged event should belong to in order to be a problem.
//
// Adding a mandatory signature check here (the fix that closes /webhook/razorpay's
// equivalent risk) is not code-controlled for these 6 generic sources: unlike
// Razorpay's single, known, already-configured RAZORPAY_WEBHOOK_SECRET, these
// routes are deliberately generic ingestion points for many possible external
// systems with no fixed shared secret to check against — introducing one would
// require a product decision (per-source secrets? per-tenant tokens in the
// URL?) this audit has no authority to invent. Rate limiting the existing,
// already-proven middleware (used 1156+ other places in this codebase) closes
// the concrete abuse vector actually reproduced — unlimited free mission
// creation — without guessing at that larger design question.
const _webhookRL = rateLimiter(20, 60_000); // 20/min per IP per route — generous for real burst traffic, bounded against abuse
router.post("/business/webhook/form",      _webhookRL, (req, res) => _handleWebhook("form",      req, res));
router.post("/business/webhook/email",     _webhookRL, (req, res) => _handleWebhook("email",     req, res));
router.post("/business/webhook/whatsapp",  _webhookRL, (req, res) => _handleWebhook("whatsapp",  req, res));
router.post("/business/webhook/telegram",  _webhookRL, (req, res) => _handleWebhook("telegram",  req, res));
router.post("/business/webhook/payment",   _webhookRL, (req, res) => _handleWebhook("payment",   req, res));
router.post("/business/webhook/calendar",  _webhookRL, (req, res) => _handleWebhook("calendar",  req, res));
router.post("/business/webhook/:source",   _webhookRL, (req, res) => _handleWebhook(req.params.source, req, res));

// ── Authenticated event management ────────────────────────────────────────────
router.post("/business/events/ingest", requireAuth, async (req, res) => {
    try {
        const bea = _bea();
        if (!bea) return _err(res, new Error("event adapter unavailable"), 503);
        const { source = "manual", raw, automate, priority, alert } = req.body;
        if (!raw || typeof raw !== "object") return res.status(400).json({ success: false, error: "raw event object required" });
        const result = await bea.ingest(source, raw, { automate, priority, alert });
        _ok(res, result);
    } catch (e) { _err(res, e, 400); }
});

router.get("/business/events", requireAuth, (req, res) => {
    try {
        const bea = _bea();
        if (!bea) return _err(res, new Error("event adapter unavailable"), 503);
        const { source, entityType, status, limit, offset } = req.query;
        _ok(res, bea.getEventLog({ source, entityType, status, limit: limit ? parseInt(limit, 10) : 50, offset: offset ? parseInt(offset, 10) : 0 }));
    } catch (e) { _err(res, e); }
});

router.get("/business/events/stats", requireAuth, (req, res) => {
    try {
        const bea = _bea();
        if (!bea) return _err(res, new Error("event adapter unavailable"), 503);
        _ok(res, bea.getStats());
    } catch (e) { _err(res, e); }
});

router.get("/business/events/sources", requireAuth, (req, res) => {
    try {
        const bea = _bea();
        if (!bea) return _err(res, new Error("event adapter unavailable"), 503);
        _ok(res, { sources: Object.values(bea.SOURCES) });
    } catch (e) { _err(res, e); }
});

module.exports = router;
