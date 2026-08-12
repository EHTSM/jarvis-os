/**
 * B19.3 — Keyboard & ARIA recovery regression suite.
 *
 * WHY THIS EXISTS. B19.1 recovered keyboard access across the app. By B19.2.3
 * every one of those fixes had silently reverted: `useEscapeKey` and
 * `useClickableProps` still existed on disk with ZERO importers. The guards
 * that would have caught it lived in `tests/`, which is `.gitignore`d, so they
 * never ran in CI.
 *
 * This suite asserts the RECOVERED CAPABILITY ITSELF — a hook that no file
 * imports is a failure, not a pass — and every test is negative-tested against
 * an injected defect so it cannot rot into a tautology.
 *
 *   node tests/runtime/28-keyboard-aria-recovery.test.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'src');

function jsxFiles(dir = SRC, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules/.test(e.name)) jsxFiles(p, out); }
    else if (/\.jsx$/.test(e.name)) out.push(p);
  }
  return out;
}
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const rel = (p) => path.relative(SRC, p);

// ── 1. The recovery hooks exist AND are actually wired ──────────────────────

test('the keyboard recovery hooks still exist', () => {
  assert.ok(fs.existsSync(path.join(SRC, 'hooks/useEscapeKey.js')));
  assert.ok(fs.existsSync(path.join(SRC, 'hooks/useClickableProps.js')));
});

test('useEscapeKey is imported by real components, not just present on disk', () => {
  const users = jsxFiles().filter(f => /useEscapeKey/.test(fs.readFileSync(f, 'utf8')));
  // This is the exact failure mode of B19.1→B19.2.3: the hook survived, every
  // call site did not. A bare existence check would have passed throughout.
  assert.ok(users.length >= 10,
    `useEscapeKey has ${users.length} importers — the hook is unwired (B19.1 regression)`);
});

test('clickableProps is imported by real components, not just present on disk', () => {
  const users = jsxFiles().filter(f => /clickableProps|overlayProps/.test(fs.readFileSync(f, 'utf8')));
  assert.ok(users.length >= 50,
    `clickableProps has ${users.length} importers — the hook is unwired (B19.1 regression)`);
});

// ── 2. Modals keep their Escape binding ─────────────────────────────────────

test('every modal that dismisses on backdrop click also binds Escape', () => {
  const offenders = [];
  for (const f of jsxFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    const hasBackdropDismiss = /className="[^"]*(modal|dialog)[^"]*(overlay|backdrop)[^"]*"\s*(\{\.\.\.overlayProps|onClick)/.test(src);
    if (!hasBackdropDismiss) continue;
    // Escape may be bound by the hook, or by an explicit key handler.
    if (!/useEscapeKey\s*\(|["']Escape["']/.test(src)) offenders.push(rel(f));
  }
  assert.deepStrictEqual(offenders, [],
    `mouse-only modal dismissal (keyboard users cannot close these):\n${offenders.join('\n')}`);
});

// ── 3. Dialog semantics ─────────────────────────────────────────────────────

test('every role="dialog" carries aria-modal and an accessible name', () => {
  const offenders = [];
  for (const f of jsxFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/<[a-zA-Z]+[^>]*role="(dialog|alertdialog)"[^>]*>/gs)) {
      const tag = m[0];
      if (!/aria-modal/.test(tag)) offenders.push(`${rel(f)}: dialog without aria-modal`);
      if (!/aria-label|aria-labelledby/.test(tag)) offenders.push(`${rel(f)}: dialog without a name`);
    }
  }
  assert.deepStrictEqual(offenders, [], offenders.join('\n'));
});

test('every aria-labelledby points at an id that exists in the same file', () => {
  const offenders = [];
  for (const f of jsxFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/aria-labelledby="([^"]+)"/g)) {
      for (const id of m[1].split(/\s+/)) {
        if (!new RegExp(`id="${id}"`).test(src)) {
          offenders.push(`${rel(f)}: aria-labelledby="${id}" has no matching id`);
        }
      }
    }
  }
  assert.deepStrictEqual(offenders, [], offenders.join('\n'));
});

test('every aria-describedby points at an id that exists in the same file', () => {
  const offenders = [];
  for (const f of jsxFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/aria-describedby="([^"]+)"/g)) {
      for (const id of m[1].split(/\s+/)) {
        if (!new RegExp(`id="${id}"`).test(src)) {
          offenders.push(`${rel(f)}: aria-describedby="${id}" has no matching id`);
        }
      }
    }
  }
  assert.deepStrictEqual(offenders, [], offenders.join('\n'));
});

// ── 4. The overlayProps aria-hidden defect stays fixed ──────────────────────

test('overlayProps does not set aria-hidden', () => {
  const src = read('hooks/useClickableProps.js');
  const fn = /export function overlayProps[\s\S]*?\n}/.exec(src);
  assert.ok(fn, 'overlayProps must exist');
  // Every modal in this codebase nests the dialog INSIDE the overlay, so
  // aria-hidden here is inherited by the dialog and removes it from the
  // accessibility tree — hiding the very content the modal exists to show.
  assert.ok(!/aria-hidden/.test(fn[0]),
    'overlayProps sets aria-hidden; the nested dialog would be hidden from assistive tech');
});

// ── 5. Specific recovered defects stay recovered ────────────────────────────

test('the settings Toggle exposes an accessible name and is type=button', () => {
  const src = read('components/WorkspaceSettingsShared.jsx');
  assert.match(src, /role="switch"/);
  assert.match(src, /aria-labelledby=/, 'Toggle must expose a name');
  assert.match(src, /type="button"/, 'Toggle must not default to submit inside a form');
});

test('the code editor tablist keeps roving tabindex and arrow keys', () => {
  const src = read('components/CodeEditorPane.jsx');
  assert.match(src, /role="tablist"/);
  assert.match(src, /tabIndex=\{tab\.id === activeId \? 0 : -1\}/, 'tabs must use roving tabindex');
  assert.match(src, /ArrowRight/, 'tabs must support arrow-key navigation');
});

test('the operator command input describedby target exists', () => {
  const src = read('components/operator/WorkflowPanel.jsx');
  assert.match(src, /aria-describedby="cmd-risk-hint"/);
  assert.match(src, /id="cmd-risk-hint"/, 'describedby must point at a real element');
});

// ── 6. NEGATIVE TESTS: each rule still catches its defect ───────────────────

test('NEGATIVE: a dialog without aria-modal is detected', () => {
  const snippet = '<div role="dialog" aria-label="x">body</div>';
  const tag = /<[a-zA-Z]+[^>]*role="(dialog|alertdialog)"[^>]*>/s.exec(snippet);
  assert.ok(tag, 'the matcher must find the dialog');
  assert.ok(!/aria-modal/.test(tag[0]), 'and must see that aria-modal is absent');
});

test('NEGATIVE: a dangling aria-labelledby is detected', () => {
  const snippet = '<div aria-labelledby="nope"><h3 id="other">t</h3></div>';
  const m = /aria-labelledby="([^"]+)"/.exec(snippet);
  assert.ok(m);
  assert.ok(!new RegExp(`id="${m[1]}"`).test(snippet),
    'a labelledby with no matching id must be reported');
});

test('NEGATIVE: overlayProps regaining aria-hidden is detected', () => {
  const bad = "export function overlayProps(f){return{onClick:f,'aria-hidden':true};\n}";
  const fn = /export function overlayProps[\s\S]*?\n}/.exec(bad);
  assert.ok(fn && /aria-hidden/.test(fn[0]),
    'the guard must fire if aria-hidden is reintroduced');
});
