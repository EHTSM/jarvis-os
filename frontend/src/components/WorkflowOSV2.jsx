import React, { useState, useEffect, useCallback, useRef } from "react";
import { track } from "../analytics";
import { sendMessage } from "../api";
import { getRuntimeHistory, dispatchTask, emergencyStop } from "../runtimeApi";
import { getOpsData } from "../telemetryApi";
import { startCycle, listCycles, cycleStats } from "../phase18Api";
import EmptyState from "./EmptyState";
import "./WorkflowOSV2.css";

// ── Constants ─────────────────────────────────────────────────────────

const TABS = [
  { id: "library",    label: "Library"     },
  { id: "designer",   label: "Designer"    },
  { id: "running",    label: "Running"     },
  { id: "scheduled",  label: "Scheduled"   },
  { id: "history",    label: "History"     },
  { id: "router",     label: "Task Router" },
  { id: "autonomous", label: "Autonomous"  },
];

const WORKFLOW_LIBRARY = [
  { id: "wf1", icon: "🔄", name: "follow_up_sequence_v2",   label: "WhatsApp Follow-up Sequence",  desc: "Sends tiered WhatsApp follow-ups to all uncontacted leads", category: "crm",        lastRun: "2026-06-06T14:33:00Z", duration: "4.2s", status: "success", steps: 6, runsToday: 28 },
  { id: "wf2", icon: "📊", name: "daily_lead_score_update", label: "Daily Lead Score Update",       desc: "Scores and prioritises all leads based on activity signals", category: "crm",        lastRun: "2026-06-06T12:00:00Z", duration: "8.1s", status: "success", steps: 4, runsToday: 1  },
  { id: "wf3", icon: "🌙", name: "nightly_report_gen",      label: "Nightly Report Generator",      desc: "Generates executive summary and sends via email at 23:00",  category: "reporting",  lastRun: "2026-06-05T23:00:00Z", duration: "12.3s", status: "success", steps: 5, runsToday: 0  },
  { id: "wf4", icon: "💸", name: "payment_reminder_batch",  label: "Payment Reminder Batch",        desc: "Sends payment reminders to overdue leads via WhatsApp",      category: "payments",   lastRun: "2026-06-05T18:30:00Z", duration: "1.2s",  status: "error",   steps: 3, runsToday: 0, errorDetail: "WhatsApp template rejected by Meta" },
  { id: "wf5", icon: "🔍", name: "seo_rank_monitor",        label: "SEO Rank Monitor",              desc: "Checks keyword rankings and stores diff report",             category: "seo",        lastRun: "2026-06-06T13:30:00Z", duration: "6.8s", status: "success", steps: 3, runsToday: 12 },
  { id: "wf6", icon: "🎧", name: "support_ticket_router",   label: "Support Ticket Router",         desc: "Triages inbound support tickets and routes to agents",        category: "support",    lastRun: "2026-06-06T14:08:00Z", duration: "2.1s", status: "success", steps: 4, runsToday: 41 },
  { id: "wf7", icon: "📣", name: "content_publish_flow",    label: "Content Publish Flow",          desc: "Publishes drafted content to blog and notifies via Slack",   category: "content",    lastRun: "2026-06-06T09:00:00Z", duration: "5.4s", status: "success", steps: 5, runsToday: 2  },
];

const CATEGORIES = ["all", "crm", "payments", "seo", "support", "content", "reporting"];

const ROUTING_RULES = [
  { agent: "jarvis-core",     task: "AI commands (natural language)",  status: "active",  latency: "~380ms" },
  { agent: "workflow-runner", task: "Named workflow execution",         status: "active",  latency: "~4.2s"  },
  { agent: "follow-up-bot",   task: "WhatsApp send tasks",             status: "active",  latency: "~220ms" },
  { agent: "executor",        task: "General task dispatch",           status: "active",  latency: "~600ms" },
  { agent: "crm-sync",        task: "Lead & CRM data sync",            status: "active",  latency: "~150ms" },
];

const ROUTER_AGENTS = [
  { id: "ag_seo",       name: "SEO Agent",       icon: "⌕", color: "#4ecdc4" },
  { id: "ag_marketing", name: "Marketing",        icon: "◉", color: "#f0b429" },
  { id: "ag_content",   name: "Content Agent",    icon: "◈", color: "#7c6fff" },
  { id: "ag_support",   name: "Support Agent",    icon: "◎", color: "#52d68a" },
  { id: "ag_sales",     name: "Sales Agent",      icon: "◇", color: "#da552f" },
  { id: "ag_dev",       name: "Dev Agent",        icon: "⬡", color: "#dde2ec" },
  { id: "ag_devops",    name: "DevOps Agent",     icon: "⬟", color: "#fc6d26" },
  { id: "ag_analytics", name: "Analytics Agent",  icon: "▣", color: "#38bdf8" },
];

const SEED_TASKS = [
  { id: "rt1", title: "Generate meta descriptions for Phase 10 blog post",   priority: "high",     status: "completed",  agentId: "ag_seo",       category: "seo",        createdAt: "10:02", duration: "720ms" },
  { id: "rt2", title: "Triage 3 inbound support tickets",                    priority: "critical", status: "completed",  agentId: "ag_support",   category: "support",    createdAt: "10:08", duration: "180ms" },
  { id: "rt3", title: "Draft LinkedIn post about Phase 9 AI OS release",     priority: "medium",   status: "in_progress",agentId: "ag_marketing", category: "marketing",  createdAt: "10:15", duration: null   },
  { id: "rt4", title: "Analyse keyword gap vs competitors",                  priority: "medium",   status: "queued",     agentId: "ag_seo",       category: "seo",        createdAt: "10:18", duration: null   },
  { id: "rt5", title: "Write blog: WhatsApp Automation for Agencies",        priority: "high",     status: "queued",     agentId: "ag_content",   category: "content",    createdAt: "10:20", duration: null   },
  { id: "rt6", title: "Check deploy health after v9.4.0 push",              priority: "critical", status: "completed",  agentId: "ag_devops",    category: "devops",     createdAt: "09:58", duration: "92ms" },
  { id: "rt7", title: "Qualify 5 new leads from yesterday sign-ups",        priority: "high",     status: "in_progress",agentId: "ag_sales",     category: "sales",      createdAt: "10:10", duration: null   },
  { id: "rt8", title: "Weekly analytics summary report",                    priority: "medium",   status: "completed",  agentId: "ag_analytics", category: "analytics",  createdAt: "09:00", duration: "310ms" },
];

const DEPARTMENTS = [
  {
    id: "sales", name: "Sales", icon: "◇", color: "#da552f",
    mission: "Qualify leads, run outreach sequences, manage pipeline, close deals.",
    activeWork: ["Qualify 5 new sign-ups from yesterday", "Follow up: 3 unreplied DMs (day 3)", "Pipeline report for 16:00 team sync"],
    metrics: { throughput: 5, rate: "94%", open: 8, closed: 3 },
    outcomes: ["3 leads qualified as hot this week", "₹7,497 pipeline added", "1 deal closed at ₹2,499/mo"],
  },
  {
    id: "marketing", name: "Marketing", icon: "◉", color: "#f0b429",
    mission: "Run campaigns, manage content distribution, track channel performance.",
    activeWork: ["LinkedIn post: Phase 9 AI OS release", "Keyword gap analysis vs competitors", "Email subject line review — CTR drop -12%"],
    metrics: { throughput: 22, rate: "99%", open: 5, closed: 18 },
    outcomes: ["12 keywords tracked, 3 moved to page 1", "Email: 24.1% open rate", "LinkedIn: 840 impressions, 42 clicks"],
  },
  {
    id: "support", name: "Support", icon: "◎", color: "#52d68a",
    mission: "Triage tickets, draft responses from knowledge base, escalate critical issues.",
    activeWork: ["Ticket #1024: WhatsApp QR not scanning", "Ticket #1025: Payment confirmation missing", "FAQ update: 4 new entries"],
    metrics: { throughput: 31, rate: "98.8%", open: 2, closed: 28 },
    outcomes: ["28 tickets resolved (avg 8 min TTR)", "2 bugs escalated to Dev Agent", "1 upsell routed to Sales"],
  },
  {
    id: "operations", name: "Operations", icon: "⬟", color: "#7c6fff",
    mission: "System health, deploy pipelines, infrastructure monitoring, incident response.",
    activeWork: ["Monitor v9.4.0 deploy health", "DB query optimisation pass", "Scale review: API rate limits"],
    metrics: { throughput: 12, rate: "100%", open: 1, closed: 9 },
    outcomes: ["Zero incidents this week", "Deploy automation: 4 pushes shipped", "API uptime: 99.97%"],
  },
  {
    id: "engineering", name: "Engineering", icon: "⬡", color: "#dde2ec",
    mission: "Code review, PR management, architecture decisions, dev tooling.",
    activeWork: ["Review PR #48: DevOps monitoring improvements", "Research: AI model cost benchmarks", "Phase 44 Memory OS implementation"],
    metrics: { throughput: 7, rate: "92%", open: 4, closed: 6 },
    outcomes: ["4 PRs reviewed this week", "2 architecture docs updated", "Phase 44 shipped on schedule"],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────

function _timeAgo(iso) {
  if (!iso) return "—";
  try {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)    return `${diff}s ago`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch { return "—"; }
}

function _fmtTs(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

function StatusChip({ status }) {
  const MAP = {
    success: { label: "success", cls: "wov2-chip--ok"      },
    error:   { label: "error",   cls: "wov2-chip--error"   },
    running: { label: "running", cls: "wov2-chip--running"  },
    idle:    { label: "idle",    cls: "wov2-chip--idle"     },
    failed:  { label: "failed",  cls: "wov2-chip--error"   },
  };
  const m = MAP[status] || MAP.idle;
  return <span className={`wov2-chip ${m.cls}`}>{status === "running" && <span className="wov2-chip-dot"/>}{m.label}</span>;
}

function Toast({ msg, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3800); return () => clearTimeout(t); }, [onDone]);
  return <div className={`wov2-toast wov2-toast--${type}`}>{msg}</div>;
}

function SkelRow() {
  return (
    <div className="wov2-wf-card wov2-wf-card--skel">
      <span className="wov2-skeleton" style={{ width: 28, height: 28, borderRadius: 6 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="wov2-skeleton" style={{ width: "45%", height: 13, borderRadius: 4 }} />
        <span className="wov2-skeleton" style={{ width: "70%", height: 11, borderRadius: 4 }} />
      </div>
    </div>
  );
}

// ── Tab: Library ──────────────────────────────────────────────────────

function TabLibrary({ addToast, runningId, setRunningId }) {
  const [search, setSearch]   = useState("");
  const [catF,   setCatF]     = useState("all");
  const [loading, setLoading] = useState(false);
  const [cycles,  setCycles]  = useState(null);
  const [triggerInput, setTriggerInput] = useState("");
  const [triggering,   setTriggering]   = useState(false);

  useEffect(() => {
    listCycles({ limit: 10 }).then(r => {
      const arr = Array.isArray(r) ? r : (r?.cycles || r?.items || []);
      if (arr.length > 0) setCycles(arr);
    }).catch(() => {});
  }, []);

  const filtered = WORKFLOW_LIBRARY.filter(wf => {
    const matchCat = catF === "all" || wf.category === catF;
    const q = search.toLowerCase();
    const matchQ = !q || wf.name.toLowerCase().includes(q) || wf.label.toLowerCase().includes(q) || wf.desc.toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  async function handleRun(wf) {
    if (runningId) return;
    setRunningId(wf.id);
    try {
      const r = await sendMessage(`run ${wf.name}`, "exec");
      addToast(`✓ "${wf.label}" dispatched`, "success");
      track("wf_library_run", { name: wf.name });
    } catch (e) {
      addToast(`Failed to dispatch: ${e.message}`, "error");
    } finally {
      setTimeout(() => setRunningId(null), 3000);
    }
  }

  async function handleTrigger() {
    if (!triggerInput.trim() || triggering) return;
    setTriggering(true);
    try {
      const r = await startCycle(triggerInput.trim(), "general", "ui");
      addToast(`✓ Cycle started: ${r?.cycleId || "dispatched"}`, "success");
      setTriggerInput("");
      track("wf_quick_trigger");
    } catch (e) {
      addToast(`Could not dispatch — ${e.message}`, "error");
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="wov2-library-root">
      <div className="wov2-library-toolbar">
        <div className="wov2-search-wrap">
          <span className="wov2-search-icon">🔍</span>
          <input
            className="wov2-search"
            placeholder="Search workflows…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="wov2-cat-chips">
          {CATEGORIES.map(c => (
            <button
              key={c}
              className={`wov2-cat-chip${catF === c ? " wov2-cat-chip--active" : ""}`}
              onClick={() => setCatF(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="wov2-empty">
          <span className="wov2-empty-icon">⬡</span>
          <p className="wov2-empty-title">No workflows match "{search}"</p>
          <p className="wov2-empty-sub">Try a different search or clear the category filter.</p>
        </div>
      ) : (
        <div className="wov2-wf-list">
          {filtered.map(wf => (
            <div key={wf.id} className={`wov2-wf-card${runningId === wf.id ? " wov2-wf-card--running" : ""}`}>
              <div className="wov2-wf-top">
                <span className="wov2-wf-icon">{wf.icon}</span>
                <div className="wov2-wf-ident">
                  <span className="wov2-wf-name">{wf.name}</span>
                  <span className="wov2-wf-label">{wf.label}</span>
                </div>
                <div className="wov2-wf-actions">
                  <button
                    className={`wov2-btn wov2-btn--run${runningId === wf.id ? " wov2-btn--running" : ""}`}
                    onClick={() => handleRun(wf)}
                    disabled={!!runningId}
                  >
                    {runningId === wf.id ? "⟳ Running…" : "▶ Run"}
                  </button>
                  <button className="wov2-btn wov2-btn--ghost" title="Configuration coming soon"
                    onClick={() => addToast("Workflow configuration coming soon", "info")}>
                    ⚙
                  </button>
                </div>
              </div>
              <p className="wov2-wf-desc">{wf.desc}</p>
              <div className="wov2-wf-meta">
                <span className="wov2-wf-meta-item">Last run: {_timeAgo(wf.lastRun)}</span>
                <span className="wov2-wf-meta-sep">·</span>
                <span className="wov2-wf-meta-item">Duration: {wf.duration}</span>
                <span className="wov2-wf-meta-sep">·</span>
                <span className="wov2-wf-meta-item">{wf.runsToday} runs today</span>
                <span className="wov2-wf-meta-sep">·</span>
                <StatusChip status={wf.status} />
              </div>
              {wf.errorDetail && (
                <p className="wov2-wf-error">↳ {wf.errorDetail}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="wov2-quick-trigger">
        <p className="wov2-qt-label">Quick Trigger</p>
        <div className="wov2-trigger-group">
          <input
            className="wov2-trigger-input"
            placeholder="Type a workflow name or describe what to automate…"
            value={triggerInput}
            onChange={e => setTriggerInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleTrigger()}
            disabled={triggering}
          />
          <button
            className="wov2-trigger-submit"
            onClick={handleTrigger}
            disabled={!triggerInput.trim() || triggering}
          >
            {triggering ? "⟳" : "▶"}
          </button>
        </div>
      </div>

    </div>
  );
}

// ── Tab: Designer ─────────────────────────────────────────────────────

const TRIGGER_TYPES = [
  { id: "manual",   label: "Manual Trigger",    icon: "▶",  desc: "Run on demand via UI or API call" },
  { id: "schedule", label: "Scheduled (Cron)",   icon: "🕐", desc: "Run on a time-based schedule" },
  { id: "event",    label: "Event Trigger",      icon: "⚡", desc: "Fire on system event or webhook" },
  { id: "ai",       label: "AI Condition",       icon: "◎",  desc: "Trigger when AI detects a pattern" },
];

const ACTION_TYPES = [
  { id: "whatsapp", label: "WhatsApp Send",   icon: "💬" },
  { id: "email",    label: "Send Email",       icon: "📧" },
  { id: "crm",      label: "Update CRM Lead",  icon: "◈"  },
  { id: "agent",    label: "Invoke Agent",     icon: "⬟"  },
  { id: "webhook",  label: "Call Webhook",     icon: "🔗" },
  { id: "payment",  label: "Generate Payment Link", icon: "💸" },
];

function TabDesigner({ addToast }) {
  const [step,       setStep]       = useState(0); // 0=trigger, 1=actions, 2=review, 3=done
  const [trigger,    setTrigger]    = useState(null);
  const [actions,    setActions]    = useState([]);
  const [wfName,     setWfName]     = useState("");
  const [saving,     setSaving]     = useState(false);

  const STEPS = ["Trigger", "Actions", "Review", "Save"];

  async function handleSave() {
    if (!wfName.trim()) return;
    setSaving(true);
    try {
      await startCycle(`design:${wfName}`, "workflow", "designer");
      setStep(3);
      track("wf_designer_saved", { name: wfName });
    } catch {
      addToast("Could not save workflow draft", "error");
    } finally {
      setSaving(false);
    }
  }

  function reset() { setStep(0); setTrigger(null); setActions([]); setWfName(""); }

  return (
    <div className="wov2-designer-root">
      <div className="wov2-wizard-steps">
        {STEPS.map((s, i) => (
          <div key={s} className={`wov2-wizard-step${step === i ? " wov2-wizard-step--active" : ""}${step > i ? " wov2-wizard-step--done" : ""}`}>
            <span className="wov2-wizard-num">{step > i ? "✓" : i + 1}</span>
            <span className="wov2-wizard-label">{s}</span>
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="wov2-designer-step">
          <p className="wov2-designer-step-title">Choose a trigger</p>
          <div className="wov2-trigger-grid">
            {TRIGGER_TYPES.map(t => (
              <button
                key={t.id}
                className={`wov2-trigger-card${trigger?.id === t.id ? " wov2-trigger-card--selected" : ""}`}
                onClick={() => setTrigger(t)}
              >
                <span className="wov2-tcard-icon">{t.icon}</span>
                <span className="wov2-tcard-label">{t.label}</span>
                <span className="wov2-tcard-desc">{t.desc}</span>
              </button>
            ))}
          </div>
          <div className="wov2-designer-nav">
            <button className="wov2-btn wov2-btn--primary" disabled={!trigger} onClick={() => setStep(1)}>
              Next: Actions →
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="wov2-designer-step">
          <p className="wov2-designer-step-title">Select actions <span className="wov2-step-hint">(pick one or more)</span></p>
          <div className="wov2-action-grid">
            {ACTION_TYPES.map(a => (
              <button
                key={a.id}
                className={`wov2-action-chip${actions.includes(a.id) ? " wov2-action-chip--selected" : ""}`}
                onClick={() => setActions(prev => prev.includes(a.id) ? prev.filter(x => x !== a.id) : [...prev, a.id])}
              >
                {a.icon} {a.label}
              </button>
            ))}
          </div>
          <div className="wov2-designer-nav">
            <button className="wov2-btn wov2-btn--ghost" onClick={() => setStep(0)}>← Back</button>
            <button className="wov2-btn wov2-btn--primary" disabled={actions.length === 0} onClick={() => setStep(2)}>
              Next: Review →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wov2-designer-step">
          <p className="wov2-designer-step-title">Review & name your workflow</p>
          <div className="wov2-review-panel">
            <div className="wov2-review-row">
              <span className="wov2-review-key">Trigger</span>
              <span className="wov2-review-val">{trigger?.icon} {trigger?.label}</span>
            </div>
            <div className="wov2-review-row">
              <span className="wov2-review-key">Actions</span>
              <span className="wov2-review-val">
                {actions.map(id => ACTION_TYPES.find(a => a.id === id)).filter(Boolean).map(a => `${a.icon} ${a.label}`).join(" → ")}
              </span>
            </div>
            <div className="wov2-review-row">
              <span className="wov2-review-key">Name <span className="wov2-req">*</span></span>
              <input
                className="wov2-input"
                placeholder="my_custom_workflow"
                value={wfName}
                onChange={e => setWfName(e.target.value.replace(/\s+/g, "_"))}
                style={{ flex: 1, maxWidth: 300 }}
              />
            </div>
          </div>
          <div className="wov2-designer-nav">
            <button className="wov2-btn wov2-btn--ghost" onClick={() => setStep(1)}>← Back</button>
            <button className="wov2-btn wov2-btn--primary" disabled={!wfName.trim() || saving} onClick={handleSave}>
              {saving ? "Saving…" : "✓ Save Draft"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="wov2-designer-success">
          <span className="wov2-success-icon">✓</span>
          <p className="wov2-success-title">Draft Saved — "{wfName}"</p>
          <p className="wov2-success-sub">Your workflow draft has been saved. Full execution requires the visual builder (coming soon).</p>
          <div className="wov2-designer-nav" style={{ justifyContent: "center" }}>
            <button className="wov2-btn wov2-btn--ghost" onClick={reset}>Create another</button>
            <button className="wov2-btn wov2-btn--primary" onClick={() => {}}>View Library</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Running ──────────────────────────────────────────────────────

function TabRunning({ addToast }) {
  const [history,  setHistory]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [stopping, setStopping] = useState(false);
  const [elapsed,  setElapsed]  = useState({});
  const timerRef = useRef(null);

  useEffect(() => {
    loadHistory();
    timerRef.current = setInterval(() => {
      if (document.hidden) return;
      setElapsed(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(k => { next[k] = (next[k] || 0) + 1; });
        return next;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  async function loadHistory() {
    setLoading(true);
    try {
      const r = await getRuntimeHistory(20);
      const arr = Array.isArray(r) ? r : (r?.history || r?.items || []);
      setHistory(arr);
      const init = {};
      arr.filter(i => i.status === "running").forEach(i => { init[i.id] = 0; });
      setElapsed(init);
    } catch { setHistory([]); }
    finally { setLoading(false); }
  }

  const running = history.filter(h => h.status === "running");

  async function handleStop() {
    setStopping(true);
    try {
      await emergencyStop("operator_stop_running");
      addToast("Emergency stop dispatched — all workflows halting", "info");
      track("wf_emergency_stop");
      setTimeout(loadHistory, 2000);
    } catch (e) {
      addToast(`Stop failed: ${e.message}`, "error");
    } finally {
      setStopping(false);
    }
  }

  if (loading) return (
    <div className="wov2-running-root">
      {[0,1,2].map(i => <SkelRow key={i} />)}
    </div>
  );

  if (running.length === 0) return (
    <div className="wov2-empty" style={{ flex: 1 }}>
      <span className="wov2-empty-icon" style={{ color: "#52d68a" }}>✓</span>
      <p className="wov2-empty-title">No workflows currently running</p>
      <p className="wov2-empty-sub">All workflows are idle. Trigger one from the Library tab.</p>
    </div>
  );

  return (
    <div className="wov2-running-root">
      <div className="wov2-running-header">
        <div className="wov2-running-indicator">
          <span className="wov2-run-dot" />
          <span className="wov2-run-label">{running.length} workflow{running.length > 1 ? "s" : ""} active</span>
        </div>
        <button
          className="wov2-btn wov2-btn--danger wov2-btn--sm"
          onClick={handleStop}
          disabled={stopping}
        >
          {stopping ? "Stopping…" : "⏹ Emergency Stop"}
        </button>
      </div>

      {running.map(item => {
        const sec = elapsed[item.id] || 0;
        const steps = item.totalSteps || 6;
        const done  = Math.min(item.stepsDone || 1, steps);
        const pct   = Math.round((done / steps) * 100);
        return (
          <div key={item.id} className="wov2-running-card">
            <div className="wov2-rc-top">
              <span className="wov2-run-dot" />
              <span className="wov2-rc-name">{item.input || item.goal || item.id}</span>
              <span className="wov2-rc-timer">{sec}s</span>
              <StatusChip status="running" />
            </div>
            <div className="wov2-progress-wrap">
              <div className="wov2-progress-track">
                <div className="wov2-progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="wov2-progress-label">Step {done} of {steps}</span>
            </div>
            <div className="wov2-rc-actions">
              <button className="wov2-btn wov2-btn--ghost wov2-btn--sm" onClick={() => addToast("Live log streaming coming soon", "info")}>View Log</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Tab: Scheduled ────────────────────────────────────────────────────

function TabScheduled() {
  const MOCK_SCHEDULES = [
    { name: "nightly_report_gen",      cron: "0 23 * * *",  next: "Tonight 23:00", enabled: true,  lastRun: "Yesterday 23:00" },
    { name: "daily_lead_score_update", cron: "0 12 * * *",  next: "Today 12:00",   enabled: true,  lastRun: "Today 12:00"    },
    { name: "seo_rank_monitor",        cron: "0 * * * *",   next: "Next hour",     enabled: true,  lastRun: "30 min ago"     },
    { name: "weekly_analytics_brief",  cron: "0 8 * * 1",   next: "Mon 08:00",     enabled: false, lastRun: "Last Monday"    },
  ];
  const [schedules, setSchedules] = useState(MOCK_SCHEDULES);

  function toggleSchedule(name) {
    setSchedules(prev => prev.map(s => s.name === name ? { ...s, enabled: !s.enabled } : s));
  }

  return (
    <div className="wov2-sched-root">
      <div className="wov2-sched-list">
        {schedules.map(s => (
          <div key={s.name} className={`wov2-sched-row${!s.enabled ? " wov2-sched-row--off" : ""}`}>
            <div className="wov2-sched-left">
              <span className="wov2-sched-name">{s.name}</span>
              <span className="wov2-sched-cron">{s.cron}</span>
            </div>
            <div className="wov2-sched-center">
              <span className="wov2-sched-next">Next: {s.enabled ? s.next : "—"}</span>
              <span className="wov2-sched-last">Last: {s.lastRun}</span>
            </div>
            <div className="wov2-sched-right">
              <span className={`wov2-freq-badge${!s.enabled ? " wov2-freq-badge--off" : ""}`}>
                {s.enabled ? "active" : "disabled"}
              </span>
              <button
                className={`wov2-toggle${s.enabled ? " wov2-toggle--on" : ""}`}
                onClick={() => toggleSchedule(s.name)}
                title={s.enabled ? "Disable" : "Enable"}
              >
                <span className="wov2-toggle-knob" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab: History ──────────────────────────────────────────────────────

function TabHistory() {
  const [history,  setHistory]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [page,     setPage]     = useState(1);
  const [expanded, setExpanded] = useState(null);
  const [cycles,   setCycles]   = useState([]);
  const PAGE = 15;

  useEffect(() => {
    Promise.all([
      getRuntimeHistory(50).catch(() => []),
      listCycles({ limit: 30 }).catch(() => []),
    ]).then(([histRes, cycleRes]) => {
      const hist = Array.isArray(histRes) ? histRes : (histRes?.history || histRes?.items || []);
      const cycs = Array.isArray(cycleRes) ? cycleRes : (cycleRes?.cycles || cycleRes?.items || []);
      setHistory(hist);
      setCycles(cycs);
    }).finally(() => setLoading(false));
  }, []);

  const allItems = history.length > 0 ? history : WORKFLOW_LIBRARY.map(wf => ({
    id: wf.id + "_hist",
    input: wf.name,
    status: wf.status === "error" ? "failed" : "completed",
    duration: wf.duration,
    timestamp: wf.lastRun,
    tokens: Math.floor(Math.random() * 8000) + 1000,
  }));

  const shown = allItems.slice(0, page * PAGE);
  const hasMore = shown.length < allItems.length;

  if (loading) return (
    <div className="wov2-history-root">
      {[0,1,2,3,4].map(i => <SkelRow key={i} />)}
    </div>
  );

  return (
    <div className="wov2-history-root">
      <div className="wov2-history-header">
        <span className="wov2-history-count">{allItems.length} executions recorded</span>
      </div>
      <div className="wov2-history-list">
        {shown.map((item, i) => (
          <div
            key={item.id || i}
            className={`wov2-history-row${expanded === (item.id || i) ? " wov2-history-row--open" : ""}`}
            onClick={() => setExpanded(v => v === (item.id || i) ? null : (item.id || i))}
          >
            <span className={`wov2-hist-status wov2-hist-status--${item.status === "completed" || item.status === "success" ? "ok" : "error"}`}>
              {item.status === "completed" || item.status === "success" ? "✓" : "✗"}
            </span>
            <span className="wov2-hist-ts">{_fmtTs(item.timestamp || item.createdAt || item.lastRun)}</span>
            <span className="wov2-hist-name">{item.input || item.goal || item.name || "—"}</span>
            <span className="wov2-hist-dur">{item.duration || item.durationMs ? `${item.duration || Math.round(item.durationMs / 100) / 10}s` : "—"}</span>
            {item.tokens && <span className="wov2-hist-tokens">{Number(item.tokens).toLocaleString()} tok</span>}
            {expanded === (item.id || i) && (
              <div className="wov2-hist-detail">
                <p className="wov2-hist-detail-text">
                  {item.output || item.result || item.error || "No additional detail available."}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
      {hasMore && (
        <button className="wov2-load-more" onClick={() => setPage(p => p + 1)}>
          Load more ({allItems.length - shown.length} remaining)
        </button>
      )}
    </div>
  );
}

// ── Tab: Task Router ──────────────────────────────────────────────────

function TabRouter({ addToast }) {
  const [opsData,    setOpsData]    = useState(null);
  const [tasks,      setTasks]      = useState(SEED_TASKS);
  const [statusF,    setStatusF]    = useState("all");
  const [newTask,    setNewTask]    = useState("");
  const [dispatching,setDispatching]= useState(false);

  useEffect(() => {
    const load = () => { if (!document.hidden) getOpsData().then(r => { if (r && !r.error) setOpsData(r); }).catch(() => {}); };
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 10000);
    return () => clearInterval(t);
  }, []);

  const queue = opsData?.queue || {};
  const running = queue.running ?? tasks.filter(t => t.status === "in_progress").length;
  const queued  = queue.queued  ?? tasks.filter(t => t.status === "queued").length;
  const failed  = queue.failed  ?? tasks.filter(t => t.status === "failed").length;

  const statuses = ["all", "in_progress", "queued", "completed", "failed"];
  const filtered = tasks.filter(t => statusF === "all" || t.status === statusF);

  async function handleDispatch() {
    if (!newTask.trim() || dispatching) return;
    setDispatching(true);
    try {
      const r = await dispatchTask(newTask.trim());
      addToast(`✓ Task dispatched: ${r?.taskId || "queued"}`, "success");
      setTasks(prev => [{
        id: `rt${Date.now()}`,
        title: newTask.trim(),
        priority: "medium",
        status: "queued",
        agentId: "ag_dev",
        category: "general",
        createdAt: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        duration: null,
      }, ...prev]);
      setNewTask("");
      track("wf_router_dispatch");
    } catch (e) {
      addToast(`Dispatch failed: ${e.message}`, "error");
    } finally {
      setDispatching(false);
    }
  }

  const PRI_COLORS = { critical: "#f55b5b", high: "#f0b429", medium: "#4ecdc4", low: "#4a5470" };
  const STA_COLORS = { completed: "#52d68a", in_progress: "#7c6fff", queued: "#4a5470", failed: "#f55b5b" };

  return (
    <div className="wov2-router-root">
      <div className="wov2-queue-strip">
        <div className="wov2-qs-cell">
          <span className="wov2-qs-val" style={{ color: "#7c6fff" }}>{running}</span>
          <span className="wov2-qs-label">Running</span>
        </div>
        <div className="wov2-qs-sep" />
        <div className="wov2-qs-cell">
          <span className="wov2-qs-val" style={{ color: "#f0b429" }}>{queued}</span>
          <span className="wov2-qs-label">Queued</span>
        </div>
        <div className="wov2-qs-sep" />
        <div className="wov2-qs-cell">
          <span className="wov2-qs-val" style={{ color: "#f55b5b" }}>{failed}</span>
          <span className="wov2-qs-label">Failed</span>
        </div>
        <div className="wov2-qs-sep" />
        <div className="wov2-qs-cell">
          <span className="wov2-qs-val">{tasks.length}</span>
          <span className="wov2-qs-label">Total Today</span>
        </div>
      </div>

      <div className="wov2-routing-rules">
        <p className="wov2-rr-title">Routing Rules</p>
        {ROUTING_RULES.map(r => (
          <div key={r.agent} className="wov2-rr-row">
            <span className="wov2-rr-dot" />
            <span className="wov2-rr-agent">{r.agent}</span>
            <span className="wov2-rr-arrow">→</span>
            <span className="wov2-rr-task">{r.task}</span>
            <span className="wov2-rr-latency">{r.latency}</span>
          </div>
        ))}
      </div>

      <div className="wov2-dispatch-bar">
        <input
          className="wov2-trigger-input"
          placeholder="Dispatch a task description…"
          value={newTask}
          onChange={e => setNewTask(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleDispatch()}
          disabled={dispatching}
        />
        <button
          className="wov2-trigger-submit"
          onClick={handleDispatch}
          disabled={!newTask.trim() || dispatching}
        >
          {dispatching ? "⟳" : "▶"}
        </button>
      </div>

      <div className="wov2-task-toolbar">
        {statuses.map(s => (
          <button
            key={s}
            className={`wov2-cat-chip${statusF === s ? " wov2-cat-chip--active" : ""}`}
            onClick={() => setStatusF(s)}
          >
            {s.replace("_", " ")}
          </button>
        ))}
      </div>

      <div className="wov2-task-list">
        {filtered.length === 0 ? (
          <div className="wov2-empty" style={{ padding: "24px" }}>
            <span className="wov2-empty-icon" style={{ color: "#52d68a", fontSize: 22 }}>✓</span>
            <p className="wov2-empty-title">Queue is clear</p>
            <p className="wov2-empty-sub">All tasks completed. No items pending.</p>
          </div>
        ) : (
          filtered.map(task => {
            const agent = ROUTER_AGENTS.find(a => a.id === task.agentId);
            return (
              <div key={task.id} className="wov2-task-row">
                <span className="wov2-task-pri-dot" style={{ background: PRI_COLORS[task.priority] || "#4a5470" }} />
                <div className="wov2-task-info">
                  <span className="wov2-task-title">{task.title}</span>
                  <span className="wov2-task-meta">{task.category} · {task.createdAt}</span>
                </div>
                {agent && (
                  <span className="wov2-agent-chip" style={{ color: agent.color, borderColor: agent.color + "33" }}>
                    {agent.icon} {agent.name}
                  </span>
                )}
                <span className="wov2-task-status" style={{ color: STA_COLORS[task.status] || "#4a5470" }}>
                  {task.status.replace("_", " ")}
                </span>
                {task.duration && <span className="wov2-task-dur">{task.duration}</span>}
              </div>
            );
          })
        )}
      </div>

    </div>
  );
}

// ── Tab: Autonomous Company ───────────────────────────────────────────

function TabAutonomous({ addToast }) {
  const [selected, setSelected] = useState(null);
  const [opsData,  setOpsData]  = useState(null);

  useEffect(() => {
    getOpsData().then(r => { if (r && !r.error) setOpsData(r); }).catch(() => {});
  }, []);

  const WK_STATUS = { in_progress: "⟳", queued: "○", done: "✓" };
  const WK_COLORS = { in_progress: "#7c6fff", queued: "#4a5470", done: "#52d68a" };

  return (
    <div className="wov2-auto-root">
      <div className="wov2-live-today">
        <p className="wov2-lt-title">Live Today</p>
        <div className="wov2-live-cards">
          {[
            { icon: "●", title: "Self-healing agent monitor", status: "ACTIVE", color: "#52d68a", detail: "Restarts crashed agents automatically", stat: "24 restarts prevented this week" },
            { icon: "●", title: "Retry logic with exponential backoff", status: "ACTIVE", color: "#52d68a", detail: "Failed tasks retried up to 3× before dead-letter queue", stat: "12 tasks recovered this week" },
            { icon: "○", title: "Evolution scoring engine", status: "MONITORING", color: "#f0b429", detail: "Scoring system improvement opportunities", stat: `Score: ${opsData?.evolution?.score ?? 72}/100` },
          ].map(item => (
            <div key={item.title} className="wov2-live-card">
              <div className="wov2-lc-top">
                <span className="wov2-lc-dot" style={{ color: item.color }}>{item.icon}</span>
                <span className="wov2-lc-title">{item.title}</span>
                <span className="wov2-lc-status" style={{ color: item.color }}>{item.status}</span>
              </div>
              <p className="wov2-lc-detail">{item.detail}</p>
              <span className="wov2-lc-stat">{item.stat}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="wov2-dept-section">
        <p className="wov2-dept-title">Department View</p>
        <div className="wov2-dept-grid">
          {DEPARTMENTS.map(dept => (
            <div
              key={dept.id}
              className={`wov2-dept-card${selected === dept.id ? " wov2-dept-card--selected" : ""}`}
              style={{ borderColor: selected === dept.id ? dept.color + "40" : undefined }}
              onClick={() => setSelected(v => v === dept.id ? null : dept.id)}
            >
              <div className="wov2-dept-header">
                <span className="wov2-dept-icon" style={{ color: dept.color }}>{dept.icon}</span>
                <span className="wov2-dept-name">{dept.name}</span>
                <div className="wov2-dept-metrics">
                  <span className="wov2-dm-val" style={{ color: dept.color }}>{dept.metrics.throughput}</span>
                  <span className="wov2-dm-label"> tasks</span>
                  <span className="wov2-dm-sep">·</span>
                  <span className="wov2-dm-val">{dept.metrics.rate}</span>
                </div>
              </div>
              {selected === dept.id && (
                <div className="wov2-dept-detail">
                  <p className="wov2-dept-mission">{dept.mission}</p>
                  <div className="wov2-dept-work">
                    <p className="wov2-dept-work-title">Active Work</p>
                    {dept.activeWork.map((w, i) => (
                      <div key={i} className="wov2-dept-work-row">
                        <span style={{ color: "#7c6fff", fontSize: 11 }}>⟳</span>
                        <span className="wov2-dept-work-text">{w}</span>
                      </div>
                    ))}
                  </div>
                  <div className="wov2-dept-outcomes">
                    <p className="wov2-dept-work-title">Outcomes This Week</p>
                    {dept.outcomes.map((o, i) => (
                      <div key={i} className="wov2-dept-work-row">
                        <span style={{ color: "#52d68a", fontSize: 11 }}>✓</span>
                        <span className="wov2-dept-work-text">{o}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="wov2-cs-list">
        <p className="wov2-cs-title">In Active Development</p>
        {[
          "Agent self-optimisation (auto-tuning prompts based on success rates)",
          "Workflow auto-generation from detected patterns",
          "Cross-department orchestration and handoff protocols",
          "Ooplix Runs Ooplix — full autonomous business mode",
        ].map(item => (
          <div key={item} className="wov2-cs-item">
            <span className="wov2-cs-dot">◎</span>
            <span className="wov2-cs-text">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

export default function WorkflowOSV2({ onNavigate }) {
  const [tab,       setTab]       = useState("library");
  const [toasts,    setToasts]    = useState([]);
  const [runningId, setRunningId] = useState(null);
  const [cycStats,  setCycStats]  = useState(null);

  const addToast = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
  }, []);
  const removeToast = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), []);

  useEffect(() => {
    cycleStats().then(r => { if (r && !r.error) setCycStats(r); }).catch(() => {});
  }, []);

  const totalRuns   = cycStats?.total ?? WORKFLOW_LIBRARY.reduce((a, w) => a + w.runsToday, 0);
  const successRate = cycStats?.successRate ?? 94;
  const running     = cycStats?.running ?? (runningId ? 1 : 0);

  const runningTab = TABS.find(t => t.id === "running");

  return (
    <div className="wov2-root">
      <div className="wov2-header">
        <div>
          <h1 className="wov2-page-title">Workflow OS</h1>
          <p className="wov2-page-sub">Autonomous execution sequences, task routing, and department operations</p>
        </div>
        <div className="wov2-header-right">
          <div className="wov2-stat-strip">
            <div className="wov2-hstat">
              <span className="wov2-hstat-val">{WORKFLOW_LIBRARY.length}</span>
              <span className="wov2-hstat-label">Workflows</span>
            </div>
            <div className="wov2-hstat-sep" />
            <div className="wov2-hstat">
              <span className="wov2-hstat-val">{totalRuns}</span>
              <span className="wov2-hstat-label">Runs Today</span>
            </div>
            <div className="wov2-hstat-sep" />
            <div className="wov2-hstat">
              <span className="wov2-hstat-val" style={{ color: "#52d68a" }}>{successRate}%</span>
              <span className="wov2-hstat-label">Success</span>
            </div>
          </div>
        </div>
      </div>

      <div className="wov2-subnav">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`wov2-subnav-tab${tab === t.id ? " wov2-subnav-tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "running" && running > 0 && (
              <span className="wov2-subnav-badge">{running}</span>
            )}
          </button>
        ))}
      </div>

      <div className="wov2-tab-content">
        {tab === "library"    && <TabLibrary    addToast={addToast} runningId={runningId} setRunningId={setRunningId} />}
        {tab === "designer"   && <TabDesigner   addToast={addToast} />}
        {tab === "running"    && <TabRunning    addToast={addToast} />}
        {tab === "scheduled"  && <TabScheduled  />}
        {tab === "history"    && <TabHistory    />}
        {tab === "router"     && <TabRouter     addToast={addToast} />}
        {tab === "autonomous" && <TabAutonomous addToast={addToast} />}
      </div>

      <div className="wov2-toast-container">
        {toasts.map(t => (
          <Toast key={t.id} msg={t.msg} type={t.type} onDone={() => removeToast(t.id)} />
        ))}
      </div>
    </div>
  );
}
