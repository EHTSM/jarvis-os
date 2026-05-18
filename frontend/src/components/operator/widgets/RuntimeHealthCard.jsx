import React, { useMemo } from "react";

function fmtUptime(secs) {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// A simple CSS sparkline component (Zero dependency)
const Sparkline = ({ value, max, thresholdWarn, thresholdCrit }) => {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  const colorClass = value >= thresholdCrit ? 'bg-crit' : value >= thresholdWarn ? 'bg-warn' : 'bg-ok';
  
  return (
    <div className="sparkline-container">
      <div className={`sparkline-fill ${colorClass}`} style={{ width: `${percent}%` }} />
    </div>
  );
};

export const RuntimeHealthCard = React.memo(({ ops }) => {
  const status = ops?.status ?? "unknown";
  const statusClass = status === "ok" ? "ok" : status === "degraded" ? "warn" : "crit";
  const heapMb = ops?.memory?.current?.heap_mb ?? 0;
  const rssMb = ops?.memory?.current?.rss_mb ?? 0;
  const uptime = fmtUptime(ops?.uptime?.seconds);
  const errRate = ops?.errors?.errors_per_hour ?? 0;

  return (
    <div className="op-widget-card health-card">
      <div className="op-widget-header">
        <span>Runtime Health</span>
        <span className={`op-stat-value ${statusClass}`}>{status.toUpperCase()}</span>
      </div>
      
      <div className="op-widget-content">
        <div className="op-metric">
          <span className="label">Uptime</span>
          <span className="value dim">{uptime}</span>
        </div>

        <div className="op-metric">
          <span className="label">Err/hr</span>
          <span className={`value ${errRate > 10 ? "crit" : errRate > 0 ? "warn" : "ok"}`}>
            {errRate}
          </span>
        </div>

        <div className="op-metric-block">
          <div className="op-metric-flex">
            <span className="label">Heap Memory</span>
            <span className={`value ${ops?.memory?.critical ? "crit" : ops?.memory?.warn ? "warn" : ""}`}>
              {heapMb} MB
            </span>
          </div>
          <Sparkline value={heapMb} max={250} thresholdWarn={150} thresholdCrit={200} />
        </div>
        
        <div className="op-metric-block">
          <div className="op-metric-flex">
            <span className="label">RSS Memory</span>
            <span className="value dim">{rssMb} MB</span>
          </div>
          <Sparkline value={rssMb} max={300} thresholdWarn={200} thresholdCrit={250} />
        </div>
      </div>
    </div>
  );
});
