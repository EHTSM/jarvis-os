import React, { useState, useEffect, useCallback } from "react";
import { getBillingStatus, cancelSubscription, PLANS } from "../billingApi";
import { track } from "../analytics";
import "./BillingDashboard.css";

// ── Helpers ────────────────────────────────────────────────────────────
function _fmtDate(isoStr) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function _planLabel(plan) {
  switch (plan) {
    case "trial":     return "Free Trial";
    case "starter":   return "Starter";
    case "growth":    return "Growth";
    case "scale":     return "Scale";
    case "cancelled": return "Cancelled";
    default:          return plan || "—";
  }
}

function _statusLabel(status) {
  switch (status) {
    case "trialing":  return { text: "Trial Active",  cls: "bd-status--trial"    };
    case "active":    return { text: "Active",         cls: "bd-status--active"   };
    case "expired":   return { text: "Expired",        cls: "bd-status--expired"  };
    case "cancelled": return { text: "Cancelled",      cls: "bd-status--expired"  };
    default:          return { text: status || "Unknown", cls: "bd-status--dim" };
  }
}

// ── Trial countdown ring ────────────────────────────────────────────────
function TrialRing({ daysLeft, totalDays = 7 }) {
  const pct    = Math.max(0, Math.min(1, daysLeft / totalDays));
  const r      = 28;
  const circ   = 2 * Math.PI * r;
  const dash   = pct * circ;
  const color  = daysLeft <= 1 ? "var(--danger)"
               : daysLeft <= 3 ? "var(--warning)"
               : "var(--accent2)";

  return (
    <div className="bd-ring" title={`${daysLeft} of ${totalDays} days remaining`}>
      <svg width="68" height="68" viewBox="0 0 68 68">
        {/* Track */}
        <circle cx="34" cy="34" r={r} fill="none"
          stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
        {/* Fill */}
        <circle cx="34" cy="34" r={r} fill="none"
          stroke={color} strokeWidth="5"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 34 34)"
          style={{ transition: "stroke-dasharray 600ms var(--ease-out)" }}
        />
      </svg>
      <div className="bd-ring-inner">
        <span className="bd-ring-num" style={{ color }}>{daysLeft}</span>
        <span className="bd-ring-sub">days</span>
      </div>
    </div>
  );
}

// ── Plan feature list ──────────────────────────────────────────────────
function PlanFeatures({ plan }) {
  const def = PLANS.find(p => p.id === plan) || PLANS[0];
  if (!def) return null;
  return (
    <ul className="bd-features">
      {def.features.map((f, i) => (
        <li key={i} className="bd-feature">
          <span className="bd-feature-check">✓</span>
          {f}
        </li>
      ))}
    </ul>
  );
}

// ── Root dashboard ─────────────────────────────────────────────────────
export default function BillingDashboard({ onUpgrade }) {
  const [billing,   setBilling]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled,  setCancelled]  = useState(false);
  const [showCancel, setShowCancel] = useState(false);

  const fetchBilling = useCallback(async () => {
    setLoading(true);
    const b = await getBillingStatus();
    setBilling(b);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchBilling();
    track.event("billing_dashboard_viewed");
  }, [fetchBilling]);

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    const res = await cancelSubscription();
    setCancelling(false);
    if (res?.success) {
      setCancelled(true);
      setShowCancel(false);
      track.event("subscription_cancelled");
      fetchBilling();
    }
  }, [fetchBilling]);

  if (loading) {
    return (
      <div className="billing-dashboard">
        <div className="bd-skeleton-group">
          <div className="skeleton skeleton--title" style={{ width: 180 }} />
          <div className="skeleton skeleton--card" style={{ height: 120 }} />
          <div className="skeleton skeleton--card" style={{ height: 80 }} />
        </div>
      </div>
    );
  }

  if (!billing) {
    return (
      <div className="billing-dashboard">
        <div className="bd-error">
          <p className="bd-error-title">Could not load billing information</p>
          <p className="bd-error-sub">Check your connection and try again.</p>
          <button className="bd-retry" onClick={fetchBilling}>Retry</button>
        </div>
      </div>
    );
  }

  const { plan, status, daysLeft, trialEnd, activatedAt, graceActive } = billing;
  const statusInfo = _statusLabel(status);
  const isTrial    = status === "trialing" || status === "expired";
  const isActive   = status === "active";
  const planDef    = PLANS.find(p => p.id === plan);

  return (
    <div className="billing-dashboard">

      {/* ── Subscription status card ──────────────────────────────── */}
      <div className="bd-card">
        <div className="bd-card-header">
          <h2 className="bd-card-title">Current Plan</h2>
          <span className={`bd-status ${statusInfo.cls}`}>{statusInfo.text}</span>
        </div>

        <div className="bd-plan-row">
          {isTrial ? (
            <>
              <TrialRing daysLeft={daysLeft || 0} />
              <div className="bd-plan-info">
                <span className="bd-plan-name">Free Trial</span>
                <span className="bd-plan-detail">
                  {graceActive
                    ? "Grace period — upgrade within 24h to avoid interruption."
                    : daysLeft > 0
                    ? `Expires ${_fmtDate(trialEnd)} — ${daysLeft} day${daysLeft !== 1 ? "s" : ""} left.`
                    : "Trial has expired. Upgrade to restore access."}
                </span>
                <span className="bd-plan-limits">Free · No credit card required</span>
              </div>
            </>
          ) : (
            <div className="bd-plan-info bd-plan-info--active">
              <span className="bd-plan-name">{_planLabel(plan)}</span>
              {planDef && <span className="bd-plan-detail">{planDef.tagline}</span>}
              {planDef && <span className="bd-plan-limits">{planDef.limits}</span>}
              {isActive && activatedAt && (
                <span className="bd-plan-since">Active since {_fmtDate(activatedAt)}</span>
              )}
            </div>
          )}

          <div className="bd-plan-actions">
            {!isActive && (
              <button
                className="bd-upgrade-btn"
                onClick={() => { track.event("upgrade_clicked", { source: "billing_dashboard" }); onUpgrade?.(); }}
              >
                {status === "expired" ? "Reactivate" : "Upgrade"}
              </button>
            )}
            {isActive && plan !== "scale" && (
              <button className="bd-change-btn" onClick={onUpgrade}>
                Change plan
              </button>
            )}
          </div>
        </div>

        {/* Features for active plans */}
        {isActive && <PlanFeatures plan={plan} />}
      </div>

      {/* ── Trial timeline ────────────────────────────────────────── */}
      {isTrial && (
        <div className="bd-card">
          <h2 className="bd-card-title">Trial Timeline</h2>
          <div className="bd-timeline">
            <div className="bd-tl-row">
              <span className="bd-tl-label">Trial started</span>
              <span className="bd-tl-val">{_fmtDate(billing.trialStart)}</span>
            </div>
            <div className="bd-tl-row">
              <span className="bd-tl-label">Trial ends</span>
              <span className="bd-tl-val bd-tl-val--warn">{_fmtDate(trialEnd)}</span>
            </div>
            {graceActive && (
              <div className="bd-tl-row">
                <span className="bd-tl-label">Grace period ends</span>
                <span className="bd-tl-val bd-tl-val--danger">
                  {_fmtDate(new Date(new Date(trialEnd).getTime() + 24 * 3600_000).toISOString())}
                </span>
              </div>
            )}
          </div>

          {/* Trial progress bar */}
          <div className="bd-trial-bar-wrap">
            <div className="bd-trial-bar-track">
              <div
                className="bd-trial-bar-fill"
                style={{
                  width: `${Math.max(0, Math.min(100, ((daysLeft || 0) / 7) * 100))}%`,
                  background: (daysLeft || 0) <= 1 ? "var(--danger)"
                             : (daysLeft || 0) <= 3 ? "var(--warning)"
                             : "var(--accent2)",
                }}
              />
            </div>
            <span className="bd-trial-bar-label">
              {daysLeft || 0} / 7 days remaining
            </span>
          </div>

          <button
            className="bd-upgrade-inline"
            onClick={() => { track.event("upgrade_clicked", { source: "billing_dashboard_trial" }); onUpgrade?.(); }}
          >
            Upgrade now — keep automations running →
          </button>
        </div>
      )}

      {/* ── Billing summary ───────────────────────────────────────── */}
      <div className="bd-card">
        <h2 className="bd-card-title">Billing Summary</h2>
        <div className="bd-summary-grid">
          <div className="bd-summary-item">
            <span className="bd-summary-label">Plan</span>
            <span className="bd-summary-val">{_planLabel(plan)}</span>
          </div>
          <div className="bd-summary-item">
            <span className="bd-summary-label">Status</span>
            <span className="bd-summary-val">{statusInfo.text}</span>
          </div>
          <div className="bd-summary-item">
            <span className="bd-summary-label">Price</span>
            <span className="bd-summary-val">
              {isActive ? (planDef?.price ?? "—") + (planDef?.period ?? "") : "₹0 (trial)"}
            </span>
          </div>
          <div className="bd-summary-item">
            <span className="bd-summary-label">Next renewal</span>
            <span className="bd-summary-val">
              {isActive ? "Monthly (auto-renew)" : "—"}
            </span>
          </div>
          <div className="bd-summary-item">
            <span className="bd-summary-label">Payment method</span>
            <span className="bd-summary-val">
              {billing.razorpaySubId ? "Razorpay" : "—"}
            </span>
          </div>
          <div className="bd-summary-item">
            <span className="bd-summary-label">Razorpay ID</span>
            <span className="bd-summary-val bd-summary-val--mono">
              {billing.razorpaySubId || "—"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Cancellation ─────────────────────────────────────────── */}
      {isActive && !cancelled && (
        <div className="bd-danger-zone">
          {!showCancel ? (
            <button className="bd-cancel-link" onClick={() => setShowCancel(true)}>
              Cancel subscription
            </button>
          ) : (
            <div className="bd-cancel-confirm">
              <p className="bd-cancel-msg">
                Cancel now? Your access continues until the end of the billing period.
                Data is retained for 30 days after cancellation.
              </p>
              <div className="bd-cancel-actions">
                <button
                  className="bd-cancel-yes"
                  onClick={handleCancel}
                  disabled={cancelling}
                >
                  {cancelling ? "Cancelling…" : "Yes, cancel subscription"}
                </button>
                <button className="bd-cancel-no" onClick={() => setShowCancel(false)}>
                  Keep subscription
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {cancelled && (
        <div className="bd-cancelled-notice">
          Subscription cancelled. Access continues until your next renewal date.
        </div>
      )}

    </div>
  );
}
