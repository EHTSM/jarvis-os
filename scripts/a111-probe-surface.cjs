#!/usr/bin/env node
/**
 * A.11.1 — operate ONE surface with a realistic settle time and capture what it
 * actually renders, including errors the ErrorBoundary swallows.
 *
 * The bulk walk uses a short wait so it can cover 80+ surfaces; that is right
 * for coverage but wrong for adjudicating a single suspicious screen. This
 * probe waits for the surface to settle, then reports its real state.
 *
 *   A11_APP=… A11_PW=… A11_TARGET="Registry" node scripts/a111-probe-surface.cjs
 */
const { chromium } = require('playwright-core');

const APP = process.env.A11_APP || 'http://127.0.0.1:8899';
const PW = process.env.A11_PW;
const TARGET = process.env.A11_TARGET;
const SETTLE = +(process.env.A11_SETTLE || 6000);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors = [], failed = [], consoleErrs = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 240)));
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 240)); });
  page.on('response', async r => {
    if (r.status() < 400) return;
    let b = ''; try { b = (await r.text()).slice(0, 160); } catch {}
    failed.push(`${r.status()} ${r.url().replace(APP, '')} ${b}`);
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
    console.error('INVALID RUN — never authenticated.'); await browser.close(); process.exit(2);
  }

  // Reach the target through the overflow menu, the way an operator would.
  const MORE = '.tab--more, [class*="tab--more"]';
  const m = await page.$(MORE);
  if (m) { await m.click({ timeout: 2500 }).catch(() => {}); await page.waitForTimeout(700); }
  const items = await page.$$('.tab-more-item');
  let opened = false;
  for (const it of items) {
    const t = (await it.textContent() || '').trim();
    if (TARGET && t.startsWith(TARGET)) { await it.click({ timeout: 2500 }); opened = true; break; }
  }
  if (!opened) { console.error(`target "${TARGET}" not found in the More menu`); await browser.close(); process.exit(3); }

  await page.waitForTimeout(SETTLE);

  const state = await page.evaluate(() => {
    const txt = [...document.querySelectorAll('div,p,span,h1,h2,h3')]
      .filter(e => { const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden'; })
      .map(e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim())
      .filter(t => t && t.length <= 140);
    return {
      dom: document.querySelectorAll('*').length,
      headings: [...document.querySelectorAll('h1,h2,h3')].map(h => h.textContent.trim().slice(0, 60)),
      boundary: txt.filter(t => /panel encountered an error/i.test(t)),
      loading: txt.filter(t => /^(loading|fetching|please wait)/i.test(t)).slice(0, 3),
      errors: txt.filter(t => /(failed|error|unavailable|could not|denied)/i.test(t)).slice(0, 6),
      sample: txt.slice(0, 12),
    };
  });

  console.log(`target: ${TARGET}  settle: ${SETTLE}ms  dom: ${state.dom}`);
  console.log(`headings: ${JSON.stringify(state.headings.slice(0, 5))}`);
  console.log(`error-boundary hit: ${state.boundary.length > 0}`);
  console.log(`loading: ${JSON.stringify(state.loading)}`);
  console.log(`error text: ${JSON.stringify(state.errors)}`);
  if (errors.length) { console.log('page errors:'); [...new Set(errors)].forEach(e => console.log('  ' + e)); }
  if (consoleErrs.length) {
    console.log('console errors:');
    [...new Set(consoleErrs)].slice(0, 6).forEach(e => console.log('  ' + e));
  }
  if (failed.length) {
    console.log('failed responses:');
    [...new Set(failed)].slice(0, 8).forEach(f => console.log('  ' + f));
  }
  await browser.close();
})();
