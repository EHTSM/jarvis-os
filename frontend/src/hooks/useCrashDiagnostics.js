// Phase 888: Crash reporting + diagnostics.
// Captures runtime failure snapshots, replay-linked crash summaries,
// deployment-failure diagnostics, workflow interruption reports.
//
// Privacy-safe: no user data, only command outcomes + error patterns.
// Bounded: max 50 crash records, 30 diagnostics, 24h TTL.
// No external calls. No autonomous execution.

import { useState, useEffect, useCallback, useMemo } from "react";

const CRASH_KEY   = "jarvis_crash_log";
const DIAG_KEY    = "jarvis_diagnostics";
const CRASH_MAX   = 50;
const DIAG_MAX    = 30;
const CRASH_TTL   = 24 * 60 * 60 * 1000;
const RETAIN_TTL  = 7  * 24 * 60 * 60 * 1000; // keep crashes 7 days for support export

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function _loadCrashes() {
  return _load(CRASH_KEY, []).filter(c => Date.now() - (c.ts || 0) < RETAIN_TTL);
}
function _loadDiags() {
  return _load(DIAG_KEY, []).filter(d => Date.now() - (d.ts || 0) < CRASH_TTL);
}

// ── Crash severity classifier ─────────────────────────────────────────────────

function _classifyCrash(type, context) {
  if (type === "process_crash" || type === "oom")      return "critical";
  if (type === "deploy_failure")                        return "high";
  if (type === "workflow_interrupted")                  return "medium";
  if (type === "reconnect_storm")                       return "medium";
  if (type === "dep_missing" || type === "exec_error")  return "low";
  return "low";
}

// ── Diagnostic builder ────────────────────────────────────────────────────────
// Analyzes crash log to produce operator-visible diagnostics.

function _buildDiagnostics(crashes) {
  const now  = Date.now();
  const recent24h = crashes.filter(c => now - (c.ts || 0) < CRASH_TTL);
  const diags = [];

  // Group by type
  const byType = {};
  recent24h.forEach(c => {
    byType[c.type] = (byType[c.type] || 0) + 1;
  });

  // Process crash pattern
  const processCrashes = byType["process_crash"] || 0;
  if (processCrashes > 0) {
    diags.push({
      id:       "process_crash_pattern",
      severity: "critical",
      title:    `${processCrashes} process crash(es) in last 24h`,
      detail:   "Check pm2 logs for stack traces. Likely causes: uncaught exception, OOM, or SIGTERM.",
      suggestedCmd: "pm2 logs --lines 50",
      ts:       now,
    });
  }

  // Deploy failure pattern
  const deployFails = recent24h.filter(c => c.type === "deploy_failure");
  if (deployFails.length > 0) {
    const lastFail = deployFails[0];
    diags.push({
      id:       "deploy_failure_pattern",
      severity: "high",
      title:    `${deployFails.length} deploy failure(s) in last 24h`,
      detail:   lastFail.summary || "Check build output and environment variables.",
      suggestedCmd: "pm2 restart all && pm2 status",
      ts:       now,
    });
  }

  // Reconnect storm
  const reconnects = byType["reconnect_storm"] || 0;
  if (reconnects >= 2) {
    diags.push({
      id:       "reconnect_storm_diag",
      severity: "medium",
      title:    `${reconnects} reconnect storms recorded`,
      detail:   "Network instability or SSE handler leak. Check browser console for WebSocket/EventSource errors.",
      suggestedCmd: null,
      ts:       now,
    });
  }

  // Workflow interruption
  const interrupted = byType["workflow_interrupted"] || 0;
  if (interrupted >= 2) {
    diags.push({
      id:       "workflow_interruption_pattern",
      severity: "medium",
      title:    `${interrupted} workflow interruptions`,
      detail:   "Frequent interruptions may indicate session instability. Review workflow step timeouts.",
      suggestedCmd: null,
      ts:       now,
    });
  }

  // OOM
  const oom = byType["oom"] || 0;
  if (oom > 0) {
    diags.push({
      id:       "oom_pattern",
      severity: "critical",
      title:    `${oom} out-of-memory event(s)`,
      detail:   "Heap exhaustion detected. Run: node --max-old-space-size check or pm2 info to see memory.",
      suggestedCmd: "pm2 info",
      ts:       now,
    });
  }

  return diags.slice(0, DIAG_MAX);
}

// ── Replay-linked summary ─────────────────────────────────────────────────────
// Links crashes to replay context (last command, workflow state).

function _buildReplaySummary(crashes) {
  const recent = crashes
    .filter(c => c.replayContext)
    .slice(0, 5);

  return recent.map(c => ({
    ts:          c.ts,
    type:        c.type,
    severity:    _classifyCrash(c.type, c),
    lastCmd:     c.replayContext?.lastCmd || null,
    workflowId:  c.replayContext?.workflowId || null,
    summary:     c.summary || c.type,
  }));
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useCrashDiagnostics() {
  const [crashes,      setCrashes]      = useState([]);
  const [diagnostics,  setDiagnostics]  = useState([]);
  const [replaySummary, setReplaySummary] = useState([]);

  const _refresh = useCallback(() => {
    const c = _loadCrashes();
    const d = _buildDiagnostics(c);
    const r = _buildReplaySummary(c);
    setCrashes(c);
    setDiagnostics(d);
    setReplaySummary(r);
    _save(DIAG_KEY, d);
  }, []);

  useEffect(() => { _refresh(); }, [_refresh]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") _refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [_refresh]);

  // Record a crash event (called by other hooks / error boundaries)
  const recordCrash = useCallback((type, { summary = "", replayContext = null, meta = {} } = {}) => {
    const entry = {
      id:            `crash_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type,
      severity:      _classifyCrash(type),
      summary,
      replayContext,
      meta,
      ts:            Date.now(),
    };
    setCrashes(prev => {
      const next = [entry, ...prev].slice(0, CRASH_MAX);
      _save(CRASH_KEY, next);
      return next;
    });
    // Rebuild diagnostics immediately
    _refresh();
  }, [_refresh]);

  // Dismiss a diagnostic (suppresses it for the session)
  const [dismissed, setDismissed] = useState(new Set());
  const dismissDiag = useCallback((id) => {
    setDismissed(prev => new Set([...prev, id]));
  }, []);

  // Visible diagnostics (not dismissed, sorted by severity)
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  const visibleDiagnostics = useMemo(() =>
    diagnostics
      .filter(d => !dismissed.has(d.id))
      .sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9)),
    [diagnostics, dismissed]
  );

  // Top crash for operator status bar
  const topCrash = useMemo(() =>
    crashes.find(c => _classifyCrash(c.type) === "critical") ||
    crashes.find(c => _classifyCrash(c.type) === "high") ||
    crashes[0] || null,
    [crashes]
  );

  // Health summary
  const crashSummary = useMemo(() => {
    const now = Date.now();
    const last24h = crashes.filter(c => now - (c.ts || 0) < CRASH_TTL);
    const critical = last24h.filter(c => _classifyCrash(c.type) === "critical").length;
    const high     = last24h.filter(c => _classifyCrash(c.type) === "high").length;
    const label    = critical > 0 ? "CRITICAL" : high > 0 ? "DEGRADED" : last24h.length > 0 ? "ISSUES" : "CLEAN";
    const color    = critical > 0 ? "var(--op-red)" : high > 0 ? "var(--op-amber)" : "var(--op-green)";
    return { total: last24h.length, critical, high, label, color };
  }, [crashes]);

  // Export crash log for support (privacy-safe: no raw output, only patterns)
  const exportForSupport = useCallback(() => {
    const safe = crashes.slice(0, 20).map(c => ({
      ts:       c.ts,
      type:     c.type,
      severity: c.severity,
      summary:  (c.summary || "").slice(0, 200),
      hasReplayContext: !!c.replayContext,
    }));
    return JSON.stringify({ exportedAt: Date.now(), version: "1", crashes: safe }, null, 2);
  }, [crashes]);

  // Clear all (operator-triggered)
  const clearAll = useCallback(() => {
    try { localStorage.removeItem(CRASH_KEY); localStorage.removeItem(DIAG_KEY); } catch {}
    setCrashes([]);
    setDiagnostics([]);
    setReplaySummary([]);
  }, []);

  return {
    crashes,
    diagnostics:       visibleDiagnostics,
    replaySummary,
    topCrash,
    crashSummary,
    // Actions
    recordCrash,
    dismissDiag,
    exportForSupport,
    clearAll,
    refresh: _refresh,
  };
}
