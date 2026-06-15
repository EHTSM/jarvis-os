"use strict";
/**
 * collaboration.js — J5 Human–AI Collaboration routes
 *
 * GET  /collaboration/session/:missionId        — session state
 * GET  /collaboration/history/:missionId        — unified interaction timeline
 * POST /collaboration/message                   — ask AI / ask agent
 * POST /collaboration/action                    — all 10 collaboration actions
 * POST /collaboration/replan                    — request re-plan
 * POST /collaboration/approve                   — accept recommendation
 * POST /collaboration/reject                    — reject recommendation
 */
const router = require("express").Router();
const layer  = require("../../agents/runtime/collaborationLayer.cjs");

function _ok(res, data)       { res.json({ ok: true,  ...data }); }
function _err(res, err, code) { res.status(code || 500).json({ ok: false, error: err.message || String(err) }); }

// ── GET /collaboration/session/:missionId ────────────────────────────────────
router.get("/collaboration/session/:missionId", (req, res) => {
    try {
        const session = layer.getSession(req.params.missionId);
        _ok(res, { session });
    } catch (err) {
        _err(res, err, err.message?.includes("not found") ? 404 : 500);
    }
});

// ── GET /collaboration/history/:missionId ────────────────────────────────────
router.get("/collaboration/history/:missionId", (req, res) => {
    try {
        const limit   = parseInt(req.query.limit) || 50;
        const history = layer.getHistory(req.params.missionId, { limit });
        _ok(res, { history });
    } catch (err) {
        _err(res, err, err.message?.includes("not found") ? 404 : 500);
    }
});

// ── POST /collaboration/message ──────────────────────────────────────────────
// body: { missionId, from?, body, agentId?, type? }
router.post("/collaboration/message", async (req, res) => {
    try {
        const { missionId, from, body, agentId, type } = req.body || {};
        if (!missionId)  return _err(res, new Error("missionId is required"), 400);
        if (!body?.trim()) return _err(res, new Error("body is required"),    400);

        const result = await layer.sendMessage(missionId, from || "operator", body, { agentId, type });
        _ok(res, { result });
    } catch (err) {
        _err(res, err);
    }
});

// ── POST /collaboration/action ───────────────────────────────────────────────
// body: { missionId, action, payload }
// action: ask_ai | ask_agent | explain_decision | explain_risk | explain_confidence
//         | compare_alternatives | accept_recommendation | reject_recommendation
//         | request_replan | escalate_operator
router.post("/collaboration/action", async (req, res) => {
    try {
        const { missionId, action, payload } = req.body || {};
        if (!missionId) return _err(res, new Error("missionId is required"), 400);
        if (!action)    return _err(res, new Error("action is required"),    400);

        const result = await layer.performAction(missionId, action, payload || {});
        _ok(res, { result });
    } catch (err) {
        _err(res, err, err.message?.includes("Unknown action") ? 400 : err.message?.includes("not found") ? 404 : 500);
    }
});

// ── POST /collaboration/replan ───────────────────────────────────────────────
// body: { missionId, reason }
router.post("/collaboration/replan", async (req, res) => {
    try {
        const { missionId, reason } = req.body || {};
        if (!missionId) return _err(res, new Error("missionId is required"), 400);

        const result = await layer.requestReplan(missionId, reason || "Operator requested");
        _ok(res, { result });
    } catch (err) {
        _err(res, err, err.message?.includes("not found") ? 404 : 500);
    }
});

// ── POST /collaboration/approve ──────────────────────────────────────────────
// body: { missionId, itemId, approvedBy }
router.post("/collaboration/approve", async (req, res) => {
    try {
        const { missionId, itemId, approvedBy } = req.body || {};
        if (!missionId) return _err(res, new Error("missionId is required"), 400);
        if (!itemId)    return _err(res, new Error("itemId is required"),    400);

        const result = await layer.approve(missionId, itemId, approvedBy || "operator");
        _ok(res, { result });
    } catch (err) {
        _err(res, err, err.message?.includes("not found") ? 404 : 500);
    }
});

// ── POST /collaboration/reject ───────────────────────────────────────────────
// body: { missionId, itemId, reason, rejectedBy }
router.post("/collaboration/reject", async (req, res) => {
    try {
        const { missionId, itemId, reason, rejectedBy } = req.body || {};
        if (!missionId) return _err(res, new Error("missionId is required"), 400);
        if (!itemId)    return _err(res, new Error("itemId is required"),    400);

        const result = await layer.reject(missionId, itemId, reason || "Rejected", rejectedBy || "operator");
        _ok(res, { result });
    } catch (err) {
        _err(res, err, err.message?.includes("not found") ? 404 : 500);
    }
});

module.exports = router;
