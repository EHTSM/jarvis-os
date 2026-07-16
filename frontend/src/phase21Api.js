/**
 * Phase 21 API client — OAuth, Observability, Live Mode, Production Readiness
 * /oauth/*         — OAuth integration layer
 * /p21/obs/*       — Observability
 * /p21/live/*      — Live mode controls
 * /p21/readiness/* — Production readiness engine
 */
import { _fetch } from "./_client";

// ── OAuth ─────────────────────────────────────────────────────────────
// Matches backend/routes/phase21.js — provider is a path segment, not a
// query param, and refresh/revoke are provider-scoped routes.
export async function getOAuthUrl(provider, opts = {}) {
  const { scopes } = opts;
  const q = scopes ? `?${new URLSearchParams({ scopes }).toString()}` : "";
  return _fetch(`/oauth/${encodeURIComponent(provider)}/url${q}`);
}
export async function listOAuthConnections() {
  return _fetch("/oauth/connections");
}
export async function refreshOAuth(provider) {
  return _fetch(`/oauth/${encodeURIComponent(provider)}/refresh`, { method: "POST" });
}
export async function revokeOAuth(provider) {
  return _fetch(`/oauth/${encodeURIComponent(provider)}/revoke`, { method: "DELETE" });
}
export async function getOAuthProviderStatus() {
  return _fetch("/oauth/status");
}

// ── Integration connectors (live-probed, non-OAuth credential checks) ─
export async function getIntegrationsStatus() {
  return _fetch("/integrations");
}

// ── Observability ────────────────────────────────────────────────────
export async function getObsSnapshot() {
  return _fetch("/p21/obs");
}
export async function getObsTimeline(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p21/obs/timeline${q ? "?" + q : ""}`);
}

// ── Live mode ────────────────────────────────────────────────────────
export async function getLiveStatus() {
  return _fetch("/p21/live/state");
}
export async function setLiveMode(enabled, reason = "") {
  return _fetch("/p21/live/mode", {
    method: "POST", body: JSON.stringify({ enabled, reason }),
  });
}

// ── Production readiness ─────────────────────────────────────────────
export async function getReadinessReport() {
  return _fetch("/p21/readiness/report");
}
export async function runReadinessCheck() {
  return _fetch("/p21/readiness/check", { method: "POST" });
}
