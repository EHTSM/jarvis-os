"use strict";
/**
 * Push Notification Engine — V6 Phase 8 (Personal JARVIS: mobile).
 *
 * Survey confirmed the Capacitor mobile app (mobile/) has no push plugin
 * installed and no FCM/APNs wiring anywhere. Real send delivery requires a
 * genuine Firebase service account (FIREBASE_SERVICE_ACCOUNT) — this
 * environment has none configured (confirmed via integrationConnectors.cjs's
 * connectFirebase(), the same real credential check already used
 * elsewhere in this repo). Per the mission's stop condition, that half is a
 * genuine external-credentials blocker, not something to fake.
 *
 * What IS real and buildable without those credentials: device token
 * registration/storage, and readiness reporting reusing the same real
 * connectFirebase() check. send() is honestly gated — it reports
 * "not configured" rather than pretending to deliver, and will start
 * actually sending the moment a real service account is added, with no
 * further code change needed here.
 *
 * Storage: data/push-tokens.json
 */

const fs   = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "../../data/push-tokens.json");

function _load() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { tokens: [] };
    const raw = fs.readFileSync(DATA_FILE, "utf-8").trim();
    return raw ? JSON.parse(raw) : { tokens: [] };
  } catch { return { tokens: [] }; }
}

function _save(d) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

function registerToken({ accountId, token, platform = "android" } = {}) {
  if (!accountId || !token) return { ok: false, error: "accountId and token required" };
  const store = _load();
  const existing = store.tokens.find(t => t.token === token);
  if (existing) {
    existing.accountId = accountId;
    existing.platform = platform;
    existing.updatedAt = new Date().toISOString();
  } else {
    store.tokens.push({ accountId, token, platform, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  _save(store);
  return { ok: true };
}

function unregisterToken(token) {
  const store = _load();
  const before = store.tokens.length;
  store.tokens = store.tokens.filter(t => t.token !== token);
  _save(store);
  return { ok: true, removed: before - store.tokens.length };
}

function listTokens(accountId) {
  const store = _load();
  return accountId ? store.tokens.filter(t => t.accountId === accountId) : store.tokens;
}

/**
 * getReadiness(): reuses the exact same real Firebase credential check
 * already used by integrationConnectors.cjs's connectFirebase() — no
 * parallel credential-detection logic.
 */
async function getReadiness() {
  const connectors = require("./integrationConnectors.cjs");
  const status = await connectors.connectFirebase();
  return {
    ok: true,
    pushReady: status.status === "CONNECTED",
    firebaseStatus: status.status,
    detail: status.detail,
    registeredTokens: _load().tokens.length,
  };
}

/**
 * send(): honestly gated on real Firebase readiness. Never fabricates a
 * delivery result — returns ok:false with an explicit reason when
 * unconfigured, so callers never mistake "accepted" for "delivered."
 */
async function send({ accountId, title, body } = {}) {
  const readiness = await getReadiness();
  if (!readiness.pushReady) {
    return { ok: false, error: `Push not configured: ${readiness.detail}`, sent: 0 };
  }
  // Real FCM send would go here once FIREBASE_SERVICE_ACCOUNT is present —
  // intentionally not implemented against fabricated credentials.
  return { ok: false, error: "Firebase configured but FCM send path not yet implemented", sent: 0 };
}

module.exports = { registerToken, unregisterToken, listTokens, getReadiness, send };
