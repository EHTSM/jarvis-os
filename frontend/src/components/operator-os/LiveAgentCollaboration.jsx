import React, {
  useState, useEffect, useCallback, useMemo, memo,
} from "react";
import {
  getAgents, getAgentDetail, getAgentHistory, getAgentFailures,
  getP20Agents, getCoordStatus, getTaskChains,
} from "./operatorApi";
import { useIntervalCleanup } from "../../hooks/useResourceManager";
import "./LiveAgentCollaboration.css";

const TICK_MS   = 5_000;
const TICK_FAST = 2_000;

// ── Helpers ────────────────────────────────────────────────────────────
const Dot = memo(({ s }) => (
  <span className={`lac-dot lac-dot--${
    s === "running" || s === "active" ? "ok" :
    s === "pending" || s === "waiting" ? "pulse" :
    s === "error"   || s === "failed"  ? "err" : "dim"
  }`} />
));

const Bar = memo(({ pct }) => (
  <div className="lac-bar">
    <div className="lac-bar-fill" style={{ width: `${Math.min(100, pct || 0)}%` }} />
  </div>
));

const Tag = memo(({ label, color = "green" }) => (
  <span className={`lac-tag lac-tag--${color}`}>{label}</span>
));

function elapsed(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function dur(start, end) {
  if (!start) return "";
  const ms = (end ? new Date(end) : new Date()) - new Date(start);
  if (ms < 1000)   return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

// ── Pipeline stage list ────────────────────────────────────────────────
const PIPELINE_STAGES = [
  { id: "planner",   label: "Planner",    icon: "◎" },
  { id: "developer", label: "Developer",  icon: "⬡" },
  { id: "reviewer",  label: "Reviewer",   icon: "◈" },
  { id: "tester",    label: "Tester",     icon: "◉" },
  { id: "security",  label: "Security",   icon: "⬟" },
  { id: "devops",    label: "DevOps",     icon: "▣" },
  { id: "operator",  label: "Operator",   icon: "✦" },
];

function matchStage(agent) {
  const name = (agent.name || agent.type || agent.kind || "").toLowerCase();
  return PIPELINE_STAGES.find(s => name.includes(s.id)) || null;
}

// ── Agent detail panel ─────────────────────────────────────────────────
const AgentDetail = memo(({ agent, history, onClose }) => {
  if (!agent) return null;
  const stage = matchStage(agent);
  const pct   = agent.progress ?? agent.completionPercent ?? null;
  const conf  = agent.confidence ?? agent.confidenceScore ?? null;

  return (
    <div className="lac-detail">
      <div className="lac-detail-head">
        <div className="lac-detail-title">
          {stage && <span className="lac-detail-stage-icon">{stage.icon}</span>}
          <span>{agent.name || agent.agentId || agent.id || "Agent"}</span>
          <Dot s={agent.status} />
          <span className={`lac-detail-status lac-detail-status--${
            agent.status === "running" ? "ok" : agent.status === "error" ? "err" : "dim"
          }`}>{agent.status || "idle"}</span>
        </div>
        <button className="lac-close" onClick={onClose}>✕</button>
      </div>

      <div className="lac-detail-meta">
        {agent.type && <Tag label={agent.type} />}
        {agent.kind && <Tag label={agent.kind} color="blue" />}
        {stage      && <Tag label={stage.label} color="purple" />}
        {agent.lastActive && (
          <span className="lac-meta-time">last active {elapsed(agent.lastActive)}</span>
        )}
      </div>

      {/* Current task */}
      {(agent.currentTask || agent.task || agent.input) && (
        <div className="lac-detail-section">
          <div className="lac-detail-section-label">Current Task</div>
          <div className="lac-detail-task">
            {(agent.currentTask || agent.task || agent.input).slice(0, 200)}
          </div>
        </div>
      )}

      {/* Current thought */}
      {(agent.currentThought || agent.thought || agent.reasoning) && (
        <div className="lac-detail-section">
          <div className="lac-detail-section-label">Current Thought</div>
          <div className="lac-detail-thought">
            {(agent.currentThought || agent.thought || agent.reasoning).slice(0, 300)}
          </div>
        </div>
      )}

      {/* Progress + confidence */}
      {(pct != null || conf != null) && (
        <div className="lac-detail-section lac-detail-metrics">
          {pct != null && (
            <div className="lac-metric">
              <span className="lac-metric-label">Progress</span>
              <Bar pct={pct} />
              <span className="lac-metric-val">{Math.round(pct)}%</span>
            </div>
          )}
          {conf != null && (
            <div className="lac-metric">
              <span className="lac-metric-label">Confidence</span>
              <Bar pct={conf * 100} />
              <span className="lac-metric-val">{Math.round(conf * 100)}%</span>
            </div>
          )}
        </div>
      )}

      {/* Dependencies */}
      {agent.dependencies?.length > 0 && (
        <div className="lac-detail-section">
          <div className="lac-detail-section-label">Dependencies</div>
          <div className="lac-dep-list">
            {agent.dependencies.map((d, i) => (
              <span key={i} className="lac-dep">{d}</span>
            ))}
          </div>
        </div>
      )}

      {/* Waiting on */}
      {(agent.waitingOn || agent.blockedBy) && (
        <div className="lac-detail-section">
          <div className="lac-detail-section-label">Waiting On</div>
          <div className="lac-detail-waiting">{agent.waitingOn || agent.blockedBy}</div>
        </div>
      )}

      {/* Artifacts */}
      {agent.artifacts?.length > 0 && (
        <div className="lac-detail-section">
          <div className="lac-detail-section-label">Produced Artifacts</div>
          <div className="lac-artifact-list">
            {agent.artifacts.slice(0, 5).map((a, i) => (
              <div key={i} className="lac-artifact">
                <span className="lac-artifact-icon">◷</span>
                <span className="lac-artifact-name">{(a.name || a.path || a.type || String(a)).slice(0, 60)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execution timeline (history runs) */}
      {history.length > 0 && (
        <div className="lac-detail-section">
          <div className="lac-detail-section-label">Execution Timeline</div>
          <div className="lac-timeline">
            {history.slice(0, 8).map((run, i) => {
              const ok  = run.status === "completed" || run.status === "success";
              const err = run.status === "failed"    || run.status === "error";
              return (
                <div key={i} className="lac-run">
                  <span className={`lac-run-dot lac-run-dot--${ok ? "ok" : err ? "err" : "dim"}`} />
                  <span className="lac-run-time">{elapsed(run.startedAt || run.createdAt)}</span>
                  <span className="lac-run-dur">{dur(run.startedAt, run.completedAt)}</span>
                  <span className={`lac-run-status lac-run-status--${ok ? "ok" : err ? "err" : "dim"}`}>
                    {run.status}
                  </span>
                  {run.error && (
                    <span className="lac-run-err" title={run.error}>{run.error.slice(0, 60)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

// ── Pipeline view ──────────────────────────────────────────────────────
const PipelineView = memo(({ agents }) => {
  const byStage = useMemo(() => {
    const map = {};
    for (const s of PIPELINE_STAGES) map[s.id] = [];
    for (const a of agents) {
      const stage = matchStage(a);
      if (stage) map[stage.id].push(a);
      else       (map["operator"] = map["operator"] || []).push(a);
    }
    return map;
  }, [agents]);

  return (
    <div className="lac-pipeline">
      {PIPELINE_STAGES.map((s, i) => {
        const stageAgents = byStage[s.id] || [];
        const hasActive   = stageAgents.some(a => a.status === "running" || a.status === "active");
        return (
          <React.Fragment key={s.id}>
            <div className={`lac-stage${hasActive ? " lac-stage--active" : ""}`}>
              <div className="lac-stage-head">
                <span className="lac-stage-icon">{s.icon}</span>
                <span className="lac-stage-label">{s.label}</span>
                {stageAgents.length > 0 && (
                  <span className="lac-stage-count">{stageAgents.length}</span>
                )}
              </div>
              {stageAgents.length === 0 ? (
                <div className="lac-stage-empty">idle</div>
              ) : (
                stageAgents.slice(0, 3).map((a, j) => (
                  <div key={j} className="lac-stage-agent">
                    <Dot s={a.status} />
                    <span className="lac-stage-agent-name">
                      {(a.name || a.agentId || a.id || "agent").slice(0, 20)}
                    </span>
                  </div>
                ))
              )}
            </div>
            {i < PIPELINE_STAGES.length - 1 && (
              <div className={`lac-arrow${hasActive ? " lac-arrow--active" : ""}`}>→</div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
});

// ── Agent card ─────────────────────────────────────────────────────────
const AgentCard = memo(({ agent, selected, onClick }) => {
  const running = agent.status === "running" || agent.status === "active";
  const pct     = agent.progress ?? agent.completionPercent ?? null;
  const conf    = agent.confidence ?? agent.confidenceScore ?? null;
  const stage   = matchStage(agent);

  return (
    <div
      className={`lac-card${selected ? " lac-card--selected" : ""}${running ? " lac-card--running" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === "Enter" && onClick()}
    >
      <div className="lac-card-head">
        <div className="lac-card-id">
          <Dot s={agent.status} />
          <span className="lac-card-name">{(agent.name || agent.agentId || agent.id || "agent").slice(0, 26)}</span>
        </div>
        <div className="lac-card-badges">
          {stage && <span className="lac-badge lac-badge--stage">{stage.icon}</span>}
          <span className={`lac-badge lac-badge--${running ? "ok" : agent.status === "error" ? "err" : "dim"}`}>
            {agent.status || "idle"}
          </span>
        </div>
      </div>

      {(agent.currentTask || agent.task || agent.input) && (
        <div className="lac-card-task">
          {(agent.currentTask || agent.task || agent.input).slice(0, 80)}
        </div>
      )}

      {(pct != null || conf != null) && (
        <div className="lac-card-metrics">
          {pct  != null && <Bar pct={pct} />}
          {conf != null && (
            <span className="lac-card-conf">{Math.round(conf * 100)}% conf</span>
          )}
        </div>
      )}

      {agent.lastActive && (
        <div className="lac-card-time">{elapsed(agent.lastActive)}</div>
      )}
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════
// Main LiveAgentCollaboration component
// ══════════════════════════════════════════════════════════════════════
export default function LiveAgentCollaboration() {
  const [agents,   setAgents]   = useState([]);
  const [p20,      setP20]      = useState([]);
  const [failures, setFailures] = useState([]);
  const [chains,   setChains]   = useState([]);
  const [coordSt,  setCoordSt]  = useState(null);
  const [loading,  setLoading]  = useState(true);

  const [selected,  setSelected]  = useState(null);
  const [selDetail, setSelDetail] = useState(null);
  const [selHistory,setSelHistory]= useState([]);
  const [view,      setView]      = useState("cards"); // "cards" | "pipeline" | "failures"
  const [filter,    setFilter]    = useState("all");   // "all" | "running" | "error" | "idle"

  // ── Fetch all ────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    const [ag, p2, fa, ch, co] = await Promise.allSettled([
      getAgents(),
      getP20Agents(),
      getAgentFailures(),
      getTaskChains(),
      getCoordStatus(),
    ]);
    if (ag.status === "fulfilled") setAgents(ag.value?.agents || ag.value || []);
    if (p2.status === "fulfilled") setP20(p2.value?.agents   || p2.value || []);
    if (fa.status === "fulfilled") setFailures(fa.value?.failures || fa.value || []);
    if (ch.status === "fulfilled") setChains(ch.value?.chains || ch.value || []);
    if (co.status === "fulfilled") setCoordSt(co.value);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useIntervalCleanup(fetchAll, TICK_MS);

  // ── Fetch detail for selected agent ──────────────────────────────
  useEffect(() => {
    if (!selected) { setSelDetail(null); setSelHistory([]); return; }
    const id = selected.id || selected.agentId;
    if (!id) return;
    Promise.allSettled([getAgentDetail(id), getAgentHistory(id)]).then(([det, hist]) => {
      if (det.status  === "fulfilled") setSelDetail(det.value?.agent || det.value || selected);
      if (hist.status === "fulfilled") setSelHistory(hist.value?.runs || hist.value || []);
    });
    const id2 = setInterval(() => {
      getAgentDetail(id).then(d => setSelDetail(d?.agent || d || selected)).catch(() => {});
    }, TICK_FAST);
    return () => clearInterval(id2);
  }, [selected]);

  // ── Merged agent list ─────────────────────────────────────────────
  const allAgents = useMemo(() => {
    const map = new Map();
    for (const a of agents) map.set(a.id || a.agentId, a);
    for (const a of p20)    map.set(a.id || a.agentId, { ...map.get(a.id || a.agentId), ...a });
    return Array.from(map.values());
  }, [agents, p20]);

  const filtered = useMemo(() => {
    if (filter === "running") return allAgents.filter(a => a.status === "running" || a.status === "active");
    if (filter === "error")   return allAgents.filter(a => a.status === "error"   || a.status === "failed");
    if (filter === "idle")    return allAgents.filter(a => !["running","active","error","failed"].includes(a.status));
    return allAgents;
  }, [allAgents, filter]);

  const runCount  = useMemo(() => allAgents.filter(a => a.status === "running" || a.status === "active").length, [allAgents]);
  const errCount  = useMemo(() => allAgents.filter(a => a.status === "error"   || a.status === "failed").length, [allAgents]);

  return (
    <div className="lac-root">
      {/* Header */}
      <header className="lac-header">
        <div className="lac-header-left">
          <span className="lac-title">Agent Collaboration</span>
          <span className="lac-subtitle">Live pipeline observation</span>
        </div>
        <div className="lac-header-stats">
          <span className="lac-stat">
            <span className="lac-stat-dot lac-stat-dot--ok" />
            {runCount} running
          </span>
          <span className="lac-stat">
            <span className="lac-stat-dot lac-stat-dot--dim" />
            {allAgents.length} total
          </span>
          {errCount > 0 && (
            <span className="lac-stat lac-stat--err">
              <span className="lac-stat-dot lac-stat-dot--err" />
              {errCount} errors
            </span>
          )}
          {coordSt?.status && (
            <span className="lac-stat">
              coordinator: <strong>{coordSt.status}</strong>
            </span>
          )}
        </div>
        <div className="lac-header-views">
          <button className={`lac-view-btn${view === "cards"    ? " active" : ""}`} onClick={() => setView("cards")}>Cards</button>
          <button className={`lac-view-btn${view === "pipeline" ? " active" : ""}`} onClick={() => setView("pipeline")}>Pipeline</button>
          <button className={`lac-view-btn${view === "failures" ? " active" : ""}`} onClick={() => setView("failures")}>Failures</button>
          <button className="lac-refresh" onClick={fetchAll} title="Refresh">↻</button>
        </div>
      </header>

      {/* Pipeline view (header-only) */}
      {view === "pipeline" && (
        <div className="lac-pipeline-wrap">
          {loading ? <div className="lac-loading">Loading…</div> : <PipelineView agents={allAgents} />}
        </div>
      )}

      {/* Failures view */}
      {view === "failures" && (
        <div className="lac-failures">
          {failures.length === 0 && <div className="lac-empty">No agent failures recorded.</div>}
          {failures.slice(0, 20).map((f, i) => (
            <div key={i} className="lac-failure-row">
              <span className="lac-failure-agent">{(f.agentId || f.agent || f.name || "agent").slice(0, 30)}</span>
              <span className="lac-failure-error">{(f.error || f.message || "—").slice(0, 100)}</span>
              <span className="lac-failure-time">{elapsed(f.failedAt || f.createdAt)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Cards view */}
      {view === "cards" && (
        <div className={`lac-body${selected ? " lac-body--split" : ""}`}>
          {/* Left: agent list */}
          <div className="lac-list-col">
            {/* Filters */}
            <div className="lac-filters">
              {["all","running","error","idle"].map(f => (
                <button
                  key={f}
                  className={`lac-filter-btn${filter === f ? " active" : ""}`}
                  onClick={() => setFilter(f)}
                >
                  {f === "all" ? `All (${allAgents.length})` :
                   f === "running" ? `Running (${runCount})` :
                   f === "error"   ? `Errors (${errCount})`   :
                   "Idle"}
                </button>
              ))}
            </div>

            {loading && <div className="lac-loading">Loading agents…</div>}
            {!loading && filtered.length === 0 && (
              <div className="lac-empty">No agents match filter.</div>
            )}

            <div className="lac-cards">
              {filtered.map((a, i) => (
                <AgentCard
                  key={a.id || a.agentId || i}
                  agent={a}
                  selected={selected?.id === a.id}
                  onClick={() => setSelected(prev => prev?.id === a.id ? null : a)}
                />
              ))}
            </div>

            {/* Task chains */}
            {chains.length > 0 && (
              <div className="lac-chains-section">
                <div className="lac-chains-label">Task Chains ({chains.length})</div>
                {chains.slice(0, 5).map((c, i) => (
                  <div key={i} className="lac-chain">
                    <span className="lac-chain-id">{(c.id || c.chainId || "chain").slice(0, 20)}</span>
                    <span className="lac-chain-len">{c.steps?.length || c.length || 0} steps</span>
                    <span className={`lac-chain-status lac-chain-status--${c.status === "completed" ? "ok" : c.status === "failed" ? "err" : "dim"}`}>
                      {c.status || "pending"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: detail panel */}
          {selected && (
            <div className="lac-detail-col">
              <AgentDetail
                agent={selDetail || selected}
                history={selHistory}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
