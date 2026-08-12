#!/usr/bin/env node
/**
 * B19.2.1 — LIVE authenticated contrast sweep.
 *
 * Logs into the running app with a real backend session, walks the real
 * rendered DOM across every reachable tab, and measures computed foreground
 * against the composited ancestor background — in both themes.
 *
 * This is the authority the synthetic scanner approximates: no reconstructed
 * selector chains, no inferred backdrops.
 *
 *   A11Y_APP=http://127.0.0.1:8899  A11Y_PW=…  node scripts/a11y-live-scan.cjs
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const APP = process.env.A11Y_APP || 'http://127.0.0.1:8899';
const PW = process.env.A11Y_PW;
const OUT = process.env.A11Y_LIVE_OUT || '/tmp/a11y-live.json';
const SHOTS = process.env.A11Y_SHOTS || '/tmp/a11y-shots';

const PROBE = `(() => {
  const parse = s => { const m=(s||'').match(/[\\d.]+/g); if(!m) return null;
    const p=m.map(Number); return p.length>=4 ? p.slice(0,4) : [p[0],p[1],p[2],1]; };
  const over = (f,b) => [0,1,2].map(i=>f[i]*f[3]+b[i]*(1-f[3])).concat(1);
  const lum = c => { const f=v=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
    return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
  const ratio = (a,b) => { const L1=lum(a),L2=lum(b); return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); };

  function effBg(el){
    const stack=[]; let n=el;
    while(n && n!==document.documentElement){
      const cs=getComputedStyle(n);
      // A painted image/gradient makes the backdrop unmeasurable — but ONLY if
      // it sits between the text and an opaque colour. <body> carries a
      // decorative ambient gradient over an opaque --bg; bailing there
      // discarded almost every element in the app. Bail only when the element
      // itself (or an ancestor above the first opaque fill) paints one.
      if(cs.backgroundImage && cs.backgroundImage!=='none'
         && n!==document.body && n!==document.documentElement) return null;
      const c=parse(cs.backgroundColor);
      if(c && c[3]>0){ stack.push(c); if(c[3]===1) break; }
      n=n.parentElement;
    }
    const rb=parse(getComputedStyle(document.documentElement).backgroundColor)||[255,255,255,1];
    let base = rb[3]===1 ? rb : [255,255,255,1];
    for(let i=stack.length-1;i>=0;i--) base=over(stack[i],base);
    return base;
  }

  const out=[];
  for(const el of document.querySelectorAll('*')){
    const own = Array.from(el.childNodes).filter(n=>n.nodeType===3)
      .map(n=>n.textContent.trim()).join('');
    if(!own) continue;
    // decorative glyph only — WCAG 1.4.3 covers text, not ornament
    if(own.length<=2 && !/[a-zA-Z0-9]/.test(own)) continue;
    // Content hidden from assistive tech is presentational. It is still
    // reported (visual quality matters) but flagged so it can be told apart
    // from text that carries meaning.
    const ariaHidden = !!el.closest('[aria-hidden="true"]');
    const cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity===0) continue;
    const r=el.getBoundingClientRect();
    if(r.width<2||r.height<2) continue;
    const fg0=parse(cs.color); if(!fg0||fg0[3]===0) continue;
    const bg=effBg(el); if(!bg) continue;
    const cr=ratio(over(fg0,bg),bg);
    const size=parseFloat(cs.fontSize), weight=parseInt(cs.fontWeight)||400;
    const need=(size>=24||(size>=18.66&&weight>=700))?3.0:4.5;
    if(cr<need){
      out.push({
        sel:(el.tagName.toLowerCase()+(typeof el.className==='string'&&el.className
          ?'.'+el.className.trim().split(/\\s+/).slice(0,3).join('.'):'')).slice(0,90),
        text:own.slice(0,40), color:cs.color,
        bg:'rgb('+bg.slice(0,3).map(Math.round).join(',')+')',
        size, weight, ratio:Math.round(cr*100)/100, need, ariaHidden,
      });
    }
  }
  return out;
})()`;

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const results = {};

  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 }, colorScheme: theme,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.slice(0, 120)));

    await page.goto(APP + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(t => {
      localStorage.setItem('ooplix-theme', t);
      document.documentElement.setAttribute('data-theme', t);
    }, theme);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Log in through the real UI. The marketing landing page has no password
    // field, so first follow its "Log in" control to reach the auth card.
    if (PW) {
      if (!await page.$('input[type="password"]')) {
        for (const label of ['Log in', 'Login', 'Sign in']) {
          const link = await page.$(`text="${label}"`);
          if (link) { await link.click().catch(() => {}); await page.waitForTimeout(2500); break; }
        }
      }
      const pwField = await page.$('input[type="password"]');
      if (pwField) {
        // Operator login is password-ONLY: supplying an email routes to
        // user-account auth, which rejects the operator password. The email
        // input is `required`, so drop the constraint rather than fill it.
        await page.evaluate(() => {
          const e = document.querySelector('input[type="email"]');
          if (e) { e.removeAttribute('required'); e.value = ''; }
        });
        await pwField.fill(PW);
        const btn = await page.$('button[type="submit"], .auth-btn, .auth-submit');
        if (btn) await btn.click().catch(() => {});
        else await pwField.press('Enter');
        // Wait for the auth gate to actually disappear rather than a fixed
        // sleep — the shell hydrates well after the login response lands.
        await page.waitForFunction(
          () => !document.querySelector('.app-auth-gate, .auth-card'),
          { timeout: 45000 },
        ).catch(() => {});
        await page.waitForTimeout(4000);
      } else {
        console.warn(`  [${theme}] no password field reached — staying unauthenticated`);
      }
    }
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(1500);

    const found = [];
    const seen = new Set();
    const push = (rows, where) => {
      for (const r of rows) {
        const k = r.sel + '|' + r.color + '|' + r.ratio;
        if (seen.has(k)) continue;
        seen.add(k); found.push({ ...r, where });
      }
    };

    push(await page.evaluate(PROBE), 'initial');
    await page.screenshot({ path: `${SHOTS}/${theme}-initial.png`, fullPage: false });

    // The primary nav collapses most surfaces behind a "More (N)" menu; open
    // it so those tabs are enumerable alongside the visible ones.
    for (const m of await page.$$('.tab-more-wrap, [class*="tab--more"]')) {
      await m.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(700);
    }

    // Walk every top-level tab we can reach.
    const TAB_SEL = '[role="tab"], .tab, nav button, .tab-more-item';
    const tabs = await page.$$eval(TAB_SEL,
      els => els.slice(0, 120).map((e, i) => ({ i, label: (e.textContent || '').trim().slice(0, 28) }))
        .filter(t => t.label));
    let visited = 0, elementsSeen = 0, textSeen = 0;
    for (const t of tabs) {
      try {
        const els = await page.$$(TAB_SEL);
        if (!els[t.i]) continue;
        await els[t.i].click({ timeout: 2500 });
        await page.waitForTimeout(1200);
        push(await page.evaluate(PROBE), t.label);
        elementsSeen += await page.evaluate(() => document.querySelectorAll('*').length);
        textSeen += await page.evaluate(() => [...document.querySelectorAll('*')]
          .filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).length);
        visited++;
        if (visited <= 6) await page.screenshot({ path: `${SHOTS}/${theme}-${t.label.replace(/\W+/g, '_')}.png` });
      } catch { /* tab not clickable in this state */ }
    }

    // "Authenticated" means the app shell actually rendered — not merely that
    // no password field is visible (the marketing page has none either).
    const reachable = await page.evaluate(() => ({
      els: document.querySelectorAll('*').length,
      withText: [...document.querySelectorAll('*')]
        .filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).length,
      authed: !document.querySelector('.app-auth-gate, .auth-card'),
      onLanding: !!document.querySelector('[class^="lp-"], .lp-root'),
    }));

    results[theme] = { failures: found, visitedTabs: visited, reachable, errors,
                       coverage: { elementsSeen, textSeen } };
    console.log(`${theme}: ${found.length} failures | tabs walked ${visited} | cumulative DOM ${elementsSeen} els, ${textSeen} text nodes | authed=${reachable.authed} | page errors ${errors.length}`);
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  for (const [t, r] of Object.entries(results)) {
    if (!r.failures.length) continue;
    console.log(`\n--- ${t} worst 15 ---`);
    r.failures.sort((a, b) => a.ratio - b.ratio).slice(0, 15).forEach(f =>
      console.log(`  ${String(f.ratio).padStart(6)}:1 (need ${f.need}) [${f.where}] ${f.sel}  "${f.text}"  ${f.color} on ${f.bg}`));
  }
  console.log(`\nscreenshots: ${SHOTS}`);
})();
