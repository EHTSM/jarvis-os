#!/usr/bin/env node
/**
 * B19.2.2 pass 8 — private component palettes → aliases onto the real tokens.
 *
 * Several surfaces define their own `--xx-bg / --xx-surface / --xx-text /
 * --xx-muted / --xx-accent …` block pinned to dark literals. The component then
 * uses those names everywhere, so the whole surface ignores the theme: in light
 * mode it keeps a near-black canvas while global text tokens turn dark.
 *
 * Rewrites only the DEFINITION block, mapping each private name onto the
 * canonical token it was standing in for. Call sites are untouched — they keep
 * using `var(--xx-…)` and become theme-aware for free.
 *
 *   node scripts/a11y-palette-alias-codemod.cjs [--apply]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'frontend', 'src');
const APPLY = process.argv.includes('--apply');

/** Private suffix → canonical token, by ROLE not by value. */
const ROLE = {
  bg: '--bg',
  surface: '--surface',
  card: '--surface-base',
  panel: '--surface-base',
  border: '--border',
  text: '--text',
  muted: '--text-dim',
  dim: '--text-faint',
  faint: '--text-faint',
  accent: '--accent',
  green: '--success',
  red: '--danger',
  yellow: '--warning',
  orange: '--warning',
  blue: '--info',
  cyan: '--info',
  teal: '--accent2',
  purple: '--accent',
};

const FIXED_DARK = /LandingPage\.css$|ShortcutsOverlay\.css$|PublicLaunch\.css$/;

/**
 * The design-system source of truth. Its :root block DEFINES the canonical
 * tokens, so rewriting them here produces `--text-dim: var(--text-dim)` and
 * collapses the entire theme. Never codemod it.
 */
const TOKEN_SOURCE = /(^|[\\/])(index\.css|tokens\.(js|ts))$/;

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (/node_modules|\.git|build|dist/.test(e.name)) continue;
      walk(p);
    } else if (/\.css$/.test(e.name) && !FIXED_DARK.test(p) && !TOKEN_SOURCE.test(p)) {
      files.push(p);
    }
  }
})(ROOT);

let total = 0;
const perFile = {};
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let n = 0;

  // Only rewrite inside a :root { … } block, i.e. actual definitions.
  const out = src.replace(/:root\s*\{([^}]*)\}/g, (whole, body) => {
    const nextBody = body.replace(
      /(\s*)(--([a-z0-9]+)-([a-z0-9]+))\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g,
      (decl, ws, name, prefix, suffix, lit) => {
        const token = ROLE[suffix.toLowerCase()];
        if (!token) return decl;
        // Defence in depth: never rewrite a canonical token to itself, and
        // never touch the reserved `--on-*` on-fill family.
        if (name.toLowerCase() === token || prefix.toLowerCase() === 'on') return decl;
        n++; total++;
        return `${ws}${name}: var(${token});`;
      },
    );
    return `:root {${nextBody}}`;
  });

  if (n) {
    perFile[path.relative(ROOT, f)] = n;
    if (APPLY) fs.writeFileSync(f, out);
  }
}

console.log((APPLY ? 'APPLIED' : 'DRY RUN') + ` — ${total} palette aliases in ${Object.keys(perFile).length} files\n`);
Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 25)
  .forEach(([f, c]) => console.log('  ' + String(c).padStart(4) + '  ' + f));
if (!APPLY) console.log('\nre-run with --apply to write.');
