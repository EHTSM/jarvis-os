import React, { useState, useCallback } from "react";
import { getStats, getOpsData } from "../api.js";

function StatCard({ label, value, color }) {
  return (
    <div className="stat-card">
      <div className="stat-value" style={{ color }}>{value ?? "—"}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function _timeAgo(isoStr) {
  if (!isoStr) return "never";
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const TIER_LABELS = {
  "10min":      "10-min follow-up",
  "6hr":        "6-hour follow-up",
  "24hr":       "Daily follow-up",
  "3day":       "3-day reminder",
  "onboarding": "Onboarding",
  "upsell":     "Upsell trigger",
};

function AutoRow({ tierKey, data }) {
  const label = TIER_LABELS[tierKey] || tierKey;
  const { sent = 0, attempts = 0, lastRun } = data;
  const rate = attempts > 0 ? Math.round((sent / attempts) * 100) : null;

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 14px",
      background: "var(--surface2)",
      borderRadius: "var(--radius-sm)",
    }}>
      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{label}</p>
        <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
          Last run: {_timeAgo(lastRun)}
        </p>
      </div>
      <div style={{ textAlign: "right" }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: "var(--success)" }}>{sent}</p>
        <p style={{ fontSize: 10, color: "var(--text-dim)" }}>
          {rate !== null ? `${rate}% success` : "no data"}
        </p>
      </div>
    </div>
  );
}

export default function Insights() {
  const [stats,   setStats]   = useState(null);
  const [ops,     setOps]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, o] = await Promise.allSettled([getStats(), getOpsData()]);
    setStats(s.value  ?? null);
    setOps(o.value    ?? null);
    setLoading(false);
    setLoaded(true);
  }, []);

  // Auto-load on first render
  React.useEffect(() => { load(); }, [load]);

  const autoStats = ops?.automation || null;
  const crm = stats;

  return (
    <>
      <header className="mobile-header">
        <div className="brand">
          <span className="brand-name">Insights</span>
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
          {loading && !loaded ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
              <div className="spinner" />
            </div>
          ) : (
            <>
              {/* Business KPIs */}
              <p className="section-label">Your Business</p>

              {!crm || crm.total === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">👥</span>
                  <span className="empty-title">No clients yet</span>
                  <span className="empty-sub">Add your first lead to see stats here.</span>
                </div>
              ) : (
                <div className="stat-grid">
                  <StatCard label="Clients"    value={crm.total}         color="var(--text)"    />
                  <StatCard label="Hot"        value={crm.hot ?? 0}      color="var(--warning)" />
                  <StatCard label="Paid"       value={crm.paid ?? 0}     color="var(--success)" />
                  <StatCard label="Revenue"    value={crm.revenue ? `₹${crm.revenue.toLocaleString("en-IN")}` : "₹0"}
                                                                          color="var(--accent2)" />
                  <StatCard label="Conversion" value={crm.conversionRate ?? "0%"} color="var(--accent)" />
                  <StatCard label="Onboarded"  value={crm.onboarded ?? 0} color="var(--accent2)" />
                </div>
              )}

              {/* Automation status */}
              {autoStats && Object.keys(autoStats).length > 0 && (
                <>
                  <p className="section-label" style={{ marginTop: 8 }}>Automation</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {Object.entries(autoStats).map(([key, data]) => (
                      <AutoRow key={key} tierKey={key} data={data} />
                    ))}
                  </div>
                </>
              )}

              {!loaded && !loading && (
                <div className="empty-state">
                  <span className="empty-icon">📡</span>
                  <span className="empty-title">Could not load data</span>
                  <span className="empty-sub">Check your connection and try again.</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
