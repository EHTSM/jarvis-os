"use strict";
/**
 * Launch Platform Routes — all 10 modules.
 *
 * MODULE 1  – Launch Dashboard         /launch/dashboard
 * MODULE 2  – Interactive Onboarding   /launch/onboarding/*
 * MODULE 3  – Sample Workspaces        /launch/workspaces/*
 * MODULE 4  – Documentation Center     /launch/docs/*
 * MODULE 5  – Academy                  /launch/academy/*
 * MODULE 6  – Referral System          /launch/referral/*
 * MODULE 7  – Customer Success         /launch/cst/*
 * MODULE 8  – Feedback Hub             /launch/feedback/*
 * MODULE 9  – Launch Readiness         /launch/readiness
 * MODULE 10 – Commercial Benchmark     /launch/benchmark
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const metrics    = require("../services/launchMetrics.cjs");
const onboarding = require("../services/onboardingEngine.cjs");
const academy    = require("../services/academyEngine.cjs");
const referral   = require("../services/referralEngine.cjs");
const cst        = require("../services/customerSuccess.cjs");
const feedback   = require("../services/feedbackHub.cjs");
const readiness  = require("../services/launchReadiness.cjs");
const simulator  = require("../services/commercialSimulator.cjs");
const creditEngine = require("../services/creditEngine.cjs");

router.use(requireAuth);

function _account(req) { return req.user?.accountId || req.user?.id || "unknown"; }
function _plan(req)    { return req.user?.plan || "trial"; }

// ══════════════════════════════════════════════════════════════════
// MODULE 1: Launch Dashboard
// ══════════════════════════════════════════════════════════════════

router.get("/launch/dashboard", (req, res) => {
  try {
    const snap = metrics.getSnapshot();
    res.json({ ok: true, snapshot: snap });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/dashboard/history", (req, res) => {
  try {
    const history = metrics.getHistory(parseInt(req.query.limit || "10"));
    res.json({ ok: true, history });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/launch/dashboard/nps", (req, res) => {
  try {
    const { score, comment } = req.body || {};
    if (score === undefined || score < 0 || score > 10) return res.status(400).json({ error: "score 0-10 required" });
    metrics.submitNPS({ score, comment, accountId: _account(req) });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/dashboard/nps", (req, res) => {
  try { res.json({ ok: true, nps: metrics.getNPS() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 2: Interactive Onboarding
// ══════════════════════════════════════════════════════════════════

router.get("/launch/onboarding/roles", (req, res) => {
  try { res.json({ ok: true, roles: onboarding.getRoles() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/onboarding/state", (req, res) => {
  try {
    const state = onboarding.getState(_account(req));
    res.json({ ok: true, state, progress: state ? onboarding.getProgress(_account(req)) : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/launch/onboarding/start", (req, res) => {
  try {
    const { role } = req.body || {};
    if (!role) return res.status(400).json({ error: "role required" });
    const result = onboarding.startOnboarding(_account(req), role);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/launch/onboarding/step/:stepId", (req, res) => {
  try {
    const state = onboarding.completeStep(_account(req), req.params.stepId);
    res.json({ ok: true, state, progress: onboarding.getProgress(_account(req)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/onboarding/progress", (req, res) => {
  try { res.json({ ok: true, progress: onboarding.getProgress(_account(req)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/onboarding/all", (req, res) => {
  try { res.json({ ok: true, all: onboarding.getAllProgress() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 3: Sample Workspaces
// ══════════════════════════════════════════════════════════════════

router.get("/launch/workspaces", (req, res) => {
  try { res.json({ ok: true, workspaces: onboarding.getSampleWorkspaces() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/workspaces/:id", (req, res) => {
  try {
    const ws = onboarding.getSampleWorkspaces().find(w => w.id === req.params.id);
    if (!ws) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, workspace: ws });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Provision a sample workspace for the user (marks onboarding step as done)
router.post("/launch/workspaces/:id/provision", (req, res) => {
  try {
    const ws     = onboarding.getSampleWorkspaces().find(w => w.id === req.params.id);
    if (!ws) return res.status(404).json({ error: "workspace_not_found" });
    // Mark workspace step done in onboarding
    onboarding.completeStep(_account(req), "workspace");
    res.json({ ok: true, workspace: ws, message: `${ws.name} workspace provisioned. Open your Code Workspace to begin.` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 4: Documentation Center
// ══════════════════════════════════════════════════════════════════

const DOC_CATALOGUE = [
  { id: "quickstart",     title: "Quick Start",              category: "getting_started", tags: ["beginner","setup"] },
  { id: "api_reference",  title: "API Reference",            category: "api",             tags: ["api","developer"] },
  { id: "ai_routing",     title: "AI Routing & Credits",     category: "ai",              tags: ["credits","routing"] },
  { id: "missions",       title: "Missions & Pipelines",     category: "platform",        tags: ["missions","autonomous"] },
  { id: "browser_auto",   title: "Browser Automation",       category: "automation",      tags: ["browser","playwright"] },
  { id: "creative_studio","title": "Creative Studio Guide",  category: "creative",        tags: ["images","video","brand"] },
  { id: "billing",        title: "Billing & Plans",          category: "billing",         tags: ["payment","plans"] },
  { id: "keyboard",       title: "Keyboard Shortcuts",       category: "productivity",    tags: ["shortcuts","keyboard"] },
  { id: "brand_studio",   title: "Brand Studio",             category: "creative",        tags: ["brand","logos"] },
  { id: "enterprise",     title: "Enterprise Setup",         category: "enterprise",      tags: ["sso","rbac","org"] },
];

const SHORTCUTS = [
  { key: "⌘K",       action: "Command Palette"         },
  { key: "⌘⇧P",     action: "AI Chat Panel"            },
  { key: "⌘⇧M",     action: "Mission Engine"           },
  { key: "⌘⇧G",     action: "Visual Git"               },
  { key: "⌘⇧A",     action: "Automation Dashboard"     },
  { key: "⌘⇧C",     action: "Creative Studio"          },
  { key: "⌘\\",     action: "Toggle AI Sidebar"        },
  { key: "⌘J",       action: "Jump to File"            },
  { key: "⌘⇧F",     action: "Global Search"            },
  { key: "⌘⇧B",     action: "Build Frontend"           },
  { key: "⌘`",       action: "Terminal"                },
  { key: "⌘⇧D",     action: "Deploy"                   },
];

router.get("/launch/docs", (req, res) => {
  try {
    const { search, category } = req.query;
    let list = [...DOC_CATALOGUE];
    if (category) list = list.filter(d => d.category === category);
    if (search)   list = list.filter(d =>
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      d.tags.some(t => t.includes(search.toLowerCase()))
    );
    res.json({ ok: true, docs: list, total: DOC_CATALOGUE.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/docs/shortcuts", (req, res) => {
  try { res.json({ ok: true, shortcuts: SHORTCUTS }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/docs/:id", (req, res) => {
  try {
    const doc = DOC_CATALOGUE.find(d => d.id === req.params.id);
    if (!doc) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, doc: { ...doc, content: `Documentation for ${doc.title} — full content served from static docs.` } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 5: Academy
// ══════════════════════════════════════════════════════════════════

router.get("/launch/academy/paths", (req, res) => {
  try { res.json({ ok: true, paths: academy.listPaths(), badges: academy.listBadges() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/academy/progress", (req, res) => {
  try { res.json({ ok: true, progress: academy.getProgress(_account(req)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/launch/academy/enroll/:pathId", (req, res) => {
  try {
    const result = academy.enrollPath(_account(req), req.params.pathId);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/launch/academy/:pathId/module/:moduleId", (req, res) => {
  try {
    const result = academy.completeModule(_account(req), req.params.pathId, req.params.moduleId);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/academy/leaderboard", (req, res) => {
  try { res.json({ ok: true, leaderboard: academy.getLeaderboard() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 6: Referral System
// ══════════════════════════════════════════════════════════════════

router.get("/launch/referral", (req, res) => {
  try { res.json({ ok: true, dashboard: referral.getDashboard(_account(req)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/launch/referral/use", (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "code required" });
    const result = referral.useCode(code, _account(req));
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/launch/referral/redeem", (req, res) => {
  try {
    const result = referral.redeemCredits(_account(req));
    if (!result.ok) return res.status(400).json({ error: "No pending credits" });
    res.json({ ok: true, credits: result.credits });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/referral/leaderboard", (req, res) => {
  try { res.json({ ok: true, leaderboard: referral.getLeaderboard() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 7: Customer Success Center
// ══════════════════════════════════════════════════════════════════

router.get("/launch/cst/health", (req, res) => {
  try { res.json({ ok: true, health: cst.getHealth(_account(req)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/launch/cst/signals", (req, res) => {
  try {
    const signals = cst.updateSignals(_account(req), req.body || {});
    res.json({ ok: true, signals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/cst/risks", (req, res) => {
  try { res.json({ ok: true, alerts: cst.getRiskAlerts() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/cst/overview", (req, res) => {
  try { res.json({ ok: true, overview: cst.getOverview() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 8: Feedback Hub
// ══════════════════════════════════════════════════════════════════

router.get("/launch/feedback", (req, res) => {
  try {
    const { type, status, limit } = req.query;
    const items = feedback.list({ type, status, limit: parseInt(limit || "50") });
    res.json({ ok: true, items, stats: feedback.getStats() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/launch/feedback", (req, res) => {
  try {
    const { type, title, body, screenshot, sessionRef, tags } = req.body || {};
    if (!title) return res.status(400).json({ error: "title required" });
    if (type && !feedback.TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${feedback.TYPES.join(",")}` });
    const item = feedback.submit({ type: type || "feature", title, body, screenshot, sessionRef, tags, accountId: _account(req) });
    res.json({ ok: true, item });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/launch/feedback/:id/vote", (req, res) => {
  try {
    const item = feedback.vote(req.params.id, _account(req));
    if (!item) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, item });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/launch/feedback/:id/status", (req, res) => {
  try {
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ error: "status required" });
    const item = feedback.updateStatus(req.params.id, status);
    if (!item) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, item });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/feedback/roadmap", (req, res) => {
  try { res.json({ ok: true, roadmap: feedback.getRoadmap() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/feedback/:id", (req, res) => {
  try {
    const item = feedback.getItem(req.params.id);
    if (!item) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, item });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 9: Launch Readiness Center
// ══════════════════════════════════════════════════════════════════

router.get("/launch/readiness", (req, res) => {
  try {
    const report = readiness.runChecks();
    res.json({ ok: true, report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/launch/readiness/last", (req, res) => {
  try {
    const report = readiness.getLastReport();
    res.json({ ok: true, report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 10: Commercial Benchmark
// ══════════════════════════════════════════════════════════════════

router.get("/launch/benchmark", (req, res) => {
  try {
    const result = simulator.runFullBenchmark();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/launch/benchmark/simulate", (req, res) => {
  try {
    const { users } = req.body || {};
    const count = parseInt(users) || 1000;
    if (count < 1 || count > 10000000) return res.status(400).json({ error: "users must be 1–10,000,000" });
    const result = simulator.simulate(count);
    res.json({ ok: true, simulation: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 11: Product Completion Report (PCP-1)
// ══════════════════════════════════════════════════════════════════

const pcpReport = require("../services/pcpReport.cjs");

router.get("/launch/pcp-report", requireAuth, (req, res) => {
  try {
    const report = pcpReport.generateReport();
    res.json({ ok: true, report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 12: Production Integration Report (PIP-1)
// ══════════════════════════════════════════════════════════════════

const pipReport = require("../services/pipReport.cjs");

router.get("/launch/pip-report", requireAuth, (req, res) => {
  try {
    const report = pipReport.generateReport();
    res.json({ ok: true, report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 13: GitHub & Company Presence Report (OP-2)
// ══════════════════════════════════════════════════════════════════

const op2Report = require("../services/op2Report.cjs");

router.get("/launch/op2-report", requireAuth, (req, res) => {
  try {
    const report = op2Report.generateReport();
    res.json({ ok: true, report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
