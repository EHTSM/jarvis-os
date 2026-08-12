/**
 * Phase B19.1 — Accessibility Foundation regression suite.
 *
 * Two kinds of test here:
 *
 *  1. POSITIVE — the live frontend scans clean, and specific recovered
 *     defects are still fixed at their real source locations.
 *
 *  2. NEGATIVE — each rule is re-proved by feeding the scanner a fixture that
 *     reintroduces the defect. If a rule ever stops detecting its defect, the
 *     corresponding fix could be reverted silently; these tests make that
 *     impossible. This is the "must fail when reverted" requirement.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const SCANNER = path.join(REPO, 'scripts', 'a11y-foundation-scan.cjs');
const FRONTEND_SRC = path.join(REPO, 'frontend', 'src');

function scan(dir) {
  const out = execFileSync('node', [SCANNER, dir, '--json'], {
    encoding: 'utf8', maxBuffer: 1024 * 1024 * 128,
  });
  return JSON.parse(out);
}

/** Scan a single throwaway component built from `jsx`. */
function scanSnippet(jsx) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-fixture-'));
  try {
    fs.writeFileSync(path.join(dir, 'Fixture.jsx'), jsx);
    return scan(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const rules = (result) => result.findings.map(f => f.rule);

// ── 1. The real frontend is clean ────────────────────────────────────────
test('frontend accessibility foundation scans with zero findings', () => {
  const result = scan(FRONTEND_SRC);
  assert.strictEqual(
    result.totals.findings, 0,
    `Expected 0 findings, got ${result.totals.findings}:\n` +
    result.findings.slice(0, 25).map(f => `  ${f.rule} ${f.file}:${f.line} — ${f.detail}`).join('\n'),
  );
});

test('inventory still covers the real component surface', () => {
  const { inventory } = scan(FRONTEND_SRC);
  // Guards against the scanner silently matching nothing (which would make
  // "0 findings" meaningless).
  assert.ok(inventory.files    > 200, `files=${inventory.files}`);
  assert.ok(inventory.buttons  > 1500, `buttons=${inventory.buttons}`);
  assert.ok(inventory.inputs   > 400, `inputs=${inventory.inputs}`);
  assert.ok(inventory.selects  > 150, `selects=${inventory.selects}`);
  // B19.3: was `> 30`, which never held — the app has 22 modal overlay
  // containers in total, so 30 was unreachable and the guard failed from the
  // day it was written. The real number of elements carrying role="dialog"
  // rose 7 → 15 in B19.3 as the existing dialog pattern was recovered. The
  // floor tracks that measured value so a REGRESSION still fails the guard.
  assert.ok(inventory.dialogs  >= 15, `dialogs=${inventory.dialogs}`);
});

// ── 2. Negative tests: every rule still catches its defect ───────────────

test('NEGATIVE: placeholder-only field is detected', () => {
  const r = scanSnippet(`export default () => (
    <input className="x" placeholder="Search agents" value={q} onChange={f} />
  );`);
  assert.ok(rules(r).includes('FORM-PLACEHOLDER-ONLY'), JSON.stringify(rules(r)));
});

test('NEGATIVE: unlabeled select is detected', () => {
  const r = scanSnippet(`export default () => (
    <select className="x" value={v} onChange={f}><option>a</option></select>
  );`);
  assert.ok(rules(r).includes('FORM-UNLABELED'), JSON.stringify(rules(r)));
});

test('NEGATIVE: clickable div with no keyboard path is detected', () => {
  const r = scanSnippet(`export default () => (
    <div className="row" onClick={() => pick(1)}>Row</div>
  );`);
  assert.ok(rules(r).includes('KBD-CLICK-NO-KEYBOARD'), JSON.stringify(rules(r)));
});

test('NEGATIVE: icon-only button with no accessible name is detected', () => {
  const r = scanSnippet(`export default () => (
    <button className="icon" onClick={go}><svg viewBox="0 0 1 1" /></button>
  );`);
  assert.ok(rules(r).includes('CTRL-UNNAMED-BUTTON'), JSON.stringify(rules(r)));
});

test('NEGATIVE: unnamed dialog is detected', () => {
  const r = scanSnippet(`export default () => (
    <div role="dialog" aria-modal="true" className="m">body</div>
  );`);
  assert.ok(rules(r).includes('DIALOG-UNNAMED'), JSON.stringify(rules(r)));
});

test('NEGATIVE: dialog without aria-modal is detected', () => {
  const r = scanSnippet(`export default () => (
    <div role="dialog" aria-label="Settings" className="m">body</div>
  );`);
  assert.ok(rules(r).includes('DIALOG-NO-ARIA-MODAL'), JSON.stringify(rules(r)));
});

test('NEGATIVE: role=switch without a name is detected', () => {
  const r = scanSnippet(`export default () => (
    <button role="switch" aria-checked={on} onClick={t}><span /></button>
  );`);
  assert.ok(rules(r).includes('CTRL-UNNAMED-WIDGET'), JSON.stringify(rules(r)));
});

test('NEGATIVE: dangling aria-labelledby reference is detected', () => {
  const r = scanSnippet(`export default () => (
    <input aria-labelledby="does-not-exist" value={v} onChange={f} />
  );`);
  assert.ok(rules(r).includes('ARIA-DANGLING-REF'), JSON.stringify(rules(r)));
});

test('NEGATIVE: positive tabIndex is detected', () => {
  const r = scanSnippet(`export default () => (
    <button tabIndex={3} aria-label="Go">Go</button>
  );`);
  assert.ok(rules(r).includes('FOCUS-POSITIVE-TABINDEX'), JSON.stringify(rules(r)));
});

test('NEGATIVE: image without alt is detected', () => {
  const r = scanSnippet(`export default () => <img src="/a.png" />;`);
  assert.ok(rules(r).includes('IMG-NO-ALT'), JSON.stringify(rules(r)));
});

test('NEGATIVE: identity field without autocomplete is detected', () => {
  const r = scanSnippet(`export default () => (
    <input type="email" name="email" aria-label="Email" value={v} onChange={f} />
  );`);
  assert.ok(rules(r).includes('FORM-NO-AUTOCOMPLETE'), JSON.stringify(rules(r)));
});

// ── 3. Positive control: correct markup must NOT be flagged ─────────────
// Without these, a scanner that flagged everything would also pass the
// negative tests above.

test('POSITIVE: properly labelled control is not flagged', () => {
  const r = scanSnippet(`export default () => (
    <div>
      <label htmlFor="f-name">Full name</label>
      <input id="f-name" placeholder="e.g. Priya" value={v} onChange={f} />
    </div>
  );`);
  assert.strictEqual(r.totals.findings, 0, JSON.stringify(r.findings));
});

test('POSITIVE: keyboard-accessible div control is not flagged', () => {
  const r = scanSnippet(`export default () => (
    <div role="button" tabIndex={0} aria-label="Open row"
      onClick={go} onKeyDown={k}>Row</div>
  );`);
  assert.strictEqual(r.totals.findings, 0, JSON.stringify(r.findings));
});

test('POSITIVE: named modal dialog is not flagged', () => {
  const r = scanSnippet(`export default () => (
    <div className="overlay" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="t" onClick={stop}>
        <h3 id="t">Create agent</h3>
      </div>
    </div>
  );`);
  assert.strictEqual(r.totals.findings, 0, JSON.stringify(r.findings));
});

// ── 4. Specific recovered defects stay recovered ────────────────────────

test('Toggle switch keeps its accessible name', () => {
  const src = fs.readFileSync(
    path.join(FRONTEND_SRC, 'components/WorkspaceSettingsShared.jsx'), 'utf8');
  assert.match(src, /role="switch"/);
  assert.match(src, /aria-labelledby|aria-label/,
    'Toggle switch must expose a name');
  assert.match(src, /type="button"/,
    'Toggle must not default to type=submit inside a form');
});

test('operator command input describedby target exists', () => {
  const src = fs.readFileSync(
    path.join(FRONTEND_SRC, 'components/operator/WorkflowPanel.jsx'), 'utf8');
  assert.match(src, /aria-describedby="cmd-risk-hint"/);
  assert.match(src, /id="cmd-risk-hint"/,
    'aria-describedby must point at an element that exists');
});

test('code editor tablist implements roving tabindex', () => {
  const src = fs.readFileSync(
    path.join(FRONTEND_SRC, 'components/CodeEditorPane.jsx'), 'utf8');
  assert.match(src, /role="tablist"/);
  assert.match(src, /tabIndex=\{tab\.id === activeId \? 0 : -1\}/,
    'tabs must use roving tabindex');
  assert.match(src, /ArrowRight/, 'tabs must support arrow-key navigation');
});

test('modals that only closed on backdrop click now bind Escape', () => {
  const files = [
    'components/AgentRegistryCenter.jsx', 'components/BetaChecklist.jsx',
    'components/CompanyFactoryCenter.jsx', 'components/KnowledgeCenter.jsx',
    'components/MemoryCenter.jsx', 'components/MissionControlV1.jsx',
    'components/WorkflowOSV2.jsx', 'components/WorkspaceSettingsK4.jsx',
    'components/WorkspaceSettingsL2.jsx', 'components/WorkspaceSettingsL3.jsx',
    'components/operator-os/MissionEngine.jsx', 'components/GuidedTour.jsx',
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(FRONTEND_SRC, rel), 'utf8');
    assert.match(src, /useEscapeKey\s*\(/, `${rel} lost its Escape binding`);
  }
});

test('shared keyboard/escape helpers exist', () => {
  assert.ok(fs.existsSync(path.join(FRONTEND_SRC, 'hooks/useEscapeKey.js')));
  assert.ok(fs.existsSync(path.join(FRONTEND_SRC, 'hooks/useClickableProps.js')));
});

test('no duplicate accessibility attributes were introduced', () => {
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
      else if (/\.jsx$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const dupes = [];
  for (const file of walk(FRONTEND_SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /<(input|select|textarea|button|div)\b/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      let j = m.index + m[0].length, d = 0, s = null, end = -1;
      for (; j < src.length; j++) {
        const c = src[j];
        if (s) { if (c === s && src[j - 1] !== '\\') s = null; continue; }
        if (c === '"' || c === "'" || c === '`') { s = c; continue; }
        if (c === '{') d++;
        else if (c === '}') d--;
        else if (c === '>' && d === 0) { end = j; break; }
      }
      if (end === -1) break;
      const tag = src.slice(m.index, end + 1);
      for (const attr of ['aria-label', 'aria-labelledby', 'autoComplete', 'role', 'tabIndex']) {
        const n = (tag.match(new RegExp(`\\s${attr}\\s*=`, 'g')) || []).length;
        if (n > 1) {
          dupes.push(`${path.relative(REPO, file)}:${src.slice(0, m.index).split('\n').length} ${attr} x${n}`);
        }
      }
      re.lastIndex = end;
    }
  }
  assert.deepStrictEqual(dupes, [], `Duplicate attributes:\n${dupes.join('\n')}`);
});
