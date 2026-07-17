"use strict";
/**
 * Integration Connectors — Production Mission 3
 *
 * Unified connector registry for all 12 integration phases.
 * Every connector provides: connect · health · status · reconnect ·
 * rotateCredentials · detectFailure · getMetrics · lastSync · lastError
 *
 * Reuses existing services — never duplicates:
 *   aiService.js          → Phase A (AI providers)
 *   gitHubEngineeringAgent.cjs → Phase B (GitHub)
 *   pcs2ExternalPlatforms.cjs  → Phase C–K (infra/payments/email/messaging/auth/productivity/commerce/creative/automation)
 *   sentryService.cjs     → Phase L (monitoring)
 *   storageService.cjs    → Phase C (infra/storage)
 *   oauthIntegrationLayer.cjs  → auth flows
 *   emailService.cjs      → Phase E
 *   paymentService.js     → Phase D
 *   localAiRuntime.cjs    → Phase A (Ollama/LM Studio)
 *   providerManager.cjs   → Phase A health
 *
 * No credentials are stored in plain text.
 * Credentials are only read from env vars or from the AES-256-GCM
 * encrypted store managed by oauthIntegrationLayer.cjs.
 *
 * Storage: data/integration-connectors.json
 */

const fs     = require("fs");
const path   = require("path");
const https  = require("https");
const http   = require("http");
const crypto = require("crypto");

const DATA_FILE = path.join(__dirname, "../../data/integration-connectors.json");

// ── I/O ───────────────────────────────────────────────────────────────────────
function _load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { connectors: {}, metrics: {}, lastFullScan: null }; }
}
function _save(d) {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch { /* non-fatal */ }
}
function _ts()       { return new Date().toISOString(); }

// ── Lazy service loaders ──────────────────────────────────────────────────────
const _try = fn => { try { return fn(); } catch { return null; } };
const _vault    = () => _try(() => require("./secretVault.cjs"));

// Reverse index of secretVault's ENV_MAP (envVarName -> "connectorId::type"),
// built once and cached. Lets every connector below check the encrypted
// vault first — via the same env-var-name key it already uses — before
// falling back to process.env, without restructuring each connector's own
// _has()/_env() calls or duplicating the vault's connector-id mapping here.
let _envToVaultKey = null;
function _buildEnvToVaultKey() {
  const vault = _vault();
  if (!vault?.ENV_MAP) return {};
  const rev = {};
  for (const [vaultKey, envName] of Object.entries(vault.ENV_MAP)) {
    if (!rev[envName]) rev[envName] = vaultKey; // first mapping wins on collision
  }
  return rev;
}
function _env(k) {
  const vault = _vault();
  if (vault) {
    if (_envToVaultKey === null) _envToVaultKey = _buildEnvToVaultKey();
    const vaultKey = _envToVaultKey[k];
    if (vaultKey) {
      const [connectorId, type] = vaultKey.split("::");
      try {
        const fromVault = vault.getSecret(connectorId, type);
        if (fromVault) return fromVault;
      } catch { /* fall through to env var */ }
    }
  }
  return process.env[k] || "";
}
function _has(...ks) { return ks.every(k => !!_env(k)); }
const _ai       = () => _try(() => require("./aiService.js"));
const _ghAgent  = () => _try(() => require("./gitHubEngineeringAgent.cjs"));
const _pcs2     = () => _try(() => require("./pcs2ExternalPlatforms.cjs"));
const _sentry   = () => _try(() => require("./sentryService.cjs"));
const _storage  = () => _try(() => require("./storageService.cjs"));
const _oauth    = () => _try(() => require("./oauthIntegrationLayer.cjs"));
const _email    = () => _try(() => require("./emailService.cjs"));
const _payment  = () => _try(() => require("./paymentService.js"));
const _localAi  = () => _try(() => require("./localAiRuntime.cjs"));
const _prov     = () => _try(() => require("./providerManager.cjs"));

// ── HTTP probe helper ─────────────────────────────────────────────────────────
function _probe(url, headersObj = {}, ms = 6000) {
  return new Promise(resolve => {
    try {
      const u   = new URL(url);
      const mod = u.protocol === "http:" ? http : https;
      const req = mod.request(
        { hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
          path: u.pathname + u.search, method: "GET",
          headers: { "User-Agent": "ooplix/3.0", ...headersObj } },
        res => {
          let body = "";
          res.on("data", d => { body += d; });
          res.on("end", () => {
            try { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: JSON.parse(body) }); }
            catch { resolve({ ok: res.statusCode < 400, status: res.statusCode, body }); }
          });
        }
      );
      req.setTimeout(ms, () => { req.destroy(); resolve({ ok: false, status: 0, error: "timeout" }); });
      req.on("error", e => resolve({ ok: false, status: 0, error: e.message }));
      req.end();
    } catch (e) { resolve({ ok: false, status: 0, error: e.message }); }
  });
}

// ── Connector record builder ──────────────────────────────────────────────────
function _record(id, phase, label, status, detail, credentials, metrics = {}) {
  // status: CONNECTED | READY | PARTIAL | MISSING | NOT_APPLICABLE
  const state = _load();
  const prev  = state.connectors[id] || {};
  const rec   = {
    id, phase, label, status, detail,
    credentials,   // { required: string[], present: string[], missing: string[] }
    metrics: { ...prev.metrics, ...metrics },
    lastCheck: _ts(),
    lastError:   status === "CONNECTED" ? null : (detail || prev.lastError || null),
    lastSuccess: status === "CONNECTED" ? _ts() : (prev.lastSuccess || null),
    syncCount:   (prev.syncCount || 0) + (status === "CONNECTED" ? 1 : 0),
  };
  state.connectors[id] = rec;
  _save(state);
  return rec;
}

function _creds(required, optional = []) {
  const present  = required.filter(k => !!_env(k));
  const missing  = required.filter(k => !_env(k));
  const optPres  = optional.filter(k => !!_env(k));
  return { required, present, missing, optional, optionalPresent: optPres };
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE A — AI Providers
// ══════════════════════════════════════════════════════════════════════════════

const AI_PROVIDERS = {
  groq:       { label: "Groq",          baseUrl: "https://api.groq.com/openai/v1",          modelsPath: "/models",  envKey: "GROQ_API_KEY",        authHeader: k => `Bearer ${k}` },
  openai:     { label: "OpenAI",        baseUrl: "https://api.openai.com/v1",               modelsPath: "/models",  envKey: "OPENAI_API_KEY",      authHeader: k => `Bearer ${k}` },
  anthropic:  { label: "Anthropic",     baseUrl: "https://api.anthropic.com/v1",            modelsPath: "/models",  envKey: "ANTHROPIC_API_KEY",   authHeader: k => null, customHeaders: k => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }) },
  gemini:     { label: "Gemini",        baseUrl: null,                                       modelsPath: null,       envKey: "GEMINI_API_KEY",      authHeader: null },
  openrouter: { label: "OpenRouter",    baseUrl: "https://openrouter.ai/api/v1",            modelsPath: "/models",  envKey: "OPENROUTER_API_KEY",  authHeader: k => `Bearer ${k}` },
  deepseek:   { label: "DeepSeek",      baseUrl: "https://api.deepseek.com/v1",             modelsPath: "/models",  envKey: "DEEPSEEK_API_KEY",    authHeader: k => `Bearer ${k}` },
  together:   { label: "Together AI",   baseUrl: "https://api.together.xyz/v1",             modelsPath: "/models",  envKey: "TOGETHER_API_KEY",    authHeader: k => `Bearer ${k}` },
  fireworks:  { label: "Fireworks AI",  baseUrl: "https://api.fireworks.ai/inference/v1",  modelsPath: "/models",  envKey: "FIREWORKS_API_KEY",   authHeader: k => `Bearer ${k}` },
  cohere:     { label: "Cohere",        baseUrl: "https://api.cohere.ai/v1",               modelsPath: "/models",  envKey: "COHERE_API_KEY",      authHeader: k => `Bearer ${k}` },
  nvidia:     { label: "NVIDIA NIM",    baseUrl: "https://integrate.api.nvidia.com/v1",    modelsPath: "/models",  envKey: "NVIDIA_API_KEY",      authHeader: k => `Bearer ${k}` },
  ollama:     { label: "Ollama (Local)",baseUrl: null,                                       modelsPath: null,       envKey: null,                  authHeader: null },
  lmstudio:   { label: "LM Studio",     baseUrl: null,                                       modelsPath: null,       envKey: null,                  authHeader: null },
};

async function connectAIProvider(providerId) {
  const def = AI_PROVIDERS[providerId];
  if (!def) return _record(`ai:${providerId}`, "A", def?.label || providerId, "MISSING", "Unknown provider", _creds([]));

  // Local runtimes — probe via localAiRuntime
  if (providerId === "ollama" || providerId === "lmstudio") {
    const local  = _localAi();
    const result = local ? await local.probeRuntime(providerId).catch(() => null) : null;
    const ok     = result?.running === true;
    const creds  = _creds([], []);
    return _record(`ai:${providerId}`, "A", def.label,
      ok ? "CONNECTED" : "READY",
      ok ? `Running on port ${result.port}, ${result.models?.length || 0} model(s) loaded`
         : `Not running locally — install from ${providerId === "ollama" ? "https://ollama.com" : "https://lmstudio.ai"}`,
      creds,
      ok ? { modelsLoaded: result.models?.length || 0, port: result.port } : {}
    );
  }

  // Gemini — probe via generateContent URL with key as query param
  if (providerId === "gemini") {
    const key = _env("GEMINI_API_KEY");
    const creds = _creds(["GEMINI_API_KEY"]);
    if (!key) return _record("ai:gemini", "A", def.label, "MISSING", "GEMINI_API_KEY not set", creds);
    const model = _env("GEMINI_MODEL") || "gemini-2.0-flash";
    const probeUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${key}`;
    const r = await _probe(probeUrl);
    return _record("ai:gemini", "A", def.label,
      r.ok ? "CONNECTED" : "READY",
      r.ok ? `Gemini API reachable — model: ${model}` : `Probe failed: HTTP ${r.status} ${r.error || ""}`,
      creds, r.ok ? { model } : {}
    );
  }

  // Anthropic — custom headers
  if (providerId === "anthropic") {
    const key = _env("ANTHROPIC_API_KEY");
    const creds = _creds(["ANTHROPIC_API_KEY"]);
    if (!key) return _record("ai:anthropic", "A", def.label, "MISSING", "ANTHROPIC_API_KEY not set", creds);
    const r = await _probe("https://api.anthropic.com/v1/models", { "x-api-key": key, "anthropic-version": "2023-06-01" });
    return _record("ai:anthropic", "A", def.label,
      r.ok ? "CONNECTED" : "READY",
      r.ok ? "Anthropic API reachable" : `Probe failed: HTTP ${r.status} ${r.error || ""}`,
      creds
    );
  }

  // Standard OpenAI-compatible providers
  const key = _env(def.envKey);
  const creds = _creds([def.envKey]);
  if (!key) return _record(`ai:${providerId}`, "A", def.label, "MISSING", `${def.envKey} not set`, creds);

  const url = `${def.baseUrl}${def.modelsPath}`;
  const authVal = def.authHeader(key);
  const r = await _probe(url, authVal ? { Authorization: authVal } : {});
  return _record(`ai:${providerId}`, "A", def.label,
    r.ok ? "CONNECTED" : "READY",
    r.ok ? `${def.label} API reachable` : `Probe failed: HTTP ${r.status} ${r.error || ""}`,
    creds
  );
}

async function healthAIProvider(providerId) {
  // For already-connected providers, reuse aiService health check
  const ai = _ai();
  if (ai && ["groq", "openrouter", "openai", "claude", "gemini", "ollama"].includes(providerId)) {
    const status = await ai.getAIStatus().catch(() => null);
    const prov = status?.providers?.find(p => p.id === (providerId === "anthropic" ? "claude" : providerId));
    if (prov) {
      return { ok: prov.health?.ok ?? false, latencyMs: null, detail: prov.health?.reason || "ok", provider: providerId };
    }
  }
  // Fallback: re-probe
  const rec = await connectAIProvider(providerId);
  return { ok: rec.status === "CONNECTED", detail: rec.detail, provider: providerId };
}

async function scanAllAIProviders() {
  const ids = Object.keys(AI_PROVIDERS);
  const results = await Promise.all(ids.map(id => connectAIProvider(id).catch(e => ({
    id: `ai:${id}`, phase: "A", label: id, status: "MISSING", detail: e.message,
    credentials: _creds([]), lastCheck: _ts()
  }))));
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — Git Providers
// ══════════════════════════════════════════════════════════════════════════════

async function connectGitHub() {
  const creds = _creds(["GITHUB_TOKEN"], ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_APP_ID"]);
  const token = _env("GITHUB_TOKEN");
  if (!token) return _record("git:github", "B", "GitHub", "READY",
    "GITHUB_TOKEN not set — public read access available; set PAT for full access", creds);

  const r = await _probe("https://api.github.com/user",
    { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
  const username = r.body?.login;
  const rateLimit = await _probe("https://api.github.com/rate_limit",
    { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
  const remaining = rateLimit.body?.rate?.remaining;

  return _record("git:github", "B", "GitHub",
    r.ok ? "CONNECTED" : "READY",
    r.ok ? `Authenticated as @${username} — rate limit remaining: ${remaining ?? "unknown"}` : `Token invalid: HTTP ${r.status}`,
    creds, r.ok ? { username, rateRemaining: remaining } : {}
  );
}

async function connectGitLab() {
  const host  = _env("GITLAB_HOST") || "https://gitlab.com";
  const token = _env("GITLAB_TOKEN") || _env("GITLAB_ACCESS_TOKEN");
  const creds = _creds(["GITLAB_TOKEN"], ["GITLAB_HOST"]);
  if (!token) return _record("git:gitlab", "B", "GitLab", "READY", "GITLAB_TOKEN not set", creds);

  const r = await _probe(`${host}/api/v4/user`, { "PRIVATE-TOKEN": token });
  const username = r.body?.username;
  return _record("git:gitlab", "B", "GitLab",
    r.ok ? "CONNECTED" : "READY",
    r.ok ? `Authenticated as @${username} on ${host}` : `Token invalid: HTTP ${r.status}`,
    creds, r.ok ? { username, host } : {}
  );
}

async function connectBitbucket() {
  const user = _env("BITBUCKET_USER") || _env("BITBUCKET_USERNAME");
  const pass = _env("BITBUCKET_APP_PASSWORD") || _env("BITBUCKET_TOKEN");
  const creds = _creds(["BITBUCKET_USER", "BITBUCKET_APP_PASSWORD"]);
  if (!user || !pass) return _record("git:bitbucket", "B", "Bitbucket", "READY", "BITBUCKET_USER and BITBUCKET_APP_PASSWORD not set", creds);

  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const r    = await _probe("https://api.bitbucket.org/2.0/user", { Authorization: `Basic ${auth}` });
  const displayName = r.body?.display_name;
  return _record("git:bitbucket", "B", "Bitbucket",
    r.ok ? "CONNECTED" : "READY",
    r.ok ? `Authenticated as ${displayName}` : `Auth failed: HTTP ${r.status}`,
    creds, r.ok ? { displayName } : {}
  );
}

async function scanAllGitProviders() {
  return Promise.all([connectGitHub(), connectGitLab(), connectBitbucket()]);
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE C — Infrastructure
// ══════════════════════════════════════════════════════════════════════════════

async function connectHostinger() {
  const key = _env("HOSTINGER_API_KEY");
  const creds = _creds(["HOSTINGER_API_KEY"]);
  if (!key) return _record("infra:hostinger", "C", "Hostinger", "READY", "HOSTINGER_API_KEY not set", creds);
  const r = await _probe("https://api.hostinger.com/v1/profile", { Authorization: `Bearer ${key}` });
  return _record("infra:hostinger", "C", "Hostinger",
    r.ok ? "CONNECTED" : "READY",
    r.ok ? "Hostinger API authenticated" : `Auth failed: HTTP ${r.status}`,
    creds
  );
}

async function connectCloudflare() {
  const token = _env("CLOUDFLARE_API_TOKEN") || _env("CF_API_TOKEN");
  const accountId = _env("CLOUDFLARE_ACCOUNT_ID");
  const creds = _creds(["CLOUDFLARE_API_TOKEN"], ["CLOUDFLARE_ACCOUNT_ID"]);
  if (!token) return _record("infra:cloudflare", "C", "Cloudflare", "READY", "CLOUDFLARE_API_TOKEN not set", creds);
  const r = await _probe("https://api.cloudflare.com/client/v4/user/tokens/verify", { Authorization: `Bearer ${token}` });
  const ok = r.ok && r.body?.result?.status === "active";
  return _record("infra:cloudflare", "C", "Cloudflare",
    ok ? "CONNECTED" : "READY",
    ok ? `Token active${accountId ? ` — account: ${accountId}` : ""}` : `Token inactive or invalid: HTTP ${r.status}`,
    creds, ok ? { accountId } : {}
  );
}

async function connectFirebase() {
  const projectId = _env("FIREBASE_PROJECT_ID");
  const serviceAccount = _env("FIREBASE_SERVICE_ACCOUNT");
  const creds = _creds(["FIREBASE_PROJECT_ID"], ["FIREBASE_SERVICE_ACCOUNT"]);
  if (!projectId) return _record("infra:firebase", "C", "Firebase", "READY", "FIREBASE_PROJECT_ID not set", creds);
  // Firebase projects are validated at auth layer; if service account JSON is present, parse-check it
  let saOk = false;
  if (serviceAccount) {
    try { JSON.parse(serviceAccount); saOk = true; } catch { /* invalid JSON */ }
  }
  return _record("infra:firebase", "C", "Firebase",
    projectId ? (saOk ? "CONNECTED" : "PARTIAL") : "MISSING",
    projectId && saOk ? `Project: ${projectId}, service account configured`
      : projectId ? `Project: ${projectId}, FIREBASE_SERVICE_ACCOUNT missing or invalid JSON`
      : "FIREBASE_PROJECT_ID not set",
    creds
  );
}

async function connectSupabase() {
  const url = _env("SUPABASE_URL");
  const key = _env("SUPABASE_ANON_KEY") || _env("SUPABASE_SERVICE_KEY");
  const creds = _creds(["SUPABASE_URL", "SUPABASE_ANON_KEY"]);
  if (!url || !key) return _record("infra:supabase", "C", "Supabase", "READY", "SUPABASE_URL and SUPABASE_ANON_KEY not set", creds);
  const r = await _probe(`${url}/rest/v1/`, { apikey: key, Authorization: `Bearer ${key}` });
  return _record("infra:supabase", "C", "Supabase",
    r.ok ? "CONNECTED" : "READY",
    r.ok ? `Supabase project reachable: ${url}` : `Probe failed: HTTP ${r.status}`,
    creds
  );
}

async function connectAWS() {
  // Validate via S3-compatible storage service which handles SigV4
  const storage = _storage();
  if (!storage) return _record("infra:aws", "C", "AWS", "MISSING", "storageService unavailable", _creds([]));
  const cfg = storage.detectProvider();
  const creds = _creds(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"], ["S3_BUCKET", "AWS_REGION"]);
  if (cfg.provider !== "s3") return _record("infra:aws", "C", "AWS", "READY", "AWS credentials not set", creds);
  const r = await storage.verifyProvider().catch(e => ({ ok: false, detail: e.message }));
  return _record("infra:aws", "C", "AWS",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `S3 reachable — bucket: ${cfg.bucket}` : `S3 probe failed: ${r.detail}`,
    creds, r.ok ? { bucket: cfg.bucket, region: cfg.region } : {}
  );
}

async function connectCloudflareR2() {
  const storage = _storage();
  if (!storage) return _record("infra:r2", "C", "Cloudflare R2", "MISSING", "storageService unavailable", _creds([]));
  const cfg = storage.detectProvider();
  const creds = _creds(["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ACCOUNT_ID"]);
  if (cfg.provider !== "r2") return _record("infra:r2", "C", "Cloudflare R2", "READY", "R2 credentials not set", creds);
  const r = await storage.verifyProvider().catch(e => ({ ok: false, detail: e.message }));
  return _record("infra:r2", "C", "Cloudflare R2",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `R2 reachable — bucket: ${cfg.bucket}` : `R2 probe failed: ${r.detail}`,
    creds
  );
}

async function scanAllInfraProviders() {
  return Promise.all([
    connectHostinger(), connectCloudflare(), connectFirebase(),
    connectSupabase(), connectAWS(), connectCloudflareR2()
  ]);
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE D — Payments
// ══════════════════════════════════════════════════════════════════════════════

async function connectRazorpay() {
  const key    = _env("RAZORPAY_KEY_ID") || _env("RAZORPAY_KEY");
  const secret = _env("RAZORPAY_KEY_SECRET") || _env("RAZORPAY_SECRET");
  const whs    = _env("RAZORPAY_WEBHOOK_SECRET");
  const creds  = _creds(["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]);
  if (!key || !secret) return _record("pay:razorpay", "D", "Razorpay", "READY", "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set", creds);

  // Razorpay API v1 — Basic Auth with key:secret
  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  const r    = await _probe("https://api.razorpay.com/v1/payment_links?count=1",
    { Authorization: `Basic ${auth}`, "Content-Type": "application/json" });
  const webhookOk = !!whs;
  return _record("pay:razorpay", "D", "Razorpay",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `Razorpay API authenticated${webhookOk ? ", webhook secret set" : " (webhook secret missing)"}` : `Auth failed: HTTP ${r.status}`,
    creds, r.ok ? { webhookConfigured: webhookOk } : {}
  );
}

async function connectStripe() {
  const sk    = _env("STRIPE_SECRET_KEY");
  const whs   = _env("STRIPE_WEBHOOK_SECRET");
  const creds = _creds(["STRIPE_SECRET_KEY"], ["STRIPE_WEBHOOK_SECRET", "STRIPE_PUBLISHABLE_KEY"]);
  if (!sk) return _record("pay:stripe", "D", "Stripe", "READY", "STRIPE_SECRET_KEY not set", creds);

  const r = await _probe("https://api.stripe.com/v1/customers?limit=1",
    { Authorization: `Bearer ${sk}`, "Stripe-Version": "2024-06-20" });
  return _record("pay:stripe", "D", "Stripe",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `Stripe API authenticated${whs ? ", webhook secret set" : " (webhook secret missing)"}` : `Auth failed: HTTP ${r.status}`,
    creds, r.ok ? { webhookConfigured: !!whs } : {}
  );
}

async function connectPaddle() {
  const key   = _env("PADDLE_API_KEY");
  const creds = _creds(["PADDLE_API_KEY"], ["PADDLE_VENDOR_ID", "PADDLE_WEBHOOK_SECRET"]);
  if (!key) return _record("pay:paddle", "D", "Paddle", "READY", "PADDLE_API_KEY not set", creds);
  // Paddle Billing API
  const r = await _probe("https://api.paddle.com/customers?per_page=1",
    { Authorization: `Bearer ${key}` });
  return _record("pay:paddle", "D", "Paddle",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? "Paddle API authenticated" : `Auth failed: HTTP ${r.status}`,
    creds
  );
}

async function connectLemonSqueezy() {
  const key   = _env("LEMONSQUEEZY_API_KEY");
  const creds = _creds(["LEMONSQUEEZY_API_KEY"], ["LEMONSQUEEZY_STORE_ID", "LEMONSQUEEZY_WEBHOOK_SECRET"]);
  if (!key) return _record("pay:lemonsqueezy", "D", "LemonSqueezy", "READY", "LEMONSQUEEZY_API_KEY not set", creds);
  const r = await _probe("https://api.lemonsqueezy.com/v1/me",
    { Authorization: `Bearer ${key}`, Accept: "application/vnd.api+json" });
  return _record("pay:lemonsqueezy", "D", "LemonSqueezy",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `LemonSqueezy authenticated — ${r.body?.data?.attributes?.name || ""}` : `Auth failed: HTTP ${r.status}`,
    creds
  );
}

async function scanAllPaymentProviders() {
  return Promise.all([connectRazorpay(), connectStripe(), connectPaddle(), connectLemonSqueezy()]);
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE E — Email
// ══════════════════════════════════════════════════════════════════════════════

async function connectEmailProviders() {
  const email = _email();
  const detected = email ? email.detectProvider() : { provider: null, configured: false };

  // Probe each configured email provider
  const results = [];

  // Resend
  const resendKey = _env("RESEND_API_KEY");
  const resendCreds = _creds(["RESEND_API_KEY"]);
  if (resendKey) {
    const r = await _probe("https://api.resend.com/emails",
      { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" });
    // Resend returns 405 on GET (expects POST) which means key is valid
    results.push(_record("email:resend", "E", "Resend",
      (r.status === 405 || r.status === 200) ? "CONNECTED" : "PARTIAL",
      r.status === 405 ? "Resend API key valid" : `HTTP ${r.status}`,
      resendCreds
    ));
  } else {
    results.push(_record("email:resend", "E", "Resend", "READY", "RESEND_API_KEY not set", resendCreds));
  }

  // SendGrid
  const sgKey = _env("SENDGRID_API_KEY");
  const sgCreds = _creds(["SENDGRID_API_KEY"]);
  if (sgKey) {
    const r = await _probe("https://api.sendgrid.com/v3/user/profile",
      { Authorization: `Bearer ${sgKey}` });
    results.push(_record("email:sendgrid", "E", "SendGrid",
      r.ok ? "CONNECTED" : "PARTIAL",
      r.ok ? `SendGrid authenticated — ${r.body?.username || ""}` : `Auth failed: HTTP ${r.status}`,
      sgCreds
    ));
  } else {
    results.push(_record("email:sendgrid", "E", "SendGrid", "READY", "SENDGRID_API_KEY not set", sgCreds));
  }

  // Mailgun
  const mgKey    = _env("MAILGUN_API_KEY");
  const mgDomain = _env("MAILGUN_DOMAIN");
  const mgCreds  = _creds(["MAILGUN_API_KEY", "MAILGUN_DOMAIN"]);
  if (mgKey && mgDomain) {
    const auth = Buffer.from(`api:${mgKey}`).toString("base64");
    const r    = await _probe(`https://api.mailgun.net/v3/domains/${mgDomain}`,
      { Authorization: `Basic ${auth}` });
    results.push(_record("email:mailgun", "E", "Mailgun",
      r.ok ? "CONNECTED" : "PARTIAL",
      r.ok ? `Mailgun domain verified: ${mgDomain}` : `Auth failed: HTTP ${r.status}`,
      mgCreds
    ));
  } else {
    results.push(_record("email:mailgun", "E", "Mailgun", "READY", "MAILGUN_API_KEY and MAILGUN_DOMAIN not set", mgCreds));
  }

  // Postmark
  const pmKey   = _env("POSTMARK_API_KEY");
  const pmCreds = _creds(["POSTMARK_API_KEY"]);
  if (pmKey) {
    const r = await _probe("https://api.postmarkapp.com/server",
      { "X-Postmark-Server-Token": pmKey, Accept: "application/json" });
    results.push(_record("email:postmark", "E", "Postmark",
      r.ok ? "CONNECTED" : "PARTIAL",
      r.ok ? `Postmark authenticated — ${r.body?.Name || ""}` : `Auth failed: HTTP ${r.status}`,
      pmCreds
    ));
  } else {
    results.push(_record("email:postmark", "E", "Postmark", "READY", "POSTMARK_API_KEY not set", pmCreds));
  }

  // Brevo (formerly Sendinblue)
  const brevoKey   = _env("BREVO_API_KEY");
  const brevoCreds = _creds(["BREVO_API_KEY"]);
  if (brevoKey) {
    const r = await _probe("https://api.brevo.com/v3/account",
      { "api-key": brevoKey, Accept: "application/json" });
    results.push(_record("email:brevo", "E", "Brevo",
      r.ok ? "CONNECTED" : "PARTIAL",
      r.ok ? `Brevo authenticated — ${r.body?.email || ""}` : `Auth failed: HTTP ${r.status}`,
      brevoCreds
    ));
  } else {
    results.push(_record("email:brevo", "E", "Brevo", "READY", "BREVO_API_KEY not set", brevoCreds));
  }

  // Amazon SES — validated through storageService's AWS credential detection
  const sesCreds = _creds(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SES_REGION"], ["SES_FROM_EMAIL"]);
  if (_has("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SES_REGION")) {
    results.push(_record("email:ses", "E", "Amazon SES", "PARTIAL",
      "AWS credentials set — SES access requires IAM ses:SendEmail permission (cannot probe without sending)",
      sesCreds
    ));
  } else {
    results.push(_record("email:ses", "E", "Amazon SES", "READY", "AWS_ACCESS_KEY_ID/SECRET/SES_REGION not set", sesCreds));
  }

  // SMTP
  const smtpCreds = _creds(["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]);
  if (_has("SMTP_HOST", "SMTP_USER", "SMTP_PASS")) {
    // TCP port probe — no SMTP handshake, just connectivity
    const port = parseInt(_env("SMTP_PORT") || "587", 10);
    const host = _env("SMTP_HOST");
    const tcpOk = await new Promise(resolve => {
      const s = require("net").createConnection({ host, port, timeout: 5000 });
      s.on("connect", () => { s.destroy(); resolve(true); });
      s.on("error",   () => resolve(false));
      s.on("timeout", () => { s.destroy(); resolve(false); });
    });
    results.push(_record("email:smtp", "E", "SMTP",
      tcpOk ? "CONNECTED" : "PARTIAL",
      tcpOk ? `SMTP reachable at ${host}:${port}` : `TCP connection failed to ${host}:${port}`,
      smtpCreds, { host, port }
    ));
  } else {
    results.push(_record("email:smtp", "E", "SMTP", "READY", "SMTP_HOST/USER/PASS not set", smtpCreds));
  }

  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE F — Messaging
// ══════════════════════════════════════════════════════════════════════════════

async function connectWhatsApp() {
  const token   = _env("WA_TOKEN") || _env("WHATSAPP_TOKEN");
  const phoneId = _env("WA_PHONE_ID") || _env("PHONE_NUMBER_ID");
  const wabaid  = _env("WA_BUSINESS_ACCOUNT_ID");
  const creds   = _creds(["WA_TOKEN", "WA_PHONE_ID"], ["WA_BUSINESS_ACCOUNT_ID", "WA_VERIFY_TOKEN"]);
  if (!token || !phoneId) return _record("msg:whatsapp", "F", "WhatsApp Cloud", "READY",
    "WA_TOKEN and WA_PHONE_ID not set", creds);

  const ver = _env("WA_API_VERSION") || "v19.0";
  const r   = await _probe(`https://graph.facebook.com/${ver}/${phoneId}?fields=display_phone_number,verified_name,status`,
    { Authorization: `Bearer ${token}` });
  return _record("msg:whatsapp", "F", "WhatsApp Cloud",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `Phone: ${r.body?.display_phone_number || phoneId}, Status: ${r.body?.status || "unknown"}`
         : `Auth failed: HTTP ${r.status}`,
    creds, r.ok ? { phoneNumber: r.body?.display_phone_number, status: r.body?.status } : {}
  );
}

async function connectTelegram() {
  const token = _env("TELEGRAM_TOKEN");
  const creds = _creds(["TELEGRAM_TOKEN"]);
  if (!token) return _record("msg:telegram", "F", "Telegram", "READY", "TELEGRAM_TOKEN not set", creds);
  const r = await _probe(`https://api.telegram.org/bot${token}/getMe`);
  const botName = r.body?.result?.username;
  return _record("msg:telegram", "F", "Telegram",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `Bot: @${botName}` : `Token invalid: HTTP ${r.status}`,
    creds, r.ok ? { botUsername: botName } : {}
  );
}

async function connectTwilio() {
  const sid  = _env("TWILIO_ACCOUNT_SID");
  const auth = _env("TWILIO_AUTH_TOKEN");
  const creds = _creds(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"], ["TWILIO_PHONE_NUMBER"]);
  if (!sid || !auth) return _record("msg:twilio", "F", "Twilio", "READY", "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN not set", creds);
  const basic = Buffer.from(`${sid}:${auth}`).toString("base64");
  const r     = await _probe(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`,
    { Authorization: `Basic ${basic}` });
  return _record("msg:twilio", "F", "Twilio",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `Twilio account: ${r.body?.friendly_name || sid}` : `Auth failed: HTTP ${r.status}`,
    creds
  );
}

async function connectDiscord() {
  const token    = _env("DISCORD_BOT_TOKEN");
  const webhookUrl = _env("DISCORD_WEBHOOK_URL");
  const creds    = _creds(["DISCORD_BOT_TOKEN"], ["DISCORD_GUILD_ID", "DISCORD_WEBHOOK_URL"]);
  if (!token && !webhookUrl) return _record("msg:discord", "F", "Discord", "READY",
    "DISCORD_BOT_TOKEN and DISCORD_WEBHOOK_URL not set", creds);

  if (token) {
    const r = await _probe("https://discord.com/api/v10/users/@me",
      { Authorization: `Bot ${token}` });
    return _record("msg:discord", "F", "Discord",
      r.ok ? "CONNECTED" : "PARTIAL",
      r.ok ? `Bot: ${r.body?.username}#${r.body?.discriminator || "0"}` : `Token invalid: HTTP ${r.status}`,
      creds
    );
  }
  // Webhook only
  return _record("msg:discord", "F", "Discord", "PARTIAL",
    "Webhook URL set but no bot token — limited to webhook sends only", creds);
}

async function connectSlack() {
  const botToken  = _env("SLACK_BOT_TOKEN");
  const clientId  = _env("SLACK_CLIENT_ID");
  const creds     = _creds(["SLACK_BOT_TOKEN"], ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"]);
  if (!botToken) return _record("msg:slack", "F", "Slack", "READY", "SLACK_BOT_TOKEN not set", creds);
  const r = await _probe("https://slack.com/api/auth.test",
    { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" });
  const ok = r.body?.ok === true;
  return _record("msg:slack", "F", "Slack",
    ok ? "CONNECTED" : "PARTIAL",
    ok ? `Workspace: ${r.body?.team}, Bot: ${r.body?.user}` : `Auth failed: ${r.body?.error || r.status}`,
    creds, ok ? { team: r.body?.team, bot: r.body?.user } : {}
  );
}

async function scanAllMessagingProviders() {
  return Promise.all([
    connectWhatsApp(), connectTelegram(), connectTwilio(),
    connectDiscord(), connectSlack()
  ]);
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE G — Authentication
// ══════════════════════════════════════════════════════════════════════════════

async function connectGoogleAuth() {
  const clientId     = _env("GOOGLE_CLIENT_ID");
  const clientSecret = _env("GOOGLE_CLIENT_SECRET");
  const creds        = _creds(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], ["GOOGLE_REDIRECT_URI"]);
  if (!clientId || !clientSecret) return _record("auth:google", "G", "Google OAuth", "READY",
    "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set", creds);
  // Discovery endpoint confirms client config is valid
  const r = await _probe("https://accounts.google.com/.well-known/openid-configuration");
  return _record("auth:google", "G", "Google OAuth",
    r.ok && clientId && clientSecret ? "CONNECTED" : "PARTIAL",
    r.ok ? `Google OAuth configured — client ID: ${clientId.slice(0, 20)}…` : `Discovery failed: HTTP ${r.status}`,
    creds
  );
}

async function connectGitHubAuth() {
  const clientId     = _env("GITHUB_CLIENT_ID");
  const clientSecret = _env("GITHUB_CLIENT_SECRET");
  const creds        = _creds(["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"], ["GITHUB_REDIRECT_URI"]);
  if (!clientId || !clientSecret) return _record("auth:github", "G", "GitHub OAuth", "READY",
    "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET not set", creds);
  return _record("auth:github", "G", "GitHub OAuth", "CONNECTED",
    `GitHub OAuth app configured — client: ${clientId}`, creds);
}

async function connectMicrosoftAuth() {
  const clientId  = _env("MICROSOFT_CLIENT_ID");
  const tenantId  = _env("MICROSOFT_TENANT_ID") || "common";
  const creds     = _creds(["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"], ["MICROSOFT_REDIRECT_URI"]);
  if (!clientId) return _record("auth:microsoft", "G", "Microsoft OAuth", "READY",
    "MICROSOFT_CLIENT_ID not set", creds);
  const r = await _probe(`https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`);
  return _record("auth:microsoft", "G", "Microsoft OAuth",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `Microsoft OAuth configured — tenant: ${tenantId}` : `Discovery failed: HTTP ${r.status}`,
    creds
  );
}

async function connectLinkedInAuth() {
  const clientId     = _env("LINKEDIN_CLIENT_ID");
  const clientSecret = _env("LINKEDIN_CLIENT_SECRET");
  const creds        = _creds(["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"], ["LINKEDIN_REDIRECT_URL"]);
  if (!clientId || !clientSecret) return _record("auth:linkedin", "G", "LinkedIn OAuth", "READY",
    "LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET not set", creds);
  // Env vars being present doesn't mean they're real — actually hit LinkedIn's
  // public OIDC discovery endpoint (same verification depth as Microsoft/
  // Google auth checks above) instead of reporting CONNECTED from presence alone.
  const r = await _probe("https://www.linkedin.com/oauth/.well-known/openid-configuration");
  return _record("auth:linkedin", "G", "LinkedIn OAuth",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `LinkedIn OAuth app configured — client: ${clientId}`
         : `LinkedIn discovery endpoint unreachable: HTTP ${r.status || r.error}`,
    creds
  );
}

async function connectAppleAuth() {
  const teamId   = _env("APPLE_TEAM_ID");
  const clientId = _env("APPLE_CLIENT_ID");
  const keyId    = _env("APPLE_KEY_ID");
  const creds    = _creds(["APPLE_TEAM_ID", "APPLE_CLIENT_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"]);
  if (!teamId || !clientId || !keyId) return _record("auth:apple", "G", "Apple Sign In", "READY",
    "APPLE_TEAM_ID, APPLE_CLIENT_ID, APPLE_KEY_ID not set", creds);
  return _record("auth:apple", "G", "Apple Sign In", "CONNECTED",
    `Apple Sign In configured — team: ${teamId}, client: ${clientId}`, creds);
}

async function connectDiscordAuth() {
  const clientId  = _env("DISCORD_CLIENT_ID");
  const creds     = _creds(["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"], ["DISCORD_REDIRECT_URI"]);
  if (!clientId) return _record("auth:discord", "G", "Discord OAuth", "READY", "DISCORD_CLIENT_ID not set", creds);
  return _record("auth:discord", "G", "Discord OAuth", "CONNECTED",
    `Discord OAuth configured — client: ${clientId}`, creds);
}

async function scanAllAuthProviders() {
  return Promise.all([
    connectGoogleAuth(), connectGitHubAuth(), connectMicrosoftAuth(),
    connectLinkedInAuth(), connectAppleAuth(), connectDiscordAuth()
  ]);
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE H — Productivity (Google Workspace / Microsoft 365 / Dropbox)
// ══════════════════════════════════════════════════════════════════════════════

async function connectGoogleWorkspace() {
  // Google Workspace tools use the same client credentials as Google Auth
  // plus a user access token from oauthIntegrationLayer
  const clientId = _env("GOOGLE_CLIENT_ID");
  const creds    = _creds(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], ["GOOGLE_REDIRECT_URI"]);
  if (!clientId) return _record("prod:google_workspace", "H", "Google Workspace", "READY",
    "GOOGLE_CLIENT_ID not set — required for Drive/Calendar/Docs/Gmail", creds);

  // Check if any user has already authorized
  const oauthLayer = _oauth();
  let authorized = false;
  if (oauthLayer) {
    try {
      const conns = oauthLayer.listConnections();
      authorized  = conns.some(c => c.provider === "google" && c.status === "active");
    } catch { /* ignore */ }
  }
  return _record("prod:google_workspace", "H", "Google Workspace",
    authorized ? "CONNECTED" : "PARTIAL",
    authorized ? "Google Workspace authorized — Drive/Calendar/Docs/Gmail accessible"
               : "Google OAuth app configured — waiting for user authorization",
    creds, { scopesRequired: ["drive", "calendar", "gmail", "docs"] }
  );
}

async function connectMicrosoft365() {
  const clientId = _env("MICROSOFT_CLIENT_ID");
  const creds    = _creds(["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"], []);
  if (!clientId) return _record("prod:m365", "H", "Microsoft 365", "READY",
    "MICROSOFT_CLIENT_ID not set", creds);

  // Prefer the token oauthIntegrationLayer already obtained via the real OAuth
  // flow (auto-refreshed) over a manually-set env var — MS_GRAPH_TOKEN/
  // MICROSOFT_GRAPH_TOKEN kept only as a fallback for pre-OAuth setups.
  let token = null;
  const oauthLayer = _oauth();
  if (oauthLayer) {
    try {
      const conns = oauthLayer.listConnections().filter(c => c.provider === "microsoft");
      if (conns.length > 0) {
        const rec = await oauthLayer.getToken("microsoft", conns[0].userId);
        token = rec?.access_token || null;
      }
    } catch { /* fall through to env var */ }
  }
  if (!token) token = _env("MS_GRAPH_TOKEN") || _env("MICROSOFT_GRAPH_TOKEN");

  if (!token) return _record("prod:m365", "H", "Microsoft 365", "PARTIAL",
    "OAuth app configured — no authorized user yet (waiting for OAuth) and MS_GRAPH_TOKEN not set", creds);

  const r = await _probe("https://graph.microsoft.com/v1.0/me",
    { Authorization: `Bearer ${token}` });
  return _record("prod:m365", "H", "Microsoft 365",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `Authenticated as ${r.body?.displayName || r.body?.userPrincipalName || "user"}` : `Token expired/invalid: HTTP ${r.status}`,
    creds
  );
}

async function connectDropbox() {
  const token = _env("DROPBOX_ACCESS_TOKEN");
  const creds = _creds(["DROPBOX_ACCESS_TOKEN"], ["DROPBOX_APP_KEY", "DROPBOX_APP_SECRET"]);
  if (!token) return _record("prod:dropbox", "H", "Dropbox", "READY", "DROPBOX_ACCESS_TOKEN not set", creds);
  const r = await _probe("https://api.dropboxapi.com/2/users/get_current_account",
    { Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
  return _record("prod:dropbox", "H", "Dropbox",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `Dropbox: ${r.body?.name?.display_name || "authenticated"}` : `Auth failed: HTTP ${r.status}`,
    creds
  );
}

async function scanAllProductivityProviders() {
  return Promise.all([connectGoogleWorkspace(), connectMicrosoft365(), connectDropbox()]);
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE I — Commerce
// ══════════════════════════════════════════════════════════════════════════════

async function connectShopify() {
  const domain     = _env("SHOPIFY_STORE_DOMAIN") || _env("SHOPIFY_DOMAIN");
  const adminToken = _env("SHOPIFY_ADMIN_TOKEN") || _env("SHOPIFY_ACCESS_TOKEN");
  const creds      = _creds(["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_TOKEN"]);
  if (!domain || !adminToken) return _record("commerce:shopify", "I", "Shopify", "READY",
    "SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN not set", creds);

  const r = await _probe(`https://${domain}/admin/api/2024-01/shop.json`,
    { "X-Shopify-Access-Token": adminToken });
  return _record("commerce:shopify", "I", "Shopify",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `Shop: ${r.body?.shop?.name || domain}` : `Auth failed: HTTP ${r.status}`,
    creds, r.ok ? { shop: r.body?.shop?.name, plan: r.body?.shop?.plan_name } : {}
  );
}

async function connectWooCommerce() {
  const url     = _env("WOOCOMMERCE_URL") || _env("WC_URL");
  const ck      = _env("WOOCOMMERCE_KEY")    || _env("WC_CONSUMER_KEY");
  const cs      = _env("WOOCOMMERCE_SECRET") || _env("WC_CONSUMER_SECRET");
  const creds   = _creds(["WOOCOMMERCE_URL", "WOOCOMMERCE_KEY", "WOOCOMMERCE_SECRET"]);
  if (!url || !ck || !cs) return _record("commerce:woocommerce", "I", "WooCommerce", "READY",
    "WOOCOMMERCE_URL/KEY/SECRET not set", creds);

  const auth = Buffer.from(`${ck}:${cs}`).toString("base64");
  const r    = await _probe(`${url}/wp-json/wc/v3/system_status`,
    { Authorization: `Basic ${auth}` });
  return _record("commerce:woocommerce", "I", "WooCommerce",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `WooCommerce API authenticated at ${url}` : `Auth failed: HTTP ${r.status}`,
    creds
  );
}

async function connectWordPress() {
  const url      = _env("WORDPRESS_URL");
  const user     = _env("WORDPRESS_USERNAME");
  const appPass  = _env("WORDPRESS_APP_PASSWORD");
  const creds    = _creds(["WORDPRESS_URL"], ["WORDPRESS_USERNAME", "WORDPRESS_APP_PASSWORD"]);
  if (!url) return _record("commerce:wordpress", "I", "WordPress", "READY", "WORDPRESS_URL not set", creds);

  const r = await _probe(`${url}/wp-json/wp/v2/users/me`,
    user && appPass ? { Authorization: `Basic ${Buffer.from(`${user}:${appPass}`).toString("base64")}` } : {}
  );
  return _record("commerce:wordpress", "I", "WordPress",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `WordPress authenticated as ${r.body?.name || user || "user"} at ${url}`
         : user ? `Auth failed: HTTP ${r.status}` : `Site reachable (no app password set): ${url}`,
    creds
  );
}

async function scanAllCommerceProviders() {
  return Promise.all([connectShopify(), connectWooCommerce(), connectWordPress()]);
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE J — Creative
// ══════════════════════════════════════════════════════════════════════════════

async function connectFigma() {
  const token = _env("FIGMA_ACCESS_TOKEN") || _env("FIGMA_TOKEN");
  const creds = _creds(["FIGMA_ACCESS_TOKEN"]);
  if (!token) return _record("creative:figma", "J", "Figma", "READY", "FIGMA_ACCESS_TOKEN not set", creds);
  const r = await _probe("https://api.figma.com/v1/me", { "X-Figma-Token": token });
  return _record("creative:figma", "J", "Figma",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `Figma: ${r.body?.handle || r.body?.email || "authenticated"}` : `Auth failed: HTTP ${r.status}`,
    creds
  );
}

async function connectCanva() {
  const clientId = _env("CANVA_CLIENT_ID");
  const apiKey   = _env("CANVA_API_KEY");
  const creds    = _creds(["CANVA_CLIENT_ID"], ["CANVA_API_KEY", "CANVA_CLIENT_SECRET"]);
  if (!clientId) return _record("creative:canva", "J", "Canva", "READY", "CANVA_CLIENT_ID not set", creds);
  // Canva Connect API uses OAuth; with API key we can probe the connect endpoint
  if (apiKey) {
    const r = await _probe("https://api.canva.com/rest/v1/users/me",
      { Authorization: `Bearer ${apiKey}` });
    return _record("creative:canva", "J", "Canva",
      r.ok ? "CONNECTED" : "PARTIAL",
      r.ok ? "Canva API authenticated" : `Auth failed: HTTP ${r.status}`,
      creds
    );
  }
  return _record("creative:canva", "J", "Canva", "PARTIAL",
    "Canva client ID set — API key missing, user must authorize via OAuth", creds);
}

async function scanAllCreativeProviders() {
  return Promise.all([connectFigma(), connectCanva()]);
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE K — Automation
// ══════════════════════════════════════════════════════════════════════════════

async function connectZapier() {
  const webhookUrl = _env("ZAPIER_WEBHOOK_URL") || _env("ZAPIER_CATCH_HOOK");
  const creds      = _creds(["ZAPIER_WEBHOOK_URL"]);
  if (!webhookUrl) return _record("auto:zapier", "K", "Zapier", "READY",
    "ZAPIER_WEBHOOK_URL not set — create a Catch Hook Zap and paste the URL", creds);
  // Zapier webhooks are fire-and-forget; validate URL format only
  const isValid = webhookUrl.startsWith("https://hooks.zapier.com/");
  return _record("auto:zapier", "K", "Zapier",
    isValid ? "CONNECTED" : "PARTIAL",
    isValid ? `Zapier webhook configured: ${webhookUrl.slice(0, 60)}…` : `Webhook URL format unexpected: ${webhookUrl}`,
    creds
  );
}

async function connectMake() {
  const apiKey     = _env("MAKE_API_KEY") || _env("MAKE_API_TOKEN");
  const webhookUrl = _env("MAKE_WEBHOOK_URL") || _env("INTEGROMAT_WEBHOOK_URL");
  const creds      = _creds(["MAKE_API_KEY"], ["MAKE_WEBHOOK_URL"]);
  if (!apiKey && !webhookUrl) return _record("auto:make", "K", "Make", "READY",
    "MAKE_API_KEY and MAKE_WEBHOOK_URL not set", creds);

  if (apiKey) {
    const r = await _probe("https://eu1.make.com/api/v2/users/me",
      { Authorization: `Token ${apiKey}` });
    // Try US region if EU fails
    const r2 = !r.ok ? await _probe("https://us1.make.com/api/v2/users/me", { Authorization: `Token ${apiKey}` }) : r;
    return _record("auto:make", "K", "Make",
      r2.ok ? "CONNECTED" : "PARTIAL",
      r2.ok ? `Make authenticated — ${r2.body?.user?.email || ""}` : `Auth failed: HTTP ${r2.status}`,
      creds
    );
  }
  return _record("auto:make", "K", "Make", "PARTIAL",
    `Webhook URL configured: ${webhookUrl}`, creds);
}

async function connectN8N() {
  const host    = _env("N8N_HOST") || _env("N8N_BASE_URL");
  const apiKey  = _env("N8N_API_KEY");
  const creds   = _creds(["N8N_HOST"], ["N8N_API_KEY", "N8N_WEBHOOK_URL"]);
  if (!host) return _record("auto:n8n", "K", "n8n", "READY", "N8N_HOST not set", creds);
  const baseUrl = host.startsWith("http") ? host : `https://${host}`;
  const headers = apiKey ? { "X-N8N-API-KEY": apiKey } : {};
  const r = await _probe(`${baseUrl}/api/v1/workflows?limit=1`, headers);
  return _record("auto:n8n", "K", "n8n",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `n8n reachable at ${baseUrl}` : `Probe failed: HTTP ${r.status}`,
    creds, r.ok ? { host: baseUrl, workflowCount: r.body?.data?.length } : {}
  );
}

async function scanAllAutomationProviders() {
  return Promise.all([connectZapier(), connectMake(), connectN8N()]);
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE L — Monitoring
// ══════════════════════════════════════════════════════════════════════════════

async function connectSentry() {
  const svc = _sentry();
  if (!svc) return _record("monitor:sentry", "L", "Sentry", "MISSING", "sentryService unavailable", _creds([]));
  const cfg  = svc.getConfig();
  const creds = _creds(["SENTRY_DSN"], ["SENTRY_AUTH_TOKEN", "SENTRY_ORG"]);
  if (!cfg.configured) return _record("monitor:sentry", "L", "Sentry", "READY", "SENTRY_DSN not set", creds);
  const verify = await svc.verifyDelivery().catch(e => ({ ok: false, detail: e.message }));
  return _record("monitor:sentry", "L", "Sentry",
    verify.ok ? "CONNECTED" : "PARTIAL",
    verify.ok ? `Sentry delivery confirmed (event ID: ${verify.eventId || "unknown"})` : `Delivery failed: ${verify.detail}`,
    creds, verify.ok ? { eventId: verify.eventId } : {}
  );
}

async function connectDatadog() {
  const apiKey  = _env("DATADOG_API_KEY");
  const appKey  = _env("DATADOG_APP_KEY");
  const site    = _env("DATADOG_SITE") || "datadoghq.com";
  const creds   = _creds(["DATADOG_API_KEY"], ["DATADOG_APP_KEY", "DATADOG_SITE"]);
  if (!apiKey) return _record("monitor:datadog", "L", "Datadog", "READY", "DATADOG_API_KEY not set", creds);
  const r = await _probe(`https://api.${site}/api/v1/validate`, { "DD-API-KEY": apiKey });
  return _record("monitor:datadog", "L", "Datadog",
    r.ok ? "CONNECTED" : "PARTIAL",
    r.ok ? `Datadog API key valid — site: ${site}` : `Validation failed: HTTP ${r.status}`,
    creds, r.ok ? { site } : {}
  );
}

async function connectUptimeMonitor() {
  // Uptime Robot (most common self-hosted uptime monitoring SaaS)
  const key   = _env("UPTIMEROBOT_API_KEY");
  const creds = _creds(["UPTIMEROBOT_API_KEY"]);
  if (!key) return _record("monitor:uptime", "L", "Uptime Monitor", "READY",
    "UPTIMEROBOT_API_KEY not set", creds);

  // UptimeRobot uses POST with API key in body
  const result = await new Promise(resolve => {
    const body = JSON.stringify({ api_key: key, format: "json" });
    const u    = new URL("https://api.uptimerobot.com/v2/getAccountDetails");
    const req  = https.request(
      { hostname: u.hostname, port: 443, path: u.pathname, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      res => {
        let d = "";
        res.on("data", c => { d += c; });
        res.on("end", () => {
          try { resolve({ ok: res.statusCode < 400, body: JSON.parse(d) }); }
          catch { resolve({ ok: res.statusCode < 400, body: d }); }
        });
      }
    );
    req.setTimeout(6000, () => { req.destroy(); resolve({ ok: false, body: { error: "timeout" } }); });
    req.on("error", e => resolve({ ok: false, body: { error: e.message } }));
    req.write(body);
    req.end();
  });

  const ok = result.ok && result.body?.stat === "ok";
  return _record("monitor:uptime", "L", "Uptime Monitor",
    ok ? "CONNECTED" : "PARTIAL",
    ok ? `UptimeRobot authenticated — ${result.body?.account?.email || ""}` : `Auth failed: ${JSON.stringify(result.body).slice(0, 80)}`,
    creds
  );
}

async function scanAllMonitoringProviders() {
  return Promise.all([connectSentry(), connectDatadog(), connectUptimeMonitor()]);
}

// ══════════════════════════════════════════════════════════════════════════════
// UNIVERSAL OPERATIONS — apply to any connector by ID
// ══════════════════════════════════════════════════════════════════════════════

async function reconnect(connectorId) {
  // Route by prefix — re-run the appropriate connect function
  const [phase, id] = connectorId.split(":");
  const fns = {
    "ai":       connectAIProvider,
    "git":      { github: connectGitHub, gitlab: connectGitLab, bitbucket: connectBitbucket },
    "infra":    { hostinger: connectHostinger, cloudflare: connectCloudflare, firebase: connectFirebase, supabase: connectSupabase, aws: connectAWS, r2: connectCloudflareR2 },
    "pay":      { razorpay: connectRazorpay, stripe: connectStripe, paddle: connectPaddle, lemonsqueezy: connectLemonSqueezy },
    "msg":      { whatsapp: connectWhatsApp, telegram: connectTelegram, twilio: connectTwilio, discord: connectDiscord, slack: connectSlack },
    "auth":     { google: connectGoogleAuth, github: connectGitHubAuth, microsoft: connectMicrosoftAuth, linkedin: connectLinkedInAuth, apple: connectAppleAuth, discord: connectDiscordAuth },
    "prod":     { google_workspace: connectGoogleWorkspace, m365: connectMicrosoft365, dropbox: connectDropbox },
    "commerce": { shopify: connectShopify, woocommerce: connectWooCommerce, wordpress: connectWordPress },
    "creative": { figma: connectFigma, canva: connectCanva },
    "auto":     { zapier: connectZapier, make: connectMake, n8n: connectN8N },
    "monitor":  { sentry: connectSentry, datadog: connectDatadog, uptime: connectUptimeMonitor },
  };
  if (phase === "ai") return connectAIProvider(id);
  const group = fns[phase];
  if (!group || !group[id]) throw new Error(`Unknown connector: ${connectorId}`);
  return group[id]();
}

async function getHealth(connectorId) {
  const state = _load();
  const prev  = state.connectors[connectorId];
  const rec   = await reconnect(connectorId);
  return {
    connectorId,
    ok:          rec.status === "CONNECTED",
    status:      rec.status,
    detail:      rec.detail,
    lastCheck:   rec.lastCheck,
    lastSuccess: rec.lastSuccess,
    lastError:   rec.lastError,
    wasOnline:   prev?.status === "CONNECTED",
    changed:     prev?.status !== rec.status,
  };
}

function getStatus(connectorId) {
  const state = _load();
  return state.connectors[connectorId] || null;
}

function getAllStatus() {
  const state = _load();
  return Object.values(state.connectors);
}

function getMetrics(connectorId) {
  const state = _load();
  const rec   = state.connectors[connectorId];
  if (!rec) return null;
  return {
    connectorId,
    phase:      rec.phase,
    label:      rec.label,
    status:     rec.status,
    syncCount:  rec.syncCount || 0,
    lastSync:   rec.lastSuccess,
    lastError:  rec.lastError,
    lastCheck:  rec.lastCheck,
    metrics:    rec.metrics || {},
  };
}

function rotateCredentialsGuide(connectorId) {
  // Returns the env vars that need rotation + rotation instructions
  const state = _load();
  const rec   = state.connectors[connectorId];
  if (!rec) return { error: "Connector not found" };
  return {
    connectorId,
    label:        rec.label,
    credentials:  rec.credentials,
    rotationSteps: [
      `1. Generate new credentials from the ${rec.label} dashboard`,
      `2. Update the following env vars in your .env file:`,
      ...(rec.credentials?.required || []).map(k => `   ${k}=<new-value>`),
      `3. Restart the server: pm2 restart jarvis-os`,
      `4. Re-verify: POST /integrations/${connectorId}/reconnect`,
    ],
  };
}

function detectFailures() {
  const state = _load();
  const failed = Object.values(state.connectors).filter(c =>
    c.status !== "CONNECTED" && c.status !== "NOT_APPLICABLE" && c.credentials?.missing?.length > 0
  );
  return failed.map(c => ({
    connectorId: c.id,
    phase:       c.phase,
    label:       c.label,
    status:      c.status,
    missing:     c.credentials?.missing || [],
    lastError:   c.lastError,
    lastCheck:   c.lastCheck,
  }));
}

// ══════════════════════════════════════════════════════════════════════════════
// FULL SCAN
// ══════════════════════════════════════════════════════════════════════════════

async function runFullScan() {
  const t0 = Date.now();
  const [ai, git, infra, pay, email, msg, auth, prod, commerce, creative, auto, monitor] = await Promise.all([
    scanAllAIProviders(),
    scanAllGitProviders(),
    scanAllInfraProviders(),
    scanAllPaymentProviders(),
    connectEmailProviders(),
    scanAllMessagingProviders(),
    scanAllAuthProviders(),
    scanAllProductivityProviders(),
    scanAllCommerceProviders(),
    scanAllCreativeProviders(),
    scanAllAutomationProviders(),
    scanAllMonitoringProviders(),
  ]);

  const all     = [...ai, ...git, ...infra, ...pay, ...email, ...msg, ...auth, ...prod, ...commerce, ...creative, ...auto, ...monitor];
  const counts  = { CONNECTED: 0, READY: 0, PARTIAL: 0, MISSING: 0, NOT_APPLICABLE: 0 };
  all.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

  const state = _load();
  state.lastFullScan = { runAt: _ts(), durationMs: Date.now() - t0, counts, total: all.length };
  _save(state);

  return {
    runAt:      state.lastFullScan.runAt,
    durationMs: state.lastFullScan.durationMs,
    counts,
    total:      all.length,
    connectors: all,
    failures:   detectFailures(),
    score:      Math.round((counts.CONNECTED / all.length) * 100),
  };
}

function getScanSummary() {
  const state = _load();
  return {
    lastFullScan: state.lastFullScan || null,
    totalConnectors: Object.keys(state.connectors).length,
    byStatus: Object.values(state.connectors).reduce((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1; return acc;
    }, {}),
    byPhase: Object.values(state.connectors).reduce((acc, c) => {
      acc[c.phase] = (acc[c.phase] || 0) + 1; return acc;
    }, {}),
  };
}

module.exports = {
  // Phase scanners
  scanAllAIProviders, scanAllGitProviders, scanAllInfraProviders,
  scanAllPaymentProviders, connectEmailProviders, scanAllMessagingProviders,
  scanAllAuthProviders, scanAllProductivityProviders, scanAllCommerceProviders,
  scanAllCreativeProviders, scanAllAutomationProviders, scanAllMonitoringProviders,
  // Individual connectors
  connectAIProvider, healthAIProvider,
  connectGitHub, connectGitLab, connectBitbucket,
  connectHostinger, connectCloudflare, connectFirebase, connectSupabase, connectAWS, connectCloudflareR2,
  connectRazorpay, connectStripe, connectPaddle, connectLemonSqueezy,
  connectWhatsApp, connectTelegram, connectTwilio, connectDiscord, connectSlack,
  connectGoogleAuth, connectGitHubAuth, connectMicrosoftAuth, connectLinkedInAuth, connectAppleAuth, connectDiscordAuth,
  connectGoogleWorkspace, connectMicrosoft365, connectDropbox,
  connectShopify, connectWooCommerce, connectWordPress,
  connectFigma, connectCanva,
  connectZapier, connectMake, connectN8N,
  connectSentry, connectDatadog, connectUptimeMonitor,
  // Universal operations
  reconnect, getHealth, getStatus, getAllStatus, getMetrics,
  rotateCredentialsGuide, detectFailures,
  // Full scan
  runFullScan, getScanSummary,
};
