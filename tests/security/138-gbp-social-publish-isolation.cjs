#!/usr/bin/env node
"use strict";
/**
 * Google Business Profile post creation — org isolation + honest-failure
 * regression (final of 13 social platforms, Mission 60-C).
 *
 * M59 found NO Google Business Profile adapter of any kind.
 * gbpPostingService.cjs is a from-scratch adapter (real Local Posts API,
 * account/location resolution), wired through the SAME attachOrg +
 * _requireOrgMemberIfOrgContext gate hardened for every other platform
 * across all three batches.
 *
 * Usage: node tests/security/138-gbp-social-publish-isolation.cjs
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
  section("Wiring — GBP accounts/locations/publish routes exist and compose the org-membership gate");
  {
    const router = require("../../backend/routes/creativeStudio.js");
    const accountsLayer = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/gbp/accounts" && l.route.methods.get);
    const locationsLayer = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/gbp/locations" && l.route.methods.get);
    const postLayer = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/gbp" && l.route.methods.post);

    assert(!!accountsLayer, "GET /creative/social/publish/gbp/accounts route exists");
    assert(!!locationsLayer, "GET /creative/social/publish/gbp/locations route exists");
    assert(!!postLayer, "POST /creative/social/publish/gbp route exists");

    const postNames = postLayer.route.stack.map(h => h.name);
    assert(postNames.includes("attachOrg"), "POST route mounts attachOrg");
    assert(postNames.includes("_requireOrgMemberIfOrgContext"), "POST route mounts the membership gate");
    assert(postNames.indexOf("attachOrg") < postNames.indexOf("_requireOrgMemberIfOrgContext"),
      "attachOrg runs before the membership gate");
  }

  section("Behavior — a resolved-but-foreign org is rejected before the GBP handler runs");
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
      const req = { org: { id: "victim-org", status: "active" }, orgRole: null, user: { sub: "attacker" }, path: "/creative/social/publish/gbp" };
      _requireOrgMemberIfOrgContext(req, res, () => { called = true; });
      assert(called === false, "handler never runs for a non-member");
      assert(res._code() === 403, "caller receives 403", `got ${res._code()}`);
    } finally {
      orgSvc.isEnterpriseAdmin    = origAdmin;
      orgSvc.listGrantsForAccount = origGrants;
    }
  }

  section("gbpPostingService — honest not-configured failure, no fabricated success");
  {
    delete process.env.DISABLE_SOCIAL_POSTING;
    const svc = require("../../backend/services/gbpPostingService.cjs");
    const result = await svc.createPost({ locationName: "accounts/1/locations/2", summary: "Test post" }, null, null);
    assert(result.success === false, "createPost() returns success:false when GBP isn't configured", JSON.stringify(result));
    assert(!result.postName, "no postName is fabricated on failure", JSON.stringify(result));
    assert(typeof result.error === "string" && result.error.length > 0, "a real error message is returned");
  }

  section("gbpPostingService — locationName required (no default location concept)");
  {
    const svc = require("../../backend/services/gbpPostingService.cjs");
    const result = await svc.createPost({ summary: "Test" }, null, null);
    assert(result.success === false, "createPost() rejects when locationName is missing");
    assert(/locationName required/.test(result.error || ""), "error explains locationName is required", result.error);
  }

  section("gbpPostingService — listLocations requires accountName (account/location resolution chain)");
  {
    const svc = require("../../backend/services/gbpPostingService.cjs");
    const result = await svc.listLocations(null, null);
    assert(result.success === false, "listLocations() rejects when accountName is missing");
    assert(/accountName required/.test(result.error || ""), "error explains accountName is required", result.error);
  }

  section("gbpPostingService — summary length limit enforced (Google Business Profile's real 1500-char limit)");
  {
    const svc = require("../../backend/services/gbpPostingService.cjs");
    const result = await svc.createPost({ locationName: "accounts/1/locations/2", summary: "a".repeat(1501) }, null, null);
    assert(result.success === false, "createPost() rejects summary over 1500 chars");
    assert(/1500 character limit/.test(result.error || ""), "error message names the real limit", result.error);
  }

  section("gbpPostingService — empty summary rejected");
  {
    const svc = require("../../backend/services/gbpPostingService.cjs");
    const result = await svc.createPost({ locationName: "accounts/1/locations/2", summary: "" }, null, null);
    assert(result.success === false, "createPost() rejects empty summary");
    assert(result.error === "summary required", "error message is exact", result.error);
  }

  section("oauthIntegrationLayer — gbp is a SEPARATE provider entry, not silently riding the shared google/youtube connections");
  {
    const oauth = require("../../backend/services/oauthIntegrationLayer.cjs");
    try { oauth.getAuthUrl("gbp", "u"); } catch (e) {
      assert(e.message === "GBP_CLIENT_ID not set", "gbp reports its own GBP_CLIENT_ID (not GOOGLE_CLIENT_ID or YOUTUBE_CLIENT_ID)", e.message);
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
