import React, { useState, useEffect, useCallback } from "react";
import { getStats, getMetrics } from "../api.js";

function StatCard({ label, value, color }) {
  return (
    <div className="stat-card">
      <div className="stat-value" style={{ color }}>{value ?? "—"}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function BarChart({ title, data, colors }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <p className="card-title">{title}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Object.entries(data)
          .sort((a, b) => b[1] - a[1])
          .map(([key, val]) => {
            const pct = Math.round((val / total) * 100);
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: "var(--text-dim)", width: 80, flexShrink: 0 }}>{key}</span>
                <div style={{ flex: 1, height: 6, background: "var(--surface2)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: colors[key] || "var(--accent)", borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 12, color: "var(--text-dim)", width: 28, textAlign: "right" }}>{val}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [stats,   setStats]   = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, m] = await Promise.allSettled([getStats(), getMetrics()]);
    setStats(s.value  ?? null);
    setMetrics(m.value ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const uptimeStr = stats?.uptime
    ? `${Math.floor(stats.uptime / 60)}m ${Math.floor(stats.uptime % 60)}s`
    : "—";

  const intentColors = {
    payment: "#00e676", search: "#00d4ff", greeting: "#6c63ff",
    intelligence: "#ffab40", crm: "#ff4081", open_app: "#ff9800"
  };
  const modeColors = { sales: "#00e676", execution: "#00d4ff", intelligence: "#6c63ff" };

  return (
    <>
      <header className="mobile-header">
        <div className="brand">
          <span className="brand-name">Dashboard</span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{ color: "var(--accent)", fontSize: 13, fontWeight: 600 }}
        >
          {loading ? "…" : "Refresh"}
        </button>
      </header>

      <div className="app-screen">
        <div className="page">
          {loading && !stats ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
              <div className="spinner" />
            </div>
          ) : (
            <>
              {/* CRM stats */}
              <p className="section-label">CRM Overview</p>
              <div className="stat-grid">
                <StatCard label="Total Leads"    value={stats?.totalLeads    ?? 0}      color="var(--accent)"  />
                <StatCard label="Hot Leads"      value={stats?.hotLeads      ?? 0}      color="var(--warning)" />
                <StatCard label="Paid"           value={stats?.paidLeads     ?? 0}      color="var(--success)" />
                <StatCard label="Revenue"        value={`₹${stats?.revenue   ?? 0}`}    color="var(--accent2)" />
                <StatCard label="Conversion"     value={stats?.conversionRate ?? "0%"}  color="#ff4081" />
                <StatCard label="Uptime"         value={uptimeStr}                      color="var(--text-dim)" />
              </div>

              {/* Request metrics */}
              {metrics && (
                <>
                  <p className="section-label" style={{ marginTop: 4 }}>Request Metrics</p>
                  <div className="stat-grid">
                    <StatCard label="Requests"     value={metrics.requests    ?? 0} color="var(--text)"    />
                    <StatCard label="Errors"        value={metrics.errors      ?? 0} color="var(--danger)"  />
                    <StatCard label="Pay Links"     value={metrics.paymentLinks ?? 0} color="var(--success)" />
                    <StatCard label="WA Sent"       value={metrics.waSent      ?? 0} color="var(--accent2)" />
                  </div>
                </>
              )}

              {/* Charts */}
              {metrics?.byIntent && Object.keys(metrics.byIntent).length > 0 && (
                <>
                  <p className="section-label" style={{ marginTop: 4 }}>Intent Breakdown</p>
                  <BarChart title="" data={metrics.byIntent} colors={intentColors} />
                </>
              )}

              {metrics?.byMode && Object.keys(metrics.byMode).length > 0 && (
                <>
                  <p className="section-label" style={{ marginTop: 4 }}>Mode Breakdown</p>
                  <BarChart title="" data={metrics.byMode} colors={modeColors} />
                </>
              )}

              {!stats && !metrics && (
                <div className="empty-state">
                  <span className="empty-icon">📡</span>
                  <span className="empty-title">No data available</span>
                  <span className="empty-sub">Backend may be offline</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
