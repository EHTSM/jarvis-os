// Phase 1366-1376: Ecosystem + platform economy maturity.
//
// Consolidates eleven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: all arrays capped, TTL-filtered, LRU-evicted cache.

import { useState, useEffect, useCallback, useMemo } from "react";

const WORKFLOW_ECO_KEY  = "jarvis_workflow_economy";
const PLUGIN_MON_KEY    = "jarvis_plugin_monetization";
const CREATOR_KEY       = "jarvis_creator_ecosystem";
const COLLAB_KEY        = "jarvis_op_collaboration";
const TEAM_MKT_KEY      = "jarvis_team_marketplace";
const REV_SURV_KEY      = "jarvis_revenue_survivability";
const GOV_KEY           = "jarvis_ecosystem_governance";
const ECO_ISO_KEY       = "jarvis_ecosystem_isolation";
const ECO_PERF_KEY      = "jarvis_eco_perf";

const WORKFLOW_ECO_MAX  = 20;
const PLUGIN_MON_MAX    = 20;
const CREATOR_MAX       = 20;
const COLLAB_MAX        = 20;
const TEAM_MKT_MAX      = 15;
const REV_SURV_MAX      = 30;
const GOV_MAX           = 20;
const ECO_ISO_MAX       = 20;
const ECO_PERF_MAX      = 20;

const WORKFLOW_ECO_TTL  = 7  * 24 * 60 * 60 * 1000;
const PLUGIN_MON_TTL    = 7  * 24 * 60 * 60 * 1000;
const CREATOR_TTL       = 7  * 24 * 60 * 60 * 1000;
const COLLAB_TTL        = 7  * 24 * 60 * 60 * 1000;
const TEAM_MKT_TTL      = 7  * 24 * 60 * 60 * 1000;
const REV_SURV_TTL      = 24 * 60 * 60 * 1000;
const GOV_TTL           = 7  * 24 * 60 * 60 * 1000;
const ECO_ISO_TTL       = 24 * 60 * 60 * 1000;
const ECO_PERF_TTL      = 24 * 60 * 60 * 1000;

const VALID_WORKFLOW_STAGES = ["draft", "packaged", "listed", "purchased", "deployed", "retired"];
const VALID_PLUGIN_STAGES   = ["draft", "listed", "installed", "active", "suspended", "removed"];
const VALID_CREATOR_STAGES  = ["onboarding", "publishing", "active", "featured", "suspended"];
const VALID_COLLAB_STAGES   = ["invited", "active", "syncing", "degraded", "departed"];
const VALID_TEAM_MKT_STAGES = ["draft", "distributed", "installed", "active", "archived"];
const VALID_REV_TYPES       = ["workflow_adoption", "plugin_continuity", "deploy_survivability", "op_trust", "eco_durability", "monetization_stability"];
const VALID_GOV_ACTIONS     = ["review_submitted", "approved", "flagged", "removed", "appealed"];

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

// ── Phase 1366: Workflow economy scoring ─────────────────────────────────────
function _scoreWorkflowEconomy(workflows) {
  if (!workflows.length) return 100;
  const active   = workflows.filter(w => ["purchased", "deployed", "active"].includes(w.stage)).length;
  const retired  = workflows.filter(w => w.stage === "retired").length;
  return Math.max(0, Math.min(100, Math.round(
    (active / workflows.length) * 80
    + (workflows.length > 0 ? 20 : 0)
    - retired * 5
  )));
}

// ── Phase 1367: Plugin monetization scoring ───────────────────────────────────
function _scorePluginMonetization(plugins) {
  if (!plugins.length) return 100;
  const active     = plugins.filter(p => p.stage === "active").length;
  const suspended  = plugins.filter(p => p.stage === "suspended").length;
  const unapproved = plugins.filter(p => p.stage === "active" && !p.approvedAt).length;
  return Math.max(0, Math.round(
    (active / plugins.length) * 80
    - suspended * 10
    - unapproved * 20
  ));
}

// ── Phase 1368: Creator ecosystem scoring ────────────────────────────────────
function _scoreCreatorEcosystem(creators) {
  if (!creators.length) return 100;
  const active    = creators.filter(c => ["active", "featured"].includes(c.stage)).length;
  const suspended = creators.filter(c => c.stage === "suspended").length;
  return Math.max(0, Math.round(
    (active / creators.length) * 85
    + (creators.length > 0 ? 15 : 0)
    - suspended * 15
  ));
}

// ── Phase 1369: Operational collaboration scoring ────────────────────────────
function _scoreCollaboration(collabs) {
  if (!collabs.length) return 100;
  const active   = collabs.filter(c => c.stage === "active" || c.stage === "syncing").length;
  const degraded = collabs.filter(c => c.stage === "degraded").length;
  return Math.max(0, Math.round(
    (active / collabs.length) * 90
    - degraded * 15
  ));
}

// ── Phase 1370: Team marketplace scoring ─────────────────────────────────────
function _scoreTeamMarketplace(items) {
  if (!items.length) return 100;
  const active   = items.filter(i => i.stage === "active").length;
  const archived = items.filter(i => i.stage === "archived").length;
  return Math.max(0, Math.round(
    (active / items.length) * 85
    + (items.length > 0 ? 15 : 0)
    - archived * 5
  ));
}

// ── Phase 1371: Revenue survivability aggregation ─────────────────────────────
function _aggregateRevenueSurvivability(events) {
  const byType = {};
  for (const t of VALID_REV_TYPES) {
    const typeEvents = events.filter(e => e.type === t);
    byType[t] = typeEvents.length
      ? Math.round(typeEvents.reduce((a, e) => a + (e.score ?? 80), 0) / typeEvents.length)
      : null;
  }
  const filled    = Object.values(byType).filter(v => v !== null);
  const composite = filled.length
    ? Math.round(filled.reduce((a, v) => a + v, 0) / filled.length)
    : 100;
  return {
    byType,
    composite,
    label: composite >= 80 ? "RESILIENT" : composite >= 60 ? "FRAGILE" : "CRITICAL",
  };
}

// ── Phase 1372: Ecosystem governance scoring ──────────────────────────────────
function _scoreGovernance(actions) {
  if (!actions.length) return 100;
  const approved = actions.filter(a => a.action === "approved").length;
  const flagged  = actions.filter(a => a.action === "flagged" || a.action === "removed").length;
  const unapproved = actions.filter(a =>
    a.action === "approved" && !a.operatorApproved
  ).length;
  return Math.max(0, Math.round(
    (approved / actions.length) * 70
    + (actions.length > 0 ? 30 : 0)
    - flagged * 10
    - unapproved * 20
  ));
}

// ── Phase 1373: Ecosystem isolation check ────────────────────────────────────
function _checkEcosystemIsolation(workflows, plugins, creators) {
  const violations = [];

  // Cross-ecosystem contamination: plugin references non-existent creator
  const creatorIds = new Set(creators.map(c => c.id).filter(Boolean));
  for (const p of plugins) {
    if (p.creatorId && !creatorIds.has(p.creatorId)) {
      violations.push({ type: "orphan_plugin_creator", pluginId: p.id, creatorId: p.creatorId, ts: Date.now() });
    }
  }

  // Workflow replay separation: same workflow ID active in multiple stages
  const wfStageMap = {};
  for (const w of workflows) {
    if (w.id) {
      if (!wfStageMap[w.id]) wfStageMap[w.id] = [];
      wfStageMap[w.id].push(w.stage);
    }
  }
  for (const [wfId, stages] of Object.entries(wfStageMap)) {
    if (stages.length > 1) {
      violations.push({ type: "workflow_stage_bleed", workflowId: wfId, stageCount: stages.length, ts: Date.now() });
    }
  }

  return violations;
}

// ── Phase 1374: Ecosystem performance audit ───────────────────────────────────
function _computeEcoPerfAudit(workflows, plugins, creators, revSurv) {
  const findings = [];

  // Marketplace saturation
  if (workflows.length > WORKFLOW_ECO_MAX) findings.push({ id: "workflow_overflow", severity: "medium", msg: `${workflows.length} workflow economy records` });

  // Plugin duplication
  const pluginIds = plugins.map(p => p.id);
  const pluginDupes = pluginIds.length - new Set(pluginIds).size;
  if (pluginDupes > 0) findings.push({ id: "plugin_duplication", severity: "high", msg: `${pluginDupes} duplicate plugin IDs` });

  // Revenue signal burst
  const recentRev = revSurv.filter(e => Date.now() - (e.ts || 0) < 10 * 1000);
  if (recentRev.length > 8) findings.push({ id: "revenue_burst", severity: "medium", msg: `${recentRev.length} revenue signals in 10s` });

  // Creator array size
  if (creators.length > CREATOR_MAX) findings.push({ id: "creator_overflow", severity: "medium", msg: `${creators.length} creator records` });

  return {
    ts:        Date.now(),
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Composite ecosystem economy score ────────────────────────────────────────
function _computeEcoScore({
  workflowScore  = 100,
  pluginScore    = 100,
  creatorScore   = 100,
  collabScore    = 100,
  teamMktScore   = 100,
  revScore       = 100,
  govScore       = 100,
  isoViolations  = 0,
  perfScore      = 100,
} = {}) {
  const composite = Math.round(
    govScore      * 0.20 +
    revScore      * 0.15 +
    pluginScore   * 0.15 +
    creatorScore  * 0.15 +
    workflowScore * 0.15 +
    collabScore   * 0.10 +
    teamMktScore  * 0.05 +
    perfScore     * 0.05
  ) - (isoViolations > 0 ? 15 : 0);
  return Math.max(0, Math.min(100, composite));
}

// ── Main hook ─────────────────────────────────────────────────────────────────
export function useEcosystemEconomy() {
  const [workflowEco,   setWorkflowEco]   = useState([]);
  const [pluginMon,     setPluginMon]     = useState([]);
  const [creators,      setCreators]      = useState([]);
  const [collabs,       setCollabs]       = useState([]);
  const [teamMkt,       setTeamMkt]       = useState([]);
  const [revSurv,       setRevSurv]       = useState([]);
  const [govActions,    setGovActions]    = useState([]);
  const [ecoIsoViolations, setEcoIsoViolations] = useState([]);
  const [ecoPerfAudit,  setEcoPerfAudit]  = useState(null);
  const [initialized,   setInitialized]   = useState(false);

  // Phase 1366: Record workflow economy event
  const recordWorkflowEcoEvent = useCallback((event = {}) => {
    const { id, stage, creatorId } = event;
    if (!id || !VALID_WORKFLOW_STAGES.includes(stage)) return;
    setWorkflowEco(prev => {
      const now      = Date.now();
      const existing = prev.find(w => w.id === id);
      let next;
      if (existing) {
        next = prev.map(w => w.id === id ? { ...w, stage, updatedAt: now } : w);
      } else {
        next = [{ id, stage, creatorId, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(w => now - (w.ts || 0) < WORKFLOW_ECO_TTL)
        .slice(0, WORKFLOW_ECO_MAX);
      _save(WORKFLOW_ECO_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1367: Record plugin monetization event (approval-gated for active)
  const recordPluginMonEvent = useCallback((event = {}) => {
    const { id, stage, creatorId, approvedAt } = event;
    if (!id || !VALID_PLUGIN_STAGES.includes(stage)) return;
    if (stage === "active" && !approvedAt) return;
    setPluginMon(prev => {
      const now      = Date.now();
      const existing = prev.find(p => p.id === id);
      let next;
      if (existing) {
        next = prev.map(p => p.id === id ? { ...p, stage, approvedAt: approvedAt ?? p.approvedAt, updatedAt: now } : p);
      } else {
        next = [{ id, stage, creatorId, approvedAt, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(p => now - (p.ts || 0) < PLUGIN_MON_TTL)
        .slice(0, PLUGIN_MON_MAX);
      _save(PLUGIN_MON_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1368: Record creator ecosystem event
  const recordCreatorEvent = useCallback((event = {}) => {
    const { id, stage } = event;
    if (!id || !VALID_CREATOR_STAGES.includes(stage)) return;
    setCreators(prev => {
      const now      = Date.now();
      const existing = prev.find(c => c.id === id);
      let next;
      if (existing) {
        next = prev.map(c => c.id === id ? { ...c, stage, updatedAt: now } : c);
      } else {
        next = [{ id, stage, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(c => now - (c.ts || 0) < CREATOR_TTL)
        .slice(0, CREATOR_MAX);
      _save(CREATOR_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1369: Record collaboration event
  const recordCollabEvent = useCallback((event = {}) => {
    const { userId, orgId, stage } = event;
    if (!userId || !VALID_COLLAB_STAGES.includes(stage)) return;
    setCollabs(prev => {
      const now      = Date.now();
      const existing = prev.find(c => c.userId === userId && c.orgId === orgId);
      let next;
      if (existing) {
        next = prev.map(c =>
          c.userId === userId && c.orgId === orgId ? { ...c, stage, updatedAt: now } : c
        );
      } else {
        next = [{ userId, orgId, stage, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(c => now - (c.ts || 0) < COLLAB_TTL)
        .slice(0, COLLAB_MAX);
      _save(COLLAB_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1370: Record team marketplace event
  const recordTeamMktEvent = useCallback((event = {}) => {
    const { id, stage, orgId } = event;
    if (!id || !VALID_TEAM_MKT_STAGES.includes(stage)) return;
    setTeamMkt(prev => {
      const now      = Date.now();
      const existing = prev.find(t => t.id === id);
      let next;
      if (existing) {
        next = prev.map(t => t.id === id ? { ...t, stage, updatedAt: now } : t);
      } else {
        // 5-min dedup per orgId
        const recentSame = prev.find(t =>
          t.orgId === orgId && t.stage === "distributed" && now - (t.ts || 0) < 5 * 60 * 1000
        );
        if (recentSame && stage === "distributed") return prev;
        next = [{ id, stage, orgId, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(t => now - (t.ts || 0) < TEAM_MKT_TTL)
        .slice(0, TEAM_MKT_MAX);
      _save(TEAM_MKT_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1371: Record revenue survivability signal (privacy-safe)
  const recordRevenueSurvivability = useCallback((event = {}) => {
    const { type, score } = event;
    if (!VALID_REV_TYPES.includes(type)) return;
    if (event.rawContent || event.commandOutput || event.userInput) return;
    setRevSurv(prev => {
      const now   = Date.now();
      const dedup = prev.find(e => e.type === type && now - (e.ts || 0) < 2 * 60 * 1000);
      if (dedup) return prev;
      const next = [{ type, score: Math.min(100, Math.max(0, score ?? 80)), ts: now }, ...prev]
        .filter(e => now - (e.ts || 0) < REV_SURV_TTL)
        .slice(0, REV_SURV_MAX);
      _save(REV_SURV_KEY, next);
      return next;
    });
  }, []);

  // Phase 1372: Record governance action (operator-approved)
  const recordGovAction = useCallback((event = {}) => {
    const { id, action, targetId, operatorApproved } = event;
    if (!id || !VALID_GOV_ACTIONS.includes(action)) return;
    if (["approved"].includes(action) && !operatorApproved) return;
    setGovActions(prev => {
      const now   = Date.now();
      const dedup = prev.find(a => a.targetId === targetId && a.action === action && now - (a.ts || 0) < 5 * 60 * 1000);
      if (dedup) return prev;
      const next = [{ id, action, targetId, operatorApproved, ts: now }, ...prev]
        .filter(a => now - (a.ts || 0) < GOV_TTL)
        .slice(0, GOV_MAX);
      _save(GOV_KEY, next);
      return next;
    });
  }, []);

  // Phase 1373 + 1374: evaluate isolation + perf
  const evaluate = useCallback(() => {
    const now = Date.now();

    const isos = _checkEcosystemIsolation(workflowEco, pluginMon, creators);
    setEcoIsoViolations(isos);
    if (isos.length) {
      const existing = _load(ECO_ISO_KEY, []);
      const next = [...isos, ...existing]
        .filter(v => now - (v.ts || 0) < ECO_ISO_TTL)
        .slice(0, ECO_ISO_MAX);
      _save(ECO_ISO_KEY, next);
    }

    const perf = _computeEcoPerfAudit(workflowEco, pluginMon, creators, revSurv);
    setEcoPerfAudit(perf);
    _save(ECO_PERF_KEY, perf);
  }, [workflowEco, pluginMon, creators, revSurv]);

  useEffect(() => {
    const now = Date.now();
    setWorkflowEco(_load(WORKFLOW_ECO_KEY, []).filter(w => now - (w.ts || 0) < WORKFLOW_ECO_TTL));
    setPluginMon(_load(PLUGIN_MON_KEY, []).filter(p => now - (p.ts || 0) < PLUGIN_MON_TTL));
    setCreators(_load(CREATOR_KEY, []).filter(c => now - (c.ts || 0) < CREATOR_TTL));
    setCollabs(_load(COLLAB_KEY, []).filter(c => now - (c.ts || 0) < COLLAB_TTL));
    setTeamMkt(_load(TEAM_MKT_KEY, []).filter(t => now - (t.ts || 0) < TEAM_MKT_TTL));
    setRevSurv(_load(REV_SURV_KEY, []).filter(e => now - (e.ts || 0) < REV_SURV_TTL));
    setGovActions(_load(GOV_KEY, []).filter(a => now - (a.ts || 0) < GOV_TTL));
    setInitialized(true);
  }, []);

  useEffect(() => { evaluate(); }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // ── Derived scores ────────────────────────────────────────────────────────
  const workflowScore = useMemo(() => _scoreWorkflowEconomy(workflowEco), [workflowEco]);

  const pluginMonScore = useMemo(() => _scorePluginMonetization(pluginMon), [pluginMon]);

  const creatorScore = useMemo(
    () => _cached(`creator|${Math.floor(creators.length / 3)}`, () => _scoreCreatorEcosystem(creators)),
    [creators]
  );

  const collabScore = useMemo(() => _scoreCollaboration(collabs), [collabs]);

  const teamMktScore = useMemo(() => _scoreTeamMarketplace(teamMkt), [teamMkt]);

  const revSurvAgg = useMemo(
    () => _cached(`revSurv|${Math.floor(revSurv.length / 5)}`, () => _aggregateRevenueSurvivability(revSurv)),
    [revSurv]
  );

  const govScore = useMemo(() => _scoreGovernance(govActions), [govActions]);

  const ecoScore = useMemo(() => _computeEcoScore({
    workflowScore,
    pluginScore:   pluginMonScore,
    creatorScore,
    collabScore,
    teamMktScore,
    revScore:      revSurvAgg.composite,
    govScore,
    isoViolations: ecoIsoViolations.length,
    perfScore:     ecoPerfAudit?.score ?? 100,
  }), [
    workflowScore, pluginMonScore, creatorScore, collabScore,
    teamMktScore, revSurvAgg.composite, govScore,
    ecoIsoViolations.length, ecoPerfAudit?.score,
  ]);

  const ecoBar = useMemo(() => {
    if (ecoScore >= 80 && ecoIsoViolations.length === 0 && !ecoPerfAudit?.highCount) return null;
    const issue =
      ecoIsoViolations.length   ? `Ecosystem isolation: ${ecoIsoViolations.length} violation${ecoIsoViolations.length > 1 ? "s" : ""}` :
      ecoPerfAudit?.highCount   ? ecoPerfAudit.findings.find(f => f.severity === "high")?.msg :
      govScore < 60             ? `Governance: ${govScore}%` :
      revSurvAgg.label !== "RESILIENT" ? `Revenue survivability: ${revSurvAgg.label}` :
      pluginMonScore < 60       ? `Plugin monetization: ${pluginMonScore}%` :
      null;
    const color = ecoScore >= 80 ? "var(--op-green)" : ecoScore >= 60 ? "var(--op-amber)" : "var(--op-red)";
    return { score: ecoScore, issue, color, hasCrit: ecoScore < 50 };
  }, [ecoScore, ecoIsoViolations.length, ecoPerfAudit, govScore, revSurvAgg.label, pluginMonScore]);

  return {
    initialized,
    workflowEco,
    pluginMon,
    creators,
    collabs,
    teamMkt,
    revSurv,
    govActions,
    ecoIsoViolations,
    ecoPerfAudit,
    workflowScore,
    pluginMonScore,
    creatorScore,
    collabScore,
    teamMktScore,
    revSurvAgg,
    govScore,
    ecoScore,
    ecoBar,
    recordWorkflowEcoEvent,
    recordPluginMonEvent,
    recordCreatorEvent,
    recordCollabEvent,
    recordTeamMktEvent,
    recordRevenueSurvivability,
    recordGovAction,
    evaluate,
  };
}
