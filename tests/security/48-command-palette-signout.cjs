#!/usr/bin/env node
"use strict";
/**
 * Command Palette missing Sign out regression —
 * frontend/src/components/CommandPalette.jsx + frontend/src/App.jsx.
 *
 * CONFIRMED finding (Founder Journey Final Polish, Phase A.4.3): "logout"
 * and "sign out" — words this mission explicitly names as required focus
 * terms — returned nothing anywhere search was tried: the More-menu search
 * (frontend/src/App.jsx's MoreMenu) and the Command Palette (⌘K) both came
 * up empty. The real Sign out button DOES exist and works — but its only
 * home was inside the ORG switcher dropdown
 * (frontend/src/components/OrgSwitcher.jsx, itself the product of an
 * earlier session's fix moving it out of a buried session-expiry banner).
 * Reachable, but not discoverable by search — a founder using this
 * product's primary discovery mechanism (⌘K, the same shortcut the app's
 * own onboarding checklist teaches) would find no path to signing out.
 *
 * Root cause: CommandPalette.jsx's action registry (NAV_ACTIONS +
 * QUICK_ACTIONS + DESKTOP_ACTIONS) never included a sign-out entry, and
 * App.jsx never passed the already-available `logout` (from useAuth())
 * down into <CommandPalette>.
 *
 * Fix reuses TWO mechanisms the palette already had, adding no new
 * architecture:
 *   1. The palette's own existing `type: "run"` action shape — already
 *      used for the desktop-only "Open Terminal" action — now has a
 *      second caller: a `{ type: "run", run: onSignOut }` Sign out entry.
 *   2. An optional `keywords` string on any action, checked by the
 *      scorer alongside the visible label (mirrors MoreMenu's existing
 *      `alias` field, applied to this system's own fuzzy scorer) — the
 *      label stays "Sign out" (matching the app's other sign-out
 *      surface for consistency) while `keywords: "logout log out"`
 *      makes the exact word this mission names also resolve.
 *
 * App.jsx now destructures `logout` from useAuth() (previously only
 * `user`/`loading` were pulled from that hook at this scope) and passes
 * it into <CommandPalette onSignOut={logout} />.
 *
 * This test is a static check against the real source (both files) plus a
 * live Playwright run against the real running app proving ⌘K + "sign
 * out" AND ⌘K + "logout" both surface the same real command, and clicking
 * it performs a real sign-out.
 *
 * Usage: node tests/security/48-command-palette-signout.cjs
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
  section("Static — real source wires onSignOut through App.jsx into CommandPalette");
  const appSrc = fs.readFileSync(path.join(__dirname, "../../frontend/src/App.jsx"), "utf8");
  assert(/const \{ user, loading: authLoading, logout \} = useAuth\(\)/.test(appSrc), "AppInner now destructures logout from useAuth() (previously only user/loading)", "logout not found in the useAuth() destructure at AppInner scope");
  assert(/<CommandPalette[\s\S]{0,400}onSignOut=\{logout\}/.test(appSrc), "the real <CommandPalette> render passes onSignOut={logout}", "onSignOut prop not found on the CommandPalette element");

  section("Static — real CommandPalette.jsx source registers a real Sign out action with logout keywords");
  const cpSrc = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/CommandPalette.jsx"), "utf8");
  assert(/function _signOutAction\(onSignOut\)/.test(cpSrc), "a _signOutAction factory function exists in the real source", "_signOutAction not found");
  assert(/label: "Sign out"[\s\S]{0,20}icon:[\s\S]{0,60}type: "run", run: onSignOut, keywords: "logout log out"/.test(cpSrc), "the Sign out action reuses the existing type:\"run\" mechanism and carries logout keywords", "Sign out action shape not found as expected");
  assert(/CommandPalette\(\{ open, onClose, onNavigate, onAsk, onSignOut \}\)/.test(cpSrc), "the component signature accepts onSignOut", "onSignOut not found in CommandPalette's props");
  assert(/function _score\(label, query, keywords\)/.test(cpSrc), "the scorer now accepts an optional keywords parameter (additive to the existing label-only scorer)", "keywords parameter not found on _score");

  section("Precondition — real frontend (:3000) and backend (:5050) dev servers reachable");
  const serversUp = await checkServersUp();
  if (!serversUp) {
    console.log("  ⚠  Frontend/backend dev servers not reachable on :3000/:5050.");
    console.log("     Skipping the live end-to-end portion (not counted as pass or fail).");
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Command Palette Sign Out Regression: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
  ok("frontend and backend dev servers are reachable");

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  section("Live — real signup, then real ⌘K search for 'sign out' surfaces a real command");
  const uniqueEmail = `cmdk-signout-${Date.now()}@ooplix-test.local`;
  // ?desktop=1 (the Electron-shell flag) intentionally skips the public
  // landing/onboarding wizard and goes straight to the signup form
  // (frontend/src/App.jsx's _initialScreen() — confirmed during this same
  // investigation) — no onboarding-step clicks needed or possible here.
  await page.goto("http://localhost:3000/?desktop=1", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.locator('input[type="text"]').first().fill("CmdK SignOut Test").catch(() => {});
  await page.locator('input[type="email"]').first().fill(uniqueEmail).catch(() => {});
  await page.locator('input[type="password"]').first().fill("CmdKSignOut12345!").catch(() => {});
  await page.locator("button.auth-btn").first().click().catch(() => {});
  await page.waitForFunction(() => !document.body.innerText.includes("Creating account"), { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const DISMISS = ["Skip for now", "Skip setup", "Skip tour", "Skip"];
  for (let round = 0; round < 8; round++) {
    let did = false;
    for (const label of DISMISS) {
      const btn = page.getByText(label, { exact: true }).first();
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) { await btn.click().catch(() => {}); await page.waitForTimeout(400); did = true; }
    }
    if (!did) break;
  }
  await page.waitForTimeout(800);

  const paletteTrigger = page.locator(".palette-trigger").first();
  const paletteVisible = await paletteTrigger.isVisible({ timeout: 5000 }).catch(() => false);
  assert(paletteVisible, "the ⌘K command palette trigger is reachable after signup", "palette trigger not found");

  if (paletteVisible) {
    await paletteTrigger.click();
    await page.waitForTimeout(600);
    await page.locator("input.cp-input").first().fill("sign out");
    await page.waitForTimeout(400);
    const signOutItem = page.locator(".cp-item", { hasText: "Sign out" }).first();
    const signOutVisible = await signOutItem.isVisible({ timeout: 3000 }).catch(() => false);
    assert(signOutVisible, "searching 'sign out' in ⌘K surfaces a real Sign out command", "Sign out command not found for 'sign out' query");

    section("Live — searching 'logout' (the exact word this mission names) also surfaces the same command");
    await page.locator("input.cp-input").first().fill("logout");
    await page.waitForTimeout(400);
    const logoutMatchVisible = await page.locator(".cp-item", { hasText: "Sign out" }).first().isVisible({ timeout: 3000 }).catch(() => false);
    assert(logoutMatchVisible, "searching 'logout' in ⌘K also surfaces the Sign out command via keywords", "Sign out command not found for 'logout' query");

    section("Live — clicking the ⌘K Sign out command performs a real sign-out");
    await page.locator("input.cp-input").first().fill("sign out");
    await page.waitForTimeout(400);
    await page.locator(".cp-item", { hasText: "Sign out" }).first().click();
    await page.waitForTimeout(2000);
    const afterText = await page.evaluate(() => document.body.innerText);
    assert(afterText.includes("Create your account") || afterText.includes("Sign in") || afterText.includes("Welcome back"), "clicking Sign out in ⌘K ends the session and returns to an unauthenticated screen", "did not land on an unauthenticated screen after clicking Sign out");
  }

  await browser.close();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Command Palette Sign Out Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
