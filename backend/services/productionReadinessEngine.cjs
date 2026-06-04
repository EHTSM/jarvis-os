"use strict";
/**
 * ProductionReadinessEngine — validate deployment, config, security,
 * and dependencies, then emit a scored readiness report.
 *
 * Score: 0–100. Each category contributes a weighted sub-score.
 *   Deployment   25%  — process manager, PORT, NODE_ENV, static build
 *   Config       25%  — required env vars, credential completeness
 *   Security     30%  — JWT_SECRET length, password hash, HTTPS, CORS
 *   Dependencies 20%  — critical npm packages, node version
 *
 * Grade:
 *   90–100  PRODUCTION_READY
 *   75–89   NEARLY_READY
 *   50–74   NEEDS_WORK
 *   <50     NOT_READY
 *
 * Public API:
 *   runCheck()                  → ReadinessReport
 *   getLastReport()             → ReadinessReport | null
 *   getCheckHistory(opts)       → { reports[] }
 *   validateDeployment()        → CategoryResult
 *   validateConfig()            → CategoryResult
 *   validateSecurity()          → CategoryResult
 *   validateDependencies()      → CategoryResult
 */

const fs      = require("fs");
const path    = require("path");
const crypto  = require("crypto");
const logger  = require("../utils/logger");

const REPORT_FILE  = path.join(__dirname, "../../data/readiness-report.json");
const HISTORY_FILE = path.join(__dirname, "../../data/readiness-history.json");

function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, f);
}

let _history = _rj(HISTORY_FILE, []);
function _saveHistory() { try { _wj(HISTORY_FILE, _history.slice(-50)); } catch { /* non-fatal */ } }

// ── Check helpers ─────────────────────────────────────────────────────────
function _pass(name, detail)  { return { name, status: "pass", detail }; }
function _warn(name, detail)  { return { name, status: "warn", detail }; }
function _fail(name, detail)  { return { name, status: "fail", detail }; }

// ── Deployment validation ────────────────────────────────────────────────
function validateDeployment() {
    const checks = [];
    const ROOT = path.join(__dirname, "../..");

    // NODE_ENV
    const env = process.env.NODE_ENV;
    checks.push(env === "production" ? _pass("NODE_ENV", "Set to production") : _warn("NODE_ENV", `Currently '${env || "unset"}' — set NODE_ENV=production for production`));

    // PORT
    const port = process.env.PORT;
    checks.push(port ? _pass("PORT", `Listening on ${port}`) : _warn("PORT", "PORT not set — defaulting to 5050"));

    // Frontend build
    const buildDir = path.join(ROOT, "frontend/build/index.html");
    checks.push(fs.existsSync(buildDir) ? _pass("frontend_build", "frontend/build/index.html present") : _fail("frontend_build", "Frontend not built — run: cd frontend && npm run build"));

    // data directory writable
    const dataDir = path.join(ROOT, "data");
    try { fs.accessSync(dataDir, fs.constants.W_OK); checks.push(_pass("data_writable", "data/ directory is writable")); }
    catch { checks.push(_fail("data_writable", "data/ directory is not writable")); }

    // Process manager (PM2)
    const pm2Flag = !!process.env.PM2_HOME || !!process.env.pm_id || !!process.env.name;
    checks.push(pm2Flag ? _pass("process_manager", "Running under PM2") : _warn("process_manager", "No process manager detected — use PM2 for production: pm2 start ecosystem.config.js"));

    // Uptime (crash recovery check)
    const uptimeSec = process.uptime();
    checks.push(uptimeSec > 30 ? _pass("stability", `Process uptime ${Math.round(uptimeSec)}s — stable`) : _warn("stability", `Process uptime only ${Math.round(uptimeSec)}s — may be in restart loop`));

    const passed = checks.filter(c => c.status === "pass").length;
    const score  = Math.round((passed / checks.length) * 100);
    return { category: "deployment", score, checks };
}

// ── Config validation ────────────────────────────────────────────────────
function validateConfig() {
    const checks = [];
    const E = process.env;

    // Required
    checks.push(E.JWT_SECRET      ? _pass("JWT_SECRET",     "Set")  : _fail("JWT_SECRET",     "REQUIRED — JWT auth will fail without this"));
    checks.push(E.OPERATOR_PASSWORD_HASH ? _pass("OPERATOR_PASSWORD_HASH", "Set") : _fail("OPERATOR_PASSWORD_HASH", "REQUIRED — operator login disabled"));

    // AI provider
    const hasAI = !!(E.GROQ_API_KEY || E.ANTHROPIC_API_KEY || E.OPENROUTER_API_KEY || E.OPENAI_API_KEY);
    checks.push(hasAI ? _pass("ai_provider", "At least one AI provider key set") : _warn("ai_provider", "No AI provider key — set GROQ_API_KEY or OPENROUTER_API_KEY"));

    // Comms
    checks.push((E.WA_TOKEN || E.WHATSAPP_TOKEN) ? _pass("whatsapp",  "WhatsApp token set")  : _warn("whatsapp",  "WhatsApp disabled — WA_TOKEN missing"));
    checks.push(E.TELEGRAM_TOKEN                  ? _pass("telegram",  "Telegram token set")  : _warn("telegram",  "Telegram disabled — TELEGRAM_TOKEN missing"));

    // Payments
    const hasPay = !!((E.RAZORPAY_KEY || E.RAZORPAY_KEY_ID) && (E.RAZORPAY_SECRET || E.RAZORPAY_KEY_SECRET));
    checks.push(hasPay ? _pass("payments", "Razorpay keys set") : _warn("payments", "Payments disabled — RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing"));

    // OAuth providers
    const oauthProviders = ["google","github","slack","notion"];
    let oauthConfigured = 0;
    for (const p of oauthProviders) {
        const id  = E[`${p.toUpperCase()}_CLIENT_ID`];
        const sec = E[`${p.toUpperCase()}_CLIENT_SECRET`];
        if (id && sec) { oauthConfigured++; checks.push(_pass(`oauth_${p}`, `${p} OAuth configured`)); }
        else { checks.push(_warn(`oauth_${p}`, `${p} OAuth not configured — set ${p.toUpperCase()}_CLIENT_ID + ${p.toUpperCase()}_CLIENT_SECRET`)); }
    }

    // Firebase (optional mobile)
    checks.push(E.FIREBASE_PROJECT_ID ? _pass("firebase", "Firebase configured") : _warn("firebase", "Firebase not configured — mobile auth disabled"));

    const passed = checks.filter(c => c.status === "pass").length;
    const required = checks.filter(c => c.status === "fail").length;
    const score = required > 0 ? Math.max(0, Math.round(((passed - required * 2) / checks.length) * 100)) : Math.round((passed / checks.length) * 100);
    return { category: "config", score: Math.max(0, score), checks };
}

// ── Security validation ──────────────────────────────────────────────────
function validateSecurity() {
    const checks = [];
    const E = process.env;

    // JWT_SECRET strength
    const jwt = E.JWT_SECRET || "";
    if (jwt.length >= 64)       checks.push(_pass("jwt_strength",  `JWT_SECRET is ${jwt.length} chars (strong)`));
    else if (jwt.length >= 32)  checks.push(_warn("jwt_strength",  `JWT_SECRET is ${jwt.length} chars — recommend ≥64 chars`));
    else if (jwt.length > 0)    checks.push(_fail("jwt_strength",  `JWT_SECRET is only ${jwt.length} chars — INSECURE, use 64+ random chars`));
    else                        checks.push(_fail("jwt_strength",  "JWT_SECRET not set"));

    // Password hash format
    const hash = E.OPERATOR_PASSWORD_HASH || "";
    const hashOk = hash.includes(":") && hash.length > 128;
    checks.push(hashOk ? _pass("password_hash", "OPERATOR_PASSWORD_HASH format looks valid (salt:hash)") : _fail("password_hash", "OPERATOR_PASSWORD_HASH missing or malformed — run: node scripts/generate-password-hash.cjs"));

    // No secrets in common leak spots
    const pkgPath = path.join(__dirname, "../../package.json");
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        const hasSecretInScripts = JSON.stringify(pkg.scripts || {}).includes("SECRET") || JSON.stringify(pkg.scripts || {}).includes("TOKEN");
        checks.push(hasSecretInScripts ? _fail("package_json_secrets", "Possible secrets found in package.json scripts") : _pass("package_json_secrets", "No obvious secrets in package.json"));
    } catch { checks.push(_warn("package_json_secrets", "Could not read package.json")); }

    // .env not committed (check for .gitignore)
    try {
        const gi = fs.readFileSync(path.join(__dirname, "../../.gitignore"), "utf8");
        checks.push(gi.includes(".env") ? _pass("gitignore_env", ".env is in .gitignore") : _fail("gitignore_env", ".env is NOT in .gitignore — credentials may be committed"));
    } catch { checks.push(_warn("gitignore_env", "Could not read .gitignore")); }

    // HTTPS / Secure cookies
    checks.push(E.NODE_ENV === "production" ? _pass("secure_cookies", "Secure cookies enabled in production mode") : _warn("secure_cookies", "Secure cookies disabled in non-production mode"));

    // CORS origin
    const corsOrigin = E.CORS_ORIGIN || E.APP_URL;
    checks.push(corsOrigin ? _pass("cors_origin", `CORS origin: ${corsOrigin}`) : _warn("cors_origin", "CORS_ORIGIN / APP_URL not set — defaulting to open CORS"));

    // Rate limiting enabled (check if rateLimiter module exists)
    const rateLimiterPath = path.join(__dirname, "../middleware/rateLimiter.js");
    checks.push(fs.existsSync(rateLimiterPath) ? _pass("rate_limiter", "Rate limiter middleware present") : _warn("rate_limiter", "Rate limiter not found"));

    const passed = checks.filter(c => c.status === "pass").length;
    const failed = checks.filter(c => c.status === "fail").length;
    const score  = Math.max(0, Math.round(((passed - failed * 1.5) / checks.length) * 100));
    return { category: "security", score: Math.max(0, score), checks };
}

// ── Dependency validation ────────────────────────────────────────────────
function validateDependencies() {
    const checks = [];
    const ROOT = path.join(__dirname, "../..");

    // Node version
    const nodeVer = parseInt(process.version.slice(1).split(".")[0]);
    checks.push(nodeVer >= 18 ? _pass("node_version", `Node ${process.version} (≥18 required)`) : _fail("node_version", `Node ${process.version} — upgrade to Node 18+`));

    // Critical packages
    const critical = ["express","cors","dotenv","node-cron","better-sqlite3"];
    const nmPath   = path.join(ROOT, "node_modules");
    for (const pkg of critical) {
        const exists = fs.existsSync(path.join(nmPath, pkg));
        checks.push(exists ? _pass(`dep_${pkg}`, `${pkg} installed`) : _fail(`dep_${pkg}`, `${pkg} missing — run npm install`));
    }

    // package.json existence
    checks.push(fs.existsSync(path.join(ROOT, "package.json")) ? _pass("package_json", "package.json present") : _fail("package_json", "package.json missing"));

    // package-lock.json
    checks.push(fs.existsSync(path.join(ROOT, "package-lock.json")) ? _pass("lockfile", "package-lock.json present") : _warn("lockfile", "package-lock.json missing — dependency versions may drift"));

    // Frontend node_modules
    const feNM = path.join(ROOT, "frontend/node_modules");
    checks.push(fs.existsSync(feNM) ? _pass("frontend_deps", "frontend/node_modules present") : _warn("frontend_deps", "frontend/node_modules missing — run: cd frontend && npm install"));

    const passed = checks.filter(c => c.status === "pass").length;
    const failed = checks.filter(c => c.status === "fail").length;
    const score  = Math.max(0, Math.round(((passed - failed) / checks.length) * 100));
    return { category: "dependencies", score: Math.max(0, score), checks };
}

// ── Score aggregation ────────────────────────────────────────────────────
const WEIGHTS = { deployment: 0.25, config: 0.25, security: 0.30, dependencies: 0.20 };

function _grade(score) {
    if (score >= 90) return "PRODUCTION_READY";
    if (score >= 75) return "NEARLY_READY";
    if (score >= 50) return "NEEDS_WORK";
    return "NOT_READY";
}

function runCheck() {
    const deployment   = validateDeployment();
    const config       = validateConfig();
    const security     = validateSecurity();
    const dependencies = validateDependencies();
    const categories   = { deployment, config, security, dependencies };

    const overall = Math.round(
        deployment.score   * WEIGHTS.deployment +
        config.score       * WEIGHTS.config +
        security.score     * WEIGHTS.security +
        dependencies.score * WEIGHTS.dependencies
    );
    const grade = _grade(overall);

    const blockers = Object.values(categories)
        .flatMap(cat => cat.checks.filter(c => c.status === "fail").map(c => ({ category: cat.category, ...c })));
    const warnings = Object.values(categories)
        .flatMap(cat => cat.checks.filter(c => c.status === "warn").map(c => ({ category: cat.category, ...c })));

    const report = {
        ts:         new Date().toISOString(),
        score:      overall,
        grade,
        categories: { deployment: { score: deployment.score }, config: { score: config.score }, security: { score: security.score }, dependencies: { score: dependencies.score } },
        breakdown:  categories,
        blockers,
        warnings,
        passingChecks: Object.values(categories).flatMap(c => c.checks).filter(c => c.status === "pass").length,
        totalChecks:   Object.values(categories).flatMap(c => c.checks).length,
    };
    try { _wj(REPORT_FILE, report); } catch { /* non-critical */ }
    _history.push({ ts: report.ts, score: overall, grade, blockerCount: blockers.length });
    _saveHistory();
    logger.info(`[ProdReadiness] Score: ${overall}/100 (${grade}) — ${blockers.length} blockers, ${warnings.length} warnings`);
    return report;
}

function getLastReport() { return _rj(REPORT_FILE, null); }
function getCheckHistory({ limit = 20 } = {}) { return { reports: [..._history].reverse().slice(0, limit) }; }

module.exports = { runCheck, getLastReport, getCheckHistory, validateDeployment, validateConfig, validateSecurity, validateDependencies };
