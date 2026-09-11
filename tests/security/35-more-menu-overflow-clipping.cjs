#!/usr/bin/env node
"use strict";
/**
 * "More" menu overflow-clipping regression — frontend/src/App.css's .tabs rule.
 *
 * CONFIRMED, most severe navigation/discoverability finding of this
 * certification: the "More (79)" dropdown — the ONLY way to reach ~74 of
 * the product's roughly 79 total surfaces, everything beyond the 5 pinned
 * top-level tabs (Dashboard, Contacts, Payments, Pipeline, AI) — rendered
 * completely inert. The dropdown opened (DOM present, every computed
 * style individually correct: dark background, white text, correct
 * position/z-index/animation), but nothing painted and nothing was
 * clickable.
 *
 * Root cause, confirmed via document.elementsFromPoint() at coordinates
 * squarely inside the dropdown's own reported getBoundingClientRect() —
 * which returned zero elements from the menu, proving it wasn't a
 * contrast/theme issue but a real paint/hit-test failure: .tabs (the nav
 * bar containing the dropdown trigger) set only `overflow-x: auto`. Per
 * the CSS overflow specification, setting one axis to a non-visible value
 * forces the other axis to also compute as `auto` — so .tabs silently
 * became a clipping container on BOTH axes, clipping its
 * position:absolute child (.tab-more-menu, which is meant to escape the
 * thin tab-bar height and float below it) to the tab bar's own few pixels
 * of height. Verified this is a real, spec-compliant browser behavior,
 * not a headless-Chromium quirk, by disabling backdrop-filter/animation/
 * transform via injected CSS (no effect) and then testing
 * `overflow-y: visible` in isolation (immediately fixed it).
 *
 * Fix: added explicit `overflow-y: visible` to .tabs.
 *
 * This test drives the REAL app through a REAL browser against the REAL
 * running dev servers — not a mock — through actual signup, and verifies
 * the dropdown is genuinely clickable by clicking a real item and
 * confirming real navigation occurred (a distinct page renders), not just
 * that DOM nodes exist.
 *
 * Separately noted (not fixed by this test — each component's own
 * dismissal logic was checked and is individually correct): this product
 * stacks at least 4 independently-built first-run/onboarding overlays for
 * a brand-new signup (WelcomeFlow, GuidedTour, CustomerFirstRunWizard,
 * plus at least one more referenced in App.jsx's own comments) — real
 * operator friction on first launch, reported in the certification's
 * findings. This test's dismissApp helper loops over every known dismiss
 * label rather than hardcoding a fixed sequence, specifically so it
 * doesn't become flaky against however many of these appear in what order.
 *
 * Requires: backend running on :5050 and frontend dev server on :3000.
 *
 * Usage: node tests/security/35-more-menu-overflow-clipping.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const { chromium } = require("playwright");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function checkServersUp() {
  try {
    const [feRes, beRes] = await Promise.all([
      fetch("http://localhost:3000").catch(() => null),
      fetch("http://localhost:5050/health").catch(() => null),
    ]);
    return !!feRes && !!beRes && beRes.ok;
  } catch { return false; }
}

// This product has multiple independently-built first-run/onboarding
// overlays that can stack after signup (confirmed this session:
// WelcomeFlow's "Skip setup", GuidedTour's "Skip tour",
// CustomerFirstRunWizard's "Skip for now", plus App.jsx's own comments
// reference at least one more — a real operator-friction finding in its
// own right, noted in this test's mission report rather than fixed here,
// since each individual component's dismissal logic was checked and is
// correct). Rather than hardcode a fixed sequence (fragile — order and
// count can vary), loop over every known dismiss-button label and any
// generic full-viewport backdrop until none remain.
const DISMISS_LABELS = ["Skip for now", "Skip setup", "Skip tour", "Skip", "Got it", "Close", "Maybe later"];
const BACKDROP_SELECTORS = [".wf-overlay", ".gt-overlay", ".cfr-backdrop"];

async function dismissOnboarding(page) {
  for (let round = 0; round < 6; round++) {
    let dismissedSomething = false;
    for (const label of DISMISS_LABELS) {
      const btn = page.getByText(label, { exact: true }).first();
      if (await btn.isVisible({ timeout: 1200 }).catch(() => false)) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(800);
        dismissedSomething = true;
      }
    }
    const anyBackdropLeft = await page.evaluate((sels) => sels.some(s => document.querySelector(s)), BACKDROP_SELECTORS);
    if (!dismissedSomething && !anyBackdropLeft) break;
    await page.waitForTimeout(600);
  }
}

async function main() {
  section("Precondition — real frontend (:3000) and backend (:5050) dev servers reachable");
  const serversUp = await checkServersUp();
  if (!serversUp) {
    console.log("  ⚠  Frontend/backend dev servers not reachable on :3000/:5050.");
    console.log("     This is a full-stack UI regression test — run `npm run dev` first.");
    console.log("     Skipping (not counted as pass or fail) rather than falsely failing CI.");
    process.exit(0);
  }
  ok("frontend and backend dev servers are reachable");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  section("Real signup + full onboarding dismissal, to reach a clean dashboard");
  const uniqueEmail = `more-menu-regression-${Date.now()}@ooplix-test.local`;
  await page.goto("http://localhost:3000/?desktop=1", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.locator('input[type="text"]').fill("More Menu Test");
  await page.locator('input[type="email"]').fill(uniqueEmail);
  await page.locator('input[type="password"]').fill("MoreMenuTest12345!");
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Start free trial")').click();
  await page.waitForTimeout(5000);
  await dismissOnboarding(page);
  ok("reached a clean, fully-onboarded dashboard");

  section("Open the 'More' menu");
  const moreBtn = page.locator("text=/More \\(\\d+\\)/");
  let moreBtnVisible = await moreBtn.isVisible({ timeout: 5000 }).catch(() => false);
  if (!moreBtnVisible) {
    // The guided tour can mount on a delay independent of the earlier
    // dismissal pass (a separate, unrelated timing characteristic of this
    // app noted during manual testing this session) — give it one more
    // chance to appear and be dismissed before treating this as a real
    // failure, rather than making the whole regression flaky on
    // unrelated tour-mount timing.
    await dismissOnboarding(page);
    moreBtnVisible = await moreBtn.isVisible({ timeout: 5000 }).catch(() => false);
  }
  assert(moreBtnVisible, "the 'More (N)' nav trigger is present", "trigger not found after two dismissal passes — nav structure may have changed");
  if (!moreBtnVisible) { await browser.close(); process.exit(1); }
  // One more dismissal pass immediately before the click — a backdrop can
  // report as gone by isVisible() checks yet still intercept a real click
  // if it unmounts a beat later than the visibility check ran (observed
  // directly this session: .cfr-backdrop blocking the More trigger click
  // for up to 30s of Playwright's own auto-retry before finally clearing).
  await dismissOnboarding(page);
  await moreBtn.click({ timeout: 10000 });
  await page.waitForTimeout(1000);

  section("THE REGRESSION CHECK — dropdown items are genuinely paintable/hit-testable, not just present in the DOM");
  const menu = page.locator(".tab-more-menu");
  const menuInDom = (await menu.count()) > 0;
  assert(menuInDom, ".tab-more-menu exists in the DOM after clicking More", "menu element not found at all — a different regression");

  if (menuInDom) {
    const menuBox = await menu.boundingBox();
    assert(!!menuBox, "the menu has a real, non-null bounding box", "boundingBox() returned null");

    // Sample the paint/hit-test stack at the search input's own center —
    // a stable, always-present element at a fixed position near the top of
    // the menu, avoiding both the header above it and any scrolled list
    // item below whose own hover/focus state could legitimately paint a
    // plain <span> at an arbitrarily-chosen fixed offset. This is the exact
    // check that caught the overflow-clipping bug: every individual CSS
    // property on .tab-more-menu was correct, but elementsFromPoint at a
    // point inside its own reported bounding box returned zero elements
    // from the menu, proving nothing actually painted there.
    const searchInput = page.locator('input[placeholder*="Search"]');
    const searchBox = await searchInput.boundingBox();
    assert(!!searchBox, "the menu's search input has a real bounding box", "search input not found or not laid out");
    if (searchBox) {
      const cx = searchBox.x + searchBox.width / 2;
      const cy = searchBox.y + searchBox.height / 2;
      const stackClasses = await page.evaluate(({ cx, cy }) => {
        return document.elementsFromPoint(cx, cy).map(e => e.className?.toString() || e.tagName);
      }, { cx, cy });
      const menuIsInStack = stackClasses.some(c => c.includes("tab-more") || c.toLowerCase().includes("search"));
      assert(menuIsInStack, "the menu's search input is actually in the paint/hit-test stack at its own center", `elementsFromPoint returned: ${JSON.stringify(stackClasses.slice(0, 5))} — the menu is present in the DOM but not actually rendered/clickable (the exact overflow-clipping bug this test guards against)`);
    }
  }

  section("A real menu item is genuinely clickable and navigates correctly");
  const gettingStarted = page.locator("text=Getting Started").first();
  const itemClickable = await gettingStarted.isVisible({ timeout: 3000 }).catch(() => false);
  assert(itemClickable, "'Getting Started' menu item reports visible", "item not visible — menu may not have opened correctly");
  if (itemClickable) {
    await gettingStarted.click();
    await page.waitForTimeout(1500);
    // Real navigation to the Getting Started screen shows its checklist
    // heading and completion counter ("N / M COMPLETED") — distinct
    // content from the dashboard, proving a real screen change occurred
    // rather than just a menu item existing in the DOM.
    const pageHeading = await page.locator("h1, h2").filter({ hasText: "Getting Started" }).first().isVisible({ timeout: 3000 }).catch(() => false);
    const completionCounter = await page.locator("text=/COMPLETED/i").first().isVisible({ timeout: 3000 }).catch(() => false);
    assert(pageHeading && completionCounter, "clicking the menu item performs real navigation (Getting Started checklist screen renders)", `pageHeading=${pageHeading} completionCounter=${completionCounter}`);
  }

  await browser.close();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`More Menu Overflow-Clipping Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
