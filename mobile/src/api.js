"use strict";
/**
 * Mobile API client — Play Store safe.
 *
 * All OS-control commands are intercepted client-side and
 * rejected with a friendly message before reaching the backend.
 */

import { getIdToken } from "./firebase";

export const BASE_URL = process.env.REACT_APP_API_URL || "https://your-jarvis-backend.com";

// ── Commands blocked on mobile (OS-level control) ─────────────────
const BLOCKED_PATTERNS = [
  /\b(open|launch|start)\s+(figma|vscode|vs\s*code|terminal|finder|safari|calculator|spotify|slack|notes|mail|zoom|cursor|xcode|iterm|postman|discord|notion|telegram|chrome)\b/i,
  /^type\s+/i,
  /press\s+(key|enter|escape|tab|delete)\b/i,
  /\bclick\b.*\b(button|link|element)\b/i,
  /move\s+mouse/i,
  /\b(create|delete|rename|move|copy)\s+file\b/i,
  /\bfile\s+(system|manager)\b/i,
  /\bshutdown\b/i,
  /restart\s+(computer|pc|mac)\b/i,
  /\bsleep\s+mode\b/i,
  /\bauto(mate)?\s+(desktop|browser|app)\b/i,
  /control\s+(keyboard|mouse|screen)\b/i,
];

function _isBlocked(input) {
  return BLOCKED_PATTERNS.some(p => p.test(input));
}

// ── Auth header ───────────────────────────────────────────────────
async function _authHeaders() {
  const token = await getIdToken().catch(() => null);
  return {
    "Content-Type":  "application/json",
    ...(token ? { "Authorization": `Bearer ${token}` } : {})
  };
}

// ── Base fetch ────────────────────────────────────────────────────
async function _fetch(path, options = {}) {
  const headers = await _authHeaders();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers,
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Normalize backend response ────────────────────────────────────
function _normalize(raw) {
  if (!raw) return { success: false, reply: "No response from server." };
  if (raw.reply !== undefined) return { success: raw.success !== false, ...raw };
  const data  = raw.data || raw;
  const reply = data.reply || data.message || (data.success !== false ? "Done." : (data.error || "Failed."));
  return {
    success: data.success !== false,
    reply,
    intent: data.intent || "unknown",
    mode:   data.mode   || "smart"
  };
}

// ── Send message to JARVIS ────────────────────────────────────────
export async function sendMessage(input, mode = "smart") {
  const trimmed = (input || "").trim();
  if (!trimmed) return { success: false, reply: "Please type a message." };

  // Block OS-control commands before they reach backend
  if (_isBlocked(trimmed)) {
    return {
      success: false,
      reply:   "This feature is not available in the mobile app. Try AI chat, task planning, or business tools instead.",
      intent:  "blocked",
      mode:    "mobile"
    };
  }

  try {
    const data = await _fetch("/jarvis", {
      method: "POST",
      body:   JSON.stringify({ input: trimmed, mode })
    });
    return _normalize(data);
  } catch (err) {
    return { success: false, reply: err.message };
  }
}

// ── Health / connectivity ─────────────────────────────────────────
export async function checkHealth() {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res   = await fetch(`${BASE_URL}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch { return false; }
}

// ── Stats / dashboard ─────────────────────────────────────────────
export async function getStats() {
  try { return await _fetch("/stats"); }
  catch { return null; }
}

export async function getMetrics() {
  try { return await _fetch("/metrics"); }
  catch { return null; }
}

export async function getOpsData() {
  try { return await _fetch("/ops"); }
  catch { return null; }
}

// ── CRM leads ─────────────────────────────────────────────────────
export async function getLeads(status) {
  try {
    const path = status ? `/crm?status=${encodeURIComponent(status)}` : "/crm";
    return await _fetch(path);
  } catch { return []; }
}

// ── Payment links ─────────────────────────────────────────────────
export async function generatePaymentLink({ amount = 999, name, phone, description = "JARVIS AI Access" }) {
  try {
    return await _fetch("/payment/link", {
      method: "POST",
      body:   JSON.stringify({ amount, name, phone, description })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── WhatsApp follow-up ────────────────────────────────────────────
export async function sendFollowUp(phone, message) {
  try {
    return await _fetch("/send-followup", {
      method: "POST",
      body:   JSON.stringify({ phone, message })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── AI direct (task generation) ───────────────────────────────────
export async function generateTask(prompt) {
  const fullPrompt =
    `You are a business task planner. The user wants to: "${prompt}". ` +
    `Break this down into 3-5 clear, actionable steps. ` +
    `Format as a numbered list. Be concise and practical.`;

  return sendMessage(fullPrompt, "intelligence");
}
