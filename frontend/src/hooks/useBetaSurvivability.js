// Phase 910: Long-session beta survivability.
// Multi-day engineering continuity, replay durability, reconnect-safe restoration,
// interrupted workflow recovery, deployment-session survivability.
//
// Prevents: stale replay continuation, duplicated workflow resurrection, contextual corruption.
// All state: localStorage-only. No external calls. No autonomous execution.
// Bounded: session log 10 entries, dedup window 5min, 7-day max retention.

import { useState, useEffect, useCallback, useMemo } from "react";

const BS_KEY        = "jarvis_beta_survivability";
const DEDUP_WINDOW  = 5  * 60 * 1000;
const SESSION_TTL   = 7  * 24 * 60 * 60 * 1000;
const STALE_WINDOW  = 6  * 60 * 60 * 1000;   // 6h replay window
const SESSION_LOG_MAX = 10;

// ── Continuity guards ─────────────────────────────────────────────────────────

function _checkReplayStaleness(snapshot) {
  if (!snapshot) return { stale: true, reason: "No snapshot" };
  const ageMs = Date.now() - (snapshot.ts || 0);
  if (ageMs > STALE_WINDOW) return { stale: true, reason: `${Math.round(ageMs / 3600000)}h old — beyond 6h window` };
  return { stale: false, reason: null };
}

function _checkWorkflowDuplication(sessionLog) {
  // Detect same workflow chain started more than once without completion (duplication risk)
  const now      = Date.now();
  const recent   = sessionLog.filter(s => now - (s.ts || 0) < DEDUP_WINDOW);
  const chainIds = recent.filter(s => s.type === "chain_started").map(s => s.chainId);
  const dupes    = chainIds.filter((id, i) => chainIds.indexOf(id) !== i);
  return { hasDupes: dupes.length > 0, dupeIds: [...new Set(dupes)] };
}

function _checkContextualCorruption() {
  // Verify critical state keys are parseable and not null
  const CRITICAL = [
    "jarvis_workflow_hist", "jarvis_friction_signals",
    "jarvis_health_snapshot", "jarvis_operator_workspace",
  ];
  const corrupted = [];
  CRITICAL.forEach(k => {
    try {
      const v = localStorage.getItem(k);
      if (v) JSON.parse(v);
    } catch {
      corrupted.push(k);
    }
  });
  return { corrupted, ok: corrupted.length === 0 };
}

// ── Multi-day continuity tracker ──────────────────────────────────────────────

function _assessMultiDayContinuity(sessionLog) {
  const now  = Date.now();
  const days = sessionLog.map(s => Math.floor((s.ts || 0) / 86400000));
  const uniqueDays = new Set(days).size;

  // Gap detection: largest gap between sessions
  const sorted = sessionLog.map(s => s.ts || 0).sort((a, b) => b - a);
  let maxGapH = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = (sorted[i] - sorted[i + 1]) / 3600000;
    maxGapH = Math.max(maxGapH, gap);
  }

  return {
    uniqueDays,
    totalSessions: sessionLog.length,
    maxGapH: Math.round(maxGapH),
    multiDay: uniqueDays > 1,
  };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function _loadState() {
  const raw = _load(BS_KEY, null);
  if (!raw || Date.now() - (raw.ts || 0) > SESSION_TTL) return { sessionLog: [] };
  return raw;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useBetaSurvivability() {
  const [sessionLog,   setSessionLog]   = useState([]);
  const [initialized,  setInitialized]  = useState(false);
  const [lastChecked,  setLastChecked]  = useState(null);

  const evaluate = useCallback(() => {
    const snap    = _load("jarvis_health_snapshot", null);
    const replayStatus  = _checkReplayStaleness(snap);
    const corruptStatus = _checkContextualCorruption();
    const now = Date.now();
    setLastChecked(now);
    return { replayStatus, corruptStatus };
  }, []);

  useEffect(() => {
    const state = _loadState();
    setSessionLog(state.sessionLog || []);
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  // Record a session lifecycle event (session start, chain start/complete, reconnect)
  const recordEvent = useCallback((type, meta = {}) => {
    setSessionLog(prev => {
      const entry = { type, ts: Date.now(), ...meta };
      const next  = [entry, ...prev].slice(0, SESSION_LOG_MAX);
      const state = _loadState();
      _save(BS_KEY, { ...state, sessionLog: next, ts: Date.now() });
      return next;
    });
  }, []);

  // Duplication check
  const duplicationCheck = useMemo(() =>
    _checkWorkflowDuplication(sessionLog),
    [sessionLog]
  );

  // Multi-day continuity
  const continuity = useMemo(() =>
    _assessMultiDayContinuity(sessionLog),
    [sessionLog]
  );

  // Survivability health
  const survivabilityHealth = useMemo(() => {
    const snap       = _load("jarvis_health_snapshot", null);
    const replay     = _checkReplayStaleness(snap);
    const corrupt    = _checkContextualCorruption();
    const hasDupes   = duplicationCheck.hasDupes;

    let score = 100;
    if (replay.stale)          score -= 20;
    if (!corrupt.ok)            score -= 30;
    if (hasDupes)               score -= 15;
    score = Math.max(0, score);

    return {
      score,
      label: score >= 80 ? "HEALTHY" : score >= 55 ? "DEGRADED" : "CRITICAL",
      color: score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
      replayStale:   replay.stale,
      replayReason:  replay.reason,
      corrupted:     corrupt.corrupted,
      hasDuplicates: hasDupes,
    };
  }, [duplicationCheck]);

  return {
    initialized,
    sessionLog,
    continuity,
    duplicationCheck,
    survivabilityHealth,
    lastChecked,
    recordEvent,
    evaluate,
  };
}
