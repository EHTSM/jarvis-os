#!/usr/bin/env node
"use strict";
/**
 * Landing page product-positioning mismatch + desktop dual-onboarding
 * regression — frontend/src/components/LandingPage.jsx, frontend/src/App.jsx.
 *
 * CONFIRMED findings (Founder Journey Certification — Phase A.4):
 *
 * 1. PRODUCTION BLOCKER — the real public marketing landing page (what any
 *    first-time visitor at localhost:3000 with no query params sees,
 *    BEFORE ever reaching signup) was entirely themed around a different
 *    product: "Autonomous Engineering Runtime" — infrastructure
 *    monitoring/auto-remediation with a waitlist model ("Request access",
 *    "Get early access"). The actual product, confirmed everywhere else
 *    in this codebase (README, meta description, every authenticated
 *    screen) is a business/CRM/marketing AI Operating System with an open
 *    7-day free trial. Every content constant in the file (hero headline,
 *    capability grid, mission-feed demo rows, before/after comparison,
 *    CTA copy) was infra-themed — 17 infra references vs. 2 business
 *    references. The CTA buttons DID correctly route to the real signup
 *    flow (functionally not broken), but the messaging would seriously
 *    mislead a real founder's first impression before they ever create an
 *    account. Fixed by replacing every mismatched string with terminology
 *    already established elsewhere in the codebase (README's Business
 *    OS/Growth OS feature copy, the real meta description) — no new
 *    marketing copy invented, no layout/visual/animation changes.
 *
 * 2. Desktop shell (?desktop=1) could show TWO separate onboarding
 *    wizards for the same brand-new signup: WelcomeFlow.jsx (desktop-
 *    specific, gated on _IS_DESKTOP) and CustomerFirstRunWizard.jsx
 *    (regular customer wizard, had no desktop exclusion at all).
 *    Reproduced directly: both wizards' "Welcome to Ooplix" cards raced
 *    to mount, one's backdrop blocking clicks meant for the other's
 *    button. Fixed by excluding CustomerFirstRunWizard on desktop,
 *    matching the exact !_IS_DESKTOP precedent already used one screen
 *    below it for showFirstLaunchHint.
 *
 * Usage: node tests/security/42-landing-page-and-onboarding-consistency.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function read(rel) { return fs.readFileSync(path.join(__dirname, "../..", rel), "utf8"); }

async function checkServersUp() {
  try {
    const [feRes, beRes] = await Promise.all([
      fetch("http://localhost:3000").catch(() => null),
      fetch("http://localhost:5050/health").catch(() => null),
    ]);
    return !!feRes && !!beRes && beRes.ok;
  } catch { return false; }
}

async function main() {
  section("Static — LandingPage.jsx no longer contains the mismatched product positioning");
  const lp = read("frontend/src/components/LandingPage.jsx");
  const mismatchTerms = ["infrastructure", "Request access", "early access", "on-call", "P99"];
  for (const term of mismatchTerms) {
    assert(!new RegExp(term, "i").test(lp), `LandingPage.jsx no longer contains "${term}"`, `"${term}" is still present — the mismatch may have regressed`);
  }
  assert(/"Your",\s*"business"/.test(lp) && /"runs",\s*"itself\."/.test(lp), "the hero headline word-arrays now say 'Your business... runs itself' (matches the real product)", "expected corrected HERO_WORDS_LINE1/LINE2 arrays not found");
  assert(/Start free trial/.test(lp), "CTA buttons now say 'Start free trial' (matches the real signup flow)", "expected corrected CTA label not found");
  assert(/Business OS/.test(lp) && /Growth OS/.test(lp), "the capability grid now references the real Business OS / Growth OS product areas", "expected real product area names not found");

  section("Static — App.jsx excludes CustomerFirstRunWizard on the desktop shell");
  const appJsx = read("frontend/src/App.jsx");
  assert(/!_IS_DESKTOP && !firstRunDismissed && shouldShowCustomerFirstRun/.test(appJsx), "showCustomerFirstRun now excludes the desktop shell", "the !_IS_DESKTOP exclusion is missing — the dual-onboarding race may have regressed");

  section("Precondition — real frontend (:3000) and backend (:5050) dev servers reachable");
  const serversUp = await checkServersUp();
  if (!serversUp) {
    console.log("  ⚠  Frontend/backend dev servers not reachable on :3000/:5050.");
    console.log("     Skipping the live end-to-end portion (not counted as pass or fail).");
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Landing Page & Onboarding Consistency Regression: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
  ok("frontend and backend dev servers are reachable");

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });

  section("Live — the real public landing page (no query params) shows the real product");
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    // The hero headline is built from separate per-word <motion.span>
    // elements (word-stagger animation) — innerText inserts a non-breaking
    // space (U+00A0) at those boundaries rather than a regular space, so
    // normalize whitespace before matching.
    const text = (await page.evaluate(() => document.body.innerText)).replace(/[ \s]+/g, " ");
    assert(text.includes("Your business") && text.includes("runs itself"), "the live landing page's hero says 'Your business... runs itself'", "expected headline not found in the live page");
    assert(!text.toLowerCase().includes("infrastructure"), "the live landing page contains zero mentions of 'infrastructure'", "the word 'infrastructure' is still present on the live page");
    assert(text.includes("Start free trial") && !text.includes("Request access"), "the live landing page's CTA says 'Start free trial', not 'Request access'", "CTA label mismatch still present");
    await context.close();
  }

  section("Live — desktop shell shows only ONE onboarding wizard, not two racing");
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const uniqueEmail = `onboarding-race-regression-${Date.now()}@ooplix-test.local`;
    await page.goto("http://localhost:3000/?desktop=1", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.locator('input[type="text"]').first().fill("Onboarding Race Regression");
    await page.locator('input[type="email"]').first().fill(uniqueEmail);
    await page.locator('input[type="password"]').first().fill("OnboardingRace12345!");
    await page.locator('button:has-text("Start free trial")').click();
    await page.waitForFunction(
      () => document.body.innerText.includes("Welcome to Ooplix") || document.body.innerText.includes("Dashboard"),
      { timeout: 25000 }
    ).catch(() => {});
    await page.waitForTimeout(1000);

    const cfrPresent = await page.evaluate(() => !!document.querySelector(".cfr-backdrop")).catch(() => false);
    assert(!cfrPresent, "CustomerFirstRunWizard (.cfr-backdrop) does not appear on the desktop shell", "the second wizard is still mounting on desktop — the race condition may have regressed");

    const wfPresent = await page.evaluate(() => !!document.querySelector(".wf-overlay")).catch(() => false);
    console.log(`  ℹ  WelcomeFlow (.wf-overlay) present: ${wfPresent} (expected — this is the correct desktop-specific wizard)`);
    await context.close();
  }

  await browser.close();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Landing Page & Onboarding Consistency Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
