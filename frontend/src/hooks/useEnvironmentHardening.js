// Phase 892: Installer + environment hardening.
// Dependency verification, environment validation, runtime prerequisite checks,
// workspace integrity validation, reconnect-safe initialization.
//
// All checks: localStorage + DOM inspection only.
// No external calls. No autonomous execution. No shell commands.

import { useState, useEffect, useCallback, useMemo } from "react";

const ENV_KEY       = "jarvis_env_validation";
const INSTALL_KEY   = "jarvis_install_state";
const ENV_TTL       = 60 * 60 * 1000; // re-validate after 1h
const INSTALL_TTL   = 24 * 60 * 60 * 1000;

// ── Environment checks ────────────────────────────────────────────────────────
// Each check returns { id, label, ok, severity, detail, suggestedFix? }

function _checkLocalStorage() {
  try {
    const testKey = "__jarvis_ls_test__";
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
    return { id: "local_storage", label: "localStorage", ok: true, severity: "critical", detail: "Available" };
  } catch {
    return { id: "local_storage", label: "localStorage", ok: false, severity: "critical",
      detail: "localStorage unavailable — Ooplix cannot persist state",
      suggestedFix: "Check browser privacy settings or enable cookies/storage" };
  }
}

function _checkBrowserAPIs() {
  const issues = [];
  if (!window.EventSource) issues.push("EventSource (SSE) not supported");
  if (!window.JSON)         issues.push("JSON not available");
  if (!window.crypto)       issues.push("crypto API unavailable");
  return {
    id:          "browser_apis",
    label:       "Browser APIs",
    ok:          issues.length === 0,
    severity:    "high",
    detail:      issues.length === 0 ? "All required APIs present" : issues.join("; "),
    suggestedFix: issues.length > 0 ? "Use a modern browser (Chrome 90+, Firefox 90+, Safari 14+)" : null,
  };
}

function _checkStorageQuota() {
  // Estimate used storage — heuristic only
  try {
    let usedBytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || "";
      const v = localStorage.getItem(k) || "";
      usedBytes += k.length + v.length;
    }
    const usedKB   = Math.round(usedBytes / 1024);
    const WARN_KB  = 4000; // 4MB warning threshold (typical 5MB quota)
    const ok       = usedKB < WARN_KB;
    return {
      id:          "storage_quota",
      label:       "Storage quota",
      ok,
      severity:    "medium",
      detail:      `~${usedKB} KB used`,
      suggestedFix: ok ? null : "Clear old Ooplix data — localStorage approaching quota",
    };
  } catch {
    return { id: "storage_quota", label: "Storage quota", ok: true, severity: "medium", detail: "Unknown" };
  }
}

function _checkJarvisKeys() {
  const REQUIRED = ["jarvis_workflow_hist", "jarvis_friction_signals"];
  const missing  = [];
  const corrupted = [];

  REQUIRED.forEach(k => {
    const v = localStorage.getItem(k);
    if (!v) { missing.push(k); return; }
    try { JSON.parse(v); }
    catch { corrupted.push(k); }
  });

  const ok = missing.length === 0 && corrupted.length === 0;
  const detail = ok
    ? "Required keys present and valid"
    : [
        missing.length   > 0 ? `Missing: ${missing.join(", ")}` : null,
        corrupted.length > 0 ? `Corrupted: ${corrupted.join(", ")}` : null,
      ].filter(Boolean).join(" | ");

  return {
    id:          "jarvis_keys",
    label:       "Ooplix state keys",
    ok,
    severity:    "medium",
    detail,
    suggestedFix: ok ? null : "Refresh the page — Ooplix will re-initialize missing keys",
  };
}

function _checkConnectivity() {
  const online = navigator.onLine !== false;
  return {
    id:          "connectivity",
    label:       "Network connectivity",
    ok:          online,
    severity:    "medium",
    detail:      online ? "Online" : "Offline — some features unavailable",
    suggestedFix: online ? null : "Check network connection",
  };
}

function _checkMetaTag() {
  const meta = document.querySelector('meta[name="jarvis-build-id"]');
  const buildId = meta?.content || null;
  return {
    id:       "build_id",
    label:    "Build ID",
    ok:       true,
    severity: "low",
    detail:   buildId ? `Build: ${buildId}` : "No build ID meta tag (dev mode)",
    suggestedFix: null,
  };
}

// ── Run all checks ────────────────────────────────────────────────────────────

function _runAllChecks() {
  return [
    _checkLocalStorage(),
    _checkBrowserAPIs(),
    _checkStorageQuota(),
    _checkJarvisKeys(),
    _checkConnectivity(),
    _checkMetaTag(),
  ];
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function _loadCachedValidation() {
  const raw = _load(ENV_KEY, null);
  if (!raw || Date.now() - (raw.ts || 0) > ENV_TTL) return null;
  return raw;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useEnvironmentHardening() {
  const [checks,      setChecks]      = useState([]);
  const [installState, setInstallState] = useState(null);
  const [initialized,  setInitialized]  = useState(false);

  const runValidation = useCallback(() => {
    const results = _runAllChecks();
    _save(ENV_KEY, { results, ts: Date.now() });
    setChecks(results);
    return results;
  }, []);

  useEffect(() => {
    // Use cache if fresh, else re-run
    const cached = _loadCachedValidation();
    if (cached) {
      setChecks(cached.results || []);
    } else {
      runValidation();
    }
    // Load install state
    const is = _load(INSTALL_KEY, null);
    if (is && Date.now() - (is.ts || 0) < INSTALL_TTL) setInstallState(is);
    setInitialized(true);
  }, [runValidation]);

  // Re-validate on visibility restore
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") runValidation(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [runValidation]);

  // Environmental health summary
  const envHealth = useMemo(() => {
    const critical = checks.filter(c => !c.ok && c.severity === "critical");
    const high     = checks.filter(c => !c.ok && c.severity === "high");
    const medium   = checks.filter(c => !c.ok && c.severity === "medium");
    const allOk    = critical.length === 0 && high.length === 0;
    const label    = critical.length > 0 ? "CRITICAL" : high.length > 0 ? "DEGRADED" : medium.length > 0 ? "WARN" : "HEALTHY";
    const color    = critical.length > 0 ? "var(--op-red)" : high.length > 0 ? "var(--op-amber)" : medium.length > 0 ? "var(--op-amber)" : "var(--op-green)";
    return { allOk, critical, high, medium, label, color, checkCount: checks.length };
  }, [checks]);

  // Record install state (called during first-time setup or reinstall)
  const recordInstall = useCallback((meta = {}) => {
    const state = { ...meta, ts: Date.now(), validated: true };
    setInstallState(state);
    _save(INSTALL_KEY, state);
  }, []);

  return {
    initialized,
    checks,
    envHealth,
    installState,
    // Actions
    runValidation,
    recordInstall,
  };
}
