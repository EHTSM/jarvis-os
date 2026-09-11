"use strict";
const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");

const COOKIE_NAME = "jarvis_auth";
const TOKEN_EXPIRY = 8 * 60 * 60; // 8 hours in seconds

function _b64url(input) {
  return Buffer.from(input).toString("base64url");
}

/**
 * MASTER RECOVERY (2026-08-15, C10-027): JWT logout previously only cleared
 * the cookie — a token issued before logout remained fully valid (accepted
 * by verifyJWT) until its natural 8-hour expiry, even after the user
 * explicitly signed out. Documented as a real architectural gap in prior
 * audits, not fixed until now.
 *
 * Minimal server-side revocation, compatible with the existing stateless-JWT
 * architecture (no session store, no DB): every signed token now carries a
 * `jti` (JWT ID). Logout appends that jti to a small revocation ledger
 * (data/revoked-tokens.json). verifyJWT rejects any token whose jti is on
 * the list. Entries naturally age out — a revoked token's own `exp` is
 * still enforced, so once every currently-outstanding token that could have
 * been revoked has expired, the ledger for it is pruned (checked on every
 * revoke + on load), keeping the file bounded without needing a cron job.
 * No new session-store architecture, no external dependency — reuses the
 * exact atomic tmp-rename file pattern already used by missionMemory.cjs,
 * organizationService.cjs, etc.
 */
const REVOKED_FILE = path.join(__dirname, "../../data/revoked-tokens.json");

function _loadRevoked() {
  try {
    const raw = JSON.parse(fs.readFileSync(REVOKED_FILE, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function _saveRevoked(list) {
  try {
    const dir = path.dirname(REVOKED_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${REVOKED_FILE}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list));
    fs.renameSync(tmp, REVOKED_FILE);
  } catch { /* best-effort — a failed write here must not block logout */ }
}

/** Revoke a token's jti. Also prunes entries whose exp has already passed —
 * an expired token is already rejected by the exp check below, so keeping
 * it on the revocation list serves no purpose and would grow unboundedly. */
function revokeToken(jti, exp) {
  if (!jti) return;
  const now = Math.floor(Date.now() / 1000);
  const list = _loadRevoked().filter(r => r.exp > now);
  if (!list.some(r => r.jti === jti)) list.push({ jti, exp: exp || (now + TOKEN_EXPIRY) });
  _saveRevoked(list);
}

function _isRevoked(jti) {
  if (!jti) return false;
  const now = Math.floor(Date.now() / 1000);
  return _loadRevoked().some(r => r.jti === jti && r.exp > now);
}

function signJWT(payload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  const fullPayload = { ...payload, jti: payload.jti || crypto.randomUUID() };
  const header = _b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body   = _b64url(JSON.stringify(fullPayload));
  const sig    = crypto.createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}

// Security Token Audit (2026-08-16): a password reset previously left every
// session issued before it fully valid until its own natural expiry — a
// pre-reset token (e.g. held by whoever the reset was meant to recover the
// account from) kept authenticating for up to 8h after the account owner
// changed their password. Fixed the same way logout revocation already
// works (C10-027, above): compare this token's iat against the account's
// own passwordChangedAt, set by betaReadiness.resetPassword via
// accountService.updateAccount. No new session-store architecture — reuses
// the accountId (`sub`) and issued-at (`iat`) every JWT already carries.
function _isStaleAfterPasswordChange(payload) {
  if (!payload.sub || !payload.iat) return false;
  try {
    const acctSvc = require("../services/accountService.js");
    const account = acctSvc.getById(payload.sub);
    if (!account || !account.passwordChangedAt) return false;
    const changedAtSec = Math.floor(new Date(account.passwordChangedAt).getTime() / 1000);
    return payload.iat < changedAtSec;
  } catch { return false; } // accountService unavailable — fail open, matching every other optional integration in this file
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
    if (payload.jti && _isRevoked(payload.jti)) return null;
    if (_isStaleAfterPasswordChange(payload)) return null;
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
  let token = cookies[COOKIE_NAME];

  // Mission 45 — Capacitor Mobile Auth Remediation (2026-08-24): a native
  // Capacitor WebView's cross-origin cookie handling is not reliable the way
  // a browser's is, so mobile clients cannot depend on the HttpOnly cookie
  // this middleware otherwise requires. Accept the identical JARVIS JWT (the
  // same token signJWT/verifyJWT already produce and validate for the cookie
  // path — not a new token type, not a raw Firebase ID token) via a standard
  // `Authorization: Bearer <jwt>` header as a fallback when no cookie is
  // present. Every check below (signature, exp, revocation, password-change
  // staleness) runs identically for both transports because both call the
  // same verifyJWT(); this widens *how* the token is carried, not *what*
  // counts as valid or *what* requireAuth accepts as proof of identity.
  if (!token) {
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ")) token = authHeader.slice(7).trim();
  }

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
  if (req.user.role !== "operator") {
    // OOPLIX V1 MASTER AUDIT (2026-08-16): this is the exact gate behind
    // every platform-wide-surface fix this session made (/eos, /ent, /eco,
    // /civ, /auto, ACP-9-12, /execution, /founder, /bible, /rc1-4, /pm7,
    // /pomena, /op1 — 15+ route groups). A real authenticated non-operator
    // repeatedly probing these boundaries left zero audit trail — confirmed
    // live: 20,382 real audit.ndjson entries, 0 denial events for any of
    // them, despite dozens of real 403s reproduced while fixing them.
    // Logging every requireAuth 401 (unauthenticated/expired token — high
    // volume, low signal, bots/stale sessions) is deliberately NOT done
    // here, matching this file's own existing precedent of not auditing
    // bare missing-credentials; this is the rarer, meaningful "an
    // authenticated user tried to exceed their role" signal.
    try {
      require("../utils/auditLog.cjs").recordAuth({
        action: "operator_access_denied", operator: req.user, method: req.originalUrl,
      });
    } catch { /* audit logging must never block the actual denial */ }
    return res.status(403).json({ error: "Forbidden — operator access required" });
  }
  next();
}

// Cookie defaults — httpOnly: true, secure in production, sameSite: strict
const COOKIE_DEFAULTS = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" };

module.exports = { requireAuth, operatorOnly, signJWT, verifyJWT, revokeToken, COOKIE_NAME, TOKEN_EXPIRY, COOKIE_DEFAULTS };
