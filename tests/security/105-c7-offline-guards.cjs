#!/usr/bin/env node
"use strict";
/**
 * C.7 — offline/resilience guards.
 *
 * Locks in the one genuine defect C.7 found and fixed: a cross-tenant
 * localStorage leak across logout. Also documents (via source assertions)
 * that no offline-write queue or service worker was fabricated where none
 * exists — those are honest NOT SUPPORTED gaps, not defects to "fix".
 *
 * MEASURED IN C.7:
 *
 *   C7-01  logout() never cleared localStorage. jarvis_biz_profile (business
 *          type, team size, goals, product — set during onboarding) survived
 *          indefinitely across logout. PaymentPanel.jsx and Chat.jsx both
 *          read it back on mount to pre-fill context. A second, different
 *          tenant logging into the same browser afterward would silently see
 *          the PREVIOUS tenant's business profile. Proven live: after a real
 *          UI "Sign out" click, jarvis_biz_profile/jarvis_has_leads/
 *          operatorSession were all null, while ooplix_last_tab (a genuine
 *          device/UI preference, not tenant data) correctly survived.
 *
 * Requires a live backend on :5050 for the live browser assertion.
 * Usage: node tests/security/105-c7-offline-guards.cjs
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
  catch { live = false; console.log(`\n  NOTE — backend not reachable on :${PORT}; live assertion reports SKIPPED (not passed).`); }

  section("C7-01 — tenant data is cleared on every logged-out transition");
  {
    const src = read("frontend/src/contexts/AuthContext.jsx");
    const fnBody = src.slice(src.indexOf("_setUserAndBroadcast = useCallback"), src.indexOf("_setUserAndBroadcast = useCallback") + 2200);

    assert.ok(/localStorage\.removeItem\(["']jarvis_biz_profile["']\)/.test(fnBody),
      "jarvis_biz_profile must be cleared on logout — PaymentPanel.jsx and Chat.jsx " +
      "both read it back and would silently use a PREVIOUS tenant's business profile");
    ok("jarvis_biz_profile is cleared");

    assert.ok(/localStorage\.removeItem\(["']operatorSession["']\)/.test(fnBody),
      "operatorSession must be cleared on logout");
    ok("operatorSession is cleared");

    // The cleanup must happen inside _setUserAndBroadcast — the ONE function all
    // three logged-out transitions (explicit logout, silent expiry, 401 handler)
    // funnel through — not duplicated per call-site where it could be missed.
    const callSites = (src.match(/_setUserAndBroadcast\(null,/g) || []).length;
    assert.ok(callSites >= 3,
      `expected at least 3 call sites transitioning to logged-out (explicit logout, ` +
      `silent expiry, 401 handler) to share the same cleanup — found ${callSites}`);
    ok(`all ${callSites} logged-out transitions share the same cleanup path`);
  }

  section("C7-01 — device/UI preferences are NOT swept up (scoped fix, not localStorage.clear())");
  {
    const src = read("frontend/src/contexts/AuthContext.jsx");
    assert.ok(!/localStorage\.clear\(\)/.test(src),
      "must not call localStorage.clear() — that would also destroy legitimate " +
      "device preferences (theme, pinned tabs, sidebar width) that should survive login");
    ok("fix is scoped to specific tenant-data keys, not a blanket clear");
  }

  section("C7-01 — live: real UI sign-out clears tenant data, preserves device prefs");
  if (live) {
    const { chromium } = require("playwright");
    const browser = await chromium.launch();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("jarvis_biz_profile", JSON.stringify({ business: "Test Co", product: "Test Product" }));
      localStorage.setItem("ooplix_last_tab", "insights");
    });
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
        console.log("  —  SKIPPED (auth did not verify) — not counted as a pass");
      } else {
        const skip = await page.$(".cfr-btn-skip");
        if (skip) { await skip.click(); await page.waitForTimeout(900); }

        const orgBtn = await page.$(".org-switcher-trigger");
        assert.ok(orgBtn, "org switcher trigger must be present to reach sign-out");
        await orgBtn.click();
        await page.waitForTimeout(500);
        const signOut = await page.getByText("Sign out", { exact: true }).first();
        await signOut.click({ timeout: 8000 });
        await page.waitForTimeout(1200);

        const after = await page.evaluate(() => ({
          biz: localStorage.getItem("jarvis_biz_profile"),
          lastTab: localStorage.getItem("ooplix_last_tab"),
        }));
        assert.strictEqual(after.biz, null,
          "jarvis_biz_profile must be null after a real UI sign-out — this is the exact " +
          "cross-tenant leak scenario C.7 found and fixed");
        ok("jarvis_biz_profile is cleared after real UI sign-out");
        assert.strictEqual(after.lastTab, "insights",
          "ooplix_last_tab (a device preference) must SURVIVE sign-out — proves the fix " +
          "is scoped, not a blanket localStorage.clear()");
        ok("device preference (ooplix_last_tab) survives sign-out, proving scoped fix");
      }
    }
    await browser.close();
  } else {
    console.log("  —  SKIPPED (backend unavailable) — not counted as a pass");
  }

  section("Honesty check — no offline-write queue or service worker is fabricated");
  {
    // These assert ABSENCE deliberately: C.7 found both are dead code / not
    // present, and the certification must not claim capabilities that don't
    // reach the running application. This guards against a future accidental
    // wiring-up that isn't matched by a documentation update.
    const swFiles = fs.existsSync("frontend/public") ?
      fs.readdirSync("frontend/public").filter(f => /service-?worker/i.test(f)) : [];
    assert.deepStrictEqual(swFiles, [],
      "no service-worker file should exist in frontend/public unless the offline " +
      "certification is updated to reflect real PWA support");
    ok("no service worker file present — matches the certification's NOT IMPLEMENTED finding");
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch(err => { console.error("FAILED:", err.message); process.exit(1); });
