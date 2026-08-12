"use strict";
// V6 Phase 8 (Personal JARVIS): Daily Planning console — dailyPlanningEngine.cjs
// composes real tasks with live mission load and Founder Digital Twin
// decision context into a single daily agenda.
import React, { useState, useEffect, useCallback } from "react";
import * as planningApi from "../planningApi";

function Kpi({ value, label, color }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.06)", textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || "#e8ecf5", fontFamily: "monospace" }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--text-dim, #8994b0)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    </div>
  );
}

const PRIORITY_COLOR = { urgent: "var(--danger)", high: "var(--warning)", normal: "var(--info)", low: "var(--text-dim)" };

function TaskRow({ task, onComplete, onDelete, busy }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 5, fontSize: 12 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: PRIORITY_COLOR[task.priority] || "var(--text-dim)", flexShrink: 0 }} />
      <span style={{ flex: 1, textDecoration: task.done ? "line-through" : "none", opacity: task.done ? 0.5 : 1 }}>{task.title}</span>
      {task.dueDate && <span style={{ color: "var(--text-dim, #8994b0)", fontFamily: "monospace" }}>{task.dueDate}</span>}
      {!task.done && (
        <>
          <button disabled={busy === task.id} onClick={() => onComplete(task.id)}>{busy === task.id ? "…" : "Done"}</button>
          <button disabled={busy === task.id} onClick={() => onDelete(task.id)}>✕</button>
        </>
      )}
    </div>
  );
}

export default function DailyPlanningConsole() {
  const [agenda, setAgenda] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState({ title: "", dueDate: "", priority: "normal" });

  const refresh = useCallback(() => {
    setLoading(true);
    planningApi.getAgenda()
      .then(r => { if (r.ok !== false) { setAgenda(r); setError(null); } else setError(r.error || "Failed to load agenda"); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addTask = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    await planningApi.createTask(form);
    setForm({ title: "", dueDate: "", priority: "normal" });
    refresh();
  };

  const complete = async (id) => { setBusy(id); try { await planningApi.completeTask(id); refresh(); } finally { setBusy(null); } };
  const remove = async (id) => { setBusy(id); try { await planningApi.deleteTask(id); refresh(); } finally { setBusy(null); } };

  if (loading && !agenda) return <div style={{ padding: 24, color: "var(--text-dim, #8994b0)" }}>Loading daily agenda…</div>;
  if (error && !agenda) return (
    <div style={{ padding: 24 }}>
      <div style={{ color: "var(--danger)", marginBottom: 8 }}>⚠ {error}</div>
      <button onClick={refresh}>Retry</button>
    </div>
  );

  const t = agenda?.tasks || {};

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Daily Planning</h2>
        <button onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
        <Kpi value={t.overdue?.length ?? 0} label="Overdue" color="var(--danger)" />
        <Kpi value={t.dueToday?.length ?? 0} label="Due Today" color="var(--warning)" />
        <Kpi value={t.totalOpen ?? 0} label="Open Tasks" color="var(--info)" />
        <Kpi value={agenda?.founderContext?.pendingDecisions ?? "—"} label="Pending Decisions" color="var(--accent)" />
      </div>

      <form onSubmit={addTask} style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input placeholder="New task…" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={{ flex: 1 }} />
        <input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
        <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <button type="submit">Add</button>
      </form>

      {t.overdue?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--danger)", marginBottom: 8 }}>Overdue</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {t.overdue.map(task => <TaskRow key={task.id} task={task} onComplete={complete} onDelete={remove} busy={busy} />)}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--text-dim, #8994b0)", marginBottom: 8 }}>Today</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {t.dueToday?.length > 0 ? t.dueToday.map(task => <TaskRow key={task.id} task={task} onComplete={complete} onDelete={remove} busy={busy} />)
            : <div style={{ fontSize: 12, color: "var(--text-dim, #8994b0)" }}>Nothing due today.</div>}
        </div>
      </div>

      {t.upcoming?.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--text-dim, #8994b0)", marginBottom: 8 }}>Upcoming</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {t.upcoming.map(task => <TaskRow key={task.id} task={task} onComplete={complete} onDelete={remove} busy={busy} />)}
          </div>
        </div>
      )}

      {agenda?.missionLoad?.active > 0 && (
        <div style={{ marginTop: 20, fontSize: 12, color: "var(--text-dim, #8994b0)" }}>
          {agenda.missionLoad.active} mission(s) actively executing right now.
        </div>
      )}
    </div>
  );
}
