#!/usr/bin/env node
/**
 * A.11 — UX consistency measurement against the REAL running app.
 *
 * Logs in with a real operator session, walks every reachable surface, and
 * measures the computed values the mission names: button/input/tab heights,
 * radii, header heights, font sizes, content width, spacing.
 *
 * It reports DRIFT, not difference. The objective stated in the mission is a
 * consistent design language, not identical screens — so a value is only a
 * finding when it sits outside the dominant cluster for its role, and every
 * finding carries the measured numbers that justify it.
 *
 *   A11_APP=http://127.0.0.1:8899 A11_PW=… node scripts/a11-ux-consistency-scan.cjs
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const APP = process.env.A11_APP || 'http://127.0.0.1:8899';
const PW  = process.env.A11_PW;
const OUT = process.env.A11_OUT || '/tmp/a11-ux-scan.json';
const SHOTS = process.env.A11_SHOTS || '/tmp/a11-ux-shots';

/** Measure every rendered control, grouped by the role its class implies. */
const PROBE = `(() => {
  const px = v => Math.round(parseFloat(v) || 0);
  const out = { buttons: [], inputs: [], tabs: [], headers: [], cards: [], modals: [],
                toasts: [], tables: [], empties: [], spinners: [] };

  const vis = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const rec = el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      cls: (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/).slice(0,3).join(' '),
      h: Math.round(r.height), w: Math.round(r.width),
      radius: px(cs.borderTopLeftRadius),
      fs: px(cs.fontSize), fw: cs.fontWeight,
      padY: px(cs.paddingTop) + '/' + px(cs.paddingBottom),
      padX: px(cs.paddingLeft) + '/' + px(cs.paddingRight),
      border: cs.borderTopWidth === '0px' ? 'none' : px(cs.borderTopWidth) + 'px',
      text: (el.textContent || '').trim().slice(0, 28),
    };
  };

  for (const el of document.querySelectorAll('button, [role="button"]')) {
    if (!vis(el)) continue;
    out.buttons.push(rec(el));
  }
  for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    if (!vis(el)) continue;
    out.inputs.push(rec(el));
  }
  for (const el of document.querySelectorAll('[role="tab"], .tab, [class*="-tab"]')) {
    if (!vis(el)) continue;
    out.tabs.push(rec(el));
  }
  for (const el of document.querySelectorAll('h1, h2, [class*="page-header"], [class*="-header"]')) {
    if (!vis(el)) continue;
    out.headers.push(rec(el));
  }
  for (const el of document.querySelectorAll('[class*="-card"], [class*="card-"]')) {
    if (!vis(el)) continue;
    out.cards.push(rec(el));
  }
  for (const el of document.querySelectorAll('[role="dialog"], [class*="-modal"]')) {
    if (!vis(el)) continue;
    out.modals.push(rec(el));
  }
  for (const el of document.querySelectorAll('[class*="toast"]')) {
    if (!vis(el)) continue;
    out.toasts.push(rec(el));
  }
  for (const el of document.querySelectorAll('table, [class*="-table"]')) {
    if (!vis(el)) continue;
    out.tables.push(rec(el));
  }
  // Empty / loading states: text-bearing nodes whose copy signals the state.
  for (const el of document.querySelectorAll('div, p, span')) {
    if (!vis(el)) continue;
    const own = Array.from(el.childNodes).filter(n => n.nodeType === 3)
      .map(n => n.textContent.trim()).join(' ').trim();
    if (!own || own.length > 120) continue;
    if (/^(no |nothing |empty|there are no|you have no|0 )/i.test(own)) {
      out.empties.push({ ...rec(el), text: own.slice(0, 90) });
    }
    if (/^(loading|fetching|please wait|working)/i.test(own)) {
      out.spinners.push({ ...rec(el), text: own.slice(0, 60) });
    }
  }
  return out;
})()`;

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message.slice(0, 160)));

  await page.goto(APP + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // Real login through the real form (operator auth is password-only).
  if (PW) {
    if (!await page.$('input[type="password"]')) {
      for (const label of ['Log in', 'Login', 'Sign in']) {
        const link = await page.$(`text="${label}"`);
        if (link) { await link.click().catch(() => {}); await page.waitForTimeout(2200); break; }
      }
    }
    const pw = await page.$('input[type="password"]');
    if (pw) {
      await page.evaluate(() => {
        const e = document.querySelector('input[type="email"]');
        if (e) { e.removeAttribute('required'); e.value = ''; }
      });
      await pw.fill(PW);
      const btn = await page.$('button[type="submit"], .auth-btn, .auth-submit');
      if (btn) await btn.click().catch(() => {}); else await pw.press('Enter');
      await page.waitForFunction(() => !document.querySelector('.app-auth-gate, .auth-card'),
        { timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(4000);
    }
  }

  const authed = await page.evaluate(() => !document.querySelector('.app-auth-gate, .auth-card'));
  if (!authed) {
    console.error('INVALID RUN — never authenticated; measurements would describe the login screen.');
    await browser.close();
    process.exit(2);
  }

  // Open the overflow menu so every surface is enumerable.
  for (const m of await page.$$('.tab-more-wrap, [class*="tab--more"]')) {
    await m.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(600);
  }

  const surfaces = {};
  let visited = 0;

  const measure = async (label) => {
    surfaces[label] = await page.evaluate(PROBE);
    visited++;
    if (visited <= 12) {
      await page.screenshot({ path: `${SHOTS}/${String(visited).padStart(2,'0')}-${label.replace(/\W+/g,'_')}.png` })
        .catch(() => {});
    }
  };

  // 1. Primary nav tabs (always visible).
  const PRIMARY = '.tabs > button.tab:not(.tab--more), [role="tab"]';
  const primaryCount = await page.$$eval(PRIMARY, e => e.length).catch(() => 0);
  for (let i = 0; i < primaryCount; i++) {
    try {
      const els = await page.$$(PRIMARY);
      if (!els[i]) continue;
      const label = (await els[i].textContent() || '').trim().slice(0, 32) || `tab${i}`;
      await els[i].click({ timeout: 2500 });
      await page.waitForTimeout(900);
      await measure(label);
    } catch { /* not clickable in this state */ }
  }

  // 2. Overflow surfaces. The menu closes on each selection, so it has to be
  //    reopened before every item — walking a stale handle list silently
  //    measures the same screen N times.
  const MORE = '.tab--more, .tab-more-wrap button, [class*="tab--more"]';
  const itemCount = await (async () => {
    const more = await page.$(MORE);
    if (!more) return 0;
    await more.click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(700);
    const n = await page.$$eval('.tab-more-item', e => e.length).catch(() => 0);
    await page.keyboard.press('Escape').catch(() => {});
    return n;
  })();

  for (let i = 0; i < itemCount; i++) {
    try {
      const more = await page.$(MORE);
      if (!more) break;
      await more.click({ timeout: 2500 });
      await page.waitForTimeout(500);
      const items = await page.$$('.tab-more-item');
      if (!items[i]) { await page.keyboard.press('Escape').catch(() => {}); continue; }
      const label = (await items[i].textContent() || '').trim().slice(0, 32) || `more${i}`;
      await items[i].click({ timeout: 2500 });
      await page.waitForTimeout(1000);
      await measure(label);
    } catch { /* surface not reachable in this state */ }
  }

  const reach = await page.evaluate(() => ({
    els: document.querySelectorAll('*').length,
    authed: !document.querySelector('.app-auth-gate, .auth-card'),
  }));

  fs.writeFileSync(OUT, JSON.stringify({ surfaces, visited, reach, pageErrors }, null, 2));
  console.log(`surfaces measured: ${visited} | DOM ${reach.els} els | authed=${reach.authed} | page errors ${pageErrors.length}`);

  // ── Drift analysis: cluster each control role by its measured height ──────
  const roles = ['buttons', 'inputs', 'tabs'];
  for (const role of roles) {
    const all = [];
    for (const [s, d] of Object.entries(surfaces)) for (const r of (d[role] || [])) all.push({ ...r, s });
    if (!all.length) continue;
    const hist = {};
    all.forEach(r => { hist[r.h] = (hist[r.h] || 0) + 1; });
    const sorted = Object.entries(hist).sort((a, b) => b[1] - a[1]);
    const total = all.length;
    const top = sorted.slice(0, 5);
    const covered = top.reduce((n, [, c]) => n + c, 0);
    console.log(`\n${role}: ${total} measured, ${sorted.length} distinct heights`);
    console.log('  dominant: ' + top.map(([h, c]) => `${h}px×${c}`).join('  '));
    console.log(`  top-5 cover ${Math.round(covered / total * 100)}% — ${sorted.length - 5 > 0 ? sorted.length - 5 : 0} outlier heights`);
  }

  const radii = {};
  for (const d of Object.values(surfaces)) for (const c of (d.cards || [])) radii[c.radius] = (radii[c.radius] || 0) + 1;
  const rs = Object.entries(radii).sort((a, b) => b[1] - a[1]);
  if (rs.length) console.log(`\ncard radii: ${rs.length} distinct — ` + rs.slice(0, 6).map(([r, c]) => `${r}px×${c}`).join('  '));

  await browser.close();
})();
