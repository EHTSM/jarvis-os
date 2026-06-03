// Phase 1006-1012: Organization management + role hierarchy + enterprise audit exports +
// deployment governance chains + compliance-safe logging + enterprise observability +
// org-wide policy enforcement.
//
// Consolidates seven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 5 orgs, 3 roles, 100 compliance events, 20 audit exports, 30d retention.

import { useState, useEffect, useCallback, useMemo } from "react";

const ORG_KEY    = "jarvis_enterprise_org";
const COMP_KEY   = "jarvis_compliance_log";
const EXPORT_KEY = "jarvis_audit_exports";
const EOBS_KEY   = "jarvis_enterprise_obs";
const ORG_MAX    = 5;
const COMP_MAX   = 100;
const EXPORT_MAX = 20;
const ORG_TTL    = 30 * 24 * 60 * 60 * 1000;
const COMP_TTL   = 90 * 24 * 60 * 60 * 1000;  // 90d compliance retention
const APPR_STALE = 24 * 60 * 60 * 1000;

// ── Phase 1006: Organization management ──────────────────────────────────────

function _getOrCreateOrgId() {
  try {
    let id = localStorage.getItem("jarvis_org_id");
    if (!id) {
      id = `org_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      localStorage.setItem("jarvis_org_id", id);
    }
    return id;
  } catch { return "org_default"; }
}

function _loadOrgState() {
  try {
    const raw = JSON.parse(localStorage.getItem(ORG_KEY) || "null");
    if (!raw || Date.now() - (raw.updatedAt || 0) > ORG_TTL) return null;
    return raw;
  } catch { return null; }
}

function _defaultOrg(orgId) {
  return {
    orgId,
    displayName: "My Organization",
    tier:        "enterprise",
    orgs:        { [orgId]: { label: "Default", createdAt: Date.now() } },
    activeOrgId: orgId,
    updatedAt:   Date.now(),
  };
}

// ── Phase 1007: Role hierarchy ────────────────────────────────────────────────

// Ordered from most to least privileged
const ROLES = {
  admin:    { level: 3, label: "Admin",    permissions: ["executeWorkflow","deploy","export","restoreReplay","manageTeam","changeChannel","manageOrg","approveDeployment"] },
  operator: { level: 2, label: "Operator", permissions: ["executeWorkflow","deploy","export","restoreReplay","approveDeployment"] },
  viewer:   { level: 1, label: "Viewer",   permissions: ["restoreReplay","export"] },
};

function _resolveRolePermissions(role) {
  return new Set(ROLES[role]?.permissions || ROLES.viewer.permissions);
}

function _checkRolePermission(role, action) {
  const perms = _resolveRolePermissions(role);
  const allowed = perms.has(action);
  return {
    allowed,
    role,
    roleLevel: ROLES[role]?.level || 0,
    reason: allowed ? null : `Action '${action}' not permitted for role '${role}'`,
  };
}

function _canEscalate(fromRole, toRole) {
  const from = ROLES[fromRole]?.level || 0;
  const to   = ROLES[toRole]?.level   || 0;
  return from > to;  // can only grant roles below own level
}

// ── Phase 1008: Enterprise audit exports ─────────────────────────────────────

function _buildAuditExport(auditLog, label = "") {
  const now = Date.now();
  const counts = {};
  auditLog.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });

  // Privacy-safe: no raw output, no user content — only type counts + outcome summaries
  const outcomes = { ok: 0, rejected: 0, error: 0 };
  auditLog.forEach(e => {
    const o = e.outcome || "ok";
    if (outcomes[o] !== undefined) outcomes[o]++;
  });

  return {
    id:          `aexp_${now.toString(36)}`,
    label:       (label || `Audit Export ${new Date(now).toLocaleDateString()}`).slice(0, 50),
    exportedAt:  now,
    eventCount:  auditLog.length,
    typeCounts:  counts,
    outcomes,
    window:      auditLog.length > 0
      ? { from: auditLog[auditLog.length - 1]?.ts, to: auditLog[0]?.ts }
      : null,
  };
}

// ── Phase 1009: Deployment governance chains ──────────────────────────────────

const DEPLOY_CHAIN_STAGES = ["request", "review", "approve", "execute", "verify"];

function _buildDeployChain(meta = {}) {
  const now = Date.now();
  return {
    id:          `dchain_${now.toString(36)}`,
    label:       (meta.label || "Deployment").slice(0, 40),
    createdAt:   now,
    expiresAt:   now + APPR_STALE,
    stage:       "request",  // current stage
    stages:      DEPLOY_CHAIN_STAGES,
    approvedBy:  null,
    rollbackId:  meta.rollbackId || null,
    validated:   false,
  };
}

function _advanceDeployChain(chain, role) {
  const currentIdx = DEPLOY_CHAIN_STAGES.indexOf(chain.stage);
  if (currentIdx === -1 || currentIdx >= DEPLOY_CHAIN_STAGES.length - 1) {
    return { ok: false, reason: "Chain already complete or invalid stage" };
  }
  const nextStage = DEPLOY_CHAIN_STAGES[currentIdx + 1];

  // Approval stage requires operator or admin
  if (nextStage === "approve" && !_checkRolePermission(role, "approveDeployment").allowed) {
    return { ok: false, reason: `Role '${role}' cannot approve deployments` };
  }

  return {
    ok:    true,
    chain: { ...chain, stage: nextStage, approvedBy: nextStage === "approve" ? role : chain.approvedBy },
  };
}

// ── Phase 1010: Compliance-safe logging ──────────────────────────────────────

const COMPLIANCE_EVENT_TYPES = new Set([
  "deploy_approved", "deploy_rejected", "deploy_executed", "deploy_rollback",
  "workflow_authorized", "workflow_blocked", "permission_granted", "permission_revoked",
  "audit_exported", "org_created", "org_switched", "role_assigned",
  "policy_enforced", "policy_violated", "replay_restored", "replay_blocked",
]);

function _buildComplianceEntry(eventType, meta = {}) {
  return {
    id:       `cmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 4)}`,
    type:     eventType,
    ts:       Date.now(),
    orgId:    localStorage.getItem("jarvis_org_id") || "org_default",
    operatorId: localStorage.getItem("jarvis_operator_id") || "default",
    role:     meta.role || "operator",
    outcome:  meta.outcome || "ok",
    // No raw output, no user content
  };
}

// ── Phase 1011: Enterprise observability ─────────────────────────────────────

function _buildEnterpriseHealthSnapshot(complianceLog, deployChains) {
  const now  = Date.now();
  const win  = 24 * 60 * 60 * 1000;
  const recent = complianceLog.filter(e => now - (e.ts || 0) < win);

  const deploys   = deployChains.length;
  const approved  = deployChains.filter(c => c.stage === "verify" || c.stage === "execute").length;
  const expired   = deployChains.filter(c => now > c.expiresAt).length;
  const violations = recent.filter(e => e.type === "policy_violated").length;

  let score = 100;
  if (expired > 0)      score -= Math.min(expired * 15, 30);
  if (violations > 0)   score -= Math.min(violations * 10, 25);
  score = Math.max(0, score);

  return {
    ts: now,
    score,
    label: score >= 80 ? "HEALTHY" : score >= 55 ? "DEGRADED" : "CRITICAL",
    color: score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
    deploys,
    approved,
    expired,
    violations,
    recentEvents: recent.length,
  };
}

// ── Phase 1012: Org-wide policy enforcement ───────────────────────────────────

const ORG_POLICIES = {
  requireDeployChain:       true,   // all deploys must go through chain
  maxDeployChainAgeMs:      APPR_STALE,
  blockCrossOrgExecution:   true,
  auditAllRoleChanges:      true,
  replayRetentionMs:        6 * 60 * 60 * 1000,
  maxConcurrentDeployChains: 3,
};

function _enforceOrgPolicy(policyKey, context = {}) {
  const policy = ORG_POLICIES[policyKey];
  if (policy === undefined) return { enforced: false, reason: "Unknown policy" };

  switch (policyKey) {
    case "requireDeployChain":
      return { enforced: true, compliant: !context.skipChain, reason: context.skipChain ? "Deploy chain required" : null };
    case "blockCrossOrgExecution":
      return { enforced: true, compliant: context.orgId === context.activeOrgId || !context.orgId,
               reason: context.orgId !== context.activeOrgId ? "Cross-org execution blocked" : null };
    case "maxConcurrentDeployChains":
      return { enforced: true, compliant: (context.activeChains || 0) <= policy,
               reason: (context.activeChains || 0) > policy ? `Max ${policy} concurrent deploy chains` : null };
    default:
      return { enforced: true, compliant: true, reason: null };
  }
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useEnterpriseOrganization({ currentRole = "operator" } = {}) {
  const [orgState,      setOrgState]      = useState(null);
  const [complianceLog, setComplianceLog] = useState([]);
  const [auditExports,  setAuditExports]  = useState([]);
  const [deployChains,  setDeployChains]  = useState([]);
  const [initialized,   setInitialized]   = useState(false);

  useEffect(() => {
    const orgId  = _getOrCreateOrgId();
    const saved  = _loadOrgState();
    const org    = saved || _defaultOrg(orgId);
    setOrgState(org);
    if (!saved) _save(ORG_KEY, org);

    const now = Date.now();
    setComplianceLog(_load(COMP_KEY, []).filter(e => now - (e.ts || 0) < COMP_TTL));
    setAuditExports(_load(EXPORT_KEY, []));
    setDeployChains(_load("jarvis_deploy_chains", []).filter(c => now < (c.expiresAt || 0)));
    setInitialized(true);
  }, []);

  // Register or switch organization
  const switchOrg = useCallback((orgId, label = "") => {
    setOrgState(prev => {
      if (!prev) return prev;
      const orgs = { ...prev.orgs };
      if (Object.keys(orgs).length >= ORG_MAX && !orgs[orgId]) {
        const oldest = Object.keys(orgs).sort((a, b) =>
          (orgs[a].createdAt || 0) - (orgs[b].createdAt || 0)
        )[0];
        delete orgs[oldest];
      }
      if (!orgs[orgId]) orgs[orgId] = { label: label.slice(0, 30) || orgId, createdAt: Date.now() };
      const next = { ...prev, orgs, activeOrgId: orgId, updatedAt: Date.now() };
      _save(ORG_KEY, next);
      return next;
    });
    recordCompliance("org_switched", { outcome: "ok" });
  }, []);  // recordCompliance defined below — ref-stable via useCallback

  // Record a compliance event
  const recordCompliance = useCallback((eventType, meta = {}) => {
    if (!COMPLIANCE_EVENT_TYPES.has(eventType)) return;
    const entry = _buildComplianceEntry(eventType, { ...meta, role: currentRole });
    setComplianceLog(prev => {
      const next = [entry, ...prev].filter(e => Date.now() - (e.ts || 0) < COMP_TTL).slice(0, COMP_MAX);
      _save(COMP_KEY, next);
      return next;
    });
  }, [currentRole]);

  // Check role permission
  const checkRole = useCallback((action) => {
    return _checkRolePermission(currentRole, action);
  }, [currentRole]);

  // Check privilege escalation safety
  const canGrantRole = useCallback((targetRole) => {
    return _canEscalate(currentRole, targetRole);
  }, [currentRole]);

  // Export audit summary (Phase 1008)
  const exportAudit = useCallback((auditLog, label = "") => {
    const exp = _buildAuditExport(auditLog, label);
    setAuditExports(prev => {
      const next = [exp, ...prev].slice(0, EXPORT_MAX);
      _save(EXPORT_KEY, next);
      return next;
    });
    recordCompliance("audit_exported", { outcome: "ok" });
    return exp;
  }, [recordCompliance]);

  // Create deployment governance chain (Phase 1009)
  const createDeployChain = useCallback((meta = {}) => {
    const policyCheck = _enforceOrgPolicy("maxConcurrentDeployChains", {
      activeChains: deployChains.filter(c => c.stage !== "verify").length,
    });
    if (!policyCheck.compliant) return { ok: false, reason: policyCheck.reason };

    const chain = _buildDeployChain(meta);
    setDeployChains(prev => {
      const next = [chain, ...prev].filter(c => Date.now() < (c.expiresAt || 0)).slice(0, 10);
      _save("jarvis_deploy_chains", next);
      return next;
    });
    recordCompliance("deploy_approved", { outcome: "pending" });
    return { ok: true, chain };
  }, [deployChains, recordCompliance]);

  // Advance a deployment chain stage (Phase 1009)
  const advanceDeployChain = useCallback((chainId) => {
    let result = null;
    setDeployChains(prev => {
      const chain = prev.find(c => c.id === chainId);
      if (!chain) { result = { ok: false, reason: "Chain not found" }; return prev; }
      result = _advanceDeployChain(chain, currentRole);
      if (!result.ok) return prev;
      const next = prev.map(c => c.id === chainId ? result.chain : c);
      _save("jarvis_deploy_chains", next);
      return next;
    });
    if (result?.ok) recordCompliance("deploy_executed", { outcome: "ok", role: currentRole });
    return result;
  }, [currentRole, recordCompliance]);

  // Enforce org policy
  const enforcePolicy = useCallback((policyKey, context = {}) => {
    const activeOrgId = orgState?.activeOrgId || "org_default";
    const result = _enforceOrgPolicy(policyKey, { ...context, activeOrgId });
    if (!result.compliant) recordCompliance("policy_violated", { outcome: "blocked" });
    return result;
  }, [orgState, recordCompliance]);

  // Enterprise health snapshot (Phase 1011)
  const enterpriseHealth = useMemo(() =>
    _buildEnterpriseHealthSnapshot(complianceLog, deployChains),
    [complianceLog, deployChains]
  );

  // Role info
  const roleInfo = useMemo(() => ROLES[currentRole] || ROLES.viewer, [currentRole]);

  // Active deploy chains (not yet verified)
  const activeDeployChains = useMemo(() => {
    const now = Date.now();
    return deployChains.filter(c => c.stage !== "verify" && now < (c.expiresAt || 0));
  }, [deployChains]);

  // Enterprise status pill for operator bar
  const enterpriseStatusPill = useMemo(() => {
    if (enterpriseHealth.label !== "HEALTHY") {
      return {
        label: enterpriseHealth.label,
        color: enterpriseHealth.color,
        detail: enterpriseHealth.expired > 0
          ? `${enterpriseHealth.expired} expired chain(s)`
          : enterpriseHealth.violations > 0
            ? `${enterpriseHealth.violations} policy violation(s)`
            : null,
      };
    }
    if (activeDeployChains.length > 0) {
      return { label: "DEPLOY", color: "var(--op-blue)", detail: `${activeDeployChains.length} chain(s) active` };
    }
    return null;
  }, [enterpriseHealth, activeDeployChains]);

  return {
    initialized,
    orgState,
    roleInfo,
    complianceLog,
    auditExports,
    deployChains,
    activeDeployChains,
    enterpriseHealth,
    enterpriseStatusPill,
    orgPolicies: ORG_POLICIES,
    // Actions
    switchOrg,
    recordCompliance,
    checkRole,
    canGrantRole,
    exportAudit,
    createDeployChain,
    advanceDeployChain,
    enforcePolicy,
  };
}
