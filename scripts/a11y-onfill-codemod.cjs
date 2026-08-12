#!/usr/bin/env node
/**
 * B19.2.2 pass 4 — white text on a brand/semantic FILL → var(--on-*).
 *
 * `background: var(--accent); color: #fff` measures 3.77:1 — the brand fills
 * are light enough that white fails AA on them in dark mode, and in light mode
 * the fills darken so white becomes correct. That is exactly what the --on-*
 * tokens encode, and they already flip per theme.
 *
 * Only rewrites a `color: #fff` that shares a rule with a `background` set to
 * the matching token, so a white label over some other fill is left alone.
 *
 *   node scripts/a11y-onfill-codemod.cjs [--apply]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'frontend', 'src');
const APPLY = process.argv.includes('--apply');

const PAIRS = [
  ['--accent',  '--on-accent'],
  ['--accent2', '--on-accent2'],
  ['--success', '--on-success'],
  ['--danger',  '--on-danger'],
  ['--warning', '--on-warning'],
  ['--info',    '--on-info'],
];

const WHITE = /^#(fff|ffffff)$/i;
const FIXED_DARK = /LandingPage\.css$|ShortcutsOverlay\.css$|PublicLaunch\.css$/;

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (/node_modules|\.git|build|dist/.test(e.name)) continue;
      walk(p);
    } else if (/\.css$/.test(e.name) && !FIXED_DARK.test(p)) files.push(p);
  }
})(ROOT);

let total = 0;
const perFile = {};
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let n = 0;
  // Walk rule blocks so background and colour are matched within one rule.
  const out = src.replace(/\{[^{}]*\}/g, block => {
    const bg = /background(?:-color)?:\s*var\((--[a-z0-9-]+)/i.exec(block);
    if (!bg) return block;
    const pair = PAIRS.find(([fill]) => fill === bg[1].toLowerCase());
    if (!pair) return block;
    return block.replace(/(^|[;{\s])color:\s*(#[0-9a-fA-F]{3,6})\s*(?=[;}])/g,
      (m, lead, lit) => {
        if (!WHITE.test(lit)) return m;
        n++; total++;
        return `${lead}color: var(${pair[1]})`;
      });
  });
  if (n) {
    perFile[path.relative(ROOT, f)] = n;
    if (APPLY) fs.writeFileSync(f, out);
  }
}

console.log((APPLY ? 'APPLIED' : 'DRY RUN') + ` — ${total} on-fill rewrites in ${Object.keys(perFile).length} files\n`);
Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 20)
  .forEach(([f, c]) => console.log('  ' + String(c).padStart(4) + '  ' + f));
if (!APPLY) console.log('\nre-run with --apply to write.');
