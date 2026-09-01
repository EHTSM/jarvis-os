#!/usr/bin/env node
"use strict";
/**
 * Twilio SMS — real send wiring + tenant-isolation regression.
 *
 * Communication Ecosystem mission. Discovery confirmed Twilio had a real,
 * working credential health-probe (integrationConnectors.cjs's
 * connectTwilio()) but ZERO send capability anywhere — no
 * smsService/twilioService file existed. twilioService.js is a
 * from-scratch adapter, following the exact sibling shape
 * whatsappService.js/telegramService.js already established: org-scoped
 * vault-then-env credential resolution, retry with an auth cooldown,
 * honest {success, error} results, real HTTP Basic Auth against Twilio's
 * actual REST API. Wired through a NEW route (backend/routes/sms.js) with
 * attachOrg + the same non-blocking-then-gate org-membership pattern
 * proven across every credential-consuming route fixed in this mission
 * chain, applied from the outset rather than retrofitted later.
 *
 * This test never sends a real SMS — one deliberate exception makes a
 * real network call to Twilio's actual API with fake credentials to prove
 * the wiring is genuine (not a mock), and that call is guaranteed to fail
 * authentication before any message could be dispatched.
 *
 * Usage: node tests/security/147-twilio-sms-real-send-tenant-isolation.cjs
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
  section("twilioService — honest not-configured failure, no fabricated success");
  {
    delete process.env.DISABLE_TWILIO;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    const svc = require("../../backend/services/twilioService.js");
    const result = await svc.sendSMS("+15551234567", "Test message", 0, null);
    assert(result.success === false, "sendSMS() returns success:false when Twilio isn't configured", JSON.stringify(result));
    assert(!result.messageId, "no messageId is fabricated on failure", JSON.stringify(result));
    assert(svc.isConfigured(null) === false, "isConfigured() correctly reports false with no credentials");
  }

  section("twilioService — empty text and over-length text rejected");
  {
    const svc = require("../../backend/services/twilioService.js");
    const empty = await svc.sendSMS("+15551234567", "", 0, null);
    assert(empty.success === false, "sendSMS() rejects empty text");
    assert(empty.error === "text required", "error message is exact", empty.error);

    const tooLong = await svc.sendSMS("+15551234567", "a".repeat(1601), 0, null);
    assert(tooLong.success === false, "sendSMS() rejects text over 1600 chars");
    assert(/1600 character/.test(tooLong.error || ""), "error message names the real Twilio concatenation limit", tooLong.error);
  }

  section("twilioService — DISABLE_TWILIO kill-switch honored (same convention as DISABLE_WHATSAPP)");
  {
    process.env.DISABLE_TWILIO = "true";
    const svc = require("../../backend/services/twilioService.js");
    const result = await svc.sendSMS("+15551234567", "Test", 0, null);
    delete process.env.DISABLE_TWILIO;
    assert(result.success === false, "sendSMS() refuses when DISABLE_TWILIO=true");
    assert(/disabled/i.test(result.error || ""), "error message explains the kill-switch", result.error);
  }

  section("twilioService — invalid phone number rejected");
  {
    process.env.TWILIO_ACCOUNT_SID = "ACfaketest";
    process.env.TWILIO_AUTH_TOKEN  = "faketoken";
    process.env.TWILIO_PHONE_NUMBER = "+15005550006";
    delete require.cache[require.resolve("../../backend/services/twilioService.js")];
    const svc = require("../../backend/services/twilioService.js");
    const result = await svc.sendSMS("abc", "Test", 0, null);
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    assert(result.success === false, "sendSMS() rejects an invalid phone number");
    assert(/Invalid phone number/.test(result.error || ""), "error message is specific", result.error);
  }

  section("twilioService — real network call with fake credentials reaches Twilio's actual API and is honestly rejected");
  {
    process.env.TWILIO_ACCOUNT_SID  = "ACfaketest123";
    process.env.TWILIO_AUTH_TOKEN   = "faketoken";
    process.env.TWILIO_PHONE_NUMBER = "+15005550006";
    delete require.cache[require.resolve("../../backend/services/twilioService.js")];
    const svc = require("../../backend/services/twilioService.js");
    const result = await svc.sendSMS("+15551234567", "Test message", 0, null);
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    assert(result.success === false, "a fake credential set results in a real, honest failure — no message could have been sent", JSON.stringify(result));
    assert(!result.messageId, "no messageId fabricated even after a real network round-trip");
  }

  section("Wiring — POST /sms/send composes attachOrg + the org-membership gate before its handler");
  {
    const router = require("../../backend/routes/sms.js");
    const sendLayer = router.stack.find(l => l.route && l.route.path === "/sms/send" && l.route.methods.post);
    assert(!!sendLayer, "POST /sms/send route exists");
    const names = sendLayer.route.stack.map(h => h.name);
    assert(names.includes("attachOrg"), "POST /sms/send mounts attachOrg", names.join(","));
    assert(names.includes("_requireOrgMemberIfOrgContext"), "POST /sms/send mounts the membership gate", names.join(","));
    assert(names.indexOf("attachOrg") < names.indexOf("_requireOrgMemberIfOrgContext"),
      "attachOrg runs before the membership gate", names.join(","));
  }

  section("Behavior — a resolved-but-foreign org is rejected before the SMS handler runs");
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
      const req = { org: { id: "victim-org", status: "active" }, orgRole: null, user: { sub: "attacker" }, path: "/sms/send" };
      _requireOrgMemberIfOrgContext(req, res, () => { called = true; });
      assert(called === false, "handler (and twilioService's credential lookup) never runs for a non-member");
      assert(res._code() === 403, "caller receives 403", `got ${res._code()}`);
    } finally {
      orgSvc.isEnterpriseAdmin    = origAdmin;
      orgSvc.listGrantsForAccount = origGrants;
    }
  }

  section("Behavior — no org context at all falls through (solo/global-fallback caller unaffected)");
  {
    const { requireOrgMember } = require("../../backend/middleware/orgMiddleware.cjs");
    function _requireOrgMemberIfOrgContext(req, res, next) {
      if (!req.org) return next();
      return requireOrgMember(req, res, next);
    }
    let called = false;
    const req = { org: null };
    _requireOrgMemberIfOrgContext(req, resStub(), () => { called = true; });
    assert(called === true, "solo caller with no resolved org passes through to the handler (global env fallback preserved)");
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
