// ════════════════════════════════════════════════════════════════════
// ⚠️  LEGACY ENTRYPOINT — DO NOT USE IN PRODUCTION
// ════════════════════════════════════════════════════════════════════
// Canonical production entrypoint: backend/server.js
// Start command: npm start  →  node backend/server.js
//
// This file is retained ONLY during the retirement preparation period.
// It MUST NOT be started simultaneously with backend/server.js — both
// bind to PORT 5050 and will cause EADDRINUSE.
//
// Use npm run start:LEGACY-DO-NOT-USE only for isolated local debugging.
// Retirement checklist before deletion:
//   [x] startOnboardingCron() → covered by automationService._runOnboarding()
//   [x] env validation        → added to backend/server.js startup
//   [x] autonomous loop       → autonomousLoop.cjs (different module, backend owns it)
//   [ ] Final sign-off and file deletion
// ════════════════════════════════════════════════════════════════════
"use strict";
require("dotenv").config();

// ── Core stdlib ────────────────────────────────────────────────────
const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── npm packages ───────────────────────────────────────────────────
const express = require("express");
const cors    = require("cors");
const axios   = require("axios");
const cron    = require("node-cron");
const TelegramBot = require("node-telegram-bot-api");

// ── Core systems ───────────────────────────────────────────────────
const { checkEnv }      = require("./core/envCheck.cjs");
const logger            = require("./core/logger.cjs");
const { gateway }       = require("./core/gateway.cjs");
const orchestratorModule  = require("./orchestrator.cjs");
const schedulerModule     = require("./scheduler.cjs");
const commandParserModule = require("./commandParser.cjs");
const inputValidator    = require("./agents/security/inputValidator.cjs");

// ── Agents & utilities ─────────────────────────────────────────────
const { saveLead, updateLead, getLeads: getCRMLeads } = require("./agents/crm.cjs");
const { getLeads: getMapsLeads }   = require("./agents/leads.cjs");
const { createPaymentLink }        = require("./utils/payment.cjs");
const { sendWhatsApp }             = require("./utils/whatsapp.cjs");
const { followUpSequence }         = require("./agents/followUpSequence.cjs");
const { autoLoop }                 = require("./agents/autoLoop.cjs");
const { processInput }             = require("./agents/interactionPipeline.cjs");
const { route }                    = require("./agents/router.cjs");
const { processResponse }          = require("./agents/responsePipeline.cjs");
const notificationAgent            = require("./agents/interaction/notificationAgent.cjs");
const { AutoReplyAgent }           = require("./agents/autoReplyAgent.cjs");
const { SalesAgent }               = require("./agents/salesAgent.cjs");
const { InterestDetector }         = require("./agents/interestDetector.cjs");
const { PaymentAgent }             = require("./agents/paymentAgent.cjs");
const { FollowUpSystem }           = require("./agents/followUpSystem.cjs");
const { sendBulk }                 = require("./utils/bulkSender.cjs");
const saasRoutes                   = require("./agents/saas.cjs");

// ── Validate environment ───────────────────────────────────────────
checkEnv();

// ── App setup ──────────────────────────────────────────────────────
const app = express();

// Capture raw body for Razorpay HMAC verification BEFORE express.json parses it
app.use((req, res, next) => {
    if (req.url.startsWith("/webhook/razorpay") || req.url.startsWith("/razorpay-webhook")) {
        let raw = "";
        req.on("data", chunk => { raw += chunk; });
        req.on("end",  ()    => { req.rawBody = raw; next(); });
    } else {
        next();
    }
});

app.use(express.json({ limit: "10mb" }));
app.set("trust proxy", 1);
app.use(cors({ origin: "*", methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"] }));

// ── Agent instances ────────────────────────────────────────────────
const autoReply    = new AutoReplyAgent();
const salesAgent   = new SalesAgent();
const paymentAgent = new PaymentAgent();
const detector     = new InterestDetector();
const followUp     = new FollowUpSystem();

// ── Sub-routers ────────────────────────────────────────────────────
app.use("/saas", saasRoutes);

// ── Orchestrator exports ───────────────────────────────────────────
const {
    orchestrator,
    getMemoryState,
    clearMemoryState,
    contextEngine,
    learningSystem,
    voiceAgent,
    desktopAgent,
    agentFactory,
    evolutionEngine
} = orchestratorModule;

const {
    getScheduledTasks,
    cancelTask,
    getSchedulerStatus,
    clearAllTasks,
    getTask
} = schedulerModule;

const { parseCommand, executeCommand } = commandParserModule;

// ── In-memory command history ──────────────────────────────────────
const commandHistory = {
    commands: [],
    addCommand(cmd, parsed, result) {
        this.commands.push({
            command:   cmd,
            type:      parsed.type,
            timestamp: new Date(),
            success:   result.success
        });
        if (this.commands.length > 50) this.commands.shift();
    },
    getFrequency() {
        const freq = {};
        this.commands.forEach(c => { freq[c.type] = (freq[c.type] || 0) + 1; });
        return freq;
    },
    getSuggestions() {
        return Object.entries(this.getFrequency())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([type, count]) => ({ type, frequency: count, suggestion: `You often use ${type} (${count}x)` }));
    }
};

// ── AI reply (Groq primary, Ollama fallback) ───────────────────────
async function aiReply(message) {
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: "You are JARVIS, a helpful AI assistant. Be concise." },
                    { role: "user",   content: message }
                ],
                temperature: 0.7
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 15000
            }
        );
        return res.data.choices[0].message.content;
    } catch (groqErr) {
        logger.warn("Groq fallback to Ollama:", groqErr.message);
    }

    try {
        const res = await axios.post(
            "http://localhost:11434/api/generate",
            { model: "llama3", prompt: message, stream: false },
            { timeout: 10000 }
        );
        if (res.data?.response) return res.data.response;
    } catch { /* Ollama not running */ }

    return "AI backend unavailable. Please check GROQ_API_KEY in .env";
}

// ── Fulfillment after payment ──────────────────────────────────────
async function triggerFulfillment(phone) {
    logger.info("Triggering fulfillment for:", phone);
    await sendWhatsApp(
        phone,
        "Your JARVIS system is now ACTIVE!\n\n" +
        "Send any command and I'll execute it.\n\n" +
        "Examples:\n" +
        "• Open YouTube\n" +
        "• Search latest AI news\n" +
        "• Remind me to call client at 5pm"
    );
    updateLead(phone, {
        status:      "onboarded",
        onboardedAt: new Date().toISOString()
    });
}

// ── Telegram bot ───────────────────────────────────────────────────
const userState = {};

function startTelegramBot() {
    const token = process.env.TELEGRAM_TOKEN;
    if (!token) {
        logger.warn("TELEGRAM_TOKEN missing — Telegram bot disabled");
        return;
    }

    const bot = new TelegramBot(token, { polling: true });

    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;
        const text   = msg.text || "";

        if (!userState[chatId]) userState[chatId] = { step: "start" };
        const state = userState[chatId];

        if (text === "/start") {
            state.step = "menu";
            return bot.sendMessage(chatId, "Welcome to JARVIS AI!\n\nSend 1 to register");
        }

        if (state.step === "menu" && text === "1") {
            state.step = "name";
            return bot.sendMessage(chatId, "Enter your name:");
        }

        if (state.step === "name") {
            state.name = text;
            state.step = "phone";
            return bot.sendMessage(chatId, "Enter your WhatsApp number (with country code, e.g. 919876543210):");
        }

        if (state.step === "phone") {
            state.phone = text;
            saveLead({ chatId, name: state.name, phone: state.phone });
            await sendWhatsApp(state.phone, `Welcome ${state.name}! I'm JARVIS, your AI assistant.`);
            state.step = "confirm";
            return bot.sendMessage(chatId, "Type YES to continue to payment");
        }

        if (state.step === "confirm") {
            if (text.toLowerCase() !== "yes") return bot.sendMessage(chatId, "Type YES to continue");
            state.step = "payment";

            let payLink = "https://rzp.io/l/razorpay.me";
            try {
                const link = await createPaymentLink({ amount: 999, name: state.name, description: "JARVIS AI Access" });
                if (link) payLink = link;
            } catch { /* use static fallback */ }

            return bot.sendMessage(chatId,
                `Limited Offer - Rs.999\n\nJARVIS AI Automation System\n\nPay here:\n${payLink}\n\nAfter payment, type DONE`
            );
        }

        if (state.step === "payment" && text.toLowerCase() === "done") {
            state.step = "complete";
            updateLead(state.phone, { status: "pending_verification" });
            return bot.sendMessage(chatId, "Received! We'll verify and activate your account shortly.");
        }
    });

    bot.on("error", err => logger.error("Telegram error:", err.message));
    logger.info("Telegram bot started");
}

// ── Onboarding cron (daily 9am) ────────────────────────────────────
function startOnboardingCron() {
    cron.schedule("0 9 * * *", async () => {
        const leads = getCRMLeads();
        for (const lead of leads) {
            if (lead.status === "paid" && !lead.onboardingDone && lead.phone) {
                await sendWhatsApp(
                    lead.phone,
                    `Good morning ${lead.name || ""}!\n\nYour JARVIS system is ready. Reply with any command to get started.`
                );
                updateLead(lead.phone, { onboardingDone: true });
            }
        }
    });
}

// ══════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════

// ── Health & info ──────────────────────────────────────────────────
app.get("/", (req, res) => res.json({
    status:  "JARVIS running",
    version: "2.0",
    port:    process.env.PORT || 5050,
    uptime:  Math.round(process.uptime()) + "s"
}));

app.get("/test", (req, res) => res.json({ status: "OK", timestamp: new Date().toISOString() }));

app.get("/stats", (req, res) => {
    try {
        const leads = getCRMLeads();
        const paid  = leads.filter(l => l.status === "paid").length;
        const newl  = leads.filter(l => l.status === "new").length;
        const hot   = leads.filter(l => l.status === "hot").length;
        res.json({
            success: true,
            totalLeads: leads.length,
            newLeads:   newl,
            hotLeads:   hot,
            paidLeads:  paid,
            revenue:    paid * 999,
            conversionRate: leads.length > 0 ? ((paid / leads.length) * 100).toFixed(1) + "%" : "0%",
            uptime:    process.uptime(),
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── WhatsApp webhook ───────────────────────────────────────────────
app.get("/whatsapp/webhook", (req, res) => {
    const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || process.env.VERIFY_TOKEN || "jarvis_verify";
    const mode      = req.query["hub.mode"];
    const token     = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        logger.info("WhatsApp webhook verified");
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

app.post("/whatsapp/webhook", async (req, res) => {
    try {
        const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (message) {
            const phone = message.from;
            const text  = message.text?.body || "";
            logger.info(`WA incoming from ${phone}: ${text}`);
            await autoReply.handleIncoming(phone, text);
        }
        res.sendStatus(200);
    } catch (err) {
        logger.error("WA webhook error:", err.message);
        res.sendStatus(500);
    }
});

// ── CRM ────────────────────────────────────────────────────────────
app.get("/crm",       (req, res) => res.json(getCRMLeads()));
app.get("/crm-leads", (req, res) => res.json(getCRMLeads()));

app.get("/leads", async (req, res) => {
    const q    = req.query.q || "digital marketing agency india";
    const data = await getMapsLeads(q).catch(() => []);
    res.json(data);
});

app.post("/crm/lead", (req, res) => {
    const { phone, name, ...rest } = req.body;
    if (!phone) return res.status(400).json({ error: "phone required" });
    saveLead({ phone, name, ...rest });
    res.json({ success: true });
});

app.patch("/crm/lead/:phone", (req, res) => {
    updateLead(decodeURIComponent(req.params.phone), req.body);
    res.json({ success: true });
});

// ── Payment — Razorpay webhook (with HMAC verification) ───────────
app.post("/webhook/razorpay", async (req, res) => {
    try {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

        if (secret) {
            const sig    = req.headers["x-razorpay-signature"] || "";
            const body   = req.rawBody || JSON.stringify(req.body);
            const digest = crypto.createHmac("sha256", secret).update(body).digest("hex");
            if (sig !== digest) {
                logger.warn("Razorpay webhook: signature mismatch");
                return res.status(400).json({ error: "Invalid signature" });
            }
        }

        const payload = req.rawBody ? JSON.parse(req.rawBody) : req.body;
        const event   = payload?.event;

        if (event === "payment.captured") {
            const payment = payload.payload.payment.entity;
            const phone   = payment.contact || "";

            if (phone) {
                updateLead(phone, {
                    status:    "paid",
                    paymentId: payment.id,
                    paidAt:    new Date().toISOString()
                });
                await sendWhatsApp(phone, "Payment received! Activating your JARVIS system now...");
                await triggerFulfillment(phone);
            }
        }

        res.json({ status: "ok" });
    } catch (err) {
        logger.error("Razorpay webhook error:", err.message);
        res.sendStatus(500);
    }
});

// Backward-compatible alias
app.post("/razorpay-webhook", async (req, res) => {
    try {
        const event   = req.body?.event;
        const payment = req.body?.payload?.payment?.entity;
        if (event === "payment.captured" && payment) {
            const phone = payment.contact || "";
            if (phone) {
                updateLead(phone, { status: "paid", paymentId: payment.id });
                await sendWhatsApp(phone, "Payment received!");
                await triggerFulfillment(phone);
            }
        }
        res.sendStatus(200);
    } catch (err) {
        res.sendStatus(500);
    }
});

// ── Generate payment link on demand ───────────────────────────────
app.post("/payment/link", async (req, res) => {
    try {
        const { amount = 999, name = "Customer", description = "JARVIS Access", phone } = req.body;
        const link = await createPaymentLink({ amount, name, description });
        if (!link) return res.status(500).json({ error: "Failed to create payment link" });
        if (phone) await sendWhatsApp(phone, `Your payment link:\n${link}\n\nAmount: Rs.${amount}`);
        res.json({ success: true, link });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Send follow-up / bulk ──────────────────────────────────────────
app.post("/send-followup", async (req, res) => {
    const { phone, message, step } = req.body;
    if (phone) {
        await sendWhatsApp(phone, message || "Following up — any questions?");
        return res.json({ success: true });
    }
    try { await followUpSequence(); } catch { /* ignore */ }
    res.json({ success: true });
});

app.post("/start-automation", (req, res) => {
    res.json({ success: true, message: "Automation loop is already running (cron-based)" });
});

app.get("/bulk", async (req, res) => {
    await sendBulk("Limited offer! Join JARVIS AI now.").catch(() => {});
    res.json({ success: true });
});

// Dashboard revenue
app.get("/dashboard/revenue", (req, res) => {
    const leads = getCRMLeads();
    const paid  = leads.filter(l => l.status === "paid");
    res.json({ success: true, paid_customers: paid.length, revenue: paid.length * 999, currency: "INR" });
});

// ══════════════════════════════════════════════════════════════════
//  MAIN JARVIS GATEWAY  —  single, unified POST /jarvis
// ══════════════════════════════════════════════════════════════════
app.post("/jarvis", async (req, res) => {
    const traceId = Date.now().toString(36);
    try {
        // Accept { input }, { command }, or { message } for backward-compat
        const input = ((req.body.input || req.body.command || req.body.message) || "").trim();
        if (!input) return res.status(400).json({ success: false, error: "input or command is required" });

        // Mode: use explicit mode or auto-detect
        let mode = req.body.mode || "smart";

        if (mode === "smart") {
            if (/buy|price|demo|payment|pay/i.test(input))    mode = "sales";
            else if (/run|build|fix|execute|open|launch|search/i.test(input)) mode = "execution";
            else                                                mode = "intelligence";
        }

        // Intent classification
        let intent = "unknown";
        if (/buy|purchase|payment|pay/i.test(input))       intent = "payment";
        else if (/open|launch|start/i.test(input))          intent = "desktop";
        else if (/search|find|google/i.test(input))         intent = "search";
        else if (/remind|timer|schedule/i.test(input))      intent = "schedule";
        else if (/^(hello|hi|hey)/i.test(input))            intent = "greeting";
        else if (/lead|client|crm/i.test(input))            intent = "crm";
        else                                                 intent = "intelligence";

        let reply = "";

        // ── SALES mode ─────────────────────────────────────────────
        if (mode === "sales") {
            try {
                const salesReply = await salesAgent.handleIncoming?.(input, "api");
                if (salesReply) {
                    reply = salesReply;
                } else {
                    reply = "JARVIS automates your entire workflow end-to-end.";
                    if (/buy|pay|start/i.test(input)) {
                        const link = await createPaymentLink({ amount: 999, name: "Client", description: "JARVIS Access" }).catch(() => null);
                        reply = `Payment link:\n${link || "https://rzp.io/l/jarvis-ai"}\n\nAmount: Rs.999`;
                    }
                }
            } catch (err) {
                reply = "Sales system temporarily unavailable.";
            }
            return res.json({ success: true, traceId, reply, mode, intent });
        }

        // ── EXECUTION mode ─────────────────────────────────────────
        if (mode === "execution") {
            const parsed    = parseCommand(input);
            const cmdResult = await executeCommand(parsed);
            commandHistory.addCommand(input, parsed, cmdResult);
            reply = cmdResult.message || parsed.label || "Command executed";
            return res.json({ success: true, traceId, reply, mode, intent, parsed, cmdResult });
        }

        // ── INTELLIGENCE mode — full orchestrator ──────────────────
        try {
            const result = await gateway("smart", { input });
            reply = result?.reply || result?.response || "";
            if (!reply) reply = await aiReply(input);
            return res.json({ success: true, traceId, reply, mode, intent, ...result });
        } catch (orchErr) {
            logger.warn("Orchestrator failed, falling back to aiReply:", orchErr.message);
            reply = await aiReply(input);
            return res.json({ success: true, traceId, reply, mode, intent });
        }

    } catch (err) {
        logger.error("Jarvis gateway error:", err.message);
        res.json({ success: false, error: err.message, traceId });
    }
});

// ── Parse-command endpoint ─────────────────────────────────────────
app.post("/parse-command", async (req, res) => {
    try {
        const { command } = req.body;
        if (!command) return res.status(400).json({ error: "command required" });
        const parsed = parseCommand(command);
        const result = await executeCommand(parsed);
        commandHistory.addCommand(command, parsed, result);
        res.json({ success: true, input: command, parsed, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Memory ─────────────────────────────────────────────────────────
app.get("/memory", (req, res) => {
    try {
        const state = getMemoryState();
        res.json({ success: true, memory_state: state, short_term_count: state?.shortTerm?.length || 0, long_term_count: state?.longTerm?.length || 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/memory", (req, res) => {
    try { clearMemoryState(); res.json({ success: true, message: "Memory cleared" }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/memory/suggestions", (req, res) => res.json({ success: true, suggestions: commandHistory.getSuggestions() }));
app.get("/memory/frequency",   (req, res) => res.json({ success: true, frequency: commandHistory.getFrequency() }));
app.get("/memory/history", (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    res.json({ success: true, history: commandHistory.commands.slice(-limit).reverse() });
});

// ── Scheduler ──────────────────────────────────────────────────────
app.get("/scheduled",        (req, res) => { try { res.json({ success: true, tasks: getScheduledTasks() }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/scheduled/:id",    (req, res) => {
    const task = getTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json({ success: true, task });
});
app.delete("/scheduled/:id", (req, res) => { try { res.json(cancelTask(req.params.id)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.delete("/scheduled",     (req, res) => { try { res.json(clearAllTasks()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/scheduler/status", (req, res) => { try { res.json({ success: true, ...getSchedulerStatus() }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ── Learning ───────────────────────────────────────────────────────
app.get("/learning/stats",         (req, res) => { try { res.json({ success: true, ...learningSystem.getStats() }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/learning/habits",        (req, res) => { try { res.json({ success: true, habits: learningSystem.getUserHabits() }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/learning/patterns",      (req, res) => { try { res.json({ success: true, patterns: learningSystem.getPatterns(parseInt(req.query.limit) || 10) }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/learning/frequency",     (req, res) => { try { res.json({ success: true, frequency: learningSystem.getFrequency() }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/learning/success-rates", (req, res) => { try { res.json({ success: true, success_rates: learningSystem.getSuccessRate() }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/learning/suggestions",   (req, res) => { try { res.json({ success: true, suggestions: learningSystem.getSuggestions(req.query.prefix || "") }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/learning/optimizations", (req, res) => { try { res.json({ success: true, suggestions: learningSystem.getOptimizationSuggestions() }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.delete("/learning",            (req, res) => { try { learningSystem.clearLearning(); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ── Context ────────────────────────────────────────────────────────
app.get("/context/history", (req, res) => { try { res.json({ success: true, history: contextEngine.getLastConversations(parseInt(req.query.limit) || 10) }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/context/session",  (req, res) => { try { res.json({ success: true, session: contextEngine.getSessionStats() }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ── Voice ──────────────────────────────────────────────────────────
app.get("/voice/status", (req, res) => {
    try { res.json({ success: true, enabled: voiceAgent.voiceEnabled, platform: process.platform }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/voice/speak", async (req, res) => {
    try {
        const { text, rate, voice } = req.body;
        if (!text) return res.status(400).json({ error: "text required" });
        const result = await voiceAgent.speak(text, { rate, voice });
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Desktop ────────────────────────────────────────────────────────
app.get("/desktop/status",        (req, res) => { try { res.json({ success: true, ...desktopAgent.getStatus() }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post("/desktop/open-app",     async (req, res) => { try { const r = await desktopAgent.openApp(req.body.app); res.json(r); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post("/desktop/type",         async (req, res) => { try { const r = await desktopAgent.typeText(req.body.text, req.body.speed); res.json(r); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post("/desktop/press-key",    async (req, res) => { try { const r = await desktopAgent.pressKey(req.body.key); res.json(r); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post("/desktop/press-combo",  async (req, res) => { try { const r = await desktopAgent.pressKeyCombo(req.body.modifiers, req.body.key); res.json(r); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post("/desktop/move-mouse",   async (req, res) => { try { const r = await desktopAgent.moveMouse(req.body.x, req.body.y); res.json(r); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post("/desktop/click",        async (req, res) => { try { const r = await desktopAgent.click(req.body.button); res.json(r); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post("/desktop/double-click", async (req, res) => { try { const r = await desktopAgent.doubleClick(req.body.button); res.json(r); } catch (e) { res.status(500).json({ error: e.message }); } });

// ── Agent Factory ──────────────────────────────────────────────────
app.get("/agents/status",          (req, res) => { try { const a = agentFactory.listAgents(); res.json({ success: true, count: a.total, agents: a.agents }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/agents/list",            (req, res) => { try { const a = agentFactory.listAgents(); res.json({ success: true, total: a.total, agents: a.agents }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/agents/suggestions",     (req, res) => { try { res.json({ success: true, suggestions: agentFactory.suggestAgentCreation({ frequency: {} }) }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post("/agents/dynamic/create", async (req, res) => {
    try {
        const { name, type, spec } = req.body;
        if (!name || !type) return res.status(400).json({ error: "name and type required" });
        res.json(agentFactory.createAgent(name, type, spec || {}));
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/agents/:agentName/execute", async (req, res) => {
    try { res.json(await agentFactory.executeAgent(req.params.agentName, req.body.input)); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/agents/:agentName", (req, res) => { try { res.json(agentFactory.deleteAgent(req.params.agentName)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/agents/:agentName",    (req, res) => {
    try {
        const a = agentFactory.getAgent(req.params.agentName);
        if (!a.success) return res.status(404).json(a);
        res.json(a);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Evolution Engine ───────────────────────────────────────────────
app.get("/evolution/score",        (req, res) => { try { res.json({ success: true, ...evolutionEngine.getOptimizationScore() }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/evolution/approvals",    (req, res) => { try { const p = evolutionEngine.getPendingApprovals(); res.json({ success: true, pending: p, pending_count: p.length }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post("/evolution/approve/:id", async (req, res) => { try { res.json(await evolutionEngine.handleApproval(req.params.id, true)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post("/evolution/reject/:id",  (req, res) => { try { res.json(evolutionEngine.handleApproval(req.params.id, false)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/evolution/suggestions",  (req, res) => {
    try { res.json({ success: true, ...evolutionEngine.analyzeAndSuggest({ tasks: [], results: [], duration: 0 }) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 500 Master Agent System ────────────────────────────────────────
let masterAgentManager = null;

async function initializeMasterAgentManager() {
    try {
        const MasterAgentManager = require("./agents/MasterAgentManager.cjs");
        masterAgentManager = new MasterAgentManager();
        await masterAgentManager.initialize();
        logger.info("Master Agent Manager online — 500 agents active");
        return true;
    } catch (err) {
        logger.error("Master Agent Manager init failed:", err.message);
        return false;
    }
}

app.get("/agents/500/initialize", async (req, res) => {
    if (masterAgentManager?.initialized) return res.json({ success: true, status: "already_initialized" });
    const ok = await initializeMasterAgentManager();
    res.json({ success: ok, message: ok ? "500-agent system ready" : "Initialization failed" });
});
app.get("/agents/500/status", (req, res) => {
    if (!masterAgentManager) return res.json({ status: "not_initialized", message: "Call GET /agents/500/initialize first" });
    try { res.json({ success: true, stats: masterAgentManager.getSystemStatistics() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/agents/500/by-domain", (req, res) => {
    if (!masterAgentManager) return res.status(503).json({ error: "not initialized" });
    try { res.json({ success: true, agents: masterAgentManager.listAllAgents() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/agents/500/execute", async (req, res) => {
    if (!masterAgentManager) return res.status(503).json({ error: "not initialized — call /agents/500/initialize first" });
    try {
        const { task, collaborative } = req.body;
        if (!task) return res.status(400).json({ error: "task required" });
        const result = collaborative
            ? await masterAgentManager.executeTaskWithTeam(task, collaborative.numberOfAgents || 3)
            : await masterAgentManager.routeTask(task);
        res.json({ success: true, result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/agents/500/domain/:domain", async (req, res) => {
    if (!masterAgentManager) return res.status(503).json({ error: "not initialized" });
    try { res.json({ success: true, result: await masterAgentManager.routeTask(req.body.task, req.params.domain.toUpperCase()) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/agents/500/start-learning", async (req, res) => {
    if (!masterAgentManager) return res.status(503).json({ error: "not initialized" });
    try { await masterAgentManager.startContinuousLearning(); res.json({ success: true, message: "Continuous learning activated" }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/agents/500/:agentName", (req, res) => {
    if (!masterAgentManager) return res.status(503).json({ error: "not initialized" });
    const agent = masterAgentManager.getAgent(req.params.agentName);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    try { res.json({ success: true, agent: { name: agent.name, domain: agent.domain, status: agent.getStatus(), capabilities: agent.getCapabilities() } }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Auto-agent ─────────────────────────────────────────────────────
app.post("/auto-agent/schedule", async (req, res) => {
    try {
        const { command, delay = 5000 } = req.body;
        if (!command) return res.status(400).json({ error: "command required" });
        const parsed = parseCommand(command);
        const taskId = `auto_${Date.now()}`;
        setTimeout(async () => {
            const result = await executeCommand(parsed);
            commandHistory.addCommand(command, parsed, result);
        }, parseInt(delay));
        res.json({ success: true, taskId, delay });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/auto-agent/execute", async (req, res) => {
    try {
        const { command } = req.body;
        if (!command) return res.status(400).json({ error: "command required" });
        const parsed = parseCommand(command);
        const result = await executeCommand(parsed);
        commandHistory.addCommand(command, parsed, result);
        res.json({ success: true, result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/auto-agent/status", (req, res) => res.json({ success: true, status: "active", mode: "cron", scheduledTasks: getScheduledTasks().length }));

// ── Workflows ──────────────────────────────────────────────────────
const workflows = {};
app.post("/workflow/create", (req, res) => {
    const { name, steps } = req.body;
    if (!name || !steps) return res.status(400).json({ error: "name and steps required" });
    workflows[name] = { name, steps, createdAt: new Date(), executions: 0 };
    res.json({ success: true, workflow: workflows[name] });
});
app.post("/workflow/execute", async (req, res) => {
    const wf = workflows[req.body.name];
    if (!wf) return res.status(404).json({ error: "Workflow not found" });
    const results = [];
    for (const step of wf.steps) {
        const parsed = parseCommand(step.command || step);
        results.push(await executeCommand(parsed));
    }
    wf.executions++;
    res.json({ success: true, name: req.body.name, results });
});
app.get("/workflow/list", (req, res) => res.json({ success: true, workflows: Object.values(workflows) }));

// ── Predict ────────────────────────────────────────────────────────
app.post("/predict/next-commands", (req, res) => res.json({ success: true, predictions: commandHistory.getSuggestions() }));

// ── Top-50 agents (pass-through to agentFactory) ──────────────────
app.get("/agents/top-50", (req, res) => {
    try {
        const list = agentFactory.listAgents();
        res.json({ success: true, agents: (list.agents || []).slice(0, 50) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/agents/delegate", async (req, res) => {
    try {
        const { task } = req.body;
        if (!task) return res.status(400).json({ error: "task required" });
        const result = await agentFactory.executeAgent("auto", task);
        res.json({ success: true, result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Self-improve ───────────────────────────────────────────────────
app.get("/self-improve/analyze",    (req, res) => { try { res.json({ success: true, score: evolutionEngine.getOptimizationScore() }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/self-improve/evaluation", (req, res) => { try { res.json({ success: true, patterns: learningSystem.getPatterns(10) }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ── Global error handler ───────────────────────────────────────────
app.use((err, req, res, _next) => {
    logger.error("Unhandled error:", err.message);
    res.status(500).json({ error: "Internal server error", details: err.message });
});

// ── Process guards ─────────────────────────────────────────────────
process.on("uncaughtException",  err => logger.error("Uncaught exception:", err));
process.on("unhandledRejection", err => logger.error("Unhandled rejection:", err));

// ── Start ──────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 5050;
app.listen(PORT, () => {
    logger.info(`JARVIS Server running on http://localhost:${PORT}`);
    startTelegramBot();
    startOnboardingCron();
    autoLoop();
    initializeMasterAgentManager().catch(() => {});
});
