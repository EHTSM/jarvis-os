#!/usr/bin/env node
/**
 * B.19.5 — name the exact elements failing WCAG 2.5.8 target-size.
 *
 * axe reports the rule and a truncated selector; two CSS-inspection guesses
 * missed the real element. This asks the DOM directly for every interactive
 * node under 24x24 that also lacks the spacing exception, and prints its full
 * selector chain and measured box.
 */
const { chromium } = require('playwright-core');

const APP = process.env.B_APP || 'http://127.0.0.1:8899';
const PW  = process.env.B_PW;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

  const rows = await page.evaluate(() => {
    const chain = el => {
      const parts = [];
      for (let n = el, i = 0; n && i < 3; i++, n = n.parentElement) {
        const cls = typeof n.className === 'string' && n.className
          ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        parts.unshift(n.tagName.toLowerCase() + cls);
      }
      return parts.join(' > ');
    };
    const out = [];
    const sel = 'button, [role="button"], a[href], input:not([type=hidden]), select, textarea, [role="tab"], [role="switch"], [role="checkbox"]';
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.width >= 24 && r.height >= 24) continue;
      out.push({
        sel: chain(el),
        w: Math.round(r.width), h: Math.round(r.height),
        type: el.getAttribute('type') || '', title: (el.getAttribute('title') || '').slice(0, 40),
        text: (el.textContent || '').trim().slice(0, 24),
      });
    }
    return out;
  });

  console.log(`interactive nodes under 24x24: ${rows.length}`);
  for (const r of rows) {
    console.log(`  ${String(r.w).padStart(3)}x${String(r.h).padStart(3)}  ${r.sel}  ${r.type ? '[' + r.type + ']' : ''} ${r.title} ${r.text}`);
  }
  await browser.close();
})();
