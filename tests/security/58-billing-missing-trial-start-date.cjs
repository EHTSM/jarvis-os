#!/usr/bin/env node
"use strict";
/**
 * Billing missing trial-start-date regression — Phase A.6 (Business Owner
 * Certification, Finance section).
 *
 * CONFIRMED finding (reproduced live: real signup, real login, Billing
 * page): "TRIAL TIMELINE → Trial started" always showed "—" for every
 * account, including a brand-new signup made seconds earlier.
 *
 * Root cause: billingService.js's createTrial() correctly sets
 * trialStart on the real billing record at creation time, and it's still
 * there in storage — but GET /billing/status's response object never
 * included a trialStart field, so the frontend's billing.trialStart was
 * always undefined and _fmtDate(undefined) rendered as "—".
 *
 * Fix: added trialStart: record.trialStart to the /billing/status
 * response — additive, the field already existed on the record, this
 * just stops dropping it before it reaches the frontend.
 *
 * Verified live: Billing page now shows "Trial started: 6 Aug 2026" (the
 * real signup date) instead of "—".
 *
 * Usage: node tests/security/58-billing-missing-trial-start-date.cjs
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
  const routeSrc   = fs.readFileSync(require.resolve("../../backend/routes/billing.js"), "utf8");
  const serviceSrc = fs.readFileSync(require.resolve("../../backend/services/billingService.js"), "utf8");

  section("Confirmed: billingService.js's createTrial() already sets trialStart on the real record");
  {
    assert.ok(/trialStart:\s*now\.toISOString\(\)/.test(serviceSrc),
      "createTrial() must set trialStart on the record — this confirms the data was always real, just dropped in transit");
    ok("createTrial() sets trialStart: now.toISOString() on the record at creation");
  }

  section("Fix: GET /billing/status includes trialStart in its response");
  {
    const statusRouteMatch = routeSrc.match(/router\.get\("\/billing\/status"[\s\S]*?\}\);/);
    assert.ok(statusRouteMatch, "could not find the GET /billing/status route handler");
    assert.ok(/trialStart:\s*record\.trialStart/.test(statusRouteMatch[0]),
      "GET /billing/status's response must include trialStart: record.trialStart");
    ok("GET /billing/status response includes trialStart: record.trialStart");
  }

  section("Regression: trialEnd and activatedAt (already-working fields) are still present, unchanged");
  {
    const statusRouteMatch = routeSrc.match(/router\.get\("\/billing\/status"[\s\S]*?\}\);/);
    assert.ok(/trialEnd:\s*record\.trialEnd/.test(statusRouteMatch[0]), "trialEnd must remain in the response");
    assert.ok(/activatedAt:\s*record\.activatedAt/.test(statusRouteMatch[0]), "activatedAt must remain in the response");
    ok("trialEnd and activatedAt remain present — fix is additive, not a replacement");
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
