#!/usr/bin/env node
"use strict";
/**
 * C.6 — cross-browser verification against the real authenticated SPA.
 *
 * Runs the SAME measurement suite against three real, independently-installed
 * browser engines (Chromium, Firefox, WebKit). Edge is NOT MEASURED — no
 * separate Edge binary exists on this system; msedge channel launch fails.
 * Never simulated, never extrapolated from Chromium.
 */

const { chromium, firefox, webkit } = require("playwright");
const fs = require("fs");

const BASE = "http://localhost:5050";
const OUT = process.argv[2] || "tmp/c6/c6-results.json";
const CREDS = { email: "c2-audit-fixed@test.local", password: "C2Audit!2026x" };

const ENGINES = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];

async function ensureAuth(page) {
  return page.evaluate(async d =>
    (await fetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) })).status, CREDS);
}

async function measureEngine(name, engine) {
  const result = { engine: name, version: null, blocked: null, journeys: {}, consoleErrors: [], jsErrors: [] };
  let browser;
  try {
    browser = await engine.launch({ timeout: 20000 });
  } catch (e) {
    result.blocked = `launch failed: ${e.message.split("\n")[0]}`;
    return result;
  }
  result.version = browser.version();

  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on("console", m => { if (m.type() === "error") result.consoleErrors.push(m.text().slice(0, 200)); });
    page.on("pageerror", e => result.jsErrors.push(e.message.slice(0, 200)));

    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 20000 });
    const loginStatus = await ensureAuth(page);
    result.journeys.authLogin = { status: loginStatus };
    if (loginStatus !== 200) {
      result.blocked = `login returned ${loginStatus}`;
      await ctx.close(); await browser.close();
      return result;
    }

    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3500);
    const hasTabs = await page.evaluate(() => !!document.querySelector(".tab"));
    result.journeys.authVerified = hasTabs;
    if (!hasTabs) {
      result.blocked = "auth did not verify (hasTabs=false) after login 200";
      await ctx.close(); await browser.close();
      return result;
    }

    const skip = await page.$(".cfr-btn-skip");
    if (skip) { await skip.click().catch(() => {}); await page.waitForTimeout(900); }

    // A. login -> dashboard (already done above)
    result.journeys.dashboardLoaded = await page.evaluate(() => document.body.innerText.length > 100);

    // B. workspace/org switching — open the dropdown, verify it renders and receives clicks
    {
      const orgBtn = await page.$(".org-switcher-trigger");
      if (orgBtn) {
        await orgBtn.click().catch(() => {});
        await page.waitForTimeout(500);
        const dd = await page.evaluate(() => {
          const d = document.querySelector(".org-switcher-dropdown");
          if (!d) return { found: false };
          const r = d.getBoundingClientRect();
          const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + Math.min(20, r.height / 2));
          const hits = document.elementsFromPoint ? document.elementsFromPoint(cx, cy) : [];
          return { found: true, visible: r.width > 0, hitsDropdown: hits.some(el => el === d || d.contains(el)) };
        });
        result.journeys.orgSwitcherDropdown = dd;
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
      } else {
        result.journeys.orgSwitcherDropdown = { found: false, note: "trigger not found" };
      }
    }

    // I. search / command palette
    {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k").catch(() => {});
      await page.waitForTimeout(600);
      const palette = await page.evaluate(() => {
        const d = document.querySelector("[role=dialog]");
        return d ? { open: true, resultCount: document.querySelectorAll("[role=option]").length } : { open: false };
      });
      result.journeys.commandPalette = palette;
      if (palette.open) {
        await page.keyboard.type("payments").catch(() => {});
        await page.waitForTimeout(500);
        const searched = await page.evaluate(() => document.querySelectorAll("[role=option]").length);
        result.journeys.paletteSearch = { resultCount: searched };
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(400);
        result.journeys.paletteEscapeCloses = await page.evaluate(() => !document.querySelector("[role=dialog]"));
      }
    }

    // C/D/E/F: representative surfaces — Contacts (CRM), Payments (finance), Pipeline (sales)
    for (const [key, label] of [["crm", "Contacts"], ["finance", "Payments"], ["sales", "Pipeline"], ["ai", "AI"]]) {
      try {
        await page.getByText(label, { exact: true }).first().click({ timeout: 8000 });
        await page.waitForTimeout(1200);
        const state = await page.evaluate(() => ({
          hasContent: document.body.innerText.length > 50,
          docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }));
        result.journeys[key] = state;
      } catch (e) {
        result.journeys[key] = { error: e.message.slice(0, 100) };
      }
    }

    // J. settings
    try {
      await page.getByText(/^More/, { exact: false }).first().click({ timeout: 8000 });
      await page.waitForTimeout(800);
      await page.getByText(/settings/i, { exact: false }).first().click({ timeout: 8000 });
      await page.waitForTimeout(1200);
      result.journeys.settings = { hasContent: (await page.evaluate(() => document.body.innerText.length)) > 100 };
    } catch (e) {
      result.journeys.settings = { error: e.message.slice(0, 100) };
    }

    // Forms — Payments empty-submit validation
    try {
      await page.getByText("Payments", { exact: true }).first().click({ timeout: 8000 });
      await page.waitForTimeout(1000);
      const btn = await page.$("button:has-text('Generate Link')");
      if (btn) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(1000);
        const errText = await page.evaluate(() => document.querySelector(".pv2-err")?.textContent || null);
        result.journeys.formValidation = { errorShown: !!errText, text: errText };
      }
    } catch (e) { result.journeys.formValidation = { error: e.message.slice(0, 100) }; }

    // CSS rendering checks — flex/grid/sticky/backdrop-filter support
    result.journeys.cssSupport = await page.evaluate(() => {
      const test = (prop, val) => { try { return CSS.supports(prop, val); } catch { return null; } };
      return {
        flex: test("display", "flex"), grid: test("display", "grid"),
        sticky: test("position", "sticky"), backdropFilter: test("backdrop-filter", "blur(4px)") ?? test("-webkit-backdrop-filter", "blur(4px)"),
        cssVars: test("--x", "1"), gap: test("gap", "8px"),
      };
    });

    await ctx.close();
  } catch (e) {
    result.blocked = `measurement error: ${e.message.slice(0, 200)}`;
  }
  await browser.close();
  return result;
}

(async () => {
  const results = [];
  for (const [name, engine] of ENGINES) {
    console.log(`\n=== ${name} ===`);
    const r = await measureEngine(name, engine);
    results.push(r);
    console.log(JSON.stringify(r, null, 1));
  }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nwritten: ${OUT}`);
})();
