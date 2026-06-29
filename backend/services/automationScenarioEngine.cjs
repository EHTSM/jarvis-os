"use strict";
/**
 * automationScenarioEngine.cjs — POST-Ω P17 Physical World Integration
 *
 * Manages reusable automation scenarios: templates that describe multi-device
 *   sequences triggered by events or schedules.
 *
 * Reuses: deviceRegistryEngine, deviceOrchestrationEngine,
 *         autonomousExecutionEngine, workspaceMesh, selfImprovementEngine,
 *         knowledgeFederationEngine.
 *
 * Storage: data/automation-scenarios.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "automation-scenarios.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _dreg = () => _try(() => require("./deviceRegistryEngine.cjs"));
const _dorch = () => _try(() => require("./deviceOrchestrationEngine.cjs"));
const _exe  = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _wm   = () => _try(() => require("./workspaceMesh.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `scn_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const SCENARIO_TRIGGERS = [
  "manual",        // triggered on demand
  "event",         // triggered by device event
  "schedule",      // cron-like recurring
  "threshold",     // triggered when sensor crosses threshold
  "ai_decision",   // triggered by platform AI
];

const BUILTIN_SCENARIOS = [
  {
    id:      "scenario_office_morning",
    name:    "Smart Office Morning Startup",
    trigger: "schedule",
    steps: [
      { order: 1, adapterType: "smart_display", command: "write",   payload: { text: "Good morning — Ooplix OS" } },
      { order: 2, adapterType: "sensor",         command: "read",    payload: { metric: "temperature" } },
      { order: 3, adapterType: "smart_office",   command: "execute", payload: { action: "lights_on" } },
    ],
    minutesSaved: 15,
    description: "Turn on office devices at start of day",
  },
  {
    id:      "scenario_security_sweep",
    name:    "Security Camera Sweep",
    trigger: "schedule",
    steps: [
      { order: 1, adapterType: "camera", command: "stream",  payload: { duration: 30 } },
      { order: 2, adapterType: "sensor", command: "read",    payload: { metric: "motion" } },
    ],
    minutesSaved: 20,
    description: "Automated security check across all cameras and motion sensors",
  },
  {
    id:      "scenario_data_harvest",
    name:    "IoT Data Harvest",
    trigger: "schedule",
    steps: [
      { order: 1, adapterType: "iot",    command: "query",  payload: { metrics: ["temperature","humidity","power"] } },
      { order: 2, adapterType: "sensor", command: "read",   payload: { all: true } },
    ],
    minutesSaved: 30,
    description: "Collect telemetry from all IoT and sensor devices",
  },
  {
    id:      "scenario_maintenance_mode",
    name:    "Device Maintenance Mode",
    trigger: "ai_decision",
    steps: [
      { order: 1, adapterType: "plc",          command: "configure", payload: { mode: "maintenance" } },
      { order: 2, adapterType: "mqtt",          command: "write",     payload: { topic: "maintenance/start" } },
      { order: 3, adapterType: "smart_display", command: "write",     payload: { text: "Maintenance in progress" } },
    ],
    minutesSaved: 45,
    description: "Put industrial devices into safe maintenance mode",
  },
  {
    id:      "scenario_webhook_fanout",
    name:    "Webhook Event Fanout",
    trigger: "event",
    steps: [
      { order: 1, adapterType: "webhook",         command: "execute", payload: { action: "notify_all" } },
      { order: 2, adapterType: "rest_device",     command: "write",   payload: { endpoint: "/status" } },
      { order: 3, adapterType: "smart_display",   command: "write",   payload: { text: "Event received" } },
    ],
    minutesSaved: 10,
    description: "Fan out webhook events to all relevant devices",
  },
];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = {
    scenarios: [...BUILTIN_SCENARIOS.map(s => ({ ...s, builtin: true, execCount: 0, lastRunAt: null }))],
    executions: [],
    stats: { total: 0, builtins: BUILTIN_SCENARIOS.length, executions: 0, byTrigger: {}, minutesSaved: 0 },
    updatedAt: null,
  };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.scenarios)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.executions.length > 2000) d.executions = d.executions.slice(-2000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Core: create scenario ─────────────────────────────────────────────────────

function createScenario(spec = {}) {
  if (!spec.name)    return { ok: false, error: "name required" };
  if (!spec.trigger) return { ok: false, error: "trigger required" };
  if (!SCENARIO_TRIGGERS.includes(spec.trigger)) {
    return { ok: false, error: `invalid trigger. Valid: ${SCENARIO_TRIGGERS.join(", ")}` };
  }

  const scenario = {
    id:          spec.id || _id(),
    name:        spec.name,
    trigger:     spec.trigger,
    steps:       spec.steps || [],
    minutesSaved: spec.minutesSaved || 10,
    description: spec.description || "",
    builtin:     false,
    execCount:   0,
    lastRunAt:   null,
    createdAt:   _ts(),
  };

  const d = _load();
  const existing = d.scenarios.findIndex(s => s.id === scenario.id);
  if (existing >= 0) d.scenarios[existing] = scenario;
  else d.scenarios.push(scenario);
  _updateStats(d);
  _save(d);

  return { ok: true, scenario };
}

// ── Core: execute scenario ────────────────────────────────────────────────────

async function executeScenario(scenarioId, context = {}) {
  const d        = _load();
  const scenario = d.scenarios.find(s => s.id === scenarioId);
  if (!scenario) return { ok: false, error: "scenario not found" };

  // Find devices matching each step's adapterType
  const stepResults = [];
  for (const step of (scenario.steps || [])) {
    const devList = _dreg()?.listDevices?.({ adapterType: step.adapterType, status: "online" })?.devices || [];
    const deviceIds = devList.slice(0, 3).map(d => d.id);

    let result;
    if (deviceIds.length > 0) {
      result = await _dorch()?.orchestrate?.({
        deviceIds,
        commands: [{ type: step.command, payload: step.payload || {} }],
        mode:     "sequential",
        skipExecute: context.skipExecute !== false,
      }) || { ok: true, mock: true };
    } else {
      // No live devices → mock execution
      result = { ok: true, mock: true, adapterType: step.adapterType, command: step.command };
    }
    stepResults.push({ step: step.order, adapterType: step.adapterType, ...result });
  }

  const succeeded = stepResults.filter(r => r.ok).length;
  const execution = {
    id:         _id(),
    scenarioId,
    scenarioName: scenario.name,
    steps:      stepResults.length,
    succeeded,
    failed:     stepResults.length - succeeded,
    status:     succeeded === stepResults.length ? "success" : succeeded > 0 ? "partial" : "failed",
    minutesSaved: scenario.minutesSaved,
    context,
    executedAt: _ts(),
  };

  // Update scenario exec count
  scenario.execCount  = (scenario.execCount || 0) + 1;
  scenario.lastRunAt  = _ts();
  d.executions.push(execution);
  _updateStats(d);
  _save(d);

  return { ok: true, execution };
}

function _updateStats(d) {
  const byTrigger = {};
  SCENARIO_TRIGGERS.forEach(t => { byTrigger[t] = 0; });
  d.scenarios.forEach(s => { if (byTrigger[s.trigger] !== undefined) byTrigger[s.trigger]++; });
  const minutesSaved = d.executions.reduce((s, e) => s + (e.minutesSaved || 0), 0);
  d.stats = {
    total:     d.scenarios.length,
    builtins:  d.scenarios.filter(s => s.builtin).length,
    executions: d.executions.length,
    byTrigger,
    minutesSaved,
  };
}

function getScenario(id) {
  return _load().scenarios.find(s => s.id === id) || null;
}

function listScenarios({ trigger, limit = 50 } = {}) {
  let items = _load().scenarios;
  if (trigger) items = items.filter(s => s.trigger === trigger);
  return { ok: true, scenarios: items.slice(0, limit), total: items.length };
}

function getExecution(id) {
  return _load().executions.find(e => e.id === id) || null;
}

function listExecutions({ scenarioId, limit = 50 } = {}) {
  let items = _load().executions;
  if (scenarioId) items = items.filter(e => e.scenarioId === scenarioId);
  return { ok: true, executions: items.slice(-limit), total: items.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, SCENARIO_TRIGGERS, BUILTIN_COUNT: BUILTIN_SCENARIOS.length, updatedAt: d.updatedAt };
}

module.exports = {
  SCENARIO_TRIGGERS,
  BUILTIN_SCENARIOS,
  createScenario,
  executeScenario,
  getScenario,
  listScenarios,
  getExecution,
  listExecutions,
  getStats,
};
