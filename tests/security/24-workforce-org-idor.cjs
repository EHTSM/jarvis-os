#!/usr/bin/env node
"use strict";
/**
 * Workforce org-worker-listing cross-tenant IDOR regression —
 * backend/routes/workforce.js's GET /workforce/org/:orgId/workers.
 *
 * Confirmed finding (Zero-Trust Competitor Remediation, Phase 1): this
 * route called listWorkersForOrg(req.params.orgId) directly, gated only by
 * the barrel-level `router.use("/workforce", requireAuth)` — any
 * authenticated user could disclose any other org's human+AI worker
 * roster (account ids, org roles, dept/team assignment) by ID
 * guessing/incrementing.
 *
 * Reproduced live against a running server with two real accounts
 * (created via the app's own /accounts/register + /auth/login, no
 * mocking) before fixing: the attacker account successfully retrieved the
 * victim's real account id and org_owner role via this route.
 *
 * Fix: reuses attachOrg + requireOrgMember from orgMiddleware.cjs (the
 * same pair business.js's CRM routes already use) rather than inventing a
 * new check. Note a real pitfall hit and fixed during this remediation:
 * the first attempt threaded :orgId into attachOrg via
 * `req.query.orgId = req.params.orgId`, which silently no-ops under
 * Express 5 (req.query is a getter with no writable backing store in this
 * project's Express version) — attachOrg then fell through to its
 * auto-resolve-from-membership path and resolved the ATTACKER's own org
 * instead of the requested victim org, returning 200 with the attacker's
 * own (correct, but misleadingly "successful") data rather than a 403.
 * This test's "wrong org id in body must not be usable" style assertions
 * exist specifically to catch that class of silent-fallthrough bug if it
 * recurs — a 200 response must be checked against the CORRECT org's data,
 * not just treated as pass/fail by status code.
 *
 * The fix instead sets req.headers["x-org-id"] (a plain mutable object in
 * both Express 4 and 5, and attachOrg's highest-priority resolution
 * source) before calling attachOrg.
 *
 * Usage: node tests/security/24-workforce-org-idor.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-workforce-org-idor-secret";

const express = require("express");
const { signJWT, COOKIE_NAME, requireAuth } = require("../../backend/middleware/authMiddleware");
const orgSvc = require("../../backend/services/organizationService.cjs");
const workforceRouter = require("../../backend/routes/workforce.js");

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
  app.use(workforceRouter);
  const server = app.listen(0);
  await new Promise(r => server.on("listening", r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  const suffix = Date.now();
  const victimId   = `victim-wf-${suffix}`;
  const attackerId = `attacker-wf-${suffix}`;

  section("Setup — real org + membership via organizationService (not mocked)");
  const org = orgSvc.createOrg({ name: `Victim WF Org ${suffix}` }, victimId);
  const victimOrgId = org.id || org.org?.id;
  assert(!!victimOrgId, "victim org was created with a real id", `createOrg returned ${JSON.stringify(org)}`);
  const roleAfterCreate = orgSvc.getMemberRole(victimOrgId, victimId);
  assert(roleAfterCreate === "org_owner", "victim is registered as org_owner of their own org", `got role ${roleAfterCreate}`);
  const attackerRole = orgSvc.getMemberRole(victimOrgId, attackerId);
  assert(!attackerRole, "attacker has no role in victim's org (sanity check on test setup)", `attacker unexpectedly has role ${attackerRole}`);

  const { server, base } = await startApp();

  section("Attacker — cross-tenant worker-roster read is blocked");
  {
    const res = await fetch(`${base}/workforce/org/${victimOrgId}/workers`, { headers: { cookie: jwtCookieFor(attackerId) } });
    const body = await res.json().catch(() => ({}));
    assert(res.status === 403 || res.status === 404, "GET /workforce/org/:orgId/workers returns 403/404 for a non-member", `got status ${res.status}: ${JSON.stringify(body)}`);
    // Guard against the exact silent-fallthrough bug found during this
    // remediation: a 200 with data belonging to a DIFFERENT org than the
    // one requested is not a pass — it means the attacker got back their
    // own org's data instead of an error, which looks like "it worked"
    // but is a real authorization bypass (attachOrg's auto-resolve
    // fallback firing instead of the intended id-scoped check).
    if (res.status === 200) {
      const leakedRealData = Array.isArray(body.humans) && body.humans.length > 0;
      ko("response body must not contain org data on any 200 for a non-member", `got 200 with humans=${JSON.stringify(body.humans)} — attachOrg fell through to a different org instead of rejecting`);
    }
  }

  section("Legitimate owner access still works");
  {
    const res = await fetch(`${base}/workforce/org/${victimOrgId}/workers`, { headers: { cookie: jwtCookieFor(victimId) } });
    const body = await res.json();
    assert(res.status === 200, "owner can list their own org's workers", `got status ${res.status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.humans) && body.humans.some(h => h.id === victimId), "owner's own account appears in their org's roster", `humans=${JSON.stringify(body.humans)}`);
  }

  section("Regression guard — req.query mutation does not silently no-op (Express 5 pitfall)");
  {
    // Directly exercises the exact failure mode hit during this fix: if a
    // future edit reintroduces `req.query.orgId = req.params.orgId`
    // instead of the header-based approach, this assertion will catch it
    // by proving query mutation is unreliable in this project's Express
    // version — anyone re-adding that pattern will see this test explain
    // why not to.
    const app = express();
    let queryMutationStuck = null;
    app.get("/probe/:id", (req, res) => {
      req.query.probeId = req.params.id;
      queryMutationStuck = req.query.probeId === req.params.id;
      res.json({ ok: true });
    });
    const server2 = app.listen(0);
    await new Promise(r => server2.on("listening", r));
    await fetch(`http://127.0.0.1:${server2.address().port}/probe/test123`);
    server2.close();
    assert(queryMutationStuck === false, "documents that req.query mutation does not persist in this project's Express version (informs why the fix uses req.headers instead)", `req.query mutation persisted (queryMutationStuck=${queryMutationStuck}) — if Express was upgraded and this now passes, the header-based workaround in workforce.js is no longer necessary but is still safe`);
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
