#!/usr/bin/env node
"use strict";
/**
 * Ecosystem OS recovery — Product OS tenant isolation + forged-header
 * cross-tenant access across /dev/*, /product-factory/*, /customer-org/*.
 *
 * Ecosystem OS pass (2026-08-15). Per this pass's mandate (Section 3):
 * investigate whether Product OS's previously-documented "architectural
 * gap" (0/5 tenant isolation, from the earlier same-day Product OS pass)
 * could actually be safely recovered rather than left as a permanent
 * finding. It could: grep confirmed zero other services call the 5 Product
 * Factory engines' data functions (only productFactory.js and
 * ProductOSCenter.jsx do), so real org-scoping was retrofittable with zero
 * blast radius, following the exact precedent already proven for Developer
 * OS (developerOS.cjs, C10-003).
 *
 * ── FIX A: Product OS tenant isolation (this pass, new)
 * All 5 Product Factory engines (productPlannerEngine, productArchitectureEngine,
 * productAssemblyEngine, productValidationEngine, productReleaseEngine) plus
 * productFactoryDashboard.getProductView() now require and filter by orgId,
 * following the exact "orgId required, pre-existing unowned records
 * invisible not misattributed" contract developerOS.cjs already established.
 * Live-reproduced BEFORE this fix: account B, member of Org B only, could
 * list every plan platform-wide (~50 including dozens of legacy test
 * plans), read Org A's plan by direct id in full, and successfully WRITE
 * (run architecture design) against Org A's plan. All three vectors
 * confirmed closed after the fix.
 *
 * ── FIX B: /dev/* forged X-Org-Id header bypass (this pass, new — found
 * while verifying Fix A against its own cited precedent)
 * ops.js's /dev/* gate (router.use("/dev", requireAuth, attachOrg)) relied
 * on attachOrg alone, which resolves req.org from a client-supplied
 * X-Org-Id header with NO membership verification (attachOrg is explicitly
 * documented as non-blocking). Live-reproduced: account B, with X-Org-Id
 * forged to account A's real org, both LISTED and CREATED repos under
 * account A's org — a real cross-tenant read AND write. Fixed by adding
 * requireOrgMember to the same gate.
 *
 * ── FIX C: /customer-org/* forged-header "verified nobody" leak (this
 * pass, new — a different, inverted shape of the same root problem)
 * customerOrg.js's own _orgId(req) helper correctly returned null for a
 * forged header the caller isn't a real member of — but every downstream
 * service function (customerHealthEngine.listHealthRecords, and the same
 * pattern elsewhere in the file) treats a null orgId as "don't filter",
 * not "return nothing" (a legitimate design for genuinely unscoped/
 * operator callers elsewhere). This created an INVERTED vulnerability: an
 * account with a forged header for an org it does NOT belong to received
 * MORE data (the entire platform-wide record set, ~58 real records across
 * many orgs) than a genuine member of its own (empty) org. Fixed by adding
 * requireOrgMember to the router-level gate, closing the "verified nobody"
 * path before any handler runs.
 *
 * Usage: node tests/security/113-ecosystem-os-tenant-isolation-recovery.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function main() {
  section("Fix A — Product Factory services require and filter by orgId (static check)");
  {
    const files = [
      "backend/services/productPlannerEngine.cjs",
      "backend/services/productArchitectureEngine.cjs",
      "backend/services/productAssemblyEngine.cjs",
      "backend/services/productValidationEngine.cjs",
      "backend/services/productReleaseEngine.cjs",
    ];
    for (const f of files) {
      const src = require("fs").readFileSync(f, "utf8");
      assert(src.includes("_requireOrgId(orgId,"), `${f} calls _requireOrgId on its data-access functions`, "no _requireOrgId call found");
      assert(src.includes("_ownedBy(") , `${f} filters records via _ownedBy(item, orgId)`, "no _ownedBy filter found");
    }
  }

  section("Fix A — productFactory.js threads req.org.id into every service call (static check)");
  {
    const src = require("fs").readFileSync("backend/routes/productFactory.js", "utf8");
    assert(src.includes("requireOrgMember"), "route requires real org membership, not just attachOrg alone");
    assert(/ppe\(\)\.createPlan\(\{ objective, orgId: req\.org\.id/.test(src), "createPlan call passes req.org.id");
    assert(/pae\(\)\.design\(req\.org\.id,/.test(src), "design call passes req.org.id");
    assert(/pasm\(\)\.assemble\(req\.org\.id,/.test(src), "assemble call passes req.org.id");
    assert(/pve\(\)\.validate\(req\.org\.id,/.test(src), "validate call passes req.org.id");
    assert(/pre\(\)\.prepare\(req\.org\.id,/.test(src), "prepare call passes req.org.id");
  }

  section("Fix B — ops.js's /dev/* gate requires real org membership, not attachOrg alone (static check)");
  {
    const src = require("fs").readFileSync("backend/routes/ops.js", "utf8");
    assert(/router\.use\("\/dev",\s*requireAuth,\s*attachOrg,\s*requireOrgMember\)/.test(src), "requireOrgMember is chained onto the same /dev gate as requireAuth+attachOrg");
  }

  section("Fix C — customerOrg.js's gate requires real org membership, not attachOrg alone (static check)");
  {
    const src = require("fs").readFileSync("backend/routes/customerOrg.js", "utf8");
    assert(/router\.use\("\/customer-org",\s*requireAuth,\s*attachOrg,\s*requireOrgMember\)/.test(src), "requireOrgMember is chained onto the same /customer-org gate as requireAuth+attachOrg");
  }

  section("Unit-level — the shared operatorOnly-class fix pattern behaves correctly (requireOrgMember)");
  {
    const { requireOrgMember } = require("../../backend/middleware/orgMiddleware.cjs");
    const resStub = () => { let code, body; return { status(c) { code = c; return this; }, json(b) { body = b; return this; }, _code: () => code, _body: () => body }; };

    // No org resolved at all (attachOrg found nothing) → 404, not a silent pass.
    let called = false;
    const r1 = resStub();
    requireOrgMember({ org: null, orgRole: null, user: { sub: "acct1" } }, r1, () => { called = true; });
    assert(called === false && r1._code() === 404, "no resolvable org → 404 (not silently allowed through)");

    // A real org resolved but the caller has no role in it (the forged-header case) → 403.
    called = false;
    const r2 = resStub();
    const _orgSvcPath = require.resolve("../../backend/services/organizationService.cjs");
    const orgSvc = require(_orgSvcPath);
    const origIsEnterpriseAdmin = orgSvc.isEnterpriseAdmin;
    const origListGrants = orgSvc.listGrantsForAccount;
    orgSvc.isEnterpriseAdmin = () => false;
    orgSvc.listGrantsForAccount = () => [];
    try {
      requireOrgMember({ org: { id: "org_foreign" }, orgRole: null, user: { sub: "acct1" } }, r2, () => { called = true; });
      assert(called === false && r2._code() === 403, "a real org with no real membership role (the forged-header shape) → 403, never silently passed through");
    } finally {
      orgSvc.isEnterpriseAdmin = origIsEnterpriseAdmin;
      orgSvc.listGrantsForAccount = origListGrants;
    }

    // A real org WITH a real role → passes.
    called = false;
    const r3 = resStub();
    requireOrgMember({ org: { id: "org_real" }, orgRole: "member", user: { sub: "acct1" } }, r3, () => { called = true; });
    assert(called === true, "a real org with a real membership role → passes through (legitimate access unaffected)");
  }

  console.log(`\n${"=".repeat(60)}\n  Pass: ${pass}   Fail: ${fail}\n${"=".repeat(60)}`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main();
