// Phase 891: Support workflow foundation.
// Replay-linked issue summaries, debugging-session export, deployment diagnostics
// sharing, workflow-state snapshots, recovery-history reporting.
//
// Privacy contract: no raw command output, no user content, patterns only.
// Bounded: max 10 exports, 5 debug sessions, 30-day retention.
// No external calls. No autonomous execution. Operator-visible sharing controls.

import { useState, useEffect, useCallback, useMemo } from "react";

const SUPPORT_KEY  = "jarvis_support_session_id";
const EXPORT_KEY   = "jarvis_support_exports";
const EXPORT_MAX   = 10;
const SESSION_MAX  = 5;
const EXPORT_TTL   = 30 * 24 * 60 * 60 * 1000;

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function _loadExports() {
  return _load(EXPORT_KEY, []).filter(e => Date.now() - (e.exportedAt || 0) < EXPORT_TTL);
}

// ── Support session ID ────────────────────────────────────────────────────────

function _getOrCreateSessionId() {
  try {
    let id = localStorage.getItem(SUPPORT_KEY);
    if (!id) {
      id = `j-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      localStorage.setItem(SUPPORT_KEY, id);
    }
    return id;
  } catch { return `j-${Date.now().toString(36)}`; }
}

// ── Issue summary builder ─────────────────────────────────────────────────────
// Builds a privacy-safe issue summary from workflow history + crash log.

function _buildIssueSummary({ hist = [], crashes = [], friction = [] } = {}) {
  const now     = Date.now();
  const last24h = hist.filter(h => now - (h.ts || 0) < 24 * 3600000);
  const failed  = last24h.filter(h => !h.ok);
  const recentCrashes = crashes.filter(c => now - (c.ts || 0) < 24 * 3600000);

  // Pattern aggregation — no raw output
  const failTypes = {};
  failed.forEach(h => {
    const key = (h.errorClass || h.cmd || "unknown").slice(0, 40);
    failTypes[key] = (failTypes[key] || 0) + 1;
  });
  const topFailPatterns = Object.entries(failTypes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pattern, count]) => ({ pattern, count }));

  const reconnects = friction.filter(f =>
    f.type === "reconnect_event" && now - (f.ts || 0) < 24 * 3600000
  ).length;

  return {
    generatedAt:      now,
    period:           "24h",
    totalCommands:    last24h.length,
    failedCommands:   failed.length,
    failRate:         last24h.length > 0 ? Math.round((failed.length / last24h.length) * 100) : 0,
    topFailPatterns,
    crashCount:       recentCrashes.length,
    criticalCrashes:  recentCrashes.filter(c => c.severity === "critical").length,
    reconnects,
  };
}

// ── Debug session export ──────────────────────────────────────────────────────
// Exports a debugging session summary — no raw output, only patterns and outcomes.

function _buildDebugSessionExport({ rootCauses = [], recoveryPaths = [], sessionId = null } = {}) {
  return {
    exportedAt:    Date.now(),
    sessionId,
    version:       "1",
    rootCauses:    rootCauses.slice(0, 5).map(r => ({
      id:        r.id,
      type:      r.type,
      severity:  r.severity,
      // no raw output
    })),
    recoveryPaths: recoveryPaths.slice(0, 5).map(p => ({
      id:         p.id,
      cmd:        (p.cmd || "").slice(0, 80),
      confidence: p.confidence,
      boosted:    p.boosted || false,
    })),
  };
}

// ── Deployment diagnostics ────────────────────────────────────────────────────

function _buildDeployDiagnosticsExport({ deployHistory = [], trustScore = null, failRate = null } = {}) {
  const recent = deployHistory.slice(0, 10);
  const failed = recent.filter(d => !d.ok || d.status === "failed");
  return {
    exportedAt:     Date.now(),
    version:        "1",
    recentDeploys:  recent.length,
    failedDeploys:  failed.length,
    deploySuccessRate: recent.length > 0 ? Math.round(((recent.length - failed.length) / recent.length) * 100) : null,
    trustScore,
    recentFailRate: failRate,
    lastDeploy:     recent[0] ? { ts: recent[0].ts, ok: recent[0].ok } : null,
  };
}

// ── Recovery history ──────────────────────────────────────────────────────────

function _buildRecoveryHistory(hist = []) {
  const now = Date.now();
  return hist
    .filter(h => h.ok && now - (h.ts || 0) < 7 * 24 * 3600000)
    .filter(h => /pm2 restart|npm install|git reset|rollback|restore/i.test(h.cmd || ""))
    .slice(0, 10)
    .map(h => ({
      ts:    h.ts,
      cmd:   (h.cmd || "").slice(0, 60),
      ageMin: Math.round((now - (h.ts || 0)) / 60000),
    }));
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useSupportWorkflows() {
  const [exports,     setExports]     = useState([]);
  const [sessionId,   setSessionId]   = useState(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    setExports(_loadExports());
    setSessionId(_getOrCreateSessionId());
    setInitialized(true);
  }, []);

  // Generate issue summary and store it
  const generateIssueSummary = useCallback((context = {}) => {
    const summary = _buildIssueSummary(context);
    const entry = {
      id:         `support_${Date.now()}`,
      type:       "issue_summary",
      exportedAt: Date.now(),
      sessionId,
      data:       summary,
    };
    setExports(prev => {
      const next = [entry, ...prev].slice(0, EXPORT_MAX);
      _save(EXPORT_KEY, next);
      return next;
    });
    return entry;
  }, [sessionId]);

  // Export debugging session
  const exportDebugSession = useCallback((context = {}) => {
    const data  = _buildDebugSessionExport({ ...context, sessionId });
    const entry = { id: `debug_${Date.now()}`, type: "debug_session", exportedAt: Date.now(), sessionId, data };
    setExports(prev => {
      const next = [entry, ...prev].slice(0, EXPORT_MAX);
      _save(EXPORT_KEY, next);
      return next;
    });
    return entry;
  }, [sessionId]);

  // Export deployment diagnostics
  const exportDeployDiagnostics = useCallback((context = {}) => {
    const data  = _buildDeployDiagnosticsExport(context);
    const entry = { id: `deploy_${Date.now()}`, type: "deploy_diagnostics", exportedAt: Date.now(), sessionId, data };
    setExports(prev => {
      const next = [entry, ...prev].slice(0, EXPORT_MAX);
      _save(EXPORT_KEY, next);
      return next;
    });
    return entry;
  }, [sessionId]);

  // Build recovery history report (read-only, no side effects)
  const buildRecoveryReport = useCallback((hist = []) => {
    return _buildRecoveryHistory(hist);
  }, []);

  // Privacy-safe JSON for copy/paste to support
  const formatExportForCopy = useCallback((exportEntry) => {
    if (!exportEntry) return "";
    return JSON.stringify({ ...exportEntry, sessionId }, null, 2);
  }, [sessionId]);

  // Delete a specific export
  const deleteExport = useCallback((id) => {
    setExports(prev => {
      const next = prev.filter(e => e.id !== id);
      _save(EXPORT_KEY, next);
      return next;
    });
  }, []);

  // Clear all exports
  const clearExports = useCallback(() => {
    try { localStorage.removeItem(EXPORT_KEY); } catch {}
    setExports([]);
  }, []);

  // Summary for operator display
  const exportSummary = useMemo(() => ({
    total:   exports.length,
    hasIssue: exports.some(e => e.type === "issue_summary"),
    hasDebug: exports.some(e => e.type === "debug_session"),
    hasDeploy: exports.some(e => e.type === "deploy_diagnostics"),
    newest:  exports[0] || null,
  }), [exports]);

  return {
    initialized,
    sessionId,
    exports,
    exportSummary,
    // Actions
    generateIssueSummary,
    exportDebugSession,
    exportDeployDiagnostics,
    buildRecoveryReport,
    formatExportForCopy,
    deleteExport,
    clearExports,
  };
}
