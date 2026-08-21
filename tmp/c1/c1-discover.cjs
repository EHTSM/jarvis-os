#!/usr/bin/env node
"use strict";
/**
 * C.1 accessibility discovery — measures the LIVE RENDERED DOM, not source regex.
 *
 * B.19.3 and B.25 both counted <input> tags in .jsx source. That over- and
 * under-counts: conditionally rendered controls never mount, and a control whose
 * name comes from a wrapping <label> looks unlabelled in source but is fine in
 * the DOM. This walks the real app in a real browser and asks the browser for
 * each element's computed accessible name.
 */

process.chdir("/Users/ehtsm/jarvis-os");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:5050";
const AXE = require.resolve("axe-core/axe.min.js");
const OUT = process.argv[2] || "/private/tmp/claude-501/-Users-ehtsm-jarvis-os/d88b488c-0577-45ec-ae18-394b1924324c/scratchpad/c1-discovery.json";

// Routes chosen to cover the ten product families B.19.3 named, plus core chrome.
const ROUTES = [
  "/", "/dashboard", "/missions", "/business", "/crm", "/growth",
  "/enterprise", "/developer", "/revenue", "/distribution", "/settings",
];

async function login(page) {
  const email = `c1-a11y-${Date.now()}@test.local`;
  const password = "C1A11y!2026x";
  const reg = await page.evaluate(async ({ email, password }) => {
    const r = await fetch("/accounts/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name: "a11y", orgName: "A11y Ltd" }),
    });
    return { status: r.status };
  }, { email, password });
  if (reg.status !== 201 && reg.status !== 200) return { ok: false, reason: `register ${reg.status}` };
  const li = await page.evaluate(async ({ email, password }) => {
    const r = await fetch("/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return { status: r.status };
  }, { email, password });
  return { ok: li.status === 200, reason: `login ${li.status}` };
}

/** Ask the browser for each control's real accessible name and how it got one. */
const INVENTORY = () => {
  const vis = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const nameOf = el => {
    // Mirrors the accname precedence the browser uses, in the order SRs apply it.
    if (el.getAttribute("aria-labelledby")) {
      const t = el.getAttribute("aria-labelledby").split(/\s+/)
        .map(id => document.getElementById(id)?.textContent?.trim() || "").join(" ").trim();
      if (t) return { name: t, via: "aria-labelledby" };
    }
    const al = el.getAttribute("aria-label");
    if (al && al.trim()) return { name: al.trim(), via: "aria-label" };
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab?.textContent?.trim()) return { name: lab.textContent.trim(), via: "label[for]" };
    }
    const wrap = el.closest("label");
    if (wrap?.textContent?.trim()) return { name: wrap.textContent.trim(), via: "wrapping-label" };
    const ttl = el.getAttribute("title");
    if (ttl && ttl.trim()) return { name: ttl.trim(), via: "title" };
    if (el.tagName === "BUTTON" || el.tagName === "A") {
      const t = el.textContent?.trim();
      if (t) return { name: t, via: "text-content" };
    }
    const ph = el.getAttribute("placeholder");
    if (ph && ph.trim()) return { name: ph.trim(), via: "placeholder-ONLY" };
    return { name: null, via: "NONE" };
  };

  const sel = "input:not([type=hidden]),select,textarea,button,a[href],[role=button],[role=option],[role=tab],[role=combobox],[role=listbox],[role=menuitem],[tabindex]:not([tabindex='-1'])";
  const out = { controls: [], counts: {}, focusable: 0, dialogs: 0, byRole: {} };

  for (const el of document.querySelectorAll(sel)) {
    if (!vis(el)) continue;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || tag;
    const { name, via } = nameOf(el);
    const isFormControl = ["input", "select", "textarea"].includes(tag);
    out.counts[tag] = (out.counts[tag] || 0) + 1;
    out.byRole[role] = (out.byRole[role] || 0) + 1;
    out.focusable++;
    if (!name || via === "placeholder-ONLY") {
      out.controls.push({
        tag, role, via,
        type: el.getAttribute("type") || null,
        placeholder: el.getAttribute("placeholder") || null,
        cls: (el.className || "").toString().slice(0, 60),
        isFormControl,
        // a stable-ish locator for the fix pass
        outer: el.outerHTML.slice(0, 140),
      });
    }
  }
  out.dialogs = document.querySelectorAll("[role=dialog],dialog").length;
  return out;
};

async function scanRoute(page, route, theme) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1400);
  await page.addScriptTag({ path: AXE }).catch(() => {});
  const axe = await page.evaluate(async () => {
    if (!window.axe) return null;
    const r = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return r.violations.map(v => ({
      id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
      sample: v.nodes.slice(0, 2).map(n => (n.html || "").slice(0, 120)),
    }));
  }).catch(() => null);
  const inv = await page.evaluate(INVENTORY).catch(() => null);
  return { route, theme, axe, inv };
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (const theme of ["dark", "light"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: theme,
    });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    if (theme === "dark") {
      const auth = await login(page);
      console.log(`  auth: ${auth.ok ? "OK" : "FAILED — " + auth.reason}`);
      if (!auth.ok) { await browser.close(); fs.writeFileSync(OUT, JSON.stringify({ blocked: auth.reason }, null, 2)); process.exit(0); }
    } else {
      await login(page);
    }
    await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, theme);
    for (const r of ROUTES) {
      const res = await scanRoute(page, r, theme);
      results.push(res);
      const nUn = res.inv ? res.inv.controls.filter(c => c.isFormControl).length : "?";
      const nAxe = res.axe ? res.axe.reduce((a, v) => a + v.nodes, 0) : "?";
      console.log(`  ${theme.padEnd(5)} ${r.padEnd(14)} focusable=${String(res.inv?.focusable ?? "?").padStart(4)}  unnamed-form=${String(nUn).padStart(3)}  axe-nodes=${nAxe}`);
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nwritten: ${OUT}`);
})();
