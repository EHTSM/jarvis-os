#!/usr/bin/env node
"use strict";
/**
 * Webhook fulfillment idempotency — regression test.
 *
 * Production Resilience & Chaos Certification finding: Razorpay retries
 * webhook delivery on any non-2xx response or timeout, so duplicate
 * payment.captured events for the same phone number are a real production
 * scenario, not a contrived one. automationService.triggerFulfillment()
 * checked lead.onboardingDone, then `await`ed a slow WhatsApp send, then
 * marked onboardingDone true afterward — a TOCTOU gap letting concurrent
 * duplicate webhook deliveries all pass the check before any of them
 * finished the send. Verified: 10 concurrent duplicate webhooks for the
 * same phone number all sent the WhatsApp welcome message before the fix.
 *
 * Fix: triggerFulfillment() now claims onboardingDone (via the fully
 * synchronous, therefore atomic-per-call, crmService.updateLead()) BEFORE
 * starting the slow WhatsApp send, releasing the claim only if the send
 * itself throws (so a genuine failure doesn't permanently block a real
 * retry). Same reserve-before-await pattern as creditEngine.reserve()
 * (Production Blocker Elimination Module 3).
 *
 * Usage: node tests/security/16-webhook-fulfillment-idempotency.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
if (!process.env.RAZORPAY_WEBHOOK_SECRET) process.env.RAZORPAY_WEBHOOK_SECRET = "test-fulfillment-idempotency-secret";

const crypto = require("crypto");
const express = require("express");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function signBody(body) {
  return crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex");
}

async function main() {
  const waService = require("../../backend/services/whatsappService.js");
  let sendCount = 0;
  const originalSend = waService.sendMessage;
  waService.sendMessage = async (phone, message) => {
    sendCount++;
    await new Promise(r => setTimeout(r, 20)); // simulate real network latency
    return { ok: true, mocked: true };
  };

  const { handleRazorpayWebhook } = require("../../backend/controllers/webhookController.js");
  const crm = require("../../backend/services/crmService");

  section("Concurrent duplicate payment.captured webhooks send exactly one WhatsApp message");
  const suffix = Date.now();
  const phone = `9${suffix}`.slice(-9);
  const normalizedPhone = `91${phone}`;
  crm.saveLead({ phone: normalizedPhone, name: "Idempotency Test", status: "new" });

  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf.toString(); } }));
  app.post("/webhook/razorpay", handleRazorpayWebhook);
  const server = app.listen(0);
  await new Promise(r => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: {
      id: "pay_idempotency_test", contact: `+91${phone}`, customer_details: { name: "Idempotency Test" },
      notes: {},
    } } },
  });

  const N = 10;
  const responses = await Promise.all(Array.from({ length: N }, () =>
    fetch(`${base}/webhook/razorpay`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": signBody(body) },
      body,
    })
  ));
  await new Promise(r => setTimeout(r, 100)); // let in-flight async work settle
  server.close();
  waService.sendMessage = originalSend;

  assert(responses.every(r => r.status === 200), `all ${N} concurrent duplicate webhook deliveries return 200`, `some returned non-200`);
  assert(sendCount === 1, `exactly 1 WhatsApp welcome message sent despite ${N} concurrent duplicate webhook deliveries`, `${sendCount} messages sent`);

  const finalLead = crm.getLead(normalizedPhone);
  assert(finalLead?.onboardingDone === true, "lead ends in a correct, non-corrupted onboardingDone=true state", `got onboardingDone=${finalLead?.onboardingDone}`);

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    ✗ ${f.msg}: ${f.reason}`));
  }

  try {
    require("fs").writeFileSync(
      require("path").join(process.cwd(), "data/webhook-fulfillment-idempotency-test-report.json"),
      JSON.stringify({ generated: new Date().toISOString(), pass, fail, failures }, null, 2)
    );
    console.log("\n  Report: data/webhook-fulfillment-idempotency-test-report.json\n");
  } catch { /* non-critical */ }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
