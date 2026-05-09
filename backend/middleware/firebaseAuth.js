"use strict";
/**
 * Firebase ID-token verification middleware.
 *
 * Usage:
 *   const { requireAuth, optionalAuth } = require("./middleware/firebaseAuth");
 *   router.post("/jarvis", optionalAuth, controller.handleJarvis);   // attaches uid if present
 *   router.get("/crm",     requireAuth,  controller.getLeads);        // 401 if no valid token
 *
 * Set FIREBASE_SERVICE_ACCOUNT env var to the JSON string of your
 * Firebase service account key (from Firebase Console → Project Settings
 * → Service Accounts → Generate new private key).
 */

const logger = require("../utils/logger");

let _admin = null;
let _app   = null;

function _initAdmin() {
  if (_app) return _app;

  try {
    const admin = require("firebase-admin");
    _admin      = admin;

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      logger.warn("[FirebaseAuth] FIREBASE_SERVICE_ACCOUNT not set — auth middleware disabled");
      return null;
    }

    const serviceAccount = typeof raw === "string" ? JSON.parse(raw) : raw;
    _app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    logger.info("[FirebaseAuth] Firebase Admin initialised");
    return _app;
  } catch (err) {
    logger.warn("[FirebaseAuth] Could not init Firebase Admin:", err.message);
    return null;
  }
}

async function _verifyToken(token) {
  const app = _initAdmin();
  if (!app || !_admin) return null;
  try {
    return await _admin.auth().verifyIdToken(token);
  } catch {
    return null;
  }
}

/**
 * Hard auth — returns 401 if no valid Firebase token.
 */
async function requireAuth(req, res, next) {
  const auth  = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, error: "Authorisation required." });
  }

  const decoded = await _verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ success: false, error: "Invalid or expired token." });
  }

  req.uid   = decoded.uid;
  req.email = decoded.email;
  next();
}

/**
 * Soft auth — attaches uid if a valid token is present, but never blocks.
 * Use this on routes that work for both authenticated and anonymous callers.
 */
async function optionalAuth(req, _res, next) {
  const auth  = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (token) {
    const decoded = await _verifyToken(token);
    if (decoded) { req.uid = decoded.uid; req.email = decoded.email; }
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
