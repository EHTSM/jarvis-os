"use strict";

// Central adapter coordinator. Routes execution requests to the correct adapter,
// enforces control-layer gates (freeze, isolation, emergency), and tracks
// all executions with full audit receipts.

const terminalAdapter  = require("./terminalExecutionAdapter.cjs");
const filesystemAdapter = require("./filesystemExecutionAdapter.cjs");
const gitAdapter       = require("./gitExecutionAdapter.cjs");
const vscodeAdapter    = require("./vscodeExecutionAdapter.cjs");
const browserAdapter   = require("./browserExecutionAdapter.cjs");
const healthMonitor    = require("./adapterHealthMonitor.cjs");
const capabilityRegistry = require("./adapterCapabilityRegistry.cjs");
const sandboxPolicy    = require("./adapterSandboxPolicyEngine.cjs");

// Optional control-layer integrations (graceful no-op if unavailable)
function _tryRequire(modulePath) {
  try { return require(modulePath); } catch (_) { return null; }
}
const freezeController  = _tryRequire("../control/runtimeFreezeController.cjs");
const isoManager        = _tryRequire("../control/subsystemIsolationManager.cjs");
const emergencyGovernor = _tryRequire("../control/runtimeEmergencyGovernor.cjs");
const logStream         = _tryRequire("../control/liveExecutionLogStream.cjs");

const MAX_EXECUTIONS    = 10000;

const SUBSYSTEM_ID = "execution-adapters";
const ADAPTER_TYPES = new Set(["terminal", "filesystem", "git", "vscode", "browser"]);

let _counter       = 0;
let _executions    = new Map();   // executionId → execution record
let _configured    = false;

function _log(executionId, level, message, meta = {}) {
  if (logStream) {
    try { logStream.appendLog({ executionId, level, message, subsystem: SUBSYSTEM_ID, metadata: meta }); }
    catch (_) {}
  }
}

function _checkGates(adapterType) {
  // Emergency check
  if (emergencyGovernor?.isEmergencyActive?.()) {
    return { allowed: false, reason: "emergency_active" };
  }
  // Freeze check
  if (freezeController) {
    const freeze = freezeController.isFrozen(SUBSYSTEM_ID);
    if (freeze.frozen) return { allowed: false, reason: `frozen: ${freeze.reason}` };
    const adapterFreeze = freezeController.isFrozen(adapterType);
    if (adapterFreeze.frozen) return { allowed: false, reason: `adapter_frozen: ${adapterType}` };
  }
  // Isolation check
  if (isoManager) {
    const iso = isoManager.getSubsystemState?.(SUBSYSTEM_ID);
    if (iso?.found && iso.state === "isolated") return { allowed: false, reason: "subsystem_isolated" };
  }
  return { allowed: true };
}

// Configure adapters and register with health monitor + capability registry
function configure({
  registrations = [],  // [{ adapterId, adapterType, capabilities, policyId }]
} = {}) {
  for (const reg of registrations) {
    const { adapterId, adapterType, capabilities = [], policyId = null } = reg;
    if (!adapterId || !adapterType) continue;

    // Register with health monitor
    healthMonitor.registerAdapter(adapterId, { adapterType });

    // Register with capability registry
    capabilityRegistry.registerAdapter(adapterId, { adapterType, capabilities });
  }
  _configured = true;
  return { configured: true, adapterCount: registrations.length };
}

// Route an execution request to the correct adapter
async function routeExecution({
  adapterType,
  executionId   = null,
  command       = null,
  subcommand    = null,
  args          = [],
  filePath      = null,
  content       = null,
  taskType      = null,
  payload       = {},
  options       = {},
  policyId      = null,
  writeAllowed  = false,
  dryRun        = false,
  timeoutMs     = null,
}) {
  if (!ADAPTER_TYPES.has(adapterType)) {
    return Object.freeze({ routeId: `route-${++_counter}`, adapterType, status: "rejected",
      reason: `unknown_adapter_type: ${adapterType}`, timestamp: new Date().toISOString() });
  }

  executionId = executionId ?? `sv-${++_counter}`;
  const routeId = `route-${_counter}`;
  const now = new Date().toISOString();

  // Control-layer gates
  const gate = _checkGates(adapterType);
  if (!gate.allowed) {
    const record = Object.freeze({ routeId, executionId, adapterType, status: "gated", reason: gate.reason, timestamp: now });
    _executions.set(executionId, record);
    _log(executionId, "warn", `execution gated: ${gate.reason}`, { routeId });
    return record;
  }

  _log(executionId, "info", `routing ${adapterType} execution`, { routeId, command, subcommand });

  let receipt;
  try {
    switch (adapterType) {
      case "terminal":
        receipt = await terminalAdapter.execute({
          executionId, command, policyId,
          timeoutMs: timeoutMs ?? undefined,
          dryRun,
          ...options,
        });
        break;

      case "filesystem":
        if (command === "read")   receipt = filesystemAdapter.readFile(filePath, options);
        else if (command === "write")  receipt = filesystemAdapter.writeFile(filePath, content, { ...options, createDirs: true });
        else if (command === "list")   receipt = filesystemAdapter.readDir(filePath, options);
        else if (command === "stat")   receipt = filesystemAdapter.statFile(filePath);
        else if (command === "exists") receipt = filesystemAdapter.fileExists(filePath);
        else if (command === "delete") receipt = filesystemAdapter.deleteFile(filePath);
        else if (command === "mkdir")  receipt = filesystemAdapter.makeDir(filePath);
        else receipt = { status: "blocked", reason: `unknown_fs_command: ${command}` };
        break;

      case "git":
        receipt = await gitAdapter.execute({
          executionId, subcommand, args,
          writeAllowed,
          timeoutMs: timeoutMs ?? undefined,
          ...options,
        });
        break;

      case "vscode":
        if (command === "flag")         receipt = await vscodeAdapter.runFlag(subcommand);
        else if (command === "open")    receipt = await vscodeAdapter.openFile(filePath);
        else if (command === "diff")    receipt = await vscodeAdapter.openDiff(args[0], args[1]);
        else if (command === "run_cmd") receipt = await vscodeAdapter.runCommand(subcommand);
        else receipt = { status: "blocked", reason: `unknown_vscode_command: ${command}` };
        break;

      case "browser":
        if (command === "queue") receipt = browserAdapter.queueTask(taskType, payload, options);
        else if (command === "execute_next") receipt = await browserAdapter.executeNext();
        else receipt = { status: "blocked", reason: `unknown_browser_command: ${command}` };
        break;

      default:
        receipt = { status: "blocked", reason: "unhandled_adapter_type" };
    }
  } catch (err) {
    receipt = { status: "failed", reason: err.message };
  }

  const status = receipt?.status ?? (receipt?.success ? "completed" : "failed");
  const record = Object.freeze({
    routeId, executionId, adapterType,
    status,
    receipt:   receipt ?? null,
    timestamp: now,
    dryRun,
  });

  if (_executions.size >= MAX_EXECUTIONS) {
    const oldest = _executions.keys().next().value;
    _executions.delete(oldest);
  }
  _executions.set(executionId, record);

  const logLevel = (status === "completed" || status === "dry_run") ? "info" : "warn";
  _log(executionId, logLevel, `${adapterType} execution ${status}`, { routeId, status });

  return record;
}

// Cancel an in-flight terminal execution
function cancelExecution(executionId) {
  return terminalAdapter.cancel(executionId);
}

function getExecution(executionId) {
  const r = _executions.get(executionId);
  return r ? { found: true, ...r } : { found: false };
}

function getRecentExecutions(limit = 50) {
  const all = Array.from(_executions.values());
  return all.slice(-limit).reverse();
}

function getSupervisorStatus() {
  const byAdapter = {};
  const byStatus  = {};
  for (const [, r] of _executions) {
    byAdapter[r.adapterType] = (byAdapter[r.adapterType] ?? 0) + 1;
    byStatus[r.status]       = (byStatus[r.status]       ?? 0) + 1;
  }
  return {
    configured:    _configured,
    totalExecutions: _executions.size,
    activeTerminal: terminalAdapter.getActiveExecutions().length,
    byAdapterType: byAdapter,
    byStatus,
    gatesActive: {
      emergency: emergencyGovernor?.isEmergencyActive?.() ?? false,
      frozen:    freezeController?.isFrozen(SUBSYSTEM_ID)?.frozen ?? false,
    },
  };
}

function reset() {
  _counter    = 0;
  _executions = new Map();
  _configured = false;
  terminalAdapter.reset();
  filesystemAdapter.reset();
  gitAdapter.reset();
  vscodeAdapter.reset();
  browserAdapter.reset();
  healthMonitor.reset();
  capabilityRegistry.reset();
  sandboxPolicy.reset();
}

module.exports = {
  configure, routeExecution, cancelExecution,
  getExecution, getRecentExecutions, getSupervisorStatus, reset,
  ADAPTER_TYPES: Array.from(ADAPTER_TYPES),
  SUBSYSTEM_ID,
};
