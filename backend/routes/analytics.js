"use strict";
/**
 * K6 — Enterprise Analytics routes
 *
 * GET /analytics/executive     — KPIs, health score, error rate, AI providers
 * GET /analytics/workspace     — workspace security, governance, team health
 * GET /analytics/productivity  — request throughput, task execution, learning stats
 * GET /analytics/automation    — automation ROI, rule stats, outcome breakdown
 * GET /analytics/security      — security score, audit events, devices, tokens
 * GET /analytics/governance    — compliance score, policies, risk matrix
 * GET /analytics/ai            — AI provider utilization and call counts
 * GET /analytics/ai-cost       — real usage-ledger cost/token/latency summary (C.9 fix)
 * GET /analytics/runtime       — process memory, task queue, graphs, agents, missions
 * GET /analytics/missions      — mission success trends + recent missions
 * GET /analytics/reports       — rolled-up enterprise report (all of the above)
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachWorkspace, requireWorkspaceMember } = require("../middleware/workspaceMiddleware.cjs");
const svc = require("../services/analyticsService.cjs");

router.use("/analytics", requireAuth);
router.use("/analytics", attachWorkspace);

function _wsId(req) {
  return req.query.workspaceId || req.body?.workspaceId || req.workspace?.id || "default";
}

// Customer-Reachable API / Data-Access Boundary Audit (2026-08-21): the 7
// routes below read _wsId(req) — client-suppliable via ?workspaceId= or
// body.workspaceId — with no verification the caller actually belongs to
// that workspace. attachWorkspace only resolves req.workspace/req.workspaceRole
// from it; it never blocks. Live-reproduced structurally: an authenticated
// customer with zero membership in a foreign workspace received HTTP 200
// (not 403/404) from GET /analytics/security?workspaceId=<foreign id>,
// which forwards straight into getSecurityOverview() — a real per-workspace
// audit log, device list and active-session/token count, i.e. genuinely
// sensitive per-tenant security data, not aggregate platform stats. Fixed
// by composing requireWorkspaceMember (the same gate workspace.js's own
// membership routes already use) so a workspaceId the caller doesn't
// belong to is rejected before the handler ever runs, exactly like
// requireOrgMember already does for business.js's org-scoped routes.
router.get("/analytics/executive",   requireWorkspaceMember, (req, res) => { try { res.json(svc.getExecutive(_wsId(req)));          } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/workspace",   requireWorkspaceMember, (req, res) => { try { res.json(svc.getWorkspaceHealth(_wsId(req)));    } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/productivity",requireWorkspaceMember, (req, res) => { try { res.json(svc.getProductivity(_wsId(req)));       } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/automation",  requireWorkspaceMember, (req, res) => { try { res.json(svc.getAutomationROI(_wsId(req)));      } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/security",    requireWorkspaceMember, (req, res) => { try { res.json(svc.getSecurityOverview(_wsId(req)));   } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/governance",  requireWorkspaceMember, (req, res) => { try { res.json(svc.getGovernanceOverview(_wsId(req))); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/ai",          (req, res) => { try { res.json(svc.getAIUtilization());                } catch (e) { res.status(500).json({ error: e.message }); } });
// C.9 AI Experience audit: AICostCenter.jsx rendered a fully hardcoded
// PROVIDERS seed (fabricated requests/tokens/cost/rpm per model) as if it
// were live spend data — the only real values merged in were `status` and
// `activeProvider`. usageMetering.summary()/aggregateCost() already compute
// real totals (totalRequests, totalTokens, totalCostUsd, byProvider) from the
// actual usage ledger written by every /ai/chat, /ai/chat-with-tools, and
// /coding/* call — there was simply no route exposing it. Wiring the
// existing function, not building a new one.
router.get("/analytics/ai-cost",     (req, res) => {
  try {
    const usageMetering = require("../services/usageMetering.cjs");
    res.json({ ok: true, ...usageMetering.summary({}) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
router.get("/analytics/runtime",     requireWorkspaceMember, (req, res) => { try { res.json(svc.getRuntimeCapacity(_wsId(req)));    } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/missions",    (req, res) => { try { res.json(svc.getMissionTrends());                } catch (e) { res.status(500).json({ error: e.message }); } });
// getEnterpriseReport bundles getSecurityOverview/getGovernanceOverview —
// the same workspace-membership gate as those two routes above applies here.
router.get("/analytics/reports",     requireWorkspaceMember, (req, res) => { try { res.json(svc.getEnterpriseReport(_wsId(req)));   } catch (e) { res.status(500).json({ error: e.message }); } });

module.exports = router;
