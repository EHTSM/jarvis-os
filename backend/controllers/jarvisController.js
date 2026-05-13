"use strict";
/**
 * Jarvis Controller — AI gateway pipeline.
 *
 * FLOW:
 *   input → sanitise → detectIntent → route: SALES | EXECUTION | INTELLIGENCE
 *
 *   SALES:       SalesAgent.scoreLead → paymentLink → WA send → followUp → CRM
 *   EXECUTION:   parseCommand → toolAgent → real OS action
 *   INTELLIGENCE: orchestrator → Groq fallback
 *
 *   WHATSAPP INCOMING:
 *     AutoReplyAgent → pipeline → reply back
 *
 * Response shape: { success, reply, intent, action, mode, data }
 */

const logger      = require("../utils/logger");
const errTracker  = require("../utils/errorTracker");
const parser      = require("../utils/parser");
const metricsStore = require("../utils/metricsStore");
const toolAgent   = require("../../agents/toolAgent.cjs");
const ai          = require("../services/aiService");
const wa          = require("../services/whatsappService");
const payment     = require("../services/paymentService");
const crm         = require("../services/crmService");
const automation  = require("../services/automationService");

// ── Load agents (graceful — system still works if any fail) ──────
let SalesAgent, InterestDetector, FollowUpSystem, AutoReplyAgent;

try { ({ SalesAgent }       = require("../../agents/salesAgent.cjs"));       } catch { SalesAgent       = null; }
try { ({ InterestDetector } = require("../../agents/interestDetector.cjs")); } catch { InterestDetector = null; }
try { ({ FollowUpSystem }   = require("../../agents/followUpSystem.cjs"));   } catch { FollowUpSystem   = null; }
try { ({ AutoReplyAgent }   = require("../../agents/autoReplyAgent.cjs"));   } catch { AutoReplyAgent   = null; }

const _salesAgent = SalesAgent      ? new SalesAgent()       : null;
const _detector   = InterestDetector ? new InterestDetector() : null;
const _followUp   = FollowUpSystem   ? new FollowUpSystem()   : null;
const _autoReply  = AutoReplyAgent   ? new AutoReplyAgent()   : null;

// ── Load orchestrator (graceful fallback to direct AI) ───────────
let _orchestrator = null;
try { _orchestrator = require("../../orchestrator.cjs"); } catch { /* AI fallback */ }

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
// ════════════════════════════════════════════════════════════════
async function _salesPipeline(input, phone) {
    let reply     = "";
    let payLink   = null;
    let leadScore = 0;
    let isHot     = false;

    if (_salesAgent?.scoreLead)  leadScore = _salesAgent.scoreLead(input.toLowerCase());
    if (_detector?.isHot)        isHot     = _detector.isHot(input);

    try {
        if (_salesAgent?.generateReply) reply = await _salesAgent.generateReply(input) || "";
    } catch { /* silent */ }

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
            metricsStore.inc("paymentLinks");
            reply = (reply ? reply + "\n\n" : "") +
                `Payment link ready:\n${payLink}\n\nAmount: ₹999\n\nPay now to activate JARVIS immediately.`;

            if (phone) {
                const waR = await wa.sendMessage(phone, `Your payment link:\n${payLink}\n\nAmount: ₹999`);
                if (waR.success) metricsStore.inc("waSent");
            }
        } else {
            reply = (reply ? reply + "\n\n" : "") +
                "Ready to start! Reply with your name and I'll generate your payment link.";
        }

        if (phone) crm.updateLead(phone, { status: "hot", lastMessage: input });
    }

    if (!reply) {
        reply = "JARVIS AI automates your entire business — leads, replies, payments, follow-ups.\n\nType 'yes' or 'buy' to get started.";
    }

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
// ════════════════════════════════════════════════════════════════
let _sysMonitor = null;
function _getSysMonitor() {
    if (!_sysMonitor) { try { _sysMonitor = require("../../agents/automation/systemMonitor.cjs"); } catch { _sysMonitor = null; } }
    return _sysMonitor;
}

const _UNIT_TO_MS = { minute: 60_000, min: 60_000, second: 1_000, sec: 1_000, hour: 3_600_000 };

function _scheduleTimerAlert(phone, delayMs, label) {
    setTimeout(async () => {
        try {
            const msg = `⏰ Time's up! ${label}`;
            if (phone) await wa.sendMessage(phone, msg);
            else       logger.info(`[Timer] Fired: ${label}`);
        } catch { /* non-critical */ }
    }, delayMs).unref();
}

async function _executionPipeline(input, phone = "") {
    const parsed = parser.parseCommand(input);

    if (parsed.type === "get_leads") {
        const leads   = crm.getLeads();
        const real    = leads.filter(l => l.phone && l.phone !== "null");
        const summary = real.slice(0, 5).map(l => `• ${l.name || "Lead"} — ${l.phone} — ${l.status}`).join("\n");
        return {
            reply:  `${real.length} lead(s) in CRM.\n\n` + (summary || "No leads with phone numbers yet."),
            action: "get_leads",
            data:   { leads: real, total: leads.length }
        };
    }

    if (parsed.type === "payment") {
        const result = await payment.createPaymentLink({ amount: 999, name: "Customer", description: "JARVIS Access" });
        metricsStore.inc("paymentLinks");
        return {
            reply:  result.success ? `Payment link:\n${result.link}` : `Payment error: ${result.error}`,
            action: "payment_link",
            data:   result
        };
    }

    logger.info(`[Exec] tool=${parsed.type} action=${parsed.action || "-"} label="${parsed.label || "-"}"`);
    const toolResult = await toolAgent.execute(parsed);
    if (toolResult) {
        _getSysMonitor()?.record({ type: parsed.type, source: "execution" }, { success: toolResult.success !== false });

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

    logger.info(`[Exec→Intel] escalating unknown type="${parsed.type}" — "${input.slice(0, 60)}"`);
    return _intelligencePipeline(input, []);
}

// ════════════════════════════════════════════════════════════════
//  PIPELINE 3 — INTELLIGENCE FLOW
// ════════════════════════════════════════════════════════════════
async function _intelligencePipeline(input, history) {
    if (_orchestrator?.gateway) {
        try {
            const result = await _orchestrator.gateway("smart", { input });
            const reply  = result?.reply || result?.response || "";
            if (reply) return { reply, action: "orchestrator", data: result };
        } catch (err) {
            logger.warn("[Intel] Orchestrator failed:", err.message);
        }
    }

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
    metricsStore.inc("requests");
    res.setHeader("x-trace-id", traceId);

    // Note: rate limiting applied upstream in routes/jarvis.js via rateLimiter middleware.

    let intent, mode;
    try {
        const input   = _clean(req.body.input  || req.body.command || req.body.message || "");
        const phone   = _clean(req.body.phone  || "");
        const history = Array.isArray(req.body.history) ? req.body.history.slice(-10) : [];

        if (!input) {
            return res.status(400).json({ success: false, reply: "Input is required.", traceId });
        }

        intent = parser.detectIntent(input);
        metricsStore.trackIntent(intent);

        mode = _clean(req.body.mode || "smart");
        if (mode === "smart") {
            if (/\b(buy|pay|price|demo|purchase|payment|cost|interested|yes)\b/i.test(input)) mode = "sales";
            else if (/\s+(and|then)\s+.{4,}|\s*;\s*.{4,}|\s*\+\s*.{4,}/i.test(input)) mode = "intelligence";
            else if (/\b(open|launch|search|find|type|note|remind|timer|get leads|calendar)\b/i.test(input) || /^(press|copy|paste|select all)(\s|$)/i.test(input)) mode = "execution";
            else mode = "intelligence";
        }
        metricsStore.trackMode(mode);

        logger.info(`[Jarvis] ${traceId} | mode=${mode} | intent=${intent} | "${input.slice(0, 60)}"`);

        if (phone) {
            const existing = crm.getLead(phone);
            if (!existing) crm.saveLead({ phone, lastMessage: input });
            else crm.updateLead(phone, { lastMessage: input, lastInteraction: new Date().toISOString() });
        }

        let result;
        if      (mode === "sales")     result = await _salesPipeline(input, phone);
        else if (mode === "execution") result = await _executionPipeline(input, phone);
        else                           result = await _intelligencePipeline(input, history);

        const elapsed = Date.now() - startMs;
        metricsStore.recordLatency(mode, elapsed);
        logger.debug(`[Jarvis] ${traceId} done in ${elapsed}ms`);
        return _ok(res, { ...result, intent, mode, traceId });

    } catch (err) {
        metricsStore.inc("errors");
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
//  WHATSAPP INCOMING WEBHOOK
//  Stays here — reuses _salesPipeline and _executionPipeline.
// ════════════════════════════════════════════════════════════════
async function handleWhatsAppWebhook(req, res) {
    res.sendStatus(200);  // WA requires fast ack
    const _waStart = Date.now();

    try {
        const msg = wa.parseIncomingMessage(req.body);
        if (!msg || !msg.text) return;

        const { phone, text } = msg;
        logger.info(`[WA] Incoming from ${phone}: ${text}`);

        const existing = crm.getLead(phone);
        if (!existing) crm.saveLead({ phone, lastMessage: text });
        else crm.updateLead(phone, { lastMessage: text, lastInteraction: new Date().toISOString() });

        let reply = "";
        if (/\b(buy|pay|price|cost|interested|yes|start)\b/i.test(text)) {
            const result = await _salesPipeline(text, phone);
            reply = result.reply;
        } else if (/\b(open|search|find|remind|timer)\b/i.test(text)) {
            const result = await _executionPipeline(text, phone);
            reply = result.reply;
        } else if (_autoReply) {
            reply = await _autoReply.generateReply(text);
        } else {
            reply = await ai.callAI(text);
        }

        if (reply) {
            logger.info(`[WA] Sending reply to ${phone} — "${reply.slice(0, 60)}"`);
            const waR = await wa.sendMessage(phone, reply);
            if (waR.success) metricsStore.inc("waSent");
            else logger.warn(`[WA] Send failed: ${waR.error}`);
        }

        metricsStore.recordLatency("whatsapp", Date.now() - _waStart);
    } catch (err) {
        errTracker.record("whatsapp_webhook", err.message);
        logger.error("[WA] Incoming handler error:", err.message);
    }
}

// ════════════════════════════════════════════════════════════════
//  METRICS — delegates to metricsStore, merges CRM stats
// ════════════════════════════════════════════════════════════════
function getMetrics() {
    const snap     = metricsStore.getSnapshot();
    const crmStats = crm.getStats();
    return {
        ...snap,
        crm:            crmStats,
        conversionRate: crmStats.conversionRate,
    };
}

module.exports = { handleJarvis, handleWhatsAppWebhook, getMetrics };
