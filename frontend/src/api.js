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
  const res  = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
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

// ── Send WhatsApp ─────────────────────────────────────────────────
export async function sendFollowUp(phone, message) {
  try {
    return await _fetch("/send-followup", {
      method: "POST",
      body:   JSON.stringify({ phone, message })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export { BASE_URL };
