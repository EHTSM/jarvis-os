#!/usr/bin/env node
/**
 * B.19.5 — WCAG 2.2 AA final gate.
 *
 * Runs axe-core 4.13 against the REAL authenticated application, in both
 * themes, across primary and overflow surfaces, at a chosen viewport.
 *
 * Design decisions that make the result trustworthy:
 *
 *  • The run HARD-FAILS if the session never authenticated. B19.2.2 established
 *    that an unauthenticated sweep produces a false zero — it measures the
 *    login screen. A zero from an invalid run is not a pass.
 *  • axe is configured for wcag2a + wcag2aa + wcag21a/aa + wcag22aa tags only,
 *    so "best-practice" rules cannot inflate or deflate the AA verdict.
 *  • Every violation is reported with its WCAG success criterion, impact, and
 *    the surface it was found on — no aggregate-only reporting.
 *
 *   B_APP=… B_PW=… B_THEME=dark B_VW=1440 node scripts/b1945-wcag-gate.cjs
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const APP   = process.env.B_APP   || 'http://127.0.0.1:8899';
const PW    = process.env.B_PW;
const THEME = process.env.B_THEME || 'dark';
const VW    = +(process.env.B_VW  || 1440);
const VH    = VW <= 430 ? 844 : 900;
const FROM  = +(process.env.B_FROM || 0);
const TO    = +(process.env.B_TO   || 12);
const OUT   = process.env.B_OUT   || `/tmp/b1945-wcag-${THEME}-${VW}.json`;

const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

/** AA-relevant tag set. Deliberately excludes best-practice. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    colorScheme: THEME === 'light' ? 'light' : 'dark',
  });
  const page = await ctx.newPage();

  await page.goto(APP + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(t => {
    localStorage.setItem('ooplix-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, THEME);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // Real login through the real form (operator auth is password-only).
  if (PW) {
    if (!await page.$('input[type="password"]')) {
      for (const l of ['Log in', 'Login', 'Sign in']) {
        const a = await page.$(`text="${l}"`);
        if (a) { await a.click().catch(() => {}); await page.waitForTimeout(2200); break; }
      }
    }
    const pw = await page.$('input[type="password"]');
    if (pw) {
      await page.evaluate(() => {
        const e = document.querySelector('input[type="email"]');
        if (e) { e.removeAttribute('required'); e.value = ''; }
      });
      await pw.fill(PW);
      const b = await page.$('button[type="submit"], .auth-btn, .auth-submit');
      if (b) await b.click().catch(() => {}); else await pw.press('Enter');
      await page.waitForFunction(() => !document.querySelector('.app-auth-gate, .auth-card'),
        { timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(4000);
    }
  }

  const authed = await page.evaluate(() => !document.querySelector('.app-auth-gate, .auth-card'));
  if (!authed) {
    console.error('INVALID RUN — never authenticated. A zero here would describe the login screen.');
    await browser.close();
    process.exit(2);
  }
  await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), THEME);
  await page.waitForTimeout(800);

  const runAxe = async () => {
    await page.evaluate(AXE);
    return page.evaluate(async (tags) => {
      const r = await window.axe.run(document, {
        runOnly: { type: 'tag', values: tags },
        resultTypes: ['violations'],
      });
      return {
        violations: r.violations.map(v => ({
          id: v.id, impact: v.impact, help: v.help,
          tags: v.tags.filter(t => /^wcag/.test(t)),
          nodes: v.nodes.length,
          sample: v.nodes.slice(0, 2).map(n => (n.target || []).join(' ')).join(' | ').slice(0, 160),
        })),
        passes: r.passes ? r.passes.length : null,
      };
    }, TAGS);
  };

  const surfaces = {};
  const record = async (label) => {
    const res = await runAxe();
    const dom = await page.evaluate(() => document.querySelectorAll('*').length);
    surfaces[label] = { ...res, dom };
    const n = res.violations.reduce((a, v) => a + v.nodes, 0);
    console.log(`  ${String(res.violations.length).padStart(2)} rules / ${String(n).padStart(4)} nodes  ${label}`);
  };

  // Primary tabs.
  const PRIMARY = '.tabs > button.tab:not(.tab--more), [role="tab"]';
  const nPrimary = await page.$$eval(PRIMARY, e => e.length).catch(() => 0);
  for (let i = 0; i < nPrimary; i++) {
    const els = await page.$$(PRIMARY);
    if (!els[i]) continue;
    const label = (await els[i].textContent() || '').trim().slice(0, 30) || `tab${i}`;
    await els[i].click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(1100);
    await record(label);
  }

  // Overflow surfaces (menu closes on each pick, so reopen every time).
  const MORE = '.tab--more, [class*="tab--more"]';
  const nMore = await (async () => {
    const m = await page.$(MORE);
    if (!m) return 0;
    await m.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(600);
    const n = await page.$$eval('.tab-more-item', e => e.length).catch(() => 0);
    await page.keyboard.press('Escape').catch(() => {});
    return n;
  })();

  for (let i = FROM; i < Math.min(TO, nMore); i++) {
    try {
      const m = await page.$(MORE);
      if (!m) break;
      await m.click({ timeout: 2000 });
      await page.waitForTimeout(420);
      const items = await page.$$('.tab-more-item');
      if (!items[i]) { await page.keyboard.press('Escape').catch(() => {}); continue; }
      const label = (await items[i].textContent() || '').trim().slice(0, 30) || `more${i}`;
      await items[i].click({ timeout: 2500 });
      await page.waitForTimeout(1000);
      await record(label);
    } catch { /* not reachable in this state */ }
  }

  // Aggregate by rule so the verdict is per WCAG criterion, not per surface.
  const byRule = {};
  for (const [s, d] of Object.entries(surfaces)) {
    for (const v of d.violations) {
      const k = v.id;
      byRule[k] = byRule[k] || { id: k, impact: v.impact, help: v.help, tags: v.tags, nodes: 0, surfaces: [] };
      byRule[k].nodes += v.nodes;
      if (byRule[k].surfaces.length < 6) byRule[k].surfaces.push(s);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({
    theme: THEME, viewport: VW, authed, surfaces, byRule,
  }, null, 2));

  const rules = Object.values(byRule).sort((a, b) => b.nodes - a.nodes);
  const totalNodes = rules.reduce((a, r) => a + r.nodes, 0);
  console.log(`\ntheme=${THEME} viewport=${VW} surfaces=${Object.keys(surfaces).length} authed=${authed}`);
  console.log(`AA violations: ${rules.length} distinct rules, ${totalNodes} nodes\n`);
  for (const r of rules) {
    console.log(`  ${String(r.nodes).padStart(4)}  ${r.id.padEnd(34)} ${(r.impact||'').padEnd(9)} ${r.tags.join(',')}`);
  }
  await browser.close();
  process.exit(rules.length ? 1 : 0);
})();
