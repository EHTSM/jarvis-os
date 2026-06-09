import React, { useState, useCallback, useEffect } from "react";
import { upgradePlan, PLANS } from "../billingApi";
import { track } from "../analytics";
import "./UpgradeModal.css";

// ── Feature comparison table data ────────────────────────────────────
const COMPARE_ROWS = [
  { label: "Leads",                  trial: "25",        starter: "100",    growth: "1,000",   scale: "Unlimited" },
  { label: "WhatsApp follow-up tiers", trial: "2 tiers", starter: "4 tiers", growth: "6 tiers", scale: "Custom" },
  { label: "Messages/month",          trial: "100",       starter: "500",    growth: "5,000",   scale: "Unlimited" },
  { label: "Payment links",           trial: "✓",         starter: "✓",      growth: "✓",       scale: "✓" },
  { label: "Pipeline dashboard",      trial: "Basic",     starter: "Full",   growth: "Full",    scale: "Full" },
  { label: "Activity timeline",       trial: "24h",       starter: "7 days", growth: "90 days", scale: "1 year" },
  { label: "Control Room execution",  trial: "—",         starter: "—",      growth: "✓",       scale: "✓" },
  { label: "Developer & Business OS", trial: "—",         starter: "—",      growth: "✓",       scale: "✓" },
  { label: "Support",                 trial: "—",         starter: "Email",  growth: "Priority", scale: "Dedicated" },
  { label: "SLA uptime",             trial: "—",         starter: "—",      growth: "—",       scale: "✓" },
];

// ── Plan card ─────────────────────────────────────────────────────────
function PlanCard({ plan, selected, onSelect, loading }) {
  const isScale = plan.id === "scale";

  return (
    <div
      className={`um-plan${plan.featured ? " um-plan--featured" : ""}${selected === plan.id ? " um-plan--selected" : ""}`}
      onClick={() => !isScale && onSelect(plan.id)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === "Enter" && !isScale && onSelect(plan.id)}
      aria-pressed={selected === plan.id}
    >
      {plan.badge && <div className="um-plan-badge">{plan.badge}</div>}
      <h3 className="um-plan-name">{plan.name}</h3>
      <p className="um-plan-tagline">{plan.tagline}</p>
      <div className="um-plan-price-row">
        <span className="um-plan-price">{plan.price}</span>
        {plan.period && <span className="um-plan-period">{plan.period}</span>}
      </div>
      <ul className="um-plan-features">
        {plan.features.slice(0, 5).map((f, i) => (
          <li key={i} className="um-plan-feature">
            <span className="um-plan-check" aria-hidden="true">✓</span>
            {f}
          </li>
        ))}
        {plan.features.length > 5 && (
          <li className="um-plan-feature um-plan-feature--more">
            +{plan.features.length - 5} more
          </li>
        )}
      </ul>
      {isScale ? (
        <a
          className="um-plan-cta um-plan-cta--contact"
          href="mailto:sales@ooplix.com"
          onClick={e => e.stopPropagation()}
        >
          Contact Sales
        </a>
      ) : (
        <button
          className={`um-plan-cta${plan.featured ? " um-plan-cta--featured" : ""}`}
          onClick={e => { e.stopPropagation(); onSelect(plan.id); }}
          disabled={loading}
        >
          {selected === plan.id && loading ? "Processing…" : `Choose ${plan.name}`}
        </button>
      )}
    </div>
  );
}

// ── Comparison table ─────────────────────────────────────────────────
function CompareTable() {
  return (
    <div className="um-compare">
      <div className="um-compare-scroll">
        <table className="um-compare-table">
          <thead>
            <tr>
              <th className="um-th um-th--feature">Feature</th>
              <th className="um-th">Trial</th>
              <th className="um-th">Starter</th>
              <th className="um-th um-th--highlight">Growth</th>
              <th className="um-th">Scale</th>
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map(row => (
              <tr key={row.label} className="um-tr">
                <td className="um-td um-td--feature">{row.label}</td>
                <td className="um-td um-td--dim">{row.trial}</td>
                <td className="um-td">{row.starter}</td>
                <td className="um-td um-td--highlight">{row.growth}</td>
                <td className="um-td">{row.scale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Root modal ────────────────────────────────────────────────────────
export default function UpgradeModal({ open, onClose, onSuccess, billing }) {
  const [selected,  setSelected]  = useState("growth"); // pre-select recommended
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [showTable, setShowTable] = useState(false);

  // Track open
  useEffect(() => {
    if (open) {
      track.event("upgrade_modal_opened", {
        trigger: "manual",
        current_plan: billing?.plan || "trial",
        days_left: billing?.daysLeft,
      });
    }
  }, [open, billing]);

  const handleUpgrade = useCallback(async (planId) => {
    if (planId === "scale") return; // handled by mailto link in card
    setLoading(true);
    setError(null);
    setSelected(planId);

    track.event("upgrade_plan_selected", { plan: planId });

    const res = await upgradePlan(planId);
    setLoading(false);

    if (res?.success && res?.paymentUrl) {
      track.paymentStarted(res.amount || 0);
      window.open(res.paymentUrl, "_blank", "noopener,noreferrer");
      onSuccess?.();
      onClose?.();
    } else {
      // Surface actionable error — Razorpay keys may need regeneration
      const isAuthErr = (res?.error || "").toLowerCase().includes("authentication") ||
                        (res?.error || "").toLowerCase().includes("401") ||
                        (res?.error || "").toLowerCase().includes("not configured");
      setError(
        isAuthErr
          ? "payment_auth_failed"   // sentinel — rendered as rich block below
          : (res?.error || "Could not initiate payment. Please try again or contact support.")
      );
    }
  }, [onClose, onSuccess]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="um-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Upgrade plan"
      onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="um-panel animate-scale-in">

        {/* Header */}
        <div className="um-header">
          <div className="um-header-copy">
            <h2 className="um-title">Upgrade Ooplix</h2>
            <p className="um-subtitle">
              Keep your automations running. Choose a plan to continue after your trial.
            </p>
          </div>
          <button className="um-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Trial status context */}
        {billing && (billing.status === "trialing" || billing.graceActive || billing.status === "expired") && (
          <div className={`um-trial-context um-trial-context--${billing.graceActive ? "grace" : billing.daysLeft <= 1 ? "critical" : "info"}`}>
            {billing.graceActive
              ? "⚠ You're in the 24-hour grace period. Upgrade now to avoid losing access."
              : billing.daysLeft === 0
              ? "⚠ Trial expires today."
              : billing.daysLeft === 1
              ? `⚠ 1 day left on your trial.`
              : `${billing.daysLeft} days left on your trial.`}
          </div>
        )}

        {/* Plan cards */}
        <div className="um-plans">
          {PLANS.map(plan => (
            <PlanCard
              key={plan.id}
              plan={plan}
              selected={selected}
              onSelect={handleUpgrade}
              loading={loading}
            />
          ))}
        </div>

        {/* Error — rich block for payment auth failure, plain text for others */}
        {error && error === "payment_auth_failed" && (
          <div className="um-error um-error--rich" role="alert">
            <span className="um-error-icon">⚠</span>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Payment processing is temporarily unavailable.</div>
              <div style={{ fontSize: "0.82rem", lineHeight: 1.55 }}>
                To upgrade now, email us and we'll send you a payment link directly:
                {" "}<a href="mailto:billing@ooplix.com?subject=Upgrade request&body=Plan: " className="um-error-link">billing@ooplix.com</a>
              </div>
            </div>
          </div>
        )}
        {error && error !== "payment_auth_failed" && (
          <div className="um-error" role="alert">
            <span className="um-error-icon">⚠</span>
            {error}
            {" — "}
            <a href="mailto:billing@ooplix.com" className="um-error-link">contact billing ↗</a>
          </div>
        )}

        {/* Feature comparison toggle */}
        <div className="um-compare-toggle">
          <button
            className="um-toggle-btn"
            onClick={() => setShowTable(t => !t)}
            aria-expanded={showTable}
          >
            {showTable ? "Hide" : "See"} full feature comparison {showTable ? "↑" : "↓"}
          </button>
        </div>

        {showTable && <CompareTable />}

        {/* Trust footer */}
        <div className="um-footer">
          <span>🔒 Payments via Razorpay — PCI-DSS Level 1</span>
          <span>·</span>
          <span>Cancel anytime</span>
          <span>·</span>
          <span>Data retained 30 days after cancellation</span>
        </div>

      </div>
    </div>
  );
}
