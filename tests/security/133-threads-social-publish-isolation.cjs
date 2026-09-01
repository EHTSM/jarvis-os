#!/usr/bin/env node
"use strict";
/**
 * Threads publish — org isolation + honest-failure + real-API-contract
 * regression.
 *
 * Mission 60-B (Batch B / Threads). M59/60-A found NO Threads adapter.
 * threadsPostingService.cjs is a from-scratch adapter (own Meta OAuth app,
 * distinct from Instagram/Facebook), wired through the SAME attachOrg +
 * _requireOrgMemberIfOrgContext gate hardened for every other platform.
 *
 * Usage: node tests/security/133-threads-social-publish-isolation.cjs
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
  section("Wiring — Threads publish route exists and composes the org-membership gate");
  {
    const router = require("../../backend/routes/creativeStudio.js");
    const postLayer = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/threads" && l.route.methods.post);
    assert(!!postLayer, "POST /creative/social/publish/threads route exists");
    const postNames = postLayer.route.stack.map(h => h.name);
    assert(postNames.includes("attachOrg"), "POST route mounts attachOrg");
    assert(postNames.includes("_requireOrgMemberIfOrgContext"), "POST route mounts the membership gate");
    assert(postNames.indexOf("attachOrg") < postNames.indexOf("_requireOrgMemberIfOrgContext"),
      "attachOrg runs before the membership gate");
  }

  section("Behavior — a resolved-but-foreign org is rejected before the Threads handler runs");
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
      const req = { org: { id: "victim-org", status: "active" }, orgRole: null, user: { sub: "attacker" }, path: "/creative/social/publish/threads" };
      _requireOrgMemberIfOrgContext(req, res, () => { called = true; });
      assert(called === false, "handler never runs for a non-member");
      assert(res._code() === 403, "caller receives 403", `got ${res._code()}`);
    } finally {
      orgSvc.isEnterpriseAdmin    = origAdmin;
      orgSvc.listGrantsForAccount = origGrants;
    }
  }

  section("threadsPostingService — honest not-configured failure, no fabricated success");
  {
    delete process.env.DISABLE_SOCIAL_POSTING;
    const svc = require("../../backend/services/threadsPostingService.cjs");
    const result = await svc.post({ text: "Test post from CI" }, null, null);
    assert(result.success === false, "post() returns success:false when Threads isn't configured", JSON.stringify(result));
    assert(!result.postId, "no postId is fabricated on failure", JSON.stringify(result));
    assert(typeof result.error === "string" && result.error.length > 0, "a real error message is returned");
  }

  section("threadsPostingService — text-only posts are genuinely supported (no mediaUrl required)");
  {
    const svc = require("../../backend/services/threadsPostingService.cjs");
    // Not configured, so this fails at the account-resolution step — but
    // it must NOT fail at the earlier validation step for lacking media,
    // proving text-only really is a legitimate path through validation.
    const result = await svc.post({ text: "Just text, no media" }, null, null);
    assert(result.success === false, "post() fails (unconfigured) not due to missing media");
    assert(!/mediaUrl required/.test(result.error || ""), "error is NOT a media-required validation error", result.error);
    assert(/not configured/.test(result.error || ""), "error is the honest not-configured message", result.error);
  }

  section("threadsPostingService — mediaType required when mediaUrl is supplied");
  {
    const svc = require("../../backend/services/threadsPostingService.cjs");
    const result = await svc.post({ text: "Test", mediaUrl: "https://example.com/x.jpg" }, null, null);
    assert(result.success === false, "post() rejects mediaUrl without an explicit mediaType");
    assert(/mediaType required/.test(result.error || ""), "error explains mediaType is required", result.error);
  }

  section("threadsPostingService — mediaUrl required for IMAGE/VIDEO mediaType");
  {
    const svc = require("../../backend/services/threadsPostingService.cjs");
    const result = await svc.post({ text: "Test", mediaType: "IMAGE" }, null, null);
    assert(result.success === false, "post() rejects mediaType IMAGE without a mediaUrl");
    assert(/mediaUrl required for mediaType/.test(result.error || ""), "error explains mediaUrl is required for this type", result.error);
  }

  section("threadsPostingService — non-https mediaUrl rejected");
  {
    const svc = require("../../backend/services/threadsPostingService.cjs");
    const result = await svc.post({ text: "Test", mediaUrl: "/local/path.jpg", mediaType: "IMAGE" }, null, null);
    assert(result.success === false, "post() rejects a non-https mediaUrl");
    assert(/https:\/\//.test(result.error || ""), "error explains the https:// requirement", result.error);
  }

  section("threadsPostingService — 500-char limit enforced (Threads' real limit)");
  {
    const svc = require("../../backend/services/threadsPostingService.cjs");
    const result = await svc.post({ text: "a".repeat(501) }, null, null);
    assert(result.success === false, "post() rejects text over 500 chars");
    assert(/500 character limit/.test(result.error || ""), "error message names the real limit", result.error);
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
