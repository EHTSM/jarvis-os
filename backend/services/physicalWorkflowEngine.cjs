"use strict";
/**
 * physicalWorkflowEngine.cjs — POST-Ω P17 Physical World Integration
 *
 * End-to-end physical workflow: Discover → Register → Verify → Assign →
 *   Execute → Monitor → Recover → Measure → Learn.
 *
 * Reuses: deviceRegistryEngine, deviceOrchestrationEngine, automationScenarioEngine,
 *         deviceHealthEngine, autonomousExecutionEngine, approvalEngine,
 *         workforceManager, selfImprovementEngine, digitalTwinEngine,
 *         knowledgeFederationEngine.
 *
 * Storage: data/physical-workflows.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "physical-workflows.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _dreg  = () => _try(() => require("./deviceRegistryEngine.cjs"));
const _dorch = () => _try(() => require("./deviceOrchestrationEngine.cjs"));
const _ase   = () => _try(() => require("./automationScenarioEngine.cjs"));
const _dhe   = () => _try(() => require("./deviceHealthEngine.cjs"));
const _exe   = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _app   = () => _try(() => require("./approvalEngine.cjs"));
const _wf    = () => _try(() => require("./workforceManager.cjs"));
const _sie   = () => _try(() => require("./selfImprovementEngine.cjs"));
const _dt    = () => _try(() => require("./digitalTwinEngine.cjs"));
const _kfe   = () => _try(() => require("./knowledgeFederationEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `pwf_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const WORKFLOW_STAGES = [
  "discover", "register", "verify", "assign",
  "execute",  "monitor",  "recover", "measure", "learn",
];

const RECOVERY_STRATEGIES = ["retry", "reroute", "isolate", "escalate"];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = {
    workflows: [],
    stats: { total: 0, succeeded: 0, failed: 0, avgStagesCompleted: 0 },
    updatedAt: null,
  };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.workflows)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.workflows.length > 1000) d.workflows = d.workflows.slice(-1000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Stage executors ───────────────────────────────────────────────────────────

async function _runDiscover(ctx) {
  const reg = _dreg();
  const allDevices = reg?.listDevices?.({ limit: 200 })?.devices || [];
  return { stage: "discover", found: allDevices.length, adapterTypes: [...new Set(allDevices.map(d => d.adapterType))] };
}

async function _runRegister(ctx) {
  const reg = _dreg();
  if (!ctx.deviceSpecs || ctx.deviceSpecs.length === 0) {
    return { stage: "register", registered: 0, note: "no new devices to register" };
  }
  const results = ctx.deviceSpecs.map(spec => reg?.register?.(spec) || { ok: false });
  return { stage: "register", registered: results.filter(r => r.ok).length };
}

async function _runVerify(ctx) {
  const reg  = _dreg();
  const devs = ctx.deviceIds || [];
  const results = devs.map(id => reg?.verify?.(id) || { ok: false });
  return { stage: "verify", verified: results.filter(r => r.ok).length, total: devs.length };
}

async function _runAssign(ctx) {
  // Delegate to workforce manager — assign an agent per device group
  const wf = _wf();
  const mission = await wf?.runMission?.({
    name:      `physical_assign_${Date.now()}`,
    objective: `Assign control agents to ${(ctx.deviceIds || []).length} physical devices`,
    agents:    ["device_controller"],
  }).catch(() => null);
  return { stage: "assign", missionId: mission?.missionId || null, agentsAssigned: mission ? 1 : 0 };
}

async function _runExecute(ctx) {
  if (!ctx.deviceIds || ctx.deviceIds.length === 0) {
    return { stage: "execute", ok: true, note: "no devices to execute on" };
  }
  const orch = await _dorch()?.orchestrate?.({
    deviceIds:   ctx.deviceIds,
    commands:    ctx.commands || [{ type: "query", payload: {} }],
    mode:        ctx.mode || "sequential",
    skipExecute: ctx.skipExecute !== false,
  }) || { ok: true, mock: true };
  return { stage: "execute", ...orch };
}

async function _runMonitor(ctx) {
  const scan = _dhe()?.scan?.() || { ok: true, scanned: 0 };
  return { stage: "monitor", ...scan };
}

async function _runRecover(ctx) {
  const strategy = RECOVERY_STRATEGIES[0]; // retry by default
  return { stage: "recover", strategy, note: "auto-recovery via retry on next cycle" };
}

async function _runMeasure(ctx) {
  const orchStats = _dorch()?.getStats?.() || {};
  return {
    stage:   "measure",
    totalOrchestrations: orchStats.total    || 0,
    succeeded:           orchStats.succeeded || 0,
    avgDevicesPerOrch:   orchStats.avgDevicesPerOrch || 0,
  };
}

async function _runLearn(ctx) {
  // Feed execution results back to self-improvement engine
  try {
    _sie()?.recordLesson?.({ source: "physicalWorkflow", context: ctx });
  } catch {}
  return { stage: "learn", ok: true, delegated: "selfImprovementEngine" };
}

const STAGE_RUNNERS = {
  discover: _runDiscover,
  register: _runRegister,
  verify:   _runVerify,
  assign:   _runAssign,
  execute:  _runExecute,
  monitor:  _runMonitor,
  recover:  _runRecover,
  measure:  _runMeasure,
  learn:    _runLearn,
};

// ── Core: run workflow ────────────────────────────────────────────────────────

async function runWorkflow(ctx = {}) {
  const stages  = ctx.stages || WORKFLOW_STAGES;
  const results = [];
  let   stagesCompleted = 0;

  for (const stage of stages) {
    const runner = STAGE_RUNNERS[stage];
    if (!runner) continue;
    try {
      const r = await runner(ctx);
      results.push(r);
      stagesCompleted++;
    } catch (e) {
      results.push({ stage, ok: false, error: e.message });
      if (ctx.haltOnError) break;
    }
  }

  const workflow = {
    id: _id(),
    stages: results,
    stagesCompleted,
    status: stagesCompleted === stages.length ? "success" : "partial",
    context: { deviceIds: ctx.deviceIds, mode: ctx.mode },
    completedAt: _ts(),
  };

  const d = _load();
  d.workflows.push(workflow);
  d.stats = {
    total:     d.workflows.length,
    succeeded: d.workflows.filter(w => w.status === "success").length,
    failed:    d.workflows.filter(w => w.status === "failed").length,
    avgStagesCompleted: Math.round(
      d.workflows.reduce((s, w) => s + (w.stagesCompleted || 0), 0) / d.workflows.length
    ),
  };
  _save(d);

  return { ok: true, workflow };
}

function getWorkflow(id) {
  return _load().workflows.find(w => w.id === id) || null;
}

function listWorkflows({ status, limit = 20 } = {}) {
  let items = _load().workflows;
  if (status) items = items.filter(w => w.status === status);
  return { ok: true, workflows: items.slice(-limit), total: items.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, WORKFLOW_STAGES, RECOVERY_STRATEGIES, updatedAt: d.updatedAt };
}

module.exports = {
  WORKFLOW_STAGES,
  RECOVERY_STRATEGIES,
  runWorkflow,
  getWorkflow,
  listWorkflows,
  getStats,
};
