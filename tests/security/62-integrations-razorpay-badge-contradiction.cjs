#!/usr/bin/env node
"use strict";
/**
 * Integrations tab Razorpay badge contradiction — Phase A.6 (Business Owner
 * Certification, Settings section).
 *
 * CONFIRMED finding (reproduced live: real founder account, Settings →
 * Integrations): the Razorpay card showed "NOT CONNECTED" directly above
 * its own static helper text "API key configured. Update in Contacts →
 * Payment tab." — a visible self-contradiction on the same card, even
 * though real Razorpay LIVE keys (RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET) are
 * genuinely present in .env.
 *
 * Root cause: WorkspaceSettings.jsx's badge for every non-WhatsApp
 * integration read connectorStatus, which is only ever populated by a
 * GET /integrations call gated to user?.role === "operator" (a deliberate,
 * correct security fix from an earlier "Workflow Coverage Completion"
 * pass — regular founder accounts get role "user", not "operator", and
 * GET /integrations is intentionally operatorOnly server-side since it
 * also exposes reconnect controls for the founder's own shared platform
 * credentials). The result: for every real founder account, connectorStatus
 * stays {} forever, so the Razorpay badge always fell back to "Not
 * connected" regardless of actual .env state.
 *
 * Fix: reuse settingsStatus.razorpay.configured — sourced from
 * GET /settings/status, which is requireAuth-only (not operator-gated) and
 * already does a real env-presence check for Razorpay, the same
 * non-operator-safe pattern WhatsApp's badge already used. This does NOT
 * loosen the deliberate operatorOnly gate on GET /integrations — it just
 * stops a founder-facing badge from depending on a call the frontend was
 * never authorized to make, in favor of a source that was already being
 * fetched into state and genuinely reflects .env credential presence for
 * any account.
 *
 * This directly violates this pass's explicit rule: never hide or
 * misrepresent real credential state — showing "Not connected" beside
 * "API key configured" is exactly the kind of contradiction a founder
 * should never see.
 *
 * Verified live: after the fix, the Razorpay card shows "CONNECTED" with a
 * "Manage" button, matching the real .env state.
 *
 * Usage: node tests/security/62-integrations-razorpay-badge-contradiction.cjs
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
  const feSrc = fs.readFileSync(require.resolve("../../frontend/src/components/WorkspaceSettings.jsx"), "utf8");
  const routeSrc = fs.readFileSync(require.resolve("../../backend/routes/settings.js"), "utf8");

  section("GET /settings/status already reports real Razorpay credential presence, non-operator-gated");
  {
    const routeMatch = routeSrc.match(/router\.get\("\/settings\/status", requireAuth,[\s\S]*?\n\}\);/);
    assert.ok(routeMatch, "could not find GET /settings/status route handler");
    assert.ok(!/operatorOnly/.test(routeMatch[0]), "GET /settings/status must stay requireAuth-only, not operator-gated");
    assert.ok(/razorpay:\s*\{[\s\S]*?configured:\s*!!\(/.test(routeMatch[0]),
      "GET /settings/status must report a real razorpay.configured env-presence check");
    ok("GET /settings/status reports razorpay.configured for any authenticated account");
  }

  section("WorkspaceSettings.jsx's Razorpay badge uses settingsStatus.razorpay.configured, not just the operator-gated connectorStatus");
  {
    const liveMatch = feSrc.match(/const liveConnected = integ\.id === "whatsapp"[\s\S]*?: connectorStatus\[integ\.connectorId\]\?\.status === "CONNECTED";/);
    assert.ok(liveMatch, "could not find the liveConnected badge computation in WorkspaceSettings.jsx");
    assert.ok(/integ\.id === "razorpay"/.test(liveMatch[0]),
      "liveConnected must special-case razorpay instead of falling straight to connectorStatus");
    assert.ok(/settingsStatus\?\.razorpay\?\.configured/.test(liveMatch[0]),
      "razorpay's liveConnected must read settingsStatus.razorpay.configured (the non-operator-safe real check)");
    ok("Razorpay's badge is derived from a real, non-operator-gated credential check");
  }

  section("The operatorOnly gate on GET /integrations itself was left untouched (deliberate, correct security fix)");
  {
    const backendRouteSrc = fs.readFileSync(require.resolve("../../backend/routes/integrations.js"), "utf8");
    assert.ok(/router\.use\("\/integrations", requireAuth, operatorOnly\)/.test(backendRouteSrc),
      "GET /integrations must remain operatorOnly — this fix must not loosen that prior security gate");
    ok("GET /integrations's operatorOnly gate is unchanged");
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
