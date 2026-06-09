import React, { useState, useCallback, useEffect } from "react";
import { track } from "../analytics";
import { listAgents, getAgentFailures, executeAgentTask } from "../phase18Api";
import "./AgentCenter.css";

// ── Persistence ───────────────────────────────────────────────────────
const AGENTS_KEY   = "ooplix_agent_registry";
const ACTIVITY_KEY = "ooplix_agent_activity";

function _load(key, fb) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fb)); }
  catch { return fb; }
}
function _save(key, v) { localStorage.setItem(key, JSON.stringify(v)); }

// ── Seed agent registry ───────────────────────────────────────────────
const SEED_AGENTS = [
  {
    id:          "agent_seo",
    name:        "SEO Agent",
    type:        "marketing",
    icon:        "⌕",
    color:       "var(--accent2)",
    status:      "active",
    description: "Monitors keyword rankings, generates meta content, identifies link opportunities, and audits on-page SEO.",
    capabilities:["Keyword research","Meta generation","Rank tracking","Backlink analysis","SEO audit"],
    permissions: ["Read website data","Write meta tags","Read analytics"],
    memoryLink:  "agent",
    lastRun:     "12 min ago",
    runsToday:   14,
    errorRate:   "0%",
    model:       "claude-sonnet-4-6",
  },
  {
    id:          "agent_marketing",
    name:        "Marketing Agent",
    type:        "marketing",
    icon:        "◉",
    color:       "var(--warning)",
    status:      "active",
    description: "Drafts email campaigns, social posts, ad copy, and landing page content. Schedules and tracks distribution.",
    capabilities:["Email drafting","Social copy","Ad copy","Campaign scheduling","A/B variant generation"],
    permissions: ["Read CRM data","Write email drafts","Read analytics","Post to social"],
    memoryLink:  "company",
    lastRun:     "34 min ago",
    runsToday:   8,
    errorRate:   "0%",
    model:       "claude-sonnet-4-6",
  },
  {
    id:          "agent_support",
    name:        "Support Agent",
    type:        "support",
    icon:        "◎",
    color:       "#52d68a",
    status:      "active",
    description: "Handles inbound support queries, triages tickets, drafts responses from the knowledge base, and escalates critical issues.",
    capabilities:["Query triage","Response drafting","Escalation logic","FAQ generation","Ticket summarisation"],
    permissions: ["Read knowledge base","Write tickets","Read user data","Send messages"],
    memoryLink:  "project",
    lastRun:     "3 min ago",
    runsToday:   31,
    errorRate:   "1.2%",
    model:       "claude-haiku-4-5-20251001",
  },
  {
    id:          "agent_content",
    name:        "Content Agent",
    type:        "content",
    icon:        "◈",
    color:       "var(--accent)",
    status:      "idle",
    description: "Writes blog posts, documentation, case studies, and newsletters. Maintains brand voice consistency across all output.",
    capabilities:["Blog writing","Documentation","Newsletter drafting","Case studies","Brand voice enforcement"],
    permissions: ["Read knowledge base","Write documents","Read brand guidelines","Post to CMS"],
    memoryLink:  "company",
    lastRun:     "2 hours ago",
    runsToday:   3,
    errorRate:   "0%",
    model:       "claude-sonnet-4-6",
  },
  {
    id:          "agent_dev",
    name:        "Dev Agent",
    type:        "engineering",
    icon:        "⬡",
    color:       "#e6edf3",
    status:      "idle",
    description: "Writes code, reviews PRs, generates tests, debugs failures, and maintains documentation across the engineering stack.",
    capabilities:["Code generation","PR review","Test writing","Debugging","Documentation","Refactoring"],
    permissions: ["Read repos","Write code","Run tests","Read CI status","Post PR comments"],
    memoryLink:  "workflow",
    lastRun:     "45 min ago",
    runsToday:   7,
    errorRate:   "2.1%",
    model:       "claude-opus-4-8",
  },
  {
    id:          "agent_devops",
    name:        "DevOps Agent",
    type:        "engineering",
    icon:        "⬟",
    color:       "#fc6d26",
    status:      "paused",
    description: "Monitors deployments, manages infrastructure health, triggers rollbacks on failure, and reports pipeline status.",
    capabilities:["Deploy monitoring","Health checks","Rollback triggers","Incident alerts","Pipeline reporting","Log analysis"],
    permissions: ["Read deployments","Trigger rollbacks","Read logs","Write incident reports","Read infrastructure"],
    memoryLink:  "workflow",
    lastRun:     "1 hour ago",
    runsToday:   5,
    errorRate:   "0.5%",
    model:       "claude-sonnet-4-6",
  },
];

const SEED_ACTIVITY = [
  { id: "a1",  agentId: "agent_seo",       action: "Generated meta descriptions for 5 blog posts",         ts: "12 min ago",  status: "success" },
  { id: "a2",  agentId: "agent_support",   action: "Triaged 3 inbound tickets — 2 resolved, 1 escalated",  ts: "3 min ago",   status: "success" },
  { id: "a3",  agentId: "agent_marketing", action: "Drafted June newsletter — saved to Email OS",           ts: "34 min ago",  status: "success" },
  { id: "a4",  agentId: "agent_seo",       action: "Keyword rank check — 12 keywords tracked",             ts: "1 hour ago",  status: "success" },
  { id: "a5",  agentId: "agent_dev",       action: "Reviewed PR #47 — 2 suggestions posted",               ts: "45 min ago",  status: "success" },
  { id: "a6",  agentId: "agent_support",   action: "Response drafted for ticket #1023",                    ts: "8 min ago",   status: "success" },
  { id: "a7",  agentId: "agent_devops",    action: "Health check passed — all services nominal",           ts: "1 hour ago",  status: "success" },
  { id: "a8",  agentId: "agent_content",   action: "Blog post draft: 'WhatsApp Automation for Freelancers'",ts: "2 hours ago", status: "success" },
  { id: "a9",  agentId: "agent_dev",       action: "Test suite run — 94% pass rate, 2 failures flagged",   ts: "55 min ago",  status: "warning" },
  { id: "a10", agentId: "agent_support",   action: "FAQ document updated with 4 new entries",              ts: "20 min ago",  status: "success" },
];

const TYPE_COLORS = {
  marketing:   "var(--warning)",
  support:     "#52d68a",
  content:     "var(--accent)",
  engineering: "#e6edf3",
};

const STATUS_CONFIG = {
  active: { color: "var(--success)", label: "Active",  dot: true  },
  idle:   { color: "var(--accent2)", label: "Idle",    dot: false },
  paused: { color: "var(--warning)", label: "Paused",  dot: false },
  error:  { color: "var(--danger)",  label: "Error",   dot: true  },
};

function AgentCard({ agent, selected, onSelect, onToggle }) {
  const sc = STATUS_CONFIG[agent.status] || STATUS_CONFIG.idle;
  return (
    <button
      className={`ac-agent-card${selected ? " ac-agent-card--selected" : ""}`}
      onClick={() => onSelect(agent.id)}
    >
      <div className="ac-agent-header">
        <div className="ac-agent-icon-wrap" style={{ background: agent.color + "18", borderColor: agent.color + "2e" }}>
          <span className="ac-agent-icon" style={{ color: agent.color }}>{agent.icon}</span>
        </div>
        <div className="ac-agent-meta">
          <span className="ac-agent-name">{agent.name}</span>
          <span className="ac-agent-type" style={{ color: TYPE_COLORS[agent.type] }}>{agent.type}</span>
        </div>
        <div className="ac-agent-status-wrap">
          {sc.dot && <span className="ac-status-pulse" style={{ background: sc.color }} />}
          <span className="ac-status-label" style={{ color: sc.color }}>{sc.label}</span>
        </div>
      </div>
      <p className="ac-agent-desc">{agent.description.slice(0, 80)}…</p>
      <div className="ac-agent-stats">
        <span className="ac-stat"><span className="ac-stat-v">{agent.runsToday}</span> runs today</span>
        <span className="ac-stat"><span className="ac-stat-v">{agent.errorRate}</span> errors</span>
        <span className="ac-stat">Last: <span className="ac-stat-v">{agent.lastRun}</span></span>
      </div>
    </button>
  );
}

function AgentDetail({ agent, activity, onToggle, onClose, onExecResult }) {
  const sc = STATUS_CONFIG[agent.status] || STATUS_CONFIG.idle;
  const agentActivity = activity.filter(a => a.agentId === agent.id);
  const [taskInput,  setTaskInput]  = useState("");
  const [executing,  setExecuting]  = useState(false);
  const [execResult, setExecResult] = useState(null);
  const [execError,  setExecError]  = useState(null);

  function handleExecute() {
    if (!taskInput.trim()) return;
    setExecuting(true); setExecResult(null); setExecError(null);
    executeAgentTask(agent.id, taskInput.trim())
      .then(r => { setExecResult(r); if (onExecResult) onExecResult(r); })
      .catch(e => setExecError(e.message))
      .finally(() => setExecuting(false));
  }

  return (
    <div className="ac-detail">
      <div className="ac-detail-topbar">
        <div className="ac-detail-title-row">
          <span className="ac-detail-icon" style={{ color: agent.color }}>{agent.icon}</span>
          <h3 className="ac-detail-name">{agent.name}</h3>
        </div>
        <button className="ac-detail-close" onClick={onClose}>✕</button>
      </div>

      <div className="ac-detail-status-row">
        <span className="ac-detail-status-badge" style={{ color: sc.color, borderColor: sc.color + "44" }}>
          {sc.label}
        </span>
        <span className="ac-detail-model">{agent.model}</span>
        <button
          className={`ac-toggle-btn ac-toggle-btn--${agent.status === "active" ? "pause" : "resume"}`}
          onClick={() => onToggle(agent.id)}
        >
          {agent.status === "active" ? "Pause agent" : agent.status === "paused" ? "Resume agent" : "Activate"}
        </button>
      </div>

      <p className="ac-detail-desc">{agent.description}</p>

      <div className="ac-detail-section">
        <p className="ac-dl">Capabilities</p>
        <div className="ac-caps-list">
          {agent.capabilities.map(c => (
            <span key={c} className="ac-cap-chip" style={{ borderColor: agent.color + "33", color: agent.color }}>✓ {c}</span>
          ))}
        </div>
      </div>

      <div className="ac-detail-section">
        <p className="ac-dl">Permissions</p>
        <div className="ac-perms-list">
          {agent.permissions.map(p => (
            <span key={p} className="ac-perm-chip">◎ {p}</span>
          ))}
        </div>
      </div>

      <div className="ac-detail-section">
        <p className="ac-dl">Memory link</p>
        <span className="ac-mem-badge">
          ◎ {agent.memoryLink} memory
        </span>
      </div>

      <div className="ac-detail-section">
        <p className="ac-dl">Recent activity</p>
        {agentActivity.length === 0 ? (
          <p className="ac-no-activity">No recent activity</p>
        ) : (
          <div className="ac-mini-feed">
            {agentActivity.slice(0,5).map(a => (
              <div key={a.id} className={`ac-mini-row ac-mini-row--${a.status}`}>
                <span className="ac-mini-dot" />
                <span className="ac-mini-action">{a.action}</span>
                <span className="ac-mini-ts">{a.ts}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ac-detail-section">
        <p className="ac-dl">Execute task</p>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <input
            className="mc-form-input"
            style={{ flex:1, minWidth:0 }}
            value={taskInput}
            onChange={e => setTaskInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleExecute()}
            placeholder={`Give ${agent.name} a task…`}
          />
          <button
            onClick={handleExecute}
            disabled={executing || !taskInput.trim()}
            style={{ padding:"8px 16px", background:"linear-gradient(135deg,var(--accent),var(--accent2))", color:"#06080e", border:"none", borderRadius:"var(--radius-pill)", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}
          >{executing ? "Running…" : "▷ Execute"}</button>
        </div>
        {execError && <p style={{ color:"var(--danger)", fontSize:12, marginTop:6 }}>Error: {execError}</p>}
        {execResult && (
          <div style={{ marginTop:8, padding:"8px 12px", background:"var(--surface-raised)", borderRadius:"var(--radius)", fontSize:12 }}>
            <span style={{ color: execResult.success ? "var(--success)" : "var(--warning)", fontWeight:700 }}>
              {execResult.success ? "✓ Success" : "⚠ Completed"}
            </span>
            {" — "}{execResult.output || execResult.result?.message || execResult.reply || "Done"}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentCenter({ onNavigate }) {
  const [agents,   setAgents]   = useState(() => _load(AGENTS_KEY, SEED_AGENTS));
  const [activity, setActivity] = useState(() => _load(ACTIVITY_KEY, SEED_ACTIVITY));
  const [section,  setSection]  = useState("registry");
  const [selected, setSelected] = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [toast,    setToast]    = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [apiError, setApiError] = useState(null);

  useEffect(() => { track.event("agent_center_viewed"); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setApiError(null);
    Promise.all([listAgents(), getAgentFailures()])
      .then(([agentRes, failRes]) => {
        if (cancelled) return;
        const live = agentRes?.agents;
        if (Array.isArray(live) && live.length > 0) {
          setAgents(live);
          _save(AGENTS_KEY, live);
        }
        const fails = failRes?.failures;
        if (Array.isArray(fails) && fails.length > 0) {
          const feedItems = fails.map((f, i) => ({
            id: `live_f${i}`,
            agentId: f.agentId || "unknown",
            action: f.input || f.error || "Task failed",
            ts: f.failedAt ? new Date(f.failedAt).toLocaleTimeString() : "recently",
            status: "error",
          }));
          setActivity(prev => [...feedItems, ...prev].slice(0, 40));
        }
      })
      .catch(err => { if (!cancelled) setApiError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 2400); };

  const handleToggle = useCallback((id) => {
    setAgents(prev => {
      const next = prev.map(a => {
        if (a.id !== id) return a;
        const newStatus = a.status === "active" ? "paused" : "active";
        return { ...a, status: newStatus };
      });
      _save(AGENTS_KEY, next);
      const agent = prev.find(a => a.id === id);
      const newS  = agent.status === "active" ? "paused" : "active";
      showToast(`${agent.name} ${newS === "active" ? "activated" : "paused"}`);
      track.event("agent_toggled", { id, newStatus: newS });
      return next;
    });
  }, []);

  const visibleAgents = agents.filter(a =>
    (typeFilter   === "all" || a.type   === typeFilter) &&
    (statusFilter === "all" || a.status === statusFilter)
  );

  const activeCount  = agents.filter(a => a.status === "active").length;
  const totalRuns    = agents.reduce((s,a) => s + a.runsToday, 0);
  const selectedAgent = selected ? agents.find(a => a.id === selected) : null;

  const allTypes    = [...new Set(SEED_AGENTS.map(a => a.type))];
  const allStatuses = ["active","idle","paused","error"];

  return (
    <div className="agent-center page-enter">
      {toast && <div className="ac-toast">{toast}</div>}
      {loading && <div className="ac-api-banner ac-api-banner--loading">Loading live agent data…</div>}
      {apiError && !loading && <div className="ac-api-banner ac-api-banner--error">⚠ Live data unavailable — showing cached data ({apiError})</div>}

      <div className="ac-header">
        <div>
          <h1 className="ac-title">Agent OS</h1>
          <p className="ac-subtitle">Agent registry, permissions, memory links, and live activity feed.</p>
        </div>
        <div className="ac-header-stats">
          <div className="ac-hstat">
            <span className="ac-hstat-v" style={{ color: "var(--success)" }}>{activeCount}</span>
            <span className="ac-hstat-l">Active</span>
          </div>
          <div className="ac-hstat">
            <span className="ac-hstat-v">{agents.length}</span>
            <span className="ac-hstat-l">Total agents</span>
          </div>
          <div className="ac-hstat">
            <span className="ac-hstat-v" style={{ color: "var(--accent2)" }}>{totalRuns}</span>
            <span className="ac-hstat-l">Runs today</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="ac-tabs">
        {[
          { id: "registry", label: "Registry"      },
          { id: "activity", label: "Activity Feed" },
          { id: "types",    label: "Agent Types"   },
        ].map(t => (
          <button key={t.id} className={`ac-tab${section === t.id ? " ac-tab--active" : ""}`} onClick={() => setSection(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="ac-content" key={section}>

        {/* Registry */}
        {section === "registry" && (
          <div className="ac-registry">
            {/* Filters */}
            <div className="ac-filters">
              <div className="ac-filter-chips">
                <button className={`ac-chip${typeFilter==="all"?" ac-chip--active":""}`} onClick={()=>setTypeFilter("all")}>All types</button>
                {allTypes.map(t => (
                  <button key={t}
                    className={`ac-chip${typeFilter===t?" ac-chip--active":""}`}
                    style={typeFilter===t?{color:TYPE_COLORS[t],borderColor:TYPE_COLORS[t]+"44"}:{}}
                    onClick={()=>setTypeFilter(prev=>prev===t?"all":t)}
                  >{t}</button>
                ))}
              </div>
              <div className="ac-filter-chips">
                <button className={`ac-chip${statusFilter==="all"?" ac-chip--active":""}`} onClick={()=>setStatusFilter("all")}>All status</button>
                {allStatuses.map(s => {
                  const sc = STATUS_CONFIG[s];
                  return (
                    <button key={s}
                      className={`ac-chip${statusFilter===s?" ac-chip--active":""}`}
                      style={statusFilter===s?{color:sc.color,borderColor:sc.color+"44"}:{}}
                      onClick={()=>setStatusFilter(prev=>prev===s?"all":s)}
                    >{sc.label}</button>
                  );
                })}
              </div>
            </div>

            <div className="ac-registry-layout">
              <div className="ac-agent-grid">
                {visibleAgents.map(a => (
                  <AgentCard
                    key={a.id}
                    agent={a}
                    selected={selected === a.id}
                    onSelect={id => setSelected(prev => prev === id ? null : id)}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
              {selectedAgent && (
                <AgentDetail
                  agent={selectedAgent}
                  activity={activity}
                  onToggle={handleToggle}
                  onClose={() => setSelected(null)}
                  onExecResult={r => {
                    const item = { id: `exec_${Date.now()}`, agentId: selectedAgent.id, action: r.output || "Task executed", ts: "just now", status: r.success ? "success" : "warning" };
                    setActivity(prev => [item, ...prev].slice(0, 40));
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* Activity feed */}
        {section === "activity" && (
          <div className="ac-feed-section">
            <div className="ac-feed-list">
              {activity.map(a => {
                const agent = agents.find(ag => ag.id === a.agentId);
                return (
                  <div key={a.id} className={`ac-feed-row ac-feed-row--${a.status}`}>
                    <div className="ac-feed-agent-icon" style={{ color: agent?.color, background: (agent?.color||"#fff") + "18" }}>
                      {agent?.icon}
                    </div>
                    <div className="ac-feed-info">
                      <span className="ac-feed-agent-name">{agent?.name || a.agentId}</span>
                      <span className="ac-feed-action">{a.action}</span>
                    </div>
                    <div className="ac-feed-right">
                      <span className={`ac-feed-status ac-feed-status--${a.status}`}>{a.status}</span>
                      <span className="ac-feed-ts">{a.ts}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Agent types */}
        {section === "types" && (
          <div className="ac-types-section">
            {[
              { type: "marketing",   label: "Marketing Agents",   desc: "Handle SEO, email, social, ad copy, and campaign scheduling. Read CRM and analytics data.",          color: "var(--warning)" },
              { type: "support",     label: "Support Agents",     desc: "Triage tickets, draft responses from the knowledge base, escalate critical issues.",                  color: "#52d68a"        },
              { type: "content",     label: "Content Agents",     desc: "Write blog posts, docs, newsletters, and case studies. Enforce brand voice consistency.",             color: "var(--accent)"  },
              { type: "engineering", label: "Engineering Agents", desc: "Write and review code, run tests, monitor deployments, and maintain documentation.",                  color: "#e6edf3"        },
            ].map(t => {
              const typeAgents = agents.filter(a => a.type === t.type);
              return (
                <div key={t.type} className="ac-type-card" style={{ borderColor: t.color + "22" }}>
                  <div className="ac-type-header">
                    <span className="ac-type-dot" style={{ background: t.color }} />
                    <span className="ac-type-name" style={{ color: t.color }}>{t.label}</span>
                    <span className="ac-type-count">{typeAgents.length} agent{typeAgents.length !== 1 ? "s" : ""}</span>
                  </div>
                  <p className="ac-type-desc">{t.desc}</p>
                  <div className="ac-type-agents">
                    {typeAgents.map(a => (
                      <button
                        key={a.id}
                        className="ac-type-agent-chip"
                        style={{ borderColor: a.color + "33", color: a.color }}
                        onClick={() => { setSelected(a.id); setSection("registry"); }}
                      >
                        {a.icon} {a.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
