import React, { useState, useEffect, useCallback, useRef } from 'react';
import './GlobalSearch.css';

const BACKEND = process.env.REACT_APP_API_URL || '';
const isElectron = () => !!window.electronAPI?.isElectron;
const api = () => window.electronAPI;

// ── Category metadata ────────────────────────────────────────────────
const CATEGORIES = {
  file:           { icon: '📄', label: 'Files',            order: 10 },
  command:        { icon: '⚡', label: 'Commands',         order: 1  },
  nav:            { icon: '🔗', label: 'Navigate',         order: 2  },
  contact:        { icon: '👤', label: 'Contacts',         order: 6  },
  agent:          { icon: '🤖', label: 'Agents',           order: 4  },
  mission:        { icon: '🎯', label: 'Missions',         order: 3  },
  memory:         { icon: '🧠', label: 'Memory',           order: 5  },
  execution:      { icon: '⚡', label: 'Executions',       order: 7  },
  recommendation: { icon: '✦',  label: 'Recommendations',  order: 8  },
  plugin:         { icon: '⬡',  label: 'Plugins',          order: 9  },
  capability:     { icon: '◈',  label: 'Capabilities',     order: 9  },
  shortcut:       { icon: '⌨',  label: 'Shortcuts',        order: 11 },
};

// ── Static: nav routes ────────────────────────────────────────────────
const NAV_ROUTES = [
  { tab: "home",          label: "Dashboard",                icon: "◈" },
  { tab: "chat",          label: "AI Chat",                  icon: "◎" },
  { tab: "insights",      label: "Pipeline",                 icon: "◇" },
  { tab: "clients",       label: "Contacts",                 icon: "◈" },
  { tab: "payments",      label: "Payments",                 icon: "◻" },
  { tab: "activity",      label: "History",                  icon: "◻" },
  { tab: "jarvisbrain",   label: "Jarvis Brain / Missions",  icon: "🧠" },
  { tab: "execution",     label: "Execution Center",         icon: "⚡" },
  { tab: "reliability",   label: "Reliability",              icon: "◈" },
  { tab: "predict",       label: "Prediction Engine",        icon: "◇" },
  { tab: "guardrails",    label: "Guardrails",               icon: "◻" },
  { tab: "recommend",     label: "Recommendation Center",    icon: "✦" },
  { tab: "executivedash", label: "Executive Dashboard",      icon: "◉" },
  { tab: "memory",        label: "Memory OS",                icon: "◎" },
  { tab: "intel",         label: "Intelligence Panel",       icon: "◈" },
  { tab: "selfimprove",   label: "Self-Improvement Engine",  icon: "⬡" },
  { tab: "agents",        label: "Agent OS",                 icon: "🤖" },
  { tab: "registry",      label: "Agent Registry",           icon: "◈" },
  { tab: "agentfactory",  label: "Agent Factory",            icon: "⬡" },
  { tab: "engineering",   label: "Engineering Center",       icon: "⬡" },
  { tab: "workspace",     label: "Engineering Workspace",    icon: "◇" },
  { tab: "devops",        label: "DevOps Center",            icon: "⬡" },
  { tab: "selfhealing",   label: "Self-Healing",             icon: "✦" },
  { tab: "orchestrator",  label: "Orchestrator",             icon: "◎" },
  { tab: "operations",    label: "Operations",               icon: "◉" },
  { tab: "runtime",       label: "Runtime Execution",        icon: "⬡" },
  { tab: "autonomy",      label: "Autonomous Company",       icon: "◎" },
  { tab: "autonomouswf",  label: "Autonomous Workflows",     icon: "⚡" },
  { tab: "autonomyscore", label: "Autonomy Score",           icon: "◉" },
  { tab: "seo",           label: "SEO Engine",               icon: "◇" },
  { tab: "content",       label: "Content Engine",           icon: "◈" },
  { tab: "social",        label: "Social Hub",               icon: "◉" },
  { tab: "email",         label: "Email Marketing",          icon: "◻" },
  { tab: "team",          label: "Team Workspace",           icon: "◈" },
  { tab: "ecrm",          label: "Enterprise CRM",           icon: "◻" },
  { tab: "knowledge",     label: "Knowledge Base",           icon: "◇" },
  { tab: "settings",      label: "Settings",                 icon: "◈" },
  { tab: "billing",       label: "Billing",                  icon: "◇" },
  { tab: "help",          label: "Help & Guides",            icon: "◎" },
  { tab: "reports",       label: "Reports",                  icon: "◻" },
  { tab: "overview",      label: "Capabilities Overview",    icon: "◻" },
];

const STATIC_ROUTES = NAV_ROUTES.map(r => ({
  type: 'nav',
  id: `nav:${r.tab}`,
  label: r.label,
  subtitle: `Navigate → ${r.tab}`,
  icon: r.icon,
  tab: r.tab,
}));

// ── Static: commands ──────────────────────────────────────────────────
const STATIC_COMMANDS = [
  { type: 'command', id: 'cmd:terminal',   label: 'Open Terminal',              icon: '🖥',  action: 'nav:terminal'  },
  { type: 'command', id: 'cmd:explorer',   label: 'Open File Explorer',         icon: '📁',  action: 'nav:explorer'  },
  { type: 'command', id: 'cmd:openfolder', label: 'Open Folder…',               icon: '📂',  action: 'open-folder'   },
  { type: 'command', id: 'cmd:console',    label: 'Open Engineering Console',   icon: '📊',  action: 'nav:console'   },
  { type: 'command', id: 'cmd:ai',         label: 'Open AI Overlay',            icon: '🤖',  action: 'nav:ai'        },
  { type: 'command', id: 'cmd:aipair',     label: 'Open AI Pair Programming',   icon: '💡',  action: 'nav:pair'      },
  { type: 'command', id: 'cmd:mission',    label: 'New Mission…',               icon: '◎',   action: 'nav:missions'  },
  { type: 'command', id: 'cmd:search',     label: 'Project Search (Find in Files)', icon: '⌕', action: 'nav:search'  },
  { type: 'command', id: 'cmd:symbols',    label: 'File Outline — Symbol Navigation', icon: 'ƒ', action: 'nav:symbols' },
  { type: 'command', id: 'cmd:git',        label: 'Open Visual Git',            icon: '🌿',  action: 'nav:git'       },
  { type: 'command', id: 'cmd:screenshot', label: 'Take Screenshot',            icon: '📸',  action: 'screenshot'    },
  { type: 'command', id: 'cmd:clipboard',  label: 'Clipboard History',          icon: '📋',  action: 'nav:clipboard' },
  { type: 'command', id: 'cmd:settings',   label: 'Open Settings',              icon: '⚙️', action: 'settings'      },
  { type: 'command', id: 'cmd:update',     label: 'Check for Updates',          icon: '🔄',  action: 'update'        },
];

// ── Static: keyboard shortcuts ────────────────────────────────────────
const STATIC_SHORTCUTS = [
  { type: 'shortcut', id: 'sc:cmdK',    label: '⌘K — Global Search / Command Palette',          icon: '⌨', action: null },
  { type: 'shortcut', id: 'sc:cmdP',    label: '⌘P — Quick Switcher (projects, missions, panels)', icon: '⌨', action: null },
  { type: 'shortcut', id: 'sc:cmd1-6', label: '⌘1–6 — Switch sidebar panel',                    icon: '⌨', action: null },
  { type: 'shortcut', id: 'sc:cmdBs',  label: '⌘\\ — Split editor layout',                      icon: '⌨', action: null },
  { type: 'shortcut', id: 'sc:cmdB',   label: '⌘B — Toggle sidebar',                             icon: '⌨', action: null },
  { type: 'shortcut', id: 'sc:cmdShG', label: '⌘⇧G — Visual Git sidebar',                       icon: '⌨', action: 'nav:git' },
  { type: 'shortcut', id: 'sc:cmdShE', label: '⌘⇧E — File Explorer sidebar',                    icon: '⌨', action: 'nav:explorer' },
  { type: 'shortcut', id: 'sc:cmdShF', label: '⌘⇧F — Project Search (Find in Files)',           icon: '⌨', action: 'nav:search' },
  { type: 'shortcut', id: 'sc:cmdShS', label: '⌘⇧S — File Outline & Symbols sidebar',          icon: '⌨', action: 'nav:symbols' },
  { type: 'shortcut', id: 'sc:cmdT',   label: '⌘T — Fuzzy File Search',                         icon: '⌨', action: null },
  { type: 'shortcut', id: 'sc:cmdShO', label: '⌘⇧O — Workspace Symbol Search',                  icon: '⌨', action: null },
  { type: 'shortcut', id: 'sc:f12',    label: 'F12 — Go to Definition',                          icon: '⌨', action: null },
  { type: 'shortcut', id: 'sc:f2',     label: 'F2 — Rename Symbol (current file)',               icon: '⌨', action: null },
  { type: 'shortcut', id: 'sc:altarr', label: 'Alt+←/→ — Navigate Back / Forward',              icon: '⌨', action: null },
  { type: 'shortcut', id: 'sc:cmdShD', label: '⌘⇧D — Debugger panel',                           icon: '⌨', action: 'nav:debugger' },
  { type: 'shortcut', id: 'sc:cmdShP', label: '⌘⇧P — AI Pair panel',                            icon: '⌨', action: 'nav:pair' },
  { type: 'shortcut', id: 'sc:cmdShM', label: '⌘⇧M — Missions panel',                           icon: '⌨', action: 'nav:missions' },
  { type: 'shortcut', id: 'sc:cmdShT', label: '⌘⇧T — Terminal panel',                           icon: '⌨', action: 'nav:terminal' },
  { type: 'shortcut', id: 'sc:cmdTick','label': '⌘⇧` — Toggle bottom panel',                    icon: '⌨', action: null },
  { type: 'shortcut', id: 'sc:esc',    label: 'Esc — Close / Cancel',                            icon: '⌨', action: null },
];

const ALL_STATIC = [...STATIC_COMMANDS, ...STATIC_ROUTES, ...STATIC_SHORTCUTS];

// ── Recent items injected at runtime ─────────────────────────────────
function buildRecentItems(recentMissions = [], recentRepos = []) {
  return [
    ...recentMissions.slice(0, 4).map(m => ({
      type: 'mission', id: `mission:recent:${m.id}`,
      label: m.title || `Mission ${m.id}`,
      subtitle: `recent · ${m.ts ? new Date(m.ts).toLocaleString() : ''}`,
      icon: '◎', tab: 'jarvisbrain', data: m,
    })),
    ...recentRepos.slice(0, 4).map(r => ({
      type: 'nav', id: `nav:repo:${r.path}`,
      label: r.name || r.path.split('/').pop(),
      subtitle: `recent repo · ${r.path}`,
      icon: '📁', _repoPath: r.path,
    })),
  ];
}

// ── Score for ranking ─────────────────────────────────────────────────
function score(item, q) {
  const haystack = `${item.label} ${item.subtitle || ''} ${item.tab || ''}`.toLowerCase();
  const needle = q.toLowerCase().trim();
  if (!needle) return CATEGORIES[item.type]?.order ?? 99;
  if (haystack === needle)             return 0;
  if (haystack.startsWith(needle))     return 1;
  if (item.label.toLowerCase() === needle) return 2;
  if (item.label.toLowerCase().startsWith(needle)) return 3;
  if (haystack.includes(needle))       return 4;
  // Subsequence
  let qi = 0;
  for (let i = 0; i < haystack.length && qi < needle.length; i++) {
    if (haystack[i] === needle[qi]) qi++;
  }
  if (qi === needle.length) return 5 + (needle.length / haystack.length);
  return Infinity;
}

function filterAndRank(items, q) {
  if (!q.trim()) return items.slice(0, 20);
  return items
    .map(i => ({ item: i, s: score(i, q) }))
    .filter(x => x.s < Infinity)
    .sort((a, b) => a.s - b.s)
    .map(x => x.item);
}

// ── Result row ────────────────────────────────────────────────────────
function ResultItem({ item, active, onSelect, q }) {
  const ref = useRef(null);
  useEffect(() => {
    if (active && ref.current) ref.current.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const cat = CATEGORIES[item.type] || { icon: '•', label: item.type };
  const icon = item.icon || cat.icon;

  return (
    <div
      ref={ref}
      className={`gs-result${active ? ' gs-result--active' : ''}`}
      onClick={() => onSelect(item)}
    >
      <span className="gs-result__icon">{icon}</span>
      <div className="gs-result__text">
        <div className="gs-result__label">{highlightMatch(item.label || item.name || item.title, q)}</div>
        {item.subtitle && <div className="gs-result__sub">{item.subtitle}</div>}
      </div>
      <span className="gs-result__type">{cat.label}</span>
    </div>
  );
}

function highlightMatch(text, q) {
  if (!q || !text) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase().trim());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'rgba(124,111,255,0.3)', color: 'inherit', borderRadius: 2 }}>
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

// ── Group results by category for display ─────────────────────────────
function groupResults(items) {
  const groups = {};
  for (const item of items) {
    const g = item.type;
    if (!groups[g]) groups[g] = [];
    groups[g].push(item);
  }
  return Object.entries(groups).sort((a, b) => {
    const oa = CATEGORIES[a[0]]?.order ?? 99;
    const ob = CATEGORIES[b[0]]?.order ?? 99;
    return oa - ob;
  });
}

// ── Clipboard panel ───────────────────────────────────────────────────
function ClipboardHistory({ onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isElectron()) {
      api()?.clipboardGetHistory().then(h => { setHistory(h || []); setLoading(false); });
    } else {
      setLoading(false);
    }
  }, []);

  const paste = useCallback((text) => {
    if (isElectron()) api()?.clipboardWrite(text);
    onClose();
  }, [onClose]);

  return (
    <div className="clipboard-history">
      <div className="clipboard-history__header">
        <span>Clipboard History</span>
        <button className="gs-close-btn" onClick={onClose}>✕</button>
      </div>
      {loading ? (
        <div className="gs-status">Loading…</div>
      ) : !history.length ? (
        <div className="gs-status">No clipboard history.</div>
      ) : (
        <div className="clipboard-history__list">
          {history.map((text, i) => (
            <div key={i} className="clipboard-item" onClick={() => paste(text)} title="Click to copy">
              <span className="clipboard-item__text">{text}</span>
              <span className="clipboard-item__idx">#{i + 1}</span>
            </div>
          ))}
        </div>
      )}
      {history.length > 0 && (
        <div className="clipboard-history__footer">
          <button className="gs-btn" onClick={() => { if (isElectron()) api()?.clipboardClearHistory(); setHistory([]); }}>
            Clear History
          </button>
        </div>
      )}
    </div>
  );
}

export function ClipboardHistoryPanel({ onClose, className = '' }) {
  return <div className={`clipboard-panel ${className}`}><ClipboardHistory onClose={onClose} /></div>;
}

// ── Main spotlight overlay ────────────────────────────────────────────
export default function GlobalSearch({ open, onClose, onAction, recentMissions = [], recentRepos = [] }) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [cursor,  setCursor]  = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef   = useRef(null);
  const debounce   = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      // Show recents first when palette opens with no query
      const recents = buildRecentItems(recentMissions, recentRepos);
      const base = recents.length
        ? [...recents, ...filterAndRank(ALL_STATIC, '').filter(i => !recents.find(r => r.id === i.id))]
        : filterAndRank(ALL_STATIC, '');
      setResults(base.slice(0, 20));
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]); // eslint-disable-line

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (open) onClose?.(); else onAction?.('open-search');
      }
      if (e.key === 'Escape' && open) onClose?.();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, onAction]);

  const search = useCallback(async (q) => {
    const staticHits = filterAndRank(ALL_STATIC, q);
    setResults(staticHits);

    if (!q.trim()) return;

    setLoading(true);
    const term = encodeURIComponent(q);

    const tasks = [];

    // File search (Electron only)
    if (isElectron()) {
      tasks.push(
        api()?.fsSearch('', q).then(paths => (paths || []).slice(0, 6).map(p => ({
          type: 'file', id: `file:${p}`,
          label: p.split('/').pop(), subtitle: p, path: p,
        }))).catch(() => [])
      );
    }

    // Missions
    tasks.push(
      fetch(`${BACKEND}/p27/missions`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then(data => {
          const list = Array.isArray(data) ? data : (data?.missions ?? []);
          return list.filter(m => (m.title || m.name || '').toLowerCase().includes(q.toLowerCase()))
            .slice(0, 5)
            .map(m => ({
              type: 'mission', id: `mission:${m.id}`,
              label: m.title || m.name || m.goal || `Mission ${m.id}`,
              subtitle: `${m.status ?? 'unknown'} · ${m.description?.slice(0, 60) ?? ''}`,
              icon: '🎯', tab: 'jarvisbrain', data: m,
            }));
        }).catch(() => [])
    );

    // Memory search
    tasks.push(
      fetch(`${BACKEND}/p26/memory/search`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, limit: 5 }),
      }).then(r => r.ok ? r.json() : [])
        .then(data => {
          const list = Array.isArray(data) ? data : (data?.results ?? []);
          return list.slice(0, 5).map(m => ({
            type: 'memory', id: `mem:${m.id ?? Math.random()}`,
            label: m.content?.slice(0, 60) || m.text?.slice(0, 60) || 'Memory record',
            subtitle: `${m.type ?? 'memory'} · confidence ${m.confidence ?? '—'}`,
            icon: '🧠', tab: 'memory',
          }));
        }).catch(() => [])
    );

    // Plugins
    tasks.push(
      fetch(`${BACKEND}/p26/plugins`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then(data => {
          const list = Array.isArray(data) ? data : (data?.plugins ?? []);
          return list.filter(p => (p.name || '').toLowerCase().includes(q.toLowerCase()))
            .slice(0, 4)
            .map(p => ({
              type: 'plugin', id: `plugin:${p.id}`,
              label: p.name || p.id, subtitle: p.type || 'plugin',
              icon: '⬡', tab: 'agentfactory',
            }));
        }).catch(() => [])
    );

    // Capabilities
    tasks.push(
      fetch(`${BACKEND}/p26/capabilities`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then(data => {
          const list = Array.isArray(data) ? data : (data?.capabilities ?? []);
          return list.filter(c => (c.name || '').toLowerCase().includes(q.toLowerCase()))
            .slice(0, 4)
            .map(c => ({
              type: 'capability', id: `cap:${c.id}`,
              label: c.name || c.id, subtitle: c.category || 'capability',
              icon: '◈', tab: 'agentfactory',
            }));
        }).catch(() => [])
    );

    // Recommendations
    tasks.push(
      fetch(`${BACKEND}/p26/observer/recommendations`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then(data => {
          const list = Array.isArray(data) ? data : (data?.recommendations ?? []);
          return list.filter(r => (r.title || r.action || '').toLowerCase().includes(q.toLowerCase()))
            .slice(0, 4)
            .map(r => ({
              type: 'recommendation', id: `rec:${r.id ?? Math.random()}`,
              label: r.title || r.action || 'Recommendation',
              subtitle: `priority ${r.priority ?? '—'} · confidence ${r.confidence ?? '—'}%`,
              icon: '✦', tab: 'recommend',
            }));
        }).catch(() => [])
    );

    // CRM contacts + agents
    tasks.push(
      fetch(`${BACKEND}/jarvis/search?q=${term}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : {})
        .then(data => {
          const items = [];
          (data.contacts || []).forEach(c => items.push({
            type: 'contact', id: `contact:${c.phone}`,
            label: c.name || c.phone, subtitle: c.phone, icon: '👤', tab: 'clients', data: c,
          }));
          (data.agents || []).forEach(a => items.push({
            type: 'agent', id: `agent:${a.id}`,
            label: a.name || a.id, subtitle: a.type || 'agent', icon: '🤖', tab: 'agents',
          }));
          return items.slice(0, 8);
        }).catch(() => [])
    );

    const settled = await Promise.allSettled(tasks);
    const remote = settled.flatMap(s => s.status === 'fulfilled' ? s.value : []);

    // Merge static + remote, deduplicate by id, re-rank
    const merged = [...staticHits, ...remote];
    const seen = new Set();
    const deduped = merged.filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true; });
    const ranked = filterAndRank(deduped, q);

    setResults(ranked.slice(0, 40));
    setCursor(0);
    setLoading(false);
  }, []);

  const onInput = useCallback((e) => {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(q), 220);
  }, [search]);

  const onKey = useCallback((e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === 'Enter')     { e.preventDefault(); if (results[cursor]) select(results[cursor]); }
    if (e.key === 'Escape')    { onClose?.(); }
  }, [results, cursor]); // eslint-disable-line

  const select = useCallback((item) => {
    onClose?.();
    if (!item) return;
    if (item.type === 'nav' && item.tab) { onAction?.('nav:tab', item); return; }
    if (item.type === 'mission' && item.tab) { onAction?.('nav:tab', item); return; }
    if (item.type === 'memory' && item.tab) { onAction?.('nav:tab', item); return; }
    if (item.type === 'plugin' && item.tab) { onAction?.('nav:tab', item); return; }
    if (item.type === 'capability' && item.tab) { onAction?.('nav:tab', item); return; }
    if (item.type === 'recommendation' && item.tab) { onAction?.('nav:tab', item); return; }
    if (item.type === 'agent' && item.tab) { onAction?.('nav:tab', item); return; }
    if (item.type === 'contact') { onAction?.('nav:tab', { tab: 'clients', ...item }); return; }
    if (item.type === 'file') { if (isElectron()) api()?.fsOpenPath(item.path); onAction?.('open-file', item); return; }
    if (item.type === 'shortcut') return;
    onAction?.(item.action || `open:${item.type}`, item);
  }, [onClose, onAction]);

  if (!open) return null;

  const grouped = groupResults(results);
  const flatForCursor = results;

  return (
    <div className="gs-backdrop" onClick={onClose}>
      <div className="gs-modal" onClick={e => e.stopPropagation()}>
        <div className="gs-input-row">
          <span className="gs-search-icon">⌕</span>
          <input
            ref={inputRef}
            className="gs-input"
            placeholder="Search missions, agents, memory, routes, commands… (⌘K)"
            value={query}
            onChange={onInput}
            onKeyDown={onKey}
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <span className="gs-spinner">⟳</span>}
          <button className="gs-close-btn" onClick={onClose}>Esc</button>
        </div>

        {results.length > 0 && (
          <div className="gs-results">
            {grouped.map(([type, items]) => (
              <div key={type} className="gs-group">
                <div className="gs-group__label">
                  {CATEGORIES[type]?.icon} {CATEGORIES[type]?.label || type}
                </div>
                {items.map((item) => {
                  const globalIdx = flatForCursor.indexOf(item);
                  return (
                    <ResultItem
                      key={item.id}
                      item={item}
                      active={globalIdx === cursor}
                      onSelect={select}
                      q={query}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {!loading && query && results.length === 0 && (
          <div className="gs-status">No results for "{query}"</div>
        )}

        <div className="gs-footer">
          <span className="gs-hint">↑↓ navigate</span>
          <span className="gs-hint">↵ select</span>
          <span className="gs-hint">⌘K toggle</span>
          <span className="gs-hint">Esc close</span>
        </div>
      </div>
    </div>
  );
}
