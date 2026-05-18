import React, { useMemo } from "react";

function fmtRelTime(ts) {
  if (!ts) return "—";
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export const RecentFailuresPanel = React.memo(({ history }) => {
  // Extract only failures/errors from recent history (last 5)
  const failures = useMemo(() => {
    return history
      .filter(item => item.status === "failed" || item.status === "error")
      .slice(0, 5);
  }, [history]);

  if (failures.length === 0) return null;

  return (
    <div className="op-widget-card failures-card">
      <div className="op-widget-header crit-header">
        <span className="op-emergency-banner-icon" style={{ fontSize: '0.85rem' }}>⚠</span>
        <span>Recent Failures</span>
      </div>
      
      <div className="op-widget-content failure-list">
        {failures.map(f => (
          <div key={f.id || f.seq || Math.random()} className="failure-item">
            <div className="failure-meta">
              <span className="failure-type">{f.type || "unknown"}</span>
              <span className="failure-time">{fmtRelTime(f.ts || f.createdAt)}</span>
            </div>
            <div className="failure-error" title={f.error || f.result?.error || "Task failed"}>
              {f.error || f.result?.error || "Task failed without explicit error message"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
