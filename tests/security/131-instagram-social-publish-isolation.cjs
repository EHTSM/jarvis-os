#!/usr/bin/env node
"use strict";
/**
 * Instagram publish — org isolation + honest-failure + real-API-contract
 * validation regression.
 *
 * Mission 60 (Batch A / Instagram, final Batch A platform). M59 found NO
 * Instagram adapter at all. instagramPostingService.cjs is a from-scratch
 * adapter reusing the Facebook OAuth connection (Meta's real account
 * model), wired through the SAME attachOrg + _requireOrgMemberIfOrgContext
 * gate hardened for every other Batch-A platform.
 *
 * Usage: node tests/security/131-instagram-social-publish-isolation.cjs
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
  section("Wiring — Instagram publish route exists and composes the org-membership gate");
  {
    const router = require("../../backend/routes/creativeStudio.js");
    const postLayer = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/instagram" && l.route.methods.post);
    assert(!!postLayer, "POST /creative/social/publish/instagram route exists");
    const postNames = postLayer.route.stack.map(h => h.name);
    assert(postNames.includes("attachOrg"), "POST route mounts attachOrg");
    assert(postNames.includes("_requireOrgMemberIfOrgContext"), "POST route mounts the membership gate");
    assert(postNames.indexOf("attachOrg") < postNames.indexOf("_requireOrgMemberIfOrgContext"),
      "attachOrg runs before the membership gate");
  }

  section("Behavior — a resolved-but-foreign org is rejected before the Instagram handler runs");
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
      const req = { org: { id: "victim-org", status: "active" }, orgRole: null, user: { sub: "attacker" }, path: "/creative/social/publish/instagram" };
      _requireOrgMemberIfOrgContext(req, res, () => { called = true; });
      assert(called === false, "handler never runs for a non-member");
      assert(res._code() === 403, "caller receives 403", `got ${res._code()}`);
    } finally {
      orgSvc.isEnterpriseAdmin    = origAdmin;
      orgSvc.listGrantsForAccount = origGrants;
    }
  }

  section("instagramPostingService — honest not-configured failure, no fabricated success");
  {
    delete process.env.DISABLE_SOCIAL_POSTING;
    const svc = require("../../backend/services/instagramPostingService.cjs");
    const result = await svc.post({ mediaUrl: "https://example.com/real-photo.jpg", mediaType: "image", caption: "Test" }, null, null);
    assert(result.success === false, "post() returns success:false when Instagram isn't configured", JSON.stringify(result));
    assert(!result.mediaId, "no mediaId is fabricated on failure", JSON.stringify(result));
    assert(typeof result.error === "string" && result.error.length > 0, "a real error message is returned");
  }

  section("instagramPostingService — real API contract enforced: mediaUrl must be a public https:// URL");
  {
    const svc = require("../../backend/services/instagramPostingService.cjs");

    const noUrl = await svc.post({ mediaType: "image", caption: "Test" }, null, null);
    assert(noUrl.success === false, "post() rejects when mediaUrl is missing");
    assert(/mediaUrl required/.test(noUrl.error || ""), "error explains mediaUrl is required", noUrl.error);

    const localPath = await svc.post({ mediaUrl: "/local/data/image/foo.jpg", mediaType: "image" }, null, null);
    assert(localPath.success === false, "post() rejects a non-https mediaUrl (e.g. a local path)");
    assert(/https:\/\//.test(localPath.error || ""), "error explains the https:// requirement", localPath.error);
  }

  section("instagramPostingService — invalid mediaType rejected");
  {
    const svc = require("../../backend/services/instagramPostingService.cjs");
    const result = await svc.post({ mediaUrl: "https://example.com/x.jpg", mediaType: "carousel" }, null, null);
    assert(result.success === false, "post() rejects an invalid mediaType");
    assert(/invalid mediaType/.test(result.error || ""), "error message names the real problem", result.error);
  }

  section("instagramPostingService — caption length limit enforced (Instagram's real 2200-char limit)");
  {
    const svc = require("../../backend/services/instagramPostingService.cjs");
    const result = await svc.post({ mediaUrl: "https://example.com/x.jpg", caption: "a".repeat(2201) }, null, null);
    assert(result.success === false, "post() rejects caption over 2200 chars");
    assert(/2200 character limit/.test(result.error || ""), "error message names the real limit", result.error);
  }

  section("No delete route exists — Instagram's Graph API does not support deleting published media");
  {
    const router = require("../../backend/routes/creativeStudio.js");
    const delLayer = router.stack.find(l => l.route && l.route.path && l.route.path.startsWith("/creative/social/publish/instagram") && l.route.methods.delete);
    assert(!delLayer, "no DELETE route was added for Instagram (a real provider constraint, not an omission)");
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
