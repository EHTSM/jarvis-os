#!/usr/bin/env node
"use strict";
/**
 * Reddit submit — org isolation + honest-failure + read-only-agent-
 * untouched regression.
 *
 * Mission 60-B (Batch B / Reddit, final Batch B platform). The existing
 * agents/internet/socialMediaAgent.cjs is explicitly documented as
 * read-only (public endpoints only, no submit/comment capability by
 * design). redditPostingService.cjs is a from-scratch submit adapter,
 * wired through the SAME attachOrg + _requireOrgMemberIfOrgContext gate
 * hardened for every other Batch A/B platform. This test also verifies
 * the read-only agent was not modified or duplicated by this addition.
 *
 * Usage: node tests/security/135-reddit-social-publish-isolation.cjs
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
  section("The existing read-only Reddit agent is unchanged and still read-only");
  {
    const agentSrc = require("fs").readFileSync(require.resolve("../../agents/internet/socialMediaAgent.cjs"), "utf8");
    assert(/Only accesses public, unauthenticated endpoints/.test(agentSrc), "socialMediaAgent.cjs's read-only docstring is unchanged");
    assert(!/api\.submit|oauth\.reddit\.com/.test(agentSrc), "socialMediaAgent.cjs still has no submit/OAuth capability — the new adapter is a separate file, not a modification of this one");
  }

  section("Wiring — Reddit submit route exists and composes the org-membership gate");
  {
    const router = require("../../backend/routes/creativeStudio.js");
    const postLayer = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/reddit" && l.route.methods.post);
    assert(!!postLayer, "POST /creative/social/publish/reddit route exists");
    const postNames = postLayer.route.stack.map(h => h.name);
    assert(postNames.includes("attachOrg"), "POST route mounts attachOrg");
    assert(postNames.includes("_requireOrgMemberIfOrgContext"), "POST route mounts the membership gate");
    assert(postNames.indexOf("attachOrg") < postNames.indexOf("_requireOrgMemberIfOrgContext"),
      "attachOrg runs before the membership gate");
  }

  section("Behavior — a resolved-but-foreign org is rejected before the Reddit handler runs");
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
      const req = { org: { id: "victim-org", status: "active" }, orgRole: null, user: { sub: "attacker" }, path: "/creative/social/publish/reddit" };
      _requireOrgMemberIfOrgContext(req, res, () => { called = true; });
      assert(called === false, "handler never runs for a non-member");
      assert(res._code() === 403, "caller receives 403", `got ${res._code()}`);
    } finally {
      orgSvc.isEnterpriseAdmin    = origAdmin;
      orgSvc.listGrantsForAccount = origGrants;
    }
  }

  section("redditPostingService — honest not-configured failure, no fabricated success");
  {
    delete process.env.DISABLE_SOCIAL_POSTING;
    const svc = require("../../backend/services/redditPostingService.cjs");
    const result = await svc.createPost({ subreddit: "test", title: "Test post", text: "body" }, null, null);
    assert(result.success === false, "createPost() returns success:false when Reddit isn't configured", JSON.stringify(result));
    assert(!result.postId, "no postId is fabricated on failure", JSON.stringify(result));
    assert(typeof result.error === "string" && result.error.length > 0, "a real error message is returned");
  }

  section("redditPostingService — subreddit and title required");
  {
    const svc = require("../../backend/services/redditPostingService.cjs");
    const noSub = await svc.createPost({ title: "Test", text: "body" }, null, null);
    assert(noSub.success === false, "createPost() rejects when subreddit is missing");
    assert(/subreddit required/.test(noSub.error || ""), "error explains subreddit is required", noSub.error);

    const noTitle = await svc.createPost({ subreddit: "test", text: "body" }, null, null);
    assert(noTitle.success === false, "createPost() rejects when title is missing");
    assert(/title required/.test(noTitle.error || ""), "error explains title is required", noTitle.error);
  }

  section("redditPostingService — text and url are mutually exclusive, one is required");
  {
    const svc = require("../../backend/services/redditPostingService.cjs");
    const neither = await svc.createPost({ subreddit: "test", title: "Test" }, null, null);
    assert(neither.success === false, "createPost() rejects when neither text nor url is given");
    assert(/either text.*or url.*required/.test(neither.error || ""), "error explains one of text/url is required", neither.error);

    const both = await svc.createPost({ subreddit: "test", title: "Test", text: "body", url: "https://example.com" }, null, null);
    assert(both.success === false, "createPost() rejects when both text and url are given");
    assert(/not both/.test(both.error || ""), "error explains they're mutually exclusive", both.error);
  }

  section("redditPostingService — 300-char title limit enforced (Reddit's real limit)");
  {
    const svc = require("../../backend/services/redditPostingService.cjs");
    const result = await svc.createPost({ subreddit: "test", title: "a".repeat(301), text: "body" }, null, null);
    assert(result.success === false, "createPost() rejects title over 300 chars");
    assert(/300 character limit/.test(result.error || ""), "error message names the real limit", result.error);
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
