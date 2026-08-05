#!/usr/bin/env node
"use strict";
/**
 * Closed-beta org deletion-check cross-tenant IDOR regression —
 * backend/routes/closedBeta.js's GET /cbeta/orgs/:orgId/deletion-check.
 *
 * CONFIRMED finding, discovered during Phase 4 (Enterprise Readiness)
 * systemic tenant-isolation verification — same bug class as the
 * platformOrg.js and workforce.js IDORs fixed earlier in this remediation
 * pass, found by auditing every route file that reads req.params.orgId
 * for a membership/permission check. GET /cbeta/orgs/:orgId/deletion-check
 * had no ownership check, gated only by the barrel-level
 * `router.use("/cbeta", requireAuth)` — any authenticated user could
 * disclose another org's member count and open-mission count by ID
 * guessing/incrementing.
 *
 * Note: the DELETE route on the same :orgId param (DELETE /cbeta/orgs/:orgId)
 * was investigated and found NOT vulnerable — it delegates through
 * svc.safeDeleteOrg -> organizationService.deleteOrg -> archiveOrg, which
 * already calls _assertPermission(orgId, accountId, "delete_org") at the
 * deepest layer. Only the read-side deletion-check route was missing a
 * check.
 *
 * Reproduced live against a running server with two real accounts
 * (created via the app's own /accounts/register + /auth/login) before
 * fixing: the attacker account retrieved the victim's real member/mission
 * counts through this route.
 *
 * Fix: added _requireOrgMemberOrAdmin middleware (checks
 * organizationService.getMemberRole()/isEnterpriseAdmin(), rejects with
 * 404 to avoid confirming org existence to a non-member) to the
 * deletion-check route.
 *
 * Usage: node tests/security/30-closedbeta-deletion-check-idor.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-closedbeta-idor-secret";

const express = require("express");
const { signJWT, COOKIE_NAME } = require("../../backend/middleware/authMiddleware");
const orgSvc = require("../../backend/services/organizationService.cjs");
const closedBetaRouter = require("../../backend/routes/closedBeta.js");

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

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use(closedBetaRouter);
  const server = app.listen(0);
  await new Promise(r => server.on("listening", r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  const suffix = Date.now();
  const victimId   = `victim-cbeta-${suffix}`;
  const attackerId = `attacker-cbeta-${suffix}`;

  section("Setup — real org + membership via organizationService (not mocked)");
  const org = orgSvc.createOrg({ name: `Victim CBeta Org ${suffix}` }, victimId);
  const victimOrgId = org.id || org.org?.id;
  assert(!!victimOrgId, "victim org was created with a real id", `createOrg returned ${JSON.stringify(org)}`);
  assert(!orgSvc.getMemberRole(victimOrgId, attackerId), "attacker has no role in victim's org (sanity check)", "attacker unexpectedly has a role");

  const { server, base } = await startApp();

  section("Attacker — cross-tenant deletion-check read is blocked");
  {
    const res = await fetch(`${base}/cbeta/orgs/${victimOrgId}/deletion-check`, { headers: { cookie: jwtCookieFor(attackerId) } });
    assert(res.status === 404, "GET /cbeta/orgs/:orgId/deletion-check returns 404 for a non-member", `got status ${res.status}`);
  }

  section("Legitimate member access still works");
  {
    const res = await fetch(`${base}/cbeta/orgs/${victimOrgId}/deletion-check`, { headers: { cookie: jwtCookieFor(victimId) } });
    const body = await res.json();
    assert(res.status === 200, "org owner can read their own org's deletion-check", `got status ${res.status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.checks), "response includes the real checks array", `got ${JSON.stringify(body)}`);
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
