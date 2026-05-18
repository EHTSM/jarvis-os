import { _fetch } from "./_client";

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
    return await _fetch("/runtime/dispatch", {
      method: "POST",
      body: JSON.stringify({ input, timeoutMs })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function queueTask(input, priority = 1) {
  try {
    return await _fetch("/runtime/queue", {
      method: "POST",
      body: JSON.stringify({ input, priority })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function addTask(input, type = "auto") {
  try {
    return await _fetch("/tasks", {
      method: "POST",
      body: JSON.stringify({ input, type })
    });
  } catch (err) { return { success: false, error: err.message }; }
}
