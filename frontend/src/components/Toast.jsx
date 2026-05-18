import React, { useEffect } from "react";
import "./Toast.css";

/**
 * Single toast item. Auto-dismisses via the parent's removeToast callback.
 */
function ToastItem({ toast, onRemove }) {
  useEffect(() => {
    const t = setTimeout(() => onRemove(toast.id), toast.duration ?? 3500);
    return () => clearTimeout(t);
  }, [toast.id, toast.duration, onRemove]);

  return (
    <div className={`toast toast--${toast.type}`} role="alert">
      <span className="toast-icon">
        {toast.type === "success" && "✓"}
        {toast.type === "error"   && "✕"}
        {toast.type === "info"    && "ℹ"}
        {toast.type === "warn"    && "⚠"}
      </span>
      <span className="toast-msg">{toast.message}</span>
      <button className="toast-close" onClick={() => onRemove(toast.id)}>✕</button>
    </div>
  );
}

export default function ToastContainer({ toasts, onRemove }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  );
}
