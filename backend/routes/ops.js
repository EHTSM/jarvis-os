"use strict";
const router       = require("express").Router();
const crm          = require("../services/crmService");
const automation   = require("../services/automationService");
const controller   = require("../controllers/jarvisController");
const errTracker   = require("../utils/errorTracker");
const memTracker   = require("../utils/memoryTracker");
const logger       = require("../utils/logger");
const { requireAuth, operatorOnly } = require("../middleware/authMiddleware");
const operatorAudit   = require("../middleware/operatorAudit");
const rateLimiter      = require("../middleware/rateLimiter");
const { attachOrg, requireOrgMember }   = require("../middleware/orgMiddleware.cjs");

// Open probes — intentionally unauthenticated:
//   /health used by Docker HEALTHCHECK, PM2, nginx, and monitoring tools
//   /test   used by smoke tests and CI
//   /api/status used by external status pages
router.get("/health",     (req, res) => {
    // Security Hardening (Zero-Trust Competitor Remediation, Phase 1):
    // `ai` previously meant only "GROQ_API_KEY is a non-empty string" —
    // reproduced live: booting with an expired/rate-limited Groq key and
    // every other provider unset/unreachable still reported `ai:true`,
    // while the startup log directly above it showed all 14 providers
    // failing. An operator watching this dashboard saw green while the
    // product could not reach a single model.
    //
    // Fix: reuse aiService.getProviderStatus() — a real, already-existing,
    // NON-probing (no network I/O, so /health stays fast) snapshot that
    // combines "key present" with "no recently recorded call failure" for
    // each of the 14 providers. `ai` is now true only if at least one
    // provider is both configured AND has no known-recent failure — still
    // optimistic between real calls (this endpoint intentionally does not
    // make a live network probe on every health check, unlike the slower
    // authenticated /ai/status route, which does), but no longer blind to
    // failures the process has already observed firsthand.
    let aiAvailable = !!process.env.GROQ_API_KEY; // conservative fallback if aiService fails to load
    try {
        const providerStatus = require("../services/aiService.js").getProviderStatus();
        aiAvailable = Object.values(providerStatus).some(p => p.available);
    } catch { /* aiService optional at this layer — fall back to key-presence */ }

    const services = {
        ai:       aiAvailable,
        telegram: !!process.env.TELEGRAM_TOKEN,
        whatsapp: !!(process.env.WA_TOKEN || process.env.WHATSAPP_TOKEN),
        payments: !!((process.env.RAZORPAY_KEY || process.env.RAZORPAY_KEY_ID) && (process.env.RAZORPAY_SECRET || process.env.RAZORPAY_KEY_SECRET)),
    };
    // Count disabled services without leaking env key names to unauthenticated callers
    const disabledCount = Object.values(services).filter(v => !v).length;

    let base = { status: "ok", uptime_seconds: Math.round(process.uptime()), timestamp: new Date().toISOString() };
    try {
        const mc = require("../../agents/metrics/metricsCollector.cjs");
        base = { ...mc.health(), timestamp: new Date().toISOString() };
    } catch { /* metricsCollector optional */ }

    res.json({
        ...base,
        status: disabledCount >= 2 ? "degraded" : "ok",
        services,
        // warnings omit env key names — use /ops (auth-gated) for detailed diagnostics
        warnings: disabledCount > 0 ? [`${disabledCount} optional service(s) not configured`] : [],
    });
});

router.get("/test",       (req, res) => res.json({ status: "OK", timestamp: new Date().toISOString() }));
router.get("/api/status", (req, res) => res.json({ status: "JARVIS running", version: "3.0", port: process.env.PORT || 5050 }));

// Gate: ops-specific routes require a valid operator session (platform-wide
// founder data — CRM lead stats, revenue, system metrics — not scoped to any
// one account, so a regular customer must never reach these; previously only
// requireAuth was applied here, which any signed-up customer satisfies).
// Path-scoped to avoid intercepting SPA/unmatched paths that pass through this router.
// Note: /dashboard/revenue is the only dashboard sub-path here; /dashboard alone would
// prefix-match any React Router client route named /dashboard, so we scope to /dashboard/revenue.
//
// Express Router Mount / Bare requireAuth Interception Audit (2026-08-20):
// this array previously omitted /incidents, /rca-reports, /fix-plans,
// /healing-runs, /learning, /lifecycle, /goals, and /personal — 8 more
// route families registered later in this same file (lines 225-667 at the
// time of this fix), none of which had any auth of their own. Live-
// reproduced: GET /personal/tasks returned real, unauthenticated personal
// task data (titles, details, tags, due dates) with a 200, no cookie
// required — same defect class and same root cause as the /business/* and
// /dev/* findings already documented and fixed a few dozen lines below in
// this exact file (this file's own established pattern for these
// founder/operator-only, non-tenant-scoped engines — incidentEngine.cjs,
// goalEngine.cjs, personalOS.cjs, none of which carry an orgId/accountId
// concept — is requireAuth + operatorOnly, matching /stats and
// /dashboard/revenue above). Extended the existing array rather than
// adding a second gate, since every one of these route families is
// registered later in this same file and needs the identical treatment.
router.use(["/stats", "/dashboard/revenue", "/metrics", "/ops", "/runtime/reboot", "/workflow",
            "/incidents", "/rca-reports", "/fix-plans", "/healing-runs",
            "/learning", "/lifecycle", "/goals", "/personal"], requireAuth, operatorOnly, operatorAudit);

router.get("/stats", (req, res) => {
    const s = crm.getStats();
    res.json({ success: true, uptime: Math.round(process.uptime()), timestamp: new Date().toISOString(), ...s });
});

router.get("/dashboard/revenue", (req, res) => {
    const s = crm.getStats();
    res.json({ success: true, paid_customers: s.paid, revenue: s.revenue, currency: "INR" });
});

router.get("/metrics", (req, res) => {
    try {
        const mc   = require("../../agents/metrics/metricsCollector.cjs");
        const snap = mc.snapshot();
        res.json({ success: true, ...controller.getMetrics(), execution: snap });
    } catch (e) {
        res.json({ success: true, ...controller.getMetrics(), execution_error: "execution_failed" });
    }
});

router.get("/ops", (req, res) => {
    const uptimeSecs = Math.round(process.uptime());
    const debug      = req.query.debug === "1";

    let memReport = null;
    try { memReport = memTracker.getReport(); } catch { /* fallback below */ }
    if (!memReport) {
        const m = process.memoryUsage();
        memReport = {
            current: {
                rss_mb:   Math.round(m.rss      / 1_048_576),
                heap_mb:  Math.round(m.heapUsed  / 1_048_576),
                total_mb: Math.round(m.heapTotal / 1_048_576)
            },
            trend: "stable", warn: false, critical: false
        };
    }

    let queueHealth = null;
    let stuckTasks  = [];
    try {
        const tq    = require("../../agents/taskQueue.cjs");
        queueHealth = tq.getHealthReport();
        const all   = tq.getAll();
        const cutoff = Date.now() - 60 * 60_000;
        stuckTasks = all
            .filter(t => t.status === "pending" && new Date(t.scheduledFor || t.createdAt).getTime() < cutoff)
            .map(t => ({
                id:         t.id,
                input:      t.input.slice(0, 60),
                ageMinutes: Math.round((Date.now() - new Date(t.createdAt).getTime()) / 60_000)
            }));
    } catch { /* queue unavailable */ }

    let failureReport = [];
    let timingReport  = null;
    try {
        const al  = require("../../agents/autonomousLoop.cjs");
        failureReport = al.getFailureReport();
        timingReport  = al.getTimingReport();
    } catch { /* loop unavailable */ }

    let crmStats   = null;
    try { crmStats = crm.getStats(); } catch { /* non-critical */ }

    let reqMetrics = null;
    try { reqMetrics = controller.getMetrics(); } catch { /* non-critical */ }

    let autoStats  = null;
    try { autoStats = automation.getStats(); } catch { /* non-critical */ }

    const warnings   = [];
    const errReport  = errTracker.getReport();
    if (errReport.errors_per_hour > 10) {
        warnings.push({ level: "warn", code: "HIGH_ERROR_RATE", detail: `${errReport.errors_per_hour} errors/hr` });
    }
    if (memReport.critical) {
        warnings.push({ level: "critical", code: "MEMORY_CRITICAL", detail: `heap ${memReport.current.heap_mb}MB ≥ 450MB` });
    } else if (memReport.warn) {
        warnings.push({ level: "warn", code: "MEMORY_HIGH", detail: `heap ${memReport.current.heap_mb}MB ≥ 350MB` });
    }
    if (memReport.trend === "rising") {
        warnings.push({ level: "warn", code: "MEMORY_RISING", detail: "heap growing > 8MB over last 10 min" });
    }
    if (queueHealth) {
        if ((queueHealth.counts?.pending || 0) > 20) {
            warnings.push({ level: "warn", code: "QUEUE_BACKLOG", detail: `${queueHealth.counts.pending} pending tasks` });
        }
        if (queueHealth.oldestPendingMins > 60) {
            warnings.push({ level: "warn", code: "QUEUE_STUCK", detail: `oldest pending task ${queueHealth.oldestPendingMins}m old` });
        }
    }
    if (stuckTasks.length > 0) {
        warnings.push({ level: "warn", code: "STUCK_TASKS", detail: `${stuckTasks.length} task(s) stuck > 1h` });
    }
    if (failureReport.length > 0 && failureReport[0].count >= 3) {
        warnings.push({ level: "warn", code: "REPEATED_FAILURES", detail: `"${failureReport[0].input}..." failed ${failureReport[0].count}x` });
    }

    const payload = {
        status:  warnings.some(w => w.level === "critical") ? "critical"
               : warnings.length > 0 ? "degraded" : "ok",
        ts:      new Date().toISOString(),
        uptime:  { seconds: uptimeSecs, human: `${Math.floor(uptimeSecs / 3600)}h ${Math.floor((uptimeSecs % 3600) / 60)}m` },
        warnings,
        memory:      memReport,
        errors:      errReport,
        queue:       queueHealth,
        stuck_tasks: stuckTasks,
        failures:    failureReport,
        timing:      timingReport,
        automation:  autoStats,
        crm:         crmStats,
        requests:    reqMetrics,
        services: {
            whatsapp: !!(process.env.WA_TOKEN || process.env.WHATSAPP_TOKEN),
            payments: !!((process.env.RAZORPAY_KEY || process.env.RAZORPAY_KEY_ID) && (process.env.RAZORPAY_SECRET || process.env.RAZORPAY_KEY_SECRET)),
            telegram: !!process.env.TELEGRAM_TOKEN,
            groq:     !!process.env.GROQ_API_KEY
        }
    };

    if (debug) {
        try {
            payload.debug = {
                recent_errors: errTracker.recent(50),
                raw_timings:   timingReport?.recent_execs || []
            };
        } catch { /* non-critical */ }
    }

    res.json(payload);
});

// POST /runtime/reboot — safely restart the process (PM2 will bring it back).
// Already gated operatorOnly at mount (line ~75); rate-limited on top of that
// so a misclick or compromised operator session can't trigger a reboot loop.
router.post("/runtime/reboot", requireAuth, rateLimiter(3, 5 * 60_000, "runtime-reboot"), operatorAudit("runtime-reboot"), (req, res) => {
    logger.warn(`[Runtime] Operator ${req.user?.sub} initiated SAFE REBOOT`);
    res.json({ success: true, message: "Reboot initiated. System will be back in ~10s." });
    setTimeout(() => process.exit(0), 1000);
});

// ── Incident Detection Engine ─────────────────────────────────────
const _inc = (() => { try { return require("../../agents/runtime/incidentEngine.cjs"); } catch { return null; } })();

// POST /incidents/detect — trigger a detection run (authenticated)
router.post("/incidents/detect", (req, res) => {
    if (!_inc) return res.status(503).json({ success: false, error: "incidentEngine unavailable" });
    try {
        const { windowMins = 60, blueprintId, productName } = req.body || {};
        const result = _inc.detect({ windowMins, blueprintId, productName });
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /incidents — list incidents with filters
router.get("/incidents", (req, res) => {
    if (!_inc) return res.status(503).json({ success: false, error: "incidentEngine unavailable" });
    try {
        const { status, severity, blueprintId, ruleId, limit } = req.query;
        const incidents = _inc.listIncidents({
            status, severity, blueprintId, ruleId,
            limit: limit ? Math.min(parseInt(limit) || 50, 200) : 50,
        });
        const summary = _inc.getIncidentSummary();
        res.json({ success: true, summary, incidents });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /incidents/summary — counts by severity and status
router.get("/incidents/summary", (req, res) => {
    if (!_inc) return res.status(503).json({ success: false, error: "incidentEngine unavailable" });
    try { res.json({ success: true, ..._inc.getIncidentSummary() }); }
    catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /incidents/:id — single incident
router.get("/incidents/:id", (req, res) => {
    if (!_inc) return res.status(503).json({ success: false, error: "incidentEngine unavailable" });
    try {
        const inc = _inc.getIncident(req.params.id);
        if (!inc) return res.status(404).json({ success: false, error: "incident_not_found" });
        res.json({ success: true, incident: inc });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// POST /incidents/:id/acknowledge
router.post("/incidents/:id/acknowledge", (req, res) => {
    if (!_inc) return res.status(503).json({ success: false, error: "incidentEngine unavailable" });
    try {
        const result = _inc.acknowledge(req.params.id, req.body?.note || "");
        if (!result.ok) return res.status(400).json({ success: false, error: result.error });
        res.json({ success: true, incident: result.incident });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// POST /incidents/:id/resolve
router.post("/incidents/:id/resolve", (req, res) => {
    if (!_inc) return res.status(503).json({ success: false, error: "incidentEngine unavailable" });
    try {
        const result = _inc.resolve(req.params.id, req.body?.note || "");
        if (!result.ok) return res.status(400).json({ success: false, error: result.error });
        res.json({ success: true, incident: result.incident });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// ── Root Cause Analyzer ───────────────────────────────────────────
const _rca = (() => { try { return require("../../agents/runtime/rootCauseAnalyzer.cjs"); } catch { return null; } })();

// POST /incidents/:id/analyze — run RCA for an incident, persist report
router.post("/incidents/:id/analyze", (req, res) => {
    if (!_rca) return res.status(503).json({ success: false, error: "rootCauseAnalyzer unavailable" });
    if (!_inc) return res.status(503).json({ success: false, error: "incidentEngine unavailable" });
    try {
        const incident = _inc.getIncident(req.params.id);
        if (!incident) return res.status(404).json({ success: false, error: "incident_not_found" });
        const windowMins = parseInt(req.query.windowMins) || 60;
        const report = _rca.analyze(req.params.id, { windowMins });
        if (!report) return res.status(404).json({ success: false, error: "incident_not_found" });
        res.json({ success: true, report });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /incidents/:id/rca — retrieve the most recent RCA report for an incident
router.get("/incidents/:id/rca", (req, res) => {
    if (!_rca) return res.status(503).json({ success: false, error: "rootCauseAnalyzer unavailable" });
    try {
        const reports = _rca.listReports({ incidentId: req.params.id, limit: 1 });
        if (!reports.length) return res.status(404).json({ success: false, error: "no_rca_report" });
        res.json({ success: true, report: reports[0] });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /rca-reports — list all RCA reports
router.get("/rca-reports", (req, res) => {
    if (!_rca) return res.status(503).json({ success: false, error: "rootCauseAnalyzer unavailable" });
    try {
        const { incidentId, limit } = req.query;
        const reports = _rca.listReports({
            incidentId,
            limit: limit ? Math.min(parseInt(limit) || 20, 100) : 20,
        });
        res.json({ success: true, total: reports.length, reports });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /rca-reports/:rcaId — single RCA report by ID
router.get("/rca-reports/:rcaId", (req, res) => {
    if (!_rca) return res.status(503).json({ success: false, error: "rootCauseAnalyzer unavailable" });
    try {
        const report = _rca.getReport(req.params.rcaId);
        if (!report) return res.status(404).json({ success: false, error: "rca_not_found" });
        res.json({ success: true, report });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// ── Auto-Fix Planner ──────────────────────────────────────────────
const _afp = (() => { try { return require("../../agents/runtime/autoFixPlanner.cjs"); } catch { return null; } })();

// POST /rca-reports/:rcaId/plan — generate a fix plan from an RCA report
router.post("/rca-reports/:rcaId/plan", (req, res) => {
    if (!_afp) return res.status(503).json({ success: false, error: "autoFixPlanner unavailable" });
    if (!_rca) return res.status(503).json({ success: false, error: "rootCauseAnalyzer unavailable" });
    try {
        const rcaReport = _rca.getReport(req.params.rcaId);
        if (!rcaReport) return res.status(404).json({ success: false, error: "rca_not_found" });
        const registerPatches = req.query.registerPatches === "1";
        const fixPlan = _afp.planInline(rcaReport, { registerPatches });
        res.json({ success: true, plan: fixPlan });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /fix-plans — list fix plans (filter: rcaId, incidentId, status, limit)
router.get("/fix-plans", (req, res) => {
    if (!_afp) return res.status(503).json({ success: false, error: "autoFixPlanner unavailable" });
    try {
        const { rcaId, incidentId, status, limit } = req.query;
        const plans = _afp.listPlans({
            rcaId, incidentId, status,
            limit: limit ? Math.min(parseInt(limit) || 20, 100) : 20,
        });
        res.json({ success: true, total: plans.length, plans });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /fix-plans/:planId — retrieve a single fix plan
router.get("/fix-plans/:planId", (req, res) => {
    if (!_afp) return res.status(503).json({ success: false, error: "autoFixPlanner unavailable" });
    try {
        const p = _afp.getPlan(req.params.planId);
        if (!p) return res.status(404).json({ success: false, error: "plan_not_found" });
        res.json({ success: true, plan: p });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// PATCH /fix-plans/:planId/status — update plan status
router.patch("/fix-plans/:planId/status", (req, res) => {
    if (!_afp) return res.status(503).json({ success: false, error: "autoFixPlanner unavailable" });
    try {
        const result = _afp.updateStatus(req.params.planId, req.body?.status || "");
        if (!result.ok) return res.status(400).json({ success: false, error: result.error });
        res.json({ success: true, plan: result.plan });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// ── Self-Healing Pipeline ─────────────────────────────────────────
const _shp = (() => { try { return require("../../agents/runtime/selfHealingPipeline.cjs"); } catch { return null; } })();

// POST /fix-plans/:planId/execute — execute a fix plan
router.post("/fix-plans/:planId/execute", (req, res) => {
    if (!_shp) return res.status(503).json({ success: false, error: "selfHealingPipeline unavailable" });
    if (!_afp) return res.status(503).json({ success: false, error: "autoFixPlanner unavailable" });
    try {
        const plan = _afp.getPlan(req.params.planId);
        if (!plan) return res.status(404).json({ success: false, error: "plan_not_found" });
        const mode = req.body?.mode || "approval_required";
        const run  = _shp.executePlan(plan, { mode, operatorId: req.body?.operatorId || null });
        if (run.ok === false) return res.status(400).json({ success: false, error: run.error });
        res.json({ success: true, run });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// POST /healing-runs/:runId/approve — approve a halted run
router.post("/healing-runs/:runId/approve", (req, res) => {
    if (!_shp) return res.status(503).json({ success: false, error: "selfHealingPipeline unavailable" });
    try {
        const result = _shp.approveRun(req.params.runId, { operatorId: req.body?.operatorId || null });
        if (!result.ok) return res.status(400).json({ success: false, error: result.error || result.run?.outcome });
        res.json({ success: true, run: result.run });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /healing-runs — list healing runs
router.get("/healing-runs", (req, res) => {
    if (!_shp) return res.status(503).json({ success: false, error: "selfHealingPipeline unavailable" });
    try {
        const { planId, incidentId, outcome, status, limit } = req.query;
        const runs = _shp.listHealingRuns({
            planId, incidentId, outcome, status,
            limit: limit ? Math.min(parseInt(limit) || 20, 100) : 20,
        });
        res.json({ success: true, total: runs.length, runs });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /healing-runs/:runId — single healing run
router.get("/healing-runs/:runId", (req, res) => {
    if (!_shp) return res.status(503).json({ success: false, error: "selfHealingPipeline unavailable" });
    try {
        const run = _shp.getHealingRun(req.params.runId);
        if (!run) return res.status(404).json({ success: false, error: "run_not_found" });
        res.json({ success: true, run });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// ── Learning Memory Engine ────────────────────────────────────────
const _lme = (() => { try { return require("../../agents/runtime/learningMemoryEngine.cjs"); } catch { return null; } })();

// POST /learning/ingest — manually ingest a healing run into memory
router.post("/learning/ingest", (req, res) => {
    if (!_lme) return res.status(503).json({ success: false, error: "learningMemoryEngine unavailable" });
    try {
        const { runId } = req.body || {};
        const result = runId
            ? _lme.ingestFromRun(runId)
            : _lme.ingest(req.body || {});
        if (!result.ok) return res.status(400).json({ success: false, error: result.error });
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /learning/summary — counts, trends, top patterns
router.get("/learning/summary", (req, res) => {
    if (!_lme) return res.status(503).json({ success: false, error: "learningMemoryEngine unavailable" });
    try { res.json({ success: true, ..._lme.getSummary() }); }
    catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /learning/patterns — list patterns (filter: type, causeCategory, ruleId, minCount, limit)
router.get("/learning/patterns", (req, res) => {
    if (!_lme) return res.status(503).json({ success: false, error: "learningMemoryEngine unavailable" });
    try {
        const { type, causeCategory, ruleId, minCount, limit } = req.query;
        const patterns = _lme.getPatterns({
            type, causeCategory, ruleId,
            minCount: minCount ? parseInt(minCount) : 1,
            limit:    limit    ? Math.min(parseInt(limit) || 20, 100) : 20,
        });
        res.json({ success: true, ...patterns });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /learning/recommendations — context-aware recommendations
router.get("/learning/recommendations", (req, res) => {
    if (!_lme) return res.status(503).json({ success: false, error: "learningMemoryEngine unavailable" });
    try {
        const { ruleId, causeCategory, severity } = req.query;
        const recs = _lme.getRecommendations({ ruleId, causeCategory, severity });
        res.json({ success: true, recommendations: recs });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /learning/repeated — check if a pattern is a known repeat
router.get("/learning/repeated", (req, res) => {
    if (!_lme) return res.status(503).json({ success: false, error: "learningMemoryEngine unavailable" });
    try {
        const { ruleId, causeCategory, severity } = req.query;
        const result = _lme.detectRepeated({ ruleId, causeCategory, severity });
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// ── Product Lifecycle Engine ──────────────────────────────────────
const _ple = (() => { try { return require("../../agents/runtime/productLifecycleEngine.cjs"); } catch { return null; } })();

// POST /lifecycle/evaluate — run a lifecycle evaluation tick
router.post("/lifecycle/evaluate", (req, res) => {
    if (!_ple) return res.status(503).json({ success: false, error: "productLifecycleEngine unavailable" });
    try {
        const { blueprintId, productName, windowMins = 60 } = req.body || {};
        const report = _ple.evaluate({ blueprintId, productName, windowMins: parseInt(windowMins) || 60 });
        res.json({ success: true, report });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /lifecycle/reports — list lifecycle reports
router.get("/lifecycle/reports", (req, res) => {
    if (!_ple) return res.status(503).json({ success: false, error: "productLifecycleEngine unavailable" });
    try {
        const { blueprintId, limit } = req.query;
        const reports = _ple.listReports({ blueprintId, limit: limit ? Math.min(parseInt(limit) || 10, 50) : 10 });
        res.json({ success: true, total: reports.length, reports });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /lifecycle/reports/:reportId — single lifecycle report
router.get("/lifecycle/reports/:reportId", (req, res) => {
    if (!_ple) return res.status(503).json({ success: false, error: "productLifecycleEngine unavailable" });
    try {
        const r = _ple.getReport(req.params.reportId);
        if (!r) return res.status(404).json({ success: false, error: "report_not_found" });
        res.json({ success: true, report: r });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /lifecycle/maturity — current maturity score
router.get("/lifecycle/maturity", (req, res) => {
    if (!_ple) return res.status(503).json({ success: false, error: "productLifecycleEngine unavailable" });
    try {
        const m = _ple.getMaturity(req.query.blueprintId);
        if (!m) return res.status(404).json({ success: false, error: "no_lifecycle_report_yet" });
        res.json({ success: true, maturity: m });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /lifecycle/debt — list technical debt items
router.get("/lifecycle/debt", (req, res) => {
    if (!_ple) return res.status(503).json({ success: false, error: "productLifecycleEngine unavailable" });
    try {
        const { blueprintId, status, type, limit } = req.query;
        const items = _ple.getDebtItems({
            blueprintId, status, type,
            limit: limit ? Math.min(parseInt(limit) || 50, 200) : 50,
        });
        res.json({ success: true, total: items.length, items });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// ── Goal Engine ───────────────────────────────────────────────────
const _ge = (() => { try { return require("../../agents/runtime/goalEngine.cjs"); } catch { return null; } })();

// POST /goals — create a new goal
router.post("/goals", (req, res) => {
    if (!_ge) return res.status(503).json({ success: false, error: "goalEngine unavailable" });
    try {
        const { title, description, type, targetDate, blueprintId, tags } = req.body || {};
        if (!title) return res.status(400).json({ success: false, error: "title is required" });
        const goal = _ge.createGoal({ title, description, type, targetDate, blueprintId, tags });
        if (goal.ok === false) return res.status(400).json({ success: false, error: goal.error });
        res.status(201).json({ success: true, goal });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /goals — list goals
router.get("/goals", (req, res) => {
    if (!_ge) return res.status(503).json({ success: false, error: "goalEngine unavailable" });
    try {
        const { type, status, blueprintId, limit } = req.query;
        const goals   = _ge.listGoals({ type, status, blueprintId, limit: limit ? Math.min(parseInt(limit) || 20, 100) : 20 });
        const summary = _ge.getGoalSummary();
        res.json({ success: true, summary, goals });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /goals/summary — goal counts and health
router.get("/goals/summary", (req, res) => {
    if (!_ge) return res.status(503).json({ success: false, error: "goalEngine unavailable" });
    try { res.json({ success: true, ..._ge.getGoalSummary() }); }
    catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /goals/:id — single goal
router.get("/goals/:id", (req, res) => {
    if (!_ge) return res.status(503).json({ success: false, error: "goalEngine unavailable" });
    try {
        const goal = _ge.getGoal(req.params.id);
        if (!goal) return res.status(404).json({ success: false, error: "goal_not_found" });
        res.json({ success: true, goal });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// POST /goals/:id/advance — record a task outcome
router.post("/goals/:id/advance", (req, res) => {
    if (!_ge) return res.status(503).json({ success: false, error: "goalEngine unavailable" });
    try {
        const { taskId, ok, detail, error: err, projectRunId } = req.body || {};
        if (!taskId) return res.status(400).json({ success: false, error: "taskId required" });
        const result = _ge.advanceTask(req.params.id, taskId, { ok, detail, error: err, projectRunId });
        if (!result.ok) return res.status(400).json({ success: false, error: result.error });
        res.json({ success: true, goal: result.goal });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// POST /goals/:id/complete — complete the goal
router.post("/goals/:id/complete", (req, res) => {
    if (!_ge) return res.status(503).json({ success: false, error: "goalEngine unavailable" });
    try {
        const result = _ge.completeGoal(req.params.id, { note: req.body?.note || "" });
        if (!result.ok) return res.status(400).json({ success: false, error: result.error });
        res.json({ success: true, goal: result.goal, report: result.report });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// POST /goals/:id/abandon
router.post("/goals/:id/abandon", (req, res) => {
    if (!_ge) return res.status(503).json({ success: false, error: "goalEngine unavailable" });
    try {
        const result = _ge.abandonGoal(req.params.id, req.body?.reason || "");
        if (!result.ok) return res.status(400).json({ success: false, error: result.error });
        res.json({ success: true, goal: result.goal });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// GET /goals/:id/report — completion report
router.get("/goals/:id/report", (req, res) => {
    if (!_ge) return res.status(503).json({ success: false, error: "goalEngine unavailable" });
    try {
        const report = _ge.getCompletionReport(req.params.id);
        if (!report) return res.status(404).json({ success: false, error: "no_completion_report" });
        res.json({ success: true, report });
    } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); }
});

// ── Personal AI OS ────────────────────────────────────────────────
const _pos = (() => { try { return require("../../agents/runtime/personalOS.cjs"); } catch { return null; } })();

// ── Dashboard & Summaries ─────────────────────────────────────────
router.get("/personal/dashboard",           (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { res.json({ success: true, ..._pos.getDashboard() }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/personal/summary/daily",       (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { res.json({ success: true, ..._pos.getDailySummary(req.query.date) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/personal/summary/weekly",      (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { res.json({ success: true, ..._pos.getWeeklySummary(req.query.weekStart) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/personal/stats",               (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { res.json({ success: true, ..._pos.getStats() }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/personal/search",              (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const { q, limit } = req.query; if (!q) return res.status(400).json({ success: false, error: "q required" }); res.json({ success: true, results: _pos.searchMemory(q, { limit: limit ? parseInt(limit) : 20 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// ── Tasks ─────────────────────────────────────────────────────────
router.post("/personal/tasks",              (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const t = _pos.createTask(req.body || {}); if (t.ok === false) return res.status(400).json({ success: false, error: t.error }); res.status(201).json({ success: true, task: t }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/personal/tasks",               (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const { status, priority, goalId, overdue, limit } = req.query; res.json({ success: true, tasks: _pos.listTasks({ status, priority, goalId, overdue: overdue === "1", limit: limit ? parseInt(limit) : 50 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/personal/tasks/:id",           (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const t = _pos.getTask(req.params.id); if (!t) return res.status(404).json({ success: false, error: "not_found" }); res.json({ success: true, task: t }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.patch("/personal/tasks/:id",         (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const r = _pos.updateTask(req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, task: r.task }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/personal/tasks/:id/complete", (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const r = _pos.completeTask(req.params.id); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, task: r.task }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.delete("/personal/tasks/:id",        (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const r = _pos.deleteTask(req.params.id); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// ── Notes ─────────────────────────────────────────────────────────
router.post("/personal/notes",              (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const n = _pos.createNote(req.body || {}); if (n.ok === false) return res.status(400).json({ success: false, error: n.error }); res.status(201).json({ success: true, note: n }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/personal/notes",               (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const { search, pinned, limit } = req.query; res.json({ success: true, notes: _pos.listNotes({ search, pinned: pinned === "1" ? true : pinned === "0" ? false : undefined, limit: limit ? parseInt(limit) : 20 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/personal/notes/:id",           (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const n = _pos.getNote(req.params.id); if (!n) return res.status(404).json({ success: false, error: "not_found" }); res.json({ success: true, note: n }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.patch("/personal/notes/:id",         (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const r = _pos.updateNote(req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, note: r.note }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.delete("/personal/notes/:id",        (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const r = _pos.deleteNote(req.params.id); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// ── Reminders ─────────────────────────────────────────────────────
router.post("/personal/reminders",                      (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const r = _pos.createReminder(req.body || {}); if (r.ok === false) return res.status(400).json({ success: false, error: r.error }); res.status(201).json({ success: true, reminder: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/personal/reminders",                       (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const { status, upcoming, limit } = req.query; res.json({ success: true, reminders: _pos.listReminders({ status, upcoming: upcoming === "1", limit: limit ? parseInt(limit) : 20 }), due: _pos.getDueReminders() }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/personal/reminders/:id/dismiss",          (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const r = _pos.dismissReminder(req.params.id); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, reminder: r.reminder }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/personal/reminders/:id/snooze",           (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const r = _pos.snoozeReminder(req.params.id, parseInt(req.body?.mins) || 30); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, reminder: r.reminder, snoozedUntil: r.snoozedUntil }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// ── Knowledge Base ────────────────────────────────────────────────
router.post("/personal/knowledge",          (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const r = _pos.addKnowledge(req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.status(201).json({ success: true, entry: r.entry }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/personal/knowledge",           (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const { category, search, limit } = req.query; res.json({ success: true, entries: search ? _pos.searchKnowledge(search, { category, limit: limit ? parseInt(limit) : 20 }) : _pos.listKnowledge({ category, limit: limit ? parseInt(limit) : 50 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/personal/knowledge/:key",      (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const e = _pos.getKnowledge(req.params.key); if (!e) return res.status(404).json({ success: false, error: "not_found" }); res.json({ success: true, entry: e }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.delete("/personal/knowledge/:key",   (req, res) => { if (!_pos) return res.status(503).json({ success: false, error: "personalOS unavailable" }); try { const r = _pos.deleteKnowledge(req.params.key); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// ── Business AI OS ────────────────────────────────────────────────
//
// Phase OS-5.2 security recovery: this file previously defined 34
// /business/* routes backed by agents/runtime/businessOS.cjs. Every one was
// an EXACT METHOD+PATH duplicate of a route in backend/routes/business.js
// (0 unique endpoints), but with 0 requireAuth, 0 _requireOrg and 0
// req.org.id — versus 72 / 43 / 47 in business.js.
//
// The route barrel mounts ops.js at line 38, business.js at 73, and the
// /business auth gate at 181, so these duplicates shadowed the canonical
// implementation AND sat ahead of the auth gate.
//
// Measured live before removal (unauthenticated, no cookie):
//   GET  /business/leads         200 — 4 real leads incl. names + emails
//   GET  /business/contacts      200 — 2 contacts
//   GET  /business/revenue       200 — 8 records totalling $128,800
//   GET  /business/pipeline|stats|opportunities|dashboard  200
//   POST /business/leads         201 — anonymous WRITE accepted
// while routes served only by business.js correctly returned 401.
//
// Removed here so /business/* resolves to the authenticated, org-scoped
// implementation in business.js. No route is lost: all 34 exist there.
// No barrel reorder, no replacement routes, no change to business.js.

// ── Developer AI OS ───────────────────────────────────────────────
const _dos = (() => { try { return require("../../agents/runtime/developerOS.cjs"); } catch { return null; } })();

// C.10 audit (2026-08-14/15): all 36 /dev/* routes below had NO auth gate at
// all — confirmed live with a bare unauthenticated curl request, which
// successfully created a real repo record and read the full global
// repo/project/issue/build/deployment store. Fixed with requireAuth.
//
// MASTER RECOVERY (2026-08-15, C10-003): requireAuth alone left a second,
// real gap — developerOS.cjs had zero orgId concept, so any authenticated
// user of ANY organization still saw every OTHER organization's engineering
// data (live-confirmed: Org B saw Org A's test repo). Fixed at the root:
// developerOS.cjs's entire API now requires and filters by orgId (see that
// file's own MASTER RECOVERY comment). This route layer resolves orgId via
// attachOrg (the same middleware already used by business.js, growthOS.js,
// etc.) and requires it — a caller with no resolvable org gets a real 403,
// not a silent empty result or a fallback to unscoped data.
//
// ECOSYSTEM OS RECOVERY (2026-08-15): the C10-003 fix above was itself
// incomplete — attachOrg resolves req.org from a caller-supplied X-Org-Id
// header with NO membership verification (documented as non-blocking in
// orgMiddleware.cjs's own header; requireOrgMember is the actual
// enforcement). The `!req.org?.id` check only verified SOME real org
// resolved, not that the caller belongs to it. Live-reproduced: account B,
// with X-Org-Id forged to account A's real org, both listed and created
// repos under account A's org — a real cross-tenant read AND write, not
// hypothetical. Fixed by adding requireOrgMember, the same real membership
// gate business.js's CRM routes already use.
router.use("/dev", requireAuth, attachOrg, requireOrgMember);
router.use("/dev", (req, res, next) => {
    if (!req.org?.id) return res.status(403).json({ success: false, error: "no organization context — join or create an organization to use Developer OS" });
    next();
});

// Repos
router.post("/dev/repos",                         (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.createRepo({ ...req.body, orgId: req.org.id }); if (r.ok === false) return res.status(400).json({ success: false, error: r.error }); res.status(201).json({ success: true, repo: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/repos",                          (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const { language, status, search, limit } = req.query; res.json({ success: true, repos: search ? _dos.searchRepos(req.org.id, search, { limit: limit ? parseInt(limit) : 20 }) : _dos.listRepos(req.org.id, { language, status, limit: limit ? parseInt(limit) : 50 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/repos/:id",                      (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.getRepo(req.org.id, req.params.id); if (!r) return res.status(404).json({ success: false, error: "not_found" }); res.json({ success: true, repo: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.patch("/dev/repos/:id",                    (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.updateRepo(req.org.id, req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, repo: r.repo }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/dev/repos/:id/archive",             (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.archiveRepo(req.org.id, req.params.id); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, repo: r.repo }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// Projects
router.post("/dev/projects",                      (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.createProject({ ...req.body, orgId: req.org.id }); if (r.ok === false) return res.status(400).json({ success: false, error: r.error }); res.status(201).json({ success: true, project: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/projects",                       (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const { status, repoId, priority, limit } = req.query; res.json({ success: true, projects: _dos.listProjects(req.org.id, { status, repoId, priority, limit: limit ? parseInt(limit) : 50 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/projects/:id",                   (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.getProject(req.org.id, req.params.id); if (!r) return res.status(404).json({ success: false, error: "not_found" }); res.json({ success: true, project: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.patch("/dev/projects/:id",                 (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.updateProject(req.org.id, req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, project: r.project }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/dev/projects/:id/complete",         (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.completeProject(req.org.id, req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, project: r.project }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/dev/projects/:id/archive",          (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.archiveProject(req.org.id, req.params.id); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, project: r.project }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// Issues
router.post("/dev/issues",                        (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.createIssue({ ...req.body, orgId: req.org.id }); if (r.ok === false) return res.status(400).json({ success: false, error: r.error }); res.status(201).json({ success: true, issue: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/issues",                         (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const { status, type, priority, severity, repoId, projectId, assignee, label, limit } = req.query; res.json({ success: true, issues: _dos.listIssues(req.org.id, { status, type, priority, severity, repoId, projectId, assignee, label, limit: limit ? parseInt(limit) : 50 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/issues/:id",                     (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.getIssue(req.org.id, req.params.id); if (!r) return res.status(404).json({ success: false, error: "not_found" }); res.json({ success: true, issue: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.patch("/dev/issues/:id",                   (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.updateIssue(req.org.id, req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, issue: r.issue }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/dev/issues/:id/assign",             (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.assignIssue(req.org.id, req.params.id, req.body?.assignee || ""); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, issue: r.issue }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/dev/issues/:id/close",              (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.closeIssue(req.org.id, req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, issue: r.issue }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/dev/issues/:id/reopen",             (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.reopenIssue(req.org.id, req.params.id); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, issue: r.issue }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.delete("/dev/issues/:id",                  (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.deleteIssue(req.org.id, req.params.id); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// Builds
router.post("/dev/builds",                        (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.recordBuild({ ...req.body, orgId: req.org.id }); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.status(201).json({ success: true, build: r.build }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/builds",                         (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const { status, repoId, branch, trigger, limit } = req.query; res.json({ success: true, builds: _dos.listBuilds(req.org.id, { status, repoId, branch, trigger, limit: limit ? parseInt(limit) : 50 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/builds/stats",                   (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const { repoId, dateFrom, dateTo } = req.query; res.json({ success: true, ..._dos.getBuildStats(req.org.id, { repoId, dateFrom, dateTo }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/builds/:id",                     (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.getBuild(req.org.id, req.params.id); if (!r) return res.status(404).json({ success: false, error: "not_found" }); res.json({ success: true, build: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.patch("/dev/builds/:id",                   (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.updateBuild(req.org.id, req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, build: r.build }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// Deployments
router.post("/dev/deployments",                   (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.recordDeployment({ ...req.body, orgId: req.org.id }); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.status(201).json({ success: true, deployment: r.deployment }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/deployments",                    (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const { status, repoId, environment, projectId, limit } = req.query; res.json({ success: true, deployments: _dos.listDeployments(req.org.id, { status, repoId, environment, projectId, limit: limit ? parseInt(limit) : 50 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/deployments/stats",              (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const { repoId, dateFrom, dateTo } = req.query; res.json({ success: true, ..._dos.getDeploymentStats(req.org.id, { repoId, dateFrom, dateTo }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/deployments/:id",                (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.getDeployment(req.org.id, req.params.id); if (!r) return res.status(404).json({ success: false, error: "not_found" }); res.json({ success: true, deployment: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.patch("/dev/deployments/:id",              (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.updateDeployment(req.org.id, req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, deployment: r.deployment }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/dev/deployments/:id/rollback",      (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const r = _dos.rollbackDeployment(req.org.id, req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, deployment: r.deployment }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// Summaries & search
router.get("/dev/dashboard",                      (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { res.json({ success: true, ..._dos.getEngineeringDashboard(req.org.id) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/summary/daily",                  (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { res.json({ success: true, ..._dos.getDailySummary(req.org.id, req.query.date) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/summary/weekly",                 (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { res.json({ success: true, ..._dos.getWeeklySummary(req.org.id, req.query.weekStart) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/velocity",                       (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const { days } = req.query; res.json({ success: true, ..._dos.getVelocityMetrics(req.org.id, { days: days ? parseInt(days) : 7 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/search",                         (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { const { q, limit } = req.query; if (!q) return res.status(400).json({ success: false, error: "q required" }); res.json({ success: true, results: _dos.searchEngineering(req.org.id, q, { limit: limit ? parseInt(limit) : 20 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/dev/stats",                          (req, res) => { if (!_dos) return res.status(503).json({ success: false, error: "developerOS unavailable" }); try { res.json({ success: true, ..._dos.getStats(req.org.id) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// ── Enterprise AI OS (legacy engine) ────────────────────────────────
// OS-ENTERPRISE RECONCILIATION (2026-08-15): this engine has no per-request
// tenant scoping at all — createOrg/listOrgs/etc. take an arbitrary orgId in
// the body/query with no verification the caller belongs to it, and
// listOrgs() returns every organization on the platform in one call. Same
// class of platform-wide, not-account-scoped data as /stats /ops /metrics
// above (line ~75) — a regular customer, or an unauthenticated caller, must
// never reach these. Live-reproduced pre-fix on an isolated port: a
// zero-cookie request created, listed, renamed and archived organizations
// (including pre-existing seed orgs) with no auth at all. Fixed with the
// identical precedented gate already used for the other platform-wide admin
// surfaces in this file (requireAuth, operatorOnly, operatorAudit) — applied
// per-route below, NOT via router.use(prefix, ...), because several of these
// exact paths (/enterprise/audit, /enterprise/dashboard) are literal-string
// prefixes of unrelated, already-correctly-gated org-scoped route families
// mounted later (enterpriseAudit.js's /enterprise/audit/:orgId/*,
// enterpriseDashboard.js's /enterprise/dashboard/:orgId/*) — a prefix-based
// router.use here would have shadowed and double-gated those real routes.
const _eosGate = [requireAuth, operatorOnly, operatorAudit];
const _eos = (() => { try { return require("../../agents/runtime/enterpriseOS.cjs"); } catch { return null; } })();

// Organizations
router.post("/enterprise/orgs",                           _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.createOrg(req.body || {}); if (r.ok === false) return res.status(400).json({ success: false, error: r.error }); res.status(201).json({ success: true, org: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/orgs",                            _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const { status, plan, industry, limit } = req.query; res.json({ success: true, orgs: _eos.listOrgs({ status, plan, industry, limit: limit ? parseInt(limit) : 50 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/orgs/:id",                        _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.getOrg(req.params.id); if (!r) return res.status(404).json({ success: false, error: "not_found" }); res.json({ success: true, org: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.patch("/enterprise/orgs/:id",                      _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.updateOrg(req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, org: r.org }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/enterprise/orgs/:id/archive",               _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.archiveOrg(req.params.id); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, org: r.org }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// Departments
router.post("/enterprise/depts",                          _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.createDept(req.body || {}); if (r.ok === false) return res.status(400).json({ success: false, error: r.error }); res.status(201).json({ success: true, dept: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/depts",                           _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const { orgId, status, limit } = req.query; res.json({ success: true, depts: _eos.listDepts({ orgId, status, limit: limit ? parseInt(limit) : 50 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/depts/:id",                       _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.getDept(req.params.id); if (!r) return res.status(404).json({ success: false, error: "not_found" }); res.json({ success: true, dept: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.patch("/enterprise/depts/:id",                     _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.updateDept(req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, dept: r.dept }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/enterprise/depts/:id/archive",              _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.archiveDept(req.params.id); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, dept: r.dept }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// Teams
router.post("/enterprise/teams",                          _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.createTeam(req.body || {}); if (r.ok === false) return res.status(400).json({ success: false, error: r.error }); res.status(201).json({ success: true, team: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/teams",                           _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const { orgId, deptId, status, type, limit } = req.query; res.json({ success: true, teams: _eos.listTeams({ orgId, deptId, status, type, limit: limit ? parseInt(limit) : 50 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/teams/:id",                       _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.getTeam(req.params.id); if (!r) return res.status(404).json({ success: false, error: "not_found" }); res.json({ success: true, team: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.patch("/enterprise/teams/:id",                     _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.updateTeam(req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, team: r.team }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/enterprise/teams/:id/members",              _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.addMember(req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, team: r.team }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.delete("/enterprise/teams/:id/members/:memberId",  _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.removeMember(req.params.id, req.params.memberId); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, team: r.team }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/enterprise/teams/:id/archive",              _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.archiveTeam(req.params.id); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, team: r.team }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// Roles
router.post("/enterprise/roles",                          _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.createRole(req.body || {}); if (r.ok === false) return res.status(400).json({ success: false, error: r.error }); res.status(201).json({ success: true, role: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/roles",                           _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const { orgId, scope, status, limit } = req.query; res.json({ success: true, roles: _eos.listRoles({ orgId, scope, status, limit: limit ? parseInt(limit) : 50 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/roles/:id",                       _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.getRole(req.params.id); if (!r) return res.status(404).json({ success: false, error: "not_found" }); res.json({ success: true, role: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.patch("/enterprise/roles/:id",                     _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.updateRole(req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, role: r.role }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/enterprise/roles/:id/deprecate",            _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.deprecateRole(req.params.id); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, role: r.role }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// Permissions
router.post("/enterprise/permissions",                    _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.grantPermission(req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.status(201).json({ success: true, permission: r.permission }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/permissions",                     _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const { memberId, roleId, orgId, resource, active, limit } = req.query; res.json({ success: true, permissions: _eos.listPermissions({ memberId, roleId, orgId, resource, active: active !== undefined ? active === "true" : undefined, limit: limit ? parseInt(limit) : 50 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/permissions/check",               _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const { memberId, resource, action } = req.query; if (!memberId || !resource || !action) return res.status(400).json({ success: false, error: "memberId, resource, action required" }); res.json({ success: true, ..._eos.checkPermission(memberId, resource, action) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/permissions/:id",                 _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.getPermission(req.params.id); if (!r) return res.status(404).json({ success: false, error: "not_found" }); res.json({ success: true, permission: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.patch("/enterprise/permissions/:id",               _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.updatePermission(req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, permission: r.permission }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/enterprise/permissions/:id/revoke",         _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.revokePermission(req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, permission: r.permission }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// Policies
router.post("/enterprise/policies",                       _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.createPolicy(req.body || {}); if (r.ok === false) return res.status(400).json({ success: false, error: r.error }); res.status(201).json({ success: true, policy: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/policies",                        _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const { orgId, type, status, enforcement, limit } = req.query; res.json({ success: true, policies: _eos.listPolicies({ orgId, type, status, enforcement, limit: limit ? parseInt(limit) : 50 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/policies/:id",                    _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.getPolicy(req.params.id); if (!r) return res.status(404).json({ success: false, error: "not_found" }); res.json({ success: true, policy: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.patch("/enterprise/policies/:id",                  _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.updatePolicy(req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, policy: r.policy }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/enterprise/policies/:id/enforce",           _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.enforcePolicy(req.params.id, req.body || {}); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, ...r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.post("/enterprise/policies/:id/archive",           _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.archivePolicy(req.params.id); if (!r.ok) return res.status(400).json({ success: false, error: r.error }); res.json({ success: true, policy: r.policy }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// Audit
router.post("/enterprise/audit",                          _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const r = _eos.logAuditEvent(req.body || {}); res.status(201).json({ success: true, event: r }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/audit",                           _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const { orgId, actorId, action, resource, outcome, dateFrom, dateTo, limit } = req.query; res.json({ success: true, events: _eos.listAuditLog({ orgId, actorId, action, resource, outcome, dateFrom, dateTo, limit: limit ? parseInt(limit) : 50 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/audit/stats",                     _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const { orgId, dateFrom, dateTo } = req.query; res.json({ success: true, ..._eos.getAuditStats({ orgId, dateFrom, dateTo }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// Summaries & dashboard
router.get("/enterprise/dashboard",                       _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { res.json({ success: true, ..._eos.getEnterpriseDashboard() }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/summary/daily",                   _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { res.json({ success: true, ..._eos.getDailySummary(req.query.date) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/summary/weekly",                  _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { res.json({ success: true, ..._eos.getWeeklySummary(req.query.weekStart) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/compliance/:orgId",               _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { res.json({ success: true, ..._eos.getComplianceSummary(req.params.orgId) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/search",                          _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { const { q, limit } = req.query; if (!q) return res.status(400).json({ success: false, error: "q required" }); res.json({ success: true, results: _eos.searchEnterprise(q, { limit: limit ? parseInt(limit) : 20 }) }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });
router.get("/enterprise/stats",                           _eosGate, (req, res) => { if (!_eos) return res.status(503).json({ success: false, error: "enterpriseOS unavailable" }); try { res.json({ success: true, ..._eos.getStats() }); } catch (e) { res.status(500).json({ success: false, error: "internal_error" }); } });

// ── Workflow health status ────────────────────────────────────────
const _autoAgent = (() => { try { return require("../../agents/automationAgent.cjs"); } catch { return null; } })();

router.get("/workflow/status", (req, res) => {
    if (!_autoAgent) return res.status(503).json({ success: false, error: "automationAgent unavailable" });
    try { return res.json({ success: true, ..._autoAgent.getStatus() }); }
    catch (e) { return res.status(500).json({ success: false, error: "internal_error" }); }
});

router.get("/workflow/log", (req, res) => {
    if (!_autoAgent) return res.status(503).json({ success: false, error: "automationAgent unavailable" });
    try {
        const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 20, 100));
        return res.json({ success: true, log: _autoAgent.getLog(limit) });
    } catch (e) { return res.status(500).json({ success: false, error: "internal_error" }); }
});

module.exports = router;
