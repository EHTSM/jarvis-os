#!/usr/bin/env node
"use strict";
/**
 * Launch Readiness — email check canonical env-var name regression.
 *
 * Mission 94: launchReadiness.cjs's "email_service" check previously read
 * SENDGRID_KEY / RESEND_KEY, which no other file in the repository ever
 * wrote, checked, or documented — emailService.cjs (the actual sender)
 * and .env.example both use SENDGRID_API_KEY / RESEND_API_KEY, and
 * docs/audits/CREDENTIAL-CANONICAL-MAP.md lists those as canonical with
 * "ALIASES FOUND: none". The old names meant this check could report
 * "email not configured" even when a real provider key was set, and vice
 * versa — a readiness/consumer mismatch, not a code path either name was
 * intentionally supporting.
 *
 * Fixed: the check now reads SENDGRID_API_KEY / RESEND_API_KEY, matching
 * emailService.cjs exactly. No new naming convention introduced, no
 * backwards-compatibility alias added — repo-wide search found nothing
 * else depends on the old names.
 *
 * This test calls the check function in isolation (CHECKS[].check()), not
 * runChecks(), so data/launch-readiness.json is never written — no
 * runtime data is touched by this test.
 *
 * Usage: node tests/security/100-launch-readiness-email-canonical-env-names.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

const EMAIL_ENV_KEYS = ["SMTP_HOST", "SENDGRID_KEY", "RESEND_KEY", "SENDGRID_API_KEY", "RESEND_API_KEY"];
const _savedEnv = {};
function _snapshotEnv() { for (const k of EMAIL_ENV_KEYS) _savedEnv[k] = process.env[k]; }
function _clearEnv()    { for (const k of EMAIL_ENV_KEYS) delete process.env[k]; }
function _restoreEnv()  { for (const k of EMAIL_ENV_KEYS) { if (_savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = _savedEnv[k]; } }

function _emailCheck() {
  delete require.cache[require.resolve("../../backend/services/launchReadiness.cjs")];
  const { CHECKS } = require("../../backend/services/launchReadiness.cjs");
  const entry = CHECKS.find(c => c.id === "email_service");
  if (!entry) throw new Error("email_service check not found in CHECKS");
  return entry.check();
}

async function main() {
  _snapshotEnv();

  section("source-level: launchReadiness.cjs no longer references the stale names");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/services/launchReadiness.cjs"), "utf8");
    assert(!/SENDGRID_KEY/.test(src), "no reference to SENDGRID_KEY remains");
    assert(!/RESEND_KEY/.test(src), "no reference to RESEND_KEY remains");
    assert(/SENDGRID_API_KEY/.test(src), "SENDGRID_API_KEY is referenced");
    assert(/RESEND_API_KEY/.test(src), "RESEND_API_KEY is referenced");
  }

  section("email_service check — fails closed with nothing set");
  {
    _clearEnv();
    const r = _emailCheck();
    assert(r.pass === false, "pass is false when no email env var is set");
    assert(/SENDGRID_API_KEY/.test(r.detail) && /RESEND_API_KEY/.test(r.detail),
      "failure detail names the real canonical vars (SENDGRID_API_KEY/RESEND_API_KEY), not the stale ones");
  }

  section("email_service check — recognizes RESEND_API_KEY (canonical, emailService.cjs's 1st-priority provider)");
  {
    _clearEnv();
    process.env.RESEND_API_KEY = "fake-value-not-a-real-credential";
    const r = _emailCheck();
    assert(r.pass === true, "pass is true when RESEND_API_KEY is set");
  }

  section("email_service check — recognizes SENDGRID_API_KEY (canonical, emailService.cjs's 2nd-priority provider)");
  {
    _clearEnv();
    process.env.SENDGRID_API_KEY = "fake-value-not-a-real-credential";
    const r = _emailCheck();
    assert(r.pass === true, "pass is true when SENDGRID_API_KEY is set");
  }

  section("email_service check — still recognizes SMTP_HOST (unrelated to the drift, must not regress)");
  {
    _clearEnv();
    process.env.SMTP_HOST = "smtp.example.com";
    const r = _emailCheck();
    assert(r.pass === true, "pass is true when SMTP_HOST is set");
  }

  section("email_service check — the stale names alone no longer flip pass to true");
  {
    _clearEnv();
    process.env.SENDGRID_KEY = "fake-value-not-a-real-credential";
    process.env.RESEND_KEY   = "fake-value-not-a-real-credential";
    const r = _emailCheck();
    assert(r.pass === false, "pass is false when only the old, non-canonical SENDGRID_KEY/RESEND_KEY are set — proves the drift is actually gone, not just the string literal");
  }

  section("runtime-data safety: this test never touched data/launch-readiness.json");
  {
    const fs = require("fs");
    const storeFile = require("path").join(__dirname, "../../data/launch-readiness.json");
    // Only assert on mtime if the file pre-existed; this test must not create it either.
    const existedBefore = _initialStoreState.existed;
    const existsNow = fs.existsSync(storeFile);
    if (!existedBefore) {
      assert(!existsNow, "data/launch-readiness.json was not created by this test (file did not exist before, still doesn't)");
    } else {
      const mtimeNow = fs.statSync(storeFile).mtimeMs;
      assert(mtimeNow === _initialStoreState.mtimeMs, "data/launch-readiness.json mtime is unchanged (this test never calls runChecks(), only the check() function directly)");
    }
  }

  _restoreEnv();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
}

const fs = require("fs");
const path = require("path");
const _storeFilePath = path.join(__dirname, "../../data/launch-readiness.json");
const _initialStoreState = fs.existsSync(_storeFilePath)
  ? { existed: true, mtimeMs: fs.statSync(_storeFilePath).mtimeMs }
  : { existed: false, mtimeMs: null };

main().catch(e => { console.error("FATAL:", e); _restoreEnv(); process.exit(1); });
