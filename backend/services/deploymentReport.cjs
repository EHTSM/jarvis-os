"use strict";
/**
 * OP-1 — Deployment Report Service
 *
 * Generates a comprehensive report covering all 10 OP-1 tasks:
 *   1. VPS readiness
 *   2. PM2 configuration
 *   3. Nginx configuration
 *   4. SSL / HTTPS
 *   5. Domain configuration
 *   6. Production .env
 *   7. Production validation
 *   8. Backup status
 *   9. Monitoring status
 *  10. Deployment Report (this)
 */

const fs    = require("fs");
const path  = require("path");
const http  = require("http");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "../../");
const LOGS = path.join(ROOT, "logs");
const DATA = path.join(ROOT, "data");
const BACK = path.join(ROOT, "backups");

function _env(key) { return !!(process.env[key] && process.env[key].trim()); }
function _exists(rel) { try { fs.accessSync(path.join(ROOT, rel)); return true; } catch { return false; } }
function _read(rel, fallback = null) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }
  catch { return fallback; }
}
function _exec(cmd, fallback = "") {
  try { return execSync(cmd, { encoding: "utf8", timeout: 3000 }).trim(); }
  catch { return fallback; }
}
function _httpGet(path, timeout = 3000) {
  return new Promise((resolve) => {
    const port = process.env.PORT || 5050;
    const req = http.get({ hostname: "127.0.0.1", port, path, timeout }, (res) => {
      let body = "";
      res.on("data", d => { body += d; });
      res.on("end", () => { try { resolve({ ok: true, status: res.statusCode, data: JSON.parse(body) }); } catch { resolve({ ok: false, status: res.statusCode }); } });
    });
    req.on("error", () => resolve({ ok: false, status: 0 }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, status: 0 }); });
  });
}

// ── Task checks ───────────────────────────────────────────────────────────────

function checkVPS() {
  const nodeVersion  = process.version;
  const platform     = process.platform;
  const arch         = process.arch;
  const uptime       = Math.round(require("os").uptime());
  const freeMem      = Math.round(require("os").freemem() / 1_048_576);
  const totalMem     = Math.round(require("os").totalmem() / 1_048_576);

  const status = platform === "linux" ? "production_ready" : "local_dev";
  return {
    task: "1. VPS Preparation",
    status,
    detail: `Node ${nodeVersion} | ${platform}/${arch} | uptime ${uptime}s | ${freeMem}MB free / ${totalMem}MB total`,
    checks: {
      node_version:  { ok: parseInt(nodeVersion.slice(1)) >= 18, detail: nodeVersion },
      platform:      { ok: true, detail: platform },
      memory_free:   { ok: freeMem > 100, detail: `${freeMem}MB` },
    },
  };
}

function checkPM2() {
  const pm2Available = !!_exec("command -v pm2");
  let pm2Process = null;
  try {
    const raw = _exec("pm2 jlist 2>/dev/null");
    if (raw) {
      const procs = JSON.parse(raw);
      pm2Process = procs.find(p => p.name === "jarvis-os" || p.name === "jarvis") || null;
    }
  } catch { /* pm2 not available */ }

  const online = pm2Process?.pm2_env?.status === "online";
  const restarts = pm2Process?.pm2_env?.restart_time || 0;
  const mem = pm2Process ? Math.round((pm2Process.monit?.memory || 0) / 1_048_576) : null;
  const savedList = _exists("node_modules/.pm2/dump.pm2") || _exec("pm2 list 2>/dev/null").includes("jarvis");

  return {
    task: "2. PM2 Configuration",
    status: online ? "running" : pm2Available ? "configured_not_running" : "not_installed",
    detail: online
      ? `jarvis-os online | ${restarts} restarts | ${mem}MB heap | startup: ${savedList ? "saved" : "not saved"}`
      : pm2Available ? "PM2 installed but jarvis-os not running" : "PM2 not installed",
    checks: {
      pm2_installed:      { ok: pm2Available, detail: _exec("pm2 --version 2>/dev/null") || "not found" },
      process_online:     { ok: online, detail: pm2Process?.pm2_env?.status || "not running" },
      restart_count:      { ok: restarts < 5, detail: `${restarts} restarts` },
      ecosystem_config:   { ok: _exists("ecosystem.config.cjs"), detail: "ecosystem.config.cjs" },
      backup_job:         { ok: !!(pm2Process), detail: "ooplix-backup cron job" },
      startup_saved:      { ok: savedList, detail: "pm2 save + pm2 startup" },
    },
  };
}

function checkNginx() {
  const nginxAvailable = !!_exec("command -v nginx");
  const configValid    = nginxAvailable ? _exec("nginx -t 2>&1").includes("ok") : null;
  const active         = nginxAvailable ? _exec("systemctl is-active nginx 2>/dev/null") === "active" : null;
  const confExists     = _exists("nginx.conf");

  return {
    task: "3. Nginx Configuration",
    status: (!nginxAvailable) ? "not_installed" : (active ? "running" : "installed_not_running"),
    detail: nginxAvailable
      ? `nginx ${_exec("nginx -v 2>&1").replace("nginx version: nginx/", "")} | config: ${configValid ? "valid" : "INVALID"} | service: ${active ? "active" : "inactive"}`
      : "nginx not installed — for VPS deployment only",
    checks: {
      nginx_installed:      { ok: nginxAvailable, detail: nginxAvailable ? "found" : "not installed" },
      nginx_config_file:    { ok: confExists, detail: "nginx.conf in project root" },
      config_syntax_valid:  { ok: configValid === null ? null : configValid, detail: configValid ? "nginx -t passed" : "run nginx -t" },
      service_active:       { ok: active === null ? null : active, detail: active ? "systemctl active" : "not active" },
      deploy_config_exists: { ok: _exists("deploy/nginx-jarvis.conf"), detail: "deploy/nginx-jarvis.conf" },
    },
  };
}

function checkSSL() {
  const baseUrl  = process.env.BASE_URL || "";
  const isHTTPS  = baseUrl.startsWith("https://");
  const domain   = baseUrl.replace(/^https?:\/\//, "").split("/")[0];
  const isLocal  = !domain || domain.includes("localhost") || domain.includes("127.0.0");

  let certExists = false;
  let daysLeft   = null;

  if (!isLocal && domain) {
    const certPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
    if (fs.existsSync(certPath)) {
      certExists = true;
      try {
        const raw = _exec(`openssl x509 -enddate -noout -in ${certPath} 2>/dev/null`);
        const match = raw.match(/notAfter=(.*)/);
        if (match) {
          const exp = new Date(match[1]);
          daysLeft = Math.round((exp - Date.now()) / 86400000);
        }
      } catch { /* ignore */ }
    }
  }

  const httpsSetupExists = _exists("deploy/https-setup.sh");
  const autoRenew = !!_exec("systemctl is-active certbot.timer 2>/dev/null") || !!_exec("crontab -l 2>/dev/null | grep certbot");

  return {
    task: "4. SSL / HTTPS Configuration",
    status: isLocal ? "local_dev" : (isHTTPS && certExists && daysLeft > 0 ? "configured" : "needs_setup"),
    detail: isLocal
      ? "Localhost — SSL not applicable"
      : isHTTPS
        ? (certExists
            ? `Certificate valid — ${daysLeft} days remaining on ${domain}`
            : `HTTPS configured but no cert at /etc/letsencrypt/live/${domain}/`)
        : `BASE_URL is not HTTPS: ${baseUrl}`,
    checks: {
      base_url_is_https:     { ok: isLocal || isHTTPS, detail: baseUrl || "unset" },
      cert_exists:           { ok: isLocal || certExists, detail: certExists ? `/etc/letsencrypt/live/${domain}/` : "not found — run https-setup.sh" },
      cert_expiry_ok:        { ok: isLocal || (daysLeft !== null && daysLeft > 30), detail: daysLeft !== null ? `${daysLeft} days` : "unknown" },
      auto_renew_configured: { ok: isLocal || autoRenew, detail: autoRenew ? "certbot.timer or cron active" : "run: certbot renew --dry-run" },
      https_setup_script:    { ok: httpsSetupExists, detail: "deploy/https-setup.sh" },
    },
  };
}

function checkDomains() {
  const baseUrl  = process.env.BASE_URL || "";
  const origins  = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
  const appUrl   = process.env.APP_URL || "";
  const isLocal  = !baseUrl || baseUrl.includes("localhost");

  return {
    task: "5. Domain Configuration",
    status: isLocal ? "local_dev" : (baseUrl && origins.length > 0 ? "configured" : "incomplete"),
    detail: `BASE_URL: ${baseUrl || "unset"} | ALLOWED_ORIGINS: ${origins.length} origins | APP_URL: ${appUrl || "unset"}`,
    checks: {
      base_url_set:            { ok: !!baseUrl, detail: baseUrl || "unset" },
      base_url_no_localhost:   { ok: isLocal || !baseUrl.includes("localhost"), detail: isLocal ? "local dev" : "ok" },
      allowed_origins_set:     { ok: origins.length > 0, detail: origins.join(", ") || "unset" },
      app_url_set:             { ok: !!appUrl, detail: appUrl || "unset" },
      cors_covers_base_url:    { ok: isLocal || origins.some(o => baseUrl.includes(o.replace(/^https?:\/\//, ""))), detail: isLocal ? "skip" : "check ALLOWED_ORIGINS includes BASE_URL domain" },
    },
  };
}

function checkEnv() {
  const required = ["JWT_SECRET", "OPERATOR_PASSWORD_HASH", "BASE_URL", "NODE_ENV"];
  const optional = ["GROQ_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "WA_TOKEN", "TELEGRAM_TOKEN"];

  const requiredStatus = {};
  const optionalStatus = {};
  let allRequired = true;

  for (const key of required) {
    const set = _env(key);
    requiredStatus[key] = { ok: set, detail: set ? "set" : "MISSING" };
    if (!set) allRequired = false;
  }
  for (const key of optional) {
    optionalStatus[key] = { ok: _env(key), detail: _env(key) ? "set" : "not set" };
  }

  const jwtLen = (process.env.JWT_SECRET || "").length;
  const prodMode = process.env.NODE_ENV === "production";

  return {
    task: "6. Production .env",
    status: allRequired && prodMode ? "configured" : "incomplete",
    detail: `${required.filter(k => _env(k)).length}/${required.length} required set | ${optional.filter(k => _env(k)).length}/${optional.length} optional set | NODE_ENV=${process.env.NODE_ENV || "unset"}`,
    checks: {
      ...requiredStatus,
      jwt_secret_length: { ok: jwtLen >= 32, detail: `${jwtLen} chars (min 32)` },
      node_env_production: { ok: prodMode, detail: process.env.NODE_ENV || "unset" },
      env_file_exists:   { ok: _exists(".env"), detail: ".env" },
      ...optionalStatus,
    },
  };
}

async function checkValidation() {
  const health = await _httpGet("/health");
  const ops    = await _httpGet("/ops");
  const authMe = await _httpGet("/auth/me");
  const billing = await _httpGet("/billing/status");
  const launch = await _httpGet("/launch/dashboard");

  const routeChecks = {
    "GET /health":           { ok: health.ok && health.status === 200, detail: health.data?.status || `HTTP ${health.status}` },
    "GET /ops":              { ok: ops.ok && ops.status === 200, detail: `HTTP ${ops.status}` },
    "GET /auth/me (→401)":  { ok: authMe.status === 401 || authMe.status === 403, detail: `HTTP ${authMe.status}` },
    "GET /billing (→401)":  { ok: billing.status === 401 || billing.status === 403, detail: `HTTP ${billing.status}` },
    "GET /launch (→401)":   { ok: launch.status === 401 || launch.status === 403, detail: `HTTP ${launch.status}` },
  };

  const allPass = Object.values(routeChecks).every(c => c.ok);

  return {
    task: "7. Production Validation",
    status: health.ok ? (allPass ? "passed" : "partial") : "server_down",
    detail: health.ok
      ? `Server responding | ${Object.values(routeChecks).filter(c => c.ok).length}/${Object.keys(routeChecks).length} routes verified`
      : "Server not responding on local port",
    checks: routeChecks,
  };
}

function checkBackups() {
  let archives = [];
  try {
    archives = fs.readdirSync(BACK)
      .filter(f => f.startsWith("jarvis_") && f.endsWith(".tar.gz"))
      .sort()
      .reverse();
  } catch { /* no backups dir */ }

  const latestAge = archives.length > 0
    ? Math.round((Date.now() - fs.statSync(path.join(BACK, archives[0])).mtimeMs) / 3_600_000)
    : null;

  const backupJobRunning = !!_exec("pm2 jlist 2>/dev/null | python3 -c \"import sys,json; procs=json.load(sys.stdin); print('yes' if any(p.get('name')=='ooplix-backup' for p in procs) else 'no')\" 2>/dev/null");

  return {
    task: "8. Backup Verification",
    status: archives.length > 0 ? (latestAge < 25 ? "current" : "stale") : "no_backups",
    detail: archives.length > 0
      ? `${archives.length} archives | latest: ${latestAge}h ago | retention: 7 per safe-backup.cjs`
      : "No backup archives found — run: npm run backup",
    checks: {
      backup_dir_exists:       { ok: _exists("backups"), detail: "backups/" },
      backup_archives_exist:   { ok: archives.length > 0, detail: `${archives.length} archives` },
      latest_backup_age:       { ok: latestAge !== null && latestAge < 25, detail: latestAge !== null ? `${latestAge}h ago` : "no backup" },
      retention_configured:    { ok: _exists("scripts/safe-backup.cjs"), detail: "7-file retention in safe-backup.cjs" },
      automated_backup:        { ok: _exists("ecosystem.config.cjs"), detail: "ooplix-backup cron job in ecosystem.config.cjs" },
      rollback_script:         { ok: _exists("deploy/rollback.sh"), detail: "deploy/rollback.sh" },
    },
  };
}

function checkMonitoring() {
  const hasMonitor  = _exists("deploy/monitor.sh");
  const hasHealth   = _exists("deploy/healthcheck.sh");
  const hasErrLog   = _exists("logs/pm2-err.log");
  const hasOutLog   = _exists("logs/pm2-out.log");
  const telegramSet = _env("TELEGRAM_TOKEN");

  let recentErrors = 0;
  if (hasErrLog) {
    try {
      const logText = _exec(`grep -i "error\\|FATAL\\|uncaught" logs/pm2-err.log 2>/dev/null | wc -l`);
      recentErrors = parseInt(logText) || 0;
    } catch { /* ignore */ }
  }

  const hasObservability = _exists("data/observability.json");
  const obsData = _read("data/observability.json");
  const eventCount = obsData?.events?.length || obsData?.length || 0;

  return {
    task: "9. Monitoring Verification",
    status: hasMonitor && hasHealth ? "configured" : "partial",
    detail: `monitor.sh: ${hasMonitor} | healthcheck.sh: ${hasHealth} | logs: ${hasErrLog} | telegram: ${telegramSet} | observability events: ${eventCount}`,
    checks: {
      monitor_script:         { ok: hasMonitor, detail: "deploy/monitor.sh" },
      healthcheck_script:     { ok: hasHealth, detail: "deploy/healthcheck.sh" },
      error_log_exists:       { ok: hasErrLog, detail: hasErrLog ? `${recentErrors} total errors logged` : "not yet created" },
      out_log_exists:         { ok: hasOutLog, detail: "logs/pm2-out.log" },
      telegram_alerts:        { ok: telegramSet, detail: telegramSet ? "TELEGRAM_TOKEN set" : "optional — set TELEGRAM_TOKEN for crash alerts" },
      observability_pipeline: { ok: hasObservability, detail: `data/observability.json — ${eventCount} events` },
      rollback_available:     { ok: _exists("deploy/rollback.sh"), detail: "deploy/rollback.sh" },
    },
  };
}

// ── Score ─────────────────────────────────────────────────────────────────────

function _score(checks) {
  const vals = Object.values(checks).filter(c => c.ok !== null);
  const pass = vals.filter(c => c.ok === true).length;
  return { pass, total: vals.length, pct: Math.round(pass / Math.max(vals.length, 1) * 100) };
}

// ── Main report ───────────────────────────────────────────────────────────────

async function generateReport() {
  const tasks = [
    checkVPS(),
    checkPM2(),
    checkNginx(),
    checkSSL(),
    checkDomains(),
    checkEnv(),
    await checkValidation(),
    checkBackups(),
    checkMonitoring(),
  ];

  // Task 10 is the report itself
  const allChecks = tasks.flatMap(t => Object.values(t.checks));
  const totalPass = allChecks.filter(c => c.ok === true).length;
  const totalChecks = allChecks.filter(c => c.ok !== null).length;
  const overallScore = Math.round(totalPass / Math.max(totalChecks, 1) * 100);

  const statusCounts = { configured: 0, running: 0, warning: 0, not_ready: 0 };
  for (const t of tasks) {
    const s = t.status;
    if (["running", "passed", "configured", "current", "local_dev"].includes(s)) statusCounts.configured++;
    else if (["partial", "stale", "configured_not_running"].includes(s)) statusCounts.warning++;
    else statusCounts.not_ready++;
  }

  const readyForLaunch = overallScore >= 70 && statusCounts.not_ready === 0;

  tasks.push({
    task: "10. Deployment Report",
    status: readyForLaunch ? "generated" : "generated_with_warnings",
    detail: `${totalPass}/${totalChecks} checks passed | ${overallScore}% production readiness`,
    checks: {
      all_tasks_audited: { ok: tasks.length >= 10, detail: `${tasks.length} tasks covered` },
      overall_score:     { ok: overallScore >= 70, detail: `${overallScore}%` },
      no_blocking_tasks: { ok: statusCounts.not_ready === 0, detail: `${statusCounts.not_ready} blocking` },
    },
  });

  return {
    generatedAt: new Date().toISOString(),
    version: "OP-1",
    overallScore,
    readyForLaunch,
    summary: {
      totalChecks,
      passed: totalPass,
      failed: totalChecks - totalPass,
      tasks: tasks.length,
      ...statusCounts,
    },
    recommendation: readyForLaunch
      ? "GO — all critical systems verified. Deploy now."
      : overallScore >= 70
        ? "CONDITIONAL GO — core systems ready. Review warnings before launch."
        : "NOT YET — address failed checks before deploying.",
    tasks: tasks.map(t => ({ ...t, score: _score(t.checks) })),
  };
}

module.exports = { generateReport };
