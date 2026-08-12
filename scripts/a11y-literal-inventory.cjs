#!/usr/bin/env node
/**
 * B19.2.2 — Inline colour literal inventory.
 *
 * Walks every JSX/TSX source file, extracts each colour literal that is applied
 * to a *rendered* colour property, groups by value, and classifies each group
 * into the taxonomy the phase requires.
 *
 * Classification is derived from how the literal is used in source — never from
 * a hardcoded value list — so the output stays honest as the codebase changes.
 *
 *   node scripts/a11y-literal-inventory.cjs [--json out.json]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'frontend', 'src');

// Properties whose value actually paints. `borderColor`/`fill`/`stroke` paint
// non-text pixels; `color` paints text. Keeping them distinct matters because
// only text carries a WCAG 1.4.3 contrast obligation.
const TEXT_PROPS = new Set(['color']);
const PAINT_PROPS = new Set([
  'background', 'backgroundColor', 'borderColor', 'border', 'borderTop',
  'borderBottom', 'borderLeft', 'borderRight', 'fill', 'stroke', 'boxShadow',
  'outline', 'outlineColor', 'textShadow', 'caretColor', 'accentColor',
]);

const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/node_modules|__tests__|\.git/.test(e.name)) continue;
      walk(p, out);
    } else if (/\.(jsx|tsx|js|ts)$/.test(e.name) && !/\.test\./.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/** Normalise so `#FFF`, `#ffffff`, `#FFFFFFFF` and `rgb(255,255,255)` group. */
function norm(raw) {
  const s = raw.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length === 4) h = h.slice(0, 3).split('').map(c => c + c).join('') + h[3] + h[3];
    if (h.length === 6) return '#' + h;
    if (h.length === 8) {
      const a = Math.round((parseInt(h.slice(6), 16) / 255) * 100) / 100;
      return a === 1 ? '#' + h.slice(0, 6) : `#${h.slice(0, 6)}@${a}`;
    }
    return '#' + h;
  }
  m = s.match(/^rgba?\(([^)]*)\)$/);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length >= 3 && p.every(n => !Number.isNaN(n))) {
      const hex = '#' + p.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, '0')).join('');
      const a = p.length >= 4 ? Math.round(p[3] * 100) / 100 : 1;
      return a === 1 ? hex : `${hex}@${a}`;
    }
  }
  return s;
}

function relLum(hex) {
  const h = hex.replace(/@.*$/, '').slice(1);
  if (h.length !== 6) return null;
  const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * Classify an occurrence from its surrounding source context.
 * Order matters: the most specific evidence wins.
 */
function classify(occ) {
  const ctx = (occ.line + ' ' + occ.file).toLowerCase();

  // Charts: recharts/svg data series, palette arrays feeding a chart.
  if (/chart|recharts|<cell|dataKey|series|sparkline|donut|<Pie|<Bar|<Area|<Line/i.test(occ.line)
      || /chart|graph/.test(path.basename(occ.file).toLowerCase())) return 'charts';

  // Avatars: per-identity generated fills.
  if (/avatar|initials|palette\[|colou?rFor|hashColor/i.test(ctx)) return 'avatars';

  // Gradients: multi-stop paint, decorative by construction.
  if (/gradient|linear-gradient|radial-gradient|conic-gradient/i.test(occ.line)) return 'gradients';

  // Status: value is chosen by a state/condition expression.
  if (/status|state|severity|health|risk|priority|\?\s*["'`]?#|success|error|warn|danger|fail|pass|active|inactive|online|offline|critical|degraded/i
      .test(occ.line)) return 'status';

  // Semantic: plain text/surface colour with no conditional — the migration target.
  if (TEXT_PROPS.has(occ.prop)) return 'semantic';

  // Decorative paint that is not text: borders, shadows, glyph fills.
  if (/boxshadow|textshadow|outline|border/i.test(occ.prop)) return 'decorative';

  return 'semantic';
}

const files = walk(ROOT);
const occurrences = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    // Skip comments and imported//generated asset URLs.
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;

    let m;
    COLOUR.lastIndex = 0;
    while ((m = COLOUR.exec(line))) {
      const raw = m[0];
      // Determine the property this literal is assigned to, looking left.
      const before = line.slice(0, m.index);
      const pm = before.match(/([A-Za-z-]+)\s*[:=]\s*[^:=]*$/);
      const prop = pm ? pm[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : '(unbound)';
      const isPaint = TEXT_PROPS.has(prop) || PAINT_PROPS.has(prop);
      occurrences.push({
        file: path.relative(ROOT, file), lineNo: i + 1, raw, value: norm(raw),
        prop, isPaint, line: t.slice(0, 200),
      });
    }
  });
}

const painted = occurrences.filter(o => o.isPaint);
for (const o of painted) o.klass = classify(o);

// Group by normalised value.
const groups = new Map();
for (const o of painted) {
  if (!groups.has(o.value)) groups.set(o.value, []);
  groups.get(o.value).push(o);
}

const byClass = {};
for (const o of painted) byClass[o.klass] = (byClass[o.klass] || 0) + 1;

const report = {
  totals: {
    filesScanned: files.length,
    allColourTokensFound: occurrences.length,
    paintedColourLiterals: painted.length,
    unboundOrNonPaint: occurrences.length - painted.length,
    distinctValues: groups.size,
    filesWithPaintedLiterals: new Set(painted.map(o => o.file)).size,
  },
  byClass,
  groups: [...groups.entries()]
    .map(([value, occs]) => ({
      value, count: occs.length,
      luminance: relLum(value),
      classes: [...new Set(occs.map(o => o.klass))],
      textUses: occs.filter(o => TEXT_PROPS.has(o.prop)).length,
      files: [...new Set(occs.map(o => o.file))].slice(0, 12),
      occurrences: occs.map(o => ({ file: o.file, lineNo: o.lineNo, prop: o.prop, klass: o.klass })),
    }))
    .sort((a, b) => b.count - a.count),
};

const jsonAt = process.argv.indexOf('--json');
if (jsonAt > -1 && process.argv[jsonAt + 1]) {
  fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify(report, null, 2));
}

console.log('files scanned            ', report.totals.filesScanned);
console.log('painted colour literals  ', report.totals.paintedColourLiterals);
console.log('  (non-paint / unbound)  ', report.totals.unboundOrNonPaint);
console.log('distinct values          ', report.totals.distinctValues);
console.log('files carrying literals  ', report.totals.filesWithPaintedLiterals);
console.log('\nby class:');
for (const [k, v] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + k.padEnd(12), v);
}
console.log('\ntop 25 repeated values:');
report.groups.slice(0, 25).forEach(g =>
  console.log('  ' + g.value.padEnd(14) + String(g.count).padStart(4) + '  text:' + String(g.textUses).padStart(3)
    + '  [' + g.classes.join(',') + ']  ' + g.files.slice(0, 3).join(' ')));
