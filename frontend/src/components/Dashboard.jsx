import React from "react";
import "./Dashboard.css";

function StatCard({ label, value, color, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-value" style={{ color }}>{value ?? "—"}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function AutoTierRow({ label, data }) {
  if (!data) return null;
  const { sent = 0, attempts = 0, lastRun } = data;
  const rate = attempts > 0 ? Math.round((sent / attempts) * 100) : null;
  const ago  = lastRun ? _timeAgo(lastRun) : "never";

  return (
    <div className="auto-row">
      <div className="auto-row-left">
        <span className="auto-label">{label}</span>
        <span className="auto-last">Last run: {ago}</span>
      </div>
      <div className="auto-row-right">
        <span className="auto-sent">{sent} sent</span>
        {rate !== null && (
          <span className="auto-rate" style={{ color: rate >= 50 ? "var(--success)" : "var(--text-dim)" }}>
            {rate}%
          </span>
        )}
      </div>
    </div>
  );
}

function _timeAgo(isoStr) {
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const mins   = Math.floor(diffMs / 60_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const TIER_LABELS = {
  "10min":      "10-minute follow-up",
  "6hr":        "6-hour follow-up",
  "24hr":       "Daily follow-up",
  "3day":       "3-day follow-up",
  "onboarding": "Onboarding sequence",
  "upsell":     "Upsell trigger",
};

export default function Dashboard({ stats, opsData }) {
  const hasLeads = stats && stats.total > 0;
  const autoStats = opsData?.automation || null;

  return (
    <div className="dashboard">
      <h2 className="dash-title">Business Insights</h2>

      {/* ── Lead Pipeline ─────────────────────────────────────────── */}
      {!hasLeads ? (
        <div className="empty-state-block">
          <div className="empty-icon-lg">👥</div>
          <p className="empty-title">No clients yet</p>
          <p className="empty-sub">
            Add your first lead to start automated follow-ups.
          </p>
        </div>
      ) : (
        <div className="stats-grid">
          <StatCard
            label="Total Clients"
            value={stats.total}
            color="var(--text)"
          />
          <StatCard
            label="Following Up"
            value={(stats.total ?? 0) - (stats.paid ?? 0)}
            color="var(--accent)"
            sub="in automation"
          />
          <StatCard
            label="Paid"
            value={stats.paid ?? 0}
            color="var(--success)"
          />
          <StatCard
            label="Revenue"
            value={stats.revenue ? `₹${stats.revenue.toLocaleString("en-IN")}` : "₹0"}
            color="var(--accent2)"
          />
          <StatCard
            label="Conversion"
            value={stats.conversionRate ?? "0%"}
            color={parseFloat(stats.conversionRate) >= 30 ? "var(--success)" : "var(--warning)"}
          />
          <StatCard
            label="Hot Leads"
            value={stats.hot ?? 0}
            color="var(--warning)"
            sub="active interest"
          />
        </div>
      )}

      {/* ── Automation Status ──────────────────────────────────────── */}
      <div className="dash-section">
        <h3 className="section-title">Automation Status</h3>

        {!autoStats || Object.keys(autoStats).length === 0 ? (
          <div className="auto-empty">
            <span className="auto-empty-dot" />
            Automations will show here once leads are added and WhatsApp is connected.
          </div>
        ) : (
          <div className="auto-list">
            {Object.entries(autoStats).map(([key, data]) => (
              <AutoTierRow
                key={key}
                label={TIER_LABELS[key] || key}
                data={data}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
