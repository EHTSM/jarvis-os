import React, { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
const MissionTemplates         = lazy(() => import("./MissionTemplates"));
const RecentSessions           = lazy(() => import("./RecentSessions"));
const RepoInsights             = lazy(() => import("./RepoInsights"));
const WorkspacePersonalization = lazy(() => import("./WorkspacePersonalization"));
import {
  emergencyStop,
  emergencyResume,
  getRuntimeHistory,
  getApprovalQueue,
  decideApprovalItem,
  getUnifiedQueue,
  getSystemHealthReport,
  dispatchTask,
} from "../runtimeApi";
import {
  getRevenueDashboard,
  getConnectorHealth,
  getDeploymentActive,
  getDeploymentStats,
} from "../founderHomeApi";
import { getTwinDashboard } from "../twinApi";
import {
  FadeUp,
  StaggerList,
  StaggerItem,
  FeedRow,
  StatusDot,
  PulseDot,
  PressButton,
  ExecStateCard,
} from "../design/Animated";
import {
  spring,
  transition,
  staggerContainer,
  staggerItem,
  thinkingScanStyle,
  thinkingScanAnim,
  thinkingScanTransition,
  approvalExitApprove,
  approvalExitReject,
} from "../design/motion";
import "./CommandCenter.css";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function _ago(isoStr) {
  if (!isoStr) return "";
  const s = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function _fmtUptime(secs) {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function _execState(item) {
  const status = (item.status || item.state || "").toLowerCase();
  if (status === "running" || status === "active")                       return "running";
  if (status === "thinking" || status === "llm")                         return "thinking";
  if (status === "done" || status === "success" || status === "completed") return "done";
  if (status === "failed" || status === "error")                         return "error";
  if (status === "paused")                                               return "paused";
  if (status === "queued" || status === "pending")                       return "queued";
  return "idle";
}

function _priorityClass(p) {
  if (!p) return "normal";
  const s = String(p).toLowerCase();
  if (s === "critical" || s === "p0") return "critical";
  if (s === "high"     || s === "p1") return "high";
  return "normal";
}

const STATE_LABEL = {
  running:  "RUNNING",
  thinking: "THINKING",
  done:     "DONE",
  error:    "ERROR",
  queued:   "QUEUED",
  paused:   "PAUSED",
  idle:     "IDLE",
};

// A rejected fetch is a real backend failure — it must never render identically
// to "no data yet." Shared distinct error state for CommandCenter panels.
function CmdPanelError({ error, onRetry }) {
  return (
    <div className="cmd-panel-error">
      <span className="cmd-panel-error-text">Couldn't load this data{error ? ` — ${error}` : ""}.</span>
      <button className="cmd-panel-error-retry" onClick={onRetry}>Retry</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HealthPulseBar
// Always-visible system state strip — one animated pill per service.
// ─────────────────────────────────────────────────────────────────────────────

function HealthPulseBar({ opsData, online, emergencyActive, onResume, onStop, onRefresh }) {
  const services   = opsData?.services || {};
  const queue      = opsData?.queue    || {};
  const uptime     = opsData?.uptime?.seconds;
  const heap       = opsData?.memory?.current?.heap_mb;
  const qRun       = queue?.counts?.running ?? 0;
  const apiLatency = opsData?.latency?.api_ms ?? null;

  const pulses = [
    {
      id:    "runtime",
      label: "Runtime",
      state: online ? "ok" : "crit",
      value: online ? (uptime ? _fmtUptime(uptime) : "Live") : "Offline",
    },
    {
      id:    "agents",
      label: `Agents`,
      state: qRun > 0 ? "live" : "ok",
      value: qRun > 0 ? `${qRun} running` : "Idle",
    },
    {
      id:    "ai",
      label: "AI",
      state: (services.ai || services.groq) ? "ok" : "warn",
      value: (services.ai || services.groq) ? "Online" : "Offline",
    },
    {
      id:    "queue",
      label: "Queue",
      state: queue?.healthy === false ? "warn" : "ok",
      value: `${(queue?.counts?.pending ?? 0)} queued`,
    },
    ...(apiLatency != null ? [{
      id:    "api",
      label: "API",
      state: apiLatency > 500 ? "warn" : "ok",
      value: `${apiLatency}ms`,
    }] : []),
    ...(heap != null ? [{
      id:    "mem",
      label: "Memory",
      state: heap > 400 ? "warn" : "ok",
      value: `${heap} MB`,
    }] : []),
  ];

  // Emergency — full-width red banner with animated pulsing border
  if (emergencyActive) {
    return (
      <motion.div
        className="cmd-pulse cmd-pulse--emergency"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transition.fast}
      >
        <motion.span
          className="cmd-pulse-dot cmd-pulse-dot--crit"
          animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
        <span className="cmd-pulse-emerg">EMERGENCY STOP ACTIVE — All execution halted</span>
        <button className="cmd-pulse-resume" onClick={onResume}>Resume →</button>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="cmd-pulse"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition.enter}
    >
      <motion.div
        className="cmd-pulse-items"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {pulses.map((p) => (
          <motion.div
            key={p.id}
            className="cmd-pulse-item"
            variants={staggerItem}
          >
            <motion.span
              className={`cmd-pulse-dot cmd-pulse-dot--${p.state}`}
              animate={p.state === "live" ? { scale: [1, 1.4, 1], opacity: [1, 0.6, 1] } : {}}
              transition={p.state === "live" ? { duration: 2.4, repeat: Infinity } : {}}
            />
            <span className="cmd-pulse-label">{p.label}</span>
            <span className="cmd-pulse-value">{p.value}</span>
          </motion.div>
        ))}
      </motion.div>
      <div className="cmd-pulse-actions">
        {onRefresh && (
          <button className="cmd-pulse-refresh" onClick={onRefresh} title="Refresh now" aria-label="Refresh status">
            <span aria-hidden="true">↻</span>
          </button>
        )}
        {online && (
          <button className="cmd-pulse-stop" onClick={onStop} title="Emergency stop (⌘⇧.)" aria-label="Emergency stop">
            <span aria-hidden="true">⏹</span>
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MissionFeed
// Live stream of runtime events with flash-on-new, thinking scan, LIVE header.
// ─────────────────────────────────────────────────────────────────────────────

function ExecRow({ item, isNew }) {
  const state = _execState(item);
  const label = item.input || item.description || item.label || item.task || "—";
  const agent = item.agentId || item.agent_id || item.executionId || "";
  const ts    = item.timestamp || item.ts || item.startedAt || item.created_at;

  return (
    <motion.div
      className={`cmd-feed-row exec-state exec-state--${state}${isNew ? " cmd-feed-row--flash" : ""}${state === "thinking" ? " cmd-feed-row--thinking" : ""}`}
      style={{ position: "relative", overflow: "hidden" }}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={transition.enter}
      layout
    >
      <StatusDot execState={state} size="sm" />
      <span className="cmd-feed-ts mono-sm">{ts ? _ago(ts) : ""}</span>
      <span className={`badge badge--${state} badge--pill cmd-feed-badge`}>
        {STATE_LABEL[state] || state.toUpperCase()}
      </span>
      {agent && (
        <span className="cmd-feed-agent mono-sm text-faint">{String(agent).slice(0, 14)}</span>
      )}
      <span className="cmd-feed-label truncate">{label}</span>

      {/* Thinking scan line overlay */}
      {state === "thinking" && (
        <motion.div
          style={thinkingScanStyle}
          animate={thinkingScanAnim}
          transition={thinkingScanTransition}
        />
      )}
    </motion.div>
  );
}

function MissionFeed({ opsData, online }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [newIds,  setNewIds]  = useState(new Set());
  const prevIds = useRef(new Set());

  const load = useCallback(async () => {
    const [hist, queue] = await Promise.allSettled([
      getRuntimeHistory(30),
      getUnifiedQueue(),
    ]);

    // Both calls failing means the feed genuinely can't load — a rejected
    // promise must not be silently treated as "no missions yet."
    if (hist.status === "rejected" && queue.status === "rejected") {
      setError(hist.reason?.message || queue.reason?.message || "Failed to load mission feed");
      setLoading(false);
      return;
    }
    setError(null);

    const histItems  = hist.status  === "fulfilled" ? (hist.value?.history  || hist.value?.items  || hist.value  || []) : [];
    const queueItems = queue.status === "fulfilled" ? (queue.value?.queue   || queue.value?.items || queue.value || []) : [];

    const seen = new Set();
    const merged = [
      ...(Array.isArray(queueItems) ? queueItems : []),
      ...(Array.isArray(histItems)  ? histItems  : []),
    ]
      .filter(item => {
        const id = item.id || item.executionId || item.taskId;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort((a, b) => {
        const ta = new Date(a.timestamp || a.ts || a.startedAt || 0).getTime();
        const tb = new Date(b.timestamp || b.ts || b.startedAt || 0).getTime();
        return tb - ta;
      })
      .slice(0, 40);

    const currentIds = new Set(merged.map(i => i.id || i.executionId || i.taskId).filter(Boolean));
    const fresh = new Set([...currentIds].filter(id => !prevIds.current.has(id)));
    prevIds.current = currentIds;

    setNewIds(fresh);
    setHistory(merged);
    setLoading(false);

    // Clear flash markers after animation
    if (fresh.size > 0) {
      setTimeout(() => setNewIds(new Set()), 1200);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const autoEntries = useMemo(() => {
    const auto = opsData?.automation || {};
    return Object.entries(auto)
      .filter(([, d]) => d.sent > 0 && d.lastRun)
      .map(([key, d]) => ({
        id: `auto-${key}`,
        status: "done",
        input: `Automation: ${key} — ${d.sent} sent`,
        timestamp: d.lastRun,
      }));
  }, [opsData]);

  const allItems = useMemo(() => {
    return [...history, ...autoEntries]
      .sort((a, b) => new Date(b.timestamp || b.ts || 0) - new Date(a.timestamp || a.ts || 0))
      .slice(0, 40);
  }, [history, autoEntries]);

  if (loading) {
    return (
      <div className="cmd-feed-list">
        {[0,1,2,3].map(i => (
          <div key={i} className="cmd-feed-row cmd-feed-row--skeleton">
            <div className="skeleton skeleton--text" style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0 }} />
            <div className="skeleton skeleton--text" style={{ width: 36 }} />
            <div className="skeleton skeleton--text" style={{ width: 64 }} />
            <div className="skeleton skeleton--text" style={{ flex: 1 }} />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <CmdPanelError error={error} onRetry={load} />;
  }

  if (allItems.length === 0) {
    return (
      <div className="cmd-feed-empty">
        <motion.div
          className="cmd-feed-empty-icon"
          animate={{ opacity: [0.4, 0.9, 0.4] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        >
          ◎
        </motion.div>
        <p className="cmd-feed-empty-title">Awaiting first dispatch</p>
        <p className="cmd-feed-empty-sub">
          Dispatch a task below or add a contact — the OS will start executing.
        </p>
      </div>
    );
  }

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <div className="cmd-feed-list">
        {allItems.map(item => (
          <ExecRow
            key={item.id || item.executionId || item.taskId || item.timestamp}
            item={item}
            isNew={newIds.has(item.id || item.executionId || item.taskId)}
          />
        ))}
      </div>
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ActiveAgents
// Running agents grid — thinking shimmer, running glow, idle empty state.
// ─────────────────────────────────────────────────────────────────────────────

function AgentCard({ agent }) {
  const state   = _execState(agent);
  const name    = agent.agentType || agent.type || agent.name || "Agent";
  const id      = agent.agentId   || agent.agent_id || agent.id || agent.executionId || "";
  const task    = agent.input     || agent.description || agent.task || "—";
  const ts      = agent.startedAt || agent.timestamp || agent.ts;
  const elapsed = ts ? _ago(ts) : "";

  return (
    <motion.div
      className={`cmd-agent-card cmd-agent-card--${state}`}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.93 }}
      transition={transition.card}
      layout
      style={{ position: "relative", overflow: "hidden" }}
    >
      <div className="cmd-agent-card-top">
        <StatusDot execState={state} size="lg" />
        <span className="cmd-agent-name">{name}</span>
        {elapsed && <span className="cmd-agent-elapsed mono-sm text-faint">{elapsed}</span>}
      </div>
      {id && <div className="cmd-agent-id mono-sm text-faint">{String(id).slice(0, 20)}</div>}
      <div className="cmd-agent-task truncate">{task}</div>
      <div className="cmd-agent-state">
        <span className={`badge badge--${state} badge--pill`}>{STATE_LABEL[state] || state}</span>
      </div>

      {/* Thinking shimmer overlay */}
      {state === "thinking" && (
        <motion.div
          style={thinkingScanStyle}
          animate={thinkingScanAnim}
          transition={thinkingScanTransition}
        />
      )}
    </motion.div>
  );
}

function ActiveAgents({ opsData }) {
  const [agents,  setAgents]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await getUnifiedQueue();
      const raw = res?.queue || res?.items || res?.running || res || [];
      const active = (Array.isArray(raw) ? raw : [])
        .filter(a => {
          const s = (a.status || a.state || "").toLowerCase();
          return s === "running" || s === "active" || s === "thinking" || s === "llm";
        })
        .slice(0, 8);
      setAgents(active);
      setError(null);
    } catch (e) {
      setError(e.message || "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const fromOps = useMemo(() => {
    const qRun = opsData?.queue?.counts?.running ?? 0;
    if (agents.length === 0 && qRun > 0) {
      return Array.from({ length: Math.min(qRun, 3) }, (_, i) => ({
        id: `placeholder-${i}`,
        status: "running",
        agentType: "Runtime Agent",
        input: "Processing…",
      }));
    }
    return [];
  }, [agents, opsData]);

  const displayed = agents.length > 0 ? agents : fromOps;

  if (loading) {
    return (
      <div className="cmd-agent-grid">
        {[0,1,2].map(i => (
          <div key={i} className="skeleton skeleton--card" style={{ height: 88, borderRadius: 10 }} />
        ))}
      </div>
    );
  }

  if (error) {
    return <CmdPanelError error={error} onRetry={load} />;
  }

  if (displayed.length === 0) {
    return (
      <div className="cmd-agents-empty">
        <StatusDot execState="idle" size="md" />
        <span>No agents active — system is idle</span>
      </div>
    );
  }

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <div className="cmd-agent-grid">
        {displayed.map(agent => (
          <AgentCard key={agent.id || agent.agentId || agent.executionId} agent={agent} />
        ))}
      </div>
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EngineeringTimeline
// NEW component — horizontal 60-minute event timeline.
// ─────────────────────────────────────────────────────────────────────────────

function EngineeringTimeline({ opsData }) {
  const [events, setEvents]     = useState([]);
  const [hovered, setHovered]   = useState(null);
  // Mission 58: fetchEvents had no try/catch at all — a rejected
  // getRuntimeHistory() promise was an unhandled rejection, and the
  // timeline silently showed only its static placeholder dots forever,
  // indistinguishable from a genuinely quiet 60 minutes (Mission 43B
  // finding). Same CmdPanelError pattern this file already uses elsewhere.
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await getRuntimeHistory(60);
      const items = r?.history || r?.items || r || [];
      setEvents(Array.isArray(items) ? items.slice(0, 40) : []);
      setError(null);
    } catch (e) {
      setError(e?.message || "Could not load engineering timeline.");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 15000);
    return () => clearInterval(id);
  }, [load]);

  const now    = Date.now();
  const WINDOW = 60 * 60 * 1000; // 60 min

  const positioned = events.map((e, i) => {
    const ts  = new Date(e.timestamp || e.ts || e.startedAt || 0).getTime();
    const pct = Math.max(0, Math.min(98, ((ts - (now - WINDOW)) / WINDOW) * 100));
    return { ...e, pct, _idx: i };
  });

  const placeholders = [20, 40, 60, 80];

  return (
    <motion.div
      className="cmd-timeline"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...transition.enter, delay: 0.24 }}
    >
      <div className="cmd-panel-header">
        <span className="section-label">Engineering Timeline</span>
        <span className="mono-sm text-faint">Last 60 min</span>
      </div>

      {error ? <CmdPanelError error={error} onRetry={load} /> : null}
      <div className="cmd-timeline-body">
        <div className="cmd-timeline-track">
          <div className="cmd-timeline-rail" />

          {positioned.map((e, i) => {
            const state = _execState(e);
            const label = e.input || e.description || e.task || state;
            return (
              <motion.div
                key={e.id || i}
                className={`cmd-timeline-dot exec-state--${state}`}
                style={{ left: `${e.pct}%` }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ ...spring.snappy, delay: i * 0.015 }}
                onMouseEnter={() => setHovered({ ...e, label, state, idx: i })}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}

          {events.length === 0 && placeholders.map(p => (
            <div
              key={p}
              className="cmd-timeline-dot cmd-timeline-dot--empty"
              style={{ left: `${p}%` }}
            />
          ))}

          {/* Hover tooltip */}
          <AnimatePresence>
            {hovered && (
              <motion.div
                className="cmd-timeline-tooltip"
                style={{ left: `${Math.min(hovered.pct, 75)}%` }}
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                transition={transition.fast}
              >
                <span className={`cmd-timeline-tooltip-state exec-state--${hovered.state}`}>
                  {STATE_LABEL[hovered.state] || hovered.state}
                </span>
                <span className="cmd-timeline-tooltip-label">{hovered.label}</span>
                {(hovered.timestamp || hovered.ts) && (
                  <span className="mono-sm text-faint">{_ago(hovered.timestamp || hovered.ts)} ago</span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="cmd-timeline-labels">
          <span className="mono-sm text-faint">−60m</span>
          <span className="mono-sm text-faint">−30m</span>
          <span className="mono-sm text-faint">now</span>
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ApprovalQueue
// Decision queue — spring exit, count badge, priority pulse border.
// ─────────────────────────────────────────────────────────────────────────────

function ApprovalCard({ item, onDecide }) {
  const [busy,    setBusy]    = useState(null);    // "approve" | "reject" | null
  const [exiting, setExiting] = useState(null);    // "approve" | "reject" | null
  const priority = _priorityClass(item.priority);

  const handle = useCallback(async (decision) => {
    setBusy(decision);
    setExiting(decision);
    try {
      await onDecide(item.id || item.itemId, decision, item.queueType || "patch");
    } catch {
      // onDecide throws when the backend rejected the decision (see
      // handleDecide in ApprovalQueue) — the item stays in the pending list,
      // so cancel the exit animation that was optimistically started above.
      setExiting(null);
    } finally {
      setBusy(null);
    }
  }, [item, onDecide]);

  const risk    = item.riskScore ?? item.risk_score ?? item.confidence ?? null;
  const riskPct = risk != null ? Math.round(Number(risk) * (risk > 1 ? 1 : 100)) : null;

  const exitAnim = exiting === "approve"
    ? approvalExitApprove
    : exiting === "reject"
    ? approvalExitReject
    : undefined;

  return (
    <motion.div
      className={`cmd-approval-card approval-card--${priority}`}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={exitAnim ?? { opacity: 0, scale: 0.96 }}
      transition={transition.card}
      whileHover={{ scale: 1.01 }}
    >
      <div className="cmd-approval-header">
        <span className={`badge badge--${priority} badge--pill`}>
          {priority.toUpperCase()}
        </span>
        {riskPct != null && (
          <span className="cmd-approval-risk">
            Risk{" "}
            <span style={{ color: riskPct > 70 ? "var(--danger)" : riskPct > 40 ? "var(--warning)" : "var(--success)" }}>
              {riskPct}%
            </span>
          </span>
        )}
        {item.timestamp && (
          <span className="cmd-approval-ts mono-sm text-faint">{_ago(item.timestamp)}</span>
        )}
      </div>

      <p className="cmd-approval-desc">
        {item.description || item.recommendation || item.input || item.title || "Action pending"}
      </p>

      {item.impact && (
        <p className="cmd-approval-impact text-faint">{item.impact}</p>
      )}

      {riskPct != null && (
        <div className="cmd-approval-risk-bar">
          <motion.div
            className="cmd-approval-risk-fill"
            initial={{ width: 0 }}
            animate={{ width: `${riskPct}%` }}
            transition={transition.slow}
            style={{
              background: riskPct > 70
                ? "var(--danger)"
                : riskPct > 40
                ? "var(--warning)"
                : "var(--success)",
            }}
          />
        </div>
      )}

      <div className="cmd-approval-actions">
        <PressButton
          className="btn btn--success btn--sm"
          onClick={() => handle("approve")}
          disabled={!!busy}
        >
          {busy === "approve" ? "…" : "✓ Approve"}
        </PressButton>
        <PressButton
          className="btn btn--danger btn--sm"
          onClick={() => handle("reject")}
          disabled={!!busy}
        >
          {busy === "reject" ? "…" : "✗ Reject"}
        </PressButton>
      </div>
    </motion.div>
  );
}

export function ApprovalQueue({ onNavigate }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [decided, setDecided] = useState(new Set());

  const load = useCallback(async () => {
    try {
      const res = await getApprovalQueue();
      // getApprovalQueue() never throws — it catches internally and resolves
      // {success:false, error} on a real backend failure. Without this check,
      // that shape fell through to `res || []` (an object, not an array),
      // Array.isArray(raw) was false, and the queue silently rendered as
      // "Queue clear" — hiding a real outage on the panel that exists
      // specifically to surface risk. Same bug class fixed across BusinessOS
      // (Mission 24) and DevOps emergency controls (Mission 25).
      if (res?.success === false) throw new Error(res.error || "Failed to load approvals");
      const raw = res?.queue || res?.items || res?.approvals || res || [];
      setItems(Array.isArray(raw) ? raw : []);
      setError(null);
    } catch (e) {
      setError(e.message || "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 12000);
    return () => clearInterval(id);
  }, [load]);

  const handleDecide = useCallback(async (id, decision, queueType) => {
    // decideApprovalItem() never throws — it catches internally and resolves
    // {success:false, error} on a real backend failure. Without this check,
    // the item was optimistically marked "decided" (removed from the
    // pending list) regardless of whether the backend actually recorded the
    // approve/reject — an operator could believe they rejected a risky
    // agent action while the backend never received it.
    const res = await decideApprovalItem(id, decision, queueType);
    if (res?.success === false) throw new Error(res.error || `Failed to ${decision}`);
    setDecided(prev => new Set([...prev, id]));
    setTimeout(load, 800);
  }, [load]);

  const pending = items.filter(i => !decided.has(i.id || i.itemId));
  const count   = pending.length;

  return (
    <div className="cmd-approval-panel">
      <div className="cmd-panel-header">
        <span className="section-label">Approvals</span>
        {count > 0 && (
          <motion.span
            key={count}
            className={`badge badge--${count > 2 ? "warning" : "dim"} badge--pill`}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring.snappy}
          >
            {count}
          </motion.span>
        )}
        {count > 0 && (
          <button className="cmd-panel-link" onClick={() => onNavigate?.("recommend")}>
            View all →
          </button>
        )}
      </div>

      {loading ? (
        <div className="cmd-approval-list">
          {[0,1].map(i => (
            <div key={i} className="skeleton skeleton--card" style={{ height: 100, marginBottom: 8, borderRadius: 10 }} />
          ))}
        </div>
      ) : error ? (
        <CmdPanelError error={error} onRetry={load} />
      ) : pending.length === 0 ? (
        <div className="cmd-approval-empty">
          <span className="cmd-approval-empty-icon">✓</span>
          <p>Queue clear — all decisions resolved</p>
        </div>
      ) : (
        <AnimatePresence mode="popLayout" initial={false}>
          <div className="cmd-approval-list">
            {pending.slice(0, 5).map(item => (
              <ApprovalCard
                key={item.id || item.itemId}
                item={item}
                onDecide={handleDecide}
              />
            ))}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CommandDispatch
// Full-width input bar — busy spinner, scrollable chips, result fade-in.
// ─────────────────────────────────────────────────────────────────────────────

const QUICK_CMDS = [
  { label: "Health check",      cmd: "Run health diagnostics"      },
  { label: "Active agents",     cmd: "List all active agents"      },
  { label: "Pipeline summary",  cmd: "Show my pipeline summary"    },
  { label: "Recent tasks",      cmd: "Show last 10 completed tasks" },
  { label: "Memory stats",      cmd: "Show knowledge graph stats"   },
];

function CommandDispatch({ online }) {
  const [input,  setInput]  = useState("");
  const [result, setResult] = useState(null);
  const [busy,   setBusy]   = useState(false);
  const inputRef = useRef(null);
  const resultTimerRef = useRef(null);

  const dismissResult = useCallback(() => {
    clearTimeout(resultTimerRef.current);
    setResult(null);
  }, []);

  const run = useCallback(async (cmd) => {
    const text = (cmd || input).trim();
    if (!text || busy || !online) return;
    setBusy(true);
    clearTimeout(resultTimerRef.current);
    setResult(null);
    try {
      const res = await dispatchTask(text, 20000);
      setResult({
        ok:   res.success !== false,
        text: res.reply || res.output || res.result || (res.success ? "Done." : res.error || "Failed."),
      });
      if (res.success !== false) {
        resultTimerRef.current = setTimeout(() => setResult(null), 8000);
      }
    } catch (e) {
      setResult({ ok: false, text: e.message });
    } finally {
      setBusy(false);
      if (!cmd) setInput("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, busy, online]);

  return (
    <div className="cmd-dispatch">
      <div className="cmd-dispatch-row">
        <span className="cmd-dispatch-prefix mono-sm">›</span>
        <input
          ref={inputRef}
          className="cmd-dispatch-input"
          placeholder={
            busy    ? "Executing…" :
            !online ? "Backend offline" :
            "Run a task, workflow, or command…"
          }
          aria-label="Task or command input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); }
            if (e.key === "Escape" && input) { e.stopPropagation(); setInput(""); dismissResult(); }
          }}
          disabled={!online || busy}
          autoComplete="off"
          spellCheck={false}
        />
        {input && !busy && (
          <button
            className="cmd-dispatch-clear"
            onClick={() => { setInput(""); dismissResult(); inputRef.current?.focus(); }}
            title="Clear (Esc)"
            aria-label="Clear input"
          >✕</button>
        )}
        <motion.button
          className="btn btn--primary btn--sm cmd-dispatch-run"
          onClick={() => run()}
          disabled={!online || busy || !input.trim()}
          whileTap={{ scale: 0.94 }}
          transition={spring.snappy}
        >
          {busy ? <span className="cmd-spinner" /> : "Run ↵"}
        </motion.button>
      </div>

      <div className="cmd-dispatch-chips">
        {QUICK_CMDS.map(q => (
          <button
            key={q.cmd}
            className="cmd-chip"
            onClick={() => run(q.cmd)}
            disabled={!online || busy}
            title={q.cmd}
          >
            {q.label}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {result && (
          <motion.div
            className={`cmd-dispatch-result${result.ok ? "" : " cmd-dispatch-result--err"}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={transition.enter}
          >
            <span className="cmd-dispatch-result-icon mono-sm">
              {result.ok ? "✓" : "✗"}
            </span>
            <span className="cmd-dispatch-result-text">{result.text}</span>
            <button
              className="cmd-dispatch-result-dismiss"
              onClick={dismissResult}
              title="Dismiss"
              aria-label="Dismiss result"
            >✕</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// J6: LiveActivityStream — SSE-driven real-time event feed.
// Reuses the same /runtime/stream EventSource already consumed by EngineeringConsole.
// Separate connection: CommandCenter needs its own SSE client (browser-level).
// ─────────────────────────────────────────────────────────────────────────────

const EVT_TYPE_COLOR = {
  'execution':          '#34d399',
  'agent:message':      '#60a5fa',
  'agent:override':     '#f87171',
  'collaboration:action': '#a78bfa',
  'collaboration:message': '#60a5fa',
  'lifecycle:stage:start': '#fbbf24',
  'lifecycle:stage:complete': 'var(--success)',
  'lifecycle:stage:failed':  'var(--danger)',
  'mission:started':    'var(--success)',
  'mission:completed':  'var(--success)',
  'mission:failed':     'var(--danger)',
  'telemetry':          '#374151',
  'heartbeat':          '#1f2937',
};

function LiveActivityStream() {
  const [events, setEvents] = useState([]);
  const listRef = useRef(null);

  useEffect(() => {
    const streamUrl = (process.env.REACT_APP_API_URL || '') + '/runtime/stream';
    const es = new EventSource(streamUrl, { withCredentials: true });
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const type = data.type || data.event || 'event';
        if (type === 'heartbeat') return;
        const text = data.message || data.log ||
          (data.missionId ? `[${data.missionId}] ` : '') +
          (data.agentId   ? `${data.agentId} — ` : '') +
          (data.stage || data.action || type);
        setEvents(prev => {
          const next = [{ type, text: String(text).slice(0, 100), ts: Date.now() }, ...prev].slice(0, 60);
          return next;
        });
      } catch {}
    };
    es.onerror = () => {};
    return () => es.close();
  }, []);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        ref={listRef}
        style={{ flex: 1, overflowY: 'auto', fontSize: 10, fontFamily: 'monospace' }}
      >
        {events.length === 0 && (
          <div style={{ color: 'var(--text-dim)', padding: '12px 0', textAlign: 'center', fontSize: 11 }}>
            Waiting for runtime events…
          </div>
        )}
        {events.map((evt, i) => {
          const color = EVT_TYPE_COLOR[evt.type] || 'var(--text-dim)';
          return (
            <div key={i} style={{ display: 'flex', gap: 6, padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.03)', alignItems: 'flex-start' }}>
              <span style={{ color: '#374151', flexShrink: 0 }}>
                {new Date(evt.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span style={{ fontSize: 9, fontWeight: 700, color, padding: '1px 4px', borderRadius: 4, background: color + '18', flexShrink: 0, whiteSpace: 'nowrap' }}>
                {evt.type}
              </span>
              <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {evt.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// J6: MissionTimelineStrip — active missions with current lifecycle stage.
// Fetches from /p27/missions (already fetched by JarvisBrainCenter;
// here in CommandCenter it shares a separate fetch — no shared store to reuse).
// ─────────────────────────────────────────────────────────────────────────────

const LC_STAGE_COLORS = {
  observe:'#60a5fa', detect:'#60a5fa', reason:'#a78bfa', recommend:'#a78bfa',
  plan:'#fbbf24', delegate:'#fbbf24', execute:'#34d399', review:'#34d399',
  test:'#34d399', secure:'#f87171', deploy:'#fb923c', verify:'#fb923c',
  heal:'#94a3b8', learn:'#94a3b8',
};

function MissionTimelineStrip() {
  const [missions, setMissions] = useState([]);
  const [stages,   setStages]   = useState({});
  const [error,    setError]    = useState(null);

  const load = useCallback(async () => {
    try {
      // C.2 (C2-01): this used to be fetch(...).json() with no status check.
      // /p27/missions answers 401 {"error":"Unauthorized"} on an expired
      // session — that body parses fine, res.missions is undefined so the list
      // became [], and setError(null) then CLEARED the error. The user saw a
      // truthful-looking "no active missions" while actually being logged out.
      // Same defect class as the A.11.8 Marketplace 402-rendered-as-0 finding:
      // an authorization failure must never present as a successful empty state.
      const r = await fetch((process.env.REACT_APP_API_URL || '') + '/p27/missions', { credentials: 'include' });
      if (!r.ok) {
        setMissions([]);
        setError(r.status === 401 || r.status === 403
          ? 'Your session has expired or you lack access to missions. Please sign in again.'
          : `Could not load missions (HTTP ${r.status}).`);
        return;
      }
      const res = await r.json();
      const list = res.missions || res.data || (Array.isArray(res) ? res : []);
      const active = list.filter(m => m.status === 'running' || m.status === 'active' || m.status === 'planned').slice(0, 6);
      setMissions(active);
      setError(null);

      // Fetch lifecycle stage for each active mission (secondary enrichment —
      // a single stage lookup failing shouldn't block the mission list itself)
      const stageMap = {};
      await Promise.allSettled(
        active.map(m =>
          fetch((process.env.REACT_APP_API_URL || '') + `/runtime/stage/${m.id}`, { credentials: 'include' })
            .then(r => r.json())
            .then(r => { if (r.stage) stageMap[m.id] = r.stage; })
            .catch(() => {})
        )
      );
      setStages(stageMap);
    } catch (e) {
      // The mission list itself failed to load — this is a real backend error,
      // not "no active missions."
      setError(e.message || "Failed to load mission timeline");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 10000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <CmdPanelError error={error} onRetry={load} />;

  if (!missions.length) return (
    <div style={{ color: 'var(--text-dim)', fontSize: 11, padding: '10px 0', textAlign: 'center' }}>No active missions</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {missions.map(m => {
        const stage = stages[m.id];
        const color = stage ? (LC_STAGE_COLORS[stage.stage] || 'var(--text-dim)') : '#374151';
        const pct   = stage?.progressPct ?? (m.metrics?.progress ?? 0);
        return (
          <div key={m.id} style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 5, border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.title || m.goal || m.id}
              </span>
              {stage && (
                <span style={{ fontSize: 9, fontWeight: 700, color, padding: '1px 5px', borderRadius: 8, background: color + '18', flexShrink: 0 }}>
                  {stage.stageLabel || stage.stage}
                </span>
              )}
            </div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.5s' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// J6: QueueOverview — queue counts from /ops (opsData prop, no new fetch).
// ─────────────────────────────────────────────────────────────────────────────

function QueueOverview({ opsData }) {
  const queue = opsData?.queue || {};
  const counts = queue.counts || {};
  const items = [
    { label: 'Pending',   value: counts.pending  ?? '—', color: 'var(--warning)' },
    { label: 'Running',   value: counts.running  ?? '—', color: 'var(--success)' },
    { label: 'Done',      value: counts.done     ?? '—', color: 'var(--text-dim)' },
    { label: 'Failed',    value: counts.failed   ?? '—', color: 'var(--danger)' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      {items.map(item => (
        <div key={item.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 5, padding: '7px 10px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: item.color, fontFamily: 'monospace' }}>{item.value}</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.label}</div>
        </div>
      ))}
      {queue.oldestPendingMins > 0 && (
        <div style={{ gridColumn: '1 / -1', fontSize: 10, color: queue.oldestPendingMins > 30 ? 'var(--danger)' : 'var(--warning)', textAlign: 'center', marginTop: 2 }}>
          Oldest pending: {queue.oldestPendingMins}m
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Founder Home: RevenuePulse — MRR/ARR/subscriptions from /revenue/dashboard.
// operator-only endpoint — 403 for non-operator roles renders nothing (not an error).
// ─────────────────────────────────────────────────────────────────────────────

function RevenuePulse({ onNavigate }) {
  const [data, setData] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const r = await getRevenueDashboard();
    if (r?.status === 401 || r?.status === 403) { setForbidden(true); return; }
    if (r?.ok !== false) { setData(r.dashboard); setError(null); }
    else { setError(r.error || "Failed to load revenue data"); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => { if (!cancelled) await load(); };
    run();
    const t = setInterval(() => { if (!document.hidden) run(); }, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, [load]);

  if (forbidden) return null;

  // A genuine fetch failure must say so distinctly — not claim to still be loading.
  if (error && !data) return <CmdPanelError error={error} onRetry={load} />;

  if (!data) return (
    <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', padding: '10px 0' }}>Loading revenue…</div>
  );

  const fmtINR = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
  const items = [
    { label: 'MRR',        value: fmtINR(data.mrr),   color: 'var(--success)' },
    { label: 'ARR',        value: fmtINR(data.arr),   color: 'var(--accent2)' },
    { label: 'Paid',       value: data.paidCount ?? '—',  color: 'var(--accent)' },
    { label: 'Trials',     value: data.trialCount ?? '—', color: 'var(--warning)' },
    { label: 'Churn',      value: `${data.churnRate ?? 0}%`, color: (data.churnRate ?? 0) > 5 ? 'var(--danger)' : 'var(--text-dim)' },
    { label: 'Avg LTV',    value: fmtINR(data.ltv),  color: 'var(--info)' },
  ];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {items.map(item => (
          <div key={item.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 5, padding: '7px 8px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: item.color, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{item.value}</div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.label}</div>
          </div>
        ))}
      </div>
      {onNavigate && (
        <button className="cmd-panel-link" style={{ marginTop: 8, width: '100%', textAlign: 'right' }} onClick={() => onNavigate('billing')}>
          Full revenue center →
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Founder Home: FounderTwinPulse — Digital Twin trust/decisions from /twin/dashboard.
// V6 Phase 6 recovery: this backend (POST-Ω Sprint P6, digitalTwinEngine.cjs)
// was fully built with zero frontend consumers until this widget.
// ─────────────────────────────────────────────────────────────────────────────

function FounderTwinPulse({ onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const r = await getTwinDashboard();
    if (r?.status === 401 || r?.status === 403) { setError(null); setData({ forbidden: true }); return; }
    if (r?.ok !== false) { setData(r); setError(null); }
    else { setError(r.error || "Failed to load Digital Twin data"); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => { if (!cancelled) await load(); };
    run();
    const t = setInterval(() => { if (!document.hidden) run(); }, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, [load]);

  if (data?.forbidden) return null;
  if (error && !data) return <CmdPanelError error={error} onRetry={load} />;
  if (!data) return (
    <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', padding: '10px 0' }}>Loading twin…</div>
  );

  const items = [
    { label: 'Trust Score',   value: `${data.trustScore ?? 0}`,       color: 'var(--accent)' },
    { label: 'Accuracy',      value: `${data.accuracy ?? 0}%`,        color: 'var(--success)' },
    { label: 'Decisions',     value: data.totalDecisions ?? '—',      color: 'var(--accent2)' },
    { label: 'Auto-Resolved', value: data.autoResolved ?? '—',        color: 'var(--info)' },
    { label: 'Escalated',     value: data.founderRequired ?? '—',     color: 'var(--warning)' },
    { label: 'Min Saved',     value: data.minutesSaved ?? '—',        color: 'var(--text-dim)' },
  ];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {items.map(item => (
          <div key={item.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 5, padding: '7px 8px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: item.color, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{item.value}</div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.label}</div>
          </div>
        ))}
      </div>
      {onNavigate && (
        <button className="cmd-panel-link" style={{ marginTop: 8, width: '100%', textAlign: 'right' }} onClick={() => onNavigate('twin')}>
          Full twin console →
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Founder Home: ConnectorHealthPulse — secret/credential health from /vault/health.
// operator-only endpoint — 403 for non-operator roles renders nothing (not an error).
// ─────────────────────────────────────────────────────────────────────────────

function ConnectorHealthPulse({ onNavigate }) {
  const [health, setHealth] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const r = await getConnectorHealth();
    if (r?.status === 401 || r?.status === 403) { setForbidden(true); return; }
    if (r?.ok !== false) { setHealth(r); setError(null); }
    else { setError(r.error || "Failed to load connector health"); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => { if (!cancelled) await load(); };
    run();
    const t = setInterval(() => { if (!document.hidden) run(); }, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, [load]);

  if (forbidden) return null;

  // A genuine fetch failure must say so distinctly — not claim to still be loading.
  if (error && !health) return <CmdPanelError error={error} onRetry={load} />;

  if (!health) return (
    <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', padding: '10px 0' }}>Loading connector health…</div>
  );

  const score    = health.score ?? 100;
  const scoreColor = score >= 90 ? 'var(--success)' : score >= 70 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: scoreColor, fontFamily: 'monospace' }}>{score}</div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          Vault health score<br />
          <span className="mono-sm">{health.totalSecrets ?? 0} credentials tracked</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <div style={{ background: 'rgba(82,214,138,0.08)', border: '1px solid rgba(82,214,138,0.2)', borderRadius: 5, padding: '5px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--success)', fontFamily: 'monospace' }}>{health.ok ?? 0}</div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase' }}>OK</div>
        </div>
        <div style={{ background: 'rgba(240,180,41,0.08)', border: '1px solid rgba(240,180,41,0.2)', borderRadius: 5, padding: '5px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--warning)', fontFamily: 'monospace' }}>{health.expiring ?? 0}</div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Expiring</div>
        </div>
        <div style={{ background: 'rgba(245,91,91,0.08)', border: '1px solid rgba(245,91,91,0.2)', borderRadius: 5, padding: '5px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--danger)', fontFamily: 'monospace' }}>{health.overdue ?? 0}</div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Overdue</div>
        </div>
      </div>
      {onNavigate && (
        <button className="cmd-panel-link" style={{ marginTop: 8, width: '100%', textAlign: 'right' }} onClick={() => onNavigate('integrations')}>
          Connector Center →
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Founder Home: DeploymentPulse — active deploys + stats from /deployment/*.
// ─────────────────────────────────────────────────────────────────────────────

function DeploymentPulse({ onNavigate }) {
  const [active, setActive] = useState([]);
  const [stats, setStats]   = useState(null);
  const [forbidden, setForbidden] = useState(false);
  // Mission 58: a non-401 failure (e.g. a real 500) previously never set
  // `stats`, so the component stayed on "Loading deployments…" forever — a
  // silent stuck-loading state, not an honest error (Mission 43B finding).
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const [a, s] = await Promise.all([getDeploymentActive(), getDeploymentStats()]);
    if (a?.status === 401 || s?.status === 401) { setForbidden(true); return; }
    if (a?.ok === false && s?.ok === false) {
      setError(a.error || s.error || "Could not load deployment data.");
      return;
    }
    setError(null);
    if (a?.ok !== false) setActive(a.deployments || []);
    if (s?.ok !== false) setStats(s.stats || null);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 20000);
    return () => clearInterval(t);
  }, [load]);

  if (forbidden) return null;

  if (error && !stats) return <CmdPanelError error={error} onRetry={load} />;

  if (!stats) return (
    <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', padding: '10px 0' }}>Loading deployments…</div>
  );

  return (
    <div>
      {active.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
          {active.slice(0, 4).map((d, i) => (
            <div key={d.id || i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <PulseDot status="running" size={6} />
              <span style={{ flex: 1, fontSize: 11, color: 'var(--text)' }}>{d.target || d.id}</span>
              <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{d.stage || d.status}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--success)', textAlign: 'center', padding: '4px 0 8px' }}>No active deployments</div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 5, padding: '5px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--success)', fontFamily: 'monospace' }}>{stats.completed ?? 0}</div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Completed</div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 5, padding: '5px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--danger)', fontFamily: 'monospace' }}>{stats.failed ?? 0}</div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Failed</div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 5, padding: '5px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--warning)', fontFamily: 'monospace' }}>{stats.rolledBack ?? 0}</div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Rolled Back</div>
        </div>
      </div>
      {onNavigate && (
        <button className="cmd-panel-link" style={{ marginTop: 8, width: '100%', textAlign: 'right' }} onClick={() => onNavigate('devops')}>
          Deployments →
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// J6: ProviderHealth — AI provider status from /p27/ai/providers.
// ─────────────────────────────────────────────────────────────────────────────

function ProviderHealth() {
  const [providers, setProviders] = useState([]);
  // Mission 58: catch {} was fully empty, no error state — a genuine
  // failure to reach /p27/ai/providers was indistinguishable from "no
  // providers configured" (Mission 43B finding).
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch((process.env.REACT_APP_API_URL || '') + '/p27/ai/providers', { credentials: 'include' });
      // Mission 65: same defect class as the /p27/missions fix above — an
      // auth failure (401/403) or any non-2xx response can still return a
      // parseable JSON error body. Calling .json() unconditionally and
      // trusting its shape (r.providers || ...) silently produced an
      // empty provider list while setError(null) cleared any prior error,
      // presenting a genuine auth/server failure as "No provider data"
      // instead of surfacing it.
      if (!r.ok) {
        setProviders([]);
        setError(r.status === 401 || r.status === 403
          ? 'Your session has expired or you lack access to provider status. Please sign in again.'
          : `Could not load AI provider status (HTTP ${r.status}).`);
        return;
      }
      const res = await r.json();
      const list = res.providers || (Array.isArray(res) ? res : []);
      setProviders(list.slice(0, 6));
      setError(null);
    } catch (e) {
      setError(e?.message || "Could not load AI provider status.");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <CmdPanelError error={error} onRetry={load} />;

  if (!providers.length) return (
    <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', padding: '8px 0' }}>No provider data</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {providers.map((p, i) => {
        const ok    = p.status === 'active' || p.status === 'healthy' || p.available === true;
        const color = ok ? 'var(--success)' : p.status === 'degraded' ? '#eab308' : 'var(--danger)';
        return (
          <div key={p.id || p.name || i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 11, color: 'var(--text)' }}>{p.name || p.provider || p.id}</span>
            {p.model && <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{p.model}</span>}
            <span style={{ fontSize: 9, fontWeight: 700, color, padding: '1px 5px', borderRadius: 6, background: color + '18' }}>
              {p.status ?? (ok ? 'active' : 'offline')}
            </span>
            {p.latency != null && <span style={{ fontSize: 9, color: '#374151' }}>{p.latency}ms</span>}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// J6: RuntimeAlerts — warnings from opsData (no new fetch; opsData passed in).
// ─────────────────────────────────────────────────────────────────────────────

function RuntimeAlerts({ opsData }) {
  const warnings = opsData?.warnings || [];
  if (!warnings.length) return (
    <div style={{ fontSize: 11, color: 'var(--success)', textAlign: 'center', padding: '6px 0' }}>All systems operational</div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {warnings.slice(0, 5).map((w, i) => {
        const color = w.level === 'critical' ? 'var(--danger)' : w.level === 'warn' ? 'var(--warning)' : 'var(--text-dim)';
        return (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 8px', background: color + '0d', border: `1px solid ${color}33`, borderRadius: 4 }}>
            <span style={{ fontSize: 9, fontWeight: 800, color, flexShrink: 0, marginTop: 1 }}>{w.level?.toUpperCase()}</span>
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)', marginRight: 6 }}>{w.code}</span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{w.detail}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SystemHealth
// Compact health rows with stagger-in + memory bar + score number.
// ─────────────────────────────────────────────────────────────────────────────

function SystemHealth({ opsData, online }) {
  const [report, setReport] = useState(null);
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    // Mission 58: no .catch() — a rejected promise was an unhandled
    // rejection (Mission 43B finding). The Health Score section is a
    // non-critical enhancement over the row-based health display below,
    // which is derived from opsData and unaffected by this failing — so a
    // silent no-op (score section just doesn't appear) is the correct,
    // proportionate fix here, not a full CmdPanelError state.
    getSystemHealthReport().then(r => { if (r) setReport(r); }).catch(() => {});
  }, []);

  // Trigger stagger animation on first render
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 120);
    return () => clearTimeout(t);
  }, []);

  const services = opsData?.services || {};
  const queue    = opsData?.queue    || {};
  const heap     = opsData?.memory?.current?.heap_mb;
  const heapPct  = heap ? Math.min(100, Math.round((heap / 512) * 100)) : 0;

  const rows = [
    { label: "AI Engine",  ok: !!(services.ai || services.groq), value: (services.ai || services.groq) ? "Active"         : "Offline"          },
    { label: "WhatsApp",   ok: !!services.whatsapp,              value: services.whatsapp               ? "Connected"      : "Not configured"    },
    { label: "Payments",   ok: !!services.payments,              value: services.payments               ? "Razorpay ✓"    : "Not configured"    },
    { label: "Runtime",    ok: online,                           value: online                          ? "Online"         : "Offline"           },
    { label: "Queue",      ok: queue?.healthy !== false,         value: queue?.healthy === false        ? "Degraded"       : "Healthy"           },
  ];

  const score = report?.overallHealth ?? report?.score ?? report?.healthScore ?? null;
  const scoreColor = score == null ? "var(--text)"
    : score >= 80 ? "var(--success)"
    : score >= 50 ? "var(--warning)"
    : "var(--danger)";

  return (
    <div className="cmd-health" ref={ref}>
      {score != null && (
        <motion.div
          className="cmd-health-score"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={transition.enter}
        >
          <motion.span
            className="cmd-health-score-val"
            style={{ color: scoreColor }}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...spring.crisp, delay: 0.1 }}
          >
            {Math.round(score)}%
          </motion.span>
          <span className="section-label">Health Score</span>
        </motion.div>
      )}

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate={visible ? "visible" : "hidden"}
      >
        {rows.map((r, i) => (
          <motion.div
            key={r.label}
            className="cmd-health-row"
            variants={staggerItem}
          >
            <StatusDot execState={r.ok ? "done" : "error"} size="sm" />
            <span className="cmd-health-label">{r.label}</span>
            <span className={`cmd-health-val${!r.ok ? " text-faint" : ""}`}>{r.value}</span>
          </motion.div>
        ))}
      </motion.div>

      {heap != null && (
        <div className="cmd-health-mem">
          <div className="cmd-health-mem-label">
            <span className="cmd-health-label">Memory</span>
            <span className="cmd-health-val">{heap} MB</span>
          </div>
          <div className="cmd-health-mem-track">
            <motion.div
              className="cmd-health-mem-fill"
              initial={{ width: 0 }}
              animate={{ width: `${heapPct}%` }}
              transition={{ ...transition.slow, delay: 0.3 }}
              style={{
                background: heapPct > 80 ? "var(--danger)"
                  : heapPct > 60 ? "var(--warning)"
                  : "var(--success)",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CommandCenter — root
// 3-column OS cockpit layout.
// ─────────────────────────────────────────────────────────────────────────────

export default function CommandCenter({ stats, opsData, online, onNavigate, billing, onUpgrade, onRefreshOps }) {
  const [emergencyActive, setEmergencyActive] = useState(
    () => opsData?.emergencyStop?.active ?? false
  );
  const [stopConfirm, setStopConfirm] = useState(false);

  useEffect(() => {
    setEmergencyActive(opsData?.emergencyStop?.active ?? false);
  }, [opsData]);

  const handleStop = useCallback(() => {
    setStopConfirm(true);
  }, []);

  const handleStopConfirmed = useCallback(async () => {
    setStopConfirm(false);
    const res = await emergencyStop("operator_initiated");
    if (res?.success !== false) setEmergencyActive(true);
  }, []);

  const handleResume = useCallback(async () => {
    const res = await emergencyResume();
    if (res?.success !== false) setEmergencyActive(false);
  }, []);

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
  });

  return (
    <motion.div
      className={`cmd-root${emergencyActive ? " cmd-root--emergency" : ""}`}
      initial={{ opacity: 0, y: 10, filter: "blur(3px)" }}
      animate={{ opacity: 1, y: 0,  filter: "blur(0px)" }}
      transition={transition.enter}
    >
      {/* ── Emergency Stop Confirmation ───────────────────────────── */}
      <AnimatePresence>
        {stopConfirm && (
          <motion.div
            className="cmd-stop-confirm-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onClick={() => setStopConfirm(false)}
          >
            <motion.div
              className="cmd-stop-confirm-panel"
              initial={{ scale: 0.94, y: 8, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="cmd-stop-confirm-icon">⏹</div>
              <div className="cmd-stop-confirm-title">Emergency Stop</div>
              <div className="cmd-stop-confirm-body">All running tasks will be halted immediately. In-progress work will be paused and queued for resume.</div>
              <div className="cmd-stop-confirm-actions">
                <button className="cmd-stop-confirm-btn cmd-stop-confirm-btn--cancel" onClick={() => setStopConfirm(false)}>Cancel</button>
                <button className="cmd-stop-confirm-btn cmd-stop-confirm-btn--stop" onClick={handleStopConfirmed}>Stop All Execution</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Health Pulse Bar (always visible) ─────────────────────── */}
      <HealthPulseBar
        opsData={opsData}
        online={online}
        emergencyActive={emergencyActive}
        onStop={handleStop}
        onResume={handleResume}
        onRefresh={onRefreshOps}
      />

      {/* ── Page header ───────────────────────────────────────────── */}
      <motion.div
        className="cmd-header"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...transition.enter, delay: 0.06 }}
      >
        <div className="cmd-header-left">
          <h1 className="cmd-title">Command Center</h1>
          <span className="cmd-date section-label">{today}</span>
        </div>
        <div className="cmd-header-right">
          {online && !emergencyActive && (
            <span className="cmd-live-badge">
              <PulseDot status="ok" size={7} />
              Live
            </span>
          )}
          <PressButton className="cmd-header-btn" onClick={() => onNavigate?.("recommend")}>
            Approvals
          </PressButton>
          <PressButton className="cmd-header-btn" onClick={() => onNavigate?.("reliability")}>
            Health
          </PressButton>
        </div>
      </motion.div>

      {/* ── Quick Actions strip ───────────────────────────────────── */}
      <motion.div
        className="cmd-quick-actions"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...transition.enter, delay: 0.09 }}
      >
        {[
          { icon: "✦", label: "New Mission",  tab: "mission"          },
          // A.5 finding (see CustomerDashboard.jsx for full writeup):
          // "AI Chat" must route to "chat" (Chat.jsx's real message
          // input), not "jarvisbrain" (a read-only monitoring dashboard
          // with zero <input>/<textarea> anywhere on the page).
          { icon: "◎", label: "AI Chat",      tab: "chat"             },
          { icon: "⌥", label: "Analytics",    tab: "analyticscenter"  },
          { icon: "⬡", label: "Automation",   tab: "workflowautomation" },
          { icon: "◈", label: "CRM",          tab: "business"         },
          { icon: "₹", label: "Payments",     tab: "payments"         },
        ].map(({ icon, label, tab }) => (
          <button
            key={tab}
            className="cmd-qa-btn"
            onClick={() => onNavigate?.(tab)}
          >
            <span className="cmd-qa-icon">{icon}</span>
            <span className="cmd-qa-label">{label}</span>
          </button>
        ))}
      </motion.div>

      {/* ── Founder KPI strip: Revenue / Connector Health / Deployment ── */}
      <motion.div
        className="cmd-founder-strip"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...transition.enter, delay: 0.11 }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '0 16px 12px' }}
      >
        <section className="cmd-panel">
          <div className="cmd-panel-header">
            <span className="section-label">Revenue</span>
          </div>
          <div style={{ padding: '10px 12px' }}>
            <RevenuePulse onNavigate={onNavigate} />
          </div>
        </section>

        <section className="cmd-panel">
          <div className="cmd-panel-header">
            <span className="section-label">Connector Health</span>
          </div>
          <div style={{ padding: '10px 12px' }}>
            <ConnectorHealthPulse onNavigate={onNavigate} />
          </div>
        </section>

        <section className="cmd-panel">
          <div className="cmd-panel-header">
            <span className="section-label">Deployment Status</span>
          </div>
          <div style={{ padding: '10px 12px' }}>
            <DeploymentPulse onNavigate={onNavigate} />
          </div>
        </section>

        <section className="cmd-panel">
          <div className="cmd-panel-header">
            <span className="section-label">Digital Twin</span>
          </div>
          <div style={{ padding: '10px 12px' }}>
            <FounderTwinPulse onNavigate={onNavigate} />
          </div>
        </section>
      </motion.div>

      {/* ── 3-column cockpit layout ───────────────────────────────── */}
      <div className="cmd-layout">

        {/* ── Column 1: Mission Feed (35%) ──── */}
        <motion.section
          className="cmd-panel cmd-col-feed"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition.enter, delay: 0.10 }}
        >
          <div className="cmd-panel-header">
            <span className="section-label">Mission Feed</span>
            <span className="cmd-panel-live">
              <PulseDot status="ok" size={6} />
              <span className="mono-sm" style={{ color: "var(--success)", fontWeight: 700, letterSpacing: "0.06em" }}>LIVE</span>
            </span>
            <button className="cmd-panel-link" onClick={() => onNavigate?.("execution")}>
              Full log →
            </button>
          </div>
          <MissionFeed opsData={opsData} online={online} />
        </motion.section>

        {/* ── Column 2: Agents (30%) ──── */}
        <motion.section
          className="cmd-panel cmd-col-agents"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition.enter, delay: 0.14 }}
        >
          <div className="cmd-panel-header">
            <span className="section-label">Active Agents</span>
            <button className="cmd-panel-link" onClick={() => onNavigate?.("agents")}>
              All agents →
            </button>
          </div>
          <ActiveAgents opsData={opsData} />
        </motion.section>

        {/* ── Column 3: Approvals + System Health (35%) ──── */}
        <div className="cmd-col-side">
          <motion.div
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...transition.enter, delay: 0.16 }}
          >
            <ApprovalQueue onNavigate={onNavigate} />
          </motion.div>

          <motion.section
            className="cmd-panel"
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...transition.enter, delay: 0.22 }}
          >
            <div className="cmd-panel-header">
              <span className="section-label">System Health</span>
              <button className="cmd-panel-link" onClick={() => onNavigate?.("reliability")}>
                Details →
              </button>
            </div>
            <SystemHealth opsData={opsData} online={online} />
          </motion.section>

          <motion.section
            className="cmd-panel"
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...transition.enter, delay: 0.28 }}
          >
            <Suspense fallback={null}>
              <RepoInsights />
            </Suspense>
          </motion.section>

          <motion.section
            className="cmd-panel"
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...transition.enter, delay: 0.34 }}
          >
            <Suspense fallback={null}>
              <WorkspacePersonalization onNavigate={onNavigate} />
            </Suspense>
          </motion.section>
        </div>

        {/* ── Row 2, Col 1+2: Engineering Timeline ──── */}
        <motion.section
          className="cmd-panel cmd-col-timeline"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition.enter, delay: 0.26 }}
        >
          <EngineeringTimeline opsData={opsData} />
        </motion.section>

        {/* ── Mission Templates ──── */}
        {/* B19.5: this carried cmd-col-dispatch, the same grid area as the
            Command Dispatch panel below, so the two stacked on top of each
            other. Moved to its own area. */}
        <motion.section
          className="cmd-panel cmd-col-templates"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition.enter, delay: 0.28 }}
        >
          <Suspense fallback={null}>
            <MissionTemplates onNavigate={onNavigate} />
          </Suspense>
        </motion.section>

        {/* ── Row 2, Col 1+2: Command Dispatch ──── */}
        <motion.section
          className="cmd-panel cmd-col-dispatch"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition.enter, delay: 0.30 }}
        >
          <div className="cmd-panel-header">
            <span className="section-label">Dispatch</span>
          </div>
          <CommandDispatch online={online} />
        </motion.section>

        {/* ── J6 Row 3: Live Operations — 4-col strip ──── */}
        <motion.section
          className="cmd-panel cmd-col-timeline"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition.enter, delay: 0.34 }}
          style={{ gridColumn: '1 / -1' }}
        >
          <div className="cmd-panel-header">
            <span className="section-label">Mission Timeline</span>
            <span className="cmd-panel-live">
              <PulseDot status="ok" size={6} />
              <span className="mono-sm" style={{ color: "var(--success)", fontWeight: 700, letterSpacing: "0.06em" }}>LIVE</span>
            </span>
          </div>
          <MissionTimelineStrip />
        </motion.section>

        <motion.section
          className="cmd-panel"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition.enter, delay: 0.36 }}
          style={{ gridColumn: '1 / -1' }}
        >
          <div className="cmd-panel-header" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span className="section-label">Live Activity Stream</span>
            <span className="cmd-panel-live">
              <PulseDot status="ok" size={6} />
              <span className="mono-sm" style={{ color: "var(--success)", fontWeight: 700, letterSpacing: "0.06em" }}>SSE</span>
            </span>
          </div>
          <div style={{ height: 140, overflow: 'hidden' }}>
            <LiveActivityStream />
          </div>
        </motion.section>

        <motion.section
          className="cmd-panel"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...transition.enter, delay: 0.38 }}
        >
          <div className="cmd-panel-header">
            <span className="section-label">Queue Status</span>
          </div>
          <QueueOverview opsData={opsData} />
        </motion.section>

        <motion.section
          className="cmd-panel"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...transition.enter, delay: 0.41 }}
        >
          <Suspense fallback={null}>
            <RecentSessions onNavigate={onNavigate} />
          </Suspense>
        </motion.section>

        <motion.section
          className="cmd-panel"
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...transition.enter, delay: 0.40 }}
        >
          <div className="cmd-panel-header">
            <span className="section-label">Runtime Alerts</span>
          </div>
          <RuntimeAlerts opsData={opsData} />
        </motion.section>

        <motion.section
          className="cmd-panel"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition.enter, delay: 0.42 }}
        >
          <div className="cmd-panel-header">
            <span className="section-label">AI Providers</span>
          </div>
          <ProviderHealth />
        </motion.section>

      </div>
    </motion.div>
  );
}
