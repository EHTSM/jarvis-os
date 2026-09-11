#!/usr/bin/env node
"use strict";
/**
 * Organization "Executive Intelligence" tab crashed on every load — Phase
 * A.9 (Enterprise Certification, Executive section).
 *
 * CONFIRMED finding (reproduced live: real enterprise account, Organization
 * -> Executive Intelligence): a genuine, 100% reproducible error boundary
 * catch — "Something went wrong — The orgadmin panel encountered an error.
 * summary.summary.map is not a function".
 *
 * Root cause: backend/services/orgExecutiveIntelligence.cjs's
 * getOperationalSummary() builds an array of lines internally, then
 * deliberately returns `summary: lines.join(" ")` — a single joined
 * STRING, never an array. frontend/src/components/OrgAdminCenter.jsx's
 * render code assumed `summary.summary` was still the array of lines
 * (`summary.summary.map((line, i) => ...)`), which always throws on a
 * string. This is not a data-quality edge case — the backend always
 * returns a string here, so the crash was 100% reproducible on every
 * single load, for every organization.
 *
 * Fix: render the real string directly instead of calling .map() on it.
 * No backend change — the backend's shape was already correct and
 * intentional (a human-readable one-line summary), only the frontend's
 * assumption about that shape was wrong.
 *
 * Verified live: Executive Intelligence now renders the full summary
 * sentence plus real KPI tiles (Connector Health, AI Spend, Knowledge
 * Nodes, Active Automations) and real recommendations, with zero errors.
 * 144/144 regression passing.
 *
 * Usage: node tests/security/72-org-executive-intelligence-summary-crash.cjs
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
  const svcSrc = fs.readFileSync(require.resolve("../../backend/services/orgExecutiveIntelligence.cjs"), "utf8");
  const uiSrc  = fs.readFileSync(require.resolve("../../frontend/src/components/OrgAdminCenter.jsx"), "utf8");

  section("Backend genuinely returns summary as a joined string (confirms the bug's real trigger)");
  {
    const fnMatch = svcSrc.match(/function getOperationalSummary\(orgId, accountId\) \{[\s\S]*?\n\}/);
    assert.ok(fnMatch, "could not find getOperationalSummary");
    assert.ok(/summary:\s*lines\.join\(" "\)/.test(fnMatch[0]),
      "getOperationalSummary must return summary as lines.join(' ') — a string, never an array");
    ok("confirmed: the backend always returns summary as a single string");
  }

  section("Frontend no longer calls .map() on the string summary field");
  {
    assert.ok(!/\{summary\.summary\.map\(/.test(uiSrc),
      "the crash-prone summary.summary.map() call must no longer be used in JSX rendering");
    assert.ok(/\{summary\.summary\}/.test(uiSrc),
      "the real string must be rendered directly, not iterated as an array");
    ok("OrgAdminCenter.jsx renders the real string summary directly");
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
