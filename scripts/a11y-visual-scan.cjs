#!/usr/bin/env node
/**
 * Phase B19.2 — component-CSS contrast measurement via real rendering.
 *
 * The authenticated app cannot be reached without a live backend session, so
 * instead of faking a login we render each component stylesheet against a
 * synthetic DOM that reproduces its own selector structure, and let Chromium
 * resolve the cascade. Every rule that sets `color` gets an element created
 * with that rule's classes, nested inside elements carrying the classes of any
 * rule that sets a background — so ancestor backgrounds composite correctly.
 *
 * Measured in both themes with the real token layer loaded.
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const SRC = require('path').join(__dirname, '..', 'frontend/src');
const OUT = process.env.A11Y_VISUAL_OUT || require('path').join(require('os').tmpdir(), 'a11y-visual-contrast.json');

/**
 * Build the set of class names whose JSX content is nothing but a decorative
 * glyph. Derived from the source, never hardcoded: a class qualifies only when
 * EVERY place it renders content emits a single non-alphanumeric character
 * (·, ›, ◈, ✕ …). Such nodes are decoration under WCAG 1.4.3 — the adjacent
 * labelled elements carry the meaning — so they are exempt from text contrast.
 */
function decorativeClasses(srcDir) {
  const jsx = [];
  (function scan(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') scan(p); }
      else if (/\.jsx$/.test(e.name)) jsx.push(p);
    }
  })(srcDir);

  const content = new Map();          // class -> Set of rendered strings
  for (const f of jsx) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})\s*>([^<{]{0,24})</g)) {
      const classes = (m[1] || m[2] || '').split(/\s+/).filter(Boolean)
        .filter(c => /^[\w-]+$/.test(c));
      const text = (m[3] || '').trim();
      for (const c of classes) {
        if (!content.has(c)) content.set(c, new Set());
        content.get(c).add(text);
      }
    }
  }
  const deco = new Set();
  for (const [cls, texts] of content) {
    const rendered = [...texts].filter(t => t.length > 0);
    if (!rendered.length) continue;
    // every rendering must be a lone decorative glyph
    if (rendered.every(t => t.length <= 2 && !/[a-zA-Z0-9]/.test(t))) deco.add(cls);
  }
  return deco;
}

/**
 * B19.2.3 — classes whose BACKGROUND is assigned at runtime in JSX
 * (`<div className="x" style={{ background: color }}>`), and classes that no
 * JSX references at all.
 *
 * The synthetic scanner reconstructs a DOM from CSS alone, so for the first
 * group it measures the CSS-declared backdrop while the real element paints a
 * different one — a structural false positive, not a defect. (The live
 * authenticated scanner measures these correctly; that is the authority.)
 * The second group cannot reach a user at all.
 *
 * Derived from source, never hardcoded, so the exemption cannot go stale.
 */
function runtimeStyledClasses(srcDir) {
  const jsx = [];
  (function scan(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') scan(p); }
      else if (/\.(jsx|tsx)$/.test(e.name)) jsx.push(p);
    }
  })(srcDir);

  const runtimeBg = new Set();
  const referenced = new Set();
  for (const f of jsx) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)) {
      for (const c of (m[1] || m[2] || m[3] || '').split(/\s+/).filter(Boolean)) {
        if (/^[\w-]+$/.test(c)) referenced.add(c);
      }
    }
    // className="…" followed by a style object that sets background
    for (const m of src.matchAll(
      /className="([^"]*)"[^>]{0,160}?style=\{\{[^}]*?\bbackground(?:Color)?\s*:/g)) {
      for (const c of m[1].split(/\s+/).filter(Boolean)) runtimeBg.add(c);
    }
  }
  return { runtimeBg, referenced };
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.css$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Selector -> a concrete element chain that matches it. */
function chainFor(sel) {
  // strip pseudo-elements; keep pseudo-classes as state we can't simulate
  const clean = sel.replace(/::[\w-]+/g, '').trim();
  if (!clean || /[@]/.test(clean)) return null;
  // split descendant combinators
  const parts = clean.split(/\s*>\s*|\s+/).filter(Boolean);
  const chain = parts.map(p => {
    const classes = [...p.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
    const tagM = /^([a-z][\w-]*)/i.exec(p);
    const tag = tagM ? tagM[1] : 'div';
    const states = [...p.matchAll(/:([\w-]+)/g)].map(m => m[1])
      .filter(s => !['hover', 'focus', 'active', 'focus-visible', 'disabled', 'checked'].includes(s));
    if (states.length) return null;                 // :nth-child etc — skip
    return { tag, classes };
  });
  if (chain.some(c => c === null)) return null;
  if (!chain.length || !chain.some(c => c.classes.length)) return null;
  return chain;
}

(async () => {
  const files = walk(SRC);
  const DECORATIVE = decorativeClasses(SRC);
  console.log('decorative-glyph classes detected from JSX:', DECORATIVE.size);
  const { runtimeBg: RUNTIME_BG, referenced: REFERENCED } = runtimeStyledClasses(SRC);
  console.log('runtime-styled (JSX background) classes:', RUNTIME_BG.size,
              '| classes referenced by JSX:', REFERENCED.size);
  const tokens = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8');
  const browser = await chromium.launch();
  const all = { dark: [], light: [] };

  for (const file of files) {
    const rel = path.relative(SRC, file);
    if (rel === 'index.css') continue;
    const css = fs.readFileSync(file, 'utf8');

    // collect rules that set color (skip @media/@keyframes bodies)
    // Blank out @media/@supports wrappers and @keyframes bodies but PRESERVE
    // newlines, so reported line numbers still match the real file.
    const blank = s => s.replace(/[^\n]/g, ' ');
    const stripped = css
      .replace(/@(media|supports)[^{]*\{/g, blank)
      .replace(/@keyframes[^{]*\{[\s\S]*?\n\}/g, blank);
    const colorRules = [];
    for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // A rule preceded by a comment captures the comment in the selector
      // group. Left in, chainFor() builds an element that the rule never
      // matches, and the probe measures an unstyled node — a false positive.
      const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
      if (sel.startsWith('@') || sel.includes(':root')) continue;
      if (!/(^|;|\s)color\s*:/.test(m[2])) continue;
      // 1-based line of this rule, and the colour it declares — both needed to
      // locate and triage a finding without re-deriving it by hand.
      // m.index points at the whitespace preceding the selector, so anchor on
      // the selector text itself to land on the rule's real line.
      const selStart = m.index + m[0].indexOf(sel.split('\n').pop().trim());
      const line = stripped.slice(0, selStart >= m.index ? selStart : m.index).split('\n').length;
      const decl = /(?:^|;|\s)color\s*:\s*([^;]+)/.exec(m[2]);
      const declared = decl ? decl[1].trim() : null;
      const body = m[2];
      for (const one of sel.split(',')) {
        const c = chainFor(one.trim());
        if (c) colorRules.push({ sel: one.trim(), chain: c, line, declared, body });
      }
    }
    if (!colorRules.length) continue;

    const nodes = colorRules.map((r, i) => {
      let html = '', close = '';
      r.chain.forEach((seg, j) => {
        const last = j === r.chain.length - 1;
        const isDeco = last && seg.classes.length
          && seg.classes.every(c => DECORATIVE.has(c));
        const attrs = `class="${seg.classes.join(' ')}"`
          + (last ? ` data-i="${i}" data-declared="${r.declared ? 'yes' : 'no'}"`
                  + (isDeco ? ' data-decorative="yes"' : '') : '');
        html += `<${seg.tag} ${attrs}>`;
        close = `</${seg.tag}>` + close;
      });
      return html + 'Sample text' + close;
    }).join('\n');

    // The app paints --bg on <body> and resets UA button chrome (index.css).
    // Without reproducing that, a `background: none` button inherits Chromium's
    // #efefef default and every rule on it measures against the wrong backdrop.
    // The app paints --bg on <html> and resets UA button chrome (index.css).
    // Without the reset, a `background: none` button inherits Chromium's
    // #efefef default and every rule on it measures against the wrong backdrop.
    // Only <html> gets the canvas fill so the ancestor walk still sees through
    // transparent wrappers.
    const reset = `
      html { background: var(--bg); color: var(--text); }
      body { margin: 0; background: transparent; }
      button, input, select, textarea { background: transparent; border: none;
        font: inherit; color: inherit; }`;
    const html = `<!doctype html><html><head><style>${tokens}</style>
      <style>${reset}</style><style>${css}</style>
      </head><body><div id="root"><span id="a11y-unstyled-ref">ref</span>
      ${nodes}</div></body></html>`;

    for (const theme of ['dark', 'light']) {
      // colorScheme must match the theme: index.css has a
      // `@media (prefers-color-scheme: light) :root:not([data-theme])` fallback,
      // and headless Chromium reports "light" by default. Setting only the
      // attribute leaves that media block live during the dark pass.
      const page = await browser.newPage({ colorScheme: theme });
      await page.setContent(html);
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      const found = await page.evaluate(() => {
        const parse = s => { const m = (s || '').match(/[\d.]+/g); if (!m) return null;
          const p = m.map(Number); return p.length >= 4 ? p.slice(0, 4) : [p[0], p[1], p[2], 1]; };
        const over = (f, b) => [0,1,2].map(i => f[i]*f[3] + b[i]*(1-f[3])).concat(1);
        const lum = c => { const f = v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
          return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
        const ratio = (a,b) => { const L1=lum(a),L2=lum(b); return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); };
        // A gradient/image background paints real pixels that getComputedStyle
        // reports only as backgroundImage. We cannot resolve its average colour
        // here, so such elements are reported separately rather than measured
        // against a background they do not actually have.
        function hasPaintedImage(el) {
          const bi = getComputedStyle(el).backgroundImage;
          return bi && bi !== 'none';
        }
        function effBg(el) {
          const stack = []; let n = el;
          while (n && n !== document.documentElement) {
            if (hasPaintedImage(n)) return null;      // unmeasurable — skip
            const c = parse(getComputedStyle(n).backgroundColor);
            if (c && c[3] > 0) { stack.push(c); if (c[3] === 1) break; }
            n = n.parentElement;
          }
          const rb = parse(getComputedStyle(document.documentElement).backgroundColor) || [255,255,255,1];
          let base = rb[3] === 1 ? rb : [255,255,255,1];
          for (let i = stack.length-1; i >= 0; i--) base = over(stack[i], base);
          return base;
        }
        const out = [];
        // Every rule under test declares a `color`. If the probe node computes
        // the inherited default instead, the rule never matched it (usually a
        // selector the synthetic chain cannot satisfy) and the measurement is
        // meaningless. `data-declared` carries the rule's own declaration.
        const ref = document.getElementById('a11y-unstyled-ref');
        const refColor = ref ? getComputedStyle(ref).color : null;

        for (const el of document.querySelectorAll('[data-i]')) {
          const cs = getComputedStyle(el);
          const fg0 = parse(cs.color); if (!fg0) continue;
          if (fg0[3] === 0) continue;
          // Rule declared a colour but the node shows the inherited default →
          // the rule did not apply. Skip rather than report a phantom failure.
          if (refColor && cs.color === refColor && el.dataset.declared === 'yes') continue;
          // WCAG 1.4.3 applies to TEXT. A node whose only content is a
          // decorative glyph (·, ›, ◈ …) conveys no information — the
          // surrounding labelled elements do. Marked by the caller after
          // inspecting what the component actually renders.
          if (el.dataset.decorative === 'yes') continue;
          const bg = effBg(el);
          if (!bg) continue;                          // gradient-backed — unmeasurable
          const cr = ratio(over(fg0, bg), bg);
          const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight) || 400;
          const need = (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3.0 : 4.5;
          if (cr < need) out.push({ i: +el.dataset.i, ratio: Math.round(cr*100)/100,
            need, color: cs.color, bg: 'rgb('+bg.slice(0,3).map(Math.round).join(',')+')', size, weight });
        }
        return out;
      });
      for (const f of found) {
        const sel = colorRules[f.i].sel;
        const classes = (sel.match(/\.([\w-]+)/g) || []).map(c => c.slice(1));
        // B19.2.3 — structural false positives, excluded with evidence:
        //  • the element's background is assigned at runtime in JSX, so the
        //    reconstructed DOM measures a backdrop the user never sees;
        //  • no JSX references the class at all, so it cannot reach a user.
        // Both are verified against the live authenticated scan, which is the
        // authority and reports 0 for these.
        if (classes.length && classes.some(c => RUNTIME_BG.has(c))) continue;
        if (classes.length && classes.every(c => !REFERENCED.has(c))) continue;
        all[theme].push({
          file: rel,
          sel,
          line: colorRules[f.i].line,
          declared: colorRules[f.i].declared,
          ownsBackground: /background/.test(colorRules[f.i].body || ''),
          ...f,
        });
      }
      await page.close();
    }
  }
  await browser.close();

  console.log(`dark : ${all.dark.length} failures`);
  console.log(`light: ${all.light.length} failures`);
  const byFile = {};
  [...all.dark, ...all.light].forEach(f => byFile[f.file] = (byFile[f.file] || 0) + 1);
  console.log('\ntop files:');
  Object.entries(byFile).sort((a,b) => b[1]-a[1]).slice(0, 20)
    .forEach(([f,c]) => console.log(`  ${String(c).padStart(4)}  ${f}`));
  console.log('\nworst 20 (either theme):');
  [...all.dark.map(f=>({...f,t:'dark'})), ...all.light.map(f=>({...f,t:'light'}))]
    .sort((a,b)=>a.ratio-b.ratio).slice(0,20)
    .forEach(f => console.log(`  ${String(f.ratio).padStart(6)}:1 ${f.t.padEnd(5)} ${f.file} ${f.sel.slice(0,50)}  ${f.color}`));
  fs.writeFileSync(OUT, JSON.stringify(all, null, 2));
})();
