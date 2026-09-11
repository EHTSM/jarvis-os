#!/usr/bin/env node
"use strict";
/**
 * MFA (TOTP) Security Tests — Enterprise & Physical Integration Mission,
 * Module 4 upgrade.
 *
 * Tests policyService.cjs's MFA implementation directly (service-level,
 * no HTTP server needed for most of these — they exercise real otpauth
 * TOTP generation/verification, real secretVault AES-256-GCM storage, and
 * real replay-protection state):
 *
 *   1. Enrollment produces a real, spec-compliant otpauth:// URI + secret
 *   2. A real, independently-generated TOTP code verifies enrollment
 *   3. Enrollment issues real one-time recovery codes (cleartext once)
 *   4. Recovery codes are never stored in cleartext (only SHA-256 hashes)
 *   5. A valid recovery code authenticates and is then permanently consumed
 *   6. A used recovery code cannot be reused
 *   7. Replay protection — the same valid TOTP code cannot authenticate twice
 *   8. Clock drift — a code from an adjacent time-step still verifies
 *      within the configured drift window, but one further out does not
 *   9. Wrong code / wrong recovery code are both rejected
 *  10. Disable removes both the TOTP secret and recovery codes, and clears
 *      replay state, so isMfaEnrolled reflects false immediately
 *  11. Cross-account isolation — disabling/regenerating requires the
 *      account to act on itself, not an arbitrary other account
 *
 * Usage: node tests/security/07-mfa-security.cjs
 */

process.env.SKIP_PLATFORM_REGISTER = "1";
process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const otpauth = require("otpauth");
const policy  = require("../../backend/services/policyService.cjs");
const vault   = require("../../backend/services/secretVault.cjs");

let pass = 0, fail = 0;
const failures = [];

function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function makeTotp(secretBase32, accountId) {
  return new otpauth.TOTP({ issuer: "Ooplix", label: accountId, secret: otpauth.Secret.fromBase32(secretBase32), period: 30 });
}

async function main() {
  const testAccountId  = `test-mfa-sec-${Date.now()}`;
  const otherAccountId = `test-mfa-sec-other-${Date.now()}`;

  section("Enrollment");
  const enrolled = policy.enrollMfa(testAccountId);
  assert(typeof enrolled.secret === "string" && enrolled.secret.length > 0, "enrollMfa returns a secret", "no secret returned");
  assert(/^[A-Z2-7]+=*$/.test(enrolled.secret), "secret is valid base32", `got: ${enrolled.secret}`);
  assert(enrolled.uri.startsWith("otpauth://totp/"), "URI is a spec-compliant otpauth://totp/ URI", `got: ${enrolled.uri}`);
  assert(enrolled.uri.includes("issuer=Ooplix"), "URI carries issuer for authenticator app display", `got: ${enrolled.uri}`);
  assert(enrolled.uri.includes(`secret=${enrolled.secret}`), "URI embeds the same secret returned separately", "mismatch");

  section("Enrollment verification with a real TOTP code");
  const totp = makeTotp(enrolled.secret, testAccountId);
  const enrollCode = totp.generate();
  const verifyResult = policy.verifyMfaEnrollment(testAccountId, enrollCode);
  assert(verifyResult.ok === true, "real generated code verifies enrollment", JSON.stringify(verifyResult));
  assert(Array.isArray(verifyResult.recoveryCodes) && verifyResult.recoveryCodes.length === 10, "enrollment issues exactly 10 recovery codes", `got ${verifyResult.recoveryCodes?.length}`);
  const recoveryCodes = verifyResult.recoveryCodes;
  assert(recoveryCodes.every(c => /^[0-9a-f]{5}-[0-9a-f]{5}$/.test(c)), "recovery codes match the expected xxxxx-xxxxx hex format", JSON.stringify(recoveryCodes));

  section("Recovery codes are never stored in cleartext");
  const rawVaultRecord = vault.getSecret("mfa:recovery", "jwt_secret", `account:${testAccountId}`);
  let storedRecords = [];
  try { storedRecords = JSON.parse(rawVaultRecord); } catch { /* leave empty, assertion below will fail loudly */ }
  assert(Array.isArray(storedRecords) && storedRecords.length === 10, "10 recovery-code records are persisted", `got ${storedRecords.length}`);
  const anyCleartextLeak = storedRecords.some(r => recoveryCodes.includes(r.hash));
  assert(!anyCleartextLeak, "stored records contain hashes, not the cleartext codes themselves", "found a cleartext code in storage");
  assert(storedRecords.every(r => /^[0-9a-f]{64}$/.test(r.hash)), "every stored record is a 64-hex-char SHA-256 digest", JSON.stringify(storedRecords.map(r => r.hash)));
  assert(storedRecords.every(r => r.usedAt === null), "all recovery codes start unused", JSON.stringify(storedRecords));

  section("Recovery code authentication + single-use enforcement");
  const statusBefore = policy.getRecoveryCodeStatus(testAccountId);
  assert(statusBefore.total === 10 && statusBefore.remaining === 10, "recovery code status reports 10/10 remaining before use", JSON.stringify(statusBefore));
  const codeToUse = recoveryCodes[3];
  const firstUse = policy.verifyMfaCode(testAccountId, codeToUse);
  assert(firstUse === true, "a valid, unused recovery code authenticates successfully", "recovery code rejected");
  const statusAfter = policy.getRecoveryCodeStatus(testAccountId);
  assert(statusAfter.remaining === 9, "recovery code status decrements remaining count after use", JSON.stringify(statusAfter));
  const secondUse = policy.verifyMfaCode(testAccountId, codeToUse);
  assert(secondUse === false, "the same recovery code cannot be reused", "reused recovery code was accepted");

  section("Wrong codes are rejected");
  assert(policy.verifyMfaCode(testAccountId, "000000") === false, "an arbitrary wrong 6-digit code is rejected", "wrong code accepted");
  assert(policy.verifyMfaCode(testAccountId, "00000-00000") === false, "an arbitrary wrong recovery-code-shaped string is rejected", "wrong recovery code accepted");

  section("Replay protection — a valid TOTP code cannot authenticate twice");
  // Uses a fresh account/enrollment rather than testAccountId: enrollment
  // verification above already consumed testAccountId's *current* time-step,
  // and this whole test runs in well under 30s, so "generate now" on
  // testAccountId would resolve to that same already-consumed step — a
  // second, correctly-rejected use, not the "first use" this section means
  // to test. A separate account isolates the two scenarios cleanly.
  const replayAccountId = `${testAccountId}-replay`;
  const replayEnrolled = policy.enrollMfa(replayAccountId);
  const replayTotp = makeTotp(replayEnrolled.secret, replayAccountId);
  policy.verifyMfaEnrollment(replayAccountId, replayTotp.generate());
  // Enrollment verification consumed the step at "now". Step forward one
  // full period so this section starts from a genuinely unconsumed step.
  const freshCode = replayTotp.generate({ timestamp: Date.now() + 30_000 });
  const firstTotpUse = policy.verifyMfaCode(replayAccountId, freshCode);
  assert(firstTotpUse === true, "a fresh, valid TOTP code authenticates", "fresh TOTP code was rejected");
  const replayAttempt = policy.verifyMfaCode(replayAccountId, freshCode);
  assert(replayAttempt === false, "presenting the exact same TOTP code again is rejected (replay protection)", "replayed TOTP code was accepted a second time");
  policy.disableMfa(replayAccountId, replayAccountId);

  section("Clock drift tolerance (±1 step = ±30s by default)");
  // enrollMfa() alone (unlike verifyMfaEnrollment) writes the TOTP secret
  // without consuming any time-step, so verifyMfaCode can be exercised here
  // from a genuinely clean replay-state slate — isolating drift behavior
  // from replay-consumption behavior, which the section above already covers.
  const driftAccountId = `${testAccountId}-drift`;
  const driftSecret = policy.enrollMfa(driftAccountId);
  const driftTotp = makeTotp(driftSecret.secret, driftAccountId);
  const oneStepAgo = driftTotp.generate({ timestamp: Date.now() - 30_000 });
  const withinDrift = policy.verifyMfaCode(driftAccountId, oneStepAgo);
  assert(withinDrift === true, "a code from 1 step (30s) in the past verifies within the default drift window", "code within drift window was rejected");
  const threeStepsAgo = driftTotp.generate({ timestamp: Date.now() - 90_000 });
  const outsideDrift = policy.verifyMfaCode(driftAccountId, threeStepsAgo);
  assert(outsideDrift === false, "a code from 3 steps (90s) in the past is outside the default ±1-step drift window and is rejected", "code outside drift window was incorrectly accepted");
  policy.disableMfa(driftAccountId, driftAccountId);
  policy.disableMfa(`${testAccountId}-drift`, `${testAccountId}-drift`);

  section("Cross-account isolation");
  let rejectedCrossDisable = false;
  try { policy.disableMfa(testAccountId, otherAccountId); } catch (e) { rejectedCrossDisable = e.status === 403; }
  assert(rejectedCrossDisable, "an account cannot disable another account's MFA enrollment", "cross-account disable was not rejected");

  let rejectedCrossRegen = false;
  try { policy.regenerateRecoveryCodes(testAccountId, otherAccountId); } catch (e) { rejectedCrossRegen = e.status === 403; }
  assert(rejectedCrossRegen, "an account cannot regenerate another account's recovery codes", "cross-account regenerate was not rejected");

  section("Recovery code regeneration invalidates the old set");
  const regenResult = policy.regenerateRecoveryCodes(testAccountId, testAccountId);
  assert(regenResult.codes.length === 10, "regeneration issues a fresh set of 10 codes", `got ${regenResult.codes?.length}`);
  const oldCodeStillUnused = recoveryCodes.find(c => c !== codeToUse);
  const oldCodeStillWorks = policy.verifyMfaCode(testAccountId, oldCodeStillUnused);
  assert(oldCodeStillWorks === false, "a code from the OLD set no longer authenticates after regeneration", "old recovery code still worked after regeneration");
  const newCodeWorks = policy.verifyMfaCode(testAccountId, regenResult.codes[0]);
  assert(newCodeWorks === true, "a code from the NEW set authenticates after regeneration", "new recovery code did not work");

  section("Disable / reset flow");
  assert(policy.isMfaEnrolled(testAccountId) === true, "isMfaEnrolled reports true before disable", "expected enrolled");
  const disableResult = policy.disableMfa(testAccountId, testAccountId);
  assert(disableResult.ok === true && disableResult.deleted === true, "disableMfa succeeds and confirms deletion", JSON.stringify(disableResult));
  assert(policy.isMfaEnrolled(testAccountId) === false, "isMfaEnrolled reports false immediately after disable", "still reports enrolled");
  const statusAfterDisable = policy.getRecoveryCodeStatus(testAccountId);
  assert(statusAfterDisable.total === 0, "recovery codes are also removed on disable", JSON.stringify(statusAfterDisable));

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    ✗ ${f.msg}: ${f.reason}`));
  }

  try {
    require("fs").writeFileSync(
      require("path").join(process.cwd(), "data/mfa-security-test-report.json"),
      JSON.stringify({ generated: new Date().toISOString(), pass, fail, failures }, null, 2)
    );
    console.log("\n  Report: data/mfa-security-test-report.json\n");
  } catch { /* non-critical */ }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
