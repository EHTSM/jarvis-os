// Phase 1351-1362: Scale + production operations maturity.
//
// Consolidates twelve phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: all arrays capped, TTL-filtered, LRU-evicted cache.

import { useState, useEffect, useCallback, useMemo } from "react";

const LOAD_KEY       = "jarvis_high_load_state";
const INFRA_KEY      = "jarvis_infra_scaling";
const SCALE_INTEL_KEY = "jarvis_scale_intelligence";
const SUPPORT_SCALE_KEY = "jarvis_support_scaling";
const MULTIUSER_KEY  = "jarvis_multiuser_continuity";
const ORG_SCALE_KEY  = "jarvis_org_scale_workflows";
const DURABILITY_KEY = "jarvis_platform_durability";
const TENANT_ISO_KEY = "jarvis_tenant_isolation";
const SCALE_PERF_KEY = "jarvis_scale_perf";

const LOAD_MAX       = 20;
const INFRA_MAX      = 15;
const SCALE_INTEL_MAX = 30;
const SUPPORT_MAX    = 15;
const MULTIUSER_MAX  = 20;
const ORG_SCALE_MAX  = 15;
const DURABILITY_MAX = 20;
const TENANT_ISO_MAX = 20;
const SCALE_PERF_MAX = 20;

const LOAD_TTL       = 24 * 60 * 60 * 1000;
const INFRA_TTL      = 7  * 24 * 60 * 60 * 1000;
const SCALE_INTEL_TTL = 24 * 60 * 60 * 1000;
const SUPPORT_TTL    = 7  * 24 * 60 * 60 * 1000;
const MULTIUSER_TTL  = 7  * 24 * 60 * 60 * 1000;
const ORG_SCALE_TTL  = 7  * 24 * 60 * 60 * 1000;
const DURABILITY_TTL = 7  * 24 * 60 * 60 * 1000;
const TENANT_ISO_TTL = 24 * 60 * 60 * 1000;
const SCALE_PERF_TTL = 24 * 60 * 60 * 1000;

const VALID_LOAD_STAGES   = ["nominal", "elevated", "saturated", "shedding", "recovered"];
const VALID_INFRA_STAGES  = ["provisioning", "scaling_up", "scaling_down", "stable", "failed"];
const VALID_INTEL_TYPES   = ["queue_saturation", "replay_quality", "deploy_continuity", "workflow_responsiveness", "op_trust", "exec_durability"];
const VALID_SUPPORT_STAGES = ["opened", "triaged", "escalated", "resolving", "closed"];
const VALID_MULTIUSER_STAGES = ["joining", "active", "syncing", "degraded", "departed"];
const VALID_ORG_STAGES    = ["onboarding", "active", "scaling", "stable", "offboarding"];
const VALID_DURABILITY_DIMS = ["replay_safety", "deploy_reliability", "infra_stability", "runtime_trust", "op_continuity"];

// ── LRU cache ─────────────────────────────────────────────────────────────────
const _cache = new Map();
const CACHE_TTL = 30 * 1000;
const CACHE_MAX = 50;
function _cached(key, fn) {
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && now - hit.ts < CACHE_TTL) return hit.val;
  if (_cache.size >= CACHE_MAX) {
    const oldest = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _cache.delete(oldest[0]);
  }
  const val = fn();
  _cache.set(key, { val, ts: now });
  return val;
}

// ── Storage helpers ───────────────────────────────────────────────────────────
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Phase 1351: High-load survivability scoring ───────────────────────────────
function _scoreHighLoad(events) {
  if (!events.length) return 100;
  const recovered = events.filter(e => e.stage === "recovered" || e.stage === "nominal").length;
  const saturated = events.filter(e => e.stage === "saturated" || e.stage === "shedding").length;
  return Math.max(0, Math.round(
    (recovered / events.length) * 90
    - saturated * 10
  ));
}

// ── Phase 1352: Infra scaling scoring ────────────────────────────────────────
function _scoreInfraScaling(provisions) {
  if (!provisions.length) return 100;
  const stable    = provisions.filter(p => p.stage === "stable").length;
  const failed    = provisions.filter(p => p.stage === "failed").length;
  const unapproved = provisions.filter(p =>
    ["scaling_up", "scaling_down"].includes(p.stage) && !p.approvedAt
  ).length;
  return Math.max(0, Math.round(
    (stable / provisions.length) * 80
    - failed * 15
    - unapproved * 20
  ));
}

// ── Phase 1354: Scaling intelligence aggregation ──────────────────────────────
function _aggregateScaleIntel(events) {
  const byType = {};
  for (const t of VALID_INTEL_TYPES) {
    const typeEvents = events.filter(e => e.type === t);
    byType[t] = typeEvents.length
      ? Math.round(typeEvents.reduce((a, e) => a + (e.score ?? 80), 0) / typeEvents.length)
      : null;
  }
  const filled    = Object.values(byType).filter(v => v !== null);
  const composite = filled.length
    ? Math.round(filled.reduce((a, v) => a + v, 0) / filled.length)
    : 100;
  return { byType, composite, label: composite >= 80 ? "SCALING_WELL" : composite >= 60 ? "STRAINED" : "CRITICAL" };
}

// ── Phase 1355: Support scaling scoring ───────────────────────────────────────
function _scoreSupportScaling(tickets) {
  if (!tickets.length) return 100;
  const now    = Date.now();
  const closed = tickets.filter(t => t.stage === "closed").length;
  const stale  = tickets.filter(t => !["closed"].includes(t.stage) && now - (t.ts || 0) > 4 * 60 * 60 * 1000).length;
  return Math.max(0, Math.round(
    (closed / tickets.length) * 70
    + (tickets.length <= 5 ? 30 : 0)
    - stale * 10
  ));
}

// ── Phase 1356: Multi-user continuity scoring ─────────────────────────────────
function _scoreMultiuser(users) {
  if (!users.length) return 100;
  const active   = users.filter(u => u.stage === "active" || u.stage === "syncing").length;
  const degraded = users.filter(u => u.stage === "degraded").length;
  return Math.max(0, Math.round(
    (active / users.length) * 90
    - degraded * 15
  ));
}

// ── Phase 1357: Org-scale workflow scoring ────────────────────────────────────
function _scoreOrgScale(orgs) {
  if (!orgs.length) return 100;
  const active   = orgs.filter(o => ["active", "scaling", "stable"].includes(o.stage)).length;
  const offboard = orgs.filter(o => o.stage === "offboarding").length;
  return Math.max(0, Math.round(
    (active / orgs.length) * 85
    + (orgs.length > 0 ? 15 : 0)
    - offboard * 5
  ));
}

// ── Phase 1358: Platform durability scoring ───────────────────────────────────
function _scoreDurability(events) {
  if (!events.length) return 100;
  const byDim = {};
  for (const dim of VALID_DURABILITY_DIMS) {
    const dimEvents = events.filter(e => e.dim === dim);
    byDim[dim] = dimEvents.length
      ? Math.round(dimEvents.reduce((a, e) => a + (e.score ?? 80), 0) / dimEvents.length)
      : null;
  }
  const filled = Object.values(byDim).filter(v => v !== null);
  return filled.length
    ? Math.round(filled.reduce((a, v) => a + v, 0) / filled.length)
    : 100;
}

// ── Phase 1359: Multi-tenant isolation check ──────────────────────────────────
function _checkTenantIsolation(multiuserList, orgList) {
  const violations = [];

  // Cross-user contamination: same user active in multiple orgs concurrently
  const userOrgMap = {};
  for (const u of multiuserList.filter(u => u.stage === "active")) {
    if (u.userId && u.orgId) {
      if (!userOrgMap[u.userId]) userOrgMap[u.userId] = new Set();
      userOrgMap[u.userId].add(u.orgId);
    }
  }
  for (const [userId, orgs] of Object.entries(userOrgMap)) {
    if (orgs.size > 1) {
      violations.push({ type: "cross_tenant_user", userId, orgCount: orgs.size, ts: Date.now() });
    }
  }

  // Org scaling bleed: scaling orgs referencing non-existent org IDs in scale events
  const orgIds = new Set(orgList.map(o => o.id).filter(Boolean));
  try {
    const scaleEvents = _load(SCALE_INTEL_KEY, []);
    for (const e of scaleEvents) {
      if (e.orgId && !orgIds.has(e.orgId)) {
        violations.push({ type: "orphan_scale_event", orgId: e.orgId, ts: Date.now() });
      }
    }
  } catch {}

  return violations;
}

// ── Phase 1360: Scale performance audit ──────────────────────────────────────
function _computeScalePerf(loadEvents, infraProvisions, scaleIntel, multiuserList) {
  const findings = [];

  // Load saturation check
  const activeSaturated = loadEvents.filter(e => ["saturated", "shedding"].includes(e.stage));
  if (activeSaturated.length > 3) findings.push({ id: "load_saturation", severity: "high", msg: `${activeSaturated.length} saturated load events` });

  // Infra provision overflow
  const activeProvisions = infraProvisions.filter(p => ["provisioning", "scaling_up", "scaling_down"].includes(p.stage));
  if (activeProvisions.length > 5) findings.push({ id: "infra_overflow", severity: "high", msg: `${activeProvisions.length} active infra provisions` });

  // Scale intel burst
  const recentIntel = scaleIntel.filter(e => Date.now() - (e.ts || 0) < 10 * 1000);
  if (recentIntel.length > 8) findings.push({ id: "intel_burst", severity: "medium", msg: `${recentIntel.length} scale intel events in 10s` });

  // Multiuser duplication
  const userIds = multiuserList.map(u => u.userId).filter(Boolean);
  const dupes   = userIds.length - new Set(userIds).size;
  if (dupes > 3) findings.push({ id: "multiuser_duplication", severity: "medium", msg: `${dupes} duplicate user entries` });

  return {
    ts:        Date.now(),
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Composite scale ops score ─────────────────────────────────────────────────
function _computeScaleOpsScore({
  loadScore       = 100,
  infraScore      = 100,
  scaleIntelScore = 100,
  supportScore    = 100,
  multiuserScore  = 100,
  orgScale        = 100,
  durabilityScore = 100,
  isoViolations   = 0,
  perfScore       = 100,
} = {}) {
  const composite = Math.round(
    durabilityScore  * 0.20 +
    infraScore       * 0.15 +
    loadScore        * 0.15 +
    multiuserScore   * 0.15 +
    scaleIntelScore  * 0.15 +
    orgScale         * 0.10 +
    supportScore     * 0.05 +
    perfScore        * 0.05
  ) - (isoViolations > 0 ? 15 : 0);
  return Math.max(0, Math.min(100, composite));
}

// ── Main hook ─────────────────────────────────────────────────────────────────
export function useScaleOpsMaturity() {
  const [loadEvents,      setLoadEvents]      = useState([]);
  const [infraProvisions, setInfraProvisions] = useState([]);
  const [scaleIntel,      setScaleIntel]      = useState([]);
  const [supportTickets,  setSupportTickets]  = useState([]);
  const [multiuserList,   setMultiuserList]   = useState([]);
  const [orgList,         setOrgList]         = useState([]);
  const [durabilityEvents, setDurabilityEvents] = useState([]);
  const [tenantIsoViolations, setTenantIsoViolations] = useState([]);
  const [scalePerfAudit,  setScalePerfAudit]  = useState(null);
  const [initialized,     setInitialized]     = useState(false);

  // Phase 1351: Record high-load event
  const recordLoadEvent = useCallback((event = {}) => {
    const { id, stage } = event;
    if (!id || !VALID_LOAD_STAGES.includes(stage)) return;
    setLoadEvents(prev => {
      const now      = Date.now();
      const existing = prev.find(e => e.id === id);
      let next;
      if (existing) {
        next = prev.map(e => e.id === id ? { ...e, stage, updatedAt: now } : e);
      } else {
        next = [{ id, stage, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(e => now - (e.ts || 0) < LOAD_TTL)
        .slice(0, LOAD_MAX);
      _save(LOAD_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1352: Record infra scaling event (approval-gated)
  const recordInfraScaling = useCallback((event = {}) => {
    const { id, stage, approvedAt, env = "production" } = event;
    if (!id || !VALID_INFRA_STAGES.includes(stage)) return;
    if (["scaling_up", "scaling_down"].includes(stage) && !approvedAt) return;
    setInfraProvisions(prev => {
      const now      = Date.now();
      const existing = prev.find(p => p.id === id);
      let next;
      if (existing) {
        next = prev.map(p => p.id === id ? { ...p, stage, approvedAt: approvedAt ?? p.approvedAt, updatedAt: now } : p);
      } else {
        // 5-min dedup per env
        const recentSame = prev.find(p =>
          p.env === env && ["scaling_up", "scaling_down"].includes(p.stage) && now - (p.ts || 0) < 5 * 60 * 1000
        );
        if (recentSame && ["scaling_up", "scaling_down"].includes(stage)) return prev;
        next = [{ id, stage, env, approvedAt, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(p => now - (p.ts || 0) < INFRA_TTL)
        .slice(0, INFRA_MAX);
      _save(INFRA_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1354: Record scale intelligence signal (privacy-safe)
  const recordScaleIntel = useCallback((event = {}) => {
    const { type, score, orgId } = event;
    if (!VALID_INTEL_TYPES.includes(type)) return;
    if (event.rawContent || event.commandOutput || event.userInput) return;
    setScaleIntel(prev => {
      const now   = Date.now();
      const dedup = prev.find(e => e.type === type && now - (e.ts || 0) < 2 * 60 * 1000);
      if (dedup) return prev;
      const next = [{ type, score: Math.min(100, Math.max(0, score ?? 80)), orgId, ts: now }, ...prev]
        .filter(e => now - (e.ts || 0) < SCALE_INTEL_TTL)
        .slice(0, SCALE_INTEL_MAX);
      _save(SCALE_INTEL_KEY, next);
      return next;
    });
  }, []);

  // Phase 1355: Record support scaling ticket (operator-approved escalation only)
  const recordSupportTicket = useCallback((event = {}) => {
    const { id, stage, issueType, operatorApproved } = event;
    if (!id || !VALID_SUPPORT_STAGES.includes(stage)) return;
    if (stage === "escalated" && !operatorApproved) return;
    setSupportTickets(prev => {
      const now      = Date.now();
      const existing = prev.find(t => t.id === id);
      let next;
      if (existing) {
        next = prev.map(t => t.id === id ? { ...t, stage, updatedAt: now } : t);
      } else {
        const recentSame = prev.find(t =>
          t.issueType === issueType && now - (t.ts || 0) < 5 * 60 * 1000
        );
        if (recentSame) return prev;
        next = [{ id, stage, issueType, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(t => now - (t.ts || 0) < SUPPORT_TTL)
        .slice(0, SUPPORT_MAX);
      _save(SUPPORT_SCALE_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1356: Record multi-user continuity event
  const recordMultiuserEvent = useCallback((event = {}) => {
    const { userId, orgId, stage } = event;
    if (!userId || !VALID_MULTIUSER_STAGES.includes(stage)) return;
    setMultiuserList(prev => {
      const now      = Date.now();
      const existing = prev.find(u => u.userId === userId && u.orgId === orgId);
      let next;
      if (existing) {
        next = prev.map(u =>
          u.userId === userId && u.orgId === orgId ? { ...u, stage, updatedAt: now } : u
        );
      } else {
        next = [{ userId, orgId, stage, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(u => now - (u.ts || 0) < MULTIUSER_TTL)
        .slice(0, MULTIUSER_MAX);
      _save(MULTIUSER_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1357: Record org-scale workflow event
  const recordOrgScaleEvent = useCallback((event = {}) => {
    const { id, stage } = event;
    if (!id || !VALID_ORG_STAGES.includes(stage)) return;
    setOrgList(prev => {
      const now      = Date.now();
      const existing = prev.find(o => o.id === id);
      let next;
      if (existing) {
        next = prev.map(o => o.id === id ? { ...o, stage, updatedAt: now } : o);
      } else {
        next = [{ id, stage, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(o => now - (o.ts || 0) < ORG_SCALE_TTL)
        .slice(0, ORG_SCALE_MAX);
      _save(ORG_SCALE_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1358: Record platform durability signal (privacy-safe)
  const recordDurabilitySignal = useCallback((event = {}) => {
    const { dim, score } = event;
    if (!VALID_DURABILITY_DIMS.includes(dim)) return;
    if (event.rawContent || event.commandOutput || event.userInput) return;
    setDurabilityEvents(prev => {
      const now   = Date.now();
      const dedup = prev.find(e => e.dim === dim && now - (e.ts || 0) < 5 * 60 * 1000);
      if (dedup) return prev;
      const next = [{ dim, score: Math.min(100, Math.max(0, score ?? 80)), ts: now }, ...prev]
        .filter(e => now - (e.ts || 0) < DURABILITY_TTL)
        .slice(0, DURABILITY_MAX);
      _save(DURABILITY_KEY, next);
      return next;
    });
  }, []);

  // Phase 1359 + 1360: evaluate isolation + perf
  const evaluate = useCallback(() => {
    const now = Date.now();

    const isos = _checkTenantIsolation(multiuserList, orgList);
    setTenantIsoViolations(isos);
    if (isos.length) {
      const existing = _load(TENANT_ISO_KEY, []);
      const next = [...isos, ...existing]
        .filter(v => now - (v.ts || 0) < TENANT_ISO_TTL)
        .slice(0, TENANT_ISO_MAX);
      _save(TENANT_ISO_KEY, next);
    }

    const perf = _computeScalePerf(loadEvents, infraProvisions, scaleIntel, multiuserList);
    setScalePerfAudit(perf);
    _save(SCALE_PERF_KEY, perf);
  }, [multiuserList, orgList, loadEvents, infraProvisions, scaleIntel]);

  useEffect(() => {
    const now = Date.now();
    setLoadEvents(_load(LOAD_KEY, []).filter(e => now - (e.ts || 0) < LOAD_TTL));
    setInfraProvisions(_load(INFRA_KEY, []).filter(p => now - (p.ts || 0) < INFRA_TTL));
    setScaleIntel(_load(SCALE_INTEL_KEY, []).filter(e => now - (e.ts || 0) < SCALE_INTEL_TTL));
    setSupportTickets(_load(SUPPORT_SCALE_KEY, []).filter(t => now - (t.ts || 0) < SUPPORT_TTL));
    setMultiuserList(_load(MULTIUSER_KEY, []).filter(u => now - (u.ts || 0) < MULTIUSER_TTL));
    setOrgList(_load(ORG_SCALE_KEY, []).filter(o => now - (o.ts || 0) < ORG_SCALE_TTL));
    setDurabilityEvents(_load(DURABILITY_KEY, []).filter(e => now - (e.ts || 0) < DURABILITY_TTL));
    setInitialized(true);
  }, []);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // ── Derived scores ────────────────────────────────────────────────────────
  const loadScore = useMemo(() => _scoreHighLoad(loadEvents), [loadEvents]);

  const infraScore = useMemo(() => _scoreInfraScaling(infraProvisions), [infraProvisions]);

  const scaleIntelAgg = useMemo(
    () => _cached(`scaleIntel|${Math.floor(scaleIntel.length / 5)}`, () => _aggregateScaleIntel(scaleIntel)),
    [scaleIntel]
  );

  const supportScore = useMemo(() => _scoreSupportScaling(supportTickets), [supportTickets]);

  const multiuserScore = useMemo(() => _scoreMultiuser(multiuserList), [multiuserList]);

  const orgScaleScore = useMemo(
    () => _cached(`orgScale|${Math.floor(orgList.length / 3)}`, () => _scoreOrgScale(orgList)),
    [orgList]
  );

  const durabilityScore = useMemo(
    () => _cached(`durability|${Math.floor(durabilityEvents.length / 5)}`, () => _scoreDurability(durabilityEvents)),
    [durabilityEvents]
  );

  const scaleOpsScore = useMemo(() => _computeScaleOpsScore({
    loadScore,
    infraScore,
    scaleIntelScore: scaleIntelAgg.composite,
    supportScore,
    multiuserScore,
    orgScale:        orgScaleScore,
    durabilityScore,
    isoViolations:   tenantIsoViolations.length,
    perfScore:       scalePerfAudit?.score ?? 100,
  }), [
    loadScore, infraScore, scaleIntelAgg.composite, supportScore,
    multiuserScore, orgScaleScore, durabilityScore,
    tenantIsoViolations.length, scalePerfAudit?.score,
  ]);

  const scaleOpsBar = useMemo(() => {
    if (scaleOpsScore >= 80 && tenantIsoViolations.length === 0 && !scalePerfAudit?.highCount) return null;
    const issue =
      tenantIsoViolations.length ? `Tenant isolation: ${tenantIsoViolations.length} violation${tenantIsoViolations.length > 1 ? "s" : ""}` :
      scalePerfAudit?.highCount  ? scalePerfAudit.findings.find(f => f.severity === "high")?.msg :
      scaleIntelAgg.label !== "SCALING_WELL" ? `Scale intel: ${scaleIntelAgg.label}` :
      infraScore < 60 ? `Infra scaling: ${infraScore}%` :
      null;
    const color = scaleOpsScore >= 80 ? "var(--op-green)" : scaleOpsScore >= 60 ? "var(--op-amber)" : "var(--op-red)";
    return { score: scaleOpsScore, issue, color, hasCrit: scaleOpsScore < 50 };
  }, [scaleOpsScore, tenantIsoViolations.length, scalePerfAudit, scaleIntelAgg.label, infraScore]);

  return {
    initialized,
    loadEvents,
    infraProvisions,
    scaleIntel,
    supportTickets,
    multiuserList,
    orgList,
    durabilityEvents,
    tenantIsoViolations,
    scalePerfAudit,
    loadScore,
    infraScore,
    scaleIntelAgg,
    supportScore,
    multiuserScore,
    orgScaleScore,
    durabilityScore,
    scaleOpsScore,
    scaleOpsBar,
    recordLoadEvent,
    recordInfraScaling,
    recordScaleIntel,
    recordSupportTicket,
    recordMultiuserEvent,
    recordOrgScaleEvent,
    recordDurabilitySignal,
    evaluate,
  };
}
