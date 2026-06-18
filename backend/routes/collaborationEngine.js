"use strict";
/**
 * collaborationEngine.js — Phase I6: Multi-Agent Collaboration Engine routes
 *
 * All routes are under /collab/* (distinct from the existing /collaboration/* J5 routes)
 *
 * Plan (I6-1):
 *   POST /collab/plans/:missionId           — create collaboration plan
 *   GET  /collab/plans/:missionId           — get plan + ownership + handoffs
 *   GET  /collab/plans                      — list plans
 *   POST /collab/plans/:missionId/complete  — force-complete plan
 *
 * Handoff (I6-2):
 *   POST /collab/handoff                    — explicit handoff
 *   POST /collab/claim                      — agent claims pending handoff
 *   POST /collab/accept                     — agent accepts handoff
 *   POST /collab/release                    — agent releases (stage done)
 *   POST /collab/retry/:handoffId           — retry failed/rejected handoff
 *   POST /collab/agent-reject               — agent rejects handoff
 *   GET  /collab/handoffs/:missionId        — list handoffs for mission
 *
 * Ownership (I6-4):
 *   GET  /collab/ownership/:missionId       — full ownership + timeline
 *
 * Dashboard (I6-5):
 *   GET  /collab/active                     — active collaborations
 *   GET  /collab/blocked                    — blocked chains
 *   GET  /collab/stalled                    — stalled handoffs
 *   GET  /collab/stats                      — engine stats
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

function _ce() { return require("../services/missionCollaborationEngine.cjs"); }
function _ok(res, data)     { res.json({ ok: true, ...data }); }
function _err(res, e, code) { res.status(code || 500).json({ ok: false, error: e?.message || String(e) }); }

router.use(requireAuth);

// ── I6-1: Plan ────────────────────────────────────────────────────────────────

router.post("/collab/plans/:missionId", (req, res) => {
    try {
        const plan = _ce().createPlan(req.params.missionId, req.body || {});
        _ok(res, { plan });
    } catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 400); }
});

router.get("/collab/plans/:missionId", (req, res) => {
    try {
        const plan = _ce().getPlan(req.params.missionId);
        if (!plan) return res.status(404).json({ ok: false, error: "No collaboration plan for this mission" });
        const ownership = _ce().getMissionOwnership(req.params.missionId);
        const handoffs  = _ce().getHandoffs(req.params.missionId);
        _ok(res, { plan, ownership, handoffs });
    } catch (e) { _err(res, e); }
});

router.get("/collab/plans", (req, res) => {
    try {
        const opts = {
            status:     req.query.status,
            limit:      req.query.limit ? parseInt(req.query.limit, 10) : 50,
            activeOnly: req.query.active === "true",
        };
        _ok(res, _ce().listPlans(opts));
    } catch (e) { _err(res, e); }
});

router.post("/collab/plans/:missionId/complete", (req, res) => {
    try {
        const plan = _ce().completePlan(req.params.missionId);
        if (!plan) return res.status(404).json({ ok: false, error: "Plan not found" });
        _ok(res, { plan });
    } catch (e) { _err(res, e); }
});

// ── I6-2: Handoff Engine ──────────────────────────────────────────────────────

router.post("/collab/handoff", (req, res) => {
    try {
        const { missionId, fromAgent, toAgent, payload } = req.body || {};
        if (!missionId || !toAgent) return _err(res, new Error("missionId and toAgent are required"), 400);
        const hoff = _ce().handoff(missionId, fromAgent, toAgent, payload || {});
        _ok(res, { handoff: hoff });
    } catch (e) { _err(res, e); }
});

router.post("/collab/claim", (req, res) => {
    try {
        const { missionId, agentId } = req.body || {};
        if (!missionId || !agentId) return _err(res, new Error("missionId and agentId are required"), 400);
        const hoff = _ce().claim(missionId, agentId);
        _ok(res, { handoff: hoff });
    } catch (e) { _err(res, e); }
});

router.post("/collab/accept", (req, res) => {
    try {
        const { missionId, agentId, handoffId } = req.body || {};
        if (!missionId || !agentId) return _err(res, new Error("missionId and agentId are required"), 400);
        const hoff = _ce().accept(missionId, agentId, handoffId);
        _ok(res, { handoff: hoff });
    } catch (e) { _err(res, e); }
});

router.post("/collab/release", (req, res) => {
    try {
        const { missionId, agentId, outcome } = req.body || {};
        if (!missionId || !agentId) return _err(res, new Error("missionId and agentId are required"), 400);
        const hoff = _ce().release(missionId, agentId, outcome);
        _ok(res, { handoff: hoff });
    } catch (e) { _err(res, e); }
});

router.post("/collab/retry/:handoffId", (req, res) => {
    try {
        const { missionId } = req.body || {};
        if (!missionId) return _err(res, new Error("missionId required in body"), 400);
        const hoff = _ce().retry(missionId, req.params.handoffId);
        _ok(res, { handoff: hoff });
    } catch (e) { _err(res, e); }
});

router.post("/collab/agent-reject", (req, res) => {
    try {
        const { missionId, agentId, reason } = req.body || {};
        if (!missionId || !agentId) return _err(res, new Error("missionId and agentId are required"), 400);
        const hoff = _ce().reject(missionId, agentId, reason);
        _ok(res, { handoff: hoff });
    } catch (e) { _err(res, e); }
});

router.get("/collab/handoffs/:missionId", (req, res) => {
    try {
        const handoffs = _ce().getHandoffs(req.params.missionId);
        _ok(res, { handoffs, total: handoffs.length });
    } catch (e) { _err(res, e); }
});

// ── I6-4: Ownership ───────────────────────────────────────────────────────────

router.get("/collab/ownership/:missionId", (req, res) => {
    try {
        const own = _ce().getMissionOwnership(req.params.missionId);
        if (!own) return res.status(404).json({ ok: false, error: "No ownership record for this mission" });
        _ok(res, { ownership: own });
    } catch (e) { _err(res, e); }
});

// ── I6-5: Dashboard data ──────────────────────────────────────────────────────

router.get("/collab/active", (req, res) => {
    try {
        const collaborations = _ce().getActiveCollaborations();
        _ok(res, { collaborations, total: collaborations.length });
    } catch (e) { _err(res, e); }
});

router.get("/collab/blocked", (req, res) => {
    try {
        const blocked = _ce().getBlockedChains();
        _ok(res, { blocked, total: blocked.length });
    } catch (e) { _err(res, e); }
});

router.get("/collab/stalled", (req, res) => {
    try {
        const thresholdMs = req.query.thresholdMs ? parseInt(req.query.thresholdMs, 10) : 5 * 60_000;
        const stalled = _ce().getStalledHandoffs(thresholdMs);
        _ok(res, { stalled, total: stalled.length });
    } catch (e) { _err(res, e); }
});

router.get("/collab/stats", (req, res) => {
    try {
        _ok(res, { stats: _ce().getStats() });
    } catch (e) { _err(res, e); }
});

module.exports = router;
