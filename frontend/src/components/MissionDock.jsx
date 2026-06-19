/**
 * MissionDock — always-visible mission progress strip.
 * Shows current mission, active task, pipeline stage, and ETA.
 * Polls /missions every 8s, lightweight.
 */
import React, { useState, useEffect } from "react";
import "./MissionDock.css";

const BASE = process.env.REACT_APP_API_URL || "";

function _ago(iso) {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function statusClass(s) {
  const st = (s || "").toLowerCase();
  if (st === "running" || st === "active") return "md-dot--run";
  if (st === "done" || st === "completed" || st === "success") return "md-dot--done";
  if (st === "failed" || st === "error") return "md-dot--err";
  if (st === "queued" || st === "pending") return "md-dot--queue";
  return "md-dot--idle";
}

const STAGES = ["plan", "scaffold", "implement", "test", "review", "commit", "deploy"];

export default function MissionDock({ onNavigate }) {
  const [missions, setMissions] = useState([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`${BASE}/missions?status=running&limit=5`, { credentials: "include" });
        const d = await r.json();
        if (!cancelled) setMissions((d.missions || []).slice(0, 5));
      } catch {}
    };
    load();
    const t = setInterval(load, 8000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const active = missions.find(m =>
    ["running", "active"].includes((m.status || "").toLowerCase())
  ) || missions[0];

  if (!active) {
    return (
      <div className="md-dock md-dock--empty">
        <span className="md-empty-label">No active missions</span>
        <button className="md-nav-btn" onClick={() => onNavigate?.("execution")}>
          + New
        </button>
      </div>
    );
  }

  const stage = active.pipelineStage || active.stage || "implement";
  const stageIdx = STAGES.indexOf(stage);

  return (
    <div className={`md-dock${expanded ? " md-dock--expanded" : ""}`}>
      {/* Collapsed bar */}
      <div className="md-bar" onClick={() => setExpanded(e => !e)}>
        <span className={`md-dot ${statusClass(active.status)}`} />
        <span className="md-mission-title">{active.title || active.goal || "Mission"}</span>
        <span className="md-stage-badge">{stage}</span>
        {active.updatedAt && <span className="md-ago">{_ago(active.updatedAt)}</span>}
        <span className="md-chevron">{expanded ? "▾" : "▸"}</span>
      </div>

      {/* Pipeline progress bar */}
      <div className="md-pipeline">
        {STAGES.map((s, i) => (
          <div
            key={s}
            className={`md-stage${i < stageIdx ? " md-stage--done" : i === stageIdx ? " md-stage--active" : ""}`}
            title={s}
          />
        ))}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="md-detail">
          {active.goal && active.goal !== active.title && (
            <p className="md-goal">{active.goal}</p>
          )}

          {/* Queue of missions */}
          {missions.length > 1 && (
            <div className="md-queue">
              <span className="md-queue-label">Queue ({missions.length})</span>
              {missions.slice(1).map(m => (
                <div key={m.id} className="md-queue-item">
                  <span className={`md-dot md-dot--sm ${statusClass(m.status)}`} />
                  <span className="md-queue-title">{m.title || m.goal}</span>
                </div>
              ))}
            </div>
          )}

          <button className="md-nav-btn" onClick={() => { onNavigate?.("execution"); setExpanded(false); }}>
            View all missions →
          </button>
        </div>
      )}
    </div>
  );
}
