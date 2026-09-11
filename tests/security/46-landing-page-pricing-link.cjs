#!/usr/bin/env node
"use strict";
/**
 * Landing page missing Pricing link regression —
 * frontend/src/components/LandingPage.jsx's Nav component.
 *
 * CONFIRMED finding (Founder Journey Final Polish, Phase A.4.3): the real
 * public landing page's top nav was "Features / How it works / Compare /
 * Start free trial" — no Pricing link anywhere, despite pricing being one
 * of the mission's explicitly required decision points to verify pre-
 * signup. A founder deciding whether to trial the product had no way to
 * see pricing without creating an account first.
 *
 * Root cause: NOT a missing feature. App.jsx already builds a full,
 * production-grade PricingPage (3 real tiers — Starter ₹999/mo, Growth
 * ₹2,499/mo "Most Popular", Scale custom — real limits, an FAQ, Razorpay/
 * GST/company-legal-name trust signals) and wires
 * `onPricing={() => setScreen("pricing")}` all the way down into
 * `<LandingPage onPricing={...} />`. But LandingPage's own `Nav` child
 * component destructured only `{ onAccess }` — the onPricing prop was
 * silently dropped one level down, so nothing ever rendered a trigger for
 * it. A single earlier `text=/pricing/i` Playwright probe against the live
 * page even appeared to find a "pricing" match — but that was a false
 * positive: it matched unrelated static copy inside the hero's mock
 * terminal demo ("Hot lead detected: ... opened pricing page"), not a real
 * link, and clicking it was a no-op.
 *
 * Fix: `Nav` now accepts `onPricing` and renders a "Pricing" button in the
 * same nav-link list as Features/How it works/Compare, calling the
 * already-existing, already-wired `onPricing` callback. No new component,
 * no new routing, no redesign — the entire capability already existed;
 * only the last-mile wiring was missing.
 *
 * This test is a static check against the real source (Nav no longer drops
 * onPricing) plus a live Playwright run against the real public landing
 * page proving a real, clickable "Pricing" nav link exists, navigates to
 * the real PricingPage content, and its own Back button returns to the
 * real landing page.
 *
 * Usage: node tests/security/46-landing-page-pricing-link.cjs
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
  section("Static — real LandingPage.jsx source no longer drops the onPricing prop");
  const src = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/LandingPage.jsx"), "utf8");

  const navSigMatch = src.match(/function Nav\(\{([^}]+)\}\)/);
  assert(!!navSigMatch, "Nav's function signature was found in the real source", "could not locate 'function Nav({...})' — component may have been restructured");
  if (navSigMatch) {
    assert(navSigMatch[1].includes("onPricing"), "Nav's signature now destructures onPricing (previously only destructured onAccess)", `signature is: ({${navSigMatch[1]}})`);
  }

  assert(/<button className="lp-nav-link" onClick=\{onPricing\}>Pricing<\/button>/.test(src), "a real 'Pricing' nav-link button wired to the onPricing callback exists in the source", "no Pricing button found calling onPricing");

  section("Precondition — real frontend (:3000) and backend (:5050) dev servers reachable");
  const serversUp = await checkServersUp();
  if (!serversUp) {
    console.log("  ⚠  Frontend/backend dev servers not reachable on :3000/:5050.");
    console.log("     Skipping the live end-to-end portion (not counted as pass or fail).");
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Landing Page Pricing Link Regression: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
  ok("frontend and backend dev servers are reachable");

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  section("Live — the real public landing page has a real, clickable Pricing link");
  await page.goto("http://localhost:3000/", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2000);

  const navLinks = await page.evaluate(() => Array.from(document.querySelectorAll(".lp-nav-link")).map(el => el.textContent));
  assert(navLinks.includes("Pricing"), "the real landing page's nav bar includes a 'Pricing' link", `nav links found: ${JSON.stringify(navLinks)}`);

  const pricingBtn = page.locator(".lp-nav-link", { hasText: "Pricing" });
  const pricingVisible = await pricingBtn.isVisible({ timeout: 3000 }).catch(() => false);
  assert(pricingVisible, "the Pricing nav link is visible and reachable pre-signup", "Pricing link not visible");

  if (pricingVisible) {
    await pricingBtn.click();
    await page.waitForTimeout(1500);
    const pricingText = await page.evaluate(() => document.body.innerText);
    assert(pricingText.includes("Simple, honest pricing") || pricingText.includes("Starter"), "clicking Pricing navigates to the real PricingPage with real tier content", "expected pricing content not found after clicking");
    assert(pricingText.includes("₹") && pricingText.includes("/month"), "real INR pricing (not placeholder text) is shown", "no real price found on the pricing page");
    assert(pricingText.includes("Start Free Trial") || pricingText.includes("Start free trial"), "a real trial CTA exists on the pricing page", "no trial CTA found on pricing page");

    section("Live — the pricing page's Back button returns to the real landing page");
    const backBtn = page.locator("text=Back").first();
    const backVisible = await backBtn.isVisible({ timeout: 3000 }).catch(() => false);
    assert(backVisible, "a Back control exists on the pricing page", "no Back control found");
    if (backVisible) {
      await backBtn.click();
      await page.waitForTimeout(1500);
      const afterBackText = await page.evaluate(() => document.body.innerText);
      assert(afterBackText.includes("AI OPERATING SYSTEM"), "clicking Back returns to the real landing page", "did not land back on the real landing page");
    }
  }

  await browser.close();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Landing Page Pricing Link Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
