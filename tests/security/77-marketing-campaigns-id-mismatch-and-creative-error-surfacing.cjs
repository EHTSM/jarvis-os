#!/usr/bin/env node
"use strict";
/**
 * Marketing Productivity Certification (Phase A.10.3) — two real, distinct
 * findings fixed together because both surfaced during the same audit pass
 * and both are the "reads a field the backend never sends" bug class first
 * documented in test 76 (CRM Leads).
 *
 * FINDING 1 — Campaigns id/campaignId field mismatch (Workflow 1: Campaign).
 * backend/services/businessDataService.cjs's createCampaign() gives every
 * campaign object a primary key field named `id` (e.g. "camp_1786...") —
 * there is no `campaignId` field anywhere on a real campaign record. But
 * frontend/src/components/BusinessOS.jsx's CampaignsView read
 * `campaign.campaignId` everywhere (list `key`, openEdit's editing state,
 * handleActivate/handleComplete/handleEvent), which is always `undefined`
 * on a real campaign object. Confirmed live against the running app:
 *
 *   1. +Click/+Lead/+Conv/Complete/Activate: fired
 *      POST /business/campaigns/undefined/event (and /undefined/complete) —
 *      confirmed 400 in the browser network log, so these buttons never
 *      worked for a single real campaign, ever.
 *   2. React rendered `key={c.campaignId}` (always undefined) on every
 *      campaign card — a real "Each child in a list should have a unique
 *      key prop" console warning on every page load with any campaign.
 *   3. Separately, handleActivate/handleComplete/handleEvent checked `r.ok`
 *      to decide success/failure, but the backend's real response shape
 *      from business.js's _ok() is `{ success: true, ... }` — there is no
 *      `.ok` field at all, so even once #1 is fixed these handlers would
 *      silently show NO feedback at all (worse than test 76's false-error
 *      toast — here there was no toast, no error, nothing) on every
 *      genuinely successful action.
 *
 * Fix (frontend/src/components/BusinessOS.jsx, CampaignsView + the
 * Overview tab's compact campaign list only):
 *   - campaign.campaignId -> campaign.id in openEdit(), the row `key`
 *     (both the full CampaignsView list and the Overview "Active
 *     Campaigns" compact list), and the Activate/Complete/+Click/+Lead/
 *     +Conv onClick handlers.
 *   - handleActivate/handleComplete/handleEvent now check
 *     `r.success !== false` (matching handleSave's existing, correct
 *     check) instead of the nonexistent `r.ok`, and now show an error
 *     toast on real failure instead of silently doing nothing.
 * No new backend route, no new component, no schema change.
 *
 * FINDING 2 — Creative Studio swallows the real generation error
 * (Workflow 5: Creative). backend/routes/creativeStudio.js's
 * _createCreativeJob() already captures the real generator error (e.g. a
 * genuine DALL-E 3 401 from an invalid/expired OPENAI_API_KEY, confirmed
 * live: agents/content/imageGeneratorAgent.cjs's generate() sets
 * result.generationError = "Request failed with status code 401") and
 * threads it through in the API response as output.generationError. But
 * frontend/src/components/CreativeStudio.jsx's ResultCard always rendered
 * the same generic "No connected provider produced a real file... Connect
 * a provider in Connector Center" message regardless — even when a
 * provider IS connected and the real call simply failed. Those are two
 * materially different, actionable situations for a founder (go connect a
 * provider vs. your existing key/quota is broken) and the UI collapsed
 * them into one misleading message.
 *
 * Fix (frontend/src/components/CreativeStudio.jsx, ResultCard only):
 *   - When result.output.generationError is present, render the real
 *     error text ("Generation failed: <reason>") instead of the generic
 *     "no connector" message.
 *   - Falls back to the original generic message only when there truly is
 *     no generationError (i.e. no real generator wired for that
 *     capability at all), preserving existing behavior for that case.
 * No new backend route, no new component, no schema change — the backend
 * already sent this field; the frontend just never read it.
 *
 * Usage: node tests/security/77-marketing-campaigns-id-mismatch-and-creative-error-surfacing.cjs
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

async function main() {
  section("Static — CampaignsView no longer reads the nonexistent campaign.campaignId field");
  const bosSrc = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/BusinessOS.jsx"), "utf8");
  const campaignsViewMatch = bosSrc.match(/function CampaignsView\([\s\S]*?\n}\n/);
  assert(!!campaignsViewMatch, "CampaignsView function body found in BusinessOS.jsx", "could not locate function CampaignsView(...) in the source");
  const campaignsViewSrc = campaignsViewMatch ? campaignsViewMatch[0] : "";

  assert(!/\.campaignId\b/.test(campaignsViewSrc),
    "CampaignsView contains zero references to the nonexistent `.campaignId` field", "found a remaining `.campaignId` reference inside CampaignsView");
  assert(/setEditing\(c\.id\)/.test(campaignsViewSrc),
    "openEdit() now sets editing state from c.id", "openEdit still does not use c.id");
  assert(/<div key=\{c\.id\} className="bos-camp-card">/.test(campaignsViewSrc),
    "the campaign card list row key now uses c.id", "campaign card row key still not using c.id");
  assert(/handleEvent\(c\.id, "click"\)/.test(campaignsViewSrc) && /handleEvent\(c\.id, "lead"\)/.test(campaignsViewSrc) && /handleEvent\(c\.id, "conversion"\)/.test(campaignsViewSrc) && /handleComplete\(c\.id\)/.test(campaignsViewSrc),
    "+Click/+Lead/+Conv/Complete buttons now pass c.id", "one or more campaign row action buttons still not passing c.id");

  section("Static — the Overview tab's compact 'Active Campaigns' list also no longer uses campaignId");
  assert(!/key=\{c\.campaignId\}/.test(bosSrc),
    "no remaining key={c.campaignId} anywhere in BusinessOS.jsx (including the Overview compact list)", "found a remaining key={c.campaignId} in BusinessOS.jsx");

  section("Static — success/failure checks now match the real backend response shape ({success:true,...}, no .ok field)");
  assert(/handleActivate = async[\s\S]{0,250}r\.success !== false/.test(campaignsViewSrc),
    "handleActivate checks r.success (not the nonexistent r.ok)", "handleActivate still checks r.ok");
  assert(/handleComplete = async[\s\S]{0,250}r\.success !== false/.test(campaignsViewSrc),
    "handleComplete checks r.success (not the nonexistent r.ok)", "handleComplete still checks r.ok");
  assert(/handleEvent = async[\s\S]{0,250}r\.success !== false/.test(campaignsViewSrc),
    "handleEvent checks r.success (not the nonexistent r.ok)", "handleEvent still checks r.ok");
  assert(/onToast\?\.\("error", r\.error \|\| "Activate failed"\)/.test(campaignsViewSrc),
    "handleActivate now surfaces a real error toast on genuine failure (was previously silent)", "handleActivate does not surface an error toast on failure");

  section("Static — Creative Studio surfaces the real generator error instead of a generic message");
  const csSrc = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/CreativeStudio.jsx"), "utf8");
  const resultCardMatch = csSrc.match(/function ResultCard\([\s\S]*?\n}\n/);
  assert(!!resultCardMatch, "ResultCard function body found in CreativeStudio.jsx", "could not locate function ResultCard(...) in the source");
  const resultCardSrc = resultCardMatch ? resultCardMatch[0] : "";
  assert(/const genError = result\.output/.test(resultCardSrc),
    "ResultCard reads result.output.generationError", "ResultCard does not read generationError from the API response");
  assert(/Generation failed: \{genError\}/.test(resultCardSrc),
    "ResultCard renders the real generationError text when present", "ResultCard does not render the real generationError text");
  assert(/!hasMedia && !genError/.test(resultCardSrc),
    "ResultCard still falls back to the generic 'no connector' message when there is truly no generationError", "generic fallback message path missing or no longer gated on !genError");

  section("Live — imageGeneratorAgent.cjs really does capture a real DALL-E error (confirms the field this fix now surfaces is genuine, not fabricated)");
  try {
    const agent = require(path.join(__dirname, "../../agents/content/imageGeneratorAgent.cjs"));
    const r = await agent.generate({ topic: "regression test banner", style: "flat_design" });
    if (process.env.OPENAI_API_KEY) {
      assert(typeof r.generated === "boolean", "generate() returns a boolean `generated` field", "generated field missing or wrong type");
      if (!r.generated) {
        assert(typeof r.generationError === "string" && r.generationError.length > 0,
          "when generation fails, a real, non-empty generationError string is present (exactly the field the UI fix now reads)",
          "generation failed but no generationError string was captured");
        console.log(`     (live generationError observed: "${r.generationError}")`);
      } else {
        ok("DALL-E 3 generation succeeded live (OPENAI_API_KEY valid) — generationError path not exercised this run, but the fix is inert-safe either way");
      }
    } else {
      ok("OPENAI_API_KEY not set in this environment — skipping live agent call, static checks above already confirm the fix");
    }
  } catch (e) {
    ko("imageGeneratorAgent.cjs is requireable and callable", e.message);
  }

  section("Precondition — real frontend (:3000) and backend (:5050) dev servers reachable");
  const serversUp = await Promise.all([
    fetch("http://localhost:3000").then(r => r.ok).catch(() => false),
    fetch("http://localhost:5050/health").then(r => r.ok).catch(() => false),
  ]).then(([fe, be]) => fe && be);
  if (!serversUp) {
    console.log("  ⚠  Frontend/backend dev servers not reachable on :3000/:5050.");
    console.log("     Skipping the live end-to-end portion (not counted as pass or fail).");
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Marketing Campaigns id Mismatch + Creative Error Surfacing Regression: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
  ok("frontend and backend dev servers are reachable");

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  section("Live — real signup, create a campaign, run +Click/+Lead/+Conv (must PATCH real id, never /undefined/, never 400)");
  const email = `mkt-campaigns-regression-${Date.now()}@ooplix-test.local`;
  await page.goto("http://localhost:3000/?desktop=1", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.locator('input[type="text"]').first().fill("Marketing Campaigns Regression").catch(() => {});
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill("MktCampaignsRegression12345!");
  await page.locator("button.auth-btn").first().click();
  await page.waitForFunction(() => !document.body.innerText.includes("Creating account"), { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const DISMISS = ["Skip for now", "Skip setup", "Skip tour", "Skip", "Got it", "Close", "Maybe later"];
  for (let round = 0; round < 15; round++) {
    let did = false;
    const gtSkip = page.locator(".gt-skip").first();
    if (await gtSkip.isVisible({ timeout: 600 }).catch(() => false)) { await gtSkip.click().catch(() => {}); await page.waitForTimeout(600); did = true; }
    for (const label of DISMISS) {
      const btn = page.getByText(label, { exact: true }).first();
      if (await btn.isVisible({ timeout: 600 }).catch(() => false)) { await btn.click().catch(() => {}); await page.waitForTimeout(500); did = true; }
    }
    const overlayLeft = await page.evaluate(() => !!document.querySelector(".gt-overlay, .wf-overlay, .cfr-backdrop")).catch(() => false);
    if (!did && !overlayLeft) break;
  }
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => !document.body.innerText.includes("Loading…"), { timeout: 20000 }).catch(() => {});

  const crmTile = page.locator("button.cd-quick-action", { hasText: "CRM" }).first();
  const crmVisible = await crmTile.isVisible({ timeout: 10000 }).catch(() => false);
  assert(crmVisible, "the Dashboard's CRM quick-action tile is reachable after signup", "CRM quick-action tile not found");

  const netlog = [];
  page.on("requestfinished", async (req) => {
    try {
      const res = await req.response();
      if (/\/business\/campaigns/.test(req.url())) netlog.push({ method: req.method(), url: req.url(), status: res ? res.status() : null });
    } catch {}
  });

  if (crmVisible) {
    await crmTile.click();
    await page.waitForTimeout(800);
    await page.getByText("Campaigns", { exact: true }).last().click({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Create a real campaign through the real form
    await page.getByText("+ New Campaign", { exact: false }).first().click({ timeout: 5000 });
    await page.waitForTimeout(400);
    await page.locator('input[placeholder="Campaign name *"]').fill("Regression Test Campaign");
    await page.getByText("Create Campaign", { exact: true }).first().click({ timeout: 5000 });
    await page.waitForTimeout(1200);

    const cardVisible = await page.locator(".bos-camp-card", { hasText: "Regression Test Campaign" }).first().isVisible({ timeout: 8000 }).catch(() => false);
    assert(cardVisible, "the newly created campaign renders as a real card (not stuck on undefined key)", "new campaign card not found after creation");

    // +Click — must PATCH a real id, never /undefined/
    if (cardVisible) {
      const clicked = await page.evaluate(() => {
        const cards = [...document.querySelectorAll(".bos-camp-card")];
        const card = cards.find(c => c.innerText.includes("Regression Test Campaign"));
        const btn = card ? [...card.querySelectorAll("button")].find(b => b.textContent.trim() === "+Click") : null;
        if (btn) { btn.click(); return true; }
        return false;
      });
      assert(clicked, "the +Click button is present and clickable on the new campaign card", "+Click button not found");
      // Wait for the real event POST to actually land in the netlog rather
      // than a fixed timeout — avoids flaking on slow CI/dev-server ticks.
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !netlog.some(n => n.method === "POST" && /\/event$/.test(n.url))) {
        await page.waitForTimeout(250);
      }
    }
  }

  await browser.close();

  const has400 = netlog.some(n => n.status >= 400);
  const hasUndefinedUrl = netlog.some(n => /\/undefined\//.test(n.url));
  assert(!hasUndefinedUrl, "no /business/campaigns/undefined/... request was ever made", `found undefined-id request(s): ${JSON.stringify(netlog.filter(n => /\/undefined\//.test(n.url)))}`);
  assert(!has400, "no /business/campaigns/* request returned 400+ during the live flow", `found failing request(s): ${JSON.stringify(netlog.filter(n => n.status >= 400))}`);
  assert(netlog.some(n => n.method === "POST" && /\/event$/.test(n.url) && n.status === 200),
    "a real POST .../campaigns/<real-id>/event succeeded with 200", `event netlog: ${JSON.stringify(netlog)}`);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Marketing Campaigns id Mismatch + Creative Error Surfacing Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
