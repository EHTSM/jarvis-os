#!/usr/bin/env node
"use strict";
/**
 * Email Ecosystem mission — Mailgun/Brevo real send + URL-shadowing bug fix.
 *
 * Discovery found Mailgun and Brevo both already had real, working auth
 * health-probes in integrationConnectors.cjs (a Connector Dashboard could
 * show them as CONNECTED) but emailService.cjs's sendEmail() dispatcher
 * had no send implementation for either — the exact "credential/probe
 * plumbing exists, real API call doesn't" pattern this continuous mission
 * has found and closed repeatedly (Gmail/Drive, FCM, Razorpay refunds).
 *
 * While building the Mailgun adapter, a SEPARATE, genuinely pre-existing
 * bug was found and fixed: emailService.cjs declares a module-level
 * `const URL = () => ...` template helper (line ~106) that shadows the
 * global URL class for the ENTIRE module — this silently broke every
 * `new URL(...)` call anywhere in the file, including the pre-existing
 * SES send path (confirmed broken via direct reproduction with fake SES
 * credentials BEFORE this mission's fix: "URL is not a constructor"
 * instead of a real AWS error). Fixed by renaming the template helper to
 * APP_URL — its only 2 call sites (the welcome template) were updated.
 *
 * This test never sends a real email — every scenario uses a fake/
 * invalid credential and asserts a REAL provider HTTP rejection is
 * reached and surfaced honestly (proving the real network path is used,
 * not a mock), never a fabricated success and never the URL-shadowing
 * crash.
 *
 * Usage: node tests/security/145-email-mailgun-brevo-real-send-url-shadowing-fix.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function _clearEnv() {
  for (const k of ["RESEND_API_KEY","SENDGRID_API_KEY","MAILGUN_API_KEY","MAILGUN_DOMAIN","POSTMARK_API_KEY","BREVO_API_KEY","SMTP_HOST","SMTP_USER","SMTP_PASS","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","AWS_SES_REGION"]) {
    delete process.env[k];
  }
}

async function main() {
  section("URL-shadowing bug — the renamed APP_URL constant exists, no bare module-level `URL` remains");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/services/emailService.cjs"), "utf8");
    assert(/const APP_URL = \(\) =>/.test(src), "the template helper was renamed to APP_URL");
    assert(!/^const URL\s*=/m.test(src), "no module-level `const URL` remains to shadow the global class");
    assert((src.match(/new URL\(/g) || []).length >= 3, "multiple new URL(...) call sites still exist (SES, Mailgun, _post/_get helpers) and must all now resolve to the real global class");
  }

  section("detectProvider() — Mailgun and Brevo are now detected, in the documented priority order");
  {
    _clearEnv();
    delete require.cache[require.resolve("../../backend/services/emailService.cjs")];
    const svc = require("../../backend/services/emailService.cjs");
    assert(svc.detectProvider().provider === null, "with nothing configured, no provider is detected");

    process.env.MAILGUN_API_KEY = "fake";
    process.env.MAILGUN_DOMAIN  = "mg.example.com";
    delete require.cache[require.resolve("../../backend/services/emailService.cjs")];
    const svcMg = require("../../backend/services/emailService.cjs");
    assert(svcMg.detectProvider().provider === "mailgun", "Mailgun is detected when its 2 required vars are both set");
    _clearEnv();

    process.env.BREVO_API_KEY = "fake";
    delete require.cache[require.resolve("../../backend/services/emailService.cjs")];
    const svcBrevo = require("../../backend/services/emailService.cjs");
    assert(svcBrevo.detectProvider().provider === "brevo", "Brevo is detected when its 1 required var is set");
    _clearEnv();
  }

  section("Mailgun real send — a fake key reaches the real API and gets a real HTTP 401, not the URL-shadowing crash");
  {
    process.env.MAILGUN_API_KEY = "fake-key-for-test";
    process.env.MAILGUN_DOMAIN  = "mg.example.com";
    delete require.cache[require.resolve("../../backend/services/emailService.cjs")];
    const svc = require("../../backend/services/emailService.cjs");
    const result = await svc.sendEmail({ to: "test@example.com", subject: "Test", html: "<p>hi</p>" });
    assert(result.provider === "mailgun", "the dispatcher routed to the Mailgun adapter");
    assert(result.ok === false, "a fake key results in a real failure, not fabricated success", JSON.stringify(result));
    assert(result.error !== "URL is not a constructor", "the URL-shadowing bug no longer masks the real error", result.error);
    assert(result.status === 401 || /HTTP 401/.test(result.error || ""), "the real Mailgun API rejected the fake key with a genuine 401", JSON.stringify(result));
    _clearEnv();
  }

  section("Mailgun — MAILGUN_DOMAIN required even if MAILGUN_API_KEY somehow reaches the adapter directly");
  {
    process.env.MAILGUN_API_KEY = "fake";
    delete require.cache[require.resolve("../../backend/services/emailService.cjs")];
    const svc = require("../../backend/services/emailService.cjs");
    // Force the mailgun path directly via the provider override, bypassing detectProvider's own gating.
    const result = await svc.sendEmail({ to: "test@example.com", subject: "Test", html: "<p>hi</p>", provider: "mailgun" });
    assert(result.ok === false, "Mailgun adapter refuses without a domain");
    assert(/MAILGUN_DOMAIN not set/.test(result.error || ""), "error message names the specific missing config", result.error);
    _clearEnv();
  }

  section("Brevo real send — a fake key reaches the real API and gets a real HTTP 401, not a fabricated success");
  {
    process.env.BREVO_API_KEY = "fake-key-for-test";
    delete require.cache[require.resolve("../../backend/services/emailService.cjs")];
    const svc = require("../../backend/services/emailService.cjs");
    const result = await svc.sendEmail({ to: "test@example.com", subject: "Test", html: "<p>hi</p>" });
    assert(result.provider === "brevo", "the dispatcher routed to the Brevo adapter");
    assert(result.ok === false, "a fake key results in a real failure, not fabricated success", JSON.stringify(result));
    assert(result.status === 401 || /HTTP 401/.test(result.error || "") || /Key not found/i.test(result.error || ""), "the real Brevo API rejected the fake key", JSON.stringify(result));
    _clearEnv();
  }

  section("SES — the pre-existing send path is fixed too (same URL-shadowing bug, confirmed via a real network call)");
  {
    process.env.AWS_ACCESS_KEY_ID     = "fake";
    process.env.AWS_SECRET_ACCESS_KEY = "fake";
    process.env.AWS_SES_REGION        = "us-east-1";
    delete require.cache[require.resolve("../../backend/services/emailService.cjs")];
    const svc = require("../../backend/services/emailService.cjs");
    const result = await svc.sendEmail({ to: "test@example.com", subject: "Test", html: "<p>hi</p>" });
    assert(result.provider === "ses", "the dispatcher routed to SES");
    assert(result.ok === false, "fake AWS credentials result in a real failure");
    assert(result.error !== "URL is not a constructor", "SES no longer hits the URL-shadowing bug — a real AWS error is surfaced instead", result.error);
    assert(/InvalidClientTokenId|Sender|HTTP 40[13]/.test(result.error || ""), "a genuine AWS SES error is surfaced", result.error);
    _clearEnv();
  }

  section("verifyProvider() — Mailgun and Brevo live-connectivity checks exist and reach the real endpoints");
  {
    process.env.MAILGUN_API_KEY = "fake";
    process.env.MAILGUN_DOMAIN  = "mg.example.com";
    delete require.cache[require.resolve("../../backend/services/emailService.cjs")];
    const svcMg = require("../../backend/services/emailService.cjs");
    const r1 = await svcMg.verifyProvider("mailgun");
    assert(r1.provider === "mailgun", "verifyProvider supports mailgun");
    assert(r1.ok === false, "a fake key fails real verification, not fabricated success");
    _clearEnv();

    process.env.BREVO_API_KEY = "fake";
    delete require.cache[require.resolve("../../backend/services/emailService.cjs")];
    const svcBrevo = require("../../backend/services/emailService.cjs");
    const r2 = await svcBrevo.verifyProvider("brevo");
    assert(r2.provider === "brevo", "verifyProvider supports brevo");
    assert(r2.ok === false, "a fake key fails real verification, not fabricated success");
    _clearEnv();
  }

  section("Welcome template still renders correctly after the URL->APP_URL rename");
  {
    delete require.cache[require.resolve("../../backend/services/emailService.cjs")];
    const svc = require("../../backend/services/emailService.cjs");
    const templates = svc.getTemplates();
    assert(/https?:\/\//.test(templates.welcome.html), "welcome template's HTML still contains a real URL");
    assert(/https?:\/\//.test(templates.welcome.text), "welcome template's plain-text body still contains a real URL");
  }

  console.log(`\n${"=".repeat(60)}\n  Pass: ${pass}   Fail: ${fail}\n${"=".repeat(60)}`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
