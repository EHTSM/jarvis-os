// Phase 191: Public-beta installer health — runs once per session at startup.
// Validates environment, missing deps, corrupted cache, reinstall preservation.
// All checks are client-side only — no external calls.

const INSTALL_KEY   = "jarvis_install_state";
const INSTALL_TTL   = 24 * 60 * 60 * 1000; // recheck daily

// Required localStorage keys that must survive reinstall
const PRESERVED_KEYS = [
  "jarvis_workflow_macros",
  "jarvis_workflow_hist",
  "jarvis_operator_workspace",
  "jarvis_productivity_analytics",
];

// Phase 191: detect environment gaps
function _checkEnvironment() {
  const issues = [];
  if (typeof localStorage === "undefined") issues.push("localStorage unavailable");
  if (typeof fetch === "undefined")        issues.push("fetch API unavailable");
  if (typeof EventSource === "undefined")  issues.push("EventSource (SSE) unavailable — live stream will not work");
  if (!navigator.onLine)                   issues.push("Device appears offline at launch");
  return issues;
}

// Phase 191: validate reinstall preservation — which keys survived
function _checkPreservation() {
  const found = [];
  const missing = [];
  for (const k of PRESERVED_KEYS) {
    if (localStorage.getItem(k)) found.push(k);
    else missing.push(k);
  }
  return { found, missing };
}

// Phase 191: detect interrupted install (partial state)
function _checkPartialState() {
  const raw = localStorage.getItem(INSTALL_KEY);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw);
    // If a previous run marked itself as "installing" and never cleared — interrupted
    if (state.status === "installing" && Date.now() - state.ts > 60000) {
      return { interrupted: true, since: state.ts };
    }
    return null;
  } catch { return null; }
}

// Phase 191: mark install as in-progress (call early in app boot)
export function markInstallStart() {
  try { localStorage.setItem(INSTALL_KEY, JSON.stringify({ status: "installing", ts: Date.now() })); } catch {}
}

// Phase 191: mark install as complete (call after first successful render)
export function markInstallComplete() {
  try { localStorage.setItem(INSTALL_KEY, JSON.stringify({ status: "ok", ts: Date.now() })); } catch {}
}

// Phase 230: artifact integrity — verify critical browser APIs and build marker loaded
function _checkArtifactIntegrity() {
  const missing = [];
  // These must exist for the app to function at all
  if (typeof Promise === "undefined")       missing.push("Promise");
  if (typeof AbortController === "undefined") missing.push("AbortController");
  if (typeof MutationObserver === "undefined") missing.push("MutationObserver");
  if (typeof crypto?.randomUUID === "undefined" && typeof crypto?.getRandomValues === "undefined")
    missing.push("crypto");
  // Build marker — injected by the build pipeline as a meta tag
  const buildMeta = typeof document !== "undefined"
    ? document.querySelector('meta[name="jarvis-build-id"]')
    : null;
  const buildId = buildMeta?.content || null;
  return { missing, buildId, ok: missing.length === 0 };
}

// Phase 191: full installer health check — returns a structured report
export function runInstallerHealthCheck() {
  const envIssues    = _checkEnvironment();
  const preservation = _checkPreservation();
  const interrupted  = _checkPartialState();
  const artifact     = _checkArtifactIntegrity(); // Phase 230

  const ok = envIssues.length === 0 && !interrupted && artifact.ok;
  if (!artifact.ok) {
    artifact.missing.forEach(m => envIssues.push(`Missing browser API: ${m}`));
  }
  const report = {
    ts:           Date.now(),
    ok,
    envIssues,
    preservation,
    interrupted,
    artifact,                                         // Phase 230
    reinstall:    preservation.found.length > 0 && preservation.missing.length > 0,
    freshInstall: preservation.found.length === 0,
  };

  // Log to friction signals
  try {
    const FRICTION_KEY = "jarvis_friction_signals";
    const log = JSON.parse(localStorage.getItem(FRICTION_KEY) || "[]");
    if (!ok || report.reinstall) {
      log.unshift({ type: "installer_health", ts: Date.now(), ok, envIssues, interrupted: !!interrupted, reinstall: report.reinstall });
      localStorage.setItem(FRICTION_KEY, JSON.stringify(log.slice(0, 200)));
    }
  } catch {}

  return report;
}

// Phase 191: React hook — runs check once per session, returns report
import { useState, useEffect } from "react";
export function useInstallerHealth() {
  const [report, setReport] = useState(null);
  useEffect(() => {
    const r = runInstallerHealthCheck();
    setReport(r);
    markInstallComplete();
  }, []);
  return report;
}
