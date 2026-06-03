// Personal OS API — connects personalOS.cjs routes.
// All endpoints require operator session (JWT cookie via credentials: "include").
import { _fetch } from "./_client";

// ── Tasks ─────────────────────────────────────────────────────────

export async function getTasks({ status, priority, overdue, limit = 50 } = {}) {
  try {
    const q = new URLSearchParams();
    if (status)   q.set("status",   status);
    if (priority) q.set("priority", priority);
    if (overdue)  q.set("overdue",  "1");
    if (limit)    q.set("limit",    String(limit));
    const qs = q.toString();
    return await _fetch(`/personal/tasks${qs ? "?" + qs : ""}`);
  } catch (err) { return { success: false, error: err.message, tasks: [] }; }
}

export async function createTask({ title, detail, priority, tags, dueDate, goalId } = {}) {
  try {
    return await _fetch("/personal/tasks", {
      method: "POST",
      body: JSON.stringify({ title, detail, priority, tags, dueDate, goalId }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function updateTask(taskId, patch = {}) {
  try {
    return await _fetch(`/personal/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function completeTask(taskId) {
  try {
    return await _fetch(`/personal/tasks/${taskId}/complete`, { method: "POST" });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function deleteTask(taskId) {
  try {
    return await _fetch(`/personal/tasks/${taskId}`, { method: "DELETE" });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Notes ─────────────────────────────────────────────────────────

export async function getNotes({ search, pinned, limit = 20 } = {}) {
  try {
    const q = new URLSearchParams();
    if (search !== undefined && search !== "") q.set("search", search);
    if (pinned === true)  q.set("pinned", "1");
    if (pinned === false) q.set("pinned", "0");
    if (limit) q.set("limit", String(limit));
    const qs = q.toString();
    return await _fetch(`/personal/notes${qs ? "?" + qs : ""}`);
  } catch (err) { return { success: false, error: err.message, notes: [] }; }
}

export async function createNote({ title, content, tags, pinned } = {}) {
  try {
    return await _fetch("/personal/notes", {
      method: "POST",
      body: JSON.stringify({ title, content, tags, pinned }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function updateNote(noteId, patch = {}) {
  try {
    return await _fetch(`/personal/notes/${noteId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function deleteNote(noteId) {
  try {
    return await _fetch(`/personal/notes/${noteId}`, { method: "DELETE" });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Reminders ─────────────────────────────────────────────────────

export async function getReminders({ status, upcoming, limit = 20 } = {}) {
  try {
    const q = new URLSearchParams();
    if (status)   q.set("status",   status);
    if (upcoming) q.set("upcoming", "1");
    if (limit)    q.set("limit",    String(limit));
    const qs = q.toString();
    return await _fetch(`/personal/reminders${qs ? "?" + qs : ""}`);
  } catch (err) { return { success: false, error: err.message, reminders: [], due: [] }; }
}

export async function createReminder({ title, detail, dueAt, repeatMins } = {}) {
  try {
    return await _fetch("/personal/reminders", {
      method: "POST",
      body: JSON.stringify({ title, detail, dueAt, repeatMins }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function dismissReminder(reminderId) {
  try {
    return await _fetch(`/personal/reminders/${reminderId}/dismiss`, { method: "POST" });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function snoozeReminder(reminderId, mins = 30) {
  try {
    return await _fetch(`/personal/reminders/${reminderId}/snooze`, {
      method: "POST",
      body: JSON.stringify({ mins }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Knowledge Base ────────────────────────────────────────────────

export async function getKnowledge({ category, search, limit = 50 } = {}) {
  try {
    const q = new URLSearchParams();
    if (category) q.set("category", category);
    if (search)   q.set("search",   search);
    if (limit)    q.set("limit",    String(limit));
    const qs = q.toString();
    return await _fetch(`/personal/knowledge${qs ? "?" + qs : ""}`);
  } catch (err) { return { success: false, error: err.message, entries: [] }; }
}

export async function addKnowledge({ key, content, category, tags } = {}) {
  try {
    return await _fetch("/personal/knowledge", {
      method: "POST",
      body: JSON.stringify({ key, content, category, tags }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function deleteKnowledge(key) {
  try {
    return await _fetch(`/personal/knowledge/${encodeURIComponent(key)}`, { method: "DELETE" });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Summaries & Search ────────────────────────────────────────────

export async function getPersonalDashboard() {
  try {
    return await _fetch("/personal/dashboard");
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getDailySummary(date) {
  try {
    const q = date ? `?date=${date}` : "";
    return await _fetch(`/personal/summary/daily${q}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getWeeklySummary(weekStart) {
  try {
    const q = weekStart ? `?weekStart=${weekStart}` : "";
    return await _fetch(`/personal/summary/weekly${q}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function searchPersonal(query, limit = 20) {
  try {
    return await _fetch(`/personal/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  } catch (err) { return { success: false, error: err.message, results: [] }; }
}

export async function getPersonalStats() {
  try {
    return await _fetch("/personal/stats");
  } catch (err) { return { success: false, error: err.message }; }
}
