import React, { useEffect, useRef, useMemo } from "react";
import "./VisualIntelligence.css";

// ── Sparkline ─────────────────────────────────────────────────────
// Pure SVG, no dependency. Points are normalized 0-1 within the series range.

function Sparkline({ points, color, height = 36, fill = true }) {
  if (!points || points.length < 2) {
    return <div className="vi-sparkline-empty" style={{ height }} />;
  }

  const w = 120;
  const h = height;
  const pad = 2;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const coords = points.map((v, i) => {
    const x = pad + (i / (points.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return [x, y];
  });

  const linePath = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  const fillPath = fill
    ? `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${(h - pad).toFixed(1)} L${pad},${(h - pad).toFixed(1)} Z`
    : null;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="vi-sparkline"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {fill && fillPath && (
        <path
          d={fillPath}
          fill={color}
          opacity="0.10"
        />
      )}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Endpoint dot */}
      <circle
        cx={coords[coords.length - 1][0]}
        cy={coords[coords.length - 1][1]}
        r="2.5"
        fill={color}
      />
    </svg>
  );
}

// ── Trend card ────────────────────────────────────────────────────

function TrendCard({ label, value, sub, delta, points, color, unit = "" }) {
  const trend = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const deltaLabel = delta !== null
    ? `${delta > 0 ? "↑" : delta < 0 ? "↓" : "—"} ${Math.abs(delta)}${unit}`
    : null;

  return (
    <div className="vi-card">
      <div className="vi-card-top">
        <span className="vi-card-label section-label">{label}</span>
        {deltaLabel && (
          <span className={`vi-card-delta vi-delta--${trend}`}>{deltaLabel}</span>
        )}
      </div>
      <div className="vi-card-value-row">
        <span className="vi-card-value">{value}</span>
        <Sparkline points={points} color={color} />
      </div>
      {sub && <span className="vi-card-sub">{sub}</span>}
    </div>
  );
}

// ── History accumulator hook ──────────────────────────────────────
// Snapshots the current value on each render where it changes.
// Returns last N readings as an array — used as sparkline points.

function useHistory(value, maxLen = 20) {
  const buf = useRef([]);
  const prev = useRef(undefined);

  if (value !== undefined && value !== null && value !== prev.current) {
    buf.current = [...buf.current.slice(-(maxLen - 1)), Number(value) || 0];
    prev.current = value;
  }

  return buf.current;
}

// ── Root component ────────────────────────────────────────────────

export default function VisualIntelligence({ stats, opsData }) {
  // Revenue trend
  const revenue      = stats?.revenue   ?? 0;
  const revenueHist  = useHistory(revenue);
  const revDelta     = revenueHist.length >= 2
    ? revenueHist[revenueHist.length - 1] - revenueHist[revenueHist.length - 2]
    : null;

  // Lead trend
  const totalLeads   = stats?.total     ?? 0;
  const leadsHist    = useHistory(totalLeads);
  const leadDelta    = leadsHist.length >= 2
    ? leadsHist[leadsHist.length - 1] - leadsHist[leadsHist.length - 2]
    : null;

  // Automation trend — total follow-ups sent across all tiers
  const autoStats    = opsData?.automation || {};
  const totalSent    = useMemo(
    () => Object.values(autoStats).reduce((s, d) => s + (d.sent || 0), 0),
    [autoStats]
  );
  const autoHist     = useHistory(totalSent);
  const autoDelta    = autoHist.length >= 2
    ? autoHist[autoHist.length - 1] - autoHist[autoHist.length - 2]
    : null;

  // Runtime trend — heap MB (proxy for system health over time)
  const heapMb       = opsData?.memory?.current?.heap_mb ?? 0;
  const heapHist     = useHistory(heapMb);
  const heapDelta    = heapHist.length >= 2
    ? heapHist[heapHist.length - 1] - heapHist[heapHist.length - 2]
    : null;

  const convRate     = parseFloat(stats?.conversionRate ?? "0");

  return (
    <div className="vi-grid">
      <TrendCard
        label="Revenue"
        value={revenue > 0 ? `₹${revenue.toLocaleString("en-IN")}` : "₹0"}
        sub={stats?.paid > 0 ? `${stats.paid} client${stats.paid > 1 ? "s" : ""} paid · ${convRate}% close rate` : "No payments yet"}
        delta={revDelta}
        unit=""
        points={revenueHist}
        color="var(--success)"
      />
      <TrendCard
        label="Pipeline"
        value={totalLeads}
        sub={`${stats?.hot ?? 0} hot · ${stats?.paid ?? 0} closed`}
        delta={leadDelta}
        unit=""
        points={leadsHist}
        color="var(--accent)"
      />
      <TrendCard
        label="Automation"
        value={totalSent}
        sub={`${Object.keys(autoStats).length} sequence${Object.keys(autoStats).length !== 1 ? "s" : ""} active`}
        delta={autoDelta}
        unit=""
        points={autoHist}
        color="var(--accent2)"
      />
      <TrendCard
        label="Runtime"
        value={heapMb ? `${heapMb} MB` : "—"}
        sub={
          opsData?.uptime?.human
            ? `Up ${opsData.uptime.human} · ${opsData?.errors?.errors_per_hour ?? 0} err/hr`
            : "Monitoring…"
        }
        delta={heapDelta !== null ? -heapDelta : null}  // inverted: lower heap = better
        unit=" MB"
        points={heapHist}
        color={heapMb > 300 ? "var(--warning)" : "var(--info)"}
      />
    </div>
  );
}
