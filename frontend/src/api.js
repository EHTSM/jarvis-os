/**
 * JARVIS API barrel — re-exports all domain API functions.
 *
 * Existing imports (e.g. `import { getRuntimeStatus } from "../api"`) continue
 * to work unchanged. New code should import from the domain file directly:
 *   import { getRuntimeStatus } from "../runtimeApi";
 *
 * Domain files:
 *   _client.js      — shared fetch client, BASE_URL, setOn401
 *   authApi.js      — getAuthStatus, loginOperator, logoutOperator
 *   runtimeApi.js   — dispatch, queue, status, history, emergency
 *   crmApi.js       — leads, follow-ups, WhatsApp, Telegram
 *   telemetryApi.js — health, stats, ops, metrics
 *   paymentApi.js   — generatePaymentLink
 */

export { BASE_URL, setOn401 } from "./_client";
export * from "./authApi";
export * from "./runtimeApi";
// Alias: WorkflowPanel imports safeDispatch — maps to the guarded dispatchTask
export { dispatchTask as safeDispatch } from "./runtimeApi";
export * from "./crmApi";
export * from "./telemetryApi";
export * from "./paymentApi";

// ── Core: send command to JARVIS ──────────────────────────────────
// Kept here because it uses _normalize and is the primary Jarvis gateway.
import { _isElectron, _normalize, _fetch } from "./_client";

export async function sendMessage(input, mode = "smart") {
  if (!input?.trim()) return { success: false, reply: "No input provided." };

  if (_isElectron()) {
    const r = await window.electronAPI.sendCommand(input).catch(err => ({ success: false, error: err.message }));
    return _normalize(r);
  }

  try {
    const data = await _fetch("/jarvis", {
      method: "POST",
      body:   JSON.stringify({ input, mode })
    });
    return _normalize(data);
  } catch (err) {
    return { success: false, reply: err.message };
  }
}
