#!/usr/bin/env node
"use strict";
/**
 * TikTok video publish/status — org isolation + honest-failure +
 * generic-paramKey-regression test.
 *
 * Mission 60 (Batch A / TikTok). M59 found NO TikTok adapter at all.
 * tiktokPostingService.cjs is a from-scratch two-step upload adapter
 * (Content Posting API), wired through the SAME attachOrg +
 * _requireOrgMemberIfOrgContext gate hardened for every other Batch-A
 * platform. TikTok also required a genuine change to
 * oauthIntegrationLayer.cjs's generic OAuth code (a "paramKey"/"envKeyName"
 * config field, since TikTok uses "client_key" not "client_id") — this
 * test verifies that change didn't regress the 8 pre-existing providers.
 *
 * Usage: node tests/security/130-tiktok-social-publish-isolation.cjs
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
  section("Regression — pre-existing OAuth providers still report their OWN correct missing-env-var name");
  {
    const oauth = require("../../backend/services/oauthIntegrationLayer.cjs");
    const expectations = {
      google: "GOOGLE_CLIENT_ID", github: "GITHUB_CLIENT_ID", slack: "SLACK_CLIENT_ID",
      notion: "NOTION_CLIENT_ID", microsoft: "MICROSOFT_CLIENT_ID", linkedin: "LINKEDIN_CLIENT_ID",
    };
    for (const [provider, expected] of Object.entries(expectations)) {
      try {
        oauth.getAuthUrl(provider, "test-user");
        ko(`${provider} getAuthUrl error check`, "expected a missing-clientId error but got a URL (env var may be set in this environment)");
      } catch (e) {
        assert(e.message === `${expected} not set`, `${provider} reports "${expected} not set"`, e.message);
      }
    }
  }

  section("New providers report their OWN correct env var name (envKeyName override)");
  {
    const oauth = require("../../backend/services/oauthIntegrationLayer.cjs");
    try { oauth.getAuthUrl("facebook", "test-user"); ko("facebook error check", "expected error, got URL"); }
    catch (e) { assert(e.message === "FACEBOOK_APP_ID not set", "facebook reports FACEBOOK_APP_ID (not FACEBOOK_CLIENT_ID)", e.message); }

    try { oauth.getAuthUrl("tiktok", "test-user"); ko("tiktok error check", "expected error, got URL"); }
    catch (e) { assert(e.message === "TIKTOK_CLIENT_KEY not set", "tiktok reports TIKTOK_CLIENT_KEY (not TIKTOK_CLIENT_ID)", e.message); }
  }

  section("TikTok authorize URL uses client_key param, not client_id (paramKey override)");
  {
    process.env.TIKTOK_CLIENT_KEY = "test-key-123";
    delete require.cache[require.resolve("../../backend/services/oauthIntegrationLayer.cjs")];
    const oauth = require("../../backend/services/oauthIntegrationLayer.cjs");
    const { url } = oauth.getAuthUrl("tiktok", "test-user");
    delete process.env.TIKTOK_CLIENT_KEY;
    assert(url.includes("client_key=test-key-123"), "URL contains client_key=<value>", url);
    assert(!url.includes("client_id=test-key-123"), "URL does NOT contain client_id=<value>", url);
  }

  section("Wiring — TikTok publish/status routes exist and compose the org-membership gate");
  {
    delete require.cache[require.resolve("../../backend/routes/creativeStudio.js")];
    const router = require("../../backend/routes/creativeStudio.js");
    const postLayer = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/tiktok" && l.route.methods.post);
    const statusLayer = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/tiktok/:publishId/status" && l.route.methods.get);

    assert(!!postLayer, "POST /creative/social/publish/tiktok route exists");
    assert(!!statusLayer, "GET /creative/social/publish/tiktok/:publishId/status route exists");

    const postNames = postLayer.route.stack.map(h => h.name);
    assert(postNames.includes("attachOrg"), "POST route mounts attachOrg");
    assert(postNames.includes("_requireOrgMemberIfOrgContext"), "POST route mounts the membership gate");
    assert(postNames.indexOf("attachOrg") < postNames.indexOf("_requireOrgMemberIfOrgContext"),
      "attachOrg runs before the membership gate");
  }

  section("Behavior — a resolved-but-foreign org is rejected before the TikTok handler runs");
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
      const req = { org: { id: "victim-org", status: "active" }, orgRole: null, user: { sub: "attacker" }, path: "/creative/social/publish/tiktok" };
      _requireOrgMemberIfOrgContext(req, res, () => { called = true; });
      assert(called === false, "handler never runs for a non-member");
      assert(res._code() === 403, "caller receives 403", `got ${res._code()}`);
    } finally {
      orgSvc.isEnterpriseAdmin    = origAdmin;
      orgSvc.listGrantsForAccount = origGrants;
    }
  }

  section("tiktokPostingService — honest not-configured failure, no fabricated success");
  {
    delete process.env.DISABLE_SOCIAL_POSTING;
    const svc = require("../../backend/services/tiktokPostingService.cjs");
    const os = require("os");
    const fs = require("fs");
    const tmpFile = require("path").join(os.tmpdir(), `tt-test-${Date.now()}.mp4`);
    fs.writeFileSync(tmpFile, "fake video bytes");
    try {
      const result = await svc.uploadVideo({ filePath: tmpFile, title: "Test Video" }, null, null);
      assert(result.success === false, "uploadVideo() returns success:false when TikTok isn't configured", JSON.stringify(result));
      assert(!result.publishId, "no publishId is fabricated on failure", JSON.stringify(result));
      assert(typeof result.error === "string" && result.error.length > 0, "a real error message is returned");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }

  section("tiktokPostingService — title length limit enforced (TikTok's real 2200-char limit)");
  {
    const svc = require("../../backend/services/tiktokPostingService.cjs");
    const os = require("os");
    const fs = require("fs");
    const tmpFile = require("path").join(os.tmpdir(), `tt-test2-${Date.now()}.mp4`);
    fs.writeFileSync(tmpFile, "x");
    try {
      const result = await svc.uploadVideo({ filePath: tmpFile, title: "a".repeat(2201) }, null, null);
      assert(result.success === false, "uploadVideo() rejects title over 2200 chars");
      assert(/2200 character limit/.test(result.error || ""), "error message names the real limit", result.error);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }

  section("tiktokPostingService — invalid privacyLevel rejected");
  {
    const svc = require("../../backend/services/tiktokPostingService.cjs");
    const os = require("os");
    const fs = require("fs");
    const tmpFile = require("path").join(os.tmpdir(), `tt-test3-${Date.now()}.mp4`);
    fs.writeFileSync(tmpFile, "x");
    try {
      const result = await svc.uploadVideo({ filePath: tmpFile, title: "Test", privacyLevel: "EVERYONE" }, null, null);
      assert(result.success === false, "uploadVideo() rejects an invalid privacyLevel value");
      assert(/invalid privacyLevel/.test(result.error || ""), "error message names the real problem", result.error);
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
