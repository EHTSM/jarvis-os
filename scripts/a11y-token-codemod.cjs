#!/usr/bin/env node
/**
 * B19.2.2 — Inline colour literal → design token codemod.
 *
 * Replaces JSX/CSS colour literals that are EXACT matches for a themed design
 * token with `var(--token)`. Exact-match only: a literal is rewritten solely
 * when it equals the dark-theme value of a token, which is precisely the class
 * of bug this phase targets (dark values frozen into theme-agnostic source).
 *
 * Deliberately conservative — it will not touch:
 *   • gradients (multi-stop paint is decorative)
 *   • chart/series palettes (data encoding, not UI chrome)
 *   • avatar palettes (per-identity generated fills)
 *   • anything already inside a var()
 *   • literals in comments
 *
 *   node scripts/a11y-token-codemod.cjs            # dry run, prints plan
 *   node scripts/a11y-token-codemod.cjs --apply    # write changes
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'frontend', 'src');
const APPLY = process.argv.includes('--apply');

/**
 * Dark-theme literal → token. These are read off index.css `:root`, so the
 * substitution is value-preserving in dark mode and theme-correcting in light.
 */
const MAP = {
  '#52d68a': '--success',
  '#f0b429': '--warning',
  '#f55b5b': '--danger',
  '#5dc8f5': '--info',
  '#7c6fff': '--accent',
  '#4ecdc4': '--accent2',
  '#dde2ec': '--text',
  '#8994b0': '--text-dim',
  '#7481a3': '--text-faint',
  // Tailwind-derived duplicates that mean the same semantic role.
  '#22c55e': '--success',
  '#10b981': '--success',
  '#f59e0b': '--warning',
  '#ef4444': '--danger',
  '#e6edf3': '--text',
  '#c8cdd8': '--text',
  '#64748b': '--text-dim',
  '#6b7280': '--text-dim',
  // Dim greys used as recessed TEXT are handled separately by
  // scripts/a11y-dimtext-codemod.cjs — they also appear as borders and
  // scrollbar thumbs, where they are decorative and must not be rewritten.
};

// Files that DEFINE the design language, or legitimately hold non-themeable
// colour. index.css/tokens.js are where these literals are the authored source
// of truth — rewriting a token to var(itself) makes it self-referential and
// collapses the whole theme. They must never be codemodded.
const SKIP_FILE =
  /^index\.css$|^tokens\.(js|ts)$|OoplixMark|Logo|Illustration|__snapshots__|\.test\./i;

// Lines whose colour is data-encoding or decorative rather than UI chrome.
const SKIP_LINE = /gradient|chart|recharts|series|<Cell|dataKey|sparkline|AVATAR|avatarPalette|palette\s*=|COLORS\s*=|shadow/i;

/**
 * A CSS custom-property DEFINITION (`--success: #52d68a;`) declares the value;
 * it is not a bypass of the token layer. Only *consumers* get rewritten.
 */
const IS_TOKEN_DEF = /^\s*--[a-z0-9-]+\s*:/i;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/node_modules|\.git|build|dist/.test(e.name)) continue;
      walk(p, out);
    } else if (/\.(jsx|tsx|css)$/.test(e.name) && !SKIP_FILE.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const plan = [];
for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  const isCss = file.endsWith('.css');
  const lines = src.split('\n');
  let changed = false;

  const next = lines.map((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return line;
    if (SKIP_LINE.test(line)) return line;
    if (IS_TOKEN_DEF.test(line)) return line;   // definition, not a bypass

    let out = line;
    for (const [lit, token] of Object.entries(MAP)) {
      // Match the literal only where it is a complete colour value, and not
      // already the fallback inside an existing var(--x, #lit) declaration.
      const re = new RegExp(`(?<!var\\([^)]{0,60})${lit}\\b`, 'gi');
      if (!re.test(out)) continue;
      re.lastIndex = 0;
      const replaced = out.replace(re, isCss ? `var(${token})` : `var(${token})`);
      if (replaced !== out) {
        out = replaced;
        plan.push({ file: path.relative(ROOT, file), line: i + 1, lit, token });
      }
    }
    if (out !== line) changed = true;
    return out;
  });

  if (changed && APPLY) fs.writeFileSync(file, next.join('\n'));
}

const byToken = {};
const byFile = {};
for (const p of plan) {
  byToken[p.token] = (byToken[p.token] || 0) + 1;
  byFile[p.file] = (byFile[p.file] || 0) + 1;
}

console.log((APPLY ? 'APPLIED' : 'DRY RUN') + ' — ' + plan.length + ' replacements in '
  + Object.keys(byFile).length + ' files\n');
console.log('by token:');
for (const [k, v] of Object.entries(byToken).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + k.padEnd(14), v);
}
console.log('\ntop files:');
Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 20)
  .forEach(([f, c]) => console.log('  ' + String(c).padStart(4) + '  ' + f));
if (!APPLY) console.log('\nre-run with --apply to write.');
