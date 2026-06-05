import React, { useState, useCallback, useEffect } from "react";
import { track } from "../analytics";
import { listAgents, getAgentHistory } from "../phase18Api";
import "./TaskRouterCenter.css";

const TASKS_KEY = "ooplix_router_tasks";
function _load(k, fb) { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(fb)); } catch { return fb; } }
function _save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

// ── Agents available for assignment ──────────────────────────────────
const AGENTS = [
  { id: "ag_seo",       name: "SEO Agent",       icon: "⌕", color: "var(--accent2)" },
  { id: "ag_marketing", name: "Marketing Agent",  icon: "◉", color: "var(--warning)" },
  { id: "ag_content",   name: "Content Agent",    icon: "◈", color: "var(--accent)"  },
  { id: "ag_support",   name: "Support Agent",    icon: "◎", color: "#52d68a"        },
  { id: "ag_sales",     name: "Sales Agent",      icon: "◇", color: "#da552f"        },
  { id: "ag_dev",       name: "Dev Agent",        icon: "⬡", color: "#e6edf3"        },
  { id: "ag_devops",    name: "DevOps Agent",     icon: "⬟", color: "#fc6d26"        },
  { id: "ag_research",  name: "Research Agent",   icon: "⊕", color: "#a78bfa"        },
  { id: "ag_analytics", name: "Analytics Agent",  icon: "▣", color: "#38bdf8"        },
];

// ── Seed tasks ────────────────────────────────────────────────────────
const SEED_TASKS = [
  { id: "rt1", title: "Generate meta descriptions for Phase 10 blog post",     priority: "high",     status: "completed",  agentId: "ag_seo",       category: "seo",        createdAt: "10:02", completedAt: "10:14", result: "5 meta descriptions generated. Avg length 148 chars. Keyword density 2.1%.", escalated: false },
  { id: "rt2", title: "Triage 3 inbound support tickets",                      priority: "critical", status: "completed",  agentId: "ag_support",   category: "support",    createdAt: "10:08", completedAt: "10:11", result: "Tickets #1021, #1022 resolved. #1023 escalated to human — billing issue.", escalated: true  },
  { id: "rt3", title: "Draft LinkedIn post about Phase 9 AI OS release",       priority: "medium",   status: "in_progress",agentId: "ag_marketing", category: "marketing",  createdAt: "10:15", completedAt: null,    result: null, escalated: false },
  { id: "rt4", title: "Analyse keyword gap vs competitors",                    priority: "medium",   status: "queued",     agentId: "ag_seo",       category: "seo",        createdAt: "10:18", completedAt: null,    result: null, escalated: false },
  { id: "rt5", title: "Write blog post: WhatsApp Automation for Agencies",    priority: "high",     status: "queued",     agentId: "ag_content",   category: "content",    createdAt: "10:20", completedAt: null,    result: null, escalated: false },
  { id: "rt6", title: "Check deploy health after v9.4.0 push",                priority: "critical", status: "completed",  agentId: "ag_devops",    category: "devops",     createdAt: "09:58", completedAt: "09:59", result: "All services nominal. No error rate spike. Deploy confirmed healthy.", escalated: false },
  { id: "rt7", title: "Qualify 5 new leads from yesterday sign-ups",          priority: "high",     status: "in_progress",agentId: "ag_sales",     category: "sales",      createdAt: "10:10", completedAt: null,    result: null, escalated: false },
  { id: "rt8", title: "Research: top 10 Indian SaaS automation tools",        priority: "low",      status: "queued",     agentId: "ag_research",  category: "research",   createdAt: "10:22", completedAt: null,    result: null, escalated: false },
  { id: "rt9", title: "Weekly analytics summary report",                      priority: "medium",   status: "completed",  agentId: "ag_analytics", category: "analytics",  createdAt: "09:00", completedAt: "09:05", result: "7-day summary: 142 leads, ₹34.2K revenue, 18% conv rate. Down 4% WoW.", escalated: false },
  { id: "rt10",title: "Review PR #48: DevOps monitoring improvements",        priority: "medium",   status: "queued",     agentId: "ag_dev",       category: "engineering",createdAt: "10:25", completedAt: null,    result: null, escalated: false },
];

const PRI_COLORS  = { critical: "var(--danger)", high: "var(--warning)", medium: "var(--accent2)", low: "var(--text-faint)" };
const STA_COLORS  = { completed: "var(--success)", in_progress: "var(--accent2)", queued: "var(--text-faint)", failed: "var(--danger)" };

function agentById(id) { return AGENTS.find(a => a.id === id); }

function TaskRow({ task, selected, onSelect }) {
  const agent = agentById(task.agentId);
  return (
    <button className={`trc-task-row${selected ? " trc-task-row--sel" : ""}`} onClick={() => onSelect(task.id)}>
      <div className="trc-task-left">
        <span className="trc-pri-dot" style={{ background: PRI_COLORS[task.priority] }} />
        <div className="trc-task-info">
          <span className="trc-task-title">{task.title}</span>
          <span className="trc-task-cat">{task.category} · {task.createdAt}</span>
        </div>
      </div>
      <div className="trc-task-right">
        {agent && (
          <span className="trc-agent-chip" style={{ color: agent.color, borderColor: agent.color + "33" }}>
            {agent.icon} {agent.name}
          </span>
        )}
        <span className="trc-status-badge" style={{ color: STA_COLORS[task.status], borderColor: STA_COLORS[task.status] + "33" }}>
          {task.status.replace("_"," ")}
        </span>
        {task.escalated && <span className="trc-escalated-badge">escalated</span>}
      </div>
    </button>
  );
}

function FlowVisualiser({ task }) {
  const agent = agentById(task.agentId);
  const steps = [
    { label: "Task received",  done: true,                                          detail: task.createdAt },
    { label: "Routed to agent",done: true,                                          detail: agent?.name    },
    { label: "Processing",     done: task.status !== "queued",                      detail: task.status === "in_progress" ? "In progress…" : task.completedAt || "" },
    { label: "Result",         done: task.status === "completed" || task.status === "failed", detail: task.result ? "Available" : "Pending" },
  ];
  return (
    <div className="trc-flow">
      {steps.map((s, i) => (
        <React.Fragment key={s.label}>
          <div className={`trc-flow-node${s.done ? " trc-flow-node--done" : ""}`}>
            <div className="trc-flow-dot" style={{ background: s.done ? "var(--success)" : "rgba(255,255,255,0.12)" }} />
            <div className="trc-flow-label-block">
              <span className="trc-flow-label">{s.label}</span>
              {s.detail && <span className="trc-flow-detail">{s.detail}</span>}
            </div>
          </div>
          {i < steps.length - 1 && <div className={`trc-flow-line${s.done ? " trc-flow-line--done" : ""}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function TaskDetail({ task, agents, onReassign, onEscalate }) {
  const [reassigning, setReassigning] = useState(false);
  const agent = agentById(task.agentId);

  return (
    <div className="trc-detail">
      <div className="trc-detail-header">
        <span className="trc-detail-title">{task.title}</span>
        <div className="trc-detail-badges">
          <span className="trc-pri-badge" style={{ color: PRI_COLORS[task.priority], borderColor: PRI_COLORS[task.priority] + "33" }}>{task.priority}</span>
          <span className="trc-sta-badge" style={{ color: STA_COLORS[task.status], borderColor: STA_COLORS[task.status] + "33" }}>{task.status.replace("_"," ")}</span>
        </div>
      </div>

      <div className="trc-detail-meta">
        <span className="trc-dml">Category</span><span className="trc-dmv">{task.category}</span>
        <span className="trc-dml">Created</span><span className="trc-dmv">{task.createdAt}</span>
        {task.completedAt && <><span className="trc-dml">Completed</span><span className="trc-dmv">{task.completedAt}</span></>}
        <span className="trc-dml">Escalated</span><span className="trc-dmv" style={{ color: task.escalated ? "var(--danger)" : "var(--success)" }}>{task.escalated ? "Yes" : "No"}</span>
      </div>

      <div className="trc-detail-section">
        <p className="trc-ds-label">Task → Agent → Result</p>
        <FlowVisualiser task={task} />
      </div>

      {agent && (
        <div className="trc-detail-section">
          <p className="trc-ds-label">Assigned agent</p>
          <div className="trc-assigned-agent" style={{ borderColor: agent.color + "33" }}>
            <span className="trc-aa-icon" style={{ color: agent.color }}>{agent.icon}</span>
            <span className="trc-aa-name">{agent.name}</span>
          </div>
        </div>
      )}

      {task.result && (
        <div className="trc-detail-section">
          <p className="trc-ds-label">Result</p>
          <div className="trc-result-box">{task.result}</div>
        </div>
      )}

      {task.status !== "completed" && (
        <div className="trc-detail-actions">
          {reassigning ? (
            <div className="trc-reassign-picker">
              <p className="trc-rp-label">Reassign to:</p>
              {agents.map(a => (
                <button key={a.id} className="trc-rp-btn" style={{ color: a.color }}
                  onClick={() => { onReassign(task.id, a.id); setReassigning(false); }}>
                  {a.icon} {a.name}
                </button>
              ))}
              <button className="trc-rp-cancel" onClick={() => setReassigning(false)}>Cancel</button>
            </div>
          ) : (
            <>
              <button className="trc-act-btn trc-act-btn--reassign" onClick={() => setReassigning(true)}>Reassign</button>
              {!task.escalated && (
                <button className="trc-act-btn trc-act-btn--escalate" onClick={() => onEscalate(task.id)}>Escalate</button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function TaskRouterCenter({ onNavigate }) {
  const [tasks,        setTasks]       = useState(() => _load(TASKS_KEY, SEED_TASKS));
  const [section,      setSection]     = useState("queue");
  const [selected,     setSelected]    = useState("rt3");
  const [priFilter,    setPriFilter]   = useState("all");
  const [catFilter,    setCatFilter]   = useState("all");
  const [toast,        setToast]       = useState(null);
  const [apiError,     setApiError]    = useState(null);

  useEffect(() => { track.event("task_router_viewed"); }, []);

  // Populate queue from live agent execution history
  useEffect(() => {
    let cancelled = false;
    listAgents()
      .then(async res => {
        if (cancelled) return;
        const agents = res?.agents;
        if (!Array.isArray(agents) || !agents.length) return;
        const histories = await Promise.all(
          agents.slice(0, 5).map(a => getAgentHistory(a.id, { limit: 5 }).catch(() => null))
        );
        if (cancelled) return;
        const liveTasks = histories.flatMap((h, i) => {
          const runs = h?.history || h?.runs || [];
          return runs.map((r, j) => ({
            id:          `live_${i}_${j}`,
            title:       r.input?.slice(0, 80) || "Agent task",
            priority:    "medium",
            status:      r.status === "completed" ? "completed" : r.status === "running" ? "in_progress" : "queued",
            agentId:     agents[i]?.id || "unknown",
            category:    "runtime",
            createdAt:   r.startedAt ? new Date(r.startedAt).toLocaleTimeString() : "—",
            completedAt: r.completedAt ? new Date(r.completedAt).toLocaleTimeString() : null,
            result:      r.result?.message || r.result?.reply || null,
            escalated:   false,
          }));
        });
        if (liveTasks.length > 0) {
          const merged = [...liveTasks, ...SEED_TASKS.slice(0, 3)];
          setTasks(merged);
          _save(TASKS_KEY, merged);
          if (!selected || !merged.find(t => t.id === selected)) setSelected(merged[0]?.id || null);
        }
      })
      .catch(err => { if (!cancelled) setApiError(err.message); });
    return () => { cancelled = true; };
  }, []);
  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2400); };
  const persist = next => { _save(TASKS_KEY, next); setTasks(next); };

  const handleReassign = useCallback((taskId, agentId) => {
    persist(tasks.map(t => t.id === taskId ? { ...t, agentId } : t));
    showToast(`Reassigned to ${agentById(agentId)?.name}`);
  }, [tasks]);

  const handleEscalate = useCallback((taskId) => {
    persist(tasks.map(t => t.id === taskId ? { ...t, escalated: true } : t));
    showToast("Task escalated");
  }, [tasks]);

  const allCats = [...new Set(SEED_TASKS.map(t => t.category))];
  const visibleTasks = (section === "history" ? tasks.filter(t => t.status === "completed") :
    section === "active" ? tasks.filter(t => t.status === "in_progress") :
    tasks.filter(t => t.status !== "completed"))
    .filter(t => (priFilter === "all" || t.priority === priFilter) && (catFilter === "all" || t.category === catFilter));

  const selTask = selected ? tasks.find(t => t.id === selected) : null;

  const queuedCount   = tasks.filter(t => t.status === "queued").length;
  const activeCount   = tasks.filter(t => t.status === "in_progress").length;
  const completedCount= tasks.filter(t => t.status === "completed").length;
  const escalatedCount= tasks.filter(t => t.escalated).length;

  return (
    <div className="task-router-center page-enter">
      {toast && <div className="trc-toast">{toast}</div>}
      {apiError && <div className="ac-api-banner ac-api-banner--error">⚠ Live task data unavailable — showing cached data ({apiError})</div>}

      <div className="trc-header">
        <div>
          <h1 className="trc-title">Task Router</h1>
          <p className="trc-subtitle">Incoming tasks, agent assignment, escalation, and completion history.</p>
        </div>
      </div>

      {/* Summary */}
      <div className="trc-summary-strip">
        {[
          { label: "Queued",    value: queuedCount,    color: "var(--text-faint)" },
          { label: "Active",    value: activeCount,    color: "var(--accent2)"    },
          { label: "Completed", value: completedCount, color: "var(--success)"    },
          { label: "Escalated", value: escalatedCount, color: escalatedCount > 0 ? "var(--danger)" : "var(--success)" },
        ].map(s => (
          <div key={s.label} className="trc-summary-tile">
            <span className="trc-summary-val" style={{ color: s.color }}>{s.value}</span>
            <span className="trc-summary-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="trc-tabs">
        {[
          { id: "queue",   label: `Queue (${queuedCount + activeCount})` },
          { id: "active",  label: `Active (${activeCount})`              },
          { id: "history", label: `History (${completedCount})`          },
        ].map(t => (
          <button key={t.id} className={`trc-tab${section===t.id?" trc-tab--active":""}`} onClick={()=>setSection(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="trc-filters">
        <div className="trc-filter-chips">
          {["all","critical","high","medium","low"].map(p=>(
            <button key={p} className={`trc-chip${priFilter===p?" trc-chip--active":""}`}
              style={priFilter===p&&p!=="all"?{color:PRI_COLORS[p],borderColor:PRI_COLORS[p]+"44"}:{}}
              onClick={()=>setPriFilter(p)}>{p}</button>
          ))}
        </div>
        <div className="trc-filter-chips">
          <button className={`trc-chip${catFilter==="all"?" trc-chip--active":""}`} onClick={()=>setCatFilter("all")}>all</button>
          {allCats.map(c=>(
            <button key={c} className={`trc-chip${catFilter===c?" trc-chip--active":""}`} onClick={()=>setCatFilter(c)}>{c}</button>
          ))}
        </div>
      </div>

      <div className="trc-layout">
        <div className="trc-task-list">
          {visibleTasks.length === 0 ? (
            <div className="trc-empty"><span>◎</span><p>No tasks in this view</p></div>
          ) : visibleTasks.map(t => (
            <TaskRow key={t.id} task={t} selected={selected===t.id} onSelect={setSelected} />
          ))}
        </div>
        {selTask && (
          <TaskDetail task={selTask} agents={AGENTS} onReassign={handleReassign} onEscalate={handleEscalate} />
        )}
      </div>
    </div>
  );
}
