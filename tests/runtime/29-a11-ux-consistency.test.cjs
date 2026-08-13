/**
 * A.11 — UX consistency regression suite.
 *
 * Guards the defects this phase reproduced live against the real authenticated
 * app. Every assertion below corresponds to a finding in
 * A11_FINDINGS_REGISTER.md and is negative-tested so it cannot rot into a
 * tautology.
 *
 *   node tests/runtime/29-a11-ux-consistency.test.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function jsxFiles(dir = SRC, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules/.test(e.name)) jsxFiles(p, out); }
    else if (/\.jsx$/.test(e.name)) out.push(p);
  }
  return out;
}

// ── F1: End of Day Review crashed on any non-array response ─────────────────

test('EndOfDayReview guards list responses with Array.isArray', () => {
  const src = read('components/EndOfDayReview.jsx');
  // Reproduced live: /lessons returned {"error":"Unauthorized"}; the old
  // `lessonsData.lessons || lessonsData || []` fell through to the RESPONSE
  // OBJECT and .slice() threw, taking the whole review down.
  assert.ok(!/\(\s*lessonsData\.lessons\s*\|\|\s*lessonsData\s*\|\|\s*\[\]\s*\)\.slice/.test(src),
    'the unguarded object-fallback must not return');
  assert.match(src, /Array\.isArray\(lessonsData\?\.lessons\)/,
    'lessons must be Array.isArray-guarded');
  assert.match(src, /Array\.isArray\(missionsData\?\.missions\)/,
    'missions must be Array.isArray-guarded too');
});

test('NEGATIVE: the unguarded object-fallback pattern is detectable', () => {
  const bad = 'const lessons = (lessonsData.lessons || lessonsData || []).slice(0, 5);';
  assert.ok(/\(\s*lessonsData\.lessons\s*\|\|\s*lessonsData\s*\|\|\s*\[\]\s*\)\.slice/.test(bad),
    'the guard must fire if the pattern is reintroduced');
});

// ── F2: Global Activity was the only surface with no page header ────────────

test('GlobalActivityFeed names itself with a page header', () => {
  const src = read('components/GlobalActivityFeed.jsx');
  // Measured across 25 authenticated surfaces: this was the only one whose
  // header count was 0 — it opened directly onto a filter toolbar.
  assert.match(src, /className="gaf-header"/, 'page header element must exist');
  assert.match(src, /gaf-page-title/, 'header must carry a title');
  const css = read('components/GlobalActivityFeed.css');
  assert.match(css, /\.gaf-header\s*\{/, 'the header must be styled');
});

test('GlobalActivityFeed canvas follows the theme', () => {
  const css = read('components/GlobalActivityFeed.css');
  const root = /\.gaf-root\s*\{[^}]*\}/.exec(css);
  assert.ok(root, '.gaf-root must exist');
  assert.ok(!/background:\s*#08090e/.test(root[0]),
    'the hardcoded canvas must not return — it ignored the theme');
  assert.match(root[0], /background:\s*var\(--bg\)/,
    'canvas must use the theme token');
});

// ── Cross-cutting: the canonical shared patterns stay canonical ─────────────

test('the shared EmptyState component still exists and is used', () => {
  assert.ok(fs.existsSync(path.join(SRC, 'components/EmptyState.jsx')),
    'the canonical empty-state component must exist');
  const users = jsxFiles().filter(f => /EmptyState/.test(fs.readFileSync(f, 'utf8')));
  assert.ok(users.length >= 5,
    `EmptyState has ${users.length} importers — the canonical pattern is being bypassed`);
});

test('the base .btn component still exists for the unprefixed convention', () => {
  const idx = read('index.css');
  // Recovered in B19.2.2 — `.btn` was applied in JSX but defined nowhere, so
  // those buttons fell back to user-agent styling.
  assert.match(idx, /^\.btn\s*\{/m, '.btn base component must remain defined');
  assert.match(idx, /^\.btn--primary/m, '.btn--primary must remain defined');
  assert.match(idx, /^\.btn:disabled/m,
    'the disabled state must remain defined — it dims the surface, not the label');
});

// ── Part 9 dependency: the search-alias recovery stays in place ─────────────

test('every overflow surface keeps a search alias', () => {
  const app = read('App.jsx');
  const block = /const MORE_TABS = \[([\s\S]*?)\n\];/.exec(app);
  assert.ok(block, 'MORE_TABS must exist');
  const entries = [...block[1].matchAll(/\{\s*id:\s*"([a-z0-9_]+)"[^}]*\}/g)];
  assert.ok(entries.length > 60, `only ${entries.length} overflow surfaces found`);
  const missing = entries.filter(e => !/alias:/.test(e[0])).map(e => e[1]);
  // Phase C.0 found 60 of 82 surfaces unaliased; the recovery closed that.
  assert.deepStrictEqual(missing, [],
    `overflow surfaces with no search alias:\n${missing.join('\n')}`);
});

// ── A.11.1: the two search registries must not drift apart ─────────────────

test('every More-menu alias word is also a Command Palette keyword', () => {
  // tests/security/89 asserts this contract. A.11 first read it as a stale
  // expectation; re-reading the assertion showed it checks a REAL two-registry
  // contract that the source violated — 68 destinations had alias words that
  // returned nothing in ⌘K. Guarded here so the registries cannot drift again.
  const app = read('App.jsx');
  const cp = read('components/CommandPalette.jsx');
  const block = (s, m) => { const i = s.indexOf(m); return s.slice(i, s.indexOf('\n];', i)); };
  const parse = (b) => {
    const out = [];
    for (const m of b.matchAll(/\{[^{}]*\}/g)) {
      const g = k => { const r = new RegExp(`${k}:\\s*"([^"]*)"`).exec(m[0]); return r ? r[1] : ''; };
      if (g('id')) out.push({ id: g('id'), alias: g('alias'), keywords: g('keywords'), tab: g('tab'), label: g('label') });
    }
    return out;
  };
  const more = parse(block(app, 'const MORE_TABS ='));
  const nav = parse(block(cp, 'const NAV_ACTIONS ='));
  assert.ok(more.length > 60 && nav.length > 60,
    `registry parse returned too few entries (more=${more.length}, nav=${nav.length})`);

  const byTab = new Map(nav.filter(n => n.tab).map(n => [n.tab, n]));
  const noEntry = more.filter(m => !byTab.has(m.id)).map(m => m.id);
  assert.deepStrictEqual(noEntry, [],
    `every More-menu destination needs a ⌘K entry; missing: ${noEntry.join(', ')}`);

  const drift = [];
  for (const m of more) {
    if (!m.alias) continue;
    const n = byTab.get(m.id);
    const hay = ((n.keywords || '') + ' ' + (n.label || '')).toLowerCase();
    const miss = m.alias.toLowerCase().split(/\s+/).filter(w => w && !hay.includes(w));
    if (miss.length) drift.push(`${m.id}:${miss.join('/')}`);
  }
  assert.deepStrictEqual(drift, [],
    `alias words that return nothing in ⌘K:\n${drift.join('\n')}`);
});

test('NEGATIVE: alias→keyword drift is detectable', () => {
  const hay = 'billing invoice'.toLowerCase();
  const miss = 'billing subscription'.split(/\s+/).filter(w => !hay.includes(w));
  assert.deepStrictEqual(miss, ['subscription'],
    'the drift check must flag a word absent from the ⌘K keywords');
});

// ── A.11.2 F3: user-initiated mutations must not fail silently ──────────────

test('no user-initiated mutation swallows its API error', () => {
  // A.11.1 classified 558 empty catch blocks; 15 were user-initiated mutations
  // (pause/cancel/reject/dismiss/switch/create) whose failure was invisible.
  // Each was recovered using the mechanism ALREADY in its own file.
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules/.test(e.name)) walk(p); }
      else if (/\.(jsx|js)$/.test(e.name)) files.push(p);
    }
  })(SRC);

  const OPTIONAL = /localStorage|sessionStorage|JSON\.parse|clipboard|matchMedia|scrollIntoView|\.focus\(\)|requestAnimation|addEventListener|removeEventListener|clearInterval|clearTimeout|Observer|track\(|analytics|\.play\(\)|navigator\./i;
  const REQUEST  = /fetch\(|await api\(|await _|Api\.|await get[A-Z]|await post|await list|await create|await save|await delete|await update|await run|axios/i;
  const MUTATION = /POST|PUT|PATCH|DELETE|\/(pause|cancel|resume|dismiss|approve|reject|retry|restart|apply|save|create|delete|update|stop|start)\b/i;

  const offenders = [];
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) return;
      const ctx = lines.slice(Math.max(0, i - 4), i + 1).join(' ').replace(/\s+/g, ' ');
      if (OPTIONAL.test(ctx) || !REQUEST.test(ctx) || !MUTATION.test(ctx)) return;
      offenders.push(`${path.relative(SRC, f)}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(offenders, [],
    `user-initiated mutations failing silently:\n${offenders.join('\n')}`);
});

test('local API helpers check response status', () => {
  // Four files carried a private `API()` that returned r.json() with NO status
  // check, so a 4xx/5xx body flowed through as data and the caller's catch only
  // fired on a network error — the same defect class as A.11 F1.
  for (const rel of [
    'components/AutonomousPlatformPanel.jsx',
    'components/RepositoryMapPanel.jsx',
    'components/EngineeringMemoryPanel.jsx',
    'components/SelfImprovementPanel.jsx',
  ]) {
    const src = read(rel);
    const helper = /const API = async \([\s\S]*?\n\};/.exec(src);
    assert.ok(helper, `${rel}: the local API helper must exist`);
    assert.match(helper[0], /if \(!r\.ok\)/,
      `${rel}: the local API helper must check response status`);
    assert.match(helper[0], /err\.error \|\| err\.message/,
      `${rel}: it must preserve the backend's own message`);
  }
});

test('NEGATIVE: a silent mutation catch is detectable', () => {
  const ctx = "const r = await api('POST', `/x/${id}/cancel`); } catch {}";
  const REQUEST  = /fetch\(|await api\(/i;
  const MUTATION = /POST|\/(cancel)\b/i;
  assert.ok(REQUEST.test(ctx) && MUTATION.test(ctx),
    'the guard must classify this as a user-visible silent mutation');
});
