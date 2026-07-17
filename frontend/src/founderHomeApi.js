// Founder Home API — thin wrappers over existing backend endpoints.
// No new backend routes. Revenue: /revenue/dashboard (revenueOS.js, requireAuth).
// Connector health: /vault/health (founderVault.js, requireAuth + operatorOnly).
// Deployment: /deployment/active + /deployment/stats (deployment.js, requireAuth).

import { _fetch } from "./_client";

export async function getRevenueDashboard() {
  try { return await _fetch("/revenue/dashboard"); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function getConnectorHealth() {
  try { return await _fetch("/vault/health"); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function getDeploymentActive() {
  try { return await _fetch("/deployment/active"); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function getDeploymentStats() {
  try { return await _fetch("/deployment/stats"); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}
