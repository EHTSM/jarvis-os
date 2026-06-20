import React, { useState, useEffect, useCallback } from "react";
import "./CommercialBenchmark.css";

const BASE = process.env.REACT_APP_API_URL || "";

function ScoreRing({ score, size = 120 }) {
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;
  const color = score >= 75 ? "#4ade80" : score >= 50 ? "#f59e0b" : "#f87171";
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className="cb-score-ring">
      <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
      <circle cx="60" cy="60" r={radius} fill="none" stroke={color} strokeWidth="10"
        strokeDasharray={`${dash} ${circumference}`}
        strokeDashoffset={circumference / 4}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
      <text x="60" y="56" textAnchor="middle" fill={color} fontSize="24" fontWeight="800">{score}</text>
      <text x="60" y="72" textAnchor="middle" fill="#64748b" fontSize="10">/100</text>
    </svg>
  );
}

function CheckRow({ check }) {
  const color = check.ok ? "#4ade80" : "#f87171";
  const label = {
    no_guaranteed_loss_per_request: "No guaranteed loss per request",
    free_tier_sustainable:          "Free tier sustainable",
    premium_profitable:             "Premium tier profitable",
    enterprise_scalable:            "Enterprise scalable",
  }[check.check] || check.check;

  return (
    <div className="cb-check-row">
      <span className="cb-check-icon" style={{ color }}>{check.ok ? "✓" : "✗"}</span>
      <div className="cb-check-body">
        <div className="cb-check-label" style={{ color }}>{label}</div>
        <div className="cb-check-detail">
          {check.check === "no_guaranteed_loss_per_request" && (
            <span>Cost/req: <b>${check.avgCostPerReq}</b> · Revenue/req: <b>${check.avgRevenuePerReq}</b></span>
          )}
          {check.check === "free_tier_sustainable" && (
            <span>Free user AI cost: <b>${check.freeCostPerUser}/mo</b> · Limit: <b>${check.limit}/mo</b></span>
          )}
          {check.check === "premium_profitable" && (
            <span>Gross margin: <b>{check.grossMarginPct}%</b> · Required: <b>{check.required}%</b></span>
          )}
          {check.check === "enterprise_scalable" && (
            <span>Avg cost/req: <b>${check.avgCostPerReq}</b> · Limit: <b>${check.limit}</b></span>
          )}
        </div>
      </div>
    </div>
  );
}

function PLTable({ summary }) {
  if (!summary) return null;
  return (
    <div className="cb-pl-table">
      <div className="cb-pl-row cb-pl-row--header">
        <span>Metric</span><span>Value</span>
      </div>
      <div className="cb-pl-row">
        <span>Total Accounts</span><span>{summary.accounts?.total ?? 0}</span>
      </div>
      <div className="cb-pl-row">
        <span>Paid Accounts</span><span>{summary.accounts?.paid ?? 0}</span>
      </div>
      <div className="cb-pl-row">
        <span>MRR (USD)</span><span>${summary.revenue?.mrrUsd?.toFixed(2) ?? "0.00"}</span>
      </div>
      <div className="cb-pl-row">
        <span>ARR (USD)</span><span>${summary.revenue?.arrUsd?.toFixed(2) ?? "0.00"}</span>
      </div>
      <div className="cb-pl-row">
        <span>AI Provider Cost</span><span>${summary.cost?.aiProviderUsd?.toFixed(4) ?? "0.0000"}</span>
      </div>
      <div className="cb-pl-row">
        <span>Gross Profit</span><span>${summary.profit?.grossUsd?.toFixed(4) ?? "0.0000"}</span>
      </div>
      <div className="cb-pl-row">
        <span>Gross Margin</span><span>{summary.profit?.grossMargin ?? 0}%</span>
      </div>
      <div className="cb-pl-row">
        <span>Margin Status</span>
        <span style={{ color: summary.profit?.marginStatus === "healthy" ? "#4ade80" : summary.profit?.marginStatus === "watch" ? "#f59e0b" : "#f87171" }}>
          {summary.profit?.marginStatus ?? "--"}
        </span>
      </div>
      <div className="cb-pl-row">
        <span>Break-even Paid Users</span><span>{summary.profit?.breakEvenPaidUsers ?? "N/A"}</span>
      </div>
    </div>
  );
}

export default function CommercialBenchmark() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(true);

  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${BASE}/commercial/benchmark`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { run(); }, [run]);

  const readiness = data?.commercialReadiness;
  const readinessColor = readiness === "ready" ? "#4ade80" : readiness === "developing" ? "#f59e0b" : "#f87171";
  const readinessLabel = { ready: "Commercially Ready", developing: "Developing", pre_commercial: "Pre-Commercial" }[readiness] || "—";

  return (
    <div className="cb-root">
      <div className="cb-header">
        <span className="cb-title">Commercial Benchmark</span>
        <button className="cb-run-btn" onClick={run} disabled={loading}>
          {loading ? "Running…" : "↻ Run Benchmark"}
        </button>
      </div>

      {error && <div className="cb-error">{error}</div>}
      {!data && !error && <div className="cb-empty">Running benchmark...</div>}

      {data && (
        <div className="cb-panel">
          <div className="cb-score-section">
            <ScoreRing score={data.score ?? 0} />
            <div className="cb-score-meta">
              <div className="cb-readiness" style={{ color: readinessColor }}>{readinessLabel}</div>
              <div className="cb-margin-pill">
                Gross Margin: <b>{data.grossMarginPct ?? 0}%</b>
              </div>
              {data.breakEvenPaidUsers != null && (
                <div className="cb-breakeven">Break-even: <b>{data.breakEvenPaidUsers}</b> paid users</div>
              )}
            </div>
          </div>

          <div className="cb-section-hdr" onClick={() => setExpanded(e => !e)}>
            <span>Benchmark Checks</span>
            <span className="cb-chevron">{expanded ? "▲" : "▼"}</span>
          </div>
          {expanded && (
            <div className="cb-checks">
              {(data.checks || []).map((c, i) => <CheckRow key={i} check={c} />)}
            </div>
          )}

          <div className="cb-section-hdr">P&amp;L Summary</div>
          <PLTable summary={data.summary} />

          {data.summary?.byProvider?.length > 0 && (
            <>
              <div className="cb-section-hdr">Cost by Provider</div>
              {data.summary.byProvider.map(p => (
                <div key={p.key} className="cb-prov-row">
                  <span className="cb-prov-name">{p.key}</span>
                  <span className="cb-prov-reqs">{p.requests} req</span>
                  <span className="cb-prov-tok">{((p.tokens || 0)/1000).toFixed(1)}K tok</span>
                  <span className="cb-prov-cost">${(p.costUsd || 0).toFixed(5)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
