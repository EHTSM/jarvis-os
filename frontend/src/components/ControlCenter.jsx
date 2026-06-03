import React, { useState, useCallback, useMemo } from "react";
import { dispatchTask } from "../runtimeApi";
import VisualIntelligence from "./VisualIntelligence.jsx";
import "./ControlCenter.css";

// ── Helpers ────────────────────────────────────────────────────────

function _timeAgo(isoStr) {
  if (!isoStr) return "";
  const ms   = Date.now() - new Date(isoStr).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60)   return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)   return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  if (hrs  < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function _fmtUptime(secs) {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── AI Systems Strip ───────────────────────────────────────────────

function SystemsStrip({ opsData, online, onNavigate }) {
  const services  = opsData?.services  || {};
  const memory    = opsData?.memory?.current || {};
  const errors    = opsData?.errors    || {};
  const uptime    = opsData?.uptime?.seconds;
  const qPending  = opsData?.queue?.counts?.pending ?? 0;

  const systems = [
    {
      id:    "runtime",
      label: "Runtime",
      value: online ? "Live" : "Offline",
      ok:    online,
      sub:   online ? `Up ${_fmtUptime(uptime)}` : "Reconnecting…",
      nav:   "runtime",
    },
    {
      id:    "queue",
      label: "Queue",
      value: qPending > 0 ? `${qPending} pending` : "Clear",
      ok:    qPending === 0,
      sub:   opsData?.queue?.counts?.running > 0
               ? `${opsData.queue.counts.running} running`
               : "Idle",
      nav:   "runtime",
    },
    {
      id:    "whatsapp",
      label: "WhatsApp",
      value: services.whatsapp ? "Connected" : "Not set up",
      ok:    !!services.whatsapp,
      sub:   services.whatsapp ? "Sending follow-ups" : "Setup required",
      nav:   "clients",
    },
    {
      id:    "ai",
      label: "AI",
      value: (services.ai || services.groq) ? "Active" : "Not configured",
      ok:    !!(services.ai || services.groq),
      sub:   (services.ai || services.groq) ? "Ready for tasks" : "Add GROQ_API_KEY",
      nav:   "runtime",
    },
    {
      id:    "payments",
      label: "Payments",
      value: services.payments ? "Ready" : "Not configured",
      ok:    !!services.payments,
      sub:   services.payments ? "Razorpay active" : "Setup required",
      nav:   "clients",
    },
    {
      id:    "memory",
      label: "Memory",
      value: memory.heap_mb ? `${memory.heap_mb} MB` : "—",
      ok:    !opsData?.memory?.warn && !opsData?.memory?.critical,
      sub:   errors.errors_per_hour > 0
               ? `${errors.errors_per_hour} err/hr`
               : "Healthy",
      nav:   "runtime",
    },
  ];

  return (
    <section className="cc-section">
      <h2 className="cc-section-label">AI Systems</h2>
      <div className="cc-systems-grid">
        {systems.map(s => (
          <button
            key={s.id}
            className={`cc-system-card${!s.ok ? " cc-system-card--warn" : ""}`}
            onClick={() => onNavigate?.(s.nav)}
            aria-label={`${s.label}: ${s.value}`}
          >
            <div className="cc-system-header">
              <span className={`status-indicator dot--${s.ok ? "ok" : "warn"} dot--live`} />
              <span className="cc-system-label">{s.label}</span>
            </div>
            <div className="cc-system-value">{s.value}</div>
            <div className="cc-system-sub">{s.sub}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

// ── Autonomous Actions Feed ────────────────────────────────────────

function _buildFeed(opsData, stats) {
  const entries = [];
  const auto    = opsData?.automation || {};

  // Automation tier events
  const tierLabels = {
    "10min":      "Immediate greeting",
    "6hr":        "Same-day follow-up",
    "24hr":       "Next-day check-in",
    "3day":       "3-day closing",
    "onboarding": "Welcome message",
    "upsell":     "Upsell nudge",
  };

  Object.entries(auto).forEach(([key, data]) => {
    if (data.sent > 0 && data.lastRun) {
      entries.push({
        id:    `auto-${key}`,
        type:  "automation",
        label: `${tierLabels[key] || key} sent`,
        meta:  `${data.sent} total · ${data.sent - (data.failed || 0)} delivered`,
        ts:    data.lastRun,
        ok:    true,
      });
    }
  });

  // Queue DLQ events
  const dlq = opsData?.queue?.dlq ?? 0;
  if (dlq > 0) {
    entries.push({
      id:    "dlq",
      type:  "error",
      label: `${dlq} task${dlq > 1 ? "s" : ""} in dead-letter queue`,
      meta:  "Requires attention",
      ts:    null,
      ok:    false,
    });
  }

  // Failures
  const fails = opsData?.failures || [];
  fails.slice(0, 2).forEach((f, i) => {
    entries.push({
      id:    `fail-${i}`,
      type:  "error",
      label: (f.input || "Task").slice(0, 60),
      meta:  `Failed · ${(f.error || "").slice(0, 50)}`,
      ts:    f.ts || f.timestamp,
      ok:    false,
    });
  });

  // CRM events
  if (stats?.paid > 0) {
    entries.push({
      id:    "paid",
      type:  "revenue",
      label: `${stats.paid} client${stats.paid > 1 ? "s" : ""} paid`,
      meta:  stats.revenue ? `₹${stats.revenue.toLocaleString("en-IN")} collected` : "",
      ts:    null,
      ok:    true,
    });
  }
  if (stats?.hot > 0) {
    entries.push({
      id:    "hot",
      type:  "lead",
      label: `${stats.hot} hot lead${stats.hot > 1 ? "s" : ""}`,
      meta:  "Ready to close",
      ts:    null,
      ok:    true,
    });
  }

  // Sort by ts (most recent first), ts=null goes to top
  return entries
    .sort((a, b) => {
      if (!a.ts && !b.ts) return 0;
      if (!a.ts) return -1;
      if (!b.ts) return 1;
      return new Date(b.ts) - new Date(a.ts);
    })
    .slice(0, 8);
}

const TYPE_ICON = {
  automation: "◎",
  revenue:    "✦",
  lead:       "◈",
  error:      "⚠",
  system:     "◇",
};

function ActionsFeed({ opsData, stats, onNavigate }) {
  const entries = useMemo(() => _buildFeed(opsData, stats), [opsData, stats]);

  if (entries.length === 0) {
    return (
      <section className="cc-section">
        <h2 className="cc-section-label">Autonomous Actions</h2>
        <div className="cc-empty">
          <p className="cc-empty-title">No activity yet</p>
          <p className="cc-empty-sub">
            Add contacts and connect WhatsApp — autonomous follow-ups will appear here as they run.
          </p>
          <button className="cc-empty-btn" onClick={() => onNavigate?.("clients")}>
            Add first contact →
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="cc-section">
      <div className="cc-section-header">
        <h2 className="cc-section-label">Autonomous Actions</h2>
        <button className="cc-section-link" onClick={() => onNavigate?.("activity")}>
          See all →
        </button>
      </div>
      <div className="cc-feed">
        {entries.map(e => (
          <div key={e.id} className={`cc-feed-row${e.ok ? "" : " cc-feed-row--error"}`}>
            <span className="cc-feed-icon">{TYPE_ICON[e.type] || "◇"}</span>
            <div className="cc-feed-body">
              <span className="cc-feed-label">{e.label}</span>
              {e.meta && <span className="cc-feed-meta">{e.meta}</span>}
            </div>
            {e.ts && <span className="cc-feed-ts">{_timeAgo(e.ts)}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Runtime Health Bar ─────────────────────────────────────────────

function HealthBar({ opsData, online }) {
  const memory   = opsData?.memory?.current || {};
  const errors   = opsData?.errors || {};
  const queue    = opsData?.queue  || {};
  const status   = opsData?.status || (online ? "ok" : "offline");
  const warnings = opsData?.warnings || [];

  const heapPct  = memory.heap_mb  ? Math.min(100, Math.round((memory.heap_mb  / 512) * 100)) : 0;
  const qPending = queue?.counts?.pending ?? 0;
  const errRate  = errors.errors_per_hour ?? 0;

  const statusColor = status === "ok"       ? "var(--success)"
                    : status === "degraded" ? "var(--warning)"
                    : status === "critical" ? "var(--danger)"
                    : "var(--text-faint)";
  const statusLabel = status === "ok"       ? "Healthy"
                    : status === "degraded" ? "Degraded"
                    : status === "critical" ? "Critical"
                    : "Offline";

  return (
    <section className="cc-section">
      <h2 className="cc-section-label">Runtime Health</h2>
      <div className="cc-health-bar">
        <div className="cc-health-status">
          <span className={`status-indicator dot--${status === "ok" ? "ok" : status === "degraded" ? "warn" : "crit"} dot--live`} />
          <span className="cc-health-status-label" style={{ color: statusColor }}>{statusLabel}</span>
        </div>

        <div className="cc-health-metrics">
          <div className="cc-health-metric">
            <span className="cc-health-metric-label">Memory</span>
            <div className="cc-health-bar-track">
              <div
                className="cc-health-bar-fill"
                style={{
                  width: `${heapPct}%`,
                  background: heapPct > 80 ? "var(--danger)"
                            : heapPct > 60 ? "var(--warning)"
                            : "var(--success)",
                }}
              />
            </div>
            <span className="cc-health-metric-val">{memory.heap_mb ?? "—"} MB</span>
          </div>

          <div className="cc-health-metric">
            <span className="cc-health-metric-label">Queue</span>
            <span className={`cc-health-metric-val ${qPending > 10 ? "cc-val--warn" : ""}`}>
              {qPending} pending
            </span>
          </div>

          <div className="cc-health-metric">
            <span className="cc-health-metric-label">Errors/hr</span>
            <span className={`cc-health-metric-val ${errRate > 5 ? "cc-val--warn" : ""}`}>
              {errRate}
            </span>
          </div>

          <div className="cc-health-metric">
            <span className="cc-health-metric-label">Uptime</span>
            <span className="cc-health-metric-val">{_fmtUptime(opsData?.uptime?.seconds)}</span>
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="cc-warnings">
            {warnings.slice(0, 2).map((w, i) => (
              <div key={i} className={`cc-warning cc-warning--${w.level || "warn"}`}>
                <span className="cc-warning-icon">⚠</span>
                {w.detail || w.code}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Dispatch Bar ───────────────────────────────────────────────────

const QUICK_CMDS = [
  { label: "pm2 list",       cmd: "run pm2 list"             },
  { label: "git status",     cmd: "run git status"           },
  { label: "System check",   cmd: "run pm2 status"           },
  { label: "Pipeline",       cmd: "Show my pipeline summary" },
];

function DispatchBar({ online, onNavigate }) {
  const [input,   setInput]   = useState("");
  const [result,  setResult]  = useState(null);  // {ok, text}
  const [loading, setLoading] = useState(false);

  const handleDispatch = useCallback(async (cmd) => {
    const text = (cmd || input).trim();
    if (!text || loading) return;
    if (!online) { setResult({ ok: false, text: "Backend offline" }); return; }

    setLoading(true);
    setResult(null);
    try {
      const res = await dispatchTask(text, 20000);
      setResult({
        ok:   res.success !== false,
        text: res.reply || res.output || res.result || (res.success ? "Done." : res.error || "Failed."),
      });
    } catch (e) {
      setResult({ ok: false, text: e.message });
    } finally {
      setLoading(false);
      if (!cmd) setInput("");
    }
  }, [input, loading, online]);

  return (
    <section className="cc-section">
      <div className="cc-section-header">
        <h2 className="cc-section-label">Dispatch</h2>
        <button className="cc-section-link" onClick={() => onNavigate?.("runtime")}>
          Control Room →
        </button>
      </div>

      <div className="cc-dispatch">
        <div className="cc-dispatch-input-row">
          <input
            className="cc-dispatch-input"
            placeholder={online ? "Run a command, workflow, or task…" : "Backend offline"}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleDispatch(); } }}
            disabled={!online || loading}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="cc-dispatch-run"
            onClick={() => handleDispatch()}
            disabled={!online || loading || !input.trim()}
          >
            {loading ? "…" : "Run →"}
          </button>
        </div>

        <div className="cc-dispatch-quick">
          {QUICK_CMDS.map(q => (
            <button
              key={q.cmd}
              className="cc-dispatch-chip"
              onClick={() => handleDispatch(q.cmd)}
              disabled={!online || loading}
            >
              {q.label}
            </button>
          ))}
        </div>

        {result && (
          <div className={`cc-dispatch-result cc-dispatch-result--${result.ok ? "ok" : "err"}`}>
            <span className="cc-dispatch-result-icon">{result.ok ? "✓" : "✗"}</span>
            <span className="cc-dispatch-result-text mono truncate">{result.text}</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Business Activity Strip ────────────────────────────────────────

function BusinessStrip({ stats, onNavigate }) {
  if (!stats) return null;

  const metrics = [
    { label: "Total leads",  value: stats.total  ?? 0, color: "var(--text)"    },
    { label: "Hot",          value: stats.hot    ?? 0, color: "var(--warning)" },
    { label: "Paid",         value: stats.paid   ?? 0, color: "var(--success)" },
    {
      label: "Revenue",
      value: stats.revenue
        ? `₹${Number(stats.revenue).toLocaleString("en-IN")}`
        : "₹0",
      color: "var(--accent2)",
    },
  ];

  return (
    <section className="cc-section">
      <div className="cc-section-header">
        <h2 className="cc-section-label">Business Activity</h2>
        <button className="cc-section-link" onClick={() => onNavigate?.("insights")}>
          Pipeline →
        </button>
      </div>
      <div className="cc-biz-strip">
        {metrics.map(m => (
          <div key={m.label} className="cc-biz-metric">
            <span className="cc-biz-value" style={{ color: m.color }}>{m.value}</span>
            <span className="cc-biz-label">{m.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Root ───────────────────────────────────────────────────────────

export default function ControlCenter({ stats, opsData, online, onNavigate }) {
  return (
    <div className="cc-root">
      <div className="cc-header">
        <div className="cc-header-brand">
          <span className={`status-indicator dot--${online ? "ok" : "crit"} dot--live`} />
          <span className="cc-header-title">Control Center</span>
        </div>
        <span className="cc-header-sub">
          {online ? "System operational" : "Reconnecting…"}
        </span>
      </div>

      <div className="cc-content">
        <VisualIntelligence stats={stats} opsData={opsData} />
        <SystemsStrip  opsData={opsData} online={online}  onNavigate={onNavigate} />
        <ActionsFeed   opsData={opsData} stats={stats}    onNavigate={onNavigate} />
        <HealthBar     opsData={opsData} online={online} />
        <DispatchBar   online={online}                    onNavigate={onNavigate} />
      </div>
    </div>
  );
}
