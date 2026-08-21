import React, { useState, useEffect } from "react";
import { track } from "../analytics";
import { _fetch } from "../_client";
import "./AICostCenter.css";

// ── C.9 AI Experience audit (2026-08-14/15) ─────────────────────────────────
// This file previously rendered a fully hardcoded PROVIDERS/BUDGET_ALERTS/
// MONTHLY_SPEND/OPTIMIZATIONS seed as if it were live measured spend: fake
// per-model request/token/cost/rpm counts, a fake 6-month spend history
// chart, fake budget-vs-threshold percentages, and fake "optimization"
// recommendations with invented savings figures and invented usage-pattern
// claims — all next to a genuinely live activeProvider/health merge, so real
// and fabricated data were visually indistinguishable. The only two live
// endpoints already being fetched (/ai/status, /analytics/ai) were used for
// nothing but a status dot.
//
// Fixed by:
//  1. Adding GET /analytics/ai-cost (backend/routes/analytics.js), which
//     exposes the already-existing usageMetering.summary() — real totals
//     computed from the actual usage ledger every /ai/chat, /ai/chat-with-tools,
//     and /coding/* call writes to. No new AI architecture; wiring an existing
//     function.
//  2. Overview + Providers now render ONLY that real data, with an honest
//     empty state when the ledger has no events yet (a founder who hasn't
//     made AI calls sees "No AI usage recorded yet", not invented numbers).
//  3. Routing / Budget & Alerts / Optimizations have no real backing engine —
//     there is no cost-anomaly detector, no budget-threshold service, no
//     optimization-recommendation engine anywhere in the codebase, and
//     building one is new AI capability this audit must not create. Rather
//     than delete the sections outright (they document real, sensible
//     policy a founder could configure), they are kept but clearly labeled
//     "Example configuration — not measured from your usage" with no numbers
//     that could be mistaken for live spend, and no "Apply" action that
//     implies a real effect.

const SECTIONS = [
  { id: "overview",  label: "Overview" },
  { id: "providers",  label: "Providers" },
  { id: "routing",   label: "Model Routing (example)" },
  { id: "budget",    label: "Budget & Alerts (example)" },
];

// Illustrative only — see header note. No numbers here are measured.
const ROUTING_RULES = [
  { id: "rr1", condition: "Token count < 2,000",        route: "Local model (Ollama)", reason: "Free local inference for short tasks" },
  { id: "rr2", condition: "Code generation request",    route: "Local model (Ollama)", reason: "Fast local code model" },
  { id: "rr3", condition: "Sentiment / classification", route: "Cheapest hosted model", reason: "Lowest cost per token, high accuracy" },
  { id: "rr4", condition: "Customer-facing reply",      route: "Quality-tier hosted model", reason: "Quality-first for external messages" },
  { id: "rr5", condition: "Fallback (offline local)",   route: "Any configured provider", reason: "Uses the real provider fallback chain — see AI Status" },
];

function fmt(n) { return (n ?? 0).toLocaleString("en-IN"); }
function fmtTok(n) {
  const v = n ?? 0;
  return v >= 1_000_000 ? (v / 1_000_000).toFixed(2) + "M" : v >= 1000 ? (v / 1000).toFixed(0) + "K" : String(v);
}
// 6 decimals, not 4 — matches usageMetering.summary()'s own precision choice.
// At 4 places, cheap-provider costs (e.g. one Groq request ≈ $0.000001)
// silently round to $0.0000, which would misrepresent a real, nonzero,
// correctly-measured cost as free right after fixing this component to stop
// fabricating cost data in the first place.
function fmtCost(n) { return `$${(n ?? 0).toFixed(6)}`; }

export default function AICostCenter({ onNavigate }) {
  const [section, setSection]     = useState("overview");
  const [aiStatus, setAiStatus]   = useState(null);
  const [costSummary, setCostSummary] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    track.event("ai_cost_center_viewed");
    Promise.all([
      _fetch("/ai/status").catch(() => null),
      _fetch("/analytics/ai-cost").catch(() => null),
    ]).then(([status, cost]) => {
      setAiStatus(status || null);
      setCostSummary(cost && cost.ok ? cost : null);
      if (!cost || !cost.ok) setLoadError("Cost summary unavailable — real usage data could not be loaded.");
    }).finally(() => setLoading(false));
  }, []);

  const activeProvider = aiStatus?.activeProvider || null;
  const providers      = Array.isArray(aiStatus?.providers) ? aiStatus.providers : [];
  const byProvider      = Array.isArray(costSummary?.byProvider) ? costSummary.byProvider : [];
  const hasUsage        = !!costSummary && costSummary.totalRequests > 0;

  return (
    <div className="ai-cost-center page-enter">
      <div className="acc-header">
        <div>
          <h1 className="acc-title">AI Cost Management</h1>
          <p className="acc-subtitle">Real request, token, cost, and latency totals from the AI usage ledger.</p>
        </div>
        {activeProvider && (
          <div className="acc-active-provider">
            <span className="acc-ap-dot" />
            <span className="acc-ap-label">Active: <strong>{activeProvider}</strong></span>
          </div>
        )}
      </div>

      {loading && <div className="acc-loading">Loading real usage data…</div>}

      {!loading && loadError && (
        <div className="acc-empty-banner">
          {loadError} This does not mean cost is zero — it means the summary could not be measured right now.
        </div>
      )}

      {!loading && !loadError && (
        <>
          <div className="acc-summary-strip">
            {[
              { label: "Total cost (all-time, measured)", value: fmtCost(costSummary?.totalCostUsd), color: "var(--text)" },
              { label: "Total requests",   value: fmt(costSummary?.totalRequests),  color: "var(--accent)" },
              { label: "Total tokens",     value: fmtTok(costSummary?.totalTokens), color: "var(--accent)" },
              { label: "Success rate",     value: `${Math.round((costSummary?.successRate ?? 1) * 100)}%`, color: "var(--success)" },
              { label: "Avg latency",      value: `${costSummary?.avgLatencyMs ?? 0}ms`, color: "var(--accent2)" },
              { label: "P95 latency",      value: `${costSummary?.p95LatencyMs ?? 0}ms`, color: "var(--accent2)" },
            ].map(s => (
              <div key={s.label} className="acc-summary-tile">
                <span className="acc-sv" style={{ color: s.color }}>{s.value}</span>
                <span className="acc-sl">{s.label}</span>
              </div>
            ))}
          </div>

          <div className="acc-tabs">
            {SECTIONS.map(t => (
              <button key={t.id} className={`acc-tab${section === t.id ? " acc-tab--active" : ""}`} onClick={() => setSection(t.id)}>{t.label}</button>
            ))}
          </div>

          <div className="acc-content" key={section}>

            {section === "overview" && (
              <div className="acc-overview">
                {!hasUsage && (
                  <div className="acc-empty-banner">
                    No AI usage recorded yet. Cost, token, and request totals will appear here once your account makes AI calls.
                  </div>
                )}

                {hasUsage && (
                  <div className="acc-provider-summary-list">
                    {byProvider.map(p => (
                      <div key={p.provider || p.id} className="acc-prov-row">
                        <div className="acc-prov-info">
                          <span className="acc-prov-name">{p.provider || p.id}</span>
                        </div>
                        <span className="acc-prov-reqs">{fmt(p.totalRequests ?? p.requests)} req</span>
                        <span className="acc-prov-toks">{fmtTok(p.totalTokens ?? p.tokens)}</span>
                        <span className="acc-prov-cost">{fmtCost(p.totalCostUsd ?? p.cost)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="acc-errors-note">
                  Errors recorded: {fmt(costSummary?.errors)} · Credits consumed: {fmt(costSummary?.totalCredits)}
                </div>
              </div>
            )}

            {section === "providers" && (
              <div className="acc-providers">
                {providers.length === 0 && (
                  <div className="acc-empty-banner">No provider health data available.</div>
                )}
                <div className="acc-provider-summary-list">
                  {providers.map(p => (
                    <div key={p.id} className="acc-prov-row">
                      <div className="acc-prov-info">
                        <span className="acc-prov-name">{p.id}</span>
                        <span className="acc-prov-type">{p.configured ? "configured" : "not configured"}</span>
                      </div>
                      <span className={`acc-prov-health acc-prov-health--${p.health?.ok ? "ok" : "down"}`}>
                        {p.health?.ok ? "healthy" : (p.lastFailure?.reason || "unavailable")}
                      </span>
                      <span className="acc-prov-toks">{fmt(p.callCount)} calls this session</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {section === "routing" && (
              <div className="acc-routing">
                <div className="acc-example-banner">
                  Example configuration — not measured from your usage. There is no automatic cost-based
                  router in this build; requests use the model you select (or the real provider fallback
                  chain on failure, shown in AI Status above). This table illustrates a policy you could
                  configure, not something currently running.
                </div>
                <div className="acc-routing-list">
                  {ROUTING_RULES.map((r, i) => (
                    <div key={r.id} className="acc-routing-row">
                      <span className="acc-routing-num">{i + 1}</span>
                      <div className="acc-routing-cond">
                        <span className="acc-routing-cond-label">IF</span>
                        <span className="acc-routing-cond-val">{r.condition}</span>
                      </div>
                      <span className="acc-routing-arrow">→</span>
                      <div className="acc-routing-target">
                        <span className="acc-routing-target-label">ROUTE TO</span>
                        <span className="acc-routing-target-val" style={{ color: "var(--accent2)" }}>{r.route}</span>
                      </div>
                      <span className="acc-routing-reason">{r.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {section === "budget" && (
              <div className="acc-budget">
                <div className="acc-example-banner">
                  Example configuration — not measured from your usage. There is no budget-threshold or
                  alerting engine in this build; no alert has ever fired. Real spend is shown above in
                  "Total cost (all-time, measured)".
                </div>
                <div className="acc-budget-note">
                  Configuring real budget thresholds and Slack/email alerts on top of the usage ledger
                  above would require new backend logic and is out of scope for this audit — this section
                  exists to show what such a policy could look like once built.
                </div>
              </div>
            )}

          </div>
        </>
      )}
    </div>
  );
}
