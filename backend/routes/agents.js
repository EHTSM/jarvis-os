"use strict";
/**
 * agents.js — J2 Agent Collaboration Runtime routes
 *
 * All routes are gated behind requireAuth (set in the route barrel before
 * this file is mounted — see routes/index.js).
 *
 * Routes:
 *   GET  /agents/conversation/:missionId    — full thread + graph nodes
 *   GET  /agents/status/:missionId          — agent status matrix
 *   GET  /agents/delegation/:missionId      — delegation event log
 *   POST /agents/message                    — post a message to a mission thread
 *   POST /agents/override                   — operator override an agent
 *   PATCH /agents/task/:taskId              — claim or delegate a task
 *
 * Additional (convenience):
 *   POST /agents/collaborate/:missionId     — start a collaboration session (create graph)
 */

const router  = require("express").Router();
const collab  = require("../../agents/runtime/agentCollaboration.cjs");
const logger  = require("../utils/logger");

function _ok(res, data) {
    res.json({ success: true, ...data });
}

function _err(res, err) {
    const status = err.message.includes("not found") ? 404 : 400;
    logger.warn(`[Agents API] ${err.message}`);
    res.status(status).json({ success: false, error: err.message });
}

// ── GET /agents/conversation/:missionId ──────────────────────────────────────
router.get("/agents/conversation/:missionId", (req, res) => {
    try {
        _ok(res, { conversation: collab.getConversation(req.params.missionId) });
    } catch (err) { _err(res, err); }
});

// ── GET /agents/status/:missionId ────────────────────────────────────────────
router.get("/agents/status/:missionId", (req, res) => {
    try {
        _ok(res, { status: collab.getAgentStatus(req.params.missionId) });
    } catch (err) { _err(res, err); }
});

// ── GET /agents/delegation/:missionId ────────────────────────────────────────
router.get("/agents/delegation/:missionId", (req, res) => {
    try {
        _ok(res, { delegation: collab.getDelegationLog(req.params.missionId) });
    } catch (err) { _err(res, err); }
});

// ── POST /agents/message ─────────────────────────────────────────────────────
// Body: { missionId, from, to, body, type? }
router.post("/agents/message", async (req, res) => {
    const { missionId, from, to, body: msgBody, type } = req.body || {};
    if (!missionId || !from || !to || !msgBody) {
        return res.status(400).json({ success: false, error: "missionId, from, to, body are required" });
    }
    try {
        const msg = collab.postMessage(missionId, from, to, msgBody, { type });
        _ok(res, { message: msg });
    } catch (err) { _err(res, err); }
});

// ── POST /agents/override ─────────────────────────────────────────────────────
// Body: { missionId, agentId, instruction, operatorId? }
router.post("/agents/override", async (req, res) => {
    const { missionId, agentId, instruction, operatorId } = req.body || {};
    if (!missionId || !agentId || !instruction) {
        return res.status(400).json({ success: false, error: "missionId, agentId, instruction are required" });
    }
    try {
        const result = await collab.overrideAgent(missionId, agentId, instruction, operatorId || "operator");
        _ok(res, { override: result });
    } catch (err) { _err(res, err); }
});

// ── PATCH /agents/task/:taskId ────────────────────────────────────────────────
// Body: { action: "claim"|"delegate", agentId, toAgentId?, reason? }
router.patch("/agents/task/:taskId", async (req, res) => {
    const { action, agentId, toAgentId, reason } = req.body || {};
    if (!action || !agentId) {
        return res.status(400).json({ success: false, error: "action and agentId are required" });
    }
    try {
        if (action === "claim") {
            const result = collab.claimTask(req.params.taskId, agentId);
            return _ok(res, { claim: result });
        }
        if (action === "delegate") {
            if (!toAgentId) return res.status(400).json({ success: false, error: "toAgentId required for delegate" });
            const result = await collab.delegateTask(req.params.taskId, agentId, toAgentId, reason || "");
            return _ok(res, { delegation: result });
        }
        res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    } catch (err) { _err(res, err); }
});

// ── POST /agents/collaborate/:missionId ───────────────────────────────────────
// Body: { steps? } — optional custom pipeline step overrides
router.post("/agents/collaborate/:missionId", async (req, res) => {
    const { steps } = req.body || {};
    try {
        const result = await collab.startCollaboration(req.params.missionId, { steps });
        _ok(res, { collaboration: result });
    } catch (err) { _err(res, err); }
});

module.exports = router;
