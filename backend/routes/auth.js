"use strict";
const router      = require("express").Router();
const crypto      = require("crypto");
const rateLimiter = require("../middleware/rateLimiter");
const { signJWT, requireAuth, COOKIE_NAME, TOKEN_EXPIRY } = require("../middleware/authMiddleware");
const auditLog    = require("../utils/auditLog.cjs");
const accountSvc  = require("../services/accountService");

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge:   TOKEN_EXPIRY * 1000,
  path:     "/",
};

function _verifyPassword(password, stored) {
  if (!password || password.length < 6) return false;
  const colonIdx = stored.indexOf(":");
  if (colonIdx < 0) return false;
  const salt = stored.slice(0, colonIdx);
  const hash = stored.slice(colonIdx + 1);
  try {
    const derived = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(derived, "hex"));
  } catch { return false; }
}

// ── Shared handler functions ─────────────────────────────────────────────────
// Extracted so they can be registered at both /auth/* and /api/auth/* paths.

function _handleLogin(req, res) {
  const { email, password } = req.body || {};
  if (!password) return res.status(400).json({ error: "Password required" });

  if (email) {
    const result = accountSvc.loginByEmail(email, password);
    if (!result.success) {
      return res.status(401).json({ error: result.error || "Invalid email or password" });
    }
    const jwtPayload = {
      role:  result.account.role || "user",
      sub:   result.account.id,
      email: result.account.email,
      iat:   Math.floor(Date.now() / 1000),
      exp:   Math.floor(Date.now() / 1000) + TOKEN_EXPIRY,
    };
    try {
      const token = signJWT(jwtPayload);
      res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    } catch (e) {
      return res.status(500).json({ error: "JWT signing failed — JWT_SECRET not configured" });
    }
    auditLog.recordAuth({ action: "login", operator: result.account.id, method: "email" });
    return res.json({ success: true, role: result.account.role, email: result.account.email });
  }

  const storedHash = process.env.OPERATOR_PASSWORD_HASH;
  if (!storedHash) {
    if (process.env.NODE_ENV !== "production") {
      if (process.env.JWT_SECRET) {
        try {
          const token = signJWT({
            role: "operator", sub: "dev",
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY,
          });
          res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
        } catch { /* no-op */ }
      }
      auditLog.recordAuth({ action: "login", operator: "dev", method: "dev_passthrough" });
      return res.json({ success: true, role: "operator" });
    }
    return res.status(503).json({ error: "Auth not configured — OPERATOR_PASSWORD_HASH missing" });
  }

  if (!_verifyPassword(password, storedHash)) {
    return res.status(401).json({ error: "Invalid password" });
  }

  let token;
  try {
    token = signJWT({
      role: "operator", sub: "operator",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY,
    });
  } catch {
    return res.status(500).json({ error: "JWT signing failed" });
  }
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  auditLog.recordAuth({ action: "login", operator: "operator", method: "password" });
  res.json({ success: true, role: "operator" });
}

function _handleLogout(req, res) {
  auditLog.recordAuth({ action: "logout", operator: req.user });
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ success: true });
}

function _handleMe(req, res) {
  res.json({ success: true, user: req.user });
}

function _handleRefresh(req, res) {
  const u = req.user;
  try {
    const token = signJWT({
      role:  u.role,
      sub:   u.sub,
      email: u.email || undefined,
      iat:   Math.floor(Date.now() / 1000),
      exp:   Math.floor(Date.now() / 1000) + TOKEN_EXPIRY,
    });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    auditLog.recordAuth({ action: "refresh", operator: u.sub || u.role, method: "cookie" });
    res.json({ success: true, role: u.role });
  } catch {
    res.status(500).json({ error: "JWT signing failed" });
  }
}

function _handleForgotPassword(req, res) {
  const { email } = req.body || {};
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }
  auditLog.recordAuth({ action: "forgot_password", operator: email.toLowerCase().trim(), method: "email" });
  res.json({ success: true, message: "If an account exists, a reset link will be sent." });
}

function _firebaseAdmin() {
  try { return require("firebase-admin"); } catch { return null; }
}

async function _handleFirebaseSession(req, res) {
  const { idToken, email, name, provider } = req.body || {};
  if (!idToken || !email) {
    return res.status(400).json({ error: "idToken and email are required" });
  }

  const admin = _firebaseAdmin();
  if (admin && admin.apps?.length) {
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      const verifiedEmail = (decoded.email || "").trim().toLowerCase();
      const claimedEmail  = email.trim().toLowerCase();
      if (verifiedEmail && verifiedEmail !== claimedEmail) {
        return res.status(401).json({ error: "Token email mismatch" });
      }
    } catch (e) {
      return res.status(401).json({ error: "Invalid Firebase ID token" });
    }
  } else {
    if (process.env.NODE_ENV === "production") {
      return res.status(503).json({ error: "Firebase auth not configured" });
    }
    if (process.env.NODE_ENV !== "production") console.warn("[Auth] firebase-admin not initialised — skipping token verification (dev only)");
  }

  const cleanEmail = email.trim().toLowerCase();
  let account = accountSvc.getByEmail(cleanEmail);
  if (!account) {
    const synthetic = `firebase_${Buffer.from(cleanEmail).toString("base64").slice(0, 16)}_${crypto.randomBytes(8).toString("hex")}`;
    const reg = accountSvc.createAccount({
      email:    cleanEmail,
      password: synthetic,
      name:     name || cleanEmail.split("@")[0],
      role:     "user",
    });
    if (!reg.success) {
      account = accountSvc.getByEmail(cleanEmail);
      if (!account) return res.status(500).json({ error: reg.error || "Account creation failed" });
    } else {
      account = reg.account;
    }
  }

  try {
    const token = signJWT({
      role:  account.role || "user",
      sub:   account.id,
      email: account.email,
      iat:   Math.floor(Date.now() / 1000),
      exp:   Math.floor(Date.now() / 1000) + TOKEN_EXPIRY,
    });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    auditLog.recordAuth({ action: "login", operator: account.id, method: provider || "firebase" });
    res.json({ success: true, role: account.role, email: account.email });
  } catch {
    res.status(500).json({ error: "JWT signing failed" });
  }
}

// ── Routes — registered at both /auth/* and /api/auth/* ─────────────────────
// /api/auth/* aliases ensure clients using the /api prefix (mobile, API consumers,
// nginx /api block) are handled before ops.js's blanket requireAuth gate.
const _loginRL        = rateLimiter(10, 5 * 60_000);
const _forgotRL       = rateLimiter(5,  15 * 60_000);
const _firebaseRL     = rateLimiter(20, 5 * 60_000);

router.post("/auth/login",              _loginRL,    _handleLogin);
router.post("/auth/logout",                          _handleLogout);
router.get("/auth/me",                  requireAuth, _handleMe);
router.post("/auth/refresh",            requireAuth, _handleRefresh);
router.post("/auth/forgot-password",    _forgotRL,   _handleForgotPassword);
router.post("/auth/firebase-session",   _firebaseRL, _handleFirebaseSession);

// /api/* aliases — same handlers, respond before ops.js requireAuth gate
router.post("/api/auth/login",          _loginRL,    _handleLogin);
router.post("/api/auth/logout",                      _handleLogout);
router.get("/api/auth/me",              requireAuth, _handleMe);
router.post("/api/auth/refresh",        requireAuth, _handleRefresh);
router.post("/api/auth/forgot-password",_forgotRL,   _handleForgotPassword);
router.post("/api/auth/firebase-session",_firebaseRL, _handleFirebaseSession);

module.exports = router;
