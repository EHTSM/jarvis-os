#!/usr/bin/env node
"use strict";
/**
 * Capacitor Mobile <-> Backend Authentication Remediation — regression test.
 *
 * Mission 45 (2026-08-24). Proven issue: mobile/src/api.js sent the raw
 * Firebase ID token as an `Authorization: Bearer` header on every request,
 * but backend requireAuth only ever read the `jarvis_auth` HttpOnly cookie
 * — meaning every authenticated mobile API call was silently unauthenticated
 * (401/503), and the app's only real auth surface was undiscoverable at the
 * HTTP boundary layer.
 *
 * Chosen fix (Approach A, minimized to a JWT hand-off, not raw-Firebase-
 * token-on-every-request): a native Capacitor WebView cannot reliably rely
 * on cross-origin cookies the way a browser can, so instead of migrating
 * mobile to cookies (Approach B — would need a Capacitor HTTP/cookie-bridge
 * plugin, a materially larger and more fragile change for a native app):
 *
 *   1. requireAuth (backend/middleware/authMiddleware.js) now also accepts
 *      the existing JARVIS-signed session JWT via `Authorization: Bearer`
 *      as a fallback when no cookie is present — verified by the SAME,
 *      unmodified verifyJWT() used for the cookie path (identical
 *      signature/exp/revocation/password-change-staleness checks). This
 *      widens *how* the token is carried, not *what* counts as valid.
 *   2. /api/auth/firebase-session (already existing, already MFA/provider-
 *      policy-gated per Mission 33's certification) now ALSO returns that
 *      same signed JWT in its JSON response body, alongside the unchanged
 *      cookie — so mobile can store it and send it back as Bearer.
 *   3. /api/auth/logout and /api/auth/refresh gained a Bearer-token branch
 *      mirroring their existing cookie-token branch, so mobile logout
 *      actually revokes the token server-side (same C10-027 ledger) instead
 *      of only forgetting it client-side, and mobile refresh rotates its
 *      stored token the same way the web cookie is rotated.
 *
 * No new auth system, no duplicate identity system, no MFA bypass, no
 * requireAuth weakening (cookie path is completely unchanged and still
 * takes precedence when both are present), no token logging.
 *
 * Usage: node tests/security/116-mobile-bearer-auth-contract.cjs
 */

process.env.SKIP_PLATFORM_REGISTER = "1";
if (!process.env.NODE_ENV) process.env.NODE_ENV = "development"; // dev-mode firebase-admin passthrough, matches this repo's other auth tests
process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(process.cwd(), ".env") });

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

const { requireAuth, operatorOnly, signJWT, verifyJWT, revokeToken } = require("../../backend/middleware/authMiddleware.js");
const authRouter = require("../../backend/routes/auth.js");
const accountSvc = require("../../backend/services/accountService.js");

function mockReq({ cookie, bearer, body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = `jarvis_auth=${encodeURIComponent(cookie)}`;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return { headers, body: body || {} };
}
function mockRes() {
  const res = { statusCode: 200, body: null, cookies: {}, cleared: [] };
  res.status = c => { res.statusCode = c; return res; };
  res.json   = b => { res.body = b; return res; };
  res.cookie = (name, val) => { res.cookies[name] = val; return res; };
  res.clearCookie = (name) => { res.cleared.push(name); return res; };
  return res;
}
function findHandler(method, path) {
  const layer = authRouter.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
  return layer ? layer.route.stack[layer.route.stack.length - 1].handle : null;
}

async function main() {
  section("requireAuth — trace: unauthenticated request");
  {
    const req = mockReq();
    const res = mockRes();
    let nextCalled = false;
    requireAuth(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, "no credentials at all -> 401, unchanged", `status=${res.statusCode}`);
  }

  section("requireAuth — OLD BROKEN CONTRACT: raw Firebase-shaped bearer token must still fail (proves the pre-fix symptom, not a bypass)");
  {
    const req = mockReq({ bearer: "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJmaXJlYmFzZSJ9.not-a-jarvis-jwt" });
    const res = mockRes();
    let nextCalled = false;
    requireAuth(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, "raw Firebase-shaped bearer token (old contract) -> 401, not a crash, not a silent bypass", `status=${res.statusCode}`);
  }

  section("requireAuth — NEW CONTRACT: a real JARVIS JWT via Bearer authenticates");
  let mobileToken, mobileSub;
  {
    mobileSub = "test-mobile-acct-" + Date.now();
    mobileToken = signJWT({ role: "user", sub: mobileSub, email: "mission45@example.com", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 3600 });
    const req = mockReq({ bearer: mobileToken });
    const res = mockRes();
    let nextCalled = false;
    requireAuth(req, res, () => { nextCalled = true; });
    assert(nextCalled && req.user?.sub === mobileSub && req.user?.role === "user",
      "real JARVIS JWT via Bearer authenticates, req.user populated identically to the cookie path",
      `nextCalled=${nextCalled} user=${JSON.stringify(req.user)}`);
  }

  section("requireAuth — cookie path is completely unchanged and still wins when both are present");
  {
    const cookieToken = signJWT({ role: "operator", sub: "cookie-acct", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 3600 });
    const staleBearer = signJWT({ role: "user", sub: "should-be-ignored", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 3600 });
    const req = mockReq({ cookie: cookieToken, bearer: staleBearer });
    const res = mockRes();
    requireAuth(req, res, () => {});
    assert(req.user?.sub === "cookie-acct", "cookie takes precedence over Bearer when both present (web behavior unchanged)", JSON.stringify(req.user));
  }

  section("authorization — wrong-tenant/insufficient-role remains denied over Bearer transport");
  {
    const req = mockReq({ bearer: mobileToken }); // role: user
    const res = mockRes();
    requireAuth(req, res, () => {
      let deniedNextCalled = false;
      operatorOnly(req, res, () => { deniedNextCalled = true; });
      assert(res.statusCode === 403 && !deniedNextCalled, "non-operator via Bearer correctly denied by operatorOnly (403)", `status=${res.statusCode}`);
    });
  }

  section("session expiry — an expired JWT via Bearer is rejected");
  {
    const expiredToken = signJWT({ role: "user", sub: "expired-acct", iat: Math.floor(Date.now()/1000) - 7200, exp: Math.floor(Date.now()/1000) - 3600 });
    const req = mockReq({ bearer: expiredToken });
    const res = mockRes();
    let nextCalled = false;
    requireAuth(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, "expired JWT via Bearer -> 401", `status=${res.statusCode}`);
  }

  section("logout/revocation — a revoked JWT via Bearer is rejected on the next request");
  {
    const token = signJWT({ role: "user", sub: "revoke-test-acct", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 3600 });
    const decoded = verifyJWT(token);
    revokeToken(decoded.jti, decoded.exp);
    const req = mockReq({ bearer: token });
    const res = mockRes();
    let nextCalled = false;
    requireAuth(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, "revoked JWT via Bearer -> 401 (same C10-027 ledger the cookie path already used)", `status=${res.statusCode}`);
  }

  section("malformed Authorization header does not crash requireAuth");
  {
    const req = { headers: { authorization: mobileToken }, body: {} }; // missing "Bearer " prefix
    const res = mockRes();
    let threw = false, nextCalled = false;
    try { requireAuth(req, res, () => { nextCalled = true; }); } catch { threw = true; }
    assert(!threw && res.statusCode === 401 && !nextCalled, "malformed Authorization header -> 401, no crash", `threw=${threw} status=${res.statusCode}`);
  }

  section("mobile login -> token/session: POST /api/auth/firebase-session returns a real usable JWT in the body");
  const fbHandler = findHandler("post", "/api/auth/firebase-session");
  let createdEmail = null;
  {
    createdEmail = `mission45-regression-${Date.now()}@example.com`;
    const req = { body: { idToken: "dev-mode-token", email: createdEmail, name: "Regression Test", provider: "firebase" }, headers: {} };
    const res = mockRes();
    await fbHandler(req, res);
    assert(res.body?.success === true && typeof res.body?.token === "string" && res.body.token.length > 20,
      "firebase-session returns {success:true, token} — mobile can use this as Bearer", JSON.stringify(res.body));
    assert(res.cookies["jarvis_auth"] === res.body?.token,
      "the same token is set as the cookie too — web callers unaffected, single source of truth", "");
    const decoded = res.body?.token ? verifyJWT(res.body.token) : null;
    assert(decoded?.email === createdEmail && decoded?.role === "user",
      "returned token verifies correctly via the real, unmodified verifyJWT()", JSON.stringify(decoded));
  }

  section("mobile login -> token/session: missing idToken/email is rejected before any account/session is created");
  {
    const req = { body: { email: "incomplete@example.com" }, headers: {} };
    const res = mockRes();
    await fbHandler(req, res);
    assert(res.statusCode === 400 && !res.body?.token, "missing idToken -> 400, no token issued", `status=${res.statusCode}`);
  }

  section("logout/session expiry: POST /api/auth/logout revokes a Bearer-only session (no cookie present)");
  const logoutHandler = findHandler("post", "/api/auth/logout");
  {
    const token = signJWT({ role: "user", sub: "logout-regression-acct", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 3600 });
    const before = verifyJWT(token);
    const req = { headers: { authorization: `Bearer ${token}` }, user: null, body: {} };
    const res = mockRes();
    logoutHandler(req, res);
    const after = verifyJWT(token);
    assert(!!before && res.body?.success === true && !after,
      "Bearer-only logout revokes the token server-side (mobile logout actually invalidates, not just forgets)", `after=${JSON.stringify(after)}`);
  }

  section("refresh: POST /api/auth/refresh rotates a Bearer-authenticated session's token");
  const refreshHandler = findHandler("post", "/api/auth/refresh");
  {
    const oldToken = signJWT({ role: "user", sub: "refresh-regression-acct", email: "refresh@example.com", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 3600 });
    const decodedOld = verifyJWT(oldToken);
    const req = { user: decodedOld, headers: { authorization: `Bearer ${oldToken}` }, body: {} };
    const res = mockRes();
    refreshHandler(req, res);
    const newDecoded = res.body?.token ? verifyJWT(res.body.token) : null;
    const oldStillValid = !!verifyJWT(oldToken);
    assert(res.body?.success === true && newDecoded?.sub === "refresh-regression-acct" && !oldStillValid,
      "refresh via Bearer returns a new valid token AND revokes the old one (rotation, not duplication)",
      `body=${JSON.stringify(res.body)} oldStillValid=${oldStillValid}`);
  }

  // cleanup: remove the account this test created
  try {
    const acct = accountSvc.getByEmail(createdEmail);
    if (acct && accountSvc.deleteAccount) accountSvc.deleteAccount(acct.id);
  } catch { /* best-effort test cleanup */ }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("CRASH:", e); process.exit(1); });
