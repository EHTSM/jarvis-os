#!/usr/bin/env node
/**
 * B.19.3 — accessibility-tree inspection via the Chrome DevTools Protocol.
 *
 * This is NOT a screen reader and is never reported as one. It reads the SAME
 * computed accessibility tree that a screen reader consumes (Chrome's AXTree —
 * the source AT-SPI/UIA/NSAccessibility are populated from), so it measures
 * what WOULD be announced: computed name, role, state, and the resolution
 * source of every name.
 *
 * What it can prove:  a control has / lacks an accessible name; the name's
 *                     origin (label / aria-label / placeholder / title);
 *                     roles, states, headings, landmarks, live regions.
 * What it CANNOT prove: how a specific screen reader verbalises it, its
 *                     reading order in practice, or gesture behaviour.
 *
 * Validity gate: refuses to report on an unauthenticated page — a zero from a
 * login screen is meaningless (established in B.19.2.2).
 */
const { chromium } = require('playwright-core');

const APP = process.env.B_APP || 'http://127.0.0.1:8899';
const PW = process.env.B_PW;
const THEME = process.env.B_THEME || 'dark';
const OUT = process.env.B_OUT || `/tmp/b193-axtree-${THEME}.json`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: THEME === 'light' ? 'light' : 'dark',
  });
  const page = await ctx.newPage();
  await page.goto(APP + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => {
    localStorage.setItem('ooplix-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, THEME);
  await page.reload({ waitUntil: 'domcontentloaded' });
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

  const shell = await page.evaluate(() => ({
    authed: !document.querySelector('.app-auth-gate, .auth-card'),
    tabs: document.querySelectorAll('.tab').length,
  }));
  if (!shell.authed || shell.tabs < 5) {
    console.error(`INVALID RUN — authed=${shell.authed} tabs=${shell.tabs}. `
      + `An accessibility-tree reading of the login screen is not evidence about the app.`);
    await browser.close();
    process.exit(2);
  }

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Accessibility.enable');

  /** Full AX tree for the current surface. */
  async function axNodes() {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    return nodes;
  }

  const val = (p) => (p && p.value !== undefined ? p.value : undefined);

  /**
   * For every form control in the DOM, resolve how its accessible name is
   * produced. This is the measurement G1-B193 needs: axe accepts a placeholder
   * as a name, WCAG 3.3.2 does not.
   */
  async function formNameSources() {
    return page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('input:not([type=hidden]),select,textarea')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const id = el.id;
        const labelFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        const wrapping = el.closest('label');
        out.push({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || '',
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
          visibleLabel: !!(labelFor || wrapping),
          ariaLabel: el.getAttribute('aria-label') || null,
          ariaLabelledby: el.getAttribute('aria-labelledby') || null,
          placeholder: el.getAttribute('placeholder') || null,
          title: el.getAttribute('title') || null,
          autocomplete: el.getAttribute('autocomplete') || null,
          required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
          describedby: el.getAttribute('aria-describedby') || null,
        });
      }
      return out;
    });
  }

  const surfaces = {};
  async function record(label) {
    const nodes = await axNodes();
    const byRole = {};
    const unnamed = [];
    let headings = [], landmarks = [], live = [];
    for (const n of nodes) {
      if (n.ignored) continue;
      const role = val(n.role);
      const name = (val(n.name) || '').trim();
      if (!role) continue;
      byRole[role] = (byRole[role] || 0) + 1;
      const INTERACTIVE = ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio',
        'switch', 'menuitem', 'tab', 'option', 'searchbox', 'slider', 'spinbutton'];
      if (INTERACTIVE.includes(role) && !name) {
        unnamed.push({ role, id: n.nodeId, props: (n.properties || []).map(p => p.name).join(',') });
      }
      if (role === 'heading') headings.push({ name: name.slice(0, 50), level: (n.properties || []).find(p => p.name === 'level')?.value?.value });
      if (['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'search', 'region', 'form'].includes(role)) {
        landmarks.push({ role, name: name.slice(0, 40) });
      }
      const lv = (n.properties || []).find(p => p.name === 'live');
      if (lv && lv.value && lv.value.value && lv.value.value !== 'off') live.push({ role, live: lv.value.value, name: name.slice(0, 40) });
    }
    const forms = await formNameSources();
    surfaces[label] = { total: nodes.length, byRole, unnamed, headings, landmarks, live, forms };
    console.log(`  ${String(nodes.length).padStart(5)} ax nodes  ${String(unnamed.length).padStart(3)} unnamed interactive  `
      + `${String(headings.length).padStart(2)} headings  ${String(landmarks.length).padStart(2)} landmarks  `
      + `${String(live.length).padStart(2)} live  ${String(forms.length).padStart(3)} form controls  ${label}`);
  }

  await record('Dashboard (initial)');

  const PRIMARY = '.tabs > button.tab:not(.tab--more), [role="tab"]';
  const n = await page.$$eval(PRIMARY, (e) => e.length).catch(() => 0);
  for (let i = 0; i < n; i++) {
    const els = await page.$$(PRIMARY);
    if (!els[i]) continue;
    const label = (await els[i].textContent() || '').trim().slice(0, 26) || `tab${i}`;
    await els[i].click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(1100);
    await record(label);
  }

  // Command palette — the G2-B195 surface.
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(1200);
  const paletteOpen = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
  if (paletteOpen) await record('Command palette (open)');

  require('fs').writeFileSync(OUT, JSON.stringify({ theme: THEME, surfaces }, null, 2));
  console.log(`\ntheme=${THEME} surfaces=${Object.keys(surfaces).length} → ${OUT}`);
  await browser.close();
})();
