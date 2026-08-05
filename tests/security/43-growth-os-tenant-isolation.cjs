#!/usr/bin/env node
"use strict";
/**
 * Growth OS cross-tenant data leak regression —
 * backend/services/growthOS.cjs + backend/routes/growthOS.js.
 *
 * CONFIRMED finding (Founder Journey Completion — Marketing/Website/
 * Content pass, Phase A.4.2): the ENTIRE Growth OS backend (~800 lines,
 * campaigns/sequences/audiences/automations/templates/tags/events) had
 * zero org/tenant scoping anywhere — confirmed by grep, zero orgId
 * references in the whole file before this fix. Reproduced live: a
 * brand-new founder account's Growth Dashboard showed "64 Total
 * Campaigns" and pre-existing "Bench List"/"Bench Segment" audiences
 * created by the real, founder-triggerable "Run Benchmark" feature
 * (GrowthOS.jsx's BenchmarkPanel) run in prior sessions — genuine
 * cross-tenant data leakage of REAL data (not fabricated numbers),
 * triggered by a legitimate product feature whose side effects were never
 * isolated per tenant.
 *
 * A second, related leak was found in the same investigation:
 * sendWhatsAppBroadcast()'s fallback recipient list (when no audienceId
 * is set) called crm.getLeads() with no orgId — crmService.js already
 * supports org-scoped lookups (used correctly elsewhere), this call site
 * just never passed it, meaning a WhatsApp broadcast without an explicit
 * audience reached every CRM lead across every tenant, not just the
 * caller's own.
 *
 * Fix: recovered the exact same isolation pattern already established
 * elsewhere in this codebase (companyLifecycleEngine.cjs's
 * listCompanies({orgId}), platformOrg.js's server-side ownerId binding) —
 * every record now carries an orgId set server-side (via
 * organizationService.resolveContext(req.user.sub), the same primary-org
 * lookup attachOrg itself uses), and every list/get/dashboard/analytics
 * function filters by it. All 54 data-bearing routes in growthOS.js now
 * thread req.orgId through to the service layer (verified via static
 * sweep — the 4 routes NOT passing it are legitimately exempt: the auth
 * middleware registration itself, sendOTP which has no data lookup,
 * push/register which is accountId-scoped device-token registration, and
 * the static TRIGGER_TYPES/ACTION_TYPES constant endpoint).
 *
 * BUILTIN_TEMPLATES (the platform's own curated template library)
 * deliberately remain global/unscoped by design — not tenant data.
 *
 * This test drives the REAL app: real accounts, real signup, real HTTP
 * calls to real routes — not mocks.
 *
 * Requires: backend running on :5050 (this test does not start it).
 *
 * Usage: node tests/security/43-growth-os-tenant-isolation.cjs
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Registration is rate-limited to 5/15min per IP (backend/routes/accounts.js) —
// a legitimate anti-abuse control. Retry with backoff so this test is robust
// to running back-to-back with other suites/manual testing against the same
// dev server, rather than assuming a clean rate-limit budget.
async function registerAndLogin(email, password, attempt = 1) {
  const regRes = await fetch(`${BASE}/accounts/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Growth Isolation Test", email, password }),
  }).catch(() => null);

  if (regRes && regRes.status === 429 && attempt <= 5) {
    const body = await regRes.json().catch(() => ({}));
    const waitMs = Math.min((body.retryAfterSeconds || 30) * 1000, 30000);
    console.log(`  … registration rate-limited, waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt}/5)`);
    await sleep(waitMs);
    return registerAndLogin(email, password, attempt + 1);
  }

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

  section("A brand-new account's Growth Dashboard shows real zeros, not platform-wide totals");
  const emailFresh = `growth-fresh-${Date.now()}@ooplix-test.local`;
  const cookieFresh = await registerAndLogin(emailFresh, "GrowthFresh12345!");
  assert(!!cookieFresh, "a real authenticated session was obtained", "signup/login failed");
  if (!cookieFresh) { console.log(`\nPass: ${pass} Fail: ${fail}`); process.exit(fail > 0 ? 1 : 0); }

  const dashR = await fetch(`${BASE}/growth/dashboard`, { headers: { Cookie: cookieFresh } });
  const dashBody = await dashR.json().catch(() => null);
  assert(dashBody?.dashboard?.kpis?.totalCampaigns === 0, "a brand-new account's totalCampaigns is 0, not the platform-wide accumulated total", `got totalCampaigns=${dashBody?.dashboard?.kpis?.totalCampaigns}`);
  assert(dashBody?.dashboard?.kpis?.totalAudiences === 0, "a brand-new account's totalAudiences is 0", `got totalAudiences=${dashBody?.dashboard?.kpis?.totalAudiences}`);

  const audR = await fetch(`${BASE}/growth/audiences`, { headers: { Cookie: cookieFresh } });
  const audBody = await audR.json().catch(() => null);
  assert(Array.isArray(audBody?.audiences) && audBody.audiences.length === 0, "a brand-new account's audience list is empty (no leaked 'Bench List' fixtures)", `got ${JSON.stringify(audBody?.audiences)}`);

  section("Running the real Run Benchmark feature scopes its own fixtures to the caller's org");
  const emailA = `growth-bench-a-${Date.now()}@ooplix-test.local`;
  const cookieA = await registerAndLogin(emailA, "GrowthBenchA12345!");
  const benchR = await fetch(`${BASE}/growth/benchmark`, { headers: { Cookie: cookieA } });
  const benchBody = await benchR.json().catch(() => null);
  assert(typeof benchBody?.score === "number", "the benchmark runs and returns a real score", `got ${JSON.stringify(benchBody)}`);

  const dashAR = await fetch(`${BASE}/growth/dashboard`, { headers: { Cookie: cookieA } });
  const dashABody = await dashAR.json().catch(() => null);
  const campaignsAfterBench = dashABody?.dashboard?.kpis?.totalCampaigns ?? 0;
  assert(campaignsAfterBench > 0, "account A sees its OWN benchmark-created campaigns", `expected >0, got ${campaignsAfterBench}`);

  section("A completely separate account does NOT see account A's benchmark data");
  const emailB = `growth-bench-b-${Date.now()}@ooplix-test.local`;
  const cookieB = await registerAndLogin(emailB, "GrowthBenchB12345!");
  const dashBR = await fetch(`${BASE}/growth/dashboard`, { headers: { Cookie: cookieB } });
  const dashBBody = await dashBR.json().catch(() => null);
  assert(dashBBody?.dashboard?.kpis?.totalCampaigns === 0, "account B's totalCampaigns is 0 — does not see account A's benchmark campaigns", `got ${dashBBody?.dashboard?.kpis?.totalCampaigns}`);

  const audBR = await fetch(`${BASE}/growth/audiences`, { headers: { Cookie: cookieB } });
  const audBBody = await audBR.json().catch(() => null);
  const benchAudienceLeaked = (audBBody?.audiences || []).some(a => a.name?.startsWith("Bench"));
  assert(!benchAudienceLeaked, "account B does not see any of account A's 'Bench*' audiences", `leaked audiences: ${JSON.stringify(audBBody?.audiences)}`);

  section("Custom templates, automations, and tags are isolated per account");
  await fetch(`${BASE}/growth/templates`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookieA }, body: JSON.stringify({ type: "email", name: "Isolation Test Template", body: "hi" }) });
  await fetch(`${BASE}/growth/automations`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookieA }, body: JSON.stringify({ name: "Isolation Test Automation" }) });
  await fetch(`${BASE}/growth/tags`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookieA }, body: JSON.stringify({ name: "isolation-test-tag" }) });

  const tplBR = await fetch(`${BASE}/growth/templates?type=email`, { headers: { Cookie: cookieB } });
  const tplBBody = await tplBR.json().catch(() => null);
  const templateLeaked = (tplBBody?.templates || []).some(t => t.name === "Isolation Test Template");
  assert(!templateLeaked, "account B does not see account A's custom template", "custom template leaked across tenants");

  const autoBR = await fetch(`${BASE}/growth/automations`, { headers: { Cookie: cookieB } });
  const autoBBody = await autoBR.json().catch(() => null);
  const automationLeaked = (autoBBody?.automations || []).some(a => a.name === "Isolation Test Automation");
  assert(!automationLeaked, "account B does not see account A's automation", "automation leaked across tenants");

  const tagsBR = await fetch(`${BASE}/growth/tags`, { headers: { Cookie: cookieB } });
  const tagsBBody = await tagsBR.json().catch(() => null);
  const tagLeaked = (tagsBBody?.tags || []).some(t => t.name === "isolation-test-tag");
  assert(!tagLeaked, "account B does not see account A's tag", "tag leaked across tenants");

  section("WhatsApp broadcast fallback recipient list no longer leaks other tenants' CRM leads");
  const emailC = `growth-wa-c-${Date.now()}@ooplix-test.local`;
  const cookieC = await registerAndLogin(emailC, "GrowthWaC12345!");
  const createWaR = await fetch(`${BASE}/growth/whatsapp/broadcasts`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookieC }, body: JSON.stringify({ name: "Isolation WA Test", body: "hi" }) });
  const createWaBody = await createWaR.json().catch(() => null);
  if (createWaBody?.campaign?.id) {
    const sendR = await fetch(`${BASE}/growth/whatsapp/broadcasts/${createWaBody.campaign.id}/send`, { method: "POST", headers: { Cookie: cookieC } });
    const sendBody = await sendR.json().catch(() => null);
    assert(sendBody?.campaign?.stats?.sent === 0, "a brand-new account's audience-less WhatsApp broadcast reaches 0 recipients (its own real empty CRM), not other tenants' leads", `got sent=${sendBody?.campaign?.stats?.sent}`);
  } else {
    ko("WhatsApp broadcast created for isolation test", `create failed: ${JSON.stringify(createWaBody)}`);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Growth OS Tenant Isolation Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
