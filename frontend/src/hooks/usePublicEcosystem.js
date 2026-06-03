// Phase 1411-1421: Public ecosystem + production deployment readiness.
//
// Consolidates eleven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: all arrays capped, TTL-filtered, LRU-evicted cache.

import { useState, useEffect, useCallback, useMemo } from "react";

const PROD_DEPLOY_KEY  = "jarvis_prod_deploy_pipeline";
const PUB_ONBOARD_KEY  = "jarvis_pub_onboarding";
const MODERATION_KEY   = "jarvis_eco_moderation";
const PLUGIN_TRUST_KEY = "jarvis_plugin_trust";
const RELEASE_KEY      = "jarvis_pub_release";
const USER_FLOW_KEY    = "jarvis_user_op_flows";
const PUB_TRUST_KEY    = "jarvis_pub_trust";
const PUB_ISO_KEY      = "jarvis_pub_tenant_iso";
const PUB_PERF_KEY     = "jarvis_pub_perf";

const PROD_DEPLOY_MAX  = 15;
const PUB_ONBOARD_MAX  = 20;
const MODERATION_MAX   = 20;
const PLUGIN_TRUST_MAX = 30;
const RELEASE_MAX      = 10;
const USER_FLOW_MAX    = 20;
const PUB_TRUST_MAX    = 20;
const PUB_ISO_MAX      = 20;
const PUB_PERF_MAX     = 20;

const PROD_DEPLOY_TTL  = 7  * 24 * 60 * 60 * 1000;
const PUB_ONBOARD_TTL  = 7  * 24 * 60 * 60 * 1000;
const MODERATION_TTL   = 7  * 24 * 60 * 60 * 1000;
const PLUGIN_TRUST_TTL = 7  * 24 * 60 * 60 * 1000;
const RELEASE_TTL      = 7  * 24 * 60 * 60 * 1000;
const USER_FLOW_TTL    = 24 * 60 * 60 * 1000;
const PUB_TRUST_TTL    = 7  * 24 * 60 * 60 * 1000;
const PUB_ISO_TTL      = 24 * 60 * 60 * 1000;
const PUB_PERF_TTL     = 24 * 60 * 60 * 1000;

const VALID_DEPLOY_STAGES    = ["queued", "validating", "deploying", "verifying", "complete", "rolled_back"];
const VALID_ONBOARD_STAGES   = ["started", "workspace_ready", "first_workflow", "first_deploy", "complete"];
const VALID_MOD_ACTIONS      = ["submitted", "under_review", "approved", "rejected", "appealed"];
const VALID_PLUGIN_TRUST_DIMS = ["survivability", "op_trust", "replay_continuity", "eco_durability", "workflow_reliability"];
const VALID_RELEASE_STAGES   = ["draft", "staged", "approved", "deploying", "live", "retired"];
const VALID_USER_FLOW_TYPES  = ["workflow_run", "deploy_action", "replay_debug", "onboard_step", "support_action"];
const VALID_TRUST_EVENTS     = ["explainability_shown", "action_previewed", "rollback_offered", "approval_confirmed", "transparency_note"];

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

// ── Phase 1411: Production deployment pipeline scoring ────────────────────────
function _scoreProdDeployments(deploys) {
  if (!deploys.length) return 100;
  const complete   = deploys.filter(d => d.stage === "complete").length;
  const rolledBack = deploys.filter(d => d.stage === "rolled_back").length;
  const unapproved = deploys.filter(d =>
    ["deploying", "verifying", "complete"].includes(d.stage) && !d.approvedAt
  ).length;
  return Math.max(0, Math.round(
    (complete / deploys.length) * 80
    - rolledBack * 8
    - unapproved * 25
  ));
}

// ── Phase 1412: Public onboarding scoring ────────────────────────────────────
function _scorePubOnboarding(sessions) {
  if (!sessions.length) return 100;
  const now      = Date.now();
  const complete = sessions.filter(s => s.stage === "complete").length;
  const stale    = sessions.filter(s =>
    s.stage !== "complete" && now - (s.ts || 0) > 48 * 60 * 60 * 1000
  ).length;
  const depth = sessions.reduce((acc, s) => {
    const idx = VALID_ONBOARD_STAGES.indexOf(s.stage);
    return acc + (idx >= 0 ? idx + 1 : 0);
  }, 0) / sessions.length;
  return Math.max(0, Math.min(100, Math.round(
    (complete / sessions.length) * 60
    + (depth / VALID_ONBOARD_STAGES.length) * 30
    - stale * 8
  )));
}

// ── Phase 1413: Ecosystem moderation scoring ─────────────────────────────────
function _scoreModeration(actions) {
  if (!actions.length) return 100;
  const approved  = actions.filter(a => a.action === "approved").length;
  const rejected  = actions.filter(a => a.action === "rejected").length;
  const unapproved = actions.filter(a => a.action === "approved" && !a.operatorApproved).length;
  return Math.max(0, Math.round(
    (approved / actions.length) * 75
    + (actions.length > 0 ? 25 : 0)
    - rejected * 5
    - unapproved * 20
  ));
}

// ── Phase 1414: Plugin trust scoring ────────────────────────────────────────
function _scorePluginTrust(events) {
  if (!events.length) return 100;
  const byDim = {};
  for (const dim of VALID_PLUGIN_TRUST_DIMS) {
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

// ── Phase 1415: Public release scoring ───────────────────────────────────────
function _scorePubRelease(releases) {
  if (!releases.length) return 100;
  const live      = releases.filter(r => r.stage === "live").length;
  const unapproved = releases.filter(r =>
    ["deploying", "live"].includes(r.stage) && !r.approvedAt
  ).length;
  const retired   = releases.filter(r => r.stage === "retired").length;
  return Math.max(0, Math.min(100, Math.round(
    (live / releases.length) * 70
    + (releases.length > 0 ? 30 : 0)
    - retired * 3
    - unapproved * 30
  )));
}

// ── Phase 1416: User operational flow scoring ────────────────────────────────
function _scoreUserFlows(flows) {
  if (!flows.length) return 100;
  const now      = Date.now();
  const recent   = flows.filter(f => now - (f.ts || 0) < 24 * 60 * 60 * 1000);
  const typeSet  = new Set(recent.map(f => f.type).filter(t => VALID_USER_FLOW_TYPES.includes(t)));
  const coverage = typeSet.size / VALID_USER_FLOW_TYPES.length;
  return Math.min(100, Math.round(coverage * 80 + (recent.length > 0 ? 20 : 0)));
}

// ── Phase 1417: Public trust scoring ────────────────────────────────────────
function _scorePubTrust(events) {
  if (!events.length) return 100;
  const valid = events.filter(e => VALID_TRUST_EVENTS.includes(e.type)).length;
  return Math.min(100, Math.round((valid / events.length) * 100));
}

// ── Phase 1418: Multi-tenant public isolation check ───────────────────────────
function _checkPubIsolation(deploys, sessions, releases) {
  const violations = [];

  // Cross-tenant: deploy references tenant not in any session
  const tenantIds = new Set(sessions.map(s => s.tenantId).filter(Boolean));
  for (const d of deploys) {
    if (d.tenantId && !tenantIds.has(d.tenantId)) {
      violations.push({ type: "orphan_tenant_deploy", deployId: d.id, tenantId: d.tenantId, ts: Date.now() });
    }
  }

  // Replay separation: same tenantId with concurrent active deploys
  const tenantDeploys = {};
  for (const d of deploys.filter(d => !["complete", "rolled_back"].includes(d.stage))) {
    if (d.tenantId) {
      tenantDeploys[d.tenantId] = (tenantDeploys[d.tenantId] || 0) + 1;
    }
  }
  for (const [tenantId, count] of Object.entries(tenantDeploys)) {
    if (count > 2) {
      violations.push({ type: "concurrent_tenant_deploys", tenantId, count, ts: Date.now() });
    }
  }

  // Release replay crossover: same release ID in multiple active stages
  const releaseStages = {};
  for (const r of releases) {
    if (r.id) {
      if (!releaseStages[r.id]) releaseStages[r.id] = [];
      releaseStages[r.id].push(r.stage);
    }
  }
  for (const [releaseId, stages] of Object.entries(releaseStages)) {
    if (stages.length > 1) {
      violations.push({ type: "release_stage_bleed", releaseId, stageCount: stages.length, ts: Date.now() });
    }
  }

  return violations;
}

// ── Phase 1419: Public performance audit ────────────────────────────────────
function _computePubPerfAudit(deploys, sessions, releases, flows) {
  const findings = [];

  // Active deploy saturation
  const active = deploys.filter(d => !["complete", "rolled_back"].includes(d.stage));
  if (active.length > 5) findings.push({ id: "deploy_saturation", severity: "high", msg: `${active.length} active production deploys` });

  // Session duplication
  const sessionIds = sessions.map(s => s.sessionId).filter(Boolean);
  const sessionDupes = sessionIds.length - new Set(sessionIds).size;
  if (sessionDupes > 0) findings.push({ id: "session_duplication", severity: "high", msg: `${sessionDupes} duplicate onboarding session IDs` });

  // Release overflow
  if (releases.length > RELEASE_MAX) findings.push({ id: "release_overflow", severity: "medium", msg: `${releases.length} release records` });

  // User flow burst
  const recentFlows = flows.filter(f => Date.now() - (f.ts || 0) < 10 * 1000);
  if (recentFlows.length > 8) findings.push({ id: "flow_burst", severity: "medium", msg: `${recentFlows.length} user flows in 10s` });

  return {
    ts:        Date.now(),
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Composite public ecosystem score ─────────────────────────────────────────
function _computePubEcoScore({
  deployScore    = 100,
  onboardScore   = 100,
  modScore       = 100,
  pluginScore    = 100,
  releaseScore   = 100,
  userFlowScore  = 100,
  trustScore     = 100,
  isoViolations  = 0,
  perfScore      = 100,
} = {}) {
  const composite = Math.round(
    deployScore   * 0.20 +
    trustScore    * 0.20 +
    releaseScore  * 0.15 +
    modScore      * 0.15 +
    pluginScore   * 0.10 +
    onboardScore  * 0.10 +
    userFlowScore * 0.05 +
    perfScore     * 0.05
  ) - (isoViolations > 0 ? 15 : 0);
  return Math.max(0, Math.min(100, composite));
}

// ── Main hook ─────────────────────────────────────────────────────────────────
export function usePublicEcosystem() {
  const [prodDeploys,    setProdDeploys]    = useState([]);
  const [pubSessions,    setPubSessions]    = useState([]);
  const [moderationItems, setModerationItems] = useState([]);
  const [pluginTrustEvents, setPluginTrustEvents] = useState([]);
  const [releases,       setReleases]       = useState([]);
  const [userFlows,      setUserFlows]      = useState([]);
  const [trustEvents,    setTrustEvents]    = useState([]);
  const [pubIsoViolations, setPubIsoViolations] = useState([]);
  const [pubPerfAudit,   setPubPerfAudit]   = useState(null);
  const [initialized,    setInitialized]    = useState(false);

  // Phase 1411: Record production deployment (approval-gated)
  const recordProdDeploy = useCallback((event = {}) => {
    const { id, stage, tenantId, approvedAt } = event;
    if (!id || !VALID_DEPLOY_STAGES.includes(stage)) return;
    if (stage === "deploying" && !approvedAt) return;
    setProdDeploys(prev => {
      const now      = Date.now();
      const existing = prev.find(d => d.id === id);
      let next;
      if (existing) {
        next = prev.map(d => d.id === id ? { ...d, stage, approvedAt: approvedAt ?? d.approvedAt, updatedAt: now } : d);
      } else {
        next = [{ id, stage, tenantId, approvedAt, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(d => now - (d.ts || 0) < PROD_DEPLOY_TTL)
        .slice(0, PROD_DEPLOY_MAX);
      _save(PROD_DEPLOY_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1412: Record public onboarding step
  const recordPubOnboardStep = useCallback((event = {}) => {
    const { sessionId, tenantId, stage } = event;
    if (!sessionId || !VALID_ONBOARD_STAGES.includes(stage)) return;
    setPubSessions(prev => {
      const now      = Date.now();
      const existing = prev.find(s => s.sessionId === sessionId);
      let next;
      if (existing) {
        const newIdx = VALID_ONBOARD_STAGES.indexOf(stage);
        const curIdx = VALID_ONBOARD_STAGES.indexOf(existing.stage);
        if (newIdx <= curIdx) return prev;
        next = prev.map(s => s.sessionId === sessionId ? { ...s, stage, updatedAt: now } : s);
      } else {
        next = [{ sessionId, tenantId, stage, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(s => now - (s.ts || 0) < PUB_ONBOARD_TTL)
        .slice(0, PUB_ONBOARD_MAX);
      _save(PUB_ONBOARD_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1413: Record moderation action (operator-approved)
  const recordModerationAction = useCallback((event = {}) => {
    const { id, action, targetId, operatorApproved } = event;
    if (!id || !VALID_MOD_ACTIONS.includes(action)) return;
    if (action === "approved" && !operatorApproved) return;
    setModerationItems(prev => {
      const now   = Date.now();
      const dedup = prev.find(a => a.targetId === targetId && a.action === action && now - (a.ts || 0) < 5 * 60 * 1000);
      if (dedup) return prev;
      const next = [{ id, action, targetId, operatorApproved, ts: now }, ...prev]
        .filter(a => now - (a.ts || 0) < MODERATION_TTL)
        .slice(0, MODERATION_MAX);
      _save(MODERATION_KEY, next);
      return next;
    });
  }, []);

  // Phase 1414: Record plugin trust signal (privacy-safe)
  const recordPluginTrustSignal = useCallback((event = {}) => {
    const { dim, score, pluginId } = event;
    if (!VALID_PLUGIN_TRUST_DIMS.includes(dim)) return;
    if (event.rawContent || event.commandOutput || event.userInput) return;
    setPluginTrustEvents(prev => {
      const now   = Date.now();
      const dedup = prev.find(e => e.dim === dim && e.pluginId === pluginId && now - (e.ts || 0) < 5 * 60 * 1000);
      if (dedup) return prev;
      const next = [{ dim, score: Math.min(100, Math.max(0, score ?? 80)), pluginId, ts: now }, ...prev]
        .filter(e => now - (e.ts || 0) < PLUGIN_TRUST_TTL)
        .slice(0, PLUGIN_TRUST_MAX);
      _save(PLUGIN_TRUST_KEY, next);
      return next;
    });
  }, []);

  // Phase 1415: Record public release (approval-gated)
  const recordPubRelease = useCallback((event = {}) => {
    const { id, stage, approvedAt } = event;
    if (!id || !VALID_RELEASE_STAGES.includes(stage)) return;
    if (["deploying", "live"].includes(stage) && !approvedAt) return;
    setReleases(prev => {
      const now      = Date.now();
      const existing = prev.find(r => r.id === id);
      let next;
      if (existing) {
        next = prev.map(r => r.id === id ? { ...r, stage, approvedAt: approvedAt ?? r.approvedAt, updatedAt: now } : r);
      } else {
        next = [{ id, stage, approvedAt, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(r => now - (r.ts || 0) < RELEASE_TTL)
        .slice(0, RELEASE_MAX);
      _save(RELEASE_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1416: Record user operational flow (privacy-safe)
  const recordUserFlow = useCallback((event = {}) => {
    const { type, sessionId } = event;
    if (!VALID_USER_FLOW_TYPES.includes(type)) return;
    if (event.rawContent || event.commandOutput || event.userInput) return;
    setUserFlows(prev => {
      const now   = Date.now();
      const dedup = prev.find(f => f.type === type && f.sessionId === sessionId && now - (f.ts || 0) < 5 * 60 * 1000);
      if (dedup) return prev;
      const next = [{ type, sessionId, ts: now }, ...prev]
        .filter(f => now - (f.ts || 0) < USER_FLOW_TTL)
        .slice(0, USER_FLOW_MAX);
      _save(USER_FLOW_KEY, next);
      return next;
    });
  }, []);

  // Phase 1417: Record public trust event
  const recordPubTrustEvent = useCallback((event = {}) => {
    const { type } = event;
    if (!VALID_TRUST_EVENTS.includes(type)) return;
    setTrustEvents(prev => {
      const now   = Date.now();
      const dedup = prev.find(e => e.type === type && now - (e.ts || 0) < 5 * 60 * 1000);
      if (dedup) return prev;
      const next = [{ type, ts: now }, ...prev]
        .filter(e => now - (e.ts || 0) < PUB_TRUST_TTL)
        .slice(0, PUB_TRUST_MAX);
      _save(PUB_TRUST_KEY, next);
      return next;
    });
  }, []);

  // Phase 1418 + 1419: evaluate isolation + perf
  const evaluate = useCallback(() => {
    const now = Date.now();

    const isos = _checkPubIsolation(prodDeploys, pubSessions, releases);
    setPubIsoViolations(isos);
    if (isos.length) {
      const existing = _load(PUB_ISO_KEY, []);
      const next = [...isos, ...existing]
        .filter(v => now - (v.ts || 0) < PUB_ISO_TTL)
        .slice(0, PUB_ISO_MAX);
      _save(PUB_ISO_KEY, next);
    }

    const perf = _computePubPerfAudit(prodDeploys, pubSessions, releases, userFlows);
    setPubPerfAudit(perf);
    _save(PUB_PERF_KEY, perf);
  }, [prodDeploys, pubSessions, releases, userFlows]);

  useEffect(() => {
    const now = Date.now();
    setProdDeploys(_load(PROD_DEPLOY_KEY, []).filter(d => now - (d.ts || 0) < PROD_DEPLOY_TTL));
    setPubSessions(_load(PUB_ONBOARD_KEY, []).filter(s => now - (s.ts || 0) < PUB_ONBOARD_TTL));
    setModerationItems(_load(MODERATION_KEY, []).filter(a => now - (a.ts || 0) < MODERATION_TTL));
    setPluginTrustEvents(_load(PLUGIN_TRUST_KEY, []).filter(e => now - (e.ts || 0) < PLUGIN_TRUST_TTL));
    setReleases(_load(RELEASE_KEY, []).filter(r => now - (r.ts || 0) < RELEASE_TTL));
    setUserFlows(_load(USER_FLOW_KEY, []).filter(f => now - (f.ts || 0) < USER_FLOW_TTL));
    setTrustEvents(_load(PUB_TRUST_KEY, []).filter(e => now - (e.ts || 0) < PUB_TRUST_TTL));
    setInitialized(true);
  }, []);

  useEffect(() => { evaluate(); }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // ── Derived scores ────────────────────────────────────────────────────────
  const deployScore = useMemo(() => _scoreProdDeployments(prodDeploys), [prodDeploys]);

  const onboardScore = useMemo(
    () => _cached(`pubOnboard|${Math.floor(pubSessions.length / 3)}`, () => _scorePubOnboarding(pubSessions)),
    [pubSessions]
  );

  const modScore = useMemo(() => _scoreModeration(moderationItems), [moderationItems]);

  const pluginTrustScore = useMemo(
    () => _cached(`pluginTrust|${Math.floor(pluginTrustEvents.length / 5)}`, () => _scorePluginTrust(pluginTrustEvents)),
    [pluginTrustEvents]
  );

  const releaseScore = useMemo(() => _scorePubRelease(releases), [releases]);

  const userFlowScore = useMemo(() => _scoreUserFlows(userFlows), [userFlows]);

  const trustScore = useMemo(
    () => _cached(`pubTrust|${Math.floor(trustEvents.length / 3)}`, () => _scorePubTrust(trustEvents)),
    [trustEvents]
  );

  const pubEcoScore = useMemo(() => _computePubEcoScore({
    deployScore,
    onboardScore,
    modScore,
    pluginScore:  pluginTrustScore,
    releaseScore,
    userFlowScore,
    trustScore,
    isoViolations: pubIsoViolations.length,
    perfScore:    pubPerfAudit?.score ?? 100,
  }), [
    deployScore, onboardScore, modScore, pluginTrustScore,
    releaseScore, userFlowScore, trustScore,
    pubIsoViolations.length, pubPerfAudit?.score,
  ]);

  const pubEcoBar = useMemo(() => {
    if (pubEcoScore >= 80 && pubIsoViolations.length === 0 && !pubPerfAudit?.highCount) return null;
    const issue =
      pubIsoViolations.length  ? `Public isolation: ${pubIsoViolations.length} violation${pubIsoViolations.length > 1 ? "s" : ""}` :
      pubPerfAudit?.highCount  ? pubPerfAudit.findings.find(f => f.severity === "high")?.msg :
      trustScore < 60          ? `Public trust: ${trustScore}%` :
      releaseScore < 60        ? `Release health: ${releaseScore}%` :
      deployScore < 60         ? `Deploy health: ${deployScore}%` :
      null;
    const color = pubEcoScore >= 80 ? "var(--op-green)" : pubEcoScore >= 60 ? "var(--op-amber)" : "var(--op-red)";
    return { score: pubEcoScore, issue, color, hasCrit: pubEcoScore < 50 };
  }, [pubEcoScore, pubIsoViolations.length, pubPerfAudit, trustScore, releaseScore, deployScore]);

  return {
    initialized,
    prodDeploys,
    pubSessions,
    moderationItems,
    pluginTrustEvents,
    releases,
    userFlows,
    trustEvents,
    pubIsoViolations,
    pubPerfAudit,
    deployScore,
    onboardScore,
    modScore,
    pluginTrustScore,
    releaseScore,
    userFlowScore,
    trustScore,
    pubEcoScore,
    pubEcoBar,
    recordProdDeploy,
    recordPubOnboardStep,
    recordModerationAction,
    recordPluginTrustSignal,
    recordPubRelease,
    recordUserFlow,
    recordPubTrustEvent,
    evaluate,
  };
}
