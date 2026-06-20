import React, { useState, useEffect, useCallback } from "react";
import "./DeveloperConsole.css";

const BASE = process.env.REACT_APP_API_URL || "";

function badge(v) {
  if (v === true || v === "healthy" || v === "ready" || v === "active") return "dc-badge dc-badge--green";
  if (v === false || v === "unhealthy" || v === "at_risk") return "dc-badge dc-badge--red";
  if (v === "watch" || v === "developing" || v === "rate_limited") return "dc-badge dc-badge--yellow";
  return "dc-badge dc-badge--gray";
}

function ProviderRow({ p }) {
  return (
    <div className="dc-provider-row">
      <span className={badge(p.available)}>{p.available ? "✓" : "✗"}</span>
      <span className="dc-provider-name">{p.name}</span>
      <span className="dc-provider-stat">{p.usageToday ?? 0} tok today</span>
      {p.quotaUsePct != null && (
        <span className="dc-provider-quota">
          <span className="dc-quota-bar" style={{ width: `${Math.min(100, p.quotaUsePct)}%` }} />
          {p.quotaUsePct}%
        </span>
      )}
      {p.rateLimited && <span className="dc-badge dc-badge--yellow">rate-limited</span>}
    </div>
  );
}

function RouterRow({ s }) {
  const score = parseFloat(s.composite || 0);
  return (
    <div className="dc-router-row">
      <span className="dc-router-name">{s.name}</span>
      <span className="dc-router-bar-wrap">
        <span className="dc-router-bar" style={{ width: `${Math.round(score * 100)}%` }} />
      </span>
      <span className="dc-router-score">{(score * 100).toFixed(0)}</span>
      <span className={badge(s.available)}>{s.available ? "on" : "off"}</span>
    </div>
  );
}

function CreditPanel({ credits }) {
  if (!credits) return null;
  const { free, premium, byok, local } = credits;
  return (
    <div className="dc-credit-panel">
      <div className="dc-credit-row">
        <span className="dc-credit-label">Free</span>
        <span className="dc-credit-bar-wrap">
          <span className="dc-credit-bar" style={{ width: `${Math.round((free.balance / Math.max(1, free.dailyLimit)) * 100)}%` }} />
        </span>
        <span className="dc-credit-val">{free.balance} / {free.dailyLimit}</span>
      </div>
      <div className="dc-credit-row">
        <span className="dc-credit-label">Premium</span>
        <span className="dc-credit-val">{premium.balance} credits</span>
        {premium.expiresAt && <span className="dc-credit-exp">exp {new Date(premium.expiresAt).toLocaleDateString()}</span>}
      </div>
      <div className="dc-credit-row">
        <span className="dc-credit-label">BYOK</span>
        <span className={badge(byok.enabled)}>{byok.enabled ? "enabled" : "off"}</span>
        <span className="dc-credit-label" style={{ marginLeft: 12 }}>Local</span>
        <span className={badge(local.enabled)}>{local.enabled ? "enabled" : "off"}</span>
      </div>
    </div>
  );
}

function UsageSummary({ usage }) {
  if (!usage) return null;
  return (
    <div className="dc-usage-grid">
      <div className="dc-usage-cell"><span className="dc-usage-val">{usage.requests}</span><span className="dc-usage-lbl">requests</span></div>
      <div className="dc-usage-cell"><span className="dc-usage-val">{(usage.tokens / 1000).toFixed(1)}K</span><span className="dc-usage-lbl">tokens</span></div>
      <div className="dc-usage-cell"><span className="dc-usage-val">${usage.costUsd?.toFixed(4)}</span><span className="dc-usage-lbl">est cost</span></div>
      <div className="dc-usage-cell"><span className="dc-usage-val">{(usage.successRate * 100).toFixed(1)}%</span><span className="dc-usage-lbl">success</span></div>
      <div className="dc-usage-cell"><span className="dc-usage-val">{usage.p50ms}ms</span><span className="dc-usage-lbl">p50</span></div>
    </div>
  );
}

function FailureRow({ f }) {
  return (
    <div className="dc-fail-row">
      <span className="dc-fail-ts">{new Date(f.ts).toLocaleTimeString()}</span>
      <span className="dc-fail-type">{f.requestType}</span>
      <span className="dc-fail-prov">{f.provider}</span>
      <span className="dc-fail-err">{f.errorCode || "error"}</span>
    </div>
  );
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "providers", label: "Providers" },
  { id: "routing",   label: "Routing" },
  { id: "usage",     label: "Usage" },
  { id: "credits",   label: "Credits" },
  { id: "failures",  label: "Failures" },
];

export default function DeveloperConsole() {
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetch_ = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${BASE}/commercial/console`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(fetch_, 10000);
    return () => clearInterval(t);
  }, [autoRefresh, fetch_]);

  return (
    <div className="dc-root">
      <div className="dc-header">
        <span className="dc-title">Developer Console</span>
        <span className="dc-ts">{data?.ts ? new Date(data.ts).toLocaleTimeString() : "--"}</span>
        <button className={`dc-refresh-btn${autoRefresh ? " dc-refresh-btn--on" : ""}`} onClick={() => setAutoRefresh(a => !a)}>
          {autoRefresh ? "⏸ Auto" : "▶ Auto"}
        </button>
        <button className="dc-refresh-btn" onClick={fetch_} disabled={loading}>{loading ? "…" : "↻"}</button>
      </div>

      <div className="dc-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`dc-tab${tab === t.id ? " dc-tab--active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {error && <div className="dc-error">{error}</div>}

      {!data && !error && <div className="dc-empty">Loading...</div>}

      {data && tab === "overview" && (
        <div className="dc-panel">
          <h3 className="dc-section-title">Usage</h3>
          <UsageSummary usage={data.usage} />
          <h3 className="dc-section-title">Credits</h3>
          <CreditPanel credits={data.credits} />
          <h3 className="dc-section-title">Recent Decisions</h3>
          {(data.recentDecisions || []).slice(0, 3).map((d, i) => (
            <div key={i} className="dc-decision-row">
              <span className="dc-decision-task">{d.task}</span>
              <span className="dc-decision-prov">→ {d.primary}</span>
              <span className="dc-decision-reason">{d.reason}</span>
            </div>
          ))}
          {(data.recentFailures || []).length > 0 && (
            <>
              <h3 className="dc-section-title dc-section-title--warn">Recent Failures</h3>
              {data.recentFailures.slice(0, 3).map((f, i) => <FailureRow key={i} f={f} />)}
            </>
          )}
        </div>
      )}

      {data && tab === "providers" && (
        <div className="dc-panel">
          <h3 className="dc-section-title">Provider Health</h3>
          {(data.providers || []).map(p => <ProviderRow key={p.id} p={p} />)}
        </div>
      )}

      {data && tab === "routing" && (
        <div className="dc-panel">
          <h3 className="dc-section-title">Router Scores (composite)</h3>
          {(data.routerScores || []).map(s => <RouterRow key={s.id} s={s} />)}
          <h3 className="dc-section-title" style={{ marginTop: 16 }}>Recent Decisions</h3>
          {(data.recentDecisions || []).map((d, i) => (
            <div key={i} className="dc-decision-row">
              <span className="dc-decision-ts">{new Date(d.ts).toLocaleTimeString()}</span>
              <span className="dc-decision-task">{d.task}</span>
              <span className="dc-decision-prov">→ {d.primary}</span>
              <span className="dc-decision-reason">{d.reason}</span>
              <span className="dc-decision-score">{(d.scores?.composite * 100 || 0).toFixed(0)}</span>
            </div>
          ))}
        </div>
      )}

      {data && tab === "usage" && (
        <div className="dc-panel">
          <h3 className="dc-section-title">Usage Summary</h3>
          <UsageSummary usage={data.usage} />
        </div>
      )}

      {data && tab === "credits" && (
        <div className="dc-panel">
          <h3 className="dc-section-title">Credit Balances</h3>
          <CreditPanel credits={data.credits} />
        </div>
      )}

      {data && tab === "failures" && (
        <div className="dc-panel">
          <h3 className="dc-section-title">Recent Failures</h3>
          {(data.recentFailures || []).length === 0 && <div className="dc-empty dc-empty--green">No recent failures</div>}
          {(data.recentFailures || []).map((f, i) => <FailureRow key={i} f={f} />)}
          <h3 className="dc-section-title" style={{ marginTop: 16 }}>Fallback History</h3>
          {(data.fallbackHistory || []).length === 0 && <div className="dc-empty">No fallbacks recorded</div>}
          {(data.fallbackHistory || []).map((d, i) => (
            <div key={i} className="dc-decision-row">
              <span className="dc-decision-ts">{new Date(d.ts).toLocaleTimeString()}</span>
              <span className="dc-decision-prov">→ {d.chain?.join(" → ")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
