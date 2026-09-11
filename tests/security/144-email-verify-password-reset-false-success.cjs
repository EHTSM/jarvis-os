#!/usr/bin/env node
"use strict";
/**
 * Email verification / password reset false-success regression — Email
 * Ecosystem mission.
 *
 * CONFIRMED finding, the exact same class already found and fixed once in
 * workspaceService.cjs's invite path (test 61): betaReadiness.cjs's
 * sendEmailVerification() and sendPasswordReset() both called
 * emailService.cjs's async sendEmail()/sendPasswordReset() WITHOUT await,
 * inside a synchronous try/catch. Two compounding problems: (1) with no
 * await, a rejection becomes an unhandled promise rejection the
 * surrounding try/catch can never see; (2) emailService.cjs's functions
 * don't even throw on failure — they always resolve to {ok, error}, so
 * the catch block was structurally unable to ever fire for a real send
 * failure regardless. A live email-provider outage during registration,
 * a resend request, or a password-reset request was completely invisible
 * — not logged, not audited, not surfaced to the caller in any way.
 *
 * Fix: both functions are now async and properly await the send,
 * recording the REAL outcome (emailSent/emailError) to the audit log and
 * returning it to callers as additional metadata. Their external
 * ok:true/message contracts are deliberately UNCHANGED — a registration
 * or password-reset request correctly should not fail just because an
 * email provider hiccuped, and anti-enumeration (forgot-password must
 * never reveal whether an account exists) is a genuine, correct security
 * property this fix does not touch. What was missing was ever recording
 * that a failure happened, not the tolerant response shape itself.
 *
 * A THIRD call site (unlike the other two) has no anti-enumeration
 * concern at all: POST /accounts/resend-verification is an authenticated
 * user explicitly asking to confirm their OWN email was (re)sent — that
 * route previously returned {success:true, message:"Verification email
 * sent."} unconditionally, a genuine user-facing false success. Fixed to
 * await the real result and report a real 502 when the send failed.
 *
 * Usage: node tests/security/144-email-verify-password-reset-false-success.cjs
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
  const svcSrc      = fs.readFileSync(require.resolve("../../backend/services/betaReadiness.cjs"), "utf8");
  const accountsSrc = fs.readFileSync(require.resolve("../../backend/routes/accounts.js"), "utf8");
  const authSrc     = fs.readFileSync(require.resolve("../../backend/routes/auth.js"), "utf8");

  section("Fix 1: sendEmailVerification() is async and awaits the real send");
  {
    assert.ok(/async function sendEmailVerification/.test(svcSrc), "sendEmailVerification must be declared async");
    const fnMatch = svcSrc.match(/async function sendEmailVerification\([\s\S]*?\n\}/);
    assert.ok(fnMatch, "could not find sendEmailVerification's body");
    assert.ok(/const result = await emailSvc\.sendEmail\(/.test(fnMatch[0]),
      "sendEmailVerification must await emailSvc.sendEmail(), not fire-and-forget it");
    assert.ok(/emailSent\s*=\s*!!result\?\.ok/.test(fnMatch[0]),
      "sendEmailVerification must derive the real emailSent flag from the awaited result");
    assert.ok(/al\.append\(\{ type: "email_verify_sent", accountId, email, emailSent, emailError/.test(fnMatch[0]),
      "the real emailSent/emailError must be recorded to the audit log");
    ok("sendEmailVerification() is async, awaits sendEmail(), and records the real outcome");
  }

  section("Fix 2: sendPasswordReset() is async and awaits the real send, anti-enumeration response unchanged");
  {
    assert.ok(/async function sendPasswordReset/.test(svcSrc), "sendPasswordReset must be declared async");
    const fnMatch = svcSrc.match(/async function sendPasswordReset\([\s\S]*?\n\}/);
    assert.ok(fnMatch, "could not find sendPasswordReset's body");
    assert.ok(/const result = await emailSvc\.sendPasswordReset\(/.test(fnMatch[0]),
      "sendPasswordReset must await emailSvc.sendPasswordReset(), not fire-and-forget it");
    assert.ok(/al\.append\(\{ type: "password_reset_requested", accountId: account\.id, email, emailSent, emailError/.test(fnMatch[0]),
      "the real emailSent/emailError must be recorded to the audit log");
    assert.ok(/message: "If an account exists, a reset link will be sent\."/.test(fnMatch[0]),
      "the anti-enumeration response message is unchanged regardless of real send outcome");
    ok("sendPasswordReset() is async, awaits the send, records the real outcome, keeps its anti-enumeration contract");
  }

  section("Fix 3: /accounts/resend-verification awaits and reports a real failure (no anti-enumeration concern here)");
  {
    const routeStart = accountsSrc.indexOf('router.post("/accounts/resend-verification"');
    assert.ok(routeStart !== -1, "could not find the POST /accounts/resend-verification route handler");
    const routeBody = accountsSrc.slice(routeStart, routeStart + 900);
    assert.ok(/async \(req, res\) => \{/.test(routeBody), "the route handler is async");
    assert.ok(/const result = await beta\.sendEmailVerification\(/.test(routeBody),
      "the route must await beta.sendEmailVerification()");
    assert.ok(/if \(!result\.emailSent\)/.test(routeBody),
      "the route must check the real emailSent flag before reporting success");
    assert.ok(/res\.status\(502\)\.json\(\{ error: "Could not send verification email/.test(routeBody),
      "the route must report a real error to the user when the send genuinely failed, not a hardcoded success");
    ok("/accounts/resend-verification awaits the real result and reports honest failure");
  }

  section("Fix 4: registration (/accounts/register) fires the email non-blockingly but no longer swallows the real error silently");
  {
    const routeStart = accountsSrc.indexOf("function _handleRegister");
    const routeBody = accountsSrc.slice(routeStart, routeStart + 2000);
    assert.ok(!/try \{ beta\.sendEmailVerification\([\s\S]{0,40}catch \{ \/\* non-fatal \*\/ \}/.test(routeBody),
      "the old broken synchronous try/catch around the un-awaited call is gone");
    assert.ok(/beta\.sendEmailVerification\(result\.account\.id, result\.account\.email, name\)\s*\n\s*\.catch\(e => logger\.warn/.test(routeBody),
      "a real .catch() now logs the actual failure reason instead of a synchronous catch that could never fire");
    ok("registration's fire-and-forget email send now logs its real failure instead of silently discarding it");
  }

  section("Fix 5: forgot-password awaits the real send but keeps its anti-enumeration response unchanged");
  {
    assert.ok(/async function _handleForgotPassword/.test(authSrc), "_handleForgotPassword must be declared async");
    const fnMatch = authSrc.match(/async function _handleForgotPassword\([\s\S]*?\n\}/);
    assert.ok(fnMatch, "could not find _handleForgotPassword's body");
    assert.ok(/const result = await beta\.sendPasswordReset\(/.test(fnMatch[0]),
      "_handleForgotPassword must await beta.sendPasswordReset()");
    assert.ok(/return res\.json\(\{ success: true, message: result\.message \}\)/.test(fnMatch[0]),
      "the success response is unchanged — always success:true regardless of real email delivery outcome");
    ok("_handleForgotPassword awaits the real send while preserving its anti-enumeration contract");
  }

  section("Behavior — sendEmailVerification() honestly reports emailSent:false with no provider configured");
  {
    delete require.cache[require.resolve("../../backend/services/betaReadiness.cjs")];
    const beta = require("../../backend/services/betaReadiness.cjs");
    const result = await beta.sendEmailVerification("test-honesty-check-acct", "honesty-test@example.com", "Test");
    assert.ok(result.ok === true, "the function's own contract (ok:true) is unchanged");
    assert.ok(result.emailSent === false, "emailSent honestly reflects that no real provider is configured", JSON.stringify(result));
    // Clean up the token entry this call just created.
    try {
      const fsMod = require("fs");
      const tokenFile = "data/m6-auth-tokens.json";
      if (fsMod.existsSync(tokenFile)) {
        const data = JSON.parse(fsMod.readFileSync(tokenFile, "utf8"));
        const key = `ev_${result.token}`;
        if (data[key]) { delete data[key]; fsMod.writeFileSync(tokenFile, JSON.stringify(data, null, 2)); }
      }
    } catch { /* best-effort cleanup, not part of the assertion */ }
    ok("sendEmailVerification() returns ok:true (unchanged contract) but emailSent:false (the real, previously-invisible outcome)");
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
