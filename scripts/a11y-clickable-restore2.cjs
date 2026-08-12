#!/usr/bin/env node
/**
 * B19.3 — second pass over the clickable elements B19.2.3 left alone.
 *
 * RECOVERY. Both helpers already ship in `hooks/useClickableProps.js`:
 *
 *   clickableProps(onClick)  — focus stop + Enter/Space, for real controls
 *   overlayProps(onDismiss)  — click-outside dismissal, aria-hidden, and
 *                              deliberately NO focus stop, because an overlay
 *                              is not a control (its keyboard equivalent is
 *                              Escape, bound by useEscapeKey)
 *
 * B19.2.3's pass handled only single-statement handlers and skipped 71 sites.
 * This pass covers the two remaining shapes, each with the helper the hook file
 * already prescribes for it:
 *
 *   • overlay/backdrop containers → overlayProps
 *   • rows/cards whose handler contains braces or multiple statements
 *     → clickableProps
 *
 *   node scripts/a11y-clickable-restore2.cjs [--apply]
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'frontend', 'src');
const APPLY = process.argv.includes('--apply');

const OVERLAY = /(overlay|backdrop|scrim)/i;

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p); }
    else if (/\.jsx$/.test(e.name)) files.push(p);
  }
})(SRC);

/** Balanced-brace scan for the handler expression after `onClick={`. */
function readHandler(src, at) {
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { expr: src.slice(at + 1, i), end: i + 1 }; }
  }
  return null;
}

let nClick = 0, nOverlay = 0, skipped = 0;
const perFile = {};

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  let out = '', cursor = 0, n = 0;
  const tagRe = /<(div|span)\s/g;
  let m;

  while ((m = tagRe.exec(src))) {
    const tagStart = m.index;
    const gt = src.indexOf('>', tagStart);
    if (gt === -1) continue;
    const tag = src.slice(tagStart, gt + 1);

    // Only single-element openings without nested JSX children in attributes.
    if (!/onClick=\{/.test(tag)) continue;
    if (/\brole=|\btabIndex=|\bonKeyDown=|\{\.\.\./.test(tag)) { skipped++; continue; }

    const ocAt = src.indexOf('onClick={', tagStart);
    if (ocAt === -1 || ocAt > gt) {
      // Handler spans past the naive '>' (braces contain a '>'), re-read it.
      const oc2 = src.indexOf('onClick={', tagStart);
      if (oc2 === -1) { skipped++; continue; }
    }
    const h = readHandler(src, src.indexOf('{', src.indexOf('onClick=', tagStart)));
    if (!h) { skipped++; continue; }

    // Re-derive the true end of the opening tag, after the handler.
    const tagEnd = src.indexOf('>', h.end);
    if (tagEnd === -1) { skipped++; continue; }
    const fullTag = src.slice(tagStart, tagEnd + 1);
    // `style={{…}}` is safe: only the onClick attribute is replaced, and the
    // balanced-brace reader already located its exact bounds. What must still be
    // skipped is an element that is already interactive or already spreads props.
    if (/\brole=|\btabIndex=|\bonKeyDown=|\{\.\.\./.test(fullTag)) { skipped++; continue; }

    // B19.3: overlays are NOT converted. `overlayProps` sets aria-hidden on the
    // element it is spread onto, and its doc-comment assumes the dialog is a
    // SIBLING ("the dialog above it carries the accessible content"). In this
    // codebase every modal nests the panel INSIDE the overlay, so spreading it
    // here would hide the dialog — including the role="dialog" semantics — from
    // assistive tech. Recorded as a finding instead of propagated.
    if (OVERLAY.test(fullTag)) { skipped++; continue; }
    const helper = 'clickableProps';
    const ocStart = src.indexOf('onClick=', tagStart);
    const replaced = src.slice(tagStart, ocStart)
      + `{...${helper}(${h.expr.trim()})}`
      + src.slice(h.end, tagEnd + 1);

    out += src.slice(cursor, tagStart) + replaced;
    cursor = tagEnd + 1;
    tagRe.lastIndex = tagEnd + 1;
    n++;
    nClick++;
  }
  if (!n) continue;
  out += src.slice(cursor);

  // Import whichever helpers this file now uses.
  const need = [];
  if (/clickableProps\(/.test(out) && !/import[^;]*clickableProps/.test(out)) need.push('clickableProps');
  if (/overlayProps\(/.test(out)   && !/import[^;]*overlayProps/.test(out))   need.push('overlayProps');
  if (need.length) {
    const depth = path.relative(SRC, file).split('/').length - 1;
    const prefix = depth === 0 ? './' : '../'.repeat(depth);
    const imports = [...out.matchAll(/^import .*?;$/gm)];
    if (!imports.length) { console.log('  NO-IMPORTS ' + path.relative(SRC, file)); continue; }
    const last = imports[imports.length - 1];
    out = out.slice(0, last.index + last[0].length)
        + `\nimport { ${need.join(', ')} } from "${prefix}hooks/useClickableProps";`
        + out.slice(last.index + last[0].length);
  }

  perFile[path.relative(SRC, file)] = n;
  if (APPLY) fs.writeFileSync(file, out);
}

console.log((APPLY ? 'APPLIED' : 'DRY RUN')
  + ` — ${nClick} controls → clickableProps, ${nOverlay} overlays → overlayProps`
  + ` in ${Object.keys(perFile).length} files (${skipped} left alone)\n`);
Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 20)
  .forEach(([f, c]) => console.log('  ' + String(c).padStart(3) + '  ' + f));
if (!APPLY) console.log('\nre-run with --apply to write.');
