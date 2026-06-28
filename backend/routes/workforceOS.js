"use strict";
/**
 * POST-Ω Sprint P7 — Autonomous Workforce OS routes
 * Prefix: /workforce-os/*
 */

const router = require("express").Router();

const _try  = fn => { try { return fn(); } catch { return null; } };
const requireAuth = _try(() => require("../middleware/requireAuth")) || ((req, res, next) => next());

const _wm  = () => _try(() => require("../services/workforceManager.cjs"));
const _se  = () => _try(() => require("../services/skillEngine.cjs"));
const _tb  = () => _try(() => require("../services/teamBuilder.cjs"));
const _cp  = () => _try(() => require("../services/capacityPlanner.cjs"));
const _pe  = () => _try(() => require("../services/performanceEngine.cjs"));
const _wd  = () => _try(() => require("../services/workforceDashboard.cjs"));

// ── Dashboard ────────────────────────────────────────────────────────────────

router.get("/workforce-os/dashboard", requireAuth, (req, res) =>
  res.json(_wd()?.getDashboard?.() || { ok: false }));

router.get("/workforce-os/stats", requireAuth, (req, res) =>
  res.json({ ok: true, stats: _wm()?.getStats?.() || {} }));

// ── Workforce manager ─────────────────────────────────────────────────────────

router.post("/workforce-os/mission/run", requireAuth, async (req, res) => {
  const { title, description, domain, priority, requiredSkills, teamType, minAgents, maxAgents, dryRun } = req.body || {};
  if (!title) return res.status(400).json({ ok: false, error: "title required" });
  try {
    const result = await _wm()?.runMission?.({ title, description, domain, priority, requiredSkills, teamType, minAgents, maxAgents, dryRun });
    res.json(result || { ok: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/workforce-os/missions", requireAuth, (req, res) => {
  const { status, domain, limit } = req.query;
  res.json(_wm()?.listMissions?.({ status, domain, limit: limit ? +limit : 50 }) || { ok: false });
});

router.get("/workforce-os/missions/:id", requireAuth, (req, res) => {
  const m = _wm()?.getMission?.(req.params.id);
  if (!m) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, mission: m });
});

router.get("/workforce-os/report", requireAuth, (req, res) =>
  res.json(_wm()?.getWorkforceReport?.() || { ok: false }));

router.post("/workforce-os/reassign", requireAuth, (req, res) => {
  const { teamId, agentId, reason } = req.body || {};
  if (!teamId || !agentId) return res.status(400).json({ ok: false, error: "teamId and agentId required" });
  res.json(_wm()?.reassignAgent?.(teamId, agentId, { reason }) || { ok: false });
});

// ── Skill engine ─────────────────────────────────────────────────────────────

router.get("/workforce-os/agents", requireAuth, (req, res) => {
  const { org, skill, available, teamType, limit } = req.query;
  const av = available !== undefined ? available === "true" : undefined;
  res.json({ ok: true, agents: _se()?.listAgents?.({ org, skill, available: av, teamType, limit: limit ? +limit : 100 }) || [] });
});

router.get("/workforce-os/agents/:id", requireAuth, (req, res) =>
  res.json(_wd()?.getAgentCard?.(req.params.id) || { ok: false }));

router.get("/workforce-os/agents/:id/performance", requireAuth, (req, res) =>
  res.json(_pe()?.getAgentPerformance?.(req.params.id) || { ok: false }));

router.post("/workforce-os/agents/find", requireAuth, (req, res) => {
  const { skills, minConfidence, available, limit } = req.body || {};
  if (!skills?.length) return res.status(400).json({ ok: false, error: "skills array required" });
  res.json({ ok: true, agents: _se()?.findBySkills?.(skills, { minConfidence, available, limit }) || [] });
});

router.get("/workforce-os/skills/coverage", requireAuth, (req, res) =>
  res.json({ ok: true, coverage: _se()?.getSkillCoverage?.() || {} }));

router.get("/workforce-os/skills/stats", requireAuth, (req, res) =>
  res.json({ ok: true, stats: _se()?.getStats?.() || {} }));

// ── Team builder ──────────────────────────────────────────────────────────────

router.post("/workforce-os/teams/build", requireAuth, (req, res) => {
  const { missionId, missionTitle, missionDomain, teamType, requiredSkills, size } = req.body || {};
  if (!missionId) return res.status(400).json({ ok: false, error: "missionId required" });
  res.json(_tb()?.buildTeam?.({ missionId, missionTitle, missionDomain, teamType, requiredSkills, size }) || { ok: false });
});

router.get("/workforce-os/teams", requireAuth, (req, res) => {
  const { status, type, limit } = req.query;
  res.json({ ok: true, teams: _tb()?.listTeams?.({ status, type, limit: limit ? +limit : 50 }) || [] });
});

router.get("/workforce-os/teams/:id", requireAuth, (req, res) => {
  const team = _tb()?.getTeam?.(req.params.id);
  if (!team) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, team });
});

router.post("/workforce-os/teams/:id/replace", requireAuth, (req, res) => {
  const { agentId, reason } = req.body || {};
  if (!agentId) return res.status(400).json({ ok: false, error: "agentId required" });
  res.json(_tb()?.replaceAgent?.(req.params.id, agentId, { reason }) || { ok: false });
});

router.post("/workforce-os/teams/:id/disband", requireAuth, (req, res) => {
  const { outcome, minutesSaved } = req.body || {};
  res.json(_tb()?.disbandTeam?.(req.params.id, { outcome, minutesSaved }) || { ok: false });
});

router.get("/workforce-os/teams/stats", requireAuth, (req, res) =>
  res.json({ ok: true, stats: _tb()?.getStats?.() || {} }));

// ── Capacity planner ──────────────────────────────────────────────────────────

router.get("/workforce-os/capacity", requireAuth, (req, res) =>
  res.json(_cp()?.getCapacityReport?.() || { ok: false }));

router.get("/workforce-os/capacity/snapshot", requireAuth, (req, res) =>
  res.json(_cp()?.snapshot?.() || { ok: false }));

router.post("/workforce-os/capacity/rebalance", requireAuth, (req, res) =>
  res.json(_cp()?.rebalance?.() || { ok: false }));

router.post("/workforce-os/capacity/queue", requireAuth, (req, res) => {
  const { title, skillsRequired, priority, teamId, missionId } = req.body || {};
  res.json(_cp()?.enqueueWork?.({ title, skillsRequired, priority, teamId, missionId }) || { ok: false });
});

router.post("/workforce-os/capacity/assign", requireAuth, (req, res) => {
  const { workItemId, agentId } = req.body || {};
  if (!workItemId || !agentId) return res.status(400).json({ ok: false, error: "workItemId and agentId required" });
  res.json(_cp()?.assignWork?.(workItemId, agentId) || { ok: false });
});

router.post("/workforce-os/capacity/complete", requireAuth, (req, res) => {
  const { workItemId, outcome } = req.body || {};
  res.json(_cp()?.completeWork?.(workItemId, { outcome }) || { ok: false });
});

// ── Performance engine ────────────────────────────────────────────────────────

router.get("/workforce-os/performance", requireAuth, (req, res) =>
  res.json(_pe()?.getDashboardData?.() || { ok: false }));

router.get("/workforce-os/performance/rankings", requireAuth, (req, res) => {
  const { org, limit } = req.query;
  res.json(_pe()?.getRankings?.({ org, limit: limit ? +limit : 20 }) || { ok: false });
});

router.post("/workforce-os/performance/record", requireAuth, (req, res) =>
  res.json(_pe()?.record?.(req.body || {}) || { ok: false }));

router.get("/workforce-os/performance/teams/:id", requireAuth, (req, res) =>
  res.json(_pe()?.getTeamPerformance?.(req.params.id) || { ok: false }));

router.get("/workforce-os/performance/agents/:id", requireAuth, (req, res) =>
  res.json(_pe()?.getAgentPerformance?.(req.params.id) || { ok: false }));

// ── Collaboration graph ───────────────────────────────────────────────────────

router.get("/workforce-os/collaboration", requireAuth, (req, res) =>
  res.json({ ok: true, graph: _wd()?.buildCollaborationGraph?.() || {} }));

router.get("/workforce-os/heatmap", requireAuth, (req, res) =>
  res.json({ ok: true, heatmap: _wd()?.buildWorkloadHeatmap?.() || {} }));

module.exports = router;
