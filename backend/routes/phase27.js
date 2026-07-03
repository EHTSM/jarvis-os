"use strict";
/**
 * Phase 27 routes — Track F: Jarvis Brain
 *
 * F1  Executive Reasoning Engine
 *     POST   /p27/executive/prioritize          prioritize a list of missions
 *     POST   /p27/executive/compare             compare execution plans
 *     POST   /p27/executive/estimate            estimate mission cost/time/risk
 *     POST   /p27/executive/choose              choose optimal path from options
 *     POST   /p27/executive/risk                assess strategic risk
 *     GET    /p27/executive/decisions           list executive decisions
 *     GET    /p27/executive/decisions/:id       get single decision
 *
 * F2  Mission Memory
 *     POST   /p27/missions                      create mission
 *     GET    /p27/missions                      list missions
 *     GET    /p27/missions/stats                aggregate stats
 *     GET    /p27/missions/:id                  get mission
 *     PATCH  /p27/missions/:id                  update mission
 *     POST   /p27/missions/:id/subtasks         add subtask
 *     POST   /p27/missions/:id/decisions        record decision
 *     POST   /p27/missions/:id/artifacts        record artifact
 *     POST   /p27/missions/:id/failures         record failure
 *     POST   /p27/missions/:id/deployments      record deployment
 *     POST   /p27/missions/:id/approvals        record approval
 *     POST   /p27/missions/:id/learnings        add learning
 *     GET    /p27/missions/:id/replay           replay mission
 *
 * F3  Autonomous Planning
 *     GET    /p27/planning/horizons             get all 5 horizon plans (cached)
 *     GET    /p27/planning/horizons/:horizon    get single horizon plan
 *     POST   /p27/planning/horizons/:horizon/refresh  force-refresh horizon
 *     GET    /p27/planning/recommend            recommend next highest-impact objective
 *     POST   /p27/planning/objectives/:id/complete    mark objective complete
 *     GET    /p27/planning/stats                planning statistics
 *
 * F4  Multi-Model Intelligence (AI routing)
 *     GET    /p27/ai/providers                  provider status for all 6 providers
 *     POST   /p27/ai/route                      route by capability (returns best provider)
 *     POST   /p27/ai/chat                       chat via best provider for task type
 *
 * F6  Continuous Improvement Loop
 *     GET    /p27/improvement/metrics           current self-evaluation metrics
 *     POST   /p27/improvement/report            generate weekly report now
 *     GET    /p27/improvement/reports           list past reports
 *     GET    /p27/improvement/reports/latest    most recent report
 *     GET    /p27/improvement/history           metrics history (weeks)
 *     POST   /p27/improvement/overrides         record operator override event
 *     POST   /p27/improvement/outcomes          record recommendation outcome
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const er   = require("../services/executiveReasoning.cjs");
const mm   = require("../services/missionMemory.cjs");
const ap   = require("../services/autonomousPlanning.cjs");
const ai   = require("../services/aiService.js");
const il   = require("../services/improvementLoop.cjs");

router.use("/p27", requireAuth);

// ── F1 Executive Reasoning ────────────────────────────────────────────────────

router.post("/p27/executive/prioritize", async (req, res) => {
    try {
        const { missions } = req.body;
        if (!Array.isArray(missions) || missions.length === 0)
            return res.status(400).json({ success: false, error: "missions array required" });
        const result = er.prioritizeMissions(missions);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/executive/compare", async (req, res) => {
    try {
        const { plans } = req.body;
        if (!Array.isArray(plans) || plans.length < 2)
            return res.status(400).json({ success: false, error: "plans array with at least 2 items required" });
        const result = er.compareExecutionPlans(plans);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/executive/estimate", async (req, res) => {
    try {
        const mission = req.body;
        if (!mission || !mission.effort)
            return res.status(400).json({ success: false, error: "mission object with effort field required" });
        const result = er.estimateMissionCost(mission);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/executive/choose", async (req, res) => {
    try {
        const { options } = req.body;
        if (!Array.isArray(options) || options.length < 2)
            return res.status(400).json({ success: false, error: "options array with at least 2 items required" });
        const result = er.chooseOptimalPath(options);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/executive/risk", async (req, res) => {
    try {
        const context = req.body;
        if (!context || !context.action)
            return res.status(400).json({ success: false, error: "context with action field required" });
        const result = er.assessStrategicRisk(context);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/p27/executive/decisions", (req, res) => {
    try {
        const { limit, type, since } = req.query;
        const result = er.getExecutiveDecisions({
            limit: limit ? parseInt(limit, 10) : 50,
            type,
            since,
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/p27/executive/decisions/:id", (req, res) => {
    try {
        const decision = er.getDecision(req.params.id);
        if (!decision) return res.status(404).json({ success: false, error: "Decision not found" });
        res.json({ success: true, decision });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── F2 Mission Memory ─────────────────────────────────────────────────────────

router.post("/p27/missions", (req, res) => {
    try {
        const { objective, priority, subtasks } = req.body;
        if (!objective) return res.status(400).json({ success: false, error: "objective required" });
        const mission = mm.createMission({ objective, priority, subtasks });
        res.status(201).json({ success: true, mission });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/p27/missions/stats", (req, res) => {
    try {
        const stats = mm.getMissionStats();
        res.json({ success: true, ...stats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/p27/missions", (req, res) => {
    try {
        const { status, priority, limit, since, search } = req.query;
        const result = mm.listMissions({ status, priority, limit: limit ? parseInt(limit, 10) : 50, since, search });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/p27/missions/:id/replay", (req, res) => {
    try {
        const result = mm.replayMission(req.params.id);
        if (!result) return res.status(404).json({ success: false, error: "Mission not found" });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/p27/missions/:id", (req, res) => {
    try {
        const mission = mm.getMission(req.params.id);
        if (!mission) return res.status(404).json({ success: false, error: "Mission not found" });
        res.json({ success: true, mission });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.patch("/p27/missions/:id", (req, res) => {
    try {
        const mission = mm.updateMission(req.params.id, req.body);
        if (!mission) return res.status(404).json({ success: false, error: "Mission not found" });
        res.json({ success: true, mission });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/missions/:id/subtasks", (req, res) => {
    try {
        const result = mm.addSubtask(req.params.id, req.body);
        if (!result) return res.status(404).json({ success: false, error: "Mission not found" });
        res.status(201).json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/missions/:id/decisions", (req, res) => {
    try {
        const result = mm.recordDecision(req.params.id, req.body);
        if (!result) return res.status(404).json({ success: false, error: "Mission not found" });
        res.status(201).json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/missions/:id/artifacts", (req, res) => {
    try {
        const result = mm.recordArtifact(req.params.id, req.body);
        if (!result) return res.status(404).json({ success: false, error: "Mission not found" });
        res.status(201).json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/missions/:id/failures", (req, res) => {
    try {
        const result = mm.recordFailure(req.params.id, req.body);
        if (!result) return res.status(404).json({ success: false, error: "Mission not found" });
        res.status(201).json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/missions/:id/deployments", (req, res) => {
    try {
        const result = mm.recordDeployment(req.params.id, req.body);
        if (!result) return res.status(404).json({ success: false, error: "Mission not found" });
        res.status(201).json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/missions/:id/approvals", (req, res) => {
    try {
        const result = mm.recordApproval(req.params.id, req.body);
        if (!result) return res.status(404).json({ success: false, error: "Mission not found" });
        res.status(201).json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/missions/:id/learnings", (req, res) => {
    try {
        const result = mm.addLearning(req.params.id, req.body);
        if (!result) return res.status(404).json({ success: false, error: "Mission not found" });
        res.status(201).json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── F3 Autonomous Planning ────────────────────────────────────────────────────

router.get("/p27/planning/horizons", async (req, res) => {
    try {
        const result = await ap.getAllHorizons();
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/p27/planning/horizons/:horizon", async (req, res) => {
    try {
        const valid = ["immediate", "today", "week", "month", "roadmap"];
        if (!valid.includes(req.params.horizon))
            return res.status(400).json({ success: false, error: `horizon must be one of: ${valid.join(", ")}` });
        const plan = await ap.getHorizon(req.params.horizon);
        if (!plan) return res.status(404).json({ success: false, error: "Horizon not yet generated" });
        res.json({ success: true, plan });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/planning/horizons/:horizon/refresh", async (req, res) => {
    try {
        const valid = ["immediate", "today", "week", "month", "roadmap"];
        if (!valid.includes(req.params.horizon))
            return res.status(400).json({ success: false, error: `horizon must be one of: ${valid.join(", ")}` });
        const plan = await ap.refreshHorizon(req.params.horizon);
        res.json({ success: true, plan });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/p27/planning/recommend", async (req, res) => {
    try {
        const context = req.query.context ? JSON.parse(req.query.context) : {};
        const result = await ap.recommendNextObjective(context);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/planning/objectives/:id/complete", async (req, res) => {
    try {
        const result = await ap.markObjectiveComplete(req.params.id, req.body);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/p27/planning/stats", async (req, res) => {
    try {
        const stats = await ap.getPlanningStats();
        res.json({ success: true, ...stats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── F4 Multi-Model Intelligence ───────────────────────────────────────────────

router.get("/p27/ai/providers", (req, res) => {
    try {
        const status = ai.getProviderStatus();
        res.json({ success: true, providers: status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/ai/route", (req, res) => {
    try {
        const { task } = req.body;
        const valid = ["reasoning", "coding", "fast", "cheap", "creative", "analysis"];
        if (!task || !valid.includes(task))
            return res.status(400).json({ success: false, error: `task must be one of: ${valid.join(", ")}` });
        const result = ai.routeByCapability(task);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/ai/chat", async (req, res) => {
    try {
        const { messages, provider, task, maxTokens, temperature } = req.body;
        if (!Array.isArray(messages) || messages.length === 0)
            return res.status(400).json({ success: false, error: "messages array required" });
        const result = await ai.chat(messages, { provider, task, maxTokens, temperature });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── F6 Continuous Improvement Loop ────────────────────────────────────────────

router.get("/p27/improvement/metrics", async (req, res) => {
    try {
        const metrics = await il.getMetrics();
        res.json({ success: true, metrics });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/improvement/report", async (req, res) => {
    try {
        const report = await il.generateWeeklyReport();
        res.json({ success: true, report });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/p27/improvement/reports/latest", async (req, res) => {
    try {
        const report = await il.getLatestReport();
        if (!report) return res.status(404).json({ success: false, error: "No reports generated yet" });
        res.json({ success: true, report });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/p27/improvement/reports", async (req, res) => {
    try {
        const { limit, since } = req.query;
        const result = await il.getReports({ limit: limit ? parseInt(limit, 10) : 20, since });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/p27/improvement/history", async (req, res) => {
    try {
        const { weeks } = req.query;
        const result = await il.getMetricsHistory(weeks ? parseInt(weeks, 10) : 12);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/improvement/overrides", async (req, res) => {
    try {
        const { decisionId, reason, outcome } = req.body;
        if (!decisionId) return res.status(400).json({ success: false, error: "decisionId required" });
        const result = await il.trackOperatorOverride({ decisionId, reason, outcome });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/p27/improvement/outcomes", async (req, res) => {
    try {
        const { recId, accepted, outcome } = req.body;
        if (!recId || accepted === undefined)
            return res.status(400).json({ success: false, error: "recId and accepted required" });
        const result = await il.trackRecommendationOutcome(recId, accepted, outcome);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
