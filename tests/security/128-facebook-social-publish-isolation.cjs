#!/usr/bin/env node
"use strict";
/**
 * Facebook Page publish/delete — org isolation + honest-failure regression.
 *
 * Mission 60 (Batch A / Facebook). M59 found NO Facebook adapter at all.
 * facebookPostingService.cjs is a from-scratch Page-publish adapter, wired
 * through the SAME attachOrg + _requireOrgMemberIfOrgContext gate already
 * hardened for X (test 114) / LinkedIn (test 127).
 *
 * Usage: node tests/security/128-facebook-social-publish-isolation.cjs
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
  section("Wiring — Facebook publish/delete routes exist and compose the org-membership gate");
  {
    const router = require("../../backend/routes/creativeStudio.js");
    const postLayer = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/facebook" && l.route.methods.post);
    const delLayer  = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/facebook/:postId" && l.route.methods.delete);

    assert(!!postLayer, "POST /creative/social/publish/facebook route exists");
    assert(!!delLayer, "DELETE /creative/social/publish/facebook/:postId route exists");

    const postNames = postLayer.route.stack.map(h => h.name);
    assert(postNames.includes("attachOrg"), "POST route mounts attachOrg");
    assert(postNames.includes("_requireOrgMemberIfOrgContext"), "POST route mounts the membership gate");
    assert(postNames.indexOf("attachOrg") < postNames.indexOf("_requireOrgMemberIfOrgContext"),
      "attachOrg runs before the membership gate");
  }

  section("Behavior — a resolved-but-foreign org is rejected before the Facebook handler runs");
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
      const req = { org: { id: "victim-org", status: "active" }, orgRole: null, user: { sub: "attacker" }, path: "/creative/social/publish/facebook" };
      _requireOrgMemberIfOrgContext(req, res, () => { called = true; });
      assert(called === false, "handler never runs for a non-member");
      assert(res._code() === 403, "caller receives 403", `got ${res._code()}`);
    } finally {
      orgSvc.isEnterpriseAdmin    = origAdmin;
      orgSvc.listGrantsForAccount = origGrants;
    }
  }

  section("facebookPostingService — honest not-configured failure, no fabricated success");
  {
    delete process.env.DISABLE_SOCIAL_POSTING;
    const svc = require("../../backend/services/facebookPostingService.cjs");
    const result = await svc.post("Test post from CI", null, null);
    assert(result.success === false, "post() returns success:false when Facebook isn't configured", JSON.stringify(result));
    assert(!result.postId, "no postId is fabricated on failure", JSON.stringify(result));
    assert(typeof result.error === "string" && result.error.length > 0, "a real error message is returned");
  }

  section("facebookPostingService — 63206-char limit enforced client-side (Facebook's real limit)");
  {
    const svc = require("../../backend/services/facebookPostingService.cjs");
    const tooLong = "a".repeat(63207);
    const result = await svc.post(tooLong, null, null);
    assert(result.success === false, "post() rejects text over 63206 chars");
    assert(/63206 character limit/.test(result.error || ""), "error message names the real limit", result.error);
  }

  section("facebookPostingService — empty text rejected");
  {
    const svc = require("../../backend/services/facebookPostingService.cjs");
    const result = await svc.post("", null, null);
    assert(result.success === false, "post() rejects empty text");
    assert(result.error === "text required", "error message is exact", result.error);
  }

  section("facebookPostingService — DISABLE_SOCIAL_POSTING kill-switch honored");
  {
    process.env.DISABLE_SOCIAL_POSTING = "true";
    const svc = require("../../backend/services/facebookPostingService.cjs");
    const result = await svc.post("Test", null, null);
    delete process.env.DISABLE_SOCIAL_POSTING;
    assert(result.success === false, "post() refuses when DISABLE_SOCIAL_POSTING=true");
    assert(/disabled/i.test(result.error || ""), "error message explains the kill-switch", result.error);
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
