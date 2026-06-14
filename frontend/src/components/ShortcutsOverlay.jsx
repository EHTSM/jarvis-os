import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SHORTCUTS } from '../hooks/useKeyboardShortcuts';
import './ShortcutsOverlay.css';

const GROUPS = [
  { label: 'Navigation', ids: ['nav-home','nav-intelligence','nav-engineering','nav-contacts','nav-payments','nav-reports','nav-chat'] },
  { label: 'Actions',    ids: ['palette','new-task','search','escape'] },
  { label: 'Runtime',    ids: ['emergency-stop','emergency-resume'] },
  { label: 'View',       ids: ['zoom-in','zoom-out','fullscreen'] },
];

function formatKey(keyStr) {
  const isMac = navigator.platform.includes('Mac');
  return keyStr
    .replace('Meta',  isMac ? '⌘' : 'Ctrl')
    .replace('Ctrl',  isMac ? '⌃' : 'Ctrl')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace('Alt',   isMac ? '⌥' : 'Alt')
    .split('+')
    .map(k => `<kbd>${k}</kbd>`)
    .join('');
}

export default function ShortcutsOverlay({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="shortcuts-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            className="shortcuts-panel"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <div className="shortcuts-header">
              <span className="shortcuts-title">Keyboard Shortcuts</span>
              <button className="shortcuts-close" onClick={onClose}>
                <kbd>Esc</kbd>
              </button>
            </div>
            <div className="shortcuts-grid">
              {GROUPS.map(group => {
                const items = group.ids
                  .map(id => SHORTCUTS.find(s => s.id === id))
                  .filter(Boolean);
                return (
                  <div key={group.label} className="shortcuts-group">
                    <div className="shortcuts-group-label">{group.label}</div>
                    {items.map(s => (
                      <div key={s.id} className="shortcuts-row">
                        <span className="shortcuts-desc">{s.description}</span>
                        <span
                          className="shortcuts-keys"
                          dangerouslySetInnerHTML={{ __html: formatKey(s.keys[0]) }}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
