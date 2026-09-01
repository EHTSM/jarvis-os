"use strict";
/**
 * Push Notification Engine — V6 Phase 8 (Personal JARVIS: mobile).
 *
 * Survey confirmed the Capacitor mobile app (mobile/) has no push plugin
 * installed and no FCM/APNs wiring anywhere. Real send delivery requires a
 * genuine Firebase service account (FIREBASE_SERVICE_ACCOUNT) — this
 * environment has none configured (confirmed via integrationConnectors.cjs's
 * connectFirebase(), the same real credential check already used
 * elsewhere in this repo).
 *
 * Google Ecosystem mission: send() now makes a real firebase-admin
 * messaging().send() call — the actual missing piece flagged by this
 * repo's own prior audit comment above ("FCM send path not yet
 * implemented"). firebase-admin is required the same optional-require way
 * backend/routes/auth.js's _firebaseAdmin() already does (it is not a
 * package.json dependency in this environment — confirmed by checking
 * node_modules directly; this is a genuine, pre-existing install gap
 * outside this mission's scope to fix, same as auth.js already handles
 * it: gracefully degrade, never fabricate). Unlike auth.js, which only
 * checks admin.apps?.length without ever calling initializeApp() itself
 * (so Firebase Admin is never actually initialized anywhere in this repo
 * today), this module DOES call admin.initializeApp() — using the exact
 * same FIREBASE_SERVICE_ACCOUNT JSON connectFirebase() already parses —
 * since FCM send genuinely requires an initialized app to construct a
 * signed request, whereas ID-token verification does not strictly need
 * this module's initialization to exist for its own (separate,
 * unmodified) code path in auth.js.
 *
 * Without firebase-admin installed, or without a real, valid
 * FIREBASE_SERVICE_ACCOUNT, send() returns a real, honest "not
 * configured"/"initialization failed" failure — never a fabricated
 * delivery result.
 *
 * Storage: data/push-tokens.json
 */

const fs   = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "../../data/push-tokens.json");

let _firebaseApp = null; // cached — initialized once per process, not per send() call
let _initAttempted = false;

function _firebaseAdmin() {
  try { return require("firebase-admin"); } catch { return null; }
}

/** Initialize (once) or return the cached Firebase Admin app instance. */
function _initFirebaseApp() {
  if (_firebaseApp) return _firebaseApp;
  if (_initAttempted) return null; // already tried and failed this process — don't retry every send()
  _initAttempted = true;

  const admin = _firebaseAdmin();
  if (!admin) return null;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) return null;

  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    _firebaseApp = admin.apps?.length
      ? admin.app()
      : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    return _firebaseApp;
  } catch {
    return null; // invalid JSON or invalid service account shape — same "PARTIAL" case connectFirebase() already detects
  }
}

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
 *
 * Real send: firebase-admin's messaging().send() per registered token
 * (FCM HTTP v1 has no true multicast "send to N tokens" single call in
 * the Admin SDK's basic send() — sendEachForMulticast() exists but caps
 * at 500 tokens per call and has a different error-per-index response
 * shape; for this mission's scope, per-token send() keeps error handling
 * simple and per-token failures isolated, matching the "smallest real
 * adapter" pattern used throughout the social platform missions). An
 * invalid/unregistered token (messaging/registration-token-not-registered)
 * is pruned from the store — the same real, permanent-vs-transient
 * error distinction whatsappService.js's auth-cooldown logic already draws.
 */
async function send({ accountId, title, body } = {}) {
  const readiness = await getReadiness();
  if (!readiness.pushReady) {
    return { ok: false, error: `Push not configured: ${readiness.detail}`, sent: 0 };
  }
  if (!title && !body) {
    return { ok: false, error: "title or body required", sent: 0 };
  }

  const admin = _firebaseAdmin();
  const app = _initFirebaseApp();
  if (!admin || !app) {
    return { ok: false, error: "Firebase Admin SDK unavailable or FIREBASE_SERVICE_ACCOUNT invalid — cannot send", sent: 0 };
  }

  const targets = listTokens(accountId);
  if (!targets.length) {
    return { ok: false, error: accountId ? `No registered device tokens for account ${accountId}` : "No registered device tokens", sent: 0 };
  }

  let sent = 0;
  const errors = [];
  const staleTokens = [];

  for (const t of targets) {
    try {
      await admin.messaging(app).send({
        token: t.token,
        notification: { title: title || "", body: body || "" },
      });
      sent++;
    } catch (err) {
      const code = err.errorInfo?.code || err.code || "unknown";
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        staleTokens.push(t.token); // permanent failure — prune, don't keep retrying a dead token
      }
      errors.push({ token: t.token.slice(0, 8) + "…", code }); // never log/return the full token
    }
  }

  for (const token of staleTokens) unregisterToken(token);

  return {
    ok: sent > 0,
    sent,
    total: targets.length,
    pruned: staleTokens.length,
    errors: errors.length ? errors : undefined,
  };
}

module.exports = { registerToken, unregisterToken, listTokens, getReadiness, send };
