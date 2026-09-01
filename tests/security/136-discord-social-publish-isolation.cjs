#!/usr/bin/env node
"use strict";
/**
 * Discord message post — org isolation + honest-failure + dual-path
 * (webhook vs bot) regression.
 *
 * Mission 60-C (Batch C / Discord). M59 found only OAuth-identity/
 * reachability probes (integrationConnectors.cjs's connectDiscord/
 * connectDiscordAuth) — no message-send path. discordPostingService.cjs
 * is a from-scratch adapter, wired through the SAME attachOrg +
 * _requireOrgMemberIfOrgContext gate hardened for every other platform.
 *
 * Usage: node tests/security/136-discord-social-publish-isolation.cjs
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
  section("Wiring — Discord publish route exists and composes the org-membership gate");
  {
    const router = require("../../backend/routes/creativeStudio.js");
    const postLayer = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/discord" && l.route.methods.post);
    assert(!!postLayer, "POST /creative/social/publish/discord route exists");
    const postNames = postLayer.route.stack.map(h => h.name);
    assert(postNames.includes("attachOrg"), "POST route mounts attachOrg");
    assert(postNames.includes("_requireOrgMemberIfOrgContext"), "POST route mounts the membership gate");
    assert(postNames.indexOf("attachOrg") < postNames.indexOf("_requireOrgMemberIfOrgContext"),
      "attachOrg runs before the membership gate");
  }

  section("Behavior — a resolved-but-foreign org is rejected before the Discord handler runs");
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
      const req = { org: { id: "victim-org", status: "active" }, orgRole: null, user: { sub: "attacker" }, path: "/creative/social/publish/discord" };
      _requireOrgMemberIfOrgContext(req, res, () => { called = true; });
      assert(called === false, "handler never runs for a non-member");
      assert(res._code() === 403, "caller receives 403", `got ${res._code()}`);
    } finally {
      orgSvc.isEnterpriseAdmin    = origAdmin;
      orgSvc.listGrantsForAccount = origGrants;
    }
  }

  section("discordPostingService — honest not-configured failure, no fabricated success");
  {
    delete process.env.DISABLE_SOCIAL_POSTING;
    delete process.env.DISCORD_WEBHOOK_URL;
    delete process.env.DISCORD_BOT_TOKEN;
    const svc = require("../../backend/services/discordPostingService.cjs");
    const result = await svc.post({ content: "Test message from CI" }, null, null);
    assert(result.success === false, "post() returns success:false when Discord isn't configured", JSON.stringify(result));
    assert(!result.messageId, "no messageId is fabricated on failure", JSON.stringify(result));
    assert(typeof result.error === "string" && result.error.length > 0, "a real error message is returned");
  }

  section("discordPostingService — channelId required for bot-token path when no webhook is set");
  {
    process.env.DISCORD_BOT_TOKEN = "fake-token-for-validation-test";
    delete require.cache[require.resolve("../../backend/services/discordPostingService.cjs")];
    const svc = require("../../backend/services/discordPostingService.cjs");
    const result = await svc.post({ content: "Test" }, null, null); // no channelId
    delete process.env.DISCORD_BOT_TOKEN;
    assert(result.success === false, "post() rejects bot-token path without a channelId");
    assert(/channelId required/.test(result.error || ""), "error explains channelId is required", result.error);
  }

  section("discordPostingService — empty content rejected");
  {
    const svc = require("../../backend/services/discordPostingService.cjs");
    const result = await svc.post({ content: "" }, null, null);
    assert(result.success === false, "post() rejects empty content");
    assert(result.error === "content required", "error message is exact", result.error);
  }

  section("discordPostingService — 2000-char limit enforced (Discord's real message limit)");
  {
    const svc = require("../../backend/services/discordPostingService.cjs");
    const result = await svc.post({ content: "a".repeat(2001) }, null, null);
    assert(result.success === false, "post() rejects content over 2000 chars");
    assert(/2000 character limit/.test(result.error || ""), "error message names the real limit", result.error);
  }

  section("discordPostingService — DISABLE_SOCIAL_POSTING kill-switch honored");
  {
    process.env.DISABLE_SOCIAL_POSTING = "true";
    const svc = require("../../backend/services/discordPostingService.cjs");
    const result = await svc.post({ content: "Test" }, null, null);
    delete process.env.DISABLE_SOCIAL_POSTING;
    assert(result.success === false, "post() refuses when DISABLE_SOCIAL_POSTING=true");
    assert(/disabled/i.test(result.error || ""), "error message explains the kill-switch", result.error);
  }

  section("myConnectors — Discord entry reuses the existing msg:discord connectorId (not a new one)");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/routes/myConnectors.js"), "utf8");
    const discordEntryMatch = src.match(/discord: \{[\s\S]*?\n  \},/);
    assert(!!discordEntryMatch, "found the myConnectors.js discord entry");
    assert(/connectorId: "msg:discord"/.test(discordEntryMatch[0]), "reuses msg:discord, the same connectorId integrationConnectors.cjs's connectDiscord() already probes");
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
