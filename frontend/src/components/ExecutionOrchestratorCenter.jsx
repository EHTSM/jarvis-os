import React, { useState, useCallback } from "react";
import { track } from "../analytics";
import "./ExecutionOrchestratorCenter.css";

const EXC_KEY = "ooplix_exec_chains";
function _load(k,fb){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(fb));}catch{return fb;}}
function _save(k,v){localStorage.setItem(k,JSON.stringify(v));}

// ── Agent colours ─────────────────────────────────────────────────────
const AGENT_COLORS = {
  "SEO Agent":"#4ecdc4","Marketing Agent":"#f0b429","Content Agent":"#7c6fff",
  "Support Agent":"#52d68a","Sales Agent":"#da552f","Dev Agent":"#e6edf3",
  "DevOps Agent":"#fc6d26","Research Agent":"#a78bfa","Analytics Agent":"#38bdf8",
};

// ── Execution chain seed ──────────────────────────────────────────────
const SEED_CHAINS = [
  {
    id: "ec1",
    goal: "Publish blog post about WhatsApp automation for freelancers",
    status: "in_progress", successRate: null, startedAt: "10:20",
    tasks: [
      { id: "ec1t1", title: "Research: top keywords for topic",        agent: "SEO Agent",      tool: "web_search",      status: "done",        result: "5 primary keywords. Search vol: 4,400/mo.",       retries: 0 },
      { id: "ec1t2", title: "Competitive content analysis",            agent: "Research Agent", tool: "read_url",        status: "done",        result: "10 competitor posts analysed. Content gaps found.", retries: 0 },
      { id: "ec1t3", title: "Write 1,200-word blog post draft",        agent: "Content Agent",  tool: "write_document",  status: "in_progress", result: null,                                               retries: 0 },
      { id: "ec1t4", title: "SEO-optimise draft (meta + headings)",    agent: "SEO Agent",      tool: "write_file",      status: "pending",     result: null,                                               retries: 0 },
      { id: "ec1t5", title: "Schedule LinkedIn + email distribution",  agent: "Marketing Agent",tool: "schedule_send",   status: "pending",     result: null,                                               retries: 0 },
    ],
  },
  {
    id: "ec2",
    goal: "Qualify all new sign-ups from the last 24 hours",
    status: "completed", successRate: 100, startedAt: "09:00",
    tasks: [
      { id: "ec2t1", title: "Fetch new sign-ups from CRM",             agent: "Sales Agent",    tool: "read_crm",        status: "done", result: "7 new sign-ups retrieved.",                               retries: 0 },
      { id: "ec2t2", title: "Score each lead (ICP fit 1–10)",          agent: "Analytics Agent",tool: "read_analytics",  status: "done", result: "3 hot (≥8), 2 warm (5–7), 2 cold (<5).",                 retries: 0 },
      { id: "ec2t3", title: "Send personalised outreach to hot leads", agent: "Sales Agent",    tool: "send_message",    status: "done", result: "3 DMs sent on WhatsApp. 1 reply received.",               retries: 0 },
      { id: "ec2t4", title: "Add warm leads to drip sequence",         agent: "Marketing Agent",tool: "schedule_send",   status: "done", result: "2 leads enrolled in day-3 follow-up sequence.",           retries: 0 },
      { id: "ec2t5", title: "Log all qualification results to CRM",    agent: "Sales Agent",    tool: "write_crm",       status: "done", result: "CRM updated. Pipeline value +₹12,498.",                  retries: 0 },
    ],
  },
  {
    id: "ec3",
    goal: "Resolve mobile API proxy degradation",
    status: "in_progress", successRate: null, startedAt: "14:00",
    tasks: [
      { id: "ec3t1", title: "Detect anomaly via health check",         agent: "DevOps Agent",   tool: "read_deployments",status: "done",        result: "Mobile proxy CPU 78%, 1/2 replicas down.",           retries: 0 },
      { id: "ec3t2", title: "Restart degraded pod",                    agent: "DevOps Agent",   tool: "trigger_rollback",status: "done",        result: "Pod restarted. Latency improving.",                  retries: 1 },
      { id: "ec3t3", title: "Monitor recovery (5 min window)",        agent: "DevOps Agent",   tool: "read_logs",       status: "in_progress", result: null,                                                retries: 0 },
      { id: "ec3t4", title: "Write incident report",                   agent: "DevOps Agent",   tool: "write_incident",  status: "pending",     result: null,                                               retries: 0 },
      { id: "ec3t5", title: "Alert Analytics Agent to log incident",   agent: "Analytics Agent",tool: "write_report",    status: "pending",     result: null,                                               retries: 0 },
    ],
  },
  {
    id: "ec4",
    goal: "Weekly SEO performance report",
    status: "completed", successRate: 100, startedAt: "09:00",
    tasks: [
      { id: "ec4t1", title: "Pull rank data for 12 tracked keywords",  agent: "SEO Agent",      tool: "read_analytics",  status: "done", result: "12 keywords tracked. 3 moved up, 1 dropped.",          retries: 0 },
      { id: "ec4t2", title: "Scrape top-3 competitor positions",       agent: "SEO Agent",      tool: "web_search",      status: "done", result: "Competitor gap identified: 'AI CRM India' keyword.",    retries: 0 },
      { id: "ec4t3", title: "Generate written report with insights",   agent: "Analytics Agent",tool: "write_report",    status: "done", result: "3-page report written. 4 action items identified.",    retries: 0 },
      { id: "ec4t4", title: "Post summary to Telegram ops channel",    agent: "DevOps Agent",   tool: "send_message",    status: "done", result: "Summary posted. No anomalies flagged.",                retries: 0 },
    ],
  },
  {
    id: "ec5",
    goal: "Handle inbound support ticket #1024 (WhatsApp QR not scanning)",
    status: "in_progress", successRate: null, startedAt: "13:50",
    tasks: [
      { id: "ec5t1", title: "Classify ticket: type + severity",        agent: "Support Agent",  tool: "read_knowledge",  status: "done",        result: "Type: setup issue. Severity: medium. Not a bug.",    retries: 0 },
      { id: "ec5t2", title: "Search KB for QR scan troubleshooting",   agent: "Support Agent",  tool: "read_knowledge",  status: "done",        result: "3 KB articles found. Best match: 'QR scan guide'.",  retries: 0 },
      { id: "ec5t3", title: "Draft personalised response",             agent: "Support Agent",  tool: "write_ticket",    status: "in_progress", result: null,                                               retries: 0 },
      { id: "ec5t4", title: "Send response via WhatsApp",              agent: "Support Agent",  tool: "send_message",    status: "pending",     result: null,                                               retries: 0 },
    ],
  },
];

const STEP_COLORS = { done: "var(--success)", in_progress: "var(--accent2)", pending: "rgba(255,255,255,0.15)", failed: "var(--danger)" };

function TaskNode({ task, isLast }) {
  const col = STEP_COLORS[task.status] || STEP_COLORS.pending;
  const agColor = AGENT_COLORS[task.agent] || "var(--text-faint)";
  return (
    <div className="eoc-task-node-wrap">
      <div className={`eoc-task-node eoc-task-node--${task.status}`}>
        <div className="eoc-tn-header">
          <div className="eoc-tn-status-dot" style={{ background: col }} />
          <span className="eoc-tn-title">{task.title}</span>
          {task.retries > 0 && <span className="eoc-tn-retries">↻{task.retries}</span>}
        </div>
        <div className="eoc-tn-meta">
          <span className="eoc-tn-agent" style={{ color: agColor }}>{task.agent}</span>
          <span className="eoc-tn-tool">{task.tool}</span>
        </div>
        {task.result && <p className="eoc-tn-result">{task.result}</p>}
      </div>
      {!isLast && <div className={`eoc-chain-arrow${task.status==="done"?" eoc-chain-arrow--done":""}`}>↓</div>}
    </div>
  );
}

function ChainCard({ chain, selected, onSelect }) {
  const done     = chain.tasks.filter(t => t.status === "done").length;
  const total    = chain.tasks.length;
  const pct      = Math.round((done / total) * 100);
  const stColor  = chain.status === "completed" ? "var(--success)" : chain.status === "in_progress" ? "var(--accent2)" : "var(--warning)";
  return (
    <button className={`eoc-chain-card${selected ? " eoc-chain-card--sel" : ""}`} onClick={() => onSelect(chain.id)}>
      <div className="eoc-cc-header">
        <span className="eoc-cc-status-dot" style={{ background: stColor }} />
        <span className="eoc-cc-goal">{chain.goal}</span>
      </div>
      <div className="eoc-cc-progress-row">
        <div className="eoc-cc-bar-track">
          <div className="eoc-cc-bar-fill" style={{ width: `${pct}%`, background: stColor }} />
        </div>
        <span className="eoc-cc-pct" style={{ color: stColor }}>{done}/{total}</span>
      </div>
      <div className="eoc-cc-footer">
        <span className="eoc-cc-time">{chain.startedAt}</span>
        <span className="eoc-cc-status" style={{ color: stColor }}>{chain.status.replace("_"," ")}</span>
        {chain.successRate !== null && (
          <span className="eoc-cc-sr" style={{ color: "var(--success)" }}>✓ {chain.successRate}%</span>
        )}
      </div>
    </button>
  );
}

export default function ExecutionOrchestratorCenter({ onNavigate }) {
  const [chains,   setChains]   = useState(() => _load(EXC_KEY, SEED_CHAINS));
  const [selected, setSelected] = useState("ec1");
  const [section,  setSection]  = useState("chains");
  const [toast,    setToast]    = useState(null);

  React.useEffect(() => { track.event("exec_orchestrator_viewed"); }, []);
  const showToast = m => { setToast(m); setTimeout(()=>setToast(null),2400); };

  const selChain = chains.find(c => c.id === selected);
  const completedChains = chains.filter(c => c.status === "completed");
  const totalTasks  = chains.reduce((s,c) => s + c.tasks.length, 0);
  const doneTasks   = chains.reduce((s,c) => s + c.tasks.filter(t=>t.status==="done").length, 0);
  const retryCount  = chains.reduce((s,c) => s + c.tasks.reduce((rs,t) => rs + t.retries, 0), 0);
  const overallSucc = completedChains.length ? Math.round(completedChains.reduce((s,c)=>s+(c.successRate||0),0)/completedChains.length) : 0;

  // Build retry paths for display
  const retryTasks = chains.flatMap(c => c.tasks.filter(t => t.retries > 0).map(t => ({ ...t, chainGoal: c.goal })));

  return (
    <div className="execution-orchestrator-center page-enter">
      {toast && <div className="eoc-toast">{toast}</div>}

      <div className="eoc-header">
        <div>
          <h1 className="eoc-title">Execution Orchestrator</h1>
          <p className="eoc-subtitle">Goal → Tasks → Agents → Tools → Results. Full execution chain visibility.</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="eoc-kpi-strip">
        {[
          { label: "Active chains",   value: chains.filter(c=>c.status==="in_progress").length, color: "var(--accent2)"                        },
          { label: "Completed",       value: completedChains.length,                            color: "var(--success)"                        },
          { label: "Tasks done",      value: `${doneTasks}/${totalTasks}`,                      color: "var(--accent2)"                        },
          { label: "Success rate",    value: `${overallSucc}%`,                                 color: overallSucc>=95?"var(--success)":"var(--warning)" },
          { label: "Retries",         value: retryCount,                                        color: retryCount>0?"var(--warning)":"var(--success)" },
          { label: "Total chains",    value: chains.length,                                     color: "var(--text)"                           },
        ].map(k => (
          <div key={k.label} className="eoc-kpi-tile">
            <span className="eoc-kpi-val" style={{ color: k.color }}>{k.value}</span>
            <span className="eoc-kpi-label">{k.label}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="eoc-tabs">
        {[
          { id: "chains",  label: "Execution Chains"   },
          { id: "retries", label: `Retry Paths${retryCount>0?` (${retryCount})`:""}`  },
        ].map(t => (
          <button key={t.id} className={`eoc-tab${section===t.id?" eoc-tab--active":""}`} onClick={()=>setSection(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="eoc-content" key={section}>

        {section === "chains" && (
          <div className="eoc-layout">
            {/* Chain list */}
            <div className="eoc-chain-list">
              {chains.map(c => (
                <ChainCard key={c.id} chain={c} selected={selected===c.id} onSelect={setSelected} />
              ))}
            </div>

            {/* Chain detail */}
            {selChain && (
              <div className="eoc-chain-detail">
                <div className="eoc-detail-header">
                  <div className="eoc-goal-label">
                    <span className="eoc-goal-icon">◎</span>
                    <span className="eoc-goal-text">Goal</span>
                  </div>
                  <div className="eoc-goal-card">
                    <p className="eoc-goal-title">{selChain.goal}</p>
                    <div className="eoc-goal-meta">
                      <span>Started: {selChain.startedAt}</span>
                      <span className="eoc-goal-status" style={{ color: selChain.status==="completed"?"var(--success)":"var(--accent2)" }}>
                        {selChain.status.replace("_"," ")}
                      </span>
                      {selChain.successRate !== null && (
                        <span style={{ color: "var(--success)" }}>✓ {selChain.successRate}%</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="eoc-pipeline-label">
                  <span className="eoc-pipeline-title">Execution pipeline</span>
                  <span className="eoc-pipeline-legend">
                    <span className="eoc-leg-item"><span className="eoc-leg-dot" style={{background:"var(--success)"}} />done</span>
                    <span className="eoc-leg-item"><span className="eoc-leg-dot" style={{background:"var(--accent2)"}} />active</span>
                    <span className="eoc-leg-item"><span className="eoc-leg-dot" style={{background:"rgba(255,255,255,0.15)"}} />pending</span>
                    <span className="eoc-leg-item"><span className="eoc-leg-dot" style={{background:"var(--danger)"}} />failed</span>
                  </span>
                </div>

                <div className="eoc-task-pipeline">
                  {selChain.tasks.map((t, i) => (
                    <TaskNode key={t.id} task={t} isLast={i === selChain.tasks.length - 1} />
                  ))}
                </div>

                {/* Result summary */}
                {selChain.status === "completed" && (
                  <div className="eoc-result-summary">
                    <span className="eoc-result-icon">✓</span>
                    <div>
                      <span className="eoc-result-label">Chain complete</span>
                      <p className="eoc-result-detail">
                        {selChain.tasks.length} tasks executed · {selChain.tasks.filter(t=>t.retries>0).length} retries · {selChain.successRate}% success
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {section === "retries" && (
          <div className="eoc-retries-section">
            {retryTasks.length === 0 ? (
              <div className="eoc-empty">
                <span className="eoc-empty-icon" style={{ color: "var(--success)" }}>✓</span>
                <p className="eoc-empty-title">No retries recorded</p>
                <p className="eoc-empty-sub">All tasks completed on first attempt.</p>
              </div>
            ) : (
              <div className="eoc-retry-list">
                {retryTasks.map(t => (
                  <div key={t.id} className="eoc-retry-row">
                    <span className="eoc-retry-icon" style={{ color: "var(--warning)" }}>↻{t.retries}</span>
                    <div className="eoc-retry-info">
                      <span className="eoc-retry-title">{t.title}</span>
                      <span className="eoc-retry-goal">{t.chainGoal}</span>
                    </div>
                    <span className="eoc-retry-agent" style={{ color: AGENT_COLORS[t.agent] || "var(--text-faint)" }}>{t.agent}</span>
                    <span className="eoc-retry-tool">{t.tool}</span>
                    <span className="eoc-retry-status" style={{ color: STEP_COLORS[t.status] }}>{t.status}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="eoc-retry-summary">
              <p className="eoc-retry-sum-label">System retry rate: <strong style={{ color: retryCount>0?"var(--warning)":"var(--success)" }}>{totalTasks ? ((retryCount/totalTasks)*100).toFixed(1) : 0}% of tasks retried</strong></p>
              <p className="eoc-retry-sum-note">Retries occur when a tool returns an error or a result fails validation. The orchestrator automatically retries up to 3× before escalating to a human.</p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
