import React, { useState, useEffect, useCallback } from "react";
import { _fetch } from "../_client";
import "./AIUsageDashboard.css";

// Real AI provider orchestration dashboard — every number here comes from
// the /ai-ecosystem/* routes backed by aiOrchestrator.cjs, usageMetering.cjs,
// promptHistory.cjs, and orgBudgets.cjs. Distinct from AICostCenter.jsx,
// which (as of this mission) still contains hardcoded demo data across most
// of its tabs — that component is out of scope for this rebuild; this is a
// new, narrower surface covering exactly what the orchestration backend
// produces: live health, real cost breakdown, real prompt history, real
// cache stats, real budget status.

const TABS = [
  { id: "health",  label: "Provider Health" },
  { id: "cost",    label: "Cost Breakdown" },
  { id: "history", label: "Prompt History" },
  { id: "budget",  label: "Budget" },
  { id: "cache",   label: "Cache" },
];

function fmtCost(n) { return `$${(n ?? 0).toFixed(6)}`; }
function fmtMs(n)   { return n == null ? "—" : `${n}ms`; }

function HealthPanel() {
  const [providers, setProviders] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await _fetch("/ai-ecosystem/orchestrator/health").catch(() => ({ ok: false }));
    setLoading(false);
    if (r.ok !== false) setProviders(r.providers || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="aud-loading">Probing providers…</div>;

  return (
    <div className="aud-section">
      <div className="aud-section-header">
        <h3 className="aud-section-title">Live provider health</h3>
        <button className="aud-btn" onClick={load}>Refresh</button>
      </div>
      <table className="aud-table">
        <thead><tr><th>Provider</th><th>Reachable</th><th>Live latency</th><th>Historical p50</th><th>Quality</th><th>Detail</th></tr></thead>
        <tbody>
          {(providers || []).map(p => (
            <tr key={p.providerId}>
              <td className="aud-td-name">{p.providerId}</td>
              <td><span className={`aud-dot ${p.reachable ? "ok" : "fail"}`} />{p.reachable ? "Yes" : "No"}</td>
              <td>{fmtMs(p.liveLatencyMs)}</td>
              <td>{fmtMs(p.historicalP50LatencyMs)}</td>
              <td>{p.qualityScore != null ? p.qualityScore.toFixed(2) : "—"}</td>
              <td className="aud-td-dim">{p.liveDetail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CostPanel() {
  const [byProvider, setByProvider] = useState(null);
  const [myReport, setMyReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      _fetch("/ai-ecosystem/analytics/by-provider").catch(() => ({ ok: false })),
      _fetch("/ai-ecosystem/analytics/me").catch(() => ({ ok: false })),
    ]).then(([prov, me]) => {
      if (prov.ok !== false) setByProvider(prov.breakdown || []);
      if (me.ok !== false) setMyReport(me.report || null);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="aud-loading">Loading cost data…</div>;

  return (
    <div className="aud-section">
      {myReport && (
        <div className="aud-stats-grid">
          <div className="aud-stat-card"><span className="aud-stat-val">{fmtCost(myReport.aiCostUsd)}</span><span className="aud-stat-label">Your AI cost</span></div>
          <div className="aud-stat-card"><span className="aud-stat-val">{myReport.requests ?? 0}</span><span className="aud-stat-label">Requests</span></div>
          <div className="aud-stat-card"><span className="aud-stat-val">{myReport.tokens ?? 0}</span><span className="aud-stat-label">Tokens</span></div>
          <div className="aud-stat-card"><span className="aud-stat-val">{myReport.plan || "—"}</span><span className="aud-stat-label">Plan</span></div>
        </div>
      )}
      <h3 className="aud-section-title">Cost by provider (platform-wide)</h3>
      {!byProvider?.length ? (
        <div className="aud-empty">No usage recorded yet.</div>
      ) : (
        <table className="aud-table">
          <thead><tr><th>Provider</th><th>Requests</th><th>Tokens</th><th>Cost</th><th>Errors</th></tr></thead>
          <tbody>
            {byProvider.map(p => (
              <tr key={p.key}>
                <td className="aud-td-name">{p.key}</td>
                <td>{p.requests}</td>
                <td>{p.tokens}</td>
                <td>{fmtCost(p.costUsd)}</td>
                <td className={p.errors > 0 ? "aud-td-warn" : ""}>{p.errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function HistoryPanel() {
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    _fetch("/ai-ecosystem/history/me?limit=20").then(r => {
      if (r.ok !== false) setEntries(r.entries || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="aud-loading">Loading history…</div>;
  if (!entries?.length) return <div className="aud-section"><div className="aud-empty">No prompt history yet — send a message through the AI Chat tab.</div></div>;

  return (
    <div className="aud-section">
      <h3 className="aud-section-title">Your recent prompts</h3>
      <div className="aud-history-list">
        {entries.map(e => (
          <div key={e.id} className="aud-history-item">
            <div className="aud-history-meta">
              <span className="aud-history-provider">{e.provider}/{e.model}</span>
              <span className="aud-history-cost">{fmtCost(e.estimatedCostUsd)} · {fmtMs(e.latencyMs)}</span>
            </div>
            <p className="aud-history-prompt">{e.prompt}</p>
            <p className="aud-history-response">{e.response}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function BudgetPanel({ orgId }) {
  const [budget, setBudget] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) { setLoading(false); return; }
    _fetch(`/ai-ecosystem/budgets/org/${orgId}`).then(r => {
      if (r.ok !== false) setBudget(r.budget);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [orgId]);

  if (!orgId) return <div className="aud-section"><div className="aud-empty">No organization context — join or create an organization to see budget status.</div></div>;
  if (loading) return <div className="aud-loading">Loading budget…</div>;

  return (
    <div className="aud-section">
      <h3 className="aud-section-title">Organization AI budget</h3>
      <div className="aud-stats-grid">
        <div className="aud-stat-card">
          <span className="aud-stat-val">{budget?.monthlyCapUsd != null ? `$${budget.monthlyCapUsd}` : "No cap"}</span>
          <span className="aud-stat-label">Monthly cap</span>
        </div>
        <div className="aud-stat-card">
          <span className="aud-stat-val">{budget?.spentUsd != null ? fmtCost(budget.spentUsd) : "—"}</span>
          <span className="aud-stat-label">Spent this month</span>
        </div>
        <div className="aud-stat-card">
          <span className="aud-stat-val">{budget?.monthlyRequestCap ?? "No cap"}</span>
          <span className="aud-stat-label">Request cap</span>
        </div>
      </div>
    </div>
  );
}

function CachePanel() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await _fetch("/ai-ecosystem/orchestrator/cache").catch(() => ({ ok: false }));
    setLoading(false);
    if (r.ok !== false) setStats(r);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    await _fetch("/ai-ecosystem/orchestrator/cache/clear", { method: "POST" }).catch(() => {});
    load();
  };

  if (loading) return <div className="aud-loading">Loading cache stats…</div>;

  return (
    <div className="aud-section">
      <div className="aud-section-header">
        <h3 className="aud-section-title">Response cache</h3>
        <button className="aud-btn danger" onClick={handleClear}>Clear cache</button>
      </div>
      <div className="aud-stats-grid">
        <div className="aud-stat-card"><span className="aud-stat-val">{stats?.entries ?? 0}</span><span className="aud-stat-label">Cached entries</span></div>
        <div className="aud-stat-card"><span className="aud-stat-val">{stats?.hits ?? 0}</span><span className="aud-stat-label">Hits</span></div>
        <div className="aud-stat-card"><span className="aud-stat-val">{stats?.misses ?? 0}</span><span className="aud-stat-label">Misses</span></div>
        <div className="aud-stat-card"><span className="aud-stat-val">{stats ? `${(stats.hitRate * 100).toFixed(0)}%` : "—"}</span><span className="aud-stat-label">Hit rate</span></div>
      </div>
    </div>
  );
}

export default function AIUsageDashboard() {
  const [tab, setTab] = useState("health");
  const [orgId, setOrgId] = useState(null);

  useEffect(() => {
    _fetch("/orgs/me/context").then(r => {
      if (r.ok !== false) setOrgId(r.primaryOrg?.orgId || null);
    }).catch(() => {});
  }, []);

  return (
    <div className="ai-usage-dashboard page-enter">
      <div className="aud-header">
        <h1 className="aud-title">AI Provider Orchestration</h1>
        <p className="aud-subtitle">Live routing, health, cost, and history across every connected AI provider.</p>
      </div>

      <nav className="aud-subnav">
        {TABS.map(t => (
          <button key={t.id} className={`aud-subnav-btn ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>

      <div className="aud-content">
        {tab === "health"  && <HealthPanel />}
        {tab === "cost"    && <CostPanel />}
        {tab === "history" && <HistoryPanel />}
        {tab === "budget"  && <BudgetPanel orgId={orgId} />}
        {tab === "cache"   && <CachePanel />}
      </div>
    </div>
  );
}
