import React from "react";

export const QueueStatusCard = React.memo(({ ops, rtStatus }) => {
  const qCounts = ops?.queue?.counts ?? {};
  const pending = qCounts.pending ?? 0;
  const running = qCounts.running ?? 0;
  const dlqSize = ops?.queue?.dlq ?? 0;

  const isOverloaded = pending > 20;
  const isElevated   = pending > 10 && pending <= 20;
  const hasDlq       = dlqSize > 0;
  const stallCount   = rtStatus?.stalled ?? 0;
  const isRunaway    = !!rtStatus?.runaway || stallCount > 2;

  const total      = Math.max(1, pending + running + 5);
  const pendingPct = (pending / total) * 100;
  const runningPct = (running / total) * 100;

  return (
    <div className="op-widget-card queue-card">
      <div className="op-widget-header">
        <span>Queue Status</span>
        <span className={`op-stat-value ${isOverloaded ? "crit" : isElevated ? "warn" : "ok"}`}>
          {pending} Pending
        </span>
      </div>

      <div className="op-widget-content">
        {isOverloaded && (
          <div className="op-queue-alert crit">
            QUEUE OVERLOAD — {pending} tasks pending. Consider drain.
          </div>
        )}

        {isRunaway && (
          <div className="op-queue-alert warn">
            RUNAWAY DETECTED — {stallCount > 0 ? `${stallCount} stalled` : "loop suspected"}. Check logs.
          </div>
        )}

        <div className="queue-visualizer">
          <div className="queue-track">
            <div className="queue-bar-running bg-ok"   style={{ width: `${runningPct}%` }} title={`Running: ${running}`} />
            <div className="queue-bar-pending bg-warn" style={{ width: `${pendingPct}%` }} title={`Pending: ${pending}`} />
          </div>
        </div>

        <div className="op-metric-row">
          <div className="op-metric">
            <span className="label">Running</span>
            <span className="value ok">{running}</span>
          </div>
          <div className="op-metric">
            <span className="label">Pending</span>
            <span className={`value ${isOverloaded ? "crit" : isElevated ? "warn" : "dim"}`}>{pending}</span>
          </div>
          {hasDlq && (
            <div className="op-metric">
              <span className="label">DLQ</span>
              <span className="value warn">{dlqSize}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
