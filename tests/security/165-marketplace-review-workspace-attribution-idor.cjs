#!/usr/bin/env node
"use strict";
/**
 * Marketplace review workspace-attribution IDOR — regression test.
 *
 * PHASE 4 — CAPABILITY MARKETPLACE (Missions 171-173, Trust/Rating).
 *
 * tests/security/115-plugins-marketplace-workspace-idor.cjs already fixed
 * and regression-tests the READ-side cross-tenant leak on marketplace.js's
 * catalog/featured/search/recommendations/plugin-detail routes (all now
 * gated with requireWorkspaceMember). That test's own header comment
 * explicitly says /marketplace/versions/:id and /marketplace/changelog/:id
 * are untouched because they take no workspaceId at all — but it does not
 * cover POST /marketplace/plugin/:id/review, a sibling route on the exact
 * same router that DID take a client-supplied workspaceId via the same
 * _wsId(req) helper and had no requireWorkspaceMember gate.
 *
 * Concretely: marketplaceService.cjs's addReview(pluginId, {...},
 * requestingAccountId, workspaceId) forwards workspaceId straight into
 * securityLayer.cjs's addAuditEntry(workspaceId, accountId, action, detail),
 * which creates the target workspace's own audit-log record on demand (if
 * it doesn't exist yet) and unconditionally appends to it. Before this
 * mission's fix, an authenticated account with the plugins.marketplace
 * billing entitlement but NO membership in workspace X could still POST a
 * review with ?workspaceId=X and cause a real audit-log entry to be written
 * into X's own audit trail — a cross-tenant audit-integrity/spoofed-
 * attribution defect on the same _wsId(req) pattern CLAUDE.md §6 calls out
 * as this repo's single most-repeated real defect class (a sibling route
 * missing the same middleware its neighbors already have).
 *
 * This is NOT a data-disclosure IDOR like 115's finding — the review itself
 * is global catalog data (not workspace-secret), and the response returned
 * to the caller reveals nothing about the victim workspace. The defect is
 * a write into another tenant's own audit trail under a spoofed workspace
 * attribution the caller does not actually belong to.
 *
 * Fix: requireWorkspaceMember added to this one route, matching every GET
 * sibling in the same file.
 *
 * Usage: node tests/security/165-marketplace-review-workspace-attribution-idor.cjs
 */

process.env.SKIP_PLATFORM_REGISTER = "1";
process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-165-marketplace-review-idor-secret";

const express = require("express");
const { signJWT, COOKIE_NAME } = require("../../backend/middleware/authMiddleware");
const wsSvc = require("../../backend/services/workspaceService.cjs");
const billing = require("../../backend/services/billingService.js");
const marketplaceRouter = require("../../backend/routes/marketplace.js");

let pass = 0, fail = 0;
const failures = [];
function ok(msg) { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(t) { console.log(`\n[${t}]`); }

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
  const victim = wsSvc.createWorkspace({ name: `T165 Victim ${suffix}`, creatorAccountId: `t165-victim-${suffix}` });
  const attacker = wsSvc.createWorkspace({ name: `T165 Attacker ${suffix}`, creatorAccountId: `t165-attacker-${suffix}` });
  wsSvc.switchWorkspace(victim.id, `t165-victim-${suffix}`);
  wsSvc.switchWorkspace(attacker.id, `t165-attacker-${suffix}`);
  billing.activatePlan(`t165-victim-${suffix}`, "starter");
  billing.activatePlan(`t165-attacker-${suffix}`, "starter");
  ok("victim and attacker workspaces created, both entitled to plugins.marketplace");

  section("POST /marketplace/plugin/:id/review — cross-tenant review attempt is blocked (403)");
  {
    const { server, base } = await startApp(marketplaceRouter);
    const attackerCookie = jwtCookieFor(`t165-attacker-${suffix}`);
    const victimCookie = jwtCookieFor(`t165-victim-${suffix}`);

    // plugin-slack-alerts is a real BUILT_IN_CATALOG entry (see
    // marketplaceService.cjs) — pick one that exists so a 404 doesn't mask
    // the auth-gate result.
    const pluginId = "plugin-slack-alerts";

    const crossTenantRes = await fetch(`${base}/marketplace/plugin/${pluginId}/review?workspaceId=${victim.id}`, {
      method: "POST",
      headers: { cookie: attackerCookie, "content-type": "application/json" },
      body: JSON.stringify({ rating: 5, body: "T165 attacker-authored review attributed to victim workspace" }),
    });
    assert(crossTenantRes.status === 403,
      "attacker posting a review with ?workspaceId=<victim> gets 403, not 200",
      `got status ${crossTenantRes.status}`);

    section("POST /marketplace/plugin/:id/review — legitimate same-workspace review still works");
    const ownRes = await fetch(`${base}/marketplace/plugin/${pluginId}/review`, {
      method: "POST",
      headers: { cookie: victimCookie, "content-type": "application/json" },
      body: JSON.stringify({ rating: 4, body: "T165 legitimate victim-authored review" }),
    });
    assert(ownRes.status === 200, "owner can review with no workspaceId (active-workspace fallback)", `got status ${ownRes.status}`);
    const ownBody = await ownRes.json();
    assert(ownBody?.review?.rating === 4, "review actually recorded for the legitimate caller", `got ${JSON.stringify(ownBody)}`);

    section("POST /marketplace/plugin/:id/review — same-workspace explicit workspaceId still works");
    const ownExplicitRes = await fetch(`${base}/marketplace/plugin/${pluginId}/review?workspaceId=${victim.id}`, {
      method: "POST",
      headers: { cookie: victimCookie, "content-type": "application/json" },
      body: JSON.stringify({ rating: 3, body: "T165 legitimate victim-authored review, explicit workspaceId" }),
    });
    assert(ownExplicitRes.status === 200, "a real member can still review citing their own workspaceId explicitly", `got status ${ownExplicitRes.status}`);

    server.close();
  }

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}`);
  if (failures.length) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    ✗ ${f.msg}: ${f.reason}`));
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
