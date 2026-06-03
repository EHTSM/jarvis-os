import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  getPersonalDashboard, getDailySummary,
  getTasks, createTask, updateTask, completeTask, deleteTask,
  getNotes, createNote, updateNote, deleteNote,
  getReminders, createReminder, dismissReminder, snoozeReminder,
  getKnowledge, addKnowledge, deleteKnowledge,
  searchPersonal,
} from "../personalApi";
import "./PersonalOS.css";

// ── Helpers ───────────────────────────────────────────────────────

function _timeAgo(isoStr) {
  if (!isoStr) return "";
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)   return "just now";
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function _fmtDate(isoStr) {
  if (!isoStr) return "";
  return new Date(isoStr).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function _fmtDateTime(isoStr) {
  if (!isoStr) return "";
  return new Date(isoStr).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const PRIORITY_COLOR = { urgent: "var(--danger)", high: "var(--warning)", medium: "var(--accent)", low: "var(--text-dim)" };
const PRIORITY_LABEL = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };

// ── Sub-nav tabs ──────────────────────────────────────────────────
const VIEWS = [
  { id: "dashboard", label: "Overview" },
  { id: "tasks",     label: "Tasks"    },
  { id: "notes",     label: "Notes"    },
  { id: "reminders", label: "Reminders"},
  { id: "knowledge", label: "Knowledge"},
];

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD VIEW
// ═══════════════════════════════════════════════════════════════════

function DashboardView({ onToast }) {
  const [dash, setDash]       = useState(null);
  const [daily, setDaily]     = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, s] = await Promise.all([getPersonalDashboard(), getDailySummary()]);
    if (d.success !== false) setDash(d);
    if (s.success !== false) setDaily(s);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="pos-loading"><div className="pos-skeleton" /><div className="pos-skeleton pos-skeleton--sm" /></div>;

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="pos-section">
      <div className="pos-dash-header">
        <div>
          <h3 className="pos-dash-title">Personal Overview</h3>
          <p className="pos-dash-sub">{today}</p>
        </div>
        <button className="pos-btn outline" onClick={load}>Refresh</button>
      </div>

      {/* Stats row */}
      {dash && (
        <div className="pos-stats-grid">
          <div className="pos-stat-card">
            <div className="pos-stat-val" style={{ color: "var(--accent)" }}>{dash.tasks?.pending ?? 0}</div>
            <div className="pos-stat-lbl">Pending Tasks</div>
          </div>
          <div className="pos-stat-card">
            <div className="pos-stat-val" style={{ color: "var(--danger)" }}>{dash.tasks?.overdue ?? 0}</div>
            <div className="pos-stat-lbl">Overdue</div>
          </div>
          <div className="pos-stat-card">
            <div className="pos-stat-val" style={{ color: "var(--warning)" }}>{dash.reminders?.due?.length ?? 0}</div>
            <div className="pos-stat-lbl">Due Now</div>
          </div>
          <div className="pos-stat-card">
            <div className="pos-stat-val" style={{ color: "var(--success)" }}>{dash.goals?.active ?? 0}</div>
            <div className="pos-stat-lbl">Active Goals</div>
          </div>
        </div>
      )}

      {/* Due reminders */}
      {dash?.reminders?.due?.length > 0 && (
        <div className="pos-callout pos-callout--warn">
          <span className="pos-callout-icon">🔔</span>
          <div>
            <div className="pos-callout-title">{dash.reminders.due.length} reminder(s) due now</div>
            {dash.reminders.due.slice(0, 3).map(r => (
              <div key={r.reminderId} className="pos-callout-item">{r.title}</div>
            ))}
          </div>
        </div>
      )}

      {/* Today highlights */}
      {daily?.highlights?.length > 0 && (
        <div className="pos-highlights">
          <h4 className="pos-highlights-title">Today</h4>
          {daily.highlights.map((h, i) => (
            <div key={i} className="pos-highlight-row">
              <span className="pos-highlight-dot" />
              <span>{h}</span>
            </div>
          ))}
        </div>
      )}

      {/* Top pending tasks */}
      {dash?.tasks?.topPending?.length > 0 && (
        <div className="pos-dash-section">
          <h4 className="pos-dash-section-title">Priority Tasks</h4>
          {dash.tasks.topPending.map(t => (
            <div key={t.taskId} className="pos-task-row pos-task-row--compact">
              <span className="pos-priority-dot" style={{ background: PRIORITY_COLOR[t.priority] }} />
              <span className="pos-task-title">{t.title}</span>
              {t.dueDate && <span className="pos-task-due">{_fmtDate(t.dueDate)}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Pinned notes */}
      {dash?.notes?.pinned?.length > 0 && (
        <div className="pos-dash-section">
          <h4 className="pos-dash-section-title">Pinned Notes</h4>
          {dash.notes.pinned.map(n => (
            <div key={n.noteId} className="pos-note-chip">
              <span className="pos-pin-icon">📌</span>
              <span>{n.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TASKS VIEW
// ═══════════════════════════════════════════════════════════════════

const EMPTY_TASK = { title: "", detail: "", priority: "medium", dueDate: "" };

function TasksView({ onToast }) {
  const [tasks,   setTasks]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState("pending");
  const [form,    setForm]    = useState(EMPTY_TASK);
  const [editing, setEditing] = useState(null);   // taskId being edited
  const [saving,  setSaving]  = useState(false);
  const [showForm,setShowForm]= useState(false);
  const titleRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getTasks({ status: filter === "all" ? undefined : filter, limit: 100 });
    setTasks(r.tasks ?? (Array.isArray(r) ? r : []));
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const openNew = () => {
    setForm(EMPTY_TASK);
    setEditing(null);
    setShowForm(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  };

  const openEdit = (task) => {
    setForm({ title: task.title, detail: task.detail || "", priority: task.priority, dueDate: task.dueDate?.slice(0, 10) || "" });
    setEditing(task.taskId);
    setShowForm(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { onToast?.("error", "Title is required"); return; }
    setSaving(true);
    const payload = { title: form.title.trim(), detail: form.detail, priority: form.priority };
    if (form.dueDate) payload.dueDate = new Date(form.dueDate).toISOString();

    const r = editing
      ? await updateTask(editing, payload)
      : await createTask(payload);

    if (r.success === false) { onToast?.("error", r.error || "Save failed"); }
    else { onToast?.("success", editing ? "Task updated" : "Task created"); setShowForm(false); load(); }
    setSaving(false);
  };

  const handleComplete = async (taskId) => {
    const r = await completeTask(taskId);
    if (r.ok === false) onToast?.("error", r.error || "Could not complete");
    else { onToast?.("success", "Task completed"); load(); }
  };

  const handleDelete = async (taskId) => {
    const r = await deleteTask(taskId);
    if (r.ok === false) onToast?.("error", r.error || "Could not delete");
    else { onToast?.("success", "Task deleted"); load(); }
  };

  return (
    <div className="pos-section">
      <div className="pos-section-header">
        <h3 className="pos-section-title">Tasks</h3>
        <button className="pos-btn primary" onClick={openNew}>+ New Task</button>
      </div>

      {/* Filter tabs */}
      <div className="pos-filter-row">
        {["pending","in-progress","completed","all"].map(f => (
          <button key={f} className={`pos-filter-btn ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
            {f === "in-progress" ? "In Progress" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="pos-form-card">
          <input ref={titleRef} className="pos-input" placeholder="Task title *" value={form.title}
            onChange={e => setF("title", e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSave()} />
          <textarea className="pos-input pos-textarea" placeholder="Details (optional)" value={form.detail}
            onChange={e => setF("detail", e.target.value)} rows={2} />
          <div className="pos-form-row">
            <select className="pos-select" value={form.priority} onChange={e => setF("priority", e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <input type="date" className="pos-input" value={form.dueDate}
              onChange={e => setF("dueDate", e.target.value)} />
          </div>
          <div className="pos-form-actions">
            <button className="pos-btn primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Create Task"}
            </button>
            <button className="pos-btn outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Task list */}
      {loading ? (
        <div className="pos-loading"><div className="pos-skeleton" /><div className="pos-skeleton pos-skeleton--sm" /></div>
      ) : !tasks || tasks.length === 0 ? (
        <div className="pos-empty">
          <p className="pos-empty-title">No {filter === "all" ? "" : filter} tasks</p>
          <p className="pos-empty-sub">Create your first task above.</p>
        </div>
      ) : (
        <div className="pos-list">
          {tasks.map(t => (
            <div key={t.taskId} className={`pos-task-card ${t.status}`}>
              <div className="pos-task-card-left">
                {t.status !== "completed" && (
                  <button className="pos-check-btn" title="Complete" onClick={() => handleComplete(t.taskId)}>
                    <span className="pos-check-circle" />
                  </button>
                )}
                {t.status === "completed" && <span className="pos-done-mark">✓</span>}
              </div>
              <div className="pos-task-card-body">
                <div className="pos-task-card-top">
                  <span className={`pos-task-card-title ${t.status === "completed" ? "done" : ""}`}>{t.title}</span>
                  <span className="pos-priority-badge" style={{ color: PRIORITY_COLOR[t.priority] }}>
                    {PRIORITY_LABEL[t.priority]}
                  </span>
                </div>
                {t.detail && <div className="pos-task-detail">{t.detail}</div>}
                <div className="pos-task-meta">
                  {t.dueDate && (
                    <span className={`pos-task-due-badge ${new Date(t.dueDate) < new Date() && t.status !== "completed" ? "overdue" : ""}`}>
                      Due {_fmtDate(t.dueDate)}
                    </span>
                  )}
                  <span className="pos-task-age">{_timeAgo(t.createdAt)}</span>
                </div>
              </div>
              <div className="pos-task-card-actions">
                {t.status !== "completed" && (
                  <button className="pos-icon-btn" title="Edit" onClick={() => openEdit(t)}>✎</button>
                )}
                <button className="pos-icon-btn danger" title="Delete" onClick={() => handleDelete(t.taskId)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NOTES VIEW
// ═══════════════════════════════════════════════════════════════════

const EMPTY_NOTE = { title: "", content: "", pinned: false };

function NotesView({ onToast }) {
  const [notes,   setNotes]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [form,    setForm]    = useState(EMPTY_NOTE);
  const [editing, setEditing] = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [showForm,setShowForm]= useState(false);
  const titleRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getNotes({ search: search || undefined, limit: 50 });
    setNotes(r.notes ?? (Array.isArray(r) ? r : []));
    setLoading(false);
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const openNew = () => {
    setForm(EMPTY_NOTE);
    setEditing(null);
    setShowForm(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  };

  const openEdit = (note) => {
    setForm({ title: note.title, content: note.content || "", pinned: note.pinned });
    setEditing(note.noteId);
    setShowForm(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { onToast?.("error", "Title is required"); return; }
    setSaving(true);
    const r = editing
      ? await updateNote(editing, { title: form.title.trim(), content: form.content, pinned: form.pinned })
      : await createNote({ title: form.title.trim(), content: form.content, pinned: form.pinned });
    if (r.ok === false || r.success === false) onToast?.("error", r.error || "Save failed");
    else { onToast?.("success", editing ? "Note updated" : "Note saved"); setShowForm(false); load(); }
    setSaving(false);
  };

  const handleDelete = async (noteId) => {
    const r = await deleteNote(noteId);
    if (r.ok === false) onToast?.("error", r.error || "Could not delete");
    else { onToast?.("success", "Note deleted"); load(); }
  };

  const handlePin = async (note) => {
    const r = await updateNote(note.noteId, { pinned: !note.pinned });
    if (r.ok) load();
  };

  return (
    <div className="pos-section">
      <div className="pos-section-header">
        <h3 className="pos-section-title">Notes</h3>
        <button className="pos-btn primary" onClick={openNew}>+ New Note</button>
      </div>

      <input className="pos-input pos-search" placeholder="Search notes…" value={search}
        onChange={e => setSearch(e.target.value)} />

      {showForm && (
        <div className="pos-form-card">
          <input ref={titleRef} className="pos-input" placeholder="Note title *" value={form.title}
            onChange={e => setF("title", e.target.value)} />
          <textarea className="pos-input pos-textarea pos-textarea--tall" placeholder="Note content…"
            value={form.content} onChange={e => setF("content", e.target.value)} rows={5} />
          <label className="pos-check-label">
            <input type="checkbox" checked={form.pinned} onChange={e => setF("pinned", e.target.checked)} />
            Pin note
          </label>
          <div className="pos-form-actions">
            <button className="pos-btn primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Save Note"}
            </button>
            <button className="pos-btn outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="pos-loading"><div className="pos-skeleton" /><div className="pos-skeleton pos-skeleton--sm" /></div>
      ) : !notes || notes.length === 0 ? (
        <div className="pos-empty">
          <p className="pos-empty-title">{search ? "No matching notes" : "No notes yet"}</p>
          <p className="pos-empty-sub">{search ? "Try a different keyword." : "Capture your first thought above."}</p>
        </div>
      ) : (
        <div className="pos-notes-grid">
          {notes.map(n => (
            <div key={n.noteId} className={`pos-note-card ${n.pinned ? "pinned" : ""}`}>
              <div className="pos-note-card-top">
                <span className="pos-note-title">{n.pinned && <span className="pos-pin">📌 </span>}{n.title}</span>
                <div className="pos-note-actions">
                  <button className="pos-icon-btn" title={n.pinned ? "Unpin" : "Pin"} onClick={() => handlePin(n)}>
                    {n.pinned ? "📌" : "📍"}
                  </button>
                  <button className="pos-icon-btn" title="Edit" onClick={() => openEdit(n)}>✎</button>
                  <button className="pos-icon-btn danger" title="Delete" onClick={() => handleDelete(n.noteId)}>✕</button>
                </div>
              </div>
              {n.content && <div className="pos-note-preview">{n.content.slice(0, 120)}{n.content.length > 120 ? "…" : ""}</div>}
              <div className="pos-note-footer">
                {n.tags?.map(tag => <span key={tag} className="pos-tag">{tag}</span>)}
                <span className="pos-note-age">{_timeAgo(n.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// REMINDERS VIEW
// ═══════════════════════════════════════════════════════════════════

const EMPTY_REM = { title: "", detail: "", dueAt: "" };

function RemindersView({ onToast }) {
  const [data,    setData]    = useState({ reminders: [], due: [] });
  const [loading, setLoading] = useState(true);
  const [form,    setForm]    = useState(EMPTY_REM);
  const [saving,  setSaving]  = useState(false);
  const [showForm,setShowForm]= useState(false);
  const titleRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getReminders({ limit: 50 });
    setData({ reminders: r.reminders ?? [], due: r.due ?? [] });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title.trim()) { onToast?.("error", "Title is required"); return; }
    if (!form.dueAt) { onToast?.("error", "Due date/time is required"); return; }
    setSaving(true);
    const r = await createReminder({ title: form.title.trim(), detail: form.detail, dueAt: new Date(form.dueAt).toISOString() });
    if (r.ok === false || r.success === false) onToast?.("error", r.error || "Could not create reminder");
    else { onToast?.("success", "Reminder set"); setForm(EMPTY_REM); setShowForm(false); load(); }
    setSaving(false);
  };

  const handleDismiss = async (reminderId) => {
    const r = await dismissReminder(reminderId);
    if (r.ok) { onToast?.("success", "Dismissed"); load(); }
  };

  const handleSnooze = async (reminderId) => {
    const r = await snoozeReminder(reminderId, 30);
    if (r.ok) { onToast?.("success", "Snoozed 30 min"); load(); }
  };

  const allRems = data.reminders;
  const dueNow  = data.due;

  return (
    <div className="pos-section">
      <div className="pos-section-header">
        <h3 className="pos-section-title">Reminders</h3>
        <button className="pos-btn primary" onClick={() => { setShowForm(!showForm); setTimeout(() => titleRef.current?.focus(), 50); }}>
          + Set Reminder
        </button>
      </div>

      {showForm && (
        <div className="pos-form-card">
          <input ref={titleRef} className="pos-input" placeholder="Reminder text *" value={form.title}
            onChange={e => setF("title", e.target.value)} />
          <input className="pos-input" placeholder="Details (optional)" value={form.detail}
            onChange={e => setF("detail", e.target.value)} />
          <input type="datetime-local" className="pos-input" value={form.dueAt}
            onChange={e => setF("dueAt", e.target.value)} />
          <div className="pos-form-actions">
            <button className="pos-btn primary" onClick={handleSave} disabled={saving}>
              {saving ? "Setting…" : "Set Reminder"}
            </button>
            <button className="pos-btn outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Due now */}
      {dueNow.length > 0 && (
        <div className="pos-callout pos-callout--warn">
          <span className="pos-callout-icon">🔔</span>
          <div className="pos-callout-body">
            <div className="pos-callout-title">Due now</div>
            {dueNow.map(r => (
              <div key={r.reminderId} className="pos-reminder-due-row">
                <span className="pos-reminder-title">{r.title}</span>
                <div className="pos-reminder-due-actions">
                  <button className="pos-btn outline pos-btn--xs" onClick={() => handleSnooze(r.reminderId)}>Snooze 30m</button>
                  <button className="pos-btn primary pos-btn--xs" onClick={() => handleDismiss(r.reminderId)}>Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="pos-loading"><div className="pos-skeleton" /></div>
      ) : allRems.length === 0 ? (
        <div className="pos-empty">
          <p className="pos-empty-title">No active reminders</p>
          <p className="pos-empty-sub">Set a reminder and Ooplix will surface it when it's due.</p>
        </div>
      ) : (
        <div className="pos-list">
          {allRems.map(r => (
            <div key={r.reminderId} className={`pos-reminder-card ${r.status}`}>
              <div className="pos-reminder-card-body">
                <div className="pos-reminder-title">{r.title}</div>
                {r.detail && <div className="pos-reminder-detail">{r.detail}</div>}
                <div className="pos-reminder-meta">
                  <span className={`pos-rem-badge pos-rem-badge--${r.status}`}>{r.status}</span>
                  <span className="pos-reminder-due">{_fmtDateTime(r.dueAt)}</span>
                </div>
              </div>
              <div className="pos-reminder-card-actions">
                <button className="pos-icon-btn" title="Snooze 30m" onClick={() => handleSnooze(r.reminderId)}>⏸</button>
                <button className="pos-icon-btn danger" title="Dismiss" onClick={() => handleDismiss(r.reminderId)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// KNOWLEDGE VIEW
// ═══════════════════════════════════════════════════════════════════

const EMPTY_KB = { key: "", content: "", category: "personal" };
const KB_CATEGORIES = ["personal", "work", "technical", "business", "reference", "other"];

function KnowledgeView({ onToast }) {
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [category,setCat]     = useState("");
  const [form,    setForm]    = useState(EMPTY_KB);
  const [saving,  setSaving]  = useState(false);
  const [showForm,setShowForm]= useState(false);
  const keyRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getKnowledge({ search: search || undefined, category: category || undefined, limit: 50 });
    setEntries(r.entries ?? (Array.isArray(r) ? r : []));
    setLoading(false);
  }, [search, category]);

  useEffect(() => {
    const t = setTimeout(() => load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.key.trim())     { onToast?.("error", "Key is required"); return; }
    if (!form.content.trim()) { onToast?.("error", "Content is required"); return; }
    setSaving(true);
    const r = await addKnowledge({ key: form.key.trim().replace(/\s+/g, "-").toLowerCase(), content: form.content, category: form.category });
    if (!r.ok) onToast?.("error", r.error || "Could not save");
    else { onToast?.("success", "Knowledge saved"); setForm(EMPTY_KB); setShowForm(false); load(); }
    setSaving(false);
  };

  const handleDelete = async (key) => {
    const r = await deleteKnowledge(key);
    if (r.ok) { onToast?.("success", "Entry deleted"); load(); }
    else onToast?.("error", r.error || "Could not delete");
  };

  return (
    <div className="pos-section">
      <div className="pos-section-header">
        <h3 className="pos-section-title">Knowledge Base</h3>
        <button className="pos-btn primary" onClick={() => { setShowForm(!showForm); setTimeout(() => keyRef.current?.focus(), 50); }}>
          + Add Entry
        </button>
      </div>

      <div className="pos-filter-row">
        <input className="pos-input pos-search" placeholder="Search knowledge…" value={search}
          onChange={e => setSearch(e.target.value)} />
        <select className="pos-select" value={category} onChange={e => setCat(e.target.value)}>
          <option value="">All categories</option>
          {KB_CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
        </select>
      </div>

      {showForm && (
        <div className="pos-form-card">
          <input ref={keyRef} className="pos-input" placeholder="Key / slug (e.g. react-hooks-pattern) *"
            value={form.key} onChange={e => setF("key", e.target.value)} />
          <textarea className="pos-input pos-textarea pos-textarea--tall" placeholder="Knowledge content *"
            value={form.content} onChange={e => setF("content", e.target.value)} rows={4} />
          <select className="pos-select" value={form.category} onChange={e => setF("category", e.target.value)}>
            {KB_CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select>
          <div className="pos-form-actions">
            <button className="pos-btn primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save Entry"}
            </button>
            <button className="pos-btn outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="pos-loading"><div className="pos-skeleton" /><div className="pos-skeleton pos-skeleton--sm" /></div>
      ) : !entries || entries.length === 0 ? (
        <div className="pos-empty">
          <p className="pos-empty-title">{search || category ? "No matching entries" : "Knowledge base is empty"}</p>
          <p className="pos-empty-sub">Add your first insight or fact above.</p>
        </div>
      ) : (
        <div className="pos-list">
          {entries.map(e => (
            <div key={e.key} className="pos-kb-card">
              <div className="pos-kb-card-top">
                <span className="pos-kb-key">{e.key}</span>
                <span className="pos-kb-cat">{e.category}</span>
                <button className="pos-icon-btn danger" title="Delete" onClick={() => handleDelete(e.key)}>✕</button>
              </div>
              <div className="pos-kb-content">{e.content.slice(0, 200)}{e.content.length > 200 ? "…" : ""}</div>
              {e.tags?.length > 0 && (
                <div className="pos-kb-footer">
                  {e.tags.map(t => <span key={t} className="pos-tag">{t}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ROOT COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function PersonalOS({ onToast }) {
  const [view, setView] = useState("dashboard");

  return (
    <div className="pos-root">
      {/* Sub-nav */}
      <nav className="pos-subnav">
        {VIEWS.map(v => (
          <button key={v.id} className={`pos-subnav-btn ${view === v.id ? "active" : ""}`}
            onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </nav>

      {/* View content */}
      <div className="pos-content">
        {view === "dashboard"  && <DashboardView  onToast={onToast} />}
        {view === "tasks"      && <TasksView      onToast={onToast} />}
        {view === "notes"      && <NotesView      onToast={onToast} />}
        {view === "reminders"  && <RemindersView  onToast={onToast} />}
        {view === "knowledge"  && <KnowledgeView  onToast={onToast} />}
      </div>
    </div>
  );
}
