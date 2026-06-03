// Phase 1216-1225: Platform observability + self-healing operations.
//
// Consolidates ten phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: all arrays capped, TTL-filtered, LRU-evicted cache.

import { useState, useEffect, useCallback, useMemo } from "react";

const OBS_KEY      = "jarvis_obs_snapshots";
const DEGRADE_KEY  = "jarvis_infra_degradation";
const HEAL_KEY     = "jarvis_heal_recommendations";
const DIAG_KEY     = "jarvis_dist_diagnostics";
const RECOVERY_KEY = "jarvis_recovery_state";
const FORECAST_KEY = "jarvis_resilience_forecast";
const ISO_KEY      = "jarvis_obs_isolation";

const OBS_MAX      = 30;
const DEGRADE_MAX  = 20;
const HEAL_MAX     = 15;
const DIAG_MAX     = 20;
const RECOVERY_MAX = 10;
const FORECAST_MAX = 20;
const ISO_MAX      = 15;

const OBS_TTL      = 60 * 60 * 1000;
const DEGRADE_TTL  = 30 * 60 * 1000;
const HEAL_TTL     = 60 * 60 * 1000;
const DIAG_TTL     = 60 * 60 * 1000;
const FORECAST_TTL = 60 * 60 * 1000;

const VALID_DEGRADE_TYPES = [
  "runtime_responsiveness", "queue_saturation", "replay_instability",
  "deployment_survivability", "plugin_instability", "operational_trust",
];
const VALID_RECOVERY_STAGES = ["assess", "plan", "approve", "execute", "verify", "complete"];
const VALID_SEVERITY = ["low", "medium", "high", "critical"];

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

// ── Phase 1216: Operational observability snapshot ────────────────────────────

function _captureObsSnapshot({
  nodeHealth = 100, replaySurvivability = 100, deployHealth = 100,
  queueDepth = 0, queueMax = 25, reconnects = 0,
}) {
  const now = Date.now();
  const snap = {
    ts: now,
    nodeHealth,
    replaySurvivability,
    deployHealth,
    queuePressure: Math.round((queueDepth / Math.max(1, queueMax)) * 100),
    reconnects,
    composite: Math.round(
      nodeHealth          * 0.30 +
      replaySurvivability * 0.25 +
      deployHealth        * 0.25 +
      Math.max(0, 100 - (queueDepth / Math.max(1, queueMax)) * 100) * 0.20
    ),
  };
  const prev = _load(OBS_KEY, []);
  const next = [snap, ...prev]
    .filter(s => now - (s.ts || 0) < OBS_TTL)
    .slice(0, OBS_MAX);
  _save(OBS_KEY, next);
  return snap;
}

// ── Phase 1217: Infrastructure degradation detection ─────────────────────────

function _detectDegradation({
  nodeHealth, replaySurvivability, deployHealth,
  queueDepth, queueMax, pluginFailRate, opTrust,
}) {
  const cached = _cacheGet("degradation");
  if (cached) return cached;

  const now = Date.now();
  const findings = [];

  if (nodeHealth < 60)
    findings.push({ type: "runtime_responsiveness", severity: nodeHealth < 40 ? "critical" : "high",
      msg: `Node health ${nodeHealth}%`, ts: now });
  if (queueDepth / Math.max(1, queueMax) > 0.8)
    findings.push({ type: "queue_saturation", severity: "high",
      msg: `Queue ${queueDepth}/${queueMax} (${Math.round(queueDepth / queueMax * 100)}%)`, ts: now });
  if (replaySurvivability < 60)
    findings.push({ type: "replay_instability", severity: replaySurvivability < 40 ? "critical" : "high",
      msg: `Replay survivability ${replaySurvivability}%`, ts: now });
  if (deployHealth < 50)
    findings.push({ type: "deployment_survivability", severity: "high",
      msg: `Deploy health ${deployHealth}%`, ts: now });
  if (pluginFailRate > 30)
    findings.push({ type: "plugin_instability", severity: pluginFailRate > 60 ? "critical" : "medium",
      msg: `Plugin fail rate ${pluginFailRate}%`, ts: now });
  if (opTrust < 60)
    findings.push({ type: "operational_trust", severity: "medium",
      msg: `Operational trust ${opTrust}%`, ts: now });

  const highCount    = findings.filter(f => ["high", "critical"].includes(f.severity)).length;
  const critCount    = findings.filter(f => f.severity === "critical").length;
  const degradeScore = Math.max(0, 100 - highCount * 15 - critCount * 25);

  const prev = _load(DEGRADE_KEY, []).filter(d => now - (d.ts || 0) < DEGRADE_TTL);
  const merged = [...findings, ...prev]
    .filter((f, i, arr) => arr.findIndex(x => x.type === f.type) === i)
    .slice(0, DEGRADE_MAX);
  _save(DEGRADE_KEY, merged);

  const result = { findings, degradeScore, highCount, critCount };
  _cacheSet("degradation", result);
  return result;
}

// ── Phase 1218: Self-healing recommendation engine ───────────────────────────

const HEAL_RULES = [
  {
    type:     "runtime_responsiveness",
    label:    "Runtime recovery",
    steps:    ["Check node reachability", "Promote standby node", "Validate quorum"],
    priority: 1,
  },
  {
    type:     "queue_saturation",
    label:    "Queue recovery",
    steps:    ["Pause low-priority items", "Drain critical queue first", "Re-enable after pressure drops"],
    priority: 2,
  },
  {
    type:     "replay_instability",
    label:    "Replay restoration",
    steps:    ["Pause new replay dispatches", "Resolve stale replay entries", "Re-sync node state"],
    priority: 1,
  },
  {
    type:     "deployment_survivability",
    label:    "Deployment rollback",
    steps:    ["Halt in-progress deployments", "Restore from snapshot", "Re-validate after rollback"],
    priority: 1,
  },
  {
    type:     "plugin_instability",
    label:    "Plugin isolation",
    steps:    ["Quarantine unstable plugins", "Clear plugin analytics cache", "Re-evaluate plugin trust"],
    priority: 3,
  },
  {
    type:     "operational_trust",
    label:    "Trust recovery",
    steps:    ["Clear stale anomalies", "Re-run safety audits", "Review recent approval decisions"],
    priority: 2,
  },
];

function _buildHealRecommendations(findings) {
  const now = Date.now();
  const recs = findings
    .filter(f => VALID_DEGRADE_TYPES.includes(f.type))
    .map(f => {
      const rule = HEAL_RULES.find(r => r.type === f.type);
      if (!rule) return null;
      return {
        id:       `heal_${f.type}_${now}`,
        type:     f.type,
        label:    rule.label,
        steps:    rule.steps,
        priority: rule.priority,
        severity: f.severity,
        ts:       now,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, HEAL_MAX);

  const prev = _load(HEAL_KEY, []).filter(h => now - (h.ts || 0) < HEAL_TTL);
  const merged = [...recs, ...prev]
    .filter((r, i, arr) => arr.findIndex(x => x.type === r.type) === i)
    .slice(0, HEAL_MAX);
  _save(HEAL_KEY, merged);
  return recs;
}

// ── Phase 1219: Distributed diagnostics foundation ───────────────────────────

function _computeDistDiagnostics({
  nodeHealth, replaySurvivability, deployHealth,
  queueDepth, queueMax, opTrust, degradeScore,
}) {
  const score = Math.round(
    nodeHealth          * 0.25 +
    replaySurvivability * 0.20 +
    deployHealth        * 0.20 +
    opTrust             * 0.15 +
    degradeScore        * 0.10 +
    Math.max(0, 100 - (queueDepth / Math.max(1, queueMax)) * 100) * 0.10
  );

  const label = score >= 80 ? "HEALTHY" : score >= 60 ? "DEGRADED" : "CRITICAL";
  const color = score >= 80 ? "var(--op-green)" : score >= 60 ? "var(--op-amber)" : "var(--op-red)";

  const snap = { score, label, color, ts: Date.now() };
  const prev = _load(DIAG_KEY, []).filter(d => Date.now() - (d.ts || 0) < DIAG_TTL);
  _save(DIAG_KEY, [snap, ...prev].slice(0, DIAG_MAX));
  return snap;
}

// ── Phase 1220: Runtime recovery orchestration ────────────────────────────────

function _createRecovery(rec) {
  if (!rec?.type || !VALID_DEGRADE_TYPES.includes(rec.type))
    return { ok: false, reason: "invalid_type" };

  const existing = _load(RECOVERY_KEY, []);
  if (existing.find(r => r.type === rec.type && !["complete", "failed"].includes(r.stage)))
    return { ok: false, reason: "already_active" };

  const entry = {
    id:          `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type:        rec.type,
    stage:       "assess",
    approvedAt:  null,
    steps:       rec.steps || [],
    ts:          Date.now(),
    updatedAt:   Date.now(),
  };
  const next = [entry, ...existing].slice(0, RECOVERY_MAX);
  _save(RECOVERY_KEY, next);
  return { ok: true, entry };
}

function _advanceRecovery(recoveryId, approved = false) {
  const list = _load(RECOVERY_KEY, []);
  const idx = list.findIndex(r => r.id === recoveryId);
  if (idx === -1) return { ok: false, reason: "not_found" };

  const rec = list[idx];
  const stageIdx = VALID_RECOVERY_STAGES.indexOf(rec.stage);
  if (stageIdx >= VALID_RECOVERY_STAGES.length - 1) return { ok: false, reason: "already_complete" };

  const nextStage = VALID_RECOVERY_STAGES[stageIdx + 1];
  if (nextStage === "execute" && !approved) return { ok: false, reason: "approval_required" };

  const updated = {
    ...rec,
    stage:      nextStage,
    approvedAt: nextStage === "execute" ? Date.now() : rec.approvedAt,
    updatedAt:  Date.now(),
  };
  list[idx] = updated;
  _save(RECOVERY_KEY, list);
  return { ok: true, rec: updated };
}

// ── Phase 1221: Resilience forecasting ───────────────────────────────────────

function _forecastResilience(obsHistory) {
  const cached = _cacheGet("forecast");
  if (cached) return cached;

  const now = Date.now();
  if (obsHistory.length < 3) {
    const result = { trend: "insufficient_data", forecast: null };
    _cacheSet("forecast", result);
    return result;
  }

  const recent = obsHistory.slice(0, 5);
  const deltas = recent.slice(0, -1).map((s, i) => s.composite - recent[i + 1].composite);
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;

  const trend = avgDelta > 2 ? "improving" : avgDelta < -2 ? "degrading" : "stable";
  const projectedScore = Math.max(0, Math.min(100, recent[0].composite + avgDelta * 3));

  const snap = {
    trend,
    projectedScore: Math.round(projectedScore),
    riskLevel: projectedScore < 60 ? "high" : projectedScore < 80 ? "medium" : "low",
    ts: now,
  };

  const prev = _load(FORECAST_KEY, []).filter(f => now - (f.ts || 0) < FORECAST_TTL);
  _save(FORECAST_KEY, [snap, ...prev].slice(0, FORECAST_MAX));
  _cacheSet("forecast", snap);
  return snap;
}

// ── Phase 1222: Multi-runtime observability isolation ─────────────────────────

const OBS_PREFIXES = new Set([
  "jarvis_obs_", "jarvis_infra_", "jarvis_heal_",
  "jarvis_dist_diag", "jarvis_recovery_", "jarvis_resilience_", "jarvis_obs_iso",
]);

function _scanObsIsolation() {
  const cached = _cacheGet("obs_iso");
  if (cached) return cached;

  const violations = [];
  try {
    for (let i = 0; i < localStorage.length && violations.length < 5; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith("jarvis_")) continue;
      const matchesObs = [...OBS_PREFIXES].some(p => k.startsWith(p));
      if (matchesObs) continue;
      // Check if a non-obs key contains obs-like state that should be isolated
      if (k.includes("replay") && !k.includes("jarvis_distributed_replay") && !k.includes("jarvis_replay"))
        violations.push({ type: "replay_crossover", key: k, ts: Date.now() });
      if (k.includes("diagnostics") && !k.includes("jarvis_dist_diagnostics"))
        violations.push({ type: "diagnostics_bleed", key: k, ts: Date.now() });
    }
  } catch {}

  const prev = _load(ISO_KEY, []);
  const merged = [...violations, ...prev].slice(0, ISO_MAX);
  _save(ISO_KEY, merged);
  _cacheSet("obs_iso", { violations });
  return { violations };
}

// ── Phase 1223: Performance hardening utilities ───────────────────────────────
// All scoring functions are pure, cache-gated. No side-effects in render path.

function _computeObsScore(snap) {
  if (!snap) return 100;
  return snap.composite;
}

// ── Phase 1224/1225: Stress validation + UX composite ─────────────────────────

function _stressValidate({ degradeScore, isoViolations, activeRecoveries, forecast }) {
  const findings = [];
  if (degradeScore < 50)
    findings.push({ id: "infra_degraded", severity: "high", msg: `Infrastructure score ${degradeScore}%` });
  if (isoViolations > 0)
    findings.push({ id: "iso_violations", severity: "medium", msg: `${isoViolations} isolation violation${isoViolations > 1 ? "s" : ""}` });
  if (activeRecoveries >= RECOVERY_MAX)
    findings.push({ id: "recovery_saturation", severity: "medium", msg: "Recovery queue at capacity" });
  if (forecast?.riskLevel === "high")
    findings.push({ id: "forecast_risk", severity: "high", msg: `Resilience forecast: ${forecast.trend}` });
  return findings;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function usePlatformObservabilityV2({
  nodeHealth          = 100,
  replaySurvivability = 100,
  deployHealth        = 100,
  queueDepth          = 0,
  queueMax            = 25,
  pluginFailRate      = 0,
  opTrust             = 100,
  reconnects          = 0,
} = {}) {
  const [obsHistory,   setObsHistory]   = useState([]);
  const [degradation,  setDegradation]  = useState({ findings: [], degradeScore: 100, highCount: 0, critCount: 0 });
  const [healRecs,     setHealRecs]     = useState([]);
  const [diagnostics,  setDiagnostics]  = useState(null);
  const [recoveries,   setRecoveries]   = useState([]);
  const [forecast,     setForecast]     = useState(null);
  const [isoState,     setIsoState]     = useState({ violations: [] });
  const [initialized,  setInitialized]  = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const snap = _captureObsSnapshot({ nodeHealth, replaySurvivability, deployHealth, queueDepth, queueMax, reconnects });
    setObsHistory(_load(OBS_KEY, []).filter(s => now - (s.ts || 0) < OBS_TTL).slice(0, OBS_MAX));

    const deg = _detectDegradation({ nodeHealth, replaySurvivability, deployHealth, queueDepth, queueMax, pluginFailRate, opTrust });
    setDegradation(deg);

    const recs = _buildHealRecommendations(deg.findings);
    setHealRecs(recs);

    const diag = _computeDistDiagnostics({ nodeHealth, replaySurvivability, deployHealth, queueDepth, queueMax, opTrust, degradeScore: deg.degradeScore });
    setDiagnostics(diag);

    setRecoveries(_load(RECOVERY_KEY, []).slice(0, RECOVERY_MAX));

    const fc = _forecastResilience(_load(OBS_KEY, []).filter(s => now - (s.ts || 0) < OBS_TTL));
    setForecast(fc);

    const iso = _scanObsIsolation();
    setIsoState(iso);
  }, [nodeHealth, replaySurvivability, deployHealth, queueDepth, queueMax, pluginFailRate, opTrust, reconnects]);

  useEffect(() => {
    const now = Date.now();
    setObsHistory(_load(OBS_KEY, []).filter(s => now - (s.ts || 0) < OBS_TTL).slice(0, OBS_MAX));
    setDegradation(_load(DEGRADE_KEY, []).length
      ? { findings: _load(DEGRADE_KEY, []), degradeScore: 100, highCount: 0, critCount: 0 }
      : { findings: [], degradeScore: 100, highCount: 0, critCount: 0 });
    setHealRecs(_load(HEAL_KEY, []).filter(h => now - (h.ts || 0) < HEAL_TTL).slice(0, HEAL_MAX));
    setRecoveries(_load(RECOVERY_KEY, []).slice(0, RECOVERY_MAX));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const createRecovery = useCallback((rec) => {
    const result = _createRecovery(rec);
    if (result.ok) setRecoveries(_load(RECOVERY_KEY, []).slice(0, RECOVERY_MAX));
    return result;
  }, []);

  const advanceRecovery = useCallback((recoveryId, approved = false) => {
    const result = _advanceRecovery(recoveryId, approved);
    if (result.ok) setRecoveries(_load(RECOVERY_KEY, []).slice(0, RECOVERY_MAX));
    return result;
  }, []);

  // Coarse dep-key to prevent burst re-renders
  const _degradeScoreBucket = Math.floor(degradation.degradeScore / 10);
  const _isoCount = isoState.violations.length;

  const stressFindings = useMemo(
    () => _stressValidate({
      degradeScore:    degradation.degradeScore,
      isoViolations:   _isoCount,
      activeRecoveries: recoveries.filter(r => !["complete", "failed"].includes(r.stage)).length,
      forecast,
    }),
    [_degradeScoreBucket, _isoCount, recoveries, forecast]  // eslint-disable-line
  );

  const activeRecoveries = useMemo(
    () => recoveries.filter(r => !["complete", "failed"].includes(r.stage)),
    [recoveries]
  );

  const topHealRec = useMemo(() => healRecs[0] || null, [healRecs]);

  const obsScore = useMemo(() => _computeObsScore(obsHistory[0] || null), [obsHistory]);

  const obsBar = useMemo(() => {
    const hasIssues = degradation.highCount > 0 || degradation.critCount > 0 || isoState.violations.length > 0;
    const showForcast = forecast?.riskLevel === "high";
    if (!hasIssues && !showForcast && obsScore >= 80) return null;

    const critFinding = degradation.findings.find(f => f.severity === "critical");
    const highFinding = degradation.findings.find(f => ["high", "critical"].includes(f.severity));
    const topFinding  = critFinding || highFinding || degradation.findings[0];

    return {
      label:     "OBS",
      score:     diagnostics?.score ?? obsScore,
      color:     diagnostics?.color ?? (obsScore >= 80 ? "var(--op-green)" : obsScore >= 60 ? "var(--op-amber)" : "var(--op-red)"),
      finding:   topFinding?.msg || null,
      riskLevel: forecast?.riskLevel || "low",
      trend:     forecast?.trend || null,
      healRec:   topHealRec?.label || null,
    };
  }, [degradation, isoState.violations.length, forecast, obsScore, diagnostics, topHealRec]);

  return {
    initialized,
    obsHistory,
    degradation,
    healRecs,
    diagnostics,
    recoveries,
    activeRecoveries,
    forecast,
    isoState,
    stressFindings,
    obsScore,
    obsBar,
    topHealRec,
    createRecovery,
    advanceRecovery,
    evaluate,
  };
}
