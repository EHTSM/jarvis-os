#!/usr/bin/env node
"use strict";
/**
 * Plugins & Marketplace workspace-IDOR — regression test.
 *
 * plugins.js and marketplace.js both resolved the target workspace via a
 * local _wsId(req) helper that reads req.query.workspaceId /
 * req.body.workspaceId directly (client-supplied), and neither router called
 * requireWorkspaceMember on their read-only routes (the mutating routes on
 * plugins.js already correctly composed requireRole(), which does enforce
 * real membership via req.workspaceRole). Any authenticated account —
 * regardless of their own workspace membership — could supply another
 * workspace's id and read its installed plugin list, health, diagnostics,
 * stats, manifest, and per-plugin config (live-reproduced: a real victim
 * workspace's plugin config, including a secret-like value, was returned to
 * an unrelated attacker account with 200) via plugins.js, and its
 * installed/depsMet flags via marketplace.js's catalog/featured/search/
 * recommendations/plugin-detail routes.
 *
 * Fix: requireWorkspaceMember (the existing real membership check already
 * proven on extensions.js's identical defect) added after attachWorkspace on
 * every previously-unguarded read route in both files. The default
 * "view my own workspace" case (no workspaceId supplied) is unaffected,
 * since attachWorkspace's own fallback (getActiveWorkspace) always resolves
 * to a real workspace the caller is trivially a member of.
 *
 * /plugins/validate is untouched (no workspaceId, validates a manifest
 * against a schema only). /marketplace/categories is untouched (computes a
 * per-workspace installedIds value but never uses it in the response — no
 * data to leak). /marketplace/versions/:id and /marketplace/changelog/:id
 * are untouched (no workspaceId parameter at all).
 *
 * Usage: node tests/security/115-plugins-marketplace-workspace-idor.cjs
 */

process.env.SKIP_PLATFORM_REGISTER = "1";
process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-115-plugins-marketplace-idor-secret";

const express = require("express");
const { signJWT, COOKIE_NAME } = require("../../backend/middleware/authMiddleware");
const wsSvc = require("../../backend/services/workspaceService.cjs");
const billing = require("../../backend/services/billingService.js");
const pluginsRouter = require("../../backend/routes/plugins.js");
const marketplaceRouter = require("../../backend/routes/marketplace.js");
const mgr = require("../../backend/services/pluginManagerService.cjs");

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

  section("Setup — victim and attacker workspaces + a victim plugin install");
  const victim = wsSvc.createWorkspace({ name: `T115 Victim ${suffix}`, creatorAccountId: `t115-victim-${suffix}` });
  const attacker = wsSvc.createWorkspace({ name: `T115 Attacker ${suffix}`, creatorAccountId: `t115-attacker-${suffix}` });
  wsSvc.switchWorkspace(victim.id, `t115-victim-${suffix}`);
  wsSvc.switchWorkspace(attacker.id, `t115-attacker-${suffix}`);
  // Clears the unrelated account-level requireFeature("plugins.marketplace")
  // gate so this test isolates the workspace-membership check under test.
  billing.activatePlan(`t115-victim-${suffix}`, "starter");
  billing.activatePlan(`t115-attacker-${suffix}`, "starter");

  const manifest = {
    id: `t115-secret-plugin-${suffix}`,
    name: "T115 Secret Plugin",
    version: "1.0.0",
    description: "test",
    author: "t115-test",
    category: "general",
    capabilities: ["test.capability"],
    configSchema: { required: ["apiKey"] },
  };
  mgr.install(victim.id, manifest, `t115-victim-${suffix}`);
  mgr.updateConfig(victim.id, manifest.id, { apiKey: "victim-super-secret-key" }, `t115-victim-${suffix}`);
  ok("victim workspace has a real installed plugin with a secret config value to protect");

  // ── /plugins/* ──────────────────────────────────────────────────
  section("/plugins/* — cross-tenant reads are blocked (403)");
  {
    const { server, base } = await startApp(pluginsRouter);
    const attackerCookie = jwtCookieFor(`t115-attacker-${suffix}`);
    const victimCookie = jwtCookieFor(`t115-victim-${suffix}`);

    const routes = [
      ["GET /plugins",                    `/plugins?workspaceId=${victim.id}`],
      ["GET /plugins/health",             `/plugins/health?workspaceId=${victim.id}`],
      ["GET /plugins/diagnostics",        `/plugins/diagnostics?workspaceId=${victim.id}`],
      ["GET /plugins/stats",              `/plugins/stats?workspaceId=${victim.id}`],
      ["GET /plugins/manifest/:id",       `/plugins/manifest/${manifest.id}?workspaceId=${victim.id}`],
      ["GET /plugins/:id/config",         `/plugins/${manifest.id}/config?workspaceId=${victim.id}`],
      ["GET /plugins/:id",                `/plugins/${manifest.id}?workspaceId=${victim.id}`],
    ];
    for (const [label, path] of routes) {
      const res = await fetch(`${base}${path}`, { headers: { cookie: attackerCookie } });
      assert(res.status === 403, `${label}?workspaceId=<victim> returns 403 for a non-member`, `got status ${res.status}`);
    }

    section("/plugins/* — no cross-tenant secret leak in the (blocked) response");
    const cfgRes = await fetch(`${base}/plugins/${manifest.id}/config?workspaceId=${victim.id}`, { headers: { cookie: attackerCookie } });
    const cfgBody = await cfgRes.json();
    assert(JSON.stringify(cfgBody).includes("victim-super-secret-key") === false, "victim's secret config value never appears in the attacker's response", `body: ${JSON.stringify(cfgBody)}`);

    section("/plugins/* — legitimate same-workspace access still works");
    const ownCfg = await fetch(`${base}/plugins/${manifest.id}/config?workspaceId=${victim.id}`, { headers: { cookie: victimCookie } });
    const ownBody = await ownCfg.json();
    assert(ownCfg.status === 200, "owner can read their own workspace's plugin config", `got status ${ownCfg.status}`);
    assert(ownBody?.config?.apiKey === "victim-super-secret-key", "owner sees the real config value", `got ${JSON.stringify(ownBody)}`);

    const ownList = await fetch(`${base}/plugins`, { headers: { cookie: victimCookie } });
    assert(ownList.status === 200, "owner can list plugins with no workspaceId (active-workspace fallback)", `got status ${ownList.status}`);

    server.close();
  }

  // ── /marketplace/* ──────────────────────────────────────────────
  section("/marketplace/* — cross-tenant reads are blocked (403)");
  {
    const { server, base } = await startApp(marketplaceRouter);
    const attackerCookie = jwtCookieFor(`t115-attacker-${suffix}`);
    const victimCookie = jwtCookieFor(`t115-victim-${suffix}`);

    const routes = [
      ["GET /marketplace/catalog",         `/marketplace/catalog?workspaceId=${victim.id}`],
      ["GET /marketplace/featured",        `/marketplace/featured?workspaceId=${victim.id}`],
      ["GET /marketplace/search",          `/marketplace/search?q=test&workspaceId=${victim.id}`],
      ["GET /marketplace/recommendations", `/marketplace/recommendations?workspaceId=${victim.id}`],
      ["GET /marketplace/plugin/:id",      `/marketplace/plugin/${manifest.id}?workspaceId=${victim.id}`],
    ];
    for (const [label, path] of routes) {
      const res = await fetch(`${base}${path}`, { headers: { cookie: attackerCookie } });
      assert(res.status === 403, `${label}?workspaceId=<victim> returns 403 for a non-member`, `got status ${res.status}`);
    }

    section("/marketplace/* — legitimate same-workspace + no-workspaceId access still works");
    const ownCatalog = await fetch(`${base}/marketplace/catalog`, { headers: { cookie: victimCookie } });
    assert(ownCatalog.status === 200, "owner can browse catalog with no workspaceId (active-workspace fallback)", `got status ${ownCatalog.status}`);

    section("/marketplace/* — deliberately-unguarded routes remain unguarded (no data to leak)");
    const categories = await fetch(`${base}/marketplace/categories?workspaceId=${victim.id}`, { headers: { cookie: attackerCookie } });
    assert(categories.status === 200, "categories has no per-workspace data in its response, so it is intentionally not gated", `got status ${categories.status}`);

    const versions = await fetch(`${base}/marketplace/versions/${manifest.id}`, { headers: { cookie: attackerCookie } });
    assert(versions.status !== 403, "versions/:id takes no workspaceId, so it is intentionally not gated", `got status ${versions.status}`);

    server.close();
  }

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}`);
  if (failures.length) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    ✗ ${f.msg}: ${f.reason}`));
  }

  try {
    require("fs").writeFileSync(
      require("path").join(process.cwd(), "data/115-plugins-marketplace-workspace-idor-report.json"),
      JSON.stringify({ generated: new Date().toISOString(), pass, fail, failures }, null, 2)
    );
    console.log("\n  Report: data/115-plugins-marketplace-workspace-idor-report.json\n");
  } catch { /* non-critical */ }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
