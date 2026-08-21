#!/usr/bin/env node
"use strict";
/**
 * C.5 — mobile viewport measurement against the real authenticated SPA.
 *
 * Reuses the harness pattern proven correct in C.1-C.4:
 *   - Ooplix has no URL router; log in, dismiss the first-run wizard, drive tabs.
 *   - A fixed reusable account avoids the 5/15min signup rate limit.
 *   - Auth state is verified BEFORE measuring, so an unauthenticated shell is
 *     never mistaken for a mobile defect.
 */

const { chromium } = require("playwright");
const fs = require("fs");

const BASE = "http://localhost:5050";
const OUT = process.argv[2] || "tmp/c5/c5-viewports.json";
const CREDS = { email: "c2-audit-fixed@test.local", password: "C2Audit!2026x" };

const VIEWPORTS = [
  { w: 390, h: 844, label: "390x844" },
  { w: 430, h: 932, label: "430x932" },
  { w: 768, h: 1024, label: "768x1024" },
  { w: 1024, h: 1366, label: "1024x1366" },
  { w: 1440, h: 900, label: "1440x900" },
];

async function login(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const status = await page.evaluate(async d =>
    (await fetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) })).status, CREDS);
  const cookies = (await ctx.cookies()).filter(c => c.name === "jarvis_auth");
  await ctx.close();
  return { ok: status === 200 && cookies.length > 0, status, cookies };
}

const OVERFLOW_PROBE = () => {
  const de = document.documentElement, b = document.body;
  const dims = {
    docScrollWidth: de.scrollWidth, docClientWidth: de.clientWidth,
    bodyScrollWidth: b.scrollWidth, bodyClientWidth: b.clientWidth,
  };
  const hOverflow = de.scrollWidth > de.clientWidth + 1;
  let culprit = null;
  if (hOverflow) {
    // Find the widest element that exceeds the viewport — the actual overflow source.
    let worst = null, worstRight = de.clientWidth;
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > worstRight + 1) {
        worstRight = r.right;
        worst = el;
      }
    }
    if (worst) {
      const cs = getComputedStyle(worst);
      culprit = {
        tag: worst.tagName.toLowerCase(),
        cls: (worst.className || "").toString().slice(0, 60),
        rectRight: Math.round(worstRight),
        width: Math.round(worst.getBoundingClientRect().width),
        computedWidth: cs.width, minWidth: cs.minWidth, position: cs.position,
        display: cs.display, whiteSpace: cs.whiteSpace,
        parentTag: worst.parentElement?.tagName.toLowerCase() || null,
        parentCls: (worst.parentElement?.className || "").toString().slice(0, 60),
      };
    }
  }
  return { dims, hOverflow, overflowPx: Math.max(0, de.scrollWidth - de.clientWidth), culprit };
};

const SURFACE_PROBE = () => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const tabs = [...document.querySelectorAll(".tab")].filter(vis);
  const clippedTabs = tabs.filter(t => { const r = t.getBoundingClientRect(); return r.right > window.innerWidth + 1 || r.left < -1; });
  return {
    tabsVisible: tabs.length,
    tabsClipped: clippedTabs.length,
    hasMoreButton: !!document.querySelector('.tab-more, [class*="more"]'),
    focusableCount: [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea')].filter(vis).length,
    bodyTextLen: document.body.innerText.length,
  };
};

(async () => {
  const browser = await chromium.launch();
  const auth = await login(browser);
  console.log(`auth: ${auth.ok ? "OK (200, session cookie present)" : "FAILED status=" + auth.status}`);
  if (!auth.ok) { fs.writeFileSync(OUT, JSON.stringify({ blocked: `auth failed status=${auth.status}` }, null, 2)); await browser.close(); process.exit(0); }

  const results = [];
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    await ctx.addCookies(auth.cookies);
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3200);

    // Verify auth state BEFORE measuring — an unauthenticated shell must never
    // be recorded as a mobile defect.
    const authCheck = await page.evaluate(() => ({
      hasTabs: !!document.querySelector(".tab"),
      bodyStart: document.body.innerText.slice(0, 60).replace(/\n+/g, " | "),
    }));

    const skip = await page.$(".cfr-btn-skip");
    if (skip) { await skip.click(); await page.waitForTimeout(900); }

    const overflow = await page.evaluate(OVERFLOW_PROBE);
    const surface = await page.evaluate(SURFACE_PROBE);

    const row = { viewport: vp.label, w: vp.w, h: vp.h, authVerified: authCheck.hasTabs, overflow, surface };
    results.push(row);
    console.log(`  ${vp.label.padEnd(10)} auth=${authCheck.hasTabs ? "OK" : "FAIL"}  hOverflow=${overflow.hOverflow}  overflowPx=${overflow.overflowPx}  tabs=${surface.tabsVisible}/clipped=${surface.tabsClipped}  culprit=${overflow.culprit ? overflow.culprit.tag + "." + overflow.culprit.cls : "-"}`);
    await ctx.close();
  }

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nwritten: ${OUT}`);
})();
