"use strict";
// V6 Phase 6 recovery: /twin/* and /fdios/* clients — the founder Digital
// Twin + Identity OS backends (POST-Ω Sprint P6) were fully built with
// zero frontend consumers. Wiring the highest-value real endpoints only,
// not the full 56-route surface.
import { _fetch } from "./_client";

// ── Digital Twin ─────────────────────────────────────────────────────────

export async function getTwinDashboard() {
  return _fetch("/twin/dashboard");
}

export async function getTwinStats() {
  return _fetch("/twin/stats");
}

export async function getTwinDecisions(limit = 20) {
  return _fetch(`/twin/decisions?limit=${limit}`);
}

export async function decide(command, opts = {}) {
  return _fetch("/twin/decide", { method: "POST", body: JSON.stringify({ command, ...opts }) });
}

export async function predictQuick(workflowId, opts = {}) {
  return _fetch("/twin/predict/quick", { method: "POST", body: JSON.stringify({ workflowId, ...opts }) });
}

export async function getPredictStats() {
  return _fetch("/twin/predict/stats");
}

export async function getTwinProfile() {
  return _fetch("/twin/profile");
}

// ── Founder Identity OS ──────────────────────────────────────────────────

export async function getCommandCenter() {
  return _fetch("/fdios/command-center");
}

export async function searchCommandCenter(q) {
  return _fetch(`/fdios/command-center/search?q=${encodeURIComponent(q)}`);
}

export async function getIdentity() {
  return _fetch("/fdios/identity");
}

export async function getAssets() {
  return _fetch("/fdios/assets");
}
