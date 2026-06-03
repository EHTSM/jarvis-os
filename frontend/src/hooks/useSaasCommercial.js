// Phase 1126-1135: Subscription plan maturity + usage quota enforcement +
// team billing + SaaS operations dashboard + customer lifecycle +
// payment failure recovery + SaaS analytics + multi-tenant isolation +
// SaaS performance hardening + stress validation.
//
// Consolidates ten phases. No external calls. No autonomous execution.
// All state: localStorage-only. Privacy-safe: counts/scores/durations only.
// Bounded: 5 plans, 200 quota events, 10 billing records, 50 analytics events, 15 lifecycle records, 15 isolation events.

import { useState, useEffect, useCallback, useMemo } from "react";

const PLAN_KEY    = "jarvis_saas_plan";
const QUOTA_KEY   = "jarvis_saas_quota";
const BILL_KEY    = "jarvis_saas_billing";
const ANAL_KEY    = "jarvis_saas_analytics";
const LCY_KEY     = "jarvis_saas_lifecycle";
const TISO_KEY    = "jarvis_tenant_isolation";

const QUOTA_MAX   = 200;
const BILL_MAX    = 10;
const ANAL_MAX    = 50;
const LCY_MAX     = 15;
const TISO_MAX    = 15;

const QUOTA_TTL   = 30 * 24 * 60 * 60 * 1000;
const BILL_TTL    = 90 * 24 * 60 * 60 * 1000;
const ANAL_TTL    = 30 * 24 * 60 * 60 * 1000;
const LCY_TTL     = 90 * 24 * 60 * 60 * 1000;
const TISO_TTL    = 24 * 60 * 60 * 1000;

// ── Phase 1126: Subscription plans ───────────────────────────────────────────

const PLAN_DEFINITIONS = {
  free:       { label: "Free",       tier: 0, workflowLimit: 50,  deployLimit: 5,  pluginLimit: 2,  workspaces: 1, replayLimit: 10  },
  pro:        { label: "Pro",        tier: 1, workflowLimit: 500, deployLimit: 50, pluginLimit: 10, workspaces: 3, replayLimit: 100 },
  team:       { label: "Team",       tier: 2, workflowLimit: 2000,deployLimit: 200,pluginLimit: 25, workspaces: 10,replayLimit: 500 },
  enterprise: { label: "Enterprise", tier: 3, workflowLimit: null,deployLimit: null,pluginLimit: null,workspaces: null,replayLimit: null },
};

const PLAN_FEATURES = {
  free:       new Set(["basic_workflows", "basic_replay", "basic_debug"]),
  pro:        new Set(["basic_workflows","advanced_workflows","basic_replay","advanced_replay","basic_debug","advanced_debug","deployment_basic"]),
  team:       new Set(["basic_workflows","advanced_workflows","basic_replay","advanced_replay","basic_debug","advanced_debug","deployment_basic","deployment_advanced","team_workspaces","priority_support"]),
  enterprise: new Set(["basic_workflows","advanced_workflows","basic_replay","advanced_replay","basic_debug","advanced_debug","deployment_basic","deployment_advanced","team_workspaces","priority_support","enterprise_sso","compliance_exports","custom_plugins"]),
};

function _buildPlanState(planId = "free") {
  const plan = PLAN_DEFINITIONS[planId] || PLAN_DEFINITIONS.free;
  return {
    planId,
    ...plan,
    features:    [...(PLAN_FEATURES[planId] || PLAN_FEATURES.free)],
    activatedAt: Date.now(),
    gracePeriod: false,
    graceEndsAt: null,
  };
}

function _canAccess(planState, feature) {
  if (!planState) return false;
  const features = PLAN_FEATURES[planState.planId] || PLAN_FEATURES.free;
  return features.has(feature);
}

// ── Phase 1127: Usage quota enforcement ──────────────────────────────────────

const QUOTA_DIMENSIONS = ["workflows", "deployments", "replays", "plugins", "diagnostics_exports"];

function _buildQuotaState(planState) {
  if (!planState) return null;
  const plan = PLAN_DEFINITIONS[planState.planId] || PLAN_DEFINITIONS.free;
  return {
    workflows:          { used: 0, limit: plan.workflowLimit,  pct: 0 },
    deployments:        { used: 0, limit: plan.deployLimit,    pct: 0 },
    replays:            { used: 0, limit: plan.replayLimit,    pct: 0 },
    plugins:            { used: 0, limit: plan.pluginLimit,    pct: 0 },
    diagnostics_exports:{ used: 0, limit: 10,                  pct: 0 },
    resetAt:            _nextMonthStart(),
  };
}

function _nextMonthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

function _incrementQuota(quotaState, dimension, amount = 1) {
  if (!quotaState || !QUOTA_DIMENSIONS.includes(dimension)) return quotaState;
  const dim = quotaState[dimension];
  if (!dim) return quotaState;
  const newUsed = dim.used + amount;
  const limit   = dim.limit;
  const pct     = limit !== null ? Math.min(100, Math.round((newUsed / limit) * 100)) : 0;
  return { ...quotaState, [dimension]: { ...dim, used: newUsed, pct } };
}

function _quotaExceeded(quotaState, dimension) {
  if (!quotaState) return false;
  const dim = quotaState[dimension];
  if (!dim || dim.limit === null) return false;
  return dim.used >= dim.limit;
}

// ── Phase 1128: Team billing ──────────────────────────────────────────────────

const BILLING_STATES = ["active", "past_due", "grace_period", "suspended", "cancelled"];

function _buildBillingRecord({ planId, amount, period }) {
  return {
    id:        `bill_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    planId,
    amount,    // numeric only — no PII
    period,    // "monthly" | "annual"
    status:    "active",
    ts:        Date.now(),
    updatedAt: Date.now(),
  };
}

function _applyGracePeriod(planState, graceDays = 7) {
  const graceEndsAt = Date.now() + graceDays * 24 * 60 * 60 * 1000;
  return { ...planState, gracePeriod: true, graceEndsAt };
}

// ── Phase 1130: Customer lifecycle ───────────────────────────────────────────

const LIFECYCLE_EVENTS = new Set([
  "onboarding_started", "onboarding_completed", "first_workflow",
  "first_deployment", "first_plugin", "plan_upgraded", "plan_downgraded",
  "billing_failure", "billing_recovered", "workspace_created", "churn_risk",
]);

function _buildLifecycleEvent(type, meta = {}) {
  if (!LIFECYCLE_EVENTS.has(type)) return null;
  return {
    id:   `lcy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    ts:   Date.now(),
    // privacy-safe meta: only booleans, counts, tier names
    ...(typeof meta.fromPlan   === "string"  ? { fromPlan:   meta.fromPlan   } : {}),
    ...(typeof meta.toPlan     === "string"  ? { toPlan:     meta.toPlan     } : {}),
    ...(typeof meta.stepIndex  === "number"  ? { stepIndex:  meta.stepIndex  } : {}),
    ...(typeof meta.recovered  === "boolean" ? { recovered:  meta.recovered  } : {}),
  };
}

// ── Phase 1131: Payment failure recovery ─────────────────────────────────────

const GRACE_DAYS_BY_PLAN = { free: 0, pro: 7, team: 14, enterprise: 30 };

function _buildPaymentRecovery(planState) {
  const graceDays = GRACE_DAYS_BY_PLAN[planState?.planId] || 7;
  return {
    active:          true,
    graceDays,
    graceEndsAt:     Date.now() + graceDays * 24 * 60 * 60 * 1000,
    entitlementsKept: true, // keep entitlements during grace
    retryCount:      0,
    maxRetries:      3,
  };
}

// ── Phase 1132: SaaS analytics — privacy-safe aggregates ─────────────────────

const SAAS_ANALYTICS_TYPES = new Set([
  "workflow_engaged", "replay_used", "deployment_run",
  "plugin_activated", "upgrade_considered", "upgrade_completed",
  "downgrade_completed", "session_long", "quota_near",
]);

function _buildAnalyticsEvent(type, meta = {}) {
  if (!SAAS_ANALYTICS_TYPES.has(type)) return null;
  return {
    id:   `anal_${Date.now()}`,
    type,
    ts:   Date.now(),
    ...(typeof meta.planId      === "string"  ? { planId:      meta.planId      } : {}),
    ...(typeof meta.durationMin === "number"  ? { durationMin: meta.durationMin } : {}),
    ...(typeof meta.quotaPct    === "number"  ? { quotaPct:    meta.quotaPct    } : {}),
    ...(typeof meta.success     === "boolean" ? { success:     meta.success     } : {}),
  };
}

// ── Phase 1133: Multi-tenant isolation ────────────────────────────────────────

const TENANT_ISOLATED_PREFIXES = [
  "jarvis_saas_plan_",
  "jarvis_saas_quota_",
  "jarvis_saas_billing_",
  "jarvis_tenant_",
];

function _scanTenantIsolation(activeTenantId) {
  if (!activeTenantId) return [];
  const violations = [];
  try {
    for (let i = 0; i < Math.min(localStorage.length, 100); i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const isIsolated = TENANT_ISOLATED_PREFIXES.some(p => key.startsWith(p));
      if (isIsolated && !key.endsWith(activeTenantId)) {
        violations.push({ key, reason: "Cross-tenant SaaS state bleed" });
      }
    }
  } catch {}
  return violations.slice(0, 5);
}

// ── Phase 1134: Perf hardening — bounded entitlement cache ───────────────────

const _entitlementCache = new Map();
const ENT_CACHE_TTL = 30 * 1000; // 30s

function _cachedEntitlement(planId, feature, compute) {
  const key = `${planId}:${feature}`;
  const cached = _entitlementCache.get(key);
  if (cached && Date.now() - cached.ts < ENT_CACHE_TTL) return cached.val;
  const val = compute();
  if (_entitlementCache.size > 50) {
    const oldest = [..._entitlementCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _entitlementCache.delete(oldest[0]);
  }
  _entitlementCache.set(key, { val, ts: Date.now() });
  return val;
}

// ── Phase 1129/1135: SaaS dashboard scoring ───────────────────────────────────

function _buildSaasDashboard({ planState, quotaState, billingRecords, lifecycleEvents, survivabilityScore = 100 } = {}) {
  const plan = PLAN_DEFINITIONS[planState?.planId] || PLAN_DEFINITIONS.free;

  // Quota health: highest utilization across dimensions
  const quotaPcts = QUOTA_DIMENSIONS.map(d => quotaState?.[d]?.pct ?? 0);
  const maxQuotaPct = Math.max(0, ...quotaPcts);
  const quotaHealth = maxQuotaPct >= 90 ? "critical" : maxQuotaPct >= 75 ? "warning" : "healthy";

  // Billing health
  const latestBill = billingRecords[0];
  const billingHealth = latestBill?.status === "active" ? "healthy"
    : latestBill?.status === "grace_period" ? "warning"
    : latestBill ? "critical" : "healthy";

  // Lifecycle health
  const recentChurnRisk = lifecycleEvents.some(
    e => e.type === "churn_risk" && Date.now() - e.ts < 7 * 24 * 60 * 60 * 1000
  );

  // Composite SaaS health
  let score = 100;
  if (quotaHealth === "critical")  score -= 20;
  else if (quotaHealth === "warning") score -= 10;
  if (billingHealth === "critical") score -= 30;
  else if (billingHealth === "warning") score -= 15;
  if (recentChurnRisk)             score -= 10;
  if (survivabilityScore < 70)     score -= 15;
  score = Math.max(0, score);

  return {
    ts:               Date.now(),
    score,
    label:            score >= 80 ? "HEALTHY" : score >= 55 ? "DEGRADED" : "CRITICAL",
    color:            score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
    planLabel:        plan.label,
    quotaHealth,
    maxQuotaPct,
    billingHealth,
    recentChurnRisk,
    survivabilityScore,
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

export function useSaasCommercial({
  survivabilityScore = 100,
} = {}) {
  const [planState,       setPlanState]       = useState(null);
  const [quotaState,      setQuotaState]      = useState(null);
  const [billingRecords,  setBillingRecords]  = useState([]);
  const [analyticsEvents, setAnalyticsEvents] = useState([]);
  const [lifecycleEvents, setLifecycleEvents] = useState([]);
  const [isoEvents,       setIsoEvents]       = useState([]);
  const [paymentRecovery, setPaymentRecovery] = useState(null);
  const [initialized,     setInitialized]     = useState(false);

  const activeTenantId = useMemo(() =>
    localStorage.getItem("jarvis_operator_id") || "default",
    []
  );

  const evaluate = useCallback(() => {
    const now = Date.now();

    // TTL-filter arrays
    setBillingRecords(prev => {
      const next = prev.filter(b => now - (b.ts || 0) < BILL_TTL).slice(0, BILL_MAX);
      _save(BILL_KEY, next);
      return next;
    });
    setAnalyticsEvents(prev => {
      const next = prev.filter(e => now - (e.ts || 0) < ANAL_TTL).slice(0, ANAL_MAX);
      _save(ANAL_KEY, next);
      return next;
    });
    setLifecycleEvents(prev => {
      const next = prev.filter(e => now - (e.ts || 0) < LCY_TTL).slice(0, LCY_MAX);
      _save(LCY_KEY, next);
      return next;
    });

    // Grace period check — expire if past grace end
    setPlanState(prev => {
      if (!prev?.gracePeriod) return prev;
      if (Date.now() > (prev.graceEndsAt || 0)) {
        const next = { ...prev, gracePeriod: false, graceEndsAt: null };
        _save(PLAN_KEY, next);
        return next;
      }
      return prev;
    });

    // Tenant isolation scan
    const violations = _scanTenantIsolation(activeTenantId);
    if (violations.length > 0) {
      setIsoEvents(prev => {
        const entries = violations.map(v => ({ ...v, ts: now }));
        const next = [...entries, ...prev]
          .filter(e => now - (e.ts || 0) < TISO_TTL)
          .slice(0, TISO_MAX);
        _save(TISO_KEY, next);
        return next;
      });
    }
  }, [activeTenantId]);

  useEffect(() => {
    const now = Date.now();
    const savedPlan = _load(PLAN_KEY, null);
    const plan = savedPlan ?? _buildPlanState("free");
    if (!savedPlan) _save(PLAN_KEY, plan);
    setPlanState(plan);
    setQuotaState(_load(QUOTA_KEY, null) ?? _buildQuotaState(plan));
    setBillingRecords(_load(BILL_KEY, []).filter(b => now - (b.ts || 0) < BILL_TTL));
    setAnalyticsEvents(_load(ANAL_KEY, []).filter(e => now - (e.ts || 0) < ANAL_TTL));
    setLifecycleEvents(_load(LCY_KEY, []).filter(e => now - (e.ts || 0) < LCY_TTL));
    setIsoEvents(_load(TISO_KEY, []).filter(e => now - (e.ts || 0) < TISO_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // ── Lifecycle actions (Phase 1130) — declared first so other callbacks can depend on it ──

  const recordLifecycle = useCallback((type, meta = {}) => {
    const evt = _buildLifecycleEvent(type, meta);
    if (!evt) return;
    setLifecycleEvents(prev => {
      const next = [evt, ...prev].filter(e => Date.now() - (e.ts || 0) < LCY_TTL).slice(0, LCY_MAX);
      _save(LCY_KEY, next);
      return next;
    });
  }, []);

  // ── Plan actions (Phase 1126) ──────────────────────────────────────────────

  const activatePlan = useCallback((planId) => {
    if (!PLAN_DEFINITIONS[planId]) return;
    const plan = _buildPlanState(planId);
    const quota = _buildQuotaState(plan);
    setPlanState(plan);
    setQuotaState(quota);
    _save(PLAN_KEY, plan);
    _save(QUOTA_KEY, quota);
    recordLifecycle("plan_upgraded", { toPlan: planId });
  }, [recordLifecycle]);

  // ── Quota actions (Phase 1127) ────────────────────────────────────────────

  const consumeQuota = useCallback((dimension, amount = 1) => {
    setQuotaState(prev => {
      if (_quotaExceeded(prev, dimension)) return prev; // hard stop
      const next = _incrementQuota(prev, dimension, amount);
      _save(QUOTA_KEY, next);
      // Record near-quota analytics
      if (next[dimension]?.pct >= 80) {
        const evt = _buildAnalyticsEvent("quota_near", { planId: planState?.planId, quotaPct: next[dimension].pct });
        if (evt) {
          setAnalyticsEvents(ae => {
            const aeNext = [evt, ...ae].filter(e => Date.now() - (e.ts || 0) < ANAL_TTL).slice(0, ANAL_MAX);
            _save(ANAL_KEY, aeNext);
            return aeNext;
          });
        }
      }
      return next;
    });
  }, [planState?.planId]);

  const checkQuota = useCallback((dimension) =>
    !_quotaExceeded(quotaState, dimension),
    [quotaState]
  );

  const checkFeature = useCallback((feature) =>
    _cachedEntitlement(planState?.planId || "free", feature, () => _canAccess(planState, feature)),
    [planState]
  );

  // ── Billing actions (Phase 1128) ──────────────────────────────────────────

  const recordBilling = useCallback(({ planId, amount, period } = {}) => {
    const record = _buildBillingRecord({ planId, amount, period });
    setBillingRecords(prev => {
      const next = [record, ...prev].slice(0, BILL_MAX);
      _save(BILL_KEY, next);
      return next;
    });
    return record.id;
  }, []);

  const triggerPaymentFailure = useCallback(() => {
    setPlanState(prev => {
      if (!prev) return prev;
      const next = _applyGracePeriod(prev, GRACE_DAYS_BY_PLAN[prev.planId] ?? 7);
      _save(PLAN_KEY, next);
      return next;
    });
    setBillingRecords(prev => {
      const next = prev.map((b, i) => i === 0 ? { ...b, status: "past_due", updatedAt: Date.now() } : b);
      _save(BILL_KEY, next);
      return next;
    });
    setPaymentRecovery(_buildPaymentRecovery(planState));
    recordLifecycle("billing_failure");
  }, [planState, recordLifecycle]);

  const recoverPayment = useCallback(() => {
    setPlanState(prev => {
      if (!prev) return prev;
      const next = { ...prev, gracePeriod: false, graceEndsAt: null };
      _save(PLAN_KEY, next);
      return next;
    });
    setBillingRecords(prev => {
      const next = prev.map((b, i) => i === 0 ? { ...b, status: "active", updatedAt: Date.now() } : b);
      _save(BILL_KEY, next);
      return next;
    });
    setPaymentRecovery(null);
    recordLifecycle("billing_recovered", { recovered: true });
  }, [recordLifecycle]);

  // ── Analytics (Phase 1132) ────────────────────────────────────────────────

  const recordSaasAnalytics = useCallback((type, meta = {}) => {
    const evt = _buildAnalyticsEvent(type, { ...meta, planId: planState?.planId });
    if (!evt) return;
    setAnalyticsEvents(prev => {
      const next = [evt, ...prev].filter(e => Date.now() - (e.ts || 0) < ANAL_TTL).slice(0, ANAL_MAX);
      _save(ANAL_KEY, next);
      return next;
    });
  }, [planState?.planId]);

  // ── Derived state (Phase 1129) ────────────────────────────────────────────

  const saasDashboard = useMemo(() =>
    _buildSaasDashboard({ planState, quotaState, billingRecords, lifecycleEvents, survivabilityScore }),
    [planState, quotaState, billingRecords, lifecycleEvents, survivabilityScore]
  );

  const quotaWarnings = useMemo(() =>
    QUOTA_DIMENSIONS
      .filter(d => (quotaState?.[d]?.pct ?? 0) >= 75)
      .map(d => ({ dimension: d, pct: quotaState[d].pct })),
    [quotaState]
  );

  const recentIsoViolations = useMemo(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    return isoEvents.filter(e => (e.ts || 0) > cutoff).length;
  }, [isoEvents]);

  // Calm SaaS bar — shown only when degraded or billing issue (Phase 1136)
  const saasBar = useMemo(() => {
    if (saasDashboard.score >= 80 && !planState?.gracePeriod && quotaWarnings.length === 0) return null;
    const topWarning = quotaWarnings[0];
    return {
      label:       saasDashboard.label,
      score:       saasDashboard.score,
      color:       saasDashboard.color,
      plan:        saasDashboard.planLabel,
      gracePeriod: planState?.gracePeriod ?? false,
      quotaWarn:   topWarning ? `${topWarning.dimension} ${topWarning.pct}%` : null,
      isolation:   recentIsoViolations > 0 ? `${recentIsoViolations} tenant isolation issue${recentIsoViolations > 1 ? "s" : ""}` : null,
    };
  }, [saasDashboard, planState, quotaWarnings, recentIsoViolations]);

  return {
    initialized,
    planState,
    quotaState,
    billingRecords,
    analyticsEvents,
    lifecycleEvents,
    isoEvents,
    paymentRecovery,
    // Derived
    saasDashboard,
    quotaWarnings,
    saasBar,
    // Actions
    activatePlan,
    consumeQuota,
    checkQuota,
    checkFeature,
    recordBilling,
    triggerPaymentFailure,
    recoverPayment,
    recordLifecycle,
    recordSaasAnalytics,
    evaluate,
  };
}
