"use strict";
/**
 * Phase 21 routes — OAuth, Observability, Live Mode, Production Readiness
 *
 * 21A  OAuthIntegrationLayer
 *      GET    /oauth/:provider/url                  get auth URL + state
 *      GET    /oauth/:provider/callback             handle redirect callback
 *      POST   /oauth/:provider/refresh              refresh token
 *      DELETE /oauth/:provider/revoke               revoke token
 *      GET    /oauth/connections                    list all connections
 *      GET    /oauth/status                         provider config status
 *
 * 21B  ObservabilityEngine
 *      POST   /p21/obs/metrics                      record custom metric
 *      GET    /p21/obs/metrics/:name                query metric values + stats
 *      GET    /p21/obs/metrics                      list all registered metrics
 *      POST   /p21/obs/alerts                       register alert rule
 *      POST   /p21/obs/alerts/evaluate              evaluate all rules now
 *      GET    /p21/obs/alerts                       active alerts + rules
 *      POST   /p21/obs/log                          write structured log entry
 *      GET    /p21/obs/logs                         query structured logs
 *      GET    /p21/obs/health                       synthetic health probes
 *      GET    /p21/obs/snapshot                     full telemetry snapshot
 *
 * 21C  AutonomousCompanyLiveMode
 *      POST   /p21/live/start                       start live mode
 *      POST   /p21/live/stop                        stop live mode
 *      POST   /p21/live/tick                        manual single tick
 *      GET    /p21/live/state                       current state
 *      GET    /p21/live/sessions                    session history
 *
 * 21D  ProductionReadinessEngine
 *      POST   /p21/readiness/check                  run full readiness check
 *      GET    /p21/readiness/report                 last persisted report
 *      GET    /p21/readiness/history                check history
 *      GET    /p21/readiness/deployment             deployment checks only
 *      GET    /p21/readiness/config                 config checks only
 *      GET    /p21/readiness/security               security checks only
 *      GET    /p21/readiness/dependencies           dependency checks only
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const oauth  = require("../services/oauthIntegrationLayer.cjs");
const obs    = require("../services/observabilityEngine.cjs");
const live   = require("../services/autonomousCompanyLiveMode.cjs");
const ready  = require("../services/productionReadinessEngine.cjs");

// ── 21A OAuth Integration Layer ────────────────────────────────────────────
// Auth URL and callback are intentionally open (unauthenticated) because
// the OAuth provider redirects the browser before Jarvis auth cookies exist.
// State nonce + CSRF protection is handled inside oauthIntegrationLayer.

router.get("/oauth/status", requireAuth, (req, res) => {
    res.json({ success: true, providers: oauth.getProviderStatus() });
});

router.get("/oauth/connections", requireAuth, (req, res) => {
    const { userId } = req.query;
    res.json({ success: true, connections: oauth.listConnections(userId) });
});

router.get("/oauth/:provider/url", requireAuth, (req, res) => {
    const { scopes } = req.query;
    const userId = req.user?.sub || req.user?.id || "default";
    try {
        const scopeList = scopes ? scopes.split(",").map(s => s.trim()) : undefined;
        res.json({ success: true, ...oauth.getAuthUrl(req.params.provider, userId, scopeList) });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// Callback: browser lands here after provider auth — returns JSON for API clients
// or redirects for browser flows
router.get("/oauth/:provider/callback", async (req, res) => {
    const { code, state, error: oauthError } = req.query;
    if (oauthError) return res.status(400).json({ error: `OAuth denied: ${oauthError}` });
    if (!code || !state) return res.status(400).json({ error: "code and state required" });
    try {
        const result = await oauth.handleCallback(req.params.provider, code, state);
        // For browser flows: redirect to settings page; for API: return JSON
        const accept = req.headers.accept || "";
        if (accept.includes("text/html")) {
            return res.redirect(`/?oauth=${req.params.provider}&status=connected`);
        }
        res.json({ success: true, ...result });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/oauth/:provider/refresh", requireAuth, async (req, res) => {
    const userId = req.body?.userId || req.user?.sub || "default";
    try {
        const token = await oauth.refreshToken(req.params.provider, userId);
        res.json({ success: true, provider: req.params.provider, refreshed: true, expiresAt: token.expires_at ? new Date(token.expires_at).toISOString() : null });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete("/oauth/:provider/revoke", requireAuth, async (req, res) => {
    const userId = req.body?.userId || req.query.userId || req.user?.sub || "default";
    try {
        res.json({ success: true, ...await oauth.revokeToken(req.params.provider, userId) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

// ── 21B Observability Engine ──────────────────────────────────────────────

router.post("/p21/obs/metrics", requireAuth, (req, res) => {
    const { name, value, tags } = req.body || {};
    if (!name || value === undefined) return res.status(400).json({ error: "name and value required" });
    obs.recordMetric(name, value, tags || {});
    res.json({ success: true, recorded: { name, value } });
});

router.get("/p21/obs/metrics/:name", requireAuth, (req, res) => {
    const { since, limit } = req.query;
    res.json({ success: true, metric: req.params.name, ...obs.getMetric(req.params.name, { since, limit: parseInt(limit)||200 }) });
});

router.get("/p21/obs/metrics", requireAuth, (req, res) => {
    res.json({ success: true, metrics: obs.listMetrics() });
});

router.post("/p21/obs/alerts", requireAuth, (req, res) => {
    try {
        res.json({ success: true, ...obs.registerAlert(req.body || {}) });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/p21/obs/alerts/evaluate", requireAuth, (req, res) => {
    res.json({ success: true, ...obs.evaluateAlerts() });
});

router.get("/p21/obs/alerts", requireAuth, (req, res) => {
    res.json({ success: true, ...obs.getAlerts({ includeInactive: req.query.all === "1" }) });
});

router.post("/p21/obs/log", requireAuth, (req, res) => {
    const { level, msg, ...ctx } = req.body || {};
    if (!msg) return res.status(400).json({ error: "msg required" });
    obs.structuredLog(level || "info", msg, ctx);
    res.json({ success: true, logged: true });
});

router.get("/p21/obs/logs", requireAuth, (req, res) => {
    const { limit, level, service, since } = req.query;
    res.json({ success: true, ...obs.queryLogs({ limit: parseInt(limit)||200, level, service, since }) });
});

router.get("/p21/obs/health", requireAuth, async (req, res) => {
    try {
        const result = await obs.probeHealth();
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p21/obs/snapshot", requireAuth, async (req, res) => {
    try {
        const snap = await obs.getSnapshot();
        res.json({ success: true, snapshot: snap });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 21C Autonomous Company Live Mode ──────────────────────────────────────

router.post("/p21/live/start", requireAuth, (req, res) => {
    try {
        const result = live.start(req.body || {});
        obs.structuredLog("info", "Live mode started via API", { sessionId: result.sessionId });
        res.json({ success: true, ...result });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/p21/live/stop", requireAuth, (req, res) => {
    try {
        const result = live.stop();
        obs.structuredLog("info", "Live mode stopped via API", { sessionId: result.sessionId });
        res.json({ success: true, ...result });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/p21/live/tick", requireAuth, async (req, res) => {
    try {
        const results = await live.tick();
        res.json({ success: true, results });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p21/live/state", requireAuth, (req, res) => {
    res.json({ success: true, state: live.getState() });
});

router.get("/p21/live/sessions", requireAuth, (req, res) => {
    res.json({ success: true, ...live.getSessionHistory() });
});

// ── 21D Production Readiness Engine ───────────────────────────────────────

router.post("/p21/readiness/check", requireAuth, (req, res) => {
    try {
        const report = ready.runCheck();
        obs.recordMetric("readiness.score", report.score);
        obs.structuredLog("info", `Readiness check: ${report.score}/100 (${report.grade})`, { score: report.score, blockers: report.blockers.length });
        res.json({ success: true, report });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p21/readiness/report", requireAuth, (req, res) => {
    const report = ready.getLastReport();
    if (!report) return res.status(404).json({ error: "No report yet — run POST /p21/readiness/check" });
    res.json({ success: true, report });
});

router.get("/p21/readiness/history", requireAuth, (req, res) => {
    res.json({ success: true, ...ready.getCheckHistory({ limit: parseInt(req.query.limit)||20 }) });
});

router.get("/p21/readiness/deployment", requireAuth, (req, res) => {
    res.json({ success: true, ...ready.validateDeployment() });
});

router.get("/p21/readiness/config", requireAuth, (req, res) => {
    res.json({ success: true, ...ready.validateConfig() });
});

router.get("/p21/readiness/security", requireAuth, (req, res) => {
    res.json({ success: true, ...ready.validateSecurity() });
});

router.get("/p21/readiness/dependencies", requireAuth, (req, res) => {
    res.json({ success: true, ...ready.validateDependencies() });
});

module.exports = router;
