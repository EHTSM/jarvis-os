/**
 * Phase 22 API client — Security & Operations
 * /p22/secrets/*  — SecretManagement
 * /p22/security/* — SecurityHardening
 * /p22/deploy/*   — DeploymentValidator
 * /p22/alerts/*   — OpsAlerting
 */
import { _fetch } from "./_client";

// ── Secret Management ─────────────────────────────────────────────────
export async function listManagedSecrets(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p22/secrets${q ? "?" + q : ""}`);
}
export async function getSecretHealth() {
  return _fetch("/p22/secrets/health");
}
export async function auditSecrets() {
  return _fetch("/p22/secrets/audit", { method: "POST" });
}

// ── Security Hardening ────────────────────────────────────────────────
export async function getSecurityStatus() {
  return _fetch("/p22/security/status");
}
export async function runSecurityScan() {
  return _fetch("/p22/security/scan", { method: "POST" });
}
export async function getSecurityFindings(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p22/security/findings${q ? "?" + q : ""}`);
}
export async function getSecurityScore() {
  return _fetch("/p22/security/score");
}

// ── Deployment Validator ──────────────────────────────────────────────
export async function validateDeploy(spec) {
  return _fetch("/p22/deploy/validate", {
    method: "POST", body: JSON.stringify(spec),
  });
}
export async function getDeployValidationHistory(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p22/deploy/history${q ? "?" + q : ""}`);
}
export async function getDeployChecklist() {
  return _fetch("/p22/deploy/checklist");
}

// ── Ops Alerting ──────────────────────────────────────────────────────
export async function listOpsAlerts(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p22/alerts${q ? "?" + q : ""}`);
}
export async function getAlertStats() {
  return _fetch("/p22/alerts/stats");
}
export async function acknowledgeAlert(alertId) {
  return _fetch(`/p22/alerts/${alertId}/ack`, { method: "POST" });
}
export async function createAlert(alert) {
  return _fetch("/p22/alerts", {
    method: "POST", body: JSON.stringify(alert),
  });
}
