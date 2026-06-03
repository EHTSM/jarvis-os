// Phase 919-921: Beta environment validation + closed-beta diagnostics pipeline + release recovery.
// Dependency validation, runtime compatibility, replay-linked crash diagnostics,
// workflow interruption tracking, rollback survivability, update interruption recovery.
//
// Consolidates Phase 919 env checks, Phase 920 diagnostic pipeline, Phase 921 release recovery
// into one bounded surface to avoid hook sprawl.
//
// All state: localStorage-only. No external calls. No autonomous execution.
// Bounded: 30 diagnostic records, 15 recovery records, 24h retention.

import { useState, useEffect, useCallback, useMemo } from "react";

const BD_KEY       = "jarvis_beta_diagnostics";
const BD_REC_KEY   = "jarvis_beta_recovery";
const BD_TTL       = 24 * 60 * 60 * 1000;
const DIAG_MAX     = 30;
const REC_MAX      = 15;

// ── Phase 919: Beta environment validation ────────────────────────────────────

function _validateBetaEnvironment() {
  const checks = [];

  // 1. Runtime prerequisite: localStorage functional
  try {
    localStorage.setItem("__jarvis_betacheck__", "1");
    localStorage.removeItem("__jarvis_betacheck__");
    checks.push({ id: "storage", ok: true, severity: "critical", label: "localStorage" });
  } catch {
    checks.push({ id: "storage", ok: false, severity: "critical", label: "localStorage", fix: "Enable storage in browser settings" });
  }

  // 2. EventSource (SSE)
  checks.push({
    id: "sse", ok: !!window.EventSource, severity: "high", label: "SSE (EventSource)",
    fix: window.EventSource ? null : "Use Chrome 90+ or Firefox 90+",
  });

  // 3. Build ID present (indicates proper deploy)
  const buildId = document.querySelector('meta[name="jarvis-build-id"]')?.content;
  checks.push({ id: "build_id", ok: !!buildId, severity: "low", label: "Build ID", detail: buildId || "missing" });

  // 4. Replay compatibility: health snapshot within 6h
  const snap = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_health_snapshot") || "null"); } catch { return null; }
  })();
  const replayOk = snap && (Date.now() - (snap.ts || 0)) < 6 * 3600000;
  checks.push({
    id: "replay_compat", ok: replayOk, severity: "medium", label: "Replay snapshot",
    detail: snap ? `${Math.round((Date.now() - snap.ts) / 60000)}m old` : "absent",
    fix: replayOk ? null : "Snapshot will refresh on next operation",
  });

  // 5. Channel meta
  const channel = document.querySelector('meta[name="jarvis-channel"]')?.content || localStorage.getItem("jarvis_release_channel") || "beta";
  checks.push({ id: "channel", ok: true, severity: "low", label: "Release channel", detail: channel });

  return checks;
}

// ── Phase 920: Diagnostic pipeline ───────────────────────────────────────────

function _buildDiagnosticPipeline(crashLog = [], hist = [], friction = []) {
  const now    = Date.now();
  const WINDOW = BD_TTL;
  const diags  = [];

  // Replay-linked crash diagnostics
  const replayCrashes = crashLog.filter(c => c.replayContext && now - (c.ts || 0) < WINDOW);
  if (replayCrashes.length > 0) {
    diags.push({
      id:       "replay_crash_link",
      category: "replay",
      severity: replayCrashes.length >= 2 ? "high" : "medium",
      title:    `${replayCrashes.length} crash(es) with replay context`,
      detail:   "Crashes occurred during or after replay restoration — possible state corruption",
      action:   "Clear health snapshot and reload to reset replay context",
    });
  }

  // Deployment failure aggregation
  const depFails = hist.filter(h => !h.ok && /deploy|pm2 start/i.test(h.cmd || "") && now - (h.ts || 0) < WINDOW);
  if (depFails.length >= 2) {
    diags.push({
      id:       "deploy_failure_agg",
      category: "deployment",
      severity: "high",
      title:    `${depFails.length} deployment failure(s) in 24h`,
      detail:   "Repeated deployment failures — check environment and service logs",
      action:   "pm2 logs --lines 50",
    });
  }

  // Workflow interruption tracking
  const interrupted = friction.filter(f => f.type === "workflow_interrupted" && now - (f.ts || 0) < WINDOW).length;
  if (interrupted >= 2) {
    diags.push({
      id:       "workflow_interruptions",
      category: "workflow",
      severity: "medium",
      title:    `${interrupted} workflow interruption(s) in 24h`,
      detail:   "Workflows are not completing — check for reconnect storms or timeout issues",
      action:   null,
    });
  }

  // Debug session telemetry: sessions without resolution
  const unresolved = friction.filter(f =>
    f.type === "debug_session_started" &&
    !friction.some(f2 => f2.type === "debug_session_resolved" && f2.ts > f.ts) &&
    now - (f.ts || 0) < WINDOW
  ).length;
  if (unresolved >= 2) {
    diags.push({
      id:       "unresolved_debug_sessions",
      category: "debugging",
      severity: "medium",
      title:    `${unresolved} unresolved debug session(s)`,
      detail:   "Debug sessions started but not resolved — possible dead-ends",
      action:   "Follow the Debug Sequence panel for guided resolution",
    });
  }

  return diags.slice(0, DIAG_MAX);
}

// ── Phase 921: Release recovery ───────────────────────────────────────────────

function _assessReleaseRecovery(updateState) {
  const rec = { rollbackReady: false, reason: "No update state found", label: "UNKNOWN", color: "var(--op-text2)" };
  if (!updateState) return rec;

  if (updateState.status === "quarantined") {
    return { rollbackReady: true, reason: "Update quarantined — rollback available", label: "QUARANTINED", color: "var(--op-red)" };
  }
  if (updateState.status === "rolled_back") {
    return { rollbackReady: false, reason: "Already on rollback version", label: "ROLLED BACK", color: "var(--op-amber)" };
  }
  if (updateState.status === "updating" && Date.now() - (updateState.ts || 0) > 10 * 60 * 1000) {
    return { rollbackReady: true, reason: "Update stuck — rollback available", label: "STUCK UPDATE", color: "var(--op-red)" };
  }
  if (updateState.status === "ok") {
    return { rollbackReady: false, reason: "Update complete", label: "CURRENT", color: "var(--op-green)" };
  }
  return { rollbackReady: false, reason: updateState.status, label: "UNKNOWN", color: "var(--op-text2)" };
}

function _buildRecoveryActions(diags) {
  // Map high-severity diagnostics to recovery actions
  return diags
    .filter(d => d.severity === "high" && d.action)
    .slice(0, 5)
    .map(d => ({ diagId: d.id, category: d.category, action: d.action, ts: Date.now() }));
}

// ── Dedup guard ───────────────────────────────────────────────────────────────

function _checkDedup(recoveryLog, actionId) {
  const DEDUP_WINDOW = 5 * 60 * 1000;
  const now = Date.now();
  return recoveryLog.some(r => r.actionId === actionId && now - (r.ts || 0) < DEDUP_WINDOW);
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function _loadDiagCache() {
  const raw = _load(BD_KEY, null);
  if (!raw || Date.now() - (raw.ts || 0) > BD_TTL) return null;
  return raw;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useBetaDiagnostics() {
  const [envChecks,     setEnvChecks]     = useState([]);
  const [diagnostics,   setDiagnostics]   = useState([]);
  const [recoveryActions, setRecoveryActions] = useState([]);
  const [releaseRecovery, setReleaseRecovery] = useState(null);
  const [recoveryLog,   setRecoveryLog]   = useState([]);
  const [initialized,   setInitialized]   = useState(false);

  const analyze = useCallback(() => {
    const checks      = _validateBetaEnvironment();
    const crashLog    = _load("jarvis_crash_log", []);
    const hist        = _load("jarvis_workflow_hist", []);
    const friction    = _load("jarvis_friction_signals", []);
    const updateState = _load("jarvis_update_state", null);

    const diags    = _buildDiagnosticPipeline(crashLog, hist, friction);
    const recovery = _assessReleaseRecovery(updateState);
    const actions  = _buildRecoveryActions(diags);

    setEnvChecks(checks);
    setDiagnostics(diags);
    setReleaseRecovery(recovery);
    setRecoveryActions(actions);

    _save(BD_KEY, { envChecks: checks, diagnostics: diags, releaseRecovery: recovery, ts: Date.now() });
  }, []);

  useEffect(() => {
    const cached = _loadDiagCache();
    if (cached) {
      setEnvChecks(cached.envChecks || []);
      setDiagnostics(cached.diagnostics || []);
      setReleaseRecovery(cached.releaseRecovery || null);
    }
    setRecoveryLog(_load(BD_REC_KEY, []).slice(0, REC_MAX));
    analyze();
    setInitialized(true);
  }, [analyze]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") analyze(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [analyze]);

  // Record a recovery action (with dedup guard)
  const recordRecovery = useCallback((actionId, meta = {}) => {
    if (_checkDedup(recoveryLog, actionId)) return false;
    const entry = { actionId, ts: Date.now(), ...meta };
    setRecoveryLog(prev => {
      const next = [entry, ...prev].slice(0, REC_MAX);
      _save(BD_REC_KEY, next);
      return next;
    });
    return true;
  }, [recoveryLog]);

  // Environment health summary
  const envHealth = useMemo(() => {
    const critical = envChecks.filter(c => !c.ok && c.severity === "critical").length;
    const high     = envChecks.filter(c => !c.ok && c.severity === "high").length;
    const label    = critical > 0 ? "CRITICAL" : high > 0 ? "DEGRADED" : "VALID";
    const color    = critical > 0 ? "var(--op-red)" : high > 0 ? "var(--op-amber)" : "var(--op-green)";
    return { valid: critical === 0 && high === 0, critical, high, label, color };
  }, [envChecks]);

  // Top diagnostic for operator bar
  const topDiagnostic = useMemo(() =>
    diagnostics.find(d => d.severity === "high") || diagnostics[0] || null,
    [diagnostics]
  );

  return {
    initialized,
    envChecks,
    envHealth,
    diagnostics,
    topDiagnostic,
    recoveryActions,
    releaseRecovery,
    recoveryLog,
    recordRecovery,
    analyze,
  };
}
