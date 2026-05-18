// Shared HTTP client — imported by all domain API files.
// Not a public export; consumers import from api.js (barrel) or domain files directly.

export const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:5050";

// Global 401 handler — registered by AuthContext on mount.
let _on401 = null;
export function setOn401(fn) { _on401 = fn; }

export function _isElectron() {
  return typeof window !== "undefined" && !!window.electronAPI;
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
      if (res.status === 401) _on401?.();
      throw e;
    }
    return res.json();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error("Request timed out");
    throw err;
  }
}
