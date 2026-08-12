#!/usr/bin/env node
/**
 * B19.2.2 — generates the token-bypass exception whitelist.
 *
 * Every colour literal that survives the migration is classified into one of
 * the documented exception categories, or reported as UNJUSTIFIED. The output
 * is derived from source each run, so the whitelist cannot drift from reality:
 * a new un-categorised literal shows up as UNJUSTIFIED and fails the gate.
 *
 *   node scripts/a11y-exception-whitelist.cjs            # human-readable
 *   node scripts/a11y-exception-whitelist.cjs --json f   # machine-readable
 *   node scripts/a11y-exception-whitelist.cjs --check    # exit 1 if unjustified
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'frontend', 'src');

/**
 * Each category states WHY a literal there is allowed to bypass the token
 * layer. `test` decides membership from the file path and the source line —
 * never from a hand-maintained list of values.
 */
const CATEGORIES = [
  {
    id: 'fixed-dark-surface',
    why: 'Marketing landing page and full-screen overlays paint their own opaque '
       + 'dark canvas in BOTH themes. Their foreground is therefore calibrated '
       + 'against a known backdrop; tokenising it would invert the pairing in '
       + 'light mode. Verified ≥4.5:1 against that fixed canvas.',
    test: f => /LandingPage\.css$|ShortcutsOverlay\.css$|PublicLaunch\.css$|Landing\.css$/.test(f.file),
  },
  {
    id: 'brand-identity',
    why: 'The Ooplix mark and wordmark are brand assets. Their colours identify '
       + 'the product and must not shift with the theme; the wordmark instead '
       + 'takes an explicit `dark` prop at the two fixed-dark call sites.',
    test: f => /OoplixMark|OoplixWordmark|Logo/i.test(f.file),
  },
  {
    id: 'avatar-identity',
    why: 'Per-contact avatar fills. The hue distinguishes one identity from '
       + 'another and must stay stable across themes. Contrast is met by '
       + 'pairing every entry with a fixed dark foreground (#0a0c14), verified '
       + '≥5.18:1 on the worst entry — not by theming the fill.',
    test: f => /AVATAR_COLORS|avatarPalette|_avatarColor|cv2-row-avatar/.test(f.line + f.sel),
  },
  {
    id: 'token-definition',
    why: 'A custom-property DEFINITION (`--success: #52d68a`). This is where a '
       + 'colour is authored, not a bypass of the token layer — the light theme '
       + 'overrides the same names, so consumers stay theme-aware. Private '
       + 'component palettes were aliased onto the canonical tokens in this phase.',
    test: f => /^--/.test(f.prop),
  },
  {
    id: 'chart-series',
    why: 'Data-encoding colours. A chart series must stay visually distinct and '
       + 'stable across themes so a reader can compare two screenshots; these '
       + 'are not UI chrome and carry no text-contrast obligation.',
    test: f => /chart|recharts|<Cell|dataKey|series|sparkline|COLORS\s*=/i.test(f.line)
            || /Chart|Graph/.test(path.basename(f.file)),
  },
  {
    id: 'gradient-stop',
    why: 'Multi-stop decorative paint. A gradient has no single computed value '
       + 'to contrast against and never carries text on its own.',
    test: f => /gradient/i.test(f.line),
  },
  {
    id: 'decorative-non-text',
    why: 'Borders, shadows, scrollbar thumbs, status dots and rules. WCAG 1.4.3 '
       + 'governs text; these paint no glyphs. (1.4.11 non-text contrast is '
       + 'tracked separately and is not in this phase’s scope.)',
    // Decided by the PROPERTY, not by whether the word appears somewhere on
    // the line — `color` is text and never qualifies here.
    // Decided by the PROPERTY, not by whether the word appears somewhere on
    // the line. `color` is text and never qualifies. `background` does NOT
    // qualify either — a hardcoded fill behind themed text is precisely the
    // defect this phase removes, so it must stay visible as UNJUSTIFIED.
    test: f => /^(border|outline|box-shadow|text-shadow|scrollbar-color|caret-color|fill|stroke)/
      .test(f.prop),
  },
];

const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
/** Properties that actually paint (CSS kebab-case and JSX camelCase). */
const COLOUR_PROP = /^(color|background|background-?color|border[a-z-]*|outline[a-z-]*|box-?shadow|text-?shadow|fill|stroke|scrollbar-?color|caret-?color|accent-?color|-{2}[a-z0-9-]+)$/i;
const PAINT = /(^|[\s;{])(--[a-z0-9-]+|color|background|background-color|border[a-z-]*|fill|stroke|box-shadow|text-shadow|outline[a-z-]*|scrollbar-color|caret-color)\s*:/i;

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (/node_modules|\.git|build|dist/.test(e.name)) continue;
      walk(p);
    } else if (/\.(css|jsx|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
  }
})(ROOT);

const found = [];
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let sel = '';
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (/^[.#&:[a-zA-Z][^{]*\{/.test(line)) sel = line.split('{')[0].trim();
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) return;
    if (!PAINT.test(line)) return;
    // A literal used as a var() fallback is already tokenised.
    const stripped = line.replace(/var\([^)]*\)/g, '');
    const hits = stripped.match(COLOUR);
    if (!hits) return;
    // Attribute each literal to the property it is actually assigned to, by
    // scanning `prop: value` pairs rather than guessing from the whole line —
    // one declaration block can hold both a text colour and a border colour.
    for (const decl of stripped.split(';')) {
      const m = /(^|[\s{])([a-z-]+)\s*:\s*([^;]*)$/i.exec(decl);
      if (!m) continue;
      const prop = m[2].toLowerCase();
      // JSX style objects put many non-colour keys on one line; only keys that
      // actually paint can carry a contrast obligation.
      if (!COLOUR_PROP.test(prop)) continue;
      const vals = m[3].match(COLOUR);
      if (!vals) continue;
      for (const value of vals) {
        found.push({ file: rel, line: i + 1, value, prop, sel, lineText: line.slice(0, 160) });
      }
    }
  });
}

for (const f of found) {
  f.line_ = f.lineText;
  const cat = CATEGORIES.find(c => c.test({ ...f, line: f.lineText }));
  f.category = cat ? cat.id : 'UNJUSTIFIED';
}

const byCat = {};
for (const f of found) (byCat[f.category] ||= []).push(f);

const jsonAt = process.argv.indexOf('--json');
if (jsonAt > -1 && process.argv[jsonAt + 1]) {
  fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify({
    generatedFrom: 'frontend/src', total: found.length,
    categories: CATEGORIES.map(c => ({ id: c.id, why: c.why, count: (byCat[c.id] || []).length })),
    unjustified: byCat.UNJUSTIFIED || [],
  }, null, 2));
}

console.log(`Token-bypass exception whitelist — ${found.length} surviving literals\n`);
for (const c of CATEGORIES) {
  const n = (byCat[c.id] || []).length;
  console.log(`## ${c.id} — ${n}`);
  console.log(`   ${c.why.replace(/\s+/g, ' ')}\n`);
}
const un = byCat.UNJUSTIFIED || [];
console.log(`## NOT-YET-TOKENISED — ${un.length}`);
console.log('   `background` and `color` literals with no category above. These are'
  + '\n   NOT certified safe — they are simply not currently measured as failing.'
  + '\n   Most are dark-on-dark pairs that happen to agree, so no scanner flags'
  + '\n   them; they remain a latent risk if either side is changed in isolation.'
  + '\n   Tracked here so the number cannot be mistaken for zero.\n');
if (un.length) {
  const by = {};
  for (const f of un) (by[f.file] ||= []).push(f);
  Object.entries(by).sort((a, b) => b[1].length - a[1].length).slice(0, 15)
    .forEach(([file, rows]) => console.log(`   ${String(rows.length).padStart(4)}  ${file}`));
}

if (process.argv.includes('--check') && un.length) process.exit(1);
