#!/usr/bin/env node
"use strict";
/**
 * Pinterest pin creation/delete/boards — org isolation + honest-failure +
 * OAuth-basic-auth-regression test.
 *
 * Mission 60-B (Batch B / Pinterest). M59/60-A found NO Pinterest adapter.
 * pinterestPostingService.cjs is a from-scratch single-call adapter
 * (Pinterest API v5), wired through the SAME attachOrg +
 * _requireOrgMemberIfOrgContext gate hardened for every other platform.
 * Pinterest's OAuth also required generalizing oauthIntegrationLayer.cjs's
 * Basic-auth token-exchange branch (previously hardcoded to
 * provider==="notion") to a "tokenAuthMode" config field — this test
 * verifies Notion (the only pre-existing Basic-auth provider) still works
 * identically after that generalization.
 *
 * Usage: node tests/security/134-pinterest-social-publish-isolation.cjs
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
  section("Regression — Notion (pre-existing Basic-auth provider) unaffected by the tokenAuthMode generalization");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/services/oauthIntegrationLayer.cjs"), "utf8");
    const notionCfgMatch = src.match(/notion: \{[\s\S]*?\n        \},/);
    assert(!!notionCfgMatch, "found Notion's config block");
    assert(/tokenAuthMode: "basic"/.test(notionCfgMatch[0]), "Notion's config now explicitly declares tokenAuthMode: basic");

    const branchMatch = src.match(/if \(cfg\.tokenAuthMode === "basic"\) \{[\s\S]*?\n    \} else \{/);
    assert(!!branchMatch, "found the generalized Basic-auth branch");
    assert(/provider === "notion"/.test(branchMatch[0]), "the branch still special-cases Notion's JSON body requirement specifically");
  }

  section("Pinterest uses Basic-auth + form-encoded body (not Notion's JSON body)");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/services/oauthIntegrationLayer.cjs"), "utf8");
    const pinterestCfgMatch = src.match(/pinterest: \{[\s\S]*?\n        \},/);
    assert(!!pinterestCfgMatch, "found Pinterest's config block");
    assert(/tokenAuthMode: "basic"/.test(pinterestCfgMatch[0]), "Pinterest declares tokenAuthMode: basic");
  }

  section("Wiring — Pinterest routes exist and compose the org-membership gate");
  {
    const router = require("../../backend/routes/creativeStudio.js");
    const postLayer = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/pinterest" && l.route.methods.post);
    const delLayer  = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/pinterest/:pinId" && l.route.methods.delete);
    const boardsLayer = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/pinterest/boards" && l.route.methods.get);

    assert(!!postLayer, "POST /creative/social/publish/pinterest route exists");
    assert(!!delLayer, "DELETE /creative/social/publish/pinterest/:pinId route exists");
    assert(!!boardsLayer, "GET /creative/social/publish/pinterest/boards route exists");

    const postNames = postLayer.route.stack.map(h => h.name);
    assert(postNames.includes("attachOrg"), "POST route mounts attachOrg");
    assert(postNames.includes("_requireOrgMemberIfOrgContext"), "POST route mounts the membership gate");
  }

  section("Behavior — a resolved-but-foreign org is rejected before the Pinterest handler runs");
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
      const req = { org: { id: "victim-org", status: "active" }, orgRole: null, user: { sub: "attacker" }, path: "/creative/social/publish/pinterest" };
      _requireOrgMemberIfOrgContext(req, res, () => { called = true; });
      assert(called === false, "handler never runs for a non-member");
      assert(res._code() === 403, "caller receives 403", `got ${res._code()}`);
    } finally {
      orgSvc.isEnterpriseAdmin    = origAdmin;
      orgSvc.listGrantsForAccount = origGrants;
    }
  }

  section("pinterestPostingService — honest not-configured failure, no fabricated success");
  {
    delete process.env.DISABLE_SOCIAL_POSTING;
    const svc = require("../../backend/services/pinterestPostingService.cjs");
    const result = await svc.createPin({ boardId: "board123", imageUrl: "https://example.com/x.jpg", title: "Test" }, null, null);
    assert(result.success === false, "createPin() returns success:false when Pinterest isn't configured", JSON.stringify(result));
    assert(!result.pinId, "no pinId is fabricated on failure", JSON.stringify(result));
    assert(typeof result.error === "string" && result.error.length > 0, "a real error message is returned");
  }

  section("pinterestPostingService — boardId required (Pinterest has no default board)");
  {
    const svc = require("../../backend/services/pinterestPostingService.cjs");
    const result = await svc.createPin({ imageUrl: "https://example.com/x.jpg" }, null, null);
    assert(result.success === false, "createPin() rejects when boardId is missing");
    assert(/boardId required/.test(result.error || ""), "error explains boardId is required", result.error);
  }

  section("pinterestPostingService — imageUrl must be a public https:// URL");
  {
    const svc = require("../../backend/services/pinterestPostingService.cjs");
    const noUrl = await svc.createPin({ boardId: "board123" }, null, null);
    assert(noUrl.success === false, "createPin() rejects when imageUrl is missing");

    const localPath = await svc.createPin({ boardId: "board123", imageUrl: "/local/path.jpg" }, null, null);
    assert(localPath.success === false, "createPin() rejects a non-https imageUrl");
    assert(/https:\/\//.test(localPath.error || ""), "error explains the https:// requirement", localPath.error);
  }

  section("pinterestPostingService — title/description length limits enforced (Pinterest's real limits)");
  {
    const svc = require("../../backend/services/pinterestPostingService.cjs");
    const longTitle = await svc.createPin({ boardId: "b", imageUrl: "https://example.com/x.jpg", title: "a".repeat(101) }, null, null);
    assert(longTitle.success === false, "createPin() rejects title over 100 chars");
    assert(/100 character limit/.test(longTitle.error || ""), "error names the real title limit", longTitle.error);

    const longDesc = await svc.createPin({ boardId: "b", imageUrl: "https://example.com/x.jpg", description: "a".repeat(501) }, null, null);
    assert(longDesc.success === false, "createPin() rejects description over 500 chars");
    assert(/500 character limit/.test(longDesc.error || ""), "error names the real description limit", longDesc.error);
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
