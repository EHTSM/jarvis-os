"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

// ── Centralized env validation ────────────────────────────────────
// Each service declares its required keys. Missing required = DEGRADED.
// Missing optional = feature disabled, logged once at startup.
const ENV_SERVICES = {
    ai:       { vars: ["GROQ_API_KEY"],          required: true  },
    telegram: { vars: ["TELEGRAM_TOKEN"],         required: false },
    firebase: { vars: ["FIREBASE_PROJECT_ID"],    required: false },
    maps:     { vars: ["GOOGLE_API"],             required: false },
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
// Services with dual naming — check both variants so .env.example and whatsappService.js stay in sync
const _rzKey = process.env.RAZORPAY_KEY || process.env.RAZORPAY_KEY_ID;
const _rzSec = process.env.RAZORPAY_SECRET || process.env.RAZORPAY_KEY_SECRET;
_svcStatus.payments = !!(_rzKey && _rzSec);
if (!_svcStatus.payments) console.info("[Startup] Optional env not set — payments disabled: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET");

const _waToken   = process.env.WA_TOKEN   || process.env.WHATSAPP_TOKEN;
const _waPhoneId = process.env.WA_PHONE_ID || process.env.PHONE_NUMBER_ID;
_svcStatus.whatsapp = !!(_waToken && _waPhoneId);
if (!_svcStatus.whatsapp) console.info("[Startup] Optional env not set — whatsapp disabled: WHATSAPP_TOKEN / PHONE_NUMBER_ID");
if (_missingRequired.length) {
    console.warn(`[Startup] ${_missingRequired.length} required var(s) missing — core degraded`);
}

// ── Auth env validation (production hard requirement) ─────────────
// In production, JWT_SECRET and OPERATOR_PASSWORD_HASH are REQUIRED.
// Without them, all /auth/* and /runtime/* routes return 503 and the
// operator console is completely inaccessible.
_svcStatus.auth = !!(process.env.JWT_SECRET && process.env.OPERATOR_PASSWORD_HASH);
if (process.env.NODE_ENV === "production") {
    if (!process.env.JWT_SECRET) {
        console.error("[Startup] FATAL (production): JWT_SECRET is not set.");
        console.error("[Startup]   Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
        console.error("[Startup]   Auth routes will return 503 until this is set.");
    }
    if (!process.env.OPERATOR_PASSWORD_HASH) {
        console.error("[Startup] FATAL (production): OPERATOR_PASSWORD_HASH is not set.");
        console.error("[Startup]   Generate: node scripts/generate-password-hash.cjs <your-password>");
        console.error("[Startup]   Login will return 503 until this is set.");
    }
    if (!_svcStatus.auth) {
        console.error("[Startup] Operator console is INACCESSIBLE — set JWT_SECRET and OPERATOR_PASSWORD_HASH in .env and restart.");
    }
} else if (!_svcStatus.auth) {
    console.info("[Startup] Auth env not set — using dev passthrough (non-production mode)");
}

const express    = require("express");
const cors       = require("cors");
const path       = require("path");
const TelegramBot = require("node-telegram-bot-api");

const logger      = require("./utils/logger");
const errTracker  = require("./utils/errorTracker");
const memTracker  = require("./utils/memoryTracker");
const routes      = require("./routes/index");
const crm        = require("./services/crmService");
const payment    = require("./services/paymentService");
const wa         = require("./services/whatsappService");
const automation = require("./services/automationService");
// Apply any in-app credential overrides saved via /settings/* before routes start
try { require("./routes/settings").applyPersistedSettings(); } catch { /* non-critical */ }
// Bootstrap the operator account into the identity system (idempotent)
try { require("./services/accountService").bootstrapOperatorAccount(); } catch { /* non-critical */ }

const app = express();

// ── Raw body capture (Razorpay HMAC) — must be before express.json() ──
app.use(require("./middleware/rawBody"));

// ── Middleware ─────────────────────────────────────────────────────
app.use(require("./middleware/requestId"));   // x-request-id on every request
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.set("trust proxy", 1);
app.disable("x-powered-by");   // don't advertise Express
// Honour explicit flag for automated security audits
if (process.env.DISABLE_X_POWERED_BY === "1") app.disable("x-powered-by");

// ── helmet-equivalent security headers (manual — no extra dep) ─────
// helmet() middleware behaviour replicated: X-Content-Type-Options,
// X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy,
// Content-Security-Policy, Strict-Transport-Security.
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options",    "nosniff");
    res.setHeader("X-Frame-Options",           "DENY");
    res.setHeader("X-XSS-Protection",          "1; mode=block");
    res.setHeader("Referrer-Policy",           "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy",        "camera=(), microphone=(), geolocation=()");
    // CSP — allows same-origin scripts + Firebase Auth domains required for
    // Google Sign-In popup and Phone OTP reCAPTCHA.
    // Domains sourced from: index.html (GTM, GA4, Clarity), Firebase SDK (apis.google.com,
    // gstatic.com, identitytoolkit, securetoken), Phone OTP (recaptcha.net), Google OAuth popup.
    const CSP_SCRIPT  = "https://apis.google.com https://www.gstatic.com https://www.googleapis.com https://www.google.com https://www.recaptcha.net https://www.googletagmanager.com https://www.clarity.ms";
    // connect-src: add www.google.com (reCAPTCHA token XHR), www.gstatic.com (reCAPTCHA assets),
    // recaptchaenterprise.googleapis.com (Enterprise init attempted before v2 fallback)
    const CSP_CONNECT = "https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://recaptchaenterprise.googleapis.com https://www.google.com https://www.gstatic.com https://www.googletagmanager.com https://www.clarity.ms";
    const CSP_FRAME   = "https://ooplix-jarvis.firebaseapp.com https://www.google.com https://www.recaptcha.net https://www.googletagmanager.com";
    const csp = process.env.NODE_ENV === "production"
        ? `default-src 'self'; script-src 'self' 'unsafe-inline' ${CSP_SCRIPT}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: https://www.gstatic.com; connect-src 'self' https: ${CSP_CONNECT}; frame-src ${CSP_FRAME}; frame-ancestors 'none';`
        : "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; frame-ancestors 'none';";
    res.setHeader("Content-Security-Policy", csp);
    if (process.env.NODE_ENV === "production") {
        res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    }
    next();
});

// CORS: allow credentials (httpOnly cookies) only from explicitly listed origins.
// origin:"*" silently breaks credentials:include in browsers — use allowlist instead.
// Production domains are always included; ALLOWED_ORIGINS env var adds extras (e.g. localhost in dev).
const _PRODUCTION_ORIGINS = [
    "https://ooplix.com",
    "https://www.ooplix.com",
    "https://app.ooplix.com",
    "https://api.ooplix.com",
];
const _envOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
const _allowedOrigins = [...new Set([..._PRODUCTION_ORIGINS, ..._envOrigins])];
app.use(cors({
    origin: (origin, cb) => {
        // Allow same-origin requests (origin === undefined in server-to-server or
        // same-origin fetches) and any listed origin.
        if (!origin || _allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
    methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
}));

// ── Structured request logging ────────────────────────────────────
app.use(require("./middleware/requestLogger"));

// ── Mount all routes ───────────────────────────────────────────────
app.use(routes);

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
    if (err.type === "entity.parse.failed") {
        return res.status(400).json({ success: false, error: "Invalid JSON body" });
    }
    if (err.type === "entity.too.large" || err.status === 413) {
        return res.status(413).json({ success: false, error: "Payload too large" });
    }
    logger.error("Unhandled error:", err.message);
    res.status(500).json({ success: false, error: "Internal server error", details: err.message });
});

// ── Runtime alerting ──────────────────────────────────────────────
// Sends a Telegram message to TELEGRAM_OPERATOR_CHAT_ID.
// Fire-and-forget: never throws, never blocks the main process.
// Falls back to a local alert log when chatId is not configured.
const _ALERT_LOG = require("path").join(__dirname, "../data/runtime-alerts.log");

function _runtimeAlert(emoji, title, lines = []) {
    const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID;
    const ts     = new Date().toISOString();
    const text   = [
        `${emoji} <b>JARVIS — ${title}</b>`,
        ...lines,
        `<i>${ts}</i>`,
    ].join("\n");

    // Always append to local alert log regardless of Telegram outcome
    try {
        const logLine = `[${ts}] ${emoji} ${title} | ${lines.join(" | ")}\n`;
        require("fs").appendFileSync(_ALERT_LOG, logLine);
    } catch { /* non-critical */ }

    if (!chatId) return;  // no operator chat ID — local log is the only channel

    try {
        const tg = require("./services/telegramService");
        if (tg.isConfigured()) {
            tg.sendMessage(chatId, text).catch(() => {});  // fire-and-forget
        }
    } catch { /* alerting must never crash the process */ }
}

// ── Process guards + graceful shutdown ────────────────────────────
let _autoLoopRef    = null;  // set after startup
let _httpServer     = null;  // set after listen()
let _shuttingDown   = false;

function _gracefulShutdown(signal) {
    if (_shuttingDown) return;
    _shuttingDown = true;
    logger.info(`[Shutdown] ${signal} received — stopping services`);
    // Alert on unexpected termination (SIGTERM from PM2 after crash, not clean operator stop)
    // SIGINT = operator Ctrl+C, SIGUSR2 = nodemon — both expected; SIGTERM may be PM2 kill
    if (signal === "SIGTERM") {
        const restarts = parseInt(process.env.restart_time || "0");
        _runtimeAlert("⚠️", "Runtime Shutdown",
            [`Signal: ${signal}`, `Uptime: ${Math.round(process.uptime())}s`, `PM2 restarts: ${restarts}`]);
    }
    // Clear startup marker so the next boot doesn't count this as a crash
    try { _fs_native.unlinkSync(_STARTUP_MARKER); } catch {}

    // 1. Stop accepting new HTTP connections
    if (_httpServer) {
        _httpServer.close(() => logger.info("[Shutdown] HTTP server closed"));
    }

    // 2. Stop the autonomous task loop
    try { if (_autoLoopRef) _autoLoopRef.stop(); } catch { /* ignore */ }

    // 3. Stop automation cron jobs
    try { automation.stop(); } catch { /* ignore */ }

    // 3a. Stop browser schedule executor
    try { require("../agents/browser/browserScheduler.cjs").stop(); } catch { /* ignore */ }

    // 4. Stop memory sampler
    try { memTracker.stop(); } catch { /* ignore */ }

    // 5a. Stop event bus (closes SSE connections cleanly)
    try { require("../agents/runtime/runtimeEventBus.cjs").stop(); } catch { /* ignore */ }

    // 5. Give in-flight work 5 s to drain, then exit
    setTimeout(() => {
        logger.info("[Shutdown] Clean exit");
        process.exit(0);
    }, 5_000).unref();
}

// ── Crash forensics snapshot ──────────────────────────────────────
// Written synchronously on uncaughtException so it survives the crash.
function _writeCrashForensics(err, source) {
    try {
        const crashDir  = require("path").join(__dirname, "../data/crashes");
        _fs_native.mkdirSync(crashDir, { recursive: true });
        const snapFile  = require("path").join(crashDir, `crash_${Date.now()}.json`);

        // Queue snapshot
        let queueSnap = null;
        try {
            const tq = require("../agents/taskQueue.cjs");
            const all = tq.getAll();
            queueSnap = { pending: all.filter(t=>t.status==="pending").length, running: all.filter(t=>t.status==="running").length, total: all.length };
        } catch {}

        // Last ring event snapshot
        let lastEvent = null;
        try {
            const bus = require("../agents/runtime/runtimeEventBus.cjs");
            const recent = bus.getRecent(1);
            lastEvent = recent[0] ?? null;
        } catch {}

        // Drift snapshot
        let drift = null;
        try { drift = require("../agents/runtime/driftMonitor.cjs").getDriftReport(); } catch {}

        // PM2 attribution
        const pm2Info = {
            pm2AppName: process.env.name,
            pm2InstanceId: process.env.pm_id,
            restartCount: process.env.restart_time,
            nodeVersion: process.version,
            uptime: Math.round(process.uptime()),
        };

        const snap = {
            source, crashedAt: new Date().toISOString(),
            pid: process.pid, pm2: pm2Info,
            error: { message: err?.message, code: err?.code, stack: err?.stack?.slice(0, 2000) },
            queue: queueSnap, lastEvent, drift,
            mem: process.memoryUsage(),
        };
        _fs_native.writeFileSync(snapFile, JSON.stringify(snap, null, 2));
        logger.error(`[Crash] Forensics written to ${snapFile}`);

        // Telegram crash alert — non-blocking, must not throw
        _runtimeAlert("🔴", "Crash Detected", [
            `Error: ${String(err?.message || err || "unknown").slice(0, 160)}`,
            `Source: ${source}`,
            `Uptime: ${Math.round(process.uptime())}s`,
            `PM2 restarts: ${process.env.restart_time || 0}`,
        ]);
    } catch { /* writing forensics must never throw */ }
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
    _writeCrashForensics(err, "uncaughtException");
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
    // Transient network errors are throttled to one log per 5 minutes to avoid spam.
    const POLLING_LOG_THROTTLE_MS = 5 * 60 * 1000;
    let _lastPollingErrLog = 0;
    bot.on("polling_error", (err) => {
        const code = err?.response?.statusCode || err?.code;
        if (code === 401) {
            logger.error("[Telegram] Invalid token (401) — polling stopped. Check TELEGRAM_TOKEN in .env");
            bot.stopPolling();
        } else if (code === 409) {
            logger.warn("[Telegram] Conflict (409) — another instance is polling. Stopping this one.");
            bot.stopPolling();
        } else {
            const now = Date.now();
            if (now - _lastPollingErrLog > POLLING_LOG_THROTTLE_MS) {
                _lastPollingErrLog = now;
                logger.warn(`[Telegram] Polling error (${code}): ${err.message}`);
            }
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

// ── Startup health gate ────────────────────────────────────────────
// On each boot:
//   1. Write data/startup_in_progress.json (cleared on clean listen + on SIGTERM)
//   2. If that file exists from a prior boot, a crash occurred before clean listen
//   3. Count consecutive crashes — if >= 3, log a deployment rollback warning
const _fs_native = require("fs");
const _STARTUP_MARKER = require("path").join(__dirname, "../data/startup_in_progress.json");
const _CRASH_COUNTER  = require("path").join(__dirname, "../data/startup_crash_count.json");

(function _startupGate() {
  try { _fs_native.mkdirSync(require("path").dirname(_STARTUP_MARKER), { recursive: true }); } catch {}

  // ── JWT secret rotation detection ─────────────────────────────
  // If JWT_SECRET changes between deploys, all existing tokens become invalid.
  // Warn so operators know they'll need to re-login.
  const _JWT_HASH_FILE = require("path").join(__dirname, "../data/jwt_secret_hash.json");
  try {
    const crypto = require("crypto");
    const currentHash = process.env.JWT_SECRET
      ? crypto.createHash("sha256").update(process.env.JWT_SECRET).digest("hex").slice(0, 12)
      : null;
    if (currentHash) {
      let priorHash = null;
      try { priorHash = JSON.parse(_fs_native.readFileSync(_JWT_HASH_FILE, "utf8")).hash; } catch {}
      if (priorHash && priorHash !== currentHash) {
        console.warn("[Startup:Auth] JWT_SECRET changed — all existing operator sessions are invalidated.");
        console.warn("[Startup:Auth] Operators will need to log in again.");
      }
      _fs_native.writeFileSync(_JWT_HASH_FILE, JSON.stringify({ hash: currentHash, updatedAt: new Date().toISOString() }));
    }
  } catch { /* non-fatal */ }

  // ── Env mismatch / deployment integrity check ─────────────────
  // Detect NODE_VERSION changes (e.g. a deploy that switched Node major).
  // Detect NODE_ENV mismatch vs last recorded env.
  const _DEPLOY_META_FILE = require("path").join(__dirname, "../data/deploy_meta.json");
  try {
    const currentMeta = {
      nodeVersion: process.version,
      nodeEnv:     process.env.NODE_ENV || "development",
      port:        process.env.PORT || "5050",
    };
    let priorMeta = null;
    try { priorMeta = JSON.parse(_fs_native.readFileSync(_DEPLOY_META_FILE, "utf8")); } catch {}
    if (priorMeta) {
      if (priorMeta.nodeVersion !== currentMeta.nodeVersion)
        console.warn(`[Startup:Deploy] Node version changed: ${priorMeta.nodeVersion} → ${currentMeta.nodeVersion}`);
      if (priorMeta.nodeEnv !== currentMeta.nodeEnv)
        console.warn(`[Startup:Deploy] NODE_ENV changed: ${priorMeta.nodeEnv} → ${currentMeta.nodeEnv}`);
      if (priorMeta.port !== currentMeta.port)
        console.warn(`[Startup:Deploy] PORT changed: ${priorMeta.port} → ${currentMeta.port}`);
    }
    _fs_native.writeFileSync(_DEPLOY_META_FILE, JSON.stringify({ ...currentMeta, updatedAt: new Date().toISOString() }));
  } catch { /* non-fatal */ }

  // ── Crash counter + quarantine ─────────────────────────────────
  // If crashCount >= 5 (matching PM2 max_restarts), log a quarantine warning.
  // The process still starts — quarantine is informational only (PM2 will stop it).
  let crashCount = 0;
  try {
    if (_fs_native.existsSync(_STARTUP_MARKER)) {
      try { crashCount = JSON.parse(_fs_native.readFileSync(_CRASH_COUNTER, "utf8")).count || 0; } catch {}
      crashCount++;
      _fs_native.writeFileSync(_CRASH_COUNTER, JSON.stringify({ count: crashCount, lastCrashAt: new Date().toISOString() }));
      if (crashCount >= 5) {
        console.error(`[Startup:Gate] QUARANTINE — ${crashCount} consecutive failures. PM2 will stop retrying.`);
        console.error(`[Startup:Gate] Fix the error and run: pm2 restart jarvis-os`);
        console.error(`[Startup:Gate] Forensics: data/crashes/  Logs: logs/pm2-err.log`);
      } else if (crashCount >= 3) {
        console.error(`[Startup:Gate] ⚠ ${crashCount} consecutive startup failures — possible bad deploy.`);
        console.error(`[Startup:Gate] Roll back with: pm2 restart jarvis-os`);
      } else {
        console.warn(`[Startup:Gate] Prior startup did not complete cleanly (crash #${crashCount})`);
      }
    } else {
      try { _fs_native.writeFileSync(_CRASH_COUNTER, JSON.stringify({ count: 0 })); } catch {}
    }
    _fs_native.writeFileSync(_STARTUP_MARKER, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  } catch { /* non-fatal */ }
})();

// ── Startup ────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 5050;
_httpServer = app.listen(PORT, () => {
    // Signal PM2 that this process is ready (used when wait_ready:true in ecosystem config)
    if (typeof process.send === "function") process.send("ready");
    // Clear startup-in-progress marker — clean listen
    try { _fs_native.unlinkSync(_STARTUP_MARKER); } catch {}

    // Startup / Recovery alert
    const _restarts = parseInt(process.env.restart_time || "0");
    if (_restarts > 0) {
        // PM2 has restarted this process — it recovered from a prior crash
        _runtimeAlert("✅", "Runtime Recovered",
            [`PM2 restart #${_restarts}`, `Port: ${PORT}`, `Node: ${process.version}`]);
    } else {
        // Clean first start
        _runtimeAlert("🟢", "Runtime Started",
            [`Port: ${PORT}`, `Node: ${process.version}`, `Env: ${process.env.NODE_ENV || "development"}`]);
    }

    // Scan for unread crash forensics from prior runs.
    // EPIPE crashes are suppressed — they are caused by PM2 closing stdout on
    // shutdown and trigger the crash handler spuriously, not a real process crash.
    try {
        const crashDir = require("path").join(__dirname, "../data/crashes");
        if (_fs_native.existsSync(crashDir)) {
            const allFiles = _fs_native.readdirSync(crashDir)
                .filter(f => f.startsWith("crash_") && f.endsWith(".json")).sort();
            const realCrashes = allFiles.filter(f => {
                try {
                    const c = JSON.parse(_fs_native.readFileSync(require("path").join(crashDir, f), "utf8"));
                    return c.error?.code !== "EPIPE";
                } catch { return true; }
            });
            // Auto-delete EPIPE-only files silently — they are PM2 pipe noise
            const epipeFiles = allFiles.filter(f => !realCrashes.includes(f));
            for (const f of epipeFiles) {
                try { _fs_native.unlinkSync(require("path").join(crashDir, f)); } catch {}
            }
            const recent = realCrashes.slice(-5);
            if (recent.length > 0) {
                logger.warn(`[Startup:Forensics] ${recent.length} crash report(s) from prior run(s) — check data/crashes/`);
                for (const f of recent.slice(-3)) {
                    try {
                        const c = JSON.parse(_fs_native.readFileSync(require("path").join(crashDir, f), "utf8"));
                        logger.warn(`  ${f}: ${c.error?.message || "unknown"} (uptime=${c.pm2?.uptime}s restarts=${c.pm2?.restartCount})`);
                    } catch {}
                }
            }
        }
    } catch {}

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

    // ── n8n workflow registration ─────────────────────────────────
    try {
        const { registerWorkflows } = require("../agents/automation/registerWorkflows.cjs");
        registerWorkflows().then(r => {
            if (r.registered.length) logger.info(`[n8n] Registered ${r.registered.length} workflow(s): ${r.registered.join(", ")}`);
            if (r.errors.length)     logger.warn(`[n8n] Registration errors: ${r.errors.join("; ")}`);
        }).catch(err => logger.warn("[n8n] registerWorkflows error:", err.message));
    } catch (err) {
        logger.warn("[n8n] registerWorkflows failed to load:", err.message);
    }

    // ── Runtime agent registry ────────────────────────────────────
    try {
        require("../agents/runtime/bootstrapRuntime.cjs");
    } catch (err) {
        logger.warn("[Bootstrap] Runtime agent registry failed:", err.message);
    }

    // ── Realtime event bus ────────────────────────────────────────
    try {
        require("../agents/runtime/runtimeEventBus.cjs").start();
        logger.info("[EventBus] realtime event bus started — GET /runtime/stream");
    } catch (err) {
        logger.warn("[EventBus] failed to start:", err.message);
    }

    // ── Browser schedule executor ─────────────────────────────────
    try {
        require("../agents/browser/browserScheduler.cjs").start();
        logger.info("[BrowserScheduler] schedule executor started — checks every 60s");
    } catch (err) {
        logger.warn("[BrowserScheduler] failed to start:", err.message);
    }

    // ── Long-session drift monitor ────────────────────────────────
    try {
        require("../agents/runtime/driftMonitor.cjs").start();
        logger.info("[DriftMonitor] leak/drift detection started");
    } catch (err) {
        logger.warn("[DriftMonitor] failed to start:", err.message);
    }

    // ── Operational metrics persistence ──────────────────────────
    try {
        require("../agents/runtime/metricsStore.cjs").start();
        logger.info("[MetricsStore] 5-min snapshot persistence started");
    } catch (err) {
        logger.warn("[MetricsStore] failed to start:", err.message);
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

    // ── Cold-start cache validation ───────────────────────────────
    // Validate critical JSON data files before loading them.
    // Corrupted files are backed up and reset rather than crashing startup.
    try {
        const _validateJsonFile = (filePath, defaultVal) => {
            if (!_fs_native.existsSync(filePath)) return;
            try {
                JSON.parse(_fs_native.readFileSync(filePath, "utf8"));
            } catch {
                const backup = filePath + ".corrupt." + Date.now();
                try { _fs_native.copyFileSync(filePath, backup); } catch {}
                _fs_native.writeFileSync(filePath, JSON.stringify(defaultVal));
                logger.warn(`[Startup:CacheValidate] ${require("path").basename(filePath)} was corrupt — reset (backup: ${require("path").basename(backup)})`);
            }
        };
        const dataDir = require("path").join(__dirname, "../data");
        _validateJsonFile(require("path").join(dataDir, "task-queue.json"),       []);
        _validateJsonFile(require("path").join(dataDir, "dead-letter.json"),      []);
        _validateJsonFile(require("path").join(dataDir, "workflow-trust.json"),   {});
        _validateJsonFile(require("path").join(dataDir, "memory-store.json"),     {});
    } catch (valErr) {
        logger.warn("[Startup:CacheValidate] validation sweep failed (non-fatal):", valErr.message);
    }

    // ── Seed execution history from persistent log ────────────────
    try {
        require("../agents/runtime/executionHistory.cjs").seedFromLog(500);
    } catch (seedErr) {
        logger.warn("[Startup] History seed failed (non-fatal):", seedErr.message);
    }

    // ── Phase 31: startup reconciliation ─────────────────────────
    // 1. Stale queue tasks: any task stuck in "running" state (crash recovery)
    //    is reset to "pending" by recoverStale() (called below in diagnostics).
    // 2. Crash snapshots: logged by runtimeOrchestrator at module load time.
    // 3. Pending task count: surface in startup log so operator knows queue state.
    try {
        const tq = require("../agents/taskQueue.cjs");
        const all = tq.getAll();
        const stale = all.filter(t => t.status === "running");
        if (stale.length > 0) {
            logger.warn(`[Startup:Reconcile] ${stale.length} task(s) were running at shutdown — reset to pending:`);
            stale.forEach(t => logger.warn(`  - ${t.id} input="${(t.input||"").slice(0,60)}"`));
        }
        const pending = all.filter(t => t.status === "pending").length;
        if (pending > 0) logger.info(`[Startup:Reconcile] ${pending} pending task(s) queued for execution`);
    } catch (recErr) {
        logger.warn("[Startup:Reconcile] failed (non-fatal):", recErr.message);
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
        logger.info(`  auth       : ${_svcStatus.auth      ? "configured (JWT + password hash)" : process.env.NODE_ENV === "production" ? "⚠ NOT CONFIGURED — console inaccessible" : "dev passthrough"}`);
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
