import React, { useState, useEffect, useCallback, useMemo } from "react";
import { getStats, getOpsData, getMetrics } from "../telemetryApi";
import { getLeads } from "../api";
import JourneyBanner from "./JourneyBanner";
import "./ReportsV2.css";

// ── Helpers ────────────────────────────────────────────────────────────────────

function _fmtINR(v) {
  if (!v) return "₹0";
  const n = Number(v);
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${n.toLocaleString("en-IN")}`;
}

function _fmtUptime(secs) {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const d = Math.floor(h / 24);
  if (d > 0)  return `${d}d ${h % 24}h`;
  if (h > 0)  return `${h}h`;
  return `${Math.floor(secs / 60)}m`;
}

function _uptimePct(secs) {
  if (!secs) return "—";
  const max7d = 7 * 24 * 3600;
  const pct   = Math.min(100, (secs / max7d) * 100);
  return `${pct.toFixed(1)}%`;
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

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const STATUS_META = {
  new:       { label: "New",       color: "var(--accent, #7c6fff)" },
  hot:       { label: "Hot",       color: "var(--warning, #f0b429)" },
  qualified: { label: "Qualified", color: "var(--accent2, #4ecdc4)" },
  won:       { label: "Won",       color: "var(--success, #52d68a)" },
  paid:      { label: "Paid",      color: "var(--success, #52d68a)" },
  lost:      { label: "Lost",      color: "var(--text-faint, #4a5470)" },
  onboarded: { label: "Onboarded", color: "var(--success, #52d68a)" },
};

// ── Skeleton ───────────────────────────────────────────────────────────────────

function Skeleton({ w, h }) {
  return (
    <div className="rv2-skeleton" style={{ width: w || "100%", height: h || 16, borderRadius: 6 }} />
  );
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, accent, loading }) {
  return (
    <div className="rv2-kpi">
      <div className="rv2-kpi-top">
        <span className="rv2-kpi-icon" style={{ color: accent || "var(--accent)" }}>{icon}</span>
        <span className="rv2-kpi-label">{label}</span>
      </div>
      {loading ? <Skeleton w="55%" h={26} /> : (
        <div className="rv2-kpi-value" style={{ color: accent || "var(--text)" }}>{value ?? "—"}</div>
      )}
      {loading ? <Skeleton w="40%" h={12} /> : (
        sub && <div className="rv2-kpi-sub">{sub}</div>
      )}
    </div>
  );
}

// ── Pipeline Breakdown (CSS-only horizontal bars) ──────────────────────────────

function PipelineChart({ leads, loading }) {
  const bars = useMemo(() => {
    if (!leads?.length) return [];
    const grouped = leads.reduce((acc, l) => {
      const s = l.status || "new";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    const raw = Object.entries(grouped).map(([status, count]) => ({
      status,
      count,
      ...(STATUS_META[status] || { label: status, color: "var(--text-faint)" }),
    })).sort((a, b) => b.count - a.count);
    const max = Math.max(...raw.map(b => b.count), 1);
    return raw.map(b => ({ ...b, pct: Math.round((b.count / max) * 100) }));
  }, [leads]);

  if (loading) return (
    <div className="rv2-chart-bars">
      {[80, 60, 45, 30].map((w, i) => (
        <div key={i} className="rv2-bar-row">
          <div className="rv2-skeleton" style={{ width: 72, height: 12, borderRadius: 4 }} />
          <div className="rv2-bar-track">
            <div className="rv2-skeleton" style={{ width: `${w}%`, height: "100%", borderRadius: 4 }} />
          </div>
          <div className="rv2-skeleton" style={{ width: 24, height: 12, borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );

  if (!bars.length) return (
    <div className="rv2-empty-inline">
      <p>No lead data yet. Add contacts to see pipeline distribution.</p>
    </div>
  );

  const total = leads?.length || 0;

  return (
    <div className="rv2-chart-bars">
      {bars.map(b => (
        <div key={b.status} className="rv2-bar-row">
          <span className="rv2-bar-label">{b.label}</span>
          <div className="rv2-bar-track">
            <div className="rv2-bar-fill" style={{ width: `${b.pct}%`, background: b.color }} />
          </div>
          <span className="rv2-bar-count" style={{ color: b.color }}>{b.count}</span>
          <span className="rv2-bar-pct">{total ? Math.round((b.count / total) * 100) : 0}%</span>
        </div>
      ))}
    </div>
  );
}

// ── Automation Summary Rows ────────────────────────────────────────────────────

const TIER_LABELS = {
  "10min":      "First message",
  "6hr":        "Same-day follow-up",
  "24hr":       "Next-day check-in",
  "3day":       "3-day closing",
  "onboarding": "Welcome message",
  "upsell":     "Upsell nudge",
};

function AutoSummary({ opsData, loading }) {
  const entries = Object.entries(opsData?.automation || {});

  if (loading) return (
    <div className="rv2-auto-rows">
      {[0, 1, 2].map(i => (
        <div key={i} className="rv2-auto-row">
          <Skeleton w="45%" h={13} />
          <Skeleton w="25%" h={13} />
        </div>
      ))}
    </div>
  );

  if (!entries.length) return (
    <div className="rv2-empty-inline">
      <p>Automation will appear once follow-ups have been sent.</p>
    </div>
  );

  const totalSent   = entries.reduce((s, [, d]) => s + (d.sent || 0), 0);
  const totalFailed = entries.reduce((s, [, d]) => s + (d.failed || 0), 0);

  return (
    <div>
      <div className="rv2-auto-summary-bar">
        <span className="rv2-auto-total">{totalSent.toLocaleString()} messages sent</span>
        {totalFailed > 0 && <span className="rv2-auto-failed">{totalFailed} failed</span>}
      </div>
      <div className="rv2-auto-rows">
        {entries.map(([key, data]) => {
          const { sent = 0, failed = 0, attempts = 0, lastRun } = data;
          const rate = attempts > 0 ? Math.round((sent / attempts) * 100) : null;
          return (
            <div key={key} className="rv2-auto-row">
              <div className="rv2-auto-row-left">
                <span className="rv2-auto-label">{TIER_LABELS[key] || key}</span>
                {lastRun && <span className="rv2-auto-last">Last: {_timeAgo(lastRun)}</span>}
              </div>
              <div className="rv2-auto-row-right">
                <span className="rv2-auto-sent">{sent} sent</span>
                {failed > 0 && <span className="rv2-auto-fail-ct">{failed} failed</span>}
                {rate !== null && (
                  <span className="rv2-auto-rate" style={{ color: rate >= 50 ? "var(--success)" : "var(--text-dim)" }}>
                    {rate}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── System Performance ─────────────────────────────────────────────────────────

function SystemPerf({ opsData, metrics, loading }) {
  const uptime     = opsData?.uptime?.seconds ?? 0;
  const memory     = opsData?.memory?.current?.heap_mb ?? null;
  const memWarn    = opsData?.memory?.warn ?? 512;
  const completed  = opsData?.queue?.counts?.completed ?? 0;
  const failed     = opsData?.queue?.counts?.failed ?? 0;
  const dlq        = opsData?.queue?.dlq ?? 0;
  const avgResp    = metrics?.avg_response_ms ?? null;

  const rows = [
    { label: "System uptime",    value: _fmtUptime(uptime),                     sub: _uptimePct(uptime) + " of 7-day window" },
    { label: "Tasks completed",  value: completed.toLocaleString(),              sub: failed > 0 ? `${failed} failed · ${dlq} in DLQ` : "All healthy" },
    { label: "Memory usage",     value: memory !== null ? `${memory} MB` : "—", sub: memory !== null ? (memory > memWarn ? "High" : "Normal") : "" },
    { label: "Avg response",     value: avgResp !== null ? `${avgResp}ms` : "—", sub: avgResp !== null ? (avgResp > 1000 ? "Slow" : "Normal") : "Backend unavailable" },
  ];

  return (
    <div className="rv2-perf-rows">
      {rows.map(r => (
        <div key={r.label} className="rv2-perf-row">
          <span className="rv2-perf-label">{r.label}</span>
          <div className="rv2-perf-right">
            {loading ? <Skeleton w={60} h={13} /> : (
              <>
                <span className="rv2-perf-value">{r.value}</span>
                {r.sub && <span className="rv2-perf-sub">{r.sub}</span>}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Coming Soon Banner ─────────────────────────────────────────────────────────

function ComingSoon({ feature }) {
  return (
    <div className="rv2-coming-soon">
      <span className="rv2-coming-icon">◎</span>
      <div>
        <p className="rv2-coming-title">{feature} — Coming Soon</p>
        <p className="rv2-coming-sub">Export, scheduling, and team sharing are under development. Current data is available below.</p>
      </div>
    </div>
  );
}

// ── Service Health Row ─────────────────────────────────────────────────────────

function ServiceHealth({ opsData, online, loading }) {
  const svcs = opsData?.services || {};
  const rows = [
    { label: "AI Engine",  ok: !!(svcs.ai || svcs.groq), detail: (svcs.ai || svcs.groq) ? "Active" : "Not configured" },
    { label: "WhatsApp",   ok: !!svcs.whatsapp,          detail: svcs.whatsapp ? "Connected" : "Not set up" },
    { label: "Payments",   ok: !!svcs.payments,          detail: svcs.payments ? "Razorpay live" : "Not configured" },
    { label: "Runtime",    ok: online,                   detail: online ? "Online" : "Reconnecting…" },
  ];

  return (
    <div className="rv2-health-rows">
      {loading
        ? [0,1,2,3].map(i => <div key={i} className="rv2-health-row"><Skeleton h={16} /></div>)
        : rows.map(r => (
          <div key={r.label} className="rv2-health-row">
            <span className={`rv2-health-dot dot--${r.ok ? "ok" : "warn"} dot--live`} />
            <span className="rv2-health-label">{r.label}</span>
            <span className={`rv2-health-detail${!r.ok ? " rv2-health-detail--warn" : ""}`}>{r.detail}</span>
          </div>
        ))
      }
    </div>
  );
}

// ── Root Reports V2 ───────────────────────────────────────────────────────────

export default function ReportsV2({ online = false, onNavigate }) {
  const [stats,   setStats]   = useState(null);
  const [opsData, setOpsData] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [leads,   setLeads]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [period,  setPeriod]  = useState("week");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [st, ops, met, leds] = await Promise.all([
        getStats(), getOpsData(), getMetrics(), getLeads(),
      ]);
      setStats(st);
      setOpsData(ops);
      setMetrics(met);
      setLeads(Array.isArray(leds) ? leds : []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const now       = new Date();
  const monthName = MONTH_LABELS[now.getMonth()];
  const yearStr   = now.getFullYear();

  const totalActions  = Object.values(opsData?.automation || {}).reduce((s, d) => s + (d.sent || 0), 0);
  const convRate      = stats?.total > 0 && stats?.paid > 0
    ? `${Math.round((stats.paid / stats.total) * 100)}%`
    : "0%";

  return (
    <div className="rv2-root page-enter">
      <JourneyBanner currentTab="reports" onNavigate={onNavigate} />

      {/* Header */}
      <div className="rv2-header">
        <div className="rv2-header-left">
          <h1 className="rv2-page-title">Reports</h1>
          <p className="rv2-page-sub">Executive summary · {monthName} {yearStr}</p>
        </div>
        <div className="rv2-header-right">
          <button className="rv2-export-btn" title="Export — coming soon" disabled>
            ↓ Export PDF
          </button>
          <button className="rv2-refresh-btn" onClick={refresh} title="Refresh data">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Coming soon banner */}
      <ComingSoon feature="Advanced reporting" />

      {/* Period selector */}
      <div className="rv2-period-tabs">
        {[
          { id: "week",  label: "This Week" },
          { id: "month", label: "This Month" },
          { id: "all",   label: "All Time" },
        ].map(p => (
          <button
            key={p.id}
            className={`rv2-period-tab${period === p.id ? " rv2-period-tab--active" : ""}`}
            onClick={() => setPeriod(p.id)}
          >{p.label}</button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="rv2-kpi-row">
        <KpiCard
          icon="◈"
          label="Total Leads"
          value={stats?.total ?? 0}
          sub={`${stats?.hot ?? 0} hot · ${stats?.paid ?? 0} paid`}
          accent="var(--accent)"
          loading={loading}
        />
        <KpiCard
          icon="₹"
          label="Revenue"
          value={_fmtINR(stats?.revenue)}
          sub={`${stats?.paid ?? 0} paying clients`}
          accent="var(--success)"
          loading={loading}
        />
        <KpiCard
          icon="✉"
          label="Messages Sent"
          value={totalActions.toLocaleString()}
          sub="automated follow-ups"
          accent="var(--accent2)"
          loading={loading}
        />
        <KpiCard
          icon="◎"
          label="Close Rate"
          value={convRate}
          sub={`${stats?.total ?? 0} leads tracked`}
          accent={parseFloat(convRate) >= 20 ? "var(--success)" : "var(--warning)"}
          loading={loading}
        />
      </div>

      {/* Main content grid */}
      <div className="rv2-grid">

        <div className="rv2-grid-main">

          {/* Pipeline breakdown */}
          <section className="rv2-panel">
            <div className="rv2-panel-header">
              <h2 className="rv2-section-label">Pipeline Breakdown</h2>
              <button className="rv2-panel-link" onClick={() => onNavigate?.("clients")}>
                Contacts →
              </button>
            </div>
            <PipelineChart leads={leads} loading={loading} />
          </section>

          {/* Automation summary */}
          <section className="rv2-panel">
            <div className="rv2-panel-header">
              <h2 className="rv2-section-label">Automation Summary</h2>
              <button className="rv2-panel-link" onClick={() => onNavigate?.("activity")}>
                Activity →
              </button>
            </div>
            <AutoSummary opsData={opsData} loading={loading} />
          </section>

        </div>

        <div className="rv2-grid-side">

          {/* System performance */}
          <section className="rv2-panel">
            <div className="rv2-panel-header">
              <h2 className="rv2-section-label">System Performance</h2>
            </div>
            <SystemPerf opsData={opsData} metrics={metrics} loading={loading} />
          </section>

          {/* Service health */}
          <section className="rv2-panel">
            <div className="rv2-panel-header">
              <h2 className="rv2-section-label">Service Health</h2>
              <button className="rv2-panel-link" onClick={() => onNavigate?.("devops")}>
                DevOps →
              </button>
            </div>
            <ServiceHealth opsData={opsData} online={online} loading={loading} />
          </section>

        </div>
      </div>

    </div>
  );
}
