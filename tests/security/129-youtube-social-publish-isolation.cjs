#!/usr/bin/env node
"use strict";
/**
 * YouTube video upload/delete — org isolation + honest-failure + path-safety
 * regression.
 *
 * Mission 60 (Batch A / YouTube). M59 found NO YouTube adapter at all.
 * youtubePostingService.cjs is a from-scratch resumable-upload adapter
 * (Data API v3), wired through the SAME attachOrg +
 * _requireOrgMemberIfOrgContext gate hardened for X/LinkedIn/Facebook.
 * Also verifies the filename passed to POST /creative/social/publish/youtube
 * cannot escape data/video/ via path traversal.
 *
 * Usage: node tests/security/129-youtube-social-publish-isolation.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function resStub() {
  let code = null, body = null;
  return { status(c) { code = c; return this; }, json(b) { body = b; return this; }, _code: () => code, _body: () => body };
}

async function main() {
  section("Wiring — YouTube upload/delete routes exist and compose the org-membership gate");
  {
    const router = require("../../backend/routes/creativeStudio.js");
    const postLayer = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/youtube" && l.route.methods.post);
    const delLayer  = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/youtube/:videoId" && l.route.methods.delete);

    assert(!!postLayer, "POST /creative/social/publish/youtube route exists");
    assert(!!delLayer, "DELETE /creative/social/publish/youtube/:videoId route exists");

    const postNames = postLayer.route.stack.map(h => h.name);
    assert(postNames.includes("attachOrg"), "POST route mounts attachOrg");
    assert(postNames.includes("_requireOrgMemberIfOrgContext"), "POST route mounts the membership gate");
    assert(postNames.indexOf("attachOrg") < postNames.indexOf("_requireOrgMemberIfOrgContext"),
      "attachOrg runs before the membership gate");
  }

  section("Behavior — a resolved-but-foreign org is rejected before the YouTube handler runs");
  {
    const { requireOrgMember } = require("../../backend/middleware/orgMiddleware.cjs");
    function _requireOrgMemberIfOrgContext(req, res, next) {
      if (!req.org) return next();
      return requireOrgMember(req, res, next);
    }
    const orgSvc = require("../../backend/services/organizationService.cjs");
    const origAdmin  = orgSvc.isEnterpriseAdmin;
    const origGrants = orgSvc.listGrantsForAccount;
    orgSvc.isEnterpriseAdmin    = () => false;
    orgSvc.listGrantsForAccount = () => [];
    try {
      let called = false;
      const res = resStub();
      const req = { org: { id: "victim-org", status: "active" }, orgRole: null, user: { sub: "attacker" }, path: "/creative/social/publish/youtube" };
      _requireOrgMemberIfOrgContext(req, res, () => { called = true; });
      assert(called === false, "handler never runs for a non-member");
      assert(res._code() === 403, "caller receives 403", `got ${res._code()}`);
    } finally {
      orgSvc.isEnterpriseAdmin    = origAdmin;
      orgSvc.listGrantsForAccount = origGrants;
    }
  }

  section("Path safety — filename cannot escape data/video/ via traversal");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/routes/creativeStudio.js"), "utf8");
    const routeMatch = src.match(/router\.post\("\/creative\/social\/publish\/youtube"[\s\S]*?\n\}\);/);
    assert(!!routeMatch, "found the YouTube publish route handler source", "could not find the route handler");
    assert(/_ytPath\.basename\(String\(filename\)\)/.test(routeMatch[0]), "route resolves filename through path.basename() before use");
    assert(/safeName !== filename/.test(routeMatch[0]), "route rejects a filename that basename() would alter (traversal attempt)");
  }

  section("youtubePostingService — honest not-configured failure, no fabricated success");
  {
    delete process.env.DISABLE_SOCIAL_POSTING;
    const svc = require("../../backend/services/youtubePostingService.cjs");
    const os = require("os");
    const fs = require("fs");
    const tmpFile = require("path").join(os.tmpdir(), `yt-test-${Date.now()}.mp4`);
    fs.writeFileSync(tmpFile, "fake video bytes");
    try {
      const result = await svc.uploadVideo({ filePath: tmpFile, title: "Test Video" }, null, null);
      assert(result.success === false, "uploadVideo() returns success:false when YouTube isn't configured", JSON.stringify(result));
      assert(!result.videoId, "no videoId is fabricated on failure", JSON.stringify(result));
      assert(typeof result.error === "string" && result.error.length > 0, "a real error message is returned");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }

  section("youtubePostingService — missing file rejected honestly");
  {
    const svc = require("../../backend/services/youtubePostingService.cjs");
    const result = await svc.uploadVideo({ filePath: "/tmp/does-not-exist-xyz.mp4", title: "Test" }, null, null);
    assert(result.success === false, "uploadVideo() rejects a nonexistent file");
    assert(/not found/i.test(result.error || ""), "error message names the real problem", result.error);
  }

  section("youtubePostingService — title length limit enforced (YouTube's real 100-char limit)");
  {
    const svc = require("../../backend/services/youtubePostingService.cjs");
    const os = require("os");
    const fs = require("fs");
    const tmpFile = require("path").join(os.tmpdir(), `yt-test2-${Date.now()}.mp4`);
    fs.writeFileSync(tmpFile, "x");
    try {
      const result = await svc.uploadVideo({ filePath: tmpFile, title: "a".repeat(101) }, null, null);
      assert(result.success === false, "uploadVideo() rejects title over 100 chars");
      assert(/100 character limit/.test(result.error || ""), "error message names the real limit", result.error);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }

  section("youtubePostingService — invalid privacyStatus rejected");
  {
    const svc = require("../../backend/services/youtubePostingService.cjs");
    const os = require("os");
    const fs = require("fs");
    const tmpFile = require("path").join(os.tmpdir(), `yt-test3-${Date.now()}.mp4`);
    fs.writeFileSync(tmpFile, "x");
    try {
      const result = await svc.uploadVideo({ filePath: tmpFile, title: "Test", privacyStatus: "everyone-in-the-world" }, null, null);
      assert(result.success === false, "uploadVideo() rejects an invalid privacyStatus value");
      assert(/invalid privacyStatus/.test(result.error || ""), "error message names the real problem", result.error);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }

  console.log(`\n${"=".repeat(60)}\n  Pass: ${pass}   Fail: ${fail}\n${"=".repeat(60)}`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
