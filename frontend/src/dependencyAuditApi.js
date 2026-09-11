"use strict";
// V6 Phase 5: Autonomous DevOps — dependency vulnerability scan + safe update
// Backend: backend/routes/dependencyAudit.js -> backend/services/dependencyAuditEngine.cjs
import { _fetch } from "./_client";

export async function scanVulnerabilities() {
  return _fetch("/devops/dependencies/scan", { method: "POST", _timeoutMs: 70_000 });
}

export async function getLastScan() {
  return _fetch("/devops/dependencies/scan/last");
}

export async function listScans(limit = 20) {
  return _fetch(`/devops/dependencies/scans?limit=${limit}`);
}

export async function listOutdated() {
  return _fetch("/devops/dependencies/outdated");
}

export async function applySafeUpdate(packageName, { runRegression = true } = {}) {
  return _fetch("/devops/dependencies/update", {
    method: "POST",
    body: JSON.stringify({ packageName, runRegression }),
    _timeoutMs: 310_000,
  });
}

export async function listUpdates(limit = 50) {
  return _fetch(`/devops/dependencies/updates?limit=${limit}`);
}

export async function getStats() {
  return _fetch("/devops/dependencies/stats");
}
