"use strict";
/**
 * Jarvis Routes — all API endpoints in one place.
 */

const express    = require("express");
const router     = express.Router();
const controller = require("../controllers/jarvisController");
const wa         = require("../services/whatsappService");
const crm        = require("../services/crmService");
const payment    = require("../services/paymentService");
const automation = require("../services/automationService");
const ai         = require("../services/aiService");
const { optionalAuth, requireAuth } = require("../middleware/firebaseAuth");
const errTracker = require("../utils/errorTracker");
const memTracker = require("../utils/memoryTracker");

// ── Core gateway (auth optional — works from web, Electron, and mobile) ──
router.post("/jarvis", optionalAuth, controller.handleJarvis);

// ── WhatsApp webhook ───────────────────────────────────────────────
router.get("/whatsapp/webhook", (req, res) => {
    const check = wa.verifyWebhook(req.query);
    if (check.valid) return res.status(200).send(check.challenge);
    res.sendStatus(403);
});

router.post("/whatsapp/webhook", controller.handleWhatsAppWebhook);

// ── Razorpay webhook ───────────────────────────────────────────────
router.post("/webhook/razorpay",  controller.handleRazorpayWebhook);
router.post("/razorpay-webhook",  controller.handleRazorpayWebhook);  // alias

// ── CRM (require auth from mobile; web/Electron pass token automatically) ──
router.get("/crm",       optionalAuth, (req, res) => res.json(crm.getLeads()));
router.get("/crm-leads", optionalAuth, (req, res) => res.json(crm.getLeads()));

router.post("/crm/lead", optionalAuth, (req, res) => {
    const { phone, name, ...rest } = req.body;
    if (!phone) return res.status(400).json({ error: "phone required" });
    const cleanPhone = String(phone).replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 7)
        return res.status(400).json({ error: "Invalid phone number — include country code (e.g. 919876543210)" });
    const existing = crm.getLead(cleanPhone);
    if (existing)
        return res.json({ success: true, duplicate: true, message: "Client already exists" });
    crm.saveLead({ phone: cleanPhone, name, ...rest });
    res.json({ success: true, duplicate: false });
});

router.patch("/crm/lead/:phone", optionalAuth, (req, res) => {
    crm.updateLead(decodeURIComponent(req.params.phone), req.body);
    res.json({ success: true });
});

// ── Payment ────────────────────────────────────────────────────────
router.post("/payment/link", async (req, res) => {
    try {
        const { amount = 999, name = "Customer", phone, description = "JARVIS Access" } = req.body;
        const result = await payment.createPaymentLink({ amount, name, phone, description });
        if (!result.success) return res.status(500).json({ error: result.error });
        if (phone) await wa.sendMessage(phone, `Your payment link:\n${result.link}\n\nAmount: ₹${amount}`);
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Follow-up manual trigger ───────────────────────────────────────
router.post("/send-followup", async (req, res) => {
    const { phone, message } = req.body;
    if (!phone) return res.status(400).json({ error: "phone required" });
    const result = await automation.sendManualFollowUp(phone, message);
    res.json(result);
});

// ── Stats / Dashboard ──────────────────────────────────────────────
router.get("/stats", (req, res) => {
    const s = crm.getStats();
    res.json({ success: true, uptime: Math.round(process.uptime()), timestamp: new Date().toISOString(), ...s });
});

router.get("/dashboard/revenue", (req, res) => {
    const s = crm.getStats();
    res.json({ success: true, paid_customers: s.paid, revenue: s.revenue, currency: "INR" });
});

// ── Metrics ────────────────────────────────────────────────────────
router.get("/metrics", (req, res) => {
    try {
        const mc = require("../../agents/metrics/metricsCollector.cjs");
        const snap = mc.snapshot();
        res.json({ success: true, ...controller.getMetrics(), execution: snap });
    } catch (e) {
        res.json({ success: true, ...controller.getMetrics(), execution_error: e.message });
    }
});

// ── Health ────────────────────────────────────────────────────────
router.get("/test",       (req, res) => res.json({ status: "OK", timestamp: new Date().toISOString() }));
router.get("/api/status", (req, res) => res.json({ status: "JARVIS running", version: "3.0", port: process.env.PORT || 5050 }));
router.get("/health", (req, res) => {
    const svcWarnings = [];
    if (!process.env.GROQ_API_KEY)                                  svcWarnings.push("AI disabled — GROQ_API_KEY missing");
    if (!process.env.TELEGRAM_TOKEN)                                 svcWarnings.push("Telegram disabled — TELEGRAM_TOKEN missing");
    if (!process.env.WA_TOKEN && !process.env.WHATSAPP_TOKEN)       svcWarnings.push("WhatsApp disabled — WA_TOKEN missing");
    if (!process.env.RAZORPAY_KEY || !process.env.RAZORPAY_SECRET)  svcWarnings.push("Payments disabled — RAZORPAY_KEY/SECRET missing");

    let base = { status: "ok", uptime_seconds: Math.round(process.uptime()), timestamp: new Date().toISOString() };
    try {
        const mc = require("../../agents/metrics/metricsCollector.cjs");
        base = { ...mc.health(), timestamp: new Date().toISOString() };
    } catch { /* metricsCollector optional */ }

    const status = svcWarnings.length >= 2 ? "degraded" : "ok";
    res.json({
        ...base,
        status,
        services: {
            ai:       !!process.env.GROQ_API_KEY,
            telegram: !!process.env.TELEGRAM_TOKEN,
            whatsapp: !!(process.env.WA_TOKEN || process.env.WHATSAPP_TOKEN),
            payments: !!(process.env.RAZORPAY_KEY && process.env.RAZORPAY_SECRET),
        },
        warnings: svcWarnings
    });
});

// ── AI direct ────────────────────────────────────────────────────
router.post("/ai/chat", async (req, res) => {
    try {
        const { prompt, system, history } = req.body;
        if (!prompt) return res.status(400).json({ error: "prompt required" });
        const reply = await ai.callAI(prompt, { system, history });
        res.json({ success: true, reply });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WhatsApp direct send ──────────────────────────────────────────
router.post("/whatsapp/send", async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: "phone and message required" });
    const result = await wa.sendMessage(phone, message);
    res.json(result);
});

// ── Bulk WhatsApp ─────────────────────────────────────────────────
router.post("/whatsapp/bulk", async (req, res) => {
    const { message, statusFilter } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });
    const leads = crm.getLeads(statusFilter || "new").filter(l => l.phone);
    const batch = leads.slice(0, 50);   // hard cap at 50 per call
    let sent = 0;
    const _sleep = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < batch.length; i++) {
        const r = await wa.sendMessage(batch[i].phone, message);
        if (r.success) sent++;
        // 1.2 s between sends — stays well under WA Cloud API rate limits
        if (i < batch.length - 1) await _sleep(1_200);
    }
    res.json({ success: true, sent, total: leads.length });
});

// ── Operational diagnostics (/ops) ────────────────────────────────
// Single endpoint showing everything an operator needs at a glance:
// queue health, error rates, uptime, memory trend, anomaly warnings,
// service states, recent failures. Add ?debug=1 for raw log buffer.
router.get("/ops", (req, res) => {
    const uptimeSecs = Math.round(process.uptime());
    const debug      = req.query.debug === "1";

    // Memory (prefer trend tracker if available)
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

    // Queue health
    let queueHealth = null;
    let stuckTasks  = [];
    try {
        const tq  = require("../../agents/taskQueue.cjs");
        queueHealth = tq.getHealthReport();
        const all = tq.getAll();
        const cutoff = Date.now() - 60 * 60_000;  // pending > 1h
        stuckTasks = all
            .filter(t => t.status === "pending" && new Date(t.scheduledFor || t.createdAt).getTime() < cutoff)
            .map(t => ({
                id:         t.id,
                input:      t.input.slice(0, 60),
                ageMinutes: Math.round((Date.now() - new Date(t.createdAt).getTime()) / 60_000)
            }));
    } catch { /* queue unavailable */ }

    // Repeated failure report + timing from autonomous loop
    let failureReport = [];
    let timingReport  = null;
    try {
        const al = require("../../agents/autonomousLoop.cjs");
        failureReport = al.getFailureReport();
        timingReport  = al.getTimingReport();
    } catch { /* loop unavailable */ }

    // CRM stats
    let crmStats = null;
    try { crmStats = crm.getStats(); } catch { /* non-critical */ }

    // Controller metrics (includes per-mode latency)
    let reqMetrics = null;
    try { reqMetrics = controller.getMetrics(); } catch { /* non-critical */ }

    // Automation success rates
    let autoStats = null;
    try { autoStats = automation.getStats(); } catch { /* non-critical */ }

    // ── Anomaly detection ────────────────────────────────────────────
    const warnings = [];
    const errReport = errTracker.getReport();
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
        status:   warnings.some(w => w.level === "critical") ? "critical"
                : warnings.length > 0 ? "degraded" : "ok",
        ts:       new Date().toISOString(),
        uptime:   { seconds: uptimeSecs, human: `${Math.floor(uptimeSecs / 3600)}h ${Math.floor((uptimeSecs % 3600) / 60)}m` },
        warnings,
        memory:       memReport,
        errors:       errReport,
        queue:        queueHealth,
        stuck_tasks:  stuckTasks,
        failures:     failureReport,
        timing:       timingReport,
        automation:   autoStats,
        crm:          crmStats,
        requests:     reqMetrics,
        services: {
            whatsapp:  !!(process.env.WA_TOKEN || process.env.WHATSAPP_TOKEN),
            payments:  !!process.env.RAZORPAY_KEY,
            telegram:  !!process.env.TELEGRAM_TOKEN,
            groq:      !!process.env.GROQ_API_KEY
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

// ── Simulation / test flow ─────────────────────────────────────────
router.post("/simulate/full-flow", async (req, res) => {
    const { phone = "919999999999", name = "Test User" } = req.body;
    const steps = [];

    try {
        // 1. Save lead
        crm.saveLead({ phone, name });
        steps.push({ step: 1, label: "Lead saved", ok: true });

        // 2. AI reply
        const aiR = await ai.callAI("Hello, I want to automate my business.");
        steps.push({ step: 2, label: "AI replied", ok: !!aiR, preview: aiR.slice(0, 80) });

        // 3. Payment link
        const p = await payment.createPaymentLink({ amount: 999, name, description: "JARVIS Sim" });
        steps.push({ step: 3, label: "Payment link", ok: p.success, link: p.link });

        // 4. WA send (only if configured)
        const token = process.env.WA_TOKEN || process.env.WHATSAPP_TOKEN;
        if (token && p.link) {
            const waR = await wa.sendMessage(phone, `Sim: ${p.link}`);
            steps.push({ step: 4, label: "WA message sent", ok: waR.success });
        } else {
            steps.push({ step: 4, label: "WA skip (not configured)", ok: true });
        }

        // 5. Simulate webhook → CRM update + fulfillment
        crm.updateLead(phone, { status: "paid", paymentStatus: "paid", paymentId: "sim_" + Date.now() });
        steps.push({ step: 5, label: "CRM updated to paid", ok: true });

        // 6. Verify CRM
        const lead = crm.getLead(phone);
        steps.push({ step: 6, label: "CRM verified", ok: lead?.status === "paid", leadStatus: lead?.status });

        res.json({ success: true, steps });

    } catch (err) {
        res.json({ success: false, steps, error: err.message });
    }
});

module.exports = router;
