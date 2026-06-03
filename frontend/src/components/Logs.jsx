import React from "react";
import "./Logs.css";

function _timeAgo(isoStr) {
  if (!isoStr) return "never";
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const mins   = Math.floor(diffMs / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const TIER_META = {
  "10min":      { label: "First message",     icon: "✉️", desc: "Sent within 10 min of adding lead" },
  "6hr":        { label: "Same-day follow-up",  icon: "🔁", desc: "Follows up the same day" },
  "24hr":       { label: "Next-day check-in",  icon: "📅", desc: "Checks in the following day" },
  "3day":       { label: "3-day close",        icon: "📣", desc: "Final push after 3 days" },
  "onboarding": { label: "Welcome message",    icon: "🎉", desc: "Sent when client converts" },
  "upsell":     { label: "Upsell nudge",       icon: "💎", desc: "Sent to high-interest leads" },
};

function AutoCard({ tierKey, data }) {
  const meta = TIER_META[tierKey] || { label: tierKey, icon: "•", desc: "" };
  const { sent = 0, attempts = 0, failed = 0, lastRun } = data;
  const rate = attempts > 0 ? Math.round((sent / attempts) * 100) : null;

  return (
    <div className="act-card">
      <div className="act-card-top">
        <span className="act-icon">{meta.icon}</span>
        <div className="act-card-info">
          <span className="act-label">{meta.label}</span>
          <span className="act-desc">{meta.desc}</span>
        </div>
        <span className="act-ago">{_timeAgo(lastRun)}</span>
      </div>
      <div className="act-card-stats">
        <div className="act-stat">
          <span className="act-stat-val" style={{ color: "var(--success)" }}>{sent}</span>
          <span className="act-stat-lbl">Sent</span>
        </div>
        {failed > 0 && (
          <div className="act-stat">
            <span className="act-stat-val" style={{ color: "var(--danger)" }}>{failed}</span>
            <span className="act-stat-lbl">Delayed</span>
          </div>
        )}
        {rate !== null && (
          <div className="act-stat">
            <span className="act-stat-val" style={{ color: rate >= 50 ? "var(--success)" : "var(--text-dim)" }}>
              {rate}%
            </span>
            <span className="act-stat-lbl">Delivered</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PipelineRow({ label, value, color, of: total }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="pipe-row">
      <span className="pipe-label">{label}</span>
      <div className="pipe-track">
        <div className="pipe-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="pipe-val" style={{ color }}>{value}</span>
    </div>
  );
}

function QueueSection({ queueHealth }) {
  if (!queueHealth) return null;
  const { counts = {}, total = 0, oldestPendingMins = 0, failedLast24h = 0, healthy } = queueHealth;
  const statusColor = healthy ? "var(--success)" : "var(--warning)";

  return (
    <div className="log-section-wrap">
      <h3 className="log-section-title">Message Queue</h3>
      <div className="log-section-inner">
        <div className="act-summary" style={{ marginBottom: "0.75rem" }}>
          <div className="act-sum-item">
            <span className="act-sum-val" style={{ color: "var(--accent)" }}>{counts.pending ?? 0}</span>
            <span className="act-sum-lbl">Awaiting</span>
          </div>
          <div className="act-sum-sep" />
          <div className="act-sum-item">
            <span className="act-sum-val" style={{ color: "var(--warning)" }}>{counts.running ?? 0}</span>
            <span className="act-sum-lbl">Processing</span>
          </div>
          <div className="act-sum-sep" />
          <div className="act-sum-item">
            <span className="act-sum-val" style={{ color: "var(--success)" }}>{counts.completed ?? 0}</span>
            <span className="act-sum-lbl">Completed</span>
          </div>
          <div className="act-sum-sep" />
          <div className="act-sum-item">
            <span className="act-sum-val" style={{ color: failedLast24h > 0 ? "var(--danger)" : "var(--text-dim)" }}>{failedLast24h}</span>
            <span className="act-sum-lbl">Delayed 24h</span>
          </div>
        </div>
        <div style={{ fontSize: "0.75rem", color: statusColor }}>
          {healthy ? "Queue healthy" : `Oldest pending: ${oldestPendingMins}m`} · {total} total sent
        </div>
      </div>
    </div>
  );
}

export default function Activity({ opsData, stats }) {
  const autoStats   = opsData?.automation || null;
  const queueHealth = opsData?.queue      || null;
  const hasAuto     = autoStats && Object.keys(autoStats).length > 0;
  const crm         = stats || opsData?.crm || null;

  // Totals for automation
  const totalSent    = hasAuto ? Object.values(autoStats).reduce((s, d) => s + (d.sent    || 0), 0) : 0;
  const totalFailed  = hasAuto ? Object.values(autoStats).reduce((s, d) => s + (d.failed  || 0), 0) : 0;

  return (
    <div className="logs">

      {/* ── Summary strip ──────────────────────────────────────────── */}
      {hasAuto && (
        <div className="act-summary">
          <div className="act-sum-item">
            <span className="act-sum-val" style={{ color: "var(--accent2)" }}>{totalSent}</span>
            <span className="act-sum-lbl">Messages sent</span>
          </div>
          <div className="act-sum-sep" />
          <div className="act-sum-item">
            <span className="act-sum-val" style={{ color: "var(--success)" }}>{crm?.paid ?? 0}</span>
            <span className="act-sum-lbl">Clients paid</span>
          </div>
          <div className="act-sum-sep" />
          <div className="act-sum-item">
            <span className="act-sum-val" style={{ color: totalFailed > 0 ? "var(--danger)" : "var(--text-dim)" }}>
              {totalFailed}
            </span>
            <span className="act-sum-lbl">Failed sends</span>
          </div>
        </div>
      )}

      {/* ── Task queue ──────────────────────────────────────────────── */}
      <QueueSection queueHealth={queueHealth} />

      {/* ── Automation sequences ────────────────────────────────────── */}
      <div className="log-section-wrap">
        <h3 className="log-section-title">Follow-up Sequences</h3>

        {!hasAuto ? (
          <div className="act-empty">
            <p className="act-empty-title">No outreach activity yet</p>
            <p className="act-empty-sub">
              Add contacts in the Clients tab and connect WhatsApp. Sequences will register here.
            </p>
          </div>
        ) : (
          <div className="act-cards">
            {Object.entries(autoStats).map(([key, data]) => (
              <AutoCard key={key} tierKey={key} data={data} />
            ))}
          </div>
        )}
      </div>

      {/* ── Lead pipeline ───────────────────────────────────────────── */}
      {crm && crm.total > 0 && (
        <div className="log-section-wrap">
          <h3 className="log-section-title">Lead Pipeline</h3>
          <div className="log-section-inner">
            <PipelineRow label="New"       value={crm.new      ?? 0} color="var(--accent)"  of={crm.total} />
            <PipelineRow label="Hot"       value={crm.hot      ?? 0} color="var(--warning)" of={crm.total} />
            <PipelineRow label="Paid"      value={crm.paid     ?? 0} color="var(--success)" of={crm.total} />
            <PipelineRow label="Onboarded" value={crm.onboarded ?? 0} color="var(--accent2)" of={crm.total} />
            {crm.revenue != null && (
              <div className="pipe-revenue">
                Total revenue: <strong style={{ color: "var(--success)" }}>
                  ₹{crm.revenue.toLocaleString("en-IN")}
                </strong>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
