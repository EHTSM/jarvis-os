"use strict";
/**
 * agentsRuntime.js — Phase I4: Agent Runtime Supervisor routes
 *
 * GET  /agents/runtime/supervisor          — supervisor status + all agents
 * GET  /agents/runtime/supervisor/:id      — single agent state
 * POST /agents/runtime/supervisor/start    — start supervisor (idempotent)
 * POST /agents/runtime/supervisor/stop     — stop all agents
 * POST /agents/runtime/supervisor/:id/pause   — pause an agent
 * POST /agents/runtime/supervisor/:id/resume  — resume a paused agent
 * POST /agents/runtime/supervisor/:id/tick    — force an immediate tick (debug)
 * GET  /agents/runtime/supervisor/history     — recent bus events (from runtimeEventBus)
 *
 * All routes require authentication. Auto-starts supervisor on first GET
 * (read-only probe) so the UI can always display something without a manual start.
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

function _sup() { return require("../services/agentRuntimeSupervisor.cjs"); }
function _bus() {
    try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; }
}

function _ok(res, data)     { res.json({ ok: true,  ...data  }); }
function _err(res, e, code) { res.status(code || 500).json({ ok: false, error: e?.message || String(e) }); }

router.use(requireAuth);

// Auto-start supervisor on first status probe (idempotent — safe)
function _ensureStarted() {
    try {
        const s = _sup();
        if (!s.getSupervisorStatus().started) s.start();
    } catch {}
}

// GET /agents/runtime/supervisor — full supervisor status
router.get("/agents/runtime/supervisor", (req, res) => {
    try {
        _ensureStarted();
        _ok(res, _sup().getSupervisorStatus());
    } catch (e) { _err(res, e); }
});

// GET /agents/runtime/supervisor/history  — last N bus events for the UI
// MUST be before /:id so "history" is not treated as an agent id param
router.get("/agents/runtime/supervisor/history", (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
        const bus = _bus();
        const history = bus?.getHistory?.({ limit }) || [];
        _ok(res, { history, total: history.length });
    } catch (e) { _err(res, e); }
});

// GET /agents/runtime/supervisor/:id — single agent
router.get("/agents/runtime/supervisor/:id", (req, res) => {
    try {
        _ensureStarted();
        const agent = _sup().getAgent(req.params.id);
        if (!agent) return res.status(404).json({ ok: false, error: "Agent not found" });
        _ok(res, { agent });
    } catch (e) { _err(res, e); }
});

// POST /agents/runtime/supervisor/start
router.post("/agents/runtime/supervisor/start", (req, res) => {
    try {
        _ok(res, _sup().start());
    } catch (e) { _err(res, e); }
});

// POST /agents/runtime/supervisor/stop
router.post("/agents/runtime/supervisor/stop", (req, res) => {
    try {
        _sup().stop();
        _ok(res, { message: "All agents stopped" });
    } catch (e) { _err(res, e); }
});

// POST /agents/runtime/supervisor/:id/pause
router.post("/agents/runtime/supervisor/:id/pause", (req, res) => {
    try {
        const r = _sup().pauseAgent(req.params.id);
        if (!r.ok) return res.status(404).json(r);
        _ok(res, r);
    } catch (e) { _err(res, e); }
});

// POST /agents/runtime/supervisor/:id/resume
router.post("/agents/runtime/supervisor/:id/resume", (req, res) => {
    try {
        const r = _sup().resumeAgent(req.params.id);
        if (!r.ok) return res.status(404).json(r);
        _ok(res, r);
    } catch (e) { _err(res, e); }
});

// POST /agents/runtime/supervisor/:id/tick  (debug — force immediate tick)
router.post("/agents/runtime/supervisor/:id/tick", async (req, res) => {
    try {
        const r = await _sup().triggerTick(req.params.id);
        if (!r.ok) return res.status(404).json(r);
        _ok(res, r);
    } catch (e) { _err(res, e); }
});

module.exports = router;
