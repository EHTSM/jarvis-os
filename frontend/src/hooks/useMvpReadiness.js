// Phase 952-954: Update infrastructure + productivity optimization + multi-account isolation.
// Staged rollout continuity, replay-safe updates, rollback-ready deployment upgrades,
// startup responsiveness optimization, bounded caches, multi-account workspace isolation.
//
// Consolidates three phases. Extends existing update/rollout infrastructure.
// All state: localStorage-only. No external calls. No autonomous execution.
// Bounded: 5 account namespaces, 10 perf samples, 24h TTL.

import { useState, useEffect, useCallback, useMemo } from "react";

const MVP_KEY      = "jarvis_mvp_readiness";
const PERF_KEY     = "jarvis_perf_samples";
const ACCT_NS_KEY  = "jarvis_account_namespaces";
const MVP_TTL      = 24 * 60 * 60 * 1000;
const PERF_MAX     = 10;
const ACCT_NS_MAX  = 5;

// ── Phase 952: Update infrastructure check ────────────────────────────────────
// Validates staged rollout health + replay-safe update state.

function _checkUpdateInfrastructure() {
  const issues    = [];
  const now       = Date.now();

  // Rollout state
  const rollout = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_rollout_state") || "null"); } catch { return null; }
  })();
  const hasActiveRollout = !!rollout?.current;

  // Migration log health
  const migrations = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_migration_log") || "[]"); } catch { return []; }
  })();
  const failedMigrations = migrations.filter(m => !m.success && now - (m.ts || 0) < MVP_TTL).length;
  if (failedMigrations > 0) issues.push(`${failedMigrations} failed migration(s) in 24h`);

  // Pre-update snapshot freshness
  const preSnap = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_pre_update_snapshot") || "null"); } catch { return null; }
  })();
  const snapAge = preSnap ? now - (preSnap.ts || 0) : null;
  const snapFresh = snapAge !== null && snapAge < 2 * 3600000;
  if (!preSnap) issues.push("No pre-update snapshot — create one before updating");

  return {
    hasActiveRollout,
    failedMigrations,
    snapFresh,
    issues,
    score: Math.max(0, 100 - issues.length * 20),
  };
}

// ── Phase 953: Startup perf sampling ─────────────────────────────────────────
// Records lightweight startup responsiveness metrics.

function _sampleStartupPerf() {
  try {
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      ts:            Date.now(),
      startupMs:     nav ? Math.round(performance.now() - (nav.startTime || 0)) : null,
      domNodes:      document.querySelectorAll("*").length,
      heapMb:        performance?.memory?.usedJSHeapSize
                       ? Math.round(performance.memory.usedJSHeapSize / 1048576)
                       : null,
    };
  } catch { return { ts: Date.now() }; }
}

// ── Phase 954: Multi-account namespace isolation ──────────────────────────────
// Tracks account namespaces; validates no cross-account key bleed.

const ACCOUNT_PREFIXES = [
  "jarvis_workflow_", "jarvis_friction_", "jarvis_execution_",
  "jarvis_operator_", "jarvis_oi_", "jarvis_wa_", "jarvis_cw_",
  "jarvis_pw_", "jarvis_ea_",
];

function _validateAccountIsolation(currentAccountId, namespaces) {
  if (Object.keys(namespaces).length <= 1) return { isolated: true, conflicts: [] };

  // Check that no namespace shares a key with a different account
  const conflicts = [];
  Object.entries(namespaces).forEach(([accountId, ns]) => {
    if (accountId === currentAccountId) return;
    ACCOUNT_PREFIXES.forEach(prefix => {
      const key = `${prefix}${accountId}`;
      if (localStorage.getItem(key) !== null) {
        conflicts.push({ accountId, key });
      }
    });
  });

  return { isolated: conflicts.length === 0, conflicts };
}

// ── MVP readiness scorer ──────────────────────────────────────────────────────

function _computeMvpReadiness({ updateInfra, continuityScore = 100, crashCount = 0, failRate = 0 }) {
  let score = 100;
  if (updateInfra.failedMigrations > 0)     score -= 15;
  if (!updateInfra.snapFresh)               score -= 10;
  if (continuityScore < 80)                  score -= 20;
  if (crashCount > 2)                        score -= 20;
  if (failRate > 30)                         score -= 15;
  score = Math.max(0, score);

  return {
    score,
    label: score >= 80 ? "READY" : score >= 55 ? "CONDITIONAL" : "NOT READY",
    color: score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
    blockers: [
      ...(updateInfra.issues),
      ...(continuityScore < 55 ? ["Session continuity critical"] : []),
      ...(crashCount > 5 ? ["Critical crash rate"] : []),
      ...(failRate > 50 ? ["Failure rate too high for MVP"] : []),
    ],
  };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useMvpReadiness({ continuityScore = 100, crashCount = 0, failRate = 0 } = {}) {
  const [updateInfra,   setUpdateInfra]   = useState(null);
  const [perfSamples,   setPerfSamples]   = useState([]);
  const [accountNs,     setAccountNs]     = useState({});
  const [initialized,   setInitialized]   = useState(false);

  const evaluate = useCallback(() => {
    const infra = _checkUpdateInfrastructure();
    setUpdateInfra(infra);
    _save(MVP_KEY, { updateInfra: infra, ts: Date.now() });
  }, []);

  useEffect(() => {
    const cached = _load(MVP_KEY, null);
    if (cached?.updateInfra) setUpdateInfra(cached.updateInfra);

    // Startup perf sample
    const sample = _sampleStartupPerf();
    setPerfSamples(prev => {
      const saved = _load(PERF_KEY, []);
      const next  = [sample, ...saved].slice(0, PERF_MAX);
      _save(PERF_KEY, next);
      return next;
    });

    // Account namespaces
    const operatorId = localStorage.getItem("jarvis_operator_id") || "default";
    const savedNs    = _load(ACCT_NS_KEY, {});
    if (!savedNs[operatorId]) {
      savedNs[operatorId] = { createdAt: Date.now() };
      _save(ACCT_NS_KEY, savedNs);
    }
    setAccountNs(savedNs);

    evaluate();
    setInitialized(true);
  }, [evaluate]);

  // Register a new account namespace (for multi-account isolation)
  const registerAccountNs = useCallback((accountId) => {
    if (!accountId) return;
    setAccountNs(prev => {
      const next = { ...prev };
      if (Object.keys(next).length >= ACCT_NS_MAX && !next[accountId]) {
        const oldest = Object.keys(next).sort((a, b) => (next[a].createdAt || 0) - (next[b].createdAt || 0))[0];
        delete next[oldest];
      }
      next[accountId] = { createdAt: Date.now() };
      _save(ACCT_NS_KEY, next);
      return next;
    });
  }, []);

  // Validate isolation for current account
  const currentAccountId = useMemo(() =>
    localStorage.getItem("jarvis_operator_id") || "default",
    []
  );

  const isolationCheck = useMemo(() =>
    _validateAccountIsolation(currentAccountId, accountNs),
    [currentAccountId, accountNs]
  );

  // MVP readiness score
  const mvpReadiness = useMemo(() => {
    if (!updateInfra) return null;
    return _computeMvpReadiness({ updateInfra, continuityScore, crashCount, failRate });
  }, [updateInfra, continuityScore, crashCount, failRate]);

  // Avg startup time from perf samples
  const avgStartupMs = useMemo(() => {
    const valid = perfSamples.filter(s => s.startupMs !== null && s.startupMs !== undefined);
    if (!valid.length) return null;
    return Math.round(valid.reduce((a, b) => a + b.startupMs, 0) / valid.length);
  }, [perfSamples]);

  return {
    initialized,
    updateInfra,
    perfSamples,
    avgStartupMs,
    accountNs,
    isolationCheck,
    mvpReadiness,
    evaluate,
    registerAccountNs,
  };
}
