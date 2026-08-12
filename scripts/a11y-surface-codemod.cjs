#!/usr/bin/env node
/**
 * B19.2.2 pass 3 — dark SURFACE literals → surface tokens.
 *
 * Pass 2 migrated recessed text onto --text-dim/--text-faint. Where the panel
 * *behind* that text is still a hardcoded near-black, light mode now paints
 * dark text on a dark fill — the same inversion this phase exists to remove.
 * Both sides have to come from the same theme.
 *
 * Only `background`/`background-color` are rewritten. Semantic fills
 * (#10b981, #ef4444 …) are NOT in the map: they are handled by the semantic
 * codemod, and the deep tints (#450a0a, #052718 …) are intentional dark
 * callout washes that pass 4 evaluates separately.
 *
 *   node scripts/a11y-surface-codemod.cjs [--apply]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'frontend', 'src');
const APPLY = process.argv.includes('--apply');

/** Near-black panel greys → the elevation token they were standing in for. */
const MAP = {
  '#0a0e17': '--surface-base',
  '#0d1117': '--surface-base',
  '#0f172a': '--surface-base',
  '#111827': '--surface-base',
  '#111111': '--surface-base',
  '#111':    '--surface-base',
  '#18181b': '--surface-base',
  '#1e293b': '--surface-raised',
  '#1f2937': '--surface-raised',
  '#27272a': '--surface-raised',
  '#374151': '--surface-hover',
  '#3f3f46': '--surface-hover',
};

// Fixed-dark surfaces keep their own canvas in both themes.
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
  let out = src, n = 0;
  for (const [lit, token] of Object.entries(MAP)) {
    // `background:` / `background-color:` with the literal as the whole value.
    // The trailing (?![0-9a-f]) stops #111 matching inside #111827.
    const re = new RegExp(`(background(?:-color)?):\\s*${lit}(?![0-9a-fA-F])`, 'gi');
    out = out.replace(re, (_, prop) => { n++; total++; return `${prop}: var(${token})`; });
  }
  if (n) {
    perFile[path.relative(ROOT, f)] = n;
    if (APPLY) fs.writeFileSync(f, out);
  }
}

console.log((APPLY ? 'APPLIED' : 'DRY RUN') + ` — ${total} surface rewrites in ${Object.keys(perFile).length} files\n`);
Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 20)
  .forEach(([f, c]) => console.log('  ' + String(c).padStart(4) + '  ' + f));
if (!APPLY) console.log('\nre-run with --apply to write.');
