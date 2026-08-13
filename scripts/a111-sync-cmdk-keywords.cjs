#!/usr/bin/env node
/**
 * A.11.1 — close the MORE_TABS → NAV_ACTIONS keyword drift.
 *
 * `tests/security/89` asserts a two-registry contract: every alias word that
 * makes a destination findable in the More menu must ALSO be a Command Palette
 * keyword for the same destination. Otherwise the same product vocabulary works
 * in one search box and fails in the other.
 *
 * Measured: all 82 More destinations DO have a ⌘K entry, but 68 of them are
 * missing alias words from their ⌘K keywords. The test is not stale — the
 * source violates a real contract.
 *
 * This is a RECOVERY, not a redesign: it copies words that already exist in
 * App.jsx's MORE_TABS into the matching NAV_ACTIONS `keywords` field. No new
 * vocabulary is invented, no UI changes, no new mechanism.
 *
 *   node scripts/a111-sync-cmdk-keywords.cjs [--apply]
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'frontend', 'src');
const APPLY = process.argv.includes('--apply');
const APP = path.join(SRC, 'App.jsx');
const CP = path.join(SRC, 'components', 'CommandPalette.jsx');

const app = fs.readFileSync(APP, 'utf8');
let cp = fs.readFileSync(CP, 'utf8');

const block = (s, marker) => {
  const i = s.indexOf(marker);
  if (i < 0) throw new Error(`marker not found: ${marker}`);
  return s.slice(i, s.indexOf('\n];', i));
};
const parse = (b) => {
  const out = [];
  for (const m of b.matchAll(/\{[^{}]*\}/g)) {
    const g = k => { const r = new RegExp(`${k}:\\s*"([^"]*)"`).exec(m[0]); return r ? r[1] : ''; };
    if (g('id')) out.push({ raw: m[0], id: g('id'), alias: g('alias'), keywords: g('keywords'), tab: g('tab'), label: g('label') });
  }
  return out;
};

const more = parse(block(app, 'const MORE_TABS ='));
const navBlock = block(cp, 'const NAV_ACTIONS =');
const nav = parse(navBlock);
const byTab = new Map(nav.filter(n => n.tab).map(n => [n.tab, n]));

let changed = 0;
const report = [];

for (const m of more) {
  if (!m.alias) continue;
  const n = byTab.get(m.id);
  if (!n) continue;                              // covered by the other assertion
  const hay = ((n.keywords || '') + ' ' + (n.label || '')).toLowerCase();
  const missing = [...new Set(m.alias.toLowerCase().split(/\s+/).filter(w => w && !hay.includes(w)))];
  if (!missing.length) continue;

  const merged = ((n.keywords || '') + ' ' + missing.join(' ')).trim().replace(/\s+/g, ' ');
  let next;
  if (/keywords:\s*"/.test(n.raw)) {
    next = n.raw.replace(/keywords:\s*"[^"]*"/, `keywords: "${merged}"`);
  } else {
    // Insert a keywords field next to the existing tab field, matching the
    // formatting the file already uses.
    next = n.raw.replace(/(tab:\s*"[^"]*")/, `$1, keywords: "${merged}"`);
  }
  if (next === n.raw) continue;
  cp = cp.replace(n.raw, next);
  changed++;
  report.push(`${m.id}: +${missing.length} (${missing.slice(0, 6).join(' ')}${missing.length > 6 ? ' …' : ''})`);
}

if (APPLY) fs.writeFileSync(CP, cp);

console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} — ${changed} Command Palette entries gained the More-menu vocabulary they were missing\n`);
report.slice(0, 20).forEach(r => console.log('  ' + r));
if (report.length > 20) console.log(`  … and ${report.length - 20} more`);
if (!APPLY) console.log('\nre-run with --apply to write.');
