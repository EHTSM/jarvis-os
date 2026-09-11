/**
 * Phase B19.2 — Visual accessibility regression suite.
 *
 * Contrast maths is computed here (WCAG 2.x relative luminance) and asserted
 * against the ACTUAL token values in index.css, so a regression in the palette
 * fails the build. Structural guarantees (accessibility media modes, alias
 * coverage) are asserted against the stylesheet itself.
 *
 * Negative tests re-prove each rule by feeding it a known-bad value: if a check
 * ever stops detecting its defect, the corresponding fix could be reverted
 * silently.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'frontend', 'src');
const INDEX = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8');

// ── WCAG maths ───────────────────────────────────────────────────────────
function lum([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [L1, L2] = [lum(a), lum(b)];
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}
function hex(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
/** Read a custom property out of a specific rule block. */
function tokenIn(selector, name) {
  const i = INDEX.indexOf(selector);
  assert.ok(i !== -1, `${selector} must exist in index.css`);
  const block = INDEX.slice(i, INDEX.indexOf('}', i));
  const m = block.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,6})`));
  return m ? m[1] : null;
}

const AA = 4.5;
const DARK_SURFACES = ['#05070d', '#0b0f1b', '#0a0e18', '#0e1320', '#080c14', '#101626'];
const LIGHT_SURFACES = ['#f4f5f8', '#ffffff'];

// ── 1. Semantic palette clears AA in BOTH themes ─────────────────────────
const SEMANTIC = ['--success', '--warning', '--danger', '--info', '--accent', '--accent2'];

test('dark-mode semantic tokens clear AA on every dark surface', () => {
  for (const tok of SEMANTIC) {
    const v = tokenIn(':root {', tok);
    assert.ok(v, `${tok} missing from :root`);
    for (const s of DARK_SURFACES) {
      const r = contrast(hex(v), hex(s));
      assert.ok(r >= AA, `${tok} (${v}) on ${s} = ${r.toFixed(2)}:1, need ${AA}`);
    }
  }
});

test('light-mode semantic tokens clear AA on every light surface', () => {
  for (const tok of SEMANTIC) {
    const v = tokenIn(':root[data-theme="light"]', tok);
    assert.ok(v, `${tok} must be overridden for light mode — the dark value renders ~1.9:1 on white`);
    for (const s of LIGHT_SURFACES) {
      const r = contrast(hex(v), hex(s));
      assert.ok(r >= AA, `${tok} (${v}) on ${s} = ${r.toFixed(2)}:1, need ${AA}`);
    }
  }
});

test('text ramp clears AA in both themes', () => {
  for (const [sel, surfaces] of [[':root {', DARK_SURFACES], [':root[data-theme="light"]', LIGHT_SURFACES]]) {
    for (const tok of ['--text', '--text-dim', '--text-faint']) {
      const v = tokenIn(sel, tok);
      assert.ok(v, `${tok} missing from ${sel}`);
      for (const s of surfaces) {
        const r = contrast(hex(v), hex(s));
        assert.ok(r >= AA, `${sel} ${tok} (${v}) on ${s} = ${r.toFixed(2)}:1`);
      }
    }
  }
});

test('on-fill tokens clear AA against their own fill', () => {
  const pairs = [
    ['--on-accent', '--accent'], ['--on-danger', '--danger'],
    ['--on-success', '--success'], ['--on-warning', '--warning'],
    ['--on-accent2', '--accent2'], ['--on-info', '--info'],
  ];
  for (const [sel, label] of [[':root {', 'dark'], [':root[data-theme="light"]', 'light']]) {
    for (const [on, fill] of pairs) {
      const fg = tokenIn(sel, on), bg = tokenIn(sel, fill);
      assert.ok(fg, `${on} missing in ${label}`);
      assert.ok(bg, `${fill} missing in ${label}`);
      const r = contrast(hex(fg), hex(bg));
      assert.ok(r >= AA, `${label}: ${on} (${fg}) on ${fill} (${bg}) = ${r.toFixed(2)}:1`);
    }
  }
});

// ── 2. Light-mode parity between the two definition sites ────────────────
test('light-mode token parity: [data-theme] block and prefers-color-scheme fallback agree', () => {
  const attrIdx = INDEX.indexOf(':root[data-theme="light"]');
  const attrBlock = INDEX.slice(attrIdx, INDEX.indexOf('}', attrIdx));
  const mqIdx = INDEX.indexOf(':root:not([data-theme])');
  assert.ok(mqIdx !== -1, 'prefers-color-scheme fallback must exist');
  const mqBlock = INDEX.slice(mqIdx, INDEX.indexOf('}', mqIdx));

  // Collapse internal whitespace: the same value wrapped across lines in one
  // block and inlined in the other is not drift.
  const grab = b => Object.fromEntries(
    [...b.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
      .map(m => [m[1], m[2].replace(/\s+/g, ' ').trim()]));
  const a = grab(attrBlock), m = grab(mqBlock);

  const drift = [];
  for (const k of Object.keys(a)) {
    if (m[k] === undefined) drift.push(`${k} missing from fallback`);
    else if (m[k] !== a[k]) drift.push(`${k}: "${a[k]}" vs "${m[k]}"`);
  }
  assert.deepStrictEqual(drift, [], `Light theme drifted between its two definition sites:\n${drift.join('\n')}`);
});

// ── 3. Accessibility media modes exist and are wired ─────────────────────
test('forced-colors mode maps tokens onto system colours', () => {
  const i = INDEX.indexOf('@media (forced-colors: active)');
  assert.ok(i !== -1, 'forced-colors block must exist (Windows High Contrast)');
  const block = INDEX.slice(i, i + 2600);
  for (const kw of ['Canvas', 'CanvasText', 'Highlight', 'ButtonText']) {
    assert.ok(block.includes(kw), `forced-colors block must use the system colour ${kw}`);
  }
  assert.match(block, /outline:\s*3px solid Highlight/, 'focus must stay visible in forced-colors');
});

test('prefers-contrast: more strengthens the text ramp', () => {
  const i = INDEX.indexOf('@media (prefers-contrast: more)');
  assert.ok(i !== -1, 'prefers-contrast block must exist');
  const block = INDEX.slice(i, i + 1200);
  assert.match(block, /--text:\s*#ffffff/, 'dark high-contrast text must go to pure white');
  assert.match(block, /--text:\s*#000000/, 'light high-contrast text must go to pure black');
});

test('prefers-reduced-transparency makes surfaces opaque', () => {
  const i = INDEX.indexOf('@media (prefers-reduced-transparency: reduce)');
  assert.ok(i !== -1, 'reduced-transparency block must exist');
  const block = INDEX.slice(i, i + 1500);
  assert.match(block, /backdrop-filter:\s*none/, 'blur must be disabled');
  // no rgba() surface values inside this block — they must all be opaque hex
  const surfaces = [...block.matchAll(/--surface[\w-]*:\s*([^;]+);/g)].map(m => m[2 - 1]);
  for (const v of surfaces) {
    if (/transparent/.test(v)) continue;
    assert.ok(/^#[0-9a-fA-F]{3,8}$/.test(v.trim()),
      `reduced-transparency surface must be opaque, got "${v.trim()}"`);
  }
});

test('accessibility modes out-specify the prefers-color-scheme fallback', () => {
  // `:root:not([data-theme])` (0,2,0) beats a bare `:root` (0,1,0); without the
  // extra qualifiers the modes silently lose to the light fallback.
  for (const mode of ['forced-colors: active', 'prefers-contrast: more',
    'prefers-reduced-transparency: reduce']) {
    const i = INDEX.indexOf(`@media (${mode})`);
    assert.ok(i !== -1, `${mode} block missing`);
    const head = INDEX.slice(i, i + 260);
    assert.match(head, /:root:not\(\[data-theme\]\)/,
      `${mode} must also target :root:not([data-theme]) or it loses the cascade`);
  }
});

// ── 4. Token hygiene ─────────────────────────────────────────────────────
test('no CSS references an undefined design token without a fallback', () => {
  const walk = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
      else if (/\.css$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const files = walk(SRC);
  const defined = new Set();
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/:root[^{]*\{([^}]*)\}/g))
      for (const t of m[1].matchAll(/(--[\w-]+)\s*:/g)) defined.add(t[1]);
  }
  // set at runtime from JSX rather than in CSS
  const RUNTIME = new Set(['--cap-color', '--verdict-color', '--x', '--i', '--delay',
    '--progress', '--pct', '--col', '--row', '--hue', '--val', '--w', '--h']);

  const missing = [];
  for (const f of files) {
    const rel = path.relative(SRC, f);
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/var\((--[\w-]+)\s*(,)?/g)) {
      if (defined.has(m[1]) || RUNTIME.has(m[1]) || m[2]) continue;
      missing.push(`${rel}: var(${m[1]}) — undefined and no fallback`);
    }
  }
  assert.deepStrictEqual(missing.slice(0, 20), [],
    `${missing.length} undefined token references:\n${missing.slice(0, 20).join('\n')}`);
});

// ── 5. Negative tests — each rule must still catch its defect ────────────
test('NEGATIVE: contrast maths flags a known-bad pair', () => {
  // the pre-fix light-mode --success on white measured 1.85:1
  const r = contrast(hex('#52d68a'), hex('#ffffff'));
  assert.ok(r < AA, `expected the original value to fail, measured ${r.toFixed(2)}:1`);
  assert.ok(Math.abs(r - 1.85) < 0.05, `expected ~1.85:1, got ${r.toFixed(2)}`);
});

test('NEGATIVE: contrast maths accepts a known-good pair', () => {
  const r = contrast(hex('#1e7e47'), hex('#ffffff'));
  assert.ok(r >= AA, `expected the fixed value to pass, measured ${r.toFixed(2)}:1`);
});

test('NEGATIVE: white text on every brand fill fails AA (why on-* tokens exist)', () => {
  for (const fill of ['#7c6fff', '#52d68a', '#f0b429', '#4ecdc4', '#5dc8f5']) {
    const r = contrast([255, 255, 255], hex(fill));
    assert.ok(r < AA, `white on ${fill} should fail, measured ${r.toFixed(2)}:1`);
  }
});

test('NEGATIVE: luminance ordering is correct (guards the maths itself)', () => {
  assert.ok(lum([255, 255, 255]) > lum([128, 128, 128]));
  assert.ok(lum([128, 128, 128]) > lum([0, 0, 0]));
  assert.ok(Math.abs(contrast([255, 255, 255], [0, 0, 0]) - 21) < 0.01, 'black/white must be 21:1');
});

// ── 6. The landing page (always-dark marketing surface) ──────────────────
test('landing page text clears AA on its fixed dark canvas', () => {
  const css = fs.readFileSync(path.join(SRC, 'components/LandingPage.css'), 'utf8');
  const CANVAS = hex('#0a0b10');   // the lightest lp panel background
  const fails = [];
  // `\bcolor:` also matches `border-color:` / `border-bottom-color:`, which are
  // strokes, not text — they are not subject to 1.4.3. Require the declaration
  // to start the property.
  for (const m of css.matchAll(/(?:^|[;{])\s*color:\s*rgba\(\s*255,\s*255,\s*255,\s*([0-9.]+)\s*\)/gm)) {
    const a = parseFloat(m[1]);
    const fg = [0, 1, 2].map(i => 255 * a + CANVAS[i] * (1 - a));
    const r = contrast(fg, CANVAS);
    if (r < AA) fails.push(`rgba(255,255,255,${a}) = ${r.toFixed(2)}:1`);
  }
  assert.deepStrictEqual(fails, [], `Landing-page white text below AA:\n${fails.join('\n')}`);
});

test('landing page primary button keeps AA in both states', () => {
  const css = fs.readFileSync(path.join(SRC, 'components/LandingPage.css'), 'utf8');
  const rest = /\.lp-btn-primary\s*\{[^}]*background:\s*(#[0-9a-f]{6})/i.exec(css);
  // `[^}]*` rather than `\s*` — the declaration need not be the first thing in
  // the block (a comment explaining the pinned brand value may precede it).
  const hover = /\.lp-btn-primary:hover\s*\{[^}]*background:\s*(#[0-9a-f]{6})/i.exec(css);
  assert.ok(rest && hover, 'primary button fills must be findable');
  for (const [label, m] of [['resting', rest], ['hover', hover]]) {
    const r = contrast([255, 255, 255], hex(m[1]));
    assert.ok(r >= AA, `${label} button ${m[1]}: white label = ${r.toFixed(2)}:1`);
  }
});
