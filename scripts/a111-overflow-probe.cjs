#!/usr/bin/env node
/**
 * A.11.1 — identify the element that actually causes horizontal overflow.
 *
 * Every measured surface reported the same 561px scrollWidth at mobile
 * viewports, which points at one shared element rather than per-page content.
 * Guessing from CSS would be attribution by assumption, so this asks the DOM
 * which node exceeds the viewport and reports its selector chain.
 *
 *   A11_APP=… A11_PW=… A11_VW=390 node scripts/a111-overflow-probe.cjs
 */
const { chromium } = require('playwright-core');

const APP = process.env.A11_APP || 'http://127.0.0.1:8899';
const PW = process.env.A11_PW;
const VW = +(process.env.A11_VW || 390);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: VW, height: 844 } });
  const page = await ctx.newPage();

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

  const report = await page.evaluate((vw) => {
    const chain = el => {
      const parts = [];
      let n = el;
      for (let i = 0; n && i < 4; i++, n = n.parentElement) {
        const cls = typeof n.className === 'string' && n.className
          ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        parts.unshift(n.tagName.toLowerCase() + cls);
      }
      return parts.join(' > ');
    };
    const offenders = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // The element itself is wider than the viewport, or extends past its right edge.
      if (r.width > vw + 1 || r.right > vw + 1) {
        const cs = getComputedStyle(el);
        offenders.push({
          sel: chain(el),
          w: Math.round(r.width), right: Math.round(r.right),
          minW: cs.minWidth, overflowX: cs.overflowX,
          scrollW: el.scrollWidth, clientW: el.clientWidth,
        });
      }
    }
    // Report the widest few, and the shallowest (closest to the root) first.
    offenders.sort((a, b) => b.w - a.w);
    return {
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
      bodyScroll: document.body.scrollWidth,
      count: offenders.length,
      top: offenders.slice(0, 12),
    };
  }, VW);

  console.log(`viewport ${VW} | doc scrollW ${report.docScroll} clientW ${report.docClient} | body scrollW ${report.bodyScroll}`);
  console.log(`elements exceeding the viewport: ${report.count}`);
  report.top.forEach(o => console.log(
    `  w=${String(o.w).padStart(5)} right=${String(o.right).padStart(5)} minW=${o.minW} ovfX=${o.overflowX}  ${o.sel}`));

  await browser.close();
})();
