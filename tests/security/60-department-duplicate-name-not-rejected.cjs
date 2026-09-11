#!/usr/bin/env node
"use strict";
/**
 * Department duplicate-name-not-rejected regression — Phase A.6 (Business
 * Owner Certification, Organization section).
 *
 * CONFIRMED finding (reproduced live: real signup, real org, Organization
 * → Departments → "+ New department"): creating "Engineering" twice
 * (across two separate real UI/API interactions, ~62 seconds apart)
 * silently succeeded both times — two distinct department records, both
 * named "Engineering", confirmed via GET /orgs/:orgId/departments
 * returning both with different IDs and no error at creation time.
 *
 * Root cause: organizationService.cjs's createDepartment() validated only
 * that `name` was non-empty — no check against existing department names
 * in the same org, so nothing prevented (or even warned about) an exact
 * or case-variant duplicate.
 *
 * Fix: mirrors the exact pattern createOrg() (same file) already uses for
 * its own name/slug collision — Object.assign(new Error(...), {status:
 * 409}) — no new mechanism. Case-insensitive comparison, since a founder
 * thinks of "Engineering" and "engineering" as the same department.
 *
 * The frontend (OrgAdminCenter.jsx's DepartmentsPanel) already correctly
 * surfaces r.ok === false via onToast — no frontend change was needed,
 * only the missing backend validation.
 *
 * Verified live: creating "Sales" succeeds (200); creating "sales"
 * (different case) is rejected with 409 and a clear, real error message.
 *
 * Usage: node tests/security/60-department-duplicate-name-not-rejected.cjs
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
  const src = fs.readFileSync(require.resolve("../../backend/services/organizationService.cjs"), "utf8");

  section("Fix: createDepartment() checks for a case-insensitive name collision");
  {
    const fnMatch = src.match(/function createDepartment\([\s\S]*?\n\}/);
    assert.ok(fnMatch, "could not find createDepartment() in organizationService.cjs");
    assert.ok(/normalizedName = name\.trim\(\)\.toLowerCase\(\)/.test(fnMatch[0]),
      "createDepartment() must normalize the incoming name (trim + lowercase) for comparison");
    assert.ok(/org\.departments \|\| \[\]\)\.some\(d => d\.name\.trim\(\)\.toLowerCase\(\) === normalizedName\)/.test(fnMatch[0]),
      "createDepartment() must check existing departments for a case-insensitive name match");
    ok("createDepartment() normalizes and compares against existing department names case-insensitively");
  }

  section("Fix: the collision throws a 409 with a real, specific message — same shape as createOrg()'s existing pattern");
  {
    const fnMatch = src.match(/function createDepartment\([\s\S]*?\n\}/);
    assert.ok(/Object\.assign\(new Error\(`A department named/.test(fnMatch[0]),
      "the collision error must be Object.assign(new Error(...), {status: 409}) — the same shape createOrg() already uses");
    assert.ok(/status: 409/.test(fnMatch[0]), "the collision error must set status: 409");
    ok("collision throws Object.assign(Error, {status: 409}) with a real message, mirroring createOrg()'s existing pattern");
  }

  section("Regression: the non-empty-name validation and department object shape are unchanged");
  {
    const fnMatch = src.match(/function createDepartment\([\s\S]*?\n\}/);
    assert.ok(/if \(!name\?\.trim\(\)\) throw new Error\("Department name is required"\)/.test(fnMatch[0]),
      "the pre-existing empty-name validation must remain untouched");
    assert.ok(/id:\s*_id\("dept"\)/.test(fnMatch[0]), "the department object's id generation must remain untouched");
    ok("pre-existing validation and department object construction are unchanged — fix is additive");
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
