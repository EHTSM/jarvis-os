#!/usr/bin/env node
/**
 * B19.2.2 — chrome dimmed-foreground migration.
 *
 * `color: rgba(255,255,255,α)` is a *dimming* idiom, not a colour choice: it
 * means "the foreground, faded". It is only correct over a dark canvas, so in
 * light mode every one of these renders white-on-near-white.
 *
 * Rewrites the TEXT-colour form to `rgba(var(--fg-rgb), α')`, where α' is the
 * nearest step that clears 4.5:1 in BOTH themes. Background/border/shadow uses
 * of the same literal are left alone — they are surface tints, not text, and
 * carry no contrast obligation.
 *
 *   node scripts/a11y-chrome-fg-codemod.cjs [--apply]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'frontend', 'src');
const APPLY = process.argv.includes('--apply');

// Verified in both themes against --bg: dark(white fg) and light(#0a0e18 fg).
// dark: 16.92 / 12.09 / 8.74 / 7.77   light: 14.86 / 9.39 / 6.09 / 5.29
const STEPS = [0.92, 0.78, 0.66, 0.62];
const floor = a => {
  // Never dim below the weakest AA-safe step; otherwise snap to nearest step
  // that is >= the author's alpha, preserving the visual hierarchy.
  if (a >= 0.92) return 0.92;
  const up = STEPS.filter(s => s >= a);
  return up.length ? Math.min(...up) : 0.62;
};

/**
 * Surfaces that paint their OWN permanently-dark canvas in both themes
 * (marketing landing, full-screen overlays). White-alpha text is correct
 * there — converting it would invert the very bug this fixes.
 * Each is verified to set an opaque dark background of its own.
 */
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

// `color:` only — and not `background-color` / `border-color` / `caret-color`.
const RE = /(?<![-a-z])color:\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*(0?\.\d+|1(?:\.0+)?)\s*\)/gi;

let total = 0;
const perFile = {};
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let n = 0;
  const out = src.replace(RE, (m, a) => {
    n++; total++;
    return `color: rgba(var(--fg-rgb), ${floor(parseFloat(a))})`;
  });
  if (n) {
    perFile[path.relative(ROOT, f)] = n;
    if (APPLY) fs.writeFileSync(f, out);
  }
}

console.log((APPLY ? 'APPLIED' : 'DRY RUN') + ` — ${total} text-colour rewrites in ${Object.keys(perFile).length} files\n`);
Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 25)
  .forEach(([f, c]) => console.log('  ' + String(c).padStart(4) + '  ' + f));
if (!APPLY) console.log('\nre-run with --apply to write.');
