// Shared HTTP client — imported by all domain API files.
// Not a public export; consumers import from api.js (barrel) or domain files directly.

// In development: proxy config in package.json routes requests to localhost:5050.
// In production (single-server nginx): REACT_APP_API_URL is empty → relative paths
//   (e.g. /jarvis, /health) — nginx proxies these to the backend on the same server.
// In production (split: api.ooplix.com): set REACT_APP_API_URL=https://api.ooplix.com
export const BASE_URL = process.env.REACT_APP_API_URL ?? "";

// Global 401 handler — registered by AuthContext on mount.
let _on401 = null;
export function setOn401(fn) { _on401 = fn; }

export function _isElectron() {
  return typeof window !== "undefined" && !!window.electronAPI;
}

// ─── EXECUTION GUARDRAILS ────────────────────────────────────────
// Track active executions to prevent duplicates, handle timeouts, manage retries

const _executionState = new Map(); // executionId -> { status, startTime, controller, retryCount }
const _recentCommands = new Map(); // cmd hash -> { lastTime, executionId } (prevent rapid duplicates)
const _EXEC_STATE_CAP = 200;
const _RECENT_CMDS_CAP = 100;

export function _getExecutionId() {
  return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function _trackExecution(executionId, cmd) {
  const cmdHash = `${cmd}`.slice(0, 100);
  const now = Date.now();
  const recent = _recentCommands.get(cmdHash);

  // Reject if same command executed within 300ms (duplicate protection)
  if (recent && (now - recent.lastTime) < 300) {
    return { duplicate: true, reason: "Duplicate execution within 300ms", previousId: recent.executionId };
  }

  _recentCommands.set(cmdHash, { lastTime: now, executionId });
  if (_recentCommands.size > _RECENT_CMDS_CAP) {
    const oldest = _recentCommands.keys().next().value;
    _recentCommands.delete(oldest);
  }

  _executionState.set(executionId, {
    status: "queued",
    startTime: now,
    controller: new AbortController(),
    retryCount: 0,
    cmd: cmdHash
  });
  if (_executionState.size > _EXEC_STATE_CAP) {
    // Prefer evicting a terminal entry over an in-flight one
    let evictId = null;
    for (const [id, exec] of _executionState.entries()) {
      const done = exec.status === "success" || exec.status === "failed"
                || exec.status === "cancelled" || exec.status === "timeout";
      if (done) { evictId = id; break; }
    }
    if (!evictId) evictId = _executionState.keys().next().value; // fallback: oldest
    _executionState.delete(evictId);
  }

  return { duplicate: false };
}

export function _updateExecutionStatus(executionId, status) {
  const exec = _executionState.get(executionId);
  if (exec) {
    exec.status = status;
    // Emit lifecycle event for UI updates
    window.runtimeEventBus?.emit?.("execution:state", { executionId, status, timestamp: Date.now() });
  }
}

export function _getExecutionController(executionId) {
  return _executionState.get(executionId)?.controller;
}

export function _recordExecutionError(executionId, error) {
  const exec = _executionState.get(executionId);
  if (exec) {
    exec.lastError = error;
    exec.status = error.name === "AbortError" ? "cancelled" : error.message.includes("timeout") ? "timeout" : "failed";
  }
}

const _cleanupTimers = new Map(); // executionId -> timer handle (prevent double-fire)
const _CLEANUP_TIMER_CAP = 300;

export function _cleanupExecution(executionId) {
  if (_cleanupTimers.has(executionId)) return; // already scheduled, skip second call
  _executionState.delete(executionId);
  // Evict oldest cleanup timer if cap exceeded (sustained spam protection)
  if (_cleanupTimers.size >= _CLEANUP_TIMER_CAP) {
    const oldest = _cleanupTimers.keys().next().value;
    clearTimeout(_cleanupTimers.get(oldest));
    _cleanupTimers.delete(oldest);
  }
  // Keep recentCommands for 2s to catch rapid repeats, then evict
  const timer = setTimeout(() => {
    _cleanupTimers.delete(executionId);
    for (const [cmd, info] of _recentCommands.entries()) {
      if (info.executionId === executionId) _recentCommands.delete(cmd);
    }
  }, 2000);
  _cleanupTimers.set(executionId, timer);
  if (typeof timer === "object" && timer?.unref) timer.unref();
}

// Periodic GC: evict stale entries that were never cleaned (e.g. page-hide mid-flight)
// Runs every 60s, only cleans entries older than 5 minutes in a terminal state.
const _GC_INTERVAL = 60_000;
const _GC_TTL      = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [id, exec] of _executionState.entries()) {
    const done = exec.status === "success" || exec.status === "failed"
              || exec.status === "cancelled" || exec.status === "timeout";
    if (done && (now - exec.startTime) > _GC_TTL) _executionState.delete(id);
  }
  // Also prune recentCommands older than 10s (normal window is 2s, but reconnect storms may skip cleanup)
  for (const [cmd, info] of _recentCommands.entries()) {
    if ((now - info.lastTime) > 10_000) _recentCommands.delete(cmd);
  }
}, _GC_INTERVAL);

// ─── STRUCTURED EXECUTION LOGGING ────────────────────────────────
const _LOG_EMIT_CAP   = 20;   // max events per second to runtimeEventBus
const _LOG_OUTPUT_CAP = 4096; // max chars for stdout/stderr fields
let _logEmitCount = 0;
let _logEmitReset = 0;

export function _logExecution(log) {
  // Truncate oversized output fields before they reach the event bus or DOM
  const truncate = (v) => {
    if (typeof v !== "string" || v.length <= _LOG_OUTPUT_CAP) return v;
    return v.slice(0, _LOG_OUTPUT_CAP) + `… [+${v.length - _LOG_OUTPUT_CAP}B truncated]`;
  };

  const entry = {
    executionId: log.executionId,
    timestamp: log.timestamp || Date.now(),
    action: log.action,
    status: log.status,
    duration: log.duration || 0,
    error: truncate(log.error) || null,
    output: truncate(log.output) || undefined,
    retryCount: log.retryCount || 0
  };

  // Flood guard: suppress burst beyond _LOG_EMIT_CAP events/s to runtimeEventBus
  const now = Date.now();
  if (now - _logEmitReset >= 1000) { _logEmitCount = 0; _logEmitReset = now; }
  if (_logEmitCount < _LOG_EMIT_CAP) {
    _logEmitCount++;
    window.runtimeEventBus?.emit?.("execution:log", entry);
  }

  if (log.error) console.error(`[${entry.executionId}] ${entry.action}: ${entry.error}`);
}

export function _isTransientError(error) {
  if (!error) return false;
  const msg = `${error.message || ""}`.toLowerCase();
  return msg.includes("timeout") || msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("request timed out");
}


export function _normalize(raw) {
  if (!raw) return { success: false, reply: "No response from server" };
  if (raw.reply !== undefined) return { success: raw.success !== false, ...raw };

  const data  = raw.data || raw;
  let   reply = data.reply || data.message || "";
  if (!reply && Array.isArray(data.results) && data.results.length) {
    reply = data.results.map(r => r.result?.message || r.result?.result || "").filter(Boolean).join("\n");
  }
  if (!reply) reply = data.success !== false ? "Command executed." : (data.error || "Failed.");

  return {
    success: data.success !== false,
    reply,
    intent:  data.intent  || "unknown",
    emotion: data.emotion || "neutral",
    lang:    data.lang    || "en",
    mode:    data.mode    || "smart"
  };
}

export async function _fetch(path, options = {}) {
  const ctrl  = new AbortController();
  const executionId = options._executionId;
  const timeoutMs = options._timeoutMs || 10_000;

  let timer = setTimeout(() => {
    ctrl.abort();
    if (executionId) _updateExecutionStatus(executionId, "timeout");
  }, timeoutMs);

  try {
    if (executionId) _updateExecutionStatus(executionId, "running");

    const { headers: callerHeaders, ...restOptions } = options;
    const res = await fetch(`${BASE_URL}${path}`, {
      credentials: "include",
      signal: ctrl.signal,
      ...restOptions,
      headers: { "Content-Type": "application/json", ...callerHeaders },
    });

    clearTimeout(timer);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.error || `HTTP ${res.status}`;
      const e   = new Error(msg);
      e.status  = res.status;
      if (executionId) {
        _recordExecutionError(executionId, e);
        _logExecution({ executionId, action: path, status: "failed", error: msg });
      }
      if (res.status === 401) _on401?.();
      throw e;
    }

    const data = res.json ? await res.json() : res;
    if (executionId) _updateExecutionStatus(executionId, "success");
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (executionId) _recordExecutionError(executionId, err);

    // Panic recovery: never crash, always return structured error
    if (err.name === "AbortError") {
      if (executionId) _logExecution({ executionId, action: path, status: "cancelled", error: "Abort signal" });
      throw new Error("Request timed out");
    }

    if (executionId) {
      _logExecution({ executionId, action: path, status: "failed", error: err.message });
    }
    throw err;
  } finally {
    if (executionId) _cleanupExecution(executionId);
  }
}
