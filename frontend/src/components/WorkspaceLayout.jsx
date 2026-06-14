import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useElectronStore } from '../hooks/useElectron';
import './WorkspaceLayout.css';

/**
 * WorkspaceLayout — resizable split-pane layout engine.
 *
 * Layout descriptor stored in electron-store:
 * {
 *   panels: [{ id, component, title, size, visible, position }],
 *   preset: 'default' | 'code' | 'terminal' | 'monitor' | 'custom'
 * }
 *
 * Usage:
 *   <WorkspaceLayout panels={[
 *     { id: 'editor', title: 'Editor', node: <MyEditor /> },
 *     { id: 'terminal', title: 'Terminal', node: <TerminalPanel /> },
 *   ]} />
 */

const PRESETS = {
  default:  { split: 'horizontal', sizes: [70, 30] },
  code:     { split: 'horizontal', sizes: [65, 35] },
  terminal: { split: 'vertical',   sizes: [50, 50] },
  monitor:  { split: 'horizontal', sizes: [60, 40] },
  full:     { split: 'horizontal', sizes: [100,  0] },
};

function Resizer({ onResize, vertical }) {
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSizes = useRef([]);

  const onMouseDown = useCallback((e) => {
    dragging.current = true;
    startPos.current = vertical ? e.clientY : e.clientX;
    e.preventDefault();

    const move = (me) => {
      if (!dragging.current) return;
      const delta = (vertical ? me.clientY : me.clientX) - startPos.current;
      onResize(delta);
    };
    const up = () => { dragging.current = false; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, [onResize, vertical]);

  return (
    <div
      className={`workspace-resizer ${vertical ? 'workspace-resizer--vertical' : 'workspace-resizer--horizontal'}`}
      onMouseDown={onMouseDown}
    />
  );
}

export function Panel({ title, children, onClose, className = '', actions }) {
  return (
    <div className={`workspace-panel ${className}`}>
      <div className="workspace-panel__header">
        <span className="workspace-panel__title">{title}</span>
        <div className="workspace-panel__actions">
          {actions}
          {onClose && (
            <button className="workspace-panel__btn" onClick={onClose} title="Close panel">✕</button>
          )}
        </div>
      </div>
      <div className="workspace-panel__body">{children}</div>
    </div>
  );
}

export default function WorkspaceLayout({ panels = [], storageKey = 'workspace-layout', defaultPreset = 'default' }) {
  const { value: saved, set: saveLayout } = useElectronStore(storageKey, null);
  const containerRef = useRef(null);

  const [preset,   setPreset]   = useState(defaultPreset);
  const [sizes,    setSizes]    = useState(PRESETS[defaultPreset].sizes);
  const [split,    setSplit]    = useState(PRESETS[defaultPreset].split);
  const [visible,  setVisible]  = useState(() => panels.map(() => true));

  // Restore from store
  useEffect(() => {
    if (!saved) return;
    try {
      if (saved.sizes)   setSizes(saved.sizes);
      if (saved.split)   setSplit(saved.split);
      if (saved.preset)  setPreset(saved.preset);
      if (saved.visible) setVisible(saved.visible);
    } catch {}
  }, [saved]);

  // Persist on change
  useEffect(() => {
    saveLayout({ sizes, split, preset, visible });
  }, [sizes, split, preset, visible]); // eslint-disable-line

  const applyPreset = useCallback((name) => {
    const p = PRESETS[name] || PRESETS.default;
    setPreset(name);
    setSizes(p.sizes);
    setSplit(p.split);
    saveLayout({ sizes: p.sizes, split: p.split, preset: name, visible });
  }, [saveLayout, visible]);

  const handleResize = useCallback((delta) => {
    if (!containerRef.current) return;
    const total = split === 'vertical'
      ? containerRef.current.offsetHeight
      : containerRef.current.offsetWidth;
    if (!total) return;
    const pct = (delta / total) * 100;
    setSizes(([a, b]) => {
      const na = Math.max(10, Math.min(90, a + pct));
      const nb = 100 - na;
      return [na, nb];
    });
  }, [split]);

  const togglePanel = useCallback((idx) => {
    setVisible(v => {
      const next = [...v];
      next[idx] = !next[idx];
      return next;
    });
  }, []);

  const visiblePanels = panels.filter((_, i) => visible[i]);

  return (
    <div className="workspace-layout">
      {/* Toolbar */}
      <div className="workspace-toolbar">
        <div className="workspace-toolbar__presets">
          {Object.keys(PRESETS).map(name => (
            <button
              key={name}
              className={`workspace-preset-btn${preset === name ? ' workspace-preset-btn--active' : ''}`}
              onClick={() => applyPreset(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="workspace-toolbar__panels">
          {panels.map((p, i) => (
            <button
              key={p.id}
              className={`workspace-panel-toggle${visible[i] ? ' workspace-panel-toggle--on' : ''}`}
              onClick={() => togglePanel(i)}
            >
              {p.title}
            </button>
          ))}
        </div>
        <div className="workspace-toolbar__spacer" />
        <button
          className="workspace-preset-btn"
          onClick={() => setSplit(s => s === 'horizontal' ? 'vertical' : 'horizontal')}
          title="Toggle split direction"
        >
          {split === 'horizontal' ? '⬛ H' : '⬛ V'}
        </button>
      </div>

      {/* Content */}
      <div
        ref={containerRef}
        className={`workspace-content workspace-content--${split}`}
      >
        {visiblePanels.map((panel, idx) => (
          <React.Fragment key={panel.id}>
            <div
              className="workspace-pane"
              style={{ [split === 'horizontal' ? 'width' : 'height']: `${sizes[idx] ?? 50}%` }}
            >
              {panel.node}
            </div>
            {idx < visiblePanels.length - 1 && (
              <Resizer vertical={split === 'vertical'} onResize={handleResize} />
            )}
          </React.Fragment>
        ))}
        {visiblePanels.length === 0 && (
          <div className="workspace-empty">
            All panels hidden. Use the toolbar above to show panels.
          </div>
        )}
      </div>
    </div>
  );
}
