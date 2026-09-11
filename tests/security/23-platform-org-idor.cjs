#!/usr/bin/env node
"use strict";
/**
 * Platform-org (Level Ω "Artificial Organization Platform") cross-tenant
 * IDOR regression — backend/routes/platformOrg.js.
 *
 * Confirmed finding (Zero-Trust Competitor Remediation, Phase 1): every
 * route in this file resolved a platform-org by client-supplied :orgId (or
 * body/query orgId) with zero ownership check — gated only by the
 * barrel-level `router.use("/platform", requireAuth)` in routes/index.js,
 * which authenticates but never authorizes. `ownerId`/`tenantId` on create
 * routes were also accepted verbatim from the request body, meaning
 * ownership itself was spoofable, not just unchecked on read.
 *
 * Reproduced live against a running server (two real accounts created via
 * the app's own /accounts/register + /auth/login) before fixing: an
 * attacker account could GET another account's private org, export its
 * full data package, view its digital twin, clone it, and PATCH its
 * lifecycle status to "retired" — a destructive mutation, not just a read.
 *
 * Fix: ownerId is now always derived server-side from req.user.sub on every
 * creation/import/clone path (never trusted from the body). A new
 * _requireOrgOwner middleware resolves the org and rejects with 404 unless
 * the requester is the recorded owner or a global enterprise_admin.
 *
 * This test mounts the real router in isolation (same pattern as
 * tests/security/09-workspace-isolation-security.cjs) and exercises it with
 * real signed JWTs — no mocking of platformState.cjs or the auth layer.
 *
 * Usage: node tests/security/23-platform-org-idor.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-platform-org-idor-secret";

// Gap Closure (Mission 102 follow-on): this file starts a real Express
// server and creates real platform-org records via platformOrg.js ->
// platformState.cjs, which (unlike this file, until now) already honors
// JARVIS_TEST_DATA_SUFFIX. Setting it here, before platformOrg.js is first
// required below, redirects platformState.cjs's DATA_DIR to an isolated
// per-run directory instead of the real data/platform/registry.json —
// stopping this file's confirmed, still-growing contribution to that
// file's test-pollution (Mission 102: 43-44 attributable records found).
process.env.JARVIS_TEST_DATA_SUFFIX = process.env.JARVIS_TEST_DATA_SUFFIX || `test-${process.pid}-${Date.now()}`;

const express = require("express");
const { signJWT, COOKIE_NAME } = require("../../backend/middleware/authMiddleware");
const platformOrgRouter = require("../../backend/routes/platformOrg.js");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function jwtCookieFor(sub) {
  const jwt = signJWT({ sub, role: "member", exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${COOKIE_NAME}=${jwt}`;
}

// requireAuth reads req.user off the verified JWT cookie — replicate the
// same barrel-level gate routes/index.js applies in front of this router,
// so the test exercises the real authorization logic, not a bypassed
// direct call.
async function startApp() {
  const { requireAuth } = require("../../backend/middleware/authMiddleware");
  const app = express();
  app.use(express.json());
  app.use("/platform", requireAuth);
  app.use(platformOrgRouter);
  const server = app.listen(0);
  await new Promise(r => server.on("listening", r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  const suffix = Date.now();
  const victimSub   = `victim-${suffix}`;
  const attackerSub = `attacker-${suffix}`;
  const victimCookie   = jwtCookieFor(victimSub);
  const attackerCookie = jwtCookieFor(attackerSub);

  const { server, base } = await startApp();

  section("Setup — victim creates a private platform org");
  let victimOrgId;
  {
    const res = await fetch(`${base}/platform/v1/orgs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: victimCookie },
      body: JSON.stringify({ name: `Victim Confidential Agency ${suffix}`, type: "agency", visibility: "private", ownerId: "spoofed-owner-attempt" }),
    });
    const body = await res.json();
    assert(res.status === 200 && body.ok, "victim can create a private platform org", `got status ${res.status}: ${JSON.stringify(body)}`);
    victimOrgId = body.org?.id;
    assert(!!victimOrgId, "org was assigned an id", "no org id in response");
    assert(body.org?.ownerId === victimSub, "ownerId is bound to the real authenticated caller, not the spoofed body value", `expected ownerId=${victimSub}, got ${body.org?.ownerId}`);
  }

  section("Attacker — cross-tenant read is blocked");
  {
    const res = await fetch(`${base}/platform/v1/orgs/${victimOrgId}`, { headers: { cookie: attackerCookie } });
    assert(res.status === 404, "GET /platform/v1/orgs/:id returns 404 for a non-owner", `got status ${res.status}`);
  }

  section("Attacker — cross-tenant export is blocked");
  {
    const res = await fetch(`${base}/platform/v1/export/${victimOrgId}`, { headers: { cookie: attackerCookie } });
    assert(res.status === 404, "GET /platform/v1/export/:orgId returns 404 for a non-owner", `got status ${res.status}`);
  }

  section("Attacker — cross-tenant digital twin read is blocked");
  {
    const res = await fetch(`${base}/platform/v1/twin/${victimOrgId}`, { headers: { cookie: attackerCookie } });
    assert(res.status === 404, "GET /platform/v1/twin/:orgId returns 404 for a non-owner", `got status ${res.status}`);
  }

  section("Attacker — cross-tenant lifecycle mutation (retire) is blocked");
  {
    const res = await fetch(`${base}/platform/v1/lifecycle/${victimOrgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: attackerCookie },
      body: JSON.stringify({ status: "retired" }),
    });
    assert(res.status === 404, "PATCH /platform/v1/lifecycle/:orgId returns 404 for a non-owner", `got status ${res.status}`);
  }

  section("Attacker — cross-tenant clone is blocked");
  {
    const res = await fetch(`${base}/platform/v1/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: attackerCookie },
      body: JSON.stringify({ sourceOrgId: victimOrgId, newName: "Stolen Copy" }),
    });
    assert(res.status === 404, "POST /platform/v1/clone returns 404 for a non-owner sourceOrgId", `got status ${res.status}`);
  }

  section("Attacker — cross-tenant rollback is blocked");
  {
    const res = await fetch(`${base}/platform/v1/versions/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: attackerCookie },
      body: JSON.stringify({ orgId: victimOrgId, versionId: "v_fake" }),
    });
    assert(res.status === 404, "POST /platform/v1/versions/rollback returns 404 for a non-owner orgId", `got status ${res.status}`);
  }

  section("Verify no side effect actually occurred despite the attempts");
  {
    const res = await fetch(`${base}/platform/v1/orgs/${victimOrgId}`, { headers: { cookie: victimCookie } });
    const body = await res.json();
    assert(body.org?.status !== "retired", "victim's org status was not changed to retired by the blocked attack", `org status is ${body.org?.status}`);
  }

  section("Legitimate owner access still works");
  {
    const readRes = await fetch(`${base}/platform/v1/orgs/${victimOrgId}`, { headers: { cookie: victimCookie } });
    assert(readRes.status === 200, "owner can GET their own org", `got status ${readRes.status}`);

    const exportRes = await fetch(`${base}/platform/v1/export/${victimOrgId}`, { headers: { cookie: victimCookie } });
    assert(exportRes.status === 200, "owner can export their own org", `got status ${exportRes.status}`);

    const twinRes = await fetch(`${base}/platform/v1/twin/${victimOrgId}`, { headers: { cookie: victimCookie } });
    assert(twinRes.status === 200, "owner can view their own org's digital twin", `got status ${twinRes.status}`);

    const lifecycleRes = await fetch(`${base}/platform/v1/lifecycle/${victimOrgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: victimCookie },
      body: JSON.stringify({ status: "paused" }),
    });
    const lifecycleBody = await lifecycleRes.json();
    assert(lifecycleRes.status === 200 && lifecycleBody.org?.status === "paused", "owner can legitimately mutate their own org's lifecycle", `got status ${lifecycleRes.status}: ${JSON.stringify(lifecycleBody)}`);
  }

  section("List endpoints do not leak other accounts' orgs");
  {
    const res = await fetch(`${base}/platform/v1/orgs`, { headers: { cookie: attackerCookie } });
    const body = await res.json();
    const leaked = (body.orgs || []).some(o => o.id === victimOrgId);
    assert(!leaked, "GET /platform/v1/orgs (attacker's own list) does not include victim's org", "victim's org leaked into attacker's org list");
  }

  server.close();

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    ✗ ${f.msg}: ${f.reason}`));
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
