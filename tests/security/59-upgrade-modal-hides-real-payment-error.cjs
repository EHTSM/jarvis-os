#!/usr/bin/env node
"use strict";
/**
 * Upgrade modal hides real payment error regression — Phase A.6 (Business
 * Owner Certification, Finance section).
 *
 * CONFIRMED finding (reproduced live: real signup, Billing → Upgrade →
 * "Choose Starter", against real but invalid/incomplete Razorpay config):
 * clicking to upgrade a real plan failed with a genuine backend 500
 * ({"error":"Razorpay plan ID not configured. Set RAZORPAY_..."}) but the
 * UI showed only "Payment processing is temporarily unavailable" with an
 * "email billing@ooplix.com" link — the real, specific infrastructure
 * reason was discarded entirely before it ever reached the founder.
 *
 * Root cause: UpgradeModal.jsx's handleUpgrade() detected an auth/config
 * -class error from the backend and REPLACED the real res?.error string
 * with the literal sentinel "payment_auth_failed", which the render logic
 * then matched to show only generic copy. The real error was never
 * stored anywhere reachable by the UI.
 *
 * This directly violates this pass's explicit rule: if a credential/
 * config is invalid, expose the real infrastructure error — never
 * convert it to a generic message.
 *
 * Fix: the real error string is now always kept in `error` state; a
 * separate `isAuthError` boolean (computed from the same substring checks
 * that used to gate the sentinel swap) selects which block renders. The
 * rich block now shows the real reason ("Reason: {error}") ABOVE the
 * existing actionable "email us" guidance — additive, not a replacement
 * of the existing UX for a real outage.
 *
 * Verified live: the modal now shows "Reason: Razorpay plan ID not
 * configured. Set RAZORPAY_..." alongside the friendly guidance.
 *
 * Usage: node tests/security/59-upgrade-modal-hides-real-payment-error.cjs
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
  const src = fs.readFileSync(require.resolve("../../frontend/src/components/UpgradeModal.jsx"), "utf8");

  section("Fix: the sentinel string no longer replaces the real error");
  {
    assert.ok(!/setError\(\s*\n?\s*isAuthErr\s*\n?\s*\?\s*"payment_auth_failed"/.test(src),
      "handleUpgrade() must not set error to the literal sentinel \"payment_auth_failed\" in place of the real message");
    assert.ok(/setError\(rawErr\)/.test(src), "handleUpgrade() must call setError(rawErr) — the real backend error string");
    ok("setError() always receives the real backend error string, never a sentinel replacement");
  }

  section("Fix: a separate isAuthError flag drives which block renders, not the error content itself");
  {
    assert.ok(/const \[isAuthError, setIsAuthError\] = useState\(false\)/.test(src),
      "UpgradeModal must have a dedicated isAuthError state, separate from the error message itself");
    assert.ok(/setIsAuthError\(isAuthErr\)/.test(src), "handleUpgrade() must call setIsAuthError(isAuthErr)");
    ok("isAuthError is tracked separately from the error message content");
  }

  section("Fix: the rich (auth-error) block displays the real reason, not just generic copy");
  {
    const richBlockMatch = src.match(/\{error && isAuthError && \([\s\S]*?\)\}\s*\n\s*\{error && !isAuthError/);
    assert.ok(richBlockMatch, "could not find the rich auth-error block");
    assert.ok(/Reason: \{error\}/.test(richBlockMatch[0]),
      "the rich block must render \"Reason: {error}\" — the real backend message — not just the generic \"temporarily unavailable\" copy");
    assert.ok(/Payment processing is temporarily unavailable/.test(richBlockMatch[0]),
      "the existing actionable guidance must remain — this is additive, not a UX regression for a genuine outage");
    ok("rich block shows the real error reason alongside the existing actionable guidance");
  }

  section("Regression: error state resets isAuthError too, so a retry doesn't carry a stale auth-error flag");
  {
    const resetBlock = src.match(/setLoading\(true\);\s*setError\(null\);\s*setIsAuthError\(false\);/);
    assert.ok(resetBlock, "handleUpgrade() must reset both setError(null) and setIsAuthError(false) at the start of each attempt");
    ok("both error and isAuthError are reset together at the start of each upgrade attempt");
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
