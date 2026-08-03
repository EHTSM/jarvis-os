#!/usr/bin/env node
"use strict";
/**
 * Org budget burst-overshoot — regression tests.
 *
 * Confirmed race (lower severity, bounded cost overshoot not corruption):
 * orgBudgets.checkBudget() derives spend by re-aggregating usageMetering's
 * ledger, which is only written to AFTER aiOrchestrator.execute()'s real
 * provider call completes (checkBudget() -> await aiService.chat(...) ->
 * usageMetering.record()). N concurrent requests for the same org could
 * each see the same ledger snapshot and all pass the check before any of
 * their spend landed — verified: 30 concurrent requests against a $0.01 cap
 * ($0.002/request, ~5 should be allowed) all proceeded, spending $0.06
 * (6x over cap).
 *
 * Fix: orgBudgets.reserveInFlight()/releaseInFlight() track a process-local
 * in-memory total of estimated (not-yet-recorded) spend per org/workspace.
 * checkBudget() adds this to the ledger total. aiOrchestrator.execute()/
 * executeStream() now reserve a conservative worst-case cost estimate
 * before the slow provider call and release it once real cost is recorded
 * (success) or the call fails (no real cost incurred). reserveInFlight/
 * releaseInFlight are synchronous Map operations (no I/O), so — same
 * reasoning as creditEngine.reserve() in Module 3 — they're atomic per call
 * under Node's single-threaded event loop.
 *
 * Usage: node tests/security/14-orgbudgets-inflight-reservation.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const orgBudgets = require("../../backend/services/orgBudgets.cjs");
const usageMetering = require("../../backend/services/usageMetering.cjs");
const aiOrchestrator = require("../../backend/services/aiOrchestrator.cjs");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  const suffix = Date.now();

  section("reserveInFlight()/releaseInFlight() close the check-then-await-then-record race");
  {
    const orgId = `test-orgbudget-race-${suffix}`;
    const COST_PER_CALL = 0.002;
    orgBudgets.setOrgBudget(orgId, { monthlyCapUsd: 0.01 });

    async function simulatedCall() {
      const check = orgBudgets.checkBudget({ orgId });
      if (!check.allowed) return false;
      orgBudgets.reserveInFlight({ orgId, estimatedUsd: COST_PER_CALL });
      await new Promise(r => setTimeout(r, 10)); // stand-in for a slow provider call
      usageMetering.record({ orgId, provider: "claude", estimatedCostUsd: COST_PER_CALL, inputTokens: 100, outputTokens: 100, success: true });
      orgBudgets.releaseInFlight({ orgId, estimatedUsd: COST_PER_CALL });
      return true;
    }

    const N = 30;
    const results = await Promise.all(Array.from({ length: N }, () => simulatedCall()));
    const proceeded = results.filter(Boolean).length;
    const final = orgBudgets.checkBudget({ orgId });

    assert(proceeded === 5, `exactly 5 of ${N} concurrent calls proceed against a $0.01 cap at $${COST_PER_CALL}/call (no overshoot)`, `${proceeded} proceeded`);
    assert(Math.abs(final.org.spentUsd - 0.01) < 1e-9, "final spend lands exactly at the cap, not beyond it", `got $${final.org.spentUsd}`);
  }

  section("aiOrchestrator.execute() wiring — reserves before and releases after the provider call");
  {
    const orgId = `test-orgbudget-wiring-${suffix}`;
    orgBudgets.setOrgBudget(orgId, { monthlyCapUsd: 1 });

    const calls = [];
    const originalReserve = orgBudgets.reserveInFlight;
    const originalRelease = orgBudgets.releaseInFlight;
    orgBudgets.reserveInFlight = (...args) => { calls.push({ fn: "reserve", args }); return originalReserve(...args); };
    orgBudgets.releaseInFlight = (...args) => { calls.push({ fn: "release", args }); return originalRelease(...args); };

    try {
      await aiOrchestrator.execute([{ role: "user", content: "hi" }], { orgId });
    } catch { /* expected in a test env with no real provider API keys — we only care about the reserve/release calls */ }

    orgBudgets.reserveInFlight = originalReserve;
    orgBudgets.releaseInFlight = originalRelease;

    const reserved = calls.some(c => c.fn === "reserve" && c.args[0].orgId === orgId);
    const released = calls.some(c => c.fn === "release" && c.args[0].orgId === orgId);
    assert(reserved, "execute() calls reserveInFlight() before the provider call", "reserveInFlight was never called");
    assert(released, "execute() calls releaseInFlight() after the provider call resolves or fails", "releaseInFlight was never called");
  }

  section("Regression — budgets with no cap set are unaffected");
  {
    const orgId = `test-orgbudget-nocap-${suffix}`;
    // No setOrgBudget call — monthlyCapUsd defaults to null (unlimited).
    const check = orgBudgets.checkBudget({ orgId });
    assert(check.allowed === true, "an org with no configured budget cap is allowed", JSON.stringify(check));
    orgBudgets.reserveInFlight({ orgId, estimatedUsd: 100 }); // huge reservation
    const check2 = orgBudgets.checkBudget({ orgId });
    assert(check2.allowed === true, "a large in-flight reservation does not block an org with no cap configured", JSON.stringify(check2));
    orgBudgets.releaseInFlight({ orgId, estimatedUsd: 100 });
  }

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    ✗ ${f.msg}: ${f.reason}`));
  }

  try {
    require("fs").writeFileSync(
      require("path").join(process.cwd(), "data/orgbudgets-inflight-reservation-test-report.json"),
      JSON.stringify({ generated: new Date().toISOString(), pass, fail, failures }, null, 2)
    );
    console.log("\n  Report: data/orgbudgets-inflight-reservation-test-report.json\n");
  } catch { /* non-critical */ }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
