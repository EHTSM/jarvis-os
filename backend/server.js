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
const crypto     = require("crypto");
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
app.disable("x-powered-by");

// ── helmet-equivalent security headers (manual — no extra dep) ─────
// helmet() middleware behaviour replicated: X-Content-Type-Options,
// X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy,
// Content-Security-Policy, Strict-Transport-Security.
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options",             "nosniff");
    res.setHeader("X-Frame-Options",                    "DENY");
    res.setHeader("X-XSS-Protection",                   "1; mode=block");
    res.setHeader("X-Permitted-Cross-Domain-Policies",  "none");
    res.setHeader("Referrer-Policy",                    "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy",                 "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cross-Origin-Opener-Policy",         "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy",       "same-origin");
    // CSP — allows same-origin scripts + Firebase Auth domains required for
    // Google Sign-In popup and Phone OTP reCAPTCHA.
    // Domains sourced from: index.html (GTM, GA4, Clarity), Firebase SDK (apis.google.com,
    // gstatic.com, identitytoolkit, securetoken), Phone OTP (recaptcha.net), Google OAuth popup.
    const CSP_SCRIPT  = "https://apis.google.com https://www.gstatic.com https://www.googleapis.com https://www.google.com https://www.recaptcha.net https://www.googletagmanager.com https://www.clarity.ms";
    // connect-src: add www.google.com (reCAPTCHA token XHR), www.gstatic.com (reCAPTCHA assets),
    // recaptchaenterprise.googleapis.com (Enterprise init attempted before v2 fallback)
    const CSP_CONNECT = "https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://recaptchaenterprise.googleapis.com https://www.google.com https://www.gstatic.com https://www.googletagmanager.com https://www.clarity.ms";
    const CSP_FRAME   = "https://ooplix-jarvis.firebaseapp.com https://www.google.com https://www.recaptcha.net https://www.googletagmanager.com";
    let csp;
    if (process.env.NODE_ENV === "production") {
        // Generate a per-request nonce. CRA injects inline scripts that historically
        // required 'unsafe-inline', but 'strict-dynamic' + nonce lets modern browsers
        // trust only nonce-annotated scripts (and scripts they load), which eliminates
        // the blanket XSS window. Older browsers fall back gracefully via 'unsafe-inline'
        // being overridden by 'strict-dynamic' in supporting browsers.
        const nonce = crypto.randomBytes(16).toString("base64");
        res.locals.cspNonce = nonce;
        csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${CSP_SCRIPT}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: https://www.gstatic.com; connect-src 'self' https: ${CSP_CONNECT}; frame-src ${CSP_FRAME}; frame-ancestors 'none';`;
    } else {
        // Development: keep unsafe-inline + unsafe-eval for HMR / CRA dev server
        csp = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; frame-ancestors 'none';";
    }
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
// Real Productivity & Operator Experience Certification: `npm run dev`
// (this project's own documented local-dev workflow — frontend on :3000,
// backend on :5050, wired via CRA's "proxy" field in frontend/package.json)
// was completely broken for every state-changing request (signup, login,
// any POST). Root cause, confirmed by reading the installed
// react-dev-utils source directly: CRA's dev-server proxy
// (frontend/node_modules/react-dev-utils/WebpackDevServerUtils.js)
// rewrites the Origin header of every proxied request to the proxy
// TARGET's own address — i.e. it sends `Origin: http://localhost:5050`
// to this very server — specifically to *avoid* CORS issues, per that
// file's own comment. This backend's strict origin allowlist then
// rejected that self-referential origin, so every proxied POST failed
// with a 500 before ever reaching its route handler. Reproduced directly:
// curl straight to :5050 always succeeded; the identical request through
// the :3000 proxy always failed with the exact
// `CORS: origin 'http://localhost:5050' not allowed` error logged here.
//
// Fix does NOT key off NODE_ENV — this repo's own checked-in .env hardcodes
// NODE_ENV=production even for local development (a separate, real finding:
// dev-only behaviors like error-detail passthrough never activate locally
// either), so a NODE_ENV-gated fix would have been dead code in this
// project's actual configuration. Instead: accept an Origin that is
// self-referential — http://<the Host header this exact request carries>
// — which is only ever possible for traffic that already reached this
// process on localhost (an external attacker cannot make a victim's
// browser send a request whose Origin equals this server's own address
// unless they already control this machine, at which point CORS is not
// the relevant boundary). This is materially the same trust boundary as
// the existing `!origin` same-origin allowance three lines below, just
// covering the one extra hop CRA's proxy introduces.
app.use(cors({
    origin: (origin, cb) => {
        // Allow same-origin requests (origin === undefined in server-to-server or
        // same-origin fetches), any listed origin, or an origin that is
        // self-referential (see comment above — covers CRA's dev-proxy rewrite).
        if (!origin || _allowedOrigins.includes(origin)) return cb(null, true);
        try {
            const originHost = new URL(origin).host; // e.g. "localhost:5050"
            if (req_isSelfOrigin(originHost)) return cb(null, true);
        } catch { /* malformed Origin header — fall through to reject */ }
        cb(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
    methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
}));
function req_isSelfOrigin(originHost) {
    const _selfPort = parseInt(process.env.PORT) || 5050;
    return originHost === `localhost:${_selfPort}` || originHost === `127.0.0.1:${_selfPort}`;
}

// ── Response compression (gzip for JSON >= 1 KB) ─────────────────
app.use(require("./middleware/compress"));

// ── Structured request logging ────────────────────────────────────
app.use(require("./middleware/requestLogger"));

// ── Serve frontend static assets — BEFORE the API route barrel ─────
// Several route modules in `routes/` apply requireAuth via a bare
// `router.use(requireAuth)` (no path prefix). Because every module in
// routes/index.js is mounted at "/", such a bare call intercepts ALL
// unmatched requests — including "/" and hashed JS/CSS bundles — before
// they'd ever reach the SPA fallback below. Serving static files first
// means real asset requests resolve here and never reach those routers.
const frontendBuild = path.join(__dirname, "../frontend/build");
const hasFrontendBuild = require("fs").existsSync(frontendBuild);
const indexHtmlPath = path.join(frontendBuild, "index.html");

// index.html must be re-rendered per request (not served statically) in
// production: the CSP header above sets a fresh 'nonce-...' on every response,
// but CRA's build output has no templating step to stamp that nonce onto its
// <script> tags. Without this, script-src's nonce never matches any script
// tag in the HTML and the browser blocks every script — the entire SPA fails
// to load (blank page) for every visitor. We inject the nonce as a `nonce`
// attribute on every <script> tag at serve time instead.
// C.1 (C1-D4): the template was cached for the process lifetime. CRA emits
// content-hashed bundles, so after a redeploy the still-running server kept
// serving the OLD index.html, which referenced main.<oldhash>.js — files that
// no longer exist on disk. Every visitor got a blank page (the browser refuses
// the 404 as a script) until someone remembered to restart the process.
// Measured live during C.1: served main.ee3b42b3.js while disk had
// main.51b4f711.js.
//
// Fixed by keying the cache on the file's mtime+size: still one read per
// deploy rather than per request, but a rebuilt index.html is picked up
// automatically. A stat() per request is negligible next to serving a blank app.
let _indexHtmlTemplate = null;
let _indexHtmlStamp = null;
function _renderIndexHtml(req, res) {
    let stamp = null;
    try {
        const st = require("fs").statSync(indexHtmlPath);
        stamp = `${st.mtimeMs}:${st.size}`;
    } catch { return res.status(500).send("Frontend build not found"); }

    if (_indexHtmlTemplate === null || _indexHtmlStamp !== stamp) {
        try {
            _indexHtmlTemplate = require("fs").readFileSync(indexHtmlPath, "utf8");
            _indexHtmlStamp = stamp;
        } catch { return res.status(500).send("Frontend build not found"); }
    }
    const nonce = res.locals.cspNonce;
    const html = nonce
        ? _indexHtmlTemplate.replace(/<script(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`)
        : _indexHtmlTemplate;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.send(html);
}

if (hasFrontendBuild) {
    // index: false — prevents express.static from auto-serving the raw,
    // un-nonced index.html for "/"; the explicit GET "/" route below (and the
    // SPA fallback further down) render it dynamically instead.
    app.use(express.static(frontendBuild, { index: false }));
    app.get("/", _renderIndexHtml);

    // Phase C.1 (C1-D1). express.static calls next() when a build asset is
    // missing, so the request continued into the API stack and came back as
    // 401 {"error":"Unauthorized"} — a *missing file* reported as an *auth
    // failure*. During a partial or stale deploy that sends an operator to
    // debug authentication while the real cause is an absent bundle, and it
    // is what blocked the C.1 accessibility scan: the SPA could not boot and
    // every route measured as zero focusable elements.
    //
    // Build assets are public static files; they are never auth-gated when
    // present, so they must not become auth-gated by being absent. Anything
    // under a build asset directory that reaches this point does not exist.
    app.use(["/static", "/assets"], (req, res) => {
        res.status(404).json({
            success: false,
            error: `Not Found: ${req.method} ${req.baseUrl}${req.path}`,
            hint: "Static build asset not found — the frontend build may be stale or incomplete.",
        });
    });

    logger.info("Serving frontend build from /frontend/build");
}

// ── Mount all API routes ────────────────────────────────────────────
app.use(routes);

// ── API 404 boundary ────────────────────────────────────────────────
// Phase C.1.1 measurement-integrity fix. The SPA fallback below matches
// ANY unmatched GET, so an authenticated request to a nonexistent API
// path (e.g. GET /enterprise/orgs, which no route defines) fell through
// to index.html and returned HTTP 200 + HTML. A client could not
// distinguish "route missing" from "route working" by status code, and a
// consumer failed at JSON.parse rather than on a clean 404.
//
// Measured impact: this corrupted the Phase C.1 audit twice — it made
// three orphaned components (EnterpriseOS/DeveloperOS/PersonalOS, 22
// endpoints) appear to have live backends, and it produced a false
// cross-tenant "leak" signal when three nonexistent org paths returned
// 200 to a foreign account (the owner received the same 200 HTML).
//
// The prefix list is derived from the live router tree at boot, not
// hardcoded, so it stays correct as routes are added or removed.
const _apiPrefixes = (() => {
    const found = new Set();
    (function walk(stack) {
        for (const layer of stack || []) {
            if (layer.route && typeof layer.route.path === "string") {
                const seg = layer.route.path.split("/")[1];
                if (seg && !seg.startsWith(":")) found.add(seg.split(":")[0]);
            } else if (layer.handle && layer.handle.stack) {
                walk(layer.handle.stack);
            }
        }
    })(routes.stack);
    return found;
})();

// Real client-side routes. App.jsx reads window.location.pathname and handles
// exactly these; everything else it renders from local state, so no other
// multi-segment path is a legitimate frontend destination.
const _SPA_PATHS = new Set(["/", "/reset-password", "/verify-email", "/accept-invite"]);

app.use((req, res, next) => {
    const seg = req.path.split("/")[1];

    // (a) Unknown path under a prefix that DOES serve routes.
    if (seg && _apiPrefixes.has(seg)) {
        return res.status(404).json({
            success: false,
            error: `Not Found: ${req.method} ${req.path}`,
        });
    }

    // (b) Phase OS-2 gap fix. Keying only off mounted prefixes left a hole:
    // a path whose prefix has NO routes at all (e.g. /dev/*, /personal/*) was
    // absent from _apiPrefixes and fell through to the SPA, still answering
    // 200 + HTML. Those are precisely the endpoints DeveloperOS.jsx and
    // PersonalOS.jsx call — the dead prototypes this whole audit is trying to
    // tell the truth about — so the masking survived exactly where it mattered.
    //
    // A multi-segment path that is not a known client-side route is an API
    // call by any reasonable reading. Single-segment paths still fall through,
    // so client-side routes added later keep working without touching this.
    const isMultiSegment = req.path.split("/").filter(Boolean).length > 1;
    if (isMultiSegment && !_SPA_PATHS.has(req.path)) {
        return res.status(404).json({
            success: false,
            error: `Not Found: ${req.method} ${req.path}`,
        });
    }

    return next();
});

// ── SPA fallback — any non-API path that reached here falls back to
// index.html so React Router / hash routes resolve client-side. Must
// run AFTER the API route barrel and the API 404 boundary above so
// unmatched API paths 404 correctly instead of silently returning the
// SPA shell.
if (hasFrontendBuild) {
    // Express 5 / path-to-regexp v6 rejects a bare "*" — wildcard segments
    // must be named (e.g. "/*splat"). This previously never executed because
    // `routes` always intercepted requests first; now it's reachable, so the
    // path string must be valid under the current router.
    app.get("/*splat", _renderIndexHtml);
}

// ── Global error handler ───────────────────────────────────────────
app.use((err, req, res, _next) => {
    if (err.type === "entity.parse.failed") {
        return res.status(400).json({ success: false, error: "Invalid JSON body" });
    }
    if (err.type === "entity.too.large" || err.status === 413) {
        return res.status(413).json({ success: false, error: "Payload too large" });
    }
    logger.error("Unhandled error:", err.message);
    // Zero Blind Spot / Continuous Autonomous Operations Certification:
    // a raw uncaught route exception previously only reached plain
    // logger.error() (console-only unless LOG_FILE is set, which it isn't
    // in the real .env) — it never landed in data/logs/structured.ndjson,
    // the one file continuousRuntimeObserver.cjs's logs source and
    // errorAggregator.cjs actually read. That made a genuinely broken
    // backend route invisible to the autonomous observe->decide->mission
    // loop unless it also crashed the whole process (caught separately by
    // the pm2 source). Reusing the existing structuredLog() writer here —
    // no new logging system — closes that gap.
    try {
        require("./services/observabilityEngine.cjs").structuredLog("error", err.message, {
            service: "http", path: req.originalUrl, method: req.method,
        });
    } catch { /* non-fatal — must never block the error response */ }
    // MASTER FINAL GAP CLOSURE (2026-08-15, C10-028): sentryService.cjs
    // exported real capture functions that nothing ever called. Wired here
    // (and at the two process-level handlers below) — no new error-tracking
    // system, reuses the existing HTTP-envelope service as-is. Honestly a
    // no-op until SENTRY_DSN is set (captureException's own early return),
    // so this introduces no fake success and requires no credential to be
    // correct code — only to actually deliver anywhere.
    try {
        require("./services/sentryService.cjs").captureException(err, {
            tags: { service: "http" },
            extra: { path: req.originalUrl, method: req.method },
        }).catch(() => {});
    } catch { /* non-fatal — must never block the error response */ }
    const body = { success: false, error: "Internal server error" };
    if (process.env.NODE_ENV !== "production") body.details = err.message;
    res.status(500).json(body);
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

    // 3a2. Stop content post scheduler (see the matching start() comment above)
    try { require("../agents/content/contentScheduler.cjs").stop(); } catch { /* ignore */ }

    // 3b. Stop org automation's real node-cron dispatcher — Scheduler
    // Reliability & Recovery Audit (2026-08-16): orgAutomationScheduler.cjs
    // has a working stop() (cronTask.stop() + clears the handle) but it was
    // never called anywhere in this file, confirmed via grep — the same
    // "real stop() exists but isn't wired into shutdown" gap already fixed
    // once for closeDB() above. Not calling it left the cron task running
    // (and its own dispatcher, in-flight fireRule calls) through the entire
    // shutdown sequence instead of stopping cleanly alongside every other
    // scheduler here.
    try { require("./services/orgAutomationScheduler.cjs").stop(); } catch { /* ignore */ }

    // 3c. Stop the founder identity sync 6h timer — same audit, same class
    // of gap: this scheduler previously had no stop() at all (fixed
    // separately in founderIdentitySyncScheduler.cjs) and consequently was
    // never part of any shutdown sequence either.
    try { require("./services/founderIdentitySyncScheduler.cjs").stopIdentitySyncSchedule(); } catch { /* ignore */ }

    // 4. Stop memory sampler
    try { memTracker.stop(); } catch { /* ignore */ }

    // 5a. Stop event bus (closes SSE connections cleanly)
    try { require("../agents/runtime/runtimeEventBus.cjs").stop(); } catch { /* ignore */ }

    // 5b. Close the SQLite shadow connection — checkpoints and truncates the
    // WAL file. OOPLIX V1 MASTER AUDIT (2026-08-16, graceful-shutdown
    // coverage audit): closeDB() was never called anywhere in this file,
    // confirmed by direct grep. WAL mode is crash-safe by design (already
    // live-verified this session under real SIGKILL — no data loss, no
    // corruption), so this was never a correctness risk, but a real,
    // measured consequence was found live: data/jarvis.db-wal had grown to
    // 4.1 MB — LARGER than the main jarvis.db file itself (930 KB) —
    // because nothing ever checkpoints it on a clean exit. A manual
    // `PRAGMA wal_checkpoint(TRUNCATE)` was confirmed to shrink it to 0
    // bytes. Left unaddressed, this grows unboundedly across a long-running
    // production deployment's restarts. Calling the connection manager's
    // own existing closeDB() (which better-sqlite3 checkpoints on close by
    // default) fixes this with no new architecture.
    try { require("./db/sqlite.cjs").closeDB(); } catch { /* ignore */ }

    // 6. Give in-flight work 5 s to drain, then exit
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
    // C10-028: best-effort — the process is exiting in 200ms regardless, so
    // this capture races the exit and may not complete delivery even with a
    // real DSN configured. Still correct to attempt: honest best-effort, not
    // a claim of guaranteed delivery.
    try { require("./services/sentryService.cjs").captureException(err, { tags: { service: "process", handler: "uncaughtException" } }).catch(() => {}); } catch {}
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 200);
});

// unhandledRejection: usually recoverable — log and continue.
process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.stack : String(reason);
    errTracker.record("unhandledRejection", msg);
    logger.error(`Unhandled promise rejection: ${msg}`);
    try {
        const err = reason instanceof Error ? reason : new Error(String(reason));
        require("./services/sentryService.cjs").captureException(err, { tags: { service: "process", handler: "unhandledRejection" } }).catch(() => {});
    } catch {}
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
// Explicit HOST — listen(PORT) alone lets Node pick the default bind
// address, which is platform-dependent (dual-stack "::" on some Linux
// configs). nginx's upstream connects via plain IPv4 (127.0.0.1:5050);
// an IPv6-only listener can silently refuse that connection at the OS
// level, producing 502 even though the process is running and healthy
// on its own host. Binding explicitly to 0.0.0.0 removes the ambiguity.
const HOST = process.env.HOST || "0.0.0.0";
_httpServer = app.listen(PORT, HOST, () => {
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

    // ── Deferred heavy analysis / probe loops ──────────────────────
    // These previously ran at require()-time (module scope), which parsed
    // and clustered agent-runs/tool-usage/cycles history before the HTTP
    // server could bind — the root cause of the startup heap-limit crash.
    // Starting them here guarantees app.listen() has already succeeded.
    try {
        require("./services/continuousLearningEngine.cjs").startAutoAnalysis();
    } catch (err) {
        logger.warn("[LearningEngine] deferred start failed:", err.message);
    }
    try {
        require("./services/selfHealingRuntime.cjs").startProbeLoop();
    } catch (err) {
        logger.warn("[SelfHeal] deferred start failed:", err.message);
    }
    try {
        // V7 Phase 1 (Continuous Self Improvement): startWeeklySchedule() was
        // fully built (real setInterval, real report generation/persistence)
        // but never called anywhere in the repo — confirmed via grep before
        // this change. Wiring it here, not rebuilding it.
        require("./services/improvementLoop.cjs").startWeeklySchedule();
    } catch (err) {
        logger.warn("[ImprovementLoop] deferred start failed:", err.message);
    }
    try {
        // V7 Phase 2 (Continuous Self Improvement): runEvolutionCycle() was
        // real (8-stage pattern discovery -> rule promotion/retirement ->
        // confidence update) but exclusively route-driven — confirmed via
        // grep, only routes/selfImprovement.js ever called it.
        require("./services/selfImprovementEngine.cjs").startEvolutionSchedule();
    } catch (err) {
        logger.warn("[SelfImprovement] deferred start failed:", err.message);
    }
    try {
        // V7 Phase 3 (Real Connector Runtime): runFullScan() was real (13
        // category scanners, live HTTP probes, persisted state) but only
        // ever triggered by POST /integrations/scan — connector health had
        // zero background monitoring.
        require("./services/integrationConnectors.cjs").startHealthMonitor();
    } catch (err) {
        logger.warn("[ConnectorMonitor] deferred start failed:", err.message);
    }
    try {
        // V7 Phase 4 (Autonomous Business Operations): composes 5 real,
        // already-built batch functions (customerJourneyEngine.syncJourneys,
        // customerHealthEngine.scoreAll, customerAutomationEngine.
        // runAutomationScan, revenueAutomationEngine.runRevenuePipeline,
        // businessIntelligenceEngine.scan) that were each exclusively
        // route-driven — confirmed via survey, zero scheduling anywhere.
        require("./services/businessOperationsScheduler.cjs").startOperationsSchedule();
    } catch (err) {
        logger.warn("[BusinessOps] deferred start failed:", err.message);
    }
    try {
        // V7 Phase 5 (Founder Operating System): founderIdentityOS.cjs's
        // runFullSystemScan() (identity graph + asset discovery +
        // relationship graph + credential intelligence) and
        // runSecretDiscovery() (bounded scan of known sensitive config
        // locations) were both real but exclusively route-driven.
        require("./services/founderIdentitySyncScheduler.cjs").startIdentitySyncSchedule();
    } catch (err) {
        logger.warn("[FounderIdentitySync] deferred start failed:", err.message);
    }
    try {
        const rot   = require("./services/secretRotationAutomation.cjs");
        const vault = require("./services/secretVault.cjs");

        // For overdue secrets whose type has no external issuer (jwt_secret,
        // webhook_secret), stage a fresh candidate automatically so an
        // operator only needs to review + apply rather than generate one by
        // hand. Every other credential type still requires a human/provider
        // to supply the replacement — see AUTO_ROTATABLE_TYPES in
        // secretVault.cjs for why.
        function _autoStageOverdueRotations() {
            try {
                const { overdue } = rot.checkReminders();
                for (const item of overdue) {
                    const [connectorId, type] = String(item.secretName).includes("::")
                        ? item.secretName.split("::")
                        : [item.secretName, "jwt_secret"];
                    if (!vault.AUTO_ROTATABLE_TYPES.has(type)) continue;
                    try { vault.prepareRotationCandidate(connectorId, type); }
                    catch { /* no vault entry for this schedule name — skip */ }
                }
            } catch { /* non-fatal */ }
        }

        rot.bootstrapSchedules();
        rot.checkReminders();
        _autoStageOverdueRotations();
        setInterval(() => { try { rot.checkReminders(); } catch { /* non-fatal */ } }, 24 * 60 * 60 * 1000).unref();
        setInterval(_autoStageOverdueRotations, 24 * 60 * 60 * 1000).unref();
        logger.info("[SecretRotation] schedule bootstrapped, daily reminder + auto-stage check running");
    } catch (err) {
        logger.warn("[SecretRotation] deferred start failed:", err.message);
    }

    // ── Autonomous task loop ───────────────────────────────────────
    // Mission 65: this loop runs real, unattended writes for the server's
    // entire lifetime — createMission()/organizationService writes via
    // runFullPipeline(), delegateToMember(), publishCivMission(), etc.
    // (agents/autonomousLoop.cjs's own runCycle()) — into the exact same
    // data/missions.json / data/organizations.json files the regression
    // and security test suites read/assert against. Live-reproduced as
    // the root cause of a recurring cluster of CI-only failures
    // (Tests 133/147/148/153/154's shared-store timing assertions, and
    // security tests 36/39/43/44/45's org-creation races) — the test
    // suites' own architecture has no way to account for a background
    // writer neither they nor the CI workflow ever asked to run. This
    // guard is opt-in and additive only: DISABLE_AUTONOMOUS_LOOP is unset
    // everywhere except where a caller (e.g. CI) explicitly sets it, so
    // every existing deployment's behavior is completely unchanged.
    if (process.env.DISABLE_AUTONOMOUS_LOOP === "1") {
        logger.info("[AutoLoop] autonomous task loop disabled (DISABLE_AUTONOMOUS_LOOP=1)");
    } else {
        try {
            _autoLoopRef = require("../agents/autonomousLoop.cjs");
            _autoLoopRef.start();
            logger.info("[AutoLoop] autonomous task loop running");
        } catch (err) {
            logger.warn("[AutoLoop] failed to start:", err.message);
        }
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

    // ── Automation OS: event-triggered rule execution ──────────────
    // MASTER FINAL GAP CLOSURE (2026-08-15, C10-007): the only trigger type
    // wired to actually fire is "event" — reuses the event bus started
    // just above. schedule/threshold/webhook remain correctly unimplemented
    // (see automationService.cjs's own header comment for why).
    try {
        const r = require("../backend/services/automationService.cjs").startEventLoop();
        logger.info(`[Automation] event-triggered rule execution ${r.started ? "started" : "not started (" + r.reason + ")"}`);
    } catch (err) {
        logger.warn("[Automation] event loop failed to start:", err.message);
    }

    // ── Browser schedule executor ─────────────────────────────────
    try {
        require("../agents/browser/browserScheduler.cjs").start();
        logger.info("[BrowserScheduler] schedule executor started — checks every 60s");
    } catch (err) {
        logger.warn("[BrowserScheduler] failed to start:", err.message);
    }

    // ── Content post scheduler ────────────────────────────────────
    // Scheduler Reliability & Recovery Audit (2026-08-16): contentScheduler.
    // cjs's processDue() was real and fully built (pending → ready → sent/
    // failed, WhatsApp broadcast dispatch) but nothing anywhere ever called
    // it automatically — confirmed via grep. A post scheduled for a future
    // time sat at "pending" forever unless something explicitly dispatched
    // a "process_due" task. Wires the same start()/stop() tick pattern
    // browserScheduler.cjs already establishes, not a new mechanism.
    try {
        require("../agents/content/contentScheduler.cjs").start();
        logger.info("[ContentScheduler] due-post executor started — checks every 60s");
    } catch (err) {
        logger.warn("[ContentScheduler] failed to start:", err.message);
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
    //    is reset to "pending" by recoverStale() (called once, inside
    //    autonomousLoop.start(), above).
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

    // ── Track D: Background Runtime Observer (proactive recommendations) ─
    try {
        const bgr = require("./services/backgroundRuntime.cjs");
        bgr.start();
        logger.info("[BackgroundRuntime] proactive observers started (repo/pm2/logs/webhooks/deployments/incidents)");
    } catch (bgrErr) {
        logger.warn("[BackgroundRuntime] failed to start (non-fatal):", bgrErr.message);
    }

    // ── V5 Module 7: Organization Automation Center — real cron dispatcher
    // for automationService's existing "schedule" trigger type, plus the
    // event-bus subscription that lets an automation rule trigger a real
    // org-scoped AI call via orgAiBrain ────────────────────────────────
    try {
        const orgScheduler = require("./services/orgAutomationScheduler.cjs");
        const schedResult = orgScheduler.start();
        const orgAutoCenter = require("./services/orgAutomationCenter.cjs");
        const aiWireResult = orgAutoCenter.startAiWiring();
        logger.info(`[OrgAutomationCenter] scheduler=${schedResult.skipped ? "skipped(test mode)" : "started"} aiWiring=${aiWireResult.ok ? "started" : "failed"}`);
    } catch (autoCenterErr) {
        logger.warn("[OrgAutomationCenter] failed to start (non-fatal):", autoCenterErr.message);
    }

    // ── Phase I4: Autonomous Execution Runtime ────────────────────────────
    try {
        const execRT = require("./services/autonomousExecutionRuntime.cjs");
        const execResult = execRT.start();
        logger.info(`[ExecRuntime] I4 started — ${execResult.capabilities?.length ?? 0} capabilities`);
    } catch (execErr) {
        logger.warn("[ExecRuntime] failed to start (non-fatal):", execErr.message);
    }

    // ── Phase I3: Mission Orchestrator ────────────────────────────────────
    try {
        const orch = require("./services/missionOrchestrator.cjs");
        orch.start();
        logger.info("[MissionOrchestrator] I3 started");
    } catch (orchErr) {
        logger.warn("[MissionOrchestrator] failed to start (non-fatal):", orchErr.message);
    }

    // ── Phase I2: Autonomous Decision Engine ──────────────────────────────
    try {
        const decEngine = require("./services/autonomousDecisionEngine.cjs");
        const decResult = decEngine.start();
        logger.info(`[DecisionEngine] I2 started — ${decResult.rulesLoaded} rules loaded`);
    } catch (decErr) {
        logger.warn("[DecisionEngine] failed to start (non-fatal):", decErr.message);
    }

    // ── Phase I1: Continuous Runtime Observer ─────────────────────────────
    try {
        const observer = require("./services/continuousRuntimeObserver.cjs");
        observer.start().then(result => {
            logger.info(`[ContinuousRuntimeObserver] I1 started — ${result.sourceCount} sources active`);
        }).catch(err => {
            logger.warn("[ContinuousRuntimeObserver] start error (non-fatal):", err.message);
        });
    } catch (obsErr) {
        logger.warn("[ContinuousRuntimeObserver] failed to load (non-fatal):", obsErr.message);
    }

    // ── Phase I5: Engineering Capability Layer ────────────────────────────
    try {
        const engCap = require("./services/engineeringCapabilities.cjs");
        const regResult = engCap.register();
        logger.info(`[EngCapabilities] I5 registered ${regResult.registered} production capability handlers`);
    } catch (capErr) {
        logger.warn("[EngCapabilities] failed to register (non-fatal):", capErr.message);
    }

    // ── Level 2: Engineering Organization (20 AI Engineer Personas) ───────
    try {
        const engOrg = require("./services/engineeringOrg.cjs");
        const orgResult = engOrg.register();
        logger.info(`[EngineeringOrg] Level 2 registered — ${orgResult.registered}/${orgResult.count} engineer personas active`);
    } catch (orgErr) {
        logger.warn("[EngineeringOrg] failed to register (non-fatal):", orgErr.message);
    }

    // ── Level 3: Business Organization (20 Autonomous Departments) ──────────
    try {
        const bizOrg = require("./services/businessOrg.cjs");
        const bizResult = bizOrg.register();
        logger.info(`[BusinessOrg] Level 3 registered — ${bizResult.registered}/${bizResult.count} business departments active`);
    } catch (bizErr) {
        logger.warn("[BusinessOrg] failed to register (non-fatal):", bizErr.message);
    }

    // ── Level 4: Autonomous Knowledge Organization (20 Knowledge Departments) ─
    try {
        const akoOrg = require("./services/autonomousKnowledgeOrg.cjs");
        const akoResult = akoOrg.register();
        logger.info(`[AKO] Level 4 registered — ${akoResult.registered}/${akoResult.count} knowledge departments active`);
    } catch (akoErr) {
        logger.warn("[AKO] failed to register (non-fatal):", akoErr.message);
    }

    // ── Level 5: Autonomous Evolution Organization (20 Evolution Departments) ─
    try {
        const aeoOrg = require("./services/autonomousEvolutionOrg.cjs");
        const aeoResult = aeoOrg.register();
        logger.info(`[AEO] Level 5 registered — ${aeoResult.registered}/${aeoResult.count} evolution departments active`);
    } catch (aeoErr) {
        logger.warn("[AEO] failed to register (non-fatal):", aeoErr.message);
    }

    // ── Level 6: Executive Operating System (20 Executive Departments) ────────
    try {
        const eosOrg = require("./services/executiveOrg.cjs");
        const eosResult = eosOrg.register();
        logger.info(`[EOS] Level 6 registered — ${eosResult.registered}/${eosResult.count} executive departments active`);
    } catch (eosErr) {
        logger.warn("[EOS] failed to register (non-fatal):", eosErr.message);
    }

    // ── Level 7: Enterprise Operating System (20 Enterprise Divisions) ────────
    try {
        const entOrg = require("./services/enterpriseOrg.cjs");
        const entResult = entOrg.register();
        logger.info(`[ENT] Level 7 registered — ${entResult.registered}/${entResult.count} enterprise divisions active`);
    } catch (entErr) {
        logger.warn("[ENT] failed to register (non-fatal):", entErr.message);
    }

    // ── Level 8: Ecosystem Platform (20 Ecosystem Domains) ──────────────────
    try {
        const ecoOrg = require('./services/ecosystemOrg.cjs');
        const ecoResult = ecoOrg.register();
        logger.info('[ECO] Level 8 registered — ' + ecoResult.registered + '/' + ecoResult.count + ' ecosystem domains active');
    } catch (ecoErr) {
        logger.warn('[ECO] failed to register (non-fatal):', ecoErr.message);
    }

    // ── Level 9: Civilization Platform (20 Civilization Domains) ───────────
    try {
        const civOrg = require('./services/civilizationOrg.cjs');
        const civResult = civOrg.register();
        logger.info('[CIV] Level 9 registered — ' + civResult.registered + '/' + civResult.count + ' civilization domains active');
    } catch (civErr) {
        logger.warn('[CIV] failed to register (non-fatal):', civErr.message);
    }

    // ── Level 10: Autonomous Civilization (20 Autonomous Domains) ───────────
    try {
        const autoOrg = require('./services/autonomousOrg.cjs');
        const autoResult = autoOrg.register();
        logger.info('[AUTO] Level 10 registered — ' + autoResult.registered + '/' + autoResult.count + ' autonomous domains active');
    } catch (autoErr) {
        logger.warn('[AUTO] failed to register (non-fatal):', autoErr.message);
    }

    // ── Level Omega: Artificial Organization Platform (20 Platform Domains) ──
    try {
        const pltOrg = require('./services/platformOrg.cjs');
        const pltResult = pltOrg.register();
        logger.info('[PLT] Level Omega registered — ' + pltResult.registered + '/' + pltResult.count + ' platform domains active');
    } catch (pltErr) {
        logger.warn('[PLT] failed to register (non-fatal):', pltErr.message);
    }

    // ── Startup diagnostics ───────────────────────────────────────
    try {
        const envOk    = _missingRequired.length === 0;
        const leads    = crm.getLeads ? crm.getLeads().length : "?";
        let   queueLen = "?";
        try {
            // A.5.3 runtime-stability finding: recoverStale() was called
            // here AND inside autonomousLoop.start() (agents/autonomousLoop.cjs,
            // invoked earlier in this same boot sequence, above). Both ran on
            // every boot — harmless in effect (the second call is a no-op,
            // since the first already reset every "running" task to
            // "pending"), but it produced a duplicate "recovered N stale
            // running task(s)" log line on every restart, confirmed live.
            // autonomousLoop.start() already guarantees this runs once per
            // boot; removed the redundant second call here.
            const tq = require("../agents/taskQueue.cjs");
            tq.pruneOldTasks(50);
            const all = tq.getAll();
            queueLen = `${all.filter(t => t.status === "pending").length} pending / ${all.length} total`;
        } catch { /* queue unavailable */ }
        try {
            // Same crash-recovery role as tq.recoverStale() above, for
            // missions left "running" by a prior process instance that
            // didn't reach a terminal state.
            const missionRuntime = require("../agents/runtime/missionRuntime.cjs");
            const { recovered } = missionRuntime.recoverStaleMissions();
            if (recovered > 0) logger.info(`[Startup] Recovered ${recovered} stale running mission(s) → planned`);
        } catch { /* mission runtime unavailable */ }

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
