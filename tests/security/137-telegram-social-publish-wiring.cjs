#!/usr/bin/env node
"use strict";
/**
 * Telegram social publish wiring — org isolation + call-site-contract
 * regression.
 *
 * Mission 60-C (Batch C / Telegram). Telegram was already LIVE VERIFIED
 * by M53/M59 — telegramService.js's sendMessage() already does exactly
 * what social publishing needs (a real message to any chatId, which can
 * be a public channel @handle, not just an operator DM).
 *
 * UPDATED (Communication Ecosystem mission, M76 resume): telegramService.js
 * itself WAS modified by that later mission — it gained org-scoped
 * credential resolution (vault-then-env, same pattern as Twilio/WhatsApp/
 * Discord/Slack) and an auth cooldown, closing a genuine gap where
 * Telegram alone had no per-org credential isolation. That mission
 * preserved full backward compatibility: sendMessage(chatId, text, orgId)
 * and isConfigured(orgId) both default orgId to null, so this route's own
 * 2-arg/no-arg call sites below are byte-for-byte unaffected — confirmed
 * directly by re-running this route's tests, not assumed. This test's
 * "zero diff" assertions (accurate for Mission 60-C's own scope, false as
 * a general invariant once org-scoping was later and deliberately added)
 * are replaced with a call-site CONTRACT check: this route must still call
 * sendMessage/isConfigured in a way that is valid for both the old and the
 * new signature, and must not itself have grown a duplicate send path.
 *
 * Usage: node tests/security/137-telegram-social-publish-wiring.cjs
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
  section("backend/routes/telegram.js's direct-send path is org-scoped and rate-limited like its siblings");
  {
    // routes/telegram.js WAS also modified by the Communication Ecosystem
    // mission (M76 resume) — it gained attachOrg/org-membership gating and
    // a rate limiter, matching sms.js/slack.js, which it previously lacked.
    // This does not affect creative/social/publish/telegram (a separate
    // route in creativeStudio.js, verified unmodified below) — it only
    // brings the direct /telegram/send endpoint up to the same isolation
    // standard every sibling messaging route already has.
    const src = require("fs").readFileSync("backend/routes/telegram.js", "utf8");
    assert(src.includes("attachOrg"), "/telegram/send route composes attachOrg");
    assert(src.includes("_requireOrgMemberIfOrgContext") || src.includes("requireOrgMember"), "/telegram/send route composes an org-membership gate");
    assert(src.includes("rateLimiter"), "/telegram/send route is rate-limited");
  }

  section("telegramService.js's API remains backward-compatible for this route's call sites");
  {
    const svc = require("../../backend/services/telegramService");
    assert(typeof svc.sendMessage === "function", "sendMessage still exists");
    assert(typeof svc.isConfigured === "function", "isConfigured still exists");
    // orgId is an added, optional 3rd/1st param respectively — both
    // functions must still behave correctly when called with the old,
    // shorter argument list this route (and creativeStudio.js's Telegram
    // publish route) actually uses.
    assert(svc.sendMessage.length <= 3, "sendMessage accepts no more than 3 params (chatId, text, orgId)", `length=${svc.sendMessage.length}`);
    assert(svc.isConfigured.length <= 1, "isConfigured accepts no more than 1 param (orgId)", `length=${svc.isConfigured.length}`);
  }

  section("Wiring — Telegram publish route exists and composes the org-membership gate");
  {
    const router = require("../../backend/routes/creativeStudio.js");
    const postLayer = router.stack.find(l => l.route && l.route.path === "/creative/social/publish/telegram" && l.route.methods.post);
    assert(!!postLayer, "POST /creative/social/publish/telegram route exists");
    const postNames = postLayer.route.stack.map(h => h.name);
    assert(postNames.includes("attachOrg"), "POST route mounts attachOrg");
    assert(postNames.includes("_requireOrgMemberIfOrgContext"), "POST route mounts the membership gate");
    assert(postNames.indexOf("attachOrg") < postNames.indexOf("_requireOrgMemberIfOrgContext"),
      "attachOrg runs before the membership gate");
  }

  section("Behavior — a resolved-but-foreign org is rejected before the Telegram handler runs");
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
      const req = { org: { id: "victim-org", status: "active" }, orgRole: null, user: { sub: "attacker" }, path: "/creative/social/publish/telegram" };
      _requireOrgMemberIfOrgContext(req, res, () => { called = true; });
      assert(called === false, "handler never runs for a non-member");
      assert(res._code() === 403, "caller receives 403", `got ${res._code()}`);
    } finally {
      orgSvc.isEnterpriseAdmin    = origAdmin;
      orgSvc.listGrantsForAccount = origGrants;
    }
  }

  section("Route requires chatId (a public channel or numeric chat id) — the real capability Telegram provides");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/routes/creativeStudio.js"), "utf8");
    const routeMatch = src.match(/router\.post\("\/creative\/social\/publish\/telegram"[\s\S]*?\n\}\);/);
    assert(!!routeMatch, "found the Telegram publish route handler source");
    assert(/chatId required/.test(routeMatch[0]), "route validates chatId is present before calling sendMessage");
    assert(/sender\.sendMessage\(chatId, body\)/.test(routeMatch[0]), "route calls the EXISTING telegramService.sendMessage() unchanged, not a new send path");
  }

  section("Route adapts telegramService's {sent} shape to withRetry's {success} contract at the call site only");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/routes/creativeStudio.js"), "utf8");
    const routeMatch = src.match(/router\.post\("\/creative\/social\/publish\/telegram"[\s\S]*?\n\}\);/);
    assert(/success: r\.sent/.test(routeMatch[0]), "route maps sendMessage's `sent` field to withRetry's `success` field, not modifying telegramService.js itself");
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
