"use strict";
/**
 * Jarvis Controller — FINAL MASTER PIPELINE
 *
 * FLOW:
 *   input
 *     → sanitise + rate-limit
 *     → detectIntent
 *     → route: SALES | EXECUTION | INTELLIGENCE
 *
 *   SALES:
 *     SalesAgent.scoreLead()  →  if hot: createPaymentLink() → attach + WA send
 *     SalesAgent.generateReply()  →  AI closer
 *     FollowUpSystem.scheduleFollowUps()
 *     CRM: mark hot / save lead
 *
 *   EXECUTION:
 *     parseCommand() → toolAgent.execute() → real OS action
 *
 *   INTELLIGENCE:
 *     orchestrator (full pipeline) → Groq fallback
 *
 *   WEBHOOK (payment.captured):
 *     verifyHMAC → updateLead(paid) → triggerFulfillment()
 *
 *   WHATSAPP INCOMING:
 *     AutoReplyAgent → pipeline → reply back
 *
 * Response shape (always):
 *   { success, reply, intent, action, mode, data }
 */

const logger     = require("../utils/logger");
const errTracker = require("../utils/errorTracker");
const parser     = require("../utils/parser");
const toolAgent = require("../agents/toolAgent");
const ai        = require("../services/aiService");
const wa        = require("../services/whatsappService");
const payment   = require("../services/paymentService");
const crm       = require("../services/crmService");
const automation = require("../services/automationService");

// ── Load existing agents (graceful — system still works if any fail) ──
let SalesAgent, InterestDetector, FollowUpSystem, AutoReplyAgent;

try { ({ SalesAgent }        = require("../../agents/salesAgent.cjs"));       } catch { SalesAgent        = null; }
try { ({ InterestDetector }  = require("../../agents/interestDetector.cjs")); } catch { InterestDetector  = null; }
try { ({ FollowUpSystem }    = require("../../agents/followUpSystem.cjs"));   } catch { FollowUpSystem    = null; }
try { ({ AutoReplyAgent }    = require("../../agents/autoReplyAgent.cjs"));   } catch { AutoReplyAgent    = null; }

const _salesAgent      = SalesAgent      ? new SalesAgent()       : null;
const _detector        = InterestDetector ? new InterestDetector() : null;
const _followUp        = FollowUpSystem   ? new FollowUpSystem()   : null;
const _autoReply       = AutoReplyAgent   ? new AutoReplyAgent()   : null;

// ── Load orchestrator (graceful fallback to direct AI) ───────────
let _orchestrator = null;
try { _orchestrator = require("../../orchestrator.cjs"); } catch { /* AI fallback */ }

// ── Rate limiter ──────────────────────────────────────────────────
const _rateMap = new Map();
function _checkRate(ip, limit = 60, windowMs = 60_000) {
    const now   = Date.now();
    const entry = _rateMap.get(ip) || { count: 0, start: now };
    if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
    entry.count++;
    _rateMap.set(ip, entry);
    return entry.count <= limit;
}
// Purge stale rate-limit entries every 5 minutes.
// Cutoff = window (60s) + 15s grace so any in-flight window finishes first.
setInterval(() => {
    const cutoff = Date.now() - 75_000;
    for (const [ip, entry] of _rateMap) {
        if (entry.start < cutoff) _rateMap.delete(ip);
    }
}, 300_000).unref();

// ── Analytics counters ────────────────────────────────────────────
const _metrics = {
    requests:     0,
    errors:       0,
    paymentLinks: 0,
    waSent:       0,
    byIntent:     {},
    byMode:       {},
    // Per-mode latency ring buffers (last 200 durations each)
    latency: { sales: [], execution: [], intelligence: [], whatsapp: [] }
};
const _LATENCY_MAX = 200;

function _recordLatency(mode, ms) {
    const buf = _metrics.latency[mode];
    if (!buf) return;
    buf.push(ms);
    if (buf.length > _LATENCY_MAX) buf.shift();
}

function _percentile(sorted, p) {
    if (sorted.length === 0) return null;
    const idx = Math.ceil(sorted.length * p / 100) - 1;
    return sorted[Math.max(0, idx)];
}

function _latencyStats(mode) {
    const buf = _metrics.latency[mode];
    if (!buf || buf.length === 0) return { count: 0, p50: null, p95: null, p99: null, avg: null, max: null };
    const sorted = [...buf].sort((a, b) => a - b);
    const avg    = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
    return {
        count: sorted.length,
        p50:   _percentile(sorted, 50),
        p95:   _percentile(sorted, 95),
        p99:   _percentile(sorted, 99),
        avg,
        max:   sorted[sorted.length - 1]
    };
}

// ── Input sanitiser ───────────────────────────────────────────────
function _clean(str, max = 2000) {
    if (!str || typeof str !== "string") return "";
    return str.trim().slice(0, max).replace(/[<>]/g, "");
}

// ── Unified response builder ──────────────────────────────────────
function _ok(res, data) {
    return res.json({
        success: true,
        reply:   data.reply   || "",
        intent:  data.intent  || "unknown",
        action:  data.action  || null,
        mode:    data.mode    || "smart",
        data:    data.data    || null
    });
}

// ════════════════════════════════════════════════════════════════
//  PIPELINE 1 — SALES FLOW
//  SalesAgent → InterestDetector → PaymentLink → FollowUp → CRM
// ════════════════════════════════════════════════════════════════
async function _salesPipeline(input, phone) {
    let reply     = "";
    let payLink   = null;
    let leadScore = 0;
    let isHot     = false;

    // ── Step 1: Score the lead ────────────────────────────────────
    if (_salesAgent?.scoreLead) {
        leadScore = _salesAgent.scoreLead(input.toLowerCase());
    }
    if (_detector?.isHot) {
        isHot = _detector.isHot(input);
    }

    // ── Step 2: Get AI closer reply ───────────────────────────────
    try {
        if (_salesAgent?.generateReply) {
            reply = await _salesAgent.generateReply(input) || "";
        }
    } catch { /* silent */ }

    // ── Step 3: Payment link — hot lead OR explicit buy intent ─────
    const wantsToBuy = /\b(buy|pay|start|purchase|get access|sign up|register|yes|interested)\b/i.test(input);

    if (isHot || leadScore >= 5 || wantsToBuy) {
        const result = await payment.createPaymentLink({
            amount:      999,
            name:        "Client",
            phone:       phone || null,
            description: "JARVIS AI System Access"
        });

        if (result.success) {
            payLink = result.link;
            _metrics.paymentLinks++;
            reply = (reply ? reply + "\n\n" : "") +
                `Payment link ready:\n${payLink}\n\nAmount: ₹999\n\nPay now to activate JARVIS immediately.`;

            // Send link on WhatsApp if phone known
            if (phone) {
                const waR = await wa.sendMessage(phone, `Your payment link:\n${payLink}\n\nAmount: ₹999`);
                if (waR.success) _metrics.waSent++;
            }
        } else {
            reply = (reply ? reply + "\n\n" : "") +
                "Ready to start! Reply with your name and I'll generate your payment link.";
        }

        // Update CRM to hot
        if (phone) crm.updateLead(phone, { status: "hot", lastMessage: input });
    }

    // ── Step 4: Fallback reply ────────────────────────────────────
    if (!reply) {
        reply = "JARVIS AI automates your entire business — leads, replies, payments, follow-ups.\n\nType 'yes' or 'buy' to get started.";
    }

    // ── Step 5: Schedule follow-ups (only if not paid) ────────────
    if (phone) {
        const lead = crm.getLead(phone);
        if (_followUp?.scheduleFollowUps && lead?.status !== "paid" && lead?.status !== "onboarded") {
            try { _followUp.scheduleFollowUps(phone); } catch { /* non-critical */ }
        }
    }

    return {
        reply,
        action: payLink ? "payment_link_generated" : "sales_reply",
        data:   { payLink, leadScore, isHot }
    };
}

// ════════════════════════════════════════════════════════════════
//  PIPELINE 2 — EXECUTION FLOW
//  parseCommand → toolAgent → real action / CRM / payment
// ════════════════════════════════════════════════════════════════
// Lazy-load systemMonitor for execution pipeline instrumentation
let _sysMonitor = null;
function _getSysMonitor() {
    if (!_sysMonitor) { try { _sysMonitor = require("../../agents/automation/systemMonitor.cjs"); } catch { _sysMonitor = null; } }
    return _sysMonitor;
}

const _UNIT_TO_MS = { minute: 60_000, min: 60_000, second: 1_000, sec: 1_000, hour: 3_600_000 };
function _scheduleTimerAlert(phone, delayMs, label) {
    setTimeout(async () => {
        try {
            const wa = require("../services/whatsappService");
            const msg = `⏰ Time's up! ${label}`;
            if (phone) {
                await wa.sendMessage(phone, msg);
            } else {
                require("../utils/logger").info(`[Timer] Fired: ${label}`);
            }
        } catch (e) { /* non-critical */ }
    }, delayMs).unref();
}

async function _executionPipeline(input, phone = "") {
    const parsed = parser.parseCommand(input);

    // ── Execution-exclusive types: handled here and nowhere else ─────
    if (parsed.type === "get_leads") {
        const leads    = crm.getLeads();
        const real     = leads.filter(l => l.phone && l.phone !== "null");
        const summary  = real.slice(0, 5).map(l => `• ${l.name || "Lead"} — ${l.phone} — ${l.status}`).join("\n");
        return {
            reply:  `${real.length} lead(s) in CRM.\n\n` + (summary || "No leads with phone numbers yet."),
            action: "get_leads",
            data:   { leads: real, total: leads.length }
        };
    }

    if (parsed.type === "payment") {
        const result = await payment.createPaymentLink({ amount: 999, name: "Customer", description: "JARVIS Access" });
        _metrics.paymentLinks++;
        return {
            reply:  result.success ? `Payment link:\n${result.link}` : `Payment error: ${result.error}`,
            action: "payment_link",
            data:   result
        };
    }

    // ── Fast path: toolAgent handles the common execution types directly ──
    // (open_url, web_search, open_app, desktop, note, reminder, timer, greeting, time, date, status)
    logger.info(`[Exec] tool=${parsed.type} action=${parsed.action || "-"} label="${parsed.label || "-"}"`);
    const toolResult = await toolAgent.execute(parsed);
    if (toolResult) {
        _getSysMonitor()?.record({ type: parsed.type, source: "execution" }, { success: toolResult.success !== false });

        // Schedule actual delivery for timer tasks
        if (parsed.type === "timer" && parsed.duration) {
            const unitKey = (parsed.unit || "").toLowerCase().replace(/s$/, "");
            const ms = (_UNIT_TO_MS[unitKey] || _UNIT_TO_MS[parsed.unit?.toLowerCase()] || 60_000) * Number(parsed.duration);
            _scheduleTimerAlert(phone, ms, `${parsed.duration} ${parsed.unit} timer done`);
        }

        return {
            reply:  toolResult.message || parsed.label || "Done.",
            action: parsed.action || parsed.type,
            data:   { parsed, toolResult }
        };
    }

    // ── Unified fallback: route through intelligence pipeline ─────────
    // Avoids a bare AI response for commands the execution parser doesn't
    // recognise — planner+executor handle terminal, queue, research, dev, etc.
    logger.info(`[Exec→Intel] escalating unknown type="${parsed.type}" — "${input.slice(0, 60)}"`);
    return _intelligencePipeline(input, []);
}

// ════════════════════════════════════════════════════════════════
//  PIPELINE 3 — INTELLIGENCE FLOW
//  orchestrator → Groq → OpenAI → Ollama
// ════════════════════════════════════════════════════════════════
async function _intelligencePipeline(input, history) {
    // Try full orchestrator first
    if (_orchestrator?.gateway) {
        try {
            const result = await _orchestrator.gateway("smart", { input });
            const reply  = result?.reply || result?.response || "";
            if (reply) return { reply, action: "orchestrator", data: result };
        } catch (err) {
            logger.warn("[Intel] Orchestrator failed:", err.message);
        }
    }

    // Upsell check: if user asks about growing/scaling → suggest upgrade
    const upsellIntent = /\b(grow|scale|more clients|more leads|expand|increase|upgrade|advanced)\b/i.test(input);
    let systemOverride;
    if (upsellIntent) {
        systemOverride =
            "You are JARVIS, an AI business assistant. The user is interested in growing their business. " +
            "Give practical advice AND naturally mention that JARVIS Pro at ₹999 can automate everything for them. " +
            "Be concise and conversational.";
    }

    logger.info(`[AI] callAI (intelligence) — "${input.slice(0, 60)}"`);
    const reply = await ai.callAI(input, { history, system: systemOverride });
    return { reply, action: "ai_reply", data: null };
}

// ════════════════════════════════════════════════════════════════
//  MAIN /jarvis HANDLER
// ════════════════════════════════════════════════════════════════
async function handleJarvis(req, res) {
    const ip      = req.ip || "unknown";
    const traceId = Date.now().toString(36);
    const startMs = Date.now();
    _metrics.requests++;
    res.setHeader("x-trace-id", traceId);

    // Rate limit
    if (!_checkRate(ip)) {
        return res.status(429).json({ success: false, reply: "Too many requests. Slow down.", traceId });
    }

    try {
        const input   = _clean(req.body.input  || req.body.command || req.body.message || "");
        const phone   = _clean(req.body.phone  || "");
        const history = Array.isArray(req.body.history) ? req.body.history.slice(-10) : [];

        if (!input) {
            return res.status(400).json({ success: false, reply: "Input is required.", traceId });
        }

        // Detect intent + mode
        const intent = parser.detectIntent(input);
        _metrics.byIntent[intent] = (_metrics.byIntent[intent] || 0) + 1;

        let mode = _clean(req.body.mode || "smart");
        if (mode === "smart") {
            if (/\b(buy|pay|price|demo|purchase|payment|cost|interested|yes)\b/i.test(input)) mode = "sales";
            // Multi-step check: "X and Y", "X then Y", "X; Y" — route to orchestrator
            else if (/\s+(and|then)\s+.{4,}|\s*;\s*.{4,}|\s*\+\s*.{4,}/i.test(input)) mode = "intelligence";
            else if (/\b(open|launch|search|find|type|note|remind|timer|get leads|calendar)\b/i.test(input) || /^(press|copy|paste|select all)(\s|$)/i.test(input)) mode = "execution";
            else mode = "intelligence";
        }
        _metrics.byMode[mode] = (_metrics.byMode[mode] || 0) + 1;

        logger.info(`[Jarvis] ${traceId} | mode=${mode} | intent=${intent} | "${input.slice(0, 60)}"`);

        // Track lead
        if (phone) {
            const existing = crm.getLead(phone);
            if (!existing) crm.saveLead({ phone, lastMessage: input });
            else crm.updateLead(phone, { lastMessage: input, lastInteraction: new Date().toISOString() });
        }

        // Route to pipeline
        let result;
        if      (mode === "sales")       result = await _salesPipeline(input, phone);
        else if (mode === "execution")   result = await _executionPipeline(input, phone);
        else                             result = await _intelligencePipeline(input, history);

        const elapsed = Date.now() - startMs;
        _recordLatency(mode, elapsed);
        logger.debug(`[Jarvis] ${traceId} done in ${elapsed}ms`);
        return _ok(res, { ...result, intent, mode, traceId });

    } catch (err) {
        _metrics.errors++;
        errTracker.record("jarvis", err.message, { intent, mode });
        logger.error("[Jarvis] Error:", err.message);
        return res.status(500).json({
            success: false,
            reply:   "Something went wrong. Please try again.",
            error:   err.message,
            traceId
        });
    }
}

// ════════════════════════════════════════════════════════════════
//  RAZORPAY WEBHOOK
//  HMAC verify → CRM update → triggerFulfillment
// ════════════════════════════════════════════════════════════════
async function handleRazorpayWebhook(req, res) {
    try {
        const rawBody = req.rawBody || JSON.stringify(req.body);
        const sig     = req.headers["x-razorpay-signature"] || "";

        // Signature check (bypassed in dev if secret not set)
        if (!payment.verifyWebhookSignature(rawBody, sig)) {
            logger.warn("[Webhook] Razorpay signature mismatch — rejected");
            return res.status(400).json({ error: "Invalid signature" });
        }

        const parsed = payment.parseWebhookEvent(rawBody);
        if (!parsed) return res.json({ status: "ignored" });

        const { event, payment: p } = parsed;
        logger.info(`[Webhook] Event: ${event}`);

        if (event === "payment.captured" && p) {
            const phone  = p.contact || "";
            const userId = p.customer_details?.contact || phone;
            const name   = p.customer_details?.name || "";

            logger.info(`[Webhook] Payment captured — phone=${phone} id=${p.id}`);

            // Step 1: Update CRM
            const identifier = phone || userId;
            if (identifier) {
                crm.updateLead(identifier, {
                    status:        "paid",
                    paymentStatus: "paid",
                    paymentId:     p.id,
                    paidAt:        new Date().toISOString()
                });

                // Step 2: Fulfillment — WA confirmation + onboarding
                await automation.triggerFulfillment(identifier, name);
            }
        }

        res.json({ status: "ok" });
    } catch (err) {
        logger.error("[Webhook] Razorpay error:", err.message);
        res.sendStatus(500);
    }
}

// ════════════════════════════════════════════════════════════════
//  WHATSAPP INCOMING WEBHOOK
//  parse → AutoReplyAgent → full pipeline → reply
// ════════════════════════════════════════════════════════════════
async function handleWhatsAppWebhook(req, res) {
    // Always respond 200 immediately (WA requires fast ack)
    res.sendStatus(200);
    const _waStart = Date.now();

    try {
        const msg = wa.parseIncomingMessage(req.body);
        if (!msg || !msg.text) return;

        const { phone, text } = msg;
        logger.info(`[WA] Incoming from ${phone}: ${text}`);

        // Save / update lead
        const existing = crm.getLead(phone);
        if (!existing) crm.saveLead({ phone, lastMessage: text });
        else crm.updateLead(phone, { lastMessage: text, lastInteraction: new Date().toISOString() });

        // Run through full sales/execution/intelligence pipeline
        let reply = "";

        if (/\b(buy|pay|price|cost|interested|yes|start)\b/i.test(text)) {
            const result = await _salesPipeline(text, phone);
            reply = result.reply;
        } else if (/\b(open|search|find|remind|timer)\b/i.test(text)) {
            const result = await _executionPipeline(text, phone);
            reply = result.reply;
        } else if (_autoReply) {
            // AutoReplyAgent handles casual messages
            reply = await _autoReply.generateReply(text);
        } else {
            reply = await ai.callAI(text);
        }

        if (reply) {
            logger.info(`[WA] Sending reply to ${phone} — "${reply.slice(0, 60)}"`);
            const waR = await wa.sendMessage(phone, reply);
            if (waR.success) _metrics.waSent++;
            else logger.warn(`[WA] Send failed: ${waR.error}`);
        }

        _recordLatency("whatsapp", Date.now() - _waStart);
    } catch (err) {
        errTracker.record("whatsapp_webhook", err.message);
        logger.error("[WA] Incoming handler error:", err.message);
    }
}

// ════════════════════════════════════════════════════════════════
//  ANALYTICS / MONITORING
// ════════════════════════════════════════════════════════════════
function getMetrics() {
    const crmStats = crm.getStats();
    return {
        requests:      _metrics.requests,
        errors:        _metrics.errors,
        error_rate:    _metrics.requests > 0
            ? +(_metrics.errors / _metrics.requests * 100).toFixed(1)
            : 0,
        paymentLinks:  _metrics.paymentLinks,
        waSent:        _metrics.waSent,
        byIntent:      _metrics.byIntent,
        byMode:        _metrics.byMode,
        latency: {
            sales:        _latencyStats("sales"),
            execution:    _latencyStats("execution"),
            intelligence: _latencyStats("intelligence"),
            whatsapp:     _latencyStats("whatsapp")
        },
        crm:           crmStats,
        conversionRate: crmStats.conversionRate,
        uptime:        Math.round(process.uptime())
    };
}

module.exports = {
    handleJarvis,
    handleRazorpayWebhook,
    handleWhatsAppWebhook,
    getMetrics
};
