import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useConfirm } from "./ConfirmDialog";
import { dispatchTask, emergencyStop, emergencyResume } from "../runtimeApi";
import { getStats, getOpsData } from "../telemetryApi";
import "./ControlCenter.css";

// ── Helpers ────────────────────────────────────────────────────────────────────

function _timeAgo(isoStr) {
  if (!isoStr) return "";
  const ms   = Date.now() - new Date(isoStr).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60)  return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)  return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function _fmtUptime(secs) {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function _fmtINR(n) {
  if (!n) return "₹0";
  return `₹${Number(n).toLocaleString("en-IN")}`;
}

function _dot(ok, warn) {
  if (warn) return "dot--warn";
  return ok ? "dot--ok" : "dot--crit";
}

// ── System Status Strip ────────────────────────────────────────────────────────

function StatusStrip({ opsData, online, emergencyActive, onResume }) {
  const services = opsData?.services || {};
  const memory   = opsData?.memory?.current || {};
  const uptime   = opsData?.uptime?.seconds;

  const indicators = [
    { label: "AI",        ok: !!(services.ai || services.groq) },
    { label: "Queue",     ok: opsData?.queue?.healthy !== false && online },
    { label: "WhatsApp",  ok: !!services.whatsapp },
    { label: "Payments",  ok: !!services.payments },
  ];

  return (
    <div className={`cc2-strip${emergencyActive ? " cc2-strip--emergency" : ""}`}>
      {emergencyActive ? (
        <div className="cc2-strip-emergency">
          <span className="cc2-strip-dot dot--crit dot--live" />
          <span className="cc2-strip-emerg-label">EMERGENCY STOP ACTIVE</span>
          <button className="cc2-strip-resume" onClick={onResume}>Resume →</button>
        </div>
      ) : (
        <div className="cc2-strip-inner">
          <div className="cc2-strip-services">
            {indicators.map(s => (
              <span key={s.label} className="cc2-strip-svc">
                <span className={`cc2-strip-dot dot--${s.ok ? "ok" : "warn"} dot--live`} />
                <span className="cc2-strip-svc-label">{s.label}</span>
              </span>
            ))}
          </div>
          <div className="cc2-strip-meta">
            {uptime != null && (
              <span className="cc2-strip-stat">Uptime: {_fmtUptime(uptime)}</span>
            )}
            {memory.heap_mb != null && (
              <span className="cc2-strip-stat">Memory: {memory.heap_mb} MB</span>
            )}
            {!online && (
              <span className="cc2-strip-offline">● Reconnecting…</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Service Health Tiles ────────────────────────────────────────────────────────

function ServiceTiles({ opsData, stats, online, onNavigate }) {
  const services = opsData?.services || {};
  const queue    = opsData?.queue    || {};
  const qRun     = queue?.counts?.running   ?? 0;
  const qQueued  = queue?.counts?.pending   ?? 0;
  const qFailed  = queue?.counts?.failed    ?? 0;
  const msgs     = stats?.messages_today    ?? null;

  const tiles = [
    {
      id:    "contacts",
      icon:  "◈",
      label: "Contacts",
      ok:    true,
      value: stats?.total > 0 ? `${stats.total} leads` : "No leads yet",
      sub1:  stats?.hot > 0 ? `${stats.hot} hot` : "Add your first",
      sub2:  stats?.paid > 0 ? `${stats.paid} closed` : "Start adding leads",
      nav:   "clients",
    },
    {
      id:    "payments",
      icon:  "₹",
      label: "Payments",
      ok:    !!services.payments,
      value: services.payments ? "Razorpay live" : "Not configured",
      sub1:  stats?.revenue > 0 ? _fmtINR(stats.revenue) + " collected" : "₹0 collected",
      sub2:  services.payments ? "Ready to charge" : "Add Razorpay keys",
      nav:   "payments",
    },
    {
      id:    "comms",
      icon:  "✉",
      label: "WhatsApp",
      ok:    !!services.whatsapp,
      value: services.whatsapp ? "Connected" : "Not connected",
      sub1:  msgs != null ? `${msgs} messages today` : "—",
      sub2:  services.whatsapp ? "Sending follow-ups" : "Setup required",
      nav:   "clients",
    },
    {
      id:    "ai",
      icon:  "⚡",
      label: "AI Engine",
      ok:    !!(services.ai || services.groq),
      value: (services.ai || services.groq) ? "Online" : "Offline",
      sub1:  "Groq / Mixtral",
      sub2:  (services.ai || services.groq) ? "Ready for tasks" : "Add GROQ_API_KEY",
      nav:   "chat",
    },
  ];

  return (
    <div className="cc2-tiles">
      {tiles.map(t => (
        <button
          key={t.id}
          className={`cc2-tile hover-glow${!t.ok ? " cc2-tile--warn" : ""}`}
          onClick={() => onNavigate?.(t.nav)}
          aria-label={`${t.label}: ${t.value}`}
        >
          <div className="cc2-tile-header">
            <span className="cc2-tile-icon" aria-hidden="true">{t.icon}</span>
            <span className={`cc2-status-dot dot--${t.ok ? "ok" : "warn"} dot--live`} />
          </div>
          <div className="cc2-tile-label">{t.label}</div>
          <div className={`cc2-tile-value${!t.ok ? " cc2-tile-value--warn" : ""}`}>{t.value}</div>
          <div className="cc2-tile-meta">
            <span>{t.sub1}</span>
            {t.sub2 && (
              <span className={t.sub2Warn ? "cc2-tile-meta--warn" : ""}>{t.sub2}</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

// ── KPI Cards ──────────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, delta, deltaLabel, deltaOk, loading }) {
  return (
    <div className="cc2-kpi">
      <div className="cc2-kpi-top">
        <span className="cc2-kpi-icon" aria-hidden="true">{icon}</span>
        <span className="cc2-kpi-label">{label}</span>
      </div>
      {loading ? (
        <div className="cc2-skeleton cc2-skeleton--value" />
      ) : (
        <div className="cc2-kpi-value">{value}</div>
      )}
      {loading ? (
        <div className="cc2-skeleton cc2-skeleton--delta" />
      ) : delta != null ? (
        <div className={`cc2-kpi-delta${deltaOk === false ? " cc2-kpi-delta--bad" : ""}`}>
          {deltaOk !== false ? "↑ " : "↓ "}{deltaLabel}
        </div>
      ) : null}
    </div>
  );
}

function KpiRow({ stats, opsData, loading }) {
  const qRun    = opsData?.queue?.counts?.running  ?? 0;
  const qPend   = opsData?.queue?.counts?.pending  ?? 0;

  const cards = [
    {
      icon:       "◈",
      label:      "Leads",
      value:      stats?.total     ?? "—",
      delta:      stats?.hot,
      deltaLabel: `${stats?.hot ?? 0} hot`,
      deltaOk:    (stats?.hot ?? 0) > 0,
    },
    {
      icon:       "₹",
      label:      "Revenue",
      value:      _fmtINR(stats?.revenue),
      delta:      stats?.paid,
      deltaLabel: `${stats?.paid ?? 0} paid`,
      deltaOk:    (stats?.paid ?? 0) > 0,
    },
    {
      icon:       "✉",
      label:      "Messages",
      value:      stats?.messages_today ?? Object.values(opsData?.automation || {}).reduce((s, d) => s + (d.sent || 0), 0),
      delta:      null,
      deltaLabel: null,
    },
    {
      icon:       "⚙",
      label:      "Tasks",
      value:      qRun + qPend,
      delta:      qRun,
      deltaLabel: `${qRun} running`,
      deltaOk:    true,
    },
  ];

  return (
    <div className="cc2-kpi-row">
      {cards.map(c => (
        <KpiCard key={c.label} {...c} loading={loading} />
      ))}
    </div>
  );
}

// ── Activity Feed ──────────────────────────────────────────────────────────────

function _buildFeed(opsData, stats) {
  const entries = [];
  const auto    = opsData?.automation || {};
  const tierLabels = {
    "10min":      "First message sent",
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
        type:  "task",
        label: tierLabels[key] || key,
        meta:  `${data.sent} sent · ${data.sent - (data.failed || 0)} delivered`,
        ts:    data.lastRun,
        ok:    true,
      });
    }
  });

  const dlq = opsData?.queue?.dlq ?? 0;
  if (dlq > 0) {
    entries.push({ id: "dlq", type: "error", label: `${dlq} task${dlq > 1 ? "s" : ""} failed`, meta: "Dead-letter queue", ts: null, ok: false });
  }

  (opsData?.failures || []).slice(0, 2).forEach((f, i) => {
    entries.push({ id: `fail-${i}`, type: "error", label: (f.input || "Task").slice(0, 55), meta: (f.error || "").slice(0, 50), ts: f.ts || f.timestamp, ok: false });
  });

  if (stats?.paid > 0) {
    entries.push({ id: "paid", type: "revenue", label: `${stats.paid} client${stats.paid > 1 ? "s" : ""} paid`, meta: _fmtINR(stats.revenue) + " collected", ts: null, ok: true });
  }
  if (stats?.hot > 0) {
    entries.push({ id: "hot", type: "lead", label: `${stats.hot} hot lead${stats.hot > 1 ? "s" : ""}`, meta: "Ready to close", ts: null, ok: true });
  }

  return entries
    .sort((a, b) => {
      if (!a.ts && !b.ts) return 0;
      if (!a.ts) return -1;
      if (!b.ts) return 1;
      return new Date(b.ts) - new Date(a.ts);
    })
    .slice(0, 6);
}

const FEED_ICON = { task: "⚡", revenue: "₹", lead: "◈", error: "⚠", agent: "◎", whatsapp: "✉" };
const FEED_COLOR = { task: "var(--accent)", revenue: "var(--success)", lead: "var(--warning)", error: "var(--danger)", agent: "var(--accent2)", whatsapp: "var(--accent2)" };

function ActivityFeed({ opsData, stats, loading, onNavigate }) {
  const entries = useMemo(() => _buildFeed(opsData, stats), [opsData, stats]);

  if (loading) {
    return (
      <div className="cc2-feed-list">
        {[0, 1, 2].map(i => (
          <div key={i} className="cc2-feed-row cc2-feed-row--skeleton">
            <div className="cc2-skeleton cc2-skeleton--icon" />
            <div className="cc2-skeleton cc2-skeleton--text" />
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="cc2-empty">
        <div className="cc2-empty-icon">◎</div>
        <p className="cc2-empty-title">Nothing running yet</p>
        <p className="cc2-empty-sub">Add a contact with their WhatsApp number — Ooplix queues the first follow-up in 10 minutes.</p>
        <button className="cc2-empty-btn" onClick={() => onNavigate?.("clients")}>Add first contact →</button>
      </div>
    );
  }

  return (
    <div className="cc2-feed-list">
      {entries.map(e => (
        <div key={e.id} className={`cc2-feed-row${e.ok ? "" : " cc2-feed-row--error"}`}>
          <span className="cc2-feed-icon" style={{ color: FEED_COLOR[e.type] || "var(--text-dim)" }} aria-hidden="true">
            {FEED_ICON[e.type] || "◇"}
          </span>
          <div className="cc2-feed-body">
            <span className="cc2-feed-label">{e.label}</span>
            {e.meta && <span className="cc2-feed-meta">{e.meta}</span>}
          </div>
          {e.ts && <span className="cc2-feed-ts">{_timeAgo(e.ts)}</span>}
        </div>
      ))}
    </div>
  );
}

// ── Quick Actions ──────────────────────────────────────────────────────────────

function QuickActions({ online, onNavigate, onEmergencyStop, emergencyActive }) {
  const [stopBusy, setStopBusy] = useState(false);
  const [confirm, ConfirmUI] = useConfirm();

  const handleStop = useCallback(async () => {
    if (!await confirm({ title: 'Emergency Stop', message: 'All running tasks will be halted immediately. This cannot be undone without manual resume.', danger: true, confirmLabel: 'Stop Everything' })) return;
    setStopBusy(true);
    try { await onEmergencyStop?.(); } finally { setStopBusy(false); }
  }, [onEmergencyStop, confirm]);

  const actions = [
    { icon: "◈", label: "Add Contact",           onClick: () => onNavigate?.("clients") },
    { icon: "₹", label: "Generate Payment Link",  onClick: () => onNavigate?.("payments") },
    { icon: "⚡", label: "Send Follow-up",         onClick: () => onNavigate?.("clients") },
    { icon: "◎", label: "View Pipeline",          onClick: () => onNavigate?.("insights") },
  ];

  return (
    <div className="cc2-actions-list">
      {ConfirmUI}
      {actions.map(a => (
        <button
          key={a.label}
          className="cc2-action-btn"
          onClick={a.onClick}
          disabled={!online}
        >
          <span className="cc2-action-icon" aria-hidden="true">{a.icon}</span>
          <span className="cc2-action-label">{a.label}</span>
          <span className="cc2-action-arrow" aria-hidden="true">›</span>
        </button>
      ))}

      <div className="cc2-actions-divider" />

      <button
        className={`cc2-action-btn cc2-action-btn--danger${emergencyActive ? " cc2-action-btn--active-stop" : ""}`}
        onClick={emergencyActive ? () => onNavigate?.("stop-resume") : handleStop}
        disabled={stopBusy}
      >
        <span className="cc2-action-icon" aria-hidden="true">⏹</span>
        <span className="cc2-action-label">
          {emergencyActive ? "Emergency Stop Active" : "Emergency Stop"}
        </span>
        {stopBusy && <span className="cc2-spinner" />}
      </button>
    </div>
  );
}

// ── Health Indicators ──────────────────────────────────────────────────────────

function HealthIndicators({ opsData, online }) {
  const services = opsData?.services || {};
  const memory   = opsData?.memory?.current || {};
  const heap     = memory.heap_mb ?? 0;
  const heapPct  = Math.min(100, Math.round((heap / 512) * 100));

  const rows = [
    { label: "AI Engine",  ok: !!(services.ai || services.groq), value: (services.ai || services.groq) ? "Active" : "Offline" },
    { label: "WhatsApp",   ok: !!services.whatsapp,              value: services.whatsapp  ? "Connected" : "Not set up" },
    { label: "Payments",   ok: !!services.payments,              value: services.payments  ? "Razorpay live" : "Not configured" },
    { label: "Runtime",    ok: online,                           value: online ? "Online" : "Offline" },
  ];

  return (
    <div className="cc2-health">
      {rows.map(r => (
        <div key={r.label} className="cc2-health-row">
          <span className={`cc2-health-dot dot--${r.ok ? "ok" : "warn"} dot--live`} />
          <span className="cc2-health-label">{r.label}</span>
          <span className={`cc2-health-val${!r.ok ? " cc2-health-val--warn" : ""}`}>{r.value}</span>
        </div>
      ))}

      {heap > 0 && (
        <div className="cc2-mem-row">
          <span className="cc2-health-label">Memory</span>
          <div className="cc2-mem-track">
            <div
              className="cc2-mem-fill"
              style={{
                width: `${heapPct}%`,
                background: heapPct > 80 ? "var(--danger)" : heapPct > 60 ? "var(--warning)" : "var(--success)",
              }}
            />
          </div>
          <span className="cc2-health-val">{heap} MB</span>
        </div>
      )}
    </div>
  );
}

// ── Command Dispatch ──────────────────────────────────────────────────────────

const QUICK_CMDS = [
  { label: "Pipeline summary", cmd: "Show my pipeline summary" },
  { label: "Queue status",     cmd: "run pm2 list"             },
  { label: "System check",     cmd: "run pm2 status"           },
];

function CommandDispatch({ online }) {
  const [input,   setInput]   = useState("");
  const [result,  setResult]  = useState(null);
  const [busy,    setBusy]    = useState(false);

  const run = useCallback(async (cmd) => {
    const text = (cmd || input).trim();
    if (!text || busy || !online) return;
    setBusy(true);
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
      setBusy(false);
      if (!cmd) setInput("");
    }
  }, [input, busy, online]);

  return (
    <div className="cc2-dispatch">
      <div className="cc2-dispatch-row">
        <input
          className="cc2-dispatch-input"
          placeholder={online ? "Run a command, workflow, or task…" : "Backend offline"}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } }}
          disabled={!online || busy}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="cc2-dispatch-btn" onClick={() => run()} disabled={!online || busy || !input.trim()}>
          {busy ? <span className="cc2-spinner-sm" /> : "Run →"}
        </button>
      </div>
      <div className="cc2-dispatch-chips">
        {QUICK_CMDS.map(q => (
          <button key={q.cmd} className="cc2-dispatch-chip" onClick={() => run(q.cmd)} disabled={!online || busy}>
            {q.label}
          </button>
        ))}
      </div>
      {result && (
        <div className={`cc2-dispatch-result${result.ok ? "" : " cc2-dispatch-result--err"}`}>
          <span className="cc2-dispatch-result-icon">{result.ok ? "✓" : "✗"}</span>
          <span className="cc2-dispatch-result-text">{result.text}</span>
        </div>
      )}
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────

export default function ControlCenter({ stats, opsData, online, onNavigate, billing, onUpgrade }) {
  const [loading,         setLoading]         = useState(!stats && !opsData);
  const [emergencyActive, setEmergencyActive] = useState(() => opsData?.emergencyStop?.active ?? false);

  useEffect(() => {
    if (stats !== null || opsData !== null) setLoading(false);
  }, [stats, opsData]);

  useEffect(() => {
    setEmergencyActive(opsData?.emergencyStop?.active ?? false);
  }, [opsData]);

  const handleEmergencyStop = useCallback(async () => {
    const res = await emergencyStop("operator_initiated");
    if (res?.success !== false) setEmergencyActive(true);
  }, []);

  const handleEmergencyResume = useCallback(async () => {
    const res = await emergencyResume();
    if (res?.success !== false) setEmergencyActive(false);
  }, []);

  const today = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="cc2-root page-enter">

      {/* System Status Strip */}
      <StatusStrip
        opsData={opsData}
        online={online}
        emergencyActive={emergencyActive}
        onResume={handleEmergencyResume}
      />

      {/* Page Header */}
      <div className="cc2-header">
        <div className="cc2-header-left">
          <h1 className="cc2-page-title">Control Center</h1>
          <p className="cc2-page-sub">Today's operations · {today}</p>
        </div>
        <div className="cc2-header-right">
          {online && (
            <span className="cc2-active-badge">
              <span className="cc2-active-dot dot--ok dot--live" />
              Live
            </span>
          )}
        </div>
      </div>

      {/* Service Health Tiles */}
      <ServiceTiles opsData={opsData} stats={stats} online={online} onNavigate={onNavigate} />

      {/* KPI Row */}
      <section className="cc2-section">
        <h2 className="cc2-section-label">Today's Metrics</h2>
        <KpiRow stats={stats} opsData={opsData} loading={loading} />
      </section>

      {/* Main Content Grid */}
      <div className="cc2-grid">

        {/* Left: Activity Feed */}
        <div className="cc2-grid-main">
          <section className="cc2-panel">
            <div className="cc2-panel-header">
              <h2 className="cc2-section-label">Recent Activity</h2>
              <button className="cc2-panel-link" onClick={() => onNavigate?.("activity")}>
                See all →
              </button>
            </div>
            <ActivityFeed opsData={opsData} stats={stats} loading={loading} onNavigate={onNavigate} />
          </section>

          {/* Command Dispatch */}
          <section className="cc2-panel cc2-panel--dispatch">
            <h2 className="cc2-section-label">Run a Task</h2>
            <CommandDispatch online={online} />
          </section>
        </div>

        {/* Right: Quick Actions + Health */}
        <div className="cc2-grid-side">
          <section className="cc2-panel">
            <h2 className="cc2-section-label">Quick Actions</h2>
            <QuickActions
              online={online}
              onNavigate={onNavigate}
              onEmergencyStop={handleEmergencyStop}
              emergencyActive={emergencyActive}
            />
          </section>

          <section className="cc2-panel">
            <h2 className="cc2-section-label">Health</h2>
            <HealthIndicators opsData={opsData} online={online} />
          </section>
        </div>
      </div>

      {/* First-run guide: shown when no leads yet */}
      {!loading && (stats?.total === 0 || stats?.total == null) && (
        <section className="cc2-firstrun">
          <div className="cc2-firstrun-header">
            <span className="cc2-firstrun-icon">🚀</span>
            <div>
              <h3 className="cc2-firstrun-title">Start your first deal in 60 seconds</h3>
              <p className="cc2-firstrun-sub">Follow these 3 steps to get Ooplix working for you.</p>
            </div>
          </div>
          <div className="cc2-firstrun-steps">
            <button className="cc2-firstrun-step" onClick={() => onNavigate?.("clients")}>
              <span className="cc2-firstrun-num">1</span>
              <div className="cc2-firstrun-step-body">
                <span className="cc2-firstrun-step-label">Add a contact</span>
                <span className="cc2-firstrun-step-desc">Name + WhatsApp number — follow-up queues automatically</span>
              </div>
              <span className="cc2-firstrun-step-arrow">›</span>
            </button>
            <button className="cc2-firstrun-step" onClick={() => onNavigate?.("payments")}>
              <span className="cc2-firstrun-num">2</span>
              <div className="cc2-firstrun-step-body">
                <span className="cc2-firstrun-step-label">Send a payment link</span>
                <span className="cc2-firstrun-step-desc">Generate a Razorpay link and share it on WhatsApp</span>
              </div>
              <span className="cc2-firstrun-step-arrow">›</span>
            </button>
            <button className="cc2-firstrun-step" onClick={() => onNavigate?.("billing")}>
              <span className="cc2-firstrun-num">3</span>
              <div className="cc2-firstrun-step-body">
                <span className="cc2-firstrun-step-label">Upgrade when ready</span>
                <span className="cc2-firstrun-step-desc">7-day trial — no credit card needed to start</span>
              </div>
              <span className="cc2-firstrun-step-arrow">›</span>
            </button>
          </div>
        </section>
      )}

      {/* Trial usage nudge */}
      {billing && (billing.status === "trialing" || billing.status === "expired") && stats?.total > 0 && (
        <section className="cc2-trial-nudge">
          <div className="cc2-trial-inner">
            <span className="cc2-trial-icon">⚡</span>
            <div className="cc2-trial-text">
              <strong>Trial active</strong> — {stats.total ?? 0} of 25 leads used.
              {" "}<button className="cc2-trial-upgrade" onClick={onUpgrade}>Upgrade for unlimited →</button>
            </div>
          </div>
        </section>
      )}

    </div>
  );
}
