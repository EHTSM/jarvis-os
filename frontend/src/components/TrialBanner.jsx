import React, { useEffect, useState, useCallback } from "react";
import { getBillingStatus } from "../billingApi";
import { track } from "../analytics";
import "./TrialBanner.css";

/**
 * TrialBanner — persistent urgency bar shown to trialing users.
 *
 * Urgency tiers:
 *   daysLeft >= 4   → neutral info  (shows days remaining, low friction)
 *   daysLeft 2–3    → warning       (orange, "running low")
 *   daysLeft 0–1    → critical      (red pulse, "expiring today/tomorrow")
 *   graceActive     → grace period  (last chance before hard block)
 *   expired         → blocked       (upgrade required, non-dismissible)
 *
 * Active plan → banner is hidden entirely.
 */

function _urgencyTier(billing) {
  if (!billing) return null;
  if (billing.status === "active") return null;
  if (billing.graceActive) return "grace";
  if (billing.status === "expired" && !billing.graceActive) return "blocked";
  const d = billing.daysLeft ?? 7;
  if (d <= 1) return "critical";
  if (d <= 3) return "warning";
  return "info";
}

function _label(billing) {
  const tier = _urgencyTier(billing);
  const d    = billing?.daysLeft ?? 0;
  switch (tier) {
    case "info":     return `Trial — ${d} day${d !== 1 ? "s" : ""} left`;
    case "warning":  return `Trial expiring in ${d} day${d !== 1 ? "s" : ""}`;
    case "critical": return d === 0 ? "Trial expires today" : "Trial expires tomorrow";
    case "grace":    return "Trial expired — 24-hour grace period active";
    case "blocked":  return "Trial ended — upgrade to continue";
    default:         return null;
  }
}

function _sub(billing) {
  const tier = _urgencyTier(billing);
  switch (tier) {
    case "info":     return "Upgrade before your trial ends to keep all automations running.";
    case "warning":  return "Follow-ups and automations stop when the trial ends. Upgrade now to keep them running.";
    case "critical": return "Automations will pause at midnight. Upgrade now — takes 30 seconds.";
    case "grace":    return "All features still work for the next 24 hours. Upgrade now to avoid interruption.";
    case "blocked":  return "Your automations and follow-ups are paused. Choose a plan to restart them.";
    default:         return "";
  }
}

// ── Progress bar for trial days remaining ────────────────────────────
function TrialProgressBar({ daysLeft, totalDays = 7 }) {
  const pct = Math.max(0, Math.min(100, (daysLeft / totalDays) * 100));
  const color = daysLeft <= 1 ? "var(--danger)"
              : daysLeft <= 3 ? "var(--warning)"
              : "var(--accent2)";
  return (
    <div className="tb-progress-track" title={`${daysLeft} of ${totalDays} days remaining`}>
      <div
        className="tb-progress-fill"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

export default function TrialBanner({ onUpgrade, billing: billingProp }) {
  const [billing,   setBilling]   = useState(billingProp || null);
  const [dismissed, setDismissed] = useState(false);

  // Fetch billing status on mount if not passed as prop
  useEffect(() => {
    if (billingProp) { setBilling(billingProp); return; }
    getBillingStatus().then(b => { if (b) setBilling(b); });
  }, [billingProp]);

  const tier = _urgencyTier(billing);

  // Critical / grace / blocked: never dismissible
  const canDismiss = tier === "info" || tier === "warning";

  const handleUpgrade = useCallback(() => {
    track.event("upgrade_prompt_clicked", { source: "trial_banner", tier });
    onUpgrade?.();
  }, [tier, onUpgrade]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    track.event("trial_banner_dismissed", { tier, daysLeft: billing?.daysLeft });
  }, [tier, billing]);

  if (!tier || dismissed) return null;

  const label = _label(billing);
  const sub   = _sub(billing);
  const daysLeft = billing?.daysLeft ?? 0;

  return (
    <div
      className={`trial-banner trial-banner--${tier}`}
      role="alert"
      aria-live="polite"
    >
      <div className="tb-content">
        <div className="tb-left">
          <span className="tb-dot" aria-hidden="true" />
          <div className="tb-text">
            <span className="tb-label">{label}</span>
            <span className="tb-sub">{sub}</span>
          </div>
        </div>

        <div className="tb-right">
          {/* Progress bar — only during active trial */}
          {(tier === "info" || tier === "warning" || tier === "critical") && (
            <TrialProgressBar daysLeft={daysLeft} />
          )}

          <button
            className={`tb-cta tb-cta--${tier === "blocked" || tier === "grace" ? "urgent" : "default"}`}
            onClick={handleUpgrade}
          >
            {tier === "blocked" ? "Choose a plan →" : "Upgrade now →"}
          </button>

          {canDismiss && (
            <button
              className="tb-dismiss"
              onClick={handleDismiss}
              aria-label="Dismiss trial banner"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
