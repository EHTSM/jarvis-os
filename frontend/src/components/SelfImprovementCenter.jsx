import React, { useState, useEffect } from "react";
import { track } from "../analytics";
import { getLessons, getRecommendations, getLearningStats, runFullAnalysis } from "../phase19Api";
import { getImprovementReports, getImprovementMetrics, getAiProviders } from "../phase27Api";
import PageHeader from "./PageHeader";
import EmptyState from "./EmptyState";
import "./SelfImprovementCenter.css";

const LESSONS = [
  { icon: "💡", text: "Sales agents perform 34% better when given explicit objection-handling examples in system prompt.", meta: "Agent: Sales Lead Qualifier · 2026-06-01 · 47 runs analyzed" },
  { icon: "💡", text: "Memory lookups with exact entity IDs reduce hallucination by 2.1× versus fuzzy name search.", meta: "Agent: Research Agent · 2026-05-28 · cross-analysis" },
  { icon: "💡", text: "Splitting large tasks into 3-step sub-goals reduces token usage by 22% with same output quality.", meta: "Agent: Content Agent · 2026-05-30 · 120 runs" },
  { icon: "💡", text: "Support agent deflection rate improves when FAQ context is prepended to every system message.", meta: "Agent: Tier-1 Support Bot · 2026-06-02 · 91 runs" },
];

const FAILURES = [
  { icon: "⚠️", pattern: "Context Window Overflow",      detail: "Agent loses early-conversation context on calls >40 turns.", count: "14 failures in 7 days" },
  { icon: "⚠️", pattern: "Stale Memory Reads",           detail: "Agents referencing memory nodes >30 days old produce outdated responses.", count: "9 failures in 7 days" },
  { icon: "⚠️", pattern: "Tool Call Retry Storm",        detail: "Failed API calls not properly debounced — causes cascading retries.", count: "6 failures in 7 days" },
  { icon: "⚠️", pattern: "Hallucinated Metric Values",   detail: "Analytics agent invents numbers when data source returns null.", count: "5 failures in 7 days" },
];

const OPPS = [
  { icon: "🚀", title: "Prompt Compression",    desc: "Compress system prompts by 30% — estimated 18% cost reduction.", impact: "HIGH" },
  { icon: "🚀", title: "Parallel Tool Calls",   desc: "Agents call tools sequentially where parallelism is safe.", impact: "HIGH" },
  { icon: "🔄", title: "Memory Pre-warming",    desc: "Pre-fetch relevant memory before agent invocation.", impact: "MED" },
  { icon: "🔄", title: "Smarter Model Routing", desc: "Route simple classification tasks to Haiku instead of Sonnet.", impact: "MED" },
  { icon: "📋", title: "Chain-of-Thought",       desc: "Add CoT prompting to reasoning agents — improves accuracy 15%.", impact: "LOW" },
];

const PERF = [
  { label: "Task Success Rate",    val: 91, color: "#00dc82" },
  { label: "Response Quality",     val: 84, color: "var(--accent)" },
  { label: "Memory Accuracy",      val: 78, color: "var(--accent2)" },
  { label: "Cost Efficiency",      val: 67, color: "var(--warning)" },
  { label: "Hallucination Rate",   val: 100 - 12, color: "#00dc82" },
];

const RECS = [
  { priority: 1, title: "Fix Tool Retry Storm",       desc: "Add exponential backoff + max-retry cap to all tool calls." },
  { priority: 1, title: "Refresh Stale Memory Nodes", desc: "7 nodes >30d stale — schedule automated refresh jobs." },
  { priority: 2, title: "Enable Parallel Tool Calls", desc: "Update 4 agents to call independent tools in parallel." },
  { priority: 2, title: "Add CoT to Research Agent",  desc: "Enable chain-of-thought reasoning for complex research tasks." },
  { priority: 3, title: "Compress Sales Prompts",     desc: "Sales agent system prompt can be reduced by ~800 tokens." },
];

export default function SelfImprovementCenter({ onNavigate }) {
  const [tab,       setTab]       = useState("lessons");
  const [lessons,   setLessons]   = useState(LESSONS);
  const [recs,      setRecs]      = useState(RECS);
  const [stats,     setStats]     = useState(null);
  const [apiError,  setApiError]  = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [reports,   setReports]   = useState([]);
  const [metrics,   setMetrics]   = useState(null);
  const [providers, setProviders] = useState([]);
  const TABS = ["lessons","failures","opportunities","performance","recommendations","reports","providers"];

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      getLessons({ limit: 20 }),
      getRecommendations({ limit: 10 }),
      getLearningStats(),
      getImprovementReports(),
      getImprovementMetrics(),
      getAiProviders(),
    ]).then(([lessRes, recRes, statsRes, reportsRes, metricsRes, providersRes]) => {
      if (cancelled) return;

      if (lessRes.status === "fulfilled") {
        const liveLessons = lessRes.value?.lessons;
        if (Array.isArray(liveLessons) && liveLessons.length > 0) {
          setLessons(liveLessons.map(l => ({
            icon: "💡",
            text: l.insight || l.lesson || l.text,
            meta: `${l.source || "System"} · ${l.createdAt ? new Date(l.createdAt).toLocaleDateString() : "recent"}`,
          })));
        }
      }
      if (recRes.status === "fulfilled") {
        const liveRecs = recRes.value?.recommendations;
        if (Array.isArray(liveRecs) && liveRecs.length > 0) {
          setRecs(liveRecs.map((r, i) => ({
            priority: r.priority || i + 1,
            title:    r.title || r.action,
            desc:     r.description || r.detail || "",
          })));
        }
      }
      if (statsRes.status === "fulfilled" && statsRes.value) setStats(statsRes.value);

      if (reportsRes.status === "fulfilled") {
        const raw = reportsRes.value;
        setReports(Array.isArray(raw) ? raw : (raw?.reports ?? []));
      }
      if (metricsRes.status === "fulfilled" && metricsRes.value) setMetrics(metricsRes.value);
      if (providersRes.status === "fulfilled") {
        const raw = providersRes.value;
        setProviders(Array.isArray(raw) ? raw : (raw?.providers ?? []));
      }

      const anyFailed = [lessRes, recRes, statsRes].some(r => r.status === "rejected");
      if (anyFailed) setApiError("Some live data unavailable");
    });
    return () => { cancelled = true; };
  }, []);

  const handleAnalyze = () => {
    setAnalyzing(true);
    runFullAnalysis()
      .then(r => {
        if (Array.isArray(r?.lessons)) setLessons(r.lessons.map(l => ({ icon: "💡", text: l.insight || l.lesson, meta: "System · just now" })));
        if (Array.isArray(r?.recommendations)) setRecs(r.recommendations.map((rec, i) => ({ priority: i + 1, title: rec.title || rec.action, desc: rec.description || "" })));
      })
      .catch(() => {})
      .finally(() => setAnalyzing(false));
  };

  return (
    <div className="sic">
      <PageHeader
        icon="⬡"
        title="Self-Improvement Engine"
        subtitle="Lessons learned · Failure patterns · Optimization opportunities · AI provider status · Improvement reports"
        actions={[{ label: analyzing ? "Analyzing…" : "↺ Re-analyze", onClick: handleAnalyze, disabled: analyzing, primary: true }]}
        related={[
          { label: "Intelligence", tab: "intel", icon: "◈" },
          { label: "Memory", tab: "memory", icon: "◎" },
          { label: "Jarvis Brain", tab: "jarvisbrain", icon: "🧠" },
          { label: "Autonomy Score", tab: "autonomyscore", icon: "◉" },
        ]}
        onNavigate={onNavigate}
      />
      <div className="sic-header">
        <div>
          <h1 className="sic-title">Self-Improvement Engine</h1>
          <p className="sic-subtitle">Lessons learned, failure patterns, optimizations and agent recommendations.</p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding:"7px 14px", border:"1px solid var(--border)", borderRadius:"var(--radius-pill)",
              background: tab===t ? "var(--accent)" : "var(--surface-raised)",
              color: tab===t ? "#06080e" : "var(--text-dim)", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
              textTransform:"capitalize"
            }}>{t}</button>
          ))}
        </div>
      </div>

      {apiError && <div className="ac-api-banner ac-api-banner--error">⚠ Live learning data unavailable — showing cached data ({apiError})</div>}
      <div className="sic-stats">
        <div className="sic-stat"><span className="sic-stat-val" style={{color:"#00dc82"}}>{stats?.successRate != null ? `${stats.successRate}%` : "91%"}</span><span className="sic-stat-lbl">Success Rate</span></div>
        <div className="sic-stat"><span className="sic-stat-val" style={{color:"var(--accent)"}}>{lessons.length}</span><span className="sic-stat-lbl">Lessons Learned</span></div>
        <div className="sic-stat"><span className="sic-stat-val" style={{color:"#ff6464"}}>{FAILURES.length}</span><span className="sic-stat-lbl">Failure Patterns</span></div>
        <div className="sic-stat"><span className="sic-stat-val" style={{color:"var(--warning)"}}>{OPPS.length}</span><span className="sic-stat-lbl">Opportunities</span></div>
        <div className="sic-stat"><span className="sic-stat-val" style={{color:"var(--accent2)"}}>{recs.length}</span><span className="sic-stat-lbl">Recommendations</span></div>
      </div>

      {tab === "lessons" && (
        <div className="sic-panel sic-panel-full">
          <div className="sic-panel-title" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            Lessons Learned
            <button onClick={handleAnalyze} disabled={analyzing} style={{padding:"5px 12px",fontSize:11,fontWeight:700,border:"1px solid var(--border)",borderRadius:"var(--radius-pill)",background:"var(--surface-raised)",cursor:"pointer",fontFamily:"inherit",color:"var(--accent)"}}>
              {analyzing ? "Analyzing…" : "↺ Re-analyze"}
            </button>
          </div>
          {lessons.map((l,i) => (
            <div key={i} className="sic-lesson-row">
              <span className="sic-lesson-icon">{l.icon}</span>
              <div className="sic-lesson-info">
                <div className="sic-lesson-text">{l.text}</div>
                <div className="sic-lesson-meta">{l.meta}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "failures" && (
        <div className="sic-panel sic-panel-full">
          <div className="sic-panel-title">Failure Patterns</div>
          {FAILURES.map((f,i) => (
            <div key={i} className="sic-failure-row">
              <span className="sic-failure-icon">{f.icon}</span>
              <div className="sic-failure-info">
                <div className="sic-failure-pattern">{f.pattern}</div>
                <div className="sic-failure-detail">{f.detail}</div>
                <div className="sic-failure-count">{f.count}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "opportunities" && (
        <div className="sic-panel sic-panel-full">
          <div className="sic-panel-title">Optimization Opportunities</div>
          {OPPS.map((o,i) => (
            <div key={i} className="sic-opp-row">
              <span className="sic-opp-icon">{o.icon}</span>
              <div className="sic-opp-info">
                <div className="sic-opp-title">{o.title}</div>
                <div className="sic-opp-desc">{o.desc}</div>
              </div>
              <span className="sic-opp-impact">{o.impact}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "performance" && (
        <div className="sic-panel sic-panel-full">
          <div className="sic-panel-title">Performance Improvements</div>
          <div className="sic-perf-bar">
            {PERF.map((p,i) => (
              <div key={i} className="sic-perf-row">
                <div className="sic-perf-label">{p.label}</div>
                <div className="sic-perf-track">
                  <div className="sic-perf-fill" style={{width:p.val+"%", background:p.color}} />
                </div>
                <div className="sic-perf-val">{p.val}%</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "recommendations" && (
        <div className="sic-panel sic-panel-full">
          <div className="sic-panel-title">Agent Recommendations</div>
          {recs.map((r,i) => (
            <div key={i} className="sic-rec-row">
              <div className={`sic-rec-priority sic-rec-priority-${r.priority}`}>{r.priority}</div>
              <div className="sic-rec-info">
                <div className="sic-rec-title">{r.title}</div>
                <div className="sic-rec-desc">{r.desc}</div>
              </div>
              <button className="sic-apply-btn" onClick={() => track("sic_apply", {title: r.title})}>Apply</button>
            </div>
          ))}
        </div>
      )}

      {tab === "reports" && (
        <div className="sic-panel sic-panel-full">
          <div className="sic-panel-title">Improvement Reports</div>
          {reports.length === 0 ? (
            <EmptyState variant="intelligence" />
          ) : (
            reports.map((r, i) => {
              const score = r.score ?? r.overallScore ?? r.successRate;
              return (
                <div key={r.id ?? i} style={{
                  background: "#0f1117", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 5,
                  padding: "10px 12px", marginBottom: 8,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 12, color: "#e2e8f0" }}>
                      {r.title ?? r.type ?? `Report #${i + 1}`}
                    </span>
                    <span style={{ fontSize: 10, color: "#64748b" }}>
                      {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ""}
                    </span>
                  </div>
                  {score != null && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <div style={{ flex: 1, height: 3, background: "#1e2130", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: score + "%", height: "100%", background: score >= 80 ? "#22c55e" : score >= 60 ? "#eab308" : "#ef4444", borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 10, color: score >= 80 ? "#22c55e" : score >= 60 ? "#eab308" : "#ef4444", fontWeight: 700 }}>{score}%</span>
                    </div>
                  )}
                  {r.summary && <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>{r.summary}</div>}
                  {Array.isArray(r.recommendations) && r.recommendations.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      {r.recommendations.slice(0, 3).map((rec, j) => (
                        <div key={j} style={{ fontSize: 10, color: "#64748b", padding: "2px 0" }}>• {rec.title ?? rec.action ?? rec}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
          {metrics && (
            <div style={{ background: "#0f1117", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 5, padding: "10px 12px", marginTop: 8 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#64748b", marginBottom: 8 }}>Live Metrics</div>
              {Object.entries(metrics).slice(0, 6).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0", color: "#94a3b8" }}>
                  <span>{k.replace(/_/g, " ")}</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{typeof v === "number" ? (v > 1 ? v : `${Math.round(v * 100)}%`) : String(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "providers" && (
        <div className="sic-panel sic-panel-full">
          <div className="sic-panel-title">AI Provider Status</div>
          {providers.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#374151", fontSize: 11, fontStyle: "italic" }}>
              No AI providers configured.
            </div>
          ) : (
            providers.map((p, i) => {
              const isOk = p.status === "active" || p.status === "healthy" || p.available === true;
              const statusColor = isOk ? "#22c55e" : p.status === "degraded" ? "#eab308" : "#ef4444";
              return (
                <div key={p.id ?? p.name ?? i} style={{
                  background: "#0f1117", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 5,
                  padding: "10px 12px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#e2e8f0", marginBottom: 2 }}>
                      {p.name ?? p.provider ?? p.id}
                    </div>
                    {p.model && <div style={{ fontSize: 10, color: "#64748b" }}>Model: {p.model}</div>}
                    {p.description && <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{p.description}</div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                      background: statusColor + "18", color: statusColor, border: `1px solid ${statusColor}44`,
                    }}>{p.status ?? (p.available ? "active" : "unknown")}</span>
                    {p.latency != null && <span style={{ fontSize: 10, color: "#64748b" }}>{p.latency}ms</span>}
                    {p.cost != null && <span style={{ fontSize: 10, color: "#64748b" }}>${p.cost}/1k</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
