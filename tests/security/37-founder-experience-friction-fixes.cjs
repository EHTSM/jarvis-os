#!/usr/bin/env node
"use strict";
/**
 * Founder Experience Certification — 4 friction fixes, regression suite.
 *
 * CONFIRMED findings, all discovered by directly operating the product as
 * a real first-time founder (Rule #1 — no code read until each failure was
 * reproduced through the real UI first).
 *
 * 1. frontend/public/index.html — Microsoft Clarity analytics snippet
 *    shipped with a literal placeholder project ID ("CLARITY-XXXXXXXXX"),
 *    firing a 400 to clarity.ms on every single page load for every real
 *    user. GTM/GA4 in the same file both use real-looking IDs; only
 *    Clarity was never actually configured. Removed entirely (no real
 *    project ID exists to restore, and this isn't referenced as a planned
 *    integration anywhere in docs/).
 *
 * 2. frontend/src/App.jsx — the app shell's health-poll useEffect called
 *    getStats()/getOpsData() (→ /stats, /ops) unconditionally every 8
 *    seconds for the ENTIRE app-screen session, regardless of the signed-
 *    in user's role. Both routes are operatorOnly server-side
 *    (backend/routes/ops.js:74, "a regular customer must never reach
 *    these" — deliberate, previously-hardened gating). Every non-operator
 *    founder account (the product's primary audience) generated a 403 on
 *    both endpoints every 8s for their whole session — silently swallowed
 *    by try/catch, so nothing visibly broke, but real, constant, avoidable
 *    console noise and wasted requests. Fixed by adding the same
 *    `user?.role === "operator"` gate already used elsewhere in the same
 *    file (e.g. the "home" tab's CommandCenter/CustomerDashboard branch).
 *
 * 3. frontend/src/App.jsx — DevOpsCenterV2 (the "DevOps" tab, plainly
 *    reachable via the More menu by any signed-in account) was mounted
 *    with zero role gate, unlike its sibling "integrations" tab in the
 *    same conditional block. It unconditionally polls /ops, /metrics, and
 *    every /computer/docker/* route — all operatorOnly — so any founder
 *    clicking into DevOps fired a burst of silently-swallowed 403s. Same
 *    bug class as #2, found via a targeted variant sweep. Fixed by gating
 *    the mount with user?.role === "operator" and showing a plain,
 *    honest "DevOps is available to organization operators." message
 *    otherwise (matching the "integrations" tab's own
 *    operator/non-operator branch pattern — no new component invented).
 *
 * 4. MOST SEVERE — frontend/src/components/OrgSwitcher.jsx (+ AuthContext
 *    wiring): a real, fully-working logout() function has existed in
 *    AuthContext.jsx the whole time, but ZERO components in the entire
 *    frontend called it. The only pre-existing call site was a "Sign out"
 *    button buried inside a session-expiry warning banner that only
 *    renders in the last 5 minutes of an 8-hour session
 *    (App.jsx's RuntimeTab component). A founder had NO discoverable way
 *    to log out of their own account through the UI — confirmed by
 *    exhaustively checking every top-bar control, the Settings page's
 *    module list, and the Cmd+K command palette ("No commands found for
 *    logout") before reaching this conclusion. This directly failed the
 *    mission's explicit success condition (Logout → Login again must
 *    work). Fixed by adding a "Sign out" action to OrgSwitcher's dropdown
 *    (already showing account-level context — org name, role — the most
 *    standard, discoverable placement for this control).
 *
 * This test drives the REAL app through a REAL browser (Playwright,
 * chromium) against the REAL running dev servers — a real signup, real
 * navigation, real logout — not mocks.
 *
 * Requires: backend running on :5050 and frontend dev server on :3000.
 *
 * Usage: node tests/security/37-founder-experience-friction-fixes.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const { chromium } = require("playwright");
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

// Same hardening as tests/security/35-more-menu-overflow-clipping.cjs's
// dismissOnboarding: this product stacks multiple independently-built
// onboarding overlays (WelcomeFlow, GuidedTour, CustomerFirstRunWizard —
// see that test's own comment for the full history), and a backdrop can
// report visible=false via isVisible() a beat before it actually finishes
// unmounting, still intercepting a real click. Checking for a lingering
// backdrop element (not just button visibility) before declaring done
// avoids flaky "intercepts pointer events" failures on the next real
// click this test makes (e.g. the org-switcher trigger).
const DISMISS_LABELS = ["Skip for now", "Skip setup", "Skip tour", "Skip", "Got it", "Close", "Maybe later"];
const BACKDROP_SELECTORS = [".wf-overlay", ".gt-overlay", ".cfr-backdrop"];
async function dismissOnboarding(page, maxRounds = 8) {
  for (let round = 0; round < maxRounds; round++) {
    let dismissedSomething = false;
    for (const label of DISMISS_LABELS) {
      const btn = page.getByText(label, { exact: true }).first();
      if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(600);
        dismissedSomething = true;
      }
    }
    const anyBackdropLeft = await page.evaluate((sels) => sels.some(s => document.querySelector(s)), BACKDROP_SELECTORS).catch(() => false);
    if (!dismissedSomething && !anyBackdropLeft) break;
    if (anyBackdropLeft) await page.waitForTimeout(400);
  }
}

async function main() {
  section("Precondition — real frontend (:3000) and backend (:5050) dev servers reachable");
  const serversUp = await checkServersUp();
  if (!serversUp) {
    console.log("  ⚠  Frontend/backend dev servers not reachable on :3000/:5050.");
    console.log("     This is a full-stack UI regression test — run `npm run dev` first.");
    console.log("     Skipping (not counted as pass or fail) rather than falsely failing CI.");
    process.exit(0);
  }
  ok("frontend and backend dev servers are reachable");

  section("Fix 1 — Microsoft Clarity placeholder snippet is gone from source");
  {
    const html = fs.readFileSync(path.join(__dirname, "../../frontend/public/index.html"), "utf8");
    assert(!html.toLowerCase().includes("clarity"), "frontend/public/index.html no longer references Microsoft Clarity", "the broken CLARITY-XXXXXXXXX snippet is still present");
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const badRequests = [];
  page.on("response", res => {
    if (res.status() >= 400) badRequests.push(`${res.status()} ${res.url()}`);
  });

  section("Real signup, matching a first-time founder's actual path");
  const uniqueEmail = `founder-regression-${Date.now()}@ooplix-test.local`;
  const password = "FounderRegression12345!";
  await page.goto("http://localhost:3000/?desktop=1", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.locator('input[type="text"]').first().fill("Founder Regression");
  await page.locator('input[type="email"]').first().fill(uniqueEmail);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button:has-text("Start free trial")').click();
  await page.waitForTimeout(4000);
  const registered = !(await page.locator("text=Internal server error").isVisible().catch(() => false));
  assert(registered, "signup succeeds through the real web UI", "signup failed — cannot proceed with the rest of this regression");
  if (!registered) { await browser.close(); console.log(`\nPass: ${pass} Fail: ${fail}`); process.exit(1); }

  await dismissOnboarding(page);

  section("Fix 1 (live) — no failed request to clarity.ms during a real session");
  {
    const clarityFailures = badRequests.filter(r => r.includes("clarity.ms"));
    assert(clarityFailures.length === 0, "zero failed requests to clarity.ms during signup + dashboard load", `found: ${JSON.stringify(clarityFailures)}`);
  }

  section("Fix 2 — non-operator account does not poll operator-only /stats or /ops");
  {
    badRequests.length = 0; // reset — only count requests from here on
    await page.waitForTimeout(9000); // one full 8s poll interval
    const relevant = badRequests.filter(r => /\/(stats|ops)(\?|$)/.test(r.split(" ")[1] || ""));
    assert(relevant.length === 0, "no 403s to /stats or /ops during an 8s+ idle period on the dashboard as a non-operator", `found: ${JSON.stringify(relevant)}`);
  }

  section("Fix 3 — DevOps tab shows an honest operator-required message instead of firing 403s");
  {
    badRequests.length = 0;
    const moreBtn = page.locator("text=/More \\(\\d+\\)/");
    if (await moreBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await moreBtn.click();
      await page.waitForTimeout(600);
      const devopsItem = page.locator("text=DevOps").first();
      if (await devopsItem.isVisible({ timeout: 3000 }).catch(() => false)) {
        await devopsItem.click();
        await page.waitForTimeout(1500);
        const pageText = await page.evaluate(() => document.body.innerText);
        assert(pageText.includes("available to organization operators"), "DevOps tab shows the honest operator-required message for a non-operator", "expected message not found — DevOpsCenterV2 may be mounting unguarded again");
        const dockerFailures = badRequests.filter(r => /\/(ops|metrics|computer\/docker)/.test(r));
        assert(dockerFailures.length === 0, "no 403s fired while viewing the DevOps tab as a non-operator", `found: ${JSON.stringify(dockerFailures)}`);
      } else {
        ko("DevOps item reachable via More menu", "item not found — nav structure may have changed");
      }
    } else {
      ko("More menu trigger reachable", "trigger not found");
    }
  }

  section("Fix 4 (MOST SEVERE) — a founder can actually log out through the UI");
  {
    const orgTrigger = page.locator(".org-switcher-trigger").first();
    const triggerVisible = await orgTrigger.isVisible({ timeout: 3000 }).catch(() => false);
    assert(triggerVisible, "the org switcher trigger (where Sign out now lives) is reachable", "trigger not found — nav structure may have changed");
    if (triggerVisible) {
      await orgTrigger.click();
      await page.waitForTimeout(500);
      const signOutBtn = page.locator("text=Sign out").first();
      const signOutVisible = await signOutBtn.isVisible({ timeout: 2000 }).catch(() => false);
      assert(signOutVisible, "a 'Sign out' control is visible and discoverable in the org switcher dropdown", "Sign out button not found — the fix may have regressed");
      if (signOutVisible) {
        await signOutBtn.click();
        await page.waitForTimeout(2000);
        const loggedOutText = await page.evaluate(() => document.body.innerText);
        const backAtSignup = loggedOutText.includes("Create your account") || loggedOutText.includes("Start free trial");
        assert(backAtSignup, "clicking Sign out actually logs the founder out (returns to the signup/landing page)", "did not return to signup page — logout may not be working end-to-end");

        section("Fix 4 continued — the same account can log back in after signing out");
        const signInLink = page.locator("text=Sign in").first();
        if (await signInLink.isVisible({ timeout: 3000 }).catch(() => false)) {
          await signInLink.click();
          await page.waitForTimeout(1000);
          await page.locator('input[type="email"]').first().fill(uniqueEmail);
          await page.locator('input[type="password"]').first().fill(password);
          await page.locator('button:has-text("Sign in"), button[type="submit"]').last().click();
          await page.waitForTimeout(3000);
          const backInText = await page.evaluate(() => document.body.innerText);
          const loggedBackIn = backInText.includes("Dashboard") || backInText.includes("Welcome");
          assert(loggedBackIn, "the same founder can log back in with the same credentials after signing out", "re-login did not reach the dashboard");
        } else {
          ko("'Sign in' link reachable after logout", "link not found on the post-logout landing page");
        }
      }
    }
  }

  await browser.close();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Founder Experience Friction Fixes Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
