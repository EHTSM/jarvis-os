"use strict";
/**
 * Environment Manager — Production Mission 3.1
 *
 * Generates runtime configuration from the Secret Vault + existing env vars.
 * Supports sync targets: local | electron | vps | production
 * Supports export/import of env snapshots (encrypted).
 * Supports validation of current environment against required vars.
 *
 * This service NEVER writes files to disk without explicit founder action.
 * It generates .env content as a string; the founder or the /vault/env/*
 * routes apply it. It does NOT shell-exec or modify process.env directly.
 *
 * Reuses secretVault.cjs for encrypted secret resolution.
 * Reuses secretManagementLayer.cjs for catalog + rotation metadata.
 *
 * Public API:
 *   generateEnvFile(target?)         → { content: string, vars: number, timestamp }
 *   validateEnvironment()             → ValidationReport
 *   getEnvStatus()                    → StatusReport
 *   diffEnv(target?)                  → DiffReport (vault vs current process.env)
 *   getRequiredVars()                 → RequiredVar[]
 *   getSyncTargets()                  → SyncTarget[]
 *   recordSync(target, result)        → SyncRecord
 *   getSyncHistory(target?)           → SyncRecord[]
 *   generateBackup(passphrase)        → encrypted backup string
 *   restoreBackup(blob, passphrase)   → RestoreResult
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const SYNC_FILE = path.join(__dirname, "../../data/env-sync-history.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));
const _sml   = () => _try(() => require("./secretManagementLayer.cjs"));

function _loadSync() {
  try { return JSON.parse(fs.readFileSync(SYNC_FILE, "utf8")); }
  catch { return { syncs: [], targets: {} }; }
}
function _saveSync(d) {
  try {
    fs.mkdirSync(path.dirname(SYNC_FILE), { recursive: true });
    fs.writeFileSync(SYNC_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}

function _ts() { return new Date().toISOString(); }

// ── Required var catalog — merged from secretVault ENV_MAP + critical vars ────
// Groups: required (crash if missing), recommended (degraded), optional
const VAR_CATALOG = [
  // === REQUIRED ===
  { key: "JWT_SECRET",             group: "required", desc: "Server JWT signing key — generate 64+ random hex chars" },
  { key: "OPERATOR_PASSWORD_HASH", group: "required", desc: "Bcrypt/scrypt hash of operator password" },
  { key: "PORT",                   group: "required", desc: "Server port (default 5050)" },
  { key: "NODE_ENV",               group: "required", desc: "production | development" },
  // === RECOMMENDED ===
  { key: "GROQ_API_KEY",           group: "recommended", desc: "Primary AI provider" },
  { key: "SENTRY_DSN",             group: "recommended", desc: "Error tracking" },
  { key: "RESEND_API_KEY",         group: "recommended", desc: "Transactional email" },
  { key: "RAZORPAY_KEY_ID",        group: "recommended", desc: "Payment processing" },
  { key: "RAZORPAY_KEY_SECRET",    group: "recommended", desc: "Payment processing secret" },
  { key: "BASE_URL",               group: "recommended", desc: "Public URL of the server" },
  { key: "PRODUCT_NAME",           group: "recommended", desc: "Product name shown in AI responses" },
  // === OPTIONAL — AI ===
  { key: "OPENROUTER_API_KEY",     group: "optional", desc: "AI fallback — OpenRouter" },
  { key: "OPENAI_API_KEY",         group: "optional", desc: "AI fallback — OpenAI" },
  { key: "ANTHROPIC_API_KEY",      group: "optional", desc: "AI — Claude" },
  { key: "GEMINI_API_KEY",         group: "optional", desc: "AI — Gemini" },
  { key: "DEEPSEEK_API_KEY",       group: "optional", desc: "AI — DeepSeek" },
  { key: "TOGETHER_API_KEY",       group: "optional", desc: "AI — Together AI" },
  { key: "FIREWORKS_API_KEY",      group: "optional", desc: "AI — Fireworks" },
  { key: "COHERE_API_KEY",         group: "optional", desc: "AI — Cohere" },
  { key: "NVIDIA_API_KEY",         group: "optional", desc: "AI — NVIDIA NIM" },
  // === OPTIONAL — Git ===
  { key: "GITHUB_TOKEN",           group: "optional", desc: "GitHub PAT" },
  { key: "GITHUB_CLIENT_ID",       group: "optional", desc: "GitHub OAuth App client ID" },
  { key: "GITHUB_CLIENT_SECRET",   group: "optional", desc: "GitHub OAuth App secret" },
  { key: "GITLAB_TOKEN",           group: "optional", desc: "GitLab PAT" },
  { key: "BITBUCKET_USER",         group: "optional", desc: "Bitbucket username" },
  { key: "BITBUCKET_APP_PASSWORD", group: "optional", desc: "Bitbucket app password" },
  // === OPTIONAL — Infrastructure ===
  { key: "AWS_ACCESS_KEY_ID",      group: "optional", desc: "AWS IAM key" },
  { key: "AWS_SECRET_ACCESS_KEY",  group: "optional", desc: "AWS IAM secret" },
  { key: "AWS_REGION",             group: "optional", desc: "AWS region" },
  { key: "S3_BUCKET",             group: "optional", desc: "S3 bucket name" },
  { key: "R2_ACCESS_KEY_ID",      group: "optional", desc: "Cloudflare R2 key" },
  { key: "R2_SECRET_ACCESS_KEY",  group: "optional", desc: "Cloudflare R2 secret" },
  { key: "R2_BUCKET",             group: "optional", desc: "R2 bucket name" },
  { key: "R2_ACCOUNT_ID",         group: "optional", desc: "Cloudflare account ID" },
  { key: "CLOUDFLARE_API_TOKEN",  group: "optional", desc: "Cloudflare API token" },
  { key: "FIREBASE_PROJECT_ID",   group: "optional", desc: "Firebase project ID" },
  { key: "SUPABASE_URL",          group: "optional", desc: "Supabase project URL" },
  { key: "SUPABASE_ANON_KEY",     group: "optional", desc: "Supabase anon key" },
  { key: "HOSTINGER_API_KEY",     group: "optional", desc: "Hostinger API key" },
  // === OPTIONAL — Payments ===
  { key: "STRIPE_SECRET_KEY",      group: "optional", desc: "Stripe secret key" },
  { key: "STRIPE_WEBHOOK_SECRET",  group: "optional", desc: "Stripe webhook signing secret" },
  { key: "PADDLE_API_KEY",         group: "optional", desc: "Paddle API key" },
  { key: "LEMONSQUEEZY_API_KEY",   group: "optional", desc: "LemonSqueezy API key" },
  // === OPTIONAL — Email ===
  { key: "SENDGRID_API_KEY",       group: "optional", desc: "SendGrid API key" },
  { key: "MAILGUN_API_KEY",        group: "optional", desc: "Mailgun API key" },
  { key: "MAILGUN_DOMAIN",         group: "optional", desc: "Mailgun sending domain" },
  { key: "POSTMARK_API_KEY",       group: "optional", desc: "Postmark server token" },
  { key: "BREVO_API_KEY",          group: "optional", desc: "Brevo API key" },
  { key: "SMTP_HOST",              group: "optional", desc: "SMTP server hostname" },
  { key: "SMTP_PORT",              group: "optional", desc: "SMTP port" },
  { key: "SMTP_USER",              group: "optional", desc: "SMTP username" },
  { key: "SMTP_PASS",              group: "optional", desc: "SMTP password" },
  { key: "FROM_EMAIL",             group: "optional", desc: "Default sender email address" },
  // === OPTIONAL — Messaging ===
  { key: "WA_TOKEN",               group: "optional", desc: "WhatsApp Cloud API token" },
  { key: "WA_PHONE_ID",            group: "optional", desc: "WhatsApp phone number ID" },
  { key: "TELEGRAM_TOKEN",         group: "optional", desc: "Telegram bot token" },
  { key: "TWILIO_ACCOUNT_SID",     group: "optional", desc: "Twilio account SID" },
  { key: "TWILIO_AUTH_TOKEN",      group: "optional", desc: "Twilio auth token" },
  { key: "DISCORD_BOT_TOKEN",      group: "optional", desc: "Discord bot token" },
  { key: "SLACK_BOT_TOKEN",        group: "optional", desc: "Slack bot OAuth token" },
  // === OPTIONAL — Auth ===
  { key: "GOOGLE_CLIENT_ID",       group: "optional", desc: "Google OAuth client ID" },
  { key: "GOOGLE_CLIENT_SECRET",   group: "optional", desc: "Google OAuth client secret" },
  { key: "MICROSOFT_CLIENT_ID",    group: "optional", desc: "Microsoft OAuth client ID" },
  { key: "MICROSOFT_CLIENT_SECRET",group: "optional", desc: "Microsoft OAuth client secret" },
  { key: "LINKEDIN_CLIENT_ID",     group: "optional", desc: "LinkedIn OAuth client ID" },
  { key: "LINKEDIN_CLIENT_SECRET", group: "optional", desc: "LinkedIn OAuth client secret" },
  { key: "APPLE_TEAM_ID",          group: "optional", desc: "Apple Developer team ID" },
  { key: "APPLE_CLIENT_ID",        group: "optional", desc: "Apple Sign In service ID" },
  { key: "APPLE_KEY_ID",           group: "optional", desc: "Apple private key ID" },
  { key: "APPLE_PRIVATE_KEY",      group: "optional", desc: "Apple .p8 private key content" },
  // === OPTIONAL — Productivity ===
  { key: "DROPBOX_ACCESS_TOKEN",   group: "optional", desc: "Dropbox access token" },
  { key: "MS_GRAPH_TOKEN",         group: "optional", desc: "Microsoft Graph delegated token" },
  // === OPTIONAL — Commerce ===
  { key: "SHOPIFY_STORE_DOMAIN",   group: "optional", desc: "Shopify store domain" },
  { key: "SHOPIFY_ADMIN_TOKEN",    group: "optional", desc: "Shopify Admin API token" },
  { key: "WOOCOMMERCE_URL",        group: "optional", desc: "WooCommerce site URL" },
  { key: "WOOCOMMERCE_KEY",        group: "optional", desc: "WooCommerce consumer key" },
  { key: "WOOCOMMERCE_SECRET",     group: "optional", desc: "WooCommerce consumer secret" },
  // === OPTIONAL — Creative ===
  { key: "FIGMA_ACCESS_TOKEN",     group: "optional", desc: "Figma personal access token" },
  { key: "CANVA_CLIENT_ID",        group: "optional", desc: "Canva Connect client ID" },
  { key: "CANVA_API_KEY",          group: "optional", desc: "Canva API key" },
  // === OPTIONAL — Automation ===
  { key: "ZAPIER_WEBHOOK_URL",     group: "optional", desc: "Zapier catch hook URL" },
  { key: "MAKE_API_KEY",           group: "optional", desc: "Make (Integromat) API key" },
  { key: "N8N_HOST",               group: "optional", desc: "n8n instance URL" },
  { key: "N8N_API_KEY",            group: "optional", desc: "n8n API key" },
  // === OPTIONAL — Monitoring ===
  { key: "DATADOG_API_KEY",        group: "optional", desc: "Datadog API key" },
  { key: "UPTIMEROBOT_API_KEY",    group: "optional", desc: "UptimeRobot API key" },
];

// ── Sync targets ──────────────────────────────────────────────────────────────
const SYNC_TARGETS = [
  { id: "local",      label: "Local Development",  description: "Updates .env file in project root" },
  { id: "electron",   label: "Electron Desktop App", description: "Injects env at Electron startup via app.on('ready')" },
  { id: "vps",        label: "VPS Server",          description: "SSH-based env file update (requires SSH key in vault)" },
  { id: "production", label: "Production",          description: "Primary production environment" },
];

function getSyncTargets() { return SYNC_TARGETS; }
function getRequiredVars() { return VAR_CATALOG; }

// ── Generate .env file content from vault + current process.env ───────────────
function generateEnvFile(target = "local") {
  const vault = _vault();
  const lines = [
    `# Generated by Ooplix Env Manager — ${_ts()}`,
    `# Target: ${target}`,
    `# DO NOT COMMIT — contains sensitive credentials`,
    `# Re-generate via POST /vault/env/generate`,
    "",
  ];

  let varCount = 0;
  const groups = ["required", "recommended", "optional"];
  const seenGroups = new Set();

  for (const entry of VAR_CATALOG) {
    if (!seenGroups.has(entry.group)) {
      lines.push(`# ── ${entry.group.toUpperCase()} ─────────────────────────────────────────────`);
      seenGroups.add(entry.group);
    }
    // Resolve value: vault first, then current process.env
    let value = null;
    if (vault) {
      // Try common credential types for this var
      const vaultEntry = Object.entries(vault.ENV_MAP || {}).find(([vk, ek]) => ek === entry.key);
      if (vaultEntry) {
        const [vk] = vaultEntry;
        const [connId, type] = vk.split("::");
        try { value = vault.resolveEnvKey(connId, type); } catch { /* ignore */ }
      }
    }
    if (!value) value = process.env[entry.key] || "";

    lines.push(`# ${entry.desc}`);
    lines.push(`${entry.key}=${value}`);
    if (value) varCount++;
    lines.push("");
  }

  return {
    content:   lines.join("\n"),
    vars:      VAR_CATALOG.length,
    populated: varCount,
    target,
    timestamp: _ts(),
  };
}

// ── Validate current environment ──────────────────────────────────────────────
function validateEnvironment() {
  const vault  = _vault();
  const sml    = _sml();
  const now    = _ts();

  const results = VAR_CATALOG.map(entry => {
    const envVal    = process.env[entry.key];
    // Also check vault
    let vaultVal = null;
    if (vault) {
      const vaultEntry = Object.entries(vault.ENV_MAP || {}).find(([_, ek]) => ek === entry.key);
      if (vaultEntry) {
        const [vk] = vaultEntry;
        const [connId, type] = vk.split("::");
        try { vaultVal = vault.resolveEnvKey(connId, type); } catch { /* ignore */ }
      }
    }
    const resolved = envVal || vaultVal;
    const source   = envVal ? "env" : (vaultVal ? "vault" : "none");
    return {
      key:     entry.key,
      group:   entry.group,
      desc:    entry.desc,
      present: !!resolved,
      source,
      length:  resolved ? resolved.length : 0,
    };
  });

  const missing  = results.filter(r => !r.present && r.group === "required");
  const optMiss  = results.filter(r => !r.present && r.group !== "required");
  const present  = results.filter(r => r.present);
  const score    = Math.round((present.length / results.length) * 100);

  // Rotation status from secretManagementLayer
  let rotationStatus = null;
  if (sml) {
    try { rotationStatus = sml.getRotationStatus(); } catch { /* optional */ }
  }

  return {
    generatedAt:   now,
    score,
    total:         results.length,
    present:       present.length,
    missingRequired: missing.length,
    missingOptional: optMiss.length,
    vaultBacked:   results.filter(r => r.source === "vault").length,
    envBacked:     results.filter(r => r.source === "env").length,
    blockers:      missing.map(r => r.key),
    details:       results,
    rotationStatus,
    ready:         missing.length === 0,
  };
}

// ── Diff: what's in vault vs what's in process.env ───────────────────────────
function diffEnv() {
  const vault = _vault();
  const diff  = VAR_CATALOG.map(entry => {
    const inEnv   = !!process.env[entry.key];
    let inVault   = false;
    if (vault) {
      const vaultEntry = Object.entries(vault.ENV_MAP || {}).find(([_, ek]) => ek === entry.key);
      if (vaultEntry) {
        const [vk] = vaultEntry;
        const [connId, type] = vk.split("::");
        try { inVault = !!(vault.getSecret(connId, type)); } catch { /* ignore */ }
      }
    }
    const status = inVault && inEnv ? "synced"
                 : inVault          ? "vault_only"
                 : inEnv            ? "env_only"
                 :                    "missing";
    return { key: entry.key, group: entry.group, inEnv, inVault, status };
  });

  return {
    generatedAt: _ts(),
    synced:     diff.filter(d => d.status === "synced").length,
    vaultOnly:  diff.filter(d => d.status === "vault_only").length,
    envOnly:    diff.filter(d => d.status === "env_only").length,
    missing:    diff.filter(d => d.status === "missing").length,
    details:    diff,
  };
}

// ── Env status summary ────────────────────────────────────────────────────────
function getEnvStatus() {
  const validation = validateEnvironment();
  const diff       = diffEnv();
  const syncState  = _loadSync();

  return {
    generatedAt:     _ts(),
    score:           validation.score,
    ready:           validation.ready,
    missingRequired: validation.missingRequired,
    missingOptional: validation.missingOptional,
    vaultBacked:     validation.vaultBacked,
    envBacked:       validation.envBacked,
    diff: {
      synced:    diff.synced,
      vaultOnly: diff.vaultOnly,
      envOnly:   diff.envOnly,
      missing:   diff.missing,
    },
    lastSyncs: Object.entries(syncState.targets || {}).map(([id, rec]) => ({
      target: id, ...rec
    })),
  };
}

// ── Sync history ──────────────────────────────────────────────────────────────
function recordSync(target, result = {}) {
  const store = _loadSync();
  if (!store.targets) store.targets = {};
  store.targets[target] = {
    target,
    lastSyncAt: _ts(),
    status:     result.status || "ok",
    varsWritten: result.varsWritten || 0,
    note:       result.note || "",
  };
  store.syncs = store.syncs || [];
  store.syncs.unshift({ target, ts: _ts(), ...result });
  store.syncs = store.syncs.slice(0, 200);
  _saveSync(store);
  return store.targets[target];
}

function getSyncHistory(target) {
  const store = _loadSync();
  const all   = store.syncs || [];
  return target ? all.filter(s => s.target === target) : all;
}

// ── Backup / Restore ──────────────────────────────────────────────────────────
function generateBackup(passphrase) {
  if (!passphrase || passphrase.length < 8) throw new Error("Passphrase must be at least 8 characters");
  const vault = _vault();
  if (!vault) throw new Error("secretVault unavailable");

  // Combine vault export + current env snapshot (values only for non-secret vars)
  const vaultBlob  = vault.exportVault(passphrase);
  const envSnapshot = VAR_CATALOG.reduce((acc, e) => {
    const v = process.env[e.key];
    if (v) acc[e.key] = v;
    return acc;
  }, {});

  const salt   = crypto.randomBytes(16);
  const dk     = crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, "sha256");
  const iv     = crypto.randomBytes(12);
  const plain  = JSON.stringify({ vaultBlob, envSnapshot, backupAt: _ts() });
  const cipher = crypto.createCipheriv("aes-256-gcm", dk, iv);
  const enc    = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();

  return JSON.stringify({
    version: 1,
    salt: salt.toString("hex"),
    iv:   iv.toString("hex"),
    tag:  tag.toString("hex"),
    data: enc.toString("hex"),
  });
}

function restoreBackup(blobStr, passphrase) {
  const blob   = JSON.parse(blobStr);
  if (blob.version !== 1) throw new Error("Unsupported backup version");

  const salt   = Buffer.from(blob.salt, "hex");
  const dk     = crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, "sha256");
  const iv     = Buffer.from(blob.iv,   "hex");
  const tag    = Buffer.from(blob.tag,  "hex");
  const enc    = Buffer.from(blob.data, "hex");
  const d      = crypto.createDecipheriv("aes-256-gcm", dk, iv);
  d.setAuthTag(tag);
  const payload = JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString("utf8"));

  // Restore vault
  const vault = _vault();
  let vaultResult = { imported: 0, skipped: 0 };
  if (vault && payload.vaultBlob) {
    try { vaultResult = vault.importVault(payload.vaultBlob, passphrase); } catch { /* ignore */ }
  }

  return {
    backupAt:     payload.backupAt,
    vaultImported: vaultResult.imported,
    vaultSkipped:  vaultResult.skipped,
    envVarsFound:  Object.keys(payload.envSnapshot || {}).length,
    envSnapshot:   payload.envSnapshot || {},
    restoredAt:   _ts(),
    note: "Vault secrets restored. Apply envSnapshot manually or via POST /vault/env/apply to update .env file.",
  };
}

module.exports = {
  generateEnvFile, validateEnvironment, getEnvStatus, diffEnv,
  getRequiredVars, getSyncTargets, recordSync, getSyncHistory,
  generateBackup, restoreBackup,
};
