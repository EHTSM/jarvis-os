"use strict";
/**
 * Personal AI Operating System — tasks, notes, reminders, knowledge, summaries.
 *
 * Entry points:
 *
 * Task Management:
 *   createTask(opts)           — create a personal task
 *   updateTask(taskId, patch)  — update fields
 *   completeTask(taskId)       — mark done
 *   deleteTask(taskId)         — soft-delete
 *   listTasks(opts)            — filter by status, priority, tag, dueDate
 *
 * Notes Management:
 *   createNote(opts)           — create a note
 *   updateNote(noteId, patch)  — edit a note
 *   deleteNote(noteId)         — soft-delete
 *   listNotes(opts)            — filter by tag, search
 *   getNote(noteId)
 *
 * Reminder Management:
 *   createReminder(opts)       — create a reminder with dueAt
 *   dismissReminder(reminderId)
 *   snoozeReminder(reminderId, mins)
 *   listReminders(opts)        — filter by status, upcoming
 *   getDueReminders()          — reminders past their dueAt
 *
 * Personal Knowledge Base:
 *   addKnowledge(opts)         — store a fact/insight keyed by topic
 *   getKnowledge(key)
 *   searchKnowledge(query)     — keyword search across content
 *   listKnowledge(opts)        — filter by category
 *   deleteKnowledge(key)
 *
 * Dashboard & Summaries:
 *   getDashboard()             — live snapshot: tasks due, reminders, goals, health
 *   getDailySummary(date)      — what happened / is due today
 *   getWeeklySummary(weekStart)— weekly roll-up across all stores
 *
 * Reuses (all fail-safe):
 *   goalEngine.listGoals()          — active personal goals on dashboard + summaries
 *   goalEngine.getGoalSummary()     — counts for dashboard
 *   unifiedMemoryEngine.search()    — cross-namespace memory retrieval
 *   lifecycleReports (file read)    — operational health context in summaries
 *   telemetry-summary (file read)   — system health for dashboard
 *
 * No new architecture. No agent army. No AI calls.
 *
 * Storage (all in data/):
 *   personal-tasks.json      — personal task list (max 500)
 *   personal-notes.json      — notes store (max 500)
 *   personal-reminders.json  — reminders (max 200)
 *   personal-kb.json         — personal knowledge base (max 1000)
 *
 * Task shape:
 *   { taskId, title, detail, status, priority, tags[], dueDate?,
 *     createdAt, updatedAt, completedAt?, deletedAt?, goalId?, source }
 *
 * Note shape:
 *   { noteId, title, content, tags[], pinned, source,
 *     createdAt, updatedAt, deletedAt? }
 *
 * Reminder shape:
 *   { reminderId, title, detail, dueAt, status, snoozedUntil?,
 *     repeatMins?, createdAt, updatedAt, dismissedAt? }
 *
 * Knowledge entry shape:
 *   { key, category, content, tags[], source,
 *     createdAt, updatedAt, uses }
 *
 * Dashboard shape:
 *   { generatedAt, tasks, notes, reminders, goals, systemHealth, overdue }
 *
 * Daily summary shape:
 *   { date, completedTasks, pendingTasks, overdueTasks, dueToday,
 *     activeGoals, dueReminders, recentNotes, systemHealth, highlights }
 *
 * Weekly summary shape:
 *   { weekStart, weekEnd, completedTasks, newNotes, goalsProgress,
 *     topCategories, systemTrend, knowledgeAdded, highlights }
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");

const TASKS_PATH     = path.join(DATA_DIR, "personal-tasks.json");
const NOTES_PATH     = path.join(DATA_DIR, "personal-notes.json");
const REMINDERS_PATH = path.join(DATA_DIR, "personal-reminders.json");
const KB_PATH        = path.join(DATA_DIR, "personal-kb.json");

const MAX_TASKS     = 500;
const MAX_NOTES     = 500;
const MAX_REMINDERS = 200;
const MAX_KB        = 1000;

// ── Lazy accessors ────────────────────────────────────────────────
function _ge()  { try { return require("./goalEngine.cjs");           } catch { return null; } }
function _ume() { try { return require("./unifiedMemoryEngine.cjs");  } catch { return null; } }

// ── Generic store helpers ─────────────────────────────────────────
function _loadStore(filePath) {
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const d   = JSON.parse(raw);
        return Array.isArray(d) ? d : [];
    } catch { return []; }
}

function _saveStore(filePath, items, max) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(items.slice(0, max), null, 2));
    fs.renameSync(tmp, filePath);
}

let _idCtr = Date.now();
function _uid(prefix) { return `${prefix}_${++_idCtr}`; }

function _now() { return new Date().toISOString(); }

// ── Safe JSON reader for non-store files ──────────────────────────
function _readJson(name) {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8")); }
    catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════
// TASK MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a personal task.
 * @param {object} opts
 * @param {string}  opts.title
 * @param {string}  [opts.detail]
 * @param {string}  [opts.priority]   "low"|"medium"|"high"|"urgent"  (default "medium")
 * @param {string[]} [opts.tags]
 * @param {string}  [opts.dueDate]    ISO date string
 * @param {string}  [opts.goalId]     link to a goal
 * @param {string}  [opts.source]     "manual"|"goal"|"reminder"
 */
function createTask({ title, detail = "", priority = "medium", tags = [], dueDate, goalId, source = "manual" } = {}) {
    if (!title) return { ok: false, error: "title required" };
    const task = {
        taskId:      _uid("task"),
        title:       title.slice(0, 200),
        detail:      detail.slice(0, 1000),
        status:      "pending",
        priority,
        tags,
        dueDate:     dueDate || null,
        goalId:      goalId  || null,
        source,
        createdAt:   _now(),
        updatedAt:   _now(),
        completedAt: null,
        deletedAt:   null,
    };
    const all = _loadStore(TASKS_PATH);
    all.unshift(task);
    _saveStore(TASKS_PATH, all, MAX_TASKS);
    return task;
}

/**
 * Update task fields.
 * @param {string} taskId
 * @param {object} patch  — subset of task fields to update
 */
function updateTask(taskId, patch = {}) {
    const all = _loadStore(TASKS_PATH);
    const idx = all.findIndex(t => t.taskId === taskId);
    if (idx === -1) return { ok: false, error: "task_not_found" };
    const allowed = ["title","detail","priority","tags","dueDate","status","goalId"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _saveStore(TASKS_PATH, all, MAX_TASKS);
    return { ok: true, task: all[idx] };
}

function completeTask(taskId) {
    const all = _loadStore(TASKS_PATH);
    const idx = all.findIndex(t => t.taskId === taskId);
    if (idx === -1) return { ok: false, error: "task_not_found" };
    if (all[idx].status === "completed") return { ok: false, error: "already completed" };
    all[idx].status      = "completed";
    all[idx].completedAt = _now();
    all[idx].updatedAt   = _now();
    _saveStore(TASKS_PATH, all, MAX_TASKS);
    return { ok: true, task: all[idx] };
}

function deleteTask(taskId) {
    const all = _loadStore(TASKS_PATH);
    const idx = all.findIndex(t => t.taskId === taskId);
    if (idx === -1) return { ok: false, error: "task_not_found" };
    all[idx].deletedAt = _now();
    all[idx].status    = "deleted";
    all[idx].updatedAt = _now();
    _saveStore(TASKS_PATH, all, MAX_TASKS);
    return { ok: true };
}

/**
 * List tasks with filters.
 * @param {object} opts
 * @param {string}   [opts.status]     filter by status
 * @param {string}   [opts.priority]
 * @param {string[]} [opts.tags]       any-match
 * @param {boolean}  [opts.overdue]    only tasks past dueDate
 * @param {string}   [opts.goalId]
 * @param {number}   [opts.limit=50]
 */
function listTasks({ status, priority, tags, overdue, goalId, limit = 50 } = {}) {
    const now = new Date().toISOString();
    let tasks = _loadStore(TASKS_PATH).filter(t => t.status !== "deleted");
    if (status)   tasks = tasks.filter(t => t.status === status);
    if (priority) tasks = tasks.filter(t => t.priority === priority);
    if (goalId)   tasks = tasks.filter(t => t.goalId === goalId);
    if (tags?.length) tasks = tasks.filter(t => tags.some(tag => t.tags?.includes(tag)));
    if (overdue)  tasks = tasks.filter(t => t.dueDate && t.dueDate < now && t.status !== "completed");
    return tasks.slice(0, limit);
}

function getTask(taskId) {
    return _loadStore(TASKS_PATH).find(t => t.taskId === taskId) || null;
}

// ═══════════════════════════════════════════════════════════════════
// NOTES MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a note.
 * @param {object} opts
 * @param {string}  opts.title
 * @param {string}  [opts.content]
 * @param {string[]} [opts.tags]
 * @param {boolean} [opts.pinned]
 * @param {string}  [opts.source]
 */
function createNote({ title, content = "", tags = [], pinned = false, source = "manual" } = {}) {
    if (!title) return { ok: false, error: "title required" };
    const note = {
        noteId:    _uid("note"),
        title:     title.slice(0, 200),
        content:   content.slice(0, 10000),
        tags,
        pinned,
        source,
        createdAt: _now(),
        updatedAt: _now(),
        deletedAt: null,
    };
    const all = _loadStore(NOTES_PATH);
    all.unshift(note);
    _saveStore(NOTES_PATH, all, MAX_NOTES);
    return note;
}

function updateNote(noteId, patch = {}) {
    const all = _loadStore(NOTES_PATH);
    const idx = all.findIndex(n => n.noteId === noteId);
    if (idx === -1) return { ok: false, error: "note_not_found" };
    const allowed = ["title","content","tags","pinned"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _saveStore(NOTES_PATH, all, MAX_NOTES);
    return { ok: true, note: all[idx] };
}

function deleteNote(noteId) {
    const all = _loadStore(NOTES_PATH);
    const idx = all.findIndex(n => n.noteId === noteId);
    if (idx === -1) return { ok: false, error: "note_not_found" };
    all[idx].deletedAt = _now();
    all[idx].updatedAt = _now();
    _saveStore(NOTES_PATH, all, MAX_NOTES);
    return { ok: true };
}

function getNote(noteId) {
    return _loadStore(NOTES_PATH).find(n => n.noteId === noteId) || null;
}

/**
 * List notes.
 * @param {object} opts
 * @param {string[]} [opts.tags]
 * @param {string}   [opts.search]   keyword search in title + content
 * @param {boolean}  [opts.pinned]
 * @param {number}   [opts.limit=20]
 */
function listNotes({ tags, search, pinned, limit = 20 } = {}) {
    let notes = _loadStore(NOTES_PATH).filter(n => !n.deletedAt);
    if (pinned !== undefined) notes = notes.filter(n => n.pinned === pinned);
    if (tags?.length)         notes = notes.filter(n => tags.some(t => n.tags?.includes(t)));
    if (search) {
        const q = search.toLowerCase();
        notes = notes.filter(n =>
            n.title.toLowerCase().includes(q) ||
            n.content.toLowerCase().includes(q)
        );
    }
    return notes.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// REMINDER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a reminder.
 * @param {object} opts
 * @param {string}  opts.title
 * @param {string}  [opts.detail]
 * @param {string}  opts.dueAt      ISO timestamp
 * @param {number}  [opts.repeatMins]  recurring interval in minutes (0 = one-shot)
 */
function createReminder({ title, detail = "", dueAt, repeatMins = 0 } = {}) {
    if (!title) return { ok: false, error: "title required" };
    if (!dueAt) return { ok: false, error: "dueAt required" };
    const rem = {
        reminderId:   _uid("rem"),
        title:        title.slice(0, 200),
        detail:       detail.slice(0, 500),
        dueAt,
        status:       "pending",   // pending | due | dismissed | snoozed
        snoozedUntil: null,
        repeatMins:   repeatMins || 0,
        createdAt:    _now(),
        updatedAt:    _now(),
        dismissedAt:  null,
    };
    const all = _loadStore(REMINDERS_PATH);
    all.unshift(rem);
    _saveStore(REMINDERS_PATH, all, MAX_REMINDERS);
    return rem;
}

function dismissReminder(reminderId) {
    const all = _loadStore(REMINDERS_PATH);
    const idx = all.findIndex(r => r.reminderId === reminderId);
    if (idx === -1) return { ok: false, error: "reminder_not_found" };
    all[idx].status      = "dismissed";
    all[idx].dismissedAt = _now();
    all[idx].updatedAt   = _now();
    _saveStore(REMINDERS_PATH, all, MAX_REMINDERS);
    return { ok: true, reminder: all[idx] };
}

function snoozeReminder(reminderId, mins = 30) {
    const all = _loadStore(REMINDERS_PATH);
    const idx = all.findIndex(r => r.reminderId === reminderId);
    if (idx === -1) return { ok: false, error: "reminder_not_found" };
    const snoozeUntil = new Date(Date.now() + mins * 60_000).toISOString();
    all[idx].status       = "snoozed";
    all[idx].snoozedUntil = snoozeUntil;
    all[idx].updatedAt    = _now();
    _saveStore(REMINDERS_PATH, all, MAX_REMINDERS);
    return { ok: true, reminder: all[idx], snoozedUntil: snoozeUntil };
}

/**
 * Return reminders whose dueAt (or snoozedUntil) has passed.
 */
function getDueReminders() {
    const now = new Date().toISOString();
    return _loadStore(REMINDERS_PATH).filter(r => {
        if (r.status === "dismissed") return false;
        if (r.status === "snoozed")   return r.snoozedUntil && r.snoozedUntil <= now;
        return r.dueAt <= now;
    });
}

function listReminders({ status, upcoming, limit = 20 } = {}) {
    const now = new Date().toISOString();
    let rems = _loadStore(REMINDERS_PATH).filter(r => r.status !== "dismissed");
    if (status)   rems = rems.filter(r => r.status === status);
    if (upcoming) rems = rems.filter(r => r.dueAt > now).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    return rems.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// PERSONAL KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════════

/**
 * Store a fact / insight in the personal knowledge base.
 * @param {object} opts
 * @param {string}  opts.key         unique identifier (slug)
 * @param {string}  opts.content     the fact / insight
 * @param {string}  [opts.category]  "personal"|"work"|"technical"|"business"|"reference"|"other"
 * @param {string[]} [opts.tags]
 * @param {string}  [opts.source]    where this came from
 */
function addKnowledge({ key, content, category = "personal", tags = [], source = "manual" } = {}) {
    if (!key)     return { ok: false, error: "key required" };
    if (!content) return { ok: false, error: "content required" };

    const all = _loadStore(KB_PATH);
    const existing = all.findIndex(k => k.key === key);
    const now = _now();

    const entry = {
        key:       key.slice(0, 100),
        category,
        content:   content.slice(0, 5000),
        tags,
        source,
        createdAt: existing >= 0 ? all[existing].createdAt : now,
        updatedAt: now,
        uses:      existing >= 0 ? (all[existing].uses || 0) : 0,
    };

    if (existing >= 0) all[existing] = entry;
    else all.unshift(entry);

    _saveStore(KB_PATH, all, MAX_KB);
    return { ok: true, entry };
}

function getKnowledge(key) {
    const entry = _loadStore(KB_PATH).find(k => k.key === key) || null;
    if (entry) {
        // Increment use count
        const all = _loadStore(KB_PATH);
        const idx = all.findIndex(k => k.key === key);
        if (idx >= 0) { all[idx].uses = (all[idx].uses || 0) + 1; _saveStore(KB_PATH, all, MAX_KB); }
    }
    return entry;
}

function deleteKnowledge(key) {
    const all = _loadStore(KB_PATH);
    const idx = all.findIndex(k => k.key === key);
    if (idx === -1) return { ok: false, error: "entry_not_found" };
    all.splice(idx, 1);
    _saveStore(KB_PATH, all, MAX_KB);
    return { ok: true };
}

/**
 * Keyword search across knowledge base content + key + tags.
 */
function searchKnowledge(query, { category, limit = 20 } = {}) {
    if (!query) return [];
    const q = query.toLowerCase();
    let entries = _loadStore(KB_PATH);
    if (category) entries = entries.filter(e => e.category === category);
    return entries
        .filter(e =>
            e.key.toLowerCase().includes(q) ||
            e.content.toLowerCase().includes(q) ||
            e.tags?.some(t => t.toLowerCase().includes(q))
        )
        .slice(0, limit);
}

function listKnowledge({ category, limit = 50 } = {}) {
    let entries = _loadStore(KB_PATH);
    if (category) entries = entries.filter(e => e.category === category);
    return entries.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════

/**
 * Live personal dashboard snapshot.
 */
function getDashboard() {
    const now = new Date().toISOString();

    // Tasks
    const allTasks  = _loadStore(TASKS_PATH).filter(t => t.status !== "deleted");
    const pending   = allTasks.filter(t => t.status === "pending");
    const inprog    = allTasks.filter(t => t.status === "in-progress");
    const overdue   = pending.filter(t => t.dueDate && t.dueDate < now);
    const dueToday  = pending.filter(t => {
        if (!t.dueDate) return false;
        const d = t.dueDate.slice(0, 10);
        return d === now.slice(0, 10);
    });

    // Notes
    const recentNotes = _loadStore(NOTES_PATH)
        .filter(n => !n.deletedAt)
        .slice(0, 5);
    const pinnedNotes = _loadStore(NOTES_PATH)
        .filter(n => !n.deletedAt && n.pinned)
        .slice(0, 3);

    // Reminders
    const dueReminders = getDueReminders().slice(0, 5);
    const upcoming     = listReminders({ upcoming: true, limit: 3 });

    // Goals
    const ge       = _ge();
    const goalData = ge ? ge.listGoals({ status: "active", type: "personal", limit: 5 }) : [];
    const goalSum  = ge ? ge.getGoalSummary() : null;

    // System health (from telemetry summary)
    const telSummary = _readJson("telemetry-summary.json");
    const systemHealth = telSummary ? {
        overall:   telSummary.overall,
        errorRate: telSummary.api?.errorRate,
        lastDeploy: telSummary.deploy?.lastDeployAt,
    } : null;

    return {
        generatedAt: now,
        tasks: {
            pending:  pending.length,
            inProgress: inprog.length,
            overdue:  overdue.length,
            dueToday: dueToday.length,
            topPending: pending
                .sort((a, b) => {
                    const rank = { urgent: 4, high: 3, medium: 2, low: 1 };
                    return (rank[b.priority] || 2) - (rank[a.priority] || 2);
                })
                .slice(0, 5),
        },
        notes: {
            total:  _loadStore(NOTES_PATH).filter(n => !n.deletedAt).length,
            pinned: pinnedNotes,
            recent: recentNotes.slice(0, 3),
        },
        reminders: {
            due:      dueReminders,
            upcoming: upcoming,
        },
        goals: {
            active:  goalSum?.activeCount || 0,
            summary: goalSum,
            top:     goalData.slice(0, 3),
        },
        systemHealth,
        overdue: overdue.slice(0, 5),
    };
}

// ═══════════════════════════════════════════════════════════════════
// DAILY SUMMARY
// ═══════════════════════════════════════════════════════════════════

/**
 * Summary for a specific date (default: today).
 * @param {string} [date]  "YYYY-MM-DD"
 */
function getDailySummary(date) {
    const target    = date || new Date().toISOString().slice(0, 10);
    const dayStart  = target + "T00:00:00.000Z";
    const dayEnd    = target + "T23:59:59.999Z";

    const allTasks   = _loadStore(TASKS_PATH).filter(t => t.status !== "deleted");
    const allNotes   = _loadStore(NOTES_PATH).filter(n => !n.deletedAt);
    const allRems    = _loadStore(REMINDERS_PATH);

    // Tasks completed on this date
    const completedToday = allTasks.filter(t =>
        t.completedAt && t.completedAt >= dayStart && t.completedAt <= dayEnd
    );

    // Tasks created on this date
    const createdToday = allTasks.filter(t =>
        t.createdAt >= dayStart && t.createdAt <= dayEnd
    );

    // Tasks due on this date (pending)
    const dueToday = allTasks.filter(t =>
        t.status === "pending" && t.dueDate?.slice(0, 10) === target
    );

    // Overdue at end of day
    const overdue = allTasks.filter(t =>
        t.status === "pending" && t.dueDate && t.dueDate.slice(0, 10) < target
    );

    // Notes created today
    const notesToday = allNotes.filter(n =>
        n.createdAt >= dayStart && n.createdAt <= dayEnd
    );

    // Reminders due today
    const remindersToday = allRems.filter(r =>
        r.dueAt >= dayStart && r.dueAt <= dayEnd
    );

    // Goals
    const ge       = _ge();
    const activeGoals = ge ? ge.listGoals({ status: "active", limit: 10 }) : [];

    // Recent KB entries
    const kb = _loadStore(KB_PATH).filter(k =>
        k.createdAt >= dayStart && k.createdAt <= dayEnd
    );

    // System health
    const telSummary   = _readJson("telemetry-summary.json");
    const lifecycleLast = (_readJson("lifecycle-reports.json") || [])[0] || null;

    // Highlights
    const highlights = [];
    if (completedToday.length > 0)  highlights.push(`Completed ${completedToday.length} task(s)`);
    if (overdue.length > 0)         highlights.push(`${overdue.length} overdue task(s) need attention`);
    if (dueToday.length > 0)        highlights.push(`${dueToday.length} task(s) due today`);
    if (remindersToday.length > 0)  highlights.push(`${remindersToday.length} reminder(s) today`);
    if (notesToday.length > 0)      highlights.push(`Added ${notesToday.length} note(s)`);
    if (kb.length > 0)              highlights.push(`Added ${kb.length} knowledge entry(s)`);
    if (activeGoals.length > 0)     highlights.push(`${activeGoals.length} active goal(s) in progress`);
    if (telSummary?.overall && telSummary.overall !== "healthy") {
        highlights.push(`System health: ${telSummary.overall}`);
    }

    return {
        date:             target,
        generatedAt:      new Date().toISOString(),
        completedTasks:   completedToday.length,
        completedTaskList: completedToday.slice(0, 10).map(t => ({ taskId: t.taskId, title: t.title })),
        createdTasks:     createdToday.length,
        pendingTasks:     allTasks.filter(t => t.status === "pending").length,
        overdueTasks:     overdue.length,
        overdueList:      overdue.slice(0, 5).map(t => ({ taskId: t.taskId, title: t.title, dueDate: t.dueDate })),
        dueToday:         dueToday.length,
        dueTodayList:     dueToday.slice(0, 5).map(t => ({ taskId: t.taskId, title: t.title })),
        notesAdded:       notesToday.length,
        remindersToday:   remindersToday.length,
        reminderList:     remindersToday.slice(0, 5).map(r => ({ reminderId: r.reminderId, title: r.title, dueAt: r.dueAt })),
        knowledgeAdded:   kb.length,
        activeGoals:      activeGoals.length,
        goalList:         activeGoals.slice(0, 3).map(g => ({ goalId: g.goalId, title: g.title, completionPct: g.completionPct })),
        systemHealth:     telSummary ? { overall: telSummary.overall, errorRate: telSummary.api?.errorRate } : null,
        lifecycleHealth:  lifecycleLast ? { maturity: lifecycleLast.maturity?.total, health: lifecycleLast.health?.overall } : null,
        highlights,
    };
}

// ═══════════════════════════════════════════════════════════════════
// WEEKLY SUMMARY
// ═══════════════════════════════════════════════════════════════════

/**
 * Summary for a week starting on weekStart (default: this Monday).
 * @param {string} [weekStart]  "YYYY-MM-DD"
 */
function getWeeklySummary(weekStart) {
    // Default to last Monday
    const now = new Date();
    let start;
    if (weekStart) {
        start = new Date(weekStart + "T00:00:00.000Z");
    } else {
        start = new Date(now);
        const day = start.getUTCDay();          // 0=Sun, 1=Mon
        start.setUTCDate(start.getUTCDate() - ((day + 6) % 7));
        start.setUTCHours(0, 0, 0, 0);
    }
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);

    const ws = start.toISOString();
    const we = end.toISOString();

    const allTasks = _loadStore(TASKS_PATH).filter(t => t.status !== "deleted");
    const allNotes = _loadStore(NOTES_PATH).filter(n => !n.deletedAt);
    const allRems  = _loadStore(REMINDERS_PATH);
    const allKb    = _loadStore(KB_PATH);

    const completedThisWeek = allTasks.filter(t =>
        t.completedAt && t.completedAt >= ws && t.completedAt < we
    );
    const createdThisWeek = allTasks.filter(t =>
        t.createdAt >= ws && t.createdAt < we
    );
    const notesThisWeek = allNotes.filter(n =>
        n.createdAt >= ws && n.createdAt < we
    );
    const kbThisWeek = allKb.filter(k =>
        k.createdAt >= ws && k.createdAt < we
    );
    const remindersThisWeek = allRems.filter(r =>
        r.dueAt >= ws && r.dueAt < we
    );

    // Tag frequency for completed tasks
    const tagCounts = {};
    for (const t of completedThisWeek) {
        for (const tag of (t.tags || [])) {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
    }
    const topTags = Object.entries(tagCounts)
        .sort(([,a],[,b]) => b - a)
        .slice(0, 5)
        .map(([tag, count]) => ({ tag, count }));

    // Goals progress this week
    const ge       = _ge();
    const allGoals = ge ? ge.listGoals({ limit: 50 }) : [];
    const goalsActiveThisWeek = allGoals.filter(g =>
        g.updatedAt >= ws && g.updatedAt < we
    );
    const goalsCompletedThisWeek = allGoals.filter(g =>
        g.status === "completed" && g.completedAt >= ws && g.completedAt < we
    );

    // Lifecycle reports this week
    const lifecycleReports = (_readJson("lifecycle-reports.json") || [])
        .filter(r => r.generatedAt >= ws && r.generatedAt < we);
    const avgMaturity = lifecycleReports.length
        ? Math.round(lifecycleReports.reduce((s, r) => s + (r.maturity?.total || 0), 0) / lifecycleReports.length)
        : null;

    // Highlights
    const highlights = [];
    if (completedThisWeek.length > 0)         highlights.push(`Completed ${completedThisWeek.length} task(s)`);
    if (createdThisWeek.length > 0)           highlights.push(`Created ${createdThisWeek.length} new task(s)`);
    if (notesThisWeek.length > 0)             highlights.push(`Added ${notesThisWeek.length} note(s)`);
    if (kbThisWeek.length > 0)                highlights.push(`Added ${kbThisWeek.length} knowledge entry(s)`);
    if (goalsCompletedThisWeek.length > 0)    highlights.push(`Completed ${goalsCompletedThisWeek.length} goal(s)`);
    if (goalsActiveThisWeek.length > 0)       highlights.push(`Progressed on ${goalsActiveThisWeek.length} goal(s)`);
    if (avgMaturity !== null)                  highlights.push(`Average system maturity: ${avgMaturity}/100`);

    // Velocity: tasks completed / 5 working days
    const dailyVelocity = Math.round(completedThisWeek.length / 5 * 10) / 10;

    return {
        weekStart:          start.toISOString().slice(0, 10),
        weekEnd:            end.toISOString().slice(0, 10),
        generatedAt:        new Date().toISOString(),
        completedTasks:     completedThisWeek.length,
        createdTasks:       createdThisWeek.length,
        dailyVelocity,
        notesAdded:         notesThisWeek.length,
        knowledgeAdded:     kbThisWeek.length,
        remindersTriggered: remindersThisWeek.length,
        goalsActive:        goalsActiveThisWeek.length,
        goalsCompleted:     goalsCompletedThisWeek.length,
        topTags,
        systemMaturity:     avgMaturity,
        highlights,
        topCompletedTasks:  completedThisWeek.slice(0, 10).map(t => ({ taskId: t.taskId, title: t.title, completedAt: t.completedAt })),
        topNotes:           notesThisWeek.slice(0, 5).map(n => ({ noteId: n.noteId, title: n.title })),
    };
}

// ═══════════════════════════════════════════════════════════════════
// MEMORY RETRIEVAL (cross-namespace search via unifiedMemoryEngine)
// ═══════════════════════════════════════════════════════════════════

/**
 * Search across all personal memory (tasks, notes, KB, goals, incidents).
 * Falls back to local search if unifiedMemoryEngine unavailable.
 */
function searchMemory(query, { limit = 20 } = {}) {
    if (!query) return [];
    const q = query.toLowerCase();
    const results = [];

    // Local searches
    const taskHits = listTasks({ limit: 100 }).filter(t =>
        t.title.toLowerCase().includes(q) || t.detail?.toLowerCase().includes(q)
    ).slice(0, 5).map(t => ({ type: "task",      id: t.taskId, title: t.title, ns: "personal" }));

    const noteHits = listNotes({ search: query, limit: 5 })
        .map(n => ({ type: "note",      id: n.noteId, title: n.title, ns: "personal" }));

    const kbHits   = searchKnowledge(query, { limit: 5 })
        .map(k => ({ type: "knowledge", id: k.key,    title: k.key, content: k.content.slice(0, 100), ns: "personal" }));

    results.push(...taskHits, ...noteHits, ...kbHits);

    // Cross-namespace search via UME
    const ume = _ume();
    if (ume) {
        try {
            const umeResults = ume.search(query, { limit: limit - results.length });
            results.push(...umeResults.map(r => ({
                type:  r.type,
                id:    r.entityId,
                title: r.title,
                ns:    r.ns,
                summary: r.summary,
            })));
        } catch { /* non-fatal */ }
    }

    return results.slice(0, limit);
}

// ── Stats ─────────────────────────────────────────────────────────

function getStats() {
    return {
        tasks:     _loadStore(TASKS_PATH).filter(t => t.status !== "deleted").length,
        notes:     _loadStore(NOTES_PATH).filter(n => !n.deletedAt).length,
        reminders: _loadStore(REMINDERS_PATH).filter(r => r.status !== "dismissed").length,
        knowledge: _loadStore(KB_PATH).length,
    };
}

module.exports = {
    // Tasks
    createTask, updateTask, completeTask, deleteTask, listTasks, getTask,
    // Notes
    createNote, updateNote, deleteNote, listNotes, getNote,
    // Reminders
    createReminder, dismissReminder, snoozeReminder, getDueReminders, listReminders,
    // Knowledge
    addKnowledge, getKnowledge, deleteKnowledge, searchKnowledge, listKnowledge,
    // Dashboard & Summaries
    getDashboard, getDailySummary, getWeeklySummary,
    // Memory
    searchMemory,
    // Stats
    getStats,
};
