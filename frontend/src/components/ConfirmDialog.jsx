import React, { useEffect, useRef } from "react";
import "./ConfirmDialog.css";

/**
 * In-app confirm dialog — replaces all window.confirm() calls.
 *
 * Usage:
 *   const [confirm, ConfirmUI] = useConfirm();
 *   await confirm({ title, message, danger }) → boolean
 *
 *   In JSX: {ConfirmUI}
 */

export function useConfirm() {
  const [state, setState] = React.useState(null);
  const resolveRef = React.useRef(null);

  const confirm = React.useCallback(({ title = "Are you sure?", message = "", danger = false, confirmLabel = "Confirm", cancelLabel = "Cancel" } = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ title, message, danger, confirmLabel, cancelLabel });
    });
  }, []);

  const handleConfirm = React.useCallback(() => {
    setState(null);
    resolveRef.current?.(true);
  }, []);

  const handleCancel = React.useCallback(() => {
    setState(null);
    resolveRef.current?.(false);
  }, []);

  const ConfirmUI = state ? (
    <ConfirmDialog
      title={state.title}
      message={state.message}
      danger={state.danger}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return [confirm, ConfirmUI];
}

export default function ConfirmDialog({ title, message, danger, confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm, onCancel }) {
  const confirmBtnRef = useRef(null);

  useEffect(() => {
    const prev = document.activeElement;
    confirmBtnRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onCancel?.();
      if (e.key === "Enter")  onConfirm?.();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [onConfirm, onCancel]);

  return (
    <div className="cdialog-overlay" role="dialog" aria-modal="true" aria-labelledby="cdialog-title" onClick={onCancel}>
      <div className="cdialog-box" onClick={e => e.stopPropagation()}>
        <div className="cdialog-icon" aria-hidden="true">{danger ? "⚠" : "◈"}</div>
        <div id="cdialog-title" className="cdialog-title">{title}</div>
        {message && <div className="cdialog-message">{message}</div>}
        <div className="cdialog-actions">
          <button className="cdialog-btn cdialog-cancel" onClick={onCancel}>{cancelLabel}</button>
          <button
            ref={confirmBtnRef}
            className={`cdialog-btn cdialog-confirm ${danger ? "cdialog-danger" : ""}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
