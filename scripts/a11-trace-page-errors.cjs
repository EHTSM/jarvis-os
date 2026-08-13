#!/usr/bin/env node
/**
 * A.11 — attribute live page errors to the request that caused them.
 *
 * The consistency scan surfaced two runtime errors while operating real
 * screens. A stack alone does not say WHICH surface or WHICH endpoint produced
 * them, and guessing from a grep would be attribution by assumption. This
 * records, per surface: every failed response, and every page error with its
 * stack, so each finding can name its own reproduction.
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const APP = process.env.A11_APP || 'http://127.0.0.1:8899';
const PW = process.env.A11_PW;
const OUT = process.env.A11_OUT || '/tmp/a11-errors.json';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  let current = 'boot';
  const errors = [];
  const failedResponses = [];

  page.on('pageerror', e => errors.push({
    surface: current, message: e.message.slice(0, 200),
    stack: (e.stack || '').split('\n').slice(0, 4).join(' | ').slice(0, 400),
  }));
  page.on('response', async r => {
    if (r.status() < 400) return;
    let body = '';
    try { body = (await r.text()).slice(0, 160); } catch { /* body consumed */ }
    failedResponses.push({ surface: current, status: r.status(), url: r.url().replace(APP, ''), body });
  });

  await page.goto(APP + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  if (PW) {
    if (!await page.$('input[type="password"]')) {
      for (const l of ['Log in', 'Login', 'Sign in']) {
        const link = await page.$(`text="${l}"`);
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
      const b = await page.$('button[type="submit"], .auth-btn, .auth-submit');
      if (b) await b.click().catch(() => {}); else await pw.press('Enter');
      await page.waitForFunction(() => !document.querySelector('.app-auth-gate, .auth-card'),
        { timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(4000);
    }
  }

  if (!await page.evaluate(() => !document.querySelector('.app-auth-gate, .auth-card'))) {
    console.error('INVALID RUN — never authenticated.');
    await browser.close();
    process.exit(2);
  }

  const PRIMARY = '.tabs > button.tab:not(.tab--more), [role="tab"]';
  const n = await page.$$eval(PRIMARY, e => e.length).catch(() => 0);
  for (let i = 0; i < n; i++) {
    const els = await page.$$(PRIMARY);
    if (!els[i]) continue;
    current = (await els[i].textContent() || '').trim().slice(0, 30) || `tab${i}`;
    await els[i].click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(1200);
  }

  const MORE = '.tab--more, [class*="tab--more"]';
  const total = await (async () => {
    const m = await page.$(MORE);
    if (!m) return 0;
    await m.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(600);
    const c = await page.$$eval('.tab-more-item', e => e.length).catch(() => 0);
    await page.keyboard.press('Escape').catch(() => {});
    return c;
  })();

  for (let i = 0; i < total; i++) {
    try {
      const m = await page.$(MORE);
      if (!m) break;
      await m.click({ timeout: 2000 });
      await page.waitForTimeout(450);
      const items = await page.$$('.tab-more-item');
      if (!items[i]) { await page.keyboard.press('Escape').catch(() => {}); continue; }
      current = (await items[i].textContent() || '').trim().slice(0, 30) || `more${i}`;
      await items[i].click({ timeout: 2500 });
      await page.waitForTimeout(1100);
    } catch { /* unreachable in this state */ }
  }

  fs.writeFileSync(OUT, JSON.stringify({ errors, failedResponses }, null, 2));

  console.log(`page errors: ${errors.length}`);
  const seen = new Set();
  for (const e of errors) {
    const k = e.message;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  [${e.surface}] ${e.message}`);
  }

  console.log(`\nfailed responses: ${failedResponses.length}`);
  const byStatus = {};
  failedResponses.forEach(r => { (byStatus[r.status] = byStatus[r.status] || []).push(r); });
  for (const [s, rows] of Object.entries(byStatus).sort()) {
    console.log(`  ${s}: ${rows.length}`);
    const u = new Set();
    rows.forEach(r => { if (u.size < 6) u.add(`${r.url}  ${r.body.slice(0, 70)}`); });
    [...u].forEach(x => console.log(`      ${x}`));
  }

  await browser.close();
})();
