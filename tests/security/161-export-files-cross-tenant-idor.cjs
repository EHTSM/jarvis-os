#!/usr/bin/env node
"use strict";
/**
 * backend/routes/exportFiles.js — cross-tenant export-file disclosure
 * (Mission 78, final pre-VPS audit).
 *
 * Discovery found `GET /exports/:orgScope/:filename`'s middleware chain
 * did `req.query.orgId = req.params.orgScope` to feed attachOrg the org
 * named in the URL — but on this project's pinned Express 5.2.1,
 * `req.query` is a getter with no writable backing store, so that
 * assignment is a SILENT NO-OP (reproduced directly against the real
 * installed express package in this repo before writing this fix, not
 * assumed from documentation). attachOrg therefore never saw the intended
 * orgScope and fell through to auto-resolving the CALLER'S OWN primary
 * org instead — and since this route's URL param is named :orgScope (not
 * :orgId), attachOrg's own highest-priority `req.params?.orgId` source
 * could never match it either, for any request to this route. The route's
 * own header comment (lines 10-13) claimed "a check that the caller's own
 * org matches the :orgScope segment" existed — it did not; `_serve()` only
 * special-cased the separate "global" scope, and for the :orgScope branch
 * trusted the raw URL segment directly with no ownership check of any
 * kind.
 *
 * Net effect (real, live, reproduced in this test — not hypothetical):
 * any authenticated member of Org A could fetch Org B's exported files
 * (GDPR exports, founder reports, blueprint exports, API docs exports —
 * per exportFileService.cjs's own persist() doc comment) via
 * GET /exports/<org-B-id>/<filename>, since requireOrgMember was checking
 * membership in Org A (the wrongly-resolved org), not Org B (the
 * requested one).
 *
 * Fixed the exact way this codebase's own workforce.js already proved
 * correct for the identical Express 5 pattern: req.headers is a plain
 * mutable object in both Express 4 and 5, so `req.headers["x-org-id"] =
 * req.params.orgScope` works where the req.query assignment silently
 * failed. A second, independent defense-in-depth check
 * (`req.org.id !== req.params.orgScope`) was also added so a future
 * change to attachOrg's own precedence order cannot silently reopen this
 * exact gap.
 *
 * This test spins up a REAL in-process Express server (the actual
 * exportFiles router, real attachOrg/requireOrgMember middleware, real
 * organizationService.cjs orgs, real JWTs) and reproduces the exact
 * cross-tenant attempt end-to-end — no mocking of the authorization logic
 * itself. Real org records and a real export file are created for this
 * test and cleaned up afterward.
 *
 * Usage: node tests/security/161-export-files-cross-tenant-idor.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-exportfiles-idor-secret";

const express = require("express");
const fs = require("fs");
const path = require("path");
const { signJWT, COOKIE_NAME } = require("../../backend/middleware/authMiddleware.js");
const orgService = require("../../backend/services/organizationService.cjs");
const exportFileService = require("../../backend/services/exportFileService.cjs");
const exportFilesRouter = require("../../backend/routes/exportFiles.js");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  const suffix = Date.now();
  const acctA = `test-idor-a-${suffix}`;
  const acctB = `test-idor-b-${suffix}`;

  // Real orgs, via the real service (persisted to the real org data file,
  // cleaned up in `finally` below).
  const orgA = orgService.createOrg({ name: `IDOR Test Org A ${suffix}` }, acctA);
  const orgB = orgService.createOrg({ name: `IDOR Test Org B ${suffix}` }, acctB);

  const cookieFor = (acct) => {
    const jwt = signJWT({ sub: acct, role: "member", exp: Math.floor(Date.now() / 1000) + 3600 });
    return `${COOKIE_NAME}=${jwt}`;
  };
  const cookieA = cookieFor(acctA);
  const cookieB = cookieFor(acctB);

  // A real export file, genuinely belonging to Org B.
  const filename = `idor-test-export-${suffix}.json`;
  const fileBuffer = Buffer.from(JSON.stringify({ secret: "org-B-private-export-data" }));
  await exportFileService.persist(fileBuffer, {
    filename, mimeType: "application/json", orgId: orgB.id, accountId: acctB, capability: "test_export",
  });

  const app = express();
  app.use(express.json());
  app.use(exportFilesRouter);
  const server = app.listen(0);
  await new Promise(r => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function req(path_, cookie) {
    const r = await fetch(`${base}${path_}`, { headers: cookie ? { Cookie: cookie } : {} });
    let body = null;
    try { body = await r.json(); } catch { /* binary file response, not JSON */ }
    return { status: r.status, body };
  }

  try {
    section("A member of Org A cannot fetch Org B's export by naming Org B's id in the URL");
    {
      const r = await req(`/exports/${orgB.id}/${filename}`, cookieA);
      // With the fix, attachOrg now correctly resolves req.org to Org B
      // (the URL's orgScope), so requireOrgMember correctly rejects Org A's
      // member as "not a member of this organization" (403) before the
      // route handler's own defense-in-depth check ever runs — an even
      // earlier, stronger rejection than the 404 this test originally
      // expected. Either a 403 (membership gate) or 404 (defense-in-depth
      // org-mismatch check) is an acceptable, correct outcome; only 200
      // (the file being served) is the failure this test guards against.
      assert(r.status === 403 || r.status === 404, "GET /exports/<org-B-id>/<filename> as an Org A member is rejected (403/404), never the file", `got ${r.status}: ${JSON.stringify(r.body)}`);
    }

    section("The real owner (a member of Org B) CAN fetch Org B's own export");
    {
      const r = await fetch(`${base}/exports/${orgB.id}/${filename}`, { headers: { Cookie: cookieB } });
      assert(r.status === 200, "GET /exports/<org-B-id>/<filename> as an Org B member returns 200", `got ${r.status}`);
      const body = await r.text();
      assert(body.includes("org-B-private-export-data"), "the real file content is returned to its real owner");
    }

    section("An org member with NO relationship to org B (not even org A) also cannot fetch it");
    {
      const acctC = `test-idor-c-${suffix}`;
      const cookieC = cookieFor(acctC); // never added to any org
      const r = await req(`/exports/${orgB.id}/${filename}`, cookieC);
      assert(r.status === 403 || r.status === 404, "a caller with no org membership at all also cannot fetch org B's export", `got ${r.status}`);
    }

    section("No authentication at all is rejected");
    {
      const r = await req(`/exports/${orgB.id}/${filename}`, null);
      assert(r.status === 401 || r.status === 403, "an unauthenticated request is rejected, not served the file", `got ${r.status}`);
    }

    section("Source-shape — req.query.orgId assignment is gone; req.headers[\"x-org-id\"] is used instead");
    {
      const src = fs.readFileSync(require.resolve("../../backend/routes/exportFiles.js"), "utf8");
      // The old bug is referenced in this fix's own explanatory comment
      // (inside backticks, as historical context) — check only for a LIVE
      // assignment statement (unquoted, not inside a `...` code-span), not
      // the comment prose describing what used to be there.
      assert(!/(?<!`)req\.query\.orgId\s*=\s*req\.params\.orgScope(?!`)/.test(src),
        "the old, silently-no-op req.query.orgId assignment is gone (not counting the fix's own explanatory comment)");
      assert(/req\.headers\["x-org-id"\]\s*=\s*req\.params\.orgScope/.test(src),
        "req.headers[\"x-org-id\"] is set instead, matching workforce.js's own proven fix for this exact Express 5 pattern");
      assert(/req\.org\.id !== req\.params\.orgScope/.test(src),
        "a defense-in-depth check confirms the resolved org actually matches the requested orgScope");
    }

    section("Regression — the account-personal \"global\" export scope is unaffected by this fix");
    {
      const creativeAssetLibrary = require("../../backend/services/creativeAssetLibrary.cjs");
      const globalFilename = `idor-global-test-${suffix}.json`;
      await exportFileService.persist(Buffer.from(JSON.stringify({ ok: true })), {
        filename: globalFilename, mimeType: "application/json", orgId: null, accountId: acctA, capability: "test_export",
      });
      const rOwner = await fetch(`${base}/exports/global/${globalFilename}`, { headers: { Cookie: cookieA } });
      assert(rOwner.status === 200, "the real owner can still fetch their own global (account-personal) export", `got ${rOwner.status}`);
      const rOther = await req(`/exports/global/${globalFilename}`, cookieB);
      assert(rOther.status === 404, "a different account cannot fetch another account's global export", `got ${rOther.status}`);

      const globalPath = path.join(exportFileService.EXPORT_ROOT, "global", globalFilename);
      fs.rmSync(globalPath, { force: true });
    }
  } finally {
    server.close();
    // Clean up the real test export file and org records this test created.
    const exportPath = path.join(exportFileService.EXPORT_ROOT, exportFileService.resolveLocal ? orgB.id : orgB.id, filename);
    try { fs.rmSync(path.join(exportFileService.EXPORT_ROOT, orgB.id), { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
    try {
      const orgStore = JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/organizations.json"), "utf8"));
      orgStore.orgs = (orgStore.orgs || []).filter(o => o.id !== orgA.id && o.id !== orgB.id);
      fs.writeFileSync(path.join(__dirname, "../../data/organizations.json"), JSON.stringify(orgStore, null, 2));
    } catch { /* best-effort cleanup — data/organizations.json path may differ, non-fatal */ }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
