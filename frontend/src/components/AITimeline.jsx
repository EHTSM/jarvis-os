/**
 * AITimeline — everything the AI did today.
 * Reads from: /coding/context (patches/bundles), /missions (tasks), /lessons (lessons).
 * Shows a unified timeline of AI activity for the current session/day.
 */
import React, { useState, useEffect } from "react";
import "./AITimeline.css";

const BASE = process.env.REACT_APP_API_URL || "";

const TYPE_META = {
  question:  { icon: "◎", label: "Question",   cls: "ait-dot--ask"     },
  patch:     { icon: "⬡", label: "Patch",       cls: "ait-dot--patch"   },
  mission:   { icon: "✦", label: "Mission",     cls: "ait-dot--mission" },
  lesson:    { icon: "◈", label: "Lesson",      cls: "ait-dot--lesson"  },
  bundle:    { icon: "⌥", label: "Bundle",      cls: "ait-dot--bundle"  },
  repair:    { icon: "⚙", label: "Repair",      cls: "ait-dot--repair"  },
};

function _timeAgo(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function _isToday(ts) {
  if (!ts) return false;
  const d = new Date(ts);
  const now = new Date();
  return d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
}

export default function AITimeline({ cwd }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];

    Promise.all([
      fetch(`${BASE}/missions?limit=30`, { credentials: "include" }).then(r=>r.json()).catch(()=>({})),
      fetch(`${BASE}/lessons?limit=20`, { credentials: "include" }).then(r=>r.json()).catch(()=>({})),
      fetch(`${BASE}/coding/context`, { credentials: "include" }).then(r=>r.json()).catch(()=>({})),
    ]).then(([missionsData, lessonsData, ctxData]) => {
      const events = [];

      // Missions today
      const missions = missionsData.missions || [];
      for (const m of missions) {
        const ts = m.updatedAt || m.createdAt;
        if (!ts) continue;
        events.push({
          id:    `m-${m.id}`,
          type:  "mission",
          label: m.title || m.goal || "Mission",
          ts,
          status: m.status,
          sub: m.status,
        });
      }

      // Lessons
      const lessons = lessonsData.lessons || lessonsData || [];
      for (const l of lessons) {
        const ts = l.createdAt || l.ts;
        events.push({
          id:    `l-${l.id || Math.random()}`,
          type:  "lesson",
          label: l.lesson || l.pattern || String(l),
          ts,
        });
      }

      // Code smells as "repairs"
      const smells = ctxData.smells || [];
      for (const s of smells.slice(0, 5)) {
        events.push({
          id:    `s-${s.file}-${s.line}`,
          type:  "repair",
          label: `${s.type}: ${s.file?.split("/").pop()}:${s.line}`,
          ts:    new Date().toISOString(),
        });
      }

      // Sort by timestamp descending
      events.sort((a, b) => new Date(b.ts) - new Date(a.ts));
      setItems(events);
      setLoading(false);
    });
  }, [cwd]);

  const FILTERS = ["all", "mission", "patch", "lesson", "repair"];
  const visible = filter === "all" ? items : items.filter(i => i.type === filter);

  return (
    <div className="ait-root">
      <div className="ait-header">
        <span className="ait-title">AI Timeline</span>
        <span className="ait-count">{items.length} events today</span>
      </div>

      {/* Filter chips */}
      <div className="ait-filters">
        {FILTERS.map(f => (
          <button
            key={f}
            className={`ait-filter-btn${filter === f ? " ait-filter-btn--active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="ait-list">
        {loading && (
          <div className="ait-loading">
            {[1,2,3].map(i => <div key={i} className="skeleton ait-skel" />)}
          </div>
        )}

        {!loading && visible.length === 0 && (
          <div className="ait-empty">
            <span className="ait-empty-icon">◌</span>
            <p>No {filter === "all" ? "" : filter + " "}activity recorded yet.</p>
          </div>
        )}

        {visible.map(item => {
          const meta = TYPE_META[item.type] || TYPE_META.question;
          return (
            <div key={item.id} className="ait-item">
              <div className={`ait-dot ${meta.cls}`}>{meta.icon}</div>
              <div className="ait-item-body">
                <span className="ait-item-label">{item.label}</span>
                {item.sub && <span className="ait-item-sub">{item.sub}</span>}
              </div>
              <span className="ait-ago">{_timeAgo(item.ts)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
