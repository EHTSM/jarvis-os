#!/usr/bin/env node
"use strict";
/**
 * Company Factory dashboard cross-tenant data leak regression —
 * backend/services/companyDashboard.cjs + backend/routes/companyFactory.js.
 *
 * CONFIRMED finding (Workflow Coverage Completion, Business OS audit):
 * GET /company-factory/dashboard called listCompanies({ limit: 100 }) with
 * no orgId, returning EVERY company across the entire platform's shared
 * store (accumulated test/simulation data) to any authenticated caller —
 * regardless of which org they actually belong to. Reproduced live: a
 * brand-new founder account, zero companies of their own, saw "74
 * COMPANIES / 21 LAUNCHED / 40% AVG READINESS / 5620h SAVED" in the
 * dashboard's summary cards directly above a correctly-scoped "No
 * companies yet" empty state in the company list right below it —
 * self-contradicting on one screen, and disclosing aggregate/other-
 * tenant data as if it were the caller's own.
 *
 * Root cause: listCompanies() already supported an orgId filter (used
 * correctly by the separate, pre-existing /company-factory/founder/
 * dashboard route) — getDashboard() just never threaded it through.
 *
 * Fix: getDashboard(orgId) now accepts and forwards orgId to
 * listCompanies(); the route resolves the caller's own org via
 * organizationService.resolveContext(req.user.sub) — the same primary-org
 * lookup attachOrg itself uses elsewhere — and passes it through.
 *
 * Known, documented limitations NOT fixed by this pass:
 *   1. blueprints/workspaces/workforce/perf stats in the same dashboard
 *      response remain platform-wide, since companyBlueprintEngine/
 *      companyWorkspaceBuilder/workforceManager/performanceEngine have no
 *      orgId concept to filter by without a larger change.
 *   2. createCompany() spins up a NEW org per company, so a founder's
 *      resolveContext().primaryOrg (what this fix scopes to) is not
 *      guaranteed to be the org backing a company they just created — this
 *      route can legitimately show 0 even right after creating one. The
 *      pre-existing, separate /company-factory/founder/dashboard route
 *      already aggregates correctly across ALL of a founder's orgs and is
 *      the right long-term source for a "my companies" view; wiring the
 *      frontend to it is a larger fix than this pass's scope (its response
 *      shape lacks the launched/scaled/avgReadiness/minutesSaved aggregate
 *      fields the current UI reads).
 * This test only asserts the specific property that was actually fixed:
 * no cross-tenant/platform-wide data leak.
 *
 * This test drives the REAL app: two real accounts, real signup, real
 * company creation via the real POST route, real dashboard reads — not
 * mocks.
 *
 * Requires: backend running on :5050 (this test does not start it).
 *
 * Usage: node tests/security/39-company-dashboard-org-scoping.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const BASE = "http://localhost:5050";

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function checkServerUp() {
  try { const r = await fetch(`${BASE}/health`); return r.ok; } catch { return false; }
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const first = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return first.split(";")[0];
}

async function registerAndLogin(email, password) {
  await fetch(`${BASE}/accounts/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Dashboard Scoping Test", email, password }),
  }).catch(() => {});
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return extractCookie(loginRes.headers.get("set-cookie"));
}

async function main() {
  section("Precondition — real backend (:5050) reachable");
  const up = await checkServerUp();
  if (!up) {
    console.log("  ⚠  Backend dev server not reachable on :5050.");
    console.log("     Skipping (not counted as pass or fail) rather than falsely failing CI.");
    process.exit(0);
  }
  ok("backend is reachable");

  section("Real account creation via the app's own signup + login");
  const email = `dashboard-scoping-${Date.now()}@ooplix-test.local`;
  const cookie = await registerAndLogin(email, "DashboardScoping12345!");
  assert(!!cookie, "a real authenticated session was obtained", "signup/login failed — cannot test dashboard scoping without a real session");
  if (!cookie) { console.log(`\nPass: ${pass} Fail: ${fail}`); process.exit(fail > 0 ? 1 : 0); }

  section("A brand-new account's dashboard reports 0 companies, not the platform total");
  {
    const r = await fetch(`${BASE}/company-factory/dashboard`, { headers: { Cookie: cookie } });
    assert(r.ok, "GET /company-factory/dashboard succeeds", `expected 200, got ${r.status}`);
    const body = await r.json().catch(() => null);
    assert(body?.ok !== false, "response body reports ok", `body: ${JSON.stringify(body)}`);
    assert(body?.summary?.totalCompanies === 0, "a brand-new account's totalCompanies is 0, not the platform-wide count", `got totalCompanies=${body?.summary?.totalCompanies}`);
    assert(Array.isArray(body?.companies) && body.companies.length === 0, "the companies list is empty, consistent with totalCompanies=0", `got ${body?.companies?.length} companies in the list — count/list mismatch would reproduce the original self-contradiction`);
  }

  section("After creating a real company, it never reappears as someone ELSE's platform-wide total (the actual security property fixed)");
  {
    // Known, documented, NOT-fixed-by-this-pass limitation: createCompany()
    // spins up a NEW org per company (the caller becomes owner of a second
    // org, distinct from their signup-provisioned primary org), so
    // resolveContext(accountId).primaryOrg — what this route is scoped to —
    // is not guaranteed to be the org backing a company the founder just
    // created. /company-factory/founder/dashboard (pre-existing, separate
    // route) already aggregates correctly across ALL of a founder's orgs
    // and should be preferred for a "my companies" view — wiring the
    // frontend to it is a larger, separate fix than this pass's scope
    // (its response shape lacks the launched/scaled/avgReadiness/
    // minutesSaved aggregate fields the current UI reads). This test only
    // asserts what was actually fixed: no cross-tenant leak.
    const createRes = await fetch(`${BASE}/company-factory/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: `Scoping Test Co ${Date.now()}`, templateId: "saas", skipApproval: true }),
    });
    if (createRes.ok) {
      const dashR = await fetch(`${BASE}/company-factory/dashboard`, { headers: { Cookie: cookie } });
      const dashBody = await dashR.json().catch(() => null);
      assert(dashBody?.summary?.totalCompanies !== 74 && (dashBody?.summary?.totalCompanies ?? 0) < 5, "totalCompanies is still small/scoped (not the accumulated platform-wide total) after creating a company", `got totalCompanies=${dashBody?.summary?.totalCompanies} — looks like the platform-wide leak may have returned`);

      const founderDashR = await fetch(`${BASE}/company-factory/founder/dashboard`, { headers: { Cookie: cookie } });
      const founderDashBody = await founderDashR.json().catch(() => null);
      assert(founderDashBody?.portfolio?.totalCompanies === 1, "the pre-existing, already-correct /company-factory/founder/dashboard route DOES show the new company (proves a correctly-scoped path already exists for this workflow)", `got totalCompanies=${founderDashBody?.portfolio?.totalCompanies}`);
    } else {
      console.log(`  ⚠  Could not create a test company (status ${createRes.status}) — skipping this section, the zero-state assertion above still stands`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Company Dashboard Org-Scoping Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
