import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import "./CommandPalette.css";

// ── Action registry ────────────────────────────────────────────────

const NAV_ACTIONS = [
  { id: "nav-home",       label: "Open Control Center",   icon: "◈", group: "Navigate", tab: "home"       },
  { id: "nav-runtime",    label: "Open Execution",        icon: "⬡", group: "Navigate", tab: "runtime"    },
  { id: "nav-chat",       label: "Open Intelligence",     icon: "◎", group: "Navigate", tab: "chat"       },
  { id: "nav-insights",   label: "Open Pipeline",         icon: "◇", group: "Navigate", tab: "insights"   },
  { id: "nav-clients",    label: "Open Contacts",         icon: "◈", group: "Navigate", tab: "clients"    },
  { id: "nav-activity",   label: "Open History",          icon: "◻", group: "Navigate", tab: "activity"   },
  { id: "nav-business",   label: "Open Business OS",      icon: "◉", group: "Navigate", tab: "business"   },
  { id: "nav-developer",  label: "Open Developer OS",     icon: "◈", group: "Navigate", tab: "developer"  },
  { id: "nav-enterprise", label: "Open Enterprise OS",    icon: "◎", group: "Navigate", tab: "enterprise" },
  { id: "nav-personal",   label: "Open Personal OS",      icon: "◇", group: "Navigate", tab: "personal"   },
  { id: "nav-overview",   label: "Open Capabilities",     icon: "◻", group: "Navigate", tab: "overview"   },
];

const QUICK_ACTIONS = [
  { id: "qa-ask",         label: "Ask Ooplix",            icon: "✦", group: "Actions",  type: "ask"       },
  { id: "qa-contact",     label: "Add Contact",           icon: "＋", group: "Actions",  type: "nav", tab: "clients" },
  { id: "qa-workflow",    label: "Create Workflow",       icon: "⚡", group: "Actions",  type: "nav", tab: "runtime" },
];

const ALL_ACTIONS = [...NAV_ACTIONS, ...QUICK_ACTIONS];

// ── Fuzzy scorer ───────────────────────────────────────────────────

function _score(label, query) {
  const l = label.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  if (l === q)           return 100;
  if (l.startsWith(q))   return 80;
  if (l.includes(q))     return 60;
  // Character subsequence
  let qi = 0;
  for (let i = 0; i < l.length && qi < q.length; i++) {
    if (l[i] === q[qi]) qi++;
  }
  if (qi === q.length) return 30 + (q.length / l.length) * 20;
  return 0;
}

function _highlight(label, query) {
  if (!query.trim()) return label;
  const q = query.toLowerCase().trim();
  const l = label.toLowerCase();
  const idx = l.indexOf(q);
  if (idx === -1) return label;
  return (
    <>
      {label.slice(0, idx)}
      <mark>{label.slice(idx, idx + q.length)}</mark>
      {label.slice(idx + q.length)}
    </>
  );
}

// ── Component ──────────────────────────────────────────────────────

export default function CommandPalette({ open, onClose, onNavigate, onAsk }) {
  const [query,   setQuery]   = useState("");
  const [active,  setActive]  = useState(0);
  const inputRef  = useRef(null);
  const listRef   = useRef(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const results = useMemo(() => {
    return ALL_ACTIONS
      .map(a => ({ ...a, score: _score(a.label, query) }))
      .filter(a => a.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [query]);

  // Clamp active index when results change
  useEffect(() => {
    setActive(prev => Math.min(prev, Math.max(0, results.length - 1)));
  }, [results.length]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const execute = useCallback((action) => {
    if (!action) return;
    onClose();
    if (action.type === "ask") {
      onNavigate?.("chat");
      // Pre-fill the chat with the query as a task
      if (query.trim() && query.trim().toLowerCase() !== "ask ooplix") {
        setTimeout(() => onAsk?.(query.trim()), 120);
      }
      return;
    }
    if (action.tab) {
      onNavigate?.(action.tab);
    }
  }, [onClose, onNavigate, onAsk, query]);

  const handleKey = useCallback((e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(i => Math.min(i + 1, results.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      execute(results[active]);
    }
  }, [results, active, execute, onClose]);

  if (!open) return null;

  // Group results for display
  const grouped = results.reduce((acc, action, idx) => {
    const g = action.group;
    if (!acc[g]) acc[g] = [];
    acc[g].push({ ...action, _idx: idx });
    return acc;
  }, {});

  return (
    <div className="cp-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="cp-panel animate-fade-up" onClick={e => e.stopPropagation()}>

        {/* Input */}
        <div className="cp-input-row">
          <span className="cp-search-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            className="cp-input"
            placeholder="Type a command or search…"
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={handleKey}
            autoComplete="off"
            spellCheck={false}
            aria-label="Command search"
          />
          {query && (
            <button className="cp-clear" onClick={() => { setQuery(""); inputRef.current?.focus(); }}>
              ✕
            </button>
          )}
          <kbd className="cp-esc-hint">ESC</kbd>
        </div>

        {/* Results */}
        <div className="cp-results" ref={listRef} role="listbox">
          {results.length === 0 ? (
            <div className="cp-empty">
              <span className="cp-empty-icon">◎</span>
              <p>No commands found for <strong>"{query}"</strong></p>
            </div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="cp-group">
                <div className="cp-group-label section-label">{group}</div>
                {items.map(action => (
                  <button
                    key={action.id}
                    data-idx={action._idx}
                    className={`cp-item${action._idx === active ? " cp-item--active" : ""}`}
                    onMouseEnter={() => setActive(action._idx)}
                    onClick={() => execute(action)}
                    role="option"
                    aria-selected={action._idx === active}
                  >
                    <span className="cp-item-icon" aria-hidden="true">{action.icon}</span>
                    <span className="cp-item-label">
                      {_highlight(action.label, query)}
                    </span>
                    {action._idx === active && (
                      <kbd className="cp-item-enter">↵</kbd>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="cp-footer">
          <span className="cp-hint"><kbd>↑↓</kbd> navigate</span>
          <span className="cp-hint"><kbd>↵</kbd> select</span>
          <span className="cp-hint"><kbd>ESC</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
