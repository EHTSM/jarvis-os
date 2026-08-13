#!/usr/bin/env node
"use strict";
/**
 * Distribution Engine (Growth OS G3) cross-tenant data leak regression —
 * backend/services/distributionEngine.cjs + backend/routes/distribution.js.
 *
 * CONFIRMED finding (Founder Journey Completion, Phase A.4.2 — Content pass,
 * immediately following the identical fixes in growthOS.cjs/G1 and
 * contentSEOEngine.cjs/G2 — see tests/security/43 and 44): opening the
 * "Distribution" tab (breadcrumb: Growth › Distribution) on a real,
 * long-lived test account showed a fully populated Executive Growth Center
 * — 3,640 total reach, 746 community members, an active referral
 * leaderboard — despite this account never having used any distribution
 * features. Confirmed by grep: distributionEngine.cjs (1035 lines —
 * Universal Publisher, Campaign Orchestrator, Influencer Outreach,
 * Community Hub, Referral Campaign Manager, Launch Manager, Distribution
 * Analytics, Content Performance AI, Executive Growth Center, Benchmark)
 * had zero orgId references anywhere — the third instance of the identical
 * bug class found in this Growth OS suite.
 *
 * Fix recovers the same pattern applied to G1/G2: _scopedRecords()/
 * _ownedRecord() helpers, orgId threaded through every create/update/list/
 * get across all 9 stateful modules, req.orgId resolved once via
 * router-level middleware in distribution.js, passed to 39 of 41 routes
 * (the 2 unscoped routes are legitimately exempt — static platform list,
 * pure-computation publishing-time optimizer).
 *
 * Deliberately NOT touched: referralEngine.cjs (a separate, already-correct
 * service keyed by accountId — its getLeaderboard() is an intentional
 * cross-account leaderboard feature, not a per-tenant data leak; verified
 * it exposes no PII or other tenant's business data, only accountId/
 * invites/totalEarned rankings).
 *
 * This test drives the REAL app: real accounts, real signup, real HTTP
 * calls to real routes — not mocks.
 *
 * Requires: backend running on :5050 (this test does not start it).
 *
 * Usage: node tests/security/45-distribution-tenant-isolation.cjs
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
async function registerAndLogin(email, password, attempt = 1) {
  const regRes = await fetch(`${BASE}/accounts/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Distribution Isolation Test", email, password }),
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

  section("A brand-new account's Executive Growth Center shows real zeros");
  const emailFresh = `distrib-fresh-${Date.now()}@ooplix-test.local`;
  const cookieFresh = await registerAndLogin(emailFresh, "DistribFresh12345!");
  assert(!!cookieFresh, "a real authenticated session was obtained", "signup/login failed");
  if (!cookieFresh) { console.log(`\nPass: ${pass} Fail: ${fail}`); process.exit(fail > 0 ? 1 : 0); }

  const execR = await fetch(`${BASE}/distrib/executive`, { headers: { Cookie: cookieFresh } });
  const execBody = await execR.json().catch(() => null);
  // Phase OS-4: this used to assert traffic.totalReach === 0 as the proxy for
  // "a new tenant sees none of the platform's accumulated data". totalReach is
  // now null by design — no platform analytics connector exists, so reach is
  // NOT MEASURED and reporting 0 would falsely assert zero observed reach.
  // The isolation intent is unchanged and is now anchored on publishJobs, a
  // genuinely counted, tenant-scoped value. This is a stronger signal than the
  // old one, not a weaker one: it counts real records rather than a derived
  // metric that was fabricated before OS-3.
  assert(execBody?.dashboard?.traffic?.publishJobs === 0, "a brand-new account's publishJobs is 0, not the platform-wide accumulated total", `got ${execBody?.dashboard?.traffic?.publishJobs}`);
  assert(execBody?.dashboard?.traffic?.totalReach === null, "unmeasured reach is reported as null, never as a fabricated number", `got ${execBody?.dashboard?.traffic?.totalReach}`);
  assert(execBody?.dashboard?.community?.totalMembers === 0, "a brand-new account's community totalMembers is 0", `got ${execBody?.dashboard?.community?.totalMembers}`);
  assert(execBody?.dashboard?.campaigns?.total === 0, "a brand-new account's campaign total is 0", `got ${execBody?.dashboard?.campaigns?.total}`);

  const commR = await fetch(`${BASE}/distrib/communities`, { headers: { Cookie: cookieFresh } });
  const commBody = await commR.json().catch(() => null);
  assert(Array.isArray(commBody?.communities) && commBody.communities.length === 0, "a brand-new account's community list is empty (no leaked fixtures)", `got ${commBody?.communities?.length}`);

  section("Running the real Distribution Benchmark scopes its own fixtures to the caller's org");
  const emailA = `distrib-bench-a-${Date.now()}@ooplix-test.local`;
  const cookieA = await registerAndLogin(emailA, "DistribBenchA12345!");
  const benchR = await fetch(`${BASE}/distrib/benchmark`, { headers: { Cookie: cookieA } });
  const benchBody = await benchR.json().catch(() => null);
  assert(typeof benchBody?.score === "number", "the benchmark runs and returns a real score", `got ${JSON.stringify(benchBody)}`);

  const execAR = await fetch(`${BASE}/distrib/executive`, { headers: { Cookie: cookieA } });
  const execABody = await execAR.json().catch(() => null);
  // Same OS-4 re-anchor: count the benchmark's own publish jobs rather than a
  // reach figure that is no longer fabricated into existence.
  const jobsAfterBench = execABody?.dashboard?.traffic?.publishJobs ?? 0;
  assert(jobsAfterBench > 0, "account A sees its OWN benchmark-created publish jobs/campaigns", `expected >0, got ${jobsAfterBench}`);

  section("A completely separate account does NOT see account A's benchmark data");
  const emailB = `distrib-bench-b-${Date.now()}@ooplix-test.local`;
  const cookieB = await registerAndLogin(emailB, "DistribBenchB12345!");
  const execBR = await fetch(`${BASE}/distrib/executive`, { headers: { Cookie: cookieB } });
  const execBBody = await execBR.json().catch(() => null);
  assert(execBBody?.dashboard?.traffic?.publishJobs === 0, "account B's publishJobs is 0 — does not see account A's benchmark jobs", `got ${execBBody?.dashboard?.traffic?.publishJobs}`);
  assert(execBBody?.dashboard?.community?.totalMembers === 0, "account B's community totalMembers is 0", `got ${execBBody?.dashboard?.community?.totalMembers}`);

  const commBR = await fetch(`${BASE}/distrib/communities`, { headers: { Cookie: cookieB } });
  const commBBody = await commBR.json().catch(() => null);
  const benchCommunityLeaked = (commBBody?.communities || []).some(c => c.name?.includes("Ooplix Founders") || c.name?.includes("Ooplix Updates"));
  assert(!benchCommunityLeaked, "account B does not see any of account A's benchmark communities", `leaked: ${JSON.stringify(commBBody?.communities?.map(c=>c.name))}`);

  section("Campaigns, influencers, and launches are isolated per account");
  await fetch(`${BASE}/distrib/campaigns`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookieA }, body: JSON.stringify({ name: "Isolation Test Campaign", channels: ["email"] }) });
  await fetch(`${BASE}/distrib/influencers`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookieA }, body: JSON.stringify({ name: "Isolation Test Influencer", handle: "@isotest", platform: "instagram", followers: 1000 }) });
  await fetch(`${BASE}/distrib/launches`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookieA }, body: JSON.stringify({ name: "Isolation Test Launch" }) });

  const campBR = await fetch(`${BASE}/distrib/campaigns`, { headers: { Cookie: cookieB } });
  const campBBody = await campBR.json().catch(() => null);
  assert(!(campBBody?.campaigns || []).some(c => c.name === "Isolation Test Campaign"), "account B does not see account A's campaign", "campaign leaked across tenants");

  const infBR = await fetch(`${BASE}/distrib/influencers`, { headers: { Cookie: cookieB } });
  const infBBody = await infBR.json().catch(() => null);
  assert(!(infBBody?.influencers || []).some(i => i.name === "Isolation Test Influencer"), "account B does not see account A's influencer", "influencer leaked across tenants");

  const launchBR = await fetch(`${BASE}/distrib/launches`, { headers: { Cookie: cookieB } });
  const launchBBody = await launchBR.json().catch(() => null);
  assert(!(launchBBody?.launches || []).some(l => l.name === "Isolation Test Launch"), "account B does not see account A's launch", "launch leaked across tenants");

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Distribution Engine Tenant Isolation Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
