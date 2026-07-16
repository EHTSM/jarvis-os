import React, { useState, useEffect, useCallback } from "react";
import "./AdminDashboard.css";

const BASE = process.env.REACT_APP_API_URL || "";

function stat(label, value, sub) {
  return (
    <div className="ad-stat">
      <div className="ad-stat-val">{value}</div>
      <div className="ad-stat-lbl">{label}</div>
      {sub && <div className="ad-stat-sub">{sub}</div>}
    </div>
  );
}

function PlanBar({ name, count, total, color }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="ad-plan-row">
      <span className="ad-plan-name" style={{ color }}>{name}</span>
      <span className="ad-plan-bar-wrap">
        <span className="ad-plan-bar" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="ad-plan-count">{count}</span>
      <span className="ad-plan-pct">{pct}%</span>
    </div>
  );
}

function MarginGauge({ pct, status }) {
  const color = status === "healthy" ? "#4ade80" : status === "watch" ? "#f59e0b" : "#f87171";
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="ad-margin-gauge">
      <div className="ad-margin-arc">
        <svg viewBox="0 0 120 70" className="ad-margin-svg">
          <path d="M10,60 A50,50,0,0,1,110,60" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" strokeLinecap="round" />
          <path d="M10,60 A50,50,0,0,1,110,60" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${(clamped / 100) * 157} 157`} />
          <text x="60" y="58" textAnchor="middle" fill={color} fontSize="18" fontWeight="bold">{pct}%</text>
          <text x="60" y="70" textAnchor="middle" fill="#64748b" fontSize="9">gross margin</text>
        </svg>
      </div>
    </div>
  );
}

const TABS = [
  { id: "overview",   label: "Overview"   },
  { id: "revenue",    label: "Revenue"    },
  { id: "cost",       label: "Cost"       },
  { id: "users",      label: "Users"      },
  { id: "providers",  label: "Providers"  },
  { id: "connectors", label: "Connectors" },
];

export default function AdminDashboard() {
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [submissionsErr, setSubmissionsErr] = useState(null);
  const [reviewingId, setReviewingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${BASE}/commercial/admin/dashboard`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  const loadSubmissions = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/marketplace/submissions?status=pending`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();
      setSubmissions(body.submissions || []);
      setSubmissionsErr(null);
    } catch (e) { setSubmissionsErr(e.message); }
  }, []);

  const reviewSubmission = useCallback(async (id, decision) => {
    setReviewingId(id);
    try {
      const r = await fetch(`${BASE}/marketplace/submissions/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ decision }),
      });
      if (!r.ok) { const body = await r.json().catch(() => ({})); throw new Error(body.error || `HTTP ${r.status}`); }
      await loadSubmissions();
    } catch (e) { setSubmissionsErr(e.message); }
    finally { setReviewingId(null); }
  }, [loadSubmissions]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "connectors") loadSubmissions(); }, [tab, loadSubmissions]);

  const PLAN_COLORS = { trial: "#64748b", starter: "#06b6d4", growth: "#7c6fff", scale: "#f59e0b" };

  return (
    <div className="ad-root">
      <div className="ad-header">
        <span className="ad-title">Admin Dashboard</span>
        <span className="ad-ts">{data?.ts ? new Date(data.ts).toLocaleTimeString() : "--"}</span>
        <button className="ad-refresh-btn" onClick={load} disabled={loading}>{loading ? "…" : "↻ Refresh"}</button>
      </div>

      <div className="ad-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`ad-tab${tab === t.id ? " ad-tab--active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="ad-error">{error}</div>}
      {!data && !error && <div className="ad-empty">Loading...</div>}

      {data && tab === "overview" && (
        <div className="ad-panel">
          <div className="ad-stat-grid">
            {stat("MRR", `$${data.revenue?.mrrUsd?.toFixed(0) ?? 0}`)}
            {stat("ARR", `$${data.revenue?.arrUsd?.toFixed(0) ?? 0}`)}
            {stat("Paid Users", data.users?.paid ?? 0)}
            {stat("Total Users", data.users?.total ?? 0)}
            {stat("AI Cost", `$${data.cost?.aiProviderUsd?.toFixed(4) ?? 0}`, "USD")}
            {stat("Gross Profit", `$${data.profit?.grossUsd?.toFixed(2) ?? 0}`, data.profit?.marginStatus)}
          </div>
          <MarginGauge pct={data.profit?.grossMarginPct ?? 0} status={data.profit?.marginStatus} />
        </div>
      )}

      {data && tab === "revenue" && (
        <div className="ad-panel">
          <h3 className="ad-section-title">Monthly Recurring Revenue</h3>
          <div className="ad-stat-grid">
            {stat("MRR", `$${data.revenue?.mrrUsd?.toFixed(2) ?? 0}`, "USD / month")}
            {stat("ARR", `$${data.revenue?.arrUsd?.toFixed(0) ?? 0}`, "USD / year")}
          </div>
          <h3 className="ad-section-title" style={{ marginTop: 16 }}>Plan Distribution</h3>
          <div className="ad-plans">
            {["trial","starter","growth","scale"].map(plan => (
              <PlanBar key={plan} name={plan} count={data.users?.[plan] ?? 0} total={data.users?.total ?? 1} color={PLAN_COLORS[plan]} />
            ))}
          </div>
        </div>
      )}

      {data && tab === "cost" && (
        <div className="ad-panel">
          <h3 className="ad-section-title">AI Provider Cost</h3>
          <div className="ad-stat-grid">
            {stat("Total Requests", data.cost?.totalRequests ?? 0)}
            {stat("Total Tokens", ((data.cost?.totalTokens ?? 0) / 1000).toFixed(1) + "K")}
            {stat("AI Cost (USD)", `$${data.cost?.aiProviderUsd?.toFixed(4) ?? 0}`)}
            {stat("Avg Cost/Req", `$${data.cost?.avgCostPerReq ?? 0}`)}
          </div>
          <h3 className="ad-section-title" style={{ marginTop: 16 }}>By Provider</h3>
          {(data.providers || []).map(p => (
            <div key={p.key} className="ad-provider-cost-row">
              <span className="ad-prov-name">{p.key}</span>
              <span className="ad-prov-reqs">{p.requests} req</span>
              <span className="ad-prov-cost">${(p.costUsd || 0).toFixed(5)}</span>
            </div>
          ))}
          <h3 className="ad-section-title" style={{ marginTop: 16 }}>By Route</h3>
          {(data.topRoutes || []).slice(0, 8).map(r => (
            <div key={r.key} className="ad-provider-cost-row">
              <span className="ad-prov-name">{r.key}</span>
              <span className="ad-prov-reqs">{r.requests} req</span>
              <span className="ad-prov-cost">${(r.costUsd || 0).toFixed(5)}</span>
            </div>
          ))}
        </div>
      )}

      {data && tab === "users" && (
        <div className="ad-panel">
          <h3 className="ad-section-title">User Breakdown</h3>
          <div className="ad-stat-grid">
            {stat("Total", data.users?.total ?? 0)}
            {stat("Trial", data.users?.trial ?? 0)}
            {stat("Starter", data.users?.starter ?? 0)}
            {stat("Growth", data.users?.growth ?? 0)}
            {stat("Scale", data.users?.scale ?? 0)}
            {stat("BYOK", data.users?.byok ?? 0)}
            {stat("Local (Ollama)", data.users?.local ?? 0)}
            {stat("Paid", data.users?.paid ?? 0, `${data.users?.total > 0 ? Math.round(((data.users?.paid ?? 0) / data.users?.total) * 100) : 0}% conversion`)}
          </div>
        </div>
      )}

      {data && tab === "providers" && (
        <div className="ad-panel">
          <h3 className="ad-section-title">Cost by Provider</h3>
          {(data.providers || []).length === 0 && <div className="ad-empty">No usage data yet.</div>}
          {(data.providers || []).map(p => (
            <div key={p.key} className="ad-provider-cost-row">
              <span className="ad-prov-name">{p.key}</span>
              <span className="ad-prov-tokens">{((p.tokens || 0) / 1000).toFixed(1)}K tok</span>
              <span className="ad-prov-reqs">{p.requests} req</span>
              <span className="ad-prov-cost">${(p.costUsd || 0).toFixed(5)}</span>
              {p.errors > 0 && <span className="ad-prov-err">{p.errors} err</span>}
            </div>
          ))}
        </div>
      )}

      {tab === "connectors" && (
        <div className="ad-panel">
          <h3 className="ad-section-title">Connector Submissions — Pending Review</h3>
          {submissionsErr && <div className="ad-error">{submissionsErr}</div>}
          {submissions.length === 0 && !submissionsErr && (
            <div className="ad-empty">No pending submissions.</div>
          )}
          {submissions.map(s => (
            <div key={s.id} className="ad-provider-cost-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6, padding: "12px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                <span className="ad-prov-name">{s.manifest.name} <span style={{ opacity: 0.6, fontSize: 12 }}>({s.manifest.id} v{s.manifest.version})</span></span>
                <span style={{ fontSize: 12, opacity: 0.7 }}>submitted {new Date(s.submittedAt).toLocaleDateString()}</span>
              </div>
              <div style={{ fontSize: 13, opacity: 0.8 }}>{s.manifest.description}</div>
              <div style={{ fontSize: 12, opacity: 0.6 }}>by {s.manifest.author} · category: {s.manifest.category || "uncategorized"} · capabilities: {(s.manifest.capabilities || []).join(", ") || "none"}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button className="ad-refresh-btn" disabled={reviewingId === s.id} onClick={() => reviewSubmission(s.id, "approved")}>
                  {reviewingId === s.id ? "…" : "Approve"}
                </button>
                <button className="ad-refresh-btn" disabled={reviewingId === s.id} onClick={() => reviewSubmission(s.id, "rejected")}>
                  {reviewingId === s.id ? "…" : "Reject"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
