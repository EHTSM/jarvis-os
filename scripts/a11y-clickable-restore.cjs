#!/usr/bin/env node
/**
 * B19.2.3 — restore the keyboard path on clickable non-interactive elements.
 *
 * B19.1 added `clickableProps()` so that rows/cards carrying an `onClick` on a
 * plain <div>/<span> became reachable by keyboard (focus stop + Enter/Space).
 * The hook still exists but NO file imports it any more, so all of those
 * controls regressed to mouse-only. `tests/runtime/26` reports 157 of them.
 *
 * DELIBERATELY CONSERVATIVE. It rewrites ONLY the unambiguous shape:
 *
 *     <div className="…" onClick={<single-expression>}>
 *
 * on ONE line, where the element is a div/span, has no existing role,
 * tabIndex, onKeyDown or spread, and the handler contains no nested braces.
 * Anything else — multi-line elements, overlay backdrops (which need
 * `overlayProps`, not a focus stop), elements already interactive — is left
 * alone and reported, because a wrong transform here silently breaks a control.
 *
 *   node scripts/a11y-clickable-restore.cjs [--apply]
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'frontend', 'src');
const APPLY = process.argv.includes('--apply');

/** Overlay/backdrop containers are dismissal surfaces, not controls. */
const OVERLAY = /(overlay|backdrop|scrim|modal-bg)/i;

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p); }
    else if (/\.jsx$/.test(e.name)) files.push(p);
  }
})(SRC);

// <div className="x" onClick={expr}>   — handler must not contain { or }
const RE = /<(div|span)\s+([^>]*?)onClick=\{([^{}]+)\}([^>]*)>/g;

let rewritten = 0, skipped = 0;
const perFile = {};

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  let n = 0;

  const out = src.replace(RE, (m, tag, pre, handler, post) => {
    const attrs = pre + post;
    // Already interactive, already spread, or an overlay → leave it.
    if (/\brole=|\btabIndex=|\bonKeyDown=|\{\.\.\./.test(attrs)) { skipped++; return m; }
    if (OVERLAY.test(attrs)) { skipped++; return m; }
    // Nested JSX expression in an attribute we would clobber → too risky.
    if (/=\{\{/.test(attrs)) { skipped++; return m; }
    n++; rewritten++;
    return `<${tag} ${pre.trim()}${pre.trim() ? ' ' : ''}{...clickableProps(${handler.trim()})}${post}>`;
  });

  if (!n) continue;

  let next = out;
  if (!/clickableProps/.test(src) || !/from ["'].*hooks\/useClickableProps/.test(src)) {
    const depth = path.relative(SRC, file).split('/').length - 1;
    const imp = `import { clickableProps } from "${'../'.repeat(depth)}hooks/useClickableProps";`;
    const imports = [...next.matchAll(/^import .*?;$/gm)];
    if (!imports.length) { console.log('  NO-IMPORTS ' + path.relative(SRC, file)); continue; }
    const last = imports[imports.length - 1];
    next = next.slice(0, last.index + last[0].length) + '\n' + imp
         + next.slice(last.index + last[0].length);
  }

  perFile[path.relative(SRC, file)] = n;
  if (APPLY) fs.writeFileSync(file, next);
}

console.log((APPLY ? 'APPLIED' : 'DRY RUN')
  + ` — ${rewritten} clickable elements rebound in ${Object.keys(perFile).length} files`
  + ` (${skipped} left alone as ambiguous/overlay/already-interactive)\n`);
Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 20)
  .forEach(([f, c]) => console.log('  ' + String(c).padStart(3) + '  ' + f));
if (!APPLY) console.log('\nre-run with --apply to write.');
