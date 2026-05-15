"use strict";
const router      = require("express").Router();
const crypto      = require("crypto");
const rateLimiter = require("../middleware/rateLimiter");
const { signJWT, requireAuth, COOKIE_NAME, TOKEN_EXPIRY } = require("../middleware/authMiddleware");

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge:   TOKEN_EXPIRY * 1000,
  path:     "/",
};

function _verifyPassword(password, stored) {
  const colonIdx = stored.indexOf(":");
  if (colonIdx < 0) return false;
  const salt = stored.slice(0, colonIdx);
  const hash = stored.slice(colonIdx + 1);
  try {
    const derived = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(derived, "hex"));
  } catch { return false; }
}

// POST /auth/login — 10 attempts per 5 minutes per IP
router.post("/auth/login", rateLimiter(10, 5 * 60_000), (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "Password required" });

  const storedHash = process.env.OPERATOR_PASSWORD_HASH;

  if (!storedHash) {
    // Dev passthrough: no password configured — requireAuth also bypasses in dev mode
    if (process.env.NODE_ENV !== "production") {
      // Only set a cookie if JWT_SECRET is available; otherwise dev passthrough is enough
      // (requireAuth checks no cookie when JWT_SECRET is unset in dev mode)
      if (process.env.JWT_SECRET) {
        try {
          const token = signJWT({
            role: "operator", sub: "dev",
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY,
          });
          res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
        } catch { /* no-op: JWT_SECRET missing, dev passthrough sufficient */ }
      }
      return res.json({ success: true, role: "operator" });
    }
    return res.status(503).json({ error: "Auth not configured — OPERATOR_PASSWORD_HASH missing" });
  }

  if (!_verifyPassword(password, storedHash)) {
    return res.status(401).json({ error: "Invalid password" });
  }

  const token = signJWT({
    role: "operator", sub: "operator",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY,
  });
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ success: true, role: "operator" });
});

// POST /auth/logout
router.post("/auth/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ success: true });
});

// GET /auth/me — returns user info if authenticated, 401 otherwise
router.get("/auth/me", requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
