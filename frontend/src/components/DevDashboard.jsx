/**
 * DevDashboard — today's coding stats.
 * Files changed, tests run, commits, AI usage, estimated time saved.
 * Sources: /missions, /lessons, /coding/context, /metrics (today), git log.
 */
import React, { useState, useEffect, useCallback } from "react";
import "./DevDashboard.css";

const BASE = process.env.REACT_APP_API_URL || "";
const get  = (path) => fetch(`${BASE}${path}`, { credentials: "include" }).then(r => r.json()).catch(() => null);

function Stat({ label, value, sub, color }) {
  return (
    <div className="dd-stat">
      <div className="dd-stat__value" style={color ? { color } : {}}>{value ?? "—"}</div>
      <div className="dd-stat__label">{label}</div>
      {sub && <div className="dd-stat__sub">{sub}</div>}
    </div>
  );
}

function ActivityBar({ hours }) {
  const max = Math.max(...hours, 1);
  return (
    <div className="dd-activity">
      {hours.map((h, i) => (
        <div
          key={i}
          className="dd-activity__bar"
          style={{ height: `${Math.round((h / max) * 100)}%`, opacity: h > 0 ? 1 : 0.15 }}
          title={`${i}:00 — ${h} actions`}
        />
      ))}
    </div>
  );
}

const TODAY = new Date().toDateString();
const STORAGE_KEY = "ooplix_dd_v1";

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveLocal(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, date: TODAY })); } catch {}
}

export default function DevDashboard({ cwd }) {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    const local = loadLocal();

    const [missions, lessons, coding, metricsData] = await Promise.all([
      get("/missions?limit=50"),
      get("/lessons?limit=30"),
      get("/coding/context"),
      get("/metrics/summary?period=today"),
    ]);

    // Git: commits today
    let commitsToday = 0;
    let filesChanged = 0;
    if (window.electronAPI?.shellExec && cwd) {
      const since = new Date().toISOString().split("T")[0];
      const r1 = await window.electronAPI.shellExec({ command: `git log --oneline --after="${since}" 2>/dev/null | wc -l`, cwd }).catch(() => null);
      commitsToday = parseInt(r1?.stdout?.trim() || "0", 10);
      const r2 = await window.electronAPI.shellExec({ command: `git diff --name-only HEAD 2>/dev/null | wc -l`, cwd }).catch(() => null);
      filesChanged = parseInt(r2?.stdout?.trim() || "0", 10);
    }

    // Count today's missions
    const todayMissions = (missions?.missions || []).filter(m => {
      const d = m.updatedAt || m.createdAt;
      return d && new Date(d).toDateString() === TODAY;
    });

    // Count today's lessons
    const todayLessons = (lessons?.lessons || lessons || []).filter(l => {
      const d = l.createdAt || l.ts;
      return d && new Date(d).toDateString() === TODAY;
    });

    // AI questions (estimated from AIPairProgramming usage — track via localStorage)
    const aiQuestions = local.aiQuestions || 0;
    const patchesApplied = local.patchesApplied || 0;

    // Time saved: 5 min per AI question + 15 min per patch + 10 min per lesson
    const timeSaved = aiQuestions * 5 + patchesApplied * 15 + todayLessons.length * 10;

    // Hourly activity — from local tracking or stub zeros
    const hours = local.hours || Array(24).fill(0);
    const currentHour = new Date().getHours();
    hours[currentHour] = (hours[currentHour] || 0) + 1;
    saveLocal({ aiQuestions, patchesApplied, hours });

    setStats({
      commitsToday,
      filesChanged,
      missionsToday: todayMissions.length,
      lessonsLearned: todayLessons.length,
      aiQuestions,
      patchesApplied,
      timeSaved,
      hours,
      activeMission: coding?.activeMission?.title || null,
      smells: coding?.smells?.length || 0,
    });
    setLoading(false);
  }, [cwd]);

  useEffect(() => { fetch_(); }, [fetch_]);

  if (loading) return <div className="dd-loading">Loading stats…</div>;
  if (!stats) return null;

  return (
    <div className="dd-root">
      <div className="dd-header">
        <span className="dd-title">Developer Dashboard</span>
        <span className="dd-date">{new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
      </div>

      {stats.activeMission && (
        <div className="dd-banner">
          <span className="dd-banner__icon">◎</span>
          <span className="dd-banner__text">{stats.activeMission}</span>
        </div>
      )}

      {/* Key stats */}
      <div className="dd-stats-grid">
        <Stat label="Commits today"  value={stats.commitsToday}   color={stats.commitsToday > 0 ? "var(--success)" : undefined} />
        <Stat label="Files changed"  value={stats.filesChanged}   />
        <Stat label="Missions"       value={stats.missionsToday}  color="var(--accent)" />
        <Stat label="Lessons learned" value={stats.lessonsLearned} color="var(--warning)" />
        <Stat label="AI questions"   value={stats.aiQuestions}   color="var(--accent2)" />
        <Stat label="Time saved"     value={`${stats.timeSaved}m`} sub="estimated" color="var(--success)" />
      </div>

      {/* Hourly activity */}
      <div className="dd-section">
        <div className="dd-section-label">Activity today (hourly)</div>
        <ActivityBar hours={stats.hours} />
        <div className="dd-hours-labels">
          {[0, 6, 12, 18, 23].map(h => (
            <span key={h} className="dd-hours-label">{h}:00</span>
          ))}
        </div>
      </div>

      {/* Code health */}
      <div className="dd-section">
        <div className="dd-section-label">Code health</div>
        <div className="dd-health-row">
          <span className="dd-health-label">Code smells detected</span>
          <span className={`dd-health-value${stats.smells > 3 ? " dd-health-value--warn" : ""}`}>{stats.smells}</span>
        </div>
        <div className="dd-health-row">
          <span className="dd-health-label">Patches applied</span>
          <span className="dd-health-value">{stats.patchesApplied}</span>
        </div>
      </div>
    </div>
  );
}
