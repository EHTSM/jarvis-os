import React from "react";

export const QueueStatusCard = React.memo(({ ops }) => {
  const qCounts = ops?.queue?.counts ?? {};
  const pending = qCounts.pending ?? 0;
  const running = qCounts.running ?? 0;
  
  // Calculate relative widths for a stacked visual bar
  const total = Math.max(1, pending + running + 5); // Pad out denominator to look stable at low counts
  const pendingPct = (pending / total) * 100;
  const runningPct = (running / total) * 100;

  return (
    <div className="op-widget-card queue-card">
      <div className="op-widget-header">
        <span>Queue Status</span>
        <span className={`op-stat-value ${pending > 10 ? "warn" : ""}`}>
          {pending} Pending
        </span>
      </div>
      
      <div className="op-widget-content">
        <div className="queue-visualizer">
          <div className="queue-track">
            <div className="queue-bar-running bg-ok" style={{ width: `${runningPct}%` }} title={`Running: ${running}`} />
            <div className="queue-bar-pending bg-warn" style={{ width: `${pendingPct}%` }} title={`Pending: ${pending}`} />
          </div>
        </div>
        
        <div className="op-metric-row">
          <div className="op-metric">
            <span className="label">Running</span>
            <span className="value">{running}</span>
          </div>
          <div className="op-metric">
            <span className="label">Pending</span>
            <span className={`value ${pending > 10 ? "warn" : ""}`}>{pending}</span>
          </div>
        </div>
      </div>
    </div>
  );
});
