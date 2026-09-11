#!/usr/bin/env node
"use strict";
/**
 * C.1 accessibility scan — drives the REAL tab-based app.
 *
 * Ooplix has no URL router: everything renders at "/" after login and is
 * switched by in-app tab state. An earlier harness that navigated to /dashboard,
 * /crm etc. measured zero focusable elements on every route because those paths
 * are API prefixes, not frontend routes. This walks the actual tabs.
 *
 * For every control it asks the BROWSER for the computed accessible name, so a
 * control named by a wrapping <label> counts as named (source regex missed
 * those) and a placeholder-only control counts as UNNAMED (source regex wrongly
 * accepted those).
 */

const { chromium } = require("playwright");
const fs = require("fs");

const BASE = "http://localhost:5050";
const AXE = require.resolve("axe-core/axe.min.js");
const OUT = process.argv[2] || "tmp/c1/c1-scan.json";
const THEMES = ["dark", "light"];
const WIDTHS = [{ w: 1440, h: 900, label: "desktop" }, { w: 768, h: 1024, label: "tablet" }, { w: 390, h: 844, label: "mobile" }];

const INVENTORY = () => {
  const vis = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const nameOf = el => {
    if (el.getAttribute("aria-labelledby")) {
      const t = el.getAttribute("aria-labelledby").split(/\s+/)
        .map(id => document.getElementById(id)?.textContent?.trim() || "").join(" ").trim();
      if (t) return { name: t, via: "aria-labelledby" };
    }
    const al = el.getAttribute("aria-label");
    if (al && al.trim()) return { name: al.trim(), via: "aria-label" };
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab?.textContent?.trim()) return { name: lab.textContent.trim(), via: "label-for" };
    }
    const wrap = el.closest("label");
    if (wrap && wrap.textContent.replace(el.value || "", "").trim()) return { name: wrap.textContent.trim(), via: "wrapping-label" };
    const t = el.getAttribute("title");
    if (t && t.trim()) return { name: t.trim(), via: "title" };
    if (["BUTTON", "A", "SUMMARY"].includes(el.tagName)) {
      const tc = el.textContent?.trim();
      if (tc) return { name: tc, via: "text" };
    }
    const ph = el.getAttribute("placeholder");
    if (ph && ph.trim()) return { name: ph.trim(), via: "placeholder-ONLY" };
    return { name: null, via: "NONE" };
  };

  const out = { formControls: 0, namedForm: 0, unnamed: [], focusable: 0, buttons: 0, links: 0, dialogs: 0 };
  const FORM = "input:not([type=hidden]),select,textarea";
  for (const el of document.querySelectorAll(FORM)) {
    if (!vis(el)) continue;
    out.formControls++;
    const { via } = nameOf(el);
    // WCAG 3.3.2: placeholder alone is NOT a label — it disappears on input.
    if (via === "NONE" || via === "placeholder-ONLY") {
      out.unnamed.push({
        tag: el.tagName.toLowerCase(), via,
        type: el.getAttribute("type") || null,
        placeholder: el.getAttribute("placeholder") || null,
        cls: (el.className || "").toString().slice(0, 70),
        outer: el.outerHTML.slice(0, 160),
      });
    } else out.namedForm++;
  }
  for (const el of document.querySelectorAll("button,[role=button]")) {
    if (!vis(el)) continue;
    out.buttons++;
    const { via } = nameOf(el);
    if (via === "NONE") out.unnamed.push({ tag: "button", via, cls: (el.className || "").toString().slice(0, 70), outer: el.outerHTML.slice(0, 160) });
  }
  for (const el of document.querySelectorAll("a[href]")) { if (vis(el)) out.links++; }
  out.focusable = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(vis).length;
  out.dialogs = document.querySelectorAll("[role=dialog],dialog").length;
  return out;
};

/**
 * Signup is rate-limited to 5 registrations / 15 min / IP. Creating a tenant per
 * browser context exhausted it and stalled the scan, so ONE account is created
 * for the whole run and its session cookie is injected into every context.
 * Credentials come from the real signup + login flow — nothing is forged.
 */
const CREDS = { email: `c1-scan-${Date.now()}@test.local`, password: "C1Scan!2026x" };
let SESSION = null;

async function bootstrapSession(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const reg = await page.evaluate(async d => (await fetch("/accounts/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) })).status,
    { ...CREDS, name: "scan", orgName: "Scan Ltd" });
  if (reg !== 201 && reg !== 200) { await ctx.close(); return { ok: false, reason: `register ${reg}` }; }
  const li = await page.evaluate(async d => (await fetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) })).status, CREDS);
  if (li !== 200) { await ctx.close(); return { ok: false, reason: `login ${li}` }; }
  SESSION = (await ctx.cookies()).filter(c => c.name === "jarvis_auth");
  await ctx.close();
  return { ok: SESSION.length > 0, reason: `cookies ${SESSION.length}` };
}

async function auth(ctx) {
  if (!SESSION) return { ok: false, reason: "no session" };
  await ctx.addCookies(SESSION);
  return { ok: true, reason: "reused session" };
}

async function axeScan(page) {
  await page.addScriptTag({ path: AXE }).catch(() => {});
  return page.evaluate(async () => {
    if (!window.axe) return null;
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map(n => (n.html || "").slice(0, 150)) }));
  }).catch(() => null);
}

(async () => {
  const browser = await chromium.launch();
  const report = { generatedAt: new Date().toISOString(), runs: [] };

  const boot = await bootstrapSession(browser);
  console.log(`  session: ${boot.ok ? "OK — " + boot.reason : "BLOCKED — " + boot.reason}`);
  if (!boot.ok) {
    fs.writeFileSync(OUT, JSON.stringify({ blocked: boot.reason }, null, 2));
    console.log("  SCAN BLOCKED (environment) — not recorded as a pass");
    await browser.close();
    process.exit(0);
  }

  for (const theme of THEMES) {
    for (const vp of WIDTHS) {
      // mobile/tablet only on dark to keep run time sane; full theme matrix on desktop
      if (vp.label !== "desktop" && theme === "light") continue;
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, colorScheme: theme });
      const a = await auth(ctx);
      if (!a.ok) { console.log(`  BLOCKED ${theme}/${vp.label}: ${a.reason}`); await ctx.close(); continue; }
      const page = await ctx.newPage();
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
      await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForTimeout(300);

      const tabs = await page.evaluate(() =>
        [...document.querySelectorAll(".tab")].map(e => e.textContent.trim()).filter(t => t && !/^More/.test(t)));

      for (const tab of tabs) {
        await page.evaluate(t => {
          const el = [...document.querySelectorAll(".tab")].find(x => x.textContent.trim() === t);
          if (el) el.click();
        }, tab).catch(() => {});
        await page.waitForTimeout(1200);
        const inv = await page.evaluate(INVENTORY).catch(() => null);
        const axe = await axeScan(page);
        report.runs.push({ theme, viewport: vp.label, tab, inv, axe });
        const un = inv ? inv.unnamed.length : "?";
        const ax = axe ? axe.reduce((s, v) => s + v.nodes, 0) : "?";
        console.log(`  ${theme.padEnd(5)} ${vp.label.padEnd(7)} ${tab.padEnd(12)} focusable=${String(inv?.focusable ?? "?").padStart(3)} form=${String(inv?.formControls ?? "?").padStart(3)} UNNAMED=${String(un).padStart(3)} axe=${ax}`);
      }
      await ctx.close();
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\nwritten: ${OUT}`);
})();
