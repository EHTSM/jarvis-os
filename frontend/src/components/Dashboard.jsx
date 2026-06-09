import React, { useState, useEffect, useMemo } from "react";
import "./Dashboard.css";

// ── Helpers ────────────────────────────────────────────────────────────────────

function _fmtINR(n) {
  if (!n) return "₹0";
  const v = Number(n);
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000)   return `₹${(v / 1000).toFixed(1)}k`;
  return `₹${v.toLocaleString("en-IN")}`;
}

function _timeAgo(isoStr) {
  if (!isoStr) return "never";
  const ms   = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function Skeleton({ w, h }) {
  return (
    <div
      className="dv2-skeleton"
      style={{ width: w || "100%", height: h || 18, borderRadius: 6 }}
    />
  );
}

// ── Metric Card ────────────────────────────────────────────────────────────────

function MetricCard({ icon, label, value, sub, accent, loading }) {
  return (
    <div className="dv2-metric">
      <div className="dv2-metric-top">
        <span className="dv2-metric-icon" style={{ color: accent || "var(--accent)" }} aria-hidden="true">{icon}</span>
        <span className="dv2-metric-label">{label}</span>
      </div>
      {loading
        ? <Skeleton w="60%" h={28} />
        : <div className="dv2-metric-value" style={{ color: accent || "var(--text)" }}>{value ?? "—"}</div>
      }
      {loading
        ? <Skeleton w="40%" h={12} />
        : sub && <div className="dv2-metric-sub">{sub}</div>
      }
    </div>
  );
}

// ── Status Bar Chart (CSS-only, no library) ────────────────────────────────────

const STATUS_META = {
  new:       { label: "New",       color: "var(--accent,  #7c6fff)" },
  qualified: { label: "Qualified", color: "var(--accent2, #4ecdc4)" },
  proposal:  { label: "Proposal",  color: "var(--warning, #f0b429)" },
  won:       { label: "Won",       color: "var(--success, #52d68a)" },
  lost:      { label: "Lost",      color: "var(--text-faint, #4a5470)" },
  cold:      { label: "Cold",      color: "var(--info, #5dc8f5)"   },
  hot:       { label: "Hot",       color: "var(--warning, #f0b429)" },
  paid:      { label: "Paid",      color: "var(--success, #52d68a)" },
};

function LeadsChart({ stats, loading }) {
  const bars = useMemo(() => {
    if (!stats) return [];
    const raw = [
      { key: "hot",       count: stats.hot       ?? 0 },
      { key: "qualified", count: stats.qualified  ?? 0 },
      { key: "paid",      count: stats.paid       ?? 0 },
      { key: "cold",      count: (stats.total ?? 0) - (stats.hot ?? 0) - (stats.paid ?? 0) - (stats.hot ?? 0) },
      { key: "lost",      count: stats.lost       ?? 0 },
    ]
      .filter(b => b.count > 0)
      .sort((a, b) => b.count - a.count);

    const max = Math.max(...raw.map(b => b.count), 1);
    return raw.map(b => ({ ...b, pct: Math.round((b.count / max) * 100), ...STATUS_META[b.key] }));
  }, [stats]);

  if (loading) {
    return (
      <div className="dv2-chart-bars">
        {[80, 60, 45, 30, 18].map((w, i) => (
          <div key={i} className="dv2-bar-row">
            <div className="dv2-skeleton dv2-skeleton--label" />
            <div className="dv2-bar-track"><div className="dv2-skeleton dv2-skeleton--bar" style={{ width: `${w}%` }} /></div>
            <div className="dv2-skeleton dv2-skeleton--count" />
          </div>
        ))}
      </div>
    );
  }

  if (bars.length === 0) {
    return (
      <div className="dv2-chart-empty">
        <span>No lead data yet.</span>
        <span className="dv2-chart-empty-sub">Add contacts to see pipeline distribution.</span>
      </div>
    );
  }

  return (
    <div className="dv2-chart-bars">
      {bars.map(b => (
        <div key={b.key} className="dv2-bar-row">
          <span className="dv2-bar-label">{b.label}</span>
          <div className="dv2-bar-track">
            <div
              className="dv2-bar-fill"
              style={{ width: `${b.pct}%`, background: b.color }}
            />
          </div>
          <span className="dv2-bar-count" style={{ color: b.color }}>{b.count}</span>
        </div>
      ))}
    </div>
  );
}

// ── Automation Summary ─────────────────────────────────────────────────────────

const TIER_LABELS = {
  "10min":      "First message",
  "6hr":        "Same-day follow-up",
  "24hr":       "Next-day check-in",
  "3day":       "3-day closing",
  "onboarding": "Welcome message",
  "upsell":     "Upsell nudge",
};

function AutomationRows({ opsData, loading }) {
  const autoStats = opsData?.automation || {};
  const entries   = Object.entries(autoStats);

  if (loading) {
    return (
      <div className="dv2-auto-list">
        {[0, 1, 2].map(i => (
          <div key={i} className="dv2-auto-row">
            <div className="dv2-skeleton dv2-skeleton--auto-label" />
            <div className="dv2-skeleton dv2-skeleton--auto-val" />
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="dv2-auto-empty">
        <span className="dv2-auto-empty-dot" />
        <div>
          <div className="dv2-auto-empty-title">Automations haven't started yet</div>
          <div className="dv2-auto-empty-desc">Once you add a lead and connect WhatsApp, Ooplix runs scheduled follow-ups automatically.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dv2-auto-list">
      {entries.map(([key, data]) => {
        const { sent = 0, attempts = 0, failed = 0, lastRun } = data;
        const rate = attempts > 0 ? Math.round((sent / attempts) * 100) : null;
        return (
          <div key={key} className="dv2-auto-row">
            <div className="dv2-auto-row-left">
              <span className="dv2-auto-label">{TIER_LABELS[key] || key}</span>
              <span className="dv2-auto-last">Last: {_timeAgo(lastRun)}</span>
            </div>
            <div className="dv2-auto-row-right">
              <span className="dv2-auto-sent">{sent} sent</span>
              {failed > 0 && <span className="dv2-auto-failed">{failed} failed</span>}
              {rate !== null && (
                <span className="dv2-auto-rate" style={{ color: rate >= 50 ? "var(--success)" : "var(--text-dim)" }}>
                  {rate}%
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Service Health ─────────────────────────────────────────────────────────────

function ServiceHealth({ opsData, online, loading, onNavigate }) {
  const services = opsData?.services || {};

  const rows = [
    { label: "AI Engine",  ok: !!(services.ai || services.groq), detail: (services.ai || services.groq) ? "Active" : "Not configured" },
    { label: "WhatsApp",   ok: !!services.whatsapp,              detail: services.whatsapp  ? "Connected" : "Not set up" },
    { label: "Payments",   ok: !!services.payments,              detail: services.payments  ? "Razorpay live" : "Not configured" },
    { label: "Runtime",    ok: online,                           detail: online ? "Online" : "Reconnecting…" },
  ];

  return (
    <div className="dv2-health">
      {loading
        ? [0, 1, 2, 3].map(i => (
            <div key={i} className="dv2-health-row">
              <div className="dv2-skeleton dv2-skeleton--health" />
            </div>
          ))
        : rows.map(r => (
            <div key={r.label} className="dv2-health-row">
              <span className={`dv2-health-dot dot--${r.ok ? "ok" : "warn"} dot--live`} />
              <span className="dv2-health-label">{r.label}</span>
              <span className={`dv2-health-detail${!r.ok ? " dv2-health-detail--warn" : ""}`}>
                {r.detail}
              </span>
            </div>
          ))
      }
    </div>
  );
}

// ── First Success Banner ───────────────────────────────────────────────────────

const FIRST_SUCCESS_KEY = "jarvis_first_success_seen";

function FirstSuccessBanner({ stats, onDismiss }) {
  if (!stats?.paid) return null;
  return (
    <div className="dv2-success-banner">
      <div className="dv2-success-glow" aria-hidden="true" />
      <span className="dv2-success-icon" aria-hidden="true">★</span>
      <div className="dv2-success-text">
        <p className="dv2-success-headline">First payment collected!</p>
        <p className="dv2-success-sub">
          {stats.paid === 1
            ? `1 client paid${stats.revenue ? ` — ${_fmtINR(stats.revenue)} collected` : ""}. Ooplix is working.`
            : `${stats.paid} clients paid${stats.revenue ? ` — ${_fmtINR(stats.revenue)} collected` : ""}. Keep going.`}
        </p>
      </div>
      <button className="dv2-success-dismiss" onClick={onDismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}

// ── Root Pipeline V2 ──────────────────────────────────────────────────────────

export default function Dashboard({ stats, opsData, onNavigate, online = false }) {
  const [nullCycles,       setNullCycles]       = useState(0);
  const [showFirstSuccess, setShowFirstSuccess] = useState(false);

  const loading = stats === null && opsData === null && nullCycles <= 2;

  useEffect(() => {
    if (stats === null && opsData === null) setNullCycles(n => n + 1);
    else setNullCycles(0);
  }, [stats, opsData]);

  useEffect(() => {
    if (stats?.paid > 0 && !localStorage.getItem(FIRST_SUCCESS_KEY)) {
      setShowFirstSuccess(true);
    }
  }, [stats]);

  const totalActions = Object.values(opsData?.automation || {}).reduce((s, d) => s + (d.sent || 0), 0);
  const convRate     = stats?.conversionRate
    ? (typeof stats.conversionRate === "string"
        ? stats.conversionRate
        : `${stats.conversionRate}%`)
    : (stats?.total > 0 && stats?.paid > 0
        ? `${Math.round((stats.paid / stats.total) * 100)}%`
        : "0%");

  // Hard backend error state
  if (stats === null && opsData === null && nullCycles > 2) {
    return (
      <div className="dv2-root page-enter">
        <div className="dv2-header">
          <h1 className="dv2-page-title">Pipeline</h1>
          <p className="dv2-page-sub">Business performance</p>
        </div>
        <div className="dv2-offline">
          <div className="dv2-offline-icon">◎</div>
          <p className="dv2-offline-title">Backend unavailable</p>
          <p className="dv2-offline-sub">Pipeline data will appear when the backend reconnects.</p>
          <button className="dv2-offline-btn" onClick={() => window.location.reload()}>Retry →</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dv2-root page-enter">

      {/* Page Header */}
      <div className="dv2-header">
        <div className="dv2-header-left">
          <h1 className="dv2-page-title">Pipeline</h1>
          <p className="dv2-page-sub">Business performance</p>
        </div>
        <div className="dv2-header-right">
          <button className="dv2-header-btn" onClick={() => onNavigate?.("clients")} title="View contacts">
            Contacts →
          </button>
        </div>
      </div>

      {/* First success banner */}
      {showFirstSuccess && (
        <FirstSuccessBanner
          stats={stats}
          onDismiss={() => {
            localStorage.setItem(FIRST_SUCCESS_KEY, "1");
            setShowFirstSuccess(false);
          }}
        />
      )}

      {/* KPI Metrics Row */}
      <div className="dv2-metrics-row">
        <MetricCard
          icon="◈"
          label="Total Leads"
          value={stats?.total ?? 0}
          sub={`${stats?.hot ?? 0} hot`}
          accent="var(--accent)"
          loading={loading}
        />
        <MetricCard
          icon="✦"
          label="In Follow-up"
          value={(stats?.total ?? 0) - (stats?.paid ?? 0)}
          sub="automated outreach"
          accent="var(--accent2)"
          loading={loading}
        />
        <MetricCard
          icon="₹"
          label="Revenue"
          value={_fmtINR(stats?.revenue)}
          sub={`${stats?.paid ?? 0} paid`}
          accent="var(--success)"
          loading={loading}
        />
        <MetricCard
          icon="◎"
          label="Close Rate"
          value={convRate}
          sub={`${totalActions.toLocaleString()} messages sent`}
          accent={parseFloat(convRate) >= 30 ? "var(--success)" : "var(--warning)"}
          loading={loading}
        />
      </div>

      {/* Main Content Grid */}
      <div className="dv2-grid">

        {/* Left: Chart + Automation */}
        <div className="dv2-grid-main">

          <section className="dv2-panel">
            <div className="dv2-panel-header">
              <h2 className="dv2-section-label">Leads by Status</h2>
            </div>
            <LeadsChart stats={stats} loading={loading} />
          </section>

          <section className="dv2-panel">
            <div className="dv2-panel-header">
              <h2 className="dv2-section-label">Automated Follow-ups</h2>
              <button className="dv2-panel-link" onClick={() => onNavigate?.("activity")}>
                Activity →
              </button>
            </div>
            <AutomationRows opsData={opsData} loading={loading} />
          </section>

        </div>

        {/* Right: Health + Quick nav */}
        <div className="dv2-grid-side">

          <section className="dv2-panel">
            <div className="dv2-panel-header">
              <h2 className="dv2-section-label">Service Health</h2>
              <button className="dv2-panel-link" onClick={() => onNavigate?.("devops")}>
                DevOps →
              </button>
            </div>
            <ServiceHealth opsData={opsData} online={online} loading={loading} onNavigate={onNavigate} />
          </section>

          <section className="dv2-panel">
            <h2 className="dv2-section-label">Quick Nav</h2>
            <div className="dv2-quicknav">
              {[
                { label: "Add Contact",        nav: "clients",   icon: "◈" },
                { label: "Payment Links",      nav: "clients",   icon: "₹" },
                { label: "Automation Logs",    nav: "activity",  icon: "⚡" },
                { label: "Control Center",     nav: "home",      icon: "◎" },
              ].map(a => (
                <button key={a.label} className="dv2-quicknav-btn" onClick={() => onNavigate?.(a.nav)}>
                  <span className="dv2-quicknav-icon" aria-hidden="true">{a.icon}</span>
                  <span>{a.label}</span>
                  <span className="dv2-quicknav-arrow" aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
