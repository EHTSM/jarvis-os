import React, { useState, useEffect } from "react";
import { track } from "../analytics";
import { getLessons, getRecommendations, getLearningStats, runFullAnalysis } from "../phase19Api";
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
  const TABS = ["lessons","failures","opportunities","performance","recommendations"];

  useEffect(() => {
    let cancelled = false;
    Promise.all([getLessons({ limit: 20 }), getRecommendations({ limit: 10 }), getLearningStats()])
      .then(([lessRes, recRes, statsRes]) => {
        if (cancelled) return;
        const liveLessons = lessRes?.lessons;
        if (Array.isArray(liveLessons) && liveLessons.length > 0) {
          setLessons(liveLessons.map(l => ({
            icon: "💡",
            text: l.insight || l.lesson || l.text,
            meta: `${l.source || "System"} · ${l.createdAt ? new Date(l.createdAt).toLocaleDateString() : "recent"}`,
          })));
        }
        const liveRecs = recRes?.recommendations;
        if (Array.isArray(liveRecs) && liveRecs.length > 0) {
          setRecs(liveRecs.map((r, i) => ({
            priority: r.priority || i + 1,
            title:    r.title || r.action,
            desc:     r.description || r.detail || "",
          })));
        }
        if (statsRes) setStats(statsRes);
      })
      .catch(err => { if (!cancelled) setApiError(err.message); });
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
    </div>
  );
}
