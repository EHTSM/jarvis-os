// Connector Center API — thin wrappers over existing backend endpoints.
// No new backend routes.
//
// Two backends, complementary:
//   /vault/*        founderVault.js — operator-only credential store (57 connectors,
//                    12 credential types). Setup/validate/rotate/delete secrets.
//   /integrations/*  integrations.js — live scan/probe layer. Health, reconnect,
//                    metrics, failures. Auth-only (any logged-in user), not operator-only.

import { _fetch } from "./_client";

// ── Vault (operator-only — 401/403 for non-operator roles is expected) ──────
export async function getVaultDashboard() {
  try { return await _fetch("/vault/dashboard"); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function getCredentialTypes() {
  try { return await _fetch("/vault/credential-types"); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function getVaultSecrets(params = {}) {
  const qs = new URLSearchParams(params).toString();
  try { return await _fetch(`/vault/secrets${qs ? `?${qs}` : ""}`); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function storeSecret(connectorId, type, value, meta = {}) {
  try {
    return await _fetch(`/vault/secrets/${encodeURIComponent(connectorId)}/${encodeURIComponent(type)}`, {
      method: "POST",
      body: JSON.stringify({ value, meta }),
    });
  } catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function validateSecret(connectorId, type) {
  try {
    return await _fetch(`/vault/secrets/${encodeURIComponent(connectorId)}/${encodeURIComponent(type)}/validate`, { method: "POST" });
  } catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function rotateSecret(connectorId, type, value) {
  try {
    return await _fetch(`/vault/secrets/${encodeURIComponent(connectorId)}/${encodeURIComponent(type)}/rotate`, {
      method: "POST",
      body: JSON.stringify({ value }),
    });
  } catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function deleteSecret(connectorId, type) {
  try {
    return await _fetch(`/vault/secrets/${encodeURIComponent(connectorId)}/${encodeURIComponent(type)}`, { method: "DELETE" });
  } catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function getVaultHistory(connectorId) {
  const qs = connectorId ? `?connectorId=${encodeURIComponent(connectorId)}` : "";
  try { return await _fetch(`/vault/history${qs}`); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

// ── Integrations (live scan/probe — any authenticated user) ─────────────────
export async function runIntegrationScan() {
  try { return await _fetch("/integrations/scan", { method: "POST" }); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function getIntegrationsSummary() {
  try { return await _fetch("/integrations/summary"); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function getAllIntegrations() {
  try { return await _fetch("/integrations"); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function getIntegrationFailures() {
  try { return await _fetch("/integrations/failures"); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function checkIntegrationHealth(id) {
  try { return await _fetch(`/integrations/${encodeURIComponent(id)}/health`, { method: "POST" }); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function reconnectIntegration(id) {
  try { return await _fetch(`/integrations/${encodeURIComponent(id)}/reconnect`, { method: "POST" }); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function getIntegrationMetrics(id) {
  try { return await _fetch(`/integrations/${encodeURIComponent(id)}/metrics`); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function getRotationGuide(id) {
  try { return await _fetch(`/integrations/${encodeURIComponent(id)}/rotate`); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}
