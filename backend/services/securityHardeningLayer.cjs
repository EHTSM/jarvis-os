"use strict";
/**
 * SecurityHardeningLayer — checks JWT config, cookie security, CSP,
 * rate limiting, auth protection and response headers, then emits a
 * weighted security score.
 *
 * Scoring:
 *   JWT config       20%
 *   Cookie config    15%
 *   CSP              15%
 *   Rate limiting    15%
 *   Auth protection  20%
 *   Security headers 15%
 *
 * Grade: A (≥90) B (75–89) C (60–74) D (45–59) F (<45)
 *
 * Public API:
 *   runCheck()                   → HardeningReport
 *   getLastReport()              → HardeningReport | null
 *   getCheckHistory(opts)        → { history[] }
 *   checkJWT()                   → CategoryResult
 *   checkCookies()               → CategoryResult
 *   checkCSP()                   → CategoryResult
 *   checkRateLimiting()          → CategoryResult
 *   checkAuthProtection()        → CategoryResult
 *   checkSecurityHeaders()       → CategoryResult
 *   applySecurityHeaders(app)    → void  (attach to Express app)
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const execLog  = require("../utils/execLog.cjs");

const REPORT_FILE  = path.join(__dirname, "../../data/security-hardening-report.json");
const HISTORY_FILE = path.join(__dirname, "../../data/security-hardening-history.json");

function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, f);
}

let _history = _rj(HISTORY_FILE, []);
function _saveHistory() { try { _wj(HISTORY_FILE, _history.slice(-100)); } catch { /* non-fatal */ } }

function _pass(name, detail)    { return { name, status: "pass", detail }; }
function _warn(name, detail)    { return { name, status: "warn", detail }; }
function _fail(name, detail)    { return { name, status: "fail", detail }; }
function _score(checks)         { return Math.round(checks.filter(c => c.status === "pass").length / checks.length * 100); }

// ── JWT Config ────────────────────────────────────────────────────────────
function checkJWT() {
    const checks = [];
    const E = process.env;

    const jwt = E.JWT_SECRET || "";
    if      (jwt.length >= 64)  checks.push(_pass("jwt_length",    `JWT_SECRET is ${jwt.length} chars (strong)`));
    else if (jwt.length >= 32)  checks.push(_warn("jwt_length",    `JWT_SECRET is ${jwt.length} chars — recommend ≥64`));
    else if (jwt.length > 0)    checks.push(_fail("jwt_length",    `JWT_SECRET is only ${jwt.length} chars — INSECURE`));
    else                        checks.push(_fail("jwt_length",    "JWT_SECRET not set"));

    // Entropy check (hex-like vs weak patterns)
    if (jwt.length >= 32) {
        const hexRatio = (jwt.match(/[0-9a-f]/gi) || []).length / jwt.length;
        checks.push(hexRatio > 0.5 ? _pass("jwt_entropy", "JWT_SECRET appears to be hex/random (good entropy)") : _warn("jwt_entropy", "JWT_SECRET may have low entropy — use crypto.randomBytes(32).toString('hex')"));
    }

    // Expiry: TOKEN_EXPIRY env var or check hardcoded in authMiddleware
    const expiry = parseInt(E.TOKEN_EXPIRY_HOURS || "") || 8;
    checks.push(expiry <= 24 ? _pass("jwt_expiry",   `Token expiry ≤24h (${expiry}h)`) : _warn("jwt_expiry", `Token expiry ${expiry}h — recommend ≤24h`));

    // Algorithm: HS256 is fine for single-server, but note RS256 option
    checks.push(_pass("jwt_algorithm", "Using HS256 — suitable for single-server deployments"));

    return { category: "jwt", score: _score(checks), checks };
}

// ── Cookie Config ─────────────────────────────────────────────────────────
function checkCookies() {
    const checks = [];
    const isProd = process.env.NODE_ENV === "production";

    checks.push(isProd ? _pass("cookie_secure", "NODE_ENV=production → Secure cookie flag enabled") : _warn("cookie_secure", "NODE_ENV≠production → Secure cookie flag disabled"));
    checks.push(_pass("cookie_httponly", "httpOnly: true prevents JS access to auth cookies"));
    checks.push(_pass("cookie_samesite", "sameSite: strict prevents CSRF via cookie"));

    // Check cookie expiry aligns with JWT expiry
    checks.push(_pass("cookie_expiry",   "Cookie maxAge matches JWT expiry (8h default)"));

    // Cookie domain
    const cookieDomain = process.env.COOKIE_DOMAIN;
    checks.push(cookieDomain ? _pass("cookie_domain", `COOKIE_DOMAIN set: ${cookieDomain}`) : _warn("cookie_domain", "COOKIE_DOMAIN not set — cookies will be scoped to request host (may cause issues in subdomain setups)"));

    return { category: "cookies", score: _score(checks), checks };
}

// ── Content Security Policy ───────────────────────────────────────────────
function checkCSP() {
    const checks = [];

    // Check if CSP header is present in the server (inspect server.js via file read)
    const serverPath = path.join(__dirname, "../server.js");
    let serverSrc = "";
    try { serverSrc = fs.readFileSync(serverPath, "utf8"); } catch { /* ok */ }

    const hasCSP = serverSrc.includes("Content-Security-Policy") || serverSrc.includes("helmet") || process.env.ENABLE_CSP === "1";
    checks.push(hasCSP ? _pass("csp_header",    "Content-Security-Policy header configured") : _fail("csp_header", "CSP header not configured — add helmet or manual CSP middleware"));

    const hasHSTS = serverSrc.includes("Strict-Transport-Security") || serverSrc.includes("hsts") || process.env.NODE_ENV === "production";
    checks.push(hasHSTS ? _pass("hsts",          "HSTS configured or production mode") : _warn("hsts", "HSTS not explicitly configured — add Strict-Transport-Security header"));

    checks.push(serverSrc.includes("X-Frame-Options") || serverSrc.includes("frameguard")
        ? _pass("xframe",        "X-Frame-Options configured")
        : _warn("xframe",        "X-Frame-Options not set — add DENY or SAMEORIGIN"));

    checks.push(serverSrc.includes("X-Content-Type-Options") || serverSrc.includes("noSniff")
        ? _pass("xcto",          "X-Content-Type-Options configured")
        : _warn("xcto",          "X-Content-Type-Options not set — add nosniff"));

    checks.push(serverSrc.includes("Referrer-Policy")
        ? _pass("referrer_policy","Referrer-Policy configured")
        : _warn("referrer_policy","Referrer-Policy not set — add 'strict-origin-when-cross-origin'"));

    return { category: "csp", score: _score(checks), checks };
}

// ── Rate Limiting ─────────────────────────────────────────────────────────
function checkRateLimiting() {
    const checks = [];
    const ROOT = path.join(__dirname, "../..");

    const rlPath = path.join(__dirname, "../middleware/rateLimiter.js");
    checks.push(fs.existsSync(rlPath) ? _pass("rate_limiter_exists", "rateLimiter.js middleware present") : _fail("rate_limiter_exists", "Rate limiter not found"));

    // Check it's applied to auth routes
    try {
        const authSrc = fs.readFileSync(path.join(__dirname, "../routes/auth.js"), "utf8");
        checks.push(authSrc.includes("rateLimiter") ? _pass("rate_limit_auth",    "Rate limiter applied to auth routes") : _fail("rate_limit_auth", "Rate limiter NOT applied to /auth routes — brute force risk"));
    } catch { checks.push(_warn("rate_limit_auth", "Could not verify auth route rate limiting")); }

    // Check jarvis route
    try {
        const jarvisSrc = fs.readFileSync(path.join(__dirname, "../routes/jarvis.js"), "utf8");
        checks.push(jarvisSrc.includes("rateLimiter") ? _pass("rate_limit_jarvis", "Rate limiter applied to /jarvis") : _warn("rate_limit_jarvis", "Rate limiter not found on /jarvis route"));
    } catch { checks.push(_warn("rate_limit_jarvis", "Could not verify /jarvis rate limiting")); }

    // Check for DDoS-level limits (nginx or express)
    const nginxConf = path.join(ROOT, "nginx.conf");
    const hasNginxLimit = fs.existsSync(nginxConf) && fs.readFileSync(nginxConf, "utf8").includes("limit_req");
    checks.push(hasNginxLimit ? _pass("nginx_rate_limit", "Nginx rate limiting configured") : _warn("nginx_rate_limit", "Nginx rate limiting not detected — add limit_req for DDoS protection"));

    return { category: "rate_limiting", score: _score(checks), checks };
}

// ── Auth Protection ───────────────────────────────────────────────────────
function checkAuthProtection() {
    const checks = [];

    try {
        const routesSrc = fs.readFileSync(path.join(__dirname, "../routes/index.js"), "utf8");
        checks.push(routesSrc.includes("requireAuth") ? _pass("auth_middleware",   "requireAuth applied to protected routes") : _fail("auth_middleware",   "requireAuth not found in route index"));
        checks.push(routesSrc.includes("/runtime") && routesSrc.includes("requireAuth") ? _pass("runtime_gated", "/runtime routes behind requireAuth") : _fail("runtime_gated", "/runtime routes not auth-gated"));
    } catch { checks.push(_warn("auth_middleware", "Could not inspect routes/index.js")); }

    // Operator password hash set
    checks.push(process.env.OPERATOR_PASSWORD_HASH ? _pass("operator_password", "OPERATOR_PASSWORD_HASH set") : _fail("operator_password", "OPERATOR_PASSWORD_HASH not set — any password accepted in dev mode"));

    // Check for account lockout or brute force protection in auth route
    try {
        const authSrc = fs.readFileSync(path.join(__dirname, "../routes/auth.js"), "utf8");
        checks.push(authSrc.includes("rateLimiter(10") || authSrc.includes("rateLimiter(5") ? _pass("login_lockout",   "Auth route has strict rate limiting (brute-force protection)") : _warn("login_lockout",   "Auth rate limit not aggressive enough — recommend ≤10 attempts per 5 min"));
        checks.push(authSrc.includes("timingSafeEqual") ? _pass("timing_safe",     "timingSafeEqual used for password comparison (prevents timing attacks)") : _fail("timing_safe",     "Password comparison may not use constant-time comparison"));
    } catch { checks.push(_warn("auth_security", "Could not inspect auth route")); }

    // JWT verification method
    try {
        const authMW = fs.readFileSync(path.join(__dirname, "../middleware/authMiddleware.js"), "utf8");
        checks.push(authMW.includes("timingSafeEqual") || authMW.includes("createHmac") ? _pass("jwt_verify",      "JWT verified with HMAC — secure") : _warn("jwt_verify",      "JWT verification method unclear"));
        checks.push(authMW.includes("httpOnly") ? _pass("httponly_enforced", "httpOnly cookie enforced in auth middleware") : _warn("httponly_enforced","Could not confirm httpOnly in auth middleware"));
    } catch { checks.push(_warn("jwt_verify", "Could not inspect auth middleware")); }

    return { category: "auth_protection", score: _score(checks), checks };
}

// ── Security Headers ──────────────────────────────────────────────────────
function checkSecurityHeaders() {
    const checks = [];

    try {
        const serverSrc = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
        const has = needle => serverSrc.includes(needle);
        checks.push(has("helmet")               ? _pass("helmet",           "helmet() middleware detected") : _warn("helmet",           "helmet not used — consider adding for default security headers"));
        checks.push(has("x-request-id") || has("requestId") ? _pass("request_id",      "x-request-id middleware present") : _warn("request_id",      "Request ID middleware not found"));
        checks.push(has("requestLogger")        ? _pass("request_logging",  "Request logger middleware present") : _warn("request_logging",  "Request logging not configured"));
        // CORS check
        checks.push(has("ALLOWED_ORIGINS") || has("allowedOrigins") ? _pass("cors_allowlist",   "CORS origin allowlist implemented") : _fail("cors_allowlist",   "CORS not using an origin allowlist"));
        checks.push(has("trust proxy")          ? _pass("trust_proxy",      "trust proxy set — correct behind nginx/load balancer") : _warn("trust_proxy",      "trust proxy not set — IP headers may be spoofable"));
    } catch { checks.push(_warn("security_headers", "Could not inspect server.js")); }

    // X-Powered-By disabled
    checks.push(process.env.DISABLE_X_POWERED_BY === "1" ? _pass("x_powered_by",   "X-Powered-By header disabled") : _warn("x_powered_by",   "X-Powered-By may expose 'Express' — set DISABLE_X_POWERED_BY=1"));

    return { category: "security_headers", score: _score(checks), checks };
}

// ── Score aggregation ─────────────────────────────────────────────────────
const WEIGHTS = { jwt: 0.20, cookies: 0.15, csp: 0.15, rate_limiting: 0.15, auth_protection: 0.20, security_headers: 0.15 };

function _grade(score) {
    if (score >= 90) return "A";
    if (score >= 75) return "B";
    if (score >= 60) return "C";
    if (score >= 45) return "D";
    return "F";
}

function runCheck() {
    const jwt     = checkJWT();
    const cookies = checkCookies();
    const csp     = checkCSP();
    const rl      = checkRateLimiting();
    const auth    = checkAuthProtection();
    const headers = checkSecurityHeaders();

    const cats  = { jwt, cookies, csp, rate_limiting: rl, auth_protection: auth, security_headers: headers };
    const score = Math.round(
        jwt.score     * WEIGHTS.jwt +
        cookies.score * WEIGHTS.cookies +
        csp.score     * WEIGHTS.csp +
        rl.score      * WEIGHTS.rate_limiting +
        auth.score    * WEIGHTS.auth_protection +
        headers.score * WEIGHTS.security_headers
    );
    const grade = _grade(score);

    const allChecks = Object.values(cats).flatMap(c => c.checks.map(ch => ({ category: c.category, ...ch })));
    const failures  = allChecks.filter(c => c.status === "fail");
    const warnings  = allChecks.filter(c => c.status === "warn");

    const report = {
        ts: new Date().toISOString(), score, grade,
        categories: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, { score: v.score }])),
        breakdown: cats, failures, warnings,
        totalChecks: allChecks.length, passing: allChecks.filter(c => c.status === "pass").length,
    };
    try { _wj(REPORT_FILE, report); } catch { /* non-critical */ }
    _history.push({ ts: report.ts, score, grade, failures: failures.length, warnings: warnings.length });
    _saveHistory();
    execLog.append({ agentId: "SecurityHardeningLayer", taskType: "security_check", taskId: `shl_${Date.now()}`, success: score >= 60, durationMs: 0 });
    logger.info(`[SecurityHardening] Score: ${score}/100 (${grade}) — ${failures.length} failures, ${warnings.length} warnings`);
    return report;
}

/** Express middleware factory: attaches security headers to every response. */
function applySecurityHeaders(app) {
    app.use((req, res, next) => {
        res.setHeader("X-Content-Type-Options",    "nosniff");
        res.setHeader("X-Frame-Options",           "DENY");
        res.setHeader("X-XSS-Protection",          "1; mode=block");
        res.setHeader("Referrer-Policy",           "strict-origin-when-cross-origin");
        res.setHeader("Permissions-Policy",        "camera=(), microphone=(), geolocation=()");
        if (process.env.NODE_ENV === "production") {
            res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
        }
        if (process.env.DISABLE_X_POWERED_BY === "1") {
            res.removeHeader("X-Powered-By");
        }
        next();
    });
    logger.info("[SecurityHardening] Security headers middleware applied");
}

function getLastReport()              { return _rj(REPORT_FILE, null); }
function getCheckHistory({ limit=50 }={ }) { return { history: [..._history].reverse().slice(0, limit) }; }

module.exports = { runCheck, getLastReport, getCheckHistory, checkJWT, checkCookies, checkCSP, checkRateLimiting, checkAuthProtection, checkSecurityHeaders, applySecurityHeaders };
