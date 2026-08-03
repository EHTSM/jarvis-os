#!/usr/bin/env node
"use strict";
/**
 * Workspace isolation security tests — /security/* and /admin/* routes.
 *
 * Regression coverage for a confirmed cross-tenant IDOR: both route files
 * previously resolved the target workspace from a raw client-supplied
 * `workspaceId` (query/body param) via a local `_wsId(req)` helper, and never
 * called requireWorkspaceMember. Any authenticated user — regardless of their
 * own workspace membership — could read another workspace's sessions,
 * devices, audit log, and API/service tokens, and could revoke another
 * workspace's tokens/sessions/devices outright.
 *
 * Fix: both routers now call requireWorkspaceMember after attachWorkspace,
 * and `_wsId(req)` returns only the already-membership-validated
 * req.workspace.id — never req.query/body.workspaceId directly.
 *
 * Usage: node tests/security/09-workspace-isolation-security.cjs
 */

process.env.SKIP_PLATFORM_REGISTER = "1";
process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-workspace-isolation-secret";

const express = require("express");
const { signJWT, COOKIE_NAME } = require("../../backend/middleware/authMiddleware");
const wsSvc        = require("../../backend/services/workspaceService.cjs");
const secSvc        = require("../../backend/services/securityLayer.cjs");
const securityRouter = require("../../backend/routes/security.js");
const adminRouter    = require("../../backend/routes/admin.js");

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

async function startApp(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await new Promise(r => server.on("listening", r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  const suffix = Date.now();

  section("Setup — victim and attacker workspaces");
  const victim   = wsSvc.createWorkspace({ name: `Victim Co ${suffix}`,   creatorAccountId: `victim-owner-${suffix}` });
  const attacker = wsSvc.createWorkspace({ name: `Attacker Co ${suffix}`, creatorAccountId: `attacker-owner-${suffix}` });
  wsSvc.switchWorkspace(victim.id, `victim-owner-${suffix}`);
  wsSvc.switchWorkspace(attacker.id, `attacker-owner-${suffix}`);
  const victimToken = secSvc.createToken(victim.id, { name: "victim-secret-token", type: "service", createdBy: `victim-owner-${suffix}` });
  ok("victim workspace has a real service token to protect");

  // ── /security/* ────────────────────────────────────────────────
  section("/security/* — cross-tenant token read is blocked");
  {
    const { server, base } = await startApp(securityRouter);
    const cookie = jwtCookieFor(`attacker-owner-${suffix}`);

    const res = await fetch(`${base}/security/tokens?workspaceId=${victim.id}`, { headers: { cookie } });
    const body = await res.json();
    assert(res.status === 403, "GET /security/tokens?workspaceId=<victim> returns 403 for a non-member", `got status ${res.status}`);
    const leaked = (body.tokens || []).some(t => t.id === victimToken.id);
    assert(!leaked, "victim's token is not present in the response", "victim token leaked to attacker");

    section("/security/* — cross-tenant token revoke is blocked");
    const del = await fetch(`${base}/security/tokens/${victimToken.id}?workspaceId=${victim.id}`, { method: "DELETE", headers: { cookie } });
    assert(del.status === 403, "DELETE /security/tokens/:id?workspaceId=<victim> returns 403 for a non-member", `got status ${del.status}`);
    const stillActive = secSvc.getTokens(victim.id).some(t => t.id === victimToken.id);
    assert(stillActive, "victim's token is still active after attacker's revoke attempt", "victim token was revoked by a non-member");

    section("/security/* — legitimate same-workspace access still works");
    const ownCookie = jwtCookieFor(`victim-owner-${suffix}`);
    const own = await fetch(`${base}/security/tokens`, { headers: { cookie: ownCookie } }); // no workspaceId — active-workspace fallback
    const ownBody = await own.json();
    assert(own.status === 200, "GET /security/tokens (no param, active-workspace fallback) returns 200 for the real owner", `got status ${own.status}`);
    assert((ownBody.tokens || []).some(t => t.id === victimToken.id), "owner can see their own workspace's token", "owner could not see their own token");

    const ownExplicit = await fetch(`${base}/security/tokens?workspaceId=${victim.id}`, { headers: { cookie: ownCookie } });
    assert(ownExplicit.status === 200, "GET /security/tokens?workspaceId=<own> returns 200 for the real owner", `got status ${ownExplicit.status}`);

    server.close();
  }

  // ── /admin/* ───────────────────────────────────────────────────
  section("/admin/* — cross-tenant team directory read is blocked");
  {
    const { server, base } = await startApp(adminRouter);
    const cookie = jwtCookieFor(`attacker-owner-${suffix}`);

    const res = await fetch(`${base}/admin/team?workspaceId=${victim.id}`, { headers: { cookie } });
    assert(res.status === 403, "GET /admin/team?workspaceId=<victim> returns 403 for a non-member", `got status ${res.status}`);

    section("/admin/* — legitimate same-workspace access still works");
    const ownCookie = jwtCookieFor(`victim-owner-${suffix}`);
    const own = await fetch(`${base}/admin/team`, { headers: { cookie: ownCookie } });
    assert(own.status === 200, "GET /admin/team (active-workspace fallback) returns 200 for the real owner", `got status ${own.status}`);

    server.close();
  }

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    ✗ ${f.msg}: ${f.reason}`));
  }

  try {
    require("fs").writeFileSync(
      require("path").join(process.cwd(), "data/workspace-isolation-security-test-report.json"),
      JSON.stringify({ generated: new Date().toISOString(), pass, fail, failures }, null, 2)
    );
    console.log("\n  Report: data/workspace-isolation-security-test-report.json\n");
  } catch { /* non-critical */ }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
