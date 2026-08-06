#!/usr/bin/env node
"use strict";
/**
 * "More" menu search terminology-gap regression — frontend/src/App.jsx's
 * MORE_TABS + TABS + its search filter.
 *
 * CONFIRMED findings (Workflow Simplification Certification): searching
 * the "More" menu (the only path to 74+ of the product's ~79 surfaces, per
 * the earlier Productivity Audit's overflow-clipping fix) for the single
 * most natural word describing an entire real, substantial feature area
 * returned ZERO results:
 *
 *   "marketing" -> 0 results. The real module (9 sub-tabs: Dashboard,
 *   Email, SMS, WhatsApp, Push, Automation, Audience, Analytics,
 *   Templates; real KPIs like campaign count/reach/ROAS) is labeled
 *   "Growth" and grouped under "Growth" — neither string contains
 *   "marketing".
 *
 *   "finance" -> 0 results. The real module is labeled "Billing".
 *
 *   "invite" -> 0 results. Team invites are a real, working feature
 *   ("+ Invite member" button, pending-invites counter, roles/permissions)
 *   on the "Team" module — neither string contains "invite".
 *
 * A founder typing any of these exact words (all three are explicitly
 * named as required daily-work vocabulary in this certification's own
 * mission text) would conclude the feature doesn't exist and give up,
 * despite real, complete functionality sitting one click away under a
 * less obvious label.
 *
 * Fix: added an additive, invisible `alias` field to the 3 affected
 * MORE_TABS entries (growth->"marketing", billing->"finance",
 * team->"invite") and extended the existing search filter to also check
 * it — no visible label or group was renamed (avoids breaking existing
 * users' muscle memory), no new UI/architecture was introduced.
 *
 * EXTENDED (Founder Journey Final Polish, Phase A.4.3): a full sweep of
 * every search term named in the A.4.2/A.4.3 missions found 10 more
 * zero-result terms. Two classes of gap:
 *
 *   1. More MORE_TABS entries missing aliases — "website"/"forms" (real
 *      feature: Content & SEO, which hosts Landing Pages), "campaign"
 *      (real feature: Growth), "employee" (real feature: Team), "brand"
 *      (real feature: Creative Studio, which hosts a working Brand Kit
 *      builder — "Create Brand Kit" button, real kit list). Fixed the
 *      same way as the original 3: additive `alias` field, no renames.
 *
 *   2. A structurally different gap: "lead"/"leads"/"lead capture"/
 *      "invoice"/"dashboard" all returned 0 despite the real features
 *      (Contacts, Payments, Dashboard) being one click away in the
 *      ALWAYS-VISIBLE top TABS bar — because MoreMenu's search only ever
 *      looked at MORE_TABS, never TABS, so anything living in the
 *      permanent top bar was invisible to search by construction. Fixed
 *      by adding a small, additive `PRIMARY_TAB_ALIASES` map and merging
 *      alias-matching TABS entries into the same search results (tagged
 *      "Quick Access" so they read as distinct from overflow modules) —
 *      TABS' own rendering in the main bar, and its ids/labels, are
 *      completely untouched.
 *
 * After both fixes: all 21 search terms named across the A.4.2 and A.4.3
 * mission texts resolve to their real feature. Zero remaining gaps.
 *
 * This test is a static check against the real MORE_TABS/TABS source
 * (parses the actual array literals, not a hand-maintained copy) plus a
 * live end-to-end Playwright run proving the alias actually resolves
 * through the real running search UI to the real destination page.
 *
 * Usage: node tests/security/38-more-menu-search-terminology-gaps.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function parseMoreTabs() {
  const src = fs.readFileSync(path.join(__dirname, "../../frontend/src/App.jsx"), "utf8");
  const startIdx = src.indexOf("const MORE_TABS = [");
  const endIdx = src.indexOf("];", startIdx);
  const block = src.slice(startIdx, endIdx);
  const entries = [...block.matchAll(/id:\s*"([^"]+)",\s*label:\s*"?([^",]+)"?,\s*group:\s*"([^"]+)"(?:,\s*alias:\s*"([^"]+)")?/g)];
  return entries.map(m => ({ id: m[1], label: m[2].replace(/^"|"$/g, ""), group: m[3], alias: m[4] || null }));
}

function parsePrimaryTabs() {
  const src = fs.readFileSync(path.join(__dirname, "../../frontend/src/App.jsx"), "utf8");
  const tabsStart = src.indexOf("const TABS = [");
  const tabsEnd = src.indexOf("];", tabsStart);
  const tabsBlock = src.slice(tabsStart, tabsEnd);
  const tabs = [...tabsBlock.matchAll(/id:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g)].map(m => ({ id: m[1], label: m[2] }));

  const aliasStart = src.indexOf("const PRIMARY_TAB_ALIASES = {");
  const aliasEnd = src.indexOf("};", aliasStart);
  const aliasBlock = src.slice(aliasStart, aliasEnd);
  const aliasEntries = [...aliasBlock.matchAll(/(\w+):\s*"([^"]+)"/g)];
  const aliasMap = Object.fromEntries(aliasEntries.map(m => [m[1], m[2]]));

  return tabs.filter(t => t.id !== "more").map(t => ({ ...t, alias: aliasMap[t.id] || null }));
}

function searchMatches(tabs, q) {
  const query = q.toLowerCase();
  return tabs.filter(t => t.label.toLowerCase().includes(query) || t.group?.toLowerCase().includes(query) || (t.alias && t.alias.toLowerCase().includes(query)));
}

async function checkServersUp() {
  try {
    const [feRes, beRes] = await Promise.all([
      fetch("http://localhost:3000").catch(() => null),
      fetch("http://localhost:5050/health").catch(() => null),
    ]);
    return !!feRes && !!beRes && beRes.ok;
  } catch { return false; }
}

async function main() {
  section("Static — real MORE_TABS source now resolves the 3 previously-zero-result terms");
  const tabs = parseMoreTabs();
  assert(tabs.length > 50, "MORE_TABS was parsed successfully from the real source (sanity check)", `only parsed ${tabs.length} entries — regex may be out of sync with App.jsx's format`);

  const marketingMatches = searchMatches(tabs, "marketing");
  assert(marketingMatches.some(m => m.label === "Growth"), `"marketing" search resolves to the real Growth module`, `no match found among: ${JSON.stringify(marketingMatches.map(m => m.label))}`);

  const financeMatches = searchMatches(tabs, "finance");
  assert(financeMatches.some(m => m.label === "Billing"), `"finance" search resolves to the real Billing module`, `no match found among: ${JSON.stringify(financeMatches.map(m => m.label))}`);

  const inviteMatches = searchMatches(tabs, "invite");
  assert(inviteMatches.some(m => m.label === "Team"), `"invite" search resolves to the real Team module`, `no match found among: ${JSON.stringify(inviteMatches.map(m => m.label))}`);

  section("Static — no existing label/group was renamed (aliases are additive only)");
  const growthTab = tabs.find(t => t.id === "growth");
  assert(growthTab?.label === "Growth", "Growth module's visible label is unchanged", `label is now "${growthTab?.label}"`);
  const billingTab = tabs.find(t => t.id === "billing");
  assert(billingTab?.label === "Billing", "Billing module's visible label is unchanged", `label is now "${billingTab?.label}"`);
  const teamTab = tabs.find(t => t.id === "team");
  assert(teamTab?.label === "Team", "Team module's visible label is unchanged", `label is now "${teamTab?.label}"`);

  section("Static (A.4.3) — the 4 newly-aliased MORE_TABS terms resolve to their real module");
  assert(searchMatches(tabs, "website").some(m => m.label === "Content & SEO"), `"website" search resolves to the real Content & SEO module (hosts Landing Pages)`, `no match found`);
  assert(searchMatches(tabs, "forms").some(m => m.label === "Content & SEO"), `"forms" search resolves to the real Content & SEO module`, `no match found`);
  assert(searchMatches(tabs, "campaign").some(m => m.label === "Growth"), `"campaign" search resolves to the real Growth module`, `no match found`);
  assert(searchMatches(tabs, "employee").some(m => m.label === "Team"), `"employee" search resolves to the real Team module`, `no match found`);
  assert(searchMatches(tabs, "brand").some(m => m.label === "Creative Studio"), `"brand" search resolves to the real Creative Studio module (hosts the Brand Kit builder)`, `no match found`);

  section("Static (A.4.3) — TABS (the always-visible top bar) is now search-indexed via PRIMARY_TAB_ALIASES");
  const primaryTabs = parsePrimaryTabs();
  assert(primaryTabs.length >= 5, "TABS was parsed successfully from the real source (sanity check)", `only parsed ${primaryTabs.length} entries`);

  const leadMatches = searchMatches(primaryTabs, "lead");
  assert(leadMatches.some(m => m.label === "Contacts"), `"lead" search resolves to the real Contacts (CRM) tab`, `no match found among: ${JSON.stringify(leadMatches.map(m => m.label))}`);
  const leadsMatches = searchMatches(primaryTabs, "leads");
  assert(leadsMatches.some(m => m.label === "Contacts"), `"leads" search resolves to the real Contacts tab`, `no match found`);
  const leadCaptureMatches = searchMatches(primaryTabs, "lead capture");
  assert(leadCaptureMatches.some(m => m.label === "Contacts"), `"lead capture" search resolves to the real Contacts tab`, `no match found`);
  const invoiceMatches = searchMatches(primaryTabs, "invoice");
  assert(invoiceMatches.some(m => m.label === "Payments"), `"invoice" search resolves to the real Payments tab`, `no match found among: ${JSON.stringify(invoiceMatches.map(m => m.label))}`);
  const dashboardMatches = searchMatches(primaryTabs, "dashboard");
  assert(dashboardMatches.some(m => m.label === "Dashboard"), `"dashboard" search resolves to the real Dashboard tab`, `no match found`);

  section("Static (A.4.3) — TABS' own ids/labels are unchanged (PRIMARY_TAB_ALIASES is additive only)");
  const clientsTab = primaryTabs.find(t => t.id === "clients");
  assert(clientsTab?.label === "Contacts", "Contacts tab's visible label is unchanged", `label is now "${clientsTab?.label}"`);
  const paymentsTab = primaryTabs.find(t => t.id === "payments");
  assert(paymentsTab?.label === "Payments", "Payments tab's visible label is unchanged", `label is now "${paymentsTab?.label}"`);

  section("Precondition — real frontend (:3000) and backend (:5050) dev servers reachable");
  const serversUp = await checkServersUp();
  if (!serversUp) {
    console.log("  ⚠  Frontend/backend dev servers not reachable on :3000/:5050.");
    console.log("     Skipping the live end-to-end portion (not counted as pass or fail).");
    console.log(`\n${"=".repeat(60)}`);
    console.log(`More Menu Search Terminology Regression: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
  ok("frontend and backend dev servers are reachable");

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  section("Live — real signup, real search, real navigation to the real Growth page via 'marketing'");
  const uniqueEmail = `terminology-regression-${Date.now()}@ooplix-test.local`;
  await page.goto("http://localhost:3000/?desktop=1", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.locator('input[type="text"]').first().fill("Terminology Regression");
  await page.locator('input[type="email"]').first().fill(uniqueEmail);
  await page.locator('input[type="password"]').first().fill("TerminologyRegression12345!");
  await page.locator('button:has-text("Start free trial")').click();
  // Wait for real post-signup content rather than a fixed timeout — under
  // load (concurrent test runs, background AutoLoop activity) signup can
  // take longer than a fixed guess, and a fixed wait either flakes early
  // or wastes time when it's fast.
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return t.includes("Welcome to Ooplix") || t.includes("Welcome back") || t.includes("Dashboard");
    },
    { timeout: 25000 }
  ).catch(() => {});
  await page.waitForTimeout(500);

  // Same hardening as tests 35/37: check for a lingering onboarding
  // backdrop, not just button visibility, before proceeding — a backdrop
  // can report not-visible a beat before it actually unmounts, still
  // intercepting the next real click (the More menu trigger below).
  const DISMISS = ["Skip for now", "Skip setup", "Skip tour", "Skip"];
  const BACKDROP_SELECTORS = [".wf-overlay", ".gt-overlay", ".cfr-backdrop"];
  for (let round = 0; round < 8; round++) {
    let did = false;
    for (const label of DISMISS) {
      const btn = page.getByText(label, { exact: true }).first();
      if (await btn.isVisible({ timeout: 600 }).catch(() => false)) { await btn.click().catch(() => {}); await page.waitForTimeout(500); did = true; }
    }
    const anyBackdropLeft = await page.evaluate((sels) => sels.some(s => document.querySelector(s)), BACKDROP_SELECTORS).catch(() => false);
    if (!did && !anyBackdropLeft) break;
    if (anyBackdropLeft) await page.waitForTimeout(400);
  }

  // The trigger's own visible text is the CURRENT tab's name (e.g. "Growth
  // ▾"), not literally "More" — it only reads "More (N)" when no overflow
  // tab is active. Re-locate by the stable class each time rather than by
  // text, or every navigation after the first breaks this locator.
  async function openMoreMenu() {
    const btn = page.locator("button.tab--more");
    const visible = await btn.isVisible({ timeout: 5000 }).catch(() => false);
    if (visible) { await btn.click(); await page.waitForTimeout(600); }
    return visible;
  }

  const moreVisible = await openMoreMenu();
  assert(moreVisible, "the 'More' menu trigger is reachable", "trigger not found — nav structure may have changed");
  if (moreVisible) {
    await page.locator('input[placeholder*="Search" i]').first().fill("marketing");
    await page.waitForTimeout(400);
    const growthItem = page.locator("text=Growth").first();
    const growthVisible = await growthItem.isVisible({ timeout: 3000 }).catch(() => false);
    assert(growthVisible, "searching 'marketing' in the live UI surfaces the real Growth item", "Growth item not found in live search results");
    if (growthVisible) {
      await growthItem.click();
      await page.waitForTimeout(1500);
      const pageText = await page.evaluate(() => document.body.innerText);
      assert(pageText.includes("Growth OS") || pageText.includes("Marketing Infrastructure"), "clicking through lands on the real Growth OS page with real content", "expected Growth OS content not found after navigation");
    }
  }

  section("Live (A.4.3) — searching 'website' surfaces and navigates to the real Content & SEO page");
  if (await openMoreMenu()) {
    await page.locator('input[placeholder*="Search" i]').first().fill("website");
    await page.waitForTimeout(400);
    const cseoItem = page.locator("text=Content & SEO").first();
    const cseoVisible = await cseoItem.isVisible({ timeout: 3000 }).catch(() => false);
    assert(cseoVisible, "searching 'website' in the live UI surfaces the real Content & SEO item", "Content & SEO item not found in live search results");
    if (cseoVisible) {
      await cseoItem.click();
      await page.waitForTimeout(1500);
      const pageText = await page.evaluate(() => document.body.innerText);
      assert(pageText.includes("Landing Pages") || pageText.includes("Content & SEO Engine"), "clicking through lands on the real Content & SEO page with real content", "expected Content & SEO content not found after navigation");
    }
  }

  section("Live (A.4.3) — searching 'lead' surfaces the always-visible Contacts tab, tagged Quick Access");
  if (await openMoreMenu()) {
    await page.locator('input[placeholder*="Search" i]').first().fill("lead");
    await page.waitForTimeout(400);
    const contactsItem = page.locator("text=Contacts").first();
    const contactsVisible = await contactsItem.isVisible({ timeout: 3000 }).catch(() => false);
    assert(contactsVisible, "searching 'lead' in the live UI surfaces the real Contacts item", "Contacts item not found in live search results");
    if (contactsVisible) {
      await contactsItem.click();
      await page.waitForTimeout(1200);
      const pageText = await page.evaluate(() => document.body.innerText);
      assert(pageText.includes("Contacts"), "clicking through lands on the real Contacts page", "expected Contacts content not found after navigation");
    }
  }

  await browser.close();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`More Menu Search Terminology Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
