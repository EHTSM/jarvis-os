/**
 * CodeEditorPane — J2 Engineering Code Workspace
 * Integrated code editor: tabs, dirty indicators, session restore,
 * AI right-click context menu, mission jump-to-line, inline diagnostics.
 */
import React, {
  useState, useEffect, useCallback, useRef, useMemo, memo,
} from 'react';
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, highlightSpecialChars, dropCursor, rectangularSelection, crosshairCursor } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBracketsKeymap, closeBrackets } from '@codemirror/autocomplete';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import './CodeEditorPane.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const SESSION_KEY    = 'code-editor-session-j2';
const MAX_TABS       = 20;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const LANG_MAP = {
  js:  () => javascript({ jsx: true }),
  jsx: () => javascript({ jsx: true }),
  ts:  () => javascript({ jsx: true, typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  mjs: () => javascript(),
  cjs: () => javascript(),
  css:  () => css(),
  scss: () => css(),
  html: () => html(),
  htm:  () => html(),
  json: () => json(),
  py:   () => python(),
  md:       () => markdown(),
  markdown: () => markdown(),
  xml: () => xml(),
  svg: () => xml(),
};

function langForPath(path) {
  const ext = (path || '').split('.').pop().toLowerCase();
  return LANG_MAP[ext]?.() ?? null;
}

// ── IPC helpers ───────────────────────────────────────────────────────────────

const api        = () => window.electronAPI;
const isElectron = () => !!window.electronAPI?.isElectron;

async function readFile(filePath) {
  if (!isElectron()) throw new Error('Desktop only');
  const r = await api().fsReadFile({ filePath, encoding: 'utf8' });
  if (r?.error) throw new Error(r.error);
  return r.content ?? r.data ?? '';
}

async function writeFile(filePath, data) {
  if (!isElectron()) throw new Error('Desktop only');
  const r = await api().fsWriteFile({ filePath, data });
  if (r?.error) throw new Error(r.error);
}

async function shellExec(command) {
  if (!isElectron()) return { error: 'Desktop only' };
  return api().shellExec({ command });
}

// ── Session persistence ───────────────────────────────────────────────────────

async function loadEditorSession() {
  if (!isElectron()) return null;
  try { const r = await api().storeGet(SESSION_KEY); return r?.value || null; } catch { return null; }
}

async function saveEditorSession(state) {
  if (!isElectron()) return;
  try { await api().storeSet(SESSION_KEY, state); } catch {}
}

// ── Shared base extensions (no language, no update listener) ─────────────────

function buildBaseExtensions(langComp, wordWrapComp) {
  return [
    lineNumbers(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    foldGutter(),
    highlightActiveLine(),
    // Multi-cursor: Alt+click adds cursor; Alt+drag adds rectangular selection
    rectangularSelection(),
    crosshairCursor(),
    closeBrackets(),
    autocompletion(),
    // Built-in find panel (Cmd+F)
    search({ top: true }),
    keymap.of([...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    oneDark,
    langComp.of([]),
    wordWrapComp.of([]),
    EditorView.theme({
      '&': { height: '100%', fontSize: '13px' },
      '.cm-scroller': {
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        overflow: 'auto',
      },
      '.cm-gutters': {
        backgroundColor: 'rgba(0,0,0,0)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
      },
      // Find panel styling
      '.cm-search': {
        backgroundColor: '#1e2235',
        borderTop: '1px solid rgba(255,255,255,0.1)',
      },
      '.cm-search input': {
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '4px',
        color: '#e8ecf4',
        padding: '2px 6px',
      },
      '.cm-search button': {
        background: 'rgba(124,111,255,0.15)',
        border: '1px solid rgba(124,111,255,0.3)',
        borderRadius: '4px',
        color: '#a89fff',
        cursor: 'pointer',
      },
    }),
  ];
}

// ── Single editor panel — each tab gets its own mounted CodeMirror ────────────

const EditorPanel = memo(function EditorPanel({ tab, active, onDirty, onContextMenu, onViewReady, wordWrap }) {
  const containerRef = useRef(null);
  const viewRef      = useRef(null);
  const langComp     = useRef(new Compartment());
  const wrapComp     = useRef(new Compartment());

  // Toggle word wrap dynamically without remounting
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: wrapComp.current.reconfigure(wordWrap ? [EditorView.lineWrapping] : []) });
  }, [wordWrap]);

  useEffect(() => {
    if (!containerRef.current) return;

    const lang = langForPath(tab.path);
    const extensions = [
      ...buildBaseExtensions(langComp.current, wrapComp.current),
      langComp.current.reconfigure(lang ? [lang] : []),
      wrapComp.current.reconfigure(wordWrap ? [EditorView.lineWrapping] : []),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          const current = update.state.doc.toString();
          onDirty(tab.id, current !== tab.savedContent);
        }
      }),
      EditorView.domEventHandlers({
        contextmenu: (event, view) => {
          onContextMenu?.(event, view, tab);
          return false;
        },
      }),
    ];

    const state = EditorState.create({ doc: tab.content || '', extensions });
    const view  = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    onViewReady?.(tab.id, view);

    return () => {
      view.destroy();
      viewRef.current = null;
      onViewReady?.(tab.id, null);
    };
  }, []); // eslint-disable-line

  return (
    <div
      className="cep-editor-panel"
      ref={containerRef}
      style={{ display: active ? 'flex' : 'none', flexDirection: 'column' }}
    />
  );
});

// ── Tab bar ───────────────────────────────────────────────────────────────────

const TabBar = memo(function TabBar({ tabs, activeId, onSelect, onClose, onPin }) {
  return (
    <div className="cep-tabbar" role="tablist">
      {tabs.map(tab => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          className={[
            'cep-tab',
            tab.id === activeId ? 'cep-tab--active' : '',
            tab.dirty   ? 'cep-tab--dirty'  : '',
            tab.pinned  ? 'cep-tab--pinned' : '',
          ].filter(Boolean).join(' ')}
          onClick={() => onSelect(tab.id)}
          title={tab.path}
        >
          {tab.pinned && (
            <span className="cep-tab__pin" title="Unpin" onClick={e => { e.stopPropagation(); onPin(tab.id, false); }}>
              ◈
            </span>
          )}
          <span className="cep-tab__name">{tab.name}</span>
          {tab.dirty && <span className="cep-tab__dirty" title="Unsaved">●</span>}
          <button
            className="cep-tab__close"
            onClick={e => { e.stopPropagation(); onClose(tab.id); }}
            aria-label="Close tab"
          >✕</button>
        </div>
      ))}
    </div>
  );
});

// ── Rename dialog ─────────────────────────────────────────────────────────────

function RenameDialog({ path, onConfirm, onCancel }) {
  const [value, setValue] = useState(path.split('/').pop());
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.select(); }, []);
  return (
    <div className="cep-rename-overlay" onClick={onCancel}>
      <div className="cep-rename-dialog" onClick={e => e.stopPropagation()}>
        <div className="cep-rename-title">Rename File</div>
        <input
          ref={inputRef}
          className="cep-rename-input"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter')  onConfirm(value);
            if (e.key === 'Escape') onCancel();
          }}
        />
        <div className="cep-rename-actions">
          <button className="cep-btn cep-btn--sm" onClick={onCancel}>Cancel</button>
          <button className="cep-btn cep-btn--sm cep-btn--primary" onClick={() => onConfirm(value)}>Rename</button>
        </div>
      </div>
    </div>
  );
}

// ── AI Context Menu ───────────────────────────────────────────────────────────

function AIContextMenu({ x, y, selection, filePath, onAction, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const ACTIONS = [
    { id: 'explain', label: 'Explain code',   icon: '◈' },
    { id: 'usages',  label: 'Find usages',     icon: '⌕' },
    { id: 'patch',   label: 'Generate patch',  icon: '⧗' },
    { id: 'mission', label: 'Create mission',  icon: '◎' },
    { id: 'review',  label: 'Review file',     icon: '★' },
  ];

  return (
    <div ref={ref} className="cep-ai-menu" style={{ left: x, top: y }}>
      <div className="cep-ai-menu__header">AI Actions</div>
      {ACTIONS.map(a => (
        <button
          key={a.id}
          className="cep-ai-menu__item"
          onClick={() => { onAction(a.id, { selection, filePath }); onClose(); }}
        >
          <span className="cep-ai-menu__icon">{a.icon}</span>
          {a.label}
        </button>
      ))}
    </div>
  );
}

// ── Problems panel ────────────────────────────────────────────────────────────

function ProblemRow({ item, onJump }) {
  return (
    <div className={`cep-problem cep-problem--${item.severity || 'info'}`} onClick={() => onJump?.(item)}>
      <span className="cep-problem__icon">
        {item.severity === 'error' ? '✖' : item.severity === 'warning' ? '⚠' : 'ℹ'}
      </span>
      <span className="cep-problem__msg">{item.message}</span>
      {item.file && (
        <span className="cep-problem__loc">
          {item.file.split('/').pop()}{item.line ? `:${item.line}` : ''}
        </span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CodeEditorPane({
  initialPath,
  missionJump,
  onOpenMission,
  diagnostics = [],
  className = '',
  cwd,
  onRunInTerminal,
}) {
  const [tabs,          setTabs]          = useState([]);
  const [activeId,      setActiveId]      = useState(null);
  const [sessionLoaded, setLoaded]        = useState(false);
  const [renaming,      setRenaming]      = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // tabId to confirm delete
  const [aiMenu,        setAiMenu]        = useState(null);
  const [bottomTab,     setBottomTab]     = useState('problems');
  const [showBottom,    setShowBottom]    = useState(false);
  const [statusMsg,     setStatusMsg]     = useState('');
  const [wordWrap,      setWordWrap]      = useState(false);
  const [gotoLine,      setGotoLine]      = useState(false);
  const [gotoValue,     setGotoValue]     = useState('');
  const [runMenu,       setRunMenu]       = useState(false);
  const gotoRef = useRef(null);
  const viewMap = useRef({});   // tabId → EditorView
  const autoSaveRef = useRef(null);

  const genId = () => `t${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

  const status = useCallback((msg, ms = 2500) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(s => (s === msg ? '' : s)), ms);
  }, []);

  const activeTab = useMemo(() => tabs.find(t => t.id === activeId) ?? null, [tabs, activeId]);

  // ── Open file ────────────────────────────────────────────────────────────

  const openFile = useCallback(async (filePath) => {
    const exists = tabs.find(t => t.path === filePath);
    if (exists) { setActiveId(exists.id); return; }
    if (tabs.length >= MAX_TABS) { status('Max tabs reached'); return; }
    try {
      const content = await readFile(filePath);
      if (content.length > MAX_FILE_BYTES) { status('File too large to edit'); return; }
      const id  = genId();
      setTabs(prev => [...prev, {
        id, path: filePath, name: filePath.split('/').pop(),
        content, savedContent: content, dirty: false, pinned: false,
      }]);
      setActiveId(id);
    } catch (e) {
      status(`Cannot open: ${e.message}`);
    }
  }, [tabs, status]); // eslint-disable-line

  // ── Session restore ──────────────────────────────────────────────────────

  useEffect(() => {
    loadEditorSession().then(async s => {
      if (s?.tabs?.length) {
        const restored = [];
        for (const t of s.tabs) {
          try {
            const content = await readFile(t.path);
            restored.push({ id: genId(), path: t.path, name: t.path.split('/').pop(), content, savedContent: content, dirty: false, pinned: !!t.pinned });
          } catch {}
        }
        if (restored.length) {
          setTabs(restored);
          const active = s.activePath ? restored.find(t => t.path === s.activePath) : null;
          setActiveId((active ?? restored[0]).id);
        }
      }
      setLoaded(true);
    });
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!sessionLoaded) return;
    const t = setTimeout(() => {
      saveEditorSession({ tabs: tabs.map(t => ({ path: t.path, pinned: t.pinned })), activePath: activeTab?.path });
    }, 800);
    return () => clearTimeout(t);
  }, [tabs, activeTab, sessionLoaded]);

  // Open initial path
  useEffect(() => {
    if (sessionLoaded && initialPath) openFile(initialPath);
  }, [sessionLoaded, initialPath]); // eslint-disable-line

  // Mission jump
  useEffect(() => {
    if (!missionJump?.filePath) return;
    openFile(missionJump.filePath).then(() => {
      if (!missionJump.startLine) return;
      setTimeout(() => {
        const view = viewMap.current[tabs.find(t => t.path === missionJump.filePath)?.id];
        if (!view) return;
        try {
          const line = view.state.doc.line(missionJump.startLine);
          view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
        } catch {}
      }, 300);
    });
  }, [missionJump]); // eslint-disable-line

  useEffect(() => {
    if (diagnostics.length > 0) { setShowBottom(true); setBottomTab('problems'); }
  }, [diagnostics]);

  // ── Tab operations ───────────────────────────────────────────────────────

  const closeTab = useCallback((id) => {
    setTabs(prev => {
      const idx  = prev.findIndex(t => t.id === id);
      const next = prev.filter(t => t.id !== id);
      if (activeId === id) setActiveId(next[Math.min(idx, next.length - 1)]?.id ?? null);
      return next;
    });
  }, [activeId]);

  const markDirty = useCallback((id, isDirty) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, dirty: isDirty } : t));
  }, []);

  const pinTab = useCallback((id, pinned) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, pinned } : t));
  }, []);

  const handleViewReady = useCallback((id, view) => {
    if (view) viewMap.current[id] = view;
    else delete viewMap.current[id];
  }, []);

  // ── Save ─────────────────────────────────────────────────────────────────

  const saveActive = useCallback(async () => {
    if (!activeTab) return;
    const view    = viewMap.current[activeTab.id];
    const content = view ? view.state.doc.toString() : activeTab.content;
    try {
      await writeFile(activeTab.path, content);
      setTabs(prev => prev.map(t => t.id === activeTab.id ? { ...t, dirty: false, savedContent: content, content } : t));
      status(`Saved ${activeTab.name}`);
    } catch (e) {
      status(`Save failed: ${e.message}`, 4000);
    }
  }, [activeTab, status]);

  // ── Auto-save dirty files every 4 seconds ────────────────────────────────
  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  useEffect(() => {
    autoSaveRef.current = setInterval(async () => {
      const dirtyTabs = tabsRef.current.filter(t => t.dirty && t.path);
      for (const tab of dirtyTabs) {
        const view    = viewMap.current[tab.id];
        const content = view ? view.state.doc.toString() : tab.content;
        try {
          await writeFile(tab.path, content);
          setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, dirty: false, savedContent: content, content } : t));
        } catch {}
      }
    }, 4000);
    return () => clearInterval(autoSaveRef.current);
  }, []);

  const jumpToLine = useCallback((lineNum) => {
    if (!activeTab) return;
    const view = viewMap.current[activeTab.id];
    if (!view) return;
    try {
      const n = Math.max(1, Math.min(lineNum, view.state.doc.lines));
      const line = view.state.doc.line(n);
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
      });
      view.focus();
    } catch {}
  }, [activeTab]);

  const closeActiveTab = useCallback(() => {
    if (activeId) closeTab(activeId);
  }, [activeId, closeTab]);

  const switchTab = useCallback((dir) => {
    if (!tabs.length) return;
    const idx  = tabs.findIndex(t => t.id === activeId);
    const next = tabs[(idx + dir + tabs.length) % tabs.length];
    if (next) setActiveId(next.id);
  }, [tabs, activeId]);

  useEffect(() => {
    const handler = e => {
      const ctrl = e.metaKey || e.ctrlKey;
      if (!ctrl) return;
      // Cmd+S — save
      if (e.key === 's' && !e.shiftKey) { e.preventDefault(); saveActive(); return; }
      // Cmd+W — close active tab
      if (e.key === 'w') { e.preventDefault(); closeActiveTab(); return; }
      // Cmd+Shift+[ — prev tab
      if (e.key === '[' && e.shiftKey) { e.preventDefault(); switchTab(-1); return; }
      // Cmd+Shift+] — next tab
      if (e.key === ']' && e.shiftKey) { e.preventDefault(); switchTab(1); return; }
      // Ctrl+G — go to line
      if (e.key === 'g' && !e.shiftKey) {
        e.preventDefault();
        setGotoLine(true);
        setGotoValue('');
        setTimeout(() => gotoRef.current?.focus(), 40);
        return;
      }
      // Cmd+Shift+W — toggle word wrap
      if (e.key === 'w' && e.shiftKey) { e.preventDefault(); setWordWrap(w => !w); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveActive, closeActiveTab, switchTab]);

  // ── File operations ──────────────────────────────────────────────────────

  const renameFile = useCallback(async (id, newName) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    const dir     = tab.path.split('/').slice(0, -1).join('/');
    const newPath = `${dir}/${newName}`;
    try {
      const r = await shellExec(`mv "${tab.path}" "${newPath}"`);
      if (r?.code !== 0 && r?.stderr) throw new Error(r.stderr);
      setTabs(prev => prev.map(t => t.id === id ? { ...t, path: newPath, name: newName } : t));
      status(`Renamed to ${newName}`);
    } catch (e) { status(`Rename failed: ${e.message}`, 4000); }
    setRenaming(null);
  }, [tabs, status]);

  const deleteFile = useCallback((id) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    setDeleteConfirm(id);
  }, [tabs]);

  const deleteFileConfirmed = useCallback(async () => {
    const id  = deleteConfirm;
    const tab = tabs.find(t => t.id === id);
    setDeleteConfirm(null);
    if (!tab) return;
    try {
      await shellExec(`rm "${tab.path}"`);
      closeTab(id);
      status(`Deleted ${tab.name}`);
    } catch (e) { status(`Delete failed: ${e.message}`, 4000); }
  }, [deleteConfirm, tabs, closeTab, status]);

  const duplicateFile = useCallback(async (id) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    const ext  = tab.name.includes('.') ? '.' + tab.name.split('.').pop() : '';
    const base = tab.name.replace(/\.[^.]+$/, '');
    const dir  = tab.path.split('/').slice(0, -1).join('/');
    const dst  = `${dir}/${base}_copy${ext}`;
    try {
      await shellExec(`cp "${tab.path}" "${dst}"`);
      await openFile(dst);
      status(`Duplicated`);
    } catch (e) { status(`Duplicate failed: ${e.message}`, 4000); }
  }, [tabs, openFile, status]);

  const revealFile = useCallback((id) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab || !isElectron()) return;
    api()?.fsOpenPath?.(tab.path.split('/').slice(0, -1).join('/'));
  }, [tabs]);

  // ── Run script ───────────────────────────────────────────────────────────

  const runScript = useCallback(async (cmd) => {
    setRunMenu(false);
    if (!isElectron() || !cwd) return;
    status(`Running: ${cmd}…`);
    onRunInTerminal?.();
    // Give terminal a tick to open/focus before dispatching
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('terminal-run', { detail: { command: cmd, cwd } }));
    }, 120);
  }, [cwd, onRunInTerminal, status]);

  // ── Context menu ─────────────────────────────────────────────────────────

  const handleEditorContextMenu = useCallback((e, view, tab) => {
    e.preventDefault();
    const sel = view?.state?.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) || '';
    setAiMenu({ x: e.clientX, y: e.clientY, selection: sel, filePath: tab.path });
  }, []);

  const handleAIAction = useCallback(async (actionId, { selection, filePath }) => {
    const capMap = {
      explain: 'code.explain',
      usages:  'code.findUsages',
      patch:   'code.generatePatch',
      mission: 'mission.create',
      review:  'code.review',
    };
    const capability = capMap[actionId];
    if (!capability) return;
    try {
      window.dispatchEvent(new CustomEvent('jarvis-capability', { detail: { capability, payload: { filePath, selection, source: 'code-editor' } } }));
      const { BASE_URL } = await import('../_client');
      fetch(`${BASE_URL}/capabilities/execute`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability, payload: { filePath, selection } }),
      }).catch(() => {});
      status(`AI: ${actionId} dispatched`);
    } catch { status('AI action sent'); }
  }, [status]);

  const handleTabContextMenu = useCallback((e, tabId) => {
    if (!isElectron()) return;
    e.preventDefault();
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    const items = [
      { id: 'save',         label: 'Save' },
      { id: 'pin',          label: tab.pinned ? 'Unpin Tab' : 'Pin Tab' },
      { type: 'separator' },
      { id: 'rename',       label: 'Rename…' },
      { id: 'duplicate',    label: 'Duplicate' },
      { id: 'reveal',       label: 'Reveal in Finder' },
      { type: 'separator' },
      { id: 'delete',       label: 'Delete File' },
      { type: 'separator' },
      { id: 'close',        label: 'Close Tab' },
      { id: 'close-others', label: 'Close Other Tabs' },
    ];
    api()?.showContextMenu(items);
    const cleanup = api()?.onContextMenuAction?.((action) => {
      switch (action) {
        case 'save':         saveActive(); break;
        case 'pin':          pinTab(tabId, !tab.pinned); break;
        case 'rename':       setRenaming({ id: tabId, path: tab.path }); break;
        case 'duplicate':    duplicateFile(tabId); break;
        case 'reveal':       revealFile(tabId); break;
        case 'delete':       deleteFile(tabId); break;
        case 'close':        closeTab(tabId); break;
        case 'close-others': setTabs(prev => prev.filter(t => t.id === tabId)); setActiveId(tabId); break;
        default: break;
      }
      cleanup?.();
    });
  }, [tabs, saveActive, pinTab, duplicateFile, revealFile, deleteFile, closeTab]);

  // ── Expose openFile for external callers ─────────────────────────────────

  useEffect(() => {
    const handler = e => { if (e.detail?.filePath) openFile(e.detail.filePath); };
    window.addEventListener('cep-open-file', handler);
    return () => window.removeEventListener('cep-open-file', handler);
  }, [openFile]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isElectron()) {
    return <div className={`cep-unavailable ${className}`}>Code editor requires the desktop app.</div>;
  }

  const confirmDeleteTab = tabs.find(t => t.id === deleteConfirm);

  return (
    <div className={`cep-shell ${className}`}>
      {/* Delete confirmation modal */}
      {confirmDeleteTab && (
        <div className="cep-delete-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="cep-delete-modal" onClick={e => e.stopPropagation()}>
            <div className="cep-delete-icon">🗑</div>
            <div className="cep-delete-title">Delete "{confirmDeleteTab.name}"?</div>
            <div className="cep-delete-body">This cannot be undone.</div>
            <div className="cep-delete-actions">
              <button className="cep-delete-btn cep-delete-btn--cancel" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="cep-delete-btn cep-delete-btn--confirm" onClick={deleteFileConfirmed}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      {tabs.length > 0 ? (
        <div
          className="cep-tabbar-wrap"
          onContextMenu={e => {
            const el = e.target.closest('[role="tab"]');
            if (!el) return;
            const idx   = Array.from(el.parentNode.children).indexOf(el);
            const tabId = tabs[idx]?.id;
            if (tabId) handleTabContextMenu(e, tabId);
          }}
        >
          <TabBar tabs={tabs} activeId={activeId} onSelect={setActiveId} onClose={closeTab} onPin={pinTab} />
          <div className="cep-tabbar-actions">
            {cwd && (
              <div className="cep-run-wrap">
                <button
                  className="cep-icon-btn cep-run-btn"
                  onClick={() => setRunMenu(m => !m)}
                  title="Run script in terminal"
                >▶</button>
                {runMenu && (
                  <div className="cep-run-menu" onMouseLeave={() => setRunMenu(false)}>
                    {[
                      { label: 'npm test',    cmd: 'npm test'    },
                      { label: 'npm start',   cmd: 'npm start'   },
                      { label: 'npm run build', cmd: 'npm run build' },
                      { label: 'npm run lint',  cmd: 'npm run lint'  },
                    ].map(({ label, cmd }) => (
                      <button key={cmd} className="cep-run-item" onClick={() => runScript(cmd)}>{label}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              className={`cep-icon-btn${wordWrap ? ' cep-icon-btn--active' : ''}`}
              onClick={() => setWordWrap(w => !w)}
              title="Toggle word wrap (⌘⇧W)"
            >↩</button>
            <button
              className="cep-icon-btn"
              onClick={() => { setGotoLine(true); setGotoValue(''); setTimeout(() => gotoRef.current?.focus(), 40); }}
              title="Go to line (Ctrl+G)"
            >:</button>
            <button
              className="cep-icon-btn"
              onClick={saveActive}
              disabled={!activeTab?.dirty}
              title="Save (⌘S)"
            >⬇</button>
          </div>
        </div>
      ) : (
        <div className="cep-welcome">
          <div className="cep-welcome__icon">◻</div>
          <div className="cep-welcome__title">No file open</div>
          <div className="cep-welcome__hint">Open a file from the Explorer sidebar (⌘⇧E)</div>
        </div>
      )}

      {/* Editor panels — all mounted, hidden via display:none */}
      <div className="cep-editors">
        {tabs.map(tab => (
          <EditorPanel
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            onDirty={markDirty}
            onContextMenu={handleEditorContextMenu}
            onViewReady={handleViewReady}
            wordWrap={wordWrap}
          />
        ))}
      </div>

      {/* Go-to-line overlay */}
      {gotoLine && (
        <div className="cep-goto-overlay" onClick={() => setGotoLine(false)}>
          <div className="cep-goto-dialog" onClick={e => e.stopPropagation()}>
            <span className="cep-goto-label">Go to line</span>
            <input
              ref={gotoRef}
              className="cep-goto-input"
              type="number"
              min="1"
              value={gotoValue}
              placeholder="Line number…"
              onChange={e => setGotoValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const n = parseInt(gotoValue, 10);
                  if (!isNaN(n)) jumpToLine(n);
                  setGotoLine(false);
                }
                if (e.key === 'Escape') setGotoLine(false);
              }}
            />
          </div>
        </div>
      )}

      {/* Bottom panel */}
      {showBottom && (
        <div className="cep-bottom">
          <div className="cep-bottom__tabs">
            <button className={`cep-bottom__tab${bottomTab === 'problems' ? ' cep-bottom__tab--active' : ''}`} onClick={() => setBottomTab('problems')}>
              Problems{diagnostics.length ? ` (${diagnostics.length})` : ''}
            </button>
            <button className={`cep-bottom__tab${bottomTab === 'output' ? ' cep-bottom__tab--active' : ''}`} onClick={() => setBottomTab('output')}>
              Output
            </button>
            <button className="cep-bottom__close" onClick={() => setShowBottom(false)}>✕</button>
          </div>
          <div className="cep-bottom__body">
            {bottomTab === 'problems' && (
              diagnostics.length === 0
                ? <div className="cep-problems-empty">No problems detected.</div>
                : diagnostics.map((d, i) => (
                    <ProblemRow key={i} item={d} onJump={item => item.file && openFile(item.file)} />
                  ))
            )}
            {bottomTab === 'output' && (
              <div className="cep-output">{statusMsg || 'No output.'}</div>
            )}
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="cep-statusbar">
        {activeTab ? (
          <>
            <span className="cep-statusbar__path" title={activeTab.path}>{activeTab.path}</span>
            {activeTab.dirty && <span className="cep-statusbar__dirty">● Modified</span>}
          </>
        ) : (
          <span className="cep-statusbar__hint">Open a file to start editing</span>
        )}
        {onOpenMission && (
          <button className="cep-statusbar__mission-btn" onClick={onOpenMission}>
            ← Mission
          </button>
        )}
        {statusMsg && <span className="cep-statusbar__msg">{statusMsg}</span>}
        <button
          className="cep-statusbar__problems-btn"
          onClick={() => { setBottomTab('problems'); setShowBottom(s => !s); }}
          title="Toggle problems"
        >
          {diagnostics.filter(d => d.severity === 'error').length > 0 && (
            <span className="cep-statusbar__badge cep-statusbar__badge--error">
              ✖ {diagnostics.filter(d => d.severity === 'error').length}
            </span>
          )}
          {diagnostics.filter(d => d.severity === 'warning').length > 0 && (
            <span className="cep-statusbar__badge cep-statusbar__badge--warn">
              ⚠ {diagnostics.filter(d => d.severity === 'warning').length}
            </span>
          )}
        </button>
      </div>

      {/* Rename dialog */}
      {renaming && (
        <RenameDialog
          path={renaming.path}
          onConfirm={name => renameFile(renaming.id, name)}
          onCancel={() => setRenaming(null)}
        />
      )}

      {/* AI context menu */}
      {aiMenu && (
        <AIContextMenu
          x={aiMenu.x}
          y={aiMenu.y}
          selection={aiMenu.selection}
          filePath={aiMenu.filePath}
          onAction={handleAIAction}
          onClose={() => setAiMenu(null)}
        />
      )}
    </div>
  );
}
