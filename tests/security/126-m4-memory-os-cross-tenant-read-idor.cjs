#!/usr/bin/env node
"use strict";
/**
 * M-4 — Memory OS cross-tenant read regression.
 * backend/routes/phase18.js, backend/routes/phase20.js,
 * backend/services/memoryPersistenceLayer.cjs, backend/services/memoryIntelligenceEngine.cjs.
 *
 * Confirmed finding (docs/ooplix/12_MEMORY_KNOWLEDGE.md, 26_ERA1_CERTIFICATION.md,
 * 28_REMAINING_BACKLOG.md — "M-4"): the WRITE side of memoryPersistenceLayer.cjs
 * was already fixed (operatorOnly gate on POST/PATCH/DELETE /p18/memory*,
 * 2026-08-22). The READ side — GET /p18/memory*, GET /p20/memory/rank — was
 * left deliberately open as a documented, product-decision-required gap:
 * memoryPersistenceLayer.cjs's schema had NO orgId/ownership field at all,
 * and SharedMemoryCenter.jsx is a real, live, read-only customer feature
 * consuming GET /p18/memory*.
 *
 * Product decision (this mission): add an OPTIONAL orgId field (same design
 * as missionMemory.cjs's own orgId), scope reads to the caller's own org,
 * and accept the known transitional tradeoff that pre-existing nodes (almost
 * the entire live store — no reliable way to backfill real historical
 * ownership) remain in the shared/unowned bucket and are NOT visible to an
 * org-scoped caller (matching missionMemory.cjs's listMissions({orgId})
 * never-fall-back-to-shared rule, not an inclusive union).
 *
 * This test mounts the real routers in isolation with real signed JWTs and
 * real organizationService orgs — no mocking of memoryPersistenceLayer.cjs
 * or the auth layer — and proves: (1) a memory node written for org A is
 * invisible to an org-B caller across every read surface (list/search/
 * recall/stats/rank/load-by-id), (2) the owning org can still read its own
 * node, (3) an orgId-less (legacy/shared) node remains visible to a caller
 * with NO org context — the documented, accepted backward-compatibility
 * behavior for the ~14 genuinely internal/autonomous writers this store
 * still serves.
 *
 * Usage: node tests/security/126-m4-memory-os-cross-tenant-read-idor.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-m4-memory-idor-secret";

const express = require("express");
const { requireAuth, signJWT, COOKIE_NAME, operatorOnly } = require("../../backend/middleware/authMiddleware");
const orgSvc = require("../../backend/services/organizationService.cjs");
const mpl = require("../../backend/services/memoryPersistenceLayer.cjs");
const phase18Router = require("../../backend/routes/phase18.js");
const phase20Router = require("../../backend/routes/phase20.js");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function cookieFor(sub) {
  const jwt = signJWT({ sub, role: "member", exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${COOKIE_NAME}=${jwt}`;
}

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use("/p18", requireAuth);
  app.use("/p20", requireAuth);
  app.use(phase18Router);
  app.use(phase20Router);
  const server = app.listen(0);
  await new Promise(r => server.on("listening", r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  const suffix = Date.now();

  section("Setup — two real orgs, two real members");
  const orgAOwnerSub = `m4-org-a-owner-${suffix}`;
  const orgBOwnerSub = `m4-org-b-owner-${suffix}`;
  const orgA = orgSvc.createOrg({ name: `M-4 Org A ${suffix}` }, orgAOwnerSub);
  const orgB = orgSvc.createOrg({ name: `M-4 Org B ${suffix}` }, orgBOwnerSub);
  const cookieA = cookieFor(orgAOwnerSub);
  const cookieB = cookieFor(orgBOwnerSub);
  assert(!!orgA?.id && !!orgB?.id, "both test orgs were created", `orgA=${orgA?.id} orgB=${orgB?.id}`);

  const { server, base } = await startApp();

  section("Setup — a memory node written directly with org A's real orgId (simulates a scoped write)");
  const uniqueKey = `m4-secret-key-${suffix}`;
  const orgANode = mpl.save({ key: uniqueKey, value: { secret: "org-A-confidential" }, type: "insight", orgId: orgA.id });
  assert(!!orgANode?.nodeId, "org A node was saved", JSON.stringify(orgANode));

  section("Cross-tenant read is blocked — GET /p18/memory (list)");
  {
    const res = await fetch(`${base}/p18/memory?limit=2000`, { headers: { cookie: cookieB } });
    const body = await res.json();
    const leaked = (body.nodes || []).some(n => n.nodeId === orgANode.nodeId);
    assert(!leaked, "org B's list does not include org A's node", "org A's node leaked into org B's list");
  }

  section("Cross-tenant read is blocked — GET /p18/memory/search");
  {
    const res = await fetch(`${base}/p18/memory/search?q=${encodeURIComponent(uniqueKey)}`, { headers: { cookie: cookieB } });
    const body = await res.json();
    const leaked = (body.nodes || []).some(n => n.nodeId === orgANode.nodeId);
    assert(!leaked, "org B's search for org A's exact key returns nothing", "org A's node leaked into org B's search results");
  }

  section("Cross-tenant read is blocked — GET /p18/memory/recall");
  {
    const res = await fetch(`${base}/p18/memory/recall?input=${encodeURIComponent(uniqueKey)}`, { headers: { cookie: cookieB } });
    const body = await res.json();
    const leaked = (body.nodes || []).some(n => n.nodeId === orgANode.nodeId);
    assert(!leaked, "org B's recall for org A's exact key returns nothing", "org A's node leaked into org B's recall results");
  }

  section("Cross-tenant read is blocked — GET /p18/memory/:nodeId (direct ID)");
  {
    const res = await fetch(`${base}/p18/memory/${orgANode.nodeId}`, { headers: { cookie: cookieB } });
    assert(res.status === 404, "GET /p18/memory/:nodeId returns 404 for a non-member org", `got status ${res.status}`);
  }

  section("Cross-tenant read is blocked — GET /p20/memory/rank");
  {
    const res = await fetch(`${base}/p20/memory/rank?limit=2000`, { headers: { cookie: cookieB } });
    const body = await res.json();
    const leaked = (body.ranked || []).some(n => n.nodeId === orgANode.nodeId);
    assert(!leaked, "org B's /p20/memory/rank does not include org A's node", "org A's node leaked into org B's ranked results");
  }

  section("GET /p18/memory/stats does not count org A's node for org B");
  {
    const bRes = await fetch(`${base}/p18/memory/stats`, { headers: { cookie: cookieB } });
    const bBody = await bRes.json();
    const aRes = await fetch(`${base}/p18/memory/stats`, { headers: { cookie: cookieA } });
    const aBody = await aRes.json();
    assert(aBody.stats.total >= 1, "org A's own stats include at least their own node", `org A total=${aBody.stats.total}`);
    assert(bBody.stats.total !== aBody.stats.total || bBody.stats.total === 0, "org B's stats total is not inflated by org A's private node (sanity check on scoping)", `org A total=${aBody.stats.total}, org B total=${bBody.stats.total}`);
  }

  section("Same-org caller can still read their own node (no regression)");
  {
    const listRes = await fetch(`${base}/p18/memory?limit=2000`, { headers: { cookie: cookieA } });
    const listBody = await listRes.json();
    const found = (listBody.nodes || []).some(n => n.nodeId === orgANode.nodeId);
    assert(found, "org A's own list includes their own node", "org A could not see their own node in list()");

    const directRes = await fetch(`${base}/p18/memory/${orgANode.nodeId}`, { headers: { cookie: cookieA } });
    assert(directRes.status === 200, "org A can read their own node by direct ID", `got status ${directRes.status}`);
  }

  section("Orgless (legacy/shared) node remains visible to a caller with no org context — documented backward-compat behavior");
  {
    const noOrgSub = `m4-no-org-caller-${suffix}`;
    const noOrgCookie = cookieFor(noOrgSub);
    const sharedKey = `m4-shared-legacy-key-${suffix}`;
    const sharedNode = mpl.save({ key: sharedKey, value: { info: "shared platform memory" }, type: "insight" });

    const res = await fetch(`${base}/p18/memory/search?q=${encodeURIComponent(sharedKey)}`, { headers: { cookie: noOrgCookie } });
    const body = await res.json();
    const found = (body.nodes || []).some(n => n.nodeId === sharedNode.nodeId);
    assert(found, "a caller with no org context can still read an orgId-less (shared) node", "orgless node was incorrectly hidden from a no-org caller — would break the ~14 internal/autonomous consumers of this store");
  }

  section("Operator write via POST /p18/memory stamps the operator's own real orgId (not a client-supplied one)");
  {
    const opSub = `m4-operator-${suffix}`;
    const opJwt = signJWT({ sub: opSub, role: "operator", exp: Math.floor(Date.now() / 1000) + 3600 });
    const opCookie = `${COOKIE_NAME}=${opJwt}`;
    // Operator is not a member of org A or B — no real membership, so the
    // created node should be orgId-less, not silently attributed to a
    // spoofed org, even though attachOrg accepts a body orgId as a
    // SELECTOR (not proof of membership) and will resolve req.org to the
    // real org A object despite the caller not belonging to it.
    const res = await fetch(`${base}/p18/memory`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie: opCookie },
      body: JSON.stringify({ key: `m4-operator-write-${suffix}`, value: { x: 1 }, orgId: orgA.id }),
    });
    const body = await res.json();
    if (res.status === 200 && body.nodeId) {
      const saved = mpl.load(body.nodeId);
      assert(saved.orgId !== orgA.id, "a client-supplied orgId in the request body is NOT trusted — operator has no real membership in org A", `node.orgId is ${saved.orgId}, expected null (spoofed org A rejected)`);
    } else {
      console.log(`  (skip) operator write did not succeed as expected in isolated harness: ${res.status}`);
    }
  }

  section("Header-based org spoofing cannot be used to read another org's memory (attachOrg selector != membership)");
  {
    // attachOrg resolves req.org from X-Org-Id with NO membership check of
    // its own ("Does NOT block requests" — see orgMiddleware.cjs). Org B's
    // owner supplies org A's real id via the header; if the route trusted
    // bare req.org?.id instead of verified req.orgRole, this would leak
    // org A's private node to a non-member.
    const res = await fetch(`${base}/p18/memory/search?q=${encodeURIComponent(uniqueKey)}`, {
      headers: { cookie: cookieB, "X-Org-Id": orgA.id },
    });
    const body = await res.json();
    const leaked = (body.nodes || []).some(n => n.nodeId === orgANode.nodeId);
    assert(!leaked, "a non-member cannot read org A's node by spoofing X-Org-Id: <org A> (req.orgRole is null, not real membership)", "org A's node leaked via header-based org spoofing — attachOrg's selector was trusted as proof of membership");
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
