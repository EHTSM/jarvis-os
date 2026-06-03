import React from "react";

function rollbackLabel(lastBackupMin) {
  if (lastBackupMin === null)  return { label: "no backup", cls: "crit" };
  if (lastBackupMin < 30)      return { label: `backed up ${lastBackupMin}m ago`, cls: "safe" };
  if (lastBackupMin < 120)     return { label: `backed up ${lastBackupMin}m ago`, cls: "caution" };
  return { label: `backup ${Math.floor(lastBackupMin / 60)}h ago`, cls: "risky" };
}

export function OperationalStatusBanner({ stats, emergency }) {
  // Emergency / runaway — always visible
  if (emergency?.active) {
    return (
      <div className="op-emergency-banner op-emergency-banner--critical">
        <span className="op-emergency-banner-icon">⛔</span>
        <span className="op-emergency-banner-text">
          Emergency stop active{emergency.reason ? ` — ${emergency.reason}` : " — all task execution halted"}
        </span>
        <span className="op-emergency-banner-hint">Resume from the Governor panel or the Stop/Resume button above.</span>
      </div>
    );
  }

  if (stats.runaway) {
    return (
      <div className="op-emergency-banner op-emergency-banner--critical">
        <span className="op-emergency-banner-icon">🔥</span>
        <span className="op-emergency-banner-text">Repeated failures detected — possible loop on the same input</span>
        <span className="op-emergency-banner-hint">Check the Execution Log for the failing command and review pm2 logs.</span>
      </div>
    );
  }

  // Incident / unstable — visible with actionable guidance
  if (stats.ratio < 75) {
    const label = stats.ratio < 50 ? "Many failures" : "Elevated failures";
    const hint  = stats.ratio < 50
      ? "Open the Execution Log and filter by 'Failed' to investigate."
      : "Monitor for more failures or prune the queue.";
    const rb = rollbackLabel(stats.lastBackupMin ?? null);
    return (
      <div className="op-emergency-banner op-emergency-banner--warn">
        <span className="op-emergency-banner-icon">{stats.ratio < 50 ? "🚨" : "⚠"}</span>
        <span className="op-emergency-banner-text">
          {label} — {stats.ratio}% success rate
          {stats.stalled > 0 ? ` · ${stats.stalled} stalled` : ""}
        </span>
        <span className="op-emergency-banner-hint">
          {hint}
          {rb.cls !== "safe" && ` · Rollback: ${rb.label}.`}
        </span>
      </div>
    );
  }

  // Minor failures (95–74%) — minimal bar, no noise
  if (stats.ratio < 95 || stats.failCount > 0) {
    return (
      <div className="op-degraded-bar">
        <span className="op-degraded-label">{stats.failCount > 0 ? `${stats.failCount} failure${stats.failCount !== 1 ? "s" : ""}` : "Some failures"}</span>
        <span className="op-degraded-detail">
          {stats.ratio}% success rate{stats.stalled > 0 ? ` · ${stats.stalled} stalled` : ""} · check Execution Log
        </span>
      </div>
    );
  }

  // Healthy / active — silent. The left column cards handle status display.
  return null;
}
