"use strict";
/**
 * Enterprise & Physical Integration Mission — Module 1: Enterprise Authentication
 * Prefix: /enterprise/sso/*
 *
 * Two trust zones in this one router, deliberately not behind a blanket
 * requireAuth gate (unlike most /enterprise/* routers registered elsewhere):
 *   - Admin config routes (GET/PUT/DELETE the org's SSO connection) — require
 *     an authenticated session with manage_sso permission on the org.
 *   - IdP-facing login routes (metadata, login-request redirect, ACS/callback)
 *     — MUST be reachable by an unauthenticated browser, since establishing
 *     that first authenticated session is the entire point of SSO login.
 *     These produce a session via the exact same signJWT()+jarvis_auth
 *     cookie every other login path uses.
 */

const router = require("express").Router();
const { requireAuth, signJWT, COOKIE_NAME, TOKEN_EXPIRY } = require("../middleware/authMiddleware");
const auditLog = require("../utils/auditLog.cjs");

const _try = fn => { try { return fn(); } catch { return null; } };
const _sso = () => _try(() => require("../services/ssoService.cjs"));
const _org = () => _try(() => require("../services/organizationService.cjs"));

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge:   TOKEN_EXPIRY * 1000,
  path:     "/",
};

function _mintSession(res, account) {
  const token = signJWT({
    role:  account.role || "user",
    sub:   account.id,
    email: account.email,
    iat:   Math.floor(Date.now() / 1000),
    exp:   Math.floor(Date.now() / 1000) + TOKEN_EXPIRY,
  });
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
}

// ── Admin: SSO configuration (requires an authenticated session) ─────────────

router.get("/enterprise/sso/:orgId/config", requireAuth, (req, res) => {
  if (!_org()?.hasPermission?.(req.params.orgId, req.user.sub, "manage_sso")) {
    return res.status(403).json({ ok: false, error: "Forbidden — requires permission: manage_sso" });
  }
  const config = _sso()?.getSsoConfig?.(req.params.orgId);
  res.json({ ok: true, config: _sso()?._publicConfig?.(config) });
});

router.put("/enterprise/sso/:orgId/config", requireAuth, (req, res) => {
  try {
    const result = _sso()?.setSsoConfig?.(req.params.orgId, req.body || {}, req.user.sub);
    res.json(result || { ok: false });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.delete("/enterprise/sso/:orgId/config", requireAuth, (req, res) => {
  try {
    const result = _sso()?.deleteSsoConfig?.(req.params.orgId, req.user.sub);
    res.json(result || { ok: false });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ── SAML 2.0 (public — IdP-facing) ───────────────────────────────────────────

router.get("/enterprise/sso/:orgId/saml/metadata", (req, res) => {
  const xml = _try(() => _sso()?.getSamlMetadata?.(req.params.orgId));
  if (!xml) return res.status(404).json({ ok: false, error: "SAML SSO not configured for this organization" });
  res.type("application/xml").send(xml);
});

router.get("/enterprise/sso/:orgId/saml/login", (req, res) => {
  try {
    const redirectUrl = _sso()?.buildSamlLoginRequest?.(req.params.orgId);
    res.redirect(redirectUrl);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post("/enterprise/sso/:orgId/saml/acs", async (req, res) => {
  try {
    const { account, provider } = await _sso()?.handleSamlAssertion?.(req.params.orgId, req);
    _mintSession(res, account);
    res.redirect("/");
  } catch (e) {
    auditLog.append({ type: "sso.login_failed", orgId: req.params.orgId, provider: "saml", error: e.message, ts: new Date().toISOString() });
    res.status(e.status || 400).json({ ok: false, error: e.message });
  }
});

// ── OIDC / Google Workspace / Microsoft Entra ID (public — IdP-facing) ─────

router.get("/enterprise/sso/:orgId/oidc/login", async (req, res) => {
  try {
    const url = await _sso()?.buildOidcAuthUrl?.(req.params.orgId);
    res.redirect(url);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get("/enterprise/sso/:orgId/oidc/callback", async (req, res) => {
  try {
    const currentUrl = new URL(req.originalUrl, _sso()._baseUrl());
    const { account, provider } = await _sso()?.handleOidcCallback?.(req.params.orgId, currentUrl);
    _mintSession(res, account);
    res.redirect("/");
  } catch (e) {
    auditLog.append({ type: "sso.login_failed", orgId: req.params.orgId, provider: "oidc", error: e.message, ts: new Date().toISOString() });
    res.status(e.status || 400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
