import React, { useState, useEffect, useCallback, useMemo } from "react";
import { getOpsData, getStats } from "../telemetryApi";
import "./Logs.css";

// ── Helpers ────────────────────────────────────────────────────────────────────

function _timeAgo(isoStr) {
  if (!isoStr) return "never";
  const ms   = Date.now() - new Date(isoStr).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60)  return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)  return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function _fmtTs(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Build a unified event list from opsData + stats ────────────────────────────

const TIER_LABELS = {
  "10min":      "First message sent",
  "6hr":        "Same-day follow-up sent",
  "24hr":       "Next-day check-in sent",
  "3day":       "3-day closing message sent",
  "onboarding": "Welcome message sent",
  "upsell":     "Upsell message sent",
};

function _buildEvents(opsData, stats) {
  const events = [];
  const auto   = opsData?.automation || {};
  const queue  = opsData?.queue      || {};

  // Automation tiers → "task" type
  Object.entries(auto).forEach(([key, data]) => {
    if (data.sent > 0 && data.lastRun) {
      events.push({
        id:     `auto-${key}`,
        type:   "task",
        status: "success",
        label:  TIER_LABELS[key] || key,
        meta:   `${data.sent} sent · ${data.sent - (data.failed || 0)} delivered`,
        ts:     new Date(data.lastRun).getTime(),
      });
    }
    if ((data.failed || 0) > 0 && data.lastRun) {
      events.push({
        id:     `fail-${key}`,
        type:   "error",
        status: "error",
        label:  `${TIER_LABELS[key] || key} — delivery failures`,
        meta:   `${data.failed} failed`,
        ts:     new Date(data.lastRun).getTime(),
      });
    }
  });

  // Dead-letter queue
  const dlq = queue?.dlq ?? 0;
  if (dlq > 0) {
    events.push({
      id:     "dlq",
      type:   "error",
      status: "error",
      label:  `${dlq} task${dlq > 1 ? "s" : ""} in dead-letter queue`,
      meta:   "Manual review required",
      ts:     Date.now(),
    });
  }

  // Running tasks
  const running = queue?.counts?.running ?? 0;
  if (running > 0) {
    events.push({
      id:     "queue-running",
      type:   "task",
      status: "running",
      label:  `${running} task${running > 1 ? "s" : ""} running`,
      meta:   `${queue?.counts?.pending ?? 0} queued`,
      ts:     Date.now(),
    });
  }

  // CRM: paid leads
  if (stats?.paid > 0) {
    events.push({
      id:     "crm-paid",
      type:   "revenue",
      status: "success",
      label:  `${stats.paid} client${stats.paid > 1 ? "s" : ""} paid`,
      meta:   stats.revenue ? `₹${Number(stats.revenue).toLocaleString("en-IN")} collected` : "",
      ts:     Date.now() - 60_000,
    });
  }

  // CRM: hot leads
  if (stats?.hot > 0) {
    events.push({
      id:     "crm-hot",
      type:   "lead",
      status: "success",
      label:  `${stats.hot} hot lead${stats.hot > 1 ? "s" : ""}`,
      meta:   "Ready to close",
      ts:     Date.now() - 120_000,
    });
  }

  // Failure log
  (opsData?.failures || []).slice(0, 5).forEach((f, i) => {
    events.push({
      id:     `failure-${i}`,
      type:   "error",
      status: "error",
      label:  (f.input || "Task").slice(0, 60),
      meta:   (f.error || "").slice(0, 80),
      ts:     new Date(f.ts || f.timestamp || Date.now()).getTime(),
    });
  });

  return events.sort((a, b) => b.ts - a.ts);
}

// ── Log Row ────────────────────────────────────────────────────────────────────

const TYPE_ICON = {
  task:    "⚡",
  error:   "⚠",
  lead:    "◈",
  revenue: "₹",
  agent:   "◎",
  whatsapp:"✉",
};

const TYPE_COLOR = {
  task:    "var(--accent, #7c6fff)",
  error:   "var(--danger, #f55b5b)",
  lead:    "var(--warning, #f0b429)",
  revenue: "var(--success, #52d68a)",
  agent:   "var(--accent2, #4ecdc4)",
  whatsapp:"var(--accent2, #4ecdc4)",
};

const STATUS_CHIP = {
  success: { label: "SUCCESS", cls: "lv2-chip--ok"      },
  error:   { label: "ERROR",   cls: "lv2-chip--error"    },
  running: { label: "RUNNING", cls: "lv2-chip--running"  },
  failed:  { label: "FAILED",  cls: "lv2-chip--error"    },
};

function LogRow({ event }) {
  const [open, setOpen] = useState(false);
  const chip            = STATUS_CHIP[event.status] || STATUS_CHIP.success;

  return (
    <div className={`lv2-log-row${event.status === "error" ? " lv2-log-row--error" : ""}`}>
      <button
        className="lv2-log-main"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span className="lv2-log-ts">{_timeAgo(new Date(event.ts).toISOString())}</span>
        <span className="lv2-log-icon" style={{ color: TYPE_COLOR[event.type] || "var(--text-dim)" }} aria-hidden="true">
          {TYPE_ICON[event.type] || "◇"}
        </span>
        <span className="lv2-log-label">{event.label}</span>
        <span className={`lv2-chip ${chip.cls}`}>{chip.label}</span>
        <span className="lv2-log-expand" aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open && event.meta && (
        <div className="lv2-log-detail">
          <span className="lv2-log-meta">{event.meta}</span>
          <span className="lv2-log-time-full">{_fmtTs(event.ts)}</span>
        </div>
      )}
    </div>
  );
}

// ── Queue Stats ────────────────────────────────────────────────────────────────

function QueueStats({ opsData, loading }) {
  const q = opsData?.queue || {};

  if (loading) {
    return (
      <div className="lv2-queue-strip">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="lv2-skeleton lv2-skeleton--qstat" />
        ))}
      </div>
    );
  }

  if (!opsData) return null;

  const stats = [
    { label: "Pending",   val: q?.counts?.pending   ?? 0, color: "var(--accent)"  },
    { label: "Running",   val: q?.counts?.running   ?? 0, color: "var(--warning)" },
    { label: "Completed", val: q?.counts?.completed ?? 0, color: "var(--success)" },
    { label: "Failed",    val: q?.counts?.failed    ?? 0, color: q?.counts?.failed > 0 ? "var(--danger)" : "var(--text-faint)" },
  ];

  return (
    <div className="lv2-queue-strip">
      {stats.map(s => (
        <div key={s.label} className="lv2-queue-stat">
          <span className="lv2-queue-val" style={{ color: s.color }}>{s.val}</span>
          <span className="lv2-queue-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Filter Tabs ────────────────────────────────────────────────────────────────

const FILTERS = [
  { id: "all",      label: "All" },
  { id: "task",     label: "Tasks" },
  { id: "error",    label: "Errors" },
  { id: "lead",     label: "Leads" },
  { id: "revenue",  label: "Revenue" },
];

// ── Root Activity V2 ───────────────────────────────────────────────────────────

export default function Logs({ opsData: opsDataProp, stats: statsProp, onNavigate }) {
  const [liveOps,   setLiveOps]   = useState(null);
  const [liveStats, setLiveStats] = useState(null);
  const [filter,    setFilter]    = useState("all");
  const [liveMode,  setLiveMode]  = useState(true);
  const [loading,   setLoading]   = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const refresh = useCallback(async () => {
    const [ops, st] = await Promise.all([getOpsData(), getStats()]);
    setLiveOps(ops);
    setLiveStats(st);
    setLoading(false);
    setLastRefresh(Date.now());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!liveMode) return;
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 10_000);
    return () => clearInterval(id);
  }, [liveMode, refresh]);

  const opsData = liveOps   ?? opsDataProp;
  const stats   = liveStats ?? statsProp;

  const allEvents = useMemo(() => _buildEvents(opsData, stats), [opsData, stats]);

  const events = useMemo(() => {
    if (filter === "all") return allEvents;
    if (filter === "error") return allEvents.filter(e => e.status === "error" || e.status === "failed");
    return allEvents.filter(e => e.type === filter);
  }, [allEvents, filter]);

  const errorCount = allEvents.filter(e => e.status === "error").length;

  return (
    <div className="lv2-root page-enter">

      {/* Page Header */}
      <div className="lv2-header">
        <div className="lv2-header-left">
          <h1 className="lv2-page-title">Activity</h1>
          <p className="lv2-page-sub">
            Execution log{lastRefresh ? ` · Updated ${_timeAgo(new Date(lastRefresh).toISOString())}` : ""}
          </p>
        </div>
        <div className="lv2-header-right">
          <button
            className={`lv2-live-btn${liveMode ? " lv2-live-btn--active" : ""}`}
            onClick={() => setLiveMode(v => !v)}
            title={liveMode ? "Live refresh on — click to pause" : "Live refresh paused — click to resume"}
          >
            <span className={`lv2-live-dot${liveMode ? " dot--ok dot--live" : ""}`} />
            {liveMode ? "Live" : "Paused"}
          </button>
          <button className="lv2-refresh-btn" onClick={refresh} title="Refresh now">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Queue Stats Strip */}
      <div className="lv2-section">
        <QueueStats opsData={opsData} loading={loading} />
      </div>

      {/* Filter Tabs */}
      <div className="lv2-filter-tabs" role="tablist">
        {FILTERS.map(f => (
          <button
            key={f.id}
            className={`lv2-filter-tab${filter === f.id ? " lv2-filter-tab--active" : ""}`}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            {f.id === "error" && errorCount > 0 && (
              <span className="lv2-filter-badge">{errorCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Log List */}
      <div className="lv2-log-list">
        {loading ? (
          [0, 1, 2, 3].map(i => (
            <div key={i} className="lv2-log-row lv2-log-row--skeleton">
              <div className="lv2-skeleton lv2-skeleton--ts" />
              <div className="lv2-skeleton lv2-skeleton--icon" />
              <div className="lv2-skeleton lv2-skeleton--label" />
              <div className="lv2-skeleton lv2-skeleton--chip" />
            </div>
          ))
        ) : events.length === 0 ? (
          <div className="lv2-empty">
            <div className="lv2-empty-icon">◎</div>
            <p className="lv2-empty-title">
              {filter === "all" ? "No activity yet" : `No ${filter} events`}
            </p>
            <p className="lv2-empty-sub">
              {filter === "all"
                ? "Add contacts and connect WhatsApp to see live activity here."
                : `Switch to "All" to see everything, or wait for new events.`}
            </p>
            {filter !== "all" && (
              <button className="lv2-empty-btn" onClick={() => setFilter("all")}>Show all →</button>
            )}
            {filter === "all" && (
              <button className="lv2-empty-btn" onClick={() => onNavigate?.("clients")}>Add first contact →</button>
            )}
          </div>
        ) : (
          events.map(e => <LogRow key={e.id} event={e} />)
        )}
      </div>

    </div>
  );
}
