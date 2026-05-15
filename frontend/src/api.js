/**
 * JARVIS Unified API Client
 *
 * Auto-detects environment:
 *   Electron  → window.electronAPI (IPC → main.cjs → backend at :5050)
 *   Web/React → direct HTTP fetch to :5050 (proxied via package.json "proxy")
 */

const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:5050";

function _isElectron() {
  return typeof window !== "undefined" && !!window.electronAPI;
}

function _normalize(raw) {
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

async function _fetch(path, options = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: ctrl.signal,
      ...options,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.error || `HTTP ${res.status}`;
      const e   = new Error(msg);
      e.status  = res.status;
      throw e;
    }
    return res.json();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error("Request timed out");
    throw err;
  }
}

// ── Core: send command to JARVIS ──────────────────────────────────
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

// ── Health check ──────────────────────────────────────────────────
export async function checkHealth() {
  if (_isElectron()) {
    const r = await window.electronAPI.getServerHealth().catch(() => ({ isHealthy: false }));
    return r.isHealthy === true;
  }
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res   = await fetch(`${BASE_URL}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch { return false; }
}

// ── Evolution score ───────────────────────────────────────────────
export async function getEvolutionScore() {
  if (_isElectron()) {
    const r = await window.electronAPI.getEvolutionScore().catch(() => ({}));
    return r.data?.optimization_score ?? 50;
  }
  try {
    const data = await _fetch("/evolution/score");
    return data.optimization_score ?? data.score ?? 50;
  } catch { return 50; }
}

// ── Evolution suggestions ─────────────────────────────────────────
export async function getSuggestions() {
  if (_isElectron()) {
    const r = await window.electronAPI.getSuggestions().catch(() => ({}));
    return r.data?.suggestions || [];
  }
  try {
    const data = await _fetch("/evolution/suggestions");
    return data.suggestions || [];
  } catch { return []; }
}

// ── Approve suggestion ────────────────────────────────────────────
export async function approveSuggestion(id) {
  if (_isElectron()) {
    const r = await window.electronAPI.approveSuggestion(id).catch(() => ({ success: false }));
    return r.data || r;
  }
  try { return await _fetch(`/evolution/approve/${id}`, { method: "POST", body: "{}" }); }
  catch (err) { return { success: false, error: err.message }; }
}

// ── System stats ──────────────────────────────────────────────────
export async function getStats() {
  try { return await _fetch("/stats"); }
  catch { return null; }
}

// ── Metrics / logs ────────────────────────────────────────────────
export async function getMetrics() {
  try { return await _fetch("/metrics"); }
  catch { return null; }
}

// ── CRM ───────────────────────────────────────────────────────────
export async function getLeads() {
  try { return await _fetch("/crm"); }
  catch { return []; }
}

// ── Generate payment link ─────────────────────────────────────────
export async function generatePaymentLink({ amount, name, phone, description }) {
  try {
    return await _fetch("/payment/link", {
      method: "POST",
      body:   JSON.stringify({ amount, name, phone, description })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Create a lead (CRM) ───────────────────────────────────────────
export async function createLead({ name, phone, service, dealValue, notes }) {
  try {
    const body = { name, phone };
    if (service)   body.service   = service;
    if (dealValue) body.dealValue = String(dealValue);
    if (notes)     body.notes     = notes;
    return await _fetch("/crm/lead", { method: "POST", body: JSON.stringify(body) });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Test WhatsApp connection (send a test message) ────────────────
export async function testWhatsAppSend(phone, message) {
  try {
    return await _fetch("/whatsapp/send", {
      method: "POST",
      body: JSON.stringify({ phone, message: message || "✅ JARVIS connected! Your WhatsApp automation is now active." })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Ops / automation status ───────────────────────────────────────
export async function getOpsData() {
  try { return await _fetch("/ops"); }
  catch { return null; }
}

// ── Send WhatsApp ─────────────────────────────────────────────────
export async function sendFollowUp(phone, message) {
  try {
    return await _fetch("/send-followup", {
      method: "POST",
      body:   JSON.stringify({ phone, message })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Telegram ─────────────────────────────────────────────────────
export async function sendTelegram(chatId, message) {
  try {
    return await _fetch("/telegram/send", {
      method: "POST",
      body:   JSON.stringify({ chatId, message })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Emergency controls ────────────────────────────────────────────
export async function emergencyStop(reason = "operator_initiated") {
  try { return await _fetch("/runtime/emergency/stop", { method: "POST", body: JSON.stringify({ reason }) }); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function emergencyResume() {
  try { return await _fetch("/runtime/emergency/resume", { method: "POST", body: "{}" }); }
  catch (err) { return { success: false, error: err.message }; }
}

// ── Runtime operator endpoints ────────────────────────────────────
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

// ── Auth ──────────────────────────────────────────────────────────
export async function getAuthStatus() {
  try {
    const data = await _fetch("/auth/me");
    return data.user || null;
  } catch { return null; }
}

export async function loginOperator(password) {
  try {
    return await _fetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function logoutOperator() {
  try {
    return await _fetch("/auth/logout", { method: "POST", body: "{}" });
  } catch (err) { return { success: false, error: err.message }; }
}

export { BASE_URL };
