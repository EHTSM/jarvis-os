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

/**
 * A label pinned to either extreme is wrong on a themed fill: the fill flips
 * between a bright (dark-theme) and a darkened (light-theme) variant, so only
 * `--on-*` tracks it. Near-black values are the same bug as white.
 */
const PINNED_LABEL = /^#(fff|ffffff|000|000000|0a0c14|06080e|06100a|120d02|05100f|04121a|0f0f13)$/i;
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

  /**
   * Local alias map for this file: `--do-accent: var(--accent)` means a fill of
   * --do-accent is really --accent, so its label needs --on-accent. Also
   * resolves aliases still written as the brand literal.
   */
  const LITERAL_ROLE = {
    '#7c6fff': '--accent',  '#7c6af7': '--accent',  '#6152ff': '--accent',
    '#4ecdc4': '--accent2', '#22c55e': '--success', '#52d68a': '--success',
    '#059669': '--success', '#10b981': '--success', '#ef4444': '--danger',
    '#f55b5b': '--danger',  '#f59e0b': '--warning', '#f0b429': '--warning',
    '#5dc8f5': '--info',    '#44a2ff': '--info',    '#3b82f6': '--info',
  };
  const aliases = {};
  for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:\s*var\((--[a-z0-9-]+)\)/gi)) {
    aliases[m[1].toLowerCase()] = m[2].toLowerCase();
  }
  for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/gi)) {
    const role = LITERAL_ROLE[m[2].toLowerCase()];
    if (role) aliases[m[1].toLowerCase()] = role;
  }
  // Walk rule blocks so background and colour are matched within one rule.
  /** Brand/semantic fills still written as literals resolve to the same role. */
  const LITERAL_FILL = {
    '#7c6fff': '--accent',  '#7c6af7': '--accent',  '#6152ff': '--accent',
    '#4ecdc4': '--accent2', '#22c55e': '--success', '#52d68a': '--success',
    '#059669': '--success', '#10b981': '--success', '#ef4444': '--danger',
    '#f55b5b': '--danger',  '#f59e0b': '--warning', '#f0b429': '--warning',
    '#5dc8f5': '--info',    '#44a2ff': '--info',    '#3b82f6': '--info',
  };

  const out = src.replace(/\{[^{}]*\}/g, block => {
    let role = null;
    const bgVar = /background(?:-color)?:\s*var\((--[a-z0-9-]+)/i.exec(block);
    // Component-local fill tokens (--do-accent, --cseo-accent …) alias onto a
    // canonical role; resolve through the alias so their labels are covered too.
    if (bgVar) role = aliases[bgVar[1].toLowerCase()] || bgVar[1].toLowerCase();
    if (!role) {
      const bgLit = /background(?:-color)?:\s*(#[0-9a-fA-F]{6})\b/i.exec(block);
      if (bgLit) role = LITERAL_FILL[bgLit[1].toLowerCase()] || null;
    }
    if (!role) return block;
    const pair = PAIRS.find(([fill]) => fill === role);
    if (!pair) return block;
    let next = block.replace(/(^|[;{\s])color:\s*(#[0-9a-fA-F]{3,6})\s*(?=[;}])/g,
      (m, lead, lit) => {
        if (!PINNED_LABEL.test(lit)) return m;
        n++; total++;
        return `${lead}color: var(${pair[1]})`;
      });
    // If the label was rewritten, the fill must theme with it — otherwise the
    // pair splits again in the other theme.
    if (next !== block && !bgVar) {
      next = next.replace(/(background(?:-color)?):\s*#[0-9a-fA-F]{6}\b/i,
        (_, prop) => `${prop}: var(${role})`);
    }
    return next;
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
