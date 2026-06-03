// Phase 961-963: Subscription foundation + usage metering + team workspace foundation.
// Lightweight subscription states, replay-safe entitlement persistence,
// feature-access boundaries, operator-tier isolation, usage metering,
// team workspace sharing, collaboration continuity.
//
// Consolidates three phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 5 workspace members, 500 metering events, 30-day retention.

import { useState, useEffect, useCallback, useMemo } from "react";

const SUB_KEY     = "jarvis_subscription";
const METER_KEY   = "jarvis_usage_metering";
const TEAM_KEY    = "jarvis_team_workspace";
const SUB_TTL     = 30 * 24 * 60 * 60 * 1000;   // 30d entitlement TTL
const METER_MAX   = 500;
const MEMBER_MAX  = 5;
const METER_WIN   = 24 * 60 * 60 * 1000;         // 24h metering window

// ── Phase 961: Subscription tiers ────────────────────────────────────────────

const TIERS = {
  free:       { label: "Free",       color: "var(--op-text2)",  quotas: { workflows: 20,  deploys: 5,   exports: 2,  workspaces: 1 } },
  starter:    { label: "Starter",    color: "var(--op-blue)",   quotas: { workflows: 100, deploys: 20,  exports: 10, workspaces: 1 } },
  pro:        { label: "Pro",        color: "var(--op-green)",  quotas: { workflows: 500, deploys: 100, exports: 50, workspaces: 3 } },
  enterprise: { label: "Enterprise", color: "var(--op-purple, #a064ff)", quotas: { workflows: -1, deploys: -1, exports: -1, workspaces: 10 } },
};

const FEATURE_GATES = {
  team_workspace:       ["pro", "enterprise"],
  cloud_sync:           ["pro", "enterprise"],
  advanced_diagnostics: ["starter", "pro", "enterprise"],
  replay_export:        ["starter", "pro", "enterprise"],
  deployment_coord:     ["pro", "enterprise"],
};

function _loadSubscription() {
  try {
    const raw = JSON.parse(localStorage.getItem(SUB_KEY) || "null");
    if (!raw || Date.now() - (raw.updatedAt || 0) > SUB_TTL) return null;
    return raw;
  } catch { return null; }
}

function _defaultSubscription(operatorId) {
  return {
    operatorId:  operatorId || localStorage.getItem("jarvis_operator_id") || "default",
    tier:        "free",
    status:      "active",   // active | suspended | trial | expired
    trialEndsAt: null,
    updatedAt:   Date.now(),
  };
}

// ── Phase 962: Usage metering ─────────────────────────────────────────────────

const METERABLE_EVENTS = new Set([
  "workflow_run", "replay_restore", "deploy_coord", "diag_export",
  "automation_exec", "workspace_save", "workspace_restore", "api_action",
]);

function _loadMetering() {
  try { return JSON.parse(localStorage.getItem(METER_KEY) || "[]"); } catch { return []; }
}

function _aggregate(events, windowMs = METER_WIN) {
  const now = Date.now();
  const recent = events.filter(e => now - (e.ts || 0) < windowMs);
  const counts = {};
  recent.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
  return counts;
}

function _quotaCheck(tier, counts) {
  const quotas = TIERS[tier]?.quotas || TIERS.free.quotas;
  const warnings = [];
  const overLimit = [];

  if (quotas.workflows !== -1 && (counts.workflow_run || 0) >= quotas.workflows) {
    overLimit.push("workflow executions");
  } else if (quotas.workflows !== -1 && (counts.workflow_run || 0) >= quotas.workflows * 0.8) {
    warnings.push(`Workflow quota ${Math.round(((counts.workflow_run || 0) / quotas.workflows) * 100)}% used`);
  }

  if (quotas.deploys !== -1 && (counts.deploy_coord || 0) >= quotas.deploys) {
    overLimit.push("deployment actions");
  }

  if (quotas.exports !== -1 && (counts.diag_export || 0) >= quotas.exports) {
    overLimit.push("diagnostic exports");
  }

  return { warnings, overLimit, withinQuota: overLimit.length === 0 };
}

// ── Phase 963: Team workspace ─────────────────────────────────────────────────

function _loadTeam() {
  try { return JSON.parse(localStorage.getItem(TEAM_KEY) || "null"); } catch { return null; }
}

function _validateTeamAccess(subscription, feature) {
  const tier = subscription?.tier || "free";
  const allowed = FEATURE_GATES[feature] || [];
  return allowed.includes(tier);
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useSubscriptionFoundation() {
  const [subscription, setSubscription] = useState(null);
  const [metering,     setMetering]     = useState([]);
  const [team,         setTeam]         = useState(null);
  const [initialized,  setInitialized]  = useState(false);

  useEffect(() => {
    const saved = _loadSubscription();
    const sub   = saved || _defaultSubscription();
    setSubscription(sub);
    if (!saved) _save(SUB_KEY, sub);

    setMetering(_loadMetering());
    setTeam(_loadTeam());
    setInitialized(true);
  }, []);

  // Record a meterable event
  const recordUsage = useCallback((eventType) => {
    if (!METERABLE_EVENTS.has(eventType)) return;
    const entry = { type: eventType, ts: Date.now() };
    setMetering(prev => {
      const next = [entry, ...prev].slice(0, METER_MAX);
      _save(METER_KEY, next);
      return next;
    });
  }, []);

  // Upgrade tier (operator-triggered, no external calls — sets local entitlement)
  const setTier = useCallback((tier) => {
    if (!TIERS[tier]) return;
    setSubscription(prev => {
      const next = { ...(prev || _defaultSubscription()), tier, updatedAt: Date.now() };
      _save(SUB_KEY, next);
      return next;
    });
  }, []);

  // Check feature access
  const canAccess = useCallback((feature) => {
    return _validateTeamAccess(subscription, feature);
  }, [subscription]);

  // Add team member (bounded)
  const addTeamMember = useCallback((memberId, role = "member") => {
    if (!memberId) return { ok: false, reason: "No member ID" };
    if (!_validateTeamAccess(subscription, "team_workspace")) {
      return { ok: false, reason: "Team workspace requires Pro or Enterprise tier" };
    }
    setTeam(prev => {
      const current = prev || { members: {}, createdAt: Date.now() };
      if (Object.keys(current.members).length >= MEMBER_MAX && !current.members[memberId]) {
        return { ok: false, reason: `Team workspace limited to ${MEMBER_MAX} members` };
      }
      const next = { ...current, members: { ...current.members, [memberId]: { role, joinedAt: Date.now() } } };
      _save(TEAM_KEY, next);
      return next;
    });
    return { ok: true };
  }, [subscription]);

  // 24h usage aggregation
  const usageCounts = useMemo(() => _aggregate(metering), [metering]);

  // Quota status
  const quotaStatus = useMemo(() =>
    _quotaCheck(subscription?.tier || "free", usageCounts),
    [subscription, usageCounts]
  );

  // Tier info
  const tierInfo = useMemo(() =>
    TIERS[subscription?.tier || "free"],
    [subscription]
  );

  // Subscription summary for operator bar
  const subscriptionSummary = useMemo(() => ({
    tier:         subscription?.tier || "free",
    label:        tierInfo?.label || "Free",
    color:        tierInfo?.color || "var(--op-text2)",
    status:       subscription?.status || "active",
    withinQuota:  quotaStatus.withinQuota,
    topWarning:   quotaStatus.warnings[0] || null,
    topOverLimit: quotaStatus.overLimit[0] || null,
  }), [subscription, tierInfo, quotaStatus]);

  return {
    initialized,
    subscription,
    subscriptionSummary,
    tierInfo,
    metering,
    usageCounts,
    quotaStatus,
    team,
    // Actions
    recordUsage,
    setTier,
    canAccess,
    addTeamMember,
  };
}
