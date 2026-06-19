/**
 * LicenseManager — subscription foundation.
 * Plan detection, usage counters, feature gating, AI credit display.
 * Reads /billing/status (existing). No payment gateway.
 */
import React, { useState, useEffect, useCallback } from "react";
import "./LicenseManager.css";

const BASE = process.env.REACT_APP_API_URL || "";
const get  = (path) => fetch(`${BASE}${path}`, { credentials: "include" }).then(r => r.json()).catch(() => null);

const PLANS = {
  trial:   { name: "Trial",   color: "#f0b429", limit: 50,   aiCredits: 100,  features: ["editor", "ai-chat", "missions"] },
  starter: { name: "Starter", color: "#4ecdc4", limit: 500,  aiCredits: 1000, features: ["editor", "ai-chat", "missions", "git", "pipeline"] },
  growth:  { name: "Growth",  color: "#7c6fff", limit: 2000, aiCredits: 5000, features: ["editor", "ai-chat", "missions", "git", "pipeline", "plugins", "team"] },
  scale:   { name: "Scale",   color: "#52d68a", limit: -1,   aiCredits: -1,   features: ["*"] },
};

const ALL_FEATURES = [
  { id: "editor",   label: "AI Code Editor",       icon: "◈" },
  { id: "ai-chat",  label: "Inline AI Chat",        icon: "⬡" },
  { id: "missions", label: "Mission Engine",         icon: "◎" },
  { id: "git",      label: "Visual Git / Blame",    icon: "⎇" },
  { id: "pipeline", label: "Autonomous Pipeline",    icon: "⚙" },
  { id: "plugins",  label: "Plugin Marketplace",    icon: "★" },
  { id: "team",     label: "Team Collaboration",    icon: "◉" },
];

function UsageBar({ used, limit, label }) {
  const pct = limit === -1 ? 100 : Math.min(100, (used / limit) * 100);
  const cls  = pct > 90 ? "danger" : pct > 70 ? "warn" : "ok";
  return (
    <div className="lm-usage">
      <div className="lm-usage__meta">
        <span className="lm-usage__label">{label}</span>
        <span className={`lm-usage__count lm-usage__count--${cls}`}>
          {used} / {limit === -1 ? "∞" : limit}
        </span>
      </div>
      <div className="lm-usage__bar">
        <div className="lm-usage__fill" style={{ width: `${pct}%` }} data-cls={cls} />
      </div>
    </div>
  );
}

function PlanBadge({ plan, status }) {
  const meta = PLANS[plan] || PLANS.trial;
  return (
    <div className="lm-plan-badge" style={{ "--plan-color": meta.color }}>
      <span className="lm-plan-badge__name">{meta.name}</span>
      <span className={`lm-plan-badge__status lm-plan-badge__status--${status}`}>{status}</span>
    </div>
  );
}

function FeatureGate({ featureId, allowed, planNeeded }) {
  const feature = ALL_FEATURES.find(f => f.id === featureId);
  if (!feature) return null;
  return (
    <div className={`lm-feature${allowed ? "" : " lm-feature--locked"}`}>
      <span className="lm-feature__icon">{feature.icon}</span>
      <span className="lm-feature__label">{feature.label}</span>
      {!allowed && planNeeded && <span className="lm-feature__gate">{planNeeded}+</span>}
      {allowed  && <span className="lm-feature__check">✓</span>}
    </div>
  );
}

// Credit counter stored in localStorage (incremented by AI components)
const CREDIT_KEY = "ooplix_ai_credits_v1";
export function consumeCredit(n = 1) {
  try {
    const d = JSON.parse(localStorage.getItem(CREDIT_KEY) || "{}");
    const today = new Date().toDateString();
    if (d.date !== today) { d.date = today; d.used = 0; }
    d.used = (d.used || 0) + n;
    localStorage.setItem(CREDIT_KEY, JSON.stringify(d));
  } catch {}
}
export function getCreditsUsed() {
  try {
    const d = JSON.parse(localStorage.getItem(CREDIT_KEY) || "{}");
    if (d.date !== new Date().toDateString()) return 0;
    return d.used || 0;
  } catch { return 0; }
}

export default function LicenseManager() {
  const [billing,   setBilling]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [creditsUsed, setCreditsUsed] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const b = await get("/billing/status");
    setBilling(b);
    setCreditsUsed(getCreditsUsed());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="lm-loading">Loading license…</div>;

  const plan     = billing?.plan || "trial";
  const status   = billing?.status || "trialing";
  const meta     = PLANS[plan] || PLANS.trial;
  const daysLeft = billing?.daysLeft;
  const allowed  = meta.features.includes("*") ? ALL_FEATURES.map(f => f.id) : meta.features;

  const requestsUsed = billing?.requestsThisPeriod || 0;

  return (
    <div className="lm-root">
      <div className="lm-header">
        <span className="lm-title">License Manager</span>
        <button className="lm-refresh" onClick={load}>↻</button>
      </div>

      <PlanBadge plan={plan} status={status} />

      {daysLeft != null && daysLeft < 7 && (
        <div className="lm-warn">
          ⚠ {plan === "trial" ? "Trial" : "Plan"} expires in {daysLeft} day{daysLeft !== 1 ? "s" : ""}
        </div>
      )}

      {/* Usage counters */}
      <div className="lm-section">
        <div className="lm-section-label">Usage</div>
        <UsageBar used={requestsUsed}  limit={meta.limit}     label="API requests / period" />
        <UsageBar used={creditsUsed}   limit={meta.aiCredits} label="AI credits today" />
      </div>

      {/* Feature gating */}
      <div className="lm-section">
        <div className="lm-section-label">Features</div>
        <div className="lm-features">
          {ALL_FEATURES.map(f => {
            const isAllowed = allowed.includes(f.id);
            const needed = isAllowed ? null : Object.entries(PLANS).find(([, p]) => p.features.includes(f.id) || p.features.includes("*"))?.[1]?.name;
            return <FeatureGate key={f.id} featureId={f.id} allowed={isAllowed} planNeeded={needed} />;
          })}
        </div>
      </div>

      {plan === "trial" && (
        <div className="lm-upgrade-cta">
          <div className="lm-upgrade-cta__text">Unlock the full platform</div>
          <div className="lm-upgrade-cta__sub">Upgrade to Starter or Growth for unlimited AI credits and team collaboration.</div>
          <div className="lm-upgrade-cta__note">Contact sales — no payment gateway yet in this build.</div>
        </div>
      )}
    </div>
  );
}
