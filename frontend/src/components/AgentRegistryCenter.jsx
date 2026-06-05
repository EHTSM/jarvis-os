import React, { useState, useCallback, useEffect } from "react";
import { track } from "../analytics";
import { listAgents } from "../phase18Api";
import { listManagedAgents } from "../phase20Api";
import "./AgentRegistryCenter.css";

const REG_KEY = "ooplix_agent_registry_v2";
function _load(k, fb) { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(fb)); } catch { return fb; } }
function _save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

// ── Master agent seed ────────────────────────────────────────────────
const SEED = [
  {
    id: "ag_seo", name: "SEO Agent", type: "marketing", icon: "⌕", color: "var(--accent2)",
    status: "active", owner: "System", model: "claude-sonnet-4-6",
    description: "Monitors keyword rankings, generates meta content, audits on-page SEO, identifies backlink opportunities.",
    capabilities: ["Keyword research","Meta generation","Rank tracking","Backlink analysis","SEO audit","Schema markup"],
    tools: ["web_search","read_url","write_file","analytics_read"],
    permissions: ["Read website data","Write meta tags","Read analytics","Web search"],
    memoryLinks: ["company","agent"],
    runsToday: 14, totalRuns: 892, errorRate: "0.0%", lastRun: "12 min ago", archived: false,
  },
  {
    id: "ag_marketing", name: "Marketing Agent", type: "marketing", icon: "◉", color: "var(--warning)",
    status: "active", owner: "System", model: "claude-sonnet-4-6",
    description: "Drafts email campaigns, social posts, ad copy, and landing page content. Schedules distribution.",
    capabilities: ["Email drafting","Social copy","Ad copy","Campaign scheduling","A/B variants","Landing pages"],
    tools: ["read_crm","write_draft","schedule_send","analytics_read"],
    permissions: ["Read CRM data","Write email drafts","Read analytics","Post to social"],
    memoryLinks: ["company","user"],
    runsToday: 8, totalRuns: 540, errorRate: "0.2%", lastRun: "34 min ago", archived: false,
  },
  {
    id: "ag_content", name: "Content Agent", type: "content", icon: "◈", color: "var(--accent)",
    status: "idle", owner: "System", model: "claude-sonnet-4-6",
    description: "Writes blog posts, docs, case studies, newsletters. Enforces brand voice across all output.",
    capabilities: ["Blog writing","Documentation","Newsletter drafting","Case studies","Brand voice"],
    tools: ["read_knowledge","write_document","read_brand","publish_cms"],
    permissions: ["Read knowledge base","Write documents","Read brand guidelines","Post to CMS"],
    memoryLinks: ["company","project"],
    runsToday: 3, totalRuns: 210, errorRate: "0.0%", lastRun: "2h ago", archived: false,
  },
  {
    id: "ag_support", name: "Support Agent", type: "support", icon: "◎", color: "#52d68a",
    status: "active", owner: "System", model: "claude-haiku-4-5-20251001",
    description: "Triages tickets, drafts responses from knowledge base, escalates critical issues.",
    capabilities: ["Query triage","Response drafting","Escalation logic","FAQ generation","Ticket summarisation"],
    tools: ["read_knowledge","write_ticket","read_user","send_message"],
    permissions: ["Read knowledge base","Write tickets","Read user data","Send messages"],
    memoryLinks: ["project","agent"],
    runsToday: 31, totalRuns: 2104, errorRate: "1.2%", lastRun: "3 min ago", archived: false,
  },
  {
    id: "ag_sales", name: "Sales Agent", type: "sales", icon: "◇", color: "#da552f",
    status: "idle", owner: "System", model: "claude-sonnet-4-6",
    description: "Qualifies leads, drafts outreach sequences, tracks pipeline movement, prepares deal summaries.",
    capabilities: ["Lead qualification","Outreach drafting","Pipeline tracking","Deal summaries","Follow-up scheduling"],
    tools: ["read_crm","write_crm","send_message","read_analytics"],
    permissions: ["Read CRM","Write CRM","Send messages","Read analytics"],
    memoryLinks: ["company","user","project"],
    runsToday: 5, totalRuns: 388, errorRate: "0.5%", lastRun: "1h ago", archived: false,
  },
  {
    id: "ag_dev", name: "Dev Agent", type: "engineering", icon: "⬡", color: "#e6edf3",
    status: "idle", owner: "System", model: "claude-opus-4-8",
    description: "Writes code, reviews PRs, generates tests, debugs failures, maintains documentation.",
    capabilities: ["Code generation","PR review","Test writing","Debugging","Documentation","Refactoring"],
    tools: ["read_repo","write_code","run_tests","read_ci","post_comment"],
    permissions: ["Read repos","Write code","Run tests","Read CI status","Post PR comments"],
    memoryLinks: ["workflow","project"],
    runsToday: 7, totalRuns: 621, errorRate: "2.1%", lastRun: "45 min ago", archived: false,
  },
  {
    id: "ag_devops", name: "DevOps Agent", type: "engineering", icon: "⬟", color: "#fc6d26",
    status: "paused", owner: "System", model: "claude-sonnet-4-6",
    description: "Monitors deployments, manages infra health, triggers rollbacks on failure, reports pipeline status.",
    capabilities: ["Deploy monitoring","Health checks","Rollback triggers","Incident alerts","Pipeline reporting","Log analysis"],
    tools: ["read_deployments","trigger_rollback","read_logs","write_incident","read_infra"],
    permissions: ["Read deployments","Trigger rollbacks","Read logs","Write incident reports","Read infrastructure"],
    memoryLinks: ["workflow","project"],
    runsToday: 5, totalRuns: 430, errorRate: "0.5%", lastRun: "1h ago", archived: false,
  },
  {
    id: "ag_research", name: "Research Agent", type: "research", icon: "⊕", color: "#a78bfa",
    status: "idle", owner: "System", model: "claude-opus-4-8",
    description: "Deep-dives into topics, synthesises findings from web and knowledge base, produces structured reports.",
    capabilities: ["Web research","Knowledge synthesis","Competitive analysis","Market research","Report generation"],
    tools: ["web_search","read_knowledge","read_url","write_document"],
    permissions: ["Web search","Read knowledge base","Read URLs","Write documents"],
    memoryLinks: ["company","project"],
    runsToday: 2, totalRuns: 145, errorRate: "0.0%", lastRun: "3h ago", archived: false,
  },
  {
    id: "ag_analytics", name: "Analytics Agent", type: "analytics", icon: "▣", color: "#38bdf8",
    status: "active", owner: "System", model: "claude-sonnet-4-6",
    description: "Collects metrics, generates trend reports, flags anomalies, and surfaces actionable insights.",
    capabilities: ["Metric collection","Trend analysis","Anomaly detection","Insight generation","Automated reports"],
    tools: ["read_analytics","read_crm","write_report","send_alert"],
    permissions: ["Read analytics","Read CRM","Write reports","Send alerts"],
    memoryLinks: ["company","agent"],
    runsToday: 18, totalRuns: 1230, errorRate: "0.3%", lastRun: "5 min ago", archived: false,
  },
];

const TYPE_COLORS = {
  marketing: "var(--warning)", content: "var(--accent)", support: "#52d68a",
  engineering: "#e6edf3", sales: "#da552f", research: "#a78bfa", analytics: "#38bdf8",
};
const STATUS_CFG = {
  active: { color: "var(--success)", pulse: true },
  idle:   { color: "var(--accent2)", pulse: false },
  paused: { color: "var(--warning)", pulse: false },
  archived:{ color: "var(--text-faint)", pulse: false },
};

function AgentRow({ agent, selected, onSelect }) {
  const sc = STATUS_CFG[agent.status] || STATUS_CFG.idle;
  return (
    <button className={`arc-agent-row${selected ? " arc-agent-row--sel" : ""}${agent.archived ? " arc-agent-row--archived" : ""}`} onClick={() => onSelect(agent.id)}>
      <div className="arc-ar-icon-wrap" style={{ background: agent.color + "18", borderColor: agent.color + "2e" }}>
        <span className="arc-ar-icon" style={{ color: agent.color }}>{agent.icon}</span>
      </div>
      <div className="arc-ar-info">
        <span className="arc-ar-name">{agent.name}</span>
        <span className="arc-ar-type" style={{ color: TYPE_COLORS[agent.type] || "var(--text-faint)" }}>{agent.type}</span>
      </div>
      <div className="arc-ar-stats">
        <span className="arc-ar-stat"><b>{agent.runsToday}</b> today</span>
        <span className="arc-ar-stat"><b>{agent.errorRate}</b> err</span>
      </div>
      <span className="arc-ar-model">{agent.model.replace("claude-","").replace("-20251001","")}</span>
      <div className="arc-ar-status">
        {sc.pulse && <span className="arc-pulse" style={{ background: sc.color }} />}
        <span className="arc-ar-status-label" style={{ color: sc.color }}>{agent.status}</span>
      </div>
    </button>
  );
}

function AgentDetail({ agent, onClone, onArchive, onToggle }) {
  const sc = STATUS_CFG[agent.status] || STATUS_CFG.idle;
  return (
    <div className="arc-detail">
      <div className="arc-detail-head">
        <div className="arc-detail-icon-wrap" style={{ background: agent.color + "18", borderColor: agent.color + "2e" }}>
          <span style={{ color: agent.color, fontSize: 22, fontWeight: 900 }}>{agent.icon}</span>
        </div>
        <div className="arc-detail-title-block">
          <span className="arc-detail-name">{agent.name}</span>
          <span className="arc-detail-type" style={{ color: TYPE_COLORS[agent.type] }}>{agent.type}</span>
        </div>
      </div>

      <p className="arc-detail-desc">{agent.description}</p>

      <div className="arc-detail-meta-grid">
        <span className="arc-dml">Status</span><span className="arc-dmv" style={{ color: sc.color }}>{agent.status}</span>
        <span className="arc-dml">Model</span><span className="arc-dmv arc-mono">{agent.model}</span>
        <span className="arc-dml">Owner</span><span className="arc-dmv">{agent.owner}</span>
        <span className="arc-dml">Runs today</span><span className="arc-dmv">{agent.runsToday}</span>
        <span className="arc-dml">Total runs</span><span className="arc-dmv">{agent.totalRuns}</span>
        <span className="arc-dml">Error rate</span><span className="arc-dmv" style={{ color: parseFloat(agent.errorRate) > 1 ? "var(--danger)" : "var(--success)" }}>{agent.errorRate}</span>
        <span className="arc-dml">Last run</span><span className="arc-dmv">{agent.lastRun}</span>
      </div>

      <div className="arc-detail-section">
        <p className="arc-ds-label">Capabilities</p>
        <div className="arc-chips">
          {agent.capabilities.map(c => <span key={c} className="arc-cap-chip" style={{ borderColor: agent.color + "33", color: agent.color }}>✓ {c}</span>)}
        </div>
      </div>

      <div className="arc-detail-section">
        <p className="arc-ds-label">Tools</p>
        <div className="arc-chips">
          {agent.tools.map(t => <span key={t} className="arc-tool-chip arc-mono">{t}</span>)}
        </div>
      </div>

      <div className="arc-detail-section">
        <p className="arc-ds-label">Permissions</p>
        <div className="arc-chips">
          {agent.permissions.map(p => <span key={p} className="arc-perm-chip">◎ {p}</span>)}
        </div>
      </div>

      <div className="arc-detail-section">
        <p className="arc-ds-label">Memory links</p>
        <div className="arc-chips">
          {agent.memoryLinks.map(m => <span key={m} className="arc-mem-chip">{m} memory</span>)}
        </div>
      </div>

      <div className="arc-detail-actions">
        <button className="arc-act-btn arc-act-btn--clone" onClick={() => onClone(agent.id)}>Clone</button>
        <button className="arc-act-btn arc-act-btn--toggle" onClick={() => onToggle(agent.id)}>
          {agent.status === "active" ? "Pause" : agent.status === "paused" ? "Resume" : "Activate"}
        </button>
        {!agent.archived && <button className="arc-act-btn arc-act-btn--archive" onClick={() => onArchive(agent.id)}>Archive</button>}
      </div>
    </div>
  );
}

function CreateModal({ onSave, onClose }) {
  const [form, setForm] = useState({ name: "", type: "support", model: "claude-sonnet-4-6", description: "", capabilities: "", tools: "", permissions: "" });
  const handleSubmit = e => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave({
      id: `ag_${Date.now()}`, ...form,
      icon: "◎", color: "var(--accent2)", status: "idle", owner: "User",
      capabilities: form.capabilities.split(",").map(s=>s.trim()).filter(Boolean),
      tools: form.tools.split(",").map(s=>s.trim()).filter(Boolean),
      permissions: form.permissions.split(",").map(s=>s.trim()).filter(Boolean),
      memoryLinks: ["agent"], runsToday: 0, totalRuns: 0, errorRate: "0.0%", lastRun: "never", archived: false,
    });
  };
  return (
    <div className="arc-modal-overlay" onClick={onClose}>
      <div className="arc-modal" onClick={e=>e.stopPropagation()}>
        <h3 className="arc-modal-title">Create agent</h3>
        <form onSubmit={handleSubmit} className="arc-modal-form">
          <label className="arc-fl">Name</label>
          <input className="arc-fi" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="My Agent" autoFocus required />
          <div className="arc-form-row">
            <div>
              <label className="arc-fl">Type</label>
              <select className="arc-fi" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
                {["marketing","content","support","sales","engineering","research","analytics"].map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="arc-fl">Model</label>
              <select className="arc-fi" value={form.model} onChange={e=>setForm(f=>({...f,model:e.target.value}))}>
                {["claude-sonnet-4-6","claude-opus-4-8","claude-haiku-4-5-20251001"].map(m=><option key={m} value={m}>{m.replace("claude-","").replace("-20251001","")}</option>)}
              </select>
            </div>
          </div>
          <label className="arc-fl">Description</label>
          <textarea className="arc-fi arc-fta" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} rows={2} placeholder="What this agent does…" />
          <label className="arc-fl">Capabilities (comma-separated)</label>
          <input className="arc-fi" value={form.capabilities} onChange={e=>setForm(f=>({...f,capabilities:e.target.value}))} placeholder="Writing, Research, Analysis" />
          <label className="arc-fl">Tools (comma-separated)</label>
          <input className="arc-fi" value={form.tools} onChange={e=>setForm(f=>({...f,tools:e.target.value}))} placeholder="web_search, write_document" />
          <div className="arc-modal-actions">
            <button type="button" className="arc-cancel-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="arc-save-btn">Create agent</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AgentRegistryCenter({ onNavigate }) {
  const [agents,   setAgents]   = useState(() => _load(REG_KEY, SEED));
  const [selected, setSelected] = useState("ag_seo");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [toast, setToast] = useState(null);
  const [apiError, setApiError] = useState(null);

  useEffect(() => { track.event("agent_registry_viewed"); }, []);

  // Merge live agents from backend (p18 + p20) with local registry
  useEffect(() => {
    let cancelled = false;
    Promise.all([listAgents(), listManagedAgents()])
      .then(([p18Res, p20Res]) => {
        if (cancelled) return;
        const p18 = p18Res?.agents || [];
        const p20 = p20Res?.agents || [];
        const all = [...p18, ...p20];
        if (all.length > 0) {
          const mapped = all.map(a => ({
            id:          a.id,
            name:        a.name || a.id,
            type:        a.type || "runtime",
            icon:        a.icon || "▷",
            color:       a.color || "var(--accent)",
            status:      a.status || "active",
            description: a.description || "",
            capabilities: a.capabilities || [],
            permissions: a.permissions || [],
            model:       a.model || "—",
            lastRun:     a.lastRun || "—",
            runsToday:   a.runsToday ?? 0,
            errorRate:   a.errorRate || "0%",
            archived:    a.archived || false,
          }));
          setAgents(mapped);
          _save(REG_KEY, mapped);
          setSelected(mapped[0]?.id || null);
        }
      })
      .catch(err => { if (!cancelled) setApiError(err.message); });
    return () => { cancelled = true; };
  }, []);
  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2400); };
  const persist = next => { _save(REG_KEY, next); setAgents(next); };

  const handleCreate = useCallback(data => {
    persist([...agents, data]);
    setSelected(data.id); setShowCreate(false); showToast("Agent created");
    track.event("agent_created", { type: data.type });
  }, [agents]);

  const handleClone = useCallback(id => {
    const src = agents.find(a => a.id === id);
    if (!src) return;
    const clone = { ...src, id: `ag_${Date.now()}`, name: src.name + " (copy)", status: "idle", runsToday: 0, totalRuns: 0, lastRun: "never" };
    persist([...agents, clone]); setSelected(clone.id); showToast("Agent cloned");
  }, [agents]);

  const handleArchive = useCallback(id => {
    persist(agents.map(a => a.id === id ? { ...a, archived: true, status: "archived" } : a));
    setSelected(null); showToast("Agent archived");
  }, [agents]);

  const handleToggle = useCallback(id => {
    const a = agents.find(x => x.id === id);
    if (!a) return;
    const next = a.status === "active" ? "paused" : "active";
    persist(agents.map(x => x.id === id ? { ...x, status: next } : x));
    showToast(`Agent ${next}`);
  }, [agents]);

  const allTypes = [...new Set(SEED.map(a => a.type))];
  const visible = agents.filter(a =>
    (showArchived || !a.archived) &&
    (typeFilter === "all" || a.type === typeFilter) &&
    (statusFilter === "all" || a.status === statusFilter)
  );
  const selAgent = selected ? agents.find(a => a.id === selected) : null;
  const activeCount = agents.filter(a => a.status === "active").length;

  return (
    <div className="agent-registry-center page-enter">
      {toast && <div className="arc-toast">{toast}</div>}
      {apiError && <div className="ac-api-banner ac-api-banner--error">⚠ Live registry unavailable — showing cached data ({apiError})</div>}
      {showCreate && <CreateModal onSave={handleCreate} onClose={() => setShowCreate(false)} />}

      <div className="arc-header">
        <div>
          <h1 className="arc-title">Agent Registry</h1>
          <p className="arc-subtitle">All agents — capabilities, tools, permissions, memory links, and status.</p>
        </div>
        <button className="arc-create-btn" onClick={() => setShowCreate(true)}>+ Create agent</button>
      </div>

      {/* Summary */}
      <div className="arc-summary-strip">
        {[
          { label: "Total agents", value: agents.filter(a=>!a.archived).length, color: "var(--text)" },
          { label: "Active",       value: activeCount, color: "var(--success)" },
          { label: "Idle",         value: agents.filter(a=>a.status==="idle").length, color: "var(--accent2)" },
          { label: "Paused",       value: agents.filter(a=>a.status==="paused").length, color: "var(--warning)" },
          { label: "Runs today",   value: agents.reduce((s,a)=>s+a.runsToday,0), color: "var(--accent2)" },
          { label: "Archived",     value: agents.filter(a=>a.archived).length, color: "var(--text-faint)" },
        ].map(s => (
          <div key={s.label} className="arc-summary-tile">
            <span className="arc-summary-val" style={{ color: s.color }}>{s.value}</span>
            <span className="arc-summary-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="arc-filters">
        <div className="arc-filter-row">
          <button className={`arc-chip${typeFilter==="all"?" arc-chip--active":""}`} onClick={()=>setTypeFilter("all")}>All types</button>
          {allTypes.map(t=>(
            <button key={t} className={`arc-chip${typeFilter===t?" arc-chip--active":""}`}
              style={typeFilter===t?{color:TYPE_COLORS[t]||"var(--accent2)",borderColor:(TYPE_COLORS[t]||"var(--accent2)")+"44"}:{}}
              onClick={()=>setTypeFilter(p=>p===t?"all":t)}>{t}</button>
          ))}
        </div>
        <div className="arc-filter-row">
          {["all","active","idle","paused"].map(s=>(
            <button key={s} className={`arc-chip${statusFilter===s?" arc-chip--active":""}`} onClick={()=>setStatusFilter(s)}>{s}</button>
          ))}
          <button className={`arc-chip arc-chip--muted${showArchived?" arc-chip--active":""}`} onClick={()=>setShowArchived(p=>!p)}>
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
        </div>
      </div>

      <div className="arc-layout">
        <div className="arc-list">
          {visible.length === 0 ? (
            <div className="arc-empty"><span className="arc-empty-icon">◎</span><p>No agents match</p></div>
          ) : visible.map(a => (
            <AgentRow key={a.id} agent={a} selected={selected===a.id} onSelect={setSelected} />
          ))}
        </div>
        {selAgent && (
          <AgentDetail
            agent={selAgent}
            onClone={handleClone}
            onArchive={handleArchive}
            onToggle={handleToggle}
          />
        )}
      </div>
    </div>
  );
}
