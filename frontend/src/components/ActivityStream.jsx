import React, { useMemo } from "react";
import "./ActivityStream.css";

// ── Helpers ────────────────────────────────────────────────────────

function _timeAgo(isoStr) {
  if (!isoStr) return "";
  const ms   = Date.now() - new Date(isoStr).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 5)    return "just now";
  if (secs < 60)   return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)   return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  if (hrs  < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Event type registry ────────────────────────────────────────────

const EVENT_TYPES = {
  lead_added:          { label: "Lead Added",          icon: "◈", colorVar: "--accent"    },
  lead_qualified:      { label: "Lead Qualified",      icon: "◉", colorVar: "--warning"   },
  payment_received:    { label: "Payment Received",    icon: "✦", colorVar: "--success"   },
  followup_sent:       { label: "Follow-up Sent",      icon: "◎", colorVar: "--accent2"   },
  workflow_executed:   { label: "Workflow Executed",   icon: "⚡", colorVar: "--accent"    },
  runtime_warning:     { label: "Runtime Warning",     icon: "⚠", colorVar: "--warning"   },
  runtime_recovery:    { label: "Runtime Recovery",    icon: "✓", colorVar: "--success"   },
  runtime_error:       { label: "Runtime Error",       icon: "✗", colorVar: "--danger"    },
  queue_overload:      { label: "Queue Overload",      icon: "⊗", colorVar: "--danger"    },
  dlq_event:           { label: "Task Failed",         icon: "⊘", colorVar: "--danger"    },
};

// ── Event builder ──────────────────────────────────────────────────
// Synthesizes events from opsData + stats without new endpoints.

const TIER_SHORT = {
  "10min":      "10-min greeting",
  "6hr":        "same-day follow-up",
  "24hr":       "next-day check-in",
  "3day":       "3-day close",
  "onboarding": "welcome message",
  "upsell":     "upsell nudge",
};

function _buildEvents(opsData, stats) {
  const events = [];

  // ── Automation follow-ups sent ────────────────────────────────
  const auto = opsData?.automation || {};
  Object.entries(auto).forEach(([key, data]) => {
    if (data.sent > 0 && data.lastRun) {
      events.push({
        id:   `auto-${key}`,
        type: "followup_sent",
        title: `Follow-up sent`,
        body:  `${TIER_SHORT[key] || key} · ${data.sent} total`,
        ts:    data.lastRun,
      });
    }
  });

  // ── Payment events ────────────────────────────────────────────
  if (stats?.paid > 0) {
    events.push({
      id:    "payment",
      type:  "payment_received",
      title: `${stats.paid} payment${stats.paid > 1 ? "s" : ""} received`,
      body:  stats.revenue ? `₹${Number(stats.revenue).toLocaleString("en-IN")} total` : "Revenue collected",
      ts:    null,
    });
  }

  // ── Lead qualification (hot leads) ────────────────────────────
  if (stats?.hot > 0) {
    events.push({
      id:    "hot",
      type:  "lead_qualified",
      title: `${stats.hot} lead${stats.hot > 1 ? "s" : ""} qualified`,
      body:  "High engagement detected",
      ts:    null,
    });
  }

  // ── DLQ events ────────────────────────────────────────────────
  const dlq = opsData?.queue?.dlq ?? 0;
  if (dlq > 0) {
    events.push({
      id:    "dlq",
      type:  "dlq_event",
      title: `${dlq} task${dlq > 1 ? "s" : ""} failed`,
      body:  "Dead-letter queue — requires review",
      ts:    null,
    });
  }

  // ── Queue overload ────────────────────────────────────────────
  const qPending = opsData?.queue?.counts?.pending ?? 0;
  if (qPending > 20) {
    events.push({
      id:    "qoverload",
      type:  "queue_overload",
      title: `Queue overloaded`,
      body:  `${qPending} tasks pending`,
      ts:    null,
    });
  }

  // ── Runtime warnings ──────────────────────────────────────────
  const warnings = opsData?.warnings || [];
  warnings.forEach((w, i) => {
    events.push({
      id:    `warn-${i}`,
      type:  w.level === "critical" ? "runtime_error" : "runtime_warning",
      title: w.code?.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) || "Warning",
      body:  w.detail || "",
      ts:    null,
    });
  });

  // ── Failures ──────────────────────────────────────────────────
  const fails = opsData?.failures || [];
  fails.slice(0, 3).forEach((f, i) => {
    events.push({
      id:    `fail-${i}`,
      type:  "runtime_error",
      title: "Execution failed",
      body:  (f.input || "Task").slice(0, 60) + (f.error ? ` · ${f.error.slice(0, 50)}` : ""),
      ts:    f.ts || f.timestamp || null,
    });
  });

  // ── System recovery (low errors after prior warnings) ─────────
  const errRate = opsData?.errors?.errors_per_hour ?? 0;
  const status  = opsData?.status;
  if (status === "ok" && errRate === 0 && events.some(e => e.type.includes("error") || e.type.includes("warning"))) {
    events.push({
      id:    "recovery",
      type:  "runtime_recovery",
      title: "System recovered",
      body:  "All errors resolved, runtime healthy",
      ts:    null,
    });
  }

  // Sort: ts entries newest-first, null-ts entries at start
  return events
    .sort((a, b) => {
      if (!a.ts && !b.ts) return 0;
      if (!a.ts) return -1;
      if (!b.ts) return 1;
      return new Date(b.ts) - new Date(a.ts);
    })
    .slice(0, 12);
}

// ── Event row ─────────────────────────────────────────────────────

function EventRow({ event, isNew }) {
  const def   = EVENT_TYPES[event.type] || EVENT_TYPES.workflow_executed;
  const color = `var(${def.colorVar})`;

  return (
    <div className={`as-row${isNew ? " as-row--new" : ""}`}>
      <div className="as-spine">
        <span className="as-icon" style={{ color }}>{def.icon}</span>
        <div className="as-line" />
      </div>
      <div className="as-body">
        <div className="as-row-top">
          <span className="as-title">{event.title}</span>
          {event.ts && <span className="as-ts">{_timeAgo(event.ts)}</span>}
        </div>
        {event.body && <span className="as-body-text">{event.body}</span>}
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────

export default function ActivityStream({ opsData, stats, onNavigate }) {
  const events = useMemo(() => _buildEvents(opsData, stats), [opsData, stats]);

  if (events.length === 0) {
    return (
      <div className="as-root">
        <div className="as-empty">
          <div className="as-empty-icon">◎</div>
          <p className="as-empty-title">Waiting for your first action</p>
          <p className="as-empty-sub">
            Every message sent, payment collected, and task executed appears here in real time.
            Add a contact to start the loop.
          </p>
          <button className="as-empty-btn" onClick={() => onNavigate?.("clients")}>
            Add first contact →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="as-root">
      <div className="as-feed" role="log" aria-live="polite" aria-label="Activity stream">
        {events.map((e, i) => (
          <EventRow key={e.id} event={e} isNew={i === 0} />
        ))}
      </div>
    </div>
  );
}
