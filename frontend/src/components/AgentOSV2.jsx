import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { listAgents, getAgentFailures, executeAgentTask } from "../phase18Api";
import { listManagedAgents, createManagedAgent } from "../phase20Api";
import { getOpsData, getStats } from "../telemetryApi";
import { getRuntimeHistory, dispatchTask, emergencyStop, emergencyResume } from "../runtimeApi";
import { sendMessage, checkHealth } from "../api";
import EmptyState from "./EmptyState";
import "./AgentOSV2.css";

// ── Helpers ────────────────────────────────────────────────────────────────────

function _load(k, fb) {
  try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(fb)); }
  catch { return fb; }
}
function _save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

function _timeAgo(ts) {
  if (!ts) return "never";
  const ms   = Date.now() - new Date(ts).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60)  return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)  return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function _fmtTime(isoStr) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ── Seed data (used when live API returns nothing) ─────────────────────────────

const SEED_AGENTS = [
  {
    id: "ag_seo", name: "SEO Agent", type: "marketing", icon: "⌕",
    color: "var(--accent2, #4ecdc4)", status: "active",
    description: "Monitors keyword rankings, generates meta content, audits on-page SEO.",
    capabilities: ["Keyword research", "Meta generation", "Rank tracking", "Backlink analysis"],
    model: "claude-sonnet-4-6", runsToday: 14, totalRuns: 892, errorRate: "0.0%", lastRun: "12 min ago",
  },
  {
    id: "ag_support", name: "Support Agent", type: "support", icon: "◎",
    color: "var(--success, #52d68a)", status: "active",
    description: "Triages tickets, drafts responses from knowledge base, escalates critical issues.",
    capabilities: ["Query triage", "Response drafting", "Escalation logic", "FAQ generation"],
    model: "claude-haiku-4-5-20251001", runsToday: 31, totalRuns: 2104, errorRate: "1.2%", lastRun: "3 min ago",
  },
  {
    id: "ag_marketing", name: "Marketing Agent", type: "marketing", icon: "◉",
    color: "var(--warning, #f0b429)", status: "idle",
    description: "Drafts email campaigns, social posts, ad copy, and landing page content.",
    capabilities: ["Email drafting", "Social copy", "Ad copy", "Campaign scheduling"],
    model: "claude-sonnet-4-6", runsToday: 8, totalRuns: 540, errorRate: "0.2%", lastRun: "34 min ago",
  },
  {
    id: "ag_content", name: "Content Agent", type: "content", icon: "◈",
    color: "var(--accent, #7c6fff)", status: "idle",
    description: "Writes blog posts, docs, case studies, newsletters. Enforces brand voice.",
    capabilities: ["Blog writing", "Documentation", "Newsletter drafting", "Brand voice"],
    model: "claude-sonnet-4-6", runsToday: 3, totalRuns: 210, errorRate: "0.0%", lastRun: "2h ago",
  },
  {
    id: "ag_sales", name: "Sales Agent", type: "sales", icon: "◇",
    color: "#da552f", status: "idle",
    description: "Qualifies leads, drafts outreach sequences, tracks pipeline movement.",
    capabilities: ["Lead qualification", "Outreach drafting", "Pipeline tracking", "Deal summaries"],
    model: "claude-sonnet-4-6", runsToday: 1, totalRuns: 78, errorRate: "0.0%", lastRun: "4h ago",
  },
];

const ROLE_TEMPLATES = [
  { id: "analyst",   label: "Data Analyst",    icon: "◉", description: "Analyzes data, generates reports, spots trends." },
  { id: "writer",    label: "Content Writer",  icon: "◈", description: "Writes content across formats and maintains brand voice." },
  { id: "support",   label: "Support Agent",   icon: "◎", description: "Handles queries, triages tickets, escalates issues." },
  { id: "outreach",  label: "Outreach Agent",  icon: "◇", description: "Qualifies leads, drafts sequences, tracks pipeline." },
  { id: "ops",       label: "Ops Agent",       icon: "⚡", description: "Executes workflows, monitors queues, alerts on errors." },
  { id: "custom",    label: "Custom",          icon: "⬡", description: "Blank slate — define your own role and capabilities." },
];

const CAPABILITY_OPTIONS = [
  "Web search", "Read CRM", "Write CRM", "Send WhatsApp", "Read analytics",
  "Write documents", "Read knowledge base", "Execute code", "Post to social",
  "Generate images", "Send email", "Read calendar", "Schedule tasks",
];

const COLLAB_EVENTS_SEED = [
  { id: 1, from: "SEO Agent",       to: "Content Agent",   type: "handoff", msg: "Keyword cluster ready — pass to content pipeline",   ts: Date.now() - 180_000 },
  { id: 2, from: "Content Agent",   to: "Marketing Agent", type: "trigger", msg: "Blog post published — trigger distribution campaign", ts: Date.now() - 120_000 },
  { id: 3, from: "Support Agent",   to: null,              type: "alert",   msg: "High-priority ticket escalated to human review",       ts: Date.now() - 60_000  },
  { id: 4, from: "Marketing Agent", to: null,              type: "done",    msg: "Email campaign dispatched to 142 contacts",           ts: Date.now() - 30_000  },
];

const AI_PROMPTS = [
  "Analyze my leads and tell me which to follow up with today",
  "Run the follow-up sequence for all new contacts",
  "Generate a weekly performance summary",
  "Which agents had errors in the last 24 hours?",
  "List the top 5 contacts by deal value",
];

// ── Toast ──────────────────────────────────────────────────────────────────────

function Toast({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="av2-toast-container" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`av2-toast av2-toast--${t.type}`}>{t.msg}</div>
      ))}
    </div>
  );
}

// ── Status chip ────────────────────────────────────────────────────────────────

function StatusChip({ status }) {
  const map = {
    active:  { cls: "av2-chip--running", label: "ACTIVE",  dot: true  },
    running: { cls: "av2-chip--running", label: "RUNNING", dot: true  },
    idle:    { cls: "av2-chip--idle",    label: "IDLE",    dot: false },
    paused:  { cls: "av2-chip--paused",  label: "PAUSED",  dot: false },
    error:   { cls: "av2-chip--error",   label: "ERROR",   dot: false },
  };
  const m = map[status] || map.idle;
  return (
    <span className={`av2-chip ${m.cls}`}>
      {m.dot && <span className="av2-chip-dot" />}
      {m.label}
    </span>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function Skel({ w, h }) {
  return <div className="av2-skeleton" style={{ width: w || "100%", height: h || 14, borderRadius: 6 }} />;
}

// ── Coming Soon Banner ─────────────────────────────────────────────────────────

function ComingSoon({ title, sub }) {
  return (
    <div className="av2-coming-soon">
      <span className="av2-coming-icon">◎</span>
      <div>
        <p className="av2-coming-title">{title} <span className="csb-beta-badge">BETA</span></p>
        <p className="av2-coming-sub">{sub}</p>
      </div>
    </div>
  );
}

// ── Agent Card ─────────────────────────────────────────────────────────────────

function AgentCard({ agent, onView, onRun, running }) {
  return (
    <div className="av2-agent-card">
      <div className="av2-card-top">
        <div className="av2-card-ident">
          <span className="av2-card-icon" style={{ color: agent.color }}>{agent.icon}</span>
          <div>
            <h3 className="av2-card-name">{agent.name}</h3>
            <p className="av2-card-type">{agent.type}</p>
          </div>
        </div>
        <StatusChip status={agent.status} />
      </div>

      <p className="av2-card-desc">{agent.description}</p>

      <div className="av2-card-stats">
        <span className="av2-stat"><span className="av2-stat-val">{agent.runsToday ?? 0}</span> <span className="av2-stat-label">today</span></span>
        <span className="av2-stat-sep">·</span>
        <span className="av2-stat"><span className="av2-stat-val">{agent.totalRuns ?? 0}</span> <span className="av2-stat-label">total</span></span>
        <span className="av2-stat-sep">·</span>
        <span className="av2-stat"><span className="av2-stat-val" style={{ color: parseFloat(agent.errorRate) > 0 ? "var(--danger, #f55b5b)" : "var(--success, #52d68a)" }}>{agent.errorRate ?? "0%"}</span> <span className="av2-stat-label">errors</span></span>
        {agent.lastRun && <><span className="av2-stat-sep">·</span><span className="av2-stat"><span className="av2-stat-label">Last:</span> {agent.lastRun}</span></>}
      </div>

      {agent.model && <p className="av2-card-model">{agent.model}</p>}

      <div className="av2-card-actions">
        <button className="av2-action-btn" onClick={() => onView(agent)}>View →</button>
        <button
          className="av2-action-btn av2-action-btn--run"
          onClick={() => onRun(agent)}
          disabled={running === agent.id}
        >
          {running === agent.id ? "Running…" : "▶ Run"}
        </button>
      </div>
    </div>
  );
}

// ── Agent Detail Drawer ────────────────────────────────────────────────────────

function AgentDrawer({ agent, onClose, onRun, running }) {
  const [taskInput, setTaskInput] = useState("");
  const [result, setResult] = useState(null);

  const submit = () => {
    if (!taskInput.trim()) return;
    onRun(agent, taskInput);
    setTaskInput("");
  };

  return (
    <div className="av2-drawer-overlay" onClick={e => e.target.classList.contains("av2-drawer-overlay") && onClose()}>
      <aside className="av2-drawer">
        <div className="av2-drawer-header">
          <span className="av2-drawer-icon" style={{ color: agent.color }}>{agent.icon}</span>
          <div>
            <h2 className="av2-drawer-name">{agent.name}</h2>
            <StatusChip status={agent.status} />
          </div>
          <button className="av2-drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <p className="av2-drawer-desc">{agent.description}</p>

        <section className="av2-drawer-section">
          <h3 className="av2-drawer-section-title">Capabilities</h3>
          <div className="av2-cap-list">
            {(agent.capabilities || []).map(c => (
              <span key={c} className="av2-cap-tag">{c}</span>
            ))}
          </div>
        </section>

        <section className="av2-drawer-section">
          <h3 className="av2-drawer-section-title">Stats</h3>
          <div className="av2-drawer-stats-grid">
            {[
              { label: "Runs today",  value: agent.runsToday ?? 0    },
              { label: "Total runs",  value: agent.totalRuns ?? 0    },
              { label: "Error rate",  value: agent.errorRate ?? "0%" },
              { label: "Model",       value: agent.model || "—"      },
            ].map(s => (
              <div key={s.label} className="av2-stat-row">
                <span className="av2-stat-key">{s.label}</span>
                <span className="av2-stat-vl">{s.value}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="av2-drawer-section">
          <h3 className="av2-drawer-section-title">Run Task</h3>
          <textarea
            className="av2-input av2-textarea"
            placeholder="Describe what this agent should do…"
            value={taskInput}
            onChange={e => setTaskInput(e.target.value)}
            rows={3}
          />
          <button
            className="av2-btn av2-btn--primary"
            onClick={submit}
            disabled={running === agent.id || !taskInput.trim()}
            style={{ marginTop: 8, width: "100%" }}
          >
            {running === agent.id ? "Running…" : "▶ Execute"}
          </button>
        </section>
      </aside>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// TAB: AGENT CENTER (overview)
// ──────────────────────────────────────────────────────────────────────────────

function TabCenter({ agents, opsData, stats, loading, onNavigate }) {
  const activeCount  = agents.filter(a => a.status === "active" || a.status === "running").length;
  const running      = opsData?.queue?.counts?.running ?? 0;
  const pending      = opsData?.queue?.counts?.pending ?? 0;
  const completed    = opsData?.queue?.counts?.completed ?? 0;
  const totalRuns    = agents.reduce((s, a) => s + (a.runsToday ?? 0), 0);
  const errorAgents  = agents.filter(a => a.status === "error").length;

  return (
    <div className="av2-tab-content">
      {/* Summary strip */}
      <div className="av2-overview-strip">
        {[
          { label: "Active agents",    val: `${activeCount} / ${agents.length}`, color: "var(--success)" },
          { label: "Runs today",       val: totalRuns,                           color: "var(--accent)"  },
          { label: "Tasks running",    val: running,                             color: "var(--warning)" },
          { label: "Queue pending",    val: pending,                             color: "var(--text-dim)"},
          { label: "Completed",        val: completed,                           color: "var(--success)" },
          { label: "Error agents",     val: errorAgents,                        color: errorAgents > 0 ? "var(--danger)" : "var(--text-faint)" },
        ].map(s => (
          <div key={s.label} className="av2-overview-stat">
            <span className="av2-ov-val" style={{ color: s.color }}>{s.val}</span>
            <span className="av2-ov-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Agent grid */}
      <div className="av2-ov-grid">
        {loading ? (
          [0, 1, 2, 3].map(i => (
            <div key={i} className="av2-agent-card av2-agent-card--skel">
              <Skel w="60%" h={16} />
              <Skel w="100%" h={12} />
              <Skel w="80%" h={12} />
            </div>
          ))
        ) : agents.slice(0, 4).map(a => (
          <div key={a.id} className="av2-agent-card av2-agent-card--mini">
            <div className="av2-card-top">
              <span className="av2-card-icon av2-card-icon--sm" style={{ color: a.color }}>{a.icon}</span>
              <span className="av2-card-name">{a.name}</span>
              <StatusChip status={a.status} />
            </div>
            <p className="av2-card-mini-stat">{a.runsToday ?? 0} runs today · {a.errorRate ?? "0%"} errors</p>
          </div>
        ))}
      </div>

      {/* Memory + Uptime */}
      {opsData && (
        <div className="av2-ov-sys">
          <h3 className="av2-ov-sys-title">System Health</h3>
          <div className="av2-ov-sys-rows">
            {[
              { label: "Memory", value: opsData.memory?.current?.heap_mb ? `${opsData.memory.current.heap_mb} MB` : "—" },
              { label: "Uptime", value: opsData.uptime?.seconds ? `${Math.floor(opsData.uptime.seconds / 3600)}h` : "—" },
              { label: "DLQ",    value: `${opsData.queue?.dlq ?? 0} tasks` },
            ].map(r => (
              <div key={r.label} className="av2-sys-row">
                <span className="av2-sys-label">{r.label}</span>
                <span className="av2-sys-val">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// TAB: REGISTRY
// ──────────────────────────────────────────────────────────────────────────────

function TabRegistry({ agents, onNavigate, onRun, running, onView }) {
  const [search,   setSearch]   = useState("");
  const [typeF,    setTypeF]    = useState("all");
  const [statusF,  setStatusF]  = useState("all");

  const types    = ["all", ...new Set(agents.map(a => a.type))];
  const statuses = ["all", "active", "idle", "paused", "error"];

  const filtered = useMemo(() => agents.filter(a => {
    const q = search.toLowerCase();
    const matchQ = !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.type.includes(q);
    return matchQ && (typeF === "all" || a.type === typeF) && (statusF === "all" || a.status === statusF);
  }), [agents, search, typeF, statusF]);

  return (
    <div className="av2-tab-content">
      {/* Toolbar */}
      <div className="av2-registry-toolbar">
        <div className="av2-search-wrap">
          <span className="av2-search-icon">⌕</span>
          <input className="av2-search" placeholder="Search agents…" value={search}
            onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="av2-filter-group">
          <select className="av2-filter-select" value={typeF} onChange={e => setTypeF(e.target.value)}>
            {types.map(t => <option key={t} value={t}>{t === "all" ? "All types" : t}</option>)}
          </select>
          <select className="av2-filter-select" value={statusF} onChange={e => setStatusF(e.target.value)}>
            {statuses.map(s => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}
          </select>
        </div>
      </div>

      {/* Agent list */}
      <div className="av2-registry-list">
        {filtered.length === 0 ? (
          <div className="av2-empty">
            <div className="av2-empty-icon">◎</div>
            <p className="av2-empty-title">No agents match your search</p>
            <button className="av2-btn av2-btn--ghost" onClick={() => { setSearch(""); setTypeF("all"); setStatusF("all"); }}>Clear filters</button>
          </div>
        ) : filtered.map(a => (
          <AgentCard key={a.id} agent={a} onView={onView} onRun={onRun} running={running} />
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// TAB: RUNNING
// ──────────────────────────────────────────────────────────────────────────────

function TabRunning({ agents, opsData, history, onRun, running }) {
  const activeAgents = agents.filter(a => a.status === "active" || a.status === "running");
  const qRunning     = opsData?.queue?.counts?.running ?? 0;
  const qPending     = opsData?.queue?.counts?.pending ?? 0;

  return (
    <div className="av2-tab-content">
      <div className="av2-running-header">
        <span className="av2-running-dot dot--ok dot--live" />
        <span className="av2-running-label">Live · {activeAgents.length} agents active · {qRunning} tasks running · {qPending} queued</span>
      </div>

      {activeAgents.length === 0 ? (
        <div className="av2-empty">
          <div className="av2-empty-icon">◎</div>
          <p className="av2-empty-title">No agents currently running</p>
          <p className="av2-empty-sub">Switch to Registry to activate an agent.</p>
        </div>
      ) : (
        <div className="av2-running-list">
          {activeAgents.map(a => (
            <div key={a.id} className="av2-running-row">
              <span className="av2-running-agent-dot" style={{ background: a.color }} />
              <div className="av2-running-info">
                <span className="av2-running-name">{a.name}</span>
                <span className="av2-running-meta">{a.runsToday ?? 0} runs today · Last: {a.lastRun}</span>
              </div>
              <StatusChip status={a.status} />
              <button className="av2-action-btn av2-action-btn--run" onClick={() => onRun(a)} disabled={running === a.id}>
                {running === a.id ? "Running…" : "▶ Run"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Recent history */}
      {history.length > 0 && (
        <div className="av2-run-history">
          <h3 className="av2-run-history-title">Recent Executions</h3>
          {history.slice(0, 8).map((h, i) => (
            <div key={i} className="av2-history-row">
              <span className="av2-history-ts">{_timeAgo(h.timestamp || h.ts)}</span>
              <span className="av2-history-input">{(h.input || h.action || "Task").slice(0, 60)}</span>
              <span className={`av2-history-status av2-history-status--${h.status || "ok"}`}>
                {h.status === "error" ? "ERROR" : "OK"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// TAB: FACTORY
// ──────────────────────────────────────────────────────────────────────────────

function TabFactory({ onAgentCreated, toast }) {
  const [step,         setStep]        = useState(1);
  const [template,     setTemplate]    = useState(null);
  const [name,         setName]        = useState("");
  const [desc,         setDesc]        = useState("");
  const [caps,         setCaps]        = useState([]);
  const [creating,     setCreating]    = useState(false);
  const [done,         setDone]        = useState(false);

  const toggleCap = (c) => setCaps(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  const create = async () => {
    if (!name.trim()) { toast("error", "Agent name is required."); return; }
    setCreating(true);
    try {
      const spec = { name: name.trim(), description: desc, template: template?.id || "custom", capabilities: caps };
      await createManagedAgent(spec);
      setDone(true);
      onAgentCreated?.(spec);
      toast("success", `Agent "${name}" created!`);
    } catch (e) {
      toast("error", e.message || "Failed to create agent.");
    } finally { setCreating(false); }
  };

  const resetForm = () => { setStep(1); setTemplate(null); setName(""); setDesc(""); setCaps([]); setDone(false); };

  if (done) return (
    <div className="av2-tab-content av2-factory-done">
      <div className="av2-factory-success">
        <span className="av2-factory-success-icon">✓</span>
        <h3 className="av2-factory-success-title">Agent created</h3>
        <p className="av2-factory-success-sub">"{name}" is being provisioned and will appear in the Registry shortly.</p>
        <button className="av2-btn av2-btn--primary" onClick={resetForm}>Create another</button>
      </div>
    </div>
  );

  return (
    <div className="av2-tab-content">
      {/* Step indicator */}
      <div className="av2-wizard-steps">
        {["Template", "Configure", "Capabilities", "Review"].map((s, i) => (
          <div key={s} className={`av2-wizard-step${step === i + 1 ? " av2-wizard-step--active" : ""}${step > i + 1 ? " av2-wizard-step--done" : ""}`}>
            <span className="av2-wizard-step-num">{step > i + 1 ? "✓" : i + 1}</span>
            <span className="av2-wizard-step-label">{s}</span>
          </div>
        ))}
      </div>

      {/* Step 1: Template */}
      {step === 1 && (
        <div className="av2-factory-step">
          <h3 className="av2-factory-step-title">Choose a role template</h3>
          <div className="av2-template-grid">
            {ROLE_TEMPLATES.map(t => (
              <button
                key={t.id}
                className={`av2-template-card${template?.id === t.id ? " av2-template-card--selected" : ""}`}
                onClick={() => setTemplate(t)}
              >
                <span className="av2-template-icon">{t.icon}</span>
                <span className="av2-template-label">{t.label}</span>
                <span className="av2-template-desc">{t.description}</span>
              </button>
            ))}
          </div>
          <button className="av2-btn av2-btn--primary" disabled={!template} onClick={() => setStep(2)}>
            Next →
          </button>
        </div>
      )}

      {/* Step 2: Configure */}
      {step === 2 && (
        <div className="av2-factory-step">
          <h3 className="av2-factory-step-title">Configure your agent</h3>
          <label className="av2-label">Agent Name <span className="av2-req">*</span></label>
          <input className="av2-input" placeholder="e.g. My SEO Agent" value={name}
            onChange={e => setName(e.target.value)} autoFocus />
          <label className="av2-label" style={{ marginTop: 10 }}>Description</label>
          <textarea className="av2-input av2-textarea" placeholder="What will this agent do…"
            value={desc} onChange={e => setDesc(e.target.value)} rows={3} />
          <div className="av2-factory-nav">
            <button className="av2-btn av2-btn--ghost" onClick={() => setStep(1)}>← Back</button>
            <button className="av2-btn av2-btn--primary" onClick={() => setStep(3)}>Next →</button>
          </div>
        </div>
      )}

      {/* Step 3: Capabilities */}
      {step === 3 && (
        <div className="av2-factory-step">
          <h3 className="av2-factory-step-title">Select capabilities</h3>
          <div className="av2-cap-selector">
            {CAPABILITY_OPTIONS.map(c => (
              <button
                key={c}
                className={`av2-cap-opt${caps.includes(c) ? " av2-cap-opt--selected" : ""}`}
                onClick={() => toggleCap(c)}
              >{c}</button>
            ))}
          </div>
          <div className="av2-factory-nav">
            <button className="av2-btn av2-btn--ghost" onClick={() => setStep(2)}>← Back</button>
            <button className="av2-btn av2-btn--primary" onClick={() => setStep(4)}>Next →</button>
          </div>
        </div>
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <div className="av2-factory-step">
          <h3 className="av2-factory-step-title">Review & create</h3>
          <div className="av2-factory-review">
            <div className="av2-review-row"><span className="av2-review-key">Template</span><span>{template?.label}</span></div>
            <div className="av2-review-row"><span className="av2-review-key">Name</span><span>{name || "—"}</span></div>
            <div className="av2-review-row"><span className="av2-review-key">Description</span><span>{desc || "—"}</span></div>
            <div className="av2-review-row"><span className="av2-review-key">Capabilities</span><span>{caps.length > 0 ? caps.join(", ") : "None"}</span></div>
          </div>
          <div className="av2-factory-nav">
            <button className="av2-btn av2-btn--ghost" onClick={() => setStep(3)}>← Back</button>
            <button className="av2-btn av2-btn--primary" onClick={create} disabled={creating || !name.trim()}>
              {creating ? "Creating…" : "Create Agent →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// TAB: COLLABORATION
// ──────────────────────────────────────────────────────────────────────────────

const EVENT_TYPE_META = {
  handoff:  { icon: "→", color: "var(--accent2)" },
  trigger:  { icon: "⚡", color: "var(--warning)" },
  alert:    { icon: "⚠", color: "var(--danger)"  },
  done:     { icon: "✓", color: "var(--success)"  },
};

function TabCollaboration({ agents }) {
  const [events, setEvents] = useState(COLLAB_EVENTS_SEED);

  // Simulate live feed (add a new event every 15s from active agents)
  useEffect(() => {
    const activeAgents = agents.filter(a => a.status === "active");
    if (!activeAgents.length) return;
    const id = setInterval(() => {
      const a = activeAgents[Math.floor(Math.random() * activeAgents.length)];
      setEvents(prev => [
        {
          id: Date.now(),
          from: a.name,
          to: null,
          type: "done",
          msg: `Completed scheduled task (${a.runsToday ?? 0} runs today)`,
          ts: Date.now(),
        },
        ...prev.slice(0, 29),
      ]);
    }, 15_000);
    return () => clearInterval(id);
  }, [agents]);

  const activeCount = agents.filter(a => a.status === "active").length;

  return (
    <div className="av2-tab-content">
      {/* Session overview */}
      <div className="av2-collab-header">
        <div className="av2-collab-session">
          <span className="av2-session-dot dot--ok dot--live" />
          <span className="av2-session-label">Active session · {activeCount} agents online</span>
        </div>
      </div>

      {/* Agent mesh */}
      <div className="av2-collab-mesh">
        {agents.slice(0, 5).map((a, i) => (
          <div key={a.id} className="av2-mesh-node" style={{ '--node-color': a.color }}>
            <span className="av2-mesh-icon" style={{ color: a.color }}>{a.icon}</span>
            <span className="av2-mesh-name">{a.name.replace(" Agent", "")}</span>
            <StatusChip status={a.status} />
          </div>
        ))}
      </div>

      {/* Event stream */}
      <div className="av2-collab-stream">
        <div className="av2-stream-header">
          <h3 className="av2-stream-title">Event Stream</h3>
          <span className="av2-stream-count">{events.length} events</span>
        </div>
        <div className="av2-stream-list">
          {events.map(e => {
            const meta = EVENT_TYPE_META[e.type] || EVENT_TYPE_META.done;
            return (
              <div key={e.id} className="av2-stream-row">
                <span className="av2-stream-icon" style={{ color: meta.color }}>{meta.icon}</span>
                <div className="av2-stream-body">
                  <div className="av2-stream-agents">
                    <span className="av2-stream-from">{e.from}</span>
                    {e.to && <><span className="av2-stream-arrow">→</span><span className="av2-stream-to">{e.to}</span></>}
                  </div>
                  <p className="av2-stream-msg">{e.msg}</p>
                </div>
                <span className="av2-stream-ts">{_timeAgo(new Date(e.ts).toISOString())}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// TAB: INTELLIGENCE (AI Chat)
// ──────────────────────────────────────────────────────────────────────────────

const CHAT_KEY = "av2_chat_history";

function TabIntelligence({ online }) {
  const [messages, setMessages] = useState(() => _load(CHAT_KEY, []));
  const [input,    setInput]    = useState("");
  const [thinking, setThinking] = useState(false);
  const [aiStatus, setAiStatus] = useState(online ? "online" : "offline");
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);

  useEffect(() => {
    checkHealth().then(h => setAiStatus(h ? "online" : "offline")).catch(() => setAiStatus("offline"));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const send = useCallback(async (text) => {
    const txt = (text || input).trim();
    if (!txt || thinking) return;
    const userMsg = { role: "user", text: txt, ts: Date.now() };
    setMessages(prev => { const n = [...prev, userMsg]; _save(CHAT_KEY, n.slice(-60)); return n; });
    setInput("");
    setThinking(true);

    try {
      const res = await sendMessage(txt, "smart");
      const botMsg = { role: "jarvis", text: res?.reply || res?.output || "Done.", ts: Date.now() };
      setMessages(prev => { const n = [...prev, botMsg]; _save(CHAT_KEY, n.slice(-60)); return n; });
    } catch (e) {
      const errMsg = { role: "jarvis", text: `Error: ${e.message}`, ts: Date.now(), error: true };
      setMessages(prev => { const n = [...prev, errMsg]; _save(CHAT_KEY, n.slice(-60)); return n; });
    } finally { setThinking(false); }
  }, [input, thinking]);

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const clearChat = () => { setMessages([]); _save(CHAT_KEY, []); };

  const showSuggestions = messages.length <= 1;

  return (
    <div className="av2-tab-content av2-chat-root">
      {/* Chat header */}
      <div className="av2-chat-topbar">
        <div className="av2-chat-title-block">
          <span className="av2-chat-avatar">⬡</span>
          <div>
            <h3 className="av2-chat-title">Jarvis</h3>
            <span className="av2-chat-subtitle">Natural language command interface</span>
          </div>
        </div>
        <div className="av2-chat-status-block">
          <span className={`av2-status-dot dot--${aiStatus === "online" ? "ok" : "warn"} dot--live`} />
          <span className="av2-chat-status-label">{aiStatus === "online" ? "Online" : "Offline"}</span>
          {messages.length > 0 && (
            <button className="av2-chat-clear" onClick={clearChat} title="Clear chat">Clear</button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="av2-chat-messages">
        {messages.length === 0 && (
          <div className="av2-chat-welcome">
            <div className="av2-chat-welcome-icon">⬡</div>
            <h3 className="av2-chat-welcome-title">Jarvis AI</h3>
            <p className="av2-chat-welcome-sub">Ask me anything about your business or give me a task to execute.</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`av2-msg av2-msg--${m.role}${m.error ? " av2-msg--error" : ""}`}>
            {m.role === "jarvis" && <span className="av2-msg-avatar">⬡</span>}
            <div className="av2-msg-bubble">
              <p className="av2-msg-text">{m.text}</p>
              <span className="av2-msg-ts">{_fmtTime(new Date(m.ts).toISOString())}</span>
            </div>
          </div>
        ))}

        {thinking && (
          <div className="av2-msg av2-msg--jarvis">
            <span className="av2-msg-avatar">⬡</span>
            <div className="av2-msg-bubble av2-msg-bubble--thinking">
              <span className="av2-thinking-dots">
                <span /><span /><span />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggested prompts */}
      {showSuggestions && (
        <div className="av2-chat-suggestions">
          {AI_PROMPTS.map((p, i) => (
            <button key={i} className="av2-suggestion-chip" onClick={() => send(p)}>{p}</button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="av2-chat-input-area">
        <textarea
          ref={inputRef}
          className="av2-chat-input"
          placeholder="Type a command or question…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          rows={1}
          disabled={thinking}
        />
        <button
          className="av2-chat-send"
          onClick={() => send()}
          disabled={!input.trim() || thinking}
          aria-label="Send"
        >▶</button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// TAB: ACTIONS (Orchestrator / Emergency)
// ──────────────────────────────────────────────────────────────────────────────

function TabActions({ opsData, online, history, toast }) {
  const [stopping,    setStopping]    = useState(false);
  const [resuming,    setResuming]    = useState(false);
  const [emergActive, setEmergActive] = useState(false);

  useEffect(() => {
    setEmergActive(opsData?.emergencyStop?.active ?? false);
  }, [opsData]);

  const handleStop = async () => {
    if (!window.confirm("This will halt all running agents and queue processing. Continue?")) return;
    setStopping(true);
    try {
      await emergencyStop("operator-triggered");
      setEmergActive(true);
      toast("error", "Emergency stop activated. All execution halted.");
    } catch (e) { toast("error", e.message || "Failed to stop."); }
    finally     { setStopping(false); }
  };

  const handleResume = async () => {
    setResuming(true);
    try {
      await emergencyResume();
      setEmergActive(false);
      toast("success", "Execution resumed.");
    } catch (e) { toast("error", e.message || "Failed to resume."); }
    finally     { setResuming(false); }
  };

  const queue  = opsData?.queue || {};
  const uptime = opsData?.uptime?.seconds ?? 0;
  const uptimeH = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

  return (
    <div className="av2-tab-content">
      {/* Emergency banner */}
      {emergActive && (
        <div className="av2-emerg-banner">
          <span className="av2-emerg-icon">⚠</span>
          <div>
            <p className="av2-emerg-title">Emergency Stop Active</p>
            <p className="av2-emerg-sub">All agents and queue processing are halted. Resume when safe.</p>
          </div>
        </div>
      )}

      {/* Execution status */}
      <section className="av2-actions-panel">
        <h3 className="av2-actions-panel-title">Execution Status</h3>
        <div className="av2-status-grid">
          {[
            { label: "System",    value: emergActive ? "EMERGENCY STOP" : online ? "RUNNING NORMALLY" : "OFFLINE", color: emergActive ? "var(--danger)" : online ? "var(--success)" : "var(--warning)" },
            { label: "Running",   value: queue.counts?.running ?? 0, color: "var(--warning)" },
            { label: "Queued",    value: queue.counts?.pending ?? 0, color: "var(--text-dim)" },
            { label: "Completed", value: queue.counts?.completed ?? 0, color: "var(--success)" },
            { label: "Failed",    value: queue.counts?.failed ?? 0, color: (queue.counts?.failed ?? 0) > 0 ? "var(--danger)" : "var(--text-faint)" },
            { label: "Uptime",    value: uptimeH, color: "var(--text)" },
          ].map(s => (
            <div key={s.label} className="av2-status-cell">
              <span className="av2-status-label">{s.label}</span>
              <span className="av2-status-value" style={{ color: s.color }}>{s.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Emergency controls */}
      <section className="av2-actions-panel">
        <h3 className="av2-actions-panel-title">Emergency Controls</h3>
        <div className="av2-emergency-grid">
          <div className={`av2-emergency-card${emergActive ? " av2-emergency-card--active" : ""}`}>
            <h4 className="av2-ec-title">⏹ Emergency Stop</h4>
            <p className="av2-ec-desc">Halts all agents, clears queue, prevents new task execution.</p>
            <button
              className="av2-btn av2-btn--danger"
              onClick={handleStop}
              disabled={stopping || emergActive}
            >
              {emergActive ? "Stop Active" : stopping ? "Stopping…" : "Confirm and Stop"}
            </button>
          </div>

          <div className="av2-emergency-card">
            <h4 className="av2-ec-title">▶ Resume Execution</h4>
            <p className="av2-ec-desc">Clears emergency mode and restores normal agent operation.</p>
            <button
              className="av2-btn av2-btn--primary"
              onClick={handleResume}
              disabled={resuming || !emergActive}
            >
              {resuming ? "Resuming…" : "Resume"}
            </button>
          </div>
        </div>
      </section>

      {/* Audit trail */}
      <section className="av2-actions-panel">
        <h3 className="av2-actions-panel-title">Execution Audit Trail</h3>
        {history.length === 0 ? (
          <div className="av2-empty-inline">No execution history available.</div>
        ) : (
          <div className="av2-audit-list">
            {history.slice(0, 20).map((h, i) => (
              <div key={i} className="av2-audit-row">
                <span className="av2-audit-ts">{_timeAgo(h.timestamp || h.ts)}</span>
                <span className="av2-audit-input">{(h.input || h.action || "Task").slice(0, 64)}</span>
                <span className={`av2-audit-status av2-audit-status--${h.status === "error" ? "error" : "ok"}`}>
                  {h.status === "error" ? "ERROR" : "OK"}
                </span>
                {h.duration_ms && <span className="av2-audit-dur">{h.duration_ms}ms</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// ROOT: Agent OS V2
// ──────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "center",    label: "Overview"      },
  { id: "registry",  label: "Registry"      },
  { id: "running",   label: "Running"       },
  { id: "factory",   label: "Factory"       },
  { id: "collab",    label: "Collaboration" },
  { id: "intel",     label: "Intelligence"  },
  { id: "actions",   label: "Actions"       },
];

const AGENTS_KEY = "av2_agent_registry";

export default function AgentOSV2({ onNavigate, online = false }) {
  const [activeTab,  setActiveTab]  = useState("center");
  const [agents,     setAgents]     = useState(() => _load(AGENTS_KEY, SEED_AGENTS));
  const [opsData,    setOpsData]    = useState(null);
  const [stats,      setStats]      = useState(null);
  const [history,    setHistory]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [runningId,  setRunningId]  = useState(null);
  const [drawer,     setDrawer]     = useState(null);
  const [toasts,     setToasts]     = useState([]);

  const toast = useCallback((type, msg) => {
    const id = Date.now();
    setToasts(t => [...t, { id, type, msg }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ops, st, hist, agentRes] = await Promise.all([
        getOpsData(), getStats(), getRuntimeHistory(40), listAgents(),
      ]);
      setOpsData(ops);
      setStats(st);
      if (Array.isArray(hist)) setHistory(hist);
      const live = agentRes?.agents;
      if (Array.isArray(live) && live.length > 0) {
        setAgents(live);
        _save(AGENTS_KEY, live);
      }
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleRun = useCallback(async (agent, taskInput) => {
    setRunningId(agent.id);
    try {
      const input = taskInput || `run ${agent.name}`;
      const res = await executeAgentTask(agent.id, input);
      if (res?.success === false) {
        toast("error", res.error || "Task failed.");
      } else {
        toast("success", `${agent.name} task dispatched.`);
        setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, runsToday: (a.runsToday || 0) + 1 } : a));
      }
    } catch (e) { toast("error", e.message || "Execution error."); }
    finally     { setRunningId(null); }
  }, [toast]);

  const activeCount  = agents.filter(a => a.status === "active" || a.status === "running").length;
  const runningCount = agents.filter(a => a.status === "running").length;

  return (
    <div className="av2-root page-enter">
      <Toast toasts={toasts} />

      {/* Header */}
      <div className="av2-header">
        <div className="av2-header-left">
          <h1 className="av2-page-title">Agents</h1>
          <p className="av2-page-sub">
            {agents.length} agents configured · {activeCount} active
            {runningCount > 0 ? ` · ${runningCount} running` : ""}
          </p>
        </div>
        <div className="av2-header-right">
          <button className="av2-refresh-btn" onClick={refresh} title="Refresh">↻ Refresh</button>
          <button className="av2-btn av2-btn--ghost av2-btn--sm" onClick={() => setActiveTab("factory")}>
            + New Agent
          </button>
        </div>
      </div>

      {/* Sub-tab nav */}
      <div className="av2-subnav" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`av2-subnav-tab${activeTab === t.id ? " av2-subnav-tab--active" : ""}`}
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
            {t.id === "running" && activeCount > 0 && (
              <span className="av2-subnav-badge">{activeCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "center"   && <TabCenter   agents={agents} opsData={opsData} stats={stats} loading={loading} onNavigate={onNavigate} />}
      {activeTab === "registry" && <TabRegistry  agents={agents} onRun={handleRun} running={runningId} onView={setDrawer} onNavigate={onNavigate} />}
      {activeTab === "running"  && <TabRunning   agents={agents} opsData={opsData} history={history} onRun={handleRun} running={runningId} />}
      {activeTab === "factory"  && <TabFactory   onAgentCreated={() => refresh()} toast={toast} />}
      {activeTab === "collab"   && <TabCollaboration agents={agents} />}
      {activeTab === "intel"    && <TabIntelligence online={online} />}
      {activeTab === "actions"  && <TabActions    opsData={opsData} online={online} history={history} toast={toast} />}

      {/* Agent detail drawer */}
      {drawer && (
        <AgentDrawer
          agent={drawer}
          onClose={() => setDrawer(null)}
          onRun={handleRun}
          running={runningId}
        />
      )}
    </div>
  );
}
