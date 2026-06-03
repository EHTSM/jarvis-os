import React from "react";
import { useOperatorPrefs } from "../../../hooks/useOperatorPrefs";

export const PreferencesPanel = React.memo(({ onClose }) => {
  const { prefs, toggle, set, reset } = useOperatorPrefs();

  const Row = ({ label, children }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--op-border)" }}>
      <span style={{ fontSize: 10, color: "var(--op-text2)" }}>{label}</span>
      {children}
    </div>
  );

  const Toggle = ({ keyName }) => (
    <button
      onClick={() => toggle(keyName)}
      style={{
        padding: "2px 8px", fontSize: 9, borderRadius: 3, cursor: "pointer",
        background: prefs[keyName] ? "var(--op-accent)" : "var(--op-surface2)",
        color: prefs[keyName] ? "#06080a" : "var(--op-text2)",
        border: "1px solid var(--op-border2)", fontFamily: "inherit", fontWeight: "bold"
      }}
    >
      {prefs[keyName] ? "ON" : "OFF"}
    </button>
  );

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(6,8,10,0.85)", zIndex: 8000,
      display: "flex", alignItems: "center", justifyContent: "center"
    }} onClick={onClose}>
      <div
        style={{
          width: "min(340px, 92vw)", background: "var(--op-surface)",
          border: "1px solid var(--op-border2)", borderRadius: 7, padding: "18px 20px",
          fontFamily: "var(--op-mono)", display: "flex", flexDirection: "column", gap: 10
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, fontWeight: "bold", color: "var(--op-text)" }}>Preferences</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--op-text2)", fontSize: 14 }}>×</button>
        </div>

        <Row label="Compact mode"><Toggle keyName="compactMode" /></Row>
        <Row label="Show timestamps"><Toggle keyName="showTimestamps" /></Row>
        <Row label="Auto-scroll log"><Toggle keyName="autoScroll" /></Row>
        <Row label="Notification sound"><Toggle keyName="notifSound" /></Row>
        <Row label="Min notification level">
          <select
            value={prefs.notifMinLevel}
            onChange={e => set("notifMinLevel", e.target.value)}
            style={{
              fontSize: 9, padding: "2px 4px", background: "var(--op-surface2)",
              color: "var(--op-text)", border: "1px solid var(--op-border2)",
              borderRadius: 3, fontFamily: "inherit"
            }}
          >
            <option value="info">Info+</option>
            <option value="warn">Warn+</option>
            <option value="crit">Critical only</option>
          </select>
        </Row>

        <button
          onClick={reset}
          style={{
            marginTop: 4, padding: "5px 0", background: "none",
            color: "var(--op-text2)", border: "1px solid var(--op-border2)",
            borderRadius: 4, cursor: "pointer", fontSize: 9, fontFamily: "inherit"
          }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
});
