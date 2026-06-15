/**
 * PageHeader — unified discovery header for every major screen.
 * Answers: what is this, what state is it in, what can I do, what's related.
 * Zero mock data. All state must be passed as props.
 */
import React, { useState } from "react";
import "./PageHeader.css";

export default function PageHeader({
  icon,
  title,
  subtitle,
  status,          // { label, color, pulse? }
  metrics,         // [{ label, value, color? }]
  actions,         // [{ label, icon?, onClick, primary?, danger? }]
  related,         // [{ label, tab, icon? }]
  shortcuts,       // [{ keys: string[], desc }]
  onNavigate,
  className = "",
}) {
  const [showShortcuts, setShowShortcuts] = useState(false);

  return (
    <div className={`ph-root ${className}`}>
      {/* Left: identity */}
      <div className="ph-identity">
        {icon && <span className="ph-icon" aria-hidden="true">{icon}</span>}
        <div className="ph-titles">
          <div className="ph-title-row">
            <h1 className="ph-title">{title}</h1>
            {status && (
              <span
                className="ph-status"
                style={{
                  color: status.color,
                  borderColor: status.color + "44",
                  background: status.color + "12",
                }}
              >
                {status.pulse && <span className="ph-status-dot" style={{ background: status.color }} />}
                {status.label}
              </span>
            )}
          </div>
          {subtitle && <p className="ph-subtitle">{subtitle}</p>}
        </div>
      </div>

      {/* Center: metrics */}
      {metrics && metrics.length > 0 && (
        <div className="ph-metrics">
          {metrics.map((m, i) => (
            <div key={i} className="ph-metric">
              <span className="ph-metric-val" style={{ color: m.color }}>{m.value}</span>
              <span className="ph-metric-label">{m.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Right: actions + shortcuts + related */}
      <div className="ph-right">
        {shortcuts && shortcuts.length > 0 && (
          <div className="ph-shortcuts-wrap">
            <button
              className="ph-shortcuts-toggle"
              onClick={() => setShowShortcuts(s => !s)}
              title="Keyboard shortcuts"
            >
              ⌨
            </button>
            {showShortcuts && (
              <div className="ph-shortcuts-popover" role="tooltip">
                <div className="ph-shortcuts-title">Shortcuts</div>
                {shortcuts.map((s, i) => (
                  <div key={i} className="ph-shortcut-row">
                    <span className="ph-shortcut-keys">
                      {s.keys.map((k, j) => (
                        <React.Fragment key={j}>
                          <kbd className="ph-kbd">{k}</kbd>
                          {j < s.keys.length - 1 && <span className="ph-kbd-sep">+</span>}
                        </React.Fragment>
                      ))}
                    </span>
                    <span className="ph-shortcut-desc">{s.desc}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {actions && actions.map((a, i) => (
          <button
            key={i}
            className={`ph-action${a.primary ? " ph-action--primary" : ""}${a.danger ? " ph-action--danger" : ""}`}
            onClick={a.onClick}
            disabled={a.disabled}
            title={a.title}
          >
            {a.icon && <span className="ph-action-icon">{a.icon}</span>}
            {a.label}
          </button>
        ))}
      </div>

      {/* Related modules ribbon */}
      {related && related.length > 0 && (
        <div className="ph-related">
          <span className="ph-related-label">Related:</span>
          {related.map((r, i) => (
            <React.Fragment key={r.tab}>
              <button
                className="ph-related-link"
                onClick={() => onNavigate?.(r.tab)}
              >
                {r.icon && <span>{r.icon}</span>}
                {r.label}
              </button>
              {i < related.length - 1 && <span className="ph-related-sep">→</span>}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
