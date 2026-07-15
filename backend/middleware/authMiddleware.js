"use strict";
const crypto = require("crypto");

const COOKIE_NAME = "jarvis_auth";
const TOKEN_EXPIRY = 8 * 60 * 60; // 8 hours in seconds

function _b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signJWT(payload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  const header = _b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body   = _b64url(JSON.stringify(payload));
  const sig    = crypto.createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = crypto.createHmac("sha256", secret)
      .update(`${header}.${body}`)
      .digest("base64url");
    const sigBuf = Buffer.from(sig,      "ascii");
    const expBuf = Buffer.from(expected, "ascii");
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function _parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    try {
      out[decodeURIComponent(part.slice(0, idx).trim())] =
        decodeURIComponent(part.slice(idx + 1).trim());
    } catch { /* ignore malformed */ }
  }
  return out;
}

function requireAuth(req, res, next) {
  const jwtSecret = process.env.JWT_SECRET;

  // Dev passthrough: only when JWT_SECRET is unset AND the operator has
  // explicitly opted in with ALLOW_DEV_AUTH_BYPASS=1. Gating this on
  // NODE_ENV!=='production' alone fails open — a deploy that simply forgets
  // to set NODE_ENV would silently run with zero auth on every route.
  // Requiring an explicit, differently-named opt-in means a missing env var
  // fails closed instead.
  if (!jwtSecret) {
    if (process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_AUTH_BYPASS === "1") {
      req.user = { role: "operator", sub: "dev" };
      return next();
    }
    return res.status(503).json({ error: "Auth not configured — JWT_SECRET missing" });
  }

  const cookies = _parseCookies(req);
  const token   = cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const user = verifyJWT(token);
  if (!user) return res.status(401).json({ error: "Token invalid or expired" });

  req.user = user;
  next();
}

// Requires a valid session AND the operator role.
// Compose after requireAuth — assumes req.user is already populated.
function operatorOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (req.user.role !== "operator") return res.status(403).json({ error: "Forbidden — operator access required" });
  next();
}

// Cookie defaults — httpOnly: true, secure in production, sameSite: strict
const COOKIE_DEFAULTS = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" };

module.exports = { requireAuth, operatorOnly, signJWT, verifyJWT, COOKIE_NAME, TOKEN_EXPIRY, COOKIE_DEFAULTS };
