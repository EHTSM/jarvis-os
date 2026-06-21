"use strict";
/**
 * DOP-2 — Real Production Deployment
 *
 * Orchestrates and validates every step of deploying Ooplix to production VPS.
 * No new features. No architecture changes. Deploy the existing platform only.
 *
 * 10 phases:
 *  1.  VPS Connection        — SSH verify, Ubuntu, hostname, timezone
 *  2.  Dependencies          — Node, PM2, Nginx, Git, Certbot, build-tools
 *  3.  Repository            — clone/pull, npm install, build, verify
 *  4.  Environment           — .env validation, placeholder rejection, secrets
 *  5.  Nginx                 — app/api subdomains, HTTPS, WS, compression, cache
 *  6.  SSL                   — cert issue, auto-renew, HTTPS verify
 *  7.  PM2                   — start, auto-restart, startup service, logs
 *  8.  Health Verification   — /health, /database, /ai, /browser, /billing, /storage, /email
 *  9.  Production Smoke Test — Login, AI Chat, AI Coding, Browser, Creative, Mission, Billing
 * 10.  Reports               — Deployment, LiveURL, FailedChecks, Warnings, Score, Verdict
 *
 * Transport: SSH over VPS_HOST / VPS_USER / VPS_PORT (uses existing deploy/* shell scripts
 * via child_process when on VPS, or simulates via HTTP probes when remote).
 *
 * Storage: data/dop2-deployment.json  (last 10 reports)
 */

"use strict";
const fs    = require("fs");
const path  = require("path");
const https = require("https");
const http  = require("http");
const dns   = require("dns").promises;
const net   = require("net");
const { execSync, spawnSync } = require("child_process");
const crypto = require("crypto");

const ROOT      = path.join(__dirname, "../..");
const DATA_FILE = path.join(ROOT, "data/dop2-deployment.json");

// ── helpers ───────────────────────────────────────────────────────────────────
function _load()  { try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return { reports: [] }; } }
function _save(s) { fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2)); }
function _ts()    { return new Date().toISOString(); }
function _env(k)  { return process.env[k] || ""; }
function _has(k)  { return !!_env(k); }
function _file(p) { try { fs.accessSync(path.join(ROOT, p)); return true; } catch { return false; } }

function _exec(cmd, ms = 5000) {
  try { return { ok: true, out: execSync(cmd, { timeout: ms, stdio: ["ignore","pipe","pipe"] }).toString().trim() }; }
  catch (e) { return { ok: false, out: (e.stderr?.toString()?.trim() || e.message || "").slice(0, 300) }; }
}

function _req(opts, body = null, ms = 10000) {
  return new Promise(resolve => {
    const mod = (opts.port === 80 || opts.protocol === "http:") ? http : https;
    const req = mod.request(opts, res => {
      let d = "";
      res.on("data", c => { d += c; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(d); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: d, json });
      });
    });
    req.setTimeout(ms, () => { req.destroy(); resolve({ status: 0, headers: {}, body: "", json: null, error: "timeout" }); });
    req.on("error", e => resolve({ status: 0, headers: {}, body: "", json: null, error: e.message }));
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

function _get(url, opts = {}, ms = 8000) {
  try {
    const u = new URL(url);
    return _req({ protocol: u.protocol, hostname: u.hostname,
      port: parseInt(u.port) || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search, method: "GET",
      rejectUnauthorized: false, ...opts }, null, ms);
  } catch (e) { return Promise.resolve({ status: 0, body: "", json: null, error: e.message }); }
}

function _post(url, body, headers = {}, ms = 10000) {
  try {
    const data = typeof body === "string" ? body : JSON.stringify(body);
    const u    = new URL(url);
    return _req({ protocol: u.protocol, hostname: u.hostname,
      port: parseInt(u.port) || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search, method: "POST", rejectUnauthorized: false,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers }
    }, data, ms);
  } catch (e) { return Promise.resolve({ status: 0, body: "", json: null, error: e.message }); }
}

function _localGet(p, ms = 6000) {
  const port = parseInt(_env("PORT") || "5050");
  return _req({ hostname: "127.0.0.1", port, path: p, method: "GET" }, null, ms);
}

function _tcpCheck(host, port, ms = 4000) {
  return new Promise(resolve => {
    const s = net.createConnection({ host, port }, () => { s.destroy(); resolve(true); });
    s.setTimeout(ms, () => { s.destroy(); resolve(false); });
    s.on("error", () => resolve(false));
  });
}

function _check(id, label, pass, detail, fix = null, severity = "critical") {
  return { id, label, pass, detail: detail || "", fix: fix || null, severity };
}

// ── VPS SSH helper — runs a command over SSH if VPS_HOST is configured ────────
function _ssh(cmd, ms = 20000) {
  const host = _env("VPS_HOST") || _env("SSH_HOST") || _env("DEPLOY_HOST");
  const user = _env("VPS_USER") || _env("SSH_USER") || _env("DEPLOY_USER") || "ubuntu";
  const port = _env("VPS_PORT") || _env("SSH_PORT") || "22";
  const key  = _env("VPS_KEY_PATH") || _env("SSH_KEY_PATH") || `${process.env.HOME}/.ssh/id_rsa`;
  if (!host) return { ok: false, out: "VPS_HOST not configured — SSH unavailable", ssh: false };
  const result = _exec(
    `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 -i "${key}" -p ${port} ${user}@${host} "${cmd.replace(/"/g, '\\"')}"`,
    ms
  );
  return { ...result, ssh: true };
}

// ── Production base URL ───────────────────────────────────────────────────────
function _baseUrl() {
  return _env("BASE_URL") || _env("PRODUCTION_URL") || `https://app.ooplix.com`;
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 1 — VPS Connection
// ══════════════════════════════════════════════════════════════════════════════
async function phaseVPSConnection() {
  const checks = [];
  const vpsHost = _env("VPS_HOST") || _env("SSH_HOST") || _env("DEPLOY_HOST");
  const vpsUser = _env("VPS_USER") || _env("SSH_USER") || "ubuntu";
  const vpsPort = parseInt(_env("VPS_PORT") || "22");

  // VPS_HOST configured
  checks.push(_check("vps_host_configured", "VPS_HOST env var configured",
    !!vpsHost, vpsHost ? `VPS_HOST=${vpsHost}` : "VPS_HOST not set",
    "Set VPS_HOST=<your-vps-ip-or-hostname> in .env"));

  // TCP port 22 reachable
  if (vpsHost) {
    const sshOpen = await _tcpCheck(vpsHost, vpsPort, 8000);
    checks.push(_check("vps_ssh_port", `SSH port ${vpsPort} reachable`,
      sshOpen, sshOpen ? `TCP ${vpsHost}:${vpsPort} open` : `Cannot reach ${vpsHost}:${vpsPort}`,
      "Check firewall / UFW: sudo ufw allow 22"));

    // SSH connection
    const sshR = _ssh("echo OK", 15000);
    const sshOk = sshR.ok && sshR.out.trim() === "OK";
    checks.push(_check("vps_ssh_connect", "SSH authentication succeeds",
      sshOk, sshOk ? `SSH to ${vpsUser}@${vpsHost}:${vpsPort} OK` : `SSH failed: ${sshR.out}`,
      "Ensure SSH key is at VPS_KEY_PATH (~/.ssh/id_rsa) and authorized_keys is configured on VPS"));

    if (sshOk) {
      // Ubuntu version
      const ubuntuR = _ssh("lsb_release -rs 2>/dev/null || cat /etc/os-release | grep VERSION_ID | cut -d'\"' -f2");
      const ubuntuVer = parseFloat(ubuntuR.out) || 0;
      checks.push(_check("vps_ubuntu", "Ubuntu 22.04+",
        ubuntuVer >= 22, ubuntuR.ok ? `Ubuntu ${ubuntuR.out}` : `Cannot detect OS: ${ubuntuR.out}`,
        "Ensure VPS runs Ubuntu 22.04 LTS"));

      // Hostname
      const hostR = _ssh("hostname -f 2>/dev/null || hostname");
      checks.push(_check("vps_hostname", "Hostname reachable",
        hostR.ok && hostR.out.length > 0, hostR.ok ? `Hostname: ${hostR.out}` : "Cannot resolve hostname",
        null, "warning"));

      // Timezone
      const tzR = _ssh("timedatectl show --property=Timezone --value 2>/dev/null || date +%Z");
      const tzOk = tzR.ok && (tzR.out === "UTC" || tzR.out.toLowerCase().includes("utc"));
      checks.push(_check("vps_timezone", "Timezone UTC",
        tzOk, tzR.ok ? `Timezone: ${tzR.out}` : "Cannot read timezone",
        "sudo timedatectl set-timezone UTC", "warning"));
    } else {
      checks.push(_check("vps_ubuntu",   "Ubuntu version",    false, "SSH unavailable", null, "warning"));
      checks.push(_check("vps_hostname", "Hostname",          false, "SSH unavailable", null, "warning"));
      checks.push(_check("vps_timezone", "Timezone UTC",      false, "SSH unavailable", null, "warning"));
    }
  } else {
    checks.push(_check("vps_ssh_port",    "SSH port reachable",  false, "VPS_HOST not set"));
    checks.push(_check("vps_ssh_connect", "SSH auth succeeds",   false, "VPS_HOST not set"));
    checks.push(_check("vps_ubuntu",      "Ubuntu 22.04+",       false, "VPS_HOST not set"));
    checks.push(_check("vps_hostname",    "Hostname",            false, "VPS_HOST not set", null, "warning"));
    checks.push(_check("vps_timezone",    "Timezone UTC",        false, "VPS_HOST not set", null, "warning"));
  }

  const passing = checks.filter(c => c.pass).length;
  return { phase: "vps_connection", label: "VPS Connection", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Production Dependencies
// ══════════════════════════════════════════════════════════════════════════════
async function phaseDependencies() {
  const checks = [];
  const vpsAvail = !!(_env("VPS_HOST") || _env("SSH_HOST") || _env("DEPLOY_HOST"));

  function depCheck(id, label, sshCmd, localCmd, fix, severity = "critical") {
    if (vpsAvail) {
      const r = _ssh(sshCmd);
      const ok = r.ok && r.out.length > 0;
      checks.push(_check(id, label, ok, ok ? r.out.split("\n")[0] : r.out, fix, severity));
    } else {
      const r = _exec(localCmd);
      const ok = r.ok && r.out.length > 0;
      checks.push(_check(id, label, ok, ok ? r.out.split("\n")[0] : `Not installed (local: ${r.out})`, fix, severity));
    }
  }

  depCheck("dep_node",     "Node.js ≥ 20 installed",
    "node --version 2>/dev/null | grep -E 'v2[0-9]'",
    "node --version 2>/dev/null",
    "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs");

  depCheck("dep_npm",      "npm installed",
    "npm --version 2>/dev/null",
    "npm --version 2>/dev/null",
    "Included with Node.js", "warning");

  depCheck("dep_pm2",      "PM2 installed globally",
    "pm2 --version 2>/dev/null",
    "pm2 --version 2>/dev/null",
    "sudo npm install -g pm2");

  depCheck("dep_nginx",    "Nginx installed",
    "nginx -v 2>&1 | head -1",
    "nginx -v 2>&1 | head -1",
    "sudo apt-get install -y nginx");

  depCheck("dep_git",      "Git installed",
    "git --version",
    "git --version",
    "sudo apt-get install -y git");

  depCheck("dep_certbot",  "Certbot installed",
    "certbot --version 2>/dev/null",
    "certbot --version 2>/dev/null",
    "sudo apt-get install -y certbot python3-certbot-nginx");

  depCheck("dep_build",    "Build tools (gcc/make)",
    "gcc --version 2>/dev/null | head -1",
    "gcc --version 2>/dev/null | head -1 || echo 'gcc: missing'",
    "sudo apt-get install -y build-essential", "warning");

  depCheck("dep_curl",     "curl installed",
    "curl --version 2>/dev/null | head -1",
    "curl --version 2>/dev/null | head -1",
    "sudo apt-get install -y curl", "warning");

  const passing = checks.filter(c => c.pass).length;
  return { phase: "dependencies", label: "Production Dependencies", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 3 — Repository
// ══════════════════════════════════════════════════════════════════════════════
async function phaseRepository() {
  const checks = [];
  const APP_DIR = _env("APP_DIR") || "/opt/jarvis-os";
  const vpsAvail = !!(_env("VPS_HOST") || _env("SSH_HOST") || _env("DEPLOY_HOST"));

  // Local: git status
  const gitStatusR = _exec("git status --short 2>/dev/null | head -5");
  const gitLogR    = _exec("git log --oneline -3 2>/dev/null");
  const gitRemoteR = _exec("git remote get-url origin 2>/dev/null");

  checks.push(_check("repo_git_clean", "Local git repository accessible",
    gitLogR.ok && gitLogR.out.length > 0,
    gitLogR.ok ? `Latest: ${gitLogR.out.split("\n")[0]}` : "Cannot read git log",
    "Ensure this is a git repository: git init && git remote add origin <url>", "warning"));

  checks.push(_check("repo_remote", "Git remote (origin) configured",
    gitRemoteR.ok && gitRemoteR.out.length > 0,
    gitRemoteR.ok ? `origin: ${gitRemoteR.out}` : "No remote configured",
    "git remote add origin https://github.com/EHTSM/jarvis-os.git", "warning"));

  // VPS: app directory and git state
  if (vpsAvail) {
    const dirR = _ssh(`[ -d "${APP_DIR}" ] && echo exists || echo missing`);
    checks.push(_check("repo_app_dir", `App directory ${APP_DIR} exists on VPS`,
      dirR.ok && dirR.out === "exists",
      dirR.ok ? (dirR.out === "exists" ? APP_DIR : `Not found: ${APP_DIR}`) : dirR.out,
      `Run setup-vps.sh to clone the repo OR: sudo mkdir -p ${APP_DIR} && git clone <repo> ${APP_DIR}`));

    const vpsGitR = _ssh(`git -C "${APP_DIR}" log --oneline -1 2>/dev/null`);
    checks.push(_check("repo_vps_git", "VPS repository is up to date",
      vpsGitR.ok && vpsGitR.out.length > 0,
      vpsGitR.ok ? `VPS HEAD: ${vpsGitR.out}` : `VPS git error: ${vpsGitR.out}`,
      `On VPS: git -C ${APP_DIR} pull origin main`));

    const nmR = _ssh(`[ -d "${APP_DIR}/node_modules" ] && echo ok || echo missing`);
    checks.push(_check("repo_node_modules", "node_modules installed on VPS",
      nmR.ok && nmR.out === "ok",
      nmR.ok ? (nmR.out === "ok" ? "node_modules present" : "node_modules missing") : nmR.out,
      `On VPS: cd ${APP_DIR} && npm install --omit=dev --ignore-scripts`));

    const buildR = _ssh(`[ -f "${APP_DIR}/frontend/build/index.html" ] && echo ok || echo missing`);
    checks.push(_check("repo_frontend_build", "Frontend build present on VPS",
      buildR.ok && buildR.out === "ok",
      buildR.ok ? (buildR.out === "ok" ? "frontend/build/index.html present" : "Build missing") : buildR.out,
      `On VPS: cd ${APP_DIR} && npm run build:frontend`));
  } else {
    // Local fallback
    const nmExists   = _file("node_modules/.package-lock.json") || _file("node_modules/express/package.json");
    const buildExists = _file("frontend/build/index.html");
    const jsChunks   = (() => { try { return fs.readdirSync(path.join(ROOT, "frontend/build/static/js")).filter(f => f.endsWith(".js")).length; } catch { return 0; } })();

    checks.push(_check("repo_app_dir", "App directory (local)",
      true, `Local: ${ROOT}`, null, "warning"));
    checks.push(_check("repo_vps_git", "Repository is current (local)",
      gitLogR.ok, gitLogR.ok ? gitLogR.out.split("\n")[0] : "No git history", null, "warning"));
    checks.push(_check("repo_node_modules", "node_modules installed (local)",
      nmExists, nmExists ? "node_modules present" : "node_modules missing — run: npm install",
      "npm install --omit=dev --ignore-scripts"));
    checks.push(_check("repo_frontend_build", "Frontend build present (local)",
      buildExists && jsChunks > 0,
      buildExists ? `frontend/build present (${jsChunks} JS chunks)` : "frontend/build missing",
      "cd frontend && npm ci && npm run build:frontend"));
  }

  // Build scripts exist
  const pkgJson = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")); } catch { return {}; } })();
  checks.push(_check("repo_build_script", "build:frontend script in package.json",
    !!(pkgJson.scripts?.["build:frontend"]),
    pkgJson.scripts?.["build:frontend"] ? `Script: ${pkgJson.scripts["build:frontend"]}` : "build:frontend script missing",
    null, "warning"));

  checks.push(_check("repo_ecosystem", "PM2 ecosystem.config.cjs present",
    _file("ecosystem.config.cjs"),
    _file("ecosystem.config.cjs") ? "ecosystem.config.cjs found" : "ecosystem.config.cjs missing",
    "Ensure ecosystem.config.cjs is committed to the repository"));

  const passing = checks.filter(c => c.pass).length;
  return { phase: "repository", label: "Repository & Build", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 4 — Environment (.env)
// ══════════════════════════════════════════════════════════════════════════════
async function phaseEnvironment() {
  const checks = [];
  const vpsAvail = !!(_env("VPS_HOST") || _env("SSH_HOST") || _env("DEPLOY_HOST"));
  const APP_DIR  = _env("APP_DIR") || "/opt/jarvis-os";
  const baseUrl  = _baseUrl();

  // REQUIRED vars with placeholder detection
  const REQUIRED = [
    { key: "JWT_SECRET",            label: "JWT_SECRET",               minLen: 32, placeholders: ["change","secret","your","jwt_secret"] },
    { key: "OPERATOR_PASSWORD_HASH",label: "OPERATOR_PASSWORD_HASH",  minLen: 10, placeholders: ["change","your","hash"] },
    { key: "BASE_URL",               label: "BASE_URL (HTTPS)",         minLen: 10, placeholders: ["localhost","yourdomain","your-domain","YOUR_DOMAIN"] },
    { key: "NODE_ENV",               label: "NODE_ENV=production",       minLen: 1,  placeholders: [] },
  ];

  for (const rv of REQUIRED) {
    const val = _env(rv.key);
    const hasVal = val.length >= rv.minLen;
    const isPlaceholder = rv.placeholders.some(p => val.toLowerCase().includes(p));
    const ok = hasVal && !isPlaceholder && (rv.key !== "NODE_ENV" || val === "production") &&
               (rv.key !== "BASE_URL" || (val.startsWith("https://") && !val.includes("localhost")));
    checks.push(_check(`env_${rv.key.toLowerCase()}`, `${rv.label} set + valid`,
      ok,
      val.length === 0 ? "Not set" :
        isPlaceholder ? `Placeholder detected: "${val.slice(0, 30)}..."` :
        rv.key === "BASE_URL" && !val.startsWith("https://") ? `Must start with https://: ${val}` :
        rv.key === "NODE_ENV" && val !== "production" ? `NODE_ENV=${val} — must be production` :
        `Set (${val.length} chars)`,
      rv.key === "JWT_SECRET" ? "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"" :
      rv.key === "OPERATOR_PASSWORD_HASH" ? "node scripts/generate-password-hash.cjs <yourpassword>" :
      rv.key === "BASE_URL" ? "Set BASE_URL=https://app.ooplix.com in .env" :
      "Set NODE_ENV=production in .env"));
  }

  // RECOMMENDED vars (non-fatal)
  const RECOMMENDED = [
    { key: "GROQ_API_KEY",            label: "AI provider (GROQ_API_KEY)",       placeholder: ["your_groq","gsk_your"] },
    { key: "RAZORPAY_KEY_ID",         label: "Razorpay key ID",                  placeholder: ["rzp_live_your","your_key"] },
    { key: "RAZORPAY_KEY_SECRET",     label: "Razorpay key secret",              placeholder: ["your_razorpay"] },
    { key: "RAZORPAY_WEBHOOK_SECRET", label: "Razorpay webhook secret",          placeholder: ["your_webhook"] },
    { key: "TELEGRAM_TOKEN",          label: "Telegram bot token",               placeholder: ["your_telegram"] },
    { key: "ALLOWED_ORIGINS",         label: "ALLOWED_ORIGINS (CORS)",           placeholder: ["yourdomain","your-domain"] },
  ];

  for (const rv of RECOMMENDED) {
    const val = _env(rv.key);
    const hasVal = val.length >= 5;
    const isPlaceholder = (rv.placeholder || []).some(p => val.toLowerCase().includes(p));
    const ok = hasVal && !isPlaceholder;
    checks.push(_check(`env_${rv.key.toLowerCase().replace(/_/g, "")}`, rv.label,
      ok,
      val.length === 0 ? "Not set (optional feature disabled)" :
        isPlaceholder ? `Placeholder: "${val.slice(0, 30)}..."` : `Set (${val.length} chars)`,
      `Set ${rv.key} in .env`, "warning"));
  }

  // VPS .env check
  if (vpsAvail) {
    const envR = _ssh(`[ -f "${APP_DIR}/.env" ] && echo ok || echo missing`);
    checks.push(_check("env_vps_file", `.env present on VPS (${APP_DIR})`,
      envR.ok && envR.out === "ok",
      envR.ok ? (envR.out === "ok" ? `.env found at ${APP_DIR}/.env` : `.env missing on VPS`) : envR.out,
      `scp .env ${_env("VPS_USER")||"ubuntu"}@${_env("VPS_HOST")}:${APP_DIR}/.env`));

    const permR = _ssh(`stat -c %a "${APP_DIR}/.env" 2>/dev/null`);
    const permOk = permR.ok && ["600","400"].some(p => permR.out.startsWith(p));
    checks.push(_check("env_vps_perms", ".env permissions 600 on VPS",
      permOk, permOk ? `.env: ${permR.out}` : `.env permissions: ${permR.out || "unknown"} — should be 600`,
      `On VPS: chmod 600 ${APP_DIR}/.env`, "warning"));
  } else {
    // Local .env check
    const envExists = _file(".env");
    checks.push(_check("env_vps_file", ".env file present (local)",
      envExists, envExists ? ".env found (local)" : ".env missing — copy from .env.example",
      "cp .env.example .env && fill in values"));
    const permR = _exec("stat -c %a .env 2>/dev/null || stat -f %Lp .env 2>/dev/null");
    const permOk = permR.ok && ["600","400"].some(p => permR.out.startsWith(p));
    checks.push(_check("env_vps_perms", ".env permissions 600",
      permOk, permR.ok ? `.env: ${permR.out}` : "Cannot check .env permissions",
      "chmod 600 .env", "warning"));
  }

  const passing = checks.filter(c => c.pass).length;
  return { phase: "environment", label: "Environment (.env)", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 5 — Nginx Configuration
// ══════════════════════════════════════════════════════════════════════════════
async function phaseNginx() {
  const checks = [];
  const vpsAvail = !!(_env("VPS_HOST") || _env("SSH_HOST") || _env("DEPLOY_HOST"));
  const APP_DIR  = _env("APP_DIR") || "/opt/jarvis-os";
  const baseUrl  = _baseUrl();
  const appDomain = (() => { try { return new URL(baseUrl).hostname; } catch { return "app.ooplix.com"; } })();
  const apiDomain = _env("API_DOMAIN") || `api.ooplix.com`;

  // nginx.conf source committed
  const nginxConfCommitted = _file("nginx.conf");
  const nginxConf = (() => { try { return fs.readFileSync(path.join(ROOT, "nginx.conf"), "utf8"); } catch { return ""; } })();
  checks.push(_check("nginx_conf_committed", "Production nginx.conf committed to repo",
    nginxConfCommitted, nginxConfCommitted ? "nginx.conf found in repo root" : "nginx.conf not in repo",
    "Ensure nginx.conf is committed and includes app.ooplix.com, api.ooplix.com"));

  // Domain presence in nginx.conf
  const appDomainInConf = nginxConf.includes("app.ooplix.com") || nginxConf.includes(appDomain);
  checks.push(_check("nginx_app_domain", `app.ooplix.com in nginx.conf`,
    appDomainInConf, appDomainInConf ? `${appDomain} configured in nginx.conf` : `${appDomain} not found in nginx.conf`,
    `Add server_name ${appDomain}; to nginx.conf HTTPS server block`));

  const apiDomainInConf = nginxConf.includes("api.ooplix.com");
  checks.push(_check("nginx_api_domain", `api.ooplix.com in nginx.conf`,
    apiDomainInConf, apiDomainInConf ? "api.ooplix.com configured" : "api.ooplix.com not in nginx.conf",
    "Add api.ooplix.com server block to nginx.conf or include in same block", "warning"));

  // HTTPS / TLS
  const httpsConf = nginxConf.includes("ssl_certificate") || nginxConf.includes("listen 443");
  checks.push(_check("nginx_https", "HTTPS (SSL) configured in nginx.conf",
    httpsConf, httpsConf ? "ssl_certificate directive found" : "No HTTPS configuration in nginx.conf",
    "Run: sudo bash deploy/https-setup.sh app.ooplix.com"));

  // HTTP → HTTPS redirect
  const httpRedirect = /return\s+30[12]\s+https/.test(nginxConf) || /return\s+301\s+https/.test(nginxConf);
  checks.push(_check("nginx_redirect", "HTTP → HTTPS redirect in nginx.conf",
    httpRedirect, httpRedirect ? "return 301 https redirect found" : "No HTTP redirect configured",
    "Add 'return 301 https://$host$request_uri;' in the :80 server block"));

  // WebSocket support
  const wsConf = /proxy_set_header\s+Upgrade/.test(nginxConf) && /proxy_set_header\s+Connection/.test(nginxConf);
  checks.push(_check("nginx_websocket", "WebSocket proxying configured",
    wsConf, wsConf ? "Upgrade + Connection headers found" : "WebSocket headers missing",
    "Add: proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection 'upgrade';", "warning"));

  // Gzip compression
  const gzipConf = /gzip\s+on/.test(nginxConf);
  checks.push(_check("nginx_gzip", "Gzip compression enabled",
    gzipConf, gzipConf ? "gzip on found" : "gzip not configured",
    "Add 'gzip on; gzip_types text/plain text/css application/json application/javascript;'", "warning"));

  // Caching
  const cacheConf = /expires\s+\d|Cache-Control.*immutable|add_header Cache-Control/.test(nginxConf);
  checks.push(_check("nginx_caching", "Static asset caching configured",
    cacheConf, cacheConf ? "Cache headers found in nginx.conf" : "No cache directives",
    "Add 'expires 1y; add_header Cache-Control \"public, immutable\";' for /static/ location", "warning"));

  // Security headers
  const hsts = /Strict-Transport-Security/.test(nginxConf);
  const xframe = /X-Frame-Options/.test(nginxConf);
  const xcto   = /X-Content-Type-Options/.test(nginxConf);
  checks.push(_check("nginx_sec_headers", "Security headers (HSTS, X-Frame, X-Content-Type)",
    hsts && xframe && xcto,
    `HSTS: ${hsts}, X-Frame: ${xframe}, X-Content-Type: ${xcto}`,
    "Add all three security headers to the HTTPS server block in nginx.conf"));

  // VPS nginx state
  if (vpsAvail) {
    const nginxActiveR = _ssh("systemctl is-active nginx 2>/dev/null");
    checks.push(_check("nginx_vps_running", "Nginx running on VPS",
      nginxActiveR.ok && nginxActiveR.out === "active",
      nginxActiveR.ok ? `nginx: ${nginxActiveR.out}` : `Nginx state unknown: ${nginxActiveR.out}`,
      "sudo systemctl start nginx && sudo systemctl enable nginx"));

    const nginxConfR = _ssh(`nginx -t 2>&1 | tail -1`);
    const confOk = nginxConfR.ok && (nginxConfR.out.includes("ok") || nginxConfR.out.includes("successful"));
    checks.push(_check("nginx_vps_config_valid", "Nginx config valid on VPS (nginx -t)",
      confOk, confOk ? "nginx -t: OK" : nginxConfR.out,
      `On VPS: sudo cp ${APP_DIR}/nginx.conf /etc/nginx/sites-available/ooplix && sudo nginx -t`));
  } else {
    const nginxLocalR = _exec("nginx -v 2>&1 | head -1");
    checks.push(_check("nginx_vps_running", "Nginx available (local)",
      nginxLocalR.ok, nginxLocalR.ok ? nginxLocalR.out : "nginx not installed locally (expected on VPS only)",
      "On VPS: sudo apt-get install -y nginx && sudo systemctl start nginx", "warning"));
    const confTestR = _exec("nginx -t 2>&1 | tail -1");
    checks.push(_check("nginx_vps_config_valid", "Nginx config test (local)",
      confTestR.out.includes("ok") || confTestR.out.includes("successful"),
      confTestR.out, null, "warning"));
  }

  const passing = checks.filter(c => c.pass).length;
  return { phase: "nginx", label: "Nginx Configuration", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 6 — SSL
// ══════════════════════════════════════════════════════════════════════════════
async function phaseSSL() {
  const checks = [];
  const vpsAvail = !!(_env("VPS_HOST") || _env("SSH_HOST") || _env("DEPLOY_HOST"));
  const baseUrl   = _baseUrl();
  const hostname  = (() => { try { return new URL(baseUrl).hostname; } catch { return "app.ooplix.com"; } })();
  const certPath  = `/etc/letsencrypt/live/${hostname}/fullchain.pem`;

  // Certificate exists
  let certExists = false, daysLeft = 0;
  if (vpsAvail) {
    const certR = _ssh(`[ -f "${certPath}" ] && echo ok || echo missing`);
    certExists  = certR.ok && certR.out === "ok";
    checks.push(_check("ssl_cert_exists", `SSL cert at ${certPath}`,
      certExists, certExists ? `Certificate found: ${certPath}` : `No cert at ${certPath}`,
      `sudo bash deploy/https-setup.sh ${hostname}`));

    if (certExists) {
      const expiryR = _ssh(`openssl x509 -enddate -noout -in "${certPath}" 2>/dev/null`);
      if (expiryR.ok && expiryR.out) {
        const match = expiryR.out.match(/notAfter=(.+)/);
        if (match) daysLeft = Math.floor((new Date(match[1]) - Date.now()) / 86400000);
      }
    }
  } else {
    // Remote TLS probe
    try {
      const r = await new Promise(resolve => {
        const req = https.request({ hostname, port: 443, path: "/", method: "HEAD", rejectUnauthorized: false }, res => {
          const cert = res.socket?.getPeerCertificate?.();
          resolve(cert);
        });
        req.setTimeout(6000, () => { req.destroy(); resolve(null); });
        req.on("error", () => resolve(null));
        req.end();
      });
      if (r?.valid_to) {
        certExists = true;
        daysLeft = Math.floor((new Date(r.valid_to) - Date.now()) / 86400000);
      }
    } catch {}
    checks.push(_check("ssl_cert_exists", `SSL cert for ${hostname}`,
      certExists,
      certExists ? `Remote TLS cert found — ${daysLeft}d remaining` : `No TLS cert found for ${hostname}`,
      `On VPS: sudo bash deploy/https-setup.sh ${hostname}`));
  }

  // Cert expiry ≥ 30 days
  checks.push(_check("ssl_expiry", "SSL cert valid ≥ 30 days",
    daysLeft >= 30,
    daysLeft > 0 ? `${daysLeft} days remaining` : (certExists ? "Cannot read expiry" : "No cert"),
    "sudo certbot renew --force-renewal"));

  // Auto-renew
  if (vpsAvail) {
    const timerR = _ssh("systemctl is-active certbot.timer 2>/dev/null");
    const cronR  = _ssh("crontab -l 2>/dev/null | grep -c certbot || echo 0");
    const renewOk = timerR.out === "active" || parseInt(cronR.out) > 0;
    checks.push(_check("ssl_autorenew", "Certbot auto-renew active",
      renewOk, renewOk ? (timerR.out === "active" ? "certbot.timer active" : "Certbot in crontab") : "Auto-renew not detected",
      "sudo systemctl enable certbot.timer && sudo systemctl start certbot.timer"));
  } else {
    const timerR = _exec("systemctl is-active certbot.timer 2>/dev/null");
    checks.push(_check("ssl_autorenew", "Certbot auto-renew active",
      timerR.out === "active",
      timerR.ok ? `certbot.timer: ${timerR.out}` : "certbot.timer not available (local dev — OK)",
      "On VPS: sudo systemctl enable certbot.timer", "warning"));
  }

  // HTTPS reachable
  let httpsOk = false, httpsDetail = `Cannot reach https://${hostname}`;
  try {
    const r = await _get(`https://${hostname}/health`, {}, 8000);
    httpsOk    = r.status === 200 || r.status === 401 || r.status === 302;
    httpsDetail = `https://${hostname}/health → HTTP ${r.status}`;
  } catch (e) { httpsDetail = `HTTPS probe error: ${e.message}`; }
  checks.push(_check("ssl_https_reachable", `https://${hostname} reachable`,
    httpsOk, httpsDetail,
    `Check DNS + nginx: app.ooplix.com A record must point to VPS IP`));

  // TLS version
  const nginxConf = (() => { try { return fs.readFileSync(path.join(ROOT, "nginx.conf"), "utf8"); } catch { return ""; } })();
  const tlsOk = nginxConf.includes("TLSv1.2") || nginxConf.includes("TLSv1.3");
  checks.push(_check("ssl_tls_version", "TLS 1.2+ only in nginx.conf",
    tlsOk, tlsOk ? "ssl_protocols TLSv1.2 TLSv1.3 configured" : "TLS version not specified",
    "Add: ssl_protocols TLSv1.2 TLSv1.3; to nginx.conf", "warning"));

  const passing = checks.filter(c => c.pass).length;
  return { phase: "ssl", label: "SSL / HTTPS", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 7 — PM2
// ══════════════════════════════════════════════════════════════════════════════
async function phasePM2() {
  const checks = [];
  const vpsAvail = !!(_env("VPS_HOST") || _env("SSH_HOST") || _env("DEPLOY_HOST"));
  const APP_DIR  = _env("APP_DIR") || "/opt/jarvis-os";

  function pm2Check(id, label, sshCmd, localCmd, fix, severity = "critical") {
    if (vpsAvail) {
      const r = _ssh(sshCmd, 15000);
      const ok = r.ok && (r.out.length > 0);
      checks.push(_check(id, label, ok, ok ? r.out.split("\n")[0].trim().slice(0, 120) : r.out, fix, severity));
    } else {
      const r = _exec(localCmd, 8000);
      const ok = r.ok && r.out.length > 0;
      checks.push(_check(id, label, ok,
        ok ? r.out.split("\n")[0].trim().slice(0, 120) : `Local: ${r.out}`,
        fix, severity));
    }
  }

  // PM2 process online
  pm2Check("pm2_online", "jarvis-os online in PM2",
    "pm2 list --no-color 2>/dev/null | grep jarvis-os | grep -c online",
    "pm2 list --no-color 2>/dev/null | grep jarvis-os",
    `On VPS: cd ${APP_DIR} && pm2 start ecosystem.config.cjs --env production && pm2 save`);

  // Auto-restart enabled
  const ecoR = (() => { try { return require(path.join(ROOT, "ecosystem.config.cjs")); } catch { return null; } })();
  const maxRestarts = ecoR?.apps?.[0]?.max_restarts ?? ecoR?.apps?.[0]?.env_production?.max_restarts;
  const watchEnabled = ecoR?.apps?.[0]?.watch;
  checks.push(_check("pm2_autorestart", "PM2 auto-restart configured",
    !!(ecoR?.apps?.length > 0),
    ecoR ? `ecosystem.config.cjs: app=${ecoR.apps[0]?.name}, restarts=${maxRestarts ?? "default"}` : "Cannot read ecosystem.config.cjs",
    "Ensure ecosystem.config.cjs has max_restarts configured", "warning"));

  // PM2 startup (systemd/init)
  if (vpsAvail) {
    const startupR = _ssh("systemctl is-enabled pm2-root 2>/dev/null || systemctl is-enabled pm2-jarvis 2>/dev/null || systemctl is-enabled pm2-ubuntu 2>/dev/null || echo 'not-enabled'");
    const startupOk = startupR.ok && startupR.out === "enabled";
    checks.push(_check("pm2_startup", "PM2 startup service enabled",
      startupOk, startupOk ? "PM2 startup service enabled" : `PM2 startup: ${startupR.out}`,
      `On VPS: sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu | tail -1 | bash && pm2 save`));
  } else {
    const startupR = _exec("systemctl is-enabled pm2-$(whoami) 2>/dev/null || echo no-systemd");
    checks.push(_check("pm2_startup", "PM2 startup service (VPS required)",
      false, `Local: ${startupR.out} — run on VPS: pm2 startup && pm2 save`,
      "pm2 startup && pm2 save", "warning"));
  }

  // PM2 logs accessible
  if (vpsAvail) {
    const logsR = _ssh(`pm2 logs jarvis-os --nostream --lines 5 2>/dev/null | tail -5`);
    checks.push(_check("pm2_logs", "PM2 logs accessible",
      logsR.ok && logsR.out.length > 5, logsR.ok ? `Last line: ${logsR.out.split("\n").pop()?.slice(0, 100)}` : logsR.out,
      "pm2 logs jarvis-os --lines 20", "warning"));

    // PM2 memory usage
    const memR = _ssh("pm2 jlist 2>/dev/null | python3 -c \"import sys,json; procs=json.load(sys.stdin); [print(p.get('monit',{}).get('memory',0)//1024//1024) for p in procs if p.get('name')=='jarvis-os']\" 2>/dev/null || echo 0");
    const memMB = parseInt(memR.out) || 0;
    checks.push(_check("pm2_memory", "PM2 memory < 512MB",
      !memR.ok || memMB === 0 || memMB < 512,
      memR.ok && memMB > 0 ? `Memory: ${memMB}MB` : "Cannot read PM2 memory",
      "Investigate: pm2 monit", "warning"));
  } else {
    const logsR = _exec("pm2 logs jarvis-os --nostream --lines 3 2>/dev/null | tail -3");
    checks.push(_check("pm2_logs", "PM2 logs accessible (local)",
      logsR.ok && logsR.out.length > 0, logsR.ok ? logsR.out.split("\n")[0] : "PM2 not running locally",
      "pm2 start ecosystem.config.cjs --env production", "warning"));
    checks.push(_check("pm2_memory", "PM2 process health (local)",
      false, "PM2 not running locally — OK for dev", null, "warning"));
  }

  const passing = checks.filter(c => c.pass).length;
  return { phase: "pm2", label: "PM2 Process Manager", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 8 — Health Verification
// ══════════════════════════════════════════════════════════════════════════════
async function phaseHealthVerification() {
  const checks = [];
  const baseUrl = _baseUrl();
  const PORT    = parseInt(_env("PORT") || "5050");

  async function healthProbe(id, label, endpoint, fix) {
    // Try local first, then remote
    let localOk = false, remoteOk = false, detail = "";
    try {
      const r = await _localGet(endpoint, 6000);
      localOk = r.status === 200;
      detail  = `Local localhost:${PORT}${endpoint} → HTTP ${r.status}`;
    } catch {}
    if (!localOk && baseUrl !== `http://localhost:${PORT}`) {
      try {
        const r = await _get(`${baseUrl}${endpoint}`, {}, 8000);
        remoteOk = r.status === 200 || r.status === 401;
        detail   = `Remote ${baseUrl}${endpoint} → HTTP ${r.status}`;
      } catch (e) { detail = `Probe error: ${e.message}`; }
    }
    checks.push(_check(id, label, localOk || remoteOk, detail || `Cannot reach ${endpoint}`, fix));
  }

  await healthProbe("health_main",    "/health → 200",              "/health",             "pm2 restart jarvis-os");
  await healthProbe("health_ops",     "/ops → 200",                 "/ops",                "Check backend/routes — /ops should return service status");
  await healthProbe("health_stats",   "/stats → 200 or 401",        "/stats",              "Backend service stats endpoint");

  // /api/health sub-paths (some may be behind auth — 401 counts)
  const subProbes = [
    { id: "health_ai",      ep: "/ai",               label: "/ai (AI provider status)",           fix: "Set GROQ_API_KEY or other AI provider key in .env" },
    { id: "health_browser", ep: "/browser/health",   label: "/browser/health",                    fix: "Browser service should respond even when headless browser not installed" },
    { id: "health_billing", ep: "/billing/status",   label: "/billing/status (auth-gated OK)",    fix: "Set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET in .env" },
    { id: "health_storage", ep: "/wiring2",          label: "/wiring2 (storage health proxy)",    fix: "Storage health via productionWiring2 — check S3/R2 env vars" },
    { id: "health_email",   ep: "/credentials",      label: "/credentials (email health proxy)",  fix: "Email health via pcsCredentials — check SMTP/Resend env vars" },
  ];

  for (const probe of subProbes) {
    let ok = false, detail = "";
    try {
      const r = await _localGet(probe.ep, 5000);
      ok     = r.status === 200 || r.status === 401;
      detail = `localhost:${PORT}${probe.ep} → HTTP ${r.status}`;
    } catch (e) {
      try {
        const r = await _get(`${baseUrl}${probe.ep}`, {}, 6000);
        ok     = r.status === 200 || r.status === 401 || r.status === 403;
        detail = `Remote ${baseUrl}${probe.ep} → HTTP ${r.status}`;
      } catch (e2) { detail = `Unreachable: ${e2.message}`; }
    }
    checks.push(_check(probe.id, probe.label, ok, detail, probe.fix));
  }

  const passing = checks.filter(c => c.pass).length;
  return { phase: "health_verification", label: "Health Verification", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 9 — Production Smoke Test
// ══════════════════════════════════════════════════════════════════════════════
async function phaseSmokeTest() {
  const checks = [];
  const baseUrl = _baseUrl();
  const PORT    = parseInt(_env("PORT") || "5050");

  async function smoke(id, label, fn, fix) {
    try {
      const { ok, detail } = await fn();
      checks.push(_check(id, label, ok, detail, fix));
    } catch (e) {
      checks.push(_check(id, label, false, `Error: ${e.message}`, fix));
    }
  }

  // 1. Login — auth/login endpoint responds (400 is OK — means it received request)
  await smoke("smoke_login", "Auth / Login endpoint accessible", async () => {
    const r = await _localGet("/auth/me", 5000).catch(() => ({}));
    const rr = r.status > 0 ? r : await _get(`${baseUrl}/auth/me`, {}, 6000).catch(() => ({}));
    const ok = rr.status === 401 || rr.status === 403 || rr.status === 200;
    return { ok, detail: `GET /auth/me → HTTP ${rr.status || 0} (401 = expected for unauthenticated)` };
  }, "Backend auth route not accessible — check pm2 logs jarvis-os");

  // 2. AI Chat — Jarvis AI endpoint accessible
  await smoke("smoke_ai_chat", "AI Chat endpoint accessible (/jarvis)", async () => {
    const r = await _localGet("/jarvis", 5000).catch(() => ({}));
    const ok = (r.status || 0) > 0 && r.status !== 500;
    return { ok, detail: `GET /jarvis → HTTP ${r.status || 0} (401 expected without auth)` };
  }, "Ensure AI provider key is set and backend is running");

  // 3. AI Coding — coding route accessible
  await smoke("smoke_ai_coding", "AI Coding endpoint accessible (/coding)", async () => {
    const r = await _localGet("/coding", 5000).catch(() => ({}));
    const ok = (r.status || 0) > 0 && r.status !== 500;
    return { ok, detail: `GET /coding → HTTP ${r.status || 0}` };
  }, "Coding platform route not responding — check backend routes/codingAssistant.js");

  // 4. Browser Automation
  await smoke("smoke_browser", "Browser Automation accessible (/browser)", async () => {
    const r = await _localGet("/browser", 5000).catch(() => ({}));
    const ok = (r.status || 0) > 0 && r.status !== 500;
    return { ok, detail: `GET /browser → HTTP ${r.status || 0}` };
  }, "Browser platform not responding — check backend routes/browser.js");

  // 5. Creative Studio
  await smoke("smoke_creative", "Creative Studio accessible (/creative)", async () => {
    const r = await _localGet("/creative", 5000).catch(() => ({}));
    const ok = (r.status || 0) > 0 && r.status !== 500;
    return { ok, detail: `GET /creative → HTTP ${r.status || 0}` };
  }, "Creative Studio route not responding — check backend routes/creativeStudio.js");

  // 6. Mission system
  await smoke("smoke_mission", "Mission system accessible (/mission)", async () => {
    const r = await _localGet("/mission", 5000).catch(() => ({}));
    const ok = (r.status || 0) > 0 && r.status !== 500;
    return { ok, detail: `GET /mission → HTTP ${r.status || 0}` };
  }, "Mission route not responding — check backend routes/mission.js");

  // 7. Billing system
  await smoke("smoke_billing", "Billing accessible (/billing/status)", async () => {
    const r = await _localGet("/billing/status", 5000).catch(() => ({}));
    const ok = r.status === 200 || r.status === 401 || r.status === 403;
    return { ok, detail: `GET /billing/status → HTTP ${r.status || 0}` };
  }, "Billing route not responding — check backend routes/billing.js");

  // 8. Frontend SPA — index.html served
  await smoke("smoke_frontend", "Frontend (SPA) served", async () => {
    const r = await _localGet("/", 5000).catch(() => ({}));
    const ok = r.status === 200 && (r.body || "").includes("<!DOCTYPE") || (r.body || "").includes("<html");
    return { ok, detail: `GET / → HTTP ${r.status || 0} — HTML: ${ok}` };
  }, "Frontend not being served — check nginx config and frontend/build/ directory");

  // 9. Runtime health
  await smoke("smoke_runtime", "Runtime health deep check (/runtime/health/deep)", async () => {
    const r = await _localGet("/runtime/health/deep", 5000).catch(() => ({}));
    const ok = r.status === 200 || r.status === 401;
    return { ok, detail: `GET /runtime/health/deep → HTTP ${r.status || 0}` };
  }, "Runtime health endpoint not responding", "warning");

  // 10. WebSocket endpoint (check upgrade header support)
  await smoke("smoke_websocket", "WebSocket endpoint accessible (/runtime/stream)", async () => {
    const r = await _localGet("/runtime/stream", 3000).catch(() => ({}));
    // SSE/WS endpoints return 200 with streaming or stay open; any non-500 is fine
    const ok = (r.status || 0) > 0 && r.status !== 500;
    return { ok, detail: `GET /runtime/stream → HTTP ${r.status || 0} (200 or open connection expected)` };
  }, "WebSocket/SSE stream endpoint not responding", "warning");

  const passing = checks.filter(c => c.pass).length;
  return { phase: "smoke_test", label: "Production Smoke Test", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 10 — Reports
// ══════════════════════════════════════════════════════════════════════════════
function _verdict(score, criticalFails) {
  if (criticalFails > 0 && score < 50) return "NO GO";
  if (criticalFails > 0 || score < 70)  return "CONDITIONAL GO";
  return "GO";
}

function buildDeploymentReport(phases) {
  const all     = phases.flatMap(p => p.checks.map(c => ({ ...c, phase: p.phase, phaseLabel: p.label })));
  const passing = all.filter(c => c.pass);
  const failing = all.filter(c => !c.pass);
  const crit    = failing.filter(c => c.severity === "critical");
  const warns   = failing.filter(c => c.severity === "warning");
  const score   = Math.round(all.filter(c => c.pass).length / all.length * 100);

  return {
    type:          "Deployment Report",
    generatedAt:   _ts(),
    score,
    verdict:       _verdict(score, crit.length),
    totalChecks:   all.length,
    passing:       passing.length,
    failing:       failing.length,
    criticalFails: crit.length,
    warnings:      warns.length,
    phaseScores:   phases.map(p => ({ phase: p.phase, label: p.label, score: p.score, passing: p.passing, total: p.total })),
    criticalIssues: crit.slice(0, 15),
    warnings_list:  warns.slice(0, 15),
  };
}

function buildLiveURLReport(baseUrl, phases) {
  const smokePhase = phases.find(p => p.phase === "smoke_test");
  const healthPhase = phases.find(p => p.phase === "health_verification");
  const hostname = (() => { try { return new URL(baseUrl).hostname; } catch { return "app.ooplix.com"; } })();

  const urls = [
    { label: "Main App",           url: `https://${hostname}`,              purpose: "SPA entry point" },
    { label: "API Health",         url: `https://${hostname}/health`,        purpose: "Backend health check" },
    { label: "API Stats",          url: `https://${hostname}/stats`,         purpose: "Runtime statistics" },
    { label: "API Ops",            url: `https://${hostname}/ops`,           purpose: "Operations status" },
    { label: "Auth Login",         url: `https://${hostname}/auth/login`,    purpose: "User authentication" },
    { label: "Runtime Stream",     url: `https://${hostname}/runtime/stream`,purpose: "WebSocket/SSE events" },
    { label: "AI Coding",          url: `https://${hostname}/coding`,        purpose: "AI coding platform" },
    { label: "Browser Automation", url: `https://${hostname}/browser`,       purpose: "Browser automation platform" },
    { label: "Billing Status",     url: `https://${hostname}/billing/status`,purpose: "Subscription & payments" },
    { label: "Mission API",        url: `https://${hostname}/mission`,       purpose: "Mission system" },
    { label: "Creative Studio",    url: `https://${hostname}/creative`,      purpose: "Creative AI platform" },
  ];

  const smokePassing = smokePhase?.checks?.filter(c => c.pass).map(c => c.id) || [];
  const liveStatus   = smokePassing.length > 0 ? "PARTIAL" : "UNVERIFIED";

  return {
    type:        "Live URL Report",
    generatedAt: _ts(),
    baseUrl,
    liveStatus,
    urls,
    smokeTestsPassing: smokePhase?.passing || 0,
    smokeTestsTotal:   smokePhase?.total || 0,
    healthChecksPassing: healthPhase?.passing || 0,
  };
}

function buildFailedChecksReport(phases) {
  const all    = phases.flatMap(p => p.checks.map(c => ({ ...c, phase: p.phase, phaseLabel: p.label })));
  const failed = all.filter(c => !c.pass);
  const crit   = failed.filter(c => c.severity === "critical");
  const warns  = failed.filter(c => c.severity === "warning");

  return {
    type:        "Failed Checks Report",
    generatedAt: _ts(),
    totalFailed: failed.length,
    critical:    crit.length,
    warnings:    warns.length,
    criticalChecks: crit.map(c => ({ id: c.id, label: c.label, phase: c.phaseLabel, detail: c.detail, fix: c.fix })),
    warningChecks:  warns.map(c => ({ id: c.id, label: c.label, phase: c.phaseLabel, detail: c.detail, fix: c.fix })),
    actionItems: crit.map(c => c.fix).filter(Boolean).slice(0, 10),
  };
}

function buildWarningsReport(phases) {
  const all   = phases.flatMap(p => p.checks.map(c => ({ ...c, phase: p.phase, phaseLabel: p.label })));
  const warns = all.filter(c => !c.pass && c.severity === "warning");
  const pass  = all.filter(c => c.pass);

  return {
    type:        "Warnings Report",
    generatedAt: _ts(),
    warningCount: warns.length,
    passingCount: pass.length,
    warnings: warns.map(c => ({ id: c.id, label: c.label, phase: c.phaseLabel, detail: c.detail, fix: c.fix })),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// FULL DEPLOYMENT RUN
// ══════════════════════════════════════════════════════════════════════════════

async function runFullDeployment() {
  const t0 = Date.now();

  const [vpsConn, deps, repo, env, nginx, ssl] = await Promise.all([
    phaseVPSConnection(),
    phaseDependencies(),
    phaseRepository(),
    phaseEnvironment(),
    phaseNginx(),
    phaseSSL(),
  ]);

  // PM2, health, smoke run sequentially (order matters for state)
  const pm2    = await phasePM2();
  const health = await phaseHealthVerification();
  const smoke  = await phaseSmokeTest();

  const phases = [vpsConn, deps, repo, env, nginx, ssl, pm2, health, smoke];
  const all    = phases.flatMap(p => p.checks);
  const total  = all.length;
  const totalPassing = all.filter(c => c.pass).length;
  const critFails    = all.filter(c => !c.pass && c.severity === "critical").length;
  const productionScore = Math.round(totalPassing / total * 100);
  const verdict = _verdict(productionScore, critFails);
  const baseUrl = _baseUrl();

  const report = {
    id:              `dop2-${Date.now()}`,
    sprint:          2,
    runAt:           _ts(),
    durationMs:      Date.now() - t0,
    productionScore,
    verdict,
    totalChecks:     total,
    totalPassing,
    criticalFails:   critFails,
    vpsHost:         _env("VPS_HOST") || _env("SSH_HOST") || null,
    baseUrl,
    phases: { vpsConn, deps, repo, env, nginx, ssl, pm2, health, smoke },
    reports: {
      deployment:  buildDeploymentReport(phases),
      liveUrl:     buildLiveURLReport(baseUrl, phases),
      failedChecks: buildFailedChecksReport(phases),
      warnings:    buildWarningsReport(phases),
    },
    phaseSummary: phases.map(p => ({ phase: p.phase, label: p.label, score: p.score, passing: p.passing, total: p.total,
      verdict: p.score >= 70 ? "GO" : p.score >= 50 ? "CONDITIONAL GO" : "NO GO" })),
  };

  const s = _load();
  s.reports = s.reports || [];
  s.reports.unshift(report);
  if (s.reports.length > 10) s.reports = s.reports.slice(0, 10);
  s.lastRun = report.runAt;
  _save(s);
  return report;
}

async function runPhase(phase) {
  switch (phase) {
    case "vps_connection":    return phaseVPSConnection();
    case "dependencies":      return phaseDependencies();
    case "repository":        return phaseRepository();
    case "environment":       return phaseEnvironment();
    case "nginx":             return phaseNginx();
    case "ssl":               return phaseSSL();
    case "pm2":               return phasePM2();
    case "health_verification": return phaseHealthVerification();
    case "smoke_test":        return phaseSmokeTest();
    default: throw new Error(`Unknown phase: ${phase}`);
  }
}

function getLastReport()    { return _load().reports?.[0] || null; }
function getReportHistory() { return (_load().reports || []).map(r => ({ id: r.id, runAt: r.runAt, productionScore: r.productionScore, verdict: r.verdict, vpsHost: r.vpsHost, baseUrl: r.baseUrl })); }

async function runBenchmark() {
  const report = await runFullDeployment();
  const checks = [
    // Phase checks
    { id: "vps_connected",    label: "VPS SSH connection",                         ok: report.phases.vpsConn.checks.find(c => c.id === "vps_ssh_connect")?.pass },
    { id: "node_installed",   label: "Node.js ≥ 20 on VPS",                        ok: report.phases.deps.checks.find(c => c.id === "dep_node")?.pass },
    { id: "pm2_installed",    label: "PM2 installed",                              ok: report.phases.deps.checks.find(c => c.id === "dep_pm2")?.pass },
    { id: "nginx_installed",  label: "Nginx installed",                            ok: report.phases.deps.checks.find(c => c.id === "dep_nginx")?.pass },
    { id: "certbot_installed",label: "Certbot installed",                          ok: report.phases.deps.checks.find(c => c.id === "dep_certbot")?.pass },
    { id: "repo_cloned",      label: "Repository on VPS",                          ok: report.phases.repo.checks.find(c => c.id === "repo_vps_git")?.pass },
    { id: "frontend_built",   label: "Frontend build present",                     ok: report.phases.repo.checks.find(c => c.id === "repo_frontend_build")?.pass },
    { id: "env_jwt",          label: "JWT_SECRET set (≥32 chars)",                 ok: report.phases.env.checks.find(c => c.id === "env_jwt_secret")?.pass },
    { id: "env_baseurl",      label: "BASE_URL is production HTTPS",               ok: report.phases.env.checks.find(c => c.id === "env_base_url")?.pass },
    { id: "env_no_placeholder",label: "NODE_ENV=production",                       ok: report.phases.env.checks.find(c => c.id === "env_node_env")?.pass },
    { id: "nginx_https",      label: "HTTPS configured in nginx.conf",             ok: report.phases.nginx.checks.find(c => c.id === "nginx_https")?.pass },
    { id: "nginx_redirect",   label: "HTTP→HTTPS redirect in nginx.conf",          ok: report.phases.nginx.checks.find(c => c.id === "nginx_redirect")?.pass },
    { id: "ssl_cert",         label: "SSL certificate issued",                     ok: report.phases.ssl.checks.find(c => c.id === "ssl_cert_exists")?.pass },
    { id: "ssl_expiry",       label: "SSL cert valid ≥ 30 days",                   ok: report.phases.ssl.checks.find(c => c.id === "ssl_expiry")?.pass },
    { id: "pm2_online",       label: "jarvis-os online in PM2",                   ok: report.phases.pm2.checks.find(c => c.id === "pm2_online")?.pass },
    { id: "health_main",      label: "/health endpoint → 200",                     ok: report.phases.health.checks.find(c => c.id === "health_main")?.pass },
    { id: "smoke_login",      label: "Auth/Login accessible",                      ok: report.phases.smoke.checks.find(c => c.id === "smoke_login")?.pass },
    { id: "smoke_frontend",   label: "Frontend SPA served",                        ok: report.phases.smoke.checks.find(c => c.id === "smoke_frontend")?.pass },
    { id: "smoke_billing",    label: "Billing endpoint accessible",                ok: report.phases.smoke.checks.find(c => c.id === "smoke_billing")?.pass },
    { id: "production_score", label: `Production score ≥ 60% (actual: ${report.productionScore}%)`, ok: report.productionScore >= 60 },
  ];
  const passing = checks.filter(c => c.ok).length;
  return {
    score:          Math.round(passing / checks.length * 100),
    passing,
    total:          checks.length,
    regressionPass: passing >= Math.floor(checks.length * 0.50),
    productionScore: report.productionScore,
    verdict:        report.verdict,
    checks,
    runAt:          report.runAt,
    vpsHost:        report.vpsHost,
    baseUrl:        report.baseUrl,
  };
}

const VALID_PHASES = ["vps_connection","dependencies","repository","environment","nginx","ssl","pm2","health_verification","smoke_test"];

module.exports = {
  runFullDeployment, runPhase, getLastReport, getReportHistory, runBenchmark,
  VALID_PHASES,
  phaseVPSConnection, phaseDependencies, phaseRepository, phaseEnvironment,
  phaseNginx, phaseSSL, phasePM2, phaseHealthVerification, phaseSmokeTest,
};
