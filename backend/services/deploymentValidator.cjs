"use strict";
/**
 * DeploymentValidator — validates PM2, nginx, SSL, domain, build
 * artifacts and environment to produce a deployment readiness report.
 *
 * Each check probes the real filesystem, processes or network —
 * no mock data.
 *
 * Scoring weights:
 *   Environment    25%
 *   Build artifacts20%
 *   Process mgmt   20%
 *   Nginx/proxy    15%
 *   SSL/TLS        10%
 *   Domain         10%
 *
 * Public API:
 *   runCheck()                  → DeploymentReport
 *   getLastReport()             → DeploymentReport | null
 *   getHistory(opts)            → { history[] }
 *   checkEnvironment()          → CategoryResult
 *   checkBuildArtifacts()       → CategoryResult
 *   checkProcessManagement()    → CategoryResult
 *   checkNginx()                → CategoryResult
 *   checkSSL()                  → Promise<CategoryResult>
 *   checkDomain()               → Promise<CategoryResult>
 */

const fs     = require("fs");
const path   = require("path");
const https  = require("https");
const http   = require("http");
const dns    = require("dns").promises;
const { execSync } = require("child_process");
const logger = require("../utils/logger");
const execLog  = require("../utils/execLog.cjs");

const ROOT         = path.join(__dirname, "../..");
const REPORT_FILE  = path.join(__dirname, "../../data/deployment-validation-report.json");
const HISTORY_FILE = path.join(__dirname, "../../data/deployment-validation-history.json");

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

function _pass(name, detail) { return { name, status: "pass", detail }; }
function _warn(name, detail) { return { name, status: "warn", detail }; }
function _fail(name, detail) { return { name, status: "fail", detail }; }
function _score(checks)      { return Math.round(checks.filter(c => c.status === "pass").length / checks.length * 100); }

function _exec(cmd, timeout = 3000) {
    try { return { ok: true, out: execSync(cmd, { timeout, stdio: ["ignore","pipe","ignore"] }).toString().trim() }; }
    catch { return { ok: false, out: "" }; }
}

// ── Environment ────────────────────────────────────────────────────────────
function checkEnvironment() {
    const checks = [];
    const E = process.env;

    checks.push(E.NODE_ENV === "production" ? _pass("NODE_ENV",     "NODE_ENV=production") : _warn("NODE_ENV",     `NODE_ENV=${E.NODE_ENV || "unset"} — set to 'production'`));
    checks.push(E.PORT      ? _pass("PORT",          `PORT=${E.PORT}`) : _warn("PORT",          "PORT not set — defaulting to 5050"));
    checks.push(E.JWT_SECRET ? _pass("JWT_SECRET",    "JWT_SECRET set") : _fail("JWT_SECRET",    "JWT_SECRET missing — auth will fail"));
    checks.push(E.OPERATOR_PASSWORD_HASH ? _pass("OPERATOR_PASSWORD_HASH","Set") : _fail("OPERATOR_PASSWORD_HASH","Missing — operator login disabled"));

    // .env file exists (dev warning if checked against production)
    const envFile = path.join(ROOT, ".env");
    checks.push(fs.existsSync(envFile) ? _pass("env_file",       ".env file present") : _warn("env_file",       ".env file not found — ensure env vars are set via PM2/systemd"));

    // Check for common production env vars
    const appUrl = E.APP_URL || E.BASE_URL;
    checks.push(appUrl ? _pass("APP_URL", `APP_URL: ${appUrl}`) : _warn("APP_URL", "APP_URL/BASE_URL not set — OAuth redirects may break"));

    // Node version
    const nodeVer = parseInt(process.version.slice(1));
    checks.push(nodeVer >= 18 ? _pass("node_version", `Node ${process.version}`) : _fail("node_version", `Node ${process.version} — upgrade to 18+`));

    // Writable data dir
    try { fs.accessSync(path.join(ROOT, "data"), fs.constants.W_OK); checks.push(_pass("data_writable", "data/ writable")); }
    catch { checks.push(_fail("data_writable", "data/ not writable")); }

    return { category: "environment", score: _score(checks), checks };
}

// ── Build Artifacts ───────────────────────────────────────────────────────
function checkBuildArtifacts() {
    const checks = [];
    const buildDir = path.join(ROOT, "frontend/build");

    checks.push(fs.existsSync(path.join(buildDir, "index.html"))      ? _pass("frontend_index",     "frontend/build/index.html present") : _fail("frontend_index",     "Frontend not built — run: cd frontend && npm run build"));
    checks.push(fs.existsSync(path.join(buildDir, "asset-manifest.json")) ? _pass("asset_manifest",    "asset-manifest.json present")       : _warn("asset_manifest",    "asset-manifest.json missing"));

    // JS bundle
    const jsDir   = path.join(buildDir, "static/js");
    const jsFiles = fs.existsSync(jsDir) ? fs.readdirSync(jsDir).filter(f => f.endsWith(".js")) : [];
    checks.push(jsFiles.length > 0 ? _pass("js_bundle",         `${jsFiles.length} JS bundle(s) found`) : _fail("js_bundle",         "No JS bundles in frontend/build/static/js"));

    // CSS bundle
    const cssDir   = path.join(buildDir, "static/css");
    const cssFiles = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).filter(f => f.endsWith(".css")) : [];
    checks.push(cssFiles.length > 0 ? _pass("css_bundle",        `${cssFiles.length} CSS bundle(s) found`) : _warn("css_bundle",        "No CSS bundles"));

    // package.json
    checks.push(fs.existsSync(path.join(ROOT, "package.json")) ? _pass("package_json",       "package.json present") : _fail("package_json",       "package.json missing"));

    // node_modules
    checks.push(fs.existsSync(path.join(ROOT, "node_modules"))  ? _pass("node_modules",       "node_modules present") : _fail("node_modules",       "node_modules missing — run npm install"));

    // Check no source maps in prod (security)
    const hasMaps = jsFiles.some(f => !f.endsWith(".map")) && fs.existsSync(jsDir) && fs.readdirSync(jsDir).some(f => f.endsWith(".map"));
    checks.push(!hasMaps ? _pass("no_sourcemaps_exposed", "Source maps not in prod bundle root") : _warn("no_sourcemaps_exposed", "Source maps present in build — consider removing in production"));

    return { category: "build_artifacts", score: _score(checks), checks };
}

// ── Process Management (PM2) ──────────────────────────────────────────────
function checkProcessManagement() {
    const checks = [];

    const pm2Env = !!(process.env.PM2_HOME || process.env.pm_id !== undefined || process.env.name);
    checks.push(pm2Env ? _pass("pm2_running",    "Process running under PM2") : _warn("pm2_running",    "Not running under PM2 — no auto-restart on crash"));

    // pm2 binary available
    const pm2Bin = _exec("which pm2");
    checks.push(pm2Bin.ok ? _pass("pm2_installed",  `PM2 installed at ${pm2Bin.out}`) : _warn("pm2_installed",  "PM2 not installed — run: npm install -g pm2"));

    // ecosystem.config.js
    const ecosystemPaths = ["ecosystem.config.js", "ecosystem.config.cjs", "pm2.config.js"].map(f => path.join(ROOT, f));
    const ecosystemExists = ecosystemPaths.some(fs.existsSync);
    checks.push(ecosystemExists ? _pass("ecosystem_config", "PM2 ecosystem config found") : _warn("ecosystem_config","No ecosystem.config.js — create for production deployment"));

    // Process uptime > 5 min (stability check)
    checks.push(process.uptime() > 300 ? _pass("process_stable",  `Uptime ${Math.round(process.uptime() / 60)}min — stable`) : _warn("process_stable",  `Uptime ${Math.round(process.uptime())}s — may be in restart loop`));

    // Memory usage check (<500MB RSS)
    const rssMB = Math.round(process.memoryUsage().rss / 1_048_576);
    checks.push(rssMB < 500 ? _pass("memory_usage",    `RSS ${rssMB}MB — within limits`) : _warn("memory_usage",    `RSS ${rssMB}MB — high memory usage`));

    return { category: "process_management", score: _score(checks), checks };
}

// ── Nginx ─────────────────────────────────────────────────────────────────
function checkNginx() {
    const checks = [];

    // nginx binary
    const nginxBin = _exec("which nginx");
    checks.push(nginxBin.ok ? _pass("nginx_installed",  `nginx at ${nginxBin.out}`) : _warn("nginx_installed",  "nginx not found in PATH — may not be installed or using different proxy"));

    // nginx running
    const nginxProc = _exec("pgrep nginx");
    checks.push(nginxProc.ok ? _pass("nginx_running",    "nginx process detected") : _warn("nginx_running",    "nginx not running — check if behind a different reverse proxy"));

    // nginx config files
    const nginxConf = path.join(ROOT, "nginx.conf");
    const nginxSiteConf = path.join(ROOT, "nginx.site.conf");
    const hasConf = fs.existsSync(nginxConf) || fs.existsSync(nginxSiteConf);
    checks.push(hasConf ? _pass("nginx_config",     "Nginx config file present in repo") : _warn("nginx_config",     "No nginx.conf in project root — document deployment config"));

    if (hasConf) {
        const confContent = fs.existsSync(nginxConf) ? fs.readFileSync(nginxConf, "utf8") : fs.readFileSync(nginxSiteConf, "utf8");
        checks.push(confContent.includes("proxy_pass") ? _pass("nginx_proxy",      "proxy_pass configured in nginx.conf") : _warn("nginx_proxy",      "proxy_pass not found in nginx config"));
        checks.push(confContent.includes("limit_req")  ? _pass("nginx_rate_limit", "Nginx rate limiting (limit_req) configured") : _warn("nginx_rate_limit", "Nginx rate limiting not configured"));
        checks.push(confContent.includes("ssl_certificate") || confContent.includes("ssl on") ? _pass("nginx_ssl",         "SSL configured in nginx") : _warn("nginx_ssl",         "SSL not configured in nginx — HTTP only"));
    }

    return { category: "nginx", score: _score(checks), checks };
}

// ── SSL ───────────────────────────────────────────────────────────────────
async function checkSSL() {
    const checks = [];
    const domain = (process.env.APP_URL || "").replace(/^https?:\/\//, "").split("/")[0].split(":")[0];

    if (!domain || domain.includes("localhost") || domain.includes("127.0.0.1")) {
        checks.push(_warn("ssl_domain",    "No production domain configured — SSL checks skipped (localhost)"));
        return { category: "ssl", score: _score(checks), checks };
    }

    // Check SSL certificate via TLS socket
    await new Promise(resolve => {
        try {
            const req = https.request({ hostname: domain, port: 443, path: "/", method: "HEAD", timeout: 5000 }, res => {
                const cert = res.socket?.getPeerCertificate?.();
                if (cert?.valid_to) {
                    const expiry = new Date(cert.valid_to);
                    const daysLeft = Math.round((expiry - Date.now()) / 86_400_000);
                    checks.push(daysLeft > 30 ? _pass("ssl_valid",     `SSL cert valid, expires in ${daysLeft} days`) :
                                daysLeft > 0  ? _warn("ssl_expiring",  `SSL cert expires in ${daysLeft} days — renew soon`) :
                                                _fail("ssl_expired",   "SSL certificate EXPIRED"));
                    checks.push(cert.issuer ? _pass("ssl_issuer",   `Issued by: ${cert.issuer.O || cert.issuer.CN}`) : _warn("ssl_issuer", "Could not read certificate issuer"));
                } else {
                    checks.push(_warn("ssl_cert",       "Connected via HTTPS but could not read certificate details"));
                }
                resolve();
            });
            req.on("error", () => { checks.push(_fail("ssl_connect",   `Could not connect to ${domain}:443 — SSL not configured`)); resolve(); });
            req.on("timeout", () => { checks.push(_warn("ssl_timeout",  `SSL probe to ${domain} timed out`)); req.destroy(); resolve(); });
            req.end();
        } catch { checks.push(_warn("ssl_check", "SSL check failed unexpectedly")); resolve(); }
    });

    // Let's Encrypt cert-bot presence
    const certbotBin = _exec("which certbot");
    checks.push(certbotBin.ok ? _pass("certbot",       "certbot installed (Let's Encrypt)") : _warn("certbot",       "certbot not found — use certbot for free SSL"));

    return { category: "ssl", score: _score(checks), checks };
}

// ── Domain ────────────────────────────────────────────────────────────────
async function checkDomain() {
    const checks = [];
    const appUrl = process.env.APP_URL || "";
    const domain = appUrl.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];

    if (!domain || domain.includes("localhost")) {
        checks.push(_warn("domain_config", "APP_URL not set or is localhost — domain checks skipped"));
        return { category: "domain", score: _score(checks), checks };
    }

    // DNS resolution
    try {
        const addrs = await dns.resolve4(domain);
        checks.push(_pass("dns_resolves",     `${domain} resolves to ${addrs[0]}`));
    } catch (e) {
        checks.push(_fail("dns_resolves",     `DNS lookup failed for ${domain}: ${e.code || e.message}`));
    }

    // HTTPS accessible
    await new Promise(resolve => {
        const req = https.request({ hostname: domain, port: 443, path: "/health", method: "GET", timeout: 5000 }, res => {
            checks.push(res.statusCode < 500 ? _pass("https_reachable", `${domain} reachable via HTTPS (${res.statusCode})`) : _warn("https_reachable", `${domain} HTTPS returned ${res.statusCode}`));
            resolve();
        });
        req.on("error",   () => { checks.push(_warn("https_reachable",  `${domain} HTTPS not reachable`)); resolve(); });
        req.on("timeout", () => { checks.push(_warn("https_timeout",    `${domain} HTTPS probe timed out`)); req.destroy(); resolve(); });
        req.end();
    });

    // www redirect check
    checks.push(domain.startsWith("www.") || appUrl.includes("www.")
        ? _pass("www_configured",   "www subdomain included in APP_URL")
        : _warn("www_configured",   "APP_URL does not include www — ensure www redirects to apex or vice versa"));

    return { category: "domain", score: _score(checks), checks };
}

// ── Aggregation ───────────────────────────────────────────────────────────
const WEIGHTS = { environment: 0.25, build_artifacts: 0.20, process_management: 0.20, nginx: 0.15, ssl: 0.10, domain: 0.10 };

function _grade(score) {
    if (score >= 90) return "READY";
    if (score >= 70) return "NEARLY_READY";
    if (score >= 50) return "NEEDS_WORK";
    return "BLOCKED";
}

async function runCheck() {
    const env    = checkEnvironment();
    const build  = checkBuildArtifacts();
    const proc   = checkProcessManagement();
    const nginx  = checkNginx();
    const ssl    = await checkSSL();
    const domain = await checkDomain();

    const cats  = { environment: env, build_artifacts: build, process_management: proc, nginx, ssl, domain };
    const score = Math.round(
        env.score   * WEIGHTS.environment +
        build.score * WEIGHTS.build_artifacts +
        proc.score  * WEIGHTS.process_management +
        nginx.score * WEIGHTS.nginx +
        ssl.score   * WEIGHTS.ssl +
        domain.score * WEIGHTS.domain
    );

    const allChecks = Object.values(cats).flatMap(c => c.checks.map(ch => ({ category: c.category, ...ch })));
    const failures  = allChecks.filter(c => c.status === "fail");
    const warnings  = allChecks.filter(c => c.status === "warn");

    const report = {
        ts: new Date().toISOString(), score, grade: _grade(score),
        categories: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, { score: v.score }])),
        breakdown: cats, failures, warnings,
        totalChecks: allChecks.length, passing: allChecks.filter(c => c.status === "pass").length,
    };
    try { _wj(REPORT_FILE, report); } catch { /* non-critical */ }
    _history.push({ ts: report.ts, score, grade: report.grade, failures: failures.length });
    _saveHistory();
    execLog.append({ agentId: "DeploymentValidator", taskType: "deployment_validation", taskId: `dv_${Date.now()}`, success: score >= 70, durationMs: 0 });
    logger.info(`[DeploymentValidator] Score: ${score}/100 (${report.grade}) — ${failures.length} failures, ${warnings.length} warnings`);
    return report;
}

function getLastReport()             { return _rj(REPORT_FILE, null); }
function getHistory({ limit = 20 } = {}) { return { history: [..._history].reverse().slice(0, limit) }; }

module.exports = { runCheck, getLastReport, getHistory, checkEnvironment, checkBuildArtifacts, checkProcessManagement, checkNginx, checkSSL, checkDomain };
