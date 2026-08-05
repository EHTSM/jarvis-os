#!/usr/bin/env node
"use strict";
/**
 * Committed-credential regression — root markdown documentation files.
 *
 * CONFIRMED finding (Zero-Trust Competitor Remediation, Phase 1): a live-
 * format Razorpay key pair (`rzp_live_...` / a 24-char secret) and a
 * Firebase web API key (`AIzaSy...`) were pasted in plaintext into 6
 * tracked markdown files during earlier launch-readiness audits —
 * LAUNCH_BLOCKER_RETEST.md, PRODUCTION_ENV_AUDIT.md,
 * LAUNCH_READINESS_REPORT.md, RAZORPAY_PRODUCTION_GUIDE.md,
 * GO_LIVE_CERTIFICATION.md, PRODUCTION_HARDENING_REPORT.md. Confirmed at
 * current HEAD via `git show HEAD:<file>`, and independently confirmed the
 * Razorpay key is dead (HTTP 401 from Razorpay's live API) both before and
 * after redaction — reduced blast radius, but the underlying process
 * failure (secrets pasted into "audit" docs as a matter of habit) is the
 * actual finding.
 *
 * Fix: all 6 files redacted (values replaced with
 * `<REDACTED-see-SECURITY.md>`), SECURITY.md updated to document the
 * incident and correct its previously-inaccurate "never committed to
 * source control" claim.
 *
 * This test is a static content scan, not a runtime/HTTP test — it greps
 * every tracked *.md file at the repo root for the specific credential
 * patterns found in this incident (live Razorpay key prefix, Firebase web
 * API key prefix) to catch a real secret being pasted into documentation
 * again. It is intentionally narrow (documented incident patterns, not a
 * general-purpose secret scanner) — building a general secret-scanning
 * tool was out of scope for this remediation.
 *
 * Usage: node tests/security/25-no-committed-credentials.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

// Patterns matching the exact secret shapes found in this incident.
// Deliberately specific (not a broad "any base64-looking string" heuristic)
// to avoid false positives on the many legitimate hex ids / hashes already
// present throughout this repo's docs. Excludes placeholder patterns like
// `rzp_live_XXXXXXXXXXXX` (repeated X's / literal "REDACTED") — those are
// legitimate documentation placeholders, not real leaked values; requiring
// at least one digit and one lowercase letter in the suffix distinguishes
// a real key (mixed-case alphanumeric) from an all-X or all-caps placeholder.
const CREDENTIAL_PATTERNS = [
  { name: "Razorpay live key id",  re: /rzp_live_(?=[A-Za-z0-9]*[0-9])(?=[A-Za-z0-9]*[a-z])[A-Za-z0-9]{10,}/ },
  { name: "Firebase web API key",  re: /AIzaSy(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[a-z])[A-Za-z0-9_-]{25,}/ },
];

const ROOT_MD_FILES = fs.readdirSync(process.cwd()).filter(f => f.endsWith(".md"));

section("Static scan — tracked root markdown files contain no live-format credentials");
{
  let trackedFiles;
  try {
    trackedFiles = execFileSync("git", ["ls-files", "*.md"], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch (e) {
    ko("git ls-files succeeds", e.message);
    trackedFiles = ROOT_MD_FILES; // fall back to scanning what's on disk
  }

  const rootTrackedMd = trackedFiles.filter(f => !f.includes("/") && f.endsWith(".md"));
  assert(rootTrackedMd.length > 50, "sanity check: root has the expected large number of tracked markdown files", `found only ${rootTrackedMd.length} — glob or cwd may be wrong`);

  let violations = [];
  for (const file of rootTrackedMd) {
    let content;
    try { content = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const { name, re } of CREDENTIAL_PATTERNS) {
      const m = content.match(re);
      if (m) violations.push({ file, pattern: name, match: m[0].slice(0, 12) + "…" });
    }
  }
  assert(violations.length === 0, "no tracked root .md file contains a live Razorpay key or Firebase API key pattern", `found: ${JSON.stringify(violations)}`);
}

section("Specific incident files — redaction marker present, original secret absent");
{
  const incidentFiles = {
    "LAUNCH_BLOCKER_RETEST.md":       ["rzp_live_Sefw02YRABlczU", "id3u0bf14Jq5NhfhZ5GFjQ3e"],
    "PRODUCTION_ENV_AUDIT.md":        ["rzp_live_Sefw02YRABlczU"],
    "LAUNCH_READINESS_REPORT.md":     ["rzp_live_Sefw02YRABlczU"],
    "RAZORPAY_PRODUCTION_GUIDE.md":   ["rzp_live_Sefw02YRABlczU"],
    "GO_LIVE_CERTIFICATION.md":       ["AIzaSyCIhQBxv0DWHQZim4biE_2cTiM9n6tcx_M"],
    "PRODUCTION_HARDENING_REPORT.md": ["AIzaSyCIhQBxv0DWHQZim4biE_2cTiM9n6tcx_M"],
  };
  for (const [file, secrets] of Object.entries(incidentFiles)) {
    if (!fs.existsSync(file)) { ok(`${file} no longer exists (nothing to check)`); continue; }
    const content = fs.readFileSync(file, "utf8");
    for (const secret of secrets) {
      assert(!content.includes(secret), `${file} does not contain the original secret value`, `found "${secret.slice(0,8)}…" still present`);
    }
    assert(content.includes("REDACTED"), `${file} contains a redaction marker in place of the removed secret`, "no REDACTED marker found — content may have been deleted rather than redacted-in-place, or restored unredacted");
  }
}

section("SECURITY.md documents the incident and no longer makes a false blanket claim");
{
  const content = fs.readFileSync("SECURITY.md", "utf8");
  assert(!/All production secrets in `\.env` — never committed to source control/.test(content), "SECURITY.md no longer claims secrets were never committed (this incident proves that claim was false)", "the old, now-inaccurate claim is still present verbatim");
  assert(/Known past incident/.test(content), "SECURITY.md documents the committed-credential incident", "no incident note found");
  assert(/2026-08-05/.test(content), "SECURITY.md's Disclosure History table includes this incident's date", "no dated entry found");
}

console.log(`\n${"=".repeat(60)}`);
console.log(`No-Committed-Credentials Regression: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
  process.exit(1);
}
process.exit(0);
