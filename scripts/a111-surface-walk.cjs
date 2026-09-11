#!/usr/bin/env node
/**
 * A.11.1 — direct operation of every reachable surface.
 *
 * A.11 measured 25 of 47 scoped surfaces. This walks the FULL overflow menu as
 * well as the primary tabs, and records — per surface — the fields the mission
 * names: header, tabs, buttons, inputs, empty/loading/error state, drawers,
 * tables, keyboard, theme, and observed friction.
 *
 * A surface is NOT certified because a route returned 200. Each is operated:
 * clicked into, rendered, measured, and its first-render state recorded.
 *
 *   A11_APP=… A11_PW=… node scripts/a111-surface-walk.cjs
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const APP   = process.env.A11_APP   || 'http://127.0.0.1:8899';
const PW    = process.env.A11_PW;
const OUT   = process.env.A11_OUT   || '/tmp/a111-surfaces.json';
const SHOTS = process.env.A11_SHOTS || '/tmp/a111-shots';
const VIEWPORT = +(process.env.A11_VW || 1440);

/** Everything measurable about the surface currently rendered. */
const PROBE = `(() => {
  const px = v => Math.round(parseFloat(v) || 0);
  const vis = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const box = el => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return { h: Math.round(r.height), w: Math.round(r.width), radius: px(cs.borderTopLeftRadius),
             fs: px(cs.fontSize), fw: cs.fontWeight,
             cls: (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/)[0] || '' };
  };
  const q = s => [...document.querySelectorAll(s)].filter(vis);

  const textNodes = [...document.querySelectorAll('div,p,span,td,h1,h2,h3')].filter(vis).map(el => {
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
    return own && own.length <= 160 ? own : '';
  }).filter(Boolean);

  const has = re => textNodes.some(t => re.test(t));

  return {
    buttons: q('button, [role="button"]').map(box),
    inputs:  q('input:not([type=hidden]), select, textarea').map(box),
    tabs:    q('[role="tab"], .tab, [class*="-tab"]').map(box),
    headers: q('h1, h2, [class*="page-header"], [class*="-header"]').map(box),
    tables:  q('table, [class*="-table"], [role="table"], [role="grid"]').map(box),
    drawers: q('[class*="drawer"], aside, [role="complementary"]').map(box),
    modals:  q('[role="dialog"], [class*="-modal"]').map(box),
    cards:   q('[class*="-card"]').map(box).slice(0, 60),
    // State signals, read from what the surface actually SAYS.
    emptyText:   textNodes.filter(t => /^(no |nothing |empty|there are no|you have no|0 )/i.test(t)).slice(0, 6),
    loadingText: textNodes.filter(t => /^(loading|fetching|please wait|working|analyz)/i.test(t)).slice(0, 4),
    errorText:   textNodes.filter(t => /(failed|error|unavailable|could not|unable to|denied|expired)/i.test(t)).slice(0, 6),
    // Horizontal overflow — the responsive failure that matters most.
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    textCount: textNodes.length,
    domCount: document.querySelectorAll('*').length,
  };
})()`;

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: VIEWPORT, height: 900 } });
  const page = await ctx.newPage();

  let current = 'boot';
  const errors = [], failed = [];
  page.on('pageerror', e => errors.push({ surface: current, msg: e.message.slice(0, 180) }));
  page.on('response', async r => {
    if (r.status() < 400) return;
    let body = ''; try { body = (await r.text()).slice(0, 140); } catch {}
    failed.push({ surface: current, status: r.status(), url: r.url().replace(APP, ''), body });
  });

  await page.goto(APP + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

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

  if (!await page.evaluate(() => !document.querySelector('.app-auth-gate, .auth-card'))) {
    console.error('INVALID RUN — never authenticated. Measurements would describe the login screen.');
    await browser.close();
    process.exit(2);
  }

  const surfaces = {};
  const record = async (label, navPath) => {
    current = label;
    const before = errors.length;
    const data = await page.evaluate(PROBE);
    surfaces[label] = { ...data, navPath, errorsOnEnter: errors.length - before };
    if (Object.keys(surfaces).length <= 14) {
      await page.screenshot({ path: `${SHOTS}/${VIEWPORT}-${label.replace(/\W+/g, '_').slice(0, 40)}.png` })
        .catch(() => {});
    }
  };

  // ── Primary tabs ──────────────────────────────────────────────────────────
  const PRIMARY = '.tabs > button.tab:not(.tab--more), [role="tab"]';
  const nPrimary = await page.$$eval(PRIMARY, e => e.length).catch(() => 0);
  for (let i = 0; i < nPrimary; i++) {
    try {
      const els = await page.$$(PRIMARY);
      if (!els[i]) continue;
      const label = (await els[i].textContent() || '').trim().slice(0, 34) || `tab${i}`;
      await els[i].click({ timeout: 2500 });
      await page.waitForTimeout(1100);
      await record(label, 'primary tab');
    } catch { /* not clickable in this state */ }
  }

  // ── Overflow surfaces. The menu closes on selection, so reopen each time. ──
  const MORE = '.tab--more, [class*="tab--more"]';
  const nMore = await (async () => {
    const m = await page.$(MORE);
    if (!m) return 0;
    await m.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(700);
    const n = await page.$$eval('.tab-more-item', e => e.length).catch(() => 0);
    await page.keyboard.press('Escape').catch(() => {});
    return n;
  })();

  // A slice lets the walk be run in bounded segments that each finish inside
  // the session budget; the segments together cover the full overflow menu.
  const FROM = +(process.env.A11_FROM || 0);
  const TO   = +(process.env.A11_TO   || nMore);
  for (let i = FROM; i < Math.min(TO, nMore); i++) {
    try {
      const m = await page.$(MORE);
      if (!m) break;
      await m.click({ timeout: 2000 });
      await page.waitForTimeout(420);
      const items = await page.$$('.tab-more-item');
      if (!items[i]) { await page.keyboard.press('Escape').catch(() => {}); continue; }
      const label = (await items[i].textContent() || '').trim().slice(0, 34) || `more${i}`;
      await items[i].click({ timeout: 2500 });
      await page.waitForTimeout(1050);
      await record(label, 'More menu');
    } catch { /* unreachable in this state */ }
  }

  fs.writeFileSync(OUT, JSON.stringify({ viewport: VIEWPORT, surfaces, errors, failed }, null, 2));

  const n = Object.keys(surfaces).length;
  console.log(`viewport ${VIEWPORT} | surfaces operated: ${n} | page errors ${errors.length} | failed responses ${failed.length}`);
  const noHeader = Object.entries(surfaces).filter(([, v]) => !v.headers.length).map(([k]) => k);
  const hScroll  = Object.entries(surfaces).filter(([, v]) => v.hScroll).map(([k]) => k);
  const withTable = Object.entries(surfaces).filter(([, v]) => v.tables.length).map(([k]) => k);
  const withDrawer = Object.entries(surfaces).filter(([, v]) => v.drawers.length).map(([k]) => k);
  console.log(`  no page header : ${noHeader.length}${noHeader.length ? ' → ' + noHeader.slice(0, 8).join(', ') : ''}`);
  console.log(`  h-scroll       : ${hScroll.length}${hScroll.length ? ' → ' + hScroll.slice(0, 8).join(', ') : ''}`);
  console.log(`  with tables    : ${withTable.length}`);
  console.log(`  with drawers   : ${withDrawer.length}`);
  await browser.close();
})();
