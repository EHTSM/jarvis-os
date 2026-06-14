import React, {
  useState, useEffect, useCallback, useRef, useMemo, memo,
} from "react";
import {
  getGraphList, getGraphDetail, getGraphStats,
  createGraph, executeGraph, deleteGraph,
  getRuntimeHistory,
} from "./operatorApi";
import { useIntervalCleanup } from "../../hooks/useResourceManager";
import "./MissionEngine.css";

const TICK_MS = 6_000;

// ── Helpers ────────────────────────────────────────────────────────────
function elapsed(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function pct(done, total) {
  if (!total) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

const StatusDot = memo(({ s }) => (
  <span className={`me-dot me-dot--${
    s === "completed" || s === "success" ? "ok" :
    s === "running"   || s === "active"  ? "run" :
    s === "failed"    || s === "error"   ? "err" : "dim"
  }`} />
));

// ── Node graph minimap ─────────────────────────────────────────────────
const NodeMap = memo(({ nodes = [] }) => {
  if (nodes.length === 0) return null;
  return (
    <div className="me-nodemap">
      {nodes.map((n, i) => {
        const ok  = n.status === "completed" || n.status === "success";
        const err = n.status === "failed"    || n.status === "error";
        const run = n.status === "running";
        return (
          <div
            key={i}
            className={`me-node${ok ? " me-node--ok" : err ? " me-node--err" : run ? " me-node--run" : ""}`}
            title={`${n.task || n.name || n.id || "node"}\n${n.status || "pending"}`}
          >
            <span className="me-node-label">{(n.task || n.name || n.id || "").slice(0, 12)}</span>
          </div>
        );
      })}
    </div>
  );
});

// ── Mission card ───────────────────────────────────────────────────────
const MissionCard = memo(({ g, selected, onClick, onExecute, onDelete }) => {
  const done  = g.completedNodes || g.completedTasks || 0;
  const total = g.totalNodes     || g.totalTasks     || g.nodes?.length || 0;
  const p     = pct(done, total);
  const isRun = g.status === "running" || g.status === "pending";
  const isDone= g.status === "completed";
  const isFail= g.status === "failed" || g.status === "error";

  return (
    <div
      className={`me-card${selected ? " me-card--selected" : ""}${isRun ? " me-card--running" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === "Enter" && onClick()}
    >
      <div className="me-card-head">
        <StatusDot s={g.status} />
        <span className="me-card-mission">{(g.mission || g.name || g.id || "Mission").slice(0, 50)}</span>
        <span className={`me-card-status me-card-status--${isDone ? "ok" : isFail ? "err" : isRun ? "run" : "dim"}`}>
          {g.status || "pending"}
        </span>
      </div>

      {total > 0 && (
        <div className="me-card-progress">
          <div className="me-progress-bar">
            <div className="me-progress-fill" style={{ width: `${p}%` }} />
          </div>
          <span className="me-progress-pct">{done}/{total} tasks · {p}%</span>
        </div>
      )}

      <div className="me-card-meta">
        {g.createdAt && <span className="me-meta">{elapsed(g.createdAt)} ago</span>}
        {g.estimatedDuration && <span className="me-meta">~{g.estimatedDuration}</span>}
      </div>

      <div className="me-card-actions">
        {!isDone && !isRun && (
          <button
            className="me-btn me-btn--execute"
            onClick={e => { e.stopPropagation(); onExecute(g.id); }}
          >
            ▶ Execute
          </button>
        )}
        {isRun && <span className="me-running-badge">● Running</span>}
        {isDone && <span className="me-done-badge">✓ Done</span>}
        <button
          className="me-btn me-btn--ghost me-btn--sm"
          onClick={e => { e.stopPropagation(); onDelete(g.id); }}
          title="Delete mission"
        >✕</button>
      </div>
    </div>
  );
});

// ── Node detail list ───────────────────────────────────────────────────
const NodeList = memo(({ nodes }) => {
  if (!nodes?.length) return <div className="me-empty">No task nodes.</div>;
  return (
    <div className="me-node-list">
      {nodes.map((n, i) => {
        const ok  = n.status === "completed" || n.status === "success";
        const err = n.status === "failed"    || n.status === "error";
        const run = n.status === "running";
        return (
          <div key={i} className={`me-node-row${run ? " me-node-row--run" : ""}`}>
            <StatusDot s={n.status} />
            <span className="me-node-task">{(n.task || n.name || n.id || "task").slice(0, 80)}</span>
            <span className={`me-node-st me-node-st--${ok ? "ok" : err ? "err" : run ? "run" : "dim"}`}>
              {n.status || "pending"}
            </span>
            {n.agentId && <span className="me-node-agent">{n.agentId.slice(0, 20)}</span>}
            {n.completedAt && <span className="me-node-time">{elapsed(n.completedAt)}</span>}
            {n.error && (
              <span className="me-node-err" title={n.error}>{n.error.slice(0, 60)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════
// Main MissionEngine
// ══════════════════════════════════════════════════════════════════════
export default function MissionEngine() {
  const [graphs,   setGraphs]   = useState([]);
  const [stats,    setStats]    = useState(null);
  const [history,  setHistory]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState(null);
  const [detail,   setDetail]   = useState(null);

  const [input,    setInput]    = useState("");
  const [creating, setCreating] = useState(false);
  const [execMsg,  setExecMsg]  = useState(null);

  const textRef = useRef(null);

  // ── Fetch ─────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    const [gr, st, hi] = await Promise.allSettled([
      getGraphList(),
      getGraphStats(),
      getRuntimeHistory(8),
    ]);
    if (gr.status === "fulfilled") setGraphs(gr.value?.graphs || gr.value || []);
    if (st.status === "fulfilled") setStats(st.value);
    if (hi.status === "fulfilled") setHistory(hi.value?.history || hi.value || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useIntervalCleanup(fetchAll, TICK_MS);

  // ── Fetch detail for selected graph ──────────────────────────────
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    getGraphDetail(selected.id).then(d => setDetail(d?.graph || d)).catch(() => {});
    const id = setInterval(() => {
      getGraphDetail(selected.id).then(d => setDetail(d?.graph || d)).catch(() => {});
    }, TICK_MS);
    return () => clearInterval(id);
  }, [selected]);

  // ── Derived ───────────────────────────────────────────────────────
  const active    = useMemo(() => graphs.filter(g => g.status === "running" || g.status === "pending"), [graphs]);
  const completed = useMemo(() => graphs.filter(g => g.status === "completed"), [graphs]);
  const failed    = useMemo(() => graphs.filter(g => g.status === "failed" || g.status === "error"), [graphs]);

  // ── Create mission ────────────────────────────────────────────────
  async function handleCreate(e) {
    e.preventDefault();
    const mission = input.trim();
    if (!mission) return;
    setCreating(true);
    setExecMsg(null);
    try {
      const g = await createGraph({ mission, auto_execute: true });
      const newGraph = g?.graph || g;
      setInput("");
      setExecMsg({ ok: true, text: `Mission created: "${mission.slice(0, 60)}"` });
      if (newGraph?.id) {
        // auto-execute
        try {
          await executeGraph(newGraph.id);
          setExecMsg({ ok: true, text: `Mission launched: "${mission.slice(0, 60)}"` });
        } catch {}
      }
      fetchAll();
    } catch (err) {
      setExecMsg({ ok: false, text: "Failed to create mission: " + err.message });
    } finally {
      setCreating(false);
    }
  }

  async function handleExecute(id) {
    try {
      await executeGraph(id);
      setExecMsg({ ok: true, text: "Mission execution triggered." });
      fetchAll();
    } catch (err) {
      setExecMsg({ ok: false, text: "Execute failed: " + err.message });
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this mission?")) return;
    try {
      await deleteGraph(id);
      if (selected?.id === id) setSelected(null);
      fetchAll();
    } catch (err) {
      setExecMsg({ ok: false, text: "Delete failed: " + err.message });
    }
  }

  const detailNodes = detail?.nodes || detail?.tasks || selected?.nodes || [];

  return (
    <div className="me-root">
      {/* Header */}
      <header className="me-header">
        <div>
          <div className="me-title">Autonomous Mission Engine</div>
          <div className="me-subtitle">
            {stats ? `${stats.total || graphs.length} missions · ${active.length} active · ${completed.length} done` : `${graphs.length} missions`}
          </div>
        </div>
        <button className="me-refresh" onClick={fetchAll} title="Refresh">↻</button>
      </header>

      {/* Mission input */}
      <form className="me-input-wrap" onSubmit={handleCreate}>
        <textarea
          ref={textRef}
          className="me-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCreate(e); }}
          placeholder="Describe a mission… (e.g. 'Build authentication system with JWT and refresh tokens') — ⌘↵ to launch"
          rows={2}
          disabled={creating}
        />
        <button
          type="submit"
          className={`me-launch-btn${creating ? " me-launch-btn--loading" : ""}`}
          disabled={creating || !input.trim()}
        >
          {creating ? "Planning…" : "▶ Launch Mission"}
        </button>
      </form>

      {execMsg && (
        <div className={`me-banner me-banner--${execMsg.ok ? "ok" : "err"}`}>
          {execMsg.text}
          <button className="me-banner-close" onClick={() => setExecMsg(null)}>✕</button>
        </div>
      )}

      {/* Stats strip */}
      {stats && (
        <div className="me-stats">
          <span className="me-stat"><strong>{stats.total || graphs.length}</strong> total</span>
          <span className="me-stat me-stat--run"><strong>{active.length}</strong> active</span>
          <span className="me-stat me-stat--ok"><strong>{completed.length}</strong> done</span>
          {failed.length > 0 && <span className="me-stat me-stat--err"><strong>{failed.length}</strong> failed</span>}
          {stats.total_nodes && <span className="me-stat"><strong>{stats.total_nodes}</strong> tasks planned</span>}
          {stats.completed_nodes != null && <span className="me-stat me-stat--ok"><strong>{stats.completed_nodes}</strong> tasks done</span>}
        </div>
      )}

      {/* Body: list + detail */}
      <div className={`me-body${selected ? " me-body--split" : ""}`}>

        {/* Mission list */}
        <div className="me-list-col">
          {loading && <div className="me-empty">Loading missions…</div>}

          {!loading && graphs.length === 0 && (
            <div className="me-onboarding">
              <div className="me-onboarding-icon">◎</div>
              <div className="me-onboarding-text">No missions yet. Enter a mission above to get started.</div>
            </div>
          )}

          {active.length > 0 && (
            <div className="me-section">
              <div className="me-section-label">Active ({active.length})</div>
              {active.map(g => (
                <MissionCard
                  key={g.id}
                  g={g}
                  selected={selected?.id === g.id}
                  onClick={() => setSelected(prev => prev?.id === g.id ? null : g)}
                  onExecute={handleExecute}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          {failed.length > 0 && (
            <div className="me-section">
              <div className="me-section-label">Failed ({failed.length})</div>
              {failed.map(g => (
                <MissionCard
                  key={g.id}
                  g={g}
                  selected={selected?.id === g.id}
                  onClick={() => setSelected(prev => prev?.id === g.id ? null : g)}
                  onExecute={handleExecute}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          {completed.length > 0 && (
            <div className="me-section">
              <div className="me-section-label">Completed ({completed.length})</div>
              {completed.slice(0, 10).map(g => (
                <MissionCard
                  key={g.id}
                  g={g}
                  selected={selected?.id === g.id}
                  onClick={() => setSelected(prev => prev?.id === g.id ? null : g)}
                  onExecute={handleExecute}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="me-detail-col">
            <div className="me-detail">
              <div className="me-detail-head">
                <StatusDot s={selected.status} />
                <span className="me-detail-title">{(selected.mission || selected.name || selected.id || "Mission").slice(0, 60)}</span>
                <button className="me-close" onClick={() => setSelected(null)}>✕</button>
              </div>

              <div className="me-detail-meta">
                <span className="me-meta">ID: {selected.id}</span>
                {selected.createdAt && <span className="me-meta">Created {elapsed(selected.createdAt)} ago</span>}
                {selected.completedAt && <span className="me-meta">Completed {elapsed(selected.completedAt)} ago</span>}
              </div>

              {/* Minimap */}
              <NodeMap nodes={detailNodes} />

              {/* Progress */}
              {detailNodes.length > 0 && (() => {
                const done  = detailNodes.filter(n => n.status === "completed" || n.status === "success").length;
                const total = detailNodes.length;
                const p2    = pct(done, total);
                return (
                  <div className="me-detail-progress">
                    <div className="me-progress-bar me-progress-bar--lg">
                      <div className="me-progress-fill" style={{ width: `${p2}%` }} />
                    </div>
                    <span className="me-progress-pct">{done} / {total} tasks complete · {p2}%</span>
                  </div>
                );
              })()}

              {/* Node list */}
              <div className="me-detail-section">
                <div className="me-detail-section-label">Task Breakdown</div>
                <NodeList nodes={detailNodes} />
              </div>

              {/* Error */}
              {(selected.error || detail?.error) && (
                <div className="me-detail-section">
                  <div className="me-detail-section-label">Error</div>
                  <div className="me-error-box">{selected.error || detail?.error}</div>
                </div>
              )}

              {/* Re-execute */}
              {selected.status !== "running" && selected.status !== "completed" && (
                <button
                  className="me-btn me-btn--execute me-btn--full"
                  onClick={() => handleExecute(selected.id)}
                >
                  ▶ Execute This Mission
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
