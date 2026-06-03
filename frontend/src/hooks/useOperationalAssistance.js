// Phase 1396-1407: Autonomous operational assistance + execution coordination.
//
// Consolidates twelve phases. No external calls. No autonomous execution.
// All state: localStorage-only. All recommendations are operator-visible and
// require explicit operator action — no self-executing guidance.
// Bounded: all arrays capped, TTL-filtered, LRU-evicted cache.

import { useState, useEffect, useCallback, useMemo } from "react";

const COPILOT_KEY    = "jarvis_op_copilot";
const EXEC_COORD_KEY = "jarvis_exec_coordination";
const PRODUCTIVITY_KEY = "jarvis_productivity_accel";
const CONTEXT_KEY    = "jarvis_contextual_assist";
const RECS_KEY       = "jarvis_exec_recommendations";
const MEMORY_KEY     = "jarvis_op_memory";
const MULTIWF_KEY    = "jarvis_multi_workflow";
const TRUST_INTEL_KEY = "jarvis_assist_trust";
const ASSIST_ISO_KEY = "jarvis_assist_isolation";
const ASSIST_PERF_KEY = "jarvis_assist_perf";

const COPILOT_MAX    = 20;
const EXEC_COORD_MAX = 20;
const PRODUCTIVITY_MAX = 30;
const CONTEXT_MAX    = 20;
const RECS_MAX       = 15;
const MEMORY_MAX     = 30;
const MULTIWF_MAX    = 15;
const TRUST_MAX      = 30;
const ASSIST_ISO_MAX = 20;
const ASSIST_PERF_MAX = 20;

const COPILOT_TTL    = 7  * 24 * 60 * 60 * 1000;
const EXEC_COORD_TTL = 24 * 60 * 60 * 1000;
const PRODUCTIVITY_TTL = 24 * 60 * 60 * 1000;
const CONTEXT_TTL    = 24 * 60 * 60 * 1000;
const RECS_TTL       = 24 * 60 * 60 * 1000;
const MEMORY_TTL     = 7  * 24 * 60 * 60 * 1000;
const MULTIWF_TTL    = 24 * 60 * 60 * 1000;
const TRUST_TTL      = 7  * 24 * 60 * 60 * 1000;
const ASSIST_ISO_TTL = 24 * 60 * 60 * 1000;
const ASSIST_PERF_TTL = 24 * 60 * 60 * 1000;

const VALID_COPILOT_TYPES   = ["deploy_guidance", "replay_suggestion", "workflow_rec", "infra_tip", "recovery_step"];
const VALID_COORD_TYPES     = ["sequence_suggestion", "dependency_hint", "parallelism_tip", "bottleneck_alert", "reorder_rec"];
const VALID_PROD_DIMS       = ["workflow_completion", "replay_quality", "deploy_responsiveness", "op_trust", "eng_productivity", "exec_durability"];
const VALID_CONTEXT_TYPES   = ["workflow_hint", "deploy_context", "replay_context", "infra_context", "recovery_context"];
const VALID_REC_TYPES       = ["deploy_optimize", "replay_recovery", "workflow_sequence", "op_insight", "exec_continuity"];
const VALID_MEMORY_TYPES    = ["deploy_history", "workflow_progression", "replay_checkpoint", "op_pattern", "survivability_note"];
const VALID_MULTIWF_STAGES  = ["queued", "active", "syncing", "blocked", "complete"];
const VALID_TRUST_DIMS      = ["usefulness", "replay_continuity", "deploy_smoothness", "workflow_durability", "op_calmness"];

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

// ── Phase 1396: Copilot guidance scoring ──────────────────────────────────────
function _scoreCopilot(items) {
  if (!items.length) return 100;
  const acted  = items.filter(i => i.acted === true).length;
  const stale  = items.filter(i => !i.acted && Date.now() - (i.ts || 0) > 24 * 60 * 60 * 1000).length;
  return Math.max(0, Math.min(100, Math.round(
    (acted / items.length) * 60
    + (items.length > 0 ? 40 : 0)
    - stale * 5
  )));
}

// ── Phase 1397: Execution coordination scoring ───────────────────────────────
function _scoreExecCoord(events) {
  if (!events.length) return 100;
  const applied  = events.filter(e => e.applied === true).length;
  const rejected = events.filter(e => e.applied === false).length;
  return Math.max(0, Math.round(
    (applied / events.length) * 80
    + (events.length > 0 ? 20 : 0)
    - rejected * 5
  ));
}

// ── Phase 1398: Productivity acceleration aggregation ────────────────────────
function _aggregateProductivity(events) {
  const byDim = {};
  for (const dim of VALID_PROD_DIMS) {
    const dimEvents = events.filter(e => e.dim === dim);
    byDim[dim] = dimEvents.length
      ? Math.round(dimEvents.reduce((a, e) => a + (e.score ?? 80), 0) / dimEvents.length)
      : null;
  }
  const filled    = Object.values(byDim).filter(v => v !== null);
  const composite = filled.length
    ? Math.round(filled.reduce((a, v) => a + v, 0) / filled.length)
    : 100;
  return { byDim, composite };
}

// ── Phase 1400: Recommendation scoring ───────────────────────────────────────
function _scoreRecommendations(recs) {
  if (!recs.length) return 100;
  const acted  = recs.filter(r => r.acted === true).length;
  const stale  = recs.filter(r => !r.acted && Date.now() - (r.ts || 0) > 12 * 60 * 60 * 1000).length;
  return Math.max(0, Math.min(100, Math.round(
    (acted / recs.length) * 70
    + (recs.length > 0 ? 30 : 0)
    - stale * 8
  )));
}

// ── Phase 1401: Operational memory scoring ────────────────────────────────────
function _scoreOpMemory(items) {
  if (!items.length) return 100;
  const now    = Date.now();
  const recent = items.filter(i => now - (i.ts || 0) < 7 * 24 * 60 * 60 * 1000);
  const valid  = recent.filter(i => VALID_MEMORY_TYPES.includes(i.type)).length;
  return Math.min(100, Math.round((valid / Math.max(recent.length, 1)) * 100));
}

// ── Phase 1402: Multi-workflow scoring ───────────────────────────────────────
function _scoreMultiWorkflow(workflows) {
  if (!workflows.length) return 100;
  const active   = workflows.filter(w => w.stage === "active" || w.stage === "complete").length;
  const blocked  = workflows.filter(w => w.stage === "blocked").length;
  return Math.max(0, Math.round(
    (active / workflows.length) * 85
    + (workflows.length > 0 ? 15 : 0)
    - blocked * 10
  ));
}

// ── Phase 1403: Operational trust intelligence ────────────────────────────────
function _computeTrustIntel(events) {
  if (!events.length) return { score: 100, byDim: {} };
  const byDim = {};
  for (const dim of VALID_TRUST_DIMS) {
    const dimEvents = events.filter(e => e.dim === dim);
    byDim[dim] = dimEvents.length
      ? Math.round(dimEvents.reduce((a, e) => a + (e.score ?? 80), 0) / dimEvents.length)
      : null;
  }
  const filled = Object.values(byDim).filter(v => v !== null);
  const score  = filled.length
    ? Math.round(filled.reduce((a, v) => a + v, 0) / filled.length)
    : 100;
  return { score, byDim };
}

// ── Phase 1404: Assistance isolation check ───────────────────────────────────
function _checkAssistIsolation(copilotItems, recs, multiWorkflows) {
  const violations = [];

  // Cross-session contamination: recommendations referencing unknown workflow IDs
  const wfIds = new Set(multiWorkflows.map(w => w.id).filter(Boolean));
  for (const r of recs) {
    if (r.workflowId && !wfIds.has(r.workflowId)) {
      violations.push({ type: "orphan_recommendation", recId: r.id, workflowId: r.workflowId, ts: Date.now() });
    }
  }

  // Replay crossover: same session ID with conflicting copilot guidance
  const sessionGuidance = {};
  for (const item of copilotItems) {
    if (item.sessionId && item.type) {
      if (!sessionGuidance[item.sessionId]) sessionGuidance[item.sessionId] = new Set();
      sessionGuidance[item.sessionId].add(item.type);
    }
  }
  for (const [sessionId, types] of Object.entries(sessionGuidance)) {
    if (types.size > VALID_COPILOT_TYPES.length) {
      violations.push({ type: "session_guidance_bleed", sessionId, typeCount: types.size, ts: Date.now() });
    }
  }

  return violations;
}

// ── Phase 1405: Assistance performance audit ─────────────────────────────────
function _computeAssistPerf(copilotItems, recs, multiWorkflows, memoryItems) {
  const findings = [];

  // Recommendation staleness overflow
  const staleRecs = recs.filter(r => !r.acted && Date.now() - (r.ts || 0) > 12 * 60 * 60 * 1000);
  if (staleRecs.length > 5) findings.push({ id: "stale_recs", severity: "medium", msg: `${staleRecs.length} stale recommendations` });

  // Multi-workflow blocked overflow
  const blocked = multiWorkflows.filter(w => w.stage === "blocked");
  if (blocked.length > 3) findings.push({ id: "workflow_blocked", severity: "high", msg: `${blocked.length} blocked workflows` });

  // Memory duplication check
  const memIds = memoryItems.map(m => m.id).filter(Boolean);
  const memDupes = memIds.length - new Set(memIds).size;
  if (memDupes > 0) findings.push({ id: "memory_duplication", severity: "high", msg: `${memDupes} duplicate memory entries` });

  // Copilot array size
  if (copilotItems.length > COPILOT_MAX) findings.push({ id: "copilot_overflow", severity: "medium", msg: `${copilotItems.length} copilot items` });

  return {
    ts:        Date.now(),
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Composite assistance score ────────────────────────────────────────────────
function _computeAssistScore({
  copilotScore    = 100,
  coordScore      = 100,
  productivityScore = 100,
  recScore        = 100,
  memoryScore     = 100,
  multiWfScore    = 100,
  trustScore      = 100,
  isoViolations   = 0,
  perfScore       = 100,
} = {}) {
  const composite = Math.round(
    trustScore       * 0.20 +
    productivityScore * 0.20 +
    coordScore       * 0.15 +
    recScore         * 0.15 +
    copilotScore     * 0.10 +
    multiWfScore     * 0.10 +
    memoryScore      * 0.05 +
    perfScore        * 0.05
  ) - (isoViolations > 0 ? 10 : 0);
  return Math.max(0, Math.min(100, composite));
}

// ── Main hook ─────────────────────────────────────────────────────────────────
export function useOperationalAssistance() {
  const [copilotItems,   setCopilotItems]   = useState([]);
  const [execCoords,     setExecCoords]     = useState([]);
  const [productivityEvents, setProductivityEvents] = useState([]);
  const [contextItems,   setContextItems]   = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [memoryItems,    setMemoryItems]    = useState([]);
  const [multiWorkflows, setMultiWorkflows] = useState([]);
  const [trustEvents,    setTrustEvents]    = useState([]);
  const [assistIsoViolations, setAssistIsoViolations] = useState([]);
  const [assistPerfAudit, setAssistPerfAudit] = useState(null);
  const [initialized,    setInitialized]    = useState(false);

  // Phase 1396: Record copilot guidance item (operator-visible only)
  const recordCopilotItem = useCallback((event = {}) => {
    const { id, type, sessionId, summary } = event;
    if (!id || !VALID_COPILOT_TYPES.includes(type)) return;
    if (!summary) return; // must have operator-visible reasoning
    setCopilotItems(prev => {
      const now      = Date.now();
      const existing = prev.find(i => i.id === id);
      if (existing) return prev;
      // 5-min dedup per type+session
      const dedup = prev.find(i =>
        i.type === type && i.sessionId === sessionId && now - (i.ts || 0) < 5 * 60 * 1000
      );
      if (dedup) return prev;
      const next = [{ id, type, sessionId, summary, acted: false, ts: now }, ...prev]
        .filter(i => now - (i.ts || 0) < COPILOT_TTL)
        .slice(0, COPILOT_MAX);
      _save(COPILOT_KEY, next);
      return next;
    });
  }, []);

  // Mark copilot item as acted (operator confirms)
  const actOnCopilotItem = useCallback((id) => {
    setCopilotItems(prev => {
      const next = prev.map(i => i.id === id ? { ...i, acted: true, actedAt: Date.now() } : i);
      _save(COPILOT_KEY, next);
      return next;
    });
  }, []);

  // Phase 1397: Record execution coordination suggestion
  const recordExecCoord = useCallback((event = {}) => {
    const { id, type, summary } = event;
    if (!id || !VALID_COORD_TYPES.includes(type)) return;
    if (!summary) return;
    setExecCoords(prev => {
      const now   = Date.now();
      const dedup = prev.find(e => e.type === type && now - (e.ts || 0) < 2 * 60 * 1000);
      if (dedup) return prev;
      const next = [{ id, type, summary, applied: null, ts: now }, ...prev]
        .filter(e => now - (e.ts || 0) < EXEC_COORD_TTL)
        .slice(0, EXEC_COORD_MAX);
      _save(EXEC_COORD_KEY, next);
      return next;
    });
  }, []);

  // Phase 1398: Record productivity signal (privacy-safe)
  const recordProductivityEvent = useCallback((event = {}) => {
    const { dim, score } = event;
    if (!VALID_PROD_DIMS.includes(dim)) return;
    if (event.rawContent || event.commandOutput || event.userInput) return;
    setProductivityEvents(prev => {
      const now   = Date.now();
      const dedup = prev.find(e => e.dim === dim && now - (e.ts || 0) < 30 * 1000);
      if (dedup) return prev;
      const next = [{ dim, score: Math.min(100, Math.max(0, score ?? 80)), ts: now }, ...prev]
        .filter(e => now - (e.ts || 0) < PRODUCTIVITY_TTL)
        .slice(0, PRODUCTIVITY_MAX);
      _save(PRODUCTIVITY_KEY, next);
      return next;
    });
  }, []);

  // Phase 1399: Record contextual assistance item
  const recordContextItem = useCallback((event = {}) => {
    const { id, type, summary, sessionId } = event;
    if (!id || !VALID_CONTEXT_TYPES.includes(type)) return;
    if (!summary) return;
    setContextItems(prev => {
      const now   = Date.now();
      const dedup = prev.find(i => i.type === type && i.sessionId === sessionId && now - (i.ts || 0) < 5 * 60 * 1000);
      if (dedup) return prev;
      const next = [{ id, type, summary, sessionId, ts: now }, ...prev]
        .filter(i => now - (i.ts || 0) < CONTEXT_TTL)
        .slice(0, CONTEXT_MAX);
      _save(CONTEXT_KEY, next);
      return next;
    });
  }, []);

  // Phase 1400: Record execution recommendation
  const recordRecommendation = useCallback((event = {}) => {
    const { id, type, summary, workflowId } = event;
    if (!id || !VALID_REC_TYPES.includes(type)) return;
    if (!summary) return;
    setRecommendations(prev => {
      const now   = Date.now();
      const dedup = prev.find(r => r.type === type && now - (r.ts || 0) < 5 * 60 * 1000);
      if (dedup) return prev;
      const next = [{ id, type, summary, workflowId, acted: false, ts: now }, ...prev]
        .filter(r => now - (r.ts || 0) < RECS_TTL)
        .slice(0, RECS_MAX);
      _save(RECS_KEY, next);
      return next;
    });
  }, []);

  // Mark recommendation as acted
  const actOnRecommendation = useCallback((id) => {
    setRecommendations(prev => {
      const next = prev.map(r => r.id === id ? { ...r, acted: true, actedAt: Date.now() } : r);
      _save(RECS_KEY, next);
      return next;
    });
  }, []);

  // Phase 1401: Record operational memory item
  const recordMemoryItem = useCallback((event = {}) => {
    const { id, type, summary } = event;
    if (!id || !VALID_MEMORY_TYPES.includes(type)) return;
    if (!summary) return;
    if (event.rawContent || event.commandOutput || event.userInput) return;
    setMemoryItems(prev => {
      const now      = Date.now();
      const existing = prev.find(m => m.id === id);
      if (existing) {
        const next = prev.map(m => m.id === id ? { ...m, summary, updatedAt: now } : m);
        _save(MEMORY_KEY, next);
        return next;
      }
      const next = [{ id, type, summary, ts: now, updatedAt: now }, ...prev]
        .filter(m => now - (m.ts || 0) < MEMORY_TTL)
        .slice(0, MEMORY_MAX);
      _save(MEMORY_KEY, next);
      return next;
    });
  }, []);

  // Phase 1402: Record multi-workflow coordination event
  const recordMultiWorkflow = useCallback((event = {}) => {
    const { id, stage, sessionId } = event;
    if (!id || !VALID_MULTIWF_STAGES.includes(stage)) return;
    setMultiWorkflows(prev => {
      const now      = Date.now();
      const existing = prev.find(w => w.id === id);
      let next;
      if (existing) {
        next = prev.map(w => w.id === id ? { ...w, stage, updatedAt: now } : w);
      } else {
        next = [{ id, stage, sessionId, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(w => now - (w.ts || 0) < MULTIWF_TTL)
        .slice(0, MULTIWF_MAX);
      _save(MULTIWF_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1403: Record trust intelligence signal (privacy-safe)
  const recordTrustSignal = useCallback((event = {}) => {
    const { dim, score } = event;
    if (!VALID_TRUST_DIMS.includes(dim)) return;
    if (event.rawContent || event.commandOutput || event.userInput) return;
    setTrustEvents(prev => {
      const now   = Date.now();
      const dedup = prev.find(e => e.dim === dim && now - (e.ts || 0) < 5 * 60 * 1000);
      if (dedup) return prev;
      const next = [{ dim, score: Math.min(100, Math.max(0, score ?? 80)), ts: now }, ...prev]
        .filter(e => now - (e.ts || 0) < TRUST_TTL)
        .slice(0, TRUST_MAX);
      _save(TRUST_INTEL_KEY, next);
      return next;
    });
  }, []);

  // Phase 1404 + 1405: evaluate isolation + perf
  const evaluate = useCallback(() => {
    const now = Date.now();

    const isos = _checkAssistIsolation(copilotItems, recommendations, multiWorkflows);
    setAssistIsoViolations(isos);
    if (isos.length) {
      const existing = _load(ASSIST_ISO_KEY, []);
      const next = [...isos, ...existing]
        .filter(v => now - (v.ts || 0) < ASSIST_ISO_TTL)
        .slice(0, ASSIST_ISO_MAX);
      _save(ASSIST_ISO_KEY, next);
    }

    const perf = _computeAssistPerf(copilotItems, recommendations, multiWorkflows, memoryItems);
    setAssistPerfAudit(perf);
    _save(ASSIST_PERF_KEY, perf);
  }, [copilotItems, recommendations, multiWorkflows, memoryItems]);

  useEffect(() => {
    const now = Date.now();
    setCopilotItems(_load(COPILOT_KEY, []).filter(i => now - (i.ts || 0) < COPILOT_TTL));
    setExecCoords(_load(EXEC_COORD_KEY, []).filter(e => now - (e.ts || 0) < EXEC_COORD_TTL));
    setProductivityEvents(_load(PRODUCTIVITY_KEY, []).filter(e => now - (e.ts || 0) < PRODUCTIVITY_TTL));
    setContextItems(_load(CONTEXT_KEY, []).filter(i => now - (i.ts || 0) < CONTEXT_TTL));
    setRecommendations(_load(RECS_KEY, []).filter(r => now - (r.ts || 0) < RECS_TTL));
    setMemoryItems(_load(MEMORY_KEY, []).filter(m => now - (m.ts || 0) < MEMORY_TTL));
    setMultiWorkflows(_load(MULTIWF_KEY, []).filter(w => now - (w.ts || 0) < MULTIWF_TTL));
    setTrustEvents(_load(TRUST_INTEL_KEY, []).filter(e => now - (e.ts || 0) < TRUST_TTL));
    setInitialized(true);
  }, []);

  useEffect(() => { evaluate(); }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // ── Derived scores ────────────────────────────────────────────────────────
  const copilotScore = useMemo(() => _scoreCopilot(copilotItems), [copilotItems]);

  const coordScore = useMemo(() => _scoreExecCoord(execCoords), [execCoords]);

  const productivityAgg = useMemo(
    () => _cached(`prod|${Math.floor(productivityEvents.length / 5)}`, () => _aggregateProductivity(productivityEvents)),
    [productivityEvents]
  );

  const recScore = useMemo(() => _scoreRecommendations(recommendations), [recommendations]);

  const memoryScore = useMemo(() => _scoreOpMemory(memoryItems), [memoryItems]);

  const multiWfScore = useMemo(() => _scoreMultiWorkflow(multiWorkflows), [multiWorkflows]);

  const trustIntel = useMemo(
    () => _cached(`trust|${Math.floor(trustEvents.length / 5)}`, () => _computeTrustIntel(trustEvents)),
    [trustEvents]
  );

  const assistScore = useMemo(() => _computeAssistScore({
    copilotScore,
    coordScore,
    productivityScore: productivityAgg.composite,
    recScore,
    memoryScore,
    multiWfScore,
    trustScore:   trustIntel.score,
    isoViolations: assistIsoViolations.length,
    perfScore:    assistPerfAudit?.score ?? 100,
  }), [
    copilotScore, coordScore, productivityAgg.composite, recScore,
    memoryScore, multiWfScore, trustIntel.score,
    assistIsoViolations.length, assistPerfAudit?.score,
  ]);

  // Top unacted recommendation for operator visibility
  const topRecommendation = useMemo(() => {
    const unacted = recommendations.filter(r => !r.acted);
    return unacted.length ? unacted[0] : null;
  }, [recommendations]);

  const assistBar = useMemo(() => {
    if (assistScore >= 80 && assistIsoViolations.length === 0 && !assistPerfAudit?.highCount) return null;
    const issue =
      assistIsoViolations.length ? `Assist isolation: ${assistIsoViolations.length} violation${assistIsoViolations.length > 1 ? "s" : ""}` :
      assistPerfAudit?.highCount ? assistPerfAudit.findings.find(f => f.severity === "high")?.msg :
      trustIntel.score < 60      ? `Assist trust: ${trustIntel.score}%` :
      multiWfScore < 60          ? `Multi-workflow: ${multiWfScore}%` :
      null;
    const color = assistScore >= 80 ? "var(--op-green)" : assistScore >= 60 ? "var(--op-amber)" : "var(--op-red)";
    return { score: assistScore, issue, color, hasCrit: assistScore < 50 };
  }, [assistScore, assistIsoViolations.length, assistPerfAudit, trustIntel.score, multiWfScore]);

  return {
    initialized,
    copilotItems,
    execCoords,
    productivityEvents,
    contextItems,
    recommendations,
    memoryItems,
    multiWorkflows,
    trustEvents,
    assistIsoViolations,
    assistPerfAudit,
    copilotScore,
    coordScore,
    productivityAgg,
    recScore,
    memoryScore,
    multiWfScore,
    trustIntel,
    assistScore,
    topRecommendation,
    assistBar,
    recordCopilotItem,
    actOnCopilotItem,
    recordExecCoord,
    recordProductivityEvent,
    recordContextItem,
    recordRecommendation,
    actOnRecommendation,
    recordMemoryItem,
    recordMultiWorkflow,
    recordTrustSignal,
    evaluate,
  };
}
