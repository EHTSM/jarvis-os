#!/usr/bin/env node
"use strict";
/**
 * Returning-user onboarding-redirect regression — Phase A.6 (Business Owner
 * Certification).
 *
 * CONFIRMED finding (reproduced live via real signup + real login + a fresh
 * Playwright browser context, i.e. a different browser/device): App.jsx's
 * _initialScreen() decides landing vs onboarding vs app purely from two
 * localStorage flags ("jarvis_started", "jarvis_biz_profile") — set only
 * once, client-side, when the onboarding wizard is first completed. Neither
 * flag is ever synced to the server or the account record. A genuinely
 * authenticated returning founder — real account, real session, zero auth
 * failures — landed back on the "Quick setup, Step 1 of 3" onboarding
 * wizard instead of their dashboard, every time they logged in from a new
 * browser context or with cleared local storage, and this persisted across
 * repeated page reloads (confirmed 2/2 reloads before the fix).
 *
 * Root cause: the screen-routing check at the top of AppInner
 * (`if (screen === "onboarding") return <Onboarding .../>`) runs and
 * returns before the auth-gate logic further down in the same render
 * function ever executes — so even though the app already tracks real
 * auth state via AuthContext (`user`, `loading`), that state was never
 * consulted before committing to the onboarding screen.
 *
 * Fix: a useEffect in AppInner watches (authLoading, user) — once auth
 * resolves to a real, authenticated user, it corrects `screen` away from
 * "landing"/"onboarding" to "app", reusing the exact same setScreen("app")
 * escape hatch LoginPage's onSuccess handler already uses elsewhere in
 * this file. No new state, no new mechanism — just consulting auth state
 * that already existed but was being ignored by the initial screen guess.
 *
 * This test is a static source check (no live server/browser dependency)
 * confirming the fix is present and structurally sound; the live
 * reproduction (fresh browser + login + 2 reloads landing on dashboard,
 * not onboarding) was verified manually against the real running app
 * during this session.
 *
 * Usage: node tests/security/54-returning-user-onboarding-redirect.cjs
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
  const src = fs.readFileSync(require.resolve("../../frontend/src/App.jsx"), "utf8");

  section("Fix: AppInner corrects screen away from landing/onboarding once auth resolves");
  {
    // Find the useEffect that watches authLoading/user and calls setScreen.
    const hasGuardEffect = /useEffect\(\(\) => \{\s*if \(authLoading \|\| !user\) return;\s*setScreen\(s => \(s === "landing" \|\| s === "onboarding"\) \? "app" : s\);\s*\}, \[authLoading, user\]\)/.test(src);
    assert.ok(hasGuardEffect,
      "App.jsx must contain a useEffect that redirects an authenticated user away from landing/onboarding to app");
    ok("App.jsx contains the auth-aware screen-correction effect");
  }

  section("Fix: the guard only overrides landing/onboarding, not other screens");
  {
    // Sanity: the effect's ternary must preserve any other screen value (s)
    // rather than unconditionally forcing "app" — otherwise it would fight
    // with legitimate mid-flow screens (login/signup/reset-password).
    const preservesOtherScreens = /\(s === "landing" \|\| s === "onboarding"\) \? "app" : s/.test(src);
    assert.ok(preservesOtherScreens, "the guard must fall through to the existing screen value for any screen other than landing/onboarding");
    ok("guard preserves login/signup/reset-password/etc. screens — only overrides landing/onboarding");
  }

  section("Structural: _initialScreen() and the auth-gate logic both still exist (fix is additive, not a replacement)");
  {
    assert.ok(/function _initialScreen\(\)/.test(src), "_initialScreen() must still exist — the fix corrects its output, not replace it");
    assert.ok(/if \(authLoading\) return/.test(src), "the authLoading gate further down in AppInner must still exist");
    ok("both the original screen-guess function and the downstream auth gate remain intact — fix is additive");
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
