"use strict";

// Tracks spawned processes for lifecycle management and cleanup.
// Prevents orphaned processes by enforcing registration and TTL limits.

const MAX_TRACKED    = 500;
const DEFAULT_TTL_MS = 300000; // 5 minutes

let _counter   = 0;
let _processes = new Map(); // registrationId → process record

function _isAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    // signal 0 = existence check only, does NOT kill
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

// Register a spawned process for tracking
function registerProcess(pid, {
  executionId = null,
  adapterType = "terminal",
  command     = null,
  ttlMs       = DEFAULT_TTL_MS,
  metadata    = {},
} = {}) {
  if (!pid || typeof pid !== "number") return { registered: false, reason: "invalid_pid" };
  if (_processes.size >= MAX_TRACKED) return { registered: false, reason: "tracking_limit_reached" };

  // Prevent duplicate registration for same pid
  for (const [, r] of _processes) {
    if (r.pid === pid && r.alive) return { registered: false, reason: "pid_already_tracked" };
  }

  const registrationId = `proc-${++_counter}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  _processes.set(registrationId, {
    registrationId, pid, executionId, adapterType,
    command:     command ?? null,
    alive:       true,
    registeredAt: now,
    expiresAt,
    terminatedAt: null,
    exitCode:    null,
    metadata:    Object.freeze({ ...metadata }),
  });
  return { registered: true, registrationId, pid };
}

// Mark process as terminated (called after it exits naturally)
function deregisterProcess(registrationId, { exitCode = null } = {}) {
  const r = _processes.get(registrationId);
  if (!r) return { deregistered: false, reason: "registration_not_found" };
  r.alive         = false;
  r.terminatedAt  = new Date().toISOString();
  r.exitCode      = exitCode ?? null;
  return { deregistered: true, registrationId, pid: r.pid };
}

// Check if a tracked process is still alive
function checkAlive(registrationId) {
  const r = _processes.get(registrationId);
  if (!r) return { found: false };
  if (!r.alive) return { found: true, alive: false, pid: r.pid };
  const alive = _isAlive(r.pid);
  if (!alive) { r.alive = false; r.terminatedAt = new Date().toISOString(); }
  return { found: true, alive, pid: r.pid, registrationId };
}

// Terminate a tracked process (sends SIGTERM)
function terminateProcess(registrationId, { signal = "SIGTERM", force = false } = {}) {
  const r = _processes.get(registrationId);
  if (!r) return { terminated: false, reason: "registration_not_found" };
  if (!r.alive) return { terminated: false, reason: "process_not_alive" };

  const sig = force ? "SIGKILL" : signal;
  try {
    process.kill(r.pid, sig);
    r.alive        = false;
    r.terminatedAt = new Date().toISOString();
    return { terminated: true, registrationId, pid: r.pid, signal: sig };
  } catch (err) {
    // Process already dead
    r.alive = false;
    return { terminated: true, registrationId, pid: r.pid, alreadyDead: true };
  }
}

// Scan for TTL-expired or dead processes and clean them up
function cleanupOrphans({ nowMs = Date.now() } = {}) {
  const cleaned = [];
  for (const [regId, r] of _processes) {
    if (!r.alive) continue;
    // Check TTL
    const ttlExpired = nowMs > new Date(r.expiresAt).getTime();
    // Check if actually dead
    const actuallyDead = !_isAlive(r.pid);

    if (ttlExpired || actuallyDead) {
      const reason = ttlExpired ? "ttl_expired" : "process_dead";
      if (ttlExpired && _isAlive(r.pid)) {
        try { process.kill(r.pid, "SIGTERM"); } catch (_) {}
      }
      r.alive        = false;
      r.terminatedAt = new Date(nowMs).toISOString();
      cleaned.push({ registrationId: regId, pid: r.pid, reason });
    }
  }
  return { cleaned: cleaned.length, details: cleaned };
}

function getTrackedProcesses({ aliveOnly = false } = {}) {
  const out = [];
  for (const [, r] of _processes) {
    if (aliveOnly && !r.alive) continue;
    out.push({ registrationId: r.registrationId, pid: r.pid, executionId: r.executionId,
      adapterType: r.adapterType, alive: r.alive, expiresAt: r.expiresAt });
  }
  return out;
}

function getProcessByExecutionId(executionId) {
  for (const [, r] of _processes) {
    if (r.executionId === executionId) return { found: true, ...r };
  }
  return { found: false };
}

function getLifecycleMetrics() {
  let alive = 0, terminated = 0;
  for (const [, r] of _processes) r.alive ? alive++ : terminated++;
  return { total: _processes.size, alive, terminated, maxTracked: MAX_TRACKED };
}

function reset() {
  _counter   = 0;
  _processes = new Map();
}

module.exports = {
  registerProcess, deregisterProcess, checkAlive, terminateProcess,
  cleanupOrphans, getTrackedProcesses, getProcessByExecutionId,
  getLifecycleMetrics, reset,
  DEFAULT_TTL_MS, MAX_TRACKED,
};
