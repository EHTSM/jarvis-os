#!/usr/bin/env node
"use strict";
/**
 * C.5 — mobile responsive guards.
 *
 * Locks in the two safe, verified overflow fixes, and documents (via a
 * negative-shaped assertion) that the unsafe fix was deliberately NOT applied.
 *
 * MEASURED IN C.5, authenticated session, real browser, 390px viewport:
 *
 *   C5-01/01b  .org-switcher-trigger and .ws-switcher-trigger each had a BASE
 *              rule (max-width: 160px) with identical specificity to, and
 *              appearing AFTER, their own mobile override (max-width: 120px
 *              / undeclared). The cascade let the desktop value win at every
 *              viewport. Fixed by doubling the class selector in the mobile
 *              rule. Document overflow at 390px: 204px -> 123px (40%).
 *
 *   C5-01c (investigated, NOT applied) — overflow-x:auto on .topbar-actions
 *              (the same pattern .tabs uses successfully) closes the
 *              remaining 123px, but breaks .org-switcher-dropdown and
 *              .ws-switcher-dropdown: proven live that neither receives
 *              clicks with the scroll container active, and both receive
 *              clicks correctly without it. Shipping it would make
 *              organization/workspace switching unreachable on mobile — a
 *              correctness regression the mission's fix policy forbids
 *              trading for a cosmetic overflow reduction. This suite asserts
 *              the DROPDOWNS remain the priority: it does not require zero
 *              overflow, but it does require both dropdowns work.
 *
 * Requires a live backend on :5050 for the live browser assertions.
 * Usage: node tests/security/103-c5-mobile-guards.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");
const http   = require("http");

const PORT = process.env.PORT || 5050;
let pass = 0;
function ok(msg)        { pass++; console.log(`  ✓  ${msg}`); }
function section(title) { console.log(`\n[${title}]`); }
const read = p => fs.readFileSync(p, "utf8");
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "");

function request(method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "localhost", port: PORT, path: urlPath, method }, res => {
      res.on("data", () => {});
      res.on("end", () => resolve({ status: res.statusCode }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`timeout ${urlPath}`)); });
    req.end();
  });
}

async function main() {
  let live = true;
  try { const h = await request("GET", "/health"); assert.strictEqual(h.status, 200); }
  catch { live = false; console.log(`\n  NOTE — backend not reachable on :${PORT}; live assertions report SKIPPED (not passed).`); }

  section("C5-01/01b — switcher max-width overrides win the cascade");
  {
    const css = strip(read("frontend/src/App.css"));
    assert.ok(/\.org-switcher-trigger\.org-switcher-trigger\s*\{[^}]*max-width:\s*120px/.test(css),
      "the mobile org-switcher override must use a doubled selector (specificity 0,0,2,0) " +
      "to beat the base rule's identical-specificity max-width:160px, which appears " +
      "LATER in source order and would otherwise always win");
    ok("org-switcher mobile override has sufficient specificity to win");

    assert.ok(/\.ws-switcher-trigger\.ws-switcher-trigger\s*\{[^}]*max-width:\s*110px/.test(css),
      "the mobile workspace-switcher override must use the same doubled-selector pattern");
    ok("ws-switcher mobile override has sufficient specificity to win");
  }

  section("C5-01c — the unsafe scroll-container fix was NOT applied");
  {
    const css = strip(read("frontend/src/App.css"));
    // Find the mobile media block and confirm .topbar-actions does NOT carry
    // overflow-x:auto there — that is precisely the change proven to break
    // the switcher dropdowns.
    const mobileBlockMatch = css.match(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}\n\n@media \(max-width: 480px\)/);
    const mobileBlock = mobileBlockMatch ? mobileBlockMatch[1] : css;
    const topbarActionsOverflow = /\.topbar-actions\s*\{[^}]*overflow-x:\s*auto/.test(mobileBlock);
    assert.ok(!topbarActionsOverflow,
      "\"overflow-x: auto\" must NOT be applied to .topbar-actions on mobile — proven live " +
      "to make document.elementsFromPoint() miss .org-switcher-dropdown and " +
      ".ws-switcher-dropdown entirely (both receive zero clicks anywhere inside their own " +
      "bounding box) while working correctly without it");
    ok("the scroll-container approach remains unapplied — dropdowns take priority over overflow");
  }

  section("C5-01/01b — live: overflow reduced, dropdowns still reachable");
  if (live) {
    const { chromium } = require("playwright");
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
    const loginStatus = await page.evaluate(async d =>
      (await fetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) })).status,
      { email: "c2-audit-fixed@test.local", password: "C2Audit!2026x" });

    if (loginStatus !== 200) {
      console.log(`  —  SKIPPED (login returned ${loginStatus}, likely rate-limited) — not counted as a pass`);
    } else {
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3200);
      const hasTabs = await page.evaluate(() => !!document.querySelector(".tab"));
      if (!hasTabs) {
        console.log("  —  SKIPPED (auth did not verify — hasTabs false) — not counted as a pass");
      } else {
        const skip = await page.$(".cfr-btn-skip");
        if (skip) { await skip.click(); await page.waitForTimeout(900); }

        const overflow = await page.evaluate(() => {
          const de = document.documentElement;
          return de.scrollWidth - de.clientWidth;
        });
        // The mission requires document overflow to be REDUCED and dropdowns to still
        // work — not zero overflow, since closing it fully was proven unsafe.
        assert.ok(overflow < 204, `document overflow at 390px must be reduced below the ` +
          `original 204px baseline (measured ${overflow})`);
        ok(`document overflow at 390px reduced to ${overflow}px (baseline was 204px)`);

        for (const [label, triggerSel, dropdownSel] of [
          ["org-switcher", ".org-switcher-trigger", ".org-switcher-dropdown"],
          ["ws-switcher", ".ws-switcher-trigger", ".ws-switcher-dropdown"],
        ]) {
          const btn = await page.$(triggerSel);
          assert.ok(btn, `${triggerSel} must be present`);
          await btn.click();
          await page.waitForTimeout(500);
          const hit = await page.evaluate((sel) => {
            const dd = document.querySelector(sel);
            if (!dd) return false;
            const r = dd.getBoundingClientRect();
            const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + Math.min(20, r.height / 2));
            return document.elementsFromPoint(cx, cy).some(el => el === dd || dd.contains(el));
          }, dropdownSel);
          assert.ok(hit, `${label}'s dropdown must receive clicks at 390px — this is the ` +
            `exact regression C5-01c would have introduced`);
          ok(`${label} dropdown remains clickable at 390px`);
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(300);
        }
      }
    }
    await browser.close();
  } else {
    console.log("  —  SKIPPED (backend unavailable) — not counted as a pass");
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch(err => { console.error("FAILED:", err.message); process.exit(1); });
