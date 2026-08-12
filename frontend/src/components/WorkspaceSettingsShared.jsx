import React from "react";

let _toggleSeq = 0;

export function Toggle({ checked, onChange, label }) {
  // B19.2.3: the switch had role="switch" + aria-checked but NO accessible
  // name — a screen reader announced an unlabelled switch. The visible label
  // already exists, so point at it with aria-labelledby rather than inventing
  // a second string that could drift. Falls back to aria-label when unlabelled.
  const [id] = React.useState(() => `ws-toggle-${++_toggleSeq}`);
  const labelId = label ? `${id}-label` : undefined;
  return (
    <label className="ws-toggle-wrap">
      <button
        // B19.2.3: without this the button defaults to type="submit" and
        // submits any enclosing form when toggled.
        type="button"
        className={`ws-toggle${checked ? " ws-toggle--on" : ""}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-label={label ? undefined : "Toggle"}
      >
        <span className="ws-toggle-thumb" />
      </button>
      {label && <span className="ws-toggle-label" id={labelId}>{label}</span>}
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
