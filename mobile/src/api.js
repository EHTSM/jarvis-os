"use strict";
/**
 * Mobile API client — Play Store safe.
 *
 * All OS-control commands are intercepted client-side and
 * rejected with a friendly message before reaching the backend.
 */

import { getIdToken } from "./firebase";

export const BASE_URL = process.env.REACT_APP_API_URL || "https://your-jarvis-backend.com";

// ── JARVIS session token (Mission 45) ──────────────────────────────
// A Capacitor WebView's cross-origin cookie handling is not reliable the
// way a browser's is, so this app cannot depend on the backend's HttpOnly
// session cookie the way the web frontend does. Instead: exchange the
// Firebase ID token for a JARVIS-signed session JWT once (via the existing
// /api/auth/firebase-session route, which already verifies the Firebase
// token and enforces the org's MFA/provider policy before issuing one),
// then send that JWT as a standard Authorization: Bearer header on every
// request. Stored in localStorage — same trust boundary as the token this
// app already held in memory via the Firebase SDK; never logged.
const SESSION_KEY = "jarvis_session_token";
// Mission 58: /api/auth/firebase-session already returns `role` in its
// response body (backend/routes/auth.js) — this app previously discarded
// it, which is why Mission 55/56 found the mobile UI has no way to know a
// given account can't reach the operator-only /crm, /stats, /ops routes
// until the request itself 403s. Stored alongside the token, same trust
// boundary, so screens can gate on it up front instead of only reacting to
// a failed request after the fact.
const ROLE_KEY = "jarvis_session_role";

function getSessionToken() {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}

function setSessionToken(token) {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* best-effort — a storage failure must not block sign-in */ }
}

export function getSessionRole() {
  try { return localStorage.getItem(ROLE_KEY); } catch { return null; }
}

function setSessionRole(role) {
  try {
    if (role) localStorage.setItem(ROLE_KEY, role);
    else localStorage.removeItem(ROLE_KEY);
  } catch { /* best-effort */ }
}

/**
 * Establish (or refresh) the JARVIS backend session from the currently
 * signed-in Firebase user. Call after every successful Firebase sign-in
 * (login, signup, and on app launch when a session is restored).
 * Returns { success, error?, code? } — callers should surface `code`
 * (e.g. "mfa_required") to the user rather than only `.message`, matching
 * the pattern the web frontend already uses for this exact response shape.
 */
export async function establishSession(user, provider = "firebase") {
  if (!user) return { success: false, error: "No signed-in user" };
  const idToken = await getIdToken().catch(() => null);
  if (!idToken) return { success: false, error: "Could not get ID token" };

  try {
    const res = await fetch(`${BASE_URL}/api/auth/firebase-session`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idToken,
        email:    user.email,
        name:     user.displayName || undefined,
        provider,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      setSessionToken(null);
      setSessionRole(null);
      return { success: false, error: data.error || `HTTP ${res.status}`, code: data.code };
    }
    setSessionToken(data.token || null);
    setSessionRole(data.role || null);
    return { success: true, role: data.role || null };
  } catch (err) {
    setSessionToken(null);
    setSessionRole(null);
    return { success: false, error: err.message };
  }
}

/** Clear the stored session token — call on Firebase sign-out. */
export function clearSession() {
  setSessionToken(null);
  setSessionRole(null);
}

/**
 * Revoke the current JARVIS session server-side (same C10-027 revocation
 * ledger the web cookie logout already uses) before clearing it locally.
 * Call before Firebase sign-out so the Bearer token is still attached.
 * Best-effort: sign-out must proceed even if this call fails (e.g. offline).
 */
export async function endSession() {
  const token = getSessionToken();
  if (!token) return;
  try {
    await fetch(`${BASE_URL}/api/auth/logout`, {
      method:  "POST",
      headers: { "Authorization": `Bearer ${token}` },
    });
  } catch { /* best-effort — local sign-out must not be blocked by this */ }
  setSessionToken(null);
}

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
// Mission 45: send the JARVIS session JWT (established via establishSession()
// after Firebase sign-in) rather than the raw Firebase ID token — the
// backend's requireAuth validates the former (same verifyJWT already used
// for the cookie-based web session), never the latter.
async function _authHeaders() {
  const token = getSessionToken();
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
    // Mission 56: attach the real HTTP status so callers can distinguish an
    // authorization failure (401/403) from a genuine "no data" response —
    // purely additive (every existing catch (err) { ... err.message ... }
    // call site is unaffected; only new code that reads err.status changes).
    const e = new Error(err.error || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
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
// Mission 56: /stats and /ops are operator-only backend routes (403 for a
// regular customer account) — these previously caught every failure the
// same way (return null), which Dashboard.jsx couldn't tell apart from a
// genuinely empty account. Now surfaces { forbidden: true } on a 401/403 so
// the caller can render a real error/permission state instead of a false
// "no clients yet" empty state, matching this file's own established
// {success,error,code}-shaped result pattern (see establishSession above).
export async function getStats() {
  try { return await _fetch("/stats"); }
  catch (err) { return { forbidden: err.status === 401 || err.status === 403, error: err.message }; }
}

export async function getMetrics() {
  try { return await _fetch("/metrics"); }
  catch { return null; }
}

export async function getOpsData() {
  try { return await _fetch("/ops"); }
  catch (err) { return { forbidden: err.status === 401 || err.status === 403, error: err.message }; }
}

// ── CRM leads ─────────────────────────────────────────────────────
// Mission 56 (2026-08-27): this previously called GET /crm, the operator-only
// bulk-dump route (backend/routes/crm.js) — any non-operator mobile account
// got a 403 on every call, silently rendered as an empty leads list. The
// already-existing customer-scoped route is GET /crm/leads (requireAuth +
// attachOrg; returns the caller's own org-scoped leads, or every lead for an
// operator) — this is the route the mobile "CRM & Leads" feature was always
// meant to call. Note: /crm/leads does not support a status filter server-side
// (confirmed by reading the route — it always passes status=undefined to
// crm.getLeads()), so the `status` param here is accepted for API-shape
// compatibility but has no server-side effect, same as before this fix.
export async function getLeads(status) {
  try {
    const path = status ? `/crm/leads?status=${encodeURIComponent(status)}` : "/crm/leads";
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

function normalizePhone(raw) {
  if (!raw) throw new Error("Phone number is required");
  let digits = String(raw).replace(/[\s\-().+]/g, "");
  if (!/^\d+$/.test(digits)) throw new Error(`Invalid phone number: "${raw}"`);
  if (digits.length === 11 && digits.startsWith("0")) digits = "92" + digits.slice(1);
  if (digits.length === 10) digits = "92" + digits;
  if (digits.length < 7 || digits.length > 15) throw new Error(`Phone number out of range: "${raw}"`);
  return "+" + digits;
}

// ── WhatsApp follow-up ────────────────────────────────────────────
export async function sendFollowUp(phone, message) {
  try {
    const normalized = normalizePhone(phone);
    return await _fetch("/send-followup", {
      method: "POST",
      body:   JSON.stringify({ phone: normalized, message })
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
