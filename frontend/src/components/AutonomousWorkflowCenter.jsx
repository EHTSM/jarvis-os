import React, { useState, useEffect } from "react";
import { track } from "../analytics";
import "./AutonomousWorkflowCenter.css";

const WORKFLOWS = [
  {
    id: "wf_01", icon: "💰", name: "Lead Nurture Pipeline",
    trigger: "New lead added", agent: "Sales Agent", tool: "Gmail", action: "send_email", result: "Follow-up sent",
    status: "running", successRate: 94, failRate: 6, retries: 3, lastRun: "2m ago", runsToday: 28,
  },
  {
    id: "wf_02", icon: "📣", name: "Content Publish Flow",
    trigger: "Schedule: 9am daily", agent: "Content Agent", tool: "Notion + Slack", action: "create_page + post_message", result: "Published + notified",
    status: "success", successRate: 98, failRate: 2, retries: 0, lastRun: "1h ago", runsToday: 2,
  },
  {
    id: "wf_03", icon: "🔍", name: "SEO Rank Monitor",
    trigger: "Cron: hourly", agent: "SEO Agent", tool: "OpenRouter", action: "call_model", result: "Rank report stored",
    status: "success", successRate: 91, failRate: 9, retries: 1, lastRun: "30m ago", runsToday: 12,
  },
  {
    id: "wf_04", icon: "🐙", name: "GitHub PR Review",
    trigger: "PR opened webhook", agent: "Dev Agent", tool: "GitHub", action: "create_pr", result: "Review comment posted",
    status: "running", successRate: 88, failRate: 12, retries: 2, lastRun: "5m ago", runsToday: 7,
  },
  {
    id: "wf_05", icon: "🎧", name: "Support Ticket Router",
    trigger: "Inbound email", agent: "Support Agent", tool: "Gmail + Slack", action: "read_inbox + post_message", result: "Ticket categorized",
    status: "success", successRate: 96, failRate: 4, retries: 0, lastRun: "8m ago", runsToday: 41,
  },
  {
    id: "wf_06", icon: "📊", name: "Weekly Analytics Brief",
    trigger: "Schedule: Mon 8am", agent: "Analytics Agent", tool: "Google Drive", action: "upload_file", result: "Report uploaded",
    status: "idle", successRate: 100, failRate: 0, retries: 0, lastRun: "6d ago", runsToday: 0,
  },
  {
    id: "wf_07", icon: "🔬", name: "Competitor Intel Sweep",
    trigger: "Cron: every 6h", agent: "Research Agent", tool: "Ollama", action: "run_local_model", result: "Brief in Knowledge Base",
    status: "failed", successRate: 72, failRate: 28, retries: 4, lastRun: "15m ago", runsToday: 3,
  },
];

const FLOW_STEPS = [
  { label: "Trigger",   key: "trigger",    cls: "trigger"     },
  { label: "Agent",     key: "agent",      cls: "agent-node"  },
  { label: "Tool",      key: "tool",       cls: "tool-node"   },
  { label: "Action",    key: "action",     cls: "action-node" },
  { label: "Result",    key: "result",     cls: "result-node" },
];

export default function AutonomousWorkflowCenter({ onNavigate }) {
  const [selected, setSelected] = useState(WORKFLOWS[0]);
  const [tab, setTab]           = useState("all");

  const filtered = tab === "all" ? WORKFLOWS
    : tab === "running" ? WORKFLOWS.filter(w => w.status === "running")
    : tab === "failed"  ? WORKFLOWS.filter(w => w.status === "failed")
    : WORKFLOWS.filter(w => w.status === "success" || w.status === "idle");

  const totalRuns  = WORKFLOWS.reduce((s,w) => s + w.runsToday, 0);
  const avgSuccess = Math.round(WORKFLOWS.reduce((s,w) => s + w.successRate, 0) / WORKFLOWS.length);
  const avgFail    = 100 - avgSuccess;
  const totalRetry = WORKFLOWS.reduce((s,w) => s + w.retries, 0);

  return (
    <div className="awc">
      <div className="awc-header">
        <div>
          <h1 className="awc-title">Autonomous Workflow Center</h1>
          <p className="awc-subtitle">Trigger → Agent → Tool → Action → Result. Full workflow visibility.</p>
        </div>
        <button onClick={() => track("awc_new_workflow")} style={{
          padding:"9px 18px", background:"linear-gradient(135deg,var(--accent),var(--accent2))",
          color:"#06080e", border:"none", borderRadius:"var(--radius-pill)", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit"
        }}>+ New Workflow</button>
      </div>

      <div className="awc-stats">
        <div className="awc-stat"><span className="awc-stat-val">{WORKFLOWS.length}</span><span className="awc-stat-lbl">Workflows</span></div>
        <div className="awc-stat"><span className="awc-stat-val" style={{color:"var(--accent)"}}>{WORKFLOWS.filter(w=>w.status==="running").length}</span><span className="awc-stat-lbl">Running</span></div>
        <div className="awc-stat"><span className="awc-stat-val" style={{color:"#00dc82"}}>{avgSuccess}%</span><span className="awc-stat-lbl">Success</span></div>
        <div className="awc-stat"><span className="awc-stat-val" style={{color:"#ff6464"}}>{avgFail}%</span><span className="awc-stat-lbl">Failure</span></div>
        <div className="awc-stat"><span className="awc-stat-val" style={{color:"var(--warning)"}}>{totalRetry}</span><span className="awc-stat-lbl">Retries</span></div>
      </div>

      {/* Flow visualization for selected workflow */}
      <div className="awc-flow-panel">
        <div className="awc-flow-title">Flow: {selected.name}</div>
        <div className="awc-flow-nodes">
          {FLOW_STEPS.map((step, i) => (
            <React.Fragment key={step.key}>
              <div className="awc-flow-node">
                <div className={`awc-flow-box ${step.cls}`}>{selected[step.key]}</div>
                <div className="awc-flow-lbl">{step.label}</div>
              </div>
              {i < FLOW_STEPS.length - 1 && <div className="awc-flow-arrow">→</div>}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {["all","running","failed","done"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding:"7px 14px", border:"1px solid var(--border)", borderRadius:"var(--radius-pill)",
            background: tab===t ? "var(--accent)" : "var(--surface-raised)",
            color: tab===t ? "#06080e" : "var(--text-dim)", fontSize:12, fontWeight:700, cursor:"pointer",
            fontFamily:"inherit", textTransform:"capitalize"
          }}>{t}</button>
        ))}
      </div>

      <div className="awc-workflow-list">
        {filtered.map(w => (
          <div key={w.id} className="awc-workflow-card" onClick={() => setSelected(w)} style={{cursor:"pointer", borderColor: selected.id===w.id?"var(--accent)":"var(--border)"}}>
            <div className="awc-workflow-icon">{w.icon}</div>
            <div className="awc-workflow-info">
              <div className="awc-workflow-name">{w.name}</div>
              <div className="awc-workflow-meta">{w.trigger} · {w.agent} · last run {w.lastRun} · {w.runsToday} runs today</div>
            </div>
            <div className="awc-workflow-bars">
              <div className="awc-mini-bar-group">
                <div className="awc-mini-bar-label">SUCCESS</div>
                <div className="awc-mini-bar-val" style={{color:"#00dc82"}}>{w.successRate}%</div>
              </div>
              <div className="awc-mini-bar-group">
                <div className="awc-mini-bar-label">FAIL</div>
                <div className="awc-mini-bar-val" style={{color:"#ff6464"}}>{w.failRate}%</div>
              </div>
              <div className="awc-mini-bar-group">
                <div className="awc-mini-bar-label">RETRY</div>
                <div className="awc-mini-bar-val" style={{color:"var(--warning)"}}>{w.retries}</div>
              </div>
            </div>
            <span className={`awc-workflow-status awc-status-${w.status}`}>{w.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
