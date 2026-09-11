#!/usr/bin/env node
"use strict";
/**
 * Creative Studio — cross-account IDOR — regression tests.
 *
 * Creative Studio OS pass (2026-08-15). backend/routes/creativeStudio.js
 * has no organization/workspace scoping model at all (unlike every other
 * OS audited so far) — every route identifies the caller purely by
 * accountId. That would be fine IF every id-addressed record and mutation
 * verified the caller owned the record before acting on it. It didn't:
 * creativeAssetLibrary.cjs's getAsset/toggleFavorite/addTag/moveToFolder/
 * deleteAsset, brandStudio.cjs's getKit/updateKit/deleteKit/attachLogo/
 * addTemplate/updateBrandVoice/buildIdentityBrief, and creativeJobQueue.cjs's
 * getJob all take a bare id with NO accountId parameter and perform no
 * ownership check of their own.
 *
 * Live-reproduced pre-fix with two real registered accounts (A, B):
 *   - B read A's private asset by id                       (200)
 *   - B PERMANENTLY DELETED A's asset                       (200, confirmed
 *     gone from A's own subsequent read — real data loss)
 *   - B read A's brand kit by id                            (200)
 *   - B renamed A's brand kit to "HIJACKED BY B"             (200, persisted,
 *     visible on A's own subsequent read — real cross-account write)
 *   - B read A's job record (prompt content) by id           (200)
 *
 * Fix: creativeStudio.js is the only place with an accountId to check
 * against (the services below it have no owner concept in their API), so a
 * `_ownedOrDenied()` guard was added at every id-addressed route — read,
 * write, and delete — for assets, brand kits, and jobs. An id belonging to
 * another account now responds 404 (matching the response for an id that
 * doesn't exist at all — never discloses existence to a non-owner).
 *
 * Also fixed as part of the same pass: creativeJobQueue.getSummary() and the
 * two GET routes that used it (/creative/workspace, /creative/workspace/queue)
 * were unscoped globals, plus /creative/workspace/queue's running/queued
 * lists — matching the exact class of gap the pre-existing Phase A.11.3 fix
 * already closed for assets.getStats()/getFolders()/getTags() in this same
 * file.
 *
 * A second, related gap: the 3 generated-file serving routes
 * (/creative/image/file/:filename, /creative/video/file/:filename,
 * /creative/audio/:filename) required login but never checked ownership —
 * filenames are only a millisecond timestamp, not cryptographically random,
 * so any authenticated account could fetch another account's generated
 * image/video/audio by guessing/enumerating nearby timestamps. Fixed by
 * adding `url` to the asset index (creativeAssetLibrary.cjs's getAssetByUrl())
 * and gating each route on the matching asset's accountId — but failing OPEN
 * (not denying) when no asset record matches at all, since files generated
 * before this pass's index-schema addition have no record to check against
 * and denying those would break legitimate access to already-generated
 * files. The existence/path-traversal checks that ran before this fix are
 * unchanged and still strict.
 *
 * Usage: node tests/security/100-creative-studio-cross-account-idor.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-creative-idor-secret";

const express = require("express");
const { signJWT, COOKIE_NAME } = require("../../backend/middleware/authMiddleware.js");
const creativeStudioRouter = require("../../backend/routes/creativeStudio.js");
const assetLib = require("../../backend/services/creativeAssetLibrary.cjs");
const brandStudio = require("../../backend/services/brandStudio.cjs");
const jobQueue = require("../../backend/services/creativeJobQueue.cjs");

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
  const cookieFor = (acct) => {
    const jwt = signJWT({ sub: acct, role: "member", exp: Math.floor(Date.now() / 1000) + 3600 });
    return `${COOKIE_NAME}=${jwt}`;
  };
  const cookieA = cookieFor(acctA);
  const cookieB = cookieFor(acctB);

  const app = express();
  app.use(express.json());
  app.use(creativeStudioRouter);
  const server = app.listen(0);
  await new Promise(r => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function req(method, path, cookie, body) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await r.json(); } catch {}
    return { status: r.status, json };
  }

  section("Setup — A creates a real asset, brand kit, and job");
  const assetRes = await req("POST", "/creative/assets", cookieA, { type: "image", prompt: "idor test asset" });
  assert(assetRes.status === 200 && assetRes.json?.asset?.id, "A's asset created");
  const assetId = assetRes.json.asset.id;

  const kitRes = await req("POST", "/creative/brand", cookieA, { name: "IDOR Test Brand" });
  assert(kitRes.status === 200 && kitRes.json?.kit?.id, "A's brand kit created");
  const kitId = kitRes.json.kit.id;

  const job = jobQueue.createJob({ capability: "image_generate", studioType: "image", prompt: "idor test job", accountId: acctA });
  assert(job.accountId === acctA, "A's job created directly via service (avoids a real paid provider call)");

  section("Asset IDOR — B cannot read, favorite, tag, move, or delete A's asset");
  assert((await req("GET", `/creative/assets/${assetId}`, cookieB)).status === 404, "B GET A's asset → 404");
  assert((await req("POST", `/creative/assets/${assetId}/favorite`, cookieB)).status === 404, "B favorite A's asset → 404");
  assert((await req("POST", `/creative/assets/${assetId}/tag`, cookieB, { tag: "hijack" })).status === 404, "B tag A's asset → 404");
  assert((await req("POST", `/creative/assets/${assetId}/move`, cookieB, { folder: "hijack" })).status === 404, "B move A's asset → 404");
  const delRes = await req("DELETE", `/creative/assets/${assetId}`, cookieB);
  assert(delRes.status === 404, "B delete A's asset → 404 (not the pre-fix 200)");
  const stillThere = assetLib.getAsset(assetId);
  assert(!!stillThere, "A's asset genuinely still exists after B's blocked delete attempt (no data loss)");

  section("Asset — A's own access is unaffected by the fix");
  const aOwn = await req("GET", `/creative/assets/${assetId}`, cookieA);
  assert(aOwn.status === 200 && aOwn.json?.asset?.id === assetId, "A can still read own asset");
  const aFav = await req("POST", `/creative/assets/${assetId}/favorite`, cookieA);
  assert(aFav.status === 200 && aFav.json?.asset?.favorite === true, "A can still favorite own asset");

  section("Brand kit IDOR — B cannot read, update, delete, or generate from A's kit");
  assert((await req("GET", `/creative/brand/${kitId}`, cookieB)).status === 404, "B GET A's kit → 404");
  const putRes = await req("PUT", `/creative/brand/${kitId}`, cookieB, { name: "HIJACKED" });
  assert(putRes.status === 404, "B rename A's kit → 404 (not the pre-fix 200 that persisted the rename)");
  assert(brandStudio.getKit(kitId).name === "IDOR Test Brand", "A's kit name genuinely unchanged after B's blocked write");
  assert((await req("DELETE", `/creative/brand/${kitId}`, cookieB)).status === 404, "B delete A's kit → 404");
  assert((await req("GET", `/creative/brand/${kitId}/brief`, cookieB)).status === 404, "B read A's kit brief → 404");
  assert((await req("PUT", `/creative/brand/${kitId}/voice`, cookieB, { tone: "hijacked" })).status === 404, "B update A's kit voice → 404");
  assert((await req("POST", `/creative/brand/${kitId}/template`, cookieB, { name: "x" })).status === 404, "B add template to A's kit → 404");

  section("Brand kit — A's own access is unaffected by the fix");
  const aKit = await req("GET", `/creative/brand/${kitId}`, cookieA);
  assert(aKit.status === 200 && aKit.json?.kit?.name === "IDOR Test Brand", "A can still read own kit");

  section("Job IDOR — B cannot read A's job");
  assert((await req("GET", `/creative/workspace/jobs/${job.id}`, cookieB)).status === 404, "B GET A's job → 404");
  const aJob = await req("GET", `/creative/workspace/jobs/${job.id}`, cookieA);
  assert(aJob.status === 200 && aJob.json?.job?.id === job.id, "A can still read own job");

  section("Generated-file serving IDOR — B cannot fetch A's processed-image file by guessing its timestamp filename");
  {
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "../../data/processed-images");
    fs.mkdirSync(dir, { recursive: true });
    const filename = `upscale_${Date.now()}_idortest.png`;
    // A real (tiny, valid) PNG — a 1x1 transparent pixel — so the route's own
    // fs.existsSync()/sendFile() path is exercised with real bytes, not a stub.
    const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    fs.writeFileSync(path.join(dir, filename), onePixelPng);
    const fileUrl = `/creative/image/file/${filename}`;
    const fileAsset = assetLib.storeAsset({ type: "image", prompt: "idor file test", url: fileUrl, accountId: acctA });
    assert(fileAsset.url === fileUrl, "file-backed asset stored with matching url");

    const bFetch = await req("GET", fileUrl, cookieB);
    assert(bFetch.status === 404, "B fetching A's generated file by filename → 404 (not the pre-fix 200)");

    const r = await fetch(`${base}${fileUrl}`, { headers: { Cookie: cookieA } });
    assert(r.status === 200, "A can still fetch own generated file");

    // A file with no matching asset record (predates this pass's url-index
    // field) must remain servable to any authenticated caller — the fix
    // fails open on "no record found", not closed.
    const legacyFilename = `upscale_${Date.now()}_legacy.png`;
    fs.writeFileSync(path.join(dir, legacyFilename), onePixelPng);
    const legacyFetch = await req("GET", `/creative/image/file/${legacyFilename}`, cookieB);
    assert(legacyFetch.status === 200, "a file with no indexed asset record (pre-fix legacy file) stays servable to any authenticated caller");
    fs.unlinkSync(path.join(dir, filename));
    fs.unlinkSync(path.join(dir, legacyFilename));
  }

  section("Job/asset dashboard aggregates no longer leak cross-account totals");
  const bWorkspace = await req("GET", "/creative/workspace", cookieB);
  assert(bWorkspace.json?.jobs?.total === 0, "B's workspace job summary shows B's own (zero) count, not A's/global total", `got ${bWorkspace.json?.jobs?.total}`);
  const bQueue = await req("GET", "/creative/workspace/queue", cookieB);
  assert(bQueue.json?.summary?.total === 0, "B's workspace/queue summary is scoped to B, not global");
  assert(!(bQueue.json?.running || []).some(j => j.accountId === acctA), "B's running-jobs list contains none of A's jobs");

  server.close();

  console.log(`\n${"=".repeat(60)}\n  Pass: ${pass}   Fail: ${fail}\n${"=".repeat(60)}`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
