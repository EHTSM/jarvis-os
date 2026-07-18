"use strict";
/**
 * Enterprise & Physical Integration Mission — Module 7: Enterprise Monitoring
 * Prefix: /enterprise/monitoring/:orgId/*
 *
 * All routes require org membership (requireOrgMember — same bar as
 * viewing your own org's data elsewhere in this codebase); alert
 * acknowledgement actions (resolve/suppress/escalate) require
 * view_audit_log-level trust (org_owner/org_admin), reusing the
 * permission tier Module 3 already established for "can see sensitive
 * operational history," since alerts are exactly that.
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachOrg, requireOrgMember } = require("../middleware/orgMiddleware.cjs");

const _try = fn => { try { return fn(); } catch { return null; } };
const _mon = () => _try(() => require("../services/enterpriseMonitoring.cjs"));
const _org = () => _try(() => require("../services/organizationService.cjs"));
const _alerting = () => _try(() => require("../services/operationsAlertingLayer.cjs"));

router.use("/enterprise/monitoring", requireAuth, attachOrg, requireOrgMember);

router.get("/enterprise/monitoring/:orgId/health", (req, res) => {
  res.json(_mon().getOrgHealth(req.params.orgId, req.user.sub));
});

router.get("/enterprise/monitoring/:orgId/connectors", (req, res) => {
  res.json(_mon().getConnectorHealth(req.params.orgId));
});

router.get("/enterprise/monitoring/:orgId/ai-usage", (req, res) => {
  res.json(_mon().getAiUsageHealth(req.params.orgId));
});

router.get("/enterprise/monitoring/:orgId/background-jobs", (req, res) => {
  res.json(_mon().getBackgroundJobsHealth());
});

router.get("/enterprise/monitoring/:orgId/queue", (req, res) => {
  res.json(_mon().getQueueHealth());
});

router.get("/enterprise/monitoring/:orgId/alerts", (req, res) => {
  const { status, severity, category, limit, offset } = req.query;
  res.json(_mon().getOrgAlerts(req.params.orgId, { status, severity, category, limit: limit ? +limit : undefined, offset: offset ? +offset : undefined }));
});

// Evaluates real thresholds now and fires/resolves real alerts — on-demand
// (called by the dashboard on load / a manual refresh), not a hidden new
// background timer.
router.post("/enterprise/monitoring/:orgId/alerts/evaluate", (req, res) => {
  res.json(_mon().evaluateOrgAlerts(req.params.orgId));
});

// Every action below double-checks the alert actually belongs to
// req.params.orgId (via getAlert) before mutating it — alertId alone is a
// global lookup in operationsAlertingLayer.cjs, so without this check an
// org member could resolve/suppress/escalate a DIFFERENT org's alert
// simply by knowing its id.
function _requireAlertInOrg(req, res) {
  if (!_org()?.hasPermission?.(req.params.orgId, req.user.sub, "view_audit_log")) {
    res.status(403).json({ ok: false, error: "Forbidden — requires permission: view_audit_log" });
    return null;
  }
  const alert = _alerting()?.getAlert?.(req.params.alertId);
  if (!alert || alert.orgId !== req.params.orgId) {
    res.status(404).json({ ok: false, error: "Alert not found in this organization" });
    return null;
  }
  return alert;
}

router.post("/enterprise/monitoring/:orgId/alerts/:alertId/resolve", (req, res) => {
  if (!_requireAlertInOrg(req, res)) return;
  try { res.json({ ok: true, alert: _alerting().resolve(req.params.alertId) }); }
  catch (e) { res.status(404).json({ ok: false, error: e.message }); }
});

router.post("/enterprise/monitoring/:orgId/alerts/:alertId/suppress", (req, res) => {
  if (!_requireAlertInOrg(req, res)) return;
  try { res.json({ ok: true, alert: _alerting().suppress(req.params.alertId, req.body?.durationMs) }); }
  catch (e) { res.status(404).json({ ok: false, error: e.message }); }
});

router.post("/enterprise/monitoring/:orgId/alerts/:alertId/escalate", (req, res) => {
  if (!_requireAlertInOrg(req, res)) return;
  try { res.json({ ok: true, alert: _alerting().escalate(req.params.alertId) }); }
  catch (e) { res.status(404).json({ ok: false, error: e.message }); }
});

module.exports = router;
