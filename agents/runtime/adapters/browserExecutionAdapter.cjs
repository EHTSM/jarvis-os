"use strict";

// Abstract browser task adapter. Records task intents with full receipts.
// Does NOT require a browser runtime — tasks are queued and marked as requiring
// a real browser driver when one is wired up. This makes the module testable
// and composable without a Puppeteer/Playwright dependency.

const TASK_TYPES = new Set([
  "navigate", "click", "fill", "submit", "screenshot",
  "evaluate", "wait_for", "scroll", "hover", "select",
]);

const MAX_QUEUE   = 500;
const MAX_HISTORY = 2000;

let _counter = 0;
let _queue   = [];   // pending tasks (ordered)
let _history = [];   // completed/cancelled (newest first)

// Optional real-driver integration (set at runtime)
let _driver = null;

function _makeTask(taskType, payload, { executionId, priority = 50, metadata = {} }) {
  return {
    taskId:      `btask-${++_counter}`,
    taskType,
    payload:     Object.freeze({ ...payload }),
    executionId: executionId ?? null,
    priority,
    status:      "queued",
    queuedAt:    new Date().toISOString(),
    startedAt:   null,
    completedAt: null,
    result:      null,
    error:       null,
    metadata:    Object.freeze({ ...metadata }),
  };
}

// Register a real browser driver (e.g., Puppeteer page object)
function setDriver(driver) {
  _driver = driver ?? null;
  return { driverSet: _driver !== null };
}

function hasDriver() {
  return _driver !== null;
}

// Queue a browser task
function queueTask(taskType, payload = {}, options = {}) {
  if (!TASK_TYPES.has(taskType)) return { queued: false, reason: `unknown_task_type: ${taskType}` };
  if (_queue.length >= MAX_QUEUE) return { queued: false, reason: "queue_full" };

  const task = _makeTask(taskType, payload, options);
  _queue.push(task);
  return { queued: true, taskId: task.taskId, taskType, position: _queue.length };
}

// Execute the next task in the queue (with real driver if available, else record intent)
async function executeNext() {
  if (_queue.length === 0) return { executed: false, reason: "queue_empty" };
  const task = _queue.shift();
  task.status    = "running";
  task.startedAt = new Date().toISOString();

  if (_driver && typeof _driver.execute === "function") {
    try {
      const result = await _driver.execute(task.taskType, task.payload);
      task.status      = "completed";
      task.completedAt = new Date().toISOString();
      task.result      = result;
    } catch (err) {
      task.status      = "failed";
      task.completedAt = new Date().toISOString();
      task.error       = err.message;
    }
  } else {
    // No real driver: mark as "pending_driver"
    task.status      = "pending_driver";
    task.completedAt = new Date().toISOString();
    task.result      = { note: "no_real_browser_driver_wired" };
  }

  _history.unshift(Object.freeze({ ...task }));
  if (_history.length > MAX_HISTORY) _history.length = MAX_HISTORY;

  return { executed: true, taskId: task.taskId, status: task.status, result: task.result };
}

// Convenience task builders
function navigate(url, options = {}) {
  return queueTask("navigate", { url }, options);
}

function click(selector, options = {}) {
  return queueTask("click", { selector }, options);
}

function fill(selector, value, options = {}) {
  return queueTask("fill", { selector, value }, options);
}

function screenshot(options = {}) {
  return queueTask("screenshot", {}, options);
}

function evaluate(script, options = {}) {
  return queueTask("evaluate", { script }, options);
}

// Cancel a queued task
function cancelTask(taskId) {
  const idx = _queue.findIndex(t => t.taskId === taskId);
  if (idx === -1) return { cancelled: false, reason: "task_not_found_in_queue" };
  const [task] = _queue.splice(idx, 1);
  task.status      = "cancelled";
  task.completedAt = new Date().toISOString();
  _history.unshift(Object.freeze({ ...task }));
  return { cancelled: true, taskId };
}

function getQueue() {
  return _queue.map(t => ({ taskId: t.taskId, taskType: t.taskType, status: t.status, queuedAt: t.queuedAt }));
}

function getHistory(limit = 50) {
  return _history.slice(0, limit);
}

function getAdapterMetrics() {
  const statusCount = {};
  for (const t of _history) statusCount[t.status] = (statusCount[t.status] ?? 0) + 1;
  return {
    adapterType:    "browser",
    hasDriver:      _driver !== null,
    queueDepth:     _queue.length,
    historySize:    _history.length,
    statusDistribution: statusCount,
  };
}

function reset() {
  _counter = 0;
  _queue   = [];
  _history = [];
  _driver  = null;
}

module.exports = {
  setDriver, hasDriver, queueTask, executeNext,
  navigate, click, fill, screenshot, evaluate, cancelTask,
  getQueue, getHistory, getAdapterMetrics, reset,
  TASK_TYPES: Array.from(TASK_TYPES),
};
