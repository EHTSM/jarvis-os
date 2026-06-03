// Phase 1291-1301: Platform reliability + incident operations.
//
// Consolidates eleven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: all arrays capped, TTL-filtered, LRU-evicted cache.

import { useState, useEffect, useCallback, useMemo } from "react";

const INCIDENT_KEY   = "jarvis_incidents";
const OUTAGE_KEY     = "jarvis_outage_signals";
const RECOVERY_KEY   = "jarvis_incident_recovery";
const ROLLBACK_KEY   = "jarvis_rollback_intel";
const CONTINUITY_KEY = "jarvis_op_continuity";
const FORECAST_KEY   = "jarvis_reliability_forecast";
const ANALYTICS_KEY  = "jarvis_incident_analytics";
const ISO_KEY        = "jarvis_incident_isolation";

const INCIDENT_MAX   = 20;
const OUTAGE_MAX     = 20;
const RECOVERY_MAX   = 10;
const ROLLBACK_MAX   = 20;
const CONTINUITY_MAX = 20;
const FORECAST_MAX   = 20;
const ANALYTICS_MAX  = 20;
const ISO_MAX        = 15;

const INCIDENT_TTL   = 7  * 24 * 60 * 60 * 1000;
const OUTAGE_TTL     = 24 * 60 * 60 * 1000;
const RECOVERY_TTL   = 24 * 60 * 60 * 1000;
const ROLLBACK_TTL   = 7  * 24 * 60 * 60 * 1000;
const CONTINUITY_TTL = 24 * 60 * 60 * 1000;
const FORECAST_TTL   = 24 * 60 * 60 * 1000;
const ANALYTICS_TTL  = 7  * 24 * 60 * 60 * 1000;

const VALID_INCIDENT_TYPES    = ["outage", "degradation", "replay_failure", "deployment_block",
                                 "queue_saturation", "security_event"];
const VALID_INCIDENT_STAGES   = ["detected", "triaged", "mitigating", "monitoring", "resolved", "closed"];
const VALID_SEVERITY          = ["low", "medium", "high", "critical"];
const VALID_RECOVERY_STAGES   = ["assess", "plan", "approved", "executing", "verifying", "complete"];
const VALID_ROLLBACK_OUTCOMES = ["success", "partial", "failed", "skipped"];
const VALID_ANALYTICS_DIMS    = ["outage_freq", "rollback_resp", "replay_incidents",
                                 "deploy_surv_quality", "escalation_cont"];

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

// ── Phase 1291: Incident command foundation ───────────────────────────────────

function _createIncident(spec) {
  if (!spec?.type || !VALID_INCIDENT_TYPES.includes(spec.type))
    return { ok: false, reason: "invalid_type" };
  if (!VALID_SEVERITY.includes(spec.severity || "medium"))
    return { ok: false, reason: "invalid_severity" };

  const list   = _load(INCIDENT_KEY, []);
  const active = list.filter(i => !["resolved", "closed"].includes(i.stage));
  if (active.length >= 5) return { ok: false, reason: "incident_limit" };

  // Dedup: same type + severity within 5min
  if (active.find(i => i.type === spec.type
      && Date.now() - (i.ts || 0) < 5 * 60 * 1000))
    return { ok: false, reason: "duplicate_incident" };

  const entry = {
    id:       `inc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type:     spec.type,
    severity: spec.severity || "medium",
    orgId:    spec.orgId || null,
    stage:    "detected",
    ts:       Date.now(),
    updatedAt: Date.now(),
  };
  const next = [entry, ...list]
    .filter(i => Date.now() - (i.ts || 0) < INCIDENT_TTL)
    .slice(0, INCIDENT_MAX);
  _save(INCIDENT_KEY, next);
  return { ok: true, entry };
}

function _advanceIncident(incidentId) {
  const list     = _load(INCIDENT_KEY, []);
  const idx      = list.findIndex(i => i.id === incidentId);
  if (idx === -1) return { ok: false, reason: "not_found" };

  const inc      = list[idx];
  const stageIdx = VALID_INCIDENT_STAGES.indexOf(inc.stage);
  if (stageIdx >= VALID_INCIDENT_STAGES.length - 1)
    return { ok: false, reason: "already_closed" };

  list[idx] = { ...inc, stage: VALID_INCIDENT_STAGES[stageIdx + 1], updatedAt: Date.now() };
  _save(INCIDENT_KEY, list);
  return { ok: true, incident: list[idx] };
}

// ── Phase 1292: Outage survivability system ───────────────────────────────────

function _recordOutageSignal(signal) {
  if (!signal?.type) return;
  const VALID_TYPES = ["runtime_interrupted", "replay_disrupted", "deploy_blocked",
    "queue_saturated", "trust_degraded"];
  if (!VALID_TYPES.includes(signal.type)) return;

  const now  = Date.now();
  const list = _load(OUTAGE_KEY, []).filter(s => now - (s.ts || 0) < OUTAGE_TTL);
  // Dedup same type within 2min
  if (list.find(s => s.type === signal.type && now - (s.ts || 0) < 2 * 60 * 1000)) return;

  const next = [{ type: signal.type, severity: signal.severity || "medium", ts: now }, ...list]
    .slice(0, OUTAGE_MAX);
  _save(OUTAGE_KEY, next);
}

function _scoreOutageSeverity(outageSignals) {
  const cached = _cacheGet("outage_sev");
  if (cached) return cached;

  const now    = Date.now();
  const recent = outageSignals.filter(s => now - (s.ts || 0) < 60 * 60 * 1000);
  if (!recent.length) { _cacheSet("outage_sev", 100); return 100; }

  const critCount = recent.filter(s => s.severity === "critical").length;
  const highCount = recent.filter(s => s.severity === "high").length;
  const score     = Math.max(0, 100 - critCount * 25 - highCount * 10
    - recent.filter(s => s.severity === "medium").length * 5);
  _cacheSet("outage_sev", score);
  return score;
}

// ── Phase 1293: Recovery coordination engine ──────────────────────────────────

function _createRecovery(incidentId) {
  if (!incidentId) return { ok: false, reason: "invalid_incident" };

  const incidents = _load(INCIDENT_KEY, []);
  if (!incidents.find(i => i.id === incidentId))
    return { ok: false, reason: "incident_not_found" };

  const list = _load(RECOVERY_KEY, []);
  if (list.find(r => r.incidentId === incidentId && !["complete", "failed"].includes(r.stage)))
    return { ok: false, reason: "already_active" };

  const entry = {
    id:         `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    incidentId,
    stage:      "assess",
    approvedAt: null,
    ts:         Date.now(),
    updatedAt:  Date.now(),
  };
  const next = [entry, ...list]
    .filter(r => Date.now() - (r.ts || 0) < RECOVERY_TTL)
    .slice(0, RECOVERY_MAX);
  _save(RECOVERY_KEY, next);
  return { ok: true, entry };
}

function _advanceRecovery(recoveryId, approved = false) {
  const list = _load(RECOVERY_KEY, []);
  const idx  = list.findIndex(r => r.id === recoveryId);
  if (idx === -1) return { ok: false, reason: "not_found" };

  const rec      = list[idx];
  const stageIdx = VALID_RECOVERY_STAGES.indexOf(rec.stage);
  if (stageIdx >= VALID_RECOVERY_STAGES.length - 1)
    return { ok: false, reason: "already_complete" };

  const nextStage = VALID_RECOVERY_STAGES[stageIdx + 1];
  if (nextStage === "executing" && !approved)
    return { ok: false, reason: "approval_required" };

  list[idx] = { ...rec, stage: nextStage, updatedAt: Date.now(),
    approvedAt: nextStage === "executing" ? Date.now() : rec.approvedAt };
  _save(RECOVERY_KEY, list);
  return { ok: true, recovery: list[idx] };
}

// ── Phase 1294: Deployment rollback intelligence ──────────────────────────────

function _recordRollback(event) {
  if (!event?.outcome || !VALID_ROLLBACK_OUTCOMES.includes(event.outcome)) return;

  const now  = Date.now();
  const list = _load(ROLLBACK_KEY, []).filter(r => now - (r.ts || 0) < ROLLBACK_TTL);
  // Prevent duplicate rollbacks for same deployment within 5min
  if (event.deploymentId && list.find(r => r.deploymentId === event.deploymentId
      && now - (r.ts || 0) < 5 * 60 * 1000))
    return;

  const next = [{
    deploymentId: event.deploymentId || null,
    outcome:      event.outcome,
    env:          event.env || null,
    ts:           now,
  }, ...list].slice(0, ROLLBACK_MAX);
  _save(ROLLBACK_KEY, next);
}

function _scoreRollbackIntel(rollbacks) {
  const cached = _cacheGet("rollback_intel");
  if (cached) return cached;

  const now    = Date.now();
  const recent = rollbacks.filter(r => now - (r.ts || 0) < 7 * 24 * 60 * 60 * 1000);
  if (!recent.length) { _cacheSet("rollback_intel", 100); return 100; }

  const success = recent.filter(r => r.outcome === "success").length;
  const failed  = recent.filter(r => r.outcome === "failed").length;
  const score   = Math.max(0, Math.min(100, Math.round((success / recent.length) * 100) - failed * 10));
  _cacheSet("rollback_intel", score);
  return score;
}

// ── Phase 1295: Operational continuity scoring ────────────────────────────────

function _captureContiguitySnapshot({
  replaySurvivability, deployHealth, runtimeResponsiveness, rollbackScore, outageSeverity,
}) {
  const score = Math.max(0, Math.min(100, Math.round(
    replaySurvivability  * 0.25 +
    deployHealth         * 0.25 +
    runtimeResponsiveness * 0.20 +
    rollbackScore        * 0.15 +
    outageSeverity       * 0.15
  )));
  const label = score >= 80 ? "CONTINUOUS" : score >= 60 ? "DEGRADED" : "DISRUPTED";
  const snap  = { score, label, ts: Date.now() };
  const prev  = _load(CONTINUITY_KEY, []).filter(s => Date.now() - (s.ts || 0) < CONTINUITY_TTL);
  _save(CONTINUITY_KEY, [snap, ...prev].slice(0, CONTINUITY_MAX));
  return snap;
}

// ── Phase 1296: Reliability forecasting ──────────────────────────────────────

function _forecastReliability(continuityHistory, outageSignals) {
  const cached = _cacheGet("rel_forecast");
  if (cached) return cached;

  const now = Date.now();
  if (continuityHistory.length < 3) {
    const result = { trend: "insufficient_data", riskLevel: "low" };
    _cacheSet("rel_forecast", result);
    return result;
  }

  const recent  = continuityHistory.slice(0, 5);
  const deltas  = recent.slice(0, -1).map((s, i) => s.score - recent[i + 1].score);
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const trend    = avgDelta > 2 ? "improving" : avgDelta < -2 ? "degrading" : "stable";

  const critOutages = outageSignals.filter(s => s.severity === "critical"
    && now - (s.ts || 0) < 60 * 60 * 1000).length;
  const riskLevel = critOutages > 0 || recent[0].score < 50 ? "high"
    : trend === "degrading" || recent[0].score < 70 ? "medium" : "low";

  const snap = { trend, riskLevel, avgDelta: Math.round(avgDelta * 10) / 10, ts: now };
  const prev = _load(FORECAST_KEY, []).filter(f => now - (f.ts || 0) < FORECAST_TTL);
  _save(FORECAST_KEY, [snap, ...prev].slice(0, FORECAST_MAX));
  _cacheSet("rel_forecast", snap);
  return snap;
}

// ── Phase 1297: Incident analytics + reporting ────────────────────────────────

function _recordAnalytic(sample) {
  if (!sample?.dim || !VALID_ANALYTICS_DIMS.includes(sample.dim)) return;
  if (sample.rawContent || sample.commandOutput || sample.userInput) return; // privacy

  const list = _load(ANALYTICS_KEY, []);
  const next = [{ dim: sample.dim, score: sample.score ?? 0, ts: Date.now() }, ...list]
    .filter(s => Date.now() - (s.ts || 0) < ANALYTICS_TTL)
    .slice(0, ANALYTICS_MAX);
  _save(ANALYTICS_KEY, next);
}

function _aggregateAnalytics(samples) {
  const cached = _cacheGet("rel_analytics");
  if (cached) return cached;

  const agg = {};
  VALID_ANALYTICS_DIMS.forEach(dim => {
    const s = samples.filter(x => x.dim === dim);
    agg[dim] = s.length ? Math.round(s.reduce((sum, x) => sum + (x.score || 0), 0) / s.length) : null;
  });
  const filled    = Object.values(agg).filter(v => v !== null);
  const composite = filled.length
    ? Math.round(filled.reduce((a, b) => a + b, 0) / filled.length) : 100;
  const result = { dims: agg, composite };
  _cacheSet("rel_analytics", result);
  return result;
}

// ── Phase 1298: Multi-org incident isolation ──────────────────────────────────

const REL_PREFIXES = new Set([
  "jarvis_incidents", "jarvis_outage_signals", "jarvis_incident_recovery",
  "jarvis_rollback_intel", "jarvis_op_continuity", "jarvis_reliability_forecast",
  "jarvis_incident_analytics", "jarvis_incident_isolation",
]);

function _scanIncidentIsolation(incidents) {
  const cached = _cacheGet("inc_iso");
  if (cached) return cached;

  const violations = [];
  // Check for incidents referencing each other's org states
  const orgIds = new Set(incidents.filter(i => i.orgId).map(i => i.orgId));
  if (orgIds.size > 1) {
    const activeByOrg = {};
    incidents.filter(i => !["resolved","closed"].includes(i.stage)).forEach(i => {
      if (!i.orgId) return;
      activeByOrg[i.orgId] = (activeByOrg[i.orgId] || 0) + 1;
    });
    // More than 3 active incidents on a single org is an isolation concern
    Object.entries(activeByOrg).forEach(([orgId, count]) => {
      if (count > 3 && violations.length < 5)
        violations.push({ type: "org_incident_concentration", orgId, count, ts: Date.now() });
    });
  }

  const prev   = _load(ISO_KEY, []);
  const merged = [...violations, ...prev].slice(0, ISO_MAX);
  _save(ISO_KEY, merged);
  _cacheSet("inc_iso", { violations });
  return { violations };
}

// ── Phase 1299/1300/1301: Perf hardening + stress + calm bar ──────────────────

function _scoreReliability({ continuityScore, outageSeverity, rollbackScore, analyticsComposite }) {
  return Math.max(0, Math.min(100, Math.round(
    continuityScore    * 0.35 +
    outageSeverity     * 0.30 +
    rollbackScore      * 0.20 +
    analyticsComposite * 0.15
  )));
}

function _buildReliabilityBar({ relScore, activeIncidents, forecast, isoViolations, continuityLabel }) {
  const critInc    = activeIncidents.filter(i => i.severity === "critical");
  const highInc    = activeIncidents.filter(i => i.severity === "high");
  const hasIssue   = relScore < 80 || critInc.length > 0 || isoViolations > 0;
  if (!hasIssue && forecast?.riskLevel !== "high") return null;

  const topIssue = critInc.length > 0
    ? `${critInc.length} critical incident${critInc.length > 1 ? "s" : ""} active`
    : isoViolations > 0
      ? `${isoViolations} incident isolation issue${isoViolations > 1 ? "s" : ""}`
      : highInc.length > 0
        ? `${highInc.length} high-severity incident${highInc.length > 1 ? "s" : ""}`
        : forecast?.riskLevel === "high"
          ? `Reliability forecast: ${forecast.trend}`
          : continuityLabel !== "CONTINUOUS"
            ? `Continuity: ${continuityLabel}`
            : null;

  return {
    label:    "RELIABILITY",
    score:    relScore,
    color:    relScore >= 80 ? "var(--op-green)" : relScore >= 60 ? "var(--op-amber)" : "var(--op-red)",
    issue:    topIssue,
    hasCrit:  critInc.length > 0,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useReliabilityOps({
  replaySurvivability    = 100,
  deployHealth           = 100,
  runtimeResponsiveness  = 100,
} = {}) {
  const [incidents,    setIncidents]    = useState([]);
  const [outageSignals, setOutageSignals] = useState([]);
  const [recoveries,   setRecoveries]   = useState([]);
  const [rollbacks,    setRollbacks]    = useState([]);
  const [continuity,   setContinuity]   = useState([]);
  const [forecast,     setForecast]     = useState(null);
  const [analytics,    setAnalytics]    = useState([]);
  const [isoState,     setIsoState]     = useState({ violations: [] });
  const [initialized,  setInitialized]  = useState(false);

  const evaluate = useCallback(() => {
    const now          = Date.now();
    const loadedInc    = _load(INCIDENT_KEY, []).filter(i => now - (i.ts || 0) < INCIDENT_TTL).slice(0, INCIDENT_MAX);
    const loadedOutage = _load(OUTAGE_KEY, []).filter(s => now - (s.ts || 0) < OUTAGE_TTL).slice(0, OUTAGE_MAX);
    const loadedRolls  = _load(ROLLBACK_KEY, []).filter(r => now - (r.ts || 0) < ROLLBACK_TTL).slice(0, ROLLBACK_MAX);

    setIncidents(loadedInc);
    setOutageSignals(loadedOutage);
    setRecoveries(_load(RECOVERY_KEY, []).filter(r => now - (r.ts || 0) < RECOVERY_TTL).slice(0, RECOVERY_MAX));
    setRollbacks(loadedRolls);
    setAnalytics(_load(ANALYTICS_KEY, []).filter(s => now - (s.ts || 0) < ANALYTICS_TTL).slice(0, ANALYTICS_MAX));

    const outageSev   = _scoreOutageSeverity(loadedOutage);
    const rollbackSc  = _scoreRollbackIntel(loadedRolls);
    const contSnap    = _captureContiguitySnapshot({
      replaySurvivability, deployHealth, runtimeResponsiveness,
      rollbackScore: rollbackSc, outageSeverity: outageSev,
    });
    const loadedCont  = _load(CONTINUITY_KEY, []).filter(s => now - (s.ts || 0) < CONTINUITY_TTL).slice(0, CONTINUITY_MAX);
    setContinuity(loadedCont);

    const fc = _forecastReliability(loadedCont, loadedOutage);
    setForecast(fc);

    setIsoState(_scanIncidentIsolation(loadedInc));
  }, [replaySurvivability, deployHealth, runtimeResponsiveness]);

  useEffect(() => {
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const createIncident  = useCallback((spec) => { const r = _createIncident(spec);  if (r.ok) evaluate(); return r; }, [evaluate]);
  const advanceIncident = useCallback((id)   => { const r = _advanceIncident(id);   if (r.ok) evaluate(); return r; }, [evaluate]);
  const createRecovery  = useCallback((incId) => { const r = _createRecovery(incId); if (r.ok) setRecoveries(_load(RECOVERY_KEY, []).filter(x => Date.now() - (x.ts||0) < RECOVERY_TTL).slice(0, RECOVERY_MAX)); return r; }, []);
  const advanceRecovery = useCallback((id, approved = false) => {
    const r = _advanceRecovery(id, approved);
    if (r.ok) setRecoveries(_load(RECOVERY_KEY, []).filter(x => Date.now() - (x.ts||0) < RECOVERY_TTL).slice(0, RECOVERY_MAX));
    return r;
  }, []);
  const recordOutage    = useCallback((s) => { _recordOutageSignal(s); setOutageSignals(_load(OUTAGE_KEY, []).filter(x => Date.now() - (x.ts||0) < OUTAGE_TTL).slice(0, OUTAGE_MAX)); }, []);
  const recordRollback  = useCallback((e) => { _recordRollback(e); setRollbacks(_load(ROLLBACK_KEY, []).filter(x => Date.now() - (x.ts||0) < ROLLBACK_TTL).slice(0, ROLLBACK_MAX)); }, []);
  const recordAnalytic  = useCallback((s) => { _recordAnalytic(s); setAnalytics(_load(ANALYTICS_KEY, []).filter(x => Date.now() - (x.ts||0) < ANALYTICS_TTL).slice(0, ANALYTICS_MAX)); }, []);

  const outageSeverity   = useMemo(() => _scoreOutageSeverity(outageSignals),   [outageSignals]);
  const rollbackScore    = useMemo(() => _scoreRollbackIntel(rollbacks),         [rollbacks]);
  const analyticsAgg     = useMemo(() => _aggregateAnalytics(analytics),         [analytics]);
  const latestContinuity = useMemo(() => continuity[0] || null,                  [continuity]);

  const activeIncidents  = useMemo(
    () => incidents.filter(i => !["resolved", "closed"].includes(i.stage)),
    [incidents]
  );
  const activeRecoveries = useMemo(
    () => recoveries.filter(r => !["complete", "failed"].includes(r.stage)),
    [recoveries]
  );

  const relScore = useMemo(
    () => _scoreReliability({
      continuityScore:    latestContinuity?.score   ?? 100,
      outageSeverity,
      rollbackScore,
      analyticsComposite: analyticsAgg.composite,
    }),
    [latestContinuity?.score, outageSeverity, rollbackScore, analyticsAgg.composite]
  );

  const _isoCount = isoState.violations.length;

  const reliabilityBar = useMemo(
    () => _buildReliabilityBar({
      relScore,
      activeIncidents,
      forecast,
      isoViolations:   _isoCount,
      continuityLabel: latestContinuity?.label ?? "CONTINUOUS",
    }),
    [relScore, activeIncidents, forecast, _isoCount, latestContinuity?.label]
  );

  return {
    initialized,
    incidents,
    activeIncidents,
    outageSignals,
    recoveries,
    activeRecoveries,
    rollbacks,
    continuity,
    latestContinuity,
    forecast,
    analytics,
    analyticsAgg,
    isoState,
    outageSeverity,
    rollbackScore,
    relScore,
    reliabilityBar,
    createIncident,
    advanceIncident,
    createRecovery,
    advanceRecovery,
    recordOutage,
    recordRollback,
    recordAnalytic,
    evaluate,
  };
}
