import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { track } from "../analytics";
import { getReadinessReport } from "../phase21Api";
import { getOpsData } from "../telemetryApi";
import { listCoordSessions } from "../phase19Api";
import "./OperationsCenter.css";

// ── Illustrative agent roster ───────────────────────────────────────────
// No backend exposes per-agent throughput/duration/error-rate metrics for
// this named roster (verified: agentExecutionEngine.cjs has the roster but
// no metrics fields; toolExecutionLayer/taskQueue have no per-agent or
// hourly breakdown). Kept as clearly-labeled illustrative data rather than
// fabricating a mapping onto unrelated real metrics.
const AGENT_THROUGHPUT = [
  { agent: "Support Agent",   color: "#52d68a",          tasksToday: 31, avgDuration: "8s",  successRate: "98.8%", errorRate: "1.2%", queueDepth: 2  },
  { agent: "Analytics Agent", color: "#38bdf8",          tasksToday: 18, avgDuration: "22s", successRate: "99.7%", errorRate: "0.3%", queueDepth: 0  },
  { agent: "SEO Agent",       color: "var(--accent2)",   tasksToday: 14, avgDuration: "45s", successRate: "100%",  errorRate: "0.0%", queueDepth: 3  },
  { agent: "Marketing Agent", color: "var(--warning)",   tasksToday: 8,  avgDuration: "1m12s",successRate:"99.8%", errorRate: "0.2%", queueDepth: 0  },
  { agent: "Sales Agent",     color: "#da552f",          tasksToday: 5,  avgDuration: "2m4s", successRate:"99.5%", errorRate: "0.5%", queueDepth: 1  },
  { agent: "Dev Agent",       color: "#e6edf3",          tasksToday: 7,  avgDuration: "4m30s",successRate:"97.9%", errorRate: "2.1%", queueDepth: 2  },
  { agent: "Content Agent",   color: "var(--accent)",    tasksToday: 3,  avgDuration: "8m00s",successRate:"100%",  errorRate: "0.0%", queueDepth: 1  },
  { agent: "Research Agent",  color: "#a78bfa",          tasksToday: 2,  avgDuration: "12m",  successRate:"100%",  errorRate: "0.0%", queueDepth: 0  },
  { agent: "DevOps Agent",    color: "#fc6d26",          tasksToday: 5,  avgDuration: "1m22s",successRate:"99.5%", errorRate: "0.5%", queueDepth: 0  },
];

// Illustrative — no backend buckets task volume by hour of day (verified:
// errorAggregator.cjs buckets errors by hour, not tasks; taskQueue.cjs
// groups by task type, not time).
const HOURLY_TASKS = [
  { h: "08", tasks: 4 }, { h: "09", tasks: 18 }, { h: "10", tasks: 31 },
  { h: "11", tasks: 24 }, { h: "12", tasks: 12 }, { h: "13", tasks: 8 },
  { h: "14", tasks: 22 }, { h: "15", tasks: 0 },
];

// Illustrative per-agent queue breakdown — real queue depth (aggregate) comes
// from getOpsData().queue below; no backend splits queue depth per named agent.
const QUEUE_STATUS = [
  { name: "Support queue",   depth: 2,  max: 20, agent: "Support Agent",   color: "#52d68a",        urgent: 1 },
  { name: "SEO queue",       depth: 3,  max: 10, agent: "SEO Agent",       color: "var(--accent2)", urgent: 0 },
  { name: "Dev queue",       depth: 2,  max: 5,  agent: "Dev Agent",       color: "#e6edf3",        urgent: 1 },
  { name: "Content queue",   depth: 1,  max: 5,  agent: "Content Agent",   color: "var(--accent)",  urgent: 0 },
  { name: "Sales queue",     depth: 1,  max: 10, agent: "Sales Agent",     color: "#da552f",        urgent: 0 },
];

const EVENT_COLORS = { handoff: "var(--accent2)", escalation: "var(--danger)", trigger: "var(--warning)", dependency: "#a78bfa" };

// Real /p19/coord/sessions data uses `pattern` + `agents[]`, not the
// from/to/type/detail shape this view renders — map honestly, no fabrication.
function sessionToCoordEvent(s) {
  const agents = s.agents || [];
  const typeMap = { handoff: "handoff", delegation: "dependency", collaboration: "trigger" };
  return {
    id: s.sessionId,
    ts: s.createdAt ? new Date(s.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—",
    type: typeMap[s.pattern] || "handoff",
    from: agents[0] || "unknown",
    to: agents[1] || agents[0] || "unknown",
    detail: (s.output || s.error || `${s.pattern} across ${agents.length} agent(s)`).slice(0, 120),
    status: s.status === "completed" ? "success" : s.status === "failed" ? "escalated" : s.status,
  };
}

function MiniBarChart({ data, colorFn }) {
  const max = Math.max(...data.map(d => d.tasks), 1);
  return (
    <div className="oc-mini-bar-chart">
      {data.map(d => (
        <div key={d.h} className="oc-mini-bar-col">
          <div className="oc-mini-bar-track">
            <div className="oc-mini-bar-fill" style={{ height: `${Math.round((d.tasks / max) * 100)}%`, background: "var(--accent2)" }} />
          </div>
          <span className="oc-mini-bar-label">{d.h}</span>
        </div>
      ))}
    </div>
  );
}

export default function OperationsCenter({ onNavigate }) {
  const { user } = useAuth();
  const [section,    setSection]    = useState("overview");
  const [readiness,  setReadiness]  = useState(null);
  const [apiError,   setApiError]   = useState(null);
  const [opsQueue,   setOpsQueue]   = useState(null);
  const [coordEvents,setCoordEvents]= useState([]);

  React.useEffect(() => { track.event("operations_center_viewed"); }, []);

  useEffect(() => {
    let cancelled = false;
    getReadinessReport()
      .then(res => { if (!cancelled && res) setReadiness(res?.report || res); })
      .catch(err => { if (!cancelled) setApiError(err.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Workflow Coverage Completion finding: /ops is operatorOnly
    // server-side; any non-operator founder opening Operations fired a
    // 403 fetching it.
    Promise.all([
      user?.role === "operator" ? getOpsData() : Promise.resolve(null),
      listCoordSessions({ limit: 20 }),
    ])
      .then(([ops, coordRes]) => {
        if (cancelled) return;
        if (ops?.queue) setOpsQueue(ops.queue);
        const sessions = coordRes?.sessions;
        if (Array.isArray(sessions)) setCoordEvents(sessions.map(sessionToCoordEvent));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  const COORD_EVENTS = coordEvents;

  const totalTasks  = AGENT_THROUGHPUT.reduce((s,a) => s + a.tasksToday, 0);
  // Real aggregate queue depth when available, falling back to the illustrative per-agent sum.
  const totalQueue  = opsQueue ? (opsQueue.pending || 0) + (opsQueue.running || 0) : QUEUE_STATUS.reduce((s,q) => s + q.depth, 0);
  const avgSuccess  = (AGENT_THROUGHPUT.reduce((s,a) => s + parseFloat(a.successRate), 0) / AGENT_THROUGHPUT.length).toFixed(1);
  const avgError    = (AGENT_THROUGHPUT.reduce((s,a) => s + parseFloat(a.errorRate), 0) / AGENT_THROUGHPUT.length).toFixed(2);
  const urgentCount = QUEUE_STATUS.reduce((s,q) => s + q.urgent, 0);

  return (
    <div className="operations-center page-enter">
      {apiError && <div className="ac-api-banner ac-api-banner--error">⚠ Live readiness data unavailable — showing cached data ({apiError})</div>}
      {readiness?.score != null && (
        <div style={{ padding: "8px 16px", background: "rgba(0,220,130,0.08)", border: "1px solid rgba(0,220,130,0.2)", borderRadius: "var(--radius)", marginBottom: 12, fontSize: 13, color: "var(--success)" }}>
          Production Readiness Score: <strong>{readiness.score}%</strong>{readiness.status ? ` — ${readiness.status}` : ""}
        </div>
      )}
      <div className="oc-header">
        <div>
          <h1 className="oc-title">Operations Center</h1>
          <p className="oc-subtitle">Agent throughput, task queue health, error rates, and coordination events — the full AI ops layer.</p>
        </div>
      </div>

      {/* Top KPIs */}
      <div className="oc-kpi-strip">
        {[
          { label: "Tasks today",      value: totalTasks, color: "var(--accent2)"                                        },
          { label: "Avg success rate", value: `${avgSuccess}%`, color: parseFloat(avgSuccess) >= 99 ? "var(--success)" : "var(--warning)" },
          { label: "Avg error rate",   value: `${avgError}%`,   color: parseFloat(avgError) > 1 ? "var(--danger)" : "var(--success)"    },
          { label: "Queue depth",      value: totalQueue, color: totalQueue > 5 ? "var(--warning)" : "var(--success)"   },
          { label: "Urgent items",     value: urgentCount,color: urgentCount > 0 ? "var(--danger)" : "var(--success)"  },
          { label: "Coord events",     value: COORD_EVENTS.length, color: "var(--accent)"                               },
        ].map(k => (
          <div key={k.label} className="oc-kpi-tile">
            <span className="oc-kpi-val" style={{ color: k.color }}>{k.value}</span>
            <span className="oc-kpi-label">{k.label}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="oc-tabs">
        {[
          { id: "overview",     label: "Overview"         },
          { id: "throughput",   label: "Agent Throughput" },
          { id: "queue",        label: "Queue Health"     },
          { id: "errors",       label: "Error Rates"      },
          { id: "coordination", label: "Coordination"     },
        ].map(t => (
          <button key={t.id} className={`oc-tab${section===t.id?" oc-tab--active":""}`} onClick={()=>setSection(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="oc-content" key={section}>

        {/* Overview */}
        {section === "overview" && (
          <div className="oc-overview">
            <div className="oc-overview-top">
              <div className="oc-overview-card">
                <p className="oc-ov-label">Task volume today (hourly) <span style={{fontSize:10,fontWeight:400,color:"var(--text-faint)"}}>(illustrative — no hourly breakdown backend)</span></p>
                <MiniBarChart data={HOURLY_TASKS} />
                <p className="oc-ov-sub">Peak: 10:00 — 31 tasks. Total: {totalTasks} tasks.</p>
              </div>
              <div className="oc-overview-card">
                <p className="oc-ov-label">Queue health {opsQueue && <span style={{fontSize:10,fontWeight:400,color:"var(--success)"}}>· live total: {totalQueue}</span>}</p>
                <div className="oc-queue-overview">
                  {QUEUE_STATUS.map(q => (
                    <div key={q.name} className="oc-qo-row">
                      <span className="oc-qo-agent" style={{ color: q.color }}>{q.agent}</span>
                      <div className="oc-qo-bar-track">
                        <div className="oc-qo-bar-fill" style={{ width: `${Math.round((q.depth/q.max)*100)}%`, background: q.color }} />
                      </div>
                      <span className="oc-qo-depth" style={{ color: q.depth >= q.max * 0.8 ? "var(--danger)" : q.color }}>{q.depth}/{q.max}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="oc-overview-card oc-overview-card--wide">
              <p className="oc-ov-label">Recent coordination events</p>
              <div className="oc-coord-mini">
                {COORD_EVENTS.length === 0 && (
                  <p className="oc-ov-sub">No coordination sessions recorded yet.</p>
                )}
                {COORD_EVENTS.slice(0,4).map(ev => (
                  <div key={ev.id} className="oc-coord-mini-row">
                    <span className="oc-coord-type-dot" style={{ background: EVENT_COLORS[ev.type] }} />
                    <span className="oc-coord-from">{ev.from}</span>
                    <span className="oc-coord-arrow">→</span>
                    <span className="oc-coord-to">{ev.to}</span>
                    <span className="oc-coord-detail">{ev.detail.slice(0,60)}{ev.detail.length>60?"…":""}</span>
                    <span className="oc-coord-ts">{ev.ts}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Agent Throughput */}
        {section === "throughput" && (
          <div className="oc-throughput-section">
            <div className="ac-api-banner ac-api-banner--error">⚠ No per-agent throughput backend exists yet — this breakdown is illustrative, not live.</div>
            <div className="oc-throughput-list">
              {AGENT_THROUGHPUT.sort((a,b)=>b.tasksToday-a.tasksToday).map(a => {
                const maxTasks = Math.max(...AGENT_THROUGHPUT.map(x=>x.tasksToday));
                return (
                  <div key={a.agent} className="oc-tp-row">
                    <div className="oc-tp-agent-col">
                      <span className="oc-tp-name" style={{ color: a.color }}>{a.agent}</span>
                    </div>
                    <div className="oc-tp-bar-col">
                      <div className="oc-tp-bar-track">
                        <div className="oc-tp-bar-fill" style={{ width: `${Math.round((a.tasksToday/maxTasks)*100)}%`, background: a.color }} />
                      </div>
                      <span className="oc-tp-task-count">{a.tasksToday} tasks</span>
                    </div>
                    <div className="oc-tp-metrics">
                      <span className="oc-tp-metric"><span className="oc-tp-mv">{a.avgDuration}</span> avg</span>
                      <span className="oc-tp-metric"><span className="oc-tp-mv" style={{ color: parseFloat(a.successRate)>=99?"var(--success)":"var(--warning)" }}>{a.successRate}</span> ok</span>
                      <span className="oc-tp-metric"><span className="oc-tp-mv" style={{ color: parseFloat(a.errorRate)>1?"var(--danger)":"var(--success)" }}>{a.errorRate}</span> err</span>
                      <span className="oc-tp-metric"><span className="oc-tp-mv">{a.queueDepth}</span> queued</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Queue Health */}
        {section === "queue" && (
          <div className="oc-queue-section">
            <div className="ac-api-banner ac-api-banner--error">⚠ No per-agent queue breakdown backend exists yet — per-queue rows below are illustrative{opsQueue ? `; live aggregate depth is ${totalQueue}` : ""}.</div>
            {QUEUE_STATUS.map(q => {
              const pct = Math.round((q.depth / q.max) * 100);
              const color = pct >= 80 ? "var(--danger)" : pct >= 50 ? "var(--warning)" : q.color;
              return (
                <div key={q.name} className="oc-queue-card" style={{ borderColor: color + "33" }}>
                  <div className="oc-qc-header">
                    <span className="oc-qc-name">{q.name}</span>
                    {q.urgent > 0 && <span className="oc-qc-urgent">{q.urgent} urgent</span>}
                    <span className="oc-qc-depth" style={{ color }}>{q.depth}/{q.max}</span>
                  </div>
                  <div className="oc-qc-bar-track">
                    <div className="oc-qc-bar-fill" style={{ width: `${pct}%`, background: color }} />
                  </div>
                  <div className="oc-qc-footer">
                    <span className="oc-qc-agent" style={{ color: q.color }}>{q.agent}</span>
                    <span className="oc-qc-pct" style={{ color }}>{pct}% capacity</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Error rates */}
        {section === "errors" && (
          <div className="oc-errors-section">
            <div className="ac-api-banner ac-api-banner--error">⚠ No per-agent error-rate backend exists yet — this breakdown is illustrative, not live.</div>
            <div className="oc-errors-list">
              {AGENT_THROUGHPUT.sort((a,b)=>parseFloat(b.errorRate)-parseFloat(a.errorRate)).map(a => {
                const err = parseFloat(a.errorRate);
                const color = err > 1.5 ? "var(--danger)" : err > 0.5 ? "var(--warning)" : "var(--success)";
                return (
                  <div key={a.agent} className="oc-err-row">
                    <span className="oc-err-agent" style={{ color: a.color }}>{a.agent}</span>
                    <div className="oc-err-bar-track">
                      <div className="oc-err-bar-fill" style={{ width: `${Math.min(err * 20, 100)}%`, background: color }} />
                    </div>
                    <span className="oc-err-rate" style={{ color }}>{a.errorRate}</span>
                    <span className="oc-err-total">{a.tasksToday} tasks today</span>
                    <span className="oc-err-status" style={{ color }}>
                      {err === 0 ? "Clean" : err <= 0.5 ? "Acceptable" : err <= 1.5 ? "Watch" : "Investigate"}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="oc-errors-summary">
              <p className="oc-err-sum-label">System average: <strong style={{ color: parseFloat(avgError)>1?"var(--danger)":"var(--success)" }}>{avgError}% error rate</strong></p>
              <p className="oc-err-sum-note">Dev Agent at 2.1% — code generation tasks have higher inherent failure rate. All others within acceptable thresholds.</p>
            </div>
          </div>
        )}

        {/* Coordination events */}
        {section === "coordination" && (
          <div className="oc-coord-section">
            <div className="oc-coord-legend">
              {Object.entries(EVENT_COLORS).map(([type,color]) => (
                <span key={type} className="oc-coord-legend-item">
                  <span className="oc-coord-type-dot" style={{ background: color }} />{type.replace("_"," ")}
                </span>
              ))}
            </div>
            <div className="oc-coord-list">
              {COORD_EVENTS.length === 0 && (
                <div style={{padding:16,color:"var(--text-faint)",fontSize:13}}>No coordination sessions recorded yet.</div>
              )}
              {COORD_EVENTS.map(ev => (
                <div key={ev.id} className="oc-coord-row">
                  <span className="oc-coord-ts-col">{ev.ts}</span>
                  <span className="oc-coord-type-dot" style={{ background: EVENT_COLORS[ev.type] }} />
                  <div className="oc-coord-info">
                    <div className="oc-coord-agents-row">
                      <span className="oc-coord-from-label">{ev.from}</span>
                      <span className="oc-coord-arrow-icon">→</span>
                      <span className="oc-coord-to-label">{ev.to}</span>
                      <span className="oc-coord-ev-type" style={{ color: EVENT_COLORS[ev.type] }}>{ev.type.replace("_"," ")}</span>
                    </div>
                    <p className="oc-coord-detail">{ev.detail}</p>
                  </div>
                  <span className={`oc-coord-status oc-coord-status--${ev.status}`}>{ev.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
