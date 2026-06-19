/**
 * aiInlineExtension — ACP-5
 *
 * Brings AI inside CodeMirror 6:
 *   • Ghost completions  — inline grey text after cursor, Tab to accept
 *   • Hover actions     — float panel on mouse-over: Explain/Review/Refactor/Tests/Optimize/Document/Fix
 *   • Lightbulb gutter  — appears on lines with AI quick-fix suggestions
 *   • Inline diagnostics — styled marks for detected issues
 *   • Confidence badge  — shown in ghost text suffix
 *
 * Usage:
 *   import { aiInlineExtension } from './aiInlineExtension';
 *   // In buildBaseExtensions:
 *   aiInlineExtension({ onAction, onMetric, apiBase })
 *
 * No React dependency — pure CM6.
 */

import {
  ViewPlugin, WidgetType, Decoration, EditorView,
  keymap, hoverTooltip, gutter, GutterMarker,
} from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';

// ── Constants ─────────────────────────────────────────────────────────────────

const GHOST_DEBOUNCE_MS = 800;   // wait after typing stops before AI call
const MIN_TRIGGER_LEN   = 3;     // min chars typed on current line to trigger
const MAX_GHOST_CHARS   = 300;   // truncate ghost text

// ── Effects & State ───────────────────────────────────────────────────────────

// Clears or sets the current ghost completion
const setGhostEffect = StateEffect.define();

const ghostState = StateField.define({
  create: () => ({ text: '', from: 0, confidence: 0 }),
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setGhostEffect)) return e.value;
    }
    // Clear on any document change
    if (tr.docChanged) return { text: '', from: 0, confidence: 0 };
    return val;
  },
});

// ── Ghost widget ──────────────────────────────────────────────────────────────

class GhostWidget extends WidgetType {
  constructor(text, confidence) {
    super();
    this.text       = text;
    this.confidence = confidence;
  }

  eq(other) { return other.text === this.text && other.confidence === this.confidence; }

  toDOM() {
    const wrap = document.createElement('span');
    wrap.className  = 'cm-ai-ghost';
    wrap.setAttribute('aria-hidden', 'true');

    const textNode = document.createElement('span');
    textNode.className   = 'cm-ai-ghost__text';
    textNode.textContent = this.text.slice(0, MAX_GHOST_CHARS);
    wrap.appendChild(textNode);

    if (this.confidence > 0) {
      const badge = document.createElement('span');
      badge.className   = 'cm-ai-ghost__badge';
      badge.textContent = `AI ${Math.round(this.confidence * 100)}%`;
      wrap.appendChild(badge);
    }

    const hint = document.createElement('span');
    hint.className   = 'cm-ai-ghost__hint';
    hint.textContent = ' Tab';
    wrap.appendChild(hint);

    return wrap;
  }

  ignoreEvent() { return false; }
}

// ── Ghost decoration builder ──────────────────────────────────────────────────

function buildGhostDeco(state) {
  const { text, from, confidence } = state.field(ghostState);
  if (!text) return Decoration.none;

  const b = new RangeSetBuilder();
  b.add(from, from, Decoration.widget({
    widget: new GhostWidget(text, confidence),
    side: 1,
  }));
  return b.finish();
}

// ── Lightbulb gutter ──────────────────────────────────────────────────────────

class LightbulbMarker extends GutterMarker {
  constructor(onAction) {
    super();
    this._onAction = onAction;
  }

  toDOM() {
    const el = document.createElement('span');
    el.className   = 'cm-ai-lightbulb';
    el.textContent = '💡';
    el.title       = 'AI quick fix (click)';
    el.addEventListener('click', () => this._onAction('lightbulb'));
    return el;
  }
}

// ── Hover tooltip builder ─────────────────────────────────────────────────────

function makeHoverTooltip(onAction, getFileContext) {
  return hoverTooltip((view, pos) => {
    // Only show when holding Alt/Option or if there's a selection near pos
    // We show on hover always — gated client-side by a short delay
    const line = view.state.doc.lineAt(pos);
    const word = (() => {
      const text = line.text;
      const col  = pos - line.from;
      const start = text.slice(0, col).search(/\w+$/);
      const end   = col + (text.slice(col).match(/^\w*/) || [''])[0].length;
      return start >= 0 ? text.slice(start, end) : '';
    })();

    if (!word || word.length < 2) return null;

    return {
      pos,
      above: true,
      strictSide: false,
      arrow: false,
      create() {
        const dom = document.createElement('div');
        dom.className = 'cm-ai-hover';

        const actions = [
          { id: 'explain',  icon: '◈', label: 'Explain'  },
          { id: 'review',   icon: '★', label: 'Review'   },
          { id: 'refactor', icon: '⟳', label: 'Refactor' },
          { id: 'tests',    icon: '✓', label: 'Tests'    },
          { id: 'optimize', icon: '⚡', label: 'Optimize' },
          { id: 'document', icon: '📄', label: 'Docs'    },
          { id: 'fix',      icon: '🔧', label: 'Fix'     },
        ];

        actions.forEach(a => {
          const btn = document.createElement('button');
          btn.className   = 'cm-ai-hover__btn';
          btn.title       = a.label;
          btn.textContent = `${a.icon} ${a.label}`;
          btn.addEventListener('click', () => {
            const ctx = getFileContext?.() || {};
            onAction(a.id, { word, line: line.text, lineNum: line.number, ...ctx });
          });
          dom.appendChild(btn);
        });

        return { dom };
      },
    };
  }, { hideOnChange: true });
}

// ── Main AI completion plugin ─────────────────────────────────────────────────

function makeAIPlugin(opts) {
  const { onAction, onMetric, apiBase = '' } = opts || {};

  let debounceTimer = null;
  let lastPrefix    = '';
  let pendingAbort  = null;

  const getFileContext = opts.getFileContext || (() => ({}));

  async function fetchGhost(view, prefix, cursorPos) {
    pendingAbort?.abort();
    pendingAbort = new AbortController();

    try {
      const ctx   = getFileContext();
      const body  = JSON.stringify({ prefix, filePath: ctx.filePath, cwd: ctx.cwd, symbolContext: ctx.symbolContext });
      const resp  = await fetch(`${apiBase}/coding/complete`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body,
        signal: pendingAbort.signal,
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (!data?.completion || !data.completion.trim()) return;

      // Only apply if cursor hasn't moved
      const currentPos = view.state.selection.main.head;
      if (currentPos !== cursorPos) return;

      onMetric?.('ghost_triggered', { file: ctx.filePath });

      view.dispatch({
        effects: setGhostEffect.of({
          text:       data.completion,
          from:       cursorPos,
          confidence: data.confidence || 0,
        }),
      });
    } catch (e) {
      if (e.name !== 'AbortError') {} // ignore
    }
  }

  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view       = view;
      this.decorations = buildGhostDeco(view.state);
    }

    update(update) {
      // Rebuild ghost decorations whenever state changes
      this.decorations = buildGhostDeco(update.state);

      if (!update.docChanged && !update.selectionSet) return;

      // Clear ghost on selection change (user moved cursor)
      const ghost = update.state.field(ghostState);
      if (ghost.text && update.selectionSet && !update.docChanged) {
        update.view.dispatch({ effects: setGhostEffect.of({ text: '', from: 0, confidence: 0 }) });
        return;
      }

      if (!update.docChanged) return;

      const state  = update.state;
      const cursor = state.selection.main.head;
      const line   = state.doc.lineAt(cursor);
      const prefix = line.text.slice(0, cursor - line.from);

      if (prefix === lastPrefix) return;
      lastPrefix = prefix;

      if (prefix.trim().length < MIN_TRIGGER_LEN) {
        view.dispatch({ effects: setGhostEffect.of({ text: '', from: 0, confidence: 0 }) });
        clearTimeout(debounceTimer);
        return;
      }

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        fetchGhost(update.view, prefix, cursor);
      }, GHOST_DEBOUNCE_MS);
    }

    destroy() {
      clearTimeout(debounceTimer);
      pendingAbort?.abort();
    }
  }, {
    decorations: v => v.decorations,
  });
}

// ── Tab keymap: accept ghost completion ───────────────────────────────────────

function makeTabKeymap(onMetric, getFileContext) {
  return keymap.of([
    {
      key: 'Tab',
      run(view) {
        const ghost = view.state.field(ghostState, false);
        if (!ghost?.text) return false; // fall through to default Tab

        const { text, from } = ghost;
        view.dispatch({
          changes:  { from, to: from, insert: text },
          effects:  setGhostEffect.of({ text: '', from: 0, confidence: 0 }),
          selection: { anchor: from + text.length },
        });

        const ctx = getFileContext?.() || {};
        onMetric?.('ghost_accepted', { file: ctx.filePath, length: text.length });
        return true;
      },
    },
    {
      key: 'Escape',
      run(view) {
        const ghost = view.state.field(ghostState, false);
        if (!ghost?.text) return false;
        view.dispatch({ effects: setGhostEffect.of({ text: '', from: 0, confidence: 0 }) });
        return true;
      },
    },
  ]);
}

// ── Inline diagnostic decoration ──────────────────────────────────────────────

// diags: [{ from, to, severity, message }]
const setDiagsEffect = StateEffect.define();

const diagsState = StateField.define({
  create: () => [],
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiagsEffect)) return e.value;
    }
    return val;
  },
});

function buildDiagDecos(state) {
  const diags = state.field(diagsState);
  const b     = new RangeSetBuilder();
  const len   = state.doc.length;
  for (const d of diags) {
    const from = Math.min(d.from, len);
    const to   = Math.min(d.to || d.from + 1, len);
    if (from >= to) continue;
    b.add(from, to, Decoration.mark({
      class: `cm-ai-diag cm-ai-diag--${d.severity || 'warning'}`,
      attributes: { title: d.message || '' },
    }));
  }
  return b.finish();
}

const diagPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildDiagDecos(view.state); }
  update(u)         { this.decorations = buildDiagDecos(u.state); }
}, { decorations: v => v.decorations });

// ── CSS injection (once) ──────────────────────────────────────────────────────

let cssInjected = false;

function injectCSS() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;

  const style = document.createElement('style');
  style.textContent = `
/* Ghost completion */
.cm-ai-ghost { display: inline; pointer-events: none; }
.cm-ai-ghost__text {
  color: rgba(180,180,180,0.45);
  font-style: italic;
  white-space: pre;
}
.cm-ai-ghost__badge {
  margin-left: 6px;
  font-size: 9px;
  font-style: normal;
  color: rgba(16,185,129,0.55);
  background: rgba(16,185,129,0.08);
  border: 1px solid rgba(16,185,129,0.18);
  border-radius: 3px;
  padding: 0 4px;
  vertical-align: middle;
  font-family: system-ui, sans-serif;
}
.cm-ai-ghost__hint {
  margin-left: 4px;
  font-size: 9px;
  font-style: normal;
  color: rgba(255,255,255,0.2);
  font-family: system-ui, sans-serif;
}

/* Hover actions panel */
.cm-ai-hover {
  display: flex;
  gap: 3px;
  background: #1a1f2e;
  border: 1px solid #2d3748;
  border-radius: 6px;
  padding: 4px 5px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  font-family: system-ui, sans-serif;
  z-index: 9999;
}
.cm-ai-hover__btn {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #6b7280;
  font-size: 10px;
  padding: 3px 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
.cm-ai-hover__btn:hover {
  background: rgba(124,111,255,0.12);
  border-color: rgba(124,111,255,0.3);
  color: #a89fff;
}

/* Lightbulb gutter */
.cm-ai-lightbulb {
  cursor: pointer;
  font-size: 11px;
  line-height: 1.6;
  padding: 0 2px;
  opacity: 0.7;
  transition: opacity 0.12s;
}
.cm-ai-lightbulb:hover { opacity: 1; }

/* Inline diagnostics */
.cm-ai-diag--error   { border-bottom: 2px solid rgba(239,68,68,0.75); }
.cm-ai-diag--warning { border-bottom: 2px solid rgba(245,158,11,0.75); }
.cm-ai-diag--info    { border-bottom: 2px solid rgba(59,130,246,0.55); }

/* CM tooltip override for hover panel */
.cm-tooltip { z-index: 9999; }
`;
  document.head.appendChild(style);
}

// ── Public factory ────────────────────────────────────────────────────────────

/**
 * aiInlineExtension(opts) → CM6 extension array
 *
 * opts:
 *   apiBase       — backend base URL (default '')
 *   onAction(id, ctx) — called when user clicks hover action or lightbulb
 *   onMetric(event, data) — called for telemetry (ghost_triggered, ghost_accepted)
 *   getFileContext() → { filePath, cwd, symbolContext } — live file info
 *   lightbulbLines  — Set<number> of line numbers to show lightbulb on
 */
export function aiInlineExtension(opts = {}) {
  injectCSS();

  const { onAction = () => {}, onMetric = () => {}, getFileContext = () => ({}) } = opts;

  const lightbulbLines = opts.lightbulbLines || new Set();

  const lightbulbGutter = gutter({
    class: 'cm-ai-lightbulb-gutter',
    lineMarker(view, line) {
      const lineNum = view.state.doc.lineAt(line.from).number;
      if (!lightbulbLines.has(lineNum)) return null;
      return new LightbulbMarker((actionId) => {
        onAction(actionId, { lineNum, ...getFileContext() });
      });
    },
    initialSpacer: () => {
      const el = document.createElement('span');
      el.style.width = '16px';
      return new (class extends GutterMarker { toDOM() { return el; } })();
    },
  });

  return [
    ghostState,
    diagsState,
    makeAIPlugin({ onAction, onMetric, apiBase: opts.apiBase || '', getFileContext }),
    makeHoverTooltip(onAction, getFileContext),
    makeTabKeymap(onMetric, getFileContext),
    lightbulbGutter,
    diagPlugin,
    // Expose state effects for external use
    EditorView.theme({
      '.cm-ai-lightbulb-gutter': { width: '16px' },
    }),
  ];
}

// ── Exported effects for wiring from outside ──────────────────────────────────

export { setGhostEffect, setDiagsEffect, ghostState };
