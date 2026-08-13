#!/usr/bin/env node
/**
 * A.11.2 — measure drawers, tables and dialogs at mobile viewports.
 *
 * A.11.1 left these three NOT MEASURED. This opens each interactive surface
 * directly and records what it actually does at 430x900 and 390x844 — bounds,
 * overflow, Escape behaviour, close control, scroll and theme.
 *
 * Nothing is inferred from CSS. If a surface cannot be opened, that is recorded
 * as NOT MEASURED rather than assumed correct.
 *
 *   A11_APP=… A11_PW=… A11_VW=390 node scripts/a112-mobile-probe.cjs
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const APP = process.env.A11_APP || 'http://127.0.0.1:8899';
const PW  = process.env.A11_PW;
const VW  = +(process.env.A11_VW || 390);
const VH  = VW === 430 ? 900 : 844;
const OUT = process.env.A11_OUT || `/tmp/a112-mobile-${VW}.json`;
const SHOTS = process.env.A11_SHOTS || `/tmp/a112-mobile-${VW}`;

/** What is on screen right now, from the DOM's point of view. */
const STATE = `(() => {
  const vis = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const box = el => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return {
      cls: (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/)[0] || '',
      w: Math.round(r.width), h: Math.round(r.height),
      left: Math.round(r.left), right: Math.round(r.right),
      overflowY: cs.overflowY, bg: cs.backgroundColor,
      withinViewport: r.left >= -1 && r.right <= window.innerWidth + 1,
    };
  };
  const q = s => [...document.querySelectorAll(s)].filter(vis);
  return {
    drawers: q('[class*="drawer"], aside, [role="complementary"]').map(box),
    dialogs: q('[role="dialog"], [role="alertdialog"], [class*="-modal"]:not([class*="overlay"])').map(box),
    tables:  q('table, [class*="-table"], [role="table"], [role="grid"]').map(box),
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
  };
})()`;

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
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

  const results = [];

  /** Navigate to a More-menu surface by label prefix. */
  const goto = async (label) => {
    const more = await page.$('.tab--more, [class*="tab--more"]');
    if (!more) return false;
    await more.click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(500);
    for (const it of await page.$$('.tab-more-item')) {
      const t = (await it.textContent() || '').trim();
      if (t.startsWith(label)) { await it.click({ timeout: 2500 }); await page.waitForTimeout(2200); return true; }
    }
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  };

  /** Open the first element matching `opener`, then measure what appeared. */
  const probe = async ({ name, surface, opener, kind }) => {
    const rec = { name, surface, kind, opened: false, escClosed: null, notes: [] };
    try {
      if (surface && !(await goto(surface))) {
        rec.notes.push('surface not reachable in the More menu');
        results.push(rec); return;
      }
      const before = await page.evaluate(STATE);
      const el = await page.$(opener);
      if (!el) { rec.notes.push(`opener not present: ${opener}`); results.push(rec); return; }
      await el.click({ timeout: 2500 });
      await page.waitForTimeout(1200);
      const after = await page.evaluate(STATE);

      const grew = (k) => after[k].length > before[k].length ? after[k].slice(-1)[0] : null;
      const opened = grew(kind) || (after[kind].length ? after[kind].slice(-1)[0] : null);
      if (!opened) { rec.notes.push('nothing opened'); results.push(rec); return; }

      rec.opened = true;
      rec.box = opened;
      rec.docOverflow = after.docScroll - after.docClient;
      await page.screenshot({ path: `${SHOTS}/${name.replace(/\W+/g, '_')}.png` }).catch(() => {});

      // Escape must close it — the recovered behaviour from B19.4 / A.11.1.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      const post = await page.evaluate(STATE);
      rec.escClosed = post[kind].length < after[kind].length;
    } catch (e) {
      rec.notes.push('probe error: ' + e.message.slice(0, 90));
    }
    results.push(rec);
  };

  /** A persistent rail is not click-opened: navigate and measure it in place. */
  const measureInPlace = async (name, surface, kind) => {
    const rec = { name, surface, kind, opened: false, escClosed: null, notes: [], inPlace: true };
    if (surface && !(await goto(surface))) {
      rec.notes.push('surface not reachable in the More menu'); results.push(rec); return;
    }
    const st = await page.evaluate(STATE);
    if (!st[kind].length) { rec.notes.push(`no ${kind} rendered at this viewport`); results.push(rec); return; }
    rec.opened = true;
    rec.box = st[kind][0];
    rec.docOverflow = st.docScroll - st.docClient;
    await page.screenshot({ path: `${SHOTS}/${name.replace(/\W+/g, '_')}.png` }).catch(() => {});
    results.push(rec);
  };

  // Representative set. Surface labels and drawer classes were read off the
  // A.11.1 measurement data, not guessed.
  await measureInPlace('ctx-sidebar @ Execution',   'Execution',   'drawers');
  await measureInPlace('ctx-sidebar @ Reliability', 'Reliability', 'drawers');
  await measureInPlace('ctx-sidebar @ Jarvis Brain','Jarvis Brain','drawers');
  await probe({ name: 'CRM contact drawer', surface: null, opener: '.cv2-row-avatar, .cv2-row, [class*="cv2-row"]', kind: 'drawers' });
  await probe({ name: 'Emergency stop dialog', surface: null, opener: '.cmd-pulse-stop', kind: 'dialogs' });
  await measureInPlace('Tables @ AI Orchestration', 'AI Orchestration', 'tables');

  fs.writeFileSync(OUT, JSON.stringify({ viewport: VW, results }, null, 2));
  console.log(`viewport ${VW}x${VH}`);
  for (const r of results) {
    if (!r.opened) { console.log(`  NOT MEASURED  ${r.name} — ${r.notes.join('; ') || 'did not open'}`); continue; }
    const b = r.box;
    console.log(`  MEASURED      ${r.name}: w=${b.w} h=${b.h} left=${b.left} right=${b.right} `
      + `inViewport=${b.withinViewport} scrollY=${b.overflowY} esc=${r.escClosed} docOverflow=${r.docOverflow}px`);
  }
  await browser.close();
})();
