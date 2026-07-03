"use strict";
/**
 * founderVault.js — Production Mission 3.1
 *
 * Founder Identity & Secret Vault routes.
 *
 * /vault/*      — encrypted secret store (57 connectors, 12 credential types)
 * /vault/env/*  — environment manager
 *
 * All routes require authentication.
 * Vault never returns plaintext secret values except via /vault/:id/:type/value
 * which requires additional confirmation header.
 */

const router         = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const _try    = fn => { try { return fn(); } catch { return null; } };
const _vault  = () => _try(() => require("../services/secretVault.cjs"));
const _env    = () => _try(() => require("../services/envManager.cjs"));
const _ic     = () => _try(() => require("../services/integrationConnectors.cjs"));
const _oauth  = () => _try(() => require("../services/oauthIntegrationLayer.cjs"));
const _sml    = () => _try(() => require("../services/secretManagementLayer.cjs"));
const _rot    = () => _try(() => require("../services/secretRotationAutomation.cjs"));

router.use("/vault", requireAuth);

// ════════════════════════════════════════════════════════════════════════════
// VAULT CORE
// ════════════════════════════════════════════════════════════════════════════

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get("/vault/dashboard", (req, res) => {
  try {
    const v = _vault();
    if (!v) return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    res.json({ ok: true, ...v.getDashboard() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Credential types catalog ──────────────────────────────────────────────────
router.get("/vault/credential-types", (req, res) => {
  try {
    const v = _vault();
    if (!v) return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    res.json({ ok: true, types: v.getCredentialTypes() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── List all secrets (metadata only, no values) ───────────────────────────────
router.get("/vault/secrets", (req, res) => {
  try {
    const v = _vault();
    if (!v) return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    const { connectorId, type, phase } = req.query;
    const list = v.listSecrets({ connectorId, type, phase });
    res.json({ ok: true, count: list.length, secrets: list });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Store a secret ────────────────────────────────────────────────────────────
// Body: { value: string, meta?: object }
// connectorId and type come from path params (URL-encoded)
router.post("/vault/secrets/:connectorId/:type", (req, res) => {
  try {
    const v = _vault();
    if (!v) return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    const connectorId = decodeURIComponent(req.params.connectorId);
    const type        = decodeURIComponent(req.params.type);
    const { value, meta } = req.body || {};
    if (!value) return res.status(400).json({ ok: false, error: "value is required in request body" });
    const record = v.storeSecret(connectorId, type, value, meta || {});
    res.json({ ok: true, secret: record });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ── Get secret metadata ───────────────────────────────────────────────────────
router.get("/vault/secrets/:connectorId/:type", (req, res) => {
  try {
    const v = _vault();
    if (!v) return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    const connectorId = decodeURIComponent(req.params.connectorId);
    const type        = decodeURIComponent(req.params.type);
    const validation  = v.validateSecret(connectorId, type);
    if (!validation.present) return res.status(404).json({ ok: false, error: "Secret not found", validation });
    res.json({ ok: true, validation });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Retrieve plaintext value (requires confirmation header) ───────────────────
// Header: X-Vault-Confirm: reveal
// Only use this to inject into process.env or pass to connectors programmatically.
router.get("/vault/secrets/:connectorId/:type/value", (req, res) => {
  try {
    const v = _vault();
    if (!v) return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    if (req.headers["x-vault-confirm"] !== "reveal") {
      return res.status(403).json({ ok: false, error: "Set header X-Vault-Confirm: reveal to retrieve plaintext value" });
    }
    const connectorId = decodeURIComponent(req.params.connectorId);
    const type        = decodeURIComponent(req.params.type);
    const value = v.getSecret(connectorId, type);
    if (value === null) return res.status(404).json({ ok: false, error: "Secret not found or decrypt failed" });
    res.json({ ok: true, connectorId, type, value });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Rotate a secret ───────────────────────────────────────────────────────────
router.post("/vault/secrets/:connectorId/:type/rotate", (req, res) => {
  try {
    const v = _vault();
    if (!v) return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    const connectorId = decodeURIComponent(req.params.connectorId);
    const type        = decodeURIComponent(req.params.type);
    const { value } = req.body || {};
    if (!value) return res.status(400).json({ ok: false, error: "new value required in body" });
    const record = v.rotateSecret(connectorId, type, value);
    res.json({ ok: true, secret: record, rotatedAt: record.updatedAt });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ── Delete a secret ───────────────────────────────────────────────────────────
router.delete("/vault/secrets/:connectorId/:type", (req, res) => {
  try {
    const v = _vault();
    if (!v) return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    const connectorId = decodeURIComponent(req.params.connectorId);
    const type        = decodeURIComponent(req.params.type);
    const deleted = v.deleteSecret(connectorId, type);
    if (!deleted) return res.status(404).json({ ok: false, error: "Secret not found" });
    res.json({ ok: true, deleted: true, connectorId, type });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Validate a secret ─────────────────────────────────────────────────────────
router.post("/vault/secrets/:connectorId/:type/validate", (req, res) => {
  try {
    const v = _vault();
    if (!v) return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    const connectorId = decodeURIComponent(req.params.connectorId);
    const type        = decodeURIComponent(req.params.type);
    const result = v.validateSecret(connectorId, type);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Health report (all secrets or one connector) ──────────────────────────────
router.get("/vault/health", (req, res) => {
  try {
    const v = _vault();
    if (!v) return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    const { connectorId } = req.query;
    const report = v.getHealth(connectorId || undefined);
    res.json({ ok: true, ...report });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Connection history ────────────────────────────────────────────────────────
router.get("/vault/history", (req, res) => {
  try {
    const v = _vault();
    if (!v) return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    const { connectorId } = req.query;
    const history = v.getHistory(connectorId || undefined);
    res.json({ ok: true, count: history.length, history });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Resolve (vault + env lookup for a connector/type) ────────────────────────
// Returns whether value exists and its source — NOT the value itself
router.get("/vault/resolve/:connectorId/:type", (req, res) => {
  try {
    const v = _vault();
    if (!v) return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    const connectorId = decodeURIComponent(req.params.connectorId);
    const type        = decodeURIComponent(req.params.type);
    const val = v.resolveEnvKey(connectorId, type);
    const validation = v.validateSecret(connectorId, type);
    res.json({ ok: true, connectorId, type, present: !!val, validation });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Resolve all secrets for a connector ──────────────────────────────────────
router.get("/vault/resolve/:connectorId", (req, res) => {
  try {
    const v = _vault();
    if (!v) return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    const connectorId = decodeURIComponent(req.params.connectorId);
    const all = v.resolveAll(connectorId);
    // Strip actual values — return only metadata + source
    const safe = all.map(({ value, ...rest }) => ({ ...rest, present: !!value }));
    res.json({ ok: true, connectorId, count: safe.length, resolved: safe });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Export vault (encrypted blob) ─────────────────────────────────────────────
// Body: { passphrase: string }
router.post("/vault/export", (req, res) => {
  try {
    const v = _vault();
    if (!v) return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    const { passphrase } = req.body || {};
    if (!passphrase) return res.status(400).json({ ok: false, error: "passphrase required" });
    const blob = v.exportVault(passphrase);
    res.json({ ok: true, blob, exportedAt: new Date().toISOString(), note: "Store this blob securely. It is encrypted with your passphrase." });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ── Import vault ──────────────────────────────────────────────────────────────
router.post("/vault/import", (req, res) => {
  try {
    const v = _vault();
    if (!v) return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    const { blob, passphrase } = req.body || {};
    if (!blob || !passphrase) return res.status(400).json({ ok: false, error: "blob and passphrase required" });
    const result = v.importVault(blob, passphrase);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ── OAuth connections status ──────────────────────────────────────────────────
router.get("/vault/oauth/status", (req, res) => {
  try {
    const oauth = _oauth();
    if (!oauth) return res.status(503).json({ ok: false, error: "oauthIntegrationLayer unavailable" });
    const connections = oauth.listConnections();
    const byProvider  = oauth.getProviderStatus ? oauth.getProviderStatus() : {};
    res.json({ ok: true, connections, byProvider });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── OAuth initiation (delegates to existing oauthIntegrationLayer) ────────────
router.get("/vault/oauth/:provider/authorize", (req, res) => {
  try {
    const oauth = _oauth();
    if (!oauth) return res.status(503).json({ ok: false, error: "oauthIntegrationLayer unavailable" });
    const provider  = req.params.provider;
    const userId    = req.user?.sub || "founder";
    const redirect  = req.query.redirect || null;
    const authUrl   = oauth.getAuthUrl(provider, userId, redirect ? { redirect } : {});
    res.json({ ok: true, provider, authUrl, note: "Visit authUrl in a browser to authorize" });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ── Secret rotation audit ─────────────────────────────────────────────────────
router.get("/vault/rotation/status", (req, res) => {
  try {
    const sml = _sml();
    const rot = _rot();
    const vlt = _vault();
    const rotStatus  = sml ? sml.getRotationStatus() : [];
    const vaultHealth = vlt ? vlt.getHealth() : null;
    res.json({ ok: true, rotationSchedule: rotStatus, vaultHealth });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post("/vault/rotation/mark-rotated", (req, res) => {
  try {
    const sml = _sml();
    if (!sml) return res.status(503).json({ ok: false, error: "secretManagementLayer unavailable" });
    const { key, rotatedBy, notes, method } = req.body || {};
    if (!key) return res.status(400).json({ ok: false, error: "key required" });
    const result = sml.markRotated(key, { rotatedBy: rotatedBy || req.user?.sub || "founder", notes, method });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ── Secret audit (full catalog) ───────────────────────────────────────────────
router.get("/vault/audit", (req, res) => {
  try {
    const sml = _sml();
    if (!sml) return res.status(503).json({ ok: false, error: "secretManagementLayer unavailable" });
    const report = sml.audit();
    res.json({ ok: true, ...report });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT MANAGER
// ════════════════════════════════════════════════════════════════════════════

// ── Env status ────────────────────────────────────────────────────────────────
router.get("/vault/env/status", (req, res) => {
  try {
    const em = _env();
    if (!em) return res.status(503).json({ ok: false, error: "envManager unavailable" });
    res.json({ ok: true, ...em.getEnvStatus() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Validate current environment ──────────────────────────────────────────────
router.get("/vault/env/validate", (req, res) => {
  try {
    const em = _env();
    if (!em) return res.status(503).json({ ok: false, error: "envManager unavailable" });
    const report = em.validateEnvironment();
    res.json({ ok: true, ...report });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Diff: vault vs env ────────────────────────────────────────────────────────
router.get("/vault/env/diff", (req, res) => {
  try {
    const em = _env();
    if (!em) return res.status(503).json({ ok: false, error: "envManager unavailable" });
    const diff = em.diffEnv();
    res.json({ ok: true, ...diff });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Generate .env file content (returns string, does NOT write) ───────────────
router.post("/vault/env/generate", (req, res) => {
  try {
    const em = _env();
    if (!em) return res.status(503).json({ ok: false, error: "envManager unavailable" });
    const { target } = req.body || {};
    const result = em.generateEnvFile(target || "local");
    // Record the sync event
    em.recordSync(result.target, { status: "generated", varsWritten: result.populated });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Required vars catalog ─────────────────────────────────────────────────────
router.get("/vault/env/required", (req, res) => {
  try {
    const em = _env();
    if (!em) return res.status(503).json({ ok: false, error: "envManager unavailable" });
    const vars = em.getRequiredVars();
    res.json({ ok: true, count: vars.length, vars });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Sync targets ──────────────────────────────────────────────────────────────
router.get("/vault/env/targets", (req, res) => {
  try {
    const em = _env();
    if (!em) return res.status(503).json({ ok: false, error: "envManager unavailable" });
    res.json({ ok: true, targets: em.getSyncTargets() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Sync history ──────────────────────────────────────────────────────────────
router.get("/vault/env/sync-history", (req, res) => {
  try {
    const em = _env();
    if (!em) return res.status(503).json({ ok: false, error: "envManager unavailable" });
    const { target } = req.query;
    const history = em.getSyncHistory(target);
    res.json({ ok: true, count: history.length, history });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Backup ────────────────────────────────────────────────────────────────────
router.post("/vault/backup", (req, res) => {
  try {
    const em = _env();
    if (!em) return res.status(503).json({ ok: false, error: "envManager unavailable" });
    const { passphrase } = req.body || {};
    if (!passphrase) return res.status(400).json({ ok: false, error: "passphrase required" });
    const blob = em.generateBackup(passphrase);
    res.json({ ok: true, blob, note: "Contains encrypted vault + env snapshot. Store securely." });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ── Restore ───────────────────────────────────────────────────────────────────
router.post("/vault/restore", (req, res) => {
  try {
    const em = _env();
    if (!em) return res.status(503).json({ ok: false, error: "envManager unavailable" });
    const { blob, passphrase } = req.body || {};
    if (!blob || !passphrase) return res.status(400).json({ ok: false, error: "blob and passphrase required" });
    const result = em.restoreBackup(blob, passphrase);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// FOUNDER IDENTITY — CONNECTED ACCOUNTS
// ════════════════════════════════════════════════════════════════════════════

// Full identity status: vault + connectors + oauth + env — one call
router.get("/vault/identity", async (req, res) => {
  try {
    const v   = _vault();
    const em  = _env();
    const ic  = _ic();
    const sml = _sml();

    const dashboard    = v  ? v.getDashboard()          : null;
    const envStatus    = em ? em.getEnvStatus()          : null;
    const connectors   = ic ? ic.getAllStatus()           : [];
    const secretAudit  = sml ? sml.detectMissing()       : null;

    const connectedCount   = connectors.filter(c => c.status === "CONNECTED").length;
    const partialCount     = connectors.filter(c => c.status === "PARTIAL").length;
    const missingCount     = connectors.filter(c => c.status === "MISSING" || c.status === "READY").length;

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      identity: {
        vault:      dashboard,
        env:        envStatus,
        integrations: {
          total:      connectors.length,
          connected:  connectedCount,
          partial:    partialCount,
          missing:    missingCount,
          score:      connectors.length ? Math.round((connectedCount / connectors.length) * 100) : 0,
        },
        secretAudit,
      },
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Connect flow: store vault secret then trigger connector reconnect ──────────
// This is the automated path: Founder posts credential → vault stores it →
// connector re-probes → result returned.
router.post("/vault/connect/:connectorId/:type", async (req, res) => {
  try {
    const v  = _vault();
    const ic = _ic();
    if (!v)  return res.status(503).json({ ok: false, error: "secretVault unavailable" });
    if (!ic) return res.status(503).json({ ok: false, error: "integrationConnectors unavailable" });

    const connectorId = decodeURIComponent(req.params.connectorId);
    const type        = decodeURIComponent(req.params.type);
    const { value, meta } = req.body || {};
    if (!value) return res.status(400).json({ ok: false, error: "value required in body" });

    // 1. Store in vault
    const record = v.storeSecret(connectorId, type, value, meta || {});

    // 2. Inject into process.env for immediate use (runtime only — not persisted to .env file)
    const envKey = (v.ENV_MAP || {})[`${connectorId}::${type}`];
    if (envKey) process.env[envKey] = value;

    // 3. Reconnect the connector
    let connectorResult = null;
    try { connectorResult = await ic.reconnect(connectorId); } catch { /* non-fatal */ }

    res.json({
      ok: true,
      stored:    record,
      connector: connectorResult,
      envInjected: !!envKey,
      note: "Secret stored in vault and injected into runtime env. Restart server to persist to .env.",
    });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

module.exports = router;
