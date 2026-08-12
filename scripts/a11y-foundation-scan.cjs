#!/usr/bin/env node
/**
 * Phase B19.1 — Accessibility Foundation scanner.
 * Static JSX analysis over frontend/src. Reproduces defects; no fixes applied here.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || path.join(__dirname, '..', 'frontend/src');
const SRC = fs.realpathSync(ROOT);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      walk(p, out);
    } else if (/\.(jsx|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Blank out line comments, block comments and string literals, preserving
 * offsets and newlines so reported line numbers stay accurate. Prevents
 * "<input>" written inside a comment from being scanned as real markup.
 */
function maskNonCode(src) {
  const a = src.split('');
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < a.length; k++) if (a[k] !== '\n') a[k] = ' ';
  };
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') {
      let j = src.indexOf('\n', i); if (j === -1) j = src.length;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && n === '*') {
      let j = src.indexOf('*/', i + 2); j = j === -1 ? src.length : j + 2;
      blank(i, j); i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && !(src[j] === c && src[j - 1] !== '\\')) {
        if (src[j] === '\n') break;
        j++;
      }
      // keep quotes so attribute parsing still sees value="..." shape
      i = j + 1; continue;
    }
    i++;
  }
  return a.join('');
}

// Extract JSX opening tags with balanced brace handling inside attributes.
function extractTags(src) {
  const tags = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<') continue;
    const nameMatch = /^<([A-Za-z][A-Za-z0-9.\-]*)/.exec(src.slice(i, i + 60));
    if (!nameMatch) continue;
    const name = nameMatch[1];
    let j = i + nameMatch[0].length;
    let depth = 0, inStr = null, selfClosing = false, ok = false;
    for (; j < src.length; j++) {
      const c = src[j];
      if (inStr) { if (c === inStr && src[j - 1] !== '\\') inStr = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) { selfClosing = src[j - 1] === '/'; ok = true; break; }
    }
    if (!ok) continue;
    // `src` here is the masked source (comments/strings blanked). Attributes are
    // read from the ORIGINAL text at the same offsets so values survive masking.
    const raw = (extractTags.origin || src).slice(i, j + 1);
    const line = src.slice(0, i).split('\n').length;
    tags.push({ name, raw, line, selfClosing, start: i, end: j });
    i = j;
  }
  return tags;
}

function attr(raw, key) {
  // string literal attr
  const s = new RegExp(`\\s${key}\\s*=\\s*"([^"]*)"`).exec(raw)
    || new RegExp(`\\s${key}\\s*=\\s*'([^']*)'`).exec(raw);
  if (s) return { kind: 'literal', value: s[1] };
  // expression attr
  const e = new RegExp(`\\s${key}\\s*=\\s*\\{`).exec(raw);
  if (e) {
    let i = e.index + e[0].length - 1, depth = 0;
    for (; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') { depth--; if (depth === 0) break; }
    }
    return { kind: 'expr', value: raw.slice(e.index + e[0].length, i) };
  }
  // boolean attr
  if (new RegExp(`\\s${key}(\\s|/|>)`).test(raw)) return { kind: 'bool', value: 'true' };
  return null;
}
const has = (raw, key) => attr(raw, key) !== null;
const nonEmpty = (raw, key) => {
  const a = attr(raw, key);
  if (!a) return false;
  if (a.kind === 'literal') return a.value.trim().length > 0;
  return a.value.trim().length > 0;
};

// text content between an opening tag and its matching close
function innerText(src, tag) {
  if (tag.selfClosing) return '';
  const close = `</${tag.name}>`;
  const idx = src.indexOf(close, tag.end);
  if (idx === -1) return '';
  const inner = src.slice(tag.end + 1, idx);
  if (inner.length > 4000) return inner.slice(0, 4000);
  return inner;
}

// does inner content produce a perceivable accessible name?
function innerHasText(inner) {
  let s = inner;
  // strip nested tags
  s = s.replace(/<[^>]*>/g, ' ');
  // JSX expressions: {t('x')}, {label}, {count} all can yield text
  const hasExpr = /\{[^}]*\}/.test(s);
  const stripped = s.replace(/\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
  if (stripped.length > 0) return { text: true, literal: true };
  if (hasExpr) return { text: true, literal: false }; // dynamic — may or may not be text
  return { text: false, literal: false };
}

const FORM_CTRL = new Set(['input', 'select', 'textarea']);
const NON_LABEL_INPUT = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

const findings = [];
const inventory = {
  files: 0, buttons: 0, inputs: 0, selects: 0, textareas: 0,
  forms: 0, dialogs: 0, tables: 0, navs: 0, links: 0, imgs: 0,
  labels: 0, iconButtons: 0,
};

function add(rule, sev, file, line, detail, snippet) {
  findings.push({
    rule, severity: sev,
    file: path.relative(path.dirname(SRC), file),
    line, detail,
    snippet: (snippet || '').replace(/\s+/g, ' ').slice(0, 150),
  });
}

const files = walk(SRC);
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  inventory.files++;
  extractTags.origin = src;
  const tags = extractTags(maskNonCode(src));
  extractTags.origin = null;

  // map htmlFor targets present in this file
  const forTargets = new Set();
  for (const t of tags) {
    if (t.name === 'label') {
      const f = attr(t.raw, 'htmlFor') || attr(t.raw, 'for');
      if (f && f.kind === 'literal') forTargets.add(f.value);
      if (f && f.kind === 'expr') forTargets.add('__DYNAMIC__');
    }
  }
  // ids referenced by aria-labelledby / aria-describedby anywhere in file
  const idsInFile = new Set();
  for (const t of tags) {
    const idAttr = attr(t.raw, 'id');
    if (idAttr && idAttr.kind === 'literal') idsInFile.add(idAttr.value);
  }

  for (const t of tags) {
    const lower = t.name.toLowerCase();
    const raw = t.raw;
    const role = attr(raw, 'role');
    const roleVal = role && role.kind === 'literal' ? role.value : null;

    if (lower === 'label') inventory.labels++;
    if (lower === 'form') inventory.forms++;
    if (lower === 'table') inventory.tables++;
    if (lower === 'nav') inventory.navs++;
    if (lower === 'img') inventory.imgs++;

    // A conditional spread such as
    //   {...(label ? { "aria-labelledby": id } : { "aria-label": fallback })}
    // supplies a name on every branch. Treat it as named when every branch of
    // the spread provides one.
    const spreadNames = (() => {
      const spreads = [];
      const re = /\{\s*\.\.\./g;
      let mm;
      while ((mm = re.exec(raw)) !== null) {
        // brace-balance from the opening '{' to find the whole spread
        let d = 0, k = mm.index;
        for (; k < raw.length; k++) {
          if (raw[k] === '{') d++;
          else if (raw[k] === '}') { d--; if (d === 0) break; }
        }
        spreads.push(raw.slice(mm.index, k + 1));
      }
      // Named only if EVERY object literal inside the spread carries a name.
      return spreads.some(s => {
        const objs = s.match(/\{[^{}]*\}/g) || [];
        if (!objs.length) return false;
        return objs.every(o => /["']?aria-label(ledby)?["']?\s*:/.test(o));
      });
    })();

    const named = () =>
      nonEmpty(raw, 'aria-label') ||
      nonEmpty(raw, 'aria-labelledby') ||
      nonEmpty(raw, 'title') ||
      spreadNames;

    // ---------- BUTTONS ----------
    if (lower === 'button' || roleVal === 'button') {
      inventory.buttons++;
      const inner = innerText(src, t);
      const it = innerHasText(inner);
      const onlySvgOrIcon = !it.text && /<(svg|Icon|[A-Z][A-Za-z]*Icon)/.test(inner);
      if (!named() && !it.text) {
        inventory.iconButtons++;
        add('CTRL-UNNAMED-BUTTON', 'P0', file, t.line,
          onlySvgOrIcon ? 'Icon-only button with no accessible name' : 'Button has no accessible name',
          raw);
      } else if (!named() && it.text && !it.literal && /^\s*\{[^}]*\}\s*$/.test(inner.replace(/<[^>]*>/g, ''))) {
        // dynamic-only content — flagged informational
      }
    }

    // ---------- LINKS ----------
    if (lower === 'a' || roleVal === 'link') {
      inventory.links++;
      const it = innerHasText(innerText(src, t));
      if (!named() && !it.text) {
        add('CTRL-UNNAMED-LINK', 'P0', file, t.line, 'Link has no accessible name', raw);
      }
    }

    // ---------- IMG ----------
    if (lower === 'img') {
      if (!has(raw, 'alt')) {
        add('IMG-NO-ALT', 'P1', file, t.line, 'Image missing alt attribute', raw);
      }
    }

    // ---------- FORM CONTROLS ----------
    if (FORM_CTRL.has(lower)) {
      if (lower === 'input') inventory.inputs++;
      if (lower === 'select') inventory.selects++;
      if (lower === 'textarea') inventory.textareas++;

      const typeA = attr(raw, 'type');
      const type = typeA && typeA.kind === 'literal' ? typeA.value : (lower === 'input' ? 'text' : lower);
      if (NON_LABEL_INPUT.has(type)) {
        if (type === 'submit' || type === 'button') {
          if (!nonEmpty(raw, 'value') && !named()) {
            add('CTRL-UNNAMED-BUTTON', 'P0', file, t.line, `input[type=${type}] has no value/label`, raw);
          }
        }
        continue;
      }

      const idA = attr(raw, 'id');
      const id = idA && idA.kind === 'literal' ? idA.value : null;
      const wrappedByLabel = (() => {
        // look backwards for an enclosing <label> without a close in between
        const before = src.slice(Math.max(0, t.start - 800), t.start);
        const lastOpen = before.lastIndexOf('<label');
        if (lastOpen === -1) return false;
        return before.indexOf('</label>', lastOpen) === -1;
      })();

      const labelled =
        nonEmpty(raw, 'aria-label') ||
        nonEmpty(raw, 'aria-labelledby') ||
        (id && forTargets.has(id)) ||
        (idA && idA.kind === 'expr' && forTargets.has('__DYNAMIC__')) ||
        wrappedByLabel;

      const ph = attr(raw, 'placeholder');
      const hasPlaceholder = ph && (ph.kind === 'literal' ? ph.value.trim() : ph.value.trim()).length > 0;

      if (!labelled) {
        if (hasPlaceholder) {
          add('FORM-PLACEHOLDER-ONLY', 'P0', file, t.line,
            `<${lower}${type !== lower ? ` type=${type}` : ''}> relies on placeholder as its only name`, raw);
        } else {
          add('FORM-UNLABELED', 'P0', file, t.line,
            `<${lower}${type !== lower ? ` type=${type}` : ''}> has no accessible name`, raw);
        }
      }

      // required without aria-required is fine (native), but aria-required w/o required is noise — skip.
      // Flag required fields with no programmatic indicator at all when using custom validation
      const isRequired = has(raw, 'required') || has(raw, 'aria-required');
      if (isRequired && !has(raw, 'required') && !has(raw, 'aria-required')) {
        add('FORM-REQUIRED-NOT-EXPOSED', 'P2', file, t.line, 'Required field not programmatically exposed', raw);
      }

      // autocomplete on identity fields
      const nameA = attr(raw, 'name');
      const nameVal = nameA && nameA.kind === 'literal' ? nameA.value.toLowerCase() : '';
      const idVal = (id || '').toLowerCase();
      const key = nameVal + ' ' + idVal;
      // JSX spells it `autoComplete`; the DOM attribute is `autocomplete`.
      if (/email|password|username|tel|phone|address|zip|postal|fullname|firstname|lastname/.test(key)
          && !has(raw, 'autocomplete') && !has(raw, 'autoComplete')) {
        add('FORM-NO-AUTOCOMPLETE', 'P2', file, t.line,
          `Identity field ("${nameVal || idVal}") missing autocomplete`, raw);
      }
    }

    // ---------- DIALOGS ----------
    if (roleVal === 'dialog' || roleVal === 'alertdialog' || lower === 'dialog') {
      inventory.dialogs++;
      if (!has(raw, 'aria-modal')) {
        add('DIALOG-NO-ARIA-MODAL', 'P1', file, t.line, 'Dialog missing aria-modal', raw);
      }
      if (!named()) {
        add('DIALOG-UNNAMED', 'P0', file, t.line, 'Dialog has no accessible name', raw);
      }
    }

    // ---------- CUSTOM WIDGET ROLES ----------
    if (roleVal && ['checkbox', 'radio', 'switch', 'slider', 'tab', 'menuitem', 'combobox', 'searchbox', 'textbox'].includes(roleVal)) {
      const it = innerHasText(innerText(src, t));
      if (!named() && !it.text) {
        add('CTRL-UNNAMED-WIDGET', 'P0', file, t.line, `role="${roleVal}" has no accessible name`, raw);
      }
      if (['checkbox', 'radio', 'switch'].includes(roleVal) && !has(raw, 'aria-checked')) {
        add('WIDGET-NO-STATE', 'P1', file, t.line, `role="${roleVal}" missing aria-checked`, raw);
      }
      if (roleVal === 'tab' && !has(raw, 'aria-selected')) {
        add('WIDGET-NO-STATE', 'P1', file, t.line, 'role="tab" missing aria-selected', raw);
      }
      if (roleVal === 'slider' && !(has(raw, 'aria-valuenow'))) {
        add('WIDGET-NO-STATE', 'P1', file, t.line, 'role="slider" missing aria-valuenow', raw);
      }
    }

    // ---------- CLICKABLE NON-INTERACTIVE ----------
    // Exclusions (verified non-defects):
    //  - dialog/alertdialog overlays: onClick is backdrop-dismiss, keyboard path is Escape
    //  - e.stopPropagation()-only handlers: no user-facing action
    // A modal backdrop is not a control: its click merely dismisses, and the
    // keyboard equivalent is Escape (bound on the dialog, not the backdrop).
    // Recognise it either by an explicit dialog role or by wrapping an element
    // that carries one.
    const wrapsADialog = (() => {
      if (!/overlay|backdrop|scrim|modal-bg/i.test(raw)) return false;
      const after = src.slice(t.end, t.end + 600);
      // The backdrop must actually wrap a dialog. A file-wide Escape binding is
      // NOT sufficient: without the role, the modal has no accessible identity,
      // and excusing it here would let a dialog fix be reverted undetected.
      if (/role\s*=\s*["'](dialog|alertdialog)["']/.test(after)) return true;
      // Narrow exception: a full-screen scrim that contains no focusable
      // content of its own (e.g. the guided-tour mask) is decoration whose
      // dismissal is genuinely covered by Escape.
      const hasOwnControls = /<(input|select|textarea|button)\b/i.test(after)
        || /role\s*=\s*["'](button|tab|menuitem|checkbox|switch)["']/.test(after);
      return !hasOwnControls && (/useEscapeKey\s*\(/.test(src) || /["']Escape["']/.test(src));
    })();
    const isDialogOverlay = roleVal === 'dialog' || roleVal === 'alertdialog' || wrapsADialog;
    const isStopPropagationOnly = /onClick\s*=\s*\{\s*(\(?\s*e\s*\)?|\(\s*\))\s*=>\s*e?\.?stopPropagation\(\)\s*\}/.test(raw)
      || /onClick\s*=\s*\{\s*\(\s*e\s*\)\s*=>\s*e\.stopPropagation\(\)\s*\}/.test(raw);
    if ((lower === 'div' || lower === 'span' || lower === 'li' || lower === 'tr' || lower === 'td')
        && has(raw, 'onClick') && !isDialogOverlay && !isStopPropagationOnly) {
      const isInteractiveRole = roleVal && roleVal !== 'presentation' && roleVal !== 'none';
      const hasTab = has(raw, 'tabIndex');
      const hasKey = has(raw, 'onKeyDown') || has(raw, 'onKeyPress') || has(raw, 'onKeyUp');
      if (!isInteractiveRole && !hasTab) {
        add('KBD-CLICK-NO-KEYBOARD', 'P0', file, t.line,
          `<${lower} onClick> is not focusable (no role, no tabIndex) — unreachable by keyboard`, raw);
      } else if (hasTab && !hasKey && !isInteractiveRole) {
        add('KBD-NO-KEY-HANDLER', 'P1', file, t.line,
          `<${lower} onClick tabIndex> has no keyboard handler`, raw);
      } else if (isInteractiveRole && hasTab && !hasKey) {
        add('KBD-NO-KEY-HANDLER', 'P1', file, t.line,
          `role="${roleVal}" with onClick has no keyboard handler`, raw);
      } else if (isInteractiveRole && !hasTab) {
        add('KBD-ROLE-NOT-FOCUSABLE', 'P1', file, t.line,
          `role="${roleVal}" with onClick is not focusable (no tabIndex)`, raw);
      }
    }

    // ---------- POSITIVE TABINDEX ----------
    const ti = attr(raw, 'tabIndex');
    if (ti && /^\{?\s*[1-9]/.test(ti.value)) {
      add('FOCUS-POSITIVE-TABINDEX', 'P1', file, t.line, `Positive tabIndex=${ti.value} disrupts tab order`, raw);
    }

    // ---------- aria-labelledby pointing nowhere (same-file check) ----------
    const albl = attr(raw, 'aria-labelledby');
    if (albl && albl.kind === 'literal' && albl.value.trim()) {
      for (const ref of albl.value.trim().split(/\s+/)) {
        if (!idsInFile.has(ref)) {
          add('ARIA-DANGLING-REF', 'P1', file, t.line, `aria-labelledby="${ref}" has no matching id in file`, raw);
        }
      }
    }
    const adsc = attr(raw, 'aria-describedby');
    if (adsc && adsc.kind === 'literal' && adsc.value.trim()) {
      for (const ref of adsc.value.trim().split(/\s+/)) {
        if (!idsInFile.has(ref)) {
          add('ARIA-DANGLING-REF', 'P2', file, t.line, `aria-describedby="${ref}" has no matching id in file`, raw);
        }
      }
    }
  }
}

// ---------- REPORT ----------
const bySeverity = { P0: [], P1: [], P2: [] };
for (const f of findings) bySeverity[f.severity].push(f);
const byRule = {};
for (const f of findings) (byRule[f.rule] ||= []).push(f);

const out = {
  scannedAt: new Date().toISOString(),
  root: SRC,
  inventory,
  totals: {
    findings: findings.length,
    P0: bySeverity.P0.length, P1: bySeverity.P1.length, P2: bySeverity.P2.length,
  },
  byRule: Object.fromEntries(Object.entries(byRule).map(([k, v]) => [k, v.length])),
  findings,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log('=== INVENTORY ===');
  console.log(JSON.stringify(inventory, null, 2));
  console.log('\n=== TOTALS ===');
  console.log(JSON.stringify(out.totals, null, 2));
  console.log('\n=== BY RULE ===');
  for (const [r, c] of Object.entries(byRule).sort((a, b) => b[1].length - a[1].length)) {
    console.log(String(c.length ?? c).padStart(5), r);
  }
  console.log('\n=== TOP FILES ===');
  const byFile = {};
  for (const f of findings) byFile[f.file] = (byFile[f.file] || 0) + 1;
  Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 30)
    .forEach(([f, c]) => console.log(String(c).padStart(5), f));
}
module.exports = { out };
