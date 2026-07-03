"use strict";
/**
 * Phase 23 routes — Engineering Automation
 *
 * 23A  GitHubEngineeringAgent
 *      GET    /p23/github/:owner/:repo                  read repo info
 *      GET    /p23/github/:owner/:repo/issues           list issues
 *      POST   /p23/github/:owner/:repo/issues/analyze   analyze issues
 *      POST   /p23/github/:owner/:repo/issues           create issue
 *      POST   /p23/github/:owner/:repo/pulls            create PR
 *      POST   /p23/github/:owner/:repo/pulls/:number/review  review PR
 *      GET    /p23/github/:owner/:repo/changelog        generate changelog
 *      GET    /p23/github/activity                      engineering activity log
 *      GET    /p23/github/stats                         activity stats
 *
 * 23B  CodeReviewEngine
 *      POST   /p23/review/code                          review raw code
 *      POST   /p23/review/file                          review a server-side file path
 *      POST   /p23/review/diff                          review unified diff
 *      GET    /p23/review/:reviewId/summary             get review summary
 *      GET    /p23/review/:reviewId                     get full review
 *      GET    /p23/review                               list reviews
 *      GET    /p23/review/stats                         aggregate stats
 *
 * 23C  ReleaseEngine
 *      GET    /p23/release/version                      current version
 *      POST   /p23/release/version/bump                 bump version
 *      GET    /p23/release/build/validate               validate build
 *      POST   /p23/release/checklist                    run release checklist
 *      POST   /p23/release/notes                        generate release notes
 *      GET    /p23/release/readiness                    deployment readiness
 *      POST   /p23/release                              create release record
 *      GET    /p23/release/:releaseId                   get release
 *      GET    /p23/release                              list releases
 *
 * 23D  EngineeringAutopilot
 *      POST   /p23/autopilot/missions                   run a mission
 *      GET    /p23/autopilot/missions/:missionId/chain  get execution chain
 *      DELETE /p23/autopilot/missions/:missionId        cancel mission
 *      GET    /p23/autopilot/missions/:missionId        get mission
 *      GET    /p23/autopilot/missions                   list missions
 *      GET    /p23/autopilot/stats                      aggregate stats
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const gha = require("../services/gitHubEngineeringAgent.cjs");
const cre = require("../services/codeReviewEngine.cjs");
const re  = require("../services/releaseEngine.cjs");
const ap  = require("../services/engineeringAutopilot.cjs");

router.use("/p23", requireAuth);

// ── 23A GitHub Engineering Agent ──────────────────────────────────────────

router.get("/p23/github/activity", (req, res) => {
    const { type, owner, repo, limit, offset } = req.query;
    res.json({ success: true, ...gha.getActivity({ type, owner, repo, limit: parseInt(limit)||100, offset: parseInt(offset)||0 }) });
});

router.get("/p23/github/stats", (req, res) => {
    res.json({ success: true, ...gha.getStats() });
});

router.get("/p23/github/:owner/:repo/changelog", async (req, res) => {
    const { since, base, limit } = req.query;
    try {
        const r = await gha.generateChangelog(req.params.owner, req.params.repo, { since, base, limit: parseInt(limit)||30 });
        res.json({ success: true, ...r });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get("/p23/github/:owner/:repo/issues", async (req, res) => {
    const { state, labels, limit } = req.query;
    try {
        const issues = await gha.listIssues(req.params.owner, req.params.repo, { state, labels, limit: parseInt(limit)||30 });
        res.json({ success: true, issues, count: issues.length });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/p23/github/:owner/:repo/issues/analyze", async (req, res) => {
    try {
        const analysis = await gha.analyzeIssues(req.params.owner, req.params.repo, req.body || {});
        res.json({ success: true, analysis });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/p23/github/:owner/:repo/issues", async (req, res) => {
    try {
        const issue = await gha.createIssue(req.params.owner, req.params.repo, req.body || {});
        res.json({ success: true, issue });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/p23/github/:owner/:repo/pulls", async (req, res) => {
    try {
        const pr = await gha.createPR(req.params.owner, req.params.repo, req.body || {});
        res.json({ success: true, pr });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/p23/github/:owner/:repo/pulls/:number/review", async (req, res) => {
    const { postComment } = req.body || {};
    try {
        const review = await gha.reviewPR(req.params.owner, req.params.repo, parseInt(req.params.number), { postComment });
        res.json({ success: true, review });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get("/p23/github/:owner/:repo", async (req, res) => {
    try {
        const info = await gha.readRepo(req.params.owner, req.params.repo);
        res.json({ success: true, repo: info });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── 23B Code Review Engine ────────────────────────────────────────────────

router.get("/p23/review/stats", (req, res) => {
    res.json({ success: true, stats: cre.getStats() });
});

router.get("/p23/review", (req, res) => {
    const { language, grade, limit, offset } = req.query;
    res.json({ success: true, ...cre.listReviews({ language, grade, limit: parseInt(limit)||50, offset: parseInt(offset)||0 }) });
});

router.post("/p23/review/code", async (req, res) => {
    const { code, language, aiReview } = req.body || {};
    if (!code) return res.status(400).json({ error: "code required" });
    try {
        const result = await cre.reviewCode(code, { language, aiReview });
        res.json({ success: true, review: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p23/review/file", async (req, res) => {
    const { filePath, language, aiReview } = req.body || {};
    if (!filePath) return res.status(400).json({ error: "filePath required" });
    try {
        const result = await cre.reviewFile(filePath, { language, aiReview });
        res.json({ success: true, review: result });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/p23/review/diff", async (req, res) => {
    const { diff, language, aiReview } = req.body || {};
    if (!diff) return res.status(400).json({ error: "diff required" });
    try {
        const result = await cre.reviewDiff(diff, { language, aiReview });
        res.json({ success: true, review: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p23/review/:reviewId/summary", (req, res) => {
    try {
        res.json({ success: true, ...cre.getSummary(req.params.reviewId) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p23/review/:reviewId", (req, res) => {
    const r = cre.getReview(req.params.reviewId);
    if (!r) return res.status(404).json({ error: "Review not found" });
    res.json({ success: true, review: r });
});

// ── 23C Release Engine ────────────────────────────────────────────────────

router.get("/p23/release/version", (req, res) => {
    res.json({ success: true, version: re.getCurrentVersion() });
});

router.post("/p23/release/version/bump", (req, res) => {
    const { strategy, bumpedBy, notes } = req.body || {};
    try {
        const v = re.bumpVersion(strategy || "patch", { bumpedBy, notes });
        res.json({ success: true, version: v });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get("/p23/release/build/validate", (req, res) => {
    res.json({ success: true, ...re.validateBuild() });
});

router.post("/p23/release/checklist", (req, res) => {
    const { version, hasNotes } = req.body || {};
    const ver = version || re.getCurrentVersion().version;
    res.json({ success: true, ...re.runChecklist(ver, { hasNotes }) });
});

router.post("/p23/release/notes", async (req, res) => {
    const { version, owner, repo, since, notes } = req.body || {};
    const ver = version || re.getCurrentVersion().version;
    try {
        const n = await re.generateReleaseNotes(ver, { owner, repo, since, notes });
        res.json({ success: true, notes: n });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p23/release/readiness", async (req, res) => {
    try {
        const r = await re.checkDeploymentReadiness();
        res.json({ success: true, readiness: r });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p23/release", async (req, res) => {
    try {
        const r = await re.createRelease(req.body || {});
        res.json({ success: true, release: r });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p23/release", (req, res) => {
    const { status, limit, offset } = req.query;
    res.json({ success: true, ...re.listReleases({ status, limit: parseInt(limit)||50, offset: parseInt(offset)||0 }) });
});

router.get("/p23/release/:releaseId", (req, res) => {
    const r = re.getRelease(req.params.releaseId);
    if (!r) return res.status(404).json({ error: "Release not found" });
    res.json({ success: true, release: r });
});

// ── 23D Engineering Autopilot ─────────────────────────────────────────────

router.post("/p23/autopilot/missions", async (req, res) => {
    const { goal, params, source } = req.body || {};
    if (!goal) return res.status(400).json({ error: "goal required" });
    try {
        const r = await ap.runMission(goal, { params, source });
        res.json({ success: true, ...r });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p23/autopilot/stats", (req, res) => {
    res.json({ success: true, stats: ap.getStats() });
});

router.get("/p23/autopilot/missions/:missionId/chain", (req, res) => {
    try {
        res.json({ success: true, ...ap.getExecutionChain(req.params.missionId) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.delete("/p23/autopilot/missions/:missionId", (req, res) => {
    try {
        res.json({ success: true, mission: ap.cancelMission(req.params.missionId) });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get("/p23/autopilot/missions/:missionId", (req, res) => {
    const m = ap.getMission(req.params.missionId);
    if (!m) return res.status(404).json({ error: "Mission not found" });
    res.json({ success: true, mission: m });
});

router.get("/p23/autopilot/missions", (req, res) => {
    const { status, domain, limit, offset } = req.query;
    res.json({ success: true, ...ap.listMissions({ status, domain, limit: parseInt(limit)||50, offset: parseInt(offset)||0 }) });
});

module.exports = router;
