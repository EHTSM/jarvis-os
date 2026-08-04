"use strict";
// V6 Phase 8 (Personal JARVIS): /planning/* client — dailyPlanningEngine.cjs
import { _fetch } from "./_client";

export async function getAgenda() {
  return _fetch("/planning/agenda");
}

export async function listTasks({ done, priority, limit = 100 } = {}) {
  const q = new URLSearchParams();
  if (done !== undefined) q.set("done", String(done));
  if (priority) q.set("priority", priority);
  q.set("limit", limit);
  return _fetch(`/planning/tasks?${q.toString()}`);
}

export async function createTask({ title, dueDate, priority, notes }) {
  return _fetch("/planning/tasks", { method: "POST", body: JSON.stringify({ title, dueDate, priority, notes }) });
}

export async function completeTask(id) {
  return _fetch(`/planning/tasks/${encodeURIComponent(id)}/complete`, { method: "POST" });
}

export async function deleteTask(id) {
  return _fetch(`/planning/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getStats() {
  return _fetch("/planning/stats");
}
