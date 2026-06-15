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
 * GET /analytics/runtime       — process memory, task queue, graphs, agents, missions
 * GET /analytics/missions      — mission success trends + recent missions
 * GET /analytics/reports       — rolled-up enterprise report (all of the above)
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachWorkspace } = require("../middleware/workspaceMiddleware.cjs");
const svc = require("../services/analyticsService.cjs");

router.use(requireAuth);
router.use(attachWorkspace);

function _wsId(req) {
  return req.query.workspaceId || req.body?.workspaceId || req.workspace?.id || "default";
}

router.get("/analytics/executive",   (req, res) => { try { res.json(svc.getExecutive(_wsId(req)));          } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/workspace",   (req, res) => { try { res.json(svc.getWorkspaceHealth(_wsId(req)));    } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/productivity",(req, res) => { try { res.json(svc.getProductivity(_wsId(req)));       } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/automation",  (req, res) => { try { res.json(svc.getAutomationROI(_wsId(req)));      } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/security",    (req, res) => { try { res.json(svc.getSecurityOverview(_wsId(req)));   } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/governance",  (req, res) => { try { res.json(svc.getGovernanceOverview(_wsId(req))); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/ai",          (req, res) => { try { res.json(svc.getAIUtilization());                } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/runtime",     (req, res) => { try { res.json(svc.getRuntimeCapacity(_wsId(req)));    } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/missions",    (req, res) => { try { res.json(svc.getMissionTrends());                } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/analytics/reports",     (req, res) => { try { res.json(svc.getEnterpriseReport(_wsId(req)));   } catch (e) { res.status(500).json({ error: e.message }); } });

module.exports = router;
