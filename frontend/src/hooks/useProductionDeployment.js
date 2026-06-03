// Phase 1066-1075: Production deployment orchestration + incident response +
// runtime failover + live observability + rollback automation + workflow survivability +
// multi-runtime isolation + perf hardening + stress validation + UX refinement.
//
// Consolidates ten phases. No external calls. No autonomous execution.
// All state: localStorage-only. Operator approval required for all deployment actions.
// Bounded: 20 deployments, 30 incidents, 15 failovers, 50 ops events, 10 rollback snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const DEP_KEY     = "jarvis_prod_deployments";
const INC_KEY     = "jarvis_prod_incidents";
const FOV_KEY     = "jarvis_prod_failovers";
const OPS_KEY     = "jarvis_prod_ops_events";
const ROLL_KEY    = "jarvis_prod_rollbacks";
const MISO_KEY    = "jarvis_prod_runtime_isolation";

const DEP_MAX     = 20;
const INC_MAX     = 30;
const FOV_MAX     = 15;
const OPS_MAX     = 50;
const ROLL_MAX    = 10;
const MISO_MAX    = 15;

const DEP_TTL     = 7  * 24 * 60 * 60 * 1000;
const INC_TTL     = 7  * 24 * 60 * 60 * 1000;
const FOV_TTL     = 24 * 60 * 60 * 1000;
const OPS_TTL     = 30 * 24 * 60 * 60 * 1000;
const ROLL_TTL    = 7  * 24 * 60 * 60 * 1000;
const MISO_TTL    = 24 * 60 * 60 * 1000;

// ── Phase 1066: Deployment orchestration ─────────────────────────────────────

const DEPLOY_STAGES = ["prepare", "validate", "deploy", "verify", "complete"];

const DEPLOY_STAGE_CHECKS = {
  prepare:  ({ replayReady }) => replayReady !== false,
  validate: ({ queueHealthy }) => queueHealthy !== false,
  deploy:   ({ approved }) => approved === true,
  verify:   () => true,
  complete: () => true,
};

function _buildDeployment({ name, env = "production", metadata = {} }) {
  return {
    id:        `dep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    env,
    stage:     "prepare",
    status:    "pending",
    approved:  false,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    stages:    DEPLOY_STAGES.map(s => ({ name: s, status: "pending", ts: null })),
    metadata,
    rollbackAvailable: false,
  };
}

function _advanceDeployStage(dep, ctx = {}) {
  const stageIdx = DEPLOY_STAGES.indexOf(dep.stage);
  if (stageIdx < 0 || stageIdx >= DEPLOY_STAGES.length - 1) return dep;

  const check = DEPLOY_STAGE_CHECKS[dep.stage];
  if (check && !check({ ...ctx, approved: dep.approved })) {
    return { ...dep, status: "blocked", updatedAt: Date.now() };
  }

  const nextStage = DEPLOY_STAGES[stageIdx + 1];
  const stages = dep.stages.map(s =>
    s.name === dep.stage  ? { ...s, status: "complete", ts: Date.now() } :
    s.name === nextStage  ? { ...s, status: "active",   ts: Date.now() } : s
  );
  const isComplete = nextStage === "complete";
  return {
    ...dep,
    stage:             nextStage,
    status:            isComplete ? "complete" : "active",
    rollbackAvailable: isComplete,
    stages,
    updatedAt:         Date.now(),
  };
}

// ── Phase 1067: Incident classification ──────────────────────────────────────

const INCIDENT_CLASSES = {
  deployment_failure: { severity: "high",   label: "Deploy Failure",   escalate: true  },
  replay_failure:     { severity: "high",   label: "Replay Failure",   escalate: true  },
  queue_saturation:   { severity: "medium", label: "Queue Saturated",  escalate: false },
  failover_triggered: { severity: "medium", label: "Failover Active",  escalate: false },
  trust_degraded:     { severity: "medium", label: "Trust Degraded",   escalate: false },
  connectivity_lost:  { severity: "low",    label: "Connectivity Lost", escalate: false },
};

function _classifyIncident(type, meta = {}) {
  const cls = INCIDENT_CLASSES[type] || { severity: "low", label: type, escalate: false };
  return {
    id:         `inc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    ...cls,
    status:     "open",
    ts:         Date.now(),
    updatedAt:  Date.now(),
    recoverySteps: [],
    meta,
  };
}

function _resolveIncident(inc) {
  return { ...inc, status: "resolved", updatedAt: Date.now() };
}

// ── Phase 1068: Runtime failover discipline ───────────────────────────────────

const FAILOVER_LIMITS = {
  maxConcurrent:   2,
  staleSecs:       300, // 5 min — beyond this, failover state considered stale
  maxRetries:      3,
  replayGuardSecs: 60,  // replay must be < 1 min old to survive failover
};

function _buildFailoverRecord({ runtimeId, reason, replayAge = null }) {
  const replaySafe = replayAge !== null ? replayAge < FAILOVER_LIMITS.replayGuardSecs * 1000 : false;
  return {
    id:          `fov_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    runtimeId,
    reason,
    replaySafe,
    retries:     0,
    status:      "active",
    ts:          Date.now(),
    updatedAt:   Date.now(),
  };
}

// ── Phase 1069: Live operational observability ────────────────────────────────

function _buildOpsSnapshot({
  deployments = [], incidents = [], failovers = [], queueHealthy = true,
} = {}) {
  const now = Date.now();

  const activeDeployments   = deployments.filter(d => d.status === "active" || d.status === "pending");
  const openIncidents       = incidents.filter(i => i.status === "open");
  const activeFailovers     = failovers.filter(f => f.status === "active" && now - f.ts < FAILOVER_LIMITS.staleSecs * 1000);
  const highSeverityCount   = openIncidents.filter(i => i.severity === "high").length;
  const replaySafeFailovers = activeFailovers.filter(f => f.replaySafe).length;

  // Survivability: degrades with open incidents + active failovers
  let survivability = 100;
  if (highSeverityCount > 0)      survivability -= highSeverityCount * 20;
  if (openIncidents.length > 2)   survivability -= 10;
  if (activeFailovers.length > 0) survivability -= activeFailovers.length * 10;
  if (!queueHealthy)              survivability -= 15;
  survivability = Math.max(0, Math.min(100, survivability));

  // Operational trust
  const recentCompleted = deployments.filter(d => d.status === "complete" && now - d.updatedAt < 24 * 60 * 60 * 1000);
  const recentFailed    = deployments.filter(d => d.status === "failed"   && now - d.updatedAt < 24 * 60 * 60 * 1000);
  const opsTrust = recentCompleted.length + recentFailed.length > 0
    ? Math.round((recentCompleted.length / (recentCompleted.length + recentFailed.length)) * 100)
    : 100;

  return {
    ts:               now,
    survivability,
    opsTrust,
    survLabel:        survivability >= 80 ? "STABLE" : survivability >= 55 ? "DEGRADED" : "CRITICAL",
    survColor:        survivability >= 80 ? "var(--op-green)" : survivability >= 55 ? "var(--op-amber)" : "var(--op-red)",
    activeDeployments:    activeDeployments.length,
    openIncidents:        openIncidents.length,
    highSeverityCount,
    activeFailovers:      activeFailovers.length,
    replaySafeFailovers,
    queueHealthy,
  };
}

// ── Phase 1070: Rollback automation ──────────────────────────────────────────

function _buildRollbackSnapshot(deployment) {
  return {
    id:           `roll_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    deploymentId: deployment.id,
    name:         deployment.name,
    env:          deployment.env,
    stage:        deployment.stage,
    capturedAt:   Date.now(),
    approved:     false, // must be re-approved for rollback execution
  };
}

// ── Phase 1071-1072: Workflow survivability + multi-runtime isolation ─────────

const RUNTIME_ISOLATED_PREFIXES = [
  "jarvis_prod_deployments_",
  "jarvis_prod_incidents_",
  "jarvis_prod_failovers_",
];

function _scanRuntimeIsolation(activeRuntimeId) {
  if (!activeRuntimeId) return [];
  const violations = [];
  try {
    for (let i = 0; i < Math.min(localStorage.length, 100); i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const isIsolated = RUNTIME_ISOLATED_PREFIXES.some(p => key.startsWith(p));
      if (isIsolated && !key.endsWith(activeRuntimeId)) {
        violations.push({ key, reason: "Cross-runtime production state bleed" });
      }
    }
  } catch {}
  return violations.slice(0, 5);
}

// ── Phase 1073: Performance hardening — bounded module-level cache ────────────

const _opsCache = new Map(); // key → { val, ts }
const OPS_CACHE_TTL = 30 * 1000; // 30s

function _cachedOps(key, compute) {
  const cached = _opsCache.get(key);
  if (cached && Date.now() - cached.ts < OPS_CACHE_TTL) return cached.val;
  const val = compute();
  if (_opsCache.size > 20) {
    // Evict oldest entry
    const oldest = [..._opsCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _opsCache.delete(oldest[0]);
  }
  _opsCache.set(key, { val, ts: Date.now() });
  return val;
}

// ── Phase 1074-1075: Stress validation + UX refinement ───────────────────────

// Calm ops bar: suppress when all systems healthy (< noise threshold)
function _shouldShowOpsBar(snap) {
  if (!snap) return false;
  return snap.survivability < 80 || snap.openIncidents > 0 || snap.activeFailovers > 0;
}

// Production maturity scoring (Phase 1079)
function _computeProductionMaturity({
  survivability = 100, opsTrust = 100,
  recentDeployCount = 0, isolationViolations = 0,
} = {}) {
  let score = Math.round(survivability * 0.4 + opsTrust * 0.4);
  if (recentDeployCount >= 3) score += 10;
  if (isolationViolations > 0) score -= 15;
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    label: score >= 80 ? "PRODUCTION READY" : score >= 60 ? "DEVELOPING" : "FOUNDATIONAL",
    color: score >= 80 ? "var(--op-green)" : score >= 60 ? "var(--op-amber)" : "var(--op-red)",
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

export function useProductionDeployment({
  queueHealthy = true,
  trustScore   = 100,
} = {}) {
  const [deployments, setDeployments] = useState([]);
  const [incidents,   setIncidents]   = useState([]);
  const [failovers,   setFailovers]   = useState([]);
  const [opsEvents,   setOpsEvents]   = useState([]);
  const [rollbacks,   setRollbacks]   = useState([]);
  const [isoEvents,   setIsoEvents]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const activeRuntimeId = useMemo(() =>
    localStorage.getItem("jarvis_operator_id") || "default",
    []
  );

  const evaluate = useCallback(() => {
    const now = Date.now();

    // TTL-filter all arrays
    setDeployments(prev => {
      const next = prev.filter(d => now - (d.startedAt || 0) < DEP_TTL);
      _save(DEP_KEY, next);
      return next;
    });
    setIncidents(prev => {
      const next = prev.filter(i => now - (i.ts || 0) < INC_TTL);
      _save(INC_KEY, next);
      return next;
    });
    setFailovers(prev => {
      const next = prev.filter(f => now - (f.ts || 0) < FOV_TTL);
      _save(FOV_KEY, next);
      return next;
    });
    setRollbacks(prev => {
      const next = prev.filter(r => now - (r.capturedAt || 0) < ROLL_TTL);
      _save(ROLL_KEY, next);
      return next;
    });

    // Runtime isolation scan
    const violations = _scanRuntimeIsolation(activeRuntimeId);
    if (violations.length > 0) {
      setIsoEvents(prev => {
        const entries = violations.map(v => ({ ...v, ts: now }));
        const next = [...entries, ...prev]
          .filter(e => now - (e.ts || 0) < MISO_TTL)
          .slice(0, MISO_MAX);
        _save(MISO_KEY, next);
        return next;
      });
    }
  }, [activeRuntimeId]);

  useEffect(() => {
    const now = Date.now();
    setDeployments(_load(DEP_KEY,  []).filter(d => now - (d.startedAt || 0) < DEP_TTL));
    setIncidents(  _load(INC_KEY,  []).filter(i => now - (i.ts       || 0) < INC_TTL));
    setFailovers(  _load(FOV_KEY,  []).filter(f => now - (f.ts       || 0) < FOV_TTL));
    setOpsEvents(  _load(OPS_KEY,  []).filter(e => now - (e.ts       || 0) < OPS_TTL));
    setRollbacks(  _load(ROLL_KEY, []).filter(r => now - (r.capturedAt || 0) < ROLL_TTL));
    setIsoEvents(  _load(MISO_KEY, []).filter(e => now - (e.ts       || 0) < MISO_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // ── Deployment actions (Phase 1066) ────────────────────────────────────────

  const startDeployment = useCallback(({ name, env, metadata } = {}) => {
    if (!name) return null;
    const dep = _buildDeployment({ name, env, metadata });
    setDeployments(prev => {
      const next = [dep, ...prev].slice(0, DEP_MAX);
      _save(DEP_KEY, next);
      return next;
    });
    return dep.id;
  }, []);

  const approveDeployment = useCallback((depId) => {
    setDeployments(prev => {
      const next = prev.map(d => d.id === depId ? { ...d, approved: true, updatedAt: Date.now() } : d);
      _save(DEP_KEY, next);
      return next;
    });
  }, []);

  const advanceDeployment = useCallback((depId, ctx = {}) => {
    setDeployments(prev => {
      const next = prev.map(d => {
        if (d.id !== depId) return d;
        const advanced = _advanceDeployStage(d, ctx);
        // Auto-capture rollback snapshot on completion
        if (advanced.status === "complete") {
          const snap = _buildRollbackSnapshot(advanced);
          setRollbacks(rb => {
            const rbNext = [snap, ...rb].slice(0, ROLL_MAX);
            _save(ROLL_KEY, rbNext);
            return rbNext;
          });
        }
        return advanced;
      });
      _save(DEP_KEY, next);
      return next;
    });
  }, []);

  const failDeployment = useCallback((depId, reason = "") => {
    setDeployments(prev => {
      const next = prev.map(d =>
        d.id === depId ? { ...d, status: "failed", failReason: reason, updatedAt: Date.now() } : d
      );
      _save(DEP_KEY, next);
      return next;
    });
    // Auto-create incident
    const inc = _classifyIncident("deployment_failure", { depId, reason });
    setIncidents(prev => {
      const next = [inc, ...prev].slice(0, INC_MAX);
      _save(INC_KEY, next);
      return next;
    });
  }, []);

  // ── Incident actions (Phase 1067) ──────────────────────────────────────────

  const openIncident = useCallback((type, meta = {}) => {
    const inc = _classifyIncident(type, meta);
    setIncidents(prev => {
      const next = [inc, ...prev].slice(0, INC_MAX);
      _save(INC_KEY, next);
      return next;
    });
    // Record ops event
    const evt = { type: "incident_opened", incType: type, severity: inc.severity, ts: Date.now() };
    setOpsEvents(prev => {
      const next = [evt, ...prev].filter(e => Date.now() - (e.ts || 0) < OPS_TTL).slice(0, OPS_MAX);
      _save(OPS_KEY, next);
      return next;
    });
    return inc.id;
  }, []);

  const resolveIncident = useCallback((incId) => {
    setIncidents(prev => {
      const next = prev.map(i => i.id === incId ? _resolveIncident(i) : i);
      _save(INC_KEY, next);
      return next;
    });
  }, []);

  // ── Failover actions (Phase 1068) ─────────────────────────────────────────

  const triggerFailover = useCallback(({ runtimeId, reason, replayAge } = {}) => {
    setFailovers(prev => {
      // Enforce concurrent failover limit
      const activeFovs = prev.filter(f => f.status === "active");
      if (activeFovs.length >= FAILOVER_LIMITS.maxConcurrent) return prev;
      const fov = _buildFailoverRecord({ runtimeId, reason, replayAge });
      const next = [fov, ...prev].slice(0, FOV_MAX);
      _save(FOV_KEY, next);
      return next;
    });
  }, []);

  const resolveFailover = useCallback((fovId) => {
    setFailovers(prev => {
      const next = prev.map(f => f.id === fovId ? { ...f, status: "resolved", updatedAt: Date.now() } : f);
      _save(FOV_KEY, next);
      return next;
    });
  }, []);

  // ── Rollback (Phase 1070) — approval-gated ────────────────────────────────

  const approveRollback = useCallback((rollId) => {
    setRollbacks(prev => {
      const next = prev.map(r => r.id === rollId ? { ...r, approved: true } : r);
      _save(ROLL_KEY, next);
      return next;
    });
  }, []);

  // ── Derived state (Phase 1069 + 1079) ────────────────────────────────────

  const opsSnapshot = useMemo(() =>
    _cachedOps(`snap_${deployments.length}_${incidents.length}_${failovers.length}`,
      () => _buildOpsSnapshot({ deployments, incidents, failovers, queueHealthy })
    ),
    [deployments, incidents, failovers, queueHealthy]
  );

  const recentIsoViolations = useMemo(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    return isoEvents.filter(e => (e.ts || 0) > cutoff).length;
  }, [isoEvents]);

  const productionMaturity = useMemo(() => {
    const recentDeployCount = deployments.filter(
      d => d.status === "complete" && Date.now() - d.updatedAt < 24 * 60 * 60 * 1000
    ).length;
    return _computeProductionMaturity({
      survivability:       opsSnapshot?.survivability ?? 100,
      opsTrust:            opsSnapshot?.opsTrust      ?? 100,
      recentDeployCount,
      isolationViolations: recentIsoViolations,
    });
  }, [opsSnapshot, deployments, recentIsoViolations]);

  // Calm operator bar — only show when degraded (Phase 1075)
  const opsStatusBar = useMemo(() => {
    if (!_shouldShowOpsBar(opsSnapshot)) return null;
    const topIncident = incidents.find(i => i.status === "open" && i.severity === "high");
    return {
      label:      opsSnapshot.survLabel,
      score:      opsSnapshot.survivability,
      color:      opsSnapshot.survColor,
      incident:   topIncident?.label || null,
      failovers:  opsSnapshot.activeFailovers,
      deploys:    opsSnapshot.activeDeployments,
    };
  }, [opsSnapshot, incidents]);

  const pendingRollbacks = useMemo(() =>
    rollbacks.filter(r => !r.approved),
    [rollbacks]
  );

  const activeDeployments = useMemo(() =>
    deployments.filter(d => d.status === "active" || d.status === "pending"),
    [deployments]
  );

  const openIncidentsList = useMemo(() =>
    incidents.filter(i => i.status === "open"),
    [incidents]
  );

  return {
    initialized,
    deployments,
    incidents,
    failovers,
    opsEvents,
    rollbacks,
    isoEvents,
    // Derived
    opsSnapshot,
    opsStatusBar,
    productionMaturity,
    pendingRollbacks,
    activeDeployments,
    openIncidentsList,
    // Actions
    startDeployment,
    approveDeployment,
    advanceDeployment,
    failDeployment,
    openIncident,
    resolveIncident,
    triggerFailover,
    resolveFailover,
    approveRollback,
    evaluate,
  };
}
