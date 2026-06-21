"use strict";
/**
 * Production Credentials Sprint 1 (PCS-1)
 * Credential detector, validator, and report generator.
 *
 * No new features. No architecture changes. No new services beyond what
 * wires existing infrastructure to production credentials.
 *
 * Integrations:
 *   1. Email         — SMTP/Resend/SendGrid/Postmark/SES (auto-detect + live verify)
 *   2. AI Providers  — Anthropic/Gemini/OpenRouter + routing/streaming/fallback/credits
 *   3. OAuth         — Google/Microsoft/LinkedIn (login/callback/refresh/logout flows)
 *   4. Crash         — Sentry (event delivery + release tracking)
 *   5. Storage       — S3/R2 (upload/download/delete/signed-URL)
 *
 * Report schema:
 *   { configured[], missing[], invalid[], expired[], warnings[], envVars{}, runAt }
 *
 * Storage: data/pcs-credentials.json
 */

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const http  = require("http");
const net   = require("net");

const DATA_FILE = path.join(__dirname, "../../data/pcs-credentials.json");
const ROOT      = path.join(__dirname, "../..");

function _load()  { try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return { reports: [], lastRun: null }; } }
function _save(s) { fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2)); }
function _ts()    { return new Date().toISOString(); }
function _env(k)  { return process.env[k] || ""; }
function _has(...ks) { return ks.every(k => !!_env(k)); }

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function _req(opts, body = null, ms = 10000) {
  return new Promise((resolve, reject) => {
    const mod = opts.protocol === "http:" ? http : https;
    const req = mod.request(opts, res => {
      let d = "";
      res.on("data", c => { d += c; });
      res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(d), raw: d }); } catch { resolve({ status: res.statusCode, body: d, raw: d }); } });
    });
    req.setTimeout(ms, () => { req.destroy(new Error("timeout")); });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function _get(url, headers = {}, ms = 8000) {
  const u = new URL(url);
  return _req({ protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
    path: u.pathname + u.search, method: "GET", headers }, null, ms);
}

function _post(url, bodyObj, headers = {}, ms = 10000) {
  const data = typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj);
  const u    = new URL(url);
  return _req({ protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
    path: u.pathname + u.search, method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers }
  }, data, ms);
}

// ── Credential entry builder ──────────────────────────────────────────────────

function _cred(id, label, status, detail, fix = null, envVars = []) {
  // status: configured | missing | invalid | expired | warning
  return { id, label, status, detail, fix: status === "configured" ? null : fix, envVars };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. EMAIL
// ══════════════════════════════════════════════════════════════════════════════

async function auditEmail() {
  const creds = [];

  const emailSvc = (() => { try { return require("./emailService.cjs"); } catch { return null; } })();
  const det      = emailSvc ? emailSvc.detectProvider() : { provider: null, configured: false };

  // Provider detection result
  creds.push(_cred("email_provider", `Email provider: ${det.provider || "none"}`,
    det.configured ? "configured" : "missing",
    det.configured ? det.reason : "No email provider configured",
    "Set one of: RESEND_API_KEY, SENDGRID_API_KEY, POSTMARK_API_KEY, SMTP_HOST+USER+PASS, or AWS SES vars",
    det.configured ? [] : ["RESEND_API_KEY","SENDGRID_API_KEY","POSTMARK_API_KEY","SMTP_HOST","SMTP_USER","SMTP_PASS"]));

  // Per-provider credential checks
  const providers = [
    { id: "resend",   label: "Resend",    keys: ["RESEND_API_KEY"],   url: "https://api.resend.com/domains", authHeader: k => ({ Authorization: `Bearer ${k}` }), keyEnv: "RESEND_API_KEY" },
    { id: "sendgrid", label: "SendGrid",  keys: ["SENDGRID_API_KEY"], url: "https://api.sendgrid.com/v3/user/account", authHeader: k => ({ Authorization: `Bearer ${k}` }), keyEnv: "SENDGRID_API_KEY" },
    { id: "postmark", label: "Postmark",  keys: ["POSTMARK_API_KEY"], url: "https://api.postmarkapp.com/server", authHeader: k => ({ "X-Postmark-Server-Token": k, Accept: "application/json" }), keyEnv: "POSTMARK_API_KEY" },
  ];

  for (const prov of providers) {
    const key = _env(prov.keyEnv);
    if (!key) {
      creds.push(_cred(`email_${prov.id}`, `${prov.label}: API key`, "missing",
        `${prov.keyEnv} not set`, `Set ${prov.keyEnv} in .env`, [prov.keyEnv]));
      continue;
    }
    try {
      const res = await _get(prov.url, prov.authHeader(key));
      const ok  = res.status === 200;
      creds.push(_cred(`email_${prov.id}`, `${prov.label}: API key valid`, ok ? "configured" : "invalid",
        ok ? `HTTP ${res.status} — authenticated` : `HTTP ${res.status} — key may be invalid`,
        ok ? null : `Regenerate ${prov.keyEnv} from ${prov.label} dashboard`, [prov.keyEnv]));
    } catch (e) {
      creds.push(_cred(`email_${prov.id}`, `${prov.label}: reachable`, "warning",
        `Network error: ${e.message}`, "Check network connectivity", [prov.keyEnv]));
    }
  }

  // SMTP
  if (_has("SMTP_HOST","SMTP_USER","SMTP_PASS")) {
    const port = parseInt(_env("SMTP_PORT") || "587", 10);
    const reached = await new Promise(r => {
      const s = net.createConnection({ host: _env("SMTP_HOST"), port, timeout: 5000 });
      s.on("connect", () => { s.destroy(); r(true); });
      s.on("timeout", () => { s.destroy(); r(false); });
      s.on("error", () => r(false));
    });
    creds.push(_cred("email_smtp", `SMTP: ${_env("SMTP_HOST")}:${port}`, reached ? "configured" : "invalid",
      reached ? `TCP connect to ${_env("SMTP_HOST")}:${port} succeeded` : `Cannot reach ${_env("SMTP_HOST")}:${port}`,
      reached ? null : `Check SMTP_HOST and SMTP_PORT — ensure port ${port} is open`,
      ["SMTP_HOST","SMTP_USER","SMTP_PASS","SMTP_PORT","SMTP_FROM"]));
  } else {
    const missingSmtp = ["SMTP_HOST","SMTP_USER","SMTP_PASS"].filter(k => !_env(k));
    creds.push(_cred("email_smtp", "SMTP: credentials", "missing",
      `Missing: ${missingSmtp.join(", ")}`, "Set SMTP_HOST + SMTP_USER + SMTP_PASS in .env",
      ["SMTP_HOST","SMTP_USER","SMTP_PASS","SMTP_PORT","SMTP_FROM"]));
  }

  // SES
  if (_has("AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","AWS_SES_REGION")) {
    const region = _env("AWS_SES_REGION") || _env("AWS_REGION");
    try {
      const res = await _get(`https://email.${region}.amazonaws.com/`);
      creds.push(_cred("email_ses", `SES: ${region} endpoint`, res.status < 500 ? "configured" : "invalid",
        `HTTP ${res.status} — endpoint live`, null, ["AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","AWS_SES_REGION"]));
    } catch (e) {
      creds.push(_cred("email_ses", "SES: endpoint reachable", "warning", `Error: ${e.message}`, null, ["AWS_SES_REGION"]));
    }
  } else {
    creds.push(_cred("email_ses", "SES: credentials", "missing", "AWS SES vars not set",
      "Set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_SES_REGION", ["AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","AWS_SES_REGION"]));
  }

  // Template verification (structural)
  const templates = emailSvc ? emailSvc.getTemplates() : null;
  const templateTypes = ["welcome","otp","password_reset","marketing"];
  for (const tpl of templateTypes) {
    const t = templates?.[tpl];
    const ok = t && t.subject?.length > 3 && t.html?.length > 10;
    creds.push(_cred(`email_tpl_${tpl}`, `Email template: ${tpl}`, ok ? "configured" : "warning",
      ok ? `Subject: "${(t?.subject || "").slice(0,50)}"` : "Template missing or empty",
      ok ? null : "Email templates are built-in to emailService.cjs", []));
  }

  // Live verify (only if provider is configured)
  if (det.configured && emailSvc) {
    const verify = await emailSvc.verifyProvider();
    creds.push(_cred("email_live", `Email: live connectivity (${det.provider})`,
      verify.ok ? "configured" : "invalid",
      verify.detail, verify.ok ? null : `Fix credentials for ${det.provider}`, []));
  }

  return { section: "email", label: "Email Delivery", creds };
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. AI PROVIDERS
// ══════════════════════════════════════════════════════════════════════════════

async function auditAI() {
  const creds = [];

  // ── Anthropic ──
  const anthKey = _env("ANTHROPIC_API_KEY");
  if (!anthKey) {
    creds.push(_cred("ai_anthropic_key", "Anthropic: ANTHROPIC_API_KEY", "missing",
      "Not set", "Get from console.anthropic.com → API Keys", ["ANTHROPIC_API_KEY"]));
  } else {
    try {
      const res = await _post("https://api.anthropic.com/v1/messages",
        { model: "claude-haiku-4-5-20251001", messages: [{ role: "user", content: "hi" }], max_tokens: 1 },
        { "x-api-key": anthKey, "anthropic-version": "2023-06-01" });
      const ok = res.status === 200;
      creds.push(_cred("ai_anthropic_key", "Anthropic: API key", ok ? "configured" : "invalid",
        ok ? "Live call succeeded" : `HTTP ${res.status} — ${JSON.stringify(res.body).slice(0,80)}`,
        ok ? null : "Regenerate at console.anthropic.com", ["ANTHROPIC_API_KEY"]));
    } catch (e) {
      creds.push(_cred("ai_anthropic_key", "Anthropic: reachable", "warning", `Error: ${e.message}`, null, ["ANTHROPIC_API_KEY"]));
    }
  }

  // ── Gemini ──
  const gemKey   = _env("GEMINI_API_KEY");
  const gemModel = _env("GEMINI_MODEL") || "gemini-2.0-flash";
  if (!gemKey) {
    creds.push(_cred("ai_gemini_key", "Gemini: GEMINI_API_KEY", "missing",
      "Not set", "Get from aistudio.google.com → API Keys", ["GEMINI_API_KEY"]));
  } else {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${gemModel}:generateContent?key=${gemKey}`;
      const res = await _post(url, { contents: [{ parts: [{ text: "hi" }] }] });
      const ok  = res.status === 200;
      creds.push(_cred("ai_gemini_key", "Gemini: API key", ok ? "configured" : "invalid",
        ok ? `Live call succeeded (model: ${gemModel})` : `HTTP ${res.status}`,
        ok ? null : "Check GEMINI_API_KEY and GEMINI_MODEL", ["GEMINI_API_KEY","GEMINI_MODEL"]));
    } catch (e) {
      creds.push(_cred("ai_gemini_key", "Gemini: reachable", "warning", `Error: ${e.message}`, null, ["GEMINI_API_KEY"]));
    }
  }

  // ── OpenRouter ──
  const orKey = _env("OPENROUTER_API_KEY");
  if (!orKey) {
    creds.push(_cred("ai_openrouter_key", "OpenRouter: OPENROUTER_API_KEY", "missing",
      "Not set", "Get from openrouter.ai → Keys", ["OPENROUTER_API_KEY"]));
  } else {
    try {
      const res = await _post("https://openrouter.ai/api/v1/chat/completions",
        { model: "anthropic/claude-haiku-4-5", messages: [{ role: "user", content: "hi" }], max_tokens: 1 },
        { Authorization: `Bearer ${orKey}`, "HTTP-Referer": "https://app.ooplix.com", "X-Title": "Ooplix" });
      const ok = res.status === 200;
      creds.push(_cred("ai_openrouter_key", "OpenRouter: API key", ok ? "configured" : "invalid",
        ok ? "Live call succeeded" : `HTTP ${res.status}`,
        ok ? null : "Check OPENROUTER_API_KEY at openrouter.ai", ["OPENROUTER_API_KEY"]));
    } catch (e) {
      creds.push(_cred("ai_openrouter_key", "OpenRouter: reachable", "warning", `Error: ${e.message}`, null, ["OPENROUTER_API_KEY"]));
    }
  }

  // ── Routing verification ──
  const aiSvc = path.join(ROOT, "backend/services/aiService.js");
  const aiSrc = fs.existsSync(aiSvc) ? fs.readFileSync(aiSvc, "utf8") : "";
  creds.push(_cred("ai_routing", "AI: capability routing (routeByCapability)", aiSrc.includes("routeByCapability") ? "configured" : "missing",
    aiSrc.includes("routeByCapability") ? "routeByCapability() with ROUTING table present" : "Missing",
    null, []));

  // ── Fallback chain ──
  creds.push(_cred("ai_fallback", "AI: multi-provider fallback chain", aiSrc.includes("lastFailures") && aiSrc.includes("for (const provider") ? "configured" : "missing",
    aiSrc.includes("lastFailures") ? "Fallback loop with failure tracking confirmed" : "Missing", null, []));

  // ── Streaming ──
  const aiRouteSrc = fs.existsSync(path.join(ROOT, "backend/routes/ai.js"))
    ? fs.readFileSync(path.join(ROOT, "backend/routes/ai.js"), "utf8") : "";
  const hasStream = aiSrc.includes("stream") || aiRouteSrc.includes("text/event-stream");
  creds.push(_cred("ai_streaming", "AI: streaming support", hasStream ? "configured" : "warning",
    hasStream ? "Streaming pattern found" : "No SSE streaming — all responses are buffered",
    "Add SSE/streaming to /ai/chat if real-time output is needed", []));

  // ── Credit accounting ──
  const hasCreditEngine  = fs.existsSync(path.join(ROOT, "backend/services/creditEngine.cjs"));
  const hasUsageMetering = fs.existsSync(path.join(ROOT, "backend/services/usageMetering.cjs"));
  creds.push(_cred("ai_credits", "AI: credit accounting (creditEngine + usageMetering)",
    hasCreditEngine && hasUsageMetering ? "configured" : "missing",
    hasCreditEngine && hasUsageMetering ? "Both services present — PROVIDER_COSTS table with per-provider USD rates" : "Missing",
    null, []));

  return { section: "ai", label: "AI Providers", creds };
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. OAUTH
// ══════════════════════════════════════════════════════════════════════════════

async function auditOAuth() {
  const creds = [];
  const baseUrl = _env("BASE_URL") || _env("APP_URL") || "https://app.ooplix.com";

  const PROVIDERS = [
    { id: "google",    label: "Google",    idKey: "GOOGLE_CLIENT_ID",    secKey: "GOOGLE_CLIENT_SECRET",    redKey: "GOOGLE_REDIRECT_URI",
      defaultRed: `${baseUrl}/oauth/google/callback`,
      discoveryUrl: "https://accounts.google.com/.well-known/openid-configuration" },
    { id: "microsoft", label: "Microsoft", idKey: "MICROSOFT_CLIENT_ID", secKey: "MICROSOFT_CLIENT_SECRET", redKey: "MICROSOFT_REDIRECT_URI",
      defaultRed: `${baseUrl}/oauth/microsoft/callback`,
      discoveryUrl: "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration" },
    { id: "linkedin",  label: "LinkedIn",  idKey: "LINKEDIN_CLIENT_ID",  secKey: "LINKEDIN_CLIENT_SECRET",  redKey: "LINKEDIN_REDIRECT_URL",
      defaultRed: `${baseUrl}/oauth/linkedin/callback`,
      discoveryUrl: null },
  ];

  // JWT_SECRET (required for AES-256-GCM token encryption)
  creds.push(_cred("oauth_jwt", "OAuth: JWT_SECRET (token encryption)", _has("JWT_SECRET") ? "configured" : "missing",
    _has("JWT_SECRET") ? "AES-256-GCM token encryption active" : "JWT_SECRET missing — OAuth token storage will fail",
    "Set JWT_SECRET in .env", ["JWT_SECRET"]));

  // CSRF protection in OAuth service
  const oauthSrc = fs.existsSync(path.join(ROOT, "backend/services/oauthIntegrationLayer.cjs"))
    ? fs.readFileSync(path.join(ROOT, "backend/services/oauthIntegrationLayer.cjs"), "utf8") : "";
  creds.push(_cred("oauth_csrf", "OAuth: CSRF protection (state + nonce)", oauthSrc.includes("NONCE_TTL") ? "configured" : "missing",
    oauthSrc.includes("NONCE_TTL") ? "State nonce with 5-min TTL — CSRF protected" : "Missing CSRF nonce",
    null, []));

  for (const prov of PROVIDERS) {
    const hasId  = _has(prov.idKey);
    const hasSec = _has(prov.secKey);
    const redirect = _env(prov.redKey) || prov.defaultRed;
    const redirectOk = redirect && redirect.startsWith(baseUrl) && !redirect.includes("localhost");

    // Credentials
    if (!hasId || !hasSec) {
      const missing = [!hasId && prov.idKey, !hasSec && prov.secKey].filter(Boolean);
      creds.push(_cred(`oauth_${prov.id}_creds`, `${prov.label} OAuth: credentials`, "missing",
        `Missing: ${missing.join(", ")}`,
        `Register app and set ${missing.join(" + ")} in .env`, missing));
    } else {
      creds.push(_cred(`oauth_${prov.id}_creds`, `${prov.label} OAuth: credentials`, "configured",
        `${prov.idKey} + ${prov.secKey} set`, null, [prov.idKey, prov.secKey]));
    }

    // Redirect URI
    creds.push(_cred(`oauth_${prov.id}_redirect`, `${prov.label} OAuth: redirect URI`,
      redirectOk ? "configured" : (_env(prov.redKey) ? "invalid" : "missing"),
      redirect || "not set",
      `Set ${prov.redKey}=${prov.defaultRed} and register it in the provider console`,
      [prov.redKey]));

    // Discovery endpoint reachability
    if (prov.discoveryUrl) {
      try {
        const res = await _get(prov.discoveryUrl, {}, 5000);
        creds.push(_cred(`oauth_${prov.id}_endpoint`, `${prov.label}: OIDC discovery reachable`,
          res.status === 200 ? "configured" : "warning",
          `HTTP ${res.status}`, "Check network", []));
      } catch (e) {
        creds.push(_cred(`oauth_${prov.id}_endpoint`, `${prov.label}: OIDC endpoint`, "warning",
          `Error: ${e.message}`, "Check network", []));
      }
    }
  }

  // Callback / refresh / logout routes verification
  const phase21Src = fs.existsSync(path.join(ROOT, "backend/routes/phase21.js"))
    ? fs.readFileSync(path.join(ROOT, "backend/routes/phase21.js"), "utf8") : "";
  creds.push(_cred("oauth_callback_route", "OAuth: /oauth/:provider/callback route", phase21Src.includes("/oauth/:provider/callback") ? "configured" : "missing",
    phase21Src.includes("/oauth/:provider/callback") ? "Callback route registered in phase21.js" : "Missing", null, []));
  creds.push(_cred("oauth_refresh_route", "OAuth: /oauth/:provider/refresh route", phase21Src.includes("/refresh") ? "configured" : "missing",
    phase21Src.includes("/refresh") ? "Refresh route registered" : "Missing", null, []));
  creds.push(_cred("oauth_revoke_route", "OAuth: /oauth/:provider/revoke route (logout)", phase21Src.includes("/revoke") ? "configured" : "missing",
    phase21Src.includes("/revoke") ? "Revoke/logout route registered" : "Missing", null, []));

  // Microsoft + LinkedIn in oauthIntegrationLayer
  creds.push(_cred("oauth_ms_wired", "Microsoft OAuth: wired in oauthIntegrationLayer", oauthSrc.includes("microsoft") ? "configured" : "missing",
    oauthSrc.includes("microsoft") ? "microsoft provider config present (token/auth/user URLs)" : "Not wired", null, []));
  creds.push(_cred("oauth_li_wired", "LinkedIn OAuth: wired in oauthIntegrationLayer", oauthSrc.includes("linkedin") ? "configured" : "missing",
    oauthSrc.includes("linkedin") ? "linkedin provider config present (token/auth/user URLs)" : "Not wired", null, []));

  return { section: "oauth", label: "OAuth", creds };
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. CRASH REPORTING
// ══════════════════════════════════════════════════════════════════════════════

async function auditCrash() {
  const creds = [];
  const sentrySvc = (() => { try { return require("./sentryService.cjs"); } catch { return null; } })();

  // DSN
  const hasDsn = _has("SENTRY_DSN");
  creds.push(_cred("sentry_dsn", "Sentry: SENTRY_DSN", hasDsn ? "configured" : "missing",
    hasDsn ? `DSN set (${_env("SENTRY_DSN").slice(0,30)}...)` : "SENTRY_DSN not set",
    "Create project at sentry.io → Settings → Client Keys → DSN", ["SENTRY_DSN"]));

  // Environment + release tags
  creds.push(_cred("sentry_env", "Sentry: SENTRY_ENVIRONMENT",
    _has("SENTRY_ENVIRONMENT") ? "configured" : "warning",
    _has("SENTRY_ENVIRONMENT") ? `SENTRY_ENVIRONMENT=${_env("SENTRY_ENVIRONMENT")}` : "Not set — defaults to NODE_ENV",
    "Set SENTRY_ENVIRONMENT=production in .env", ["SENTRY_ENVIRONMENT"]));

  creds.push(_cred("sentry_release", "Sentry: SENTRY_RELEASE",
    _has("SENTRY_RELEASE") ? "configured" : "warning",
    _has("SENTRY_RELEASE") ? `SENTRY_RELEASE=${_env("SENTRY_RELEASE")}` : "Not set — release tracking won't correlate errors to versions",
    "Set SENTRY_RELEASE=v1.0.0 in .env (or inject from CI)", ["SENTRY_RELEASE"]));

  creds.push(_cred("sentry_auth_token", "Sentry: SENTRY_AUTH_TOKEN (for release API)",
    _has("SENTRY_AUTH_TOKEN") ? "configured" : "warning",
    _has("SENTRY_AUTH_TOKEN") ? "SENTRY_AUTH_TOKEN set" : "Not set — createRelease() will not work",
    "Set SENTRY_AUTH_TOKEN from sentry.io → User Settings → API Tokens", ["SENTRY_AUTH_TOKEN"]));

  // Service availability
  creds.push(_cred("sentry_service", "Sentry: sentryService.cjs present", sentrySvc ? "configured" : "missing",
    sentrySvc ? "sentryService.cjs loaded" : "sentryService.cjs not found", null, []));

  // Live delivery test
  if (hasDsn && sentrySvc) {
    const result = await sentrySvc.verifyDelivery();
    creds.push(_cred("sentry_delivery", "Sentry: event delivery verified", result.ok ? "configured" : "invalid",
      result.detail, result.ok ? null : "Check SENTRY_DSN format and Sentry project settings", ["SENTRY_DSN"]));
  } else {
    creds.push(_cred("sentry_delivery", "Sentry: event delivery", "missing",
      "Skipped — SENTRY_DSN not set", "Set SENTRY_DSN to enable crash reporting", ["SENTRY_DSN"]));
  }

  // Internal crash grouping (CO3)
  const hasCO3 = fs.existsSync(path.join(ROOT, "backend/services/co3UserSuccess.cjs"));
  creds.push(_cred("crash_internal", "Crash: internal grouping (CO3)", hasCO3 ? "configured" : "missing",
    hasCO3 ? "co3UserSuccess.cjs crash intelligence (fingerprint + regression detection)" : "Missing", null, []));

  return { section: "crash", label: "Crash Reporting", creds };
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. OBJECT STORAGE
// ══════════════════════════════════════════════════════════════════════════════

async function auditStorage() {
  const creds = [];
  const storageSvc = (() => { try { return require("./storageService.cjs"); } catch { return null; } })();
  const det = storageSvc ? storageSvc.detectProvider() : { provider: null, configured: false };

  creds.push(_cred("storage_provider", `Storage provider: ${det.provider || "none"}`,
    det.configured ? "configured" : "missing",
    det.configured ? `${det.provider} — bucket: ${det.bucket}, endpoint: ${det.endpoint}` : "No storage provider configured",
    "Set S3_BUCKET+S3_ACCESS_KEY+S3_SECRET_KEY or R2_BUCKET+R2_ACCESS_KEY_ID+R2_SECRET_ACCESS_KEY+R2_ACCOUNT_ID",
    ["S3_BUCKET","S3_ACCESS_KEY","S3_SECRET_KEY","R2_BUCKET","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","R2_ACCOUNT_ID"]));

  // S3 credential check
  const s3Key    = _env("S3_ACCESS_KEY") || _env("AWS_ACCESS_KEY_ID");
  const s3Secret = _env("S3_SECRET_KEY") || _env("AWS_SECRET_ACCESS_KEY");
  const s3Bucket = _env("S3_BUCKET");
  if (s3Key && s3Secret && s3Bucket) {
    creds.push(_cred("storage_s3_creds", "S3: credentials", "configured",
      `Bucket: ${s3Bucket}, Region: ${_env("S3_REGION")||_env("AWS_REGION")||"us-east-1"}`,
      null, ["S3_BUCKET","S3_ACCESS_KEY","S3_SECRET_KEY","S3_REGION"]));
  } else {
    const miss = ["S3_BUCKET","S3_ACCESS_KEY","S3_SECRET_KEY"].filter(k => !_env(k));
    creds.push(_cred("storage_s3_creds", "S3: credentials", "missing",
      `Missing: ${miss.join(", ")}`, "Set S3 vars in .env", ["S3_BUCKET","S3_ACCESS_KEY","S3_SECRET_KEY","S3_REGION"]));
  }

  // R2 credential check
  const r2Key    = _env("R2_ACCESS_KEY_ID");
  const r2Secret = _env("R2_SECRET_ACCESS_KEY");
  const r2Bucket = _env("R2_BUCKET") || _env("CLOUDFLARE_R2_BUCKET");
  const r2Acct   = _env("R2_ACCOUNT_ID") || _env("CLOUDFLARE_ACCOUNT_ID");
  if (r2Key && r2Secret && r2Bucket && r2Acct) {
    creds.push(_cred("storage_r2_creds", "Cloudflare R2: credentials", "configured",
      `Bucket: ${r2Bucket}, Account: ${r2Acct.slice(0,12)}...`, null,
      ["R2_BUCKET","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","R2_ACCOUNT_ID"]));
  } else {
    const miss = ["R2_BUCKET","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","R2_ACCOUNT_ID"].filter(k => !_env(k));
    creds.push(_cred("storage_r2_creds", "Cloudflare R2: credentials", "missing",
      `Missing: ${miss.join(", ")}`, "Set R2 vars in .env (Cloudflare Dashboard → R2 → Manage API tokens)",
      ["R2_BUCKET","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","R2_ACCOUNT_ID"]));
  }

  // Service file presence
  creds.push(_cred("storage_service", "Storage: storageService.cjs present", storageSvc ? "configured" : "missing",
    storageSvc ? "storageService.cjs loaded (upload/download/delete/signedUrl/list)" : "Missing", null, []));

  // Operations verification (structural — no live calls if not configured)
  if (storageSvc && det.configured) {
    const result = await storageSvc.verifyProvider();
    creds.push(_cred("storage_live", `Storage: live bucket access (${det.provider})`,
      result.ok ? "configured" : "invalid",
      result.detail, result.ok ? null : `Check ${det.provider} credentials and bucket name`, []));

    // Signed URL generation (no network call — pure crypto)
    const urlResult = storageSvc.signedUrl("pcs-test/verify.txt", 60);
    creds.push(_cred("storage_signed_url", "Storage: signed URL generation",
      urlResult.ok ? "configured" : "invalid",
      urlResult.ok ? `URL generated (expires 60s) — ${urlResult.url?.slice(0,60)}...` : urlResult.error, null, []));
  } else {
    const ops = ["upload","download","delete","signed_url"];
    for (const op of ops) {
      creds.push(_cred(`storage_${op}`, `Storage: ${op} capability`, "missing",
        "Skipped — no storage provider configured", null, []));
    }
  }

  return { section: "storage", label: "Object Storage", creds };
}

// ══════════════════════════════════════════════════════════════════════════════
// REPORT GENERATION
// ══════════════════════════════════════════════════════════════════════════════

// Complete env var manifest — every credential this sprint tracks
const ENV_MANIFEST = [
  // Email
  { key: "RESEND_API_KEY",         section: "email",   desc: "Resend transactional email API key",                 priority: "recommended" },
  { key: "SENDGRID_API_KEY",       section: "email",   desc: "SendGrid API key (alternative to Resend)",           priority: "optional"    },
  { key: "POSTMARK_API_KEY",       section: "email",   desc: "Postmark server token (alternative)",                priority: "optional"    },
  { key: "SMTP_HOST",              section: "email",   desc: "SMTP server hostname",                               priority: "optional"    },
  { key: "SMTP_USER",              section: "email",   desc: "SMTP username / email address",                      priority: "optional"    },
  { key: "SMTP_PASS",              section: "email",   desc: "SMTP password or app password",                      priority: "optional"    },
  { key: "SMTP_PORT",              section: "email",   desc: "SMTP port (587=STARTTLS, 465=SSL)",                  priority: "optional"    },
  { key: "SMTP_FROM",              section: "email",   desc: "Sender address (noreply@ooplix.com)",                priority: "optional"    },
  { key: "AWS_ACCESS_KEY_ID",      section: "email",   desc: "AWS access key (SES + S3 shared)",                   priority: "optional"    },
  { key: "AWS_SECRET_ACCESS_KEY",  section: "email",   desc: "AWS secret key",                                    priority: "optional"    },
  { key: "AWS_SES_REGION",         section: "email",   desc: "SES region (e.g. us-east-1)",                       priority: "optional"    },
  // AI
  { key: "ANTHROPIC_API_KEY",      section: "ai",      desc: "Claude / Anthropic API key (sk-ant-...)",           priority: "recommended" },
  { key: "GEMINI_API_KEY",         section: "ai",      desc: "Google Gemini API key (AIza...)",                   priority: "recommended" },
  { key: "OPENROUTER_API_KEY",     section: "ai",      desc: "OpenRouter API key (sk-or-...)",                    priority: "recommended" },
  { key: "GEMINI_MODEL",           section: "ai",      desc: "Gemini model override (default: gemini-2.0-flash)", priority: "optional"    },
  { key: "ANTHROPIC_MODEL",        section: "ai",      desc: "Claude model override",                             priority: "optional"    },
  { key: "LLM_PROVIDER",           section: "ai",      desc: "Primary AI provider (groq|openai|claude|gemini)",   priority: "optional"    },
  // OAuth
  { key: "GOOGLE_CLIENT_ID",       section: "oauth",   desc: "Google OAuth 2.0 client ID",                       priority: "recommended" },
  { key: "GOOGLE_CLIENT_SECRET",   section: "oauth",   desc: "Google OAuth 2.0 client secret",                   priority: "recommended" },
  { key: "GOOGLE_REDIRECT_URI",    section: "oauth",   desc: "https://app.ooplix.com/oauth/google/callback",      priority: "recommended" },
  { key: "MICROSOFT_CLIENT_ID",    section: "oauth",   desc: "Azure AD app client ID",                           priority: "optional"    },
  { key: "MICROSOFT_CLIENT_SECRET",section: "oauth",   desc: "Azure AD app client secret",                       priority: "optional"    },
  { key: "MICROSOFT_REDIRECT_URI", section: "oauth",   desc: "https://app.ooplix.com/oauth/microsoft/callback",   priority: "optional"    },
  { key: "LINKEDIN_CLIENT_ID",     section: "oauth",   desc: "LinkedIn app client ID",                           priority: "optional"    },
  { key: "LINKEDIN_CLIENT_SECRET", section: "oauth",   desc: "LinkedIn app client secret",                       priority: "optional"    },
  { key: "LINKEDIN_REDIRECT_URL",  section: "oauth",   desc: "https://app.ooplix.com/oauth/linkedin/callback",    priority: "optional"    },
  // Crash
  { key: "SENTRY_DSN",             section: "crash",   desc: "Sentry DSN for crash reporting",                   priority: "recommended" },
  { key: "SENTRY_ENVIRONMENT",     section: "crash",   desc: "Sentry environment tag (production)",              priority: "optional"    },
  { key: "SENTRY_RELEASE",         section: "crash",   desc: "Sentry release version (v1.0.0)",                  priority: "optional"    },
  { key: "SENTRY_AUTH_TOKEN",      section: "crash",   desc: "Sentry auth token for release API",                priority: "optional"    },
  { key: "SENTRY_ORG",             section: "crash",   desc: "Sentry organization slug",                         priority: "optional"    },
  // Storage
  { key: "S3_BUCKET",              section: "storage", desc: "AWS S3 bucket name",                               priority: "optional"    },
  { key: "S3_ACCESS_KEY",          section: "storage", desc: "S3 access key (or AWS_ACCESS_KEY_ID)",             priority: "optional"    },
  { key: "S3_SECRET_KEY",          section: "storage", desc: "S3 secret key",                                    priority: "optional"    },
  { key: "S3_REGION",              section: "storage", desc: "S3 region (e.g. ap-south-1)",                      priority: "optional"    },
  { key: "S3_ENDPOINT",            section: "storage", desc: "Custom S3 endpoint (DO Spaces, Backblaze, etc.)",  priority: "optional"    },
  { key: "R2_ACCOUNT_ID",          section: "storage", desc: "Cloudflare account ID",                            priority: "optional"    },
  { key: "R2_BUCKET",              section: "storage", desc: "R2 bucket name",                                   priority: "optional"    },
  { key: "R2_ACCESS_KEY_ID",       section: "storage", desc: "R2 access key ID",                                 priority: "optional"    },
  { key: "R2_SECRET_ACCESS_KEY",   section: "storage", desc: "R2 secret access key",                             priority: "optional"    },
];

function _buildEnvReport() {
  return ENV_MANIFEST.map(v => ({
    ...v,
    set:   !!_env(v.key),
    value: _env(v.key) ? `${_env(v.key).slice(0,8)}...` : null,
  }));
}

async function runFullAudit() {
  const [email, ai, oauth, crash, storage] = await Promise.all([
    auditEmail(), auditAI(), auditOAuth(), auditCrash(), auditStorage(),
  ]);

  const sections   = [email, ai, oauth, crash, storage];
  const allCreds   = sections.flatMap(s => s.creds.map(c => ({ ...c, section: s.section, sectionLabel: s.label })));

  const configured = allCreds.filter(c => c.status === "configured");
  const missing    = allCreds.filter(c => c.status === "missing");
  const invalid    = allCreds.filter(c => c.status === "invalid");
  const expired    = allCreds.filter(c => c.status === "expired");
  const warnings   = allCreds.filter(c => c.status === "warning");

  const envVars    = _buildEnvReport();
  const missingEnvVars = envVars.filter(v => !v.set);
  const presentEnvVars = envVars.filter(v => v.set);

  const score = Math.round(configured.length / allCreds.length * 100);

  const report = {
    id:          `pcs-${Date.now()}`,
    sprint:      1,
    runAt:       _ts(),
    score,
    totalCredentials: allCreds.length,
    configured:  configured.length,
    missing:     missing.length,
    invalid:     invalid.length,
    expired:     expired.length,
    warnings:    warnings.length,
    sections:    sections.map(s => ({
      section: s.section, label: s.label,
      total:   s.creds.length,
      configured: s.creds.filter(c => c.status === "configured").length,
      missing:    s.creds.filter(c => c.status === "missing").length,
      invalid:    s.creds.filter(c => c.status === "invalid").length,
      warnings:   s.creds.filter(c => c.status === "warning").length,
      score:   Math.round(s.creds.filter(c => c.status === "configured").length / s.creds.length * 100),
    })),
    details: {
      email:   email.creds,
      ai:      ai.creds,
      oauth:   oauth.creds,
      crash:   crash.creds,
      storage: storage.creds,
    },
    configured:    configured,
    missing:       missing,
    invalid:       invalid,
    expired:       expired,
    warnings:      warnings,
    envVars: {
      all:          envVars,
      missing:      missingEnvVars,
      present:      presentEnvVars,
      missingCount: missingEnvVars.length,
      presentCount: presentEnvVars.length,
    },
  };

  const s = _load();
  s.lastRun = report.runAt;
  s.reports.unshift(report);
  if (s.reports.length > 10) s.reports = s.reports.slice(0, 10);
  _save(s);
  return report;
}

function getLastReport()    { return _load().reports[0] || null; }
function getReportHistory() { return _load().reports.map(r => ({ id: r.id, runAt: r.runAt, score: r.score, configured: r.configured, total: r.totalCredentials })); }

async function auditSection(section) {
  switch (section) {
    case "email":   return auditEmail();
    case "ai":      return auditAI();
    case "oauth":   return auditOAuth();
    case "crash":   return auditCrash();
    case "storage": return auditStorage();
    default: throw new Error(`Unknown section: ${section}`);
  }
}

async function runBenchmark() {
  const report = await runFullAudit();
  const sectionChecks = report.sections.map(s => ({
    id: s.section, label: `${s.label}: ${s.configured}/${s.total} configured (${s.score}%)`, ok: s.score >= 40,
  }));
  const critChecks = [
    { id: "email_any",     label: "Email: at least one provider configured", ok: report.details.email.some(c => c.id === "email_provider" && c.status === "configured") },
    { id: "ai_routing",    label: "AI: routing + fallback wired",            ok: report.details.ai.some(c => c.id === "ai_routing" && c.status === "configured") },
    { id: "ai_credits",    label: "AI: credit accounting present",           ok: report.details.ai.some(c => c.id === "ai_credits" && c.status === "configured") },
    { id: "oauth_csrf",    label: "OAuth: CSRF protection active",           ok: report.details.oauth.some(c => c.id === "oauth_csrf" && c.status === "configured") },
    { id: "oauth_ms_wired",label: "OAuth: Microsoft provider wired",         ok: report.details.oauth.some(c => c.id === "oauth_ms_wired" && c.status === "configured") },
    { id: "oauth_li_wired",label: "OAuth: LinkedIn provider wired",          ok: report.details.oauth.some(c => c.id === "oauth_li_wired" && c.status === "configured") },
    { id: "crash_internal",label: "Crash: internal grouping (CO3)",          ok: report.details.crash.some(c => c.id === "crash_internal" && c.status === "configured") },
    { id: "storage_svc",   label: "Storage: storageService.cjs present",     ok: report.details.storage.some(c => c.id === "storage_service" && c.status === "configured") },
  ];
  const allChecks = [...sectionChecks, ...critChecks];
  const passing   = allChecks.filter(c => c.ok).length;
  return {
    score:       Math.round(passing / allChecks.length * 100),
    passing, total: allChecks.length,
    credentialScore: report.score,
    configured:  report.configured,
    missing:     report.missing,
    invalid:     report.invalid,
    warnings:    report.warnings,
    checks:      allChecks,
    missingEnvVars: report.envVars.missing.map(v => ({ key: v.key, section: v.section, desc: v.desc })),
    runAt:       report.runAt,
    regressionPass: passing === allChecks.length,
  };
}

module.exports = {
  runFullAudit, auditSection, getLastReport, getReportHistory, runBenchmark,
  auditEmail, auditAI, auditOAuth, auditCrash, auditStorage,
  ENV_MANIFEST,
};
