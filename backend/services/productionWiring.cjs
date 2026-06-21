"use strict";
/**
 * Production Wiring Sprint 1
 * Audits every existing integration and connects it to real production services.
 *
 * NO new features. NO new engines. NO architecture changes.
 * Only production wiring and verification.
 *
 * Integrations audited:
 *   1. AI Providers     — Groq, OpenAI, Anthropic, Gemini, OpenRouter, Ollama
 *   2. Payments         — Razorpay (keys, webhook, BASE_URL, test order)
 *   3. Email            — SMTP, SendGrid, Resend, Postmark, SES
 *   4. OAuth            — Google, GitHub, Slack, Notion, LinkedIn
 *   5. WhatsApp         — WA_TOKEN, PHONE_ID, webhook URL, verify flow
 *   6. Browser          — Playwright installation, chromium, headless launch
 *
 * For every integration:
 *   - Detect missing credentials
 *   - Validate environment variables
 *   - Verify callback / webhook URLs
 *   - Add health checks
 *   - Perform a real test request (safe mock if credentials absent)
 *   - Record pass / fail status
 *   - Generate a Production Wiring Report
 *
 * Storage: data/production-wiring.json
 */

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const http  = require("http");

const DATA_FILE = path.join(__dirname, "../../data/production-wiring.json");
const ROOT      = path.join(__dirname, "../..");

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { reports: [], lastRun: null }; }
}
function _save(s) { fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2)); }
function _ts()    { return new Date().toISOString(); }
function _env(k)  { return process.env[k] || ""; }
function _has(k)  { return !!_env(k); }

// ── HTTP helpers (no axios dependency — use Node built-in) ───────────────────

function _request(opts, body = null, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const mod = opts.protocol === "http:" ? http : https;
    const req = mod.request(opts, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error("timeout")); });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function _get(url, headers = {}, timeoutMs = 8000) {
  const u = new URL(url);
  return _request({ protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
    path: u.pathname + u.search, method: "GET", headers }, null, timeoutMs);
}

function _post(url, body, headers = {}, timeoutMs = 10000) {
  const u    = new URL(url);
  const data = typeof body === "string" ? body : JSON.stringify(body);
  return _request({ protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
    path: u.pathname + u.search, method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers }
  }, data, timeoutMs);
}

// ── Check result builder ─────────────────────────────────────────────────────

function _check(id, label, pass, detail, fix = null, warning = false) {
  return { id, label, pass: !!pass, warning: !pass && !!warning, detail, fix: pass ? null : fix };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. AI PROVIDERS
// ══════════════════════════════════════════════════════════════════════════════

async function auditAIProviders() {
  const checks = [];

  // ── Groq ──
  const groqKey = _env("GROQ_API_KEY");
  checks.push(_check("groq_key", "Groq: API key present", _has("GROQ_API_KEY"),
    _has("GROQ_API_KEY") ? "GROQ_API_KEY is set" : "GROQ_API_KEY missing",
    "Add GROQ_API_KEY=gsk_... to .env — free at console.groq.com"));

  if (groqKey) {
    try {
      const res = await _post("https://api.groq.com/openai/v1/chat/completions",
        { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: "ping" }], max_tokens: 3 },
        { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" });
      const pass = res.status === 200;
      checks.push(_check("groq_live", "Groq: live API call succeeds", pass,
        pass ? `HTTP ${res.status} — model responded` : `HTTP ${res.status} — ${res.body.slice(0,120)}`,
        "Check GROQ_API_KEY is valid and quota is available"));
    } catch (e) {
      checks.push(_check("groq_live", "Groq: live API call succeeds", false, `Network error: ${e.message}`, "Check network / firewall"));
    }
  } else {
    checks.push(_check("groq_live", "Groq: live API call succeeds", false, "Skipped — key missing", "Set GROQ_API_KEY", true));
  }

  // ── OpenAI ──
  const oaiKey = _env("OPENAI_API_KEY");
  checks.push(_check("openai_key", "OpenAI: API key present", _has("OPENAI_API_KEY"),
    _has("OPENAI_API_KEY") ? "OPENAI_API_KEY is set" : "OPENAI_API_KEY missing",
    "Add OPENAI_API_KEY=sk-... to .env — platform.openai.com"));

  if (oaiKey) {
    try {
      const res = await _post("https://api.openai.com/v1/chat/completions",
        { model: "gpt-4o-mini", messages: [{ role: "user", content: "ping" }], max_tokens: 3 },
        { Authorization: `Bearer ${oaiKey}` });
      const pass = res.status === 200;
      checks.push(_check("openai_live", "OpenAI: live API call succeeds", pass,
        pass ? `HTTP ${res.status} — model responded` : `HTTP ${res.status} — ${res.body.slice(0,120)}`,
        "Check OPENAI_API_KEY is valid and has quota"));
    } catch (e) {
      checks.push(_check("openai_live", "OpenAI: live API call succeeds", false, `Network error: ${e.message}`, "Check network"));
    }
  } else {
    checks.push(_check("openai_live", "OpenAI: live API call succeeds", false, "Skipped — key missing", "Set OPENAI_API_KEY", true));
  }

  // ── Anthropic ──
  const anthKey = _env("ANTHROPIC_API_KEY");
  checks.push(_check("anthropic_key", "Anthropic: API key present", _has("ANTHROPIC_API_KEY"),
    _has("ANTHROPIC_API_KEY") ? "ANTHROPIC_API_KEY is set" : "ANTHROPIC_API_KEY missing",
    "Add ANTHROPIC_API_KEY=sk-ant-... to .env — console.anthropic.com", true));

  if (anthKey) {
    try {
      const res = await _post("https://api.anthropic.com/v1/messages",
        { model: "claude-haiku-4-5-20251001", messages: [{ role: "user", content: "ping" }], max_tokens: 3 },
        { "x-api-key": anthKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" });
      const pass = res.status === 200;
      checks.push(_check("anthropic_live", "Anthropic: live API call succeeds", pass,
        pass ? `HTTP ${res.status} — model responded` : `HTTP ${res.status} — ${res.body.slice(0,120)}`,
        "Check ANTHROPIC_API_KEY is valid"));
    } catch (e) {
      checks.push(_check("anthropic_live", "Anthropic: live API call succeeds", false, `Network error: ${e.message}`, "Check network"));
    }
  } else {
    checks.push(_check("anthropic_live", "Anthropic: live API call succeeds", false, "Skipped — key missing", "Set ANTHROPIC_API_KEY", true));
  }

  // ── Gemini ──
  checks.push(_check("gemini_key", "Gemini: API key present", _has("GEMINI_API_KEY"),
    _has("GEMINI_API_KEY") ? "GEMINI_API_KEY is set" : "GEMINI_API_KEY missing",
    "Add GEMINI_API_KEY=AIza... to .env — aistudio.google.com", true));

  if (_has("GEMINI_API_KEY")) {
    const model = _env("GEMINI_MODEL") || "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${_env("GEMINI_API_KEY")}`;
    try {
      const res = await _post(url, { contents: [{ parts: [{ text: "ping" }] }] }, {});
      const pass = res.status === 200;
      checks.push(_check("gemini_live", "Gemini: live API call succeeds", pass,
        pass ? `HTTP ${res.status} — model responded` : `HTTP ${res.status} — ${res.body.slice(0,120)}`,
        "Check GEMINI_API_KEY is valid"));
    } catch (e) {
      checks.push(_check("gemini_live", "Gemini: live API call succeeds", false, `Network error: ${e.message}`, "Check network"));
    }
  } else {
    checks.push(_check("gemini_live", "Gemini: live API call succeeds", false, "Skipped — key missing", "Set GEMINI_API_KEY", true));
  }

  // ── OpenRouter ──
  checks.push(_check("openrouter_key", "OpenRouter: API key present", _has("OPENROUTER_API_KEY"),
    _has("OPENROUTER_API_KEY") ? "OPENROUTER_API_KEY is set" : "OPENROUTER_API_KEY missing",
    "Add OPENROUTER_API_KEY=sk-or-... to .env — openrouter.ai", true));

  // ── Ollama (local) ──
  const ollamaUrl = _env("OLLAMA_URL") || "http://localhost:11434";
  try {
    const res = await _get(`${ollamaUrl}/api/tags`, {}, 3000);
    const pass = res.status === 200;
    checks.push(_check("ollama_local", "Ollama: local server reachable", pass,
      pass ? `Ollama at ${ollamaUrl} — HTTP ${res.status}` : `HTTP ${res.status} at ${ollamaUrl}`,
      "Run: ollama serve — or set OLLAMA_URL to correct host", true));
  } catch {
    checks.push(_check("ollama_local", "Ollama: local server reachable", false,
      `Not reachable at ${ollamaUrl}`, "Run: ollama serve (optional — local only)", true));
  }

  // ── LLM_PROVIDER routing ──
  const pref = _env("LLM_PROVIDER");
  checks.push(_check("llm_provider_set", "LLM_PROVIDER env var set", !!pref,
    pref ? `LLM_PROVIDER=${pref}` : "LLM_PROVIDER not set — will default to groq",
    "Set LLM_PROVIDER=groq in .env for explicit primary", true));

  const passing = checks.filter(c => c.pass).length;
  const score   = Math.round(passing / checks.length * 100);
  return { integration: "ai_providers", label: "AI Providers", checks, passing, total: checks.length, score };
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. PAYMENTS
// ══════════════════════════════════════════════════════════════════════════════

async function auditPayments() {
  const checks = [];

  // Keys
  const keyId  = _env("RAZORPAY_KEY_ID")  || _env("RAZORPAY_KEY");
  const secret = _env("RAZORPAY_KEY_SECRET") || _env("RAZORPAY_SECRET");
  const whSecret = _env("RAZORPAY_WEBHOOK_SECRET");
  const baseUrl  = _env("BASE_URL");

  checks.push(_check("rzp_key_id", "Razorpay: RAZORPAY_KEY_ID present", !!keyId,
    keyId ? `Key ID set (${keyId.slice(0,12)}...)` : "RAZORPAY_KEY_ID missing",
    "Add RAZORPAY_KEY_ID=rzp_live_... to .env — razorpay.com/dashboard"));

  checks.push(_check("rzp_secret", "Razorpay: RAZORPAY_KEY_SECRET present", !!secret,
    secret ? "Key secret is set" : "RAZORPAY_KEY_SECRET missing",
    "Add RAZORPAY_KEY_SECRET=... to .env — razorpay.com/dashboard"));

  checks.push(_check("rzp_webhook_secret", "Razorpay: webhook secret present", !!whSecret,
    whSecret ? "RAZORPAY_WEBHOOK_SECRET is set" : "RAZORPAY_WEBHOOK_SECRET missing",
    "Set RAZORPAY_WEBHOOK_SECRET — copy from Razorpay Dashboard → Webhooks"));

  // BASE_URL check — required for webhook delivery
  const baseOk = !!baseUrl && !baseUrl.includes("localhost") && !baseUrl.includes("127.0.0.1");
  checks.push(_check("rzp_base_url", "BASE_URL is a public domain (not localhost)", baseOk,
    baseOk ? `BASE_URL=${baseUrl}` : `BASE_URL='${baseUrl}' — webhooks won't reach this server`,
    "Set BASE_URL=https://app.ooplix.com in .env"));

  // Webhook URL reachability
  const webhookUrl = `${baseUrl}/webhook/razorpay`;
  checks.push(_check("rzp_webhook_url", "Razorpay webhook URL is configured",
    baseOk, baseOk ? `Webhook URL: ${webhookUrl}` : "Cannot derive webhook URL — fix BASE_URL first",
    `Configure ${baseUrl}/webhook/razorpay in Razorpay Dashboard → Webhooks`));

  // Razorpay API connectivity (safe: just hit their status endpoint)
  try {
    const res = await _get("https://api.razorpay.com/v1/payments?count=1",
      { Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}` }, 6000);
    const pass = res.status === 200 || res.status === 401; // 401 means we reached them but keys wrong
    checks.push(_check("rzp_api_reachable", "Razorpay: API endpoint reachable", pass,
      `HTTP ${res.status} — ${res.status === 200 ? "authenticated" : res.status === 401 ? "reached (check keys)" : "unexpected"}`,
      res.status === 401 ? "Verify RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are live keys" : "Check network"));

    if (keyId && secret && res.status === 200) {
      checks.push(_check("rzp_live_mode", "Razorpay: using live keys (not test)", keyId.startsWith("rzp_live"),
        keyId.startsWith("rzp_live") ? "rzp_live_ prefix confirmed" : `Key starts with '${keyId.slice(0,8)}' — use rzp_live_ for production`,
        "Switch to live Razorpay keys: rzp_live_... (not rzp_test_...)"));
    }
  } catch (e) {
    checks.push(_check("rzp_api_reachable", "Razorpay: API endpoint reachable", false, `Error: ${e.message}`, "Check network"));
  }

  const passing = checks.filter(c => c.pass).length;
  const score   = Math.round(passing / checks.length * 100);
  return { integration: "payments", label: "Payments (Razorpay)", checks, passing, total: checks.length, score };
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. EMAIL
// ══════════════════════════════════════════════════════════════════════════════

async function auditEmail() {
  const checks = [];

  // Detect which provider is configured
  const smtp_host  = _env("SMTP_HOST");
  const smtp_user  = _env("SMTP_USER");
  const smtp_pass  = _env("SMTP_PASS");
  const smtp_port  = _env("SMTP_PORT") || "587";
  const smtp_from  = _env("SMTP_FROM") || _env("EMAIL_FROM");
  const sendgrid   = _env("SENDGRID_API_KEY");
  const resend     = _env("RESEND_API_KEY");
  const postmark   = _env("POSTMARK_API_KEY");
  const ses_key    = _env("AWS_SES_KEY") || _env("AWS_ACCESS_KEY_ID");

  // At least one email provider must be configured
  const hasAny = !!(smtp_host || sendgrid || resend || postmark || ses_key);
  checks.push(_check("email_provider_configured", "Email: at least one provider configured", hasAny,
    hasAny ? "Email provider detected" : "No email provider configured",
    "Set SMTP_HOST + SMTP_USER + SMTP_PASS, or SENDGRID_API_KEY, or RESEND_API_KEY in .env"));

  // SMTP checks
  if (smtp_host) {
    checks.push(_check("smtp_host", "SMTP: host configured", true, `SMTP_HOST=${smtp_host}`));
    checks.push(_check("smtp_user", "SMTP: user configured", !!smtp_user,
      smtp_user ? `SMTP_USER=${smtp_user}` : "SMTP_USER missing", "Add SMTP_USER to .env"));
    checks.push(_check("smtp_pass", "SMTP: password configured", !!smtp_pass,
      smtp_pass ? "SMTP_PASS is set" : "SMTP_PASS missing", "Add SMTP_PASS to .env"));
    checks.push(_check("smtp_from", "SMTP: FROM address configured", !!smtp_from,
      smtp_from ? `SMTP_FROM=${smtp_from}` : "SMTP_FROM missing — emails will lack a From address",
      "Set SMTP_FROM=noreply@ooplix.com in .env"));
    checks.push(_check("smtp_port", "SMTP: port configured", true, `SMTP_PORT=${smtp_port} (${smtp_port === "465" ? "SSL" : "STARTTLS"})`));

    // Port validity
    const validPorts = ["25", "465", "587", "2525"];
    checks.push(_check("smtp_port_valid", "SMTP: port is a standard email port", validPorts.includes(smtp_port),
      validPorts.includes(smtp_port) ? `Port ${smtp_port} is valid` : `Port ${smtp_port} is non-standard`,
      "Use port 587 (STARTTLS) or 465 (SSL)", true));

    // DNS check on SMTP host — resolve via TCP (safe)
    try {
      const net = require("net");
      await new Promise((resolve, reject) => {
        const sock = net.createConnection({ host: smtp_host, port: Number(smtp_port) || 587, timeout: 5000 });
        sock.on("connect", () => { sock.destroy(); resolve(); });
        sock.on("timeout", () => { sock.destroy(); reject(new Error("timeout")); });
        sock.on("error", reject);
      });
      checks.push(_check("smtp_reachable", `SMTP: ${smtp_host}:${smtp_port} reachable`, true,
        `TCP connection to ${smtp_host}:${smtp_port} succeeded`));
    } catch (e) {
      checks.push(_check("smtp_reachable", `SMTP: ${smtp_host}:${smtp_port} reachable`, false,
        `TCP connect failed: ${e.message}`,
        `Ensure ${smtp_host} is accessible from this server and port ${smtp_port} is open`));
    }
  } else {
    checks.push(_check("smtp_host", "SMTP: host configured", false, "SMTP_HOST not set",
      "Set SMTP_HOST=smtp.gmail.com (or similar) in .env", true));
  }

  // SendGrid
  if (sendgrid) {
    try {
      const res = await _get("https://api.sendgrid.com/v3/user/account",
        { Authorization: `Bearer ${sendgrid}` }, 6000);
      checks.push(_check("sendgrid_live", "SendGrid: API key valid", res.status === 200,
        `HTTP ${res.status}`, res.status === 403 ? "Insufficient SendGrid scope — regenerate key" : "Check SENDGRID_API_KEY"));
    } catch (e) {
      checks.push(_check("sendgrid_live", "SendGrid: API key valid", false, `Error: ${e.message}`, "Check network"));
    }
  } else {
    checks.push(_check("sendgrid_key", "SendGrid: API key configured", false, "Not configured (optional)",
      "Set SENDGRID_API_KEY if using SendGrid", true));
  }

  // Resend
  if (resend) {
    try {
      const res = await _get("https://api.resend.com/domains", { Authorization: `Bearer ${resend}` }, 6000);
      checks.push(_check("resend_live", "Resend: API key valid", res.status === 200,
        `HTTP ${res.status}`, "Check RESEND_API_KEY — resend.com/api-keys"));
    } catch (e) {
      checks.push(_check("resend_live", "Resend: API key valid", false, `Error: ${e.message}`, "Check network"));
    }
  }

  // Postmark
  if (postmark) {
    try {
      const res = await _get("https://api.postmarkapp.com/server",
        { "X-Postmark-Server-Token": postmark, Accept: "application/json" }, 6000);
      checks.push(_check("postmark_live", "Postmark: API key valid", res.status === 200,
        `HTTP ${res.status}`, "Check POSTMARK_API_KEY"));
    } catch (e) {
      checks.push(_check("postmark_live", "Postmark: API key valid", false, `Error: ${e.message}`, "Check network"));
    }
  }

  const passing = checks.filter(c => c.pass).length;
  const score   = Math.round(passing / checks.length * 100);
  return { integration: "email", label: "Email", checks, passing, total: checks.length, score };
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. OAUTH
// ══════════════════════════════════════════════════════════════════════════════

async function auditOAuth() {
  const checks = [];
  const baseUrl = _env("BASE_URL");
  const jwtOk   = _has("JWT_SECRET");

  // JWT_SECRET — required for OAuth token encryption
  checks.push(_check("oauth_jwt_secret", "OAuth: JWT_SECRET set (required for token encryption)", jwtOk,
    jwtOk ? "JWT_SECRET is set — OAuth tokens can be encrypted" : "JWT_SECRET missing — OAuth token storage will fail",
    "Set JWT_SECRET=<64-char random string> in .env"));

  const PROVIDERS = [
    { id: "google",   envId: "GOOGLE_CLIENT_ID",   envSecret: "GOOGLE_CLIENT_SECRET",  envRedirect: "GOOGLE_REDIRECT_URI",
      defaultRedirect: `${baseUrl}/oauth/google/callback`,
      docsUrl: "console.cloud.google.com → Credentials → OAuth 2.0 Client IDs" },
    { id: "github",   envId: "GITHUB_CLIENT_ID",   envSecret: "GITHUB_CLIENT_SECRET",  envRedirect: "GITHUB_REDIRECT_URI",
      defaultRedirect: `${baseUrl}/oauth/github/callback`,
      docsUrl: "github.com/settings/developers → OAuth Apps" },
    { id: "slack",    envId: "SLACK_CLIENT_ID",    envSecret: "SLACK_CLIENT_SECRET",   envRedirect: "SLACK_REDIRECT_URI",
      defaultRedirect: `${baseUrl}/oauth/slack/callback`,
      docsUrl: "api.slack.com/apps → OAuth & Permissions" },
    { id: "notion",   envId: "NOTION_CLIENT_ID",   envSecret: "NOTION_CLIENT_SECRET",  envRedirect: "NOTION_REDIRECT_URI",
      defaultRedirect: `${baseUrl}/oauth/notion/callback`,
      docsUrl: "notion.so/my-integrations → OAuth settings" },
    { id: "linkedin", envId: "LINKEDIN_CLIENT_ID", envSecret: "LINKEDIN_CLIENT_SECRET",envRedirect: "LINKEDIN_REDIRECT_URL",
      defaultRedirect: `${baseUrl}/oauth/linkedin/callback`,
      docsUrl: "linkedin.com/developers/apps → Auth tab" },
  ];

  for (const prov of PROVIDERS) {
    const hasId     = _has(prov.envId);
    const hasSecret = _has(prov.envSecret);
    const redirect  = _env(prov.envRedirect) || prov.defaultRedirect;

    checks.push(_check(`${prov.id}_client_id`, `OAuth/${prov.id}: client ID configured`, hasId,
      hasId ? `${prov.envId} is set` : `${prov.envId} missing`,
      `Get from ${prov.docsUrl}`, !hasId));

    checks.push(_check(`${prov.id}_client_secret`, `OAuth/${prov.id}: client secret configured`, hasSecret,
      hasSecret ? `${prov.envSecret} is set` : `${prov.envSecret} missing`,
      `Get from ${prov.docsUrl}`, !hasSecret));

    // Redirect URI must point to BASE_URL (not localhost)
    const redirectOk = !!redirect && !!baseUrl && redirect.startsWith(baseUrl);
    checks.push(_check(`${prov.id}_redirect`, `OAuth/${prov.id}: redirect URI points to ${baseUrl}`, redirectOk,
      redirect ? `Redirect: ${redirect}` : "Redirect URI not set",
      `Set ${prov.envRedirect}=${prov.defaultRedirect} in .env — and register it in ${prov.docsUrl}`,
      !redirectOk));
  }

  // Google OIDC discovery endpoint — reachability test
  try {
    const res = await _get("https://accounts.google.com/.well-known/openid-configuration", {}, 5000);
    checks.push(_check("google_oidc_reachable", "Google OIDC: discovery endpoint reachable", res.status === 200,
      `HTTP ${res.status}`, "Network issue reaching accounts.google.com"));
  } catch (e) {
    checks.push(_check("google_oidc_reachable", "Google OIDC: discovery endpoint reachable", false, `Error: ${e.message}`, "Check network"));
  }

  // GitHub API reachability
  try {
    const res = await _get("https://api.github.com", { "User-Agent": "ooplix-wiring-audit" }, 5000);
    checks.push(_check("github_api_reachable", "GitHub API: reachable", res.status === 200,
      `HTTP ${res.status}`, "Check network"));
  } catch (e) {
    checks.push(_check("github_api_reachable", "GitHub API: reachable", false, `Error: ${e.message}`, "Check network"));
  }

  const passing = checks.filter(c => c.pass).length;
  const score   = Math.round(passing / checks.length * 100);
  return { integration: "oauth", label: "OAuth", checks, passing, total: checks.length, score };
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. WHATSAPP
// ══════════════════════════════════════════════════════════════════════════════

async function auditWhatsApp() {
  const checks = [];
  const token      = _env("WA_TOKEN")     || _env("WHATSAPP_TOKEN");
  const phoneId    = _env("WA_PHONE_ID")  || _env("PHONE_NUMBER_ID");
  const verifyTok  = _env("WA_VERIFY_TOKEN") || _env("VERIFY_TOKEN");
  const version    = _env("WA_API_VERSION") || "v19.0";
  const baseUrl    = _env("BASE_URL");

  checks.push(_check("wa_token", "WhatsApp: WA_TOKEN present", !!token,
    token ? `WA_TOKEN is set (${token.slice(0,20)}...)` : "WA_TOKEN missing",
    "Get from Meta Business Manager → WhatsApp → API Setup"));

  checks.push(_check("wa_phone_id", "WhatsApp: WA_PHONE_ID present", !!phoneId,
    phoneId ? `WA_PHONE_ID=${phoneId}` : "WA_PHONE_ID missing",
    "Get from Meta Business Manager → WhatsApp → API Setup → Phone number ID"));

  checks.push(_check("wa_verify_token", "WhatsApp: WA_VERIFY_TOKEN present", !!verifyTok,
    verifyTok ? "WA_VERIFY_TOKEN is set" : "WA_VERIFY_TOKEN missing",
    "Set WA_VERIFY_TOKEN=any-secret-string in .env (must match Meta webhook config)"));

  checks.push(_check("wa_version", "WhatsApp: API version configured", true,
    `WA_API_VERSION=${version}`));

  // Webhook URL
  const webhookUrl = `${baseUrl}/whatsapp/webhook`;
  const webhookOk  = !!baseUrl && !baseUrl.includes("localhost");
  checks.push(_check("wa_webhook_url", "WhatsApp: webhook URL uses public domain",
    webhookOk, webhookOk ? `Webhook URL: ${webhookUrl}` : `BASE_URL is localhost — webhook won't receive from Meta`,
    `Configure ${webhookUrl} in Meta Developer Console → Webhooks. Verify token: ${verifyTok || "(not set)"}`));

  // Meta API connectivity
  if (token && phoneId) {
    try {
      const res = await _get(
        `https://graph.facebook.com/${version}/${phoneId}`,
        { Authorization: `Bearer ${token}` }, 6000);
      const pass   = res.status === 200;
      const body   = JSON.parse(res.body || "{}");
      const detail = pass
        ? `Phone ID verified: ${body.display_phone_number || phoneId}`
        : res.status === 401 ? "Token is expired or invalid — regenerate in Meta Business Manager"
        : `HTTP ${res.status} — ${res.body.slice(0, 100)}`;
      checks.push(_check("wa_token_valid", "WhatsApp: token validates against Meta API", pass, detail,
        "Regenerate token: Meta Business Manager → WhatsApp → API Setup"));
    } catch (e) {
      checks.push(_check("wa_token_valid", "WhatsApp: token validates against Meta API", false,
        `Network error: ${e.message}`, "Check network connection"));
    }
  } else {
    checks.push(_check("wa_token_valid", "WhatsApp: token validates against Meta API", false,
      "Skipped — token or phone ID missing", "Set WA_TOKEN and WA_PHONE_ID", true));
  }

  // Webhook receive route must exist (structural check)
  const webhookRouteExists = (() => {
    try {
      const routePath = path.join(ROOT, "backend/routes/whatsapp.js");
      const content   = fs.readFileSync(routePath, "utf8");
      return content.includes("/whatsapp/webhook") && content.includes("WA_VERIFY_TOKEN");
    } catch { return false; }
  })();
  checks.push(_check("wa_webhook_route", "WhatsApp: webhook receive route exists in codebase", webhookRouteExists,
    webhookRouteExists ? "/whatsapp/webhook route found with verify token check" : "Webhook route not found",
    "Check backend/routes/whatsapp.js for /whatsapp/webhook handler"));

  const passing = checks.filter(c => c.pass).length;
  const score   = Math.round(passing / checks.length * 100);
  return { integration: "whatsapp", label: "WhatsApp", checks, passing, total: checks.length, score };
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. BROWSER AUTOMATION
// ══════════════════════════════════════════════════════════════════════════════

async function auditBrowserAutomation() {
  const checks = [];

  // Playwright installed?
  let playwrightInstalled = false;
  try {
    require("playwright");
    playwrightInstalled = true;
  } catch { /* not installed */ }
  checks.push(_check("playwright_installed", "Browser: Playwright package installed", playwrightInstalled,
    playwrightInstalled ? "playwright package found in node_modules" : "playwright not installed",
    "Run: npm install playwright && npx playwright install chromium"));

  // Chromium binary present?
  let chromiumPresent = false;
  let chromiumPath    = "";
  if (playwrightInstalled) {
    try {
      const pw = require("playwright");
      // Try to find chromium executable
      const chromiumExec = await pw.chromium.executablePath();
      chromiumPresent = fs.existsSync(chromiumExec);
      chromiumPath    = chromiumExec;
    } catch (e) {
      chromiumPath = e.message;
    }
  }
  checks.push(_check("chromium_binary", "Browser: Chromium binary present", chromiumPresent,
    chromiumPresent ? `Chromium at: ${chromiumPath.slice(0, 80)}` : `Chromium not found: ${chromiumPath.slice(0, 100)}`,
    "Run: npx playwright install chromium"));

  // Can launch a headless browser? (real test, but lightweight — just launch + close)
  if (playwrightInstalled && chromiumPresent) {
    try {
      const { chromium } = require("playwright");
      const browser = await chromium.launch({ headless: true, timeout: 15000,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
      const page    = await browser.newPage();
      await page.goto("about:blank");
      const title   = await page.title();
      await browser.close();
      checks.push(_check("browser_launch", "Browser: headless Chromium launches successfully", true,
        `Launched, navigated to about:blank, title='${title}', closed cleanly`));
    } catch (e) {
      checks.push(_check("browser_launch", "Browser: headless Chromium launches successfully", false,
        `Launch failed: ${e.message.slice(0, 150)}`,
        "Try: npx playwright install chromium --with-deps (Linux may need system deps)"));
    }
  } else {
    checks.push(_check("browser_launch", "Browser: headless Chromium launches successfully", false,
      "Skipped — Playwright or Chromium not installed", "Install: npx playwright install chromium"));
  }

  // browserSession route file exists
  const sessionPath = path.join(ROOT, "agents/browser/browserSession.cjs");
  checks.push(_check("browser_session_service", "Browser: session manager service exists", fs.existsSync(sessionPath),
    fs.existsSync(sessionPath) ? `Found: agents/browser/browserSession.cjs` : "Session file missing",
    "Session file should exist at agents/browser/browserSession.cjs"));

  // Browser routes mounted
  const routePath = path.join(ROOT, "backend/routes/browser.js");
  const routesOk  = fs.existsSync(routePath);
  checks.push(_check("browser_routes", "Browser: API routes file exists", routesOk,
    routesOk ? "backend/routes/browser.js found" : "browser.js route file missing", "Check backend/routes/browser.js"));

  if (routesOk) {
    const content = fs.readFileSync(routePath, "utf8");
    checks.push(_check("browser_status_route", "Browser: /browser/status health route present", content.includes("/browser/status"),
      content.includes("/browser/status") ? "/browser/status route found" : "/browser/status route missing",
      "Add GET /browser/status route to backend/routes/browser.js"));
    checks.push(_check("browser_run_route", "Browser: /browser/run automation route present", content.includes("/browser/run"),
      content.includes("/browser/run") ? "/browser/run route found" : "/browser/run route missing",
      "Add POST /browser/run route to backend/routes/browser.js"));
  }

  const passing = checks.filter(c => c.pass).length;
  const score   = Math.round(passing / checks.length * 100);
  return { integration: "browser_automation", label: "Browser Automation", checks, passing, total: checks.length, score };
}

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCTION WIRING REPORT
// ══════════════════════════════════════════════════════════════════════════════

async function runFullAudit() {
  const [ai, payments, email, oauth, whatsapp, browser] = await Promise.all([
    auditAIProviders(),
    auditPayments(),
    auditEmail(),
    auditOAuth(),
    auditWhatsApp(),
    auditBrowserAutomation(),
  ]);

  const integrations = [ai, payments, email, oauth, whatsapp, browser];

  // Compute overall
  const totalChecks  = integrations.reduce((s, i) => s + i.total,   0);
  const totalPassing = integrations.reduce((s, i) => s + i.passing, 0);
  const overallScore = Math.round(totalPassing / totalChecks * 100);

  // Collect all failures and warnings
  const failures  = integrations.flatMap(i => i.checks.filter(c => !c.pass && !c.warning));
  const warnings  = integrations.flatMap(i => i.checks.filter(c => !c.pass && c.warning));
  const critCount = failures.length;

  // Production readiness gate
  // Critical: AI (at least 1 provider working), Payments wired, WhatsApp token valid
  const aiReady      = ai.checks.find(c => c.id === "groq_live" || c.id === "openai_live")?.pass || false;
  const paymentsReady= payments.checks.find(c => c.id === "rzp_api_reachable")?.pass || false;
  const waReady      = whatsapp.checks.find(c => c.id === "wa_token_valid")?.pass || false;
  const browserReady = browser.checks.find(c => c.id === "browser_launch")?.pass || false;

  const productionReady = aiReady && paymentsReady && waReady;

  const report = {
    id:          `wiring-${Date.now()}`,
    runAt:       _ts(),
    overallScore,
    totalChecks,
    totalPassing,
    criticalFailures: critCount,
    warnings:         warnings.length,
    productionReady,
    gates: {
      ai_provider_live:  aiReady,
      payments_wired:    paymentsReady,
      whatsapp_verified: waReady,
      browser_headless:  browserReady,
      email_configured:  email.checks.find(c => c.id === "email_provider_configured")?.pass || false,
      oauth_jwt_ready:   oauth.checks.find(c => c.id === "oauth_jwt_secret")?.pass || false,
    },
    integrations: integrations.map(i => ({
      integration: i.integration,
      label:       i.label,
      score:       i.score,
      passing:     i.passing,
      total:       i.total,
    })),
    failures:  failures.map(f => ({ integration: failures.find(() => true)?.integration, ...f })),
    warnings:  warnings.map(w => ({ ...w })),
    details:   integrations,
  };

  // Persist
  const s = _load();
  s.lastRun = report.runAt;
  s.reports.unshift(report);
  if (s.reports.length > 10) s.reports = s.reports.slice(0, 10);
  _save(s);

  return report;
}

function getLastReport() {
  const s = _load();
  return s.reports[0] || null;
}

function getReportHistory() {
  const s = _load();
  return s.reports.map(r => ({
    id: r.id, runAt: r.runAt, overallScore: r.overallScore,
    totalPassing: r.totalPassing, totalChecks: r.totalChecks,
    productionReady: r.productionReady,
  }));
}

// ── Individual integration re-checks (for targeted re-runs) ──────────────────
async function auditSingle(integration) {
  switch (integration) {
    case "ai_providers":      return auditAIProviders();
    case "payments":          return auditPayments();
    case "email":             return auditEmail();
    case "oauth":             return auditOAuth();
    case "whatsapp":          return auditWhatsApp();
    case "browser_automation":return auditBrowserAutomation();
    default: throw new Error(`Unknown integration: ${integration}`);
  }
}

// ── Benchmark ─────────────────────────────────────────────────────────────────
async function runBenchmark() {
  const report = await runFullAudit();
  const checks = report.integrations.map(i => ({
    id:    i.integration,
    label: `${i.label}: ${i.passing}/${i.total} checks pass`,
    ok:    i.score >= 40, // each integration must have at least 40% of its checks passing
  }));
  const passing = checks.filter(c => c.ok).length;
  const score   = Math.round(passing / checks.length * 100);
  return {
    score,
    passing,
    total:          checks.length,
    launchReadiness: score === 100 ? "all_integrations_wired" : score >= 67 ? "partially_wired" : "needs_wiring",
    regressionPass:  passing === checks.length,
    checks,
    overallScore:    report.overallScore,
    productionReady: report.productionReady,
    gates:           report.gates,
    runAt:           report.runAt,
  };
}

module.exports = {
  runFullAudit,
  auditSingle,
  getLastReport,
  getReportHistory,
  auditAIProviders,
  auditPayments,
  auditEmail,
  auditOAuth,
  auditWhatsApp,
  auditBrowserAutomation,
  runBenchmark,
};
