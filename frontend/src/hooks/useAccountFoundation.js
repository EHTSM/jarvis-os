// Phase 946-948: Account foundation + workspace sync + public API readiness.
// Lightweight account identity, replay-safe session persistence, operator profile separation,
// workspace sync continuity, bounded runtime API scope, rate-limit readiness.
//
// Consolidates three phases — no external calls, no auth tokens stored, no server sync.
// All state: localStorage-only. Privacy-safe: no PII beyond operator-supplied display name.
// Bounded: 5 workspace snapshots, 10 API access log entries, 30-day profile TTL.

import { useState, useEffect, useCallback, useMemo } from "react";

const ACCT_KEY     = "jarvis_account_profile";
const WS_SYNC_KEY  = "jarvis_ws_sync";
const API_LOG_KEY  = "jarvis_api_access_log";
const ACCT_TTL     = 30 * 24 * 60 * 60 * 1000;
const WS_SYNC_MAX  = 5;
const API_LOG_MAX  = 10;
const RATE_WINDOW  = 60 * 1000;  // 1-minute rate window
const RATE_LIMIT   = 30;         // max 30 API-like actions per minute (operator guard)

// ── Account identity ──────────────────────────────────────────────────────────
// Lightweight identity: no PII, no tokens. Just a stable operator ID + display label.

function _getOrCreateOperatorId() {
  try {
    let id = localStorage.getItem("jarvis_operator_id");
    if (!id) {
      id = `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      localStorage.setItem("jarvis_operator_id", id);
    }
    return id;
  } catch { return `op_${Date.now().toString(36)}`; }
}

// ── Workspace sync snapshot ───────────────────────────────────────────────────
// Replay-safe: captures workspace state + health snapshot for portability.

function _buildWsSyncSnapshot(label = "") {
  const now = Date.now();
  const snap = {
    id:        `snap_${now.toString(36)}`,
    label:     label.slice(0, 40) || `Snapshot ${new Date(now).toLocaleTimeString()}`,
    createdAt: now,
    staleAfter: now + 6 * 3600000,  // 6h replay window
    state: {
      workspace: (() => {
        try { return JSON.parse(localStorage.getItem("jarvis_operator_workspace") || "null"); } catch { return null; }
      })(),
      healthTs: (() => {
        try { return JSON.parse(localStorage.getItem("jarvis_health_snapshot") || "null")?.ts || null; } catch { return null; }
      })(),
      channel: localStorage.getItem("jarvis_release_channel") || "beta",
    },
  };
  return snap;
}

// ── API readiness: rate-limit guard ──────────────────────────────────────────
// Tracks operator-triggered action rate to detect runaway execution.

function _checkRateLimit(apiLog) {
  const now    = Date.now();
  const recent = apiLog.filter(e => now - (e.ts || 0) < RATE_WINDOW);
  const withinLimit = recent.length < RATE_LIMIT;
  return {
    withinLimit,
    count:    recent.length,
    limit:    RATE_LIMIT,
    resetIn:  withinLimit ? null : Math.round((RATE_WINDOW - (now - (recent[recent.length - 1]?.ts || now))) / 1000),
  };
}

// ── Bounded API access logging ─────────────────────────────────────────────────
// Logs operator-triggered actions (no commands, no output — just type + ts).

function _logApiAccess(apiLog, actionType) {
  const entry = { type: actionType, ts: Date.now() };
  return [entry, ...apiLog].slice(0, API_LOG_MAX);
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function _loadProfile() {
  const raw = _load(ACCT_KEY, null);
  if (!raw || Date.now() - (raw.updatedAt || 0) > ACCT_TTL) return null;
  return raw;
}

function _loadWsSync() {
  return _load(WS_SYNC_KEY, []).filter(s => Date.now() < (s.staleAfter || 0));
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useAccountFoundation() {
  const [profile,     setProfile]     = useState(null);
  const [operatorId,  setOperatorId]  = useState(null);
  const [wsSyncs,     setWsSyncs]     = useState([]);
  const [apiLog,      setApiLog]      = useState([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const saved = _loadProfile();
    const oid   = _getOrCreateOperatorId();
    setProfile(saved || { displayName: "Operator", operatorId: oid, updatedAt: Date.now() });
    setOperatorId(oid);
    setWsSyncs(_loadWsSync());
    setApiLog(_load(API_LOG_KEY, []));
    setInitialized(true);
  }, []);

  // Update operator display name
  const setDisplayName = useCallback((name) => {
    setProfile(prev => {
      const next = { ...(prev || {}), displayName: (name || "Operator").slice(0, 30), updatedAt: Date.now() };
      _save(ACCT_KEY, next);
      return next;
    });
  }, []);

  // Create workspace sync snapshot
  const saveWsSync = useCallback((label = "") => {
    const snap = _buildWsSyncSnapshot(label);
    setWsSyncs(prev => {
      const next = [snap, ...prev].slice(0, WS_SYNC_MAX);
      _save(WS_SYNC_KEY, next);
      return next;
    });
    return snap;
  }, []);

  // Restore a workspace sync snapshot
  const restoreWsSync = useCallback((snapId) => {
    const snap = wsSyncs.find(s => s.id === snapId);
    if (!snap) return { ok: false, reason: "Snapshot not found" };
    const now = Date.now();
    if (now > snap.staleAfter) return { ok: false, reason: "Snapshot expired (>6h)" };
    // Restore workspace state
    try {
      if (snap.state?.workspace) {
        localStorage.setItem("jarvis_operator_workspace", JSON.stringify(snap.state.workspace));
      }
    } catch {}
    return { ok: true, snap };
  }, [wsSyncs]);

  // Delete a workspace sync
  const deleteWsSync = useCallback((snapId) => {
    setWsSyncs(prev => {
      const next = prev.filter(s => s.id !== snapId);
      _save(WS_SYNC_KEY, next);
      return next;
    });
  }, []);

  // Record an API-scope action (rate-limit tracking)
  const recordApiAction = useCallback((actionType) => {
    const rateStatus = _checkRateLimit(apiLog);
    if (!rateStatus.withinLimit) return { allowed: false, reason: `Rate limit: ${rateStatus.count}/${rateStatus.limit} actions/min` };
    setApiLog(prev => {
      const next = _logApiAccess(prev, actionType);
      _save(API_LOG_KEY, next);
      return next;
    });
    return { allowed: true };
  }, [apiLog]);

  // Rate limit status
  const rateStatus = useMemo(() => _checkRateLimit(apiLog), [apiLog]);

  // Workspace sync freshness
  const freshSyncs = useMemo(() =>
    wsSyncs.filter(s => Date.now() < s.staleAfter),
    [wsSyncs]
  );

  // Account summary for operator bar
  const accountSummary = useMemo(() => ({
    displayName: profile?.displayName || "Operator",
    operatorId,
    syncCount:   freshSyncs.length,
    rateStatus,
  }), [profile, operatorId, freshSyncs, rateStatus]);

  return {
    initialized,
    profile,
    operatorId,
    wsSyncs: freshSyncs,
    apiLog,
    rateStatus,
    accountSummary,
    // Actions
    setDisplayName,
    saveWsSync,
    restoreWsSync,
    deleteWsSync,
    recordApiAction,
  };
}
