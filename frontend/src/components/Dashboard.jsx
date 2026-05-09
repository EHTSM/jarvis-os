import React, { useState, useEffect } from "react";
import { BASE_URL } from "../api";
import "./Dashboard.css";

function StatCard({ label, value, unit, color }) {
  return (
    <div className="stat-card">
      <div className="stat-value" style={{ color }}>{value ?? "—"}<span className="stat-unit">{unit}</span></div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function TaskQueue() {
  const [tasks, setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch(`${BASE_URL}/scheduled?status=pending`)
      .then(r => r.json())
      .then(d => { setTasks(d.tasks || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const cancel = (id) => {
    fetch(`${BASE_URL}/scheduled/${id}`, { method: "DELETE" })
      .then(() => load());
  };

  if (loading) return <p className="log-none">Loading…</p>;
  if (tasks.length === 0) return <p className="log-none">No pending tasks.</p>;

  return (
    <div className="task-list">
      {tasks.slice(0, 10).map(t => (
        <div key={t.id} className="task-row">
          <div className="task-info">
            <span className="task-input">{t.input}</span>
            <span className="task-meta">{t.type} · {new Date(t.scheduledFor).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <button className="task-cancel" onClick={() => cancel(t.id)} title="Cancel task">✕</button>
        </div>
      ))}
      {tasks.length > 10 && <p className="log-none">+{tasks.length - 10} more</p>}
    </div>
  );
}

export default function Dashboard({ stats, score, suggestions }) {
  const uptime = stats?.uptime ? `${Math.floor(stats.uptime / 60)}m ${Math.floor(stats.uptime % 60)}s` : "—";

  return (
    <div className="dashboard">
      <h2 className="dash-title">System Dashboard</h2>

      {/* Stats grid — use live field names from /stats response */}
      <div className="stats-grid">
        <StatCard label="Total Leads"    value={stats?.total          ?? 0}    color="#6c63ff" />
        <StatCard label="Paid"           value={stats?.paid           ?? 0}    color="#00e676" />
        <StatCard label="Hot"            value={stats?.hot            ?? 0}    color="#ffab40" />
        <StatCard label="Revenue"        value={`₹${stats?.revenue   ?? 0}`}  color="#00d4ff" />
        <StatCard label="Conversion"     value={stats?.conversionRate ?? "0%"} color="#ff4081" />
        <StatCard label="Evolution"      value={score}                unit="%" color="#6c63ff" />
        <StatCard label="Uptime"         value={uptime}                        color="#8888aa" />
        <StatCard label="Status"         value={stats ? "Online" : "Connecting"} color={stats ? "#00e676" : "#ff5252"} />
      </div>

      {/* Task queue inline */}
      <div className="dash-section">
        <h3 className="section-title">Pending Tasks</h3>
        <TaskQueue />
      </div>

      {/* Evolution suggestions */}
      {suggestions.length > 0 && (
        <div className="dash-section">
          <h3 className="section-title">Evolution Suggestions</h3>
          <div className="sugg-list">
            {suggestions.slice(0, 6).map((s, i) => (
              <div key={i} className="sugg-item">
                <span className="sugg-icon">⚡</span>
                <span>{s.description || s.type || `Optimization ${i + 1}`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick links — use relative API paths via BASE_URL */}
      <div className="dash-section">
        <h3 className="section-title">Quick Actions</h3>
        <div className="action-grid">
          {[
            { label: "CRM Leads",      href: `${BASE_URL}/crm`              },
            { label: "Memory State",   href: `${BASE_URL}/memory`           },
            { label: "Learning Stats", href: `${BASE_URL}/learning/stats`   },
            { label: "Agent Status",   href: `${BASE_URL}/agents/status`    },
            { label: "Evolution",      href: `${BASE_URL}/evolution/score`  },
            { label: "Health",         href: `${BASE_URL}/health`           }
          ].map(a => (
            <a key={a.href} className="action-link" href={a.href} target="_blank" rel="noreferrer">
              {a.label} ↗
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
