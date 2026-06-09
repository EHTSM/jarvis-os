import React, { useState, useEffect, useCallback } from "react";

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

function _isElectron() {
  return typeof window !== "undefined" && !!window.electronAPI;
}

export default function PluginManagerPanel({ addNotification }) {
  const [expanded,     setExpanded]     = useState(false);
  const [backendAlive, setBackendAlive] = useState(null); // null = unknown, true/false = checked
  const [recentCrashes, setRecentCrashes] = useState([]);
  const [crashLoading, setCrashLoading] = useState(false);

  // On expand: verify backend health + load recent crash log via IPC
  const loadLiveStatus = useCallback(async () => {
    if (!_isElectron()) return;
    try {
      const health = await window.electronAPI.getServerHealth();
      setBackendAlive(health?.isHealthy ?? false);
    } catch {
      setBackendAlive(false);
    }

    setCrashLoading(true);
    try {
      const r = await window.electronAPI.getRendererCrashes();
      setRecentCrashes(Array.isArray(r?.crashes) ? r.crashes.slice(0, 5) : []);
    } catch {
      setRecentCrashes([]);
    } finally {
      setCrashLoading(false);
    }
  }, []);

  useEffect(() => {
    if (expanded) loadLiveStatus();
  }, [expanded, loadLiveStatus]);

  const handleManage = (plugin) => {
    addNotification?.(`Plugin management requires manual backend configuration. Dynamic injection is disabled for safety.`, "info", 5000);
  };

  const isElectron = _isElectron();

  return (
    <div className="op-panel">
      <div
        className="op-panel-header"
        style={{ cursor: "pointer", userSelect: "none", background: "rgba(0,184,217,0.05)" }}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="op-panel-title">Optional Plugins {expanded ? "▲" : "▼"}</span>
        <span className="op-panel-meta">
          {isElectron && backendAlive !== null && (
            <span style={{ color: backendAlive ? "var(--op-green)" : "var(--op-red)", marginRight: 6 }}>
              {backendAlive ? "● backend ok" : "● backend offline"}
            </span>
          )}
          No active plugins
        </span>
      </div>

      {expanded && (
        <div className="op-panel-body" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8 }}>

          {/* Live IPC status section — Electron only */}
          {isElectron && (
            <div style={{
              padding: "6px 8px", borderRadius: 4, marginBottom: 4,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid var(--op-border)",
              fontSize: 9,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ color: "var(--op-text2)", textTransform: "uppercase", letterSpacing: "0.08em" }}>IPC / Backend Status</span>
                <button
                  className="op-btn secondary"
                  style={{ fontSize: 8, padding: "1px 6px" }}
                  onClick={loadLiveStatus}
                >Refresh</button>
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span>
                  Backend:{" "}
                  <span style={{ color: backendAlive === null ? "var(--op-text2)" : backendAlive ? "var(--op-green)" : "var(--op-red)", fontWeight: "bold" }}>
                    {backendAlive === null ? "checking…" : backendAlive ? "healthy" : "offline"}
                  </span>
                </span>
                <span>
                  Crashes:{" "}
                  <span style={{ color: recentCrashes.length > 0 ? "var(--op-amber)" : "var(--op-green)", fontWeight: "bold" }}>
                    {crashLoading ? "…" : recentCrashes.length}
                  </span>
                  {recentCrashes.length > 0 && (
                    <span style={{ color: "var(--op-text2)", marginLeft: 4 }}>
                      last: {recentCrashes[0]?.source || "unknown"} · {recentCrashes[0]?.ts ? new Date(recentCrashes[0].ts).toLocaleTimeString() : "—"}
                    </span>
                  )}
                </span>
              </div>
              {recentCrashes.length > 0 && (
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ color: "var(--op-text2)", fontSize: 8 }}>Recent crash log:</span>
                  {recentCrashes.map((c, i) => (
                    <div key={i} style={{ fontFamily: "monospace", fontSize: 8, color: "var(--op-red)", opacity: 0.85, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      [{c.ts ? c.ts.slice(11, 19) : "—"}] {c.source} — {(c.message || "").slice(0, 60)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Plugin cards */}
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
