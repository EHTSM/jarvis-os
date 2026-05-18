import React, { useState } from "react";

const PLUGINS = [
  {
    id: "desktop",
    name: "Local Desktop Control",
    description: "Enables autonomous UI interaction via mouse and keyboard control.",
    status: "available",
    badges: [{ text: "LOCAL ONLY", type: "info" }],
    warnings: ["Requires RobotJS peer dependency. Cannot run in headless VPS."],
  },
  {
    id: "voice",
    name: "Voice Control",
    description: "Speech-to-text integration for hands-free operation.",
    status: "available",
    badges: [{ text: "EXPERIMENTAL", type: "warn" }],
    warnings: [],
  },
  {
    id: "evo",
    name: "Evolution Runtime",
    description: "Self-modifying code generator and execution loop.",
    status: "disabled",
    badges: [{ text: "DISABLED", type: "muted" }],
    warnings: ["PRODUCTION SAFETY RISK. Not recommended for daily operations."],
  },
  {
    id: "context",
    name: "Context Engine",
    description: "Vector-based long-term memory embedding store.",
    status: "unsupported",
    badges: [{ text: "UNSUPPORTED", type: "crit" }],
    warnings: ["Heavy RAM requirement. Unsafe for current VPS instance limit."],
  }
];

export default function PluginManagerPanel({ addNotification }) {
  const [expanded, setExpanded] = useState(false);

  const handleManage = (plugin) => {
    addNotification?.(`Plugin management requires manual backend configuration. Dynamic injection is disabled for safety.`, "info", 5000);
  };

  return (
    <div className="op-panel">
      <div 
        className="op-panel-header" 
        style={{ cursor: "pointer", userSelect: "none", background: "rgba(0,184,217,0.05)" }} 
        onClick={() => setExpanded(!expanded)}
      >
        <span className="op-panel-title">Optional Plugins {expanded ? "▲" : "▼"}</span>
        <span className="op-panel-meta">No active plugins</span>
      </div>
      
      {expanded && (
        <div className="op-panel-body" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8 }}>
          {PLUGINS.map(p => (
            <div key={p.id} className={`op-plugin-card ${p.status}`}>
              <div className="op-plugin-header">
                <span className="op-plugin-name">{p.name}</span>
                <div className="op-plugin-badges">
                  {p.badges.map((b, i) => (
                    <span key={i} className={`op-plugin-badge ${b.type}`}>{b.text}</span>
                  ))}
                  <span className={`op-plugin-badge status-${p.status}`}>{p.status.toUpperCase()}</span>
                </div>
              </div>
              <div className="op-plugin-desc">{p.description}</div>
              {p.warnings.length > 0 && (
                <div className="op-plugin-warnings">
                  {p.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}
              <div className="op-plugin-actions">
                <button className="op-btn secondary" style={{ fontSize: "9px", padding: "4px 8px" }} onClick={() => handleManage(p)}>Manage</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
