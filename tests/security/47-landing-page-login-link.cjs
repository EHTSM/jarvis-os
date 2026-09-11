#!/usr/bin/env node
"use strict";
/**
 * Landing page missing Login link regression —
 * frontend/src/components/LandingPage.jsx's Nav component.
 *
 * CONFIRMED finding (Founder Journey Final Polish, Phase A.4.3): a
 * RETURNING founder had NO way to log in from the public marketing site at
 * all. The only entry point in Nav/Hero/CTASection was "Start free trial",
 * which always routes into onboarding — never into the real login screen.
 * Even navigating directly to /login in the browser fell through to
 * onboarding instead of a login form, because the SPA's client-side
 * routing has no route for that path (screen state is driven entirely by
 * localStorage + in-memory `screen`, not the URL). This is more severe
 * than the sibling Pricing-link gap (test 46): a founder's SECOND visit to
 * the product had no path back to their own account without already
 * knowing internal implementation details.
 *
 * Root cause: identical bug class to test 46, same file, same component.
 * App.jsx already builds a complete, working login system —
 * `handleLogin()` (App.jsx ~line 909) sets `screen = "login"`, which
 * renders a real login screen (Email/Google/Phone auth, "Forgot
 * password?" leading to a real, working ForgotPassword/reset-link flow,
 * "No account? Create one free" for the reverse direction) — and passes
 * `onLogin={handleLogin}` all the way down into `<LandingPage
 * onLogin={...} />`. But LandingPage's own `handleAccess = () => (onStart
 * ?? onLogin)?.()` always resolves to onStart (always provided by
 * App.jsx), so onLogin was reachable only as an unused fallback — dead
 * code from the landing page's perspective. No visible "Log in" trigger
 * existed anywhere.
 *
 * Fix: `Nav` now accepts `onLogin` and renders a real "Log in" link next
 * to the "Start free trial" CTA (wrapped in a new `.lp-nav-actions` flex
 * container so both sit together in the nav's existing 3-column layout),
 * calling the already-existing, already-wired `onLogin` callback straight
 * from LandingPage's own props — no new auth screen, no new routing logic,
 * no redesign. The entire login+forgot-password system already existed
 * end-to-end; only the last-mile wiring on the landing page was missing.
 *
 * This test is a static check against the real source (Nav no longer
 * drops onLogin) plus a live Playwright run against the real public
 * landing page proving a real, clickable "Log in" link exists, navigates
 * to the real login screen, and its "Forgot password?" link leads to a
 * real, working password-reset flow.
 *
 * Usage: node tests/security/47-landing-page-login-link.cjs
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
  section("Static — real LandingPage.jsx source no longer drops the onLogin prop");
  const src = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/LandingPage.jsx"), "utf8");

  const navSigMatch = src.match(/function Nav\(\{([^}]+)\}\)/);
  assert(!!navSigMatch, "Nav's function signature was found in the real source", "could not locate 'function Nav({...})' — component may have been restructured");
  if (navSigMatch) {
    assert(navSigMatch[1].includes("onLogin"), "Nav's signature now destructures onLogin", `signature is: ({${navSigMatch[1]}})`);
  }

  assert(/className="lp-nav-link lp-nav-login" onClick=\{onLogin\}>Log in</.test(src), "a real 'Log in' link wired to the onLogin callback exists in the source", "no Log in link found calling onLogin");
  assert(/<Nav onAccess=\{handleAccess\} onPricing=\{onPricing\} onLogin=\{onLogin\} \/>/.test(src), "LandingPage's root now forwards its own onLogin prop into Nav", "Nav invocation does not forward onLogin");

  section("Precondition — real frontend (:3000) and backend (:5050) dev servers reachable");
  const serversUp = await checkServersUp();
  if (!serversUp) {
    console.log("  ⚠  Frontend/backend dev servers not reachable on :3000/:5050.");
    console.log("     Skipping the live end-to-end portion (not counted as pass or fail).");
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Landing Page Login Link Regression: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
  ok("frontend and backend dev servers are reachable");

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  section("Live — the real public landing page has a real, clickable Log in link");
  await page.goto("http://localhost:3000/", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2000);

  const loginBtn = page.locator(".lp-nav-login", { hasText: "Log in" });
  const loginVisible = await loginBtn.isVisible({ timeout: 3000 }).catch(() => false);
  assert(loginVisible, "a real 'Log in' link is visible and reachable pre-signup on the public landing page", "Log in link not visible");

  if (loginVisible) {
    await loginBtn.click();
    await page.waitForTimeout(1500);
    const loginText = await page.evaluate(() => document.body.innerText);
    assert(loginText.includes("Welcome back") || loginText.includes("Sign in"), "clicking Log in navigates to the real login screen", "expected login screen content not found after clicking");
    assert(loginText.includes("Email") && loginText.includes("Password"), "the real login form (email + password fields) renders", "login form fields not found");
    assert(/Google|Phone/.test(loginText), "alternate real auth methods (Google/Phone) are offered, not just email", "no alternate auth method found");

    section("Live — the reverse path (no account -> create one) is offered on the login screen");
    // Checked BEFORE following the Forgot Password link below, since that
    // link navigates away from the login screen — "create one free" is
    // login-screen-only content.
    const createOneLink = page.locator("text=/create one free/i").first();
    const createOneVisible = await createOneLink.isVisible({ timeout: 3000 }).catch(() => false);
    assert(createOneVisible, "a real 'No account? Create one free' escape hatch exists on the login screen", "no reverse-direction signup link found on login screen");

    section("Live — the login screen's Forgot Password link leads to a real reset flow");
    const forgotLink = page.locator("text=/forgot password/i").first();
    const forgotVisible = await forgotLink.isVisible({ timeout: 3000 }).catch(() => false);
    assert(forgotVisible, "a real 'Forgot password?' link exists on the login screen", "no Forgot password link found");
    if (forgotVisible) {
      await forgotLink.click();
      await page.waitForTimeout(1500);
      const forgotText = await page.evaluate(() => document.body.innerText);
      assert(forgotText.includes("Reset your password") || forgotText.includes("reset link"), "clicking Forgot password leads to a real password-reset screen", "expected reset-password content not found");
    }
  }

  await browser.close();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Landing Page Login Link Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
