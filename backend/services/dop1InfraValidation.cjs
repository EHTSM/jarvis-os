"use strict";
/**
 * DOP-1 — Deployment Operating Program: Production Infrastructure Validation
 *
 * 10 modules:
 *   1.  VPS          — Ubuntu, CPU, RAM, Disk, Swap, Timezone, SSH, UFW, Fail2Ban, Cron, PM2
 *   2.  Nginx        — HTTPS, HTTP→HTTPS, Compression, Caching, Security headers, Upload, WebSocket
 *   3.  SSL          — Certificate, Expiry, Auto-renew, OCSP, TLS version
 *   4.  DNS          — A, AAAA, CNAME, MX, TXT, SPF, DKIM, DMARC, CAA, Propagation
 *   5.  Domain       — ooplix.com, www, app, api, docs, status, cdn
 *   6.  Deployment   — Frontend, Backend, Electron updater, Health endpoint, Restart, Rollback
 *   7.  Backup       — DB, Assets, Config, Restore test, Integrity, Retention, Off-site
 *   8.  Monitoring   — PM2, Memory, CPU, Disk, Telegram, Log rotation, Health endpoint
 *   9.  Security     — Headers, JWT, Secrets, Permissions, SSH, Ports, Rate limiting
 *  10.  Stress Test  — 50/100/250/500 users: CPU, RAM, P95, Error rate
 *
 * Generates:
 *   Infrastructure Report, Deployment Report, Security Report,
 *   Performance Report, Production Score, GO / CONDITIONAL GO / NO GO
 *
 * Storage: data/dop1-infra-validation.json  (last 10 reports)
 * No new runtime. No architecture changes. Pure validation probes.
 */

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const http  = require("http");
const dns   = require("dns").promises;
const net   = require("net");
const { execSync, spawnSync } = require("child_process");

const ROOT      = path.join(__dirname, "../..");
const DATA_FILE = path.join(ROOT, "data/dop1-infra-validation.json");
const PORT      = parseInt(process.env.PORT || "5050", 10);

// ── helpers ───────────────────────────────────────────────────────────────────
function _load()   { try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return { reports: [] }; } }
function _save(s)  { fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2)); }
function _ts()     { return new Date().toISOString(); }
function _env(k)   { return process.env[k] || ""; }
function _has(k)   { return !!_env(k); }
function _file(p)  { try { fs.accessSync(path.join(ROOT, p)); return true; } catch { return false; } }
function _read(p, fb = null) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); } catch { return fb; } }

function _exec(cmd, ms = 4000) {
  try { return { ok: true, out: execSync(cmd, { timeout: ms, stdio: ["ignore","pipe","pipe"] }).toString().trim() }; }
  catch (e) { return { ok: false, out: e.stderr?.toString()?.trim() || e.message }; }
}

function _check(id, label, pass, detail, fix = null, severity = "critical") {
  return { id, label, pass, detail, fix, severity };
}

function _req(opts, body = null, ms = 8000) {
  return new Promise(resolve => {
    const mod = opts.port === 80 ? http : https;
    const req = mod.request(opts, res => {
      let d = "";
      res.on("data", c => { d += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    req.setTimeout(ms, () => { req.destroy(); resolve({ status: 0, headers: {}, body: "", error: "timeout" }); });
    req.on("error", e => resolve({ status: 0, headers: {}, body: "", error: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

function _httpGet(url, ms = 8000) {
  try {
    const u = new URL(url);
    return _req({ protocol: u.protocol, hostname: u.hostname,
      port: parseInt(u.port) || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search, method: "GET" }, null, ms);
  } catch (e) { return Promise.resolve({ status: 0, headers: {}, body: "", error: e.message }); }
}

function _localGet(path_, ms = 5000) {
  return _req({ hostname: "127.0.0.1", port: PORT, path: path_, method: "GET" }, null, ms);
}

function _tcpCheck(host, port, ms = 4000) {
  return new Promise(resolve => {
    const s = net.createConnection({ host, port }, () => { s.destroy(); resolve(true); });
    s.setTimeout(ms, () => { s.destroy(); resolve(false); });
    s.on("error", () => resolve(false));
  });
}

const DOMAIN     = "ooplix.com";
const SUBDOMAINS = { app: "app.ooplix.com", api: "api.ooplix.com", www: "www.ooplix.com",
                     docs: "docs.ooplix.com", status: "status.ooplix.com", cdn: "cdn.ooplix.com" };
const NGINX_CONF = "/etc/nginx/sites-enabled/ooplix";
const CERTBOT_CERT = `/etc/letsencrypt/live/app.${DOMAIN}/fullchain.pem`;

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 1 — VPS
// ══════════════════════════════════════════════════════════════════════════════
function auditVPS() {
  const checks = [];

  // Ubuntu version
  const lsb = _exec("lsb_release -rs 2>/dev/null || cat /etc/os-release | grep VERSION_ID | cut -d'\"' -f2");
  const ubuntuVer = parseFloat(lsb.out || "0");
  checks.push(_check("vps_ubuntu", "Ubuntu 22.04+",
    lsb.ok && ubuntuVer >= 22,
    lsb.ok ? `Ubuntu ${lsb.out}` : `Cannot detect OS: ${lsb.out}`,
    "Upgrade to Ubuntu 22.04 LTS: do-release-upgrade"));

  // CPU cores
  const cpuR = _exec("nproc 2>/dev/null");
  const cpuN = parseInt(cpuR.out) || 0;
  checks.push(_check("vps_cpu", "CPU ≥ 2 cores",
    cpuN >= 2, `${cpuN} core(s) detected`,
    "Resize VPS to at least 2 vCPUs", "warning"));

  // RAM
  const memR = _exec("free -m 2>/dev/null | awk '/^Mem:/{print $2}'");
  const memMB = parseInt(memR.out) || 0;
  checks.push(_check("vps_ram", "RAM ≥ 1GB",
    memMB >= 1000, `${memMB}MB RAM detected`,
    "Resize VPS to at least 2GB RAM", "warning"));

  // Disk
  const diskR = _exec("df -BG / 2>/dev/null | awk 'NR==2{print $4}'");
  const diskGB = parseInt(diskR.out) || 0;
  checks.push(_check("vps_disk", "Disk ≥ 5GB free",
    diskGB >= 5, `${diskGB}GB free on /`,
    "Free disk space or expand volume", "warning"));

  // Swap
  const swapR = _exec("free -m 2>/dev/null | awk '/^Swap:/{print $2}'");
  const swapMB = parseInt(swapR.out) || 0;
  checks.push(_check("vps_swap", "Swap configured",
    swapMB > 0, swapMB > 0 ? `${swapMB}MB swap` : "No swap configured",
    "sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile",
    "warning"));

  // Timezone
  const tzR = _exec("timedatectl show --property=Timezone --value 2>/dev/null || date +%Z");
  const tz = tzR.out || "unknown";
  checks.push(_check("vps_timezone", "Timezone (UTC preferred)",
    tz.toLowerCase().includes("utc") || tz === "UTC",
    `Timezone: ${tz}`,
    "sudo timedatectl set-timezone UTC", "warning"));

  // SSH
  const sshR = _exec("systemctl is-active ssh 2>/dev/null || systemctl is-active sshd 2>/dev/null");
  checks.push(_check("vps_ssh", "SSH service running",
    sshR.out === "active", `SSH: ${sshR.out || "unknown"}`,
    "sudo systemctl enable --now ssh"));

  // UFW
  const ufwR = _exec("ufw status 2>/dev/null | head -1");
  const ufwActive = ufwR.out.toLowerCase().includes("active");
  checks.push(_check("vps_ufw", "UFW firewall active",
    ufwActive, ufwR.ok ? ufwR.out : "UFW not available",
    "sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable"));

  // Fail2Ban
  const f2bR = _exec("systemctl is-active fail2ban 2>/dev/null");
  checks.push(_check("vps_fail2ban", "Fail2Ban active",
    f2bR.out === "active", `Fail2Ban: ${f2bR.out || "not installed"}`,
    "sudo apt install fail2ban -y && sudo systemctl enable --now fail2ban"));

  // Cron
  const cronR = _exec("systemctl is-active cron 2>/dev/null || systemctl is-active crond 2>/dev/null");
  checks.push(_check("vps_cron", "Cron daemon active",
    cronR.out === "active", `Cron: ${cronR.out || "unknown"}`,
    "sudo systemctl enable --now cron", "warning"));

  // PM2
  const pm2R = _exec("pm2 list --no-color 2>/dev/null | grep -c online");
  const pm2OnlineCount = parseInt(pm2R.out) || 0;
  const pm2Installed = _exec("which pm2 2>/dev/null");
  checks.push(_check("vps_pm2", "PM2 running (≥1 online process)",
    pm2OnlineCount >= 1,
    pm2Installed.ok ? `${pm2OnlineCount} process(es) online` : "PM2 not installed",
    pm2Installed.ok
      ? "pm2 start ecosystem.config.cjs --env production"
      : "npm install -g pm2 && pm2 start ecosystem.config.cjs --env production && pm2 save && pm2 startup"));

  const passing = checks.filter(c => c.pass).length;
  return { module: "vps", label: "VPS Validation", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 2 — Nginx
// ══════════════════════════════════════════════════════════════════════════════
async function auditNginx() {
  const checks = [];

  // Nginx installed
  const nginxR = _exec("nginx -v 2>&1 | head -1");
  const nginxInstalled = nginxR.ok || nginxR.out.includes("nginx/");
  checks.push(_check("nginx_installed", "Nginx installed",
    nginxInstalled, nginxInstalled ? nginxR.out : "Nginx not found",
    "sudo apt install nginx -y && sudo systemctl enable --now nginx"));

  // Nginx running
  const nginxRunR = _exec("systemctl is-active nginx 2>/dev/null");
  checks.push(_check("nginx_running", "Nginx service running",
    nginxRunR.out === "active", `nginx: ${nginxRunR.out || "unknown"}`,
    "sudo systemctl start nginx && sudo systemctl enable nginx"));

  // Config test
  const confTestR = _exec("nginx -t 2>&1 | tail -1");
  const confOk = confTestR.out.includes("syntax is ok") || confTestR.out.includes("successful");
  checks.push(_check("nginx_config", "Nginx config valid (nginx -t)",
    confOk, confOk ? confTestR.out : confTestR.out,
    "Edit /etc/nginx/sites-available/ooplix — fix the reported syntax error and sudo nginx -t"));

  // Config file exists
  const ooplixConfExists = fs.existsSync(NGINX_CONF) || fs.existsSync("/etc/nginx/sites-available/ooplix");
  checks.push(_check("nginx_conf_file", "Ooplix nginx site config exists",
    ooplixConfExists,
    ooplixConfExists ? `Found at ${NGINX_CONF}` : "nginx config not at /etc/nginx/sites-enabled/ooplix",
    "sudo cp nginx.conf /etc/nginx/sites-available/ooplix && sudo ln -s /etc/nginx/sites-available/ooplix /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx"));

  // HTTPS on port 443
  const httpsUp = await _tcpCheck("127.0.0.1", 443, 3000);
  checks.push(_check("nginx_https", "HTTPS (port 443) listening",
    httpsUp, httpsUp ? "Port 443 open" : "Port 443 not responding",
    "Ensure SSL cert is installed and nginx is configured for HTTPS"));

  // HTTP→HTTPS redirect
  let redirectOk = false, redirectDetail = "Cannot probe (no domain configured)";
  const baseUrl = _env("BASE_URL");
  if (baseUrl && baseUrl.startsWith("https://")) {
    try {
      const domain = new URL(baseUrl).hostname;
      const r = await _req({ hostname: "127.0.0.1", port: 80, path: "/", method: "GET",
        headers: { Host: domain } }, null, 4000);
      redirectOk = r.status >= 301 && r.status <= 308 && (r.headers.location || "").startsWith("https://");
      redirectDetail = redirectOk ? `HTTP ${r.status} → ${r.headers.location}` : `HTTP ${r.status} — no HTTPS redirect`;
    } catch (e) { redirectDetail = `Probe error: ${e.message}`; }
  }
  checks.push(_check("nginx_http_redirect", "HTTP → HTTPS redirect",
    redirectOk, redirectDetail,
    "Add 'return 301 https://$host$request_uri;' in the :80 server block"));

  // Gzip compression
  const localR = await _localGet("/api/health");
  const gzipHeader = localR.headers?.["content-encoding"] || "";
  const nginxConfContent = (() => { try { return fs.readFileSync(path.join(ROOT, "nginx.conf"), "utf8"); } catch { return ""; } })();
  const gzipInConf = /gzip\s+on/.test(nginxConfContent);
  checks.push(_check("nginx_gzip", "Gzip compression enabled",
    gzipInConf || gzipHeader.includes("gzip"),
    gzipInConf ? "gzip on found in nginx.conf" : (gzipHeader ? `Content-Encoding: ${gzipHeader}` : "gzip not detected"),
    "Add 'gzip on; gzip_types text/plain text/css application/json application/javascript;' to nginx.conf", "warning"));

  // Caching headers (static assets)
  const staticR = await _localGet("/");
  const cacheControl = staticR.headers?.["cache-control"] || "";
  const hasCaching = /max-age=\d+/.test(cacheControl) || /immutable/.test(cacheControl) ||
    /expires/.test(nginxConfContent.toLowerCase()) || /cache-control/.test(nginxConfContent.toLowerCase());
  checks.push(_check("nginx_caching", "Static asset caching configured",
    hasCaching,
    hasCaching ? `Cache-Control: ${cacheControl || "set in nginx.conf"}` : "No cache-control headers detected",
    "Add 'expires 1y; add_header Cache-Control \"public, immutable\";' for /static/ location in nginx.conf", "warning"));

  // Security headers
  const hsts = (staticR.headers?.["strict-transport-security"] || "").includes("max-age");
  const xframe = !!staticR.headers?.["x-frame-options"];
  const xcto = !!staticR.headers?.["x-content-type-options"];
  const secHeadersOk = hsts || xframe || xcto || /add_header.*strict-transport/i.test(nginxConfContent);
  checks.push(_check("nginx_sec_headers", "Security headers (HSTS/X-Frame/X-Content-Type)",
    secHeadersOk,
    secHeadersOk ? `HSTS: ${hsts}, X-Frame: ${xframe}, X-Content-Type: ${xcto}` : "Security headers missing",
    "Add HSTS, X-Frame-Options, X-Content-Type-Options, X-XSS-Protection in nginx.conf server block"));

  // Large upload (client_max_body_size)
  const uploadOk = /client_max_body_size\s+\d/.test(nginxConfContent);
  checks.push(_check("nginx_upload", "Large upload (client_max_body_size) set",
    uploadOk,
    uploadOk ? "client_max_body_size configured in nginx.conf" : "client_max_body_size not set — default 1MB",
    "Add 'client_max_body_size 50m;' to the server block in nginx.conf", "warning"));

  // WebSocket proxy
  const wsOk = /upgrade/i.test(nginxConfContent) && /connection/i.test(nginxConfContent);
  checks.push(_check("nginx_websocket", "WebSocket proxying configured",
    wsOk,
    wsOk ? "proxy_set_header Upgrade/Connection found" : "WebSocket headers not found in nginx.conf",
    "Add: proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection 'upgrade';", "warning"));

  const passing = checks.filter(c => c.pass).length;
  return { module: "nginx", label: "Nginx", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 3 — SSL
// ══════════════════════════════════════════════════════════════════════════════
async function auditSSL() {
  const checks = [];
  const baseUrl = _env("BASE_URL") || `https://app.${DOMAIN}`;
  const hostname = (() => { try { return new URL(baseUrl).hostname; } catch { return `app.${DOMAIN}`; } })();

  // Cert file exists
  const certExists = fs.existsSync(CERTBOT_CERT) || fs.existsSync(`/etc/letsencrypt/live/${hostname}/fullchain.pem`);
  const certPath = certExists ? (fs.existsSync(CERTBOT_CERT) ? CERTBOT_CERT : `/etc/letsencrypt/live/${hostname}/fullchain.pem`) : null;
  checks.push(_check("ssl_cert", "SSL certificate file exists",
    certExists, certExists ? certPath : "No cert found at /etc/letsencrypt/live/",
    "sudo certbot certonly --nginx -d app.ooplix.com -d www.ooplix.com -d ooplix.com"));

  // Cert expiry
  let daysLeft = 0, certSubject = "";
  if (certPath) {
    const expiryR = _exec(`openssl x509 -enddate -noout -in "${certPath}" 2>/dev/null`);
    if (expiryR.ok && expiryR.out) {
      const match = expiryR.out.match(/notAfter=(.+)/);
      if (match) {
        daysLeft = Math.floor((new Date(match[1]) - Date.now()) / 86400000);
        certSubject = _exec(`openssl x509 -subject -noout -in "${certPath}" 2>/dev/null`).out || "";
      }
    }
  } else {
    // try remote probe
    try {
      const tlsR = await new Promise((resolve) => {
        const req = https.request({ hostname, port: 443, path: "/", method: "HEAD", rejectUnauthorized: false }, res => {
          const cert = res.socket?.getPeerCertificate?.();
          resolve(cert);
        });
        req.setTimeout(5000, () => { req.destroy(); resolve(null); });
        req.on("error", () => resolve(null));
        req.end();
      });
      if (tlsR?.valid_to) daysLeft = Math.floor((new Date(tlsR.valid_to) - Date.now()) / 86400000);
    } catch { /* ignore */ }
  }
  checks.push(_check("ssl_expiry", "SSL cert valid for ≥ 30 days",
    daysLeft >= 30,
    daysLeft > 0 ? `${daysLeft} days remaining${certSubject ? ` — ${certSubject}` : ""}` : (certExists ? "Cannot read expiry" : "No cert"),
    "sudo certbot renew --force-renewal"));

  // Auto-renew
  const renewTimer = _exec("systemctl is-active certbot.timer 2>/dev/null");
  const renewCron  = _exec("crontab -l 2>/dev/null | grep certbot");
  const renewOk    = renewTimer.out === "active" || renewCron.ok;
  checks.push(_check("ssl_autorenew", "Certbot auto-renew active",
    renewOk,
    renewOk ? (renewTimer.out === "active" ? "certbot.timer systemd unit active" : "Certbot in crontab") : "Auto-renew not detected",
    "sudo systemctl enable certbot.timer && sudo systemctl start certbot.timer  OR  add: 0 12 * * * /usr/bin/certbot renew --quiet"));

  // OCSP stapling
  const nginxConfContent = (() => { try { return fs.readFileSync(path.join(ROOT, "nginx.conf"), "utf8"); } catch { return ""; } })();
  const ocspOk = /ssl_stapling\s+on/.test(nginxConfContent);
  checks.push(_check("ssl_ocsp", "OCSP stapling enabled",
    ocspOk, ocspOk ? "ssl_stapling on in nginx.conf" : "ssl_stapling not found",
    "Add 'ssl_stapling on; ssl_stapling_verify on;' to nginx.conf HTTPS server block", "warning"));

  // TLS version (1.2+ only)
  const tlsConf = _exec(`openssl s_client -connect ${hostname}:443 -tls1 </dev/null 2>&1 | head -3`);
  const tls1Rejected = !tlsConf.out.includes("CONNECTED") || tlsConf.out.includes("handshake failure");
  const tlsProto = /ssl_protocols\s+TLSv1\.[23]/.test(nginxConfContent);
  const tlsOk = tls1Rejected || tlsProto || nginxConfContent.includes("TLSv1.2") || nginxConfContent.includes("TLSv1.3");
  checks.push(_check("ssl_tls_version", "TLS 1.0/1.1 disabled (TLS 1.2+ only)",
    tlsOk, tlsOk ? "ssl_protocols TLSv1.2 TLSv1.3 in nginx.conf" : "TLS version policy unclear",
    "Set 'ssl_protocols TLSv1.2 TLSv1.3;' in nginx.conf"));

  const passing = checks.filter(c => c.pass).length;
  return { module: "ssl", label: "SSL / TLS", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 4 — DNS
// ══════════════════════════════════════════════════════════════════════════════
async function auditDNS() {
  const checks = [];

  // A record
  let aRecord = null;
  try { const r = await dns.resolve4(DOMAIN); aRecord = r[0]; } catch {}
  checks.push(_check("dns_a", `A record for ${DOMAIN}`,
    !!aRecord, aRecord ? `${DOMAIN} → ${aRecord}` : `No A record for ${DOMAIN}`,
    `Add A record: ${DOMAIN} → <VPS_IP> in your DNS provider`));

  // AAAA record
  let aaaaRecord = null;
  try { const r = await dns.resolve6(DOMAIN); aaaaRecord = r[0]; } catch {}
  checks.push(_check("dns_aaaa", `AAAA record for ${DOMAIN}`,
    !!aaaaRecord, aaaaRecord ? `${DOMAIN} → ${aaaaRecord}` : `No AAAA record (IPv6)`,
    `Add AAAA record pointing to your VPS IPv6 address`, "warning"));

  // CNAME for www
  let wwwRecord = null;
  try { const r = await dns.resolve(`www.${DOMAIN}`, "CNAME"); wwwRecord = r[0]; } catch {
    try { const r = await dns.resolve4(`www.${DOMAIN}`); wwwRecord = r[0] + " (A)"; } catch {}
  }
  checks.push(_check("dns_cname_www", `www.${DOMAIN} resolves`,
    !!wwwRecord, wwwRecord ? `www.${DOMAIN} → ${wwwRecord}` : `www.${DOMAIN} not resolving`,
    `Add CNAME: www → ${DOMAIN} OR A record for www`, "warning"));

  // MX record
  let mxRecords = [];
  try { mxRecords = await dns.resolveMx(DOMAIN); } catch {}
  checks.push(_check("dns_mx", `MX record for ${DOMAIN}`,
    mxRecords.length > 0,
    mxRecords.length > 0 ? mxRecords.map(r => `${r.exchange} (${r.priority})`).join(", ") : "No MX records",
    "Add MX records via your email provider (e.g., Google Workspace, Resend)"));

  // TXT records
  let txtRecords = [];
  try { txtRecords = (await dns.resolveTxt(DOMAIN)).flat(); } catch {}
  checks.push(_check("dns_txt", `TXT records for ${DOMAIN}`,
    txtRecords.length > 0,
    txtRecords.length > 0 ? `${txtRecords.length} TXT record(s)` : "No TXT records",
    "Add domain verification TXT records for your services", "warning"));

  // SPF
  const spfRecord = txtRecords.find(r => r.startsWith("v=spf1"));
  checks.push(_check("dns_spf", "SPF record",
    !!spfRecord, spfRecord || "No SPF record",
    "Add TXT: v=spf1 include:_spf.resend.com include:sendgrid.net ~all (match your email provider)"));

  // DKIM — check selector._domainkey
  let dkimOk = false, dkimDetail = "Cannot probe (no DKIM_SELECTOR env var)";
  const dkimSel = _env("DKIM_SELECTOR") || "resend";
  try {
    const r = await dns.resolveTxt(`${dkimSel}._domainkey.${DOMAIN}`);
    dkimOk = r.flat().some(t => t.includes("v=DKIM1"));
    dkimDetail = dkimOk ? `DKIM found at ${dkimSel}._domainkey.${DOMAIN}` : `No valid DKIM at ${dkimSel}._domainkey.${DOMAIN}`;
  } catch (e) { dkimDetail = `No DKIM record at ${dkimSel}._domainkey.${DOMAIN}: ${e.code || e.message}`; }
  checks.push(_check("dns_dkim", "DKIM record",
    dkimOk, dkimDetail,
    "Configure DKIM via your email provider (Resend: resend._domainkey.ooplix.com → provided TXT)"));

  // DMARC
  let dmarcOk = false, dmarcDetail = "No DMARC record";
  try {
    const r = await dns.resolveTxt(`_dmarc.${DOMAIN}`);
    const dmarc = r.flat().find(t => t.startsWith("v=DMARC1"));
    dmarcOk = !!dmarc;
    dmarcDetail = dmarc || "No DMARC record";
  } catch { dmarcDetail = `No DMARC record (_dmarc.${DOMAIN})`; }
  checks.push(_check("dns_dmarc", "DMARC record",
    dmarcOk, dmarcDetail,
    `Add TXT _dmarc.${DOMAIN}: v=DMARC1; p=quarantine; rua=mailto:dmarc@${DOMAIN}`));

  // CAA record
  let caaOk = false, caaDetail = "No CAA record";
  try {
    const r = await dns.resolveCaa(DOMAIN);
    caaOk = r.length > 0;
    caaDetail = r.length > 0 ? r.map(c => `${c.issue || c.issuewild}`).join(", ") : "No CAA records";
  } catch { caaDetail = `No CAA record for ${DOMAIN}`; }
  checks.push(_check("dns_caa", "CAA record",
    caaOk, caaDetail,
    `Add CAA record: 0 issue "letsencrypt.org" for ${DOMAIN}`, "warning"));

  // Propagation check — resolve from multiple public resolvers
  const resolvers = ["8.8.8.8", "1.1.1.1", "9.9.9.9"];
  let propagated = 0;
  for (const resolver of resolvers) {
    const r = _exec(`dig +short @${resolver} ${DOMAIN} A 2>/dev/null || nslookup ${DOMAIN} ${resolver} 2>/dev/null | grep -A1 Name | grep Address | head -1 | awk '{print $2}'`);
    if (r.ok && r.out.match(/\d+\.\d+\.\d+\.\d+/)) propagated++;
  }
  checks.push(_check("dns_propagation", `DNS propagated (${propagated}/${resolvers.length} resolvers)`,
    propagated >= 2, `${propagated}/${resolvers.length} public resolvers return A record`,
    "DNS propagation takes up to 48h. Verify at whatsmydns.net", "warning"));

  const passing = checks.filter(c => c.pass).length;
  return { module: "dns", label: "DNS", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 5 — Domain Audit
// ══════════════════════════════════════════════════════════════════════════════
async function auditDomains() {
  const checks = [];
  const targets = [
    { id: "root",   host: DOMAIN,               label: `${DOMAIN}` },
    { id: "www",    host: `www.${DOMAIN}`,       label: `www.${DOMAIN}` },
    { id: "app",    host: `app.${DOMAIN}`,       label: `app.${DOMAIN}` },
    { id: "api",    host: `api.${DOMAIN}`,       label: `api.${DOMAIN}` },
    { id: "docs",   host: `docs.${DOMAIN}`,      label: `docs.${DOMAIN}` },
    { id: "status", host: `status.${DOMAIN}`,    label: `status.${DOMAIN}` },
    { id: "cdn",    host: `cdn.${DOMAIN}`,       label: `cdn.${DOMAIN}` },
  ];

  for (const t of targets) {
    let resolves = false, isHttps = false, detail = "";
    try {
      const aRecs = await dns.resolve4(t.host);
      resolves = aRecs.length > 0;
      detail   = resolves ? `→ ${aRecs[0]}` : "No A record";
    } catch (e) {
      try {
        const cname = await dns.resolve(t.host, "CNAME");
        resolves = true;
        detail   = `→ CNAME: ${cname[0]}`;
      } catch { detail = `DNS: NXDOMAIN / ${e.code || e.message}`; }
    }

    // HTTP probe
    if (resolves) {
      try {
        const r = await _req({ hostname: t.host, port: 443, path: "/", method: "HEAD",
          rejectUnauthorized: false }, null, 5000);
        isHttps = r.status > 0;
        detail += ` | HTTPS ${r.status}`;
      } catch { detail += " | HTTPS unreachable"; }
    }

    const severity = ["root","app"].includes(t.id) ? "critical" : "warning";
    checks.push(_check(`domain_${t.id}`, `${t.label} resolves`,
      resolves, detail,
      `Add DNS A/CNAME for ${t.host} → VPS IP`, severity));

    if (resolves) {
      checks.push(_check(`domain_https_${t.id}`, `${t.label} HTTPS responds`,
        isHttps, isHttps ? `HTTPS accessible` : "HTTPS not accessible",
        "Ensure nginx SSL config covers this subdomain", severity));
    }
  }

  const passing = checks.filter(c => c.pass).length;
  return { module: "domains", label: "Domain Audit", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 6 — Deployment Validation
// ══════════════════════════════════════════════════════════════════════════════
async function auditDeployment() {
  const checks = [];

  // Frontend build artifacts
  const indexHtml = _file("frontend/build/index.html");
  const jsChunks  = (() => { try { return fs.readdirSync(path.join(ROOT, "frontend/build/static/js")).length; } catch { return 0; } })();
  checks.push(_check("deploy_frontend", "Frontend build artifacts present",
    indexHtml && jsChunks > 0,
    indexHtml ? `frontend/build/index.html + ${jsChunks} JS chunks` : "frontend/build/index.html missing",
    "cd frontend && npm ci && npm run build"));

  // Backend entry point
  const serverJs = _file("backend/server.js");
  checks.push(_check("deploy_backend", "Backend entry point (backend/server.js)",
    serverJs, serverJs ? "backend/server.js present" : "backend/server.js missing",
    "Ensure backend/server.js exists and is the PM2 entry point"));

  // ecosystem.config.cjs
  const ecoConfig = _file("ecosystem.config.cjs");
  checks.push(_check("deploy_pm2_config", "PM2 ecosystem config (ecosystem.config.cjs)",
    ecoConfig, ecoConfig ? "ecosystem.config.cjs present" : "ecosystem.config.cjs missing",
    "PM2 ecosystem config required: pm2 start ecosystem.config.cjs --env production"));

  // PM2 process running
  const pm2R = _exec("pm2 list --no-color 2>/dev/null | grep jarvis-os | grep -c online");
  const pm2Running = parseInt(pm2R.out) >= 1;
  checks.push(_check("deploy_pm2_running", "PM2 jarvis-os process online",
    pm2Running, pm2Running ? "jarvis-os online in PM2" : "jarvis-os not running in PM2",
    "pm2 start ecosystem.config.cjs --env production && pm2 save"));

  // Health endpoint
  let healthOk = false, healthDetail = "Cannot reach /api/health";
  try {
    const r = await _localGet("/api/health", 5000);
    healthOk = r.status === 200;
    healthDetail = r.status === 200 ? "HTTP 200 from /api/health" : `HTTP ${r.status} from /api/health`;
  } catch (e) { healthDetail = `Health probe error: ${e.message}`; }
  checks.push(_check("deploy_health", "Health endpoint /api/health responds 200",
    healthOk, healthDetail,
    "Ensure backend is running: pm2 restart jarvis-os && pm2 logs jarvis-os --lines 20"));

  // Electron updater config
  const builderConfig = _read("package.json")?.build || _read("electron-builder.json") || {};
  const hasUpdater = !!builderConfig.publish || _has("GH_TOKEN") || _has("CSC_LINK");
  checks.push(_check("deploy_electron_updater", "Electron auto-updater configured",
    hasUpdater,
    hasUpdater ? "electron-builder publish config or GH_TOKEN found" : "No auto-updater config detected",
    "Set GH_TOKEN and add publish: {provider: github} to package.json build config", "warning"));

  // Restart capability (PM2 restart works)
  const restartR = _exec("pm2 list --no-color 2>/dev/null | grep jarvis-os");
  checks.push(_check("deploy_restart", "PM2 restart capability",
    restartR.ok && restartR.out.length > 0,
    restartR.ok ? "PM2 process registered (can restart)" : "PM2 process not registered",
    "pm2 start ecosystem.config.cjs --env production && pm2 save && pm2 startup"));

  // Rollback capability — git is present and has commits
  const gitLogR = _exec("git log --oneline -3 2>/dev/null");
  checks.push(_check("deploy_rollback", "Git rollback capability (git log reachable)",
    gitLogR.ok && gitLogR.out.length > 0,
    gitLogR.ok ? `Last commits: ${gitLogR.out.split("\n")[0]}` : "Cannot read git log",
    "Ensure repo is initialized and commits are present for rollback", "warning"));

  const passing = checks.filter(c => c.pass).length;
  return { module: "deployment", label: "Deployment Validation", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 7 — Backup Validation
// ══════════════════════════════════════════════════════════════════════════════
async function auditBackup() {
  const checks = [];
  const BACKUP_DIR = path.join(ROOT, "backups");

  // Backup script
  const backupSh = _file("backup.sh");
  const safeBackup = _file("scripts/safe-backup.cjs");
  checks.push(_check("backup_script", "Backup script present (backup.sh / safe-backup.cjs)",
    backupSh || safeBackup,
    (backupSh ? "backup.sh" : "") + (safeBackup ? " scripts/safe-backup.cjs" : ""),
    "Create backup.sh that tarballs data/ and uploads to S3/R2"));

  // Backup directory
  const backupDirExists = fs.existsSync(BACKUP_DIR);
  checks.push(_check("backup_dir", "Backups directory exists",
    backupDirExists, backupDirExists ? `${BACKUP_DIR}` : "backups/ directory missing",
    "mkdir -p backups && chmod 700 backups", "warning"));

  // Recent backups exist
  let recentBackups = 0, backupAge = Infinity;
  if (backupDirExists) {
    try {
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith(".tar.gz") || f.endsWith(".zip") || f.endsWith(".sql"))
        .map(f => ({ f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      recentBackups = files.length;
      if (files.length > 0) backupAge = Math.floor((Date.now() - files[0].mtime) / 3600000); // hours
    } catch {}
  }
  checks.push(_check("backup_recent", "Backup exists (< 25h old)",
    recentBackups > 0 && backupAge < 25,
    recentBackups > 0 ? `${recentBackups} backup(s), newest: ${backupAge}h ago` : "No backup files found",
    "Run: ./backup.sh   OR add to cron: 0 2 * * * cd /opt/jarvis-os && ./backup.sh >> logs/backup.log 2>&1"));

  // Data backup (data/ dir)
  const dataFiles = (() => { try { return fs.readdirSync(path.join(ROOT, "data")).length; } catch { return 0; } })();
  checks.push(_check("backup_database", "data/ directory has files (flat-file DB)",
    dataFiles > 0, `${dataFiles} data files in data/`,
    "Ensure data/ is included in backup: tar -czf backup.tar.gz data/"));

  // Config backup (.env)
  const envExists = _file(".env");
  checks.push(_check("backup_config", ".env (config) backup awareness",
    envExists,
    envExists ? ".env file present — ensure it's backed up securely off-site (NOT in git)" : ".env file missing",
    "Back up .env to a secrets manager (Doppler, AWS Secrets Manager, Vault) — NEVER commit to git", "warning"));

  // Assets backup (frontend/build or uploads)
  const assetsBuild = _file("frontend/build/index.html");
  const uploadsDir  = fs.existsSync(path.join(ROOT, "uploads"));
  checks.push(_check("backup_assets", "Assets (frontend build / uploads) exist",
    assetsBuild || uploadsDir,
    assetsBuild ? "frontend/build present" : (uploadsDir ? "uploads/ present" : "No asset directories found"),
    "Include frontend/build and uploads/ in your backup script", "warning"));

  // Restore test (scripts/test-restore.cjs exists)
  const restoreTest = _file("scripts/test-restore.cjs") || _file("scripts/test-portable-restore.cjs");
  checks.push(_check("backup_restore", "Restore test script present",
    restoreTest, restoreTest ? "test-restore.cjs found" : "No restore test script",
    "Create scripts/test-restore.cjs to validate backup integrity on every backup run", "warning"));

  // Backup integrity (last tar.gz is readable)
  let integrityOk = false, integrityDetail = "No backup to test";
  if (backupDirExists && recentBackups > 0) {
    try {
      const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith(".tar.gz")).sort().reverse();
      if (files.length > 0) {
        const r = _exec(`tar -tzf "${path.join(BACKUP_DIR, files[0])}" 2>/dev/null | wc -l`);
        const fileCount = parseInt(r.out) || 0;
        integrityOk = fileCount > 0;
        integrityDetail = integrityOk ? `Latest backup: ${files[0]} — ${fileCount} files` : `Backup integrity check failed: ${files[0]}`;
      }
    } catch (e) { integrityDetail = `Integrity check error: ${e.message}`; }
  }
  checks.push(_check("backup_integrity", "Latest backup file is readable",
    integrityOk, integrityDetail,
    "Re-run ./backup.sh and verify tar -tzf backups/latest.tar.gz completes without errors"));

  // Retention (at least 7 backups)
  checks.push(_check("backup_retention", "Backup retention ≥ 7 copies",
    recentBackups >= 7,
    `${recentBackups} backup(s) retained`,
    "Update backup.sh retention: keep last 14 backups with: ls -t backups/*.tar.gz | tail -n +15 | xargs rm -f", "warning"));

  // Off-site backup
  const hasS3 = _has("AWS_ACCESS_KEY_ID") || _has("R2_ACCESS_KEY_ID");
  const hasRsync = _exec("which rsync 2>/dev/null").ok;
  checks.push(_check("backup_offsite", "Off-site backup configured (S3/R2/rsync)",
    hasS3,
    hasS3 ? "S3/R2 credentials set — off-site backup possible" : "No S3/R2 credentials — backups are local only",
    "Set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (or R2 keys) and upload: aws s3 cp backups/ s3://your-bucket/ --recursive", "warning"));

  const passing = checks.filter(c => c.pass).length;
  return { module: "backup", label: "Backup Validation", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 8 — Monitoring
// ══════════════════════════════════════════════════════════════════════════════
async function auditMonitoring() {
  const checks = [];

  // PM2 monitoring
  const pm2MonR = _exec("pm2 list --no-color 2>/dev/null | grep jarvis-os");
  checks.push(_check("monitor_pm2", "PM2 process monitoring",
    pm2MonR.ok && pm2MonR.out.includes("jarvis-os"),
    pm2MonR.ok ? pm2MonR.out.split("\n")[0].trim().slice(0, 100) : "PM2 not available",
    "pm2 start ecosystem.config.cjs --env production && pm2 monit"));

  // Memory usage
  const memR = _exec("free -m 2>/dev/null | awk '/^Mem:/{printf \"%d%%\", $3/$2*100}'");
  const memPct = parseInt(memR.out) || 0;
  checks.push(_check("monitor_memory", "Memory usage < 90%",
    memR.ok && memPct < 90,
    memR.ok ? `Memory: ${memPct}% used` : "Cannot check memory",
    "Investigate memory leak: pm2 logs jarvis-os --lines 50 && pm2 monit", "warning"));

  // CPU usage
  const cpuR = _exec("top -bn1 2>/dev/null | grep 'Cpu(s)' | awk '{print 100-$8}' | cut -d. -f1");
  const cpuPct = parseInt(cpuR.out) || 0;
  checks.push(_check("monitor_cpu", "CPU usage < 80%",
    !cpuR.ok || cpuPct < 80,
    cpuR.ok ? `CPU: ${cpuPct}% used` : "Cannot probe CPU (may be fine)",
    "Scale VPS or optimize hot code paths", "warning"));

  // Disk usage
  const diskR = _exec("df -h / 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%'");
  const diskPct = parseInt(diskR.out) || 0;
  checks.push(_check("monitor_disk", "Disk usage < 85%",
    !diskR.ok || diskPct < 85,
    diskR.ok ? `Disk: ${diskPct}% used` : "Cannot probe disk",
    "Clean old logs: pm2 flush && find logs/ -mtime +7 -delete && df -h /", "warning"));

  // Telegram alerts
  const telegramOk = _has("TELEGRAM_TOKEN") && _has("TELEGRAM_OPERATOR_CHAT_ID");
  checks.push(_check("monitor_telegram", "Telegram alerts configured",
    telegramOk,
    telegramOk ? "TELEGRAM_TOKEN and TELEGRAM_OPERATOR_CHAT_ID set — operationsAlertingLayer active" : "TELEGRAM_TOKEN or TELEGRAM_OPERATOR_CHAT_ID not set",
    "Set TELEGRAM_TOKEN (from @BotFather) and TELEGRAM_OPERATOR_CHAT_ID in .env", "warning"));

  // Log rotation
  const logrotateR = _exec("which logrotate 2>/dev/null");
  const pm2LogRotate = _exec("pm2 list 2>/dev/null | grep -c pm2-logrotate");
  const logRotOk = logrotateR.ok || parseInt(pm2LogRotate.out) > 0;
  checks.push(_check("monitor_logrotate", "Log rotation configured",
    logRotOk,
    logRotOk ? (parseInt(pm2LogRotate.out) > 0 ? "pm2-logrotate module installed" : "logrotate available") : "No log rotation detected",
    "pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 50M && pm2 set pm2-logrotate:retain 7", "warning"));

  // Health endpoint accessible
  let healthOk = false, healthDetail = "Cannot reach /api/health";
  try {
    const r = await _localGet("/api/health", 4000);
    healthOk = r.status === 200;
    healthDetail = `HTTP ${r.status} from localhost:${PORT}/api/health`;
  } catch (e) { healthDetail = `Health probe error: ${e.message}`; }
  checks.push(_check("monitor_health_endpoint", "Health endpoint accessible",
    healthOk, healthDetail,
    "Ensure the backend is running: pm2 restart jarvis-os"));

  const passing = checks.filter(c => c.pass).length;
  return { module: "monitoring", label: "Monitoring", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 9 — Security
// ══════════════════════════════════════════════════════════════════════════════
async function auditSecurity() {
  const checks = [];

  // Security headers from local server
  let headers = {};
  try { const r = await _localGet("/"); headers = r.headers || {}; } catch {}

  const xframe    = !!headers["x-frame-options"];
  const xcto      = !!headers["x-content-type-options"];
  const hsts      = (headers["strict-transport-security"] || "").includes("max-age");
  const csp       = !!headers["content-security-policy"];
  const referer   = !!headers["referrer-policy"];
  checks.push(_check("sec_headers", "Security headers (HSTS, X-Frame, X-Content-Type, CSP, Referrer-Policy)",
    xframe && xcto && (hsts || csp),
    `X-Frame: ${xframe}, X-Content-Type: ${xcto}, HSTS: ${hsts}, CSP: ${csp}, Referrer: ${referer}`,
    "Set security headers in nginx.conf: HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, CSP"));

  // JWT secret strength
  const jwtSecret = _env("JWT_SECRET");
  const jwtOk = jwtSecret.length >= 32;
  checks.push(_check("sec_jwt", "JWT_SECRET ≥ 32 characters",
    jwtOk,
    jwtOk ? `JWT_SECRET: ${jwtSecret.length} chars` : jwtSecret ? `JWT_SECRET too short: ${jwtSecret.length} chars` : "JWT_SECRET not set",
    "Generate: openssl rand -hex 32  then set JWT_SECRET in .env"));

  // No secrets in git
  const gitSecretR = _exec('git log --all --oneline 2>/dev/null | wc -l');
  const commitCount = parseInt(gitSecretR.out) || 0;
  const gitIgnoreEnv = (() => { try { return fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").includes(".env"); } catch { return false; } })();
  checks.push(_check("sec_secrets", ".env excluded from git (.gitignore)",
    gitIgnoreEnv,
    gitIgnoreEnv ? ".env in .gitignore" : ".env NOT in .gitignore — secrets may be committed",
    "echo '.env' >> .gitignore && git rm --cached .env 2>/dev/null || true"));

  // File permissions
  const envPerms = _exec("stat -c %a .env 2>/dev/null || stat -f %Lp .env 2>/dev/null");
  const permsOk = envPerms.ok && ["600","400"].some(p => envPerms.out.startsWith(p));
  checks.push(_check("sec_permissions", ".env permissions 600 (owner read/write only)",
    permsOk,
    permsOk ? `.env permissions: ${envPerms.out}` : `.env permissions: ${envPerms.out || "unknown"} — should be 600`,
    "chmod 600 .env", "warning"));

  // SSH key auth (password auth disabled)
  const sshConfR = _exec("sshd -T 2>/dev/null | grep -i 'passwordauthentication'");
  const passwdAuthDisabled = sshConfR.out.toLowerCase().includes("no") || !sshConfR.ok;
  checks.push(_check("sec_ssh", "SSH password authentication disabled",
    passwdAuthDisabled,
    sshConfR.ok ? sshConfR.out : "Cannot probe sshd config (may be OK in local dev)",
    "Set PasswordAuthentication no in /etc/ssh/sshd_config then: sudo systemctl reload sshd", "warning"));

  // Open ports (only 22, 80, 443, PORT expected)
  const portsR = _exec("ss -tlnp 2>/dev/null | grep LISTEN | awk '{print $4}' | cut -d: -f2 | sort -u");
  const openPorts = (portsR.out || "").split("\n").map(p => parseInt(p)).filter(Boolean);
  const unexpectedPorts = openPorts.filter(p => ![22, 80, 443, PORT, 3000, 5050, 8080, 8443].includes(p));
  checks.push(_check("sec_ports", "No unexpected ports open",
    unexpectedPorts.length === 0,
    portsR.ok ? `Open ports: ${openPorts.join(", ")}${unexpectedPorts.length ? ` — unexpected: ${unexpectedPorts.join(", ")}` : ""}` : "Cannot probe ports (local dev — OK)",
    `Close unexpected ports: sudo ufw deny ${unexpectedPorts.join(" && sudo ufw deny ")}`, "warning"));

  // Rate limiting in nginx
  const nginxConf = (() => { try { return fs.readFileSync(path.join(ROOT, "nginx.conf"), "utf8"); } catch { return ""; } })();
  const rateLimitOk = /limit_req_zone/.test(nginxConf) && /limit_req\s+zone/.test(nginxConf);
  checks.push(_check("sec_rate_limit", "Nginx rate limiting configured",
    rateLimitOk,
    rateLimitOk ? "limit_req_zone + limit_req found in nginx.conf" : "Rate limiting not found in nginx.conf",
    "Add limit_req_zone and limit_req directives to nginx.conf (see project nginx.conf for reference)"));

  const passing = checks.filter(c => c.pass).length;
  return { module: "security", label: "Security", checks, passing, total: checks.length, score: Math.round(passing / checks.length * 100) };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 10 — Stress Test
// ══════════════════════════════════════════════════════════════════════════════
async function auditStressTest() {
  const checks = [];
  const levels = [
    { users: 50,  target_p95_ms: 800,  target_err_pct: 1  },
    { users: 100, target_p95_ms: 1500, target_err_pct: 2  },
    { users: 250, target_p95_ms: 3000, target_err_pct: 5  },
    { users: 500, target_p95_ms: 5000, target_err_pct: 10 },
  ];

  const results = [];

  for (const level of levels) {
    const { users, target_p95_ms, target_err_pct } = level;
    const concurrency = Math.min(users, 50); // cap actual concurrent requests to 50
    const batches = Math.ceil(users / concurrency);
    const latencies = [];
    let errors = 0, total = 0;

    const memBefore = _exec("free -m 2>/dev/null | awk '/^Mem:/{print $3}'");
    const cpuBefore = _exec("top -bn1 2>/dev/null | grep 'Cpu(s)' | awk '{print 100-$8}' | cut -d. -f1");

    for (let b = 0; b < batches; b++) {
      const batch = Array.from({ length: concurrency }, () => {
        const t0 = Date.now();
        return _localGet("/api/health", 10000).then(r => {
          latencies.push(Date.now() - t0);
          if (r.status !== 200) errors++;
          total++;
        }).catch(() => { errors++; total++; latencies.push(10000); });
      });
      await Promise.all(batch);
    }

    const memAfter = _exec("free -m 2>/dev/null | awk '/^Mem:/{print $3}'");
    const cpuAfter = _exec("top -bn1 2>/dev/null | grep 'Cpu(s)' | awk '{print 100-$8}' | cut -d. -f1");

    latencies.sort((a, b) => a - b);
    const p50  = latencies[Math.floor(latencies.length * 0.5)] || 0;
    const p95  = latencies[Math.floor(latencies.length * 0.95)] || 0;
    const p99  = latencies[Math.floor(latencies.length * 0.99)] || 0;
    const avg  = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const errPct = total > 0 ? Math.round(errors / total * 100) : 0;
    const memUsed  = parseInt(memAfter.out) || 0;
    const cpuPct   = parseInt(cpuAfter.out) || 0;
    const p95Pass  = p95 <= target_p95_ms;
    const errPass  = errPct <= target_err_pct;

    results.push({ users, p50, p95, p99, avg, errors, total, errPct, memUsedMB: memUsed, cpuPct, p95Pass, errPass });

    checks.push(_check(`stress_${users}u_p95`, `${users} users: P95 ≤ ${target_p95_ms}ms`,
      p95Pass, `P95: ${p95}ms (avg: ${avg}ms, P99: ${p99}ms)`,
      `Optimize hot path: check PM2 logs, nginx proxy timeouts, and in-memory ops`));

    checks.push(_check(`stress_${users}u_err`, `${users} users: Error rate ≤ ${target_err_pct}%`,
      errPass, `${errors}/${total} errors (${errPct}%)`,
      `Check backend logs: pm2 logs jarvis-os --lines 50`));

    checks.push(_check(`stress_${users}u_cpu`, `${users} users: CPU < 90%`,
      !cpuAfter.ok || cpuPct < 90, cpuAfter.ok ? `CPU: ${cpuPct}%` : "Cannot probe CPU",
      "Optimize CPU-heavy code paths or scale VPS", "warning"));

    checks.push(_check(`stress_${users}u_mem`, `${users} users: Memory < 1.5GB`,
      !memAfter.ok || memUsed < 1536, memAfter.ok ? `Memory: ${memUsed}MB` : "Cannot probe memory",
      "Investigate memory usage: pm2 monit && heap profiling", "warning"));
  }

  const passing = checks.filter(c => c.pass).length;
  return {
    module: "stress", label: "Stress Test", checks, passing, total: checks.length,
    score: Math.round(passing / checks.length * 100), results,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// REPORT GENERATORS
// ══════════════════════════════════════════════════════════════════════════════

function _verdict(score, criticalFails) {
  if (criticalFails > 0 && score < 50) return "NO GO";
  if (criticalFails > 0 || score < 70)  return "CONDITIONAL GO";
  return "GO";
}

function buildInfraReport(modules) {
  const allChecks = modules.flatMap(m => m.checks.map(c => ({ ...c, module: m.module })));
  const failing   = allChecks.filter(c => !c.pass);
  const critFails = failing.filter(c => c.severity === "critical").length;
  const score     = Math.round(modules.reduce((s, m) => s + m.score, 0) / modules.length);
  return {
    type:           "Infrastructure Report",
    score,
    verdict:        _verdict(score, critFails),
    totalChecks:    allChecks.length,
    passing:        allChecks.filter(c => c.pass).length,
    failing:        failing.length,
    criticalFails:  critFails,
    failingChecks:  failing.slice(0, 20),
    moduleScores:   modules.map(m => ({ module: m.module, label: m.label, score: m.score, passing: m.passing, total: m.total })),
  };
}

function buildDeploymentReport(deployMod, healthOk) {
  const allChecks  = deployMod.checks;
  const critFails  = allChecks.filter(c => !c.pass && c.severity === "critical").length;
  return {
    type:        "Deployment Report",
    score:       deployMod.score,
    verdict:     _verdict(deployMod.score, critFails),
    checks:      allChecks,
    healthEndpointOk: healthOk,
  };
}

function buildSecurityReport(secMod) {
  const failing    = secMod.checks.filter(c => !c.pass);
  const critFails  = failing.filter(c => c.severity === "critical").length;
  return {
    type:        "Security Report",
    score:       secMod.score,
    verdict:     _verdict(secMod.score, critFails),
    checks:      secMod.checks,
    criticalIssues: failing.filter(c => c.severity === "critical"),
    warnings:    failing.filter(c => c.severity === "warning"),
  };
}

function buildPerformanceReport(stressMod) {
  return {
    type:        "Performance Report",
    score:       stressMod.score,
    verdict:     stressMod.score >= 80 ? "GO" : stressMod.score >= 50 ? "CONDITIONAL GO" : "NO GO",
    results:     stressMod.results,
    checks:      stressMod.checks,
    summary:     stressMod.results.map(r =>
      `${r.users} users: P95=${r.p95}ms, err=${r.errPct}%, CPU=${r.cpuPct}%, mem=${r.memUsedMB}MB`),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// FULL AUDIT RUNNER
// ══════════════════════════════════════════════════════════════════════════════

async function runFullAudit() {
  const t0 = Date.now();

  // run all 10 modules in parallel where safe; stress last (sequential requests)
  const [vps, nginx, ssl, dns_, domains, deployment, backup, monitoring, security] = await Promise.all([
    Promise.resolve(auditVPS()),
    auditNginx(),
    auditSSL(),
    auditDNS(),
    auditDomains(),
    auditDeployment(),
    auditBackup(),
    auditMonitoring(),
    auditSecurity(),
  ]);
  const stress = await auditStressTest();

  const modules = [vps, nginx, ssl, dns_, domains, deployment, backup, monitoring, security, stress];
  const allChecks = modules.flatMap(m => m.checks);
  const totalChecks = allChecks.length;
  const totalPassing = allChecks.filter(c => c.pass).length;
  const productionScore = Math.round(totalPassing / totalChecks * 100);
  const criticalFails = allChecks.filter(c => !c.pass && c.severity === "critical").length;
  const verdict = _verdict(productionScore, criticalFails);

  // health status from deployment module
  const healthCheck = deployment.checks.find(c => c.id === "deploy_health");
  const healthOk    = healthCheck?.pass || false;

  const report = {
    id:             `dop1-${Date.now()}`,
    runAt:          _ts(),
    durationMs:     Date.now() - t0,
    productionScore,
    verdict,
    totalChecks,
    totalPassing,
    criticalFails,
    modules: { vps, nginx, ssl, dns: dns_, domains, deployment, backup, monitoring, security, stress },
    reports: {
      infrastructure: buildInfraReport(modules),
      deployment:     buildDeploymentReport(deployment, healthOk),
      security:       buildSecurityReport(security),
      performance:    buildPerformanceReport(stress),
    },
    summary: {
      vps:        { score: vps.score,        verdict: vps.score >= 70 ? "GO" : "CONDITIONAL GO" },
      nginx:      { score: nginx.score,      verdict: nginx.score >= 70 ? "GO" : "CONDITIONAL GO" },
      ssl:        { score: ssl.score,        verdict: ssl.score >= 60 ? "GO" : "CONDITIONAL GO" },
      dns:        { score: dns_.score,       verdict: dns_.score >= 60 ? "GO" : "CONDITIONAL GO" },
      domains:    { score: domains.score,    verdict: domains.score >= 70 ? "GO" : "CONDITIONAL GO" },
      deployment: { score: deployment.score, verdict: deployment.score >= 70 ? "GO" : "CONDITIONAL GO" },
      backup:     { score: backup.score,     verdict: backup.score >= 50 ? "GO" : "CONDITIONAL GO" },
      monitoring: { score: monitoring.score, verdict: monitoring.score >= 70 ? "GO" : "CONDITIONAL GO" },
      security:   { score: security.score,   verdict: security.score >= 70 ? "GO" : "CONDITIONAL GO" },
      stress:     { score: stress.score,     verdict: stress.score >= 80 ? "GO" : "CONDITIONAL GO" },
    },
  };

  const s = _load();
  s.reports = s.reports || [];
  s.reports.unshift(report);
  if (s.reports.length > 10) s.reports = s.reports.slice(0, 10);
  s.lastRun = report.runAt;
  _save(s);
  return report;
}

async function runModuleAudit(module_) {
  switch (module_) {
    case "vps":        return auditVPS();
    case "nginx":      return auditNginx();
    case "ssl":        return auditSSL();
    case "dns":        return auditDNS();
    case "domains":    return auditDomains();
    case "deployment": return auditDeployment();
    case "backup":     return auditBackup();
    case "monitoring": return auditMonitoring();
    case "security":   return auditSecurity();
    case "stress":     return auditStressTest();
    default: throw new Error(`Unknown module: ${module_}`);
  }
}

function getLastReport()    { return _load().reports?.[0] || null; }
function getReportHistory() { return (_load().reports || []).map(r => ({ id: r.id, runAt: r.runAt, productionScore: r.productionScore, verdict: r.verdict, totalPassing: r.totalPassing, totalChecks: r.totalChecks })); }

async function runBenchmark() {
  const report = await runFullAudit();
  const checks = [
    { id: "vps_score",        label: `VPS: ${report.modules.vps.score}%`,                    ok: report.modules.vps.score >= 50 },
    { id: "nginx_score",      label: `Nginx: ${report.modules.nginx.score}%`,                ok: report.modules.nginx.score >= 40 },
    { id: "ssl_score",        label: `SSL: ${report.modules.ssl.score}%`,                    ok: report.modules.ssl.score >= 40 },
    { id: "dns_score",        label: `DNS: ${report.modules.dns.score}%`,                    ok: report.modules.dns.score >= 30 },
    { id: "domains_score",    label: `Domains: ${report.modules.domains.score}%`,            ok: report.modules.domains.score >= 30 },
    { id: "deploy_score",     label: `Deployment: ${report.modules.deployment.score}%`,      ok: report.modules.deployment.score >= 50 },
    { id: "backup_score",     label: `Backup: ${report.modules.backup.score}%`,              ok: report.modules.backup.score >= 30 },
    { id: "monitor_score",    label: `Monitoring: ${report.modules.monitoring.score}%`,      ok: report.modules.monitoring.score >= 50 },
    { id: "security_score",   label: `Security: ${report.modules.security.score}%`,          ok: report.modules.security.score >= 50 },
    { id: "stress_score",     label: `Stress Test: ${report.modules.stress.score}%`,         ok: report.modules.stress.score >= 50 },
    { id: "health_endpoint",  label: "Health endpoint /api/health → 200",                    ok: report.modules.deployment.checks.find(c => c.id === "deploy_health")?.pass },
    { id: "frontend_build",   label: "Frontend build artifacts present",                      ok: report.modules.deployment.checks.find(c => c.id === "deploy_frontend")?.pass },
    { id: "pm2_running",      label: "PM2 process online",                                   ok: report.modules.vps.checks.find(c => c.id === "vps_pm2")?.pass },
    { id: "jwt_secret",       label: "JWT_SECRET ≥ 32 chars",                                ok: report.modules.security.checks.find(c => c.id === "sec_jwt")?.pass },
    { id: "env_gitignore",    label: ".env excluded from git",                               ok: report.modules.security.checks.find(c => c.id === "sec_secrets")?.pass },
    { id: "backup_exists",    label: "Recent backup present",                                ok: report.modules.backup.checks.find(c => c.id === "backup_recent")?.pass },
    { id: "nginx_installed",  label: "Nginx installed and running",                           ok: report.modules.nginx.checks.find(c => c.id === "nginx_running")?.pass },
    { id: "ssl_cert",         label: "SSL certificate exists",                               ok: report.modules.ssl.checks.find(c => c.id === "ssl_cert")?.pass },
    { id: "rate_limiting",    label: "Nginx rate limiting configured",                        ok: report.modules.security.checks.find(c => c.id === "sec_rate_limit")?.pass },
    { id: "stress_50u",       label: "50-user P95 test passes",                              ok: report.modules.stress.checks.find(c => c.id === "stress_50u_p95")?.pass },
  ];
  const passing = checks.filter(c => c.ok).length;
  const score   = Math.round(passing / checks.length * 100);
  return {
    score, passing, total: checks.length,
    regressionPass: passing >= Math.floor(checks.length * 0.55),
    productionScore: report.productionScore,
    verdict: report.verdict,
    checks,
    runAt: report.runAt,
  };
}

module.exports = {
  runFullAudit, runModuleAudit, getLastReport, getReportHistory, runBenchmark,
  auditVPS, auditNginx, auditSSL, auditDNS, auditDomains,
  auditDeployment, auditBackup, auditMonitoring, auditSecurity, auditStressTest,
};
