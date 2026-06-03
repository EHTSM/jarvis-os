// Phase 991-996: Workspace access governance + operational audit logging +
// workflow approval system + API security hardening + security event detection +
// operational policy enforcement.
//
// Consolidates six phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 200 audit events, 50 security events, 20 approvals, 30d retention, 24h TTL.

import { useState, useEffect, useCallback, useMemo } from "react";

const GOV_KEY    = "jarvis_governance";
const AUDIT_KEY  = "jarvis_audit_log";
const SEC_KEY    = "jarvis_security_events";
const APPR_KEY   = "jarvis_approval_queue";
const POLICY_KEY = "jarvis_op_policies";
const AUDIT_MAX  = 200;
const SEC_MAX    = 50;
const APPR_MAX   = 20;
const AUDIT_TTL  = 30 * 24 * 60 * 60 * 1000;  // 30d
const SEC_TTL    = 7  * 24 * 60 * 60 * 1000;   // 7d
const APPR_TTL   = 24 * 60 * 60 * 1000;        // 24h

// ── Phase 991: Workspace access governance ───────────────────────────────────

const DEFAULT_PERMISSIONS = {
  canExecuteWorkflow:  true,
  canDeploy:           false,  // requires explicit approval
  canExport:           true,
  canRestoreReplay:    true,
  canManageTeam:       false,
  canChangeChannel:    false,
};

const TIER_PERMISSIONS = {
  free:       { ...DEFAULT_PERMISSIONS },
  starter:    { ...DEFAULT_PERMISSIONS, canDeploy: true },
  pro:        { ...DEFAULT_PERMISSIONS, canDeploy: true, canManageTeam: true },
  enterprise: { ...DEFAULT_PERMISSIONS, canDeploy: true, canManageTeam: true, canChangeChannel: true },
};

function _resolvePermissions(tier, overrides = {}) {
  const base = TIER_PERMISSIONS[tier] || TIER_PERMISSIONS.free;
  return { ...base, ...overrides };
}

function _checkPermission(permissions, action) {
  const key = `can${action.charAt(0).toUpperCase()}${action.slice(1)}`;
  const allowed = permissions[key] ?? false;
  return {
    allowed,
    reason: allowed ? null : `${action} not permitted for current tier/permissions`,
  };
}

// ── Phase 992: Operational audit logging ─────────────────────────────────────

const AUDITABLE_EVENTS = new Set([
  "workflow_run", "workflow_approved", "workflow_rejected",
  "deploy_approved", "deploy_rejected", "deploy_executed",
  "replay_restored", "diag_exported", "workspace_access_changed",
  "automation_triggered", "permission_changed", "policy_updated",
  "security_alert", "approval_created", "approval_expired",
]);

function _buildAuditEntry(eventType, meta = {}) {
  return {
    id:         `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    type:       eventType,
    ts:         Date.now(),
    operatorId: localStorage.getItem("jarvis_operator_id") || "default",
    // Never store raw output or user content — only type, outcome, metadata
    outcome:    meta.outcome || "ok",
    meta:       {
      workspaceId: meta.workspaceId || null,
      actionType:  meta.actionType || null,
      approved:    meta.approved ?? null,
    },
  };
}

// ── Phase 993: Workflow approval system ──────────────────────────────────────

const APPROVAL_REQUIRED = new Set([
  "deploy", "restart", "rollback", "bulk_execute",
  "permission_change", "channel_change", "team_modify",
]);

const DESTRUCTIVE_CONFIRMATIONS = new Set([
  "bulk_execute", "rollback", "permission_change",
]);

function _requiresApproval(actionType) {
  return APPROVAL_REQUIRED.has(actionType);
}

function _requiresDestructiveConfirm(actionType) {
  return DESTRUCTIVE_CONFIRMATIONS.has(actionType);
}

function _buildApprovalRequest(actionType, meta = {}) {
  return {
    id:          `appr_${Date.now().toString(36)}`,
    actionType,
    ts:          Date.now(),
    expiresAt:   Date.now() + APPR_TTL,
    status:      "pending",  // pending | approved | rejected | expired
    requiresConfirm: _requiresDestructiveConfirm(actionType),
    meta: {
      workspaceId: meta.workspaceId || null,
      chainId:     meta.chainId || null,
      label:       meta.label || actionType,
    },
  };
}

// ── Phase 994: API security hardening ────────────────────────────────────────

const SECURE_ENDPOINTS = {
  "/api/run":      { requiresPermission: "executeWorkflow", rateLimit: 30 },
  "/api/deploy":   { requiresPermission: "deploy",         rateLimit: 5,  requiresApproval: true },
  "/api/export":   { requiresPermission: "export",         rateLimit: 10 },
  "/api/replay":   { requiresPermission: "restoreReplay",  rateLimit: 20 },
  "/api/diagnose": { requiresPermission: "executeWorkflow", rateLimit: 15 },
};

function _validateSecureEndpoint(endpoint, permissions, recentCalls) {
  const config = SECURE_ENDPOINTS[endpoint];
  if (!config) return { allowed: true, violations: [] };

  const violations = [];
  const permCheck = _checkPermission(permissions, config.requiresPermission);
  if (!permCheck.allowed) violations.push(permCheck.reason);

  const now = Date.now();
  const windowCalls = recentCalls.filter(c => c.endpoint === endpoint && now - c.ts < 60000).length;
  if (windowCalls >= config.rateLimit) {
    violations.push(`Rate limit: ${windowCalls}/${config.rateLimit} calls/min on ${endpoint}`);
  }

  return { allowed: violations.length === 0, violations, requiresApproval: !!config.requiresApproval };
}

// ── Phase 995: Security event detection ──────────────────────────────────────

const ANOMALY_THRESHOLDS = {
  rapidWorkflowExec:    10,   // >10 executions in 5min
  repeatedAuthFail:      3,   // >3 permission violations in 10min
  replayCorrAttempts:    2,   // >2 replay parse errors
  unusualExportFreq:     5,   // >5 exports in 1h
};

function _detectAnomalies(auditLog, secEvents) {
  const now  = Date.now();
  const alerts = [];

  const recentExecs = auditLog.filter(
    e => e.type === "workflow_run" && now - e.ts < 5 * 60 * 1000
  ).length;
  if (recentExecs >= ANOMALY_THRESHOLDS.rapidWorkflowExec) {
    alerts.push({ id: "rapid_exec", severity: "high", msg: `${recentExecs} workflow executions in 5min`, ts: now });
  }

  const recentPermFail = auditLog.filter(
    e => e.type === "workflow_rejected" && now - e.ts < 10 * 60 * 1000
  ).length;
  if (recentPermFail >= ANOMALY_THRESHOLDS.repeatedAuthFail) {
    alerts.push({ id: "auth_fail", severity: "high", msg: `${recentPermFail} permission violations in 10min`, ts: now });
  }

  const recentExports = auditLog.filter(
    e => e.type === "diag_exported" && now - e.ts < 60 * 60 * 1000
  ).length;
  if (recentExports >= ANOMALY_THRESHOLDS.unusualExportFreq) {
    alerts.push({ id: "export_freq", severity: "medium", msg: `${recentExports} exports in 1h`, ts: now });
  }

  // Replay corruption: check for stored corruption signals
  const frictionLog = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_friction_signals") || "[]"); } catch { return []; }
  })();
  const replayCorrAttempts = frictionLog.filter(
    f => f.type === "startup_corruption" && now - f.ts < 60 * 60 * 1000
  ).length;
  if (replayCorrAttempts >= ANOMALY_THRESHOLDS.replayCorrAttempts) {
    alerts.push({ id: "replay_corruption", severity: "high", msg: `${replayCorrAttempts} replay corruption event(s) in 1h`, ts: now });
  }

  return alerts;
}

// ── Phase 996: Operational policy enforcement ────────────────────────────────

const DEFAULT_POLICIES = {
  maxWorkflowChainSteps:    6,
  requireApprovalForDeploy: true,
  blockRecursiveExecution:  true,
  auditAllDeployments:      true,
  enforceReplayStaleGuard:  true,
  replayStaleWindowMs:      6 * 60 * 60 * 1000,
};

function _evaluatePolicyCompliance(policies, context) {
  const violations = [];

  if (policies.requireApprovalForDeploy && context.actionType === "deploy" && !context.approved) {
    violations.push("Deploy requires operator approval (policy: requireApprovalForDeploy)");
  }
  if (policies.blockRecursiveExecution && context.isRecursive) {
    violations.push("Recursive execution blocked by policy");
  }
  if (policies.enforceReplayStaleGuard && context.replayAgeMs > policies.replayStaleWindowMs) {
    violations.push(`Replay exceeds stale window (${Math.round(context.replayAgeMs / 3600000)}h)`);
  }
  if (context.chainSteps > policies.maxWorkflowChainSteps) {
    violations.push(`Chain steps (${context.chainSteps}) exceeds policy limit (${policies.maxWorkflowChainSteps})`);
  }

  return { compliant: violations.length === 0, violations };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useWorkspaceGovernance({ tier = "free" } = {}) {
  const [permissions,   setPermissions]   = useState(null);
  const [auditLog,      setAuditLog]      = useState([]);
  const [secEvents,     setSecEvents]     = useState([]);
  const [approvalQueue, setApprovalQueue] = useState([]);
  const [policies,      setPolicies]      = useState(DEFAULT_POLICIES);
  const [initialized,   setInitialized]   = useState(false);

  useEffect(() => {
    const perms = _resolvePermissions(tier, _load(GOV_KEY, {})?.overrides || {});
    setPermissions(perms);

    const now = Date.now();
    setAuditLog(_load(AUDIT_KEY, []).filter(e => now - e.ts < AUDIT_TTL));
    setSecEvents(_load(SEC_KEY, []).filter(e => now - e.ts < SEC_TTL));
    setApprovalQueue(_load(APPR_KEY, []).filter(e => now < (e.expiresAt || 0)));
    setPolicies(_load(POLICY_KEY, DEFAULT_POLICIES));
    setInitialized(true);
  }, [tier]);

  // Recompute permissions when tier changes
  useEffect(() => {
    const saved = _load(GOV_KEY, {});
    setPermissions(_resolvePermissions(tier, saved?.overrides || {}));
  }, [tier]);

  // Append an audit event (immutable append — never mutates existing entries)
  const audit = useCallback((eventType, meta = {}) => {
    if (!AUDITABLE_EVENTS.has(eventType)) return;
    const entry = _buildAuditEntry(eventType, meta);
    setAuditLog(prev => {
      const next = [entry, ...prev].filter(e => Date.now() - e.ts < AUDIT_TTL).slice(0, AUDIT_MAX);
      _save(AUDIT_KEY, next);
      return next;
    });
  }, []);

  // Check a permission gate
  const checkPermission = useCallback((action) => {
    if (!permissions) return { allowed: false, reason: "Permissions not initialized" };
    return _checkPermission(permissions, action);
  }, [permissions]);

  // Validate a secure API endpoint call
  const validateEndpoint = useCallback((endpoint, recentCalls = []) => {
    if (!permissions) return { allowed: false, violations: ["Governance not ready"] };
    return _validateSecureEndpoint(endpoint, permissions, recentCalls);
  }, [permissions]);

  // Create an approval request
  const requestApproval = useCallback((actionType, meta = {}) => {
    if (!_requiresApproval(actionType)) return { required: false };
    const req = _buildApprovalRequest(actionType, meta);
    setApprovalQueue(prev => {
      const next = [req, ...prev].slice(0, APPR_MAX);
      _save(APPR_KEY, next);
      return next;
    });
    audit("approval_created", { actionType, outcome: "pending" });
    return { required: true, request: req };
  }, [audit]);

  // Resolve an approval (approve or reject)
  const resolveApproval = useCallback((approvalId, decision) => {
    setApprovalQueue(prev => {
      const next = prev.map(a =>
        a.id === approvalId ? { ...a, status: decision, resolvedAt: Date.now() } : a
      );
      _save(APPR_KEY, next);
      return next;
    });
    audit(decision === "approved" ? "workflow_approved" : "workflow_rejected", {
      outcome: decision,
    });
  }, [audit]);

  // Evaluate policy compliance for an action context
  const checkPolicy = useCallback((context = {}) => {
    return _evaluatePolicyCompliance(policies, context);
  }, [policies]);

  // Security anomaly scan (run on mount + visibility restore)
  const scanForAnomalies = useCallback(() => {
    const alerts = _detectAnomalies(auditLog, secEvents);
    if (alerts.length > 0) {
      setSecEvents(prev => {
        const merged = [...alerts, ...prev]
          .filter(e => Date.now() - (e.ts || 0) < SEC_TTL)
          .slice(0, SEC_MAX);
        _save(SEC_KEY, merged);
        return merged;
      });
      alerts.forEach(a => audit("security_alert", { actionType: a.id, outcome: a.severity }));
    }
    return alerts;
  }, [auditLog, secEvents, audit]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") scanForAnomalies(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [scanForAnomalies]);

  // Derived: active security alerts (high severity)
  const activeAlerts = useMemo(() => {
    const now = Date.now();
    return secEvents.filter(e => e.severity === "high" && now - (e.ts || 0) < 60 * 60 * 1000);
  }, [secEvents]);

  // Derived: pending approvals
  const pendingApprovals = useMemo(() => {
    const now = Date.now();
    return approvalQueue.filter(a => a.status === "pending" && now < (a.expiresAt || 0));
  }, [approvalQueue]);

  // Governance maturity score 0-100
  const governanceScore = useMemo(() => {
    let score = 100;
    if (activeAlerts.length > 0)      score -= activeAlerts.length * 20;
    if (pendingApprovals.length > 3)  score -= 10;
    return Math.max(0, Math.min(100, score));
  }, [activeAlerts, pendingApprovals]);

  // Governance status pill for operator bar
  const governanceStatus = useMemo(() => {
    if (activeAlerts.length > 0) {
      return { label: "ALERT", msg: activeAlerts[0].msg, color: "var(--op-red)" };
    }
    if (pendingApprovals.length > 0) {
      return { label: "APPROVAL", msg: `${pendingApprovals.length} pending`, color: "var(--op-amber)" };
    }
    return null;
  }, [activeAlerts, pendingApprovals]);

  // Audit export (privacy-safe — no raw output, only event types + counts)
  const exportAuditSummary = useCallback(() => {
    const counts = {};
    auditLog.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
    return {
      exportedAt: Date.now(),
      eventCount: auditLog.length,
      counts,
      alerts:     secEvents.filter(e => Date.now() - (e.ts || 0) < SEC_TTL).length,
    };
  }, [auditLog, secEvents]);

  return {
    initialized,
    permissions,
    policies,
    auditLog,
    secEvents,
    activeAlerts,
    approvalQueue,
    pendingApprovals,
    governanceScore,
    governanceStatus,
    // Actions
    audit,
    checkPermission,
    validateEndpoint,
    requestApproval,
    resolveApproval,
    checkPolicy,
    scanForAnomalies,
    exportAuditSummary,
  };
}
