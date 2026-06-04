/**
 * PremiumGate — feature gating UI system.
 *
 * Usage patterns:
 *
 *   1. Inline gate — wraps content with a locked overlay when not on required plan:
 *      <PremiumGate plan="growth" billing={billing} onUpgrade={fn}>
 *        <SomeFeature />
 *      </PremiumGate>
 *
 *   2. Premium badge — small inline indicator on premium-only items:
 *      <PremiumBadge />
 *
 *   3. Upgrade nudge — inline card prompting upgrade for a specific feature:
 *      <UpgradeNudge feature="Control Room" plan="growth" onUpgrade={fn} />
 *
 *   4. Usage bar — shows consumed / limit to drive upgrade intent:
 *      <UsageBar label="Leads" used={42} limit={100} plan="starter" onUpgrade={fn} />
 */

import React, { useState } from "react";
import { track } from "../analytics";
import "./PremiumGate.css";

// ── Plan hierarchy ────────────────────────────────────────────────────
const PLAN_RANK = { trial: 0, starter: 1, growth: 2, scale: 3 };

function _hasAccess(billing, requiredPlan) {
  if (!billing) return false;
  if (billing.status === "active") {
    return (PLAN_RANK[billing.plan] ?? 0) >= (PLAN_RANK[requiredPlan] ?? 0);
  }
  // Trialing users get access to starter-level features
  if (billing.status === "trialing") {
    return (PLAN_RANK[requiredPlan] ?? 0) <= PLAN_RANK.starter;
  }
  return false;
}

const PLAN_LABEL = {
  starter: "Starter",
  growth:  "Growth",
  scale:   "Scale",
};

// ── Premium badge ─────────────────────────────────────────────────────
export function PremiumBadge({ plan = "growth" }) {
  return (
    <span className="pg-badge" title={`Requires ${PLAN_LABEL[plan] || plan} plan`}>
      ✦ {PLAN_LABEL[plan] || plan}
    </span>
  );
}

// ── Upgrade nudge card ────────────────────────────────────────────────
export function UpgradeNudge({ feature, plan = "growth", onUpgrade, compact = false }) {
  const handleClick = () => {
    track.event("upgrade_nudge_clicked", { feature, plan });
    onUpgrade?.();
  };

  if (compact) {
    return (
      <button className="pg-nudge-compact" onClick={handleClick}>
        <span className="pg-nudge-compact-icon">✦</span>
        <span className="pg-nudge-compact-text">
          {feature} — requires {PLAN_LABEL[plan] || plan}
        </span>
        <span className="pg-nudge-compact-cta">Upgrade →</span>
      </button>
    );
  }

  return (
    <div className="pg-nudge">
      <div className="pg-nudge-icon">✦</div>
      <div className="pg-nudge-body">
        <p className="pg-nudge-title">{feature} is a {PLAN_LABEL[plan] || plan} feature</p>
        <p className="pg-nudge-sub">
          Upgrade to {PLAN_LABEL[plan] || plan} to unlock {feature} and{" "}
          {plan === "growth"
            ? "full execution, analytics, and all OS modules."
            : "unlimited scale across your entire operation."}
        </p>
      </div>
      <button className="pg-nudge-btn" onClick={handleClick}>
        Upgrade to {PLAN_LABEL[plan] || plan} →
      </button>
    </div>
  );
}

// ── Usage visibility bar ──────────────────────────────────────────────
export function UsageBar({ label, used, limit, plan = "starter", onUpgrade }) {
  if (!limit) return null;
  const pct      = Math.min(100, Math.round((used / limit) * 100));
  const nearLimit = pct >= 80;
  const atLimit   = pct >= 100;

  const barColor = atLimit   ? "var(--danger)"
                 : nearLimit ? "var(--warning)"
                 : "var(--accent2)";

  const handleUpgrade = () => {
    track.event("usage_limit_upgrade_clicked", { label, used, limit, plan, pct });
    onUpgrade?.();
  };

  return (
    <div className={`ub-root${nearLimit ? " ub-root--warn" : ""}${atLimit ? " ub-root--limit" : ""}`}>
      <div className="ub-header">
        <span className="ub-label">{label}</span>
        <span className={`ub-count${atLimit ? " ub-count--danger" : nearLimit ? " ub-count--warn" : ""}`}>
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="ub-track">
        <div
          className="ub-fill"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
      {nearLimit && (
        <div className="ub-warn-row">
          <span className="ub-warn-text">
            {atLimit
              ? `${label} limit reached.`
              : `${100 - pct}% of ${label.toLowerCase()} limit remaining.`}
          </span>
          {onUpgrade && (
            <button className="ub-upgrade-link" onClick={handleUpgrade}>
              Increase limit →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Gate overlay ──────────────────────────────────────────────────────
export default function PremiumGate({ children, billing, plan = "growth", feature, onUpgrade }) {
  const [hovered, setHovered] = useState(false);
  const hasAccess = _hasAccess(billing, plan);

  if (hasAccess) return children;

  const handleUpgrade = () => {
    track.event("gate_upgrade_clicked", { feature, plan });
    onUpgrade?.();
  };

  return (
    <div
      className="pg-gate"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="pg-gate-content" aria-hidden="true">
        {children}
      </div>
      <div className={`pg-gate-overlay${hovered ? " pg-gate-overlay--hovered" : ""}`}>
        <div className="pg-gate-inner">
          <div className="pg-gate-lock">✦</div>
          <p className="pg-gate-title">
            {feature ? `${feature} — ` : ""}{PLAN_LABEL[plan] || plan} plan
          </p>
          <p className="pg-gate-sub">
            Upgrade to unlock this feature and all {PLAN_LABEL[plan]} capabilities.
          </p>
          <button className="pg-gate-btn" onClick={handleUpgrade}>
            Upgrade to {PLAN_LABEL[plan]} →
          </button>
        </div>
      </div>
    </div>
  );
}
