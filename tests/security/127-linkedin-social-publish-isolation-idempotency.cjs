#!/usr/bin/env node
"use strict";
/**
 * LinkedIn social publish/delete — org isolation + idempotency regression.
 *
 * Mission 60 (Batch A / LinkedIn). M59 found LinkedIn had only an
 * OAuth-discovery reachability probe, no publish adapter. This mission
 * added linkedinPostingService.cjs (real UGC Posts API v2 adapter) and
 * wired POST/DELETE /creative/social/publish/linkedin[/:postId] through
 * the SAME attachOrg + _requireOrgMemberIfOrgContext gate already
 * hardened for X (test 114) — this test verifies that gate applies
 * identically to the new LinkedIn routes, plus the new shared
 * retry/idempotency helper (socialPublishSupport.cjs) behaves correctly.
 *
 * Usage: node tests/security/127-linkedin-social-publish-isolation-idempotency.cjs
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
  return {
    status(c) { code = c; return this; },
    json(b)   { body = b; return this; },
    _code: () => code,
    _body: () => body,
  };
}

async function main() {
  section("Wiring — LinkedIn publish/delete routes exist and compose the same org-membership gate as X");
  {
    const router = require("../../backend/routes/creativeStudio.js");
    const postLayer = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/linkedin" && l.route.methods.post);
    const delLayer  = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/linkedin/:postId" && l.route.methods.delete);

    assert(!!postLayer, "POST /creative/social/publish/linkedin route exists");
    assert(!!delLayer, "DELETE /creative/social/publish/linkedin/:postId route exists");

    const postNames = postLayer.route.stack.map(h => h.name);
    const delNames  = delLayer.route.stack.map(h => h.name);

    assert(postNames.includes("attachOrg"), "POST route mounts attachOrg", postNames.join(","));
    assert(postNames.includes("_requireOrgMemberIfOrgContext"), "POST route mounts the membership gate", postNames.join(","));
    assert(postNames.indexOf("attachOrg") < postNames.indexOf("_requireOrgMemberIfOrgContext"),
      "attachOrg runs before the membership gate on POST", postNames.join(","));

    assert(delNames.includes("attachOrg"), "DELETE route mounts attachOrg", delNames.join(","));
    assert(delNames.includes("_requireOrgMemberIfOrgContext"), "DELETE route mounts the membership gate", delNames.join(","));
  }

  section("Behavior — a resolved-but-foreign org is rejected before the LinkedIn handler runs");
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
      const req = {
        org: { id: "victim-org", status: "active" },
        orgRole: null,
        user: { sub: "attacker-account" },
        path: "/creative/social/publish/linkedin",
      };
      _requireOrgMemberIfOrgContext(req, res, () => { called = true; });
      assert(called === false, "handler (and linkedinPostingService's credential lookup) never runs for a non-member");
      assert(res._code() === 403, "caller receives 403, not a silent pass-through", `got ${res._code()}`);
    } finally {
      orgSvc.isEnterpriseAdmin    = origAdmin;
      orgSvc.listGrantsForAccount = origGrants;
    }
  }

  section("linkedinPostingService — honest not-configured failure, no fabricated success");
  {
    delete process.env.DISABLE_SOCIAL_POSTING;
    const svc = require("../../backend/services/linkedinPostingService.cjs");
    // No LinkedIn OAuth connection exists in this test environment (no
    // data/oauth-tokens.json entry for provider=linkedin), and no orgId
    // vault secret — so post() must fail honestly, never fabricate a postId.
    const result = await svc.post("Test post from CI", null, null);
    assert(result.success === false, "post() returns success:false when LinkedIn isn't configured", JSON.stringify(result));
    assert(!result.postId, "no postId is fabricated on failure", JSON.stringify(result));
    assert(typeof result.error === "string" && result.error.length > 0, "a real error message is returned", JSON.stringify(result));
  }

  section("linkedinPostingService — 3000-char limit enforced client-side (LinkedIn's real UGC limit)");
  {
    const svc = require("../../backend/services/linkedinPostingService.cjs");
    const tooLong = "a".repeat(3001);
    const result = await svc.post(tooLong, null, null);
    assert(result.success === false, "post() rejects text over 3000 chars");
    assert(/3000 character limit/.test(result.error || ""), "error message names the real limit", result.error);
  }

  section("linkedinPostingService — empty text rejected");
  {
    const svc = require("../../backend/services/linkedinPostingService.cjs");
    const result = await svc.post("", null, null);
    assert(result.success === false, "post() rejects empty text");
    assert(result.error === "text required", "error message is exact", result.error);
  }

  section("socialPublishSupport — idempotency dedup returns the cached result for a repeated key");
  {
    const { checkIdempotency, recordIdempotency } = require("../../backend/services/socialPublishSupport.cjs");
    const key = `test-idem-${Date.now()}`;
    assert(checkIdempotency(key) === null, "no cached result before first record");
    const fakeResult = { success: true, postId: "urn:li:share:12345" };
    recordIdempotency(key, fakeResult);
    const cached = checkIdempotency(key);
    assert(cached && cached.postId === "urn:li:share:12345", "cached result is returned for the same key", JSON.stringify(cached));
    assert(checkIdempotency(`${key}-different`) === null, "a different key does not collide with the cached one");
  }

  section("socialPublishSupport — withRetry retries only transient errors (429/5xx/network), not permanent ones");
  {
    const { withRetry } = require("../../backend/services/socialPublishSupport.cjs");

    let attempts = 0;
    const permanentResult = await withRetry(async () => {
      attempts++;
      return { success: false, status: 401, error: "bad token" };
    }, 2, 1);
    assert(attempts === 1, "a 401 (permanent) error is not retried", `attempts=${attempts}`);
    assert(permanentResult.status === 401, "the permanent error result is returned unchanged");

    attempts = 0;
    const transientResult = await withRetry(async () => {
      attempts++;
      if (attempts < 2) return { success: false, status: 503, error: "temporarily unavailable" };
      return { success: true, postId: "recovered-after-retry" };
    }, 2, 1);
    assert(attempts === 2, "a 503 (transient) error is retried until success", `attempts=${attempts}`);
    assert(transientResult.success === true, "the retried call eventually succeeds");
  }

  console.log(`\n${"=".repeat(60)}\n  Pass: ${pass}   Fail: ${fail}\n${"=".repeat(60)}`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
