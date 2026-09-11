#!/usr/bin/env node
"use strict";
/**
 * Mission 56 — regression test: POST /send-followup ownership check.
 *
 * Mission 55 found this route's own comment claimed "a contact they own"
 * but never actually verified ownership — any authenticated caller could
 * send a real WhatsApp follow-up to an arbitrary phone number and mutate
 * an arbitrary lead's lastInteraction. Fixed with the same
 * crm.getLead(phone, orgId) + lead.userId === caller ownership check
 * crm.js's PATCH /crm/lead/:phone already uses for this identical risk
 * class.
 *
 * Required matrix (per the mission brief):
 *   Org/User A -> own lead        = ALLOW
 *   Org/User A -> Org/User B lead = DENY
 *   Org/User B -> Org/User A lead = DENY
 *   unauthenticated                = DENY
 *
 * automation.sendManualFollowUp() is stubbed via node:test's mock.method so
 * this test never attempts a real WhatsApp send or depends on WA_TOKEN
 * being configured — it verifies the AUTHORIZATION decision (was the send
 * attempted at all), not the delivery mechanism.
 *
 * Data safety: creates exactly 2 clearly-marked test leads (unique phone
 * prefix), deletes them in a finally block, and verifies the real
 * data/leads.json lead count is unchanged before/after.
 *
 * Usage: node tests/security/117-send-followup-ownership.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const { mock } = require("node:test");
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

const crm         = require("./../../backend/services/crmService");
const automation  = require("./../../backend/services/automationService");
const simRouter   = require("./../../backend/routes/simulation.js");

function findHandler(method, routePath) {
  const layer = simRouter.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer ? layer.route.stack[layer.route.stack.length - 1].handle : null;
}

function mockReq({ user, org, body } = {}) {
  return { user, org, body: body || {} };
}
function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = c => { res.statusCode = c; return res; };
  res.json   = b => { res.body = b; return res; };
  return res;
}

const LEAD_PHONE_A = "911000000001"; // marker prefix so cleanup is unambiguous
const LEAD_PHONE_B = "911000000002";
const ORG_A = "m56_test_org_a";
const ORG_B = "m56_test_org_b";
const USER_A = "m56_test_user_a";
const USER_B = "m56_test_user_b";

function countLeads() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/leads.json"), "utf8")).length;
}

async function main() {
  const beforeCount = countLeads();

  // Seed: lead A owned by user A in org A; lead B owned by user B in org B.
  crm.saveLead({ phone: LEAD_PHONE_A, name: "M56 Test Lead A", userId: USER_A, orgId: ORG_A });
  crm.saveLead({ phone: LEAD_PHONE_B, name: "M56 Test Lead B", userId: USER_B, orgId: ORG_B });

  const handler = findHandler("post", "/send-followup");
  assert(!!handler, "POST /send-followup handler found", "handler not found — route may have changed shape");

  // Stub the real WhatsApp/automation call so this test never attempts a
  // real send and never depends on WA_TOKEN being configured — verifies
  // the authorization decision only.
  const sendStub = mock.method(automation, "sendManualFollowUp", async () => ({ success: true, stubbed: true }));

  try {
    section("Org/User A -> own lead (A) = ALLOW");
    {
      sendStub.mock.resetCalls();
      const req = mockReq({ user: { sub: USER_A, role: "user" }, org: { id: ORG_A }, body: { phone: LEAD_PHONE_A, message: "hi" } });
      const res = mockRes();
      await handler(req, res);
      assert(res.statusCode === 200 && sendStub.mock.callCount() === 1,
        "user A sending to their own lead is allowed and reaches sendManualFollowUp",
        `status=${res.statusCode} callCount=${sendStub.mock.callCount()}`);
    }

    section("Org/User A -> Org/User B lead = DENY");
    {
      sendStub.mock.resetCalls();
      const req = mockReq({ user: { sub: USER_A, role: "user" }, org: { id: ORG_A }, body: { phone: LEAD_PHONE_B, message: "hi" } });
      const res = mockRes();
      await handler(req, res);
      assert(res.statusCode === 403 && sendStub.mock.callCount() === 0,
        "user A CANNOT send a follow-up to user B's lead — 403, no send attempted",
        `status=${res.statusCode} callCount=${sendStub.mock.callCount()}`);
    }

    section("Org/User B -> Org/User A lead = DENY (symmetric)");
    {
      sendStub.mock.resetCalls();
      const req = mockReq({ user: { sub: USER_B, role: "user" }, org: { id: ORG_B }, body: { phone: LEAD_PHONE_A, message: "hi" } });
      const res = mockRes();
      await handler(req, res);
      assert(res.statusCode === 403 && sendStub.mock.callCount() === 0,
        "user B CANNOT send a follow-up to user A's lead — 403, no send attempted (symmetric to the case above)",
        `status=${res.statusCode} callCount=${sendStub.mock.callCount()}`);
    }

    section("unauthenticated = DENY");
    {
      // requireAuth (mounted before this handler in the real router chain)
      // is what actually rejects a request with no req.user — verified
      // directly here since the handler itself is invoked in isolation
      // above. This asserts the handler's OWN logic degrades safely if
      // ever reached without req.user (defense in depth), not a bypass of
      // requireAuth.
      sendStub.mock.resetCalls();
      const req = mockReq({ user: undefined, org: undefined, body: { phone: LEAD_PHONE_A, message: "hi" } });
      const res = mockRes();
      let threw = false;
      try { await handler(req, res); } catch { threw = true; }
      assert(threw || (res.statusCode !== 200 && sendStub.mock.callCount() === 0),
        "no req.user (would never reach here past the real requireAuth gate) does not silently succeed",
        `threw=${threw} status=${res.statusCode} callCount=${sendStub.mock.callCount()}`);
    }

    section("operator bypass preserved — matches this route's own established 'operator or customer' comment");
    {
      sendStub.mock.resetCalls();
      const req = mockReq({ user: { sub: "m56_operator", role: "operator" }, org: undefined, body: { phone: LEAD_PHONE_A, message: "hi" } });
      const res = mockRes();
      await handler(req, res);
      assert(res.statusCode === 200 && sendStub.mock.callCount() === 1,
        "an operator can send a follow-up regardless of lead ownership, unchanged from before this fix",
        `status=${res.statusCode} callCount=${sendStub.mock.callCount()}`);
    }

    section("missing phone still rejected (pre-existing validation, unaffected by this fix)");
    {
      sendStub.mock.resetCalls();
      const req = mockReq({ user: { sub: USER_A, role: "user" }, org: { id: ORG_A }, body: { message: "hi" } });
      const res = mockRes();
      await handler(req, res);
      assert(res.statusCode === 400 && sendStub.mock.callCount() === 0,
        "missing phone -> 400, unaffected by the ownership fix", `status=${res.statusCode}`);
    }
  } finally {
    sendStub.mock.restore();
    // Cleanup: remove exactly the 2 test leads this test created.
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/leads.json"), "utf8"));
    const cleaned = raw.filter(l => l.phone !== LEAD_PHONE_A && l.phone !== LEAD_PHONE_B);
    fs.writeFileSync(path.join(__dirname, "../../data/leads.json"), JSON.stringify(cleaned, null, 2));
  }

  section("data safety — lead count restored to pre-test value");
  {
    const afterCount = countLeads();
    assert(afterCount === beforeCount, `real data/leads.json lead count unchanged (${beforeCount} before, ${afterCount} after)`, `count mismatch: ${beforeCount} -> ${afterCount}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("CRASH:", e); process.exit(1); });
