import React, { useMemo } from "react";

function fmtRelTime(ts) {
  if (!ts) return "—";
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

// Mirrors getRecoveryHint in ExecLogPanel — keep in sync.
function getHint(error) {
  if (!error) return null;
  const err = error.toLowerCase();
  if (err.includes("econnrefused"))  return "Service may be down — check pm2 list.";
  if (err.includes("etimedout") || err.includes("timeout")) return "Timed out — increase timeout or check for stuck process.";
  if (err.includes("enoent") || err.includes("not found"))  return "File/command not found — verify path.";
  if (err.includes("eacces") || err.includes("permission")) return "Permission denied — check ownership.";
  if (err.includes("enospc") || err.includes("no space"))   return "Disk full — run 'df -h'.";
  if (err.includes("enomem") || err.includes("killed"))     return "OOM or killed — check system memory.";
  if (err.includes("pm2"))     return "PM2 error — run 'pm2 list' to inspect.";
  if (err.includes("git"))     return "Git error — check 'git status'.";
  if (err.includes("401") || err.includes("unauthorized")) return "Session expired — reload to re-login.";
  return null;
}

export const RecentFailuresPanel = React.memo(({ history }) => {
  const failures = useMemo(() => {
    return history
      .filter(item => item.status === "failed" || item.status === "error")
      .slice(0, 5);
  }, [history]);

  if (failures.length === 0) return null;

  return (
    <div className="op-widget-card failures-card">
      <div className="op-widget-header crit-header">
        <span className="op-emergency-banner-icon">⚠</span>
        <span>Recent Failures</span>
        <span style={{ marginLeft: "auto", fontSize: 9, opacity: 0.6 }}>{failures.length} failure{failures.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="op-widget-content failure-list">
        {failures.map(f => {
          const errText = f.error || f.result?.error || "Task failed without explicit error message";
          const hint = getHint(errText);
          return (
            <div key={f.id || f.seq || f.ts} className="failure-item">
              <div className="failure-meta">
                <span className="failure-type">{f.type || "unknown"}</span>
                <span className="failure-time">{fmtRelTime(f.ts || f.createdAt)}</span>
              </div>
              <div className="failure-error" title={errText}>
                {errText}
              </div>
              {hint && <div className="failure-hint">Hint: {hint}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
});
