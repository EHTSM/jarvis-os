import React, { useMemo } from "react";

export function SessionContextCard({ history, ops }) {
  const stats = useMemo(() => {
    const last20 = history.slice(0, 20);
    const failed = last20.filter(e => e.status === "failed" || e.status === "error");
    const success = last20.filter(e => e.status === "success" || e.status === "completed");
    const running = last20.filter(e => e.status === "running" || e.status === "pending");
    
    // Find Landmarks
    const lastBackup = history.find(h => h.input?.includes("backup") && (h.status === "success" || h.status === "completed"));
    const lastRestart = history.find(h => h.input?.includes("restart") && (h.status === "success" || h.status === "completed"));
    const lastFailure = history.find(h => h.status === "failed" || h.status === "error");

    const uptimeSec = ops?.rtStatus?.uptime || 0;
    const uptimeStr = uptimeSec > 3600 
      ? `${(uptimeSec / 3600).toFixed(1)}h` 
      : uptimeSec > 60 
        ? `${Math.floor(uptimeSec / 60)}m` 
        : `${uptimeSec}s`;

    return {
      active: running.length,
      ratio: last20.length ? Math.round((success.length / last20.length) * 100) : 100,
      uptime: uptimeStr,
      lastBackup: lastBackup ? `${Math.floor((Date.now() - lastBackup.ts) / 60000)}m ago` : "None",
      lastRestart: lastRestart ? `${Math.floor((Date.now() - lastRestart.ts) / 60000)}m ago` : "None",
      lastFail: lastFailure ? `${Math.floor((Date.now() - lastFailure.ts) / 60000)}m ago` : "None"
    };
  }, [history, ops]);

  return (
    <div className="op-widget">
      <div className="op-widget-header">
        <span className="op-widget-title">Session Context</span>
        <span className="op-widget-status ok">Active</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', padding: '10px' }}>
        <div className="op-stat-box">
          <div className="op-stat-label">Active Workload</div>
          <div className="op-stat-value">{stats.active} Tasks</div>
        </div>
        <div className="op-stat-box">
          <div className="op-stat-label">Success Ratio</div>
          <div className="op-stat-value" style={{ color: stats.ratio < 80 ? 'var(--op-red)' : 'var(--op-green)' }}>
            {stats.ratio}%
          </div>
        </div>
        <div className="op-stat-box">
          <div className="op-stat-label">System Uptime</div>
          <div className="op-stat-value">{stats.uptime}</div>
        </div>
        <div className="op-stat-box">
          <div className="op-stat-label">Last Failure</div>
          <div className="op-stat-value" style={{ color: stats.lastFail === 'None' ? 'var(--op-text2)' : 'var(--op-amber)' }}>
            {stats.lastFail}
          </div>
        </div>
      </div>
      <div style={{ padding: '0 10px 10px 10px', fontSize: '9px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--op-text2)' }}>📦 Last Backup</span>
          <span style={{ color: 'var(--op-text)' }}>{stats.lastBackup}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--op-text2)' }}>🔄 Last Restart</span>
          <span style={{ color: 'var(--op-text)' }}>{stats.lastRestart}</span>
        </div>
      </div>
    </div>
  );
}
