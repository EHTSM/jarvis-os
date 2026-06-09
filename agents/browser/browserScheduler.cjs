"use strict";
/**
 * browserScheduler — server-side schedule executor for browser automation.
 *
 * Reads schedules from data/browser-schedules.json (written by the frontend
 * via POST /browser/schedules/*) and fires template runs at the right time.
 *
 * Design:
 *   - Single setInterval tick every 60 s — lightweight, no external deps
 *   - Each tick checks every active schedule; fires if last-run + period < now
 *   - Runs templates via browserRunner.run() — same path as manual operator runs
 *   - Records every run to browserWorkflowStore (history, health, usage stats)
 *   - Emits runtimeEventBus events so the operator SSE stream shows scheduled runs
 *   - Missed-run tracking: records the due time even on failure so the frontend
 *     can show accurate "last attempted" times
 *   - Won't double-fire: per-template in-flight lock prevents concurrent runs
 *   - Graceful stop: stop() clears the interval cleanly
 *
 * Schedule shape (stored in data/browser-schedules.json):
 *   {
 *     [templateId]: {
 *       freq:       "daily" | "weekly" | "monthly",
 *       time:       "HH:MM",          // local server time
 *       day:        0-6,              // weekly only (0=Sun)
 *       dayOfMonth: 1-28,             // monthly only
 *       params:     {},               // optional param substitutions
 *       enabled:    true,
 *     }
 *   }
 *
 * Run-record shape (data/browser-schedule-runs.json):
 *   {
 *     [templateId]: {
 *       lastRun:    ISO,
 *       lastOk:     boolean,
 *       lastError:  string | null,
 *       runCount:   number,
 *     }
 *   }
 *
 * Public API:
 *   start()          — begin ticking (idempotent)
 *   stop()           — clear interval
 *   getStatus()      — { active, schedules, lastTick, nextTick }
 *   getSchedules()   — current schedule map
 *   saveSchedule(id, sched)  — upsert one schedule
 *   removeSchedule(id)       — delete one schedule
 *   getRuns()        — current run-record map
 */

const fs   = require("fs");
const path = require("path");

const SCHEDULES_PATH = path.join(__dirname, "../../data/browser-schedules.json");
const RUNS_PATH      = path.join(__dirname, "../../data/browser-schedule-runs.json");
const TICK_MS        = 60_000;   // check every minute

// ── File I/O ──────────────────────────────────────────────────────────────────

function _loadSchedules() {
  try { return JSON.parse(fs.readFileSync(SCHEDULES_PATH, "utf8")); } catch { return {}; }
}

function _saveSchedules(map) {
  try {
    const dir = path.dirname(SCHEDULES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SCHEDULES_PATH, JSON.stringify(map, null, 2));
  } catch (err) {
    console.error("[BrowserScheduler] Failed to save schedules:", err.message);
  }
}

function _loadRuns() {
  try { return JSON.parse(fs.readFileSync(RUNS_PATH, "utf8")); } catch { return {}; }
}

function _saveRuns(map) {
  try {
    fs.writeFileSync(RUNS_PATH, JSON.stringify(map, null, 2));
  } catch (err) {
    console.error("[BrowserScheduler] Failed to save run records:", err.message);
  }
}

// ── Due-time computation ──────────────────────────────────────────────────────

function _lastDue(sched) {
  if (!sched || sched.freq === "manual" || !sched.enabled) return null;
  const now = new Date();
  const [h, m] = (sched.time || "09:00").split(":").map(Number);

  if (sched.freq === "daily") {
    const due = new Date(now);
    due.setHours(h, m, 0, 0);
    if (due > now) due.setDate(due.getDate() - 1);
    return due;
  }

  if (sched.freq === "weekly") {
    const d    = new Date(now);
    const diff = (d.getDay() - (sched.day ?? 1) + 7) % 7;
    d.setDate(d.getDate() - diff);
    d.setHours(h, m, 0, 0);
    if (d > now) d.setDate(d.getDate() - 7);
    return d;
  }

  if (sched.freq === "monthly") {
    const d = new Date(now.getFullYear(), now.getMonth(), sched.dayOfMonth || 1, h, m);
    if (d > now) d.setMonth(d.getMonth() - 1);
    return d;
  }

  return null;
}

function _isDue(sched, lastRun) {
  const due = _lastDue(sched);
  if (!due) return false;
  if (!lastRun) return true;                         // never run → always due
  return new Date(lastRun) < due;                    // last run was before current due window
}

// ── In-flight lock ────────────────────────────────────────────────────────────

const _inFlight = new Set();   // templateId → running

// ── Execution helpers ─────────────────────────────────────────────────────────

function _getBus() {
  try { return require("../runtime/runtimeEventBus.cjs"); } catch { return null; }
}

function _emit(type, data) {
  const bus = _getBus();
  if (bus?.emit) bus.emit(type, { ...data, _source: "scheduler" });
}

function _getRunner() {
  return require("./browserRunner.cjs");
}

function _getStore() {
  return require("./browserWorkflowStore.cjs");
}

async function _fireTemplate(templateId, sched) {
  if (_inFlight.has(templateId)) {
    console.log(`[BrowserScheduler] Template ${templateId} already running — skipping tick`);
    return;
  }

  const store = _getStore();
  const tpl   = store.getTemplate(templateId);
  if (!tpl) {
    console.warn(`[BrowserScheduler] Template ${templateId} not found — removing schedule`);
    removeSchedule(templateId);
    return;
  }

  const steps = store.getTemplateSteps(templateId, sched.params || {});
  if (!steps?.length) {
    console.warn(`[BrowserScheduler] Template ${templateId} has no steps — skipping`);
    return;
  }

  _inFlight.add(templateId);
  const startedAt = new Date().toISOString();
  console.log(`[BrowserScheduler] Firing scheduled run: "${tpl.name}" (${templateId})`);

  _emit("browser:schedule:start", {
    templateId,
    name: tpl.name,
    freq: sched.freq,
    startedAt,
  });

  let result;
  try {
    result = await _getRunner().run(steps, {
      label:                `Scheduled: ${tpl.name}`,
      headless:             true,
      stopOnFailure:        true,
      takeScreenshotOnFail: true,
      takeScreenshotOnDone: false,
      timeoutMs:            120_000,
    });
  } catch (err) {
    result = { ok: false, error: err.message, label: tpl.name };
  }

  _inFlight.delete(templateId);

  // Record to workflow store (feeds health + history)
  try {
    store.recordExecution(result, {
      templateId,
      workflowName: tpl.name,
      triggeredBy:  `schedule:${sched.freq}`,
    });
  } catch {}

  // Update run record
  const runs = _loadRuns();
  runs[templateId] = {
    lastRun:   new Date().toISOString(),
    lastOk:    result.ok,
    lastError: result.ok ? null : (result.error || "").slice(0, 200),
    runCount:  ((runs[templateId]?.runCount) || 0) + 1,
  };
  _saveRuns(runs);

  _emit("browser:schedule:done", {
    templateId,
    name:       tpl.name,
    ok:         result.ok,
    error:      result.ok ? null : result.error,
    completedAt: new Date().toISOString(),
  });

  if (!result.ok) {
    console.warn(`[BrowserScheduler] Scheduled run failed: "${tpl.name}" — ${result.error}`);
  } else {
    console.log(`[BrowserScheduler] Scheduled run ok: "${tpl.name}"`);
  }
}

// ── Tick ──────────────────────────────────────────────────────────────────────

let _interval    = null;
let _lastTick    = null;
let _tickCount   = 0;
let _active      = false;

async function _tick() {
  _lastTick  = new Date().toISOString();
  _tickCount++;

  const schedules = _loadSchedules();
  const runs      = _loadRuns();
  const keys      = Object.keys(schedules);

  if (keys.length === 0) return;

  const promises = [];
  for (const templateId of keys) {
    const sched   = schedules[templateId];
    if (!sched?.enabled || sched.freq === "manual") continue;

    const lastRun = runs[templateId]?.lastRun || null;
    if (_isDue(sched, lastRun)) {
      promises.push(_fireTemplate(templateId, sched).catch(err => {
        console.error(`[BrowserScheduler] Unhandled error for ${templateId}:`, err.message);
      }));
    }
  }

  if (promises.length > 0) {
    await Promise.allSettled(promises);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function start() {
  if (_active) return;
  _active = true;
  _tick().catch(() => {});  // immediate first check (non-blocking)
  _interval = setInterval(() => { _tick().catch(() => {}); }, TICK_MS);
  _interval.unref();  // don't block process exit
  console.log("[BrowserScheduler] Started — checking every 60s");
}

function stop() {
  if (_interval) { clearInterval(_interval); _interval = null; }
  _active = false;
  console.log("[BrowserScheduler] Stopped");
}

function getStatus() {
  const schedules = _loadSchedules();
  const runs      = _loadRuns();
  const entries   = Object.entries(schedules);
  return {
    active:      _active,
    tickCount:   _tickCount,
    lastTick:    _lastTick,
    nextTick:    _active ? new Date(Date.now() + TICK_MS).toISOString() : null,
    scheduleCount: entries.filter(([, s]) => s.enabled && s.freq !== "manual").length,
    inFlight:    [..._inFlight],
    schedules:   entries.map(([templateId, sched]) => ({
      templateId,
      freq:    sched.freq,
      time:    sched.time,
      enabled: sched.enabled,
      lastRun: runs[templateId]?.lastRun || null,
      lastOk:  runs[templateId]?.lastOk  ?? null,
    })),
  };
}

function getSchedules() { return _loadSchedules(); }

function saveSchedule(templateId, sched) {
  if (!templateId) return { ok: false, error: "templateId required" };
  const map = _loadSchedules();
  if (!sched || sched.freq === "manual") {
    delete map[templateId];
  } else {
    map[templateId] = {
      freq:       sched.freq,
      time:       sched.time || "09:00",
      day:        sched.day ?? 1,
      dayOfMonth: sched.dayOfMonth || 1,
      params:     sched.params || {},
      enabled:    sched.enabled !== false,
    };
  }
  _saveSchedules(map);
  return { ok: true };
}

function removeSchedule(templateId) {
  const map = _loadSchedules();
  delete map[templateId];
  _saveSchedules(map);
  return { ok: true };
}

function getRuns() { return _loadRuns(); }

module.exports = { start, stop, getStatus, getSchedules, saveSchedule, removeSchedule, getRuns };
