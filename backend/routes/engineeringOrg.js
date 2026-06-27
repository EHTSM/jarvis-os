"use strict";
/**
 * Level 2 Engineering Organization routes
 *
 * GET  /engorg/status        — full org status (all 20 engineers)
 * GET  /engorg/summary       — compact summary (counts + health)
 * GET  /engorg/agents/:id    — single engineer status
 * POST /engorg/agents/:id/tick    — force immediate tick
 * POST /engorg/agents/:id/enable  — enable disabled engineer
 * POST /engorg/agents/:id/disable — disable running engineer
 * GET  /engorg/missions      — missions created by engineering org
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

function _org()  { return require("../services/engineeringOrg.cjs"); }
function _sup()  { return require("../services/agentRuntimeSupervisor.cjs"); }
function _mm()   { try { return require("../services/missionMemory.cjs"); } catch { return null; } }

router.get("/engorg/status", requireAuth, (req, res) => {
  try {
    const status = _org().getOrgStatus();
    return res.json({ success: true, count: status.length, engineers: status });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/summary", requireAuth, (req, res) => {
  try {
    const summary = _org().getOrgSummary();
    return res.json({ success: true, ...summary });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/agents/:id", requireAuth, (req, res) => {
  try {
    const agent = _sup().getAgentStatus(req.params.id);
    if (!agent) return res.status(404).json({ success: false, error: "Agent not found" });
    return res.json({ success: true, agent });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/engorg/agents/:id/tick", requireAuth, async (req, res) => {
  try {
    const result = await _sup().triggerTick(req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/engorg/agents/:id/enable", requireAuth, (req, res) => {
  try {
    const result = _sup().enableAgent(req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/engorg/agents/:id/disable", requireAuth, (req, res) => {
  try {
    const result = _sup().disableAgent(req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/missions", requireAuth, (req, res) => {
  try {
    const limit  = parseInt(req.query.limit) || 50;
    const all    = _mm()?.listMissions({ limit: 500 }) || { missions: [] };
    const orgIds = new Set(require("../services/engineeringOrg.cjs").ENGINEERING_ORG.map(e => e.id));
    const missions = (all.missions || [])
      .filter(m => orgIds.has(m.metadata?.autoCreatedBy))
      .slice(0, limit);
    return res.json({ success: true, count: missions.length, missions });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
