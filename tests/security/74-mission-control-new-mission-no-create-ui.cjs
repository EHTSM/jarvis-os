#!/usr/bin/env node
"use strict";
/**
 * "New Mission" dead-end regression (Productivity Certification, Phase
 * A.10.1 — Founder Productivity, Workflow 3: Daily Planning / mission
 * creation).
 *
 * CONFIRMED finding: every "New Mission" entrypoint in the web app —
 * CustomerDashboard.jsx's Quick Actions (the first thing a founder sees
 * after signup), CommandCenter.jsx's own Quick Actions, and the CommandPalette
 * (⌘K) — navigates to tab id "mission" (MissionControlV1.jsx). That
 * component is a real, live-refreshing ops/health monitoring dashboard
 * (revenue/leads/agents/memory/workflow/autonomy cards, emergency stop),
 * but confirmed via full-page button/link enumeration to have ZERO
 * create/new/+ affordance anywhere on it. A founder clicking a button
 * literally labeled "New Mission" landed on a dashboard with no way to
 * create anything.
 *
 * The real create form (goal input -> POST /missions/orchestrator/create,
 * fully wired to missionOrchestrator.cjs) already existed in
 * MissionOrchestratorPanel.jsx — but that component was only ever mounted
 * inside ElectronWorkspace.jsx (the desktop shell's own internal panel
 * layout), unreachable from the web app's tab router in App.jsx.
 *
 * Fix: MissionControlV1.jsx now imports MissionOrchestratorPanel.jsx and
 * renders it inline behind a "＋ New Mission" toggle in its own header,
 * reusing the existing component and existing API — no new component, no
 * new endpoint, no architecture change.
 *
 * This test is a static check that the import + toggle are wired, plus a
 * live Playwright run against the real running app proving a real signed-in
 * founder can click "New Mission" from the Dashboard, reach a real create
 * form, submit a real goal, and have it actually persist as a real mission
 * via GET /missions/orchestrator.
 *
 * Usage: node tests/security/74-mission-control-new-mission-no-create-ui.cjs
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
  section("Static — MissionControlV1.jsx imports and renders the real create-mission panel");
  const mcSrc = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/MissionControlV1.jsx"), "utf8");
  assert(/import MissionOrchestratorPanel from ["']\.\/MissionOrchestratorPanel\.jsx["']/.test(mcSrc),
    "MissionControlV1.jsx imports MissionOrchestratorPanel.jsx", "import not found");
  assert(/<MissionOrchestratorPanel\s*\/>/.test(mcSrc),
    "MissionControlV1.jsx renders <MissionOrchestratorPanel />", "component not rendered anywhere in MissionControlV1.jsx");
  assert(/New Mission/.test(mcSrc),
    "MissionControlV1.jsx has a \"New Mission\" affordance of its own now", "no New Mission toggle text found");

  section("Static — MissionOrchestratorPanel.jsx's real create form is unchanged (goal input -> POST /missions/orchestrator/create)");
  const panelSrc = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/MissionOrchestratorPanel.jsx"), "utf8");
  assert(/_fetch\(["']\/missions\/orchestrator\/create["']/.test(panelSrc),
    "MissionOrchestratorPanel still posts to /missions/orchestrator/create", "create endpoint call not found");

  section("Precondition — real frontend (:3000) and backend (:5050) dev servers reachable");
  const serversUp = await Promise.all([
    fetch("http://localhost:3000").then(r => r.ok).catch(() => false),
    fetch("http://localhost:5050/health").then(r => r.ok).catch(() => false),
  ]).then(([fe, be]) => fe && be);
  if (!serversUp) {
    console.log("  ⚠  Frontend/backend dev servers not reachable on :3000/:5050.");
    console.log("     Skipping the live end-to-end portion (not counted as pass or fail).");
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Mission Control New Mission Dead-End Regression: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
  ok("frontend and backend dev servers are reachable");

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  section("Live — a real signup, clicking 'New Mission', reaching a real create form, and persisting a real mission");
  const email = `mission-create-regression-${Date.now()}@ooplix-test.local`;
  await page.goto("http://localhost:3000/?desktop=1", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.locator('input[type="text"]').first().fill("Mission Create Regression");
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill("MissionCreateRegression12345!");
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

  // The dashboard quick-actions row itself renders slightly after the
  // dismissal loop settles (its own data fetch) — poll rather than a
  // single fixed-timeout visibility check so this isn't flaky under load.
  const newMissionBtn = page.locator("button.cd-quick-action", { hasText: "New Mission" }).first();
  let newMissionVisible = false;
  for (let i = 0; i < 10; i++) {
    newMissionVisible = await newMissionBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (newMissionVisible) break;
    await page.waitForTimeout(1000);
  }
  if (!newMissionVisible) {
    const debugBody = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => "");
    console.log(`  (debug) page state when New Mission button was not found: ${JSON.stringify(debugBody)}`);
  }
  assert(newMissionVisible, "the Dashboard's 'New Mission' button is reachable after signup", "New Mission button not found");

  if (newMissionVisible) {
    await newMissionBtn.click();
    await page.waitForTimeout(1000);

    const bodyBefore = await page.evaluate(() => document.body.innerText);
    assert(/Mission Control/.test(bodyBefore), "'New Mission' still lands on Mission Control (unchanged navigation)", "did not land on Mission Control");

    const toggleBtn = page.getByText("＋ New Mission", { exact: false }).first();
    const toggleVisible = await toggleBtn.isVisible({ timeout: 5000 }).catch(() => false);
    assert(toggleVisible, "Mission Control now has its own '＋ New Mission' toggle button", "toggle button not found on Mission Control page");

    if (toggleVisible) {
      await toggleBtn.click();
      await page.waitForTimeout(600);

      // Scoped to a plain <button> with exact text "create" — a bare
      // substring `text=create` locator also matches "...Organization"
      // (org-switcher-name span, case-insensitive substring) and mission
      // goal text containing the word "create", both of which sit earlier
      // in DOM order than the actual orchestrator tab button.
      const createTab = page.locator("button", { hasText: /^create$/ }).first();
      const createTabVisible = await createTab.isVisible({ timeout: 3000 }).catch(() => false);
      assert(createTabVisible, "the orchestrator panel's 'create' sub-tab is visible", "create sub-tab not found after opening the panel");

      if (createTabVisible) {
        await createTab.click();
        await page.waitForTimeout(600);

        const goalInput = page.locator("textarea[placeholder='Mission goal…']").first();
        const goalInputVisible = await goalInput.isVisible({ timeout: 5000 }).catch(() => false);
        assert(goalInputVisible, "a real goal input is visible on the create tab", "no goal input found on create tab");

        if (goalInputVisible) {
          const goalText = `regression test mission ${Date.now()}`;
          await goalInput.fill(goalText);
          const createBtn = page.getByText("Create Mission", { exact: false }).last();
          const createBtnVisible = await createBtn.isVisible({ timeout: 3000 }).catch(() => false);
          assert(createBtnVisible, "a real 'Create Mission' submit button is visible", "no Create Mission button found");

          if (createBtnVisible) {
            await createBtn.click();
            await page.waitForTimeout(2500);

            // /missions/orchestrator requires the founder's own session
            // (Unauthorized without it) — query it through the same
            // authenticated Playwright page/context that just did the
            // signup + click, not a bare unauthenticated fetch().
            const r = await page.evaluate(async () => {
              const res = await fetch("/missions/orchestrator?limit=20", { credentials: "include" });
              return res.json();
            }).catch(() => null);
            const found = r?.success && Array.isArray(r.missions) && r.missions.some(m => m.goal === goalText);
            assert(found, "the mission created via the UI actually persisted and is visible via GET /missions/orchestrator", `mission with goal "${goalText}" not found in orchestrator missions list (response: ${JSON.stringify(r).slice(0, 200)})`);
          }
        }
      }
    }
  }

  await browser.close();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Mission Control New Mission Dead-End Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
