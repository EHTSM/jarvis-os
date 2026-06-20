"use strict";
/**
 * Growth Operating System — G3
 * Distribution Engine
 * All routes under /distrib/*
 *
 * 10 modules: Universal Publisher, Campaign Orchestrator, Influencer Outreach,
 *             Community Hub, Referral Campaign Manager, Launch Manager,
 *             Distribution Analytics, Content Performance AI,
 *             Executive Growth Center, Commercial Benchmark
 */

const router          = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const g               = require("../services/distributionEngine.cjs");

router.use(requireAuth);

function _ok(res, data)           { res.json({ ok: true, ...data }); }
function _err(res, e, code = 500) { res.status(code).json({ error: e.message || e }); }

// ══════════════════════════════════════════════════════════════════
// MODULE 1: Universal Publisher
// ══════════════════════════════════════════════════════════════════

router.get("/distrib/platforms",                  (req, res) => {
  try { _ok(res, { platforms: g.PUBLISH_PLATFORMS, statuses: g.PUBLISH_STATUSES }); }
  catch (e) { _err(res, e); }
});

router.get("/distrib/publish/jobs",               (req, res) => {
  try { _ok(res, { jobs: g.listPublishJobs(req.query.status, req.query.platform) }); }
  catch (e) { _err(res, e); }
});

router.post("/distrib/publish/jobs",              (req, res) => {
  try { _ok(res, { job: g.createPublishJob(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.get("/distrib/publish/jobs/:id",           (req, res) => {
  try {
    const j = g.getPublishJob(req.params.id);
    if (!j) return res.status(404).json({ error: "Job not found" });
    _ok(res, { job: j });
  } catch (e) { _err(res, e); }
});

router.post("/distrib/publish/jobs/:id/publish",  (req, res) => {
  try { _ok(res, { job: g.publishJob(req.params.id) }); }
  catch (e) { _err(res, e); }
});

router.post("/distrib/publish/jobs/:id/approve",  (req, res) => {
  try {
    const { approvedBy } = req.body || {};
    _ok(res, { job: g.approvePublishJob(req.params.id, approvedBy || req.user?.email || "operator") });
  } catch (e) { _err(res, e); }
});

router.post("/distrib/publish/jobs/:id/retry",    (req, res) => {
  try {
    const { platform } = req.body || {};
    if (!platform) return res.status(400).json({ error: "platform required" });
    _ok(res, { job: g.retryPlatform(req.params.id, platform) });
  } catch (e) { _err(res, e); }
});

router.get("/distrib/publish/stats",              (req, res) => {
  try { _ok(res, { stats: g.getPublishStats() }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 2: Campaign Orchestrator
// ══════════════════════════════════════════════════════════════════

router.get("/distrib/campaigns",                  (req, res) => {
  try { _ok(res, { campaigns: g.listCampaigns(req.query.status) }); }
  catch (e) { _err(res, e); }
});

router.post("/distrib/campaigns",                 (req, res) => {
  try { _ok(res, { campaign: g.createCampaign(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.patch("/distrib/campaigns/:id",            (req, res) => {
  try { _ok(res, { campaign: g.updateCampaign(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/distrib/campaigns/:id/approve",     (req, res) => {
  try {
    const { note } = req.body || {};
    _ok(res, { campaign: g.approveCampaign(req.params.id, note) });
  } catch (e) { _err(res, e); }
});

router.post("/distrib/campaigns/:id/launch",      (req, res) => {
  try { _ok(res, { campaign: g.launchCampaign(req.params.id) }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 3: Influencer Outreach
// ══════════════════════════════════════════════════════════════════

router.get("/distrib/influencers",                (req, res) => {
  try {
    const { tier, platform, status } = req.query;
    _ok(res, { influencers: g.listInfluencers(tier, platform, status), intelligence: g.getInfluencerIntelligence(), tiers: g.INFLUENCER_TIERS });
  } catch (e) { _err(res, e); }
});

router.post("/distrib/influencers",               (req, res) => {
  try { _ok(res, { influencer: g.addInfluencer(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.patch("/distrib/influencers/:id",          (req, res) => {
  try { _ok(res, { influencer: g.updateInfluencer(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/distrib/influencers/:id/draft",     (req, res) => {
  try { _ok(res, { draft: g.buildOutreachDraft(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/distrib/influencers/:id/outreach",  (req, res) => {
  try { _ok(res, { influencer: g.logOutreach(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.get("/distrib/influencers/intelligence",   (req, res) => {
  try { _ok(res, { intelligence: g.getInfluencerIntelligence() }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 4: Community Hub
// ══════════════════════════════════════════════════════════════════

router.get("/distrib/communities",                (req, res) => {
  try { _ok(res, { communities: g.listCommunities(req.query.platform), stats: g.getCommunityStats(), platforms: g.COMMUNITY_PLATFORMS }); }
  catch (e) { _err(res, e); }
});

router.post("/distrib/communities",               (req, res) => {
  try { _ok(res, { community: g.addCommunity(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.patch("/distrib/communities/:id",          (req, res) => {
  try { _ok(res, { community: g.updateCommunity(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/distrib/communities/:id/calendar",  (req, res) => {
  try { _ok(res, { entry: g.addCommunityCalendarEntry(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/distrib/communities/:id/workflow",  (req, res) => {
  try { _ok(res, { workflow: g.addCommunityWorkflow(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 5: Referral Campaign Manager
// ══════════════════════════════════════════════════════════════════

router.get("/distrib/referral-campaigns",         (req, res) => {
  try { _ok(res, { campaigns: g.listReferralCampaigns(), fraudSignals: g.FRAUD_SIGNALS }); }
  catch (e) { _err(res, e); }
});

router.post("/distrib/referral-campaigns",        (req, res) => {
  try { _ok(res, { campaign: g.createReferralCampaign(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/distrib/referral-campaigns/:id/invite", (req, res) => {
  try { _ok(res, g.addReferralInvite(req.params.id, req.body || {})); }
  catch (e) { _err(res, e); }
});

router.post("/distrib/referral-campaigns/:id/convert/:inviteId", (req, res) => {
  try { _ok(res, g.convertReferralInvite(req.params.id, req.params.inviteId)); }
  catch (e) { _err(res, e); }
});

router.get("/distrib/referral-campaigns/:id/leaderboard", (req, res) => {
  try { _ok(res, { leaderboard: g.getReferralLeaderboard(req.params.id) }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 6: Launch Manager
// ══════════════════════════════════════════════════════════════════

router.get("/distrib/launches",                   (req, res) => {
  try { _ok(res, { launches: g.listLaunches(req.query.status), channels: g.LAUNCH_CHANNELS }); }
  catch (e) { _err(res, e); }
});

router.post("/distrib/launches",                  (req, res) => {
  try { _ok(res, { launch: g.createLaunch(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.get("/distrib/launches/:id",               (req, res) => {
  try {
    const l = g.getLaunch(req.params.id);
    if (!l) return res.status(404).json({ error: "Launch not found" });
    _ok(res, { launch: l });
  } catch (e) { _err(res, e); }
});

router.patch("/distrib/launches/:id/channel",     (req, res) => {
  try {
    const { channel, ...patch } = req.body || {};
    if (!channel) return res.status(400).json({ error: "channel required" });
    _ok(res, { launch: g.updateLaunchChannel(req.params.id, channel, patch) });
  } catch (e) { _err(res, e); }
});

router.patch("/distrib/launches/:id/checklist",   (req, res) => {
  try {
    const { itemId, done } = req.body || {};
    if (!itemId) return res.status(400).json({ error: "itemId required" });
    _ok(res, { launch: g.updateLaunchChecklist(req.params.id, itemId, done !== false) });
  } catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 7: Distribution Analytics
// ══════════════════════════════════════════════════════════════════

router.get("/distrib/analytics",                  (req, res) => {
  try { _ok(res, { analytics: g.getDistributionAnalytics() }); }
  catch (e) { _err(res, e); }
});

router.get("/distrib/analytics/campaigns/:id",    (req, res) => {
  try { _ok(res, g.getCampaignAnalytics(req.params.id)); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 8: Content Performance AI
// ══════════════════════════════════════════════════════════════════

router.post("/distrib/performance/snapshot/:jobId", (req, res) => {
  try { _ok(res, { snapshot: g.snapshotPerformance(req.params.jobId) }); }
  catch (e) { _err(res, e); }
});

router.get("/distrib/performance/top",            (req, res) => {
  try { _ok(res, { top: g.getTopPerformers(Number(req.query.limit) || 5) }); }
  catch (e) { _err(res, e); }
});

router.get("/distrib/performance/recommendations",(req, res) => {
  try { _ok(res, { recommendations: g.getRepublishRecommendations() }); }
  catch (e) { _err(res, e); }
});

router.get("/distrib/performance/optimization",   (req, res) => {
  try { _ok(res, { optimization: g.getPublishingOptimization() }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 9: Executive Growth Center
// ══════════════════════════════════════════════════════════════════

router.get("/distrib/executive",                  (req, res) => {
  try { _ok(res, { dashboard: g.getExecutiveDashboard() }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 10: Commercial Benchmark
// ══════════════════════════════════════════════════════════════════

router.get("/distrib/benchmark",                  (req, res) => {
  try { _ok(res, g.runBenchmark()); }
  catch (e) { _err(res, e); }
});

module.exports = router;
