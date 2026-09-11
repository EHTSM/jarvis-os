#!/usr/bin/env node
"use strict";
/**
 * Billing webhook concurrency verification — NOT a fix, a documented
 * negative result.
 *
 * The audit originally claimed billingService.js's activatePlan()/
 * cancelPlan() could lose updates under concurrent Razorpay webhook
 * deliveries (full-file _load()/_save() with no lock, reachable via webhook
 * retries). This was tested directly against the real webhook controller +
 * billing service under three interleavings and did NOT reproduce in any of
 * them, because activatePlan()/cancelPlan() are fully synchronous (no await
 * inside their own bodies) — Node's single-threaded event loop cannot
 * interleave two calls to either function, and each call re-_load()s a
 * fresh on-disk snapshot rather than reusing state captured before any
 * await elsewhere in the handler.
 *
 * This test exists to keep that verification honest over time — if a future
 * refactor reintroduces an await inside activatePlan/cancelPlan, or a route
 * starts checking checkAccess() then calling activatePlan/cancelPlan only
 * after its own slow await (the Module 3 creativeStudio.js pattern), this
 * test should start failing.
 *
 * See docs/audits/PRODUCTION-BLOCKER-ELIMINATION.md Module 4 for the full
 * writeup of what was tested and why it's documented rather than "fixed."
 *
 * Usage: node tests/security/12-billing-webhook-race-verification.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
// Webhook signature verification (backend/services/paymentService.js
// verifyWebhookSignature) checks RAZORPAY_WEBHOOK_SECRET specifically — not
// RAZORPAY_KEY_SECRET/RAZORPAY_SECRET (those are for creating payment
// links). Sign with whatever is actually configured so this test exercises
// the real signature-checked path rather than the dev-mode auto-accept
// fallback (which only applies when RAZORPAY_WEBHOOK_SECRET is entirely
// unset).
if (!process.env.RAZORPAY_WEBHOOK_SECRET) process.env.RAZORPAY_WEBHOOK_SECRET = "test-billing-race-webhook-secret";

const crypto = require("crypto");
const express = require("express");
const billing = require("../../backend/services/billingService");
const { handleRazorpayWebhook } = require("../../backend/controllers/webhookController.js");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function signBody(body) {
  return crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex");
}

async function startApp() {
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf.toString(); } }));
  app.post("/webhook/razorpay", handleRazorpayWebhook);
  const server = app.listen(0);
  await new Promise(r => server.on("listening", r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  const suffix = Date.now();

  section("Interleaving 1 — different accounts, alternating activate/cancel events");
  {
    const acctA = `test-billing-race-A-${suffix}`;
    const acctB = `test-billing-race-B-${suffix}`;
    billing.createTrial(acctA);
    billing.createTrial(acctB);

    const { server, base } = await startApp();
    const bodyA = JSON.stringify({ event: "subscription.activated", payload: { subscription: { entity: { id: "sub_A", plan_id: "plan_x", notes: { accountId: acctA } } } } });
    const bodyB = JSON.stringify({ event: "subscription.cancelled", payload: { subscription: { entity: { id: "sub_B", plan_id: "plan_x", notes: { accountId: acctB } } } } });

    const N = 30;
    const reqs = Array.from({ length: N }, (_, i) => {
      const body = i % 2 === 0 ? bodyA : bodyB;
      return fetch(`${base}/webhook/razorpay`, { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": signBody(body) }, body });
    });
    await Promise.all(reqs);
    server.close();

    const stateA = billing.checkAccess(acctA);
    const stateB = billing.checkAccess(acctB);
    assert(stateA.plan === "starter" && stateA.status === "active", "account A ends activated despite interleaved webhooks for account B", `got plan=${stateA.plan} status=${stateA.status}`);
    assert(stateB.status === "cancelled", "account B ends cancelled despite interleaved webhooks for account A", `got status=${stateB.status}`);
  }

  section("Interleaving 2 — different accounts, payment.captured (real await before activatePlan)");
  {
    const N = 20;
    const accounts = Array.from({ length: N }, (_, i) => `test-billing-race2-${i}-${suffix}`);
    accounts.forEach(a => billing.createTrial(a));

    const { server, base } = await startApp();
    const reqs = accounts.map((acctId, i) => {
      const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: `pay_${i}`, contact: "+911234567890", customer_details: { name: "Test" }, notes: { accountId: acctId } } } } });
      return fetch(`${base}/webhook/razorpay`, { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": signBody(body) }, body });
    });
    await Promise.all(reqs);
    server.close();

    const activatedCount = accounts.filter(a => { const s = billing.checkAccess(a); return s.plan === "starter" && s.status === "active"; }).length;
    assert(activatedCount === N, `all ${N} accounts activate correctly despite a real await (triggerFulfillment) before each activatePlan() call`, `only ${activatedCount}/${N} activated`);
  }

  section("Interleaving 3 — same account, duplicate webhook delivery (Razorpay retry simulation)");
  {
    const acct = `test-billing-race3-${suffix}`;
    billing.createTrial(acct);

    const { server, base } = await startApp();
    const body = JSON.stringify({ event: "subscription.activated", payload: { subscription: { entity: { id: "sub_dup", plan_id: "plan_x", notes: { accountId: acct } } } } });
    const reqs = Array.from({ length: 15 }, () =>
      fetch(`${base}/webhook/razorpay`, { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": signBody(body) }, body })
    );
    await Promise.all(reqs);
    server.close();

    const state = billing.checkAccess(acct);
    assert(state.plan === "starter" && state.status === "active", "15 concurrent duplicate activation webhooks for the same account converge to the correct final state", `got plan=${state.plan} status=${state.status}`);
  }

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    ✗ ${f.msg}: ${f.reason}`));
    console.log("\n  If this test now fails, the Module 4 'documented as false' conclusion in");
    console.log("  docs/audits/PRODUCTION-BLOCKER-ELIMINATION.md may no longer hold — investigate");
    console.log("  what changed in billingService.js or webhookController.js before assuming a");
    console.log("  fix is needed.");
  }

  try {
    require("fs").writeFileSync(
      require("path").join(process.cwd(), "data/billing-webhook-race-verification-report.json"),
      JSON.stringify({ generated: new Date().toISOString(), pass, fail, failures }, null, 2)
    );
    console.log("\n  Report: data/billing-webhook-race-verification-report.json\n");
  } catch { /* non-critical */ }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
