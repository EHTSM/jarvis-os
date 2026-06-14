import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * ToastContainer — renders a list of toasts in the bottom-right corner.
 * Drop-in replacement / companion to Toast.jsx.
 * Usage: <ToastContainer toasts={toasts} onRemove={removeToast} />
 */
export function ToastContainer({ toasts, onRemove }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence mode="popLayout">
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, x: 20, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            style={{ pointerEvents: 'auto' }}
          >
            <Toast toast={toast} onRemove={onRemove} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Toast({ toast, onRemove }) {
  const { type = 'info', message, id } = toast;

  const config = {
    success: { color: '#4ade80', bg: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.20)',   icon: '✓' },
    error:   { color: '#f87171', bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.20)',   icon: '✗' },
    warning: { color: '#fbbf24', bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.20)',  icon: '⚠' },
    warn:    { color: '#fbbf24', bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.20)',  icon: '⚠' },
    info:    { color: '#818cf8', bg: 'rgba(102,87,232,0.10)',  border: 'rgba(102,87,232,0.20)',  icon: '◎' },
  };

  const c = config[type] || config.info;

  React.useEffect(() => {
    const t = setTimeout(() => onRemove(id), toast.duration ?? 4000);
    return () => clearTimeout(t);
  }, [id, onRemove, toast.duration]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      padding: '12px 14px',
      background: '#0d1117',
      border: `1px solid ${c.border}`,
      borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.60)',
      maxWidth: 340,
      minWidth: 260,
    }}>
      <span style={{
        color: c.color,
        fontFamily: 'monospace',
        fontSize: 13,
        flexShrink: 0,
        marginTop: 1,
      }}>
        {c.icon}
      </span>
      <span style={{
        fontSize: 13,
        color: 'rgba(255,255,255,0.78)',
        lineHeight: 1.5,
        flex: 1,
        fontFamily: '"Inter", "Geist", -apple-system, sans-serif',
      }}>
        {message}
      </span>
      <button
        onClick={() => onRemove(id)}
        style={{
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.24)',
          cursor: 'pointer',
          padding: '0 2px',
          fontSize: 14,
          lineHeight: 1,
          flexShrink: 0,
          marginTop: 1,
        }}
      >×</button>
    </div>
  );
}

export default ToastContainer;
