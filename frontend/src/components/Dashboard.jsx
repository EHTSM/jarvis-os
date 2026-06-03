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
  "10min":      "Immediate Greeting",
  "6hr":        "Same-day Follow-up",
  "24hr":       "Next-day Touchpoint",
  "3day":       "Gentle Closing Sequence",
  "onboarding": "Welcome & Onboarding",
  "upsell":     "High Interest Action",
};

export default function Dashboard({ stats, opsData }) {
  // Still loading — show skeleton rather than blank screen
  if (stats === null && opsData === null) {
    return (
      <div className="dashboard">
        <div className="dash-header">
          <h2 className="dash-title">Customer Pipeline</h2>
          <p className="dash-subtitle">Track active relationships, automated outreach, and conversions</p>
        </div>
        <div className="dash-loading">
          <div className="dash-skeleton" />
          <div className="dash-skeleton dash-skeleton--sm" />
          <div className="dash-skeleton" />
        </div>
      </div>
    );
  }

  const hasLeads = stats && stats.total > 0;
  const autoStats = opsData?.automation || null;
  const workflowCount = autoStats ? Object.keys(autoStats).length : 0;
  const totalActions = autoStats ? Object.values(autoStats).reduce((sum, item) => sum + (item.sent || 0), 0) : 0;
  const activityLabel = totalActions > 0 ? `${totalActions.toLocaleString()} follow-up actions sent` : "Automations are ready to launch";

  return (
    <div className="dashboard">
      <div className="dash-header">
        <h2 className="dash-title">Revenue</h2>
        <p className="dash-subtitle">Leads, follow-ups, and closed revenue at a glance.</p>
      </div>
      <div className="dash-meta-strip">
        <div className="dash-meta-item">
          <span className="dash-meta-label">Follow-up sequences</span>
          <span className="dash-meta-value">{workflowCount > 0 ? `${workflowCount} running` : "None yet"}</span>
        </div>
        <div className="dash-meta-item">
          <span className="dash-meta-label">Total contacts</span>
          <span className="dash-meta-value">{stats?.total ?? 0}</span>
        </div>
        <div className="dash-meta-item">
          <span className="dash-meta-label">Outreach sent</span>
          <span className="dash-meta-value">{activityLabel}</span>
        </div>
      </div>

      {/* ── Lead Pipeline ─────────────────────────────────────────── */}
      {!hasLeads ? (
        <div className="empty-state-block">
          <div className="empty-icon-mark" aria-hidden="true" />
          <p className="empty-title">Your pipeline starts here</p>
          <p className="empty-sub">
            Go to the <strong>Clients</strong> tab and add your first lead — just a name and WhatsApp number. Jarvis handles all the follow-ups from there.
          </p>
          <span className="empty-action-hint">Add your first client</span>
        </div>
      ) : (
        <div className="stats-grid">
          <StatCard
            label="Total Leads"
            value={stats.total}
            color="var(--text)"
          />
          <StatCard
            label="In Follow-up"
            value={(stats.total ?? 0) - (stats.paid ?? 0)}
            color="var(--accent)"
            sub="automated outreach active"
          />
          <StatCard
            label="Closed / Paid"
            value={stats.paid ?? 0}
            color="var(--success)"
          />
          <StatCard
            label="Revenue Collected"
            value={stats.revenue ? `₹${stats.revenue.toLocaleString("en-IN")}` : "₹0"}
            color="var(--accent2)"
          />
          <StatCard
            label="Close Rate"
            value={stats.conversionRate ?? "0%"}
            color={parseFloat(stats.conversionRate) >= 30 ? "var(--success)" : "var(--warning)"}
          />
          <StatCard
            label="Hot Leads"
            value={stats.hot ?? 0}
            color="var(--warning)"
            sub="respond soon"
          />
        </div>
      )}

      {/* ── Automation Status ──────────────────────────────────────── */}
      <div className="dash-section">
        <h3 className="section-title">Automated Follow-ups</h3>

        {!autoStats || Object.keys(autoStats).length === 0 ? (
          <div className="auto-empty">
            <span className="auto-empty-dot" />
            <div>
              <div className="auto-empty-title">Automations haven't started yet</div>
              <div className="auto-empty-desc">Once you add a lead and connect WhatsApp, Jarvis runs scheduled follow-ups automatically — no manual sending needed.</div>
            </div>
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
