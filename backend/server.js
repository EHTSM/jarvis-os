"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

// ── Centralized env validation ────────────────────────────────────
// Each service declares its required keys. Missing required = DEGRADED.
// Missing optional = feature disabled, logged once at startup.
const ENV_SERVICES = {
    ai:       { vars: ["GROQ_API_KEY"],                          required: true  },
    telegram: { vars: ["TELEGRAM_TOKEN"],                        required: true  },
    payments: { vars: ["RAZORPAY_KEY","RAZORPAY_SECRET"],        required: false },
    whatsapp: { vars: ["WA_TOKEN","WA_PHONE_ID"],                required: false },
    firebase: { vars: ["FIREBASE_PROJECT_ID"],                   required: false },
    maps:     { vars: ["GOOGLE_API"],                            required: false },
};

// _svcStatus: live service capability flags — queried by /health and /ops
const _svcStatus = {};
const _missingRequired = [];
for (const [svc, cfg] of Object.entries(ENV_SERVICES)) {
    const missing = cfg.vars.filter(k => !process.env[k]);
    _svcStatus[svc] = missing.length === 0;
    if (missing.length > 0) {
        if (cfg.required) {
            _missingRequired.push(...missing);
            console.warn(`[Startup] REQUIRED env missing — ${svc} DISABLED: ${missing.join(", ")}`);
        } else {
            console.info(`[Startup] Optional env not set — ${svc} disabled: ${missing.join(", ")}`);
        }
    }
}
if (_missingRequired.length) {
    console.warn(`[Startup] ${_missingRequired.length} required var(s) missing — core degraded`);
}

const express    = require("express");
const cors       = require("cors");
const path       = require("path");
const TelegramBot = require("node-telegram-bot-api");

const logger      = require("./utils/logger");
const errTracker  = require("./utils/errorTracker");
const memTracker  = require("./utils/memoryTracker");
const routes      = require("./routes/jarvis");
const crm        = require("./services/crmService");
const payment    = require("./services/paymentService");
const wa         = require("./services/whatsappService");
const automation = require("./services/automationService");

const app = express();

// ── Raw body capture (Razorpay HMAC) ──────────────────────────────
app.use((req, res, next) => {
    if (req.url.includes("/webhook/razorpay") || req.url.includes("/razorpay-webhook")) {
        let raw = "";
        req.on("data", chunk => { raw += chunk; });
        req.on("end",  ()    => { req.rawBody = raw; next(); });
    } else {
        next();
    }
});

// ── Middleware ─────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.set("trust proxy", 1);
app.use(cors({ origin: "*", methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"] }));

// ── Structured request logging ────────────────────────────────────
// Skips OPTIONS (CORS preflight) and high-frequency health/metrics polls
// to keep logs readable in production. Records method, path, status, ms, IP.
const _SKIP_LOG_PATHS = new Set(["/health", "/test", "/metrics", "/"]);
app.use((req, res, next) => {
    if (req.method === "OPTIONS" || _SKIP_LOG_PATHS.has(req.path)) return next();
    const _t0 = Date.now();
    res.on("finish", () => {
        const ms  = Date.now() - _t0;
        const ip  = req.ip || req.socket?.remoteAddress || "-";
        const msg = `${req.method} ${req.path} ${res.statusCode} ${ms}ms ${ip}`;
        if (res.statusCode >= 500) logger.error(`[HTTP] ${msg}`);
        else if (res.statusCode >= 400) logger.warn(`[HTTP] ${msg}`);
        else logger.info(`[HTTP] ${msg}`);
    });
    next();
});

// ── Mount all routes ───────────────────────────────────────────────
app.use(routes);

// ── Mount legacy routes (orchestrator, scheduler, voice, desktop, agents, etc.) ──
try {
    app.use(require("./routes/legacy"));
} catch (err) {
    logger.warn("[Legacy] Routes unavailable:", err.message);
}

// ── Serve frontend build in production ────────────────────────────
const frontendBuild = path.join(__dirname, "../frontend/build");
try {
    if (require("fs").existsSync(frontendBuild)) {
        app.use(express.static(frontendBuild));
        app.get("*", (req, res) => res.sendFile(path.join(frontendBuild, "index.html")));
        logger.info("Serving frontend build from /frontend/build");
    }
} catch { /* no build yet — that's ok in dev */ }

// ── Global error handler ───────────────────────────────────────────
app.use((err, req, res, _next) => {
    logger.error("Unhandled error:", err.message);
    res.status(500).json({ success: false, error: "Internal server error", details: err.message });
});

// ── Process guards + graceful shutdown ────────────────────────────
let _autoLoopRef    = null;  // set after startup
let _httpServer     = null;  // set after listen()
let _shuttingDown   = false;

function _gracefulShutdown(signal) {
    if (_shuttingDown) return;
    _shuttingDown = true;
    logger.info(`[Shutdown] ${signal} received — stopping services`);

    // 1. Stop accepting new HTTP connections
    if (_httpServer) {
        _httpServer.close(() => logger.info("[Shutdown] HTTP server closed"));
    }

    // 2. Stop the autonomous task loop
    try { if (_autoLoopRef) _autoLoopRef.stop(); } catch { /* ignore */ }

    // 3. Stop automation cron jobs
    try { automation.stop(); } catch { /* ignore */ }

    // 4. Stop memory sampler
    try { memTracker.stop(); } catch { /* ignore */ }

    // 5. Give in-flight work 5 s to drain, then exit
    setTimeout(() => {
        logger.info("[Shutdown] Clean exit");
        process.exit(0);
    }, 5_000).unref();
}

// uncaughtException: state is unknown — log, record, exit so PM2 restarts cleanly.
process.on("uncaughtException", (err) => {
    // Startup guard: EADDRINUSE means another process owns the port — fail fast
    // with a clear message rather than looping in PM2 restarts.
    if (err.code === "EADDRINUSE") {
        logger.error(`[Startup] FATAL: Port ${err.port || PORT} is already in use.`);
        logger.error(`[Startup] Kill the existing process first: lsof -nP -iTCP:${err.port || PORT}`);
        process.exit(1);
    }
    errTracker.record("uncaughtException", err.message || String(err));
    logger.error("FATAL uncaughtException — exiting for clean restart:");
    logger.error(err.stack || err.message || String(err));
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 200);
});

// unhandledRejection: usually recoverable — log and continue.
process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.stack : String(reason);
    errTracker.record("unhandledRejection", msg);
    logger.error(`Unhandled promise rejection: ${msg}`);
});

// SIGTERM: PM2/systemd graceful stop.
process.on("SIGTERM", () => _gracefulShutdown("SIGTERM"));

// SIGINT: Ctrl+C in dev.
process.on("SIGINT",  () => _gracefulShutdown("SIGINT"));

// SIGUSR2: nodemon restart — treat same as graceful shutdown.
process.on("SIGUSR2", () => _gracefulShutdown("SIGUSR2"));

// ── Telegram Bot ───────────────────────────────────────────────────
// userState is capped to prevent unbounded growth from unique Telegram chat IDs.
const MAX_USER_STATE = 500;
const userState = {};
function startTelegramBot() {
    const token = process.env.TELEGRAM_TOKEN;
    if (!token) { logger.warn("[Telegram] TELEGRAM_TOKEN not set — bot disabled"); return; }

    const bot = new TelegramBot(token, { polling: true });

    // Catch polling errors (401 = bad token, 409 = conflict with another bot instance).
    // Log and disable rather than crashing — these are config errors, not runtime bugs.
    bot.on("polling_error", (err) => {
        const code = err?.response?.statusCode || err?.code;
        if (code === 401) {
            logger.error("[Telegram] Invalid token (401) — polling stopped. Check TELEGRAM_TOKEN in .env");
            bot.stopPolling();
        } else if (code === 409) {
            logger.warn("[Telegram] Conflict (409) — another instance is polling. Stopping this one.");
            bot.stopPolling();
        } else {
            logger.warn(`[Telegram] Polling error (${code}): ${err.message}`);
        }
    });

    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;
        const text   = msg.text || "";
        if (!userState[chatId]) {
            // Evict oldest entry when cap is reached
            const keys = Object.keys(userState);
            if (keys.length >= MAX_USER_STATE) delete userState[keys[0]];
            userState[chatId] = { step: "start" };
        }
        const state = userState[chatId];

        if (text === "/start") {
            state.step = "menu";
            return bot.sendMessage(chatId, "Welcome to JARVIS AI!\n\nSend 1 to register");
        }
        if (state.step === "menu" && text === "1") {
            state.step = "name";
            return bot.sendMessage(chatId, "Your name:");
        }
        if (state.step === "name") {
            state.name = text; state.step = "phone";
            return bot.sendMessage(chatId, "Your WhatsApp number (with country code, e.g. 919876543210):");
        }
        if (state.step === "phone") {
            state.phone = text;
            crm.saveLead({ phone: state.phone, name: state.name, chatId });
            await wa.sendMessage(state.phone, `Welcome ${state.name}! I'm JARVIS AI.`);
            state.step = "confirm";
            return bot.sendMessage(chatId, "Type YES to continue");
        }
        if (state.step === "confirm") {
            if (text.toLowerCase() !== "yes") return bot.sendMessage(chatId, "Type YES to continue");
            state.step = "payment";
            let payLink = process.env.PAYMENT_FALLBACK_LINK || "https://rzp.io/l/jarvis-ai";
            try {
                const r = await payment.createPaymentLink({ amount: 999, name: state.name, phone: state.phone, description: "JARVIS AI Access" });
                if (r.success) payLink = r.link;
            } catch { /* use static */ }
            return bot.sendMessage(chatId, `Limited offer — ₹999\n\nJARVIS AI Automation\n\nPay here:\n${payLink}\n\nAfter payment type DONE`);
        }
        if (state.step === "payment" && text.toLowerCase() === "done") {
            state.step = "complete";
            crm.updateLead(state.phone, { status: "pending_verification" });
            return bot.sendMessage(chatId, "Received! Verifying payment and activating your account shortly.");
        }
    });
    bot.on("error", err => logger.error("[Telegram] Error:", err.message));
    logger.info("[Telegram] Bot started");
}

// ── Startup ────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 5050;
_httpServer = app.listen(PORT, () => {
    logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.info(` JARVIS OS v3.0 — http://localhost:${PORT}`);
    logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.info(` POST /jarvis          — main gateway`);
    logger.info(` POST /webhook/razorpay — payment webhook`);
    logger.info(` POST /whatsapp/webhook — WA messages`);
    logger.info(` GET  /stats           — CRM + revenue`);
    logger.info(` POST /simulate/full-flow — test pipeline`);
    logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    memTracker.start();
    startTelegramBot();
    automation.start();

    // ── Autonomous task loop ───────────────────────────────────────
    try {
        _autoLoopRef = require("../agents/autonomousLoop.cjs");
        _autoLoopRef.start();
        logger.info("[AutoLoop] autonomous task loop running");
    } catch (err) {
        logger.warn("[AutoLoop] failed to start:", err.message);
    }

    // ── Queue persistence integrity check ────────────────────────
    // Verify the queue file is valid JSON before the loop reads it.
    // If corrupted, back it up and reset so the system can start clean.
    try {
        const fs        = require("fs");
        const queueFile = require("path").join(__dirname, "../data/task-queue.json");
        if (fs.existsSync(queueFile)) {
            try {
                JSON.parse(fs.readFileSync(queueFile, "utf8"));
            } catch {
                const backup = queueFile + ".bak." + Date.now();
                fs.copyFileSync(queueFile, backup);
                fs.writeFileSync(queueFile, "[]");
                logger.warn(`[Startup] task-queue.json was corrupt — reset to [] (backup: ${backup})`);
            }
        }
    } catch (qErr) {
        logger.warn("[Startup] Queue integrity check failed:", qErr.message);
    }

    // ── Startup diagnostics ───────────────────────────────────────
    try {
        const envOk    = _missingRequired.length === 0;
        const leads    = crm.getLeads ? crm.getLeads().length : "?";
        let   queueLen = "?";
        try {
            const tq = require("../agents/taskQueue.cjs");
            tq.recoverStale();
            tq.pruneOldTasks(50);
            const all = tq.getAll();
            queueLen = `${all.filter(t => t.status === "pending").length} pending / ${all.length} total`;
        } catch { /* queue unavailable */ }

        logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        logger.info(` Startup Diagnostics`);
        logger.info(`  env        : ${envOk ? "OK" : "DEGRADED — missing: " + _missingRequired.join(", ")}`);
        logger.info(`  crm leads  : ${leads}`);
        logger.info(`  task queue : ${queueLen}`);
        logger.info(`  automation : follow-ups + onboarding + upsell`);
        logger.info(`  auto loop  : task execution every 10s`);
        logger.info(`  ai         : ${_svcStatus.ai       ? "enabled" : "DISABLED"}`);
        logger.info(`  telegram   : ${_svcStatus.telegram  ? "enabled" : "DISABLED"}`);
        logger.info(`  whatsapp   : ${_svcStatus.whatsapp  ? "enabled" : "disabled (WA_TOKEN not set)"}`);
        logger.info(`  payments   : ${_svcStatus.payments  ? "enabled" : "disabled (RAZORPAY_KEY not set)"}`);
        if (!process.env.BASE_URL) {
            logger.warn(`[Startup] WARNING: BASE_URL not set — Razorpay webhook callback will use localhost.`);
            logger.warn(`[Startup]          Set BASE_URL=https://yourdomain.com in .env for payments to work.`);
        }
        logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    } catch (diagErr) {
        logger.warn("[Startup] Diagnostics failed:", diagErr.message);
    }

    // ── Periodic maintenance ──────────────────────────────────────
    // Prune completed/failed tasks every 6 hours to keep queue file small
    setInterval(() => {
        try {
            const tq = require("../agents/taskQueue.cjs");
            tq.pruneOldTasks(50);
        } catch { /* non-critical */ }
    }, 6 * 3_600_000).unref();
});
