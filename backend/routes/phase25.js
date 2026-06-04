"use strict";
/**
 * Phase 25 routes — Deployment Autopilot, Secret Rotation, Enterprise Observability, Large Context Search
 *
 * 25A  DeploymentAutopilot
 *      POST   /p25/deploy/canary              start canary deployment
 *      POST   /p25/deploy/canary/:id/promote  promote canary traffic %
 *      POST   /p25/deploy/canary/:id/rollback rollback canary
 *      POST   /p25/deploy/bluegreen           start blue/green
 *      POST   /p25/deploy/bluegreen/:id/switch switch blue/green traffic
 *      POST   /p25/deploy/bluegreen/:id/rollback rollback
 *      POST   /p25/deploy/pipeline            multi-env pipeline deploy
 *      POST   /p25/deploy/validate            release validation
 *      POST   /p25/deploy/:id/rollback        rollback any deploy
 *      GET    /p25/deploy/:id                 get deployment
 *      GET    /p25/deploy                     list deployments
 *      GET    /p25/deploy/history             deploy history
 *
 * 25B  SecretRotationAutomation
 *      POST   /p25/secrets/schedules          set schedule
 *      DELETE /p25/secrets/schedules/:name    remove schedule
 *      GET    /p25/secrets/schedules/:name    get schedule
 *      GET    /p25/secrets/schedules          list schedules
 *      POST   /p25/secrets/:name/rotated      record rotation
 *      GET    /p25/secrets/:name/history      rotation history
 *      GET    /p25/secrets/reminders          check reminders
 *      POST   /p25/secrets/validate           validate secret value
 *      GET    /p25/secrets/health             aggregate health score
 *      POST   /p25/secrets/bootstrap          bootstrap default schedules
 *
 * 25C  EnterpriseObservability
 *      POST   /p25/obs/metrics                record metric
 *      GET    /p25/obs/metrics                get metrics (all or ?service=)
 *      GET    /p25/obs/metrics/system         system + process metrics
 *      POST   /p25/obs/traces/span/start      start span
 *      POST   /p25/obs/traces/span/:spanId/end   end span
 *      POST   /p25/obs/traces/span/:spanId/event add span event
 *      GET    /p25/obs/traces/:traceId        get trace
 *      GET    /p25/obs/traces                 list traces (?service=)
 *      GET    /p25/obs/servicemap             service dependency map
 *      POST   /p25/obs/alerts/rules           set alert rule
 *      GET    /p25/obs/alerts/rules           list rules
 *      POST   /p25/obs/alerts/fire            fire manual alert
 *      POST   /p25/obs/alerts/:alertId/resolve resolve alert
 *      GET    /p25/obs/alerts                 list alerts
 *      PUT    /p25/obs/channels/:channelId    configure channel
 *      GET    /p25/obs/channels               list channels
 *      POST   /p25/obs/slos                   create SLO
 *      POST   /p25/obs/slos/:sloId/event      record SLO event
 *      GET    /p25/obs/slos/:sloId            get SLO status
 *      GET    /p25/obs/slos                   list all SLOs
 *
 * 25D  LargeContextCodeSearch
 *      POST   /p25/search                     full code search
 *      GET    /p25/search/related             related files for a file path
 *      GET    /p25/search/context             extract context around line
 *      GET    /p25/search/stats               repo stats
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const da  = require("../services/deploymentAutopilot.cjs");
const sra = require("../services/secretRotationAutomation.cjs");
const eo  = require("../services/enterpriseObservability.cjs");
const lcs = require("../services/largeContextCodeSearch.cjs");

router.use(requireAuth);

// ── 25A Deployment Autopilot ──────────────────────────────────────────────────

router.post("/p25/deploy/canary", async (req, res) => {
    try { res.json({ success: true, deployment: await da.startCanary(req.body) }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p25/deploy/canary/:id/promote", async (req, res) => {
    try { res.json({ success: true, deployment: await da.promoteCanary(req.params.id, req.body.trafficPct) }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p25/deploy/canary/:id/rollback", (req, res) => {
    try { res.json({ success: true, ...da.rollback(req.params.id, req.body.reason || "canary-rollback") }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p25/deploy/bluegreen", async (req, res) => {
    try { res.json({ success: true, deployment: await da.startBlueGreen(req.body) }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p25/deploy/bluegreen/:id/switch", async (req, res) => {
    try { res.json({ success: true, deployment: await da.switchBlueGreen(req.params.id) }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p25/deploy/bluegreen/:id/rollback", (req, res) => {
    try { res.json({ success: true, ...da.rollback(req.params.id, req.body.reason || "bg-rollback") }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p25/deploy/pipeline", async (req, res) => {
    try { res.json({ success: true, pipeline: await da.deployPipeline(req.body) }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p25/deploy/validate", async (req, res) => {
    try { res.json({ success: true, ...(await da.validateRelease(req.body)) }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p25/deploy/:id/rollback", (req, res) => {
    try { res.json({ success: true, ...da.rollback(req.params.id, req.body.reason) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p25/deploy/history", (req, res) => {
    try { res.json({ success: true, history: da.getHistory(parseInt(req.query.limit) || 50) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p25/deploy/:id", (req, res) => {
    try { res.json({ success: true, deployment: da.getDeployment(req.params.id) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p25/deploy", (req, res) => {
    try { res.json({ success: true, deployments: da.listDeployments(req.query.type) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 25B Secret Rotation Automation ───────────────────────────────────────────

router.post("/p25/secrets/schedules", (req, res) => {
    try {
        const { secretName, ...opts } = req.body;
        if (!secretName) return res.status(400).json({ success: false, error: "secretName required" });
        res.json({ success: true, schedule: sra.setSchedule(secretName, opts) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete("/p25/secrets/schedules/:name", (req, res) => {
    try { res.json({ success: true, ...sra.removeSchedule(req.params.name) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p25/secrets/schedules/:name", (req, res) => {
    try { res.json({ success: true, schedule: sra.getSchedule(req.params.name) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p25/secrets/schedules", (_req, res) => {
    try { res.json({ success: true, schedules: sra.listSchedules() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p25/secrets/:name/rotated", (req, res) => {
    try { res.json({ success: true, record: sra.recordRotation(req.params.name, req.body) }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.get("/p25/secrets/:name/history", (req, res) => {
    try { res.json({ success: true, history: sra.getRotationHistory(req.params.name, parseInt(req.query.limit) || 20) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p25/secrets/reminders", (_req, res) => {
    try { res.json({ success: true, ...sra.checkReminders() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p25/secrets/validate", (req, res) => {
    try {
        const { secretName, secretValue } = req.body;
        if (!secretName || !secretValue) return res.status(400).json({ success: false, error: "secretName and secretValue required" });
        res.json({ success: true, ...sra.validateSecret(secretName, secretValue) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.get("/p25/secrets/health", (_req, res) => {
    try { res.json({ success: true, ...sra.scoreHealth() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p25/secrets/bootstrap", (_req, res) => {
    try { res.json({ success: true, ...sra.bootstrapSchedules() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 25C Enterprise Observability ─────────────────────────────────────────────

router.post("/p25/obs/metrics", (req, res) => {
    try {
        const { service, name, value, type, labels } = req.body;
        if (!service || !name || value === undefined) return res.status(400).json({ success: false, error: "service, name, value required" });
        res.json({ success: true, metric: eo.recordMetric(service, name, value, type, labels) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.get("/p25/obs/metrics", (req, res) => {
    try { res.json({ success: true, metrics: eo.getMetrics(req.query.service) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p25/obs/metrics/system", (_req, res) => {
    try { res.json({ success: true, ...eo.getSystemMetrics() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p25/obs/traces/span/start", (req, res) => {
    try {
        const { traceId, service, operation, parentSpanId, meta } = req.body;
        if (!traceId || !service || !operation) return res.status(400).json({ success: false, error: "traceId, service, operation required" });
        res.json({ success: true, span: eo.startSpan(traceId, service, operation, parentSpanId, meta) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p25/obs/traces/span/:spanId/end", (req, res) => {
    try { res.json({ success: true, span: eo.endSpan(req.params.spanId, req.body.status, req.body.error) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.post("/p25/obs/traces/span/:spanId/event", (req, res) => {
    try { res.json({ success: true, span: eo.addSpanEvent(req.params.spanId, req.body.name, req.body.attrs) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p25/obs/traces/:traceId", (req, res) => {
    try { res.json({ success: true, trace: eo.getTrace(req.params.traceId) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p25/obs/traces", (req, res) => {
    try { res.json({ success: true, traces: eo.listTraces(req.query.service, parseInt(req.query.limit) || 20) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p25/obs/servicemap", (_req, res) => {
    try { res.json({ success: true, ...eo.getServiceMap() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p25/obs/alerts/rules", (req, res) => {
    try {
        const { ruleId, ...opts } = req.body;
        if (!ruleId) return res.status(400).json({ success: false, error: "ruleId required" });
        res.json({ success: true, rule: eo.setAlertRule(ruleId, opts) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.get("/p25/obs/alerts/rules", (_req, res) => {
    try { res.json({ success: true, rules: eo.listAlertRules() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p25/obs/alerts/fire", (req, res) => {
    try { eo.fireManualAlert(req.body); res.json({ success: true }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p25/obs/alerts/:alertId/resolve", (req, res) => {
    try { res.json({ success: true, alert: eo.resolveAlert(req.params.alertId) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p25/obs/alerts", (req, res) => {
    try {
        const { service, severity, unresolved, limit } = req.query;
        res.json({ success: true, alerts: eo.listAlerts({ service, severity, unresolved: unresolved === "true", limit: parseInt(limit) || 100 }) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.put("/p25/obs/channels/:channelId", (req, res) => {
    try { res.json({ success: true, channel: eo.setChannel(req.params.channelId, req.body) }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.get("/p25/obs/channels", (_req, res) => {
    try { res.json({ success: true, channels: eo.listChannels() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p25/obs/slos", (req, res) => {
    try {
        const { sloId, ...opts } = req.body;
        if (!sloId || !opts.service) return res.status(400).json({ success: false, error: "sloId and service required" });
        res.json({ success: true, slo: eo.setSLO(sloId, opts) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p25/obs/slos/:sloId/event", (req, res) => {
    try { res.json({ success: true, ...eo.recordSLOEvent(req.params.sloId, req.body.good) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p25/obs/slos/:sloId", (req, res) => {
    try { res.json({ success: true, ...eo.getSLOStatus(req.params.sloId) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p25/obs/slos", (_req, res) => {
    try { res.json({ success: true, slos: eo.listSLOs() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 25D Large Context Code Search ────────────────────────────────────────────

router.post("/p25/search", (req, res) => {
    try {
        const { query, repoPath, ...opts } = req.body;
        if (!query) return res.status(400).json({ success: false, error: "query required" });
        res.json({ success: true, ...lcs.search(query, repoPath, opts) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p25/search/related", (req, res) => {
    try {
        const { file, repoPath, limit } = req.query;
        if (!file) return res.status(400).json({ success: false, error: "file required" });
        res.json({ success: true, ...lcs.findRelated(file, repoPath, { limit: parseInt(limit) || 10 }) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p25/search/context", (req, res) => {
    try {
        const { file, line, window: win } = req.query;
        if (!file || !line) return res.status(400).json({ success: false, error: "file and line required" });
        const ctx = lcs.extractContext(file, parseInt(line), parseInt(win) || 5);
        if (!ctx) return res.status(404).json({ success: false, error: "File not found" });
        res.json({ success: true, ...ctx });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p25/search/stats", (req, res) => {
    try { res.json({ success: true, ...lcs.repoStats(req.query.repoPath) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
