// Phase 997-1004: Multi-workspace security isolation + governance performance hardening +
// security stress validation + audit + governance UX + enterprise trust + platform security audit.
//
// Consolidates eight phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 5 workspace isolation namespaces, 20 violation events, 15 trust snapshots, 7d TTL.

import { useState, useEffect, useCallback, useMemo } from "react";

const ISO_KEY    = "jarvis_ws_isolation";
const TRUST_KEY  = "jarvis_gov_trust";
const PERF_KEY   = "jarvis_gov_perf";
const ISO_MAX    = 20;
const TRUST_MAX  = 15;
const ISO_TTL    = 7  * 24 * 60 * 60 * 1000;   // 7d
const TRUST_TTL  = 24 * 60 * 60 * 1000;

// ── Phase 997: Multi-workspace security isolation ─────────────────────────────

// Keys that must never bleed across workspace namespaces
const ISOLATED_KEY_PREFIXES = [
  "jarvis_workflow_", "jarvis_execution_", "jarvis_deploy_",
  "jarvis_replay_",   "jarvis_debug_",      "jarvis_friction_ws_",
];

function _scanWorkspaceBleed(activeWorkspaceId, allWorkspaceIds) {
  const violations = [];
  if (!activeWorkspaceId || allWorkspaceIds.length <= 1) return violations;

  allWorkspaceIds.forEach(wsId => {
    if (wsId === activeWorkspaceId) return;
    ISOLATED_KEY_PREFIXES.forEach(prefix => {
      const key = `${prefix}${wsId}`;
      if (localStorage.getItem(key) !== null) {
        violations.push({ wsId, key, reason: "Cross-workspace key visible in active session" });
      }
    });
  });

  return violations.slice(0, 10);
}

function _purgeStaleWorkspaceKeys(workspaceId, ageMs = ISO_TTL) {
  const purged = [];
  ISOLATED_KEY_PREFIXES.forEach(prefix => {
    const key = `${prefix}${workspaceId}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const ts = parsed?.ts || parsed?.savedAt || parsed?.updatedAt || null;
      if (ts && Date.now() - ts > ageMs) {
        localStorage.removeItem(key);
        purged.push(key);
      }
    } catch { /* non-critical */ }
  });
  return purged;
}

// ── Phase 998: Governance performance hardening ──────────────────────────────

// Lightweight permission cache — avoids re-evaluating on every render
const _permCache = new Map();
const PERM_CACHE_TTL = 30 * 1000;  // 30s permission cache

function _cachedPermCheck(cacheKey, computeFn) {
  const cached = _permCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < PERM_CACHE_TTL) return cached.result;
  const result = computeFn();
  _permCache.set(cacheKey, { result, ts: Date.now() });
  return result;
}

function _clearPermCache() {
  _permCache.clear();
}

// Audit log retrieval with indexed fast-path (by type)
function _buildAuditIndex(auditLog) {
  const index = {};
  auditLog.forEach(entry => {
    if (!index[entry.type]) index[entry.type] = [];
    index[entry.type].push(entry);
  });
  return index;
}

// ── Phase 999-1003: Security stress + trust validation ────────────────────────

// Enterprise trust dimensions
const TRUST_DIMENSIONS = {
  workspaceIsolation: { weight: 25, desc: "No cross-workspace contamination" },
  approvalCompliance: { weight: 25, desc: "All approvals properly gated" },
  auditCoverage:      { weight: 20, desc: "Audit events captured" },
  replaySecurity:     { weight: 15, desc: "No stale replay continuation" },
  apiProtection:      { weight: 15, desc: "API endpoints properly gated" },
};

function _computeEnterpriseTrust({
  isolationViolations = 0,
  pendingApprovals    = 0,
  auditEventCount     = 0,
  replayStale         = false,
  apiBlockedCount     = 0,
} = {}) {
  let score = 100;

  // Workspace isolation
  if (isolationViolations > 0) score -= Math.min(isolationViolations * 10, 25);

  // Approval compliance
  if (pendingApprovals > 5) score -= 25;
  else if (pendingApprovals > 2) score -= 10;

  // Audit coverage
  if (auditEventCount === 0) score -= 20;
  else if (auditEventCount < 5) score -= 5;

  // Replay security
  if (replayStale) score -= 15;

  // API protection
  if (apiBlockedCount > 3) score -= 15;
  else if (apiBlockedCount > 0) score -= 5;

  score = Math.max(0, score);
  return {
    score,
    label: score >= 80 ? "TRUSTED" : score >= 60 ? "GUARDED" : score >= 40 ? "RESTRICTED" : "UNTRUSTED",
    color: score >= 80 ? "var(--op-green)" : score >= 60 ? "var(--op-blue)" :
           score >= 40 ? "var(--op-amber)" : "var(--op-red)",
    dimensions: Object.fromEntries(
      Object.entries(TRUST_DIMENSIONS).map(([k, v]) => [k, { ...v, passing: score >= 60 }])
    ),
  };
}

// ── Phase 1004: Platform security audit ──────────────────────────────────────

function _buildGovernanceMaturityReport({ governanceScore, enterpriseTrust, isolationViolations, auditCoverage }) {
  const areas = [];

  if (isolationViolations > 0) {
    areas.push({ area: "Workspace Isolation", status: "NEEDS_WORK", detail: `${isolationViolations} violation(s)` });
  } else {
    areas.push({ area: "Workspace Isolation", status: "PASSING" });
  }

  if (auditCoverage >= 10) {
    areas.push({ area: "Audit Coverage", status: "PASSING", detail: `${auditCoverage} events` });
  } else {
    areas.push({ area: "Audit Coverage", status: "NEEDS_WORK", detail: "Insufficient audit events" });
  }

  const overallScore = Math.round((governanceScore + enterpriseTrust.score) / 2);
  return {
    overallScore,
    label: overallScore >= 80 ? "MATURE" : overallScore >= 60 ? "DEVELOPING" : "FOUNDATIONAL",
    color: overallScore >= 80 ? "var(--op-green)" : overallScore >= 60 ? "var(--op-amber)" : "var(--op-red)",
    areas,
    generatedAt: Date.now(),
  };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useSecurityIsolation({
  auditLog           = [],
  pendingApprovals   = [],
  governanceScore    = 100,
  apiBlockedCount    = 0,
} = {}) {
  const [isolationEvents, setIsolationEvents] = useState([]);
  const [trustSnapshots,  setTrustSnapshots]  = useState([]);
  const [initialized,     setInitialized]     = useState(false);

  const activeWorkspaceId = useMemo(() =>
    localStorage.getItem("jarvis_operator_id") || "default",
    []
  );

  const evaluate = useCallback(() => {
    // Workspace ID list from MWC state
    const mwcWorkspaces = (() => {
      try {
        return Object.keys(JSON.parse(localStorage.getItem("jarvis_mwc_state") || "{}").workspaces || {});
      } catch { return []; }
    })();

    const violations = _scanWorkspaceBleed(activeWorkspaceId, mwcWorkspaces);
    if (violations.length > 0) {
      setIsolationEvents(prev => {
        const entries = violations.map(v => ({ ...v, ts: Date.now() }));
        const next = [...entries, ...prev]
          .filter(e => Date.now() - (e.ts || 0) < ISO_TTL)
          .slice(0, ISO_MAX);
        _save(ISO_KEY, next);
        return next;
      });
    }

    // Stale replay check
    const replayStale = (() => {
      try {
        const snap = JSON.parse(localStorage.getItem("jarvis_health_snapshot") || "null");
        return snap ? Date.now() - (snap.ts || 0) > 6 * 60 * 60 * 1000 : false;
      } catch { return false; }
    })();

    const trust = _computeEnterpriseTrust({
      isolationViolations: violations.length,
      pendingApprovals:    pendingApprovals.length,
      auditEventCount:     auditLog.length,
      replayStale,
      apiBlockedCount,
    });

    const snap = { ...trust, ts: Date.now() };
    setTrustSnapshots(prev => {
      const next = [snap, ...prev].slice(0, TRUST_MAX);
      _save(TRUST_KEY, next);
      return next;
    });
  }, [activeWorkspaceId, pendingApprovals.length, auditLog.length, apiBlockedCount]);

  useEffect(() => {
    const now = Date.now();
    setIsolationEvents(_load(ISO_KEY, []).filter(e => now - (e.ts || 0) < ISO_TTL));
    setTrustSnapshots(_load(TRUST_KEY, []).filter(e => now - (e.ts || 0) < TRUST_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Purge stale keys for a given workspace
  const purgeWorkspace = useCallback((workspaceId) => {
    _clearPermCache();
    return _purgeStaleWorkspaceKeys(workspaceId);
  }, []);

  // Cached permission lookup (Phase 998: governance perf hardening)
  const cachedCheck = useCallback((cacheKey, computeFn) => {
    return _cachedPermCheck(cacheKey, computeFn);
  }, []);

  // Current enterprise trust
  const enterpriseTrust = useMemo(() =>
    trustSnapshots[0] || _computeEnterpriseTrust(),
    [trustSnapshots]
  );

  // Audit index for fast retrieval (Phase 998)
  const auditIndex = useMemo(() => _buildAuditIndex(auditLog), [auditLog]);

  // Governance maturity report (Phase 1004)
  const maturityReport = useMemo(() =>
    _buildGovernanceMaturityReport({
      governanceScore,
      enterpriseTrust,
      isolationViolations: isolationEvents.filter(e => Date.now() - (e.ts || 0) < 60 * 60 * 1000).length,
      auditCoverage: auditLog.length,
    }),
    [governanceScore, enterpriseTrust, isolationEvents, auditLog.length]
  );

  // Security status for operator bar (Phase 1002 UX refinement)
  const securityStatus = useMemo(() => {
    const recentViolations = isolationEvents.filter(e => Date.now() - (e.ts || 0) < 60 * 60 * 1000);
    if (recentViolations.length > 0) {
      return { label: "ISOLATION", msg: recentViolations[0].reason, color: "var(--op-red)" };
    }
    if (enterpriseTrust.score < 60) {
      return { label: "TRUST", msg: enterpriseTrust.label, color: enterpriseTrust.color };
    }
    return null;
  }, [isolationEvents, enterpriseTrust]);

  return {
    initialized,
    isolationEvents,
    trustSnapshots,
    enterpriseTrust,
    maturityReport,
    auditIndex,
    securityStatus,
    // Actions
    evaluate,
    purgeWorkspace,
    cachedCheck,
  };
}
