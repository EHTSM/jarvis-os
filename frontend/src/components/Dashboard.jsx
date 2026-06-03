import React, { useState, useEffect } from "react";
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

const FIRST_SUCCESS_KEY = "jarvis_first_success_seen";

function SystemStatusCard({ opsData, online }) {
  const services  = opsData?.services   || {};
  const queue     = opsData?.queue      || null;
  const autoStats = opsData?.automation || null;
  const totalSent = autoStats
    ? Object.values(autoStats).reduce((s, d) => s + (d.sent || 0), 0)
    : 0;

  const items = [
    {
      label: "Jarvis backend",
      ok:    online,
      value: online ? "Online" : "Offline",
    },
    {
      label: "WhatsApp",
      ok:    !!services.whatsapp,
      value: services.whatsapp ? "Connected" : "Not connected",
    },
    {
      label: "Message queue",
      ok:    queue?.healthy !== false,
      value: queue
        ? (queue.healthy ? `Healthy · ${queue.counts?.pending ?? 0} pending` : `${queue.counts?.pending ?? 0} pending`)
        : "No data",
    },
    {
      label: "Follow-ups sent",
      ok:    true,
      value: totalSent > 0 ? totalSent.toLocaleString() : "None yet",
    },
  ];

  return (
    <div className="sys-card">
      <h3 className="sys-title">System Status</h3>
      <div className="sys-rows">
        {items.map(item => (
          <div key={item.label} className="sys-row">
            <span className={`sys-dot sys-dot--${item.ok ? "ok" : "warn"}`} />
            <span className="sys-label">{item.label}</span>
            <span className={`sys-value ${item.ok ? "" : "sys-value--warn"}`}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FirstSuccessBanner({ stats, onDismiss }) {
  const paid    = stats?.paid    ?? 0;
  const revenue = stats?.revenue ?? 0;
  if (paid === 0) return null;

  return (
    <div className="fs-banner">
      <div className="fs-banner-glow" aria-hidden="true" />
      <div className="fs-banner-body">
        <span className="fs-icon" aria-hidden="true">★</span>
        <div className="fs-text">
          <p className="fs-headline">First payment collected!</p>
          <p className="fs-sub">
            {paid === 1
              ? `1 client paid${revenue > 0 ? ` — ₹${revenue.toLocaleString("en-IN")} collected` : ""}. Jarvis is working.`
              : `${paid} clients paid${revenue > 0 ? ` — ₹${revenue.toLocaleString("en-IN")} collected` : ""}. Keep going.`
            }
          </p>
        </div>
      </div>
      <button className="fs-dismiss" onClick={onDismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}

const WYWA_DISMISS_KEY = "jarvis_wywa_dismissed_ts";
const WYWA_VISIT_KEY   = "jarvis_last_visit_ts";
const WYWA_MIN_ABSENCE = 5 * 60 * 1000;   // 5 minutes
const WYWA_RESHOW_AFTER = 24 * 60 * 60 * 1000; // 24 hours

function _wywaVisible(totalSent, dismissedAt) {
  const lastVisit = parseInt(localStorage.getItem(WYWA_VISIT_KEY) || "0", 10);
  const absence   = Date.now() - lastVisit;

  // Must have been away at least 5 minutes
  if (absence < WYWA_MIN_ABSENCE) return false;

  // If dismissed, only reshow after 24h AND only if there's been new activity
  if (dismissedAt) {
    const timeSinceDismiss = Date.now() - dismissedAt;
    if (timeSinceDismiss < WYWA_RESHOW_AFTER) return false;
  }

  // Show when there's any outreach activity, or when contacts exist but WhatsApp not yet connected
  return totalSent >= 0;
}

function WywaCard({ stats, opsData, onDismiss }) {
  const autoStats  = opsData?.automation || {};
  const totalSent  = Object.values(autoStats).reduce((s, d) => s + (d.sent || 0), 0);
  const hotLeads   = stats?.hot ?? 0;
  const totalContacts = stats?.total ?? 0;

  // Derive most-recent lastRun across all automation tiers
  const lastActivity = Object.values(autoStats)
    .map(d => d.lastRun ? new Date(d.lastRun).getTime() : 0)
    .reduce((max, t) => Math.max(max, t), 0);

  let headline, sub;

  if (totalSent > 0) {
    headline = `Jarvis sent ${totalSent.toLocaleString()} follow-up${totalSent !== 1 ? "s" : ""} since your last visit.`;
    sub = hotLeads > 0
      ? `${hotLeads} lead${hotLeads !== 1 ? "s are" : " is"} hot — worth a quick reply.`
      : lastActivity > 0
        ? `Last action ${_timeAgo(new Date(lastActivity).toISOString())}.`
        : "All automations running.";
  } else if (totalContacts > 0) {
    headline = `Jarvis is ready — ${totalContacts} contact${totalContacts !== 1 ? "s" : ""} loaded.`;
    sub = "Connect WhatsApp to start automated follow-ups.";
  } else {
    return null;
  }

  return (
    <div className="wywa-card">
      <div className="wywa-pulse" aria-hidden="true" />
      <div className="wywa-body">
        <p className="wywa-headline">{headline}</p>
        <p className="wywa-sub">{sub}</p>
      </div>
      <button className="wywa-dismiss" onClick={onDismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}

export default function Dashboard({ stats, opsData, onNavigate, online = false }) {
  const [nullCycles,   setNullCycles]   = useState(0);
  const [wywaShown,    setWywaShown]    = useState(false);
  const [wywaDismissed, setWywaDismissed] = useState(
    () => parseInt(localStorage.getItem(WYWA_DISMISS_KEY) || "0", 10)
  );
  const [showFirstSuccess, setShowFirstSuccess] = useState(false);

  // Show first-success banner once when paid > 0 and not yet seen
  useEffect(() => {
    if (!stats) return;
    if (stats.paid > 0 && !localStorage.getItem(FIRST_SUCCESS_KEY)) {
      setShowFirstSuccess(true);
    }
  }, [stats]);

  // Evaluate WYWA visibility once data arrives
  useEffect(() => {
    if (!stats && !opsData) return;
    const autoStats = opsData?.automation || {};
    const totalSent = Object.values(autoStats).reduce((s, d) => s + (d.sent || 0), 0);
    setWywaShown(_wywaVisible(totalSent, wywaDismissed));
  }, [stats, opsData, wywaDismissed]);

  const handleWywaDismiss = () => {
    const now = Date.now();
    localStorage.setItem(WYWA_DISMISS_KEY, String(now));
    setWywaDismissed(now);
    setWywaShown(false);
  };

  useEffect(() => {
    if (stats === null && opsData === null) {
      setNullCycles(n => n + 1);
    } else {
      setNullCycles(0);
    }
  }, [stats, opsData]);

  if (stats === null && opsData === null) {
    if (nullCycles <= 2) {
      // First load — brief skeleton is fine
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
    // Repeated failures — data never arrived. Show a recoverable empty state
    // instead of a forever-spinning skeleton.
    return (
      <div className="dashboard">
        <div className="dash-header">
          <h2 className="dash-title">Revenue</h2>
          <p className="dash-subtitle">Leads, follow-ups, and closed revenue at a glance.</p>
        </div>
        <div className="empty-state-block">
          <div className="empty-icon-mark" aria-hidden="true" />
          <p className="empty-title">Your pipeline starts here</p>
          <p className="empty-sub">
            Add your first lead — just a name and WhatsApp number. Jarvis handles all the follow-ups from there.
          </p>
          <button className="empty-action-btn" onClick={() => onNavigate?.("clients")}>
            Add your first contact →
          </button>
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

      {showFirstSuccess && (
        <FirstSuccessBanner
          stats={stats}
          onDismiss={() => {
            localStorage.setItem(FIRST_SUCCESS_KEY, "1");
            setShowFirstSuccess(false);
          }}
        />
      )}

      {wywaShown && (
        <WywaCard stats={stats} opsData={opsData} onDismiss={handleWywaDismiss} />
      )}

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
          <button className="empty-action-btn" onClick={() => onNavigate?.("clients")}>
            Add your first contact →
          </button>
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

      {/* ── System Status ─────────────────────────────────────────── */}
      <SystemStatusCard opsData={opsData} online={online} />

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
