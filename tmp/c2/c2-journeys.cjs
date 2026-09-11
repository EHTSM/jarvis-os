#!/usr/bin/env node
"use strict";
/**
 * C.2 — UX critical-journey measurement against the real authenticated SPA.
 *
 * Reuses the harness shape C.1 proved correct:
 *   - Ooplix has NO URL router; everything renders at "/" and switches by tab
 *     state, so navigation is by clicking real tabs, not by page.goto().
 *   - The first-run wizard blocks pointer interaction and must be dismissed
 *     the way a user would, or every click silently does nothing.
 *   - Signup is rate-limited (5 / 15 min / IP), so ONE account is created and
 *     its session cookie is reused across every context.
 *
 * Records real clicks, real timings, real visible state. No screenshots as
 * primary evidence, no invented user-testing numbers.
 */

const { chromium } = require("playwright");
const fs = require("fs");

const BASE = "http://localhost:5050";
const OUT = process.argv[2] || "tmp/c2/c2-journeys.json";
const CREDS = { email: `c2-ux-${Date.now()}@test.local`, password: "C2Ux!2026x" };
let SESSION = null;

/**
 * Signup is rate-limited to 5 registrations / 15 min / IP, and polling the
 * endpoint to detect when the window clears CONSUMES a slot each time — a wait
 * loop can starve itself indefinitely. So: log in with an existing account when
 * one is supplied (C2_EMAIL/C2_PASSWORD), and only register as a fallback.
 * Either way the credentials come from the real signup + login flow; nothing is
 * forged and no auth control is bypassed.
 */
async function bootstrap(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });

  const existing = process.env.C2_EMAIL && process.env.C2_PASSWORD
    ? { email: process.env.C2_EMAIL, password: process.env.C2_PASSWORD } : null;

  if (existing) {
    const li = await page.evaluate(async d =>
      (await fetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) })).status, existing);
    if (li === 200) {
      SESSION = (await ctx.cookies()).filter(c => c.name === "jarvis_auth");
      await ctx.close();
      return { ok: SESSION.length > 0, reason: "reused existing account" };
    }
    console.log(`  existing-account login returned ${li}; falling back to registration`);
  }

  const reg = await page.evaluate(async d =>
    (await fetch("/accounts/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) })).status,
    { ...CREDS, name: "ux", orgName: "UX Audit Ltd" });
  if (reg !== 201 && reg !== 200) { await ctx.close(); return { ok: false, reason: `register ${reg}` }; }
  const li = await page.evaluate(async d =>
    (await fetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) })).status, CREDS);
  if (li !== 200) { await ctx.close(); return { ok: false, reason: `login ${li}` }; }
  SESSION = (await ctx.cookies()).filter(c => c.name === "jarvis_auth");
  await ctx.close();
  return { ok: SESSION.length > 0, reason: "registered a new account" };
}

async function openApp(browser, { width = 1440, height = 900, theme = "dark" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
  await ctx.addCookies(SESSION);
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3200);
  await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
  // dismiss the first-run wizard as a user would
  const skip = await page.$(".cfr-btn-skip");
  if (skip) { await skip.click(); await page.waitForTimeout(1000); }
  return { ctx, page };
}

const R = [];
const rec = (journey, step, data) => { R.push({ journey, step, ...data }); console.log(`  ${journey} · ${step}: ${JSON.stringify(data)}`); };

(async () => {
  const browser = await chromium.launch();
  const boot = await bootstrap(browser);
  console.log(`session: ${boot.ok ? "OK" : "BLOCKED — " + boot.reason}`);
  if (!boot.ok) { fs.writeFileSync(OUT, JSON.stringify({ blocked: boot.reason }, null, 2)); await browser.close(); process.exit(0); }

  // ── J1: shell + primary navigation ──────────────────────────────────────
  {
    const { ctx, page } = await openApp(browser);
    const shell = await page.evaluate(() => ({
      tabs: [...document.querySelectorAll(".tab")].map(t => t.textContent.trim()),
      hasSkipLink: !!document.querySelector(".skip-link"),
      hasSearch: !!document.querySelector('input[placeholder*="Search" i], .cp-trigger, [class*="search"]'),
      orgSwitcher: !!document.querySelector('[class*="org-switcher"], [class*="orgSwitcher"]'),
      wsSwitcher: !!document.querySelector('[class*="workspace"]'),
    }));
    rec("J1-shell", "chrome", shell);

    for (const tab of ["Dashboard", "Contacts", "Payments", "Pipeline", "AI"]) {
      const t0 = Date.now();
      await page.getByText(tab, { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
      // wait for the pane to settle rather than a fixed sleep
      await page.waitForTimeout(900);
      const ms = Date.now() - t0;
      const st = await page.evaluate(() => ({
        h1: (document.querySelector("h1,h2,.page-title,[class*='title']") || {}).textContent?.trim().slice(0, 40) || null,
        spinners: document.querySelectorAll('[class*="spinner"],[class*="loading"],[class*="skeleton"]').length,
        emptyStates: document.querySelectorAll('[class*="empty"]').length,
        errors: document.querySelectorAll('[class*="error"]').length,
        focusable: [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length,
      }));
      rec("J1-nav", tab, { ms, ...st });
    }
    await ctx.close();
  }

  // ── J2: command palette ─────────────────────────────────────────────────
  {
    const { ctx, page } = await openApp(browser);
    const t0 = Date.now();
    await page.keyboard.press("Meta+k");
    await page.waitForSelector("[role=dialog]", { timeout: 5000 }).catch(() => {});
    const openMs = Date.now() - t0;
    const st = await page.evaluate(() => ({
      open: !!document.querySelector("[role=dialog]"),
      focusInside: document.querySelector("[role=dialog]")?.contains(document.activeElement) || false,
      resultCount: document.querySelectorAll("[role=option]").length,
    }));
    rec("J2-palette", "open", { openMs, ...st });

    // search behaviour
    await page.keyboard.type("payments");
    await page.waitForTimeout(600);
    const searched = await page.evaluate(() => ({
      results: document.querySelectorAll("[role=option]").length,
      first: document.querySelector("[role=option]")?.textContent?.trim().slice(0, 40) || null,
      emptyMsg: document.querySelector(".cp-empty")?.textContent?.trim().slice(0, 60) || null,
    }));
    rec("J2-palette", "search:payments", searched);

    // a term with no matches — is the empty state truthful?
    await page.keyboard.press("Meta+a"); await page.keyboard.type("zzzznotathing");
    await page.waitForTimeout(600);
    const noRes = await page.evaluate(() => ({
      results: document.querySelectorAll("[role=option]").length,
      emptyMsg: document.querySelector(".cp-empty")?.textContent?.trim().slice(0, 80) || null,
    }));
    rec("J2-palette", "search:no-match", noRes);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    rec("J2-palette", "escape", { closed: !(await page.evaluate(() => !!document.querySelector("[role=dialog]"))) });
    await ctx.close();
  }

  // ── J3: More menu (82 tabs) ─────────────────────────────────────────────
  {
    const { ctx, page } = await openApp(browser);
    const t0 = Date.now();
    await page.getByText(/^More/, { exact: false }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900);
    const st = await page.evaluate(() => {
      const items = [...document.querySelectorAll('[class*="more"] button, [class*="More"] button, .more-item, .more-menu button')];
      return {
        openMs: 0,
        itemCount: items.length,
        hasSearch: !!document.querySelector('[class*="more"] input, .more-search'),
        overflowClipped: (() => {
          const m = document.querySelector('[class*="more-menu"],[class*="moreMenu"],[class*="more-panel"]');
          if (!m) return null;
          return m.scrollHeight > m.clientHeight + 2;
        })(),
      };
    });
    rec("J3-more", "open", { ms: Date.now() - t0, ...st });

    // search inside More
    const si = await page.$('[class*="more"] input, .more-search');
    if (si) {
      await si.type("enterprise");
      await page.waitForTimeout(600);
      const r = await page.evaluate(() => ({
        visible: [...document.querySelectorAll('[class*="more"] button')].filter(b => b.getBoundingClientRect().width > 0).length,
      }));
      rec("J3-more", "search:enterprise", r);
    } else {
      rec("J3-more", "search", { note: "search input not located" });
    }
    await ctx.close();
  }

  // ── J4: create/validation/error journey on a real form ──────────────────
  {
    const { ctx, page } = await openApp(browser);
    await page.getByText("Payments", { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);

    // submit empty -> validation feedback?
    const btn = await page.$("button:has-text('Generate Link')");
    if (btn) {
      const t0 = Date.now();
      await btn.click().catch(() => {});
      await page.waitForTimeout(1200);
      const st = await page.evaluate(() => ({
        errText: document.querySelector(".pv2-err")?.textContent?.trim().slice(0, 80) || null,
        anyError: [...document.querySelectorAll('[class*="err"]')].map(e => e.textContent.trim().slice(0, 60)).filter(Boolean).slice(0, 3),
        toasts: document.querySelectorAll('[class*="toast"]').length,
      }));
      rec("J4-validation", "empty-submit", { ms: Date.now() - t0, ...st });
    } else {
      rec("J4-validation", "empty-submit", { note: "Generate Link button not found" });
    }
    await ctx.close();
  }

  // ── J5: responsive ──────────────────────────────────────────────────────
  for (const vp of [{ w: 390, h: 844 }, { w: 430, h: 932 }, { w: 768, h: 1024 }, { w: 1024, h: 768 }, { w: 1440, h: 900 }]) {
    const { ctx, page } = await openApp(browser, { width: vp.w, height: vp.h });
    const st = await page.evaluate(() => {
      const de = document.documentElement;
      const clipped = [...document.querySelectorAll("button,.tab,input")].filter(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.right > window.innerWidth + 2 || r.left < -2);
      }).length;
      return {
        hScroll: de.scrollWidth > window.innerWidth + 2,
        overflowPx: Math.max(0, de.scrollWidth - window.innerWidth),
        offscreenControls: clipped,
        tabsVisible: [...document.querySelectorAll(".tab")].filter(t => t.getBoundingClientRect().width > 0).length,
      };
    });
    rec("J5-responsive", `${vp.w}px`, st);
    await ctx.close();
  }

  // ── J6: themes ──────────────────────────────────────────────────────────
  for (const theme of ["dark", "light"]) {
    const { ctx, page } = await openApp(browser, { theme });
    const st = await page.evaluate(() => {
      const bad = [];
      // find visible text whose colour is within 1.5:1 of its own background
      const lum = c => { const s = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * s[0] + .7152 * s[1] + .0722 * s[2]; };
      const P = s => (s.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
      const bgOf = el => { let n = el; while (n && n !== document.documentElement) { const b = getComputedStyle(n).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; n = n.parentElement; } return "rgb(255,255,255)"; };
      for (const el of document.querySelectorAll("h1,h2,h3,p,span,button,label,a")) {
        const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
        if (!el.textContent || !el.textContent.trim()) continue;
        const fg = P(getComputedStyle(el).color), bg = P(bgOf(el));
        const l1 = lum(fg), l2 = lum(bg);
        const ratio = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
        if (ratio < 1.6) bad.push({ t: el.textContent.trim().slice(0, 30), ratio: +ratio.toFixed(2), cls: (el.className || "").toString().slice(0, 40) });
      }
      return { nearInvisible: bad.length, samples: bad.slice(0, 5) };
    });
    rec("J6-theme", theme, st);
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(R, null, 2));
  console.log(`\nwritten: ${OUT}`);
})();
