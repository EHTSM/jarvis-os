import React from "react";

export function OperationalStatusBanner({ stats, emergency }) {
  if (emergency?.active || stats.runaway) {
    return (
      <div className="op-emergency-banner" style={{ background: stats.runaway && !emergency?.active ? "var(--op-red)" : undefined }}>
        <span className="op-emergency-banner-icon">{emergency?.active ? "🛑" : "🔥"}</span>
        <span className="op-emergency-banner-text">
          {emergency?.active 
            ? `EXECUTION HALTED — ${emergency.reason || "Operator Triggered"}`
            : "RUNAWAY LOOP DETECTED — Multiple failures for same input"
          }
        </span>
        <span className="op-emergency-banner-hint">
          {emergency?.active ? "System is frozen. Resume from Governor panel." : "Check logs for recursive loops or failing automated tasks."}
        </span>
      </div>
    );
  }

  // Determine Stability
  let stability = { label: "HEALTHY", color: "var(--op-green)", icon: "🟢", next: "Monitor activity" };
  if (stats.ratio < 50) {
    stability = { label: "INCIDENT", color: "var(--op-red)", icon: "🚨", next: "Investigate failures or trigger 🔄 REBOOT" };
  } else if (stats.ratio < 75) {
    stability = { label: "UNSTABLE", color: "var(--op-amber)", icon: "🟡", next: "Prune queue or monitor stability" };
  } else if (stats.ratio < 95 || stats.failCount > 0) {
    stability = { label: "DEGRADED", color: "#ffa726", icon: "🟠", next: "Check recent failures for patterns" };
  } else if (stats.active > 0) {
    stability = { label: "ACTIVE", color: "var(--op-blue)", icon: "🔵", next: "Observe execution" };
  }

  // Determine Pressure & Safety
  const isHighPressure = stats.active > 5 || stats.stalled > 0;
  const isAtRisk = stats.lastBackupMin === null || stats.lastBackupMin > 60;

  return (
    <div className="op-emergency-banner" style={{ 
      backgroundColor: stability.color, 
      color: "#fff", 
      border: "none", 
      flexDirection: "column", 
      alignItems: "flex-start", 
      padding: "8px 12px",
      marginBottom: "6px" 
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="op-emergency-banner-icon">{stability.icon}</span>
          <span style={{ fontWeight: "bold", fontSize: 11 }}>SYSTEM {stability.label}</span>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ fontSize: 9, opacity: 0.9, background: "rgba(0,0,0,0.1)", padding: "2px 4px", borderRadius: "2px" }}>
             PULSE: {stats.ratio}%
          </div>
          <div style={{ fontSize: 9, opacity: 0.9, background: isHighPressure ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.1)", padding: "2px 4px", borderRadius: "2px", fontWeight: isHighPressure ? "bold" : "normal" }}>
             PRESSURE: {stats.active} RUN / {stats.stalled} STALL
          </div>
          <div style={{ fontSize: 9, opacity: 0.9, background: isAtRisk ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.1)", padding: "2px 4px", borderRadius: "2px", fontWeight: isAtRisk ? "bold" : "normal" }}>
             SAFETY: {stats.lastBackupMin === null ? "NO BACKUP" : `${stats.lastBackupMin}m AGO`}
          </div>
          {stats.vitals && (
            <div style={{ fontSize: 9, opacity: 0.9, background: "rgba(0,0,0,0.1)", padding: "2px 4px", borderRadius: "2px" }}>
               RSS: {stats.vitals.memRSS}MB / CPU: {stats.vitals.cpuLoad?.toFixed(1)}s
            </div>
          )}
          {stats.total > 200 && (
            <div style={{ fontSize: 9, opacity: 0.9, background: "rgba(0,0,0,0.3)", padding: "2px 4px", borderRadius: "2px", fontWeight: "bold", border: "1px solid rgba(255,255,255,0.2)" }}>
               ENTROPY HIGH: SAFE TO PRUNE
            </div>
          )}
        </div>
      </div>
      
      <div style={{ marginTop: 6, fontSize: 9, fontWeight: "bold", background: "rgba(0,0,0,0.2)", padding: "2px 6px", borderRadius: "2px", width: "100%" }}>
        NEXT STEP: {stability.next}
      </div>
    </div>
  );
}
