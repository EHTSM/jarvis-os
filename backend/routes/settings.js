"use strict";
/**
 * Settings API — in-app credential management.
 * Allows updating WhatsApp and Razorpay credentials without SSH.
 *
 * Security model: requireAuth on all routes. Credentials are written to
 * process.env (hot-reload) AND persisted to data/settings.json so they
 * survive PM2 restarts. The .env file is NOT modified — VPS operators
 * set baseline values there; this layer is the override layer.
 *
 * Data file: data/settings.json
 * Schema: { whatsapp: { token, phoneId, verifyToken, apiVersion },
 *           razorpay: { keyId, keySecret, webhookSecret },
 *           updatedAt: ISO string }
 */

const router   = require("express").Router();
const fs       = require("fs");
const path     = require("path");
const crypto   = require("crypto");
const { requireAuth } = require("../middleware/authMiddleware");
const auditLog = require("../utils/auditLog.cjs");
const logger   = require("../utils/logger");

const SETTINGS_FILE = path.join(__dirname, "../../data/settings.json");

// ── Persistence helpers ──────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); }
  catch { return {}; }
}

function _save(data) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2));
    return true;
  } catch (e) {
    logger.error("[Settings] Failed to persist:", e.message);
    return false;
  }
}

// Apply persisted settings to process.env on startup
function applyPersistedSettings() {
  const s = _load();
  if (s.whatsapp) {
    if (s.whatsapp.token)       process.env.WA_TOKEN       = s.whatsapp.token;
    if (s.whatsapp.phoneId)     process.env.WA_PHONE_ID    = s.whatsapp.phoneId;
    if (s.whatsapp.verifyToken) process.env.WA_VERIFY_TOKEN = s.whatsapp.verifyToken;
    if (s.whatsapp.apiVersion)  process.env.WA_API_VERSION  = s.whatsapp.apiVersion;
  }
  if (s.razorpay) {
    if (s.razorpay.keyId)        process.env.RAZORPAY_KEY_ID     = s.razorpay.keyId;
    if (s.razorpay.keySecret)    process.env.RAZORPAY_KEY_SECRET  = s.razorpay.keySecret;
    if (s.razorpay.webhookSecret) process.env.RAZORPAY_WEBHOOK_SECRET = s.razorpay.webhookSecret;
  }
}

// Call on module load — applies any previously saved credentials
applyPersistedSettings();

// ── GET /settings/status ──────────────────────────────────────────
// Returns which integrations are configured (no secrets returned)
router.get("/settings/status", requireAuth, (req, res) => {
  const s = _load();
  res.json({
    success: true,
    whatsapp: {
      configured: !!(process.env.WA_TOKEN || process.env.WHATSAPP_TOKEN),
      hasToken:   !!(s.whatsapp?.token || process.env.WA_TOKEN),
      hasPhoneId: !!(s.whatsapp?.phoneId || process.env.WA_PHONE_ID),
      source:     s.whatsapp ? "in-app" : "env",
    },
    razorpay: {
      configured: !!((process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY) &&
                     (process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET)),
      hasKeyId:   !!(s.razorpay?.keyId || process.env.RAZORPAY_KEY_ID),
      hasSecret:  !!(s.razorpay?.keySecret || process.env.RAZORPAY_KEY_SECRET),
      source:     s.razorpay ? "in-app" : "env",
    },
    updatedAt: s.updatedAt || null,
  });
});

// ── POST /settings/whatsapp ───────────────────────────────────────
// Save WhatsApp credentials in-app — no SSH or server restart needed
router.post("/settings/whatsapp", requireAuth, async (req, res) => {
  const { token, phoneId, verifyToken, apiVersion } = req.body || {};

  if (!token || !phoneId) {
    return res.status(400).json({ error: "token and phoneId are required" });
  }
  if (token.length < 20) {
    return res.status(400).json({ error: "token appears too short — paste the full Meta access token" });
  }
  if (!/^\d{10,20}$/.test(String(phoneId).trim())) {
    return res.status(400).json({ error: "phoneId must be a numeric Meta Phone Number ID (10–20 digits)" });
  }

  // Persist to data/settings.json
  const existing = _load();
  const updated  = {
    ...existing,
    whatsapp: {
      token:       token.trim(),
      phoneId:     String(phoneId).trim(),
      verifyToken: (verifyToken || process.env.WA_VERIFY_TOKEN || "ooplix_verify").trim(),
      apiVersion:  (apiVersion  || process.env.WA_API_VERSION  || "v19.0").trim(),
    },
  };

  if (!_save(updated)) {
    return res.status(500).json({ error: "Failed to persist settings — check data/ directory permissions" });
  }

  // Hot-reload into process.env (takes effect immediately, no restart)
  process.env.WA_TOKEN        = updated.whatsapp.token;
  process.env.WA_PHONE_ID     = updated.whatsapp.phoneId;
  process.env.WA_VERIFY_TOKEN = updated.whatsapp.verifyToken;
  process.env.WA_API_VERSION  = updated.whatsapp.apiVersion;

  // Reset WhatsApp auth cooldown so the service tries immediately with new credentials
  try {
    const wa = require("../services/whatsappService");
    wa.resetAuthCooldown();
  } catch { /* non-critical */ }

  auditLog.recordAuth({ action: "settings_update", operator: req.user, method: "whatsapp_credentials" });
  logger.info(`[Settings] WhatsApp credentials updated by ${req.user?.sub || "operator"}`);

  res.json({ success: true, message: "WhatsApp credentials saved and active. Send a test message to verify." });
});

// ── POST /settings/razorpay ───────────────────────────────────────
router.post("/settings/razorpay", requireAuth, async (req, res) => {
  const { keyId, keySecret, webhookSecret } = req.body || {};

  if (!keyId || !keySecret) {
    return res.status(400).json({ error: "keyId and keySecret are required" });
  }
  if (!/^rzp_(test|live)_/.test(keyId)) {
    return res.status(400).json({ error: "keyId must start with rzp_test_ or rzp_live_" });
  }

  const existing = _load();
  const updated  = {
    ...existing,
    razorpay: {
      keyId:         keyId.trim(),
      keySecret:     keySecret.trim(),
      webhookSecret: (webhookSecret || "").trim(),
    },
  };

  if (!_save(updated)) {
    return res.status(500).json({ error: "Failed to persist settings" });
  }

  // Hot-reload
  process.env.RAZORPAY_KEY_ID      = updated.razorpay.keyId;
  process.env.RAZORPAY_KEY_SECRET  = updated.razorpay.keySecret;
  process.env.RAZORPAY_KEY         = updated.razorpay.keyId;
  process.env.RAZORPAY_SECRET      = updated.razorpay.keySecret;
  if (updated.razorpay.webhookSecret) {
    process.env.RAZORPAY_WEBHOOK_SECRET = updated.razorpay.webhookSecret;
  }

  // Force payment service to re-read credentials on next call
  // (delete cached instance so next createPaymentLink() picks up new keys)
  try {
    const paymentMod = require.cache[require.resolve("../services/paymentService")];
    if (paymentMod) {
      // Invalidate the singleton instance — will be recreated on next call
      delete require.cache[require.resolve("../services/paymentService")];
    }
  } catch { /* non-critical */ }

  auditLog.recordAuth({ action: "settings_update", operator: req.user, method: "razorpay_credentials" });
  logger.info(`[Settings] Razorpay credentials updated by ${req.user?.sub || "operator"}`);

  res.json({
    success: true,
    message: `Razorpay ${keyId.startsWith("rzp_live_") ? "live" : "test"} credentials saved and active.`,
    mode: keyId.startsWith("rzp_live_") ? "live" : "test",
  });
});

// ── DELETE /settings/whatsapp ─────────────────────────────────────
router.delete("/settings/whatsapp", requireAuth, (req, res) => {
  const s = _load();
  delete s.whatsapp;
  _save(s);
  delete process.env.WA_TOKEN;
  delete process.env.WA_PHONE_ID;
  auditLog.recordAuth({ action: "settings_delete", operator: req.user, method: "whatsapp_credentials" });
  res.json({ success: true, message: "WhatsApp credentials removed. Server will fall back to .env values." });
});

module.exports = router;
module.exports.applyPersistedSettings = applyPersistedSettings;
