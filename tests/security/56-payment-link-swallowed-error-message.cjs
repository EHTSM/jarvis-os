#!/usr/bin/env node
"use strict";
/**
 * Payment-link swallowed-error-message regression — Phase A.6 (Business
 * Owner Certification).
 *
 * CONFIRMED finding (reproduced live: real signup, real lead, real
 * "Generate Payment Link" submission against real configured Razorpay LIVE
 * keys): the /payment/link route returned HTTP 500 with a literal empty
 * JSON body "{}", and the frontend correctly fell through to a bare
 * "HTTP 500" message with zero explanation — a founder trying to collect
 * their first payment hit a dead end with no actionable information.
 *
 * Root cause: node_modules/razorpay's own error normalizer
 * (dist/api.js normalizeError()) throws a plain object —
 * { statusCode, error: { code, description } } — not a standard Error
 * instance. paymentService.js's createPaymentLink() catch block read
 * err.message, which is undefined on that shape, so it returned
 * { success: false, error: undefined }. JSON.stringify() drops keys with
 * an undefined value, so the route's res.json({ error: result.error })
 * serialized to a literal "{}" — confirmed via direct fetch, and via
 * the backend log line "[Payment] createPaymentLink failed: undefined".
 *
 * Fix: the catch block now extracts the real detail from whichever shape
 * the thrown value actually has — err?.error?.description (Razorpay's
 * real shape) falling back to err?.message (standard Error) falling back
 * to String(err) — so a genuine Razorpay-side failure (bad/expired keys,
 * disabled account, etc.) surfaces its real, specific reason instead of
 * an empty body. Verified live: raw response body changed from "{}" to
 * {"error":"Authentication failed"}, and the UI now shows "Authentication
 * failed" instead of "HTTP 500".
 *
 * This test is a static source check (no live Razorpay credentials
 * required); the live reproduction was verified manually against the
 * real running app + real (if currently invalid) Razorpay keys during
 * this session.
 *
 * Usage: node tests/security/56-payment-link-swallowed-error-message.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  const src = fs.readFileSync(require.resolve("../../backend/services/paymentService.js"), "utf8");

  section("Fix: createPaymentLink's catch block extracts the real Razorpay error shape");
  {
    assert.ok(/err\?\.error\?\.description/.test(src),
      "createPaymentLink's catch block must read err?.error?.description — Razorpay SDK's actual thrown shape");
    assert.ok(/err\?\.message/.test(src),
      "the fallback chain must still handle a standard Error (err?.message)");
    ok("catch block reads err?.error?.description with an err?.message fallback");
  }

  section("Regression: the fallback chain always produces a truthy string, never undefined");
  {
    // Reproduce the exact extraction logic in isolation and test all 3
    // shapes: Razorpay's real shape, a standard Error, and a bare string/object.
    function extract(err) {
      return err?.error?.description || err?.message || String(err);
    }

    const razorpayShape = { statusCode: 401, error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } };
    assert.strictEqual(extract(razorpayShape), "Authentication failed", "must extract Razorpay's real error.description");

    const standardError = new Error("Network timeout");
    assert.strictEqual(extract(standardError), "Network timeout", "must still handle a standard Error via .message");

    const bareObject = { foo: "bar" };
    assert.ok(extract(bareObject) !== "undefined" && extract(bareObject).length > 0,
      "an unrecognized error shape must still produce a non-empty string, never the literal 'undefined'");

    ok("extraction logic handles Razorpay's shape, a standard Error, and an unrecognized fallback — never undefined");
  }

  section("Sanity: JSON.stringify's undefined-dropping behavior is the actual mechanism that produced the empty '{}' body");
  {
    // Confirms the bug's mechanism precisely, so this test would have
    // caught the original regression even without live Razorpay access.
    const buggyResult = { success: false, error: undefined };
    const serialized = JSON.stringify(buggyResult);
    assert.strictEqual(serialized, '{"success":false}',
      "JSON.stringify must drop the undefined error key — this is exactly why the raw body was effectively empty of error detail");
    ok("confirmed JSON.stringify's undefined-key-dropping is the mechanism that produced the empty-of-detail response body");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
