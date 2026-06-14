import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useIpcCleanup } from '../hooks/useResourceManager';
import './FileExplorer.css';

const api = () => window.electronAPI;
const isElectron = () => !!window.electronAPI?.isElectron;

// ── Native context menu for file/directory nodes ──────────────────────
function useFileContextMenu(onOpen, onRefresh) {
  const targetRef = useRef(null);

  const showMenu = useCallback((e, node) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isElectron()) return;
    targetRef.current = node;
    const items = node.isDir
      ? [
          { id: 'refresh',   label: 'Refresh' },
          { type: 'separator' },
          { id: 'copy-path', label: 'Copy Path' },
          { id: 'reveal',    label: 'Reveal in Finder' },
        ]
      : [
          { id: 'open',      label: 'Open File' },
          { type: 'separator' },
          { id: 'copy-path', label: 'Copy Path' },
          { id: 'reveal',    label: 'Reveal in Finder' },
          { type: 'separator' },
          { id: 'drag',      label: 'Drag Out…' },
        ];
    api()?.showContextMenu(items);
  }, []);

  useIpcCleanup('onContextMenuAction', useCallback((id) => {
    const node = targetRef.current;
    if (!node) return;
    switch (id) {
      case 'open':      onOpen?.(node.path); break;
      case 'refresh':   onRefresh?.(node.path); break;
      case 'copy-path': api()?.clipboardWrite(node.path); break;
      case 'reveal':    api()?.fsOpenPath(node.path); break;
      case 'drag':      api()?.ondragstart(node.path); break;
      default: break;
    }
    targetRef.current = null;
  }, [onOpen, onRefresh]));

  return showMenu;
}

// File extension → icon
const EXT_ICONS = {
  js: '📄', jsx: '⚛', ts: '📘', tsx: '⚛',
  css: '🎨', scss: '🎨', html: '🌐', json: '{ }',
  md: '📝', sh: '🐚', py: '🐍', rb: '💎',
  go: '🐹', rs: '🦀', java: '☕', cpp: '⚙️', c: '⚙️',
  png: '🖼', jpg: '🖼', jpeg: '🖼', svg: '🎭', gif: '🖼',
  mp4: '🎬', mp3: '🎵', pdf: '📕', zip: '📦', env: '🔒',
};

function fileIcon(name, isDir) {
  if (isDir) return '📁';
  const ext = name.split('.').pop()?.toLowerCase();
  return EXT_ICONS[ext] || '📄';
}

function TreeNode({ node, depth, selected, onSelect, onOpen, onContextMenu }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children && node.children.length > 0;

  const toggle = useCallback((e) => {
    e.stopPropagation();
    if (node.isDir) setExpanded(x => !x);
    onSelect(node.path);
    if (!node.isDir) onOpen(node.path);
  }, [node, onSelect, onOpen]);

  const handleContextMenu = useCallback((e) => {
    onContextMenu?.(e, node);
  }, [node, onContextMenu]);

  // Native drag-out for files
  const handleDragStart = useCallback((e) => {
    if (node.isDir) return;
    e.preventDefault();
    api()?.ondragstart(node.path);
  }, [node]);

  const indent = depth * 14;

  return (
    <div className="file-tree-node">
      <div
        className={`file-tree-row${selected === node.path ? ' file-tree-row--selected' : ''}`}
        style={{ paddingLeft: indent + 8 }}
        onClick={toggle}
        onContextMenu={handleContextMenu}
        draggable={!node.isDir}
        onDragStart={handleDragStart}
        title={node.path}
      >
        {node.isDir && (
          <span className="file-tree-arrow">{expanded ? '▾' : '▸'}</span>
        )}
        {!node.isDir && <span className="file-tree-arrow" />}
        <span className="file-tree-icon">{fileIcon(node.name, node.isDir)}</span>
        <span className="file-tree-name">{node.name}</span>
      </div>
      {node.isDir && expanded && hasChildren && (
        <div className="file-tree-children">
          {node.children.map(child => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileExplorer({ rootDir, cwd, onFileOpen, className = '' }) {
  const [tree, setTree]             = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [selected, setSelected]     = useState(null);
  const [search, setSearch]         = useState('');
  const [searchResults, setResults] = useState(null);
  const [searching, setSearching]   = useState(false);
  const [favorites, setFavorites]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('file-explorer-favorites') || '[]'); } catch { return []; }
  });
  const [recent, setRecent]         = useState(() => {
    try { return JSON.parse(localStorage.getItem('file-explorer-recent') || '[]'); } catch { return []; }
  });
  const [activeTab, setActiveTab]   = useState('tree');
  const searchTimer = useRef(null);
  const searchInput = useRef(null);

  // Resolve root — accept both rootDir prop and cwd prop
  const root = rootDir || cwd || (isElectron() ? null : '/');

  const loadTree = useCallback(async (dir) => {
    if (!dir || !isElectron()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api().fsReadTree(dir, 4);
      if (result?.error) throw new Error(result.error);
      setTree(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (root) loadTree(root);
  }, [root, loadTree]);

  // Resolve home dir if no rootDir provided
  useEffect(() => {
    if (!root && isElectron()) {
      api().fsGetHomePath?.().then(r => r?.path && loadTree(r.path));
    }
  }, [root, loadTree]);

  // Debounced search
  useEffect(() => {
    if (!search.trim()) { setResults(null); return; }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      if (!isElectron()) return;
      setSearching(true);
      const dir = root || '';
      try {
        const results = await api().fsSearch(dir, search.trim());
        setResults(results || []);
      } catch {}
      setSearching(false);
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [search, root]);

  // Global Cmd+P shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        setActiveTab('search');
        setTimeout(() => searchInput.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleOpen = useCallback((path) => {
    if (onFileOpen) onFileOpen(path);
    setRecent(r => {
      const next = [path, ...r.filter(x => x !== path)].slice(0, 20);
      localStorage.setItem('file-explorer-recent', JSON.stringify(next));
      return next;
    });
  }, [onFileOpen]);

  const showContextMenu = useFileContextMenu(handleOpen, loadTree);

  const toggleFavorite = useCallback((path) => {
    setFavorites(f => {
      const next = f.includes(path) ? f.filter(x => x !== path) : [...f, path];
      localStorage.setItem('file-explorer-favorites', JSON.stringify(next));
      return next;
    });
  }, []);

  const openFromList = useCallback((path) => {
    setSelected(path);
    handleOpen(path);
  }, [handleOpen]);

  if (!isElectron()) {
    return (
      <div className={`file-explorer file-explorer--stub ${className}`}>
        <div className="file-explorer__unavailable">File explorer is only available in the desktop app.</div>
      </div>
    );
  }

  return (
    <div className={`file-explorer ${className}`}>
      {/* Header */}
      <div className="file-explorer__header">
        <span className="file-explorer__title">Explorer</span>
        <button
          className="file-explorer__btn"
          onClick={() => root && loadTree(root)}
          title="Refresh"
        >↻</button>
      </div>

      {/* Tabs */}
      <div className="file-explorer__tabs">
        {['tree', 'search', 'favorites', 'recent'].map(tab => (
          <button
            key={tab}
            className={`file-explorer__tab${activeTab === tab ? ' file-explorer__tab--active' : ''}`}
            onClick={() => {
              setActiveTab(tab);
              if (tab === 'search') setTimeout(() => searchInput.current?.focus(), 50);
            }}
          >
            {tab === 'tree' ? 'Files' : tab === 'search' ? '⌕ Search' : tab === 'favorites' ? '★ Favs' : '🕐 Recent'}
          </button>
        ))}
      </div>

      {/* Search input (shown when search tab or quick-open) */}
      {activeTab === 'search' && (
        <div className="file-explorer__search">
          <input
            ref={searchInput}
            className="file-explorer__search-input"
            placeholder="Search files… (Cmd+P)"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {searching && <span className="file-explorer__spinner">⟳</span>}
        </div>
      )}

      {/* Body */}
      <div className="file-explorer__body">
        {/* Tree tab */}
        {activeTab === 'tree' && (
          loading ? <div className="file-explorer__status">Loading…</div>
          : error  ? <div className="file-explorer__error">{error}</div>
          : !tree  ? <div className="file-explorer__status">No directory loaded.</div>
          : (
            <div className="file-tree">
              {tree.tree?.map(node => (
                <TreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  selected={selected}
                  onSelect={setSelected}
                  onOpen={handleOpen}
                  onContextMenu={showContextMenu}
                />
              ))}
            </div>
          )
        )}

        {/* Search tab */}
        {activeTab === 'search' && (
          !search.trim()
            ? <div className="file-explorer__status">Type to search files.</div>
            : searching
            ? <div className="file-explorer__status">Searching…</div>
            : searchResults?.length === 0
            ? <div className="file-explorer__status">No results.</div>
            : (searchResults || []).map(path => (
              <div
                key={path}
                className={`file-explorer__list-item${selected === path ? ' file-explorer__list-item--selected' : ''}`}
                onClick={() => openFromList(path)}
                title={path}
              >
                <span className="file-explorer__list-icon">{fileIcon(path.split('/').pop(), false)}</span>
                <div className="file-explorer__list-text">
                  <div className="file-explorer__list-name">{path.split('/').pop()}</div>
                  <div className="file-explorer__list-path">{path.replace(root, '').slice(1)}</div>
                </div>
                <button
                  className={`file-explorer__fav-btn${favorites.includes(path) ? ' file-explorer__fav-btn--on' : ''}`}
                  onClick={e => { e.stopPropagation(); toggleFavorite(path); }}
                  title="Favorite"
                >★</button>
              </div>
            ))
        )}

        {/* Favorites tab */}
        {activeTab === 'favorites' && (
          favorites.length === 0
            ? <div className="file-explorer__status">No favorites yet. Star files from search results.</div>
            : favorites.map(path => (
              <div
                key={path}
                className={`file-explorer__list-item${selected === path ? ' file-explorer__list-item--selected' : ''}`}
                onClick={() => openFromList(path)}
                title={path}
              >
                <span className="file-explorer__list-icon">{fileIcon(path.split('/').pop(), false)}</span>
                <div className="file-explorer__list-text">
                  <div className="file-explorer__list-name">{path.split('/').pop()}</div>
                  <div className="file-explorer__list-path">{path}</div>
                </div>
                <button
                  className="file-explorer__fav-btn file-explorer__fav-btn--on"
                  onClick={e => { e.stopPropagation(); toggleFavorite(path); }}
                  title="Remove"
                >★</button>
              </div>
            ))
        )}

        {/* Recent tab */}
        {activeTab === 'recent' && (
          recent.length === 0
            ? <div className="file-explorer__status">No recent files.</div>
            : recent.map(path => (
              <div
                key={path}
                className={`file-explorer__list-item${selected === path ? ' file-explorer__list-item--selected' : ''}`}
                onClick={() => openFromList(path)}
                title={path}
              >
                <span className="file-explorer__list-icon">{fileIcon(path.split('/').pop(), false)}</span>
                <div className="file-explorer__list-text">
                  <div className="file-explorer__list-name">{path.split('/').pop()}</div>
                  <div className="file-explorer__list-path">{path}</div>
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
