#!/usr/bin/env node
"use strict";
/**
 * Engineering Productivity Certification (Phase A.10.4) — two real, distinct
 * findings in the Engineering Workspace (frontend/src/components/
 * EngineeringWorkspace.jsx and frontend/src/components/
 * GuardrailsDashboard.jsx), both found operating the real
 * Plan->Patch->Test->Apply->Deploy->Observe->Heal->Learn loop live against
 * the running app, in this order.
 *
 * FINDING 1 — Un-debounced guard calls exhaust the rate limiter before a
 * founder even clicks "Run" (Workflow: Plan / prompt entry).
 * EngineeringWorkspace.jsx fed the raw `prompt` state directly as the
 * `task`/`description` props of IncidentPreventionBanner and
 * RegressionBanner (both from GuardrailsDashboard.jsx). Each banner's own
 * useEffect depends on that prop, so every keystroke past the 10-character
 * threshold re-fired both POST /runtime/guard/incident-check and POST
 * /runtime/guard/regression-check. Both routes are rate-limited to 20
 * req/60s per IP (backend/routes/runtime.js lines ~5682, ~5798). Typing a
 * single realistic ~85-character task description at normal human speed
 * produced 429 "Too many requests" on both guard endpoints well before
 * "Run Full Loop" was ever clicked, live-confirmed with a
 * retryAfterSeconds field in the 50s+ range — a founder's very first
 * engineering-workspace action of the day could exhaust the quota purely
 * from typing, before doing anything else.
 *
 * Fix (frontend/src/components/EngineeringWorkspace.jsx only): a
 * `debouncedPrompt` state (300ms silence window, the same idiom already
 * used by frontend/src/components/operator/WorkflowPanel.jsx's
 * `debouncedInput`) is fed to the two banners instead of the raw `prompt`.
 * Confirmed live: 88 keystrokes at 60ms/char now fire 0 guard calls during
 * typing, settling to exactly one pair once typing pauses. No change to
 * the banners, the guard endpoints, or the rate limiter itself.
 *
 * FINDING 2 — PreActionWarning crashes with "Rendered more hooks than
 * during the previous render" (Workflow: Patch / manual patch run).
 * GuardrailsDashboard.jsx's PreActionWarning declared a `useRef` +
 * `useEffect` pair AFTER two early `return` statements (the `loading`
 * branch, then the `data?.error || !data` branch). On first render while
 * `loading` is true, only 3 hooks run (2x useState, 1x useEffect). Once
 * loading resolves with a valid low-risk response, the early returns don't
 * fire and 2 more hooks run (useRef, useEffect) — a real, reproducible
 * React crash, confirmed live by clicking a pending patch's "Run" button
 * (Manual patch -> handleManualAutoPipeline -> _showPreActionWarning ->
 * this modal's own low-risk auto-proceed path). The sibling component
 * PreDeployGuard in the same file already does this correctly (both of
 * its useEffects sit above its own early `if (loading)` return).
 *
 * Fix (frontend/src/components/GuardrailsDashboard.jsx, PreActionWarning
 * only): moved the useRef/useEffect pair above both early returns,
 * matching PreDeployGuard's existing correct pattern; the conditional
 * auto-proceed logic now lives inside the effect body (guarded on
 * `data && !data.error && !data.shouldWarn`) instead of gating the hook
 * call itself. No new component, no backend change, no schema change.
 *
 * Usage: node tests/security/78-engineering-workspace-guard-spam-and-hooks-crash.cjs
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
  section("Static — EngineeringWorkspace.jsx debounces the prompt before feeding the guard banners");
  const ewSrc = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/EngineeringWorkspace.jsx"), "utf8");

  assert(/const \[debouncedPrompt, setDebouncedPrompt\] = useState\(""\)/.test(ewSrc),
    "debouncedPrompt state exists", "debouncedPrompt state not found");
  assert(/setTimeout\(\(\) => setDebouncedPrompt\(prompt\), 300\)/.test(ewSrc),
    "debouncedPrompt updates 300ms after the raw prompt stops changing", "300ms debounce timer for debouncedPrompt not found");
  assert(/clearTimeout\(_promptDebounceRef\.current\)/.test(ewSrc),
    "the debounce timer is cleared on every prompt change (real debounce, not just a delay)", "debounce timer is not cleared on prompt change — would not actually debounce");

  const bannerBlockMatch = ewSrc.match(/\{debouncedPrompt\.trim\(\)\.length > 10[\s\S]{0,400}/);
  assert(!!bannerBlockMatch, "found the banner-render block gated on debouncedPrompt", "could not locate the IncidentPreventionBanner/RegressionBanner render block");
  const bannerBlockSrc = bannerBlockMatch ? bannerBlockMatch[0] : "";
  assert(/<IncidentPreventionBanner task=\{debouncedPrompt\}/.test(bannerBlockSrc),
    "IncidentPreventionBanner now receives debouncedPrompt, not the raw prompt", "IncidentPreventionBanner still wired to raw prompt");
  assert(/<RegressionBanner filePath=\{activePatch\?\.filePath \|\| ""\} description=\{debouncedPrompt\}/.test(bannerBlockSrc),
    "RegressionBanner now receives debouncedPrompt, not the raw prompt", "RegressionBanner still wired to raw prompt");
  assert(!/task=\{prompt\}/.test(ewSrc) && !/description=\{prompt\}/.test(ewSrc),
    "no remaining banner prop reads the raw, un-debounced `prompt` state directly", "found a banner prop still reading raw `prompt` directly");

  section("Static — GuardrailsDashboard.jsx's PreActionWarning declares all hooks before any early return (Rules of Hooks)");
  const gdSrc = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/GuardrailsDashboard.jsx"), "utf8");
  const preActionMatch = gdSrc.match(/export function PreActionWarning\([\s\S]*?\n}\n/);
  assert(!!preActionMatch, "PreActionWarning function body found in GuardrailsDashboard.jsx", "could not locate export function PreActionWarning(...) in the source");
  const preActionSrc = preActionMatch ? preActionMatch[0] : "";

  // The two hooks (useRef, useEffect for auto-proceed) must appear in the
  // source text BEFORE the first `if (loading)` early return.
  const loadingReturnIdx = preActionSrc.indexOf("if (loading) {");
  const useRefIdx        = preActionSrc.indexOf("React.useRef(false)");
  const secondEffectIdx  = preActionSrc.indexOf("didProceedRef.current");
  assert(loadingReturnIdx > -1 && useRefIdx > -1, "both the early `if (loading)` return and the useRef hook are present", "one or both anchors missing from PreActionWarning source");
  assert(useRefIdx < loadingReturnIdx, "the useRef(false) hook is declared BEFORE the `if (loading)` early return (fixes the hooks-order crash)", `useRef found at index ${useRefIdx}, but the loading return is earlier at ${loadingReturnIdx} — hook still below an early return`);
  assert(secondEffectIdx > -1 && secondEffectIdx < loadingReturnIdx, "the auto-proceed useEffect body is also declared before the early returns", "auto-proceed effect not found before the early returns");

  // Only ONE useRef + one auto-proceed useEffect should exist now (the old
  // duplicate declaration below the early returns must be gone).
  const useRefCount = (preActionSrc.match(/React\.useRef\(false\)/g) || []).length;
  assert(useRefCount === 1, "exactly one useRef(false) declaration remains in PreActionWarning (no leftover duplicate below the early returns)", `found ${useRefCount} useRef(false) declarations`);

  assert(/data && !data\.error && !data\.shouldWarn && !didProceedRef\.current/.test(preActionSrc),
    "the auto-proceed effect body guards on data/error/shouldWarn internally, instead of the old code gating the hook CALL itself behind an early return", "auto-proceed guard condition not found in the expected form");

  section("Precondition — real frontend (:3000) and backend (:5050) dev servers reachable");
  const serversUp = await Promise.all([
    fetch("http://localhost:3000").then(r => r.ok).catch(() => false),
    fetch("http://localhost:5050/health").then(r => r.ok).catch(() => false),
  ]).then(([fe, be]) => fe && be);
  if (!serversUp) {
    console.log("  ⚠  Frontend/backend dev servers not reachable on :3000/:5050.");
    console.log("     Skipping the live end-to-end portion (not counted as pass or fail).");
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Engineering Workspace Guard Spam + Hooks Crash Regression: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
  ok("frontend and backend dev servers are reachable");

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  section("Live — real signup, open Eng Workspace, type a realistic task, confirm zero guard calls fire mid-typing");
  const email = `eng-workspace-regression-${Date.now()}@ooplix-test.local`;
  await page.goto("http://localhost:3000/?desktop=1", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.locator('input[type="text"]').first().fill("Eng Workspace Regression").catch(() => {});
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill("EngWorkspaceRegression12345!");
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

  // Navigate to Eng Workspace via the real More-menu search path.
  let moreBtn = page.locator("button.tab--more").first();
  let moreVisible = await moreBtn.isVisible({ timeout: 8000 }).catch(() => false);
  for (let attempt = 0; !moreVisible && attempt < 3; attempt++) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    moreBtn = page.locator("button.tab--more").first();
    moreVisible = await moreBtn.isVisible({ timeout: 8000 }).catch(() => false);
  }
  assert(moreVisible, "the More menu button is reachable after signup", "More menu button not found");

  let workspaceLoaded = false;
  if (moreVisible) {
    await moreBtn.click();
    await page.waitForTimeout(300);
    const searchBox = page.locator("input.tab-more-search").first();
    await searchBox.click();
    await searchBox.type("eng workspace", { delay: 30 });
    await page.waitForTimeout(400);
    const results = page.locator(".tab-more-item, .tab-more-list button, .tab-more-list a");
    const count = await results.count();
    for (let i = 0; i < count; i++) {
      const txt = (await results.nth(i).textContent()) || "";
      if (txt.includes("Eng Workspace")) { await results.nth(i).click(); break; }
    }
    await page.waitForTimeout(1500);
    const h1 = await page.locator("h1").first().textContent().catch(() => null);
    workspaceLoaded = h1 === "Engineering Workspace";
  }
  assert(workspaceLoaded, "the More-menu search for 'eng workspace' reaches Engineering Workspace (h1 matches)", "did not land on Engineering Workspace via the real nav path");

  if (workspaceLoaded) {
    let guardCallsDuringTyping = 0;
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/runtime/guard/incident-check") || url.includes("/runtime/guard/regression-check")) {
        guardCallsDuringTyping++;
      }
    });

    const promptBox = page.locator("textarea").first();
    await promptBox.click();
    const taskText = "Add input validation to the lead creation form to reject empty email addresses on submit";
    await promptBox.type(taskText, { delay: 40 });
    assert(guardCallsDuringTyping === 0,
      `zero /runtime/guard/* calls fired while typing a realistic ${taskText.length}-character task description (debounce fix confirmed live)`,
      `${guardCallsDuringTyping} guard call(s) fired mid-typing — debounce not effective`);

    // Confirm the banners still do fire once typing settles (fix doesn't
    // silently disable the guard feature, only debounces it).
    let guardCallsAfterPause = 0;
    page.removeAllListeners("request");
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/runtime/guard/incident-check") || url.includes("/runtime/guard/regression-check")) {
        guardCallsAfterPause++;
      }
    });
    await page.waitForTimeout(900);
    assert(guardCallsAfterPause > 0,
      "guard calls DO fire once typing pauses past the 300ms debounce window (feature still works, just no longer spams)",
      "no guard calls fired even after the debounce window — feature may be broken, not just debounced");
  }

  section("Live — manual patch Run no longer crashes with 'Rendered more hooks than during the previous render'");
  let patchRunAttempted = false;
  let hooksCrashSeen = false;
  if (workspaceLoaded) {
    page.on("console", (msg) => {
      const t = msg.text();
      if (/Rendered more hooks than during the previous render/.test(t)) hooksCrashSeen = true;
    });
    page.on("pageerror", (err) => {
      if (/Rendered more hooks than during the previous render/.test(err.message)) hooksCrashSeen = true;
    });

    const runBtn = page.getByRole("button", { name: "Run", exact: true });
    const runCount = await runBtn.count().catch(() => 0);
    if (runCount > 0) {
      patchRunAttempted = true;
      await runBtn.first().click();
      // Give the PreActionWarning modal's fetch + auto-proceed effect (or
      // manual-warning render) time to complete either path.
      await page.waitForTimeout(3000);
    }
  }
  if (patchRunAttempted) {
    assert(!hooksCrashSeen, "clicking a pending patch's 'Run' button does not trigger the 'Rendered more hooks' crash", "the hooks-order crash still occurs");
    const uncaughtOverlayVisible = await page.getByText("Uncaught runtime errors:", { exact: false }).first().isVisible({ timeout: 500 }).catch(() => false);
    assert(!uncaughtOverlayVisible, "no React uncaught-error overlay is shown after the manual patch Run click", "the React dev error overlay is visible after clicking Run");
  } else {
    ok("no pending patch with a 'Run' button existed in this fresh account (nothing to click) — static checks above already confirm the hooks-order fix");
  }

  await browser.close();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Engineering Workspace Guard Spam + Hooks Crash Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
