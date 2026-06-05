import React, { useState, useCallback, useEffect } from "react";
import { track } from "../analytics";
import { listMissions, getAutopilotStats, getGitHubActivity } from "../phase23Api";
import "./EngineeringCenter.css";

// ── Persistence ───────────────────────────────────────────────────────
const ENG_KEY = "ooplix_eng_tasks";
function _load(key, fb) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fb)); }
  catch { return fb; }
}
function _save(key, v) { localStorage.setItem(key, JSON.stringify(v)); }

// ── Lifecycle stages ──────────────────────────────────────────────────
const STAGES = [
  { id: "requirement", label: "Requirement", icon: "◎", color: "var(--text-faint)" },
  { id: "plan",        label: "Plan",        icon: "◈", color: "var(--accent)"     },
  { id: "build",       label: "Build",       icon: "▷", color: "var(--warning)"    },
  { id: "review",      label: "Review",      icon: "◉", color: "var(--accent2)"    },
  { id: "test",        label: "Test",        icon: "⬟", color: "var(--success)"    },
  { id: "done",        label: "Done",        icon: "✓", color: "var(--success)"    },
];

// ── Seed engineering tasks ────────────────────────────────────────────
const SEED_TASKS = [
  {
    id: "et1", title: "Webhook inbound event router",
    requirement: "Accept POST /webhook events from third-party services, validate signature, route to correct handler, respond 200 within 5s.",
    plan: "1. Create /routes/webhooks.js\n2. HMAC-SHA256 signature validation middleware\n3. Event type dispatcher (switch on event.type)\n4. Dead-letter queue for unhandled events\n5. Rate limit: 100 req/min per source",
    build: "routes/webhooks.js — 180 lines\nservices/webhookDispatcher.js — 95 lines\nmiddleware/hmacValidator.js — 45 lines",
    review: "CRITICAL: Missing rate-limit middleware on POST /webhook. Add before signature check.",
    test: "Unit: hmacValidator (6 cases)\nIntegration: POST /webhook with valid/invalid signatures\nLoad: 200 concurrent requests → p99 < 800ms",
    stage: "review", priority: "critical", repo: "ooplix-backend",  assignee: "Dev Agent",  created: "2026-06-02",
  },
  {
    id: "et2", title: "Memory agent cross-session persistence",
    requirement: "Agent memory entries must persist across server restarts and be accessible by all agent types via a typed read/write API.",
    plan: "1. Define MemoryEntry schema (type, title, body, importance, tags, used_count)\n2. localStorage adapter (dev) + JSON file adapter (prod)\n3. Read API: getMemories(filter), searchMemories(query)\n4. Write API: upsertMemory(entry), deleteMemory(id)",
    build: "agents/runtime/unifiedMemoryEngine.cjs — 210 lines\ndata/memory-index.json — schema",
    review: "Implementation clean. Follows existing patterns. No issues.",
    test: "Unit: CRUD operations across 3 types\nIntegration: agent reads memory on cold start\nRegression: 40 existing agent tests pass",
    stage: "done", priority: "high", repo: "ooplix-agents", assignee: "Dev Agent", created: "2026-06-01",
  },
  {
    id: "et3", title: "Terraform remote state backend",
    requirement: "Move Terraform state from local .tfstate file to S3 remote backend with DynamoDB locking. Required before team infra work.",
    plan: "1. Create S3 bucket: ooplix-tf-state-prod\n2. DynamoDB table: terraform-lock\n3. Update backend.tf config\n4. Run terraform init -migrate-state\n5. Document in INFRA.md",
    build: "",
    review: "",
    test: "",
    stage: "plan", priority: "high", repo: "ooplix-infra", assignee: "DevOps Agent", created: "2026-06-03",
  },
  {
    id: "et4", title: "Android cold-start Firebase null crash fix",
    requirement: "App crashes on cold start on Android 12+ when Firebase auth returns null on first call. Affects ~15% of Android users.",
    plan: "1. Add null guard on FirebaseAuth.getInstance().getCurrentUser()\n2. Defer navigation until auth state resolved\n3. Add loading state during auth check",
    build: "src/auth/LoginPage.jsx — added null check + loading guard (28 lines changed)",
    review: "Null check added correctly. Logic looks sound.",
    test: "",
    stage: "test", priority: "high", repo: "ooplix-mobile", assignee: "Dev Agent", created: "2026-06-02",
  },
  {
    id: "et5", title: "Phase 10 — Developer, Engineering, DevOps, Self-Healing OS",
    requirement: "Build 4 new OS modules: Developer Copilot, Autonomous Engineering Center, DevOps Runtime, Self-Healing Platform. Frontend only. Local persistence.",
    plan: "1. DeveloperCopilotCenter — repos, tasks, branches, PRs, reviews\n2. EngineeringCenter — planner, builder, reviewer, tester\n3. DevOpsCenter — deployments, services, infra, incidents\n4. SelfHealingCenter — health checks, recovery, prevention, timeline",
    build: "",
    review: "",
    test: "",
    stage: "build", priority: "critical", repo: "ooplix-frontend", assignee: "Dev Agent", created: "2026-06-04",
  },
];

function StageFlow({ currentStage }) {
  const currentIdx = STAGES.findIndex(s => s.id === currentStage);
  return (
    <div className="ec-stage-flow">
      {STAGES.map((s, i) => {
        const done    = i < currentIdx;
        const active  = i === currentIdx;
        const pending = i > currentIdx;
        return (
          <React.Fragment key={s.id}>
            <div className={`ec-stage-node${done ? " ec-stage-node--done" : ""}${active ? " ec-stage-node--active" : ""}${pending ? " ec-stage-node--pending" : ""}`}>
              <span className="ec-stage-icon" style={{ color: active ? s.color : done ? "var(--success)" : "var(--text-faint)" }}>
                {done ? "✓" : s.icon}
              </span>
              <span className="ec-stage-label">{s.label}</span>
            </div>
            {i < STAGES.length - 1 && (
              <div className={`ec-stage-connector${done ? " ec-stage-connector--done" : ""}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function TaskCard({ task, selected, onSelect, onAdvance }) {
  const stageIdx = STAGES.findIndex(s => s.id === task.stage);
  const stage    = STAGES[stageIdx];
  const canAdvance = task.stage !== "done";
  const PRI_COLORS = { critical: "var(--danger)", high: "var(--warning)", medium: "var(--accent2)", low: "var(--text-faint)" };

  return (
    <div className={`ec-task-card${selected ? " ec-task-card--selected" : ""}`} onClick={() => onSelect(task.id)}>
      <div className="ec-task-header">
        <span className="ec-task-title">{task.title}</span>
        <span className="ec-task-priority" style={{ color: PRI_COLORS[task.priority] }}>{task.priority}</span>
      </div>
      <div className="ec-task-meta-row">
        <span className="ec-task-repo">{task.repo}</span>
        <span className="ec-task-assignee">{task.assignee}</span>
        <span className="ec-task-date">{task.created}</span>
      </div>
      <div className="ec-task-stage-row">
        <span className="ec-task-stage-badge" style={{ color: stage?.color, borderColor: (stage?.color || "#fff") + "33" }}>
          {stage?.icon} {stage?.label}
        </span>
        {canAdvance && (
          <button
            className="ec-advance-btn"
            onClick={e => { e.stopPropagation(); onAdvance(task.id); }}
          >
            Advance → {STAGES[stageIdx + 1]?.label}
          </button>
        )}
      </div>
    </div>
  );
}

function TaskDetail({ task }) {
  const stageIdx = STAGES.findIndex(s => s.id === task.stage);

  return (
    <div className="ec-detail">
      <h3 className="ec-detail-title">{task.title}</h3>
      <StageFlow currentStage={task.stage} />
      <div className="ec-detail-sections">
        {[
          { id: "requirement", label: "Requirement", value: task.requirement, icon: "◎" },
          { id: "plan",        label: "Plan",        value: task.plan,        icon: "◈" },
          { id: "build",       label: "Build",       value: task.build,       icon: "▷" },
          { id: "review",      label: "Review",      value: task.review,      icon: "◉" },
          { id: "test",        label: "Test",        value: task.test,        icon: "⬟" },
        ].map((sec, i) => {
          const active  = sec.id === task.stage;
          const done    = i < stageIdx;
          const pending = i > stageIdx;
          const stage   = STAGES.find(s => s.id === sec.id);
          return (
            <div key={sec.id} className={`ec-detail-phase${active ? " ec-detail-phase--active" : ""}${done ? " ec-detail-phase--done" : ""}${pending ? " ec-detail-phase--pending" : ""}`}>
              <div className="ec-phase-label-row">
                <span className="ec-phase-icon" style={{ color: active ? stage?.color : done ? "var(--success)" : "var(--text-faint)" }}>
                  {done ? "✓" : sec.icon}
                </span>
                <span className="ec-phase-label">{sec.label}</span>
                {active && <span className="ec-phase-active-badge">Current</span>}
              </div>
              {sec.value ? (
                <pre className="ec-phase-content">{sec.value}</pre>
              ) : (
                <p className="ec-phase-empty">{pending ? "Pending" : "Not started"}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function EngineeringCenter({ onNavigate }) {
  const [tasks,    setTasks]    = useState(() => _load(ENG_KEY, SEED_TASKS));
  const [section,  setSection]  = useState("board");
  const [selected, setSelected] = useState("et1");
  const [filter,   setFilter]   = useState("all");
  const [toast,    setToast]    = useState(null);
  const [apiError, setApiError] = useState(null);
  const [liveStats, setLiveStats] = useState(null);

  useEffect(() => { track.event("engineering_center_viewed"); }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listMissions({ limit: 20 }),
      getAutopilotStats(),
      getGitHubActivity({ limit: 10 }),
    ]).then(([missionsRes, statsRes, activityRes]) => {
      if (cancelled) return;
      if (statsRes) setLiveStats(statsRes);
      const missions = missionsRes?.missions;
      if (Array.isArray(missions) && missions.length > 0) {
        const mapped = missions.map(m => ({
          id:          m.id,
          title:       m.goal?.slice(0, 80) || "Engineering Mission",
          requirement: m.goal || "",
          plan:        m.plan || "",
          build:       m.executionChain?.map(s => s.action).join("\n") || "",
          review:      m.review || "",
          test:        m.test || "",
          stage:       m.status === "completed" ? "done" : m.status === "running" ? "build" : "plan",
          priority:    m.priority || "medium",
          repo:        m.repo || "ooplix",
          assignee:    m.agentId || "Autopilot",
          created:     m.startedAt ? new Date(m.startedAt).toLocaleDateString() : "—",
        }));
        setTasks(mapped);
        _save(ENG_KEY, mapped);
        setSelected(mapped[0]?.id || null);
      }
    }).catch(err => { if (!cancelled) setApiError(err.message); });
    return () => { cancelled = true; };
  }, []);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 2400); };

  const handleAdvance = useCallback((id) => {
    setTasks(prev => {
      const next = prev.map(t => {
        if (t.id !== id) return t;
        const idx = STAGES.findIndex(s => s.id === t.stage);
        const nextStage = STAGES[idx + 1];
        if (!nextStage) return t;
        return { ...t, stage: nextStage.id };
      });
      _save(ENG_KEY, next);
      return next;
    });
    showToast("Task advanced");
    track.event("eng_task_advanced", { id });
  }, []);

  const visibleTasks = tasks.filter(t => filter === "all" || t.stage === filter || t.priority === filter);
  const selectedTask = selected ? tasks.find(t => t.id === selected) : null;

  // Stage counts
  const stageCounts = STAGES.reduce((acc, s) => { acc[s.id] = tasks.filter(t => t.stage === s.id).length; return acc; }, {});

  return (
    <div className="engineering-center page-enter">
      {toast && <div className="ec-toast">{toast}</div>}
      {apiError && <div className="ac-api-banner ac-api-banner--error">⚠ Live mission data unavailable — showing cached data ({apiError})</div>}

      <div className="ec-header">
        <div>
          <h1 className="ec-title">Engineering Center</h1>
          <p className="ec-subtitle">Autonomous engineering lifecycle — Requirement → Plan → Build → Review → Test → Done.</p>
        </div>
        <button className="ec-new-btn" onClick={() => {
          const t = { id: `et${Date.now()}`, title: "New task", requirement: "", plan: "", build: "", review: "", test: "", stage: "requirement", priority: "medium", repo: "ooplix-frontend", assignee: "Dev Agent", created: new Date().toISOString().slice(0,10) };
          const next = [t, ...tasks]; _save(ENG_KEY, next); setTasks(next); setSelected(t.id); showToast("Task created");
        }}>+ New task</button>
      </div>

      {/* Stage pipeline overview */}
      <div className="ec-pipeline-overview">
        {STAGES.map(s => (
          <button
            key={s.id}
            className={`ec-pipeline-col${filter === s.id ? " ec-pipeline-col--active" : ""}`}
            style={filter === s.id ? { borderColor: s.color + "44" } : {}}
            onClick={() => setFilter(prev => prev === s.id ? "all" : s.id)}
          >
            <span className="ec-pipeline-icon" style={{ color: s.color }}>{s.icon}</span>
            <span className="ec-pipeline-label">{s.label}</span>
            <span className="ec-pipeline-count" style={{ color: s.color }}>{stageCounts[s.id]}</span>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="ec-tabs">
        {[
          { id: "board",   label: "Board"         },
          { id: "planner", label: "Planner"        },
          { id: "builder", label: "Builder"        },
          { id: "reviewer",label: "Reviewer"       },
          { id: "tester",  label: "Tester"         },
        ].map(t => (
          <button key={t.id} className={`ec-tab${section === t.id ? " ec-tab--active" : ""}`} onClick={() => setSection(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="ec-content" key={section}>

        {/* Board — all tasks + detail */}
        {section === "board" && (
          <div className="ec-board-layout">
            <div className="ec-task-list">
              {visibleTasks.map(t => (
                <TaskCard key={t.id} task={t} selected={selected === t.id} onSelect={setSelected} onAdvance={handleAdvance} />
              ))}
            </div>
            {selectedTask && <TaskDetail task={selectedTask} />}
          </div>
        )}

        {/* Stage-filtered views */}
        {["planner","builder","reviewer","tester"].map(sec => {
          const stageMap = { planner: "plan", builder: "build", reviewer: "review", tester: "test" };
          if (section !== sec) return null;
          const stageTasks = tasks.filter(t => t.stage === stageMap[sec]);
          return (
            <div key={sec} className="ec-stage-view">
              <p className="ec-stage-view-label">{stageTasks.length} task{stageTasks.length !== 1 ? "s" : ""} in this stage</p>
              {stageTasks.length === 0 ? (
                <div className="ec-empty">
                  <span className="ec-empty-icon">✓</span>
                  <p className="ec-empty-title">No tasks in {STAGES.find(s=>s.id===stageMap[sec])?.label}</p>
                </div>
              ) : (
                <div className="ec-board-layout">
                  <div className="ec-task-list">
                    {stageTasks.map(t => (
                      <TaskCard key={t.id} task={t} selected={selected === t.id} onSelect={setSelected} onAdvance={handleAdvance} />
                    ))}
                  </div>
                  {selectedTask && stageTasks.find(t => t.id === selected) && <TaskDetail task={selectedTask} />}
                </div>
              )}
            </div>
          );
        })}

      </div>
    </div>
  );
}
