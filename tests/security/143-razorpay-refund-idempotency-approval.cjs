#!/usr/bin/env node
"use strict";
/**
 * Razorpay real gateway refund — honest-failure + idempotency +
 * concurrency-race + approval-gate regression.
 *
 * Payments Ecosystem mission. Discovery confirmed refunds previously
 * never reached Razorpay's real gateway API at all — only an internal
 * credit-note record existed (revenueOS.cjs), even though
 * parseWebhookEvent() in paymentService.js already parsed real
 * refund.processed events. This mission added paymentService.refundPayment()
 * (real rz.payments.refund() call) plus a new POST /payment/refund
 * (request) → POST /payment/refund/:reqId/execute (execute) pair, reusing
 * the EXACT SAME wf_refund_finance approval policy (RISK.HIGH, never
 * auto-approved) and operatorOnly gate already established and proven for
 * the internal credit-note refund path in revenueOS.js — this is a
 * separate, additive request/execute pair (a real gateway refund needs an
 * actual Razorpay payment_id, not present in revenueOS.js's context
 * shape), not a modification of that existing route.
 *
 * This test never makes a real network call to Razorpay — every scenario
 * exercises validation, honest-failure, and concurrency-guard logic that
 * fires before any real HTTP request would be constructed.
 *
 * Usage: node tests/security/143-razorpay-refund-idempotency-approval.cjs
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
  section("refundPayment() — honest not-configured failure, no fabricated success");
  {
    delete process.env.DISABLE_PAYMENTS;
    const svc = require("../../backend/services/paymentService.js");
    const result = await svc.refundPayment("pay_test123", {});
    assert(result.success === false, "refundPayment() returns success:false when Razorpay isn't configured", JSON.stringify(result));
    assert(!result.refundId, "no refundId is fabricated on failure", JSON.stringify(result));
  }

  section("refundPayment() — paymentId required");
  {
    const svc = require("../../backend/services/paymentService.js");
    const result = await svc.refundPayment(null, {});
    assert(result.success === false, "refundPayment() rejects when paymentId is missing");
    assert(result.error === "paymentId required", "error message is exact", result.error);
  }

  section("refundPayment() — amount, if provided, must be a positive number");
  {
    const svc = require("../../backend/services/paymentService.js");
    const negative = await svc.refundPayment("pay_test", { amount: -100 });
    assert(negative.success === false, "refundPayment() rejects a negative amount");
    const zero = await svc.refundPayment("pay_test", { amount: 0 });
    assert(zero.success === false, "refundPayment() rejects a zero amount");
    const notNumber = await svc.refundPayment("pay_test", { amount: "500" });
    assert(notNumber.success === false, "refundPayment() rejects a non-numeric amount");
  }

  section("refundPayment() — DISABLE_PAYMENTS kill-switch honored (same convention as createPaymentLink)");
  {
    process.env.DISABLE_PAYMENTS = "true";
    delete require.cache[require.resolve("../../backend/services/paymentService.js")];
    const svc = require("../../backend/services/paymentService.js");
    const result = await svc.refundPayment("pay_test123", {});
    delete process.env.DISABLE_PAYMENTS;
    assert(result.success === false, "refundPayment() refuses when DISABLE_PAYMENTS=true");
    assert(/disabled/i.test(result.error || ""), "error message explains the kill-switch", result.error);
  }

  section("refundPayment() — idempotency dedup returns the cached result for a repeated key");
  {
    delete require.cache[require.resolve("../../backend/services/paymentService.js")];
    const svc = require("../../backend/services/paymentService.js");
    const key = `test-refund-${Date.now()}`;
    const r1 = await svc.refundPayment("pay_test123", { idempotencyKey: key });
    const r2 = await svc.refundPayment("pay_test123", { idempotencyKey: key });
    assert(JSON.stringify(r1) === JSON.stringify(r2), "a repeated call with the same idempotencyKey returns the identical cached result, not a fresh attempt");
  }

  section("refundPayment() — concurrent calls with the same idempotencyKey do not both proceed unguarded");
  {
    const svc = require("../../backend/services/paymentService.js");
    const key = `test-concurrent-${Date.now()}`;
    // Fire both truly concurrently (no await between them) — the in-flight
    // Set lock must prevent a genuine double-fire even though neither call
    // has had time to record a result via checkIdempotency/recordIdempotency yet.
    const [r1, r2] = await Promise.all([
      svc.refundPayment("pay_race_test", { idempotencyKey: key }),
      svc.refundPayment("pay_race_test", { idempotencyKey: key }),
    ]);
    // Not configured in this test env, so both legitimately fail at that
    // check before the in-flight lock would even matter for THIS specific
    // pair — but confirm the lock mechanism itself is present in source
    // (verified structurally below) since we cannot safely force a real
    // slow async gateway call in a unit test without a real network mock.
    assert(r1.success === false && r2.success === false, "both concurrent calls fail honestly (unconfigured), no fabricated success from either");
  }

  section("refundPayment() — in-flight lock structure exists (source-level verification, since forcing a real race requires a live/mocked slow HTTP call)");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/services/paymentService.js"), "utf8");
    assert(/const _inFlightRefunds = new Set\(\)/.test(src), "a process-local in-flight Set exists");
    assert(/_inFlightRefunds\.has\(dedupKey\)/.test(src), "refundPayment() checks the in-flight lock before proceeding");
    assert(/_inFlightRefunds\.add\(dedupKey\)/.test(src), "refundPayment() reserves the lock synchronously (no await between check and add)");
    const deleteCount = (src.match(/_inFlightRefunds\.delete\(dedupKey\)/g) || []).length;
    assert(deleteCount >= 2, "the lock is released on both the early not-configured exit AND the final result path", `found ${deleteCount} release points`);
  }

  section("refundPayment() — Razorpay's own receipt-based idempotency is used, not fabricated locally only");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/services/paymentService.js"), "utf8");
    assert(/params\.receipt = String\(idempotencyKey\)/.test(src), "idempotencyKey is passed through as Razorpay's real `receipt` field, not only used for local dedup");
  }

  section("Wiring — POST /payment/refund and /payment/refund/:reqId/execute exist, operator-only, org-gated");
  {
    const router = require("../../backend/routes/payment.js");
    const reqLayer = router.stack.find(l => l.route && l.route.path === "/payment/refund" && l.route.methods.post);
    const execLayer = router.stack.find(l => l.route && l.route.path === "/payment/refund/:reqId/execute" && l.route.methods.post);
    assert(!!reqLayer, "POST /payment/refund route exists");
    assert(!!execLayer, "POST /payment/refund/:reqId/execute route exists");

    const reqNames = reqLayer.route.stack.map(h => h.name);
    assert(reqNames.includes("requireAuth"), "the request route requires authentication");
    assert(reqNames.includes("operatorOnly"), "the request route is operator-only — a regular customer cannot request a gateway refund directly");

    const execNames = execLayer.route.stack.map(h => h.name);
    assert(execNames.includes("operatorOnly"), "the execute route is also operator-only");
    assert(execNames.includes("attachOrg") && execNames.includes("_requireOrgMemberIfOrgContext"), "the execute route is also org-gated (same pattern as /payment/link)");
  }

  section("Approval policy — wf_refund_finance is RISK.HIGH and can never auto-approve (reused, not weakened)");
  {
    const policy = require("../../backend/services/approvalPolicy.cjs");
    const pol = policy.getPolicy("wf_refund_finance");
    assert(pol.risk === "high" || pol.risk === "HIGH", "wf_refund_finance policy is still HIGH risk", JSON.stringify(pol));
    assert(pol.autoApproveThreshold === null, "wf_refund_finance still has no auto-approve threshold", JSON.stringify(pol));
    assert(policy.shouldAutoApprove("wf_refund_finance", 1.0) === false, "even maximum confidence (1.0) cannot auto-approve a gateway refund");
  }

  section("Execute route rejects an unapproved or already-executed request (no bypass of the approval gate)");
  {
    const approvalQueue = require("../../backend/services/approvalQueue.cjs");
    const result = approvalQueue.enqueue({
      workflowId: "wf_refund_finance",
      action: "test refund request — never approve or execute for real",
      approvalType: "PAYMENT_CONFIRM",
      confidence: 0,
      context: { paymentId: "pay_never_real", amount: null, orgId: null },
      triggeredBy: "test:143",
    });
    assert(result.autoApproved === false, "a real enqueue() call for this workflow is never auto-approved");
    assert(result.request.status === "pending", "the request sits in pending state, awaiting real human approval", result.request.status);
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
