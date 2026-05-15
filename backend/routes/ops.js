"use strict";
const router       = require("express").Router();
const crm          = require("../services/crmService");
const automation   = require("../services/automationService");
const controller   = require("../controllers/jarvisController");
const errTracker   = require("../utils/errorTracker");
const memTracker   = require("../utils/memoryTracker");
const { requireAuth } = require("../middleware/authMiddleware");
const operatorAudit   = require("../middleware/operatorAudit");

// /health and /test are intentionally unauthenticated:
//   - /health is used by Docker HEALTHCHECK, PM2, nginx, and monitoring tools
//   - /test is a no-op probe used in smoke tests
router.get("/test",       (req, res) => res.json({ status: "OK", timestamp: new Date().toISOString() }));

// /api/status also remains unauthenticated (external status probe)
router.get("/api/status", (req, res) => res.json({ status: "JARVIS running", version: "3.0", port: process.env.PORT || 5050 }));

// Gate: all remaining ops routes require a valid operator session.
// operatorAudit records every authenticated request for the audit trail.
router.use(requireAuth, operatorAudit);

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
        res.json({ success: true, ...controller.getMetrics(), execution_error: e.message });
    }
});

router.get("/health", (req, res) => {
    const svcWarnings = [];
    if (!process.env.GROQ_API_KEY)                                 svcWarnings.push("AI disabled — GROQ_API_KEY missing");
    if (!process.env.TELEGRAM_TOKEN)                               svcWarnings.push("Telegram disabled — TELEGRAM_TOKEN missing");
    if (!process.env.WA_TOKEN && !process.env.WHATSAPP_TOKEN)      svcWarnings.push("WhatsApp disabled — WA_TOKEN missing");
    if (!process.env.RAZORPAY_KEY || !process.env.RAZORPAY_SECRET) svcWarnings.push("Payments disabled — RAZORPAY_KEY/SECRET missing");

    let base = { status: "ok", uptime_seconds: Math.round(process.uptime()), timestamp: new Date().toISOString() };
    try {
        const mc = require("../../agents/metrics/metricsCollector.cjs");
        base = { ...mc.health(), timestamp: new Date().toISOString() };
    } catch { /* metricsCollector optional */ }

    res.json({
        ...base,
        status: svcWarnings.length >= 2 ? "degraded" : "ok",
        services: {
            ai:       !!process.env.GROQ_API_KEY,
            telegram: !!process.env.TELEGRAM_TOKEN,
            whatsapp: !!(process.env.WA_TOKEN || process.env.WHATSAPP_TOKEN),
            payments: !!((process.env.RAZORPAY_KEY || process.env.RAZORPAY_KEY_ID) && (process.env.RAZORPAY_SECRET || process.env.RAZORPAY_KEY_SECRET)),
        },
        warnings: svcWarnings
    });
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
            payments: !!process.env.RAZORPAY_KEY,
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

module.exports = router;
