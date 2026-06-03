// Phase 964-968: Cloud sync survivability + hosted workflow isolation +
// billing-safe architecture + SaaS operational analytics + multi-workspace continuity.
//
// Consolidates five phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 5 workspaces, 200 analytics events, 10 sync snapshots, 24h TTL.

import { useState, useEffect, useCallback, useMemo } from "react";

const SYNC_KEY    = "jarvis_cloud_sync";
const ISOL_KEY    = "jarvis_hosted_isolation";
const BILL_KEY    = "jarvis_billing_state";
const SOPS_KEY    = "jarvis_saas_analytics";
const MWC_KEY     = "jarvis_mwc_state";
const SYNC_MAX    = 10;
const SOPS_MAX    = 200;
const WS_MAX      = 5;
const SYNC_TTL    = 6  * 60 * 60 * 1000;   // 6h sync freshness
const SOPS_TTL    = 30 * 24 * 60 * 60 * 1000; // 30d analytics retention
const BILL_TTL    = 24 * 60 * 60 * 1000;   // 24h billing state cache
const DEDUP_WIN   = 5  * 60 * 1000;         // 5min dedup window

// ── Phase 964: Cloud sync survivability ──────────────────────────────────────

function _buildSyncSnapshot(label) {
  const now = Date.now();
  return {
    id:         `sync_${now.toString(36)}`,
    label:      (label || `Sync ${new Date(now).toLocaleTimeString()}`).slice(0, 40),
    createdAt:  now,
    expiresAt:  now + SYNC_TTL,
    state: {
      workspace:    _safeGet("jarvis_operator_workspace"),
      channel:      localStorage.getItem("jarvis_release_channel") || "beta",
      healthTs:     _safeGet("jarvis_health_snapshot")?.ts || null,
      workflowHist: (_safeGet("jarvis_workflow_hist") || []).slice(0, 10),
    },
  };
}

function _safeGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

function _validateSyncSnapshot(snap) {
  if (!snap) return { valid: false, reason: "No snapshot" };
  if (Date.now() > snap.expiresAt) return { valid: false, reason: "Sync snapshot expired (>6h)" };
  if (!snap.state) return { valid: false, reason: "Snapshot state missing" };
  return { valid: true };
}

// ── Phase 965: Hosted workflow isolation ──────────────────────────────────────

const ISOLATION_LIMITS = {
  maxConcurrentWorkflows:  2,
  maxWorkflowMemoryItems:  50,
  maxReplayDepth:          3,
  blockCrossWorkspaceExec: true,
  requireWorkspacePrefix:  true,
};

function _checkIsolation(workspaceId, activeWorkflows) {
  const violations = [];
  if ((activeWorkflows || []).length >= ISOLATION_LIMITS.maxConcurrentWorkflows) {
    violations.push(`Max ${ISOLATION_LIMITS.maxConcurrentWorkflows} concurrent workflows per workspace`);
  }
  return { isolated: violations.length === 0, violations };
}

// ── Phase 966: Billing-safe architecture ──────────────────────────────────────

const EXEC_QUOTAS = {
  free:       { dailyWorkflows: 20,  dailyDeploys: 5,   dailyExports: 2  },
  starter:    { dailyWorkflows: 100, dailyDeploys: 20,  dailyExports: 10 },
  pro:        { dailyWorkflows: 500, dailyDeploys: 100, dailyExports: 50 },
  enterprise: { dailyWorkflows: -1,  dailyDeploys: -1,  dailyExports: -1 },
};

function _checkBillingQuota(tier, usageCounts) {
  const q = EXEC_QUOTAS[tier] || EXEC_QUOTAS.free;
  const blocked = [];
  const pct = {};

  if (q.dailyWorkflows !== -1) {
    const used = usageCounts.workflow_run || 0;
    pct.workflows = Math.round((used / q.dailyWorkflows) * 100);
    if (used >= q.dailyWorkflows) blocked.push("workflow_run");
  }
  if (q.dailyDeploys !== -1) {
    const used = usageCounts.deploy_coord || 0;
    pct.deploys = Math.round((used / q.dailyDeploys) * 100);
    if (used >= q.dailyDeploys) blocked.push("deploy_coord");
  }
  if (q.dailyExports !== -1) {
    const used = usageCounts.diag_export || 0;
    pct.exports = Math.round((used / q.dailyExports) * 100);
    if (used >= q.dailyExports) blocked.push("diag_export");
  }

  return {
    blocked,
    pct,
    isBlocked: (actionType) => blocked.includes(actionType),
    summary: blocked.length > 0 ? `${blocked[0].replace("_", " ")} quota reached` : null,
  };
}

// ── Phase 967: SaaS operational analytics ────────────────────────────────────

const SAAS_EVENTS = new Set([
  "workspace_switch", "replay_success", "replay_fail", "deploy_success", "deploy_fail",
  "onboarding_complete", "onboarding_skip", "debug_session_start", "debug_session_end",
  "trust_degraded", "trust_restored", "quota_warn", "quota_blocked", "sync_created",
  "sync_restored", "team_member_added", "workspace_created",
]);

function _aggregateSaasAnalytics(events, windowDays = 7) {
  const now     = Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const recent  = events.filter(e => now - (e.ts || 0) < windowMs);
  const counts  = {};
  recent.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });

  const deploys  = (counts.deploy_success || 0) + (counts.deploy_fail || 0);
  const deployOk = deploys > 0 ? Math.round(((counts.deploy_success || 0) / deploys) * 100) : null;
  const replays  = (counts.replay_success || 0) + (counts.replay_fail || 0);
  const replayOk = replays > 0 ? Math.round(((counts.replay_success || 0) / replays) * 100) : null;

  return {
    counts,
    deploySuccessRate: deployOk,
    replaySuccessRate: replayOk,
    onboardingComplete: counts.onboarding_complete || 0,
    trustEvents: (counts.trust_degraded || 0) + (counts.trust_restored || 0),
    windowDays,
  };
}

// ── Phase 968: Multi-workspace continuity ────────────────────────────────────

function _loadMwcState() {
  try { return JSON.parse(localStorage.getItem(MWC_KEY) || "null") || { workspaces: {}, activeId: null }; }
  catch { return { workspaces: {}, activeId: null }; }
}

function _validateMwcContinuity(workspaces, activeId) {
  const issues = [];
  const now    = Date.now();

  Object.entries(workspaces).forEach(([id, ws]) => {
    if (!ws.lastActiveAt) return;
    const staleDays = Math.round((now - ws.lastActiveAt) / (24 * 60 * 60 * 1000));
    if (staleDays > 7) issues.push({ id, issue: `Workspace stale (${staleDays}d inactive)` });
    if (ws.replayAt && now - ws.replayAt > SYNC_TTL) issues.push({ id, issue: "Replay window expired" });
  });

  // Dedup guard: same chain active in two workspaces
  const chains = Object.values(workspaces).map(ws => ws.activeChainId).filter(Boolean);
  if (new Set(chains).size < chains.length) {
    issues.push({ id: "global", issue: "Duplicate active chain detected across workspaces" });
  }

  return { healthy: issues.length === 0, issues };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useSaasOperations({ tier = "free", usageCounts = {} } = {}) {
  const [syncSnapshots, setSyncSnapshots] = useState([]);
  const [isolationLog,  setIsolationLog]  = useState([]);
  const [saasEvents,    setSaasEvents]    = useState([]);
  const [mwcState,      setMwcState]      = useState({ workspaces: {}, activeId: null });
  const [initialized,   setInitialized]   = useState(false);

  useEffect(() => {
    setSyncSnapshots(_load(SYNC_KEY, []));
    setIsolationLog(_load(ISOL_KEY, []));
    setSaasEvents(_load(SOPS_KEY, []).filter(e => Date.now() - (e.ts || 0) < SOPS_TTL));
    setMwcState(_loadMwcState());
    setInitialized(true);
  }, []);

  // ── Phase 964: sync snapshot management ──────────────────────────────────

  const createSyncSnapshot = useCallback((label = "") => {
    const snap = _buildSyncSnapshot(label);
    setSyncSnapshots(prev => {
      const next = [snap, ...prev].slice(0, SYNC_MAX);
      _save(SYNC_KEY, next);
      return next;
    });
    recordSaasEvent("sync_created");
    return snap;
  }, [recordSaasEvent]);

  const restoreSyncSnapshot = useCallback((snapId) => {
    const snap = syncSnapshots.find(s => s.id === snapId);
    const validation = _validateSyncSnapshot(snap);
    if (!validation.valid) return { ok: false, reason: validation.reason };

    // Dedup guard: don't restore if active chain matches
    const waSession = _safeGet("jarvis_wa_session");
    if (waSession?.activeChainId && snap.state?.workflowHist?.[0]?.chainId === waSession.activeChainId) {
      const age = Date.now() - (waSession.ts || 0);
      if (age < DEDUP_WIN) return { ok: false, reason: "Duplicate workflow chain detected" };
    }

    try {
      if (snap.state?.workspace) {
        localStorage.setItem("jarvis_operator_workspace", JSON.stringify(snap.state.workspace));
      }
    } catch {}
    recordSaasEvent("sync_restored");
    return { ok: true, snap };
  }, [syncSnapshots, recordSaasEvent]);

  // ── Phase 965: isolation check ────────────────────────────────────────────

  const checkWorkflowIsolation = useCallback((workspaceId, activeWorkflows = []) => {
    const result = _checkIsolation(workspaceId, activeWorkflows);
    if (!result.isolated) {
      const entry = { workspaceId, violations: result.violations, ts: Date.now() };
      setIsolationLog(prev => {
        const next = [entry, ...prev].slice(0, 20);
        _save(ISOL_KEY, next);
        return next;
      });
    }
    return result;
  }, []);

  // ── Phase 967: SaaS event recording ──────────────────────────────────────

  const recordSaasEvent = useCallback((eventType, meta = {}) => {
    if (!SAAS_EVENTS.has(eventType)) return;
    const entry = { type: eventType, ts: Date.now(), ...meta };
    setSaasEvents(prev => {
      const next = [entry, ...prev].slice(0, SOPS_MAX);
      _save(SOPS_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 968: workspace registration & switching ─────────────────────────

  const registerWorkspace = useCallback((workspaceId, label = "") => {
    if (!workspaceId) return { ok: false, reason: "No workspace ID" };
    setMwcState(prev => {
      const workspaces = { ...prev.workspaces };
      if (Object.keys(workspaces).length >= WS_MAX && !workspaces[workspaceId]) {
        const oldest = Object.keys(workspaces).sort(
          (a, b) => (workspaces[a].lastActiveAt || 0) - (workspaces[b].lastActiveAt || 0)
        )[0];
        delete workspaces[oldest];
      }
      workspaces[workspaceId] = { label: label.slice(0, 30) || workspaceId, lastActiveAt: Date.now() };
      const next = { ...prev, workspaces, activeId: workspaceId };
      _save(MWC_KEY, next);
      return next;
    });
    recordSaasEvent("workspace_created");
    return { ok: true };
  }, [recordSaasEvent]);

  const switchWorkspace = useCallback((workspaceId) => {
    setMwcState(prev => {
      if (!prev.workspaces[workspaceId]) return prev;
      const workspaces = {
        ...prev.workspaces,
        [workspaceId]: { ...prev.workspaces[workspaceId], lastActiveAt: Date.now() },
      };
      const next = { ...prev, workspaces, activeId: workspaceId };
      _save(MWC_KEY, next);
      return next;
    });
    recordSaasEvent("workspace_switch");
  }, [recordSaasEvent]);

  // ── Derived state ─────────────────────────────────────────────────────────

  const billingQuota = useMemo(() => _checkBillingQuota(tier, usageCounts), [tier, usageCounts]);

  const saasAnalytics7d = useMemo(() => _aggregateSaasAnalytics(saasEvents, 7), [saasEvents]);

  const mwcContinuity = useMemo(() =>
    _validateMwcContinuity(mwcState.workspaces, mwcState.activeId),
    [mwcState]
  );

  const freshSyncSnapshots = useMemo(() =>
    syncSnapshots.filter(s => Date.now() < s.expiresAt),
    [syncSnapshots]
  );

  const saasStatusBar = useMemo(() => {
    if (billingQuota.blocked.length > 0) {
      return { label: "QUOTA", msg: billingQuota.summary, color: "var(--op-red)" };
    }
    if (!mwcContinuity.healthy) {
      return { label: "WORKSPACE", msg: mwcContinuity.issues[0]?.issue, color: "var(--op-amber)" };
    }
    return null;
  }, [billingQuota, mwcContinuity]);

  return {
    initialized,
    syncSnapshots: freshSyncSnapshots,
    isolationLog,
    saasEvents,
    mwcState,
    billingQuota,
    saasAnalytics7d,
    mwcContinuity,
    saasStatusBar,
    isolationLimits: ISOLATION_LIMITS,
    // Actions
    createSyncSnapshot,
    restoreSyncSnapshot,
    checkWorkflowIsolation,
    recordSaasEvent,
    registerWorkspace,
    switchWorkspace,
  };
}
