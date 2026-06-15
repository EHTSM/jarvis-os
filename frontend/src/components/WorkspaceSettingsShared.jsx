import React from "react";

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="ws-toggle-wrap">
      <button
        className={`ws-toggle${checked ? " ws-toggle--on" : ""}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
      >
        <span className="ws-toggle-thumb" />
      </button>
      {label && <span className="ws-toggle-label">{label}</span>}
    </label>
  );
}

export function FieldRow({ label, hint, children }) {
  return (
    <div className="ws-field-row">
      <div className="ws-field-meta">
        <span className="ws-field-label">{label}</span>
        {hint && <span className="ws-field-hint">{hint}</span>}
      </div>
      <div className="ws-field-control">{children}</div>
    </div>
  );
}
