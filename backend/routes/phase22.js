"use strict";
/**
 * Phase 22 routes — Secret Mgmt, Security Hardening,
 *                   Deployment Validation, Operations Alerting
 *
 * 22A  SecretManagementLayer
 *      POST   /p22/secrets/audit              full environment secret audit
 *      GET    /p22/secrets/validate           validate all secrets
 *      GET    /p22/secrets/validate/:key      validate single secret
 *      GET    /p22/secrets/missing            detect missing secrets
 *      POST   /p22/secrets/:key/rotated       mark a secret as rotated
 *      GET    /p22/secrets/rotation           rotation status for all timed secrets
 *      GET    /p22/secrets/rotation/:key      rotation status for one secret
 *      GET    /p22/secrets/audit/history      audit run history
 *
 * 22B  SecurityHardeningLayer
 *      POST   /p22/security/check             run full hardening check
 *      GET    /p22/security/report            last report
 *      GET    /p22/security/history           check history
 *      GET    /p22/security/jwt               JWT checks only
 *      GET    /p22/security/cookies           Cookie checks only
 *      GET    /p22/security/csp               CSP checks only
 *      GET    /p22/security/rate-limiting     Rate limit checks only
 *      GET    /p22/security/auth              Auth protection checks only
 *      GET    /p22/security/headers           Security header checks only
 *
 * 22C  DeploymentValidator
 *      POST   /p22/deploy/check               run full deployment check
 *      GET    /p22/deploy/report              last report
 *      GET    /p22/deploy/history             check history
 *      GET    /p22/deploy/environment         environment checks only
 *      GET    /p22/deploy/build               build artifact checks only
 *      GET    /p22/deploy/process             process management checks only
 *      GET    /p22/deploy/nginx               nginx checks only
 *      GET    /p22/deploy/ssl                 SSL checks only
 *      GET    /p22/deploy/domain              domain checks only
 *
 * 22D  OperationsAlertingLayer
 *      POST   /p22/alerts/fire                fire a manual alert
 *      POST   /p22/alerts/probe               run system monitor probe
 *      POST   /p22/alerts/:alertId/resolve    resolve an alert
 *      POST   /p22/alerts/:alertId/suppress   suppress alert for duration
 *      POST   /p22/alerts/:alertId/escalate   escalate to critical
 *      GET    /p22/alerts/:alertId            get alert
 *      GET    /p22/alerts                     list active alerts
 *      GET    /p22/alerts/history             alert history
 *      GET    /p22/alerts/channels            notification channel status
 *      PUT    /p22/alerts/channels/:channel   configure notification channel
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const sml = require("../services/secretManagementLayer.cjs");
const shl = require("../services/securityHardeningLayer.cjs");
const dv  = require("../services/deploymentValidator.cjs");
const oal = require("../services/operationsAlertingLayer.cjs");

router.use("/p22", requireAuth);

// ── 22A Secret Management Layer ────────────────────────────────────────────

router.post("/p22/secrets/audit", (req, res) => {
    try {
        const report = sml.audit();
        res.json({ success: true, report });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p22/secrets/validate", (req, res) => {
    res.json({ success: true, secrets: sml.validate() });
});

router.get("/p22/secrets/validate/:key", (req, res) => {
    try {
        res.json({ success: true, secret: sml.validate(req.params.key) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p22/secrets/missing", (req, res) => {
    res.json({ success: true, ...sml.detectMissing() });
});

router.post("/p22/secrets/:key/rotated", (req, res) => {
    try {
        res.json({ success: true, rotation: sml.markRotated(req.params.key, req.body || {}) });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get("/p22/secrets/rotation/:key", (req, res) => {
    try {
        const status = sml.getRotationStatus(req.params.key);
        res.json({ success: true, rotation: status });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p22/secrets/rotation", (req, res) => {
    res.json({ success: true, rotation: sml.getRotationStatus() });
});

router.get("/p22/secrets/audit/history", (req, res) => {
    res.json({ success: true, ...sml.getAuditHistory({ limit: parseInt(req.query.limit)||50 }) });
});

// ── 22B Security Hardening Layer ───────────────────────────────────────────

router.post("/p22/security/check", (req, res) => {
    try {
        const report = shl.runCheck();
        res.json({ success: true, report });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p22/security/report", (req, res) => {
    const r = shl.getLastReport();
    if (!r) return res.status(404).json({ error: "No report — run POST /p22/security/check" });
    res.json({ success: true, report: r });
});

router.get("/p22/security/history", (req, res) => {
    res.json({ success: true, ...shl.getCheckHistory({ limit: parseInt(req.query.limit)||50 }) });
});

router.get("/p22/security/jwt",           (req, res) => res.json({ success: true, ...shl.checkJWT() }));
router.get("/p22/security/cookies",       (req, res) => res.json({ success: true, ...shl.checkCookies() }));
router.get("/p22/security/csp",           (req, res) => res.json({ success: true, ...shl.checkCSP() }));
router.get("/p22/security/rate-limiting", (req, res) => res.json({ success: true, ...shl.checkRateLimiting() }));
router.get("/p22/security/auth",          (req, res) => res.json({ success: true, ...shl.checkAuthProtection() }));
router.get("/p22/security/headers",       (req, res) => res.json({ success: true, ...shl.checkSecurityHeaders() }));

// ── 22C Deployment Validator ───────────────────────────────────────────────

router.post("/p22/deploy/check", async (req, res) => {
    try {
        const report = await dv.runCheck();
        res.json({ success: true, report });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p22/deploy/report", (req, res) => {
    const r = dv.getLastReport();
    if (!r) return res.status(404).json({ error: "No report — run POST /p22/deploy/check" });
    res.json({ success: true, report: r });
});

router.get("/p22/deploy/history", (req, res) => {
    res.json({ success: true, ...dv.getHistory({ limit: parseInt(req.query.limit)||20 }) });
});

router.get("/p22/deploy/environment", (req, res) => res.json({ success: true, ...dv.checkEnvironment() }));
router.get("/p22/deploy/build",       (req, res) => res.json({ success: true, ...dv.checkBuildArtifacts() }));
router.get("/p22/deploy/process",     (req, res) => res.json({ success: true, ...dv.checkProcessManagement() }));
router.get("/p22/deploy/nginx",       (req, res) => res.json({ success: true, ...dv.checkNginx() }));
router.get("/p22/deploy/ssl",   async (req, res) => { try { res.json({ success: true, ...await dv.checkSSL() });    } catch (e) { res.status(500).json({ error: e.message }); } });
router.get("/p22/deploy/domain",async (req, res) => { try { res.json({ success: true, ...await dv.checkDomain() }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ── 22D Operations Alerting Layer ─────────────────────────────────────────

router.post("/p22/alerts/fire", (req, res) => {
    const { title, detail, severity, source, category, dedupeKey } = req.body || {};
    if (!title) return res.status(400).json({ error: "title required" });
    try {
        res.json({ success: true, alert: oal.fire({ title, detail, severity, source: source || "api", category, dedupeKey }) });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/p22/alerts/probe", async (req, res) => {
    try {
        const result = await oal.probe();
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p22/alerts/:alertId/resolve", (req, res) => {
    try {
        res.json({ success: true, alert: oal.resolve(req.params.alertId) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.post("/p22/alerts/:alertId/suppress", (req, res) => {
    const durationMs = parseInt(req.body?.durationMs) || 3600_000;
    try {
        res.json({ success: true, alert: oal.suppress(req.params.alertId, durationMs) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.post("/p22/alerts/:alertId/escalate", (req, res) => {
    try {
        res.json({ success: true, alert: oal.escalate(req.params.alertId) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p22/alerts/history", (req, res) => {
    const { limit, severity } = req.query;
    res.json({ success: true, ...oal.getHistory({ limit: parseInt(limit)||100, severity }) });
});

router.get("/p22/alerts/channels", (req, res) => {
    res.json({ success: true, channels: oal.getNotificationStatus() });
});

router.put("/p22/alerts/channels/:channel", (req, res) => {
    try {
        oal.setNotificationChannel(req.params.channel, req.body || {});
        res.json({ success: true, channel: req.params.channel, updated: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get("/p22/alerts/:alertId", (req, res) => {
    const a = oal.getAlert(req.params.alertId);
    if (!a) return res.status(404).json({ error: "Alert not found" });
    res.json({ success: true, alert: a });
});

router.get("/p22/alerts", (req, res) => {
    const { status, severity, category, limit, offset } = req.query;
    res.json({ success: true, ...oal.listAlerts({ status, severity, category, limit: parseInt(limit)||100, offset: parseInt(offset)||0 }) });
});

module.exports = router;
