"use strict";
/**
 * Secret Vault — Production Mission 3.1
 *
 * Unified encrypted secret store for all 57 production connectors.
 * Supports 12 credential types. Credentials are stored AES-256-GCM
 * encrypted at rest in data/vault.json. Key = SHA-256(JWT_SECRET).
 *
 * Reuses encryption pattern from oauthIntegrationLayer.cjs.
 * Does NOT duplicate any connector or integration logic.
 * Does NOT store plaintext values — ever.
 *
 * Vault lookup order (used by integrationConnectors.cjs):
 *   1. Vault (encrypted store)
 *   2. Environment variable (fallback)
 *   3. undefined (not configured)
 *
 * Credential types:
 *   oauth_token | refresh_token | api_key | personal_access_token |
 *   ssh_key | jwt_secret | service_account_json | smtp_credentials |
 *   database_credentials | webhook_secret | certificate | license_key
 *
 * Public API:
 *   storeSecret(connectorId, type, value, meta)   → SecretRecord
 *   getSecret(connectorId, type?)                 → string | SecretRecord | null
 *   listSecrets(filter?)                          → SecretRecord[]
 *   deleteSecret(connectorId, type)               → boolean
 *   rotateSecret(connectorId, type, newValue)     → SecretRecord
 *   getHealth(connectorId?)                       → HealthReport
 *   validateSecret(connectorId, type)             → ValidationResult
 *   exportVault(passphrase)                       → encrypted backup blob
 *   importVault(blob, passphrase)                 → { imported, skipped }
 *   getHistory(connectorId?)                      → HistoryEntry[]
 *   getDashboard()                                → DashboardReport
 *   resolveEnvKey(connectorId, type)              → value (vault then env)
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const VAULT_FILE   = path.join(__dirname, "../../data/vault.json");
const HISTORY_FILE = path.join(__dirname, "../../data/vault-history.json");
const AUDIT_FILE    = path.join(__dirname, "../../data/vault-access-audit.json");
const KDF_SALT_FILE = path.join(__dirname, "../../data/vault-kdf-salt.bin");

function _try(fn) { try { return fn(); } catch { return null; } }
function _orgService() { return _try(() => require("./organizationService.cjs")); }

// ── Org-scoping enforcement (Vault Security Hardening) ───────────────────────
// Prior state: every function below accepted an orgId parameter purely as a
// storage-key component (_vkey()) — nothing verified the CALLER was actually
// authorized for that org. A caller that (accidentally or maliciously) passed
// a different orgId string could transparently read/write/rotate/delete that
// other org's secret. This closes that gap additively: when a caller passes
// a requestingAccountId, the org membership is genuinely verified via the
// real organizationService.hasPermission() (no new permission model) before
// the vault operation proceeds. Existing call sites that don't pass
// requestingAccountId (there are several — internal service-to-service calls
// that already resolved authorization at a higher layer, e.g.
// companyFactory.js's routes, which call organizationService's own
// _requireCompanyOrgPermission() before ever reaching the vault) are
// completely unaffected — this is opt-in stricter checking, not a breaking
// change to every caller.
//
// GLOBAL_ORG is exempt from this check — it is the founder/operator-only
// vault partition (founderVault.js's routes, gated by operatorOnly
// middleware upstream), not a multi-tenant org a regular account could ever
// legitimately claim membership in.
function _assertOrgAccess(orgId, requestingAccountId, action) {
  if (!requestingAccountId) return; // opt-in: no accountId passed = no check (backward compatible)
  if (!orgId || orgId === GLOBAL_ORG) return; // founder/operator vault partition — gated upstream, not per-org
  const org = _orgService();
  if (!org) return; // organizationService unavailable — fail open only in a genuinely broken install, matching this file's existing _try()-everywhere convention
  if (!org.hasPermission(orgId, requestingAccountId, action)) {
    const err = new Error(`Forbidden — account is not authorized for org ${orgId}`);
    err.status = 403;
    throw err;
  }
}

// ── Vault access audit log (Vault Security Hardening) ────────────────────────
// Separate from _appendHistory() (which records store/rotate/delete events
// keyed by connectorId — an operational log). This is a security audit
// trail specifically for plaintext reveals: who saw which secret's raw
// value, when, and why. Append-only, capped, mode 0600 like every other
// vault file.
function _loadAudit() {
  try { return JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8")); } catch { return []; }
}
function _appendAudit(entry) {
  const a = _loadAudit();
  a.unshift({ ...entry, ts: new Date().toISOString() });
  const trimmed = a.slice(0, 1000);
  try {
    const dir = path.dirname(AUDIT_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(trimmed, null, 2), { mode: 0o600 });
    fs.chmodSync(AUDIT_FILE, 0o600);
  } catch { /* non-fatal — audit logging must never block the underlying operation */ }
}
function getAccessAudit({ connectorId, limit = 200 } = {}) {
  const all = _loadAudit();
  const filtered = connectorId ? all.filter(e => e.connectorId === connectorId) : all;
  return filtered.slice(0, limit);
}

// ── Encryption (AES-256-GCM) ──────────────────────────────────────────────────
// Vault Security Hardening — key derivation upgrade.
//
// Prior: the AES-256-GCM key was crypto.createHash("sha256").update(JWT_SECRET)
// — a single unsalted hash. JWT_SECRET is already high-entropy (it's a real
// signing secret, not a user password), so this was never brute-forceable
// like a weak-password KDF gap would be; the actual weakness was structural:
// no salt (the exact same key is derivable by anyone who ever learns
// JWT_SECRET, with no per-install variance) and no cryptographic domain
// separation from JWT signing's own use of the same secret.
//
// Fix: HKDF-SHA256 (RFC 5869) with a random, persistent, per-install salt
// (data/vault-kdf-salt.bin, generated once, mode 0600) and an explicit
// "info" context string that cryptographically separates this derived key
// from any other use of JWT_SECRET (e.g. JWT signing itself). HKDF, not
// PBKDF2/scrypt, is the correct primitive here: PBKDF2/scrypt exist to slow
// down brute-forcing a LOW-entropy secret (a human password); JWT_SECRET is
// already high-entropy key material, so what's needed is key separation via
// HKDF's extract-and-expand construction, not added computational cost.
//
// Ciphertext stays AES-256-GCM, encoded as before, with one additive change:
// new ciphertext is prefixed "v2:" (v2:iv:tag:enc). Ciphertext with no
// recognized version prefix (the old iv:tag:enc, 3-part hex format) is
// decrypted with the legacy raw-SHA-256 key — every credential already
// encrypted under the old scheme keeps working with zero migration or
// re-encryption required. New writes always use the new key.
function _legacyKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET required for vault encryption");
  return crypto.createHash("sha256").update(secret).digest();
}

function _kdfSalt() {
  try {
    return fs.readFileSync(KDF_SALT_FILE);
  } catch {
    const salt = crypto.randomBytes(32);
    try {
      fs.mkdirSync(path.dirname(KDF_SALT_FILE), { recursive: true });
      const tmp = `${KDF_SALT_FILE}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
      fs.writeFileSync(tmp, salt, { mode: 0o600 });
      fs.renameSync(tmp, KDF_SALT_FILE);
    } catch { /* if persistence fails, still return this salt for this process's lifetime */ }
    return salt;
  }
}

function _key() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET required for vault encryption");
  const salt = _kdfSalt();
  const info = Buffer.from("jarvis-os:secretVault:aes-256-gcm:v2", "utf8");
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(secret, "utf8"), salt, info, 32));
}

function _encrypt(plaintext) {
  const k   = _key();
  const iv  = crypto.randomBytes(12);
  const c   = crypto.createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return "v2:" + iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}

function _decrypt(ciphertext) {
  const parts = ciphertext.split(":");
  const isV2  = parts.length === 4 && parts[0] === "v2";
  const [ivHex, tagHex, encHex] = isV2 ? parts.slice(1) : parts;
  if (!ivHex || !tagHex || !encHex) throw new Error("Invalid ciphertext format");
  const k   = isV2 ? _key() : _legacyKey();
  const iv  = Buffer.from(ivHex,  "hex");
  const tag = Buffer.from(tagHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  const d   = crypto.createDecipheriv("aes-256-gcm", k, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ── Persistence ───────────────────────────────────────────────────────────────
function _load() {
  try { return JSON.parse(fs.readFileSync(VAULT_FILE, "utf8")); }
  catch { return { secrets: {}, meta: {} }; }
}
function _save(d) {
  const dir = path.dirname(VAULT_FILE);
  fs.mkdirSync(dir, { recursive: true });
  // Vault Security Hardening: the tmp filename used to be a fixed
  // `${VAULT_FILE}.tmp` shared by every caller. Under concurrent
  // storeSecret()/deleteSecret()/rotateSecret() calls in the same
  // process (confirmed via a real test failure: two concurrent stores
  // raced, one's renameSync() completed before the other's chmodSync()
  // ran against the now-renamed-away path, throwing ENOENT), a second
  // call's write could be silently lost or crash mid-save. A unique
  // per-call tmp name (pid + random) makes concurrent saves independent;
  // each still atomically replaces VAULT_FILE via renameSync.
  const tmp = `${VAULT_FILE}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  // mode 0o600 set atomically at creation: vault holds AES-GCM ciphertext
  // of live credentials — other local users/processes on the same host
  // must not be able to read it. (A separate chmodSync() after the write
  // was redundant AND the actual race window above — removed.)
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, VAULT_FILE);
}
function _loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")); }
  catch { return []; }
}
function _appendHistory(entry) {
  const h = _loadHistory();
  h.unshift({ ...entry, ts: new Date().toISOString() });
  const trimmed = h.slice(0, 500);
  try {
    const dir = path.dirname(HISTORY_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), { mode: 0o600 });
    fs.chmodSync(HISTORY_FILE, 0o600);
  } catch { /* non-fatal */ }
}

function _ts()  { return new Date().toISOString(); }

// GLOBAL_ORG is the implicit tenant for every pre-multi-tenant install and
// for any caller that doesn't pass an orgId. Its key format
// (`connectorId::type`) is unchanged from before org-scoping existed, so
// every credential already in data/vault.json today stays reachable with
// zero migration. Only a real, non-default orgId gets the `orgId::` prefix —
// this makes org isolation strictly additive: existing single-tenant
// deployments and already-configured connectors are byte-for-byte
// unaffected.
const GLOBAL_ORG = "global";
function _vkey(connectorId, type, orgId = GLOBAL_ORG) {
  return orgId && orgId !== GLOBAL_ORG ? `${orgId}::${connectorId}::${type}` : `${connectorId}::${type}`;
}
// Recover the orgId a stored key belongs to, for filtering/iteration.
function _keyOrg(vaultKey) {
  const parts = vaultKey.split("::");
  return parts.length === 3 ? parts[0] : GLOBAL_ORG;
}

// ── Credential type definitions ───────────────────────────────────────────────
const CRED_TYPES = new Set([
  "oauth_token", "refresh_token", "api_key", "personal_access_token",
  "ssh_key", "jwt_secret", "service_account_json", "smtp_credentials",
  "database_credentials", "webhook_secret", "certificate", "license_key",
]);

// Rotation TTL defaults by credential type (days)
const ROTATION_TTL = {
  oauth_token:           30,
  refresh_token:        365,
  api_key:              180,
  personal_access_token: 90,
  ssh_key:              365,
  jwt_secret:            90,
  service_account_json: 365,
  smtp_credentials:     180,
  database_credentials:  90,
  webhook_secret:       180,
  certificate:          365,
  license_key:          365,
};

// ── Env var map — maps connector:type to known env var names ─────────────────
// Used by resolveEnvKey() to fall back to env vars when vault entry absent
const ENV_MAP = {
  // Phase A — AI
  "ai:groq::api_key":           "GROQ_API_KEY",
  "ai:openrouter::api_key":     "OPENROUTER_API_KEY",
  "ai:openai::api_key":         "OPENAI_API_KEY",
  "ai:anthropic::api_key":      "ANTHROPIC_API_KEY",
  "ai:gemini::api_key":         "GEMINI_API_KEY",
  "ai:deepseek::api_key":       "DEEPSEEK_API_KEY",
  "ai:together::api_key":       "TOGETHER_API_KEY",
  "ai:fireworks::api_key":      "FIREWORKS_API_KEY",
  "ai:cohere::api_key":         "COHERE_API_KEY",
  "ai:nvidia::api_key":         "NVIDIA_API_KEY",
  "ai:grok::api_key":           "GROK_API_KEY",
  "ai:qwen::api_key":           "DASHSCOPE_API_KEY",
  // Phase B — Git
  "git:github::personal_access_token": "GITHUB_TOKEN",
  "git:github::oauth_token":    "GITHUB_CLIENT_SECRET",
  "git:gitlab::personal_access_token": "GITLAB_TOKEN",
  "git:bitbucket::personal_access_token": "BITBUCKET_APP_PASSWORD",
  // Phase C — Infra
  "infra:aws::api_key":         "AWS_ACCESS_KEY_ID",
  "infra:aws::webhook_secret":  "AWS_SECRET_ACCESS_KEY",
  "infra:r2::api_key":          "R2_ACCESS_KEY_ID",
  "infra:r2::webhook_secret":   "R2_SECRET_ACCESS_KEY",
  "infra:cloudflare::api_key":  "CLOUDFLARE_API_TOKEN",
  "infra:hostinger::api_key":   "HOSTINGER_API_KEY",
  "infra:supabase::api_key":    "SUPABASE_SERVICE_KEY",
  "infra:firebase::service_account_json": "FIREBASE_SERVICE_ACCOUNT",
  // Phase D — Payments
  "pay:razorpay::api_key":      "RAZORPAY_KEY_ID",
  "pay:razorpay::webhook_secret": "RAZORPAY_WEBHOOK_SECRET",
  "pay:stripe::api_key":        "STRIPE_SECRET_KEY",
  "pay:stripe::webhook_secret": "STRIPE_WEBHOOK_SECRET",
  "pay:paddle::api_key":        "PADDLE_API_KEY",
  "pay:paddle::webhook_secret": "PADDLE_WEBHOOK_SECRET",
  "pay:lemonsqueezy::api_key":  "LEMONSQUEEZY_API_KEY",
  "pay:lemonsqueezy::webhook_secret": "LEMONSQUEEZY_WEBHOOK_SECRET",
  // Phase E — Email
  "email:resend::api_key":      "RESEND_API_KEY",
  "email:sendgrid::api_key":    "SENDGRID_API_KEY",
  "email:mailgun::api_key":     "MAILGUN_API_KEY",
  "email:postmark::api_key":    "POSTMARK_API_KEY",
  "email:brevo::api_key":       "BREVO_API_KEY",
  "email:smtp::smtp_credentials": "SMTP_PASS",
  // Phase F — Messaging
  "msg:whatsapp::api_key":      "WA_TOKEN",
  "msg:telegram::api_key":      "TELEGRAM_TOKEN",
  "msg:twilio::api_key":        "TWILIO_AUTH_TOKEN",
  "msg:discord::api_key":       "DISCORD_BOT_TOKEN",
  "msg:slack::oauth_token":     "SLACK_BOT_TOKEN",
  "msg:teams::oauth_token":     "MICROSOFT_CLIENT_SECRET", // Teams rides the same Graph OAuth app as Microsoft 365
  "msg:teams::webhook_secret":  "TEAMS_WEBHOOK_URL",
  // Phase G — Auth
  "auth:google::oauth_token":   "GOOGLE_CLIENT_SECRET",
  "auth:github::oauth_token":   "GITHUB_CLIENT_SECRET",
  "auth:microsoft::oauth_token": "MICROSOFT_CLIENT_SECRET",
  "auth:linkedin::oauth_token": "LINKEDIN_CLIENT_SECRET",
  "auth:apple::ssh_key":        "APPLE_PRIVATE_KEY",
  "auth:discord::oauth_token":  "DISCORD_CLIENT_SECRET",
  // Phase H — Productivity
  "prod:dropbox::oauth_token":  "DROPBOX_ACCESS_TOKEN",
  "prod:m365::oauth_token":     "MS_GRAPH_TOKEN",
  "prod:notion::api_key":       "NOTION_API_KEY",
  "prod:notion::oauth_token":   "NOTION_CLIENT_SECRET",
  // Phase J — Creative
  "creative:figma::personal_access_token": "FIGMA_ACCESS_TOKEN",
  "creative:canva::api_key":    "CANVA_API_KEY",
  // Phase K — Automation
  "auto:n8n::api_key":          "N8N_API_KEY",
  "auto:make::api_key":         "MAKE_API_KEY",
  "auto:zapier::webhook_secret": "ZAPIER_WEBHOOK_URL",
  // Phase L — Monitoring
  "monitor:sentry::api_key":    "SENTRY_DSN",
  "monitor:datadog::api_key":   "DATADOG_API_KEY",
  "monitor:uptime::api_key":    "UPTIMEROBOT_API_KEY",
  // Phase M — Project Management
  "issue:jira::personal_access_token": "JIRA_API_TOKEN",
  "issue:linear::api_key":      "LINEAR_API_KEY",
};

// ── Core CRUD ─────────────────────────────────────────────────────────────────
function storeSecret(connectorId, type, value, meta = {}, orgId = GLOBAL_ORG, requestingAccountId = null) {
  if (!CRED_TYPES.has(type)) throw new Error(`Unknown credential type: ${type}. Supported: ${[...CRED_TYPES].join(", ")}`);
  if (typeof value !== "string" || !value) throw new Error("Secret value must be a non-empty string");
  if (value.length > 32768) throw new Error("Secret value exceeds maximum length (32KB)");
  _assertOrgAccess(orgId, requestingAccountId, "manage_billing");

  const vault  = _load();
  const vk     = _vkey(connectorId, type, orgId);
  const existing = vault.secrets[vk];

  vault.secrets[vk] = {
    connectorId,
    type,
    orgId,
    encrypted: _encrypt(value),
    storedAt:  existing?.storedAt || _ts(),
    updatedAt: _ts(),
    meta: { ...existing?.meta, ...meta },
    rotationDueDays: ROTATION_TTL[type] || 180,
    rotationDueAt:   _rotationDueDate(ROTATION_TTL[type] || 180),
    lastValidatedAt: null,
    lastFailure:     null,
    version:         (existing?.version || 0) + 1,
  };

  _save(vault);
  _appendHistory({ event: "stored", connectorId, type, orgId, version: vault.secrets[vk].version });
  return _publicRecord(vault.secrets[vk]);
}

function getSecret(connectorId, type, orgId = GLOBAL_ORG, requestingAccountId = null, opts = {}) {
  _assertOrgAccess(orgId, requestingAccountId, "manage_billing");
  const vault = _load();
  if (type) {
    const rec = vault.secrets[_vkey(connectorId, type, orgId)];
    if (!rec) return null;
    try {
      const value = _decrypt(rec.encrypted);
      if (requestingAccountId) _appendAudit({ event: "reveal", connectorId, type, orgId, accountId: requestingAccountId, reason: opts.reason || null });
      return value;
    }
    catch { return null; }
  }
  // Return all types for this connector, scoped to this org
  if (requestingAccountId) _appendAudit({ event: "reveal_all", connectorId, orgId, accountId: requestingAccountId, reason: opts.reason || null });
  return Object.values(vault.secrets)
    .filter(r => r.connectorId === connectorId && (r.orgId || GLOBAL_ORG) === orgId)
    .map(r => {
      try { return { ...r, value: _decrypt(r.encrypted), encrypted: undefined }; }
      catch { return { ...r, value: null, decryptError: true, encrypted: undefined }; }
    });
}

// ── Credential reference resolution (Vault Security Hardening — Agent →
// Connector → Vault Authorization) ───────────────────────────────────────
// A credentialRef is a plain string of the form "connectorId::type"
// (matching the vault's own GLOBAL_ORG key format from _vkey() — never
// the raw orgId-prefixed internal key, since a ref is meant to be a
// stable, org-independent pointer a Company/Agent/Workflow definition can
// declare; the ORG comes from the caller's own authorized context, not
// from the ref string itself, so a ref can never be used to reach across
// orgs by embedding someone else's orgId in it).
//
// This closes a real gap: agentInstanceRegistry.cjs stores credentialRefs
// on AgentInstance records and capabilityContract.cjs validates their
// shape, but until now nothing ever turned a ref into an actual secret —
// the composition chain's "Credential Reference -> Vault authorization ->
// internal secret resolution" step didn't exist. Reuses getSecret() as-is
// (same _assertOrgAccess() org-check, same audit-log-on-reveal behavior)
// — this is not a new resolution mechanism, just the missing wiring.
function _parseCredentialRef(ref) {
  if (typeof ref !== "string" || !ref.includes("::")) return null;
  const [connectorId, type] = ref.split("::");
  if (!connectorId || !type) return null;
  return { connectorId, type };
}

/**
 * Resolve a single credentialRef string into its plaintext value, scoped
 * to the calling org/agent. Never a "reveal" in the founder-vault sense —
 * no audit-log reason is required or recorded beyond the existing
 * reveal-tracking getSecret() already does, since this is a programmatic
 * runtime resolution (agent execution), not a human inspecting a secret.
 * Returns null (never throws) for a malformed ref or a ref that doesn't
 * resolve — callers (executionEngine.cjs) must treat this as "credential
 * unavailable", not a crash.
 */
function resolveCredentialRef(ref, { orgId = GLOBAL_ORG, requestingAccountId = null } = {}) {
  const parsed = _parseCredentialRef(ref);
  if (!parsed) return null;
  try {
    return getSecret(parsed.connectorId, parsed.type, orgId, requestingAccountId);
  } catch {
    return null; // fail closed — org-check failure or decrypt error both resolve to "unavailable", never throw into the caller's dispatch path
  }
}

/**
 * Resolve every credentialRef in an array, scoped to the same org. Skips
 * (does not include) any ref that fails to resolve — callers get only the
 * credentials they were genuinely authorized for and that actually exist,
 * never a sparse array with holes.
 */
function resolveCredentialRefs(refs = [], { orgId = GLOBAL_ORG, requestingAccountId = null } = {}) {
  const out = {};
  for (const ref of Array.isArray(refs) ? refs : []) {
    const value = resolveCredentialRef(ref, { orgId, requestingAccountId });
    if (value !== null) out[ref] = value;
  }
  return out;
}

function listSecrets(filter = {}) {
  _assertOrgAccess(filter.orgId, filter.requestingAccountId, "view_analytics");
  const vault   = _load();
  const all     = Object.values(vault.secrets);
  const records = all.filter(r => {
    if (filter.connectorId && r.connectorId !== filter.connectorId) return false;
    if (filter.type        && r.type        !== filter.type)        return false;
    // orgId filter is opt-in: omitting it lists across all orgs (operator/
    // admin view), matching pre-multi-tenant behavior exactly.
    if (filter.orgId       && (r.orgId || GLOBAL_ORG) !== filter.orgId) return false;
    if (filter.phase) {
      const [ph] = r.connectorId.split(":");
      const phaseMap = { A: "ai", B: "git", C: "infra", D: "pay", E: "email", F: "msg", G: "auth", H: "prod", I: "commerce", J: "creative", K: "auto", L: "monitor" };
      if (phaseMap[filter.phase] !== ph) return false;
    }
    return true;
  });
  return records.map(_publicRecord);
}

function deleteSecret(connectorId, type, orgId = GLOBAL_ORG, requestingAccountId = null) {
  _assertOrgAccess(orgId, requestingAccountId, "manage_billing");
  const vault = _load();
  const vk    = _vkey(connectorId, type, orgId);
  if (!vault.secrets[vk]) return false;
  delete vault.secrets[vk];
  _save(vault);
  _appendHistory({ event: "deleted", connectorId, type, orgId });
  return true;
}

function rotateSecret(connectorId, type, newValue, orgId = GLOBAL_ORG, requestingAccountId = null) {
  _assertOrgAccess(orgId, requestingAccountId, "manage_billing");
  const vault = _load();
  const vk    = _vkey(connectorId, type, orgId);
  const existing = vault.secrets[vk];
  if (!existing) throw new Error(`No vault entry found for ${connectorId}::${type}`);

  // Keep old encrypted value in history before overwriting
  _appendHistory({ event: "rotated", connectorId, type, orgId, oldVersion: existing.version });

  existing.encrypted       = _encrypt(newValue);
  existing.updatedAt       = _ts();
  existing.rotationDueAt   = _rotationDueDate(ROTATION_TTL[type] || 180);
  existing.lastValidatedAt = null;
  existing.version        += 1;

  _save(vault);
  _appendHistory({ event: "rotation_complete", connectorId, type, orgId, newVersion: existing.version });
  return _publicRecord(existing);
}

// ── Resolve: vault first, then env var ───────────────────────────────────────
function resolveEnvKey(connectorId, type, orgId = GLOBAL_ORG) {
  // 1. Vault
  const fromVault = getSecret(connectorId, type, orgId);
  if (fromVault) return fromVault;
  // 2. Env var fallback
  const envKey = ENV_MAP[`${connectorId}::${type}`];
  if (envKey && process.env[envKey]) return process.env[envKey];
  return undefined;
}

// Look up all secrets for a connector (vault + env vars combined)
function resolveAll(connectorId, orgId = GLOBAL_ORG) {
  const vaultEntries = getSecret(connectorId, undefined, orgId) || [];
  const envEntries   = Object.entries(ENV_MAP)
    .filter(([k]) => k.startsWith(`${connectorId}::`) && !vaultEntries.find(v => `${v.connectorId}::${v.type}` === k))
    .map(([k, envKey]) => ({
      connectorId,
      type:   k.split("::")[1],
      source: "env",
      value:  process.env[envKey] || null,
      envKey,
    }));
  return [
    ...vaultEntries.map(v => ({ ...v, source: "vault" })),
    ...envEntries.filter(e => e.value),
  ];
}

// ── Validation ────────────────────────────────────────────────────────────────
function validateSecret(connectorId, type, orgId = GLOBAL_ORG, requestingAccountId = null) {
  _assertOrgAccess(orgId, requestingAccountId, "view_analytics");
  const vault = _load();
  const vk    = _vkey(connectorId, type, orgId);
  const rec   = vault.secrets[vk];

  if (!rec) {
    const envKey = ENV_MAP[`${connectorId}::${type}`];
    const envVal = envKey ? process.env[envKey] : null;
    return {
      connectorId, type,
      source:  envVal ? "env" : "none",
      present: !!envVal,
      valid:   !!envVal,
      detail:  envVal ? `Found in env var ${envKey}` : (envKey ? `Not in vault or env (${envKey})` : "Not configured"),
    };
  }

  let value;
  try { value = _decrypt(rec.encrypted); }
  catch (e) {
    vault.secrets[vk].lastFailure = { ts: _ts(), reason: "decrypt_error" };
    _save(vault);
    return { connectorId, type, source: "vault", present: true, valid: false, detail: `Decrypt error: ${e.message}` };
  }

  const now      = Date.now();
  const dueAt    = rec.rotationDueAt ? new Date(rec.rotationDueAt).getTime() : null;
  const daysLeft = dueAt ? Math.round((dueAt - now) / 86_400_000) : null;
  const overdue  = daysLeft !== null && daysLeft < 0;
  const expiring = daysLeft !== null && daysLeft < 14;

  vault.secrets[vk].lastValidatedAt = _ts();
  _save(vault);

  return {
    connectorId, type,
    source:  "vault",
    present: true,
    valid:   true,
    length:  value.length,
    version: rec.version,
    storedAt:        rec.storedAt,
    updatedAt:       rec.updatedAt,
    rotationDueAt:   rec.rotationDueAt,
    daysUntilRotation: daysLeft,
    overdue,
    expiring,
    detail: overdue ? `Rotation overdue by ${Math.abs(daysLeft)} days`
          : expiring ? `Rotation due in ${daysLeft} days`
          : `Valid${daysLeft !== null ? `, ${daysLeft} days until rotation` : ""}`,
  };
}

// ── Health report ─────────────────────────────────────────────────────────────
function getHealth(connectorId) {
  const vault   = _load();
  const records = connectorId
    ? Object.values(vault.secrets).filter(r => r.connectorId === connectorId)
    : Object.values(vault.secrets);

  const now = Date.now();
  const results = records.map(r => {
    const dueAt    = r.rotationDueAt ? new Date(r.rotationDueAt).getTime() : null;
    const daysLeft = dueAt ? Math.round((dueAt - now) / 86_400_000) : null;
    return {
      connectorId: r.connectorId,
      type:        r.type,
      status:      daysLeft === null ? "ok"
                 : daysLeft < 0     ? "overdue"
                 : daysLeft < 14    ? "expiring"
                 :                    "ok",
      daysUntilRotation: daysLeft,
      lastValidatedAt: r.lastValidatedAt,
      version: r.version,
    };
  });

  const overdue  = results.filter(r => r.status === "overdue");
  const expiring = results.filter(r => r.status === "expiring");
  const ok       = results.filter(r => r.status === "ok");

  return {
    connectorId: connectorId || "all",
    totalSecrets: results.length,
    ok:       ok.length,
    expiring: expiring.length,
    overdue:  overdue.length,
    score:    results.length ? Math.round((ok.length / results.length) * 100) : 100,
    details:  results,
    overdueList:  overdue.map(r => `${r.connectorId}::${r.type}`),
    expiringList: expiring.map(r => `${r.connectorId}::${r.type} (${r.daysUntilRotation}d)`),
  };
}

// ── Connection history ────────────────────────────────────────────────────────
function getHistory(connectorId) {
  const h = _loadHistory();
  return connectorId ? h.filter(e => e.connectorId === connectorId) : h;
}

// ── Export / Import ───────────────────────────────────────────────────────────
function exportVault(passphrase) {
  if (!passphrase || passphrase.length < 8) throw new Error("Export passphrase must be at least 8 characters");
  const vault   = _load();
  const payload = JSON.stringify({ exportedAt: _ts(), secrets: vault.secrets });

  // Encrypt with passphrase-derived key (PBKDF2, 100k iterations)
  const salt    = crypto.randomBytes(16);
  const dk      = crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, "sha256");
  const iv      = crypto.randomBytes(12);
  const cipher  = crypto.createCipheriv("aes-256-gcm", dk, iv);
  const enc     = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag     = cipher.getAuthTag();

  const blob = {
    version: 1,
    salt:    salt.toString("hex"),
    iv:      iv.toString("hex"),
    tag:     tag.toString("hex"),
    data:    enc.toString("hex"),
  };
  _appendHistory({ event: "exported", count: Object.keys(vault.secrets).length });
  return JSON.stringify(blob);
}

function importVault(blobStr, passphrase) {
  const blob = JSON.parse(blobStr);
  if (blob.version !== 1) throw new Error("Unsupported vault export version");

  const salt   = Buffer.from(blob.salt, "hex");
  const dk     = crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, "sha256");
  const iv     = Buffer.from(blob.iv,   "hex");
  const tag    = Buffer.from(blob.tag,  "hex");
  const enc    = Buffer.from(blob.data, "hex");
  const d      = crypto.createDecipheriv("aes-256-gcm", dk, iv);
  d.setAuthTag(tag);
  const payload = JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString("utf8"));

  const current = _load();
  let imported = 0, skipped = 0;
  for (const [k, rec] of Object.entries(payload.secrets || {})) {
    if (current.secrets[k]) { skipped++; continue; }
    current.secrets[k] = rec;
    imported++;
  }
  _save(current);
  _appendHistory({ event: "imported", imported, skipped });
  return { imported, skipped, total: Object.keys(payload.secrets || {}).length };
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function getDashboard() {
  const vault     = _load();
  const records   = Object.values(vault.secrets);
  const history   = _loadHistory().slice(0, 20);
  const health    = getHealth();
  const now       = Date.now();

  // Env var coverage — which connectors have env vars set
  const envCoverage = Object.entries(ENV_MAP).reduce((acc, [vk, envKey]) => {
    const [connId] = vk.split("::");
    if (!acc[connId]) acc[connId] = { total: 0, set: 0, vault: 0 };
    acc[connId].total++;
    if (process.env[envKey]) acc[connId].set++;
    if (records.find(r => `${r.connectorId}::${r.type}` === vk)) acc[connId].vault++;
    return acc;
  }, {});

  const phases = records.reduce((acc, r) => {
    const [ph] = r.connectorId.split(":");
    acc[ph] = acc[ph] || { phase: ph, count: 0, overdue: 0, expiring: 0 };
    acc[ph].count++;
    const dueAt = r.rotationDueAt ? new Date(r.rotationDueAt).getTime() : null;
    if (dueAt) {
      const d = Math.round((dueAt - now) / 86_400_000);
      if (d < 0)  acc[ph].overdue++;
      if (d < 14) acc[ph].expiring++;
    }
    return acc;
  }, {});

  // OAuth status — from oauthIntegrationLayer
  let oauthStatus = null;
  try {
    const oauth = require("./oauthIntegrationLayer.cjs");
    oauthStatus = oauth.listConnections();
  } catch { /* optional */ }

  // Missing connectors — list of known connector IDs that have no vault or env entry
  // Phase 6 connector reachability audit: KNOWN_CONNECTORS previously
  // omitted ai:grok, ai:qwen (both have real probe logic in AI_PROVIDERS
  // and ENV_MAP entries above, just never added here), msg:teams,
  // prod:notion (Phase F/H — real connect functions + ENV_MAP entries),
  // and issue:jira/issue:linear (Phase M — scanAllProjectManagementProviders
  // already probes both). All six were reachable via /integrations/* and
  // myConnectors.js's customer setup forms but invisible on this founder
  // dashboard, so IntegrationCenter.jsx (which renders dashboard.connected
  // + dashboard.missing) never showed them at all.
  const KNOWN_CONNECTORS = [
    "ai:groq","ai:openrouter","ai:openai","ai:anthropic","ai:gemini","ai:deepseek","ai:together","ai:fireworks","ai:cohere","ai:nvidia","ai:grok","ai:qwen",
    "git:github","git:gitlab","git:bitbucket",
    "infra:aws","infra:r2","infra:cloudflare","infra:hostinger","infra:supabase","infra:firebase",
    "pay:razorpay","pay:stripe","pay:paddle","pay:lemonsqueezy",
    "email:resend","email:sendgrid","email:mailgun","email:postmark","email:brevo","email:smtp",
    "msg:whatsapp","msg:telegram","msg:twilio","msg:discord","msg:slack","msg:teams",
    "auth:google","auth:github","auth:microsoft","auth:linkedin","auth:apple","auth:discord",
    "prod:google_workspace","prod:m365","prod:dropbox","prod:notion",
    "commerce:shopify","commerce:woocommerce","commerce:wordpress",
    "creative:figma","creative:canva",
    "auto:zapier","auto:make","auto:n8n",
    "monitor:sentry","monitor:datadog","monitor:uptime",
    "issue:jira","issue:linear",
  ];
  const connected  = KNOWN_CONNECTORS.filter(id => {
    const inVault = records.some(r => r.connectorId === id);
    const inEnv   = Object.entries(ENV_MAP).some(([k, ev]) => k.startsWith(`${id}::`) && !!process.env[ev]);
    return inVault || inEnv;
  });
  const missing = KNOWN_CONNECTORS.filter(id => !connected.includes(id));

  return {
    generatedAt:   _ts(),
    totalSecrets:  records.length,
    totalConnectors: KNOWN_CONNECTORS.length,
    connectedCount:  connected.length,
    missingCount:    missing.length,
    health: {
      ok:       health.ok,
      expiring: health.expiring,
      overdue:  health.overdue,
      score:    health.score,
    },
    credentialTypes: [...CRED_TYPES],
    oauthConnections: oauthStatus,
    byPhase:    Object.values(phases),
    connected,
    missing,
    recentHistory: history,
    envCoverage: Object.entries(envCoverage).map(([id, v]) => ({ connectorId: id, ...v })),
    rotationReminders: health.overdueList.concat(health.expiringList),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _rotationDueDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function _publicRecord(r) {
  return {
    connectorId:     r.connectorId,
    type:            r.type,
    orgId:           r.orgId || GLOBAL_ORG,
    storedAt:        r.storedAt,
    updatedAt:       r.updatedAt,
    rotationDueAt:   r.rotationDueAt,
    rotationDueDays: r.rotationDueDays,
    lastValidatedAt: r.lastValidatedAt,
    lastFailure:     r.lastFailure,
    version:         r.version,
    meta:            r.meta,
    // Never expose encrypted or plaintext value
  };
}

// ── Credential type catalog (for UI/docs) ─────────────────────────────────────
function getCredentialTypes() {
  return [...CRED_TYPES].map(t => ({
    type: t,
    rotationDays: ROTATION_TTL[t],
    description: {
      oauth_token:          "OAuth access token from provider authorization flow",
      refresh_token:        "Long-lived token used to renew oauth_token",
      api_key:              "Static API key or secret key from provider dashboard",
      personal_access_token:"PAT from developer settings (GitHub, GitLab, Figma etc.)",
      ssh_key:              "PEM-encoded SSH private key for server/git access",
      jwt_secret:           "Symmetric secret used to sign JWT tokens",
      service_account_json: "Full service account JSON (Firebase, GCP etc.)",
      smtp_credentials:     "Username:password pair for SMTP authentication",
      database_credentials: "Connection string or user:pass for database access",
      webhook_secret:       "Signing secret used to verify webhook payloads",
      certificate:          "PEM-encoded TLS/SSL certificate or bundle",
      license_key:          "Software license key for paid services",
    }[t] || t,
  }));
}

// ── Automatic rotation candidates ─────────────────────────────────────────────
// Only credential types with no external issuer can be safely auto-generated:
// jwt_secret and webhook_secret are symmetric values the app itself defines
// and validates against, so a fresh cryptographically-random value is always
// valid. Every other type (api_key, oauth_token, ssh_key, certificate, etc.)
// is issued by an external provider or a human — generating a replacement
// value for those would silently produce an unusable, fake credential, so
// they are deliberately NOT supported here. Staged, not applied: a live
// jwt_secret rotation invalidates every active session immediately, so the
// candidate is stored for review, not auto-promoted.
const AUTO_ROTATABLE_TYPES = new Set(["jwt_secret", "webhook_secret"]);

function prepareRotationCandidate(connectorId, type) {
  if (!AUTO_ROTATABLE_TYPES.has(type)) {
    throw new Error(`Cannot auto-generate a replacement for credential type "${type}" — it is issued externally. Use rotateSecret() with a value from the provider instead.`);
  }
  const vault = _load();
  const vk    = _vkey(connectorId, type);
  const existing = vault.secrets[vk];
  if (!existing) throw new Error(`No vault entry found for ${connectorId}::${type}`);

  const candidate = crypto.randomBytes(48).toString("base64url");
  existing.stagedRotation = {
    encrypted:  _encrypt(candidate),
    preparedAt: _ts(),
  };
  _save(vault);
  _appendHistory({ event: "rotation_staged", connectorId, type, version: existing.version });
  return { connectorId, type, preparedAt: existing.stagedRotation.preparedAt };
}

function applyStagedRotation(connectorId, type) {
  const vault = _load();
  const vk    = _vkey(connectorId, type);
  const existing = vault.secrets[vk];
  if (!existing?.stagedRotation) throw new Error(`No staged rotation candidate for ${connectorId}::${type}`);

  const candidate = _decrypt(existing.stagedRotation.encrypted);
  delete existing.stagedRotation;
  _save(vault);
  return rotateSecret(connectorId, type, candidate);
}

function listStagedRotations() {
  const vault = _load();
  return Object.values(vault.secrets)
    .filter(r => r.stagedRotation)
    .map(r => ({ connectorId: r.connectorId, type: r.type, preparedAt: r.stagedRotation.preparedAt }));
}

module.exports = {
  storeSecret, getSecret, listSecrets, deleteSecret,
  rotateSecret, validateSecret, getHealth, getHistory,
  exportVault, importVault, getDashboard, resolveEnvKey, resolveAll,
  getCredentialTypes, CRED_TYPES, ENV_MAP,
  prepareRotationCandidate, applyStagedRotation, listStagedRotations, AUTO_ROTATABLE_TYPES,
  GLOBAL_ORG,
  // Vault Security Hardening
  getAccessAudit,
  resolveCredentialRef, resolveCredentialRefs,
};
