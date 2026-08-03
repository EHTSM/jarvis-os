#!/usr/bin/env node
"use strict";
/**
 * Credit reservation race — regression tests.
 *
 * Confirmed race condition: creditEngine.checkCredit()/consume() are each
 * individually atomic (synchronous, no await inside — under Node's
 * single-threaded event loop no other request can interleave mid-call), but
 * backend/routes/creativeStudio.js's _createCreativeJob() checked credit,
 * then `await`ed a slow real paid-provider call (DALL-E 3 / Sora /
 * ElevenLabs), then consumed credit only after that awaited call finished.
 * That gap is a genuine TOCTOU race: N concurrent requests from the same
 * account can all pass the balance check against the same starting balance
 * before any of their slow awaits complete, letting every one of them
 * proceed to real paid provider calls even when the account can only afford
 * a fraction of them.
 *
 * Verified directly against creditEngine (simulated check→await→consume,
 * 25 concurrent "jobs" against a balance of 20 all proceeded) and against
 * the real /creative/image/generate route end-to-end.
 *
 * Fix: creditEngine.reserve() does the check-and-deduct in one synchronous
 * pass (no await inside), so it's atomic per call under the single-process
 * event loop. creativeRouter.reserveCredits() wraps it; creativeStudio.js
 * now reserves credit BEFORE starting the slow provider call instead of
 * consuming after.
 *
 * Note: creditEngine.consume() alone was never actually racy in isolation
 * (no await inside its own body) — the race only existed in call sites that
 * inserted a genuine await between an earlier check and a later consume.
 * The initial audit's report of a raw consume()-vs-consume() race did not
 * reproduce under real concurrent HTTP load (documented, not "fixed",
 * since no code change was needed there — see PRODUCTION-BLOCKER-
 * ELIMINATION.md Module 3 notes).
 *
 * Usage: node tests/security/11-credit-reservation-race.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-credit-race-secret";
delete process.env.OPENAI_API_KEY; // force the honest no-key failure path — no real network calls in a test

const express = require("express");
const { signJWT, COOKIE_NAME } = require("../../backend/middleware/authMiddleware.js");
const credits = require("../../backend/services/creditEngine.cjs");
const creativeStudioRouter = require("../../backend/routes/creativeStudio.js");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  const suffix = Date.now();

  section("creditEngine.reserve() — atomic under simulated check-then-slow-await concurrency");
  {
    const acct = `test-reserve-race-${suffix}`;
    const before = credits.getRecord(acct, "trial");
    assert(before.free.balance === 20, "trial account starts with 20 free credits", `got ${before.free.balance}`);

    async function simulatedJob(cost) {
      const reservation = credits.reserve(acct, "chat", { plan: "trial", cost });
      if (!reservation.canProceed) return false;
      await new Promise(r => setTimeout(r, 15)); // stand-in for a slow paid provider call
      return true;
    }

    const N = 25;
    const results = await Promise.all(Array.from({ length: N }, () => simulatedJob(1)));
    const proceeded = results.filter(Boolean).length;
    const after = credits.getRecord(acct, "trial");

    assert(proceeded === 20, `exactly 20 of ${N} concurrent reserve()+await calls proceed against a balance of 20 (no overspend)`, `${proceeded} proceeded`);
    assert(after.free.balance === 0, "final balance is exactly 0 (no lost updates, no negative balance)", `got ${after.free.balance}`);
  }

  section("End-to-end — real HTTP requests to /creative/image/generate cannot overspend");
  {
    const acct = `test-creative-race-${suffix}`;
    const jwt = signJWT({ sub: acct, role: "member", exp: Math.floor(Date.now() / 1000) + 3600 });
    const cookie = `${COOKIE_NAME}=${jwt}`;

    const app = express();
    app.use(express.json());
    app.use(creativeStudioRouter);
    const server = app.listen(0);
    await new Promise(r => server.on("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;

    const before = credits.getRecord(acct, "trial");
    assert(before.free.balance === 20, "trial account starts with 20 free credits", `got ${before.free.balance}`);

    // image_generate's cheapest default-routed provider (stability) costs 5
    // credits — a balance of 20 affords exactly 4 concurrent requests.
    const N = 12;
    const responses = await Promise.all(Array.from({ length: N }, () =>
      fetch(`${base}/creative/image/generate`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "a red bicycle" }),
      })
    ));
    const bodies = await Promise.all(responses.map(r => r.json().catch(() => ({}))));
    const okCount = bodies.filter(b => b.ok).length;
    const insufficientCount = responses.filter(r => r.status === 402).length;

    server.close();

    assert(okCount === 4, `exactly 4 of ${N} concurrent /creative/image/generate requests succeed (balance 20 / cost 5)`, `${okCount} succeeded`);
    assert(insufficientCount === N - 4, `the remaining ${N - 4} requests are correctly rejected as insufficient_credits`, `${insufficientCount} rejected`);
    const finalBalance = credits.getRecord(acct, "trial").free.balance;
    assert(finalBalance === 0, "final balance is exactly 0, never negative or overspent", `got ${finalBalance}`);
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
      require("path").join(process.cwd(), "data/credit-reservation-race-test-report.json"),
      JSON.stringify({ generated: new Date().toISOString(), pass, fail, failures }, null, 2)
    );
    console.log("\n  Report: data/credit-reservation-race-test-report.json\n");
  } catch { /* non-critical */ }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
