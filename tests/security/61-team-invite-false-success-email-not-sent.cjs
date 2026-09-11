#!/usr/bin/env node
"use strict";
/**
 * Team invite false-success regression — Phase A.6 (Business Owner
 * Certification, Team section).
 *
 * CONFIRMED finding (reproduced live: real signup, Team → "+ Invite
 * member", zero email provider credentials configured in this
 * environment — no RESEND_API_KEY, SENDGRID_API_KEY, POSTMARK_API_KEY,
 * SMTP host/user/pass, or AWS SES vars set): submitting a real invite showed
 * "Invite sent to colleague@..." even though no email could possibly
 * have been delivered. Direct API call confirmed the real backend
 * response: {"emailSent":false,"emailError":"No email provider
 * configured"} — the frontend simply never looked at it.
 *
 * Two root causes, both fixed:
 *
 * 1. (backend) workspaceService.cjs's sendInvitationEmail() called the
 *    genuinely-async emailService.cjs's sendEmail() WITHOUT await, so it
 *    always returned { sent: true } immediately — before the real send
 *    had even started, regardless of whether it later succeeded or
 *    failed. Fixed: sendInvitationEmail is now async and awaits
 *    sendEmail(), propagating its real { ok, error } result.
 *
 * 2. (backend route) backend/routes/workspace.js's POST /workspace/invite
 *    called sendInvitationEmail() without await too (compounding #1), and
 *    only returned emailSent — no error detail. Fixed: awaits the now-
 *    async call and also returns emailError when sending failed.
 *
 * 3. (frontend) TeamWorkspace.jsx's handleInvite() discarded the entire
 *    /workspace/invite response body and unconditionally toasted
 *    "Invite sent to {email}" as soon as the HTTP call itself succeeded
 *    (i.e. the invite RECORD was created) — the real emailSent/emailError
 *    fields the backend already sent back were never read. Fixed: reads
 *    res.emailSent and shows the real emailError when the send failed.
 *
 * This directly violates this pass's explicit rule: if a credential is
 * invalid or missing, expose the real infrastructure error — do not
 * convert it into a generic message, and never show a false success.
 *
 * Verified live: direct API call now returns
 * {"emailSent":false,"emailError":"No email provider configured"}; the
 * real UI toast now reads "Invite created for {email}, but the email
 * could not be sent: No email provider configured".
 *
 * Usage: node tests/security/61-team-invite-false-success-email-not-sent.cjs
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
  const svcSrc   = fs.readFileSync(require.resolve("../../backend/services/workspaceService.cjs"), "utf8");
  const routeSrc = fs.readFileSync(require.resolve("../../backend/routes/workspace.js"), "utf8");
  const feSrc    = fs.readFileSync(require.resolve("../../frontend/src/components/TeamWorkspace.jsx"), "utf8");

  section("Fix 1: sendInvitationEmail() is async and awaits the real send");
  {
    assert.ok(/async function sendInvitationEmail/.test(svcSrc), "sendInvitationEmail must be declared async");
    const fnMatch = svcSrc.match(/async function sendInvitationEmail\([\s\S]*?\n\}/);
    assert.ok(fnMatch, "could not find sendInvitationEmail's body");
    assert.ok(/const result = await emailSvc\.sendEmail\(/.test(fnMatch[0]),
      "sendInvitationEmail must await emailSvc.sendEmail(), not fire-and-forget it");
    assert.ok(/if \(!result\.ok\) return \{ sent: false, reason: result\.error/.test(fnMatch[0]),
      "sendInvitationEmail must propagate the real failure reason from sendEmail()'s result");
    ok("sendInvitationEmail() is async, awaits sendEmail(), and propagates the real result");
  }

  section("Fix 2: the /workspace/invite route awaits sendInvitationEmail and returns emailError");
  {
    const routeStart = routeSrc.indexOf('router.post("/workspace/invite"');
    assert.ok(routeStart !== -1, "could not find the POST /workspace/invite route handler");
    // Bound the search to a generous window past the route start rather
    // than trying to regex-match balanced braces (this file's route body
    // contains its own nested try/catch with a }); that a naive
    // non-greedy match would stop at prematurely).
    const routeBody = routeSrc.slice(routeStart, routeStart + 1600);
    assert.ok(/const delivery = await svc\.sendInvitationEmail\(/.test(routeBody),
      "the route must await svc.sendInvitationEmail()");
    assert.ok(/emailError:\s+delivery\.sent \? undefined : delivery\.reason/.test(routeBody),
      "the route's response must include emailError with the real failure reason when sending failed");
    ok("route awaits sendInvitationEmail and includes emailError in its response");
  }

  section("Fix 3: TeamWorkspace.jsx reads the real emailSent/emailError instead of a hardcoded success toast");
  {
    const fnMatch = feSrc.match(/const handleInvite = useCallback\(async \(data\) => \{[\s\S]*?\}, \[activeId, load\]\);/);
    assert.ok(fnMatch, "could not find handleInvite in TeamWorkspace.jsx");
    assert.ok(/const res = await _fetch\("\/workspace\/invite"/.test(fnMatch[0]),
      "handleInvite must capture the response from /workspace/invite (not discard it)");
    assert.ok(/if \(res\?\.emailSent === false\)/.test(fnMatch[0]),
      "handleInvite must check res.emailSent before deciding which toast to show");
    assert.ok(/could not be sent: \$\{res\.emailError/.test(fnMatch[0]),
      "handleInvite must show the real emailError in its failure toast, not generic copy");
    ok("handleInvite reads the real response and shows the honest failure toast when the email didn't send");
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
