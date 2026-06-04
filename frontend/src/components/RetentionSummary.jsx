/**
 * RetentionSummary — Weekly activity summary + usage highlights + wins + next actions.
 *
 * Shown at the top of Control Center when:
 *  - User has been active for >1 visit (returning user)
 *  - Has at least one data point (leads, messages, revenue, or runtime events)
 *
 * Uses only existing stats + opsData — no new API calls.
 */

import React, { useMemo, useState } from "react";
import { track } from "../analytics";
import "./RetentionSummary.css";

// ── Helpers ─────────────────────────────────────────────────────────────
function _sinceLastVisit() {
  const ts = parseInt(localStorage.getItem("jarvis_last_visit_ts") || "0", 10);
  if (!ts) return null;
  const ms  = Date.now() - ts;
  const hrs = ms / 3_600_000;
  if (hrs < 1) return "less than an hour ago";
  if (hrs < 24) return `${Math.floor(hrs)} hour${Math.floor(hrs) !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return "over a week ago";
}

function _timeLabel() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

// ── Suggested next actions ────────────────────────────────────────────
function _buildNextActions(stats, opsData) {
  const actions = [];
  const services = opsData?.services || {};
  const auto     = opsData?.automation || {};
  const totalSent = Object.values(auto).reduce((s, d) => s + (d.sent || 0), 0);
  const total    = stats?.total ?? 0;
  const paid     = stats?.paid ?? 0;
  const hot      = stats?.hot ?? 0;

  if (!services.whatsapp) {
    actions.push({
      id:    "connect-wa",
      icon:  "◉",
      title: "Connect WhatsApp",
      desc:  "Automations are queued but can't send until WhatsApp is linked.",
      tab:   "clients",
      urgency: "high",
    });
  }
  if (total === 0) {
    actions.push({
      id:    "add-contact",
      icon:  "◈",
      title: "Add your first contact",
      desc:  "The entire follow-up engine starts with one name and number.",
      tab:   "clients",
      urgency: "high",
    });
  }
  if (hot > 0 && paid === 0) {
    actions.push({
      id:    "close-hot",
      icon:  "✦",
      title: `Close ${hot} hot lead${hot > 1 ? "s" : ""}`,
      desc:  "These contacts have high engagement — send a payment link now.",
      tab:   "clients",
      urgency: "medium",
    });
  }
  if (total > 0 && totalSent === 0 && services.whatsapp) {
    actions.push({
      id:    "first-auto",
      icon:  "⚡",
      title: "Trigger your first automation",
      desc:  "You have contacts but no follow-ups have run yet. Check the queue.",
      tab:   "runtime",
      urgency: "medium",
    });
  }
  if (total > 5 && paid === 0) {
    actions.push({
      id:    "send-payment",
      icon:  "✦",
      title: "Generate a payment link",
      desc:  `${total} contacts in your pipeline — time to close one.`,
      tab:   "clients",
      urgency: "medium",
    });
  }
  // Default: review activity
  if (actions.length === 0) {
    actions.push({
      id:    "review-activity",
      icon:  "⚡",
      title: "Review live activity",
      desc:  "Check what Ooplix has done since your last visit.",
      tab:   "activity",
      urgency: "low",
    });
  }

  return actions.slice(0, 3);
}

// ── Win card ──────────────────────────────────────────────────────────
function WinCard({ icon, title, value, color }) {
  return (
    <div className="rs-win-card">
      <span className="rs-win-icon" style={{ color }}>{icon}</span>
      <div className="rs-win-body">
        <span className="rs-win-value" style={{ color }}>{value}</span>
        <span className="rs-win-title">{title}</span>
      </div>
    </div>
  );
}

// ── Action row ────────────────────────────────────────────────────────
function ActionRow({ action, onNavigate }) {
  return (
    <button
      className={`rs-action rs-action--${action.urgency}`}
      onClick={() => {
        track.event("retention_action_clicked", { action: action.id });
        onNavigate?.(action.tab);
      }}
    >
      <span className="rs-action-icon">{action.icon}</span>
      <div className="rs-action-body">
        <span className="rs-action-title">{action.title}</span>
        <span className="rs-action-desc">{action.desc}</span>
      </div>
      <span className="rs-action-arrow">→</span>
    </button>
  );
}

// ── Root ──────────────────────────────────────────────────────────────
export default function RetentionSummary({ stats, opsData, onNavigate }) {
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem("ooplix_retention_dismissed") === "1"
  );

  const sinceVisit = useMemo(_sinceLastVisit, []);
  const nextActions = useMemo(() => _buildNextActions(stats, opsData), [stats, opsData]);

  // Build wins from live data
  const auto      = opsData?.automation || {};
  const totalSent = Object.values(auto).reduce((s, d) => s + (d.sent || 0), 0);
  const total     = stats?.total ?? 0;
  const paid      = stats?.paid  ?? 0;
  const revenue   = stats?.revenue ?? 0;
  const uptime    = opsData?.uptime?.human;

  const wins = [];
  if (totalSent > 0)  wins.push({ icon: "◎", title: "Follow-ups sent",  value: totalSent.toLocaleString(),                color: "var(--accent2)" });
  if (total > 0)      wins.push({ icon: "◈", title: "Leads in pipeline", value: total.toLocaleString(),                    color: "var(--accent)"  });
  if (paid > 0)       wins.push({ icon: "✦", title: "Clients paid",       value: `${paid}`,                                 color: "var(--success)" });
  if (revenue > 0)    wins.push({ icon: "₹", title: "Revenue collected",  value: `₹${revenue.toLocaleString("en-IN")}`,    color: "var(--success)" });
  if (uptime)         wins.push({ icon: "◇", title: "Runtime uptime",     value: uptime,                                    color: "var(--info)"    });

  // Don't show if truly nothing to show
  const hasData = wins.length > 0 || total > 0;
  if (!hasData || dismissed) return null;

  const handleDismiss = () => {
    sessionStorage.setItem("ooplix_retention_dismissed", "1");
    setDismissed(true);
    track.event("retention_summary_dismissed");
  };

  return (
    <div className="retention-summary animate-fade-up">
      <div className="rs-header">
        <div className="rs-header-left">
          <p className="rs-greeting">
            Good {_timeLabel()}{sinceVisit ? ` — last visit ${sinceVisit}` : ""}.
          </p>
          <p className="rs-headline">Here's where things stand.</p>
        </div>
        <button className="rs-dismiss" onClick={handleDismiss} aria-label="Dismiss">✕</button>
      </div>

      {/* ── Wins strip ─────────────────────────────────────────── */}
      {wins.length > 0 && (
        <div className="rs-wins">
          {wins.slice(0, 4).map(w => (
            <WinCard key={w.title} {...w} />
          ))}
        </div>
      )}

      {/* ── Next actions ─────────────────────────────────────── */}
      {nextActions.length > 0 && (
        <div className="rs-actions-section">
          <p className="rs-section-label">Suggested next</p>
          <div className="rs-actions-list">
            {nextActions.map(a => (
              <ActionRow key={a.id} action={a} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
