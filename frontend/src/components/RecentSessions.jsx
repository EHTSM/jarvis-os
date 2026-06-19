/**
 * RecentSessions — shows the last N work sessions in CommandCenter.
 * A "session" is a time-bucketed slice of runtime history.
 * Reads from localStorage (existing session tracking) + runtime history.
 */
import React, { useState, useEffect } from "react";
import "./RecentSessions.css";

const BASE = process.env.REACT_APP_API_URL || "";
const SESSIONS_KEY = "ooplix_sessions_log";

function _timeAgo(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return "just now";
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function _recordSession() {
  try {
    const sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
    const now = Date.now();
    const last = sessions[0];
    // Only create new session if >5 min since last
    if (last && now - last.startedAt < 5 * 60 * 1000) {
      last.lastActive = now;
      last.duration = Math.floor((now - last.startedAt) / 1000);
    } else {
      sessions.unshift({ id: `s${now}`, startedAt: now, lastActive: now, duration: 0, tab: "home" });
    }
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 12)));
  } catch {}
}

export { _recordSession };

export default function RecentSessions({ onNavigate }) {
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    _recordSession();
    try {
      const raw = JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
      setSessions(raw.slice(0, 5));
    } catch {}
  }, []);

  if (!sessions.length) return null;

  return (
    <div className="rs-root">
      <div className="rs-header">
        <span className="section-label">Recent Sessions</span>
        <span className="rs-count">{sessions.length} sessions</span>
      </div>
      <div className="rs-list">
        {sessions.map((s, i) => {
          const dur = s.duration > 3600
            ? `${Math.floor(s.duration / 3600)}h ${Math.floor((s.duration % 3600) / 60)}m`
            : s.duration > 60
              ? `${Math.floor(s.duration / 60)}m`
              : "< 1m";
          return (
            <button
              key={s.id}
              className={`rs-item${i === 0 ? " rs-item--current" : ""}`}
              onClick={() => onNavigate?.("home")}
            >
              <span className="rs-dot" />
              <span className="rs-label">
                {i === 0 ? "Current session" : `Session ${new Date(s.startedAt).toLocaleDateString([], { month: "short", day: "numeric" })}`}
              </span>
              <span className="rs-meta">
                <span className="rs-dur">{i === 0 ? "Active" : dur}</span>
                <span className="rs-ago">{_timeAgo(s.startedAt)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
