/**
 * Phase 25 API client — Deployment & Observability
 * /p25/deploy/*  — DeploymentAutopilot
 * /p25/secrets/* — SecretRotationAutomation
 * /p25/obs/*     — EnterpriseObservability
 * /p25/search/*  — LargeContextCodeSearch
 */
import { _fetch } from "./_client";

// ── 25A Deployment Autopilot ──────────────────────────────────────────
export async function listDeployments(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p25/deploy${q ? "?" + q : ""}`);
}
export async function getDeployment(deployId) {
  return _fetch(`/p25/deploy/${deployId}`);
}
export async function getDeployHistory(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p25/deploy/history${q ? "?" + q : ""}`);
}
export async function startCanary(spec) {
  return _fetch("/p25/deploy/canary", {
    method: "POST", body: JSON.stringify(spec),
  });
}
export async function promoteCanary(deployId) {
  return _fetch(`/p25/deploy/canary/${deployId}/promote`, { method: "POST" });
}
export async function startBlueGreen(spec) {
  return _fetch("/p25/deploy/bluegreen", {
    method: "POST", body: JSON.stringify(spec),
  });
}
export async function switchBlueGreen(deployId) {
  return _fetch(`/p25/deploy/bluegreen/${deployId}/switch`, { method: "POST" });
}
export async function rollbackDeploy(deployId, opts = {}) {
  return _fetch(`/p25/deploy/${deployId}/rollback`, {
    method: "POST", body: JSON.stringify(opts),
  });
}
export async function runDeployPipeline(spec) {
  return _fetch("/p25/deploy/pipeline", {
    method: "POST", body: JSON.stringify(spec),
  });
}
export async function validateRelease(spec) {
  return _fetch("/p25/deploy/validate", {
    method: "POST", body: JSON.stringify(spec),
  });
}

// ── 25B Secret Rotation Automation ───────────────────────────────────
export async function listSecrets(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p25/secrets${q ? "?" + q : ""}`);
}
export async function rotateSecret(secretId, opts = {}) {
  return _fetch(`/p25/secrets/${encodeURIComponent(secretId)}/rotate`, {
    method: "POST", body: JSON.stringify(opts),
  });
}
export async function getSecretStatus(secretId) {
  return _fetch(`/p25/secrets/${encodeURIComponent(secretId)}/status`);
}

// ── 25C Enterprise Observability ──────────────────────────────────────
export async function getSystemMetrics(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p25/obs/metrics${q ? "?" + q : ""}`);
}
export async function listTraces(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p25/obs/traces${q ? "?" + q : ""}`);
}
export async function getTrace(traceId) {
  return _fetch(`/p25/obs/traces/${traceId}`);
}
export async function getServiceMap() {
  return _fetch("/p25/obs/servicemap");
}
export async function listAlerts(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p25/obs/alerts${q ? "?" + q : ""}`);
}
export async function resolveAlert(alertId) {
  return _fetch(`/p25/obs/alerts/${alertId}/resolve`, { method: "POST" });
}
export async function setAlertRule(rule) {
  return _fetch("/p25/obs/alerts/rules", {
    method: "POST", body: JSON.stringify(rule),
  });
}
export async function listAlertRules() {
  return _fetch("/p25/obs/alerts/rules");
}
export async function listSLOs() {
  return _fetch("/p25/obs/slos");
}
export async function getSLOStatus(sloId) {
  return _fetch(`/p25/obs/slos/${sloId}`);
}
export async function setSLO(spec) {
  return _fetch("/p25/obs/slos", {
    method: "POST", body: JSON.stringify(spec),
  });
}
export async function recordMetric(name, value, tags = {}) {
  return _fetch("/p25/obs/metrics", {
    method: "POST", body: JSON.stringify({ name, value, tags }),
  });
}

// ── 25D Large Context Code Search ────────────────────────────────────
export async function codeSearch(query, params = {}) {
  return _fetch("/p25/search", {
    method: "POST", body: JSON.stringify({ query, ...params }),
  });
}
export async function findRelated(symbol, params = {}) {
  return _fetch("/p25/search/related", {
    method: "POST", body: JSON.stringify({ symbol, ...params }),
  });
}
export async function extractContext(files, params = {}) {
  return _fetch("/p25/search/context", {
    method: "POST", body: JSON.stringify({ files, ...params }),
  });
}
export async function getSearchRepoStats(repoPath) {
  const q = repoPath ? `?repoPath=${encodeURIComponent(repoPath)}` : "";
  return _fetch(`/p25/search/stats${q}`);
}
