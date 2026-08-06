import React, { useState, useEffect, useCallback } from "react";
import { getBillingStatus } from "../billingApi";
import { _fetch } from "../_client";
import "./CustomerDashboard.css";

// Real customer-facing home screen — replaces CommandCenter (the founder's
// internal operator cockpit) for role:"user" accounts. Every widget here
// pulls from account/org-scoped endpoints only (billing/status, business/
// dashboard, orgs/me/context) — no platform-wide founder data.

function _fmtMoney(n) {
  if (!n && n !== 0) return "—";
  return `₹${Number(n).toLocaleString("en-IN")}`;
}

function _planLabel(plan) {
  switch (plan) {
    case "trial":   return "Free Trial";
    case "starter": return "Starter";
    case "growth":  return "Growth";
    case "scale":   return "Scale";
    default:        return plan || "—";
  }
}

// A rejected fetch is a real backend failure — it must not render identically
// to "no data yet."
function CdErrorState({ error, onRetry }) {
  return (
    <div className="cd-error">
      <span className="cd-error-title">Couldn't load this data</span>
      <p className="cd-error-sub">{error}</p>
      <button className="cd-error-retry" onClick={onRetry}>Retry</button>
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="cd-stat-card">
      <span className="cd-stat-val" style={accent ? { color: accent } : undefined}>{value}</span>
      <span className="cd-stat-label">{label}</span>
      {sub && <span className="cd-stat-sub">{sub}</span>}
    </div>
  );
}

function QuickActions({ onNavigate }) {
  // A.5 finding: "AI Chat" routed to "jarvisbrain" — a real, but purely
  // read-only monitoring dashboard (live mission/loop-cycle counters,
  // zero <input>/<textarea> anywhere on the page) — not the real chat
  // interface. The actual chat UI (Chat.jsx, a real message input +
  // send flow) lives at tab id "chat" (the top-level "AI" tab), which
  // this button never pointed to. An engineer clicking a button
  // literally labeled "AI Chat" had no way to type a message.
  const actions = [
    { icon: "✦", label: "New Mission",  tab: "mission" },
    { icon: "◎", label: "AI Chat",      tab: "chat" },
    { icon: "◈", label: "CRM",          tab: "business" },
    { icon: "⬡", label: "Automation",   tab: "workflowautomation" },
    { icon: "🔌", label: "Connectors",   tab: "integrations" },
    { icon: "👥", label: "Team",         tab: "orgadmin" },
  ];
  return (
    <div className="cd-quick-actions">
      {actions.map(({ icon, label, tab }) => (
        <button key={tab} className="cd-quick-action" onClick={() => onNavigate?.(tab)}>
          <span className="cd-quick-action-icon">{icon}</span>
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function PipelineSnapshot({ dashboard, error, onRetry, onNavigate }) {
  if (error) {
    return (
      <div className="cd-panel">
        <div className="cd-panel-header">
          <h3 className="cd-panel-title">Your pipeline</h3>
        </div>
        <CdErrorState error={error} onRetry={onRetry} />
      </div>
    );
  }

  const hasData = dashboard && (dashboard.leads.total > 0 || dashboard.opportunities.total > 0 || dashboard.revenue.count > 0);

  if (!hasData) {
    return (
      <div className="cd-panel">
        <div className="cd-panel-header">
          <h3 className="cd-panel-title">Your pipeline</h3>
        </div>
        <div className="cd-empty">
          <span className="cd-empty-icon">◈</span>
          <p className="cd-empty-title">No leads or deals yet</p>
          <p className="cd-empty-sub">Add your first lead to start tracking your sales pipeline.</p>
          <button className="cd-empty-cta" onClick={() => onNavigate?.("business")}>Go to CRM →</button>
        </div>
      </div>
    );
  }

  return (
    <div className="cd-panel">
      <div className="cd-panel-header">
        <h3 className="cd-panel-title">Your pipeline</h3>
        <button className="cd-panel-link" onClick={() => onNavigate?.("business")}>Open CRM →</button>
      </div>
      <div className="cd-stats-grid">
        <StatCard label="Leads" value={dashboard.leads.total} sub={`${dashboard.leads.new} new`} />
        <StatCard label="Open deals" value={dashboard.opportunities.open} sub={_fmtMoney(dashboard.opportunities.pipelineValue)} />
        <StatCard label="Won this month" value={dashboard.opportunities.wonThisMonth} accent="var(--success)" />
        <StatCard label="Revenue tracked" value={_fmtMoney(dashboard.revenue.total)} />
      </div>
    </div>
  );
}

function OrgPanel({ org, error, onRetry, onNavigate }) {
  if (error) {
    return (
      <div className="cd-panel">
        <div className="cd-panel-header"><h3 className="cd-panel-title">Your organization</h3></div>
        <CdErrorState error={error} onRetry={onRetry} />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="cd-panel">
        <div className="cd-panel-header"><h3 className="cd-panel-title">Your organization</h3></div>
        <div className="cd-empty">
          <span className="cd-empty-icon">◈</span>
          <p className="cd-empty-title">No organization yet</p>
          <button className="cd-empty-cta" onClick={() => onNavigate?.("orgadmin")}>Create one →</button>
        </div>
      </div>
    );
  }
  return (
    <div className="cd-panel">
      <div className="cd-panel-header">
        <h3 className="cd-panel-title">{org.orgName}</h3>
        <button className="cd-panel-link" onClick={() => onNavigate?.("orgadmin")}>Manage →</button>
      </div>
      <div className="cd-org-meta">
        <span className="cd-org-role">{(org.orgRole || "").replace("_", " ")}</span>
        <span className="cd-org-teams">{org.teams?.length || 0} team{org.teams?.length === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}

export default function CustomerDashboard({ onNavigate }) {
  const [billing,   setBilling]   = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [org,       setOrg]       = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [name,      setName]      = useState("");
  const [dashError, setDashError] = useState(null);
  const [orgError,  setOrgError]  = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [billingRes, dashRes, ctxRes, meRes] = await Promise.allSettled([
      getBillingStatus(),
      _fetch("/business/dashboard"),
      _fetch("/orgs/me/context"),
      _fetch("/accounts/me"),
    ]);
    if (billingRes.status === "fulfilled" && billingRes.value?.success !== false) setBilling(billingRes.value);

    // A rejected promise or an explicit ok:false is a real backend failure —
    // surface it distinctly instead of silently falling through to the
    // "no leads/deals yet" / "no organization yet" empty states.
    if (dashRes.status === "fulfilled" && dashRes.value?.ok !== false) {
      setDashboard(dashRes.value.dashboard || dashRes.value);
      setDashError(null);
    } else {
      setDashboard(null);
      setDashError(dashRes.status === "rejected" ? (dashRes.reason?.message || "Failed to load pipeline") : (dashRes.value?.error || "Failed to load pipeline"));
    }

    if (ctxRes.status === "fulfilled" && ctxRes.value?.ok !== false) {
      setOrg(ctxRes.value.primaryOrg || null);
      setOrgError(null);
    } else {
      setOrg(null);
      setOrgError(ctxRes.status === "rejected" ? (ctxRes.reason?.message || "Failed to load organization") : (ctxRes.value?.error || "Failed to load organization"));
    }

    if (meRes.status === "fulfilled" && meRes.value?.account?.name) setName(meRes.value.account.name.split(" ")[0]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="customer-dashboard cd-loading">Loading your dashboard…</div>;
  }

  const greeting = name ? `Welcome back, ${name}` : "Welcome back";

  return (
    <div className="customer-dashboard page-enter">
      <div className="cd-header">
        <div>
          <h1 className="cd-title">{greeting}</h1>
          <span className="cd-date">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</span>
        </div>
        {billing && (
          <div className="cd-plan-chip">
            <span className="cd-plan-label">{_planLabel(billing.plan)}</span>
            {billing.usage?.limit != null && (
              <span className="cd-plan-usage">{billing.usage.used} / {billing.usage.limit} AI actions this month</span>
            )}
          </div>
        )}
      </div>

      <QuickActions onNavigate={onNavigate} />

      <div className="cd-panel-grid">
        <OrgPanel org={org} error={orgError} onRetry={load} onNavigate={onNavigate} />
        <PipelineSnapshot dashboard={dashboard} error={dashError} onRetry={load} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
