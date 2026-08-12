#!/usr/bin/env node
/**
 * B19.2.2 pass 2 — dim-grey TEXT literals → --text-faint / --text-dim.
 *
 * The greys below are used two ways: as recessed *text* (where they measure
 * 1.02–1.85:1 and fail AA) and as borders/scrollbar thumbs (decorative, no
 * contrast obligation). This pass rewrites the `color:` form ONLY, so the
 * decorative uses are left exactly as they are.
 *
 *   node scripts/a11y-dimtext-codemod.cjs [--apply]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'frontend', 'src');
const APPLY = process.argv.includes('--apply');

const MAP = {
  '#1e2333': '--text-faint',
  '#1f2937': '--text-faint',
  '#2a3050': '--text-faint',
  '#374151': '--text-faint',
  '#4a5470': '--text-faint',
  '#4b5563': '--text-faint',
  '#9ca3af': '--text-dim',
  '#d1d5db': '--text',
  '#6b7280': '--text-dim',
  '#64748b': '--text-dim',
  // Pass 3: the remaining recessed-text greys surfaced once the panels behind
  // them were tokenised. Same role, same treatment.
  '#666666': '--text-faint',
  '#666':    '--text-faint',
  '#555555': '--text-faint',
  '#555':    '--text-faint',
  '#777777': '--text-faint',
  '#777':    '--text-faint',
  '#888888': '--text-dim',
  '#888':    '--text-dim',
  '#475569': '--text-faint',
  '#4a526a': '--text-faint',
  '#3a4258': '--text-faint',
  '#5a5a72': '--text-faint',
  '#5c6e88': '--text-faint',
  '#52525b': '--text-faint',
  '#71717a': '--text-dim',
  '#a1a1aa': '--text-dim',
  '#cccccc': '--text',
  '#ccc':    '--text',
};

// Fixed-dark surfaces: their own canvas never themes, so a dim grey there is
// a deliberate choice against a known backdrop, not a theme bug.
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
    // `color:` but not `background-color:` / `border-color:` / `scrollbar-color:`
    // The trailing guard stops a 3-digit literal matching inside a 6-digit one
    // (`#555` must not fire on `#5551ff`).
    const re = new RegExp(`(?<![-a-z])color:\\s*${lit}(?![0-9a-fA-F])`, 'gi');
    out = out.replace(re, () => { n++; total++; return `color: var(${token})`; });
  }
  if (n) {
    perFile[path.relative(ROOT, f)] = n;
    if (APPLY) fs.writeFileSync(f, out);
  }
}

console.log((APPLY ? 'APPLIED' : 'DRY RUN') + ` — ${total} text-colour rewrites in ${Object.keys(perFile).length} files\n`);
Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 20)
  .forEach(([f, c]) => console.log('  ' + String(c).padStart(4) + '  ' + f));
if (!APPLY) console.log('\nre-run with --apply to write.');
