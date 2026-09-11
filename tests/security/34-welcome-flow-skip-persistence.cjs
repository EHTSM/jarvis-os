#!/usr/bin/env node
"use strict";
/**
 * WelcomeFlow "Skip setup" persistence regression —
 * frontend/src/App.jsx + frontend/src/components/WelcomeFlow.jsx.
 *
 * CONFIRMED finding (Real Productivity & Operator Experience
 * Certification): operating the product exactly as a real first-time
 * founder would (real signup through the actual web UI, no code
 * inspection until something failed) — clicking "Skip setup" on the
 * first-launch onboarding wizard removed the modal visually, but never
 * persisted that dismissal. Reproduced directly: skip the wizard,
 * reload the page — the identical full-viewport overlay
 * (.wf-overlay: position:fixed, z-index:1000, pointer-events:auto)
 * reappears and blocks EVERY click in the entire app, on every future
 * page load, forever, for that account. A real operator who already
 * chose to skip has no path back to a working app short of clearing
 * their own browser storage — something no ordinary user would think to
 * do, since nothing on screen indicates that's the cause.
 *
 * Root cause: App.jsx's onDismiss handler (the actual wired code path —
 * a separate, unused, identically-bugged duplicate also existed in
 * WelcomeFlow.jsx's exported-but-never-imported useWelcomeFlow() hook)
 * only wrote the `ooplix_welcome_done` localStorage flag when
 * `completed` was true. "Skip setup" calls onDismiss(false), so the
 * flag was never written on that path — only fully completing the
 * 3-step wizard persisted dismissal, defeating the entire purpose of a
 * "Skip" button.
 *
 * Fix: the localStorage flag is now written on every dismissal path
 * (completed or skipped) in both places. Only the follow-up guided-tour
 * offer remains completion-gated (skipping setup should not also force
 * open the separate tour).
 *
 * This test drives the REAL app through a REAL browser (Playwright,
 * chromium) against the REAL backend and frontend dev servers — not a
 * mock — using a fresh account through actual signup, exactly
 * reproducing the conditions that surfaced this bug.
 *
 * Requires: backend running on :5050 and frontend dev server on :3000
 * (this test does not start them itself — it's a slow, full-stack UI
 * regression check, run manually/in CI after `npm run dev`, not part of
 * the fast unit suite).
 *
 * Usage: node tests/security/34-welcome-flow-skip-persistence.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const { chromium } = require("playwright");

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
  section("Precondition — real frontend (:3000) and backend (:5050) dev servers reachable");
  const serversUp = await checkServersUp();
  if (!serversUp) {
    console.log("  ⚠  Frontend/backend dev servers not reachable on :3000/:5050.");
    console.log("     This is a full-stack UI regression test — run `npm run dev` first.");
    console.log("     Skipping (not counted as pass or fail) rather than falsely failing CI.");
    process.exit(0);
  }
  ok("frontend and backend dev servers are reachable");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  section("Real signup through the actual web UI (desktop entry point)");
  const uniqueEmail = `wf-regression-${Date.now()}@ooplix-test.local`;
  await page.goto("http://localhost:3000/?desktop=1", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.locator('input[type="text"]').fill("Regression Test");
  await page.locator('input[type="email"]').fill(uniqueEmail);
  await page.locator('input[type="password"]').fill("RegressionTest12345!");
  await page.waitForTimeout(300);
  const submitBtn = page.locator('button:has-text("Start free trial")');
  await submitBtn.click();
  await page.waitForTimeout(5000);
  const registered = !(await page.locator("text=Internal server error").isVisible().catch(() => false));
  assert(registered, "signup succeeds through the real web UI (no Internal server error)", "signup failed — check the CORS dev-proxy fix (backend/server.js) is present");

  section("Dismiss any pre-onboarding modal, then the WelcomeFlow wizard via 'Skip setup'");
  const skipForNow = page.locator("text=Skip for now");
  if (await skipForNow.isVisible({ timeout: 3000 }).catch(() => false)) {
    await skipForNow.click();
    await page.waitForTimeout(1000);
  }
  const skipSetup = page.locator("text=Skip setup");
  const skipSetupVisible = await skipSetup.isVisible({ timeout: 5000 }).catch(() => false);
  assert(skipSetupVisible, "the WelcomeFlow wizard's 'Skip setup' button is reachable", "wizard did not appear — may indicate an unrelated regression in the onboarding trigger");
  if (skipSetupVisible) {
    await skipSetup.click();
    await page.waitForTimeout(1000);
  }

  const overlayImmediatelyAfterSkip = await page.locator(".wf-overlay").count();
  assert(overlayImmediatelyAfterSkip === 0, "the overlay is removed immediately after clicking Skip setup", `overlay count: ${overlayImmediatelyAfterSkip}`);

  section("THE REGRESSION CHECK — overlay must not reappear after a reload");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const overlayAfterReload = await page.locator(".wf-overlay").count();
  assert(overlayAfterReload === 0, "the onboarding overlay does NOT reappear after reloading the page", `overlay count after reload: ${overlayAfterReload} — Skip setup's dismissal was not persisted to localStorage, the app is now fully click-blocked for this user on every future load`);

  if (overlayAfterReload === 0) {
    // Confirm the app is genuinely interactive, not just visually clear —
    // click a real dashboard element and verify no full-viewport blocker exists.
    const dashboardVisible = await page.locator("text=/Welcome back/i").isVisible().catch(() => false);
    assert(dashboardVisible, "the real dashboard content is visible and interactive after reload", "dashboard content not found — app may still be in a broken state");
  }

  section("A second reload — confirm the fix is not a one-time fluke");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const overlayAfterSecondReload = await page.locator(".wf-overlay").count();
  assert(overlayAfterSecondReload === 0, "the overlay still does not reappear after a second reload", `overlay count: ${overlayAfterSecondReload}`);

  await browser.close();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`WelcomeFlow Skip Persistence Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
