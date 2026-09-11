#!/usr/bin/env node
"use strict";
/**
 * Onboarding wizard signed-out dead end — Phase A.6 (Business Owner
 * Certification, Daily Operations section).
 *
 * CONFIRMED finding (reproduced live: real account, real login, real
 * Sign out via the ORG dropdown, then reload http://localhost:3000/):
 * landed on the "Quick setup — Step 1 of 3" onboarding wizard with
 * absolutely no way back to the login form — no "Log in" link, no nav,
 * nothing except the 3-step business-type/team-size/goals wizard.
 *
 * Root cause: App.jsx's _initialScreen() decides landing vs onboarding vs
 * app purely from localStorage flags ("jarvis_started", "jarvis_biz_profile")
 * with no auth awareness (documented gap from an earlier A.6 fix,
 * c1348e42, which corrects screen -> "app" once a real user resolves, but
 * only when `user` is truthy). After a real sign-out, `user` is null, so
 * that correction effect does nothing — and because jarvis_started was
 * already "1" from the account's original signup, _initialScreen() skips
 * "landing" entirely and returns "onboarding" (jarvis_biz_profile from
 * that same original signup was also already consumed/never re-checked
 * for this fresh flow), stranding a legitimately signed-out founder.
 *
 * Fix: Onboarding now accepts an onLogin prop (App.jsx wires it to the
 * existing handleLogin — the same function already passed to LandingPage,
 * not a new mechanism) and renders an "Already have an account? Log in"
 * link in its header when the prop is provided.
 *
 * Verified live: sign out -> reload -> onboarding wizard now shows the
 * login link -> click -> real login form -> sign in -> back in the app
 * with full navigation and the real "Acme Consulting Co." lead intact.
 *
 * Usage: node tests/security/63-onboarding-wizard-signed-out-dead-end.cjs
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
  const appSrc = fs.readFileSync(require.resolve("../../frontend/src/App.jsx"), "utf8");
  const obSrc  = fs.readFileSync(require.resolve("../../frontend/src/components/Onboarding.jsx"), "utf8");

  section("App.jsx passes onLogin (the existing handleLogin) into the onboarding screen");
  {
    assert.ok(/if \(screen === "onboarding"\)[\s\S]*?<Onboarding[\s\S]*?onLogin=\{handleLogin\}/.test(appSrc),
      "the onboarding screen route must pass onLogin={handleLogin} to <Onboarding>");
    ok("Onboarding is rendered with onLogin={handleLogin}");
  }

  section("Onboarding.jsx accepts onLogin and renders a real login escape hatch");
  {
    assert.ok(/export default function Onboarding\(\{ onComplete, onLogin \}\)/.test(obSrc),
      "Onboarding must accept an onLogin prop");
    assert.ok(/\{onLogin && \(/.test(obSrc), "the login link must be conditionally rendered only when onLogin is provided");
    assert.ok(/Already have an account\? Log in/.test(obSrc), "the login link must have clear, honest copy");
    assert.ok(/onClick=\{onLogin\}/.test(obSrc), "the login link's onClick must call the real onLogin handler, not a no-op");
    ok("Onboarding renders a working 'Already have an account? Log in' link wired to onLogin");
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
