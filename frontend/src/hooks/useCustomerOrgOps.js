// Phase 1231-1241: Customer + organization operations.
//
// Consolidates eleven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: all arrays capped, TTL-filtered, LRU-evicted cache.

import { useState, useEffect, useCallback, useMemo } from "react";

const ORG_KEY        = "jarvis_orgs";
const ONBOARD_KEY    = "jarvis_org_onboarding";
const CUST_KEY       = "jarvis_customer_health";
const ESCALATION_KEY = "jarvis_support_escalations";
const ADOPTION_KEY   = "jarvis_enterprise_adoption";
const PRODUCTIVITY_KEY = "jarvis_team_productivity";
const SURVIVABILITY_KEY = "jarvis_account_survivability";
const ISO_KEY        = "jarvis_org_isolation";

const ORG_MAX        = 20;
const ONBOARD_MAX    = 20;
const CUST_MAX       = 20;
const ESCALATION_MAX = 15;
const ADOPTION_MAX   = 20;
const PRODUCTIVITY_MAX = 20;
const SURVIVABILITY_MAX = 20;
const ISO_MAX        = 15;

const ORG_TTL        = 7  * 24 * 60 * 60 * 1000;
const ONBOARD_TTL    = 30 * 24 * 60 * 60 * 1000;
const CUST_TTL       = 7  * 24 * 60 * 60 * 1000;
const ESCALATION_TTL = 7  * 24 * 60 * 60 * 1000;
const ADOPTION_TTL   = 30 * 24 * 60 * 60 * 1000;
const PRODUCTIVITY_TTL = 7 * 24 * 60 * 60 * 1000;
const SURVIVABILITY_TTL = 24 * 60 * 60 * 1000;

const VALID_ORG_STATES       = ["provisioning", "active", "suspended", "offboarded"];
const VALID_ONBOARD_STAGES   = ["invited", "workspace_created", "first_workflow", "deployment_ready", "complete"];
const VALID_ESCALATION_TYPES = ["incident", "replay_failure", "deployment_block", "support_request", "billing"];
const VALID_ESCALATION_STAGES = ["open", "triaged", "investigating", "resolved", "closed"];
const VALID_PRODUCTIVITY_DIMS = ["debugging", "deployment", "replay", "smoothness", "collaboration"];

// ── Module-level LRU cache (30s TTL, 50-entry cap) ───────────────────────────

const _cache = new Map();
const CACHE_TTL = 30 * 1000;
const CACHE_MAX = 50;

function _cacheGet(key) {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { _cache.delete(key); return null; }
  return e.val;
}
function _cacheSet(key, val) {
  if (_cache.size >= CACHE_MAX) {
    const oldest = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _cache.delete(oldest[0]);
  }
  _cache.set(key, { val, ts: Date.now() });
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Phase 1231: Organization lifecycle foundation ─────────────────────────────

function _createOrg(spec) {
  if (!spec?.id || !spec?.name) return { ok: false, reason: "invalid_spec" };
  const orgs = _load(ORG_KEY, []);
  if (orgs.find(o => o.id === spec.id)) return { ok: false, reason: "duplicate_id" };
  if (orgs.length >= ORG_MAX) return { ok: false, reason: "org_limit_reached" };

  const entry = {
    id:        spec.id,
    name:      spec.name,
    state:     "provisioning",
    plan:      spec.plan || "free",
    snapshot:  null,
    ts:        Date.now(),
    updatedAt: Date.now(),
  };
  const next = [entry, ...orgs]
    .filter(o => Date.now() - (o.ts || 0) < ORG_TTL)
    .slice(0, ORG_MAX);
  _save(ORG_KEY, next);
  return { ok: true, entry };
}

function _transitionOrg(orgId, nextState) {
  if (!VALID_ORG_STATES.includes(nextState)) return { ok: false, reason: "invalid_state" };
  const orgs = _load(ORG_KEY, []);
  const idx  = orgs.findIndex(o => o.id === orgId);
  if (idx === -1) return { ok: false, reason: "not_found" };

  const STATE_FLOW = {
    provisioning: ["active"],
    active:       ["suspended", "offboarded"],
    suspended:    ["active", "offboarded"],
    offboarded:   [],
  };
  if (!STATE_FLOW[orgs[idx].state]?.includes(nextState))
    return { ok: false, reason: "invalid_transition" };

  orgs[idx] = { ...orgs[idx], state: nextState, updatedAt: Date.now(),
    snapshot: nextState === "suspended" ? { capturedAt: Date.now() } : orgs[idx].snapshot };
  _save(ORG_KEY, orgs);
  return { ok: true, org: orgs[idx] };
}

// ── Phase 1232: Workspace onboarding automation ───────────────────────────────

function _createOnboarding(orgId) {
  if (!orgId) return { ok: false, reason: "invalid_org" };
  const list = _load(ONBOARD_KEY, []);
  if (list.find(o => o.orgId === orgId && o.stage !== "complete"))
    return { ok: false, reason: "already_active" };

  const entry = {
    id:          `ob_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    orgId,
    stage:       "invited",
    completedAt: null,
    stageHistory: [{ stage: "invited", ts: Date.now() }],
    ts:          Date.now(),
    updatedAt:   Date.now(),
  };
  const next = [entry, ...list]
    .filter(o => Date.now() - (o.ts || 0) < ONBOARD_TTL)
    .slice(0, ONBOARD_MAX);
  _save(ONBOARD_KEY, next);
  return { ok: true, entry };
}

function _advanceOnboarding(onboardingId) {
  const list = _load(ONBOARD_KEY, []);
  const idx  = list.findIndex(o => o.id === onboardingId);
  if (idx === -1) return { ok: false, reason: "not_found" };

  const ob       = list[idx];
  const stageIdx = VALID_ONBOARD_STAGES.indexOf(ob.stage);
  if (stageIdx >= VALID_ONBOARD_STAGES.length - 1) return { ok: false, reason: "already_complete" };

  const nextStage = VALID_ONBOARD_STAGES[stageIdx + 1];
  const updated   = {
    ...ob,
    stage:        nextStage,
    completedAt:  nextStage === "complete" ? Date.now() : ob.completedAt,
    stageHistory: [...ob.stageHistory, { stage: nextStage, ts: Date.now() }].slice(0, 10),
    updatedAt:    Date.now(),
  };
  list[idx] = updated;
  _save(ONBOARD_KEY, list);
  return { ok: true, onboarding: updated };
}

// ── Phase 1233: Customer success scoring ──────────────────────────────────────

function _scoreCustomerHealth({
  onboardingComplete, workflowAdoption, replayUsage,
  deployProductivity, opTrust,
}) {
  const score = Math.round(
    (onboardingComplete ? 20 : 0) +
    workflowAdoption    * 0.25 +
    replayUsage         * 0.20 +
    deployProductivity  * 0.20 +
    opTrust             * 0.15
  );
  const label = score >= 80 ? "HEALTHY" : score >= 60 ? "DEVELOPING" : "AT_RISK";
  const snap  = { score: Math.min(100, score), label, ts: Date.now() };
  const prev  = _load(CUST_KEY, []).filter(s => Date.now() - (s.ts || 0) < CUST_TTL);
  _save(CUST_KEY, [snap, ...prev].slice(0, CUST_MAX));
  return snap;
}

// ── Phase 1234: Support escalation coordination ───────────────────────────────

function _createEscalation(spec) {
  if (!spec?.type || !VALID_ESCALATION_TYPES.includes(spec.type))
    return { ok: false, reason: "invalid_type" };

  const list   = _load(ESCALATION_KEY, []);
  const active = list.filter(e => !["resolved", "closed"].includes(e.stage));
  if (active.length >= 5) return { ok: false, reason: "escalation_limit" };

  const entry = {
    id:        `esc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type:      spec.type,
    orgId:     spec.orgId || null,
    stage:     "open",
    replayRef: spec.replayRef || null,
    ts:        Date.now(),
    updatedAt: Date.now(),
  };
  const next = [entry, ...list]
    .filter(e => Date.now() - (e.ts || 0) < ESCALATION_TTL)
    .slice(0, ESCALATION_MAX);
  _save(ESCALATION_KEY, next);
  return { ok: true, entry };
}

function _advanceEscalation(escId) {
  const list = _load(ESCALATION_KEY, []);
  const idx  = list.findIndex(e => e.id === escId);
  if (idx === -1) return { ok: false, reason: "not_found" };

  const esc      = list[idx];
  const stageIdx = VALID_ESCALATION_STAGES.indexOf(esc.stage);
  if (stageIdx >= VALID_ESCALATION_STAGES.length - 1) return { ok: false, reason: "already_closed" };

  const updated = { ...esc, stage: VALID_ESCALATION_STAGES[stageIdx + 1], updatedAt: Date.now() };
  list[idx] = updated;
  _save(ESCALATION_KEY, list);
  return { ok: true, escalation: updated };
}

// ── Phase 1235: Enterprise adoption tracking ──────────────────────────────────

function _recordAdoption(event) {
  if (!event?.orgId || !event?.type) return;
  const VALID_TYPES = ["workspace_expanded", "workflow_adopted", "deployment_coordinated",
    "replay_used", "productivity_milestone", "org_upgraded"];
  if (!VALID_TYPES.includes(event.type)) return;

  const list = _load(ADOPTION_KEY, []);
  const next = [{ ...event, ts: Date.now() }, ...list]
    .filter(e => Date.now() - (e.ts || 0) < ADOPTION_TTL)
    .slice(0, ADOPTION_MAX);
  _save(ADOPTION_KEY, next);
}

function _scoreAdoption(adoptionList) {
  const cached = _cacheGet("adoption_score");
  if (cached) return cached;

  const now   = Date.now();
  const week  = adoptionList.filter(e => now - (e.ts || 0) < 7 * 24 * 60 * 60 * 1000);
  const types = new Set(week.map(e => e.type));
  const score = Math.min(100, Math.round(
    (types.has("workspace_expanded")      ? 20 : 0) +
    (types.has("workflow_adopted")        ? 20 : 0) +
    (types.has("deployment_coordinated")  ? 20 : 0) +
    (types.has("replay_used")             ? 20 : 0) +
    (types.has("productivity_milestone")  ? 15 : 0) +
    (types.has("org_upgraded")            ? 5  : 0)
  ));
  const result = { score, eventCount: week.length };
  _cacheSet("adoption_score", result);
  return result;
}

// ── Phase 1236: Team productivity reporting ───────────────────────────────────

function _recordProductivity(sample) {
  if (!sample?.dim || !VALID_PRODUCTIVITY_DIMS.includes(sample.dim)) return;
  // Privacy contract: only numeric scores, no raw content
  if (sample.rawContent || sample.commandOutput || sample.userInput) return;

  const list = _load(PRODUCTIVITY_KEY, []);
  const next = [{ dim: sample.dim, score: sample.score ?? 0, ts: Date.now() }, ...list]
    .filter(s => Date.now() - (s.ts || 0) < PRODUCTIVITY_TTL)
    .slice(0, PRODUCTIVITY_MAX);
  _save(PRODUCTIVITY_KEY, next);
}

function _aggregateProductivity(samples) {
  const cached = _cacheGet("productivity_agg");
  if (cached) return cached;

  const agg = {};
  VALID_PRODUCTIVITY_DIMS.forEach(dim => {
    const dimSamples = samples.filter(s => s.dim === dim);
    agg[dim] = dimSamples.length
      ? Math.round(dimSamples.reduce((sum, s) => sum + (s.score || 0), 0) / dimSamples.length)
      : null;
  });
  const filled    = Object.values(agg).filter(v => v !== null);
  const composite = filled.length
    ? Math.round(filled.reduce((a, b) => a + b, 0) / filled.length)
    : 100;
  const result = { dims: agg, composite };
  _cacheSet("productivity_agg", result);
  return result;
}

// ── Phase 1237: Account survivability system ──────────────────────────────────

function _recordSurvivabilityEvent(event) {
  if (!event?.orgId || !event?.type) return;
  const VALID_TYPES = ["reconnect_restored", "replay_continued", "deployment_survived",
    "workflow_resumed", "cross_org_blocked"];
  if (!VALID_TYPES.includes(event.type)) return;

  const list = _load(SURVIVABILITY_KEY, []);
  // Dedup: same org + type within 5 min
  if (list.find(e => e.orgId === event.orgId && e.type === event.type
      && Date.now() - (e.ts || 0) < 5 * 60 * 1000)) return;

  const next = [{ ...event, ts: Date.now() }, ...list]
    .filter(e => Date.now() - (e.ts || 0) < SURVIVABILITY_TTL)
    .slice(0, SURVIVABILITY_MAX);
  _save(SURVIVABILITY_KEY, next);
}

function _scoreSurvivability(events) {
  const now    = Date.now();
  const recent = events.filter(e => now - (e.ts || 0) < 60 * 60 * 1000);
  if (!recent.length) return 100;
  const positive = recent.filter(e => e.type !== "cross_org_blocked").length;
  const blocked  = recent.filter(e => e.type === "cross_org_blocked").length;
  return Math.max(0, Math.min(100, Math.round((positive / recent.length) * 100) - blocked * 10));
}

// ── Phase 1238: Multi-org isolation hardening ─────────────────────────────────

const ORG_PREFIXES = new Set([
  "jarvis_orgs", "jarvis_org_onboarding", "jarvis_customer_health",
  "jarvis_support_escalations", "jarvis_enterprise_adoption",
  "jarvis_team_productivity", "jarvis_account_survivability", "jarvis_org_isolation",
]);

function _scanOrgIsolation(orgs) {
  const cached = _cacheGet("org_iso");
  if (cached) return cached;

  const violations = [];
  const orgIds = new Set(orgs.map(o => o.id));

  // Check escalations reference valid orgs
  try {
    const escs = _load(ESCALATION_KEY, []);
    escs.forEach(e => {
      if (e.orgId && !orgIds.has(e.orgId) && violations.length < 5)
        violations.push({ type: "orphan_escalation", ref: e.id, ts: Date.now() });
    });
  } catch {}

  // Check adoption events reference valid orgs
  try {
    const adoption = _load(ADOPTION_KEY, []);
    const stale = adoption.filter(e => e.orgId && !orgIds.has(e.orgId));
    if (stale.length > 0 && violations.length < 5)
      violations.push({ type: "orphan_adoption_events", count: stale.length, ts: Date.now() });
  } catch {}

  const prev   = _load(ISO_KEY, []);
  const merged = [...violations, ...prev].slice(0, ISO_MAX);
  _save(ISO_KEY, merged);
  _cacheSet("org_iso", { violations });
  return { violations };
}

// ── Phase 1239: Performance hardening ────────────────────────────────────────
// Pure scoring functions, cache-gated. No side-effects in render path.

function _computeCustomerOpsScore({ customerHealth, adoptionScore, survivabilityScore, escalationCount }) {
  return Math.max(0, Math.min(100, Math.round(
    customerHealth     * 0.35 +
    adoptionScore      * 0.30 +
    survivabilityScore * 0.25 +
    Math.max(0, 100 - escalationCount * 10) * 0.10
  )));
}

// ── Phase 1240/1241: Stress validation + calm operator bar ────────────────────

function _buildCustomerOpsBar({ opsScore, customerHealth, adoptionScore, activeEscalations, isoViolations }) {
  const hasIssue = opsScore < 80 || activeEscalations > 3 || isoViolations > 0;
  if (!hasIssue) return null;

  const topIssue = isoViolations > 0
    ? `${isoViolations} org isolation issue${isoViolations > 1 ? "s" : ""}`
    : activeEscalations > 3
      ? `${activeEscalations} active escalations`
      : customerHealth < 60
        ? `Customer health ${customerHealth}%`
        : adoptionScore < 60
          ? `Adoption ${adoptionScore}%`
          : null;

  return {
    label:   "CUSTOMER OPS",
    score:   opsScore,
    color:   opsScore >= 80 ? "var(--op-green)" : opsScore >= 60 ? "var(--op-amber)" : "var(--op-red)",
    issue:   topIssue,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useCustomerOrgOps({
  workflowAdoption   = 80,
  replayUsage        = 80,
  deployProductivity = 80,
  opTrust            = 100,
} = {}) {
  const [orgs,           setOrgs]           = useState([]);
  const [onboardings,    setOnboardings]    = useState([]);
  const [customerHealth, setCustomerHealth] = useState(null);
  const [escalations,    setEscalations]    = useState([]);
  const [adoption,       setAdoption]       = useState([]);
  const [productivity,   setProductivity]   = useState([]);
  const [survivability,  setSurvivability]  = useState([]);
  const [isoState,       setIsoState]       = useState({ violations: [] });
  const [initialized,    setInitialized]    = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();
    const loadedOrgs = _load(ORG_KEY, []).filter(o => now - (o.ts || 0) < ORG_TTL).slice(0, ORG_MAX);
    setOrgs(loadedOrgs);
    setOnboardings(_load(ONBOARD_KEY, []).filter(o => now - (o.ts || 0) < ONBOARD_TTL).slice(0, ONBOARD_MAX));
    setEscalations(_load(ESCALATION_KEY, []).filter(e => now - (e.ts || 0) < ESCALATION_TTL).slice(0, ESCALATION_MAX));
    setAdoption(_load(ADOPTION_KEY, []).filter(e => now - (e.ts || 0) < ADOPTION_TTL).slice(0, ADOPTION_MAX));
    setProductivity(_load(PRODUCTIVITY_KEY, []).filter(s => now - (s.ts || 0) < PRODUCTIVITY_TTL).slice(0, PRODUCTIVITY_MAX));
    setSurvivability(_load(SURVIVABILITY_KEY, []).filter(e => now - (e.ts || 0) < SURVIVABILITY_TTL).slice(0, SURVIVABILITY_MAX));

    const onboardComplete = _load(ONBOARD_KEY, []).some(o => o.stage === "complete");
    const health = _scoreCustomerHealth({ onboardingComplete: onboardComplete, workflowAdoption, replayUsage, deployProductivity, opTrust });
    setCustomerHealth(health);

    const iso = _scanOrgIsolation(loadedOrgs);
    setIsoState(iso);
  }, [workflowAdoption, replayUsage, deployProductivity, opTrust]);

  useEffect(() => {
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const createOrg = useCallback((spec) => {
    const result = _createOrg(spec);
    if (result.ok) evaluate();
    return result;
  }, [evaluate]);

  const transitionOrg = useCallback((orgId, nextState) => {
    const result = _transitionOrg(orgId, nextState);
    if (result.ok) evaluate();
    return result;
  }, [evaluate]);

  const createOnboarding = useCallback((orgId) => {
    const result = _createOnboarding(orgId);
    if (result.ok) {
      setOnboardings(_load(ONBOARD_KEY, []).filter(o => Date.now() - (o.ts || 0) < ONBOARD_TTL).slice(0, ONBOARD_MAX));
    }
    return result;
  }, []);

  const advanceOnboarding = useCallback((onboardingId) => {
    const result = _advanceOnboarding(onboardingId);
    if (result.ok) {
      setOnboardings(_load(ONBOARD_KEY, []).filter(o => Date.now() - (o.ts || 0) < ONBOARD_TTL).slice(0, ONBOARD_MAX));
    }
    return result;
  }, []);

  const createEscalation = useCallback((spec) => {
    const result = _createEscalation(spec);
    if (result.ok) {
      setEscalations(_load(ESCALATION_KEY, []).filter(e => Date.now() - (e.ts || 0) < ESCALATION_TTL).slice(0, ESCALATION_MAX));
    }
    return result;
  }, []);

  const advanceEscalation = useCallback((escId) => {
    const result = _advanceEscalation(escId);
    if (result.ok) {
      setEscalations(_load(ESCALATION_KEY, []).filter(e => Date.now() - (e.ts || 0) < ESCALATION_TTL).slice(0, ESCALATION_MAX));
    }
    return result;
  }, []);

  const recordAdoption = useCallback((event) => {
    _recordAdoption(event);
    setAdoption(_load(ADOPTION_KEY, []).filter(e => Date.now() - (e.ts || 0) < ADOPTION_TTL).slice(0, ADOPTION_MAX));
  }, []);

  const recordProductivity = useCallback((sample) => {
    _recordProductivity(sample);
    setProductivity(_load(PRODUCTIVITY_KEY, []).filter(s => Date.now() - (s.ts || 0) < PRODUCTIVITY_TTL).slice(0, PRODUCTIVITY_MAX));
  }, []);

  const recordSurvivability = useCallback((event) => {
    _recordSurvivabilityEvent(event);
    setSurvivability(_load(SURVIVABILITY_KEY, []).filter(e => Date.now() - (e.ts || 0) < SURVIVABILITY_TTL).slice(0, SURVIVABILITY_MAX));
  }, []);

  const adoptionScore = useMemo(() => _scoreAdoption(adoption).score, [adoption]);

  const productivityAgg = useMemo(() => _aggregateProductivity(productivity), [productivity]);

  const survivabilityScore = useMemo(() => _scoreSurvivability(survivability), [survivability]);

  const activeEscalations = useMemo(
    () => escalations.filter(e => !["resolved", "closed"].includes(e.stage)),
    [escalations]
  );

  const activeOnboardings = useMemo(
    () => onboardings.filter(o => o.stage !== "complete"),
    [onboardings]
  );

  const _healthScore   = customerHealth?.score ?? 100;
  const _isoCount      = isoState.violations.length;
  const _escBucket     = Math.floor(activeEscalations.length / 2);

  const opsScore = useMemo(
    () => _computeCustomerOpsScore({
      customerHealth:     _healthScore,
      adoptionScore,
      survivabilityScore,
      escalationCount:    activeEscalations.length,
    }),
    [_healthScore, adoptionScore, survivabilityScore, activeEscalations.length]
  );

  const customerOpsBar = useMemo(
    () => _buildCustomerOpsBar({
      opsScore,
      customerHealth: _healthScore,
      adoptionScore,
      activeEscalations: activeEscalations.length,
      isoViolations:     _isoCount,
    }),
    [opsScore, _healthScore, adoptionScore, _escBucket, _isoCount]  // eslint-disable-line
  );

  return {
    initialized,
    orgs,
    onboardings,
    activeOnboardings,
    customerHealth,
    escalations,
    activeEscalations,
    adoption,
    adoptionScore,
    productivity,
    productivityAgg,
    survivability,
    survivabilityScore,
    isoState,
    opsScore,
    customerOpsBar,
    createOrg,
    transitionOrg,
    createOnboarding,
    advanceOnboarding,
    createEscalation,
    advanceEscalation,
    recordAdoption,
    recordProductivity,
    recordSurvivability,
    evaluate,
  };
}
