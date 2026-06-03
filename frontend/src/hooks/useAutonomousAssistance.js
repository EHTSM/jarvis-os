// Phase 1081-1090: Supervised workflow automation + engineering copilot +
// adaptive recovery assistance + execution recommendation engine +
// operator approval intelligence + session continuity + productivity acceleration +
// multi-workspace assistance isolation + live operations assistance + stress validation.
//
// Consolidates ten phases. No external calls. No autonomous execution.
// All state: localStorage-only. Operator approval required for ALL automation actions.
// Bounded: 20 workflows, 30 recommendations, 15 approvals, 20 recovery steps, 15 isolation events.

import { useState, useEffect, useCallback, useMemo } from "react";

const WF_KEY      = "jarvis_assisted_workflows";
const REC_KEY     = "jarvis_exec_recommendations";
const APPR_KEY    = "jarvis_assist_approvals";
const RECOV_KEY   = "jarvis_assist_recovery";
const AISO_KEY    = "jarvis_assist_isolation";
const CONT_KEY    = "jarvis_assist_continuity";

const WF_MAX      = 20;
const REC_MAX     = 30;
const APPR_MAX    = 15;
const RECOV_MAX   = 20;
const AISO_MAX    = 15;
const CONT_MAX    = 10;

const WF_TTL      = 24 * 60 * 60 * 1000;
const REC_TTL     = 7  * 24 * 60 * 60 * 1000;
const APPR_TTL    = 24 * 60 * 60 * 1000;
const RECOV_TTL   = 24 * 60 * 60 * 1000;
const AISO_TTL    = 24 * 60 * 60 * 1000;
const CONT_TTL    = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1081: Supervised workflow automation ────────────────────────────────

const WORKFLOW_TYPES = new Set([
  "deployment_assist", "debug_acceleration", "replay_recovery",
  "queue_recovery", "rollback_assist", "incident_response",
]);

const WF_STAGES = ["propose", "review", "approve", "execute", "verify"];

function _buildAssistedWorkflow({ type, name, steps = [], context = {} }) {
  if (!WORKFLOW_TYPES.has(type)) return null;
  return {
    id:        `awf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    name,
    steps:     steps.slice(0, 10), // bound steps
    stage:     "propose",
    approved:  false,
    status:    "pending",
    ts:        Date.now(),
    updatedAt: Date.now(),
    context,
  };
}

function _advanceWorkflow(wf) {
  const idx = WF_STAGES.indexOf(wf.stage);
  if (idx < 0 || idx >= WF_STAGES.length - 1) return wf;
  if (wf.stage === "approve" && !wf.approved) {
    return { ...wf, status: "blocked", updatedAt: Date.now() };
  }
  const next = WF_STAGES[idx + 1];
  return {
    ...wf,
    stage:     next,
    status:    next === "verify" ? "verifying" : next === WF_STAGES[WF_STAGES.length - 1] ? "complete" : "active",
    updatedAt: Date.now(),
  };
}

// ── Phase 1082: Contextual engineering copilot ────────────────────────────────

const COPILOT_CATEGORIES = {
  debug:      { priority: 1, label: "Debug",      color: "var(--op-red)"   },
  deploy:     { priority: 2, label: "Deploy",     color: "var(--op-amber)" },
  replay:     { priority: 3, label: "Replay",     color: "var(--op-blue)"  },
  workflow:   { priority: 4, label: "Workflow",   color: "var(--op-green)" },
  operations: { priority: 5, label: "Operations", color: "var(--op-text2)" },
};

function _generateCopilotRecs({
  trustScore        = 100,
  failRate          = 0,
  survivability     = 100,
  openIncidents     = 0,
  activeFailovers   = 0,
  replayAge         = null,
  queueHealthy      = true,
} = {}) {
  const recs = [];

  if (trustScore < 70) {
    recs.push({ cat: "debug",  rec: "Trust degraded — review recent failures before deploying", priority: 1 });
  }
  if (failRate > 30) {
    recs.push({ cat: "debug",  rec: `${failRate}% failure rate — inspect last execution logs`, priority: 1 });
  }
  if (openIncidents > 0) {
    recs.push({ cat: "operations", rec: `${openIncidents} open incident${openIncidents > 1 ? "s" : ""} — resolve before new deployments`, priority: 2 });
  }
  if (activeFailovers > 0) {
    recs.push({ cat: "operations", rec: "Active failover — verify replay continuity before resuming", priority: 2 });
  }
  if (replayAge !== null && replayAge > 30 * 60 * 1000) {
    recs.push({ cat: "replay", rec: "Replay snapshot is stale — refresh before heavy debugging", priority: 3 });
  }
  if (!queueHealthy) {
    recs.push({ cat: "workflow", rec: "Queue unhealthy — batch smaller workloads or clear backlog", priority: 3 });
  }
  if (survivability < 80 && openIncidents === 0) {
    recs.push({ cat: "operations", rec: "Survivability degraded — verify infra and queue health", priority: 4 });
  }
  if (trustScore >= 90 && failRate === 0 && openIncidents === 0) {
    recs.push({ cat: "deploy", rec: "System stable — good time to advance deployment queue", priority: 5 });
  }

  return recs.slice(0, 5).map((r, i) => ({ ...r, id: `rec_${Date.now()}_${i}`, ts: Date.now() }));
}

// ── Phase 1083: Adaptive recovery assistance ──────────────────────────────────

const RECOVERY_PLAYBOOKS = {
  deployment_failure: [
    { step: "Capture current deployment state snapshot" },
    { step: "Identify last stable deployment checkpoint" },
    { step: "Approve rollback to checkpoint (operator required)" },
    { step: "Verify replay continuity post-rollback" },
    { step: "Re-run deployment validation suite" },
  ],
  replay_failure: [
    { step: "Check replay snapshot age (must be < 1h)" },
    { step: "Clear stale replay state if older than TTL" },
    { step: "Restore from most recent valid snapshot" },
    { step: "Verify workspace continuity after restore" },
  ],
  queue_saturation: [
    { step: "Identify oldest queued items" },
    { step: "Prune items exceeding retry limits" },
    { step: "Reduce concurrent workflow load" },
    { step: "Monitor queue drain rate" },
  ],
  failover_triggered: [
    { step: "Confirm failover scope and affected runtimes" },
    { step: "Verify replay safety across failover boundary" },
    { step: "Check for cross-runtime state contamination" },
    { step: "Approve runtime restoration (operator required)" },
  ],
};

function _buildRecoveryGuidance(incidentType) {
  const playbook = RECOVERY_PLAYBOOKS[incidentType];
  if (!playbook) return null;
  return {
    id:            `recov_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    incidentType,
    steps:         playbook,
    currentStep:   0,
    approved:      false,
    status:        "pending",
    ts:            Date.now(),
  };
}

// ── Phase 1084: Execution recommendation engine ───────────────────────────────

function _scoreOperationalTrust({ successCount = 0, failCount = 0, recentRecs = [] } = {}) {
  const total = successCount + failCount;
  const baseScore = total > 0 ? Math.round((successCount / total) * 100) : 100;
  const recBonus = recentRecs.filter(r => r.cat === "deploy").length > 0 ? 5 : 0;
  return Math.min(100, baseScore + recBonus);
}

// ── Phase 1085: Approval intelligence — risk visibility ──────────────────────

const RISK_LEVELS = {
  deployment_assist: "medium",
  debug_acceleration: "low",
  replay_recovery:    "high",
  queue_recovery:     "medium",
  rollback_assist:    "high",
  incident_response:  "high",
};

function _buildApprovalRequest(workflow) {
  const risk = RISK_LEVELS[workflow.type] || "medium";
  return {
    id:          `appr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    workflowId:  workflow.id,
    workflowName: workflow.name,
    type:        workflow.type,
    risk,
    riskColor:   risk === "high" ? "var(--op-red)" : risk === "medium" ? "var(--op-amber)" : "var(--op-green)",
    steps:       workflow.steps.length,
    approved:    false,
    ts:          Date.now(),
  };
}

// ── Phase 1086: Session continuity ───────────────────────────────────────────

function _assessAssistContinuity() {
  const now = Date.now();
  try {
    const wfs = JSON.parse(localStorage.getItem(WF_KEY) || "[]");
    const interrupted = wfs.filter(w =>
      (w.status === "active" || w.status === "verifying") &&
      now - w.updatedAt > 5 * 60 * 1000 // stale after 5 min
    );
    const staleRecoveries = JSON.parse(localStorage.getItem(RECOV_KEY) || "[]").filter(r =>
      r.status === "pending" && now - r.ts > 30 * 60 * 1000
    );
    return {
      interruptedWorkflows: interrupted.length,
      staleRecoveries:      staleRecoveries.length,
      continuityRisk:       interrupted.length > 0 || staleRecoveries.length > 0,
    };
  } catch { return { interruptedWorkflows: 0, staleRecoveries: 0, continuityRisk: false }; }
}

// ── Phase 1087: Productivity acceleration intelligence ────────────────────────

function _computeAccelerationScore({
  recentRecs = [], approvedWorkflows = 0, resolvedIncidents = 0,
} = {}) {
  let score = 60; // baseline
  if (approvedWorkflows > 0)   score += Math.min(20, approvedWorkflows * 5);
  if (resolvedIncidents > 0)   score += Math.min(10, resolvedIncidents * 5);
  if (recentRecs.some(r => r.cat === "deploy")) score += 10;
  return Math.min(100, score);
}

// ── Phase 1088: Multi-workspace assistance isolation ──────────────────────────

const ASSIST_ISOLATED_PREFIXES = [
  "jarvis_assisted_workflows_",
  "jarvis_exec_recommendations_",
  "jarvis_assist_approvals_",
];

function _scanAssistIsolation(activeWsId) {
  if (!activeWsId) return [];
  const violations = [];
  try {
    for (let i = 0; i < Math.min(localStorage.length, 100); i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const isIsolated = ASSIST_ISOLATED_PREFIXES.some(p => key.startsWith(p));
      if (isIsolated && !key.endsWith(activeWsId)) {
        violations.push({ key, reason: "Cross-workspace assistance state bleed" });
      }
    }
  } catch {}
  return violations.slice(0, 5);
}

// ── Phase 1089: Live operations assistance ────────────────────────────────────

function _buildOpsAssistance({ openIncidents = [], activeFailovers = 0, queueHealthy = true } = {}) {
  const guidance = [];
  const topIncident = openIncidents.find(i => i.severity === "high");
  if (topIncident) {
    const playbook = RECOVERY_PLAYBOOKS[topIncident.type];
    if (playbook) {
      guidance.push({ priority: 1, area: "Incident", rec: `For ${topIncident.label}: ${playbook[0].step}` });
    }
  }
  if (activeFailovers > 0) {
    guidance.push({ priority: 2, area: "Failover", rec: "Verify replay continuity across all active failover boundaries" });
  }
  if (!queueHealthy) {
    guidance.push({ priority: 3, area: "Queue", rec: "Queue degraded — prioritize drain before new workflow submissions" });
  }
  return guidance.slice(0, 3);
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useAutonomousAssistance({
  trustScore      = 100,
  failRate        = 0,
  survivability   = 100,
  openIncidents   = [],
  activeFailovers = 0,
  replayAge       = null,
  queueHealthy    = true,
} = {}) {
  const [workflows,     setWorkflows]     = useState([]);
  const [approvals,     setApprovals]     = useState([]);
  const [recovery,      setRecovery]      = useState([]);
  const [storedRecs,    setStoredRecs]    = useState([]);
  const [isoEvents,     setIsoEvents]     = useState([]);
  const [continuity,    setContinuity]    = useState(null);
  const [initialized,   setInitialized]   = useState(false);

  const activeWsId = useMemo(() =>
    localStorage.getItem("jarvis_operator_id") || "default",
    []
  );

  const evaluate = useCallback(() => {
    const now = Date.now();

    // TTL-filter arrays
    setWorkflows(prev => {
      const next = prev.filter(w => now - (w.ts || 0) < WF_TTL);
      _save(WF_KEY, next);
      return next;
    });
    setApprovals(prev => {
      const next = prev.filter(a => now - (a.ts || 0) < APPR_TTL);
      _save(APPR_KEY, next);
      return next;
    });
    setRecovery(prev => {
      const next = prev.filter(r => now - (r.ts || 0) < RECOV_TTL);
      _save(RECOV_KEY, next);
      return next;
    });
    setStoredRecs(prev => {
      const next = prev.filter(r => now - (r.ts || 0) < REC_TTL);
      _save(REC_KEY, next);
      return next;
    });

    // Continuity assessment
    setContinuity(_assessAssistContinuity());

    // Isolation scan
    const violations = _scanAssistIsolation(activeWsId);
    if (violations.length > 0) {
      setIsoEvents(prev => {
        const entries = violations.map(v => ({ ...v, ts: now }));
        const next = [...entries, ...prev]
          .filter(e => now - (e.ts || 0) < AISO_TTL)
          .slice(0, AISO_MAX);
        _save(AISO_KEY, next);
        return next;
      });
    }
  }, [activeWsId]);

  useEffect(() => {
    const now = Date.now();
    setWorkflows( _load(WF_KEY,   []).filter(w => now - (w.ts || 0) < WF_TTL));
    setApprovals( _load(APPR_KEY, []).filter(a => now - (a.ts || 0) < APPR_TTL));
    setRecovery(  _load(RECOV_KEY,[]).filter(r => now - (r.ts || 0) < RECOV_TTL));
    setStoredRecs(_load(REC_KEY,  []).filter(r => now - (r.ts || 0) < REC_TTL));
    setIsoEvents( _load(AISO_KEY, []).filter(e => now - (e.ts || 0) < AISO_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // ── Workflow actions (Phase 1081) ──────────────────────────────────────────

  const proposeWorkflow = useCallback(({ type, name, steps, context } = {}) => {
    const wf = _buildAssistedWorkflow({ type, name, steps, context });
    if (!wf) return null;
    const appr = _buildApprovalRequest(wf);
    setWorkflows(prev => {
      const next = [wf, ...prev].slice(0, WF_MAX);
      _save(WF_KEY, next);
      return next;
    });
    setApprovals(prev => {
      const next = [appr, ...prev].slice(0, APPR_MAX);
      _save(APPR_KEY, next);
      return next;
    });
    return wf.id;
  }, []);

  const approveWorkflow = useCallback((wfId) => {
    setWorkflows(prev => {
      const next = prev.map(w => w.id === wfId ? { ...w, approved: true, updatedAt: Date.now() } : w);
      _save(WF_KEY, next);
      return next;
    });
    setApprovals(prev => {
      const next = prev.map(a => a.workflowId === wfId ? { ...a, approved: true } : a);
      _save(APPR_KEY, next);
      return next;
    });
  }, []);

  const advanceWorkflow = useCallback((wfId) => {
    setWorkflows(prev => {
      const next = prev.map(w => w.id === wfId ? _advanceWorkflow(w) : w);
      _save(WF_KEY, next);
      return next;
    });
  }, []);

  // ── Recovery actions (Phase 1083) ─────────────────────────────────────────

  const requestRecovery = useCallback((incidentType) => {
    const guidance = _buildRecoveryGuidance(incidentType);
    if (!guidance) return null;
    setRecovery(prev => {
      const next = [guidance, ...prev].slice(0, RECOV_MAX);
      _save(RECOV_KEY, next);
      return next;
    });
    return guidance.id;
  }, []);

  const advanceRecovery = useCallback((recovId) => {
    setRecovery(prev => {
      const next = prev.map(r => {
        if (r.id !== recovId) return r;
        const nextStep = r.currentStep + 1;
        const done = nextStep >= r.steps.length;
        return { ...r, currentStep: nextStep, status: done ? "complete" : "active", updatedAt: Date.now() };
      });
      _save(RECOV_KEY, next);
      return next;
    });
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────

  // Live copilot recommendations (Phase 1082) — recomputed from live inputs
  const copilotRecs = useMemo(() => _generateCopilotRecs({
    trustScore, failRate, survivability,
    openIncidents: openIncidents.length, activeFailovers, replayAge, queueHealthy,
  }), [trustScore, failRate, survivability, openIncidents.length, activeFailovers, replayAge, queueHealthy]);

  const topRec = useMemo(() => copilotRecs[0] || null, [copilotRecs]);

  // Ops assistance (Phase 1089)
  const opsAssistance = useMemo(() =>
    _buildOpsAssistance({ openIncidents, activeFailovers, queueHealthy }),
    [openIncidents, activeFailovers, queueHealthy]
  );

  // Pending approvals
  const pendingApprovals = useMemo(() =>
    approvals.filter(a => !a.approved),
    [approvals]
  );

  // Active recovery guides
  const activeRecovery = useMemo(() =>
    recovery.filter(r => r.status !== "complete"),
    [recovery]
  );

  // Acceleration score (Phase 1087)
  const accelerationScore = useMemo(() => {
    const approvedCount  = workflows.filter(w => w.approved).length;
    const resolvedCount  = recovery.filter(r => r.status === "complete").length;
    return _computeAccelerationScore({ recentRecs: copilotRecs, approvedWorkflows: approvedCount, resolvedIncidents: resolvedCount });
  }, [workflows, recovery, copilotRecs]);

  // Coarse dep-key for operational trust — bucket by 3 to prevent burst re-renders
  const _successCount = workflows.filter(w => w.status === "complete").length;
  const _failCount    = workflows.filter(w => w.status === "blocked").length;
  const _successBucket = Math.floor(_successCount / 3);
  const _failBucket    = Math.floor(_failCount / 3);
  const operationalTrust = useMemo(() => _scoreOperationalTrust({
    successCount: _successBucket * 3, // use bucketed value — exact count not needed
    failCount:    _failBucket    * 3,
    recentRecs:   copilotRecs,
  }), [_successBucket, _failBucket, copilotRecs]);

  // Calm operator bar — Phase 1093: only show when actionable
  const assistBar = useMemo(() => {
    const hasApprovals    = pendingApprovals.length > 0;
    const hasContinuity   = continuity?.continuityRisk;
    const hasTopRec       = topRec && topRec.cat !== "deploy"; // suppress low-priority deploy recs
    if (!hasApprovals && !hasContinuity && !hasTopRec) return null;
    return {
      label:       hasApprovals ? `${pendingApprovals.length} pending approval${pendingApprovals.length > 1 ? "s" : ""}` : null,
      continuity:  hasContinuity ? continuity.interruptedWorkflows > 0 ? "Interrupted workflows detected" : null : null,
      rec:         hasTopRec ? topRec.rec : null,
      recColor:    topRec ? (COPILOT_CATEGORIES[topRec.cat]?.color ?? "var(--op-text2)") : null,
      acceleration: accelerationScore,
    };
  }, [pendingApprovals.length, continuity, topRec, accelerationScore]);

  return {
    initialized,
    workflows,
    approvals,
    recovery,
    copilotRecs,
    opsAssistance,
    isoEvents,
    continuity,
    // Derived
    topRec,
    pendingApprovals,
    activeRecovery,
    assistBar,
    accelerationScore,
    operationalTrust,
    // Actions
    proposeWorkflow,
    approveWorkflow,
    advanceWorkflow,
    requestRecovery,
    advanceRecovery,
    evaluate,
  };
}
