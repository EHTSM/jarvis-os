import React, { useMemo } from "react";

// Inline SVG sparkline — no external deps
function Sparkline({ values, color, height = 36 }) {
  const pts = useMemo(() => {
    if (!values || values.length < 2) return "";
    const W = 200, H = height;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    return values.map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / range) * (H - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }, [values, height]);

  if (!pts) return <span style={{ color: "var(--op-muted)", fontSize: 10 }}>no data</span>;

  return (
    <svg
      className="op-sparkline-svg"
      viewBox={`0 0 200 ${height}`}
      preserveAspectRatio="none"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color || "var(--op-accent)"}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function TelemetryPanel({ ops }) {
  const mem     = ops?.memory;
  const samples = mem?.recent_samples ?? [];
  const heapVals = samples.map(s => s.heap_mb);
  const rssVals  = samples.map(s => s.rss_mb);

  const heapNow  = mem?.current?.heap_mb ?? "—";
  const heapMin  = mem?.window_1h?.heap_min ?? "—";
  const heapMax  = mem?.window_1h?.heap_max ?? "—";
  const trend    = mem?.trend ?? "stable";

  const errRate  = ops?.errors?.errors_per_hour ?? 0;
  const p95      = ops?.requests?.p95_ms ?? ops?.timing?.p95_ms ?? "—";
  const reqCount = ops?.requests?.total  ?? "—";

  const trendColor = trend === "rising" ? "var(--op-red)" : trend === "falling" ? "var(--op-green)" : "var(--op-accent)";
  const trendArrow = trend === "rising" ? "↑" : trend === "falling" ? "↓" : "→";

  const memClass = mem?.critical ? "crit" : mem?.warn ? "warn" : "ok";

  return (
    <div className="op-telem-body" style={{ height: "100%", overflowY: "auto" }}>
      {/* Heap sparkline */}
      <div className="op-sparkline-wrap">
        <div className="op-sparkline-label">
          <span>Heap (1h)</span>
          <span style={{ color: trendColor }}>
            {heapNow}MB {trendArrow} [{heapMin}–{heapMax}]
          </span>
        </div>
        <Sparkline values={heapVals} color="var(--op-accent)" height={36} />
      </div>

      {/* RSS sparkline */}
      {rssVals.length > 1 && (
        <div className="op-sparkline-wrap">
          <div className="op-sparkline-label">
            <span>RSS</span>
            <span>{mem?.current?.rss_mb ?? "—"}MB</span>
          </div>
          <Sparkline values={rssVals} color="var(--op-muted)" height={24} />
        </div>
      )}

      {/* Metrics row */}
      <div className="op-metrics-row">
        <div className="op-metric-cell">
          <div className="op-metric-lbl">Heap</div>
          <div className={`op-metric-val ${memClass}`}>{heapNow}MB</div>
        </div>
        <div className="op-metric-cell">
          <div className="op-metric-lbl">Err/hr</div>
          <div className={`op-metric-val ${errRate > 10 ? "crit" : errRate > 0 ? "warn" : "ok"}`}>
            {errRate}
          </div>
        </div>
        <div className="op-metric-cell">
          <div className="op-metric-lbl">p95 ms</div>
          <div className="op-metric-val">{p95}</div>
        </div>
      </div>
    </div>
  );
}
