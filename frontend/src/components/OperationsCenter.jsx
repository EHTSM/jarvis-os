import React, { useState, useEffect, useRef } from "react";
import { track } from "../analytics";
import "./OperationsCenter.css";

// ── Static seed metrics ───────────────────────────────────────────────
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

const HOURLY_TASKS = [
  { h: "08", tasks: 4 }, { h: "09", tasks: 18 }, { h: "10", tasks: 31 },
  { h: "11", tasks: 24 }, { h: "12", tasks: 12 }, { h: "13", tasks: 8 },
  { h: "14", tasks: 22 }, { h: "15", tasks: 0 },
];

const QUEUE_STATUS = [
  { name: "Support queue",   depth: 2,  max: 20, agent: "Support Agent",   color: "#52d68a",        urgent: 1 },
  { name: "SEO queue",       depth: 3,  max: 10, agent: "SEO Agent",       color: "var(--accent2)", urgent: 0 },
  { name: "Dev queue",       depth: 2,  max: 5,  agent: "Dev Agent",       color: "#e6edf3",        urgent: 1 },
  { name: "Content queue",   depth: 1,  max: 5,  agent: "Content Agent",   color: "var(--accent)",  urgent: 0 },
  { name: "Sales queue",     depth: 1,  max: 10, agent: "Sales Agent",     color: "#da552f",        urgent: 0 },
];

const COORD_EVENTS = [
  { id: "ce1", ts: "14:08", type: "handoff",     from: "Sales Agent",     to: "Support Agent",   detail: "Lead #4821 converted → onboarding handoff",              status: "success" },
  { id: "ce2", ts: "13:52", type: "escalation",  from: "Support Agent",   to: "human",            detail: "Ticket #1023 escalated — billing dispute",               status: "escalated"},
  { id: "ce3", ts: "13:44", type: "memory_write",from: "Analytics Agent", to: "shared_memory",    detail: "Weekly metrics snapshot written to company memory",      status: "success" },
  { id: "ce4", ts: "13:30", type: "handoff",     from: "SEO Agent",       to: "Content Agent",   detail: "Keyword brief for blog post handed off",                  status: "success" },
  { id: "ce5", ts: "12:20", type: "memory_read", from: "Marketing Agent", to: "shared_memory",    detail: "Read brand tone, pricing, and ICP from company memory",  status: "success" },
  { id: "ce6", ts: "11:55", type: "trigger",     from: "DevOps Agent",    to: "Dev Agent",        detail: "Deploy health check passed → unblocked PR review queue", status: "success" },
  { id: "ce7", ts: "11:14", type: "handoff",     from: "Research Agent",  to: "Content Agent",   detail: "Competitor analysis report handed off for blog post",     status: "success" },
  { id: "ce8", ts: "10:08", type: "escalation",  from: "Support Agent",   to: "Sales Agent",     detail: "Upsell signal detected — handed off to Sales Agent",      status: "success" },
];

const EVENT_COLORS = { handoff: "var(--accent2)", escalation: "var(--danger)", memory_write: "var(--warning)", memory_read: "var(--accent)", trigger: "#52d68a" };

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
  const [section, setSection] = useState("overview");

  React.useEffect(() => { track.event("operations_center_viewed"); }, []);

  const totalTasks  = AGENT_THROUGHPUT.reduce((s,a) => s + a.tasksToday, 0);
  const totalQueue  = QUEUE_STATUS.reduce((s,q) => s + q.depth, 0);
  const avgSuccess  = (AGENT_THROUGHPUT.reduce((s,a) => s + parseFloat(a.successRate), 0) / AGENT_THROUGHPUT.length).toFixed(1);
  const avgError    = (AGENT_THROUGHPUT.reduce((s,a) => s + parseFloat(a.errorRate), 0) / AGENT_THROUGHPUT.length).toFixed(2);
  const urgentCount = QUEUE_STATUS.reduce((s,q) => s + q.urgent, 0);

  return (
    <div className="operations-center page-enter">
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
                <p className="oc-ov-label">Task volume today (hourly)</p>
                <MiniBarChart data={HOURLY_TASKS} />
                <p className="oc-ov-sub">Peak: 10:00 — 31 tasks. Total: {totalTasks} tasks.</p>
              </div>
              <div className="oc-overview-card">
                <p className="oc-ov-label">Queue health</p>
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
