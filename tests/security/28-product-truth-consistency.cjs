#!/usr/bin/env node
"use strict";
/**
 * Product-truth consistency regression — README.md / SECURITY.md vs.
 * package.json and the actual regression suite.
 *
 * CONFIRMED findings (Zero-Trust Competitor Remediation, Phase 3):
 * README.md's version badge claimed "3.0.0" while package.json says
 * "1.0.0-rc6" and the latest actual GitHub release is "v1.0.0-rc8"
 * (pre-release) — three different numbers for the same product.
 * SECURITY.md's "Supported Versions" table made the same false "3.x"
 * claim, and its own logic implied the actually-shipping 1.x line was
 * "End of life." README.md's Roadmap table also listed "Team accounts
 * (multi-seat, RBAC)" as "Planned" despite organizationService.cjs
 * already implementing a real Org/Dept/Team RBAC system (6 roles,
 * cross-org grants, enterprise admin) — independently verified real
 * during this same remediation's IDOR fixes (tests/security/23, 24).
 *
 * Fix: README.md's version badge now matches package.json exactly.
 * SECURITY.md's Supported Versions table now matches package.json.
 * README.md's Roadmap table corrected to list RBAC as Shipped.
 *
 * This test is a static content/consistency check — it does not verify
 * the roadmap table is exhaustively accurate (that would require ongoing
 * human judgment), only that the SPECIFIC claims fixed in this pass don't
 * silently drift back out of sync with package.json.
 *
 * Usage: node tests/security/28-product-truth-consistency.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const readme = fs.readFileSync("README.md", "utf8");
const security = fs.readFileSync("SECURITY.md", "utf8");

section("README.md version badge matches package.json");
{
  const badgeMatch = readme.match(/badge\/version-([^-]+(?:--[a-z0-9]+)?)-/);
  assert(!!badgeMatch, "README.md contains a parseable version badge", "no version badge pattern found — README structure may have changed");
  if (badgeMatch) {
    // shields.io badges escape literal hyphens in the value as `--`
    const badgeVersion = badgeMatch[1].replace(/--/g, "-");
    assert(badgeVersion === pkg.version, `README.md's version badge ("${badgeVersion}") matches package.json's version ("${pkg.version}")`, `mismatch: badge says "${badgeVersion}", package.json says "${pkg.version}"`);
  }
}

section("SECURITY.md's Supported Versions table references the real current version");
{
  assert(security.includes(pkg.version), `SECURITY.md's Supported Versions table mentions the real current version ("${pkg.version}")`, `"${pkg.version}" not found anywhere in SECURITY.md`);
  assert(!/\b3\.x \(current\)/.test(security), "SECURITY.md no longer falsely claims '3.x (current)'", "the old false '3.x (current)' claim is still present");
}

section("README.md Roadmap table does not list an already-shipped RBAC system as 'Planned'");
{
  // The specific fixed claim: RBAC must not appear under a 📋 Planned row.
  const plannedRbacPattern = /📋 Planned \| Team accounts \(multi-seat, RBAC\)/;
  assert(!plannedRbacPattern.test(readme), "README.md's Roadmap no longer lists 'Team accounts (multi-seat, RBAC)' as Planned", "the old inaccurate 'Planned RBAC' row is still present");
  assert(/RBAC/.test(readme) && /✅ Shipped/.test(readme), "README.md's Roadmap credits RBAC as shipped somewhere", "no Shipped+RBAC combination found");

  // Cross-check against the actual code, not just trusting the doc edit:
  // organizationService.cjs must genuinely export the RBAC primitives the
  // roadmap now claims exist.
  const orgSvc = require("../../backend/services/organizationService.cjs");
  assert(typeof orgSvc.hasPermission === "function", "organizationService.cjs genuinely exports hasPermission (RBAC enforcement primitive)", "hasPermission is not exported — the roadmap claim would be false");
  assert(typeof orgSvc.getMemberRole === "function", "organizationService.cjs genuinely exports getMemberRole (RBAC primitive)", "getMemberRole is not exported — the roadmap claim would be false");
  assert(typeof orgSvc.grantOrgAccess === "function", "organizationService.cjs genuinely exports grantOrgAccess (cross-org grants, matches the roadmap's specific claim)", "grantOrgAccess is not exported");
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Product Truth Consistency Regression: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
  process.exit(1);
}
process.exit(0);
