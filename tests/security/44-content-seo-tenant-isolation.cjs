#!/usr/bin/env node
"use strict";
/**
 * Content & SEO Engine (Growth OS G2) cross-tenant data leak regression —
 * backend/services/contentSEOEngine.cjs + backend/routes/contentSEO.js.
 *
 * CONFIRMED finding (Founder Journey Completion, Phase A.4.2 — Content pass,
 * immediately following the identical growthOS.cjs/G1 fix in
 * tests/security/43-growth-os-tenant-isolation.cjs): opening Blog Studio on
 * a real, long-lived test account showed 698 articles, the overwhelming
 * majority named "Test Camp — Complete Guide" / "Campaign: Q3 Revenue Test
 * <timestamp> — Complete Guide" with "0 words" bodies — accumulated
 * fixtures from every account that had ever run the real, founder-facing
 * "Benchmark" tab (runBenchmark()) across this entire multi-session
 * engagement. Confirmed by grep: contentSEOEngine.cjs (906 lines — Blog
 * Studio, SEO Command Center, Repurposing Engine, Landing Page Builder,
 * Docs Generator, Content Calendar, Keyword Intelligence, Brand Voice,
 * Dashboard, Benchmark) had zero orgId references anywhere, identical
 * architecture and identical bug class to growthOS.cjs (G1).
 *
 * Fix recovers the same pattern applied to G1: _scopedRecords()/
 * _ownedRecord() helpers, orgId threaded through every create/update/list/
 * get function across all 9 stateful modules, req.orgId resolved once via
 * router-level middleware in contentSEO.js (organizationService.
 * resolveContext) and passed to all 24 data-bearing routes.
 *
 * Deliberately left global/unscoped (not tenant data, same as
 * BUILTIN_TEMPLATES in G1): BUILTIN_KEYWORDS, DEFAULT_GLOSSARY / custom
 * glossary entries, brand-voice settings (already correctly scoped by their
 * own accountId parameter — a narrower, pre-existing, correct scheme this
 * fix does not touch).
 *
 * This test drives the REAL app: real accounts, real signup, real HTTP
 * calls to real routes — not mocks.
 *
 * Requires: backend running on :5050 (this test does not start it).
 *
 * Usage: node tests/security/44-content-seo-tenant-isolation.cjs
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
function sleep(ms)       { return new Promise(r => setTimeout(r, ms)); }

async function checkServerUp() {
  try { const r = await fetch(`${BASE}/health`); return r.ok; } catch { return false; }
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const first = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return first.split(";")[0];
}

// Registration is rate-limited to 5/15min per IP (backend/routes/accounts.js).
// Retry with backoff so this is robust to running alongside other suites.
async function registerAndLogin(email, password, attempt = 1) {
  const regRes = await fetch(`${BASE}/accounts/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Content SEO Isolation Test", email, password }),
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

  section("A brand-new account's Blog Studio / Content dashboard shows real zeros");
  const emailFresh = `cseo-fresh-${Date.now()}@ooplix-test.local`;
  const cookieFresh = await registerAndLogin(emailFresh, "CseoFresh12345!");
  assert(!!cookieFresh, "a real authenticated session was obtained", "signup/login failed");
  if (!cookieFresh) { console.log(`\nPass: ${pass} Fail: ${fail}`); process.exit(fail > 0 ? 1 : 0); }

  const artR = await fetch(`${BASE}/content/articles`, { headers: { Cookie: cookieFresh } });
  const artBody = await artR.json().catch(() => null);
  assert(Array.isArray(artBody?.articles) && artBody.articles.length === 0, "a brand-new account's article list is empty (no leaked benchmark fixtures)", `got ${artBody?.articles?.length}`);

  const dashR = await fetch(`${BASE}/content/dashboard`, { headers: { Cookie: cookieFresh } });
  const dashBody = await dashR.json().catch(() => null);
  assert(dashBody?.dashboard?.content?.totalArticles === 0, "a brand-new account's totalArticles is 0, not the platform-wide accumulated total", `got ${dashBody?.dashboard?.content?.totalArticles}`);
  assert(dashBody?.dashboard?.content?.totalLandingPages === 0, "a brand-new account's totalLandingPages is 0", `got ${dashBody?.dashboard?.content?.totalLandingPages}`);

  section("Running the real Content Benchmark scopes its own fixtures to the caller's org");
  const emailA = `cseo-bench-a-${Date.now()}@ooplix-test.local`;
  const cookieA = await registerAndLogin(emailA, "CseoBenchA12345!");
  const benchR = await fetch(`${BASE}/content/benchmark`, { headers: { Cookie: cookieA } });
  const benchBody = await benchR.json().catch(() => null);
  assert(typeof benchBody?.score === "number", "the benchmark runs and returns a real score", `got ${JSON.stringify(benchBody)}`);

  const dashAR = await fetch(`${BASE}/content/dashboard`, { headers: { Cookie: cookieA } });
  const dashABody = await dashAR.json().catch(() => null);
  const articlesAfterBench = dashABody?.dashboard?.content?.totalArticles ?? 0;
  assert(articlesAfterBench > 0, "account A sees its OWN benchmark-created articles", `expected >0, got ${articlesAfterBench}`);

  section("A completely separate account does NOT see account A's benchmark data");
  const emailB = `cseo-bench-b-${Date.now()}@ooplix-test.local`;
  const cookieB = await registerAndLogin(emailB, "CseoBenchB12345!");
  const dashBR = await fetch(`${BASE}/content/dashboard`, { headers: { Cookie: cookieB } });
  const dashBBody = await dashBR.json().catch(() => null);
  assert(dashBBody?.dashboard?.content?.totalArticles === 0, "account B's totalArticles is 0 — does not see account A's benchmark articles", `got ${dashBBody?.dashboard?.content?.totalArticles}`);

  const artBR = await fetch(`${BASE}/content/articles`, { headers: { Cookie: cookieB } });
  const artBBody = await artBR.json().catch(() => null);
  const benchArticleLeaked = (artBBody?.articles || []).some(a => a.title?.includes("Benchmark"));
  assert(!benchArticleLeaked, "account B does not see any of account A's 'Benchmark *' articles", `leaked: ${JSON.stringify(artBBody?.articles?.map(a=>a.title))}`);

  section("Landing pages, docs, keywords, and calendar entries are isolated per account");
  await fetch(`${BASE}/content/landing-pages`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookieA }, body: JSON.stringify({ name: "Isolation Test LP", audience: "testers", keyword: "isolation test" }) });
  await fetch(`${BASE}/content/docs`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookieA }, body: JSON.stringify({ type: "feature-guide", title: "Isolation Test Doc", body: "hi" }) });
  await fetch(`${BASE}/content/keywords`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookieA }, body: JSON.stringify({ keyword: "isolation test keyword", volume: 100 }) });
  await fetch(`${BASE}/content/calendar`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookieA }, body: JSON.stringify({ title: "Isolation Test Calendar Entry", type: "blog", channel: "blog" }) });

  const lpBR = await fetch(`${BASE}/content/landing-pages`, { headers: { Cookie: cookieB } });
  const lpBBody = await lpBR.json().catch(() => null);
  assert(!(lpBBody?.landingPages || []).some(lp => lp.name === "Isolation Test LP"), "account B does not see account A's landing page", "landing page leaked across tenants");

  const docBR = await fetch(`${BASE}/content/docs`, { headers: { Cookie: cookieB } });
  const docBBody = await docBR.json().catch(() => null);
  assert(!(docBBody?.docs || []).some(d => d.title === "Isolation Test Doc"), "account B does not see account A's doc", "doc leaked across tenants");

  const kwBR = await fetch(`${BASE}/content/keywords`, { headers: { Cookie: cookieB } });
  const kwBBody = await kwBR.json().catch(() => null);
  assert(!(kwBBody?.keywords || []).some(k => k.keyword === "isolation test keyword"), "account B does not see account A's custom keyword", "keyword leaked across tenants");

  const calBR = await fetch(`${BASE}/content/calendar`, { headers: { Cookie: cookieB } });
  const calBBody = await calBR.json().catch(() => null);
  assert(!(calBBody?.entries || []).some(e => e.title === "Isolation Test Calendar Entry"), "account B does not see account A's calendar entry", "calendar entry leaked across tenants");

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Content & SEO Tenant Isolation Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
