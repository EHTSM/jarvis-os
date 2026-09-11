"use strict";
/**
 * Daily Planning Engine — V6 Phase 8 (Personal JARVIS).
 *
 * Survey confirmed no real calendar/agenda/task-prioritization entity
 * exists anywhere in the repo (jarvisController.js's "calendar" match is a
 * keyword-routing regex, not an implementation; founderJournal.cjs is
 * crash/perf/credit tracking; dailyOperatorWorkspace.cjs is an engineering
 * scorecard). This is the genuinely missing piece.
 *
 * Composes real existing subsystems rather than reinventing them:
 *   - missionOrchestrator.listMissions() for active engineering/business work
 *   - digitalTwinEngine.getDashboard() for founder decision load
 *   - founderProfileEngine.getStats() for trust/prediction context
 * Own storage is only for the task entity itself (title/dueDate/priority),
 * since nothing pre-existing models a personal task with a due date.
 *
 * Storage: data/daily-planning.json
 */

const fs   = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "../../data/daily-planning.json");

const PRIORITIES = ["low", "normal", "high", "urgent"];

function _load() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { tasks: [] };
    const raw = fs.readFileSync(DATA_FILE, "utf-8").trim();
    return raw ? JSON.parse(raw) : { tasks: [] };
  } catch { return { tasks: [] }; }
}

let _writing = false, _dirty = null;
function _save(d) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (_writing) { _dirty = d; return; }
  _writing = true;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
  } finally {
    _writing = false;
    if (_dirty) { const nd = _dirty; _dirty = null; _save(nd); }
  }
}

function _id() { return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function _try(fn, fallback) { try { return fn(); } catch { return fallback; } }

function createTask({ title, dueDate, priority = "normal", notes, source } = {}) {
  if (!title) return { ok: false, error: "title required" };
  if (!PRIORITIES.includes(priority)) return { ok: false, error: `invalid priority "${priority}"` };

  const task = {
    id: _id(),
    title,
    dueDate: dueDate || null,
    priority,
    notes: notes || null,
    source: source || "manual", // "manual" | "mission" | "twin"
    done: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  const store = _load();
  store.tasks.push(task);
  _save(store);
  return { ok: true, task };
}

function completeTask(id) {
  const store = _load();
  const idx = store.tasks.findIndex(t => t.id === id);
  if (idx === -1) return { ok: false, error: "task not found" };
  store.tasks[idx].done = true;
  store.tasks[idx].completedAt = new Date().toISOString();
  _save(store);
  return { ok: true, task: store.tasks[idx] };
}

function deleteTask(id) {
  const store = _load();
  const before = store.tasks.length;
  store.tasks = store.tasks.filter(t => t.id !== id);
  if (store.tasks.length === before) return { ok: false, error: "task not found" };
  _save(store);
  return { ok: true };
}

function listTasks({ done, priority, dueBefore, limit = 100 } = {}) {
  let out = _load().tasks;
  if (done !== undefined) out = out.filter(t => t.done === (done === true || done === "true"));
  if (priority) out = out.filter(t => t.priority === priority);
  if (dueBefore) out = out.filter(t => t.dueDate && t.dueDate <= dueBefore);
  return out.slice().sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")).slice(0, limit);
}

const PRIORITY_WEIGHT = { urgent: 3, high: 2, normal: 1, low: 0 };

/**
 * Real daily agenda: today's/overdue open tasks (weighted by priority and
 * due-date urgency) plus a live snapshot of active missions and founder
 * decision load, pulled from the real orchestrator/twin — not duplicated
 * data, just composed for a single "what does today look like" view.
 */
function getAgenda() {
  const today = new Date().toISOString().slice(0, 10);
  const allOpen = listTasks({ done: false, limit: 1000 });

  const overdue = allOpen.filter(t => t.dueDate && t.dueDate < today);
  const dueToday = allOpen.filter(t => t.dueDate === today);
  const upcoming = allOpen.filter(t => t.dueDate && t.dueDate > today).slice(0, 10);
  const noDueDate = allOpen.filter(t => !t.dueDate);

  const scored = [...overdue, ...dueToday, ...noDueDate]
    .slice()
    .sort((a, b) => (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0));

  const orch = _try(() => require("./missionOrchestrator.cjs"), null);
  const activeMissions = _try(() => orch?.listMissions?.({ status: "executing", limit: 5 }), { missions: [], total: 0 });

  const twin = _try(() => require("./digitalTwinEngine.cjs"), null);
  const twinDashboard = _try(() => twin?.getDashboard?.(), null);

  const profile = _try(() => require("./founderProfileEngine.cjs"), null);
  const profileStats = _try(() => profile?.getStats?.(), null);

  return {
    ok: true,
    date: today,
    generatedAt: new Date().toISOString(),
    tasks: {
      overdue,
      dueToday,
      upcoming,
      prioritized: scored.slice(0, 10),
      totalOpen: allOpen.length,
    },
    missionLoad: {
      active: activeMissions?.total || 0,
      recent: (activeMissions?.missions || []).map(m => ({ id: m.id, title: m.title || m.goal, status: m.orchStatus, priority: m.priority })),
    },
    founderContext: twinDashboard ? {
      trustScore: twinDashboard.trustScore,
      pendingDecisions: twinDashboard.founderRequired,
      minutesSavedToday: twinDashboard.minutesSaved,
    } : null,
    profile: profileStats ? { trustScore: profileStats.trustScore, predictionAccuracy: profileStats.predictionAccuracy } : null,
  };
}

function getStats() {
  const store = _load();
  const done = store.tasks.filter(t => t.done);
  const open = store.tasks.filter(t => !t.done);
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: store.tasks.length,
    open: open.length,
    done: done.length,
    overdue: open.filter(t => t.dueDate && t.dueDate < today).length,
    completionRate: store.tasks.length > 0 ? +((done.length / store.tasks.length) * 100).toFixed(1) : 0,
  };
}

module.exports = { createTask, completeTask, deleteTask, listTasks, getAgenda, getStats, PRIORITIES };
