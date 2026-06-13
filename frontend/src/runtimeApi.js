import { _fetch, _getExecutionId, _trackExecution, _updateExecutionStatus, _recordExecutionError, _cleanupExecution, _logExecution, _isTransientError } from "./_client";

async function _executeWithRetry(action, maxRetries = 2) {
  const executionId = _getExecutionId();
  const dupCheck = _trackExecution(executionId, action.input || JSON.stringify(action).slice(0, 100));

  // Reject duplicate executions
  if (dupCheck.duplicate) {
    _logExecution({
      executionId,
      action: "dispatch",
      status: "failed",
      error: `Duplicate execution detected (${dupCheck.previousId})`
    });
    return { success: false, error: dupCheck.reason, previousId: dupCheck.previousId };
  }

  let lastError = null;
  let backoffTimer = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      _updateExecutionStatus(executionId, "running");
      const result = await action.exec(executionId, attempt);
      _updateExecutionStatus(executionId, "success");
      _cleanupExecution(executionId);
      _logExecution({
        executionId,
        action: action.name,
        status: "success",
        retryCount: attempt
      });
      return result;
    } catch (err) {
      lastError = err;
      _recordExecutionError(executionId, err);

      const isTransient = _isTransientError(err);
      if (!isTransient || attempt === maxRetries) {
        _updateExecutionStatus(executionId, err.name === "AbortError" ? "cancelled" : "failed");
        _logExecution({
          executionId,
          action: action.name,
          status: "failed",
          error: err.message,
          retryCount: attempt
        });
        break;
      }

      // Cancellable exponential backoff: 200ms → 400ms → 800ms, capped at 2s
      const delay = Math.min(200 * Math.pow(2, attempt), 2000) + Math.random() * 100;
      await new Promise(resolve => {
        backoffTimer = setTimeout(() => { backoffTimer = null; resolve(); }, delay);
      });
    }
  }

  if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null; }
  _cleanupExecution(executionId);
  return { success: false, error: lastError?.message || "Execution failed" };
}

export async function emergencyStop(reason = "operator_initiated") {
  try { return await _fetch("/runtime/emergency/stop", { method: "POST", body: JSON.stringify({ reason }) }); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function emergencyResume() {
  try { return await _fetch("/runtime/emergency/resume", { method: "POST", body: "{}" }); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getRuntimeStatus() {
  try { return await _fetch("/runtime/status"); }
  catch { return null; }
}

export async function getRuntimeHistory(n = 40) {
  try { return await _fetch(`/runtime/history?n=${n}`); }
  catch { return null; }
}

export async function getTasks() {
  try { return await _fetch("/tasks"); }
  catch { return null; }
}

export async function dispatchTask(input, timeoutMs = 30000) {
  try {
    return await _executeWithRetry({
      name: "dispatchTask",
      input,
      exec: async (executionId, attempt) => {
        // Let errors propagate so _executeWithRetry can apply transient-retry logic.
        // Only catch non-transient terminal errors to return structured response.
        return await _fetch("/runtime/dispatch", {
          method: "POST",
          body: JSON.stringify({ input, timeoutMs, executionId, attempt }),
          _executionId: executionId,
          _timeoutMs: timeoutMs
        });
      }
    }, 2);
  } catch (err) {
    _logExecution({
      executionId: "unknown",
      action: "dispatchTask",
      status: "failed",
      error: err.message
    });
    return { success: false, error: err.message };
  }
}

export async function queueTask(input, priority = 1) {
  try {
    return await _executeWithRetry({
      name: "queueTask",
      input,
      exec: async (executionId, attempt) => {
        return await _fetch("/runtime/queue", {
          method: "POST",
          body: JSON.stringify({ input, priority, executionId, attempt }),
          _executionId: executionId,
          _timeoutMs: 10000
        });
      }
    }, 1);
  } catch (err) {
    _logExecution({
      executionId: "unknown",
      action: "queueTask",
      status: "failed",
      error: err.message
    });
    return { success: false, error: err.message };
  }
}

export async function addTask(input, type = "auto") {
  try {
    return await _fetch("/tasks", {
      method: "POST",
      body: JSON.stringify({ input, type })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Engineering pipeline APIs (Phase B2) ─────────────────────────────

export async function runPipeline(request, opts = {}) {
  try {
    return await _fetch("/runtime/pipeline/run", {
      method: "POST",
      body: JSON.stringify({ request, ...opts })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function runProject(goal, opts = {}) {
  try {
    return await _fetch("/runtime/project/run", {
      method: "POST",
      body: JSON.stringify({ goal, opts })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function generateBlueprint(idea, opts = {}) {
  try {
    return await _fetch("/runtime/blueprint/generate", {
      method: "POST",
      body: JSON.stringify({ idea, opts })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function symbolSearch(name) {
  try {
    return await _fetch(`/runtime/symbol-search?name=${encodeURIComponent(name)}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function listPatches(status) {
  try {
    const q = status ? `?status=${status}` : "";
    return await _fetch(`/runtime/patches${q}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getDLQ(limit = 20) {
  try {
    return await _fetch(`/runtime/dead-letter?limit=${limit}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function recoverDLQ() {
  try {
    return await _fetch("/runtime/recover/dlq", { method: "POST" });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function removeDLQEntry(taskId) {
  try {
    return await _fetch(`/runtime/dead-letter/${encodeURIComponent(taskId)}`, { method: "DELETE" });
  } catch (err) { return { success: false, error: err.message }; }
}
