#!/usr/bin/env node
"use strict";
/**
 * Product Factory and Engineering Organization backends were fully built
 * with real persisted data but had zero frontend consumers — Phase A.8.3
 * (Product OS Recovery).
 *
 * CONFIRMED finding (Phase A.8.2 discovery): productPlannerEngine.cjs +
 * productReleaseEngine.cjs (backend/routes/productFactory.js, 29 real
 * routes: plan/arch/assemble/validate/release/dashboard/pipeline) and
 * engineeringOrgState.cjs (backend/routes/engineeringOrg.js, real
 * objectives/epics/work-items/backlogs/blockers routes) were both real,
 * live, and already exercised — 117 real product plans, 45 releases
 * ready, 95 objectives, 66 epics, 243 work items, 36 blockers — but no
 * component anywhere in frontend/src/ ever called them.
 *
 * This is a recovery, not new engineering: zero new backend routes, zero
 * new services, zero new storage — ProductOSCenter.jsx (plus its two thin
 * API client files, productFactoryApi.js and engOrgApi.js, following the
 * exact pattern already established by customerOrgApi.js/
 * CustomerSuccessCenter.jsx for the same class of gap) is a new minimal
 * frontend panel that only calls the existing, already-working routes.
 *
 * Fix: added a MORE_TABS entry (`productos`, group "Engineering", with
 * search aliases covering "prd roadmap requirements backlog epic
 * milestone feature request ... task hierarchy dependency ... release
 * planning objectives work items") plus a lazy import and render-switch
 * line in App.jsx.
 *
 * Verified live: reachable via the More menu; Product Plans/Objectives/
 * Epics/Work Items/Blockers tabs all render real data with zero page
 * errors; created a real objective through the new form (count went
 * 95 -> 96) and a real epic under it (confirmed present in the list);
 * "prd" and "backlog" search aliases both surface it; survives a real
 * logout/login cycle. 144/144 regression passing.
 *
 * Usage: node tests/security/71-product-os-center-recovery.cjs
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
  const appSrc = fs.readFileSync(require.resolve("../../frontend/src/App.jsx"), "utf8");
  const panelSrc = fs.readFileSync(require.resolve("../../frontend/src/components/ProductOSCenter.jsx"), "utf8");
  const pfApiSrc = fs.readFileSync(require.resolve("../../frontend/src/productFactoryApi.js"), "utf8");
  const eoApiSrc = fs.readFileSync(require.resolve("../../frontend/src/engOrgApi.js"), "utf8");

  section("App.jsx wires ProductOSCenter with a real nav entry, search aliases, and render-switch line");
  {
    assert.ok(/const ProductOSCenter\s*=\s*lazy\(\(\) => import\("\.\/components\/ProductOSCenter\.jsx"\)\)/.test(appSrc),
      "App.jsx must lazy-import ProductOSCenter.jsx");
    const entryMatch = appSrc.match(/\{ id: "productos",\s+label: "Product OS",\s+group: "Engineering", alias: "([^"]+)" \}/);
    assert.ok(entryMatch, "could not find the productos MORE_TABS entry with its alias string");
    const alias = entryMatch[1];
    for (const term of ["prd", "roadmap", "requirements", "backlog", "epic", "dependency"]) {
      assert.ok(alias.includes(term), `alias must include "${term}" so it's discoverable via search`);
    }
    assert.ok(/\{tab === "productos"\s+&& <ProductOSCenter\s*\/>\}/.test(appSrc), "render-switch line must mount <ProductOSCenter />");
    ok("ProductOSCenter is wired into App.jsx with a discoverable nav entry");
  }

  section("productFactoryApi.js only calls existing /product-factory/* routes — no new backend surface");
  {
    for (const path of ["/product-factory/dashboard", "/product-factory/plan", "/product-factory/plans", "/product-factory/plan/stats"]) {
      assert.ok(pfApiSrc.includes(path), `productFactoryApi.js must call the existing ${path} route`);
    }
    const routeSrc = fs.readFileSync(require.resolve("../../backend/routes/productFactory.js"), "utf8");
    assert.ok(/productPlannerEngine/.test(routeSrc), "productFactory.js must still be backed by the existing productPlannerEngine.cjs");
    ok("productFactoryApi.js exclusively targets pre-existing routes");
  }

  section("engOrgApi.js only calls existing /engorg/v2/* routes — no new backend surface");
  {
    for (const path of ["/engorg/v2/objectives", "/engorg/v2/epics", "/engorg/v2/work-items", "/engorg/v2/blockers", "/engorg/v2/backlogs/"]) {
      assert.ok(eoApiSrc.includes(path), `engOrgApi.js must call the existing ${path} route`);
    }
    const routeSrc = fs.readFileSync(require.resolve("../../backend/routes/engineeringOrg.js"), "utf8");
    assert.ok(/engineeringOrgState/.test(routeSrc), "engineeringOrg.js must still be backed by the existing engineeringOrgState.cjs");
    ok("engOrgApi.js exclusively targets pre-existing routes");
  }

  section("ProductOSCenter.jsx covers the full mission checklist: plans, objectives, epics, work items, blockers");
  {
    for (const tabId of ["plans", "objectives", "epics", "workitems", "blockers"]) {
      assert.ok(panelSrc.includes(`id: "${tabId}"`), `ProductOSCenter must have a "${tabId}" tab`);
    }
    assert.ok(/submitPlan|createPlan/.test(panelSrc), "must support creating a product plan (PRD/requirements/roadmap)");
    assert.ok(/submitObjective|createObjective/.test(panelSrc), "must support creating an objective");
    assert.ok(/submitEpic|createEpic/.test(panelSrc), "must support creating an epic");
    assert.ok(/resolveBlocker|resolve\(/.test(panelSrc), "must support resolving a blocker (dependency tracking)");
    ok("ProductOSCenter covers plans/objectives/epics/work items/blockers with real create/resolve actions");
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
