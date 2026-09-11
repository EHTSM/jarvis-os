"use strict";
// V6 Phase 4: Blue/Green + Canary deployment strategies — /deployment/strategy/* client
// Backend: backend/routes/deployment.js -> backend/services/deploymentStrategyExecutor.cjs
import { _fetch } from "./_client";

export async function listEnvironments() {
  return _fetch("/deployment/strategy/environments");
}

export async function registerEnvironment({ name, composeFile, healthUrl, description } = {}) {
  return _fetch("/deployment/strategy/environments", {
    method: "POST",
    body: JSON.stringify({ name, composeFile, healthUrl, description }),
  });
}

export async function blueGreenDeploy({ composeFile, healthUrl, healthAttempts, healthIntervalMs } = {}) {
  return _fetch("/deployment/strategy/blue-green", {
    method: "POST",
    body: JSON.stringify({ composeFile, healthUrl, healthAttempts, healthIntervalMs }),
    _timeoutMs: 190_000,
  });
}

export async function blueGreenDeployToEnvironment(name, opts = {}) {
  return _fetch(`/deployment/strategy/environments/${encodeURIComponent(name)}/blue-green`, {
    method: "POST",
    body: JSON.stringify(opts),
    _timeoutMs: 190_000,
  });
}

export async function canaryDeploy({ composeFile, service, canaryReplicas, totalReplicas, healthUrl, healthAttempts, healthIntervalMs } = {}) {
  return _fetch("/deployment/strategy/canary", {
    method: "POST",
    body: JSON.stringify({ composeFile, service, canaryReplicas, totalReplicas, healthUrl, healthAttempts, healthIntervalMs }),
    _timeoutMs: 190_000,
  });
}

export async function promoteCanary(runId, opts = {}) {
  return _fetch(`/deployment/strategy/canary/${encodeURIComponent(runId)}/promote`, {
    method: "POST",
    body: JSON.stringify(opts),
    _timeoutMs: 190_000,
  });
}

export async function listStrategyRuns({ limit = 20, type } = {}) {
  const params = new URLSearchParams();
  params.set("limit", limit);
  if (type) params.set("type", type);
  return _fetch(`/deployment/strategy/runs?${params.toString()}`);
}

export async function getStrategyStats() {
  return _fetch("/deployment/strategy/stats");
}
