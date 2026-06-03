// Phases 1471-1481: Real-world launch operations + deployment readiness.
//
// Consolidates eleven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded arrays throughout.

import { useState, useCallback, useMemo } from "react";

// ── Keys ──────────────────────────────────────────────────────────────────────

const LO_INFRA_KEY    = "jarvis_lo_infra";
const LO_STABILITY_KEY = "jarvis_lo_stability";
const LO_MOBILE_KEY   = "jarvis_lo_mobile";
const LO_OBS_KEY      = "jarvis_lo_observability";
const LO_SUPPORT_KEY  = "jarvis_lo_support";
const LO_INCIDENT_KEY = "jarvis_lo_incidents";
const LO_SURV_KEY     = "jarvis_lo_launch_surv";
const LO_ISO_KEY      = "jarvis_lo_runtime_iso";
const LO_PERF_KEY     = "jarvis_lo_perf";

// ── Bounds ────────────────────────────────────────────────────────────────────

const MAX_INFRA      = 20;
const MAX_STABILITY  = 30;
const MAX_MOBILE     = 20;
const MAX_OBS        = 20;
const MAX_SUPPORT    = 15;
const MAX_INCIDENT   = 20;
const MAX_SURV       = 30;
const MAX_ISO        = 20;

const TTL_7D  = 7  * 24 * 60 * 60 * 1000;
const TTL_24H = 24 * 60 * 60 * 1000;

// ── LRU cache (30s TTL, 50 entries) ──────────────────────────────────────────

const _cache = new Map();
function _cached(key, fn) {
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && now - hit.ts < 30_000) return hit.val;
  if (_cache.size >= 50) _cache.delete(_cache.keys().next().value);
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

// ── Phase 1471: Deployment infrastructure ────────────────────────────────────

const VALID_INFRA_STAGES = ["provisioning", "ready", "degraded", "scaling", "decommissioned"];

function _loadInfra() {
  return _cached(LO_INFRA_KEY, () =>
    _load(LO_INFRA_KEY, []).filter(i => Date.now() - (i.ts || 0) < TTL_7D)
  );
}

function _addInfra(items, entry) {
  if (!entry.id || !entry.env || !VALID_INFRA_STAGES.includes(entry.stage)) return items;
  if (entry.stage === "scaling" && !entry.approvedAt) return items;
  const dedup = items.filter(i => i.id !== entry.id);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(i => Date.now() - (i.ts || 0) < TTL_7D)
    .slice(0, MAX_INFRA);
}

function _infraScore(items) {
  if (!items.length) return 100;
  const degraded = items.filter(i => i.stage === "degraded").length;
  if (degraded > 2) return 50;
  if (degraded > 0) return 70;
  return 100;
}

// ── Phase 1472: Real-user stability ──────────────────────────────────────────

function _loadStability() {
  return _cached(LO_STABILITY_KEY, () =>
    _load(LO_STABILITY_KEY, []).filter(s => Date.now() - (s.ts || 0) < TTL_24H)
  );
}

function _addStability(items, entry) {
  if (!entry.type || entry.userInput || entry.rawContent || entry.commandOutput) return items;
  // 2min dedup per type+sessionId
  const key = `${entry.type}:${entry.sessionId || ""}`;
  const recent = items.find(s => `${s.type}:${s.sessionId || ""}` === key && Date.now() - (s.ts || 0) < 2 * 60 * 1000);
  if (recent) return items;
  return [{ ...entry, recovered: Boolean(entry.recovered), ts: Date.now() }, ...items]
    .filter(s => Date.now() - (s.ts || 0) < TTL_24H)
    .slice(0, MAX_STABILITY);
}

function _stabilityScore(items) {
  if (!items.length) return 100;
  const recovered  = items.filter(s => s.recovered).length;
  const crashes    = items.filter(s => s.type === "crash").length;
  if (crashes > 5) return 50;
  if (crashes > 2) return 70;
  return Math.round(Math.min(100, 70 + (recovered / Math.max(1, items.length)) * 30));
}

// ── Phase 1473: Mobile ecosystem ─────────────────────────────────────────────

function _loadMobile() {
  return _cached(LO_MOBILE_KEY, () =>
    _load(LO_MOBILE_KEY, []).filter(m => Date.now() - (m.ts || 0) < TTL_7D)
  );
}

function _addMobile(items, entry) {
  if (!entry.type || !entry.platform || entry.userInput || entry.rawContent) return items;
  // 5min dedup per type+platform+sessionId
  const key = `${entry.type}:${entry.platform}:${entry.sessionId || ""}`;
  const recent = items.find(m => `${m.type}:${m.platform}:${m.sessionId || ""}` === key && Date.now() - (m.ts || 0) < 5 * 60 * 1000);
  if (recent) return items;
  return [{ ...entry, ts: Date.now() }, ...items]
    .filter(m => Date.now() - (m.ts || 0) < TTL_7D)
    .slice(0, MAX_MOBILE);
}

function _mobileScore(items) {
  if (!items.length) return 100;
  const recent = items.filter(m => Date.now() - (m.ts || 0) < TTL_24H);
  if (!recent.length) return 100;
  const sum = recent.reduce((acc, m) => acc + (m.score ?? 100), 0);
  return Math.round(sum / recent.length);
}

// ── Phase 1474: Production observability ─────────────────────────────────────

const VALID_OBS_TYPES = ["health_check", "latency_sample", "error_rate", "saturation", "availability"];

function _loadObs() {
  return _cached(LO_OBS_KEY, () =>
    _load(LO_OBS_KEY, []).filter(o => Date.now() - (o.ts || 0) < TTL_24H)
  );
}

function _addObs(items, entry) {
  if (!entry.type || !VALID_OBS_TYPES.includes(entry.type)) return items;
  if (entry.userInput || entry.rawContent || entry.commandOutput) return items;
  // 30s dedup per type+env
  const key = `${entry.type}:${entry.env || ""}`;
  const recent = items.find(o => `${o.type}:${o.env || ""}` === key && Date.now() - (o.ts || 0) < 30_000);
  if (recent) return items;
  return [{ ...entry, ts: Date.now() }, ...items]
    .filter(o => Date.now() - (o.ts || 0) < TTL_24H)
    .slice(0, MAX_OBS);
}

function _obsScore(items) {
  if (!items.length) return 100;
  const stale = items.filter(o => Date.now() - (o.ts || 0) > 4 * 60 * 60 * 1000).length;
  if (stale > items.length * 0.5) return 65;
  const errors = items.filter(o => o.type === "error_rate" && (o.value ?? 0) > 0.05).length;
  if (errors > 2) return 60;
  return 100;
}

// ── Phase 1475: Customer support ─────────────────────────────────────────────

const VALID_SUPPORT_STAGES = ["open", "investigating", "escalated", "resolved", "closed"];

function _loadSupport() {
  return _cached(LO_SUPPORT_KEY, () =>
    _load(LO_SUPPORT_KEY, []).filter(s => Date.now() - (s.ts || 0) < TTL_7D)
  );
}

function _addSupport(items, entry) {
  if (!entry.id || !entry.summary || !VALID_SUPPORT_STAGES.includes(entry.stage)) return items;
  if (entry.stage === "escalated" && !entry.operatorApproved) return items;
  const dedup = items.filter(s => s.id !== entry.id);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(s => Date.now() - (s.ts || 0) < TTL_7D)
    .slice(0, MAX_SUPPORT);
}

function _supportScore(items) {
  if (!items.length) return 100;
  const open      = items.filter(s => s.stage === "open").length;
  const escalated = items.filter(s => s.stage === "escalated").length;
  if (escalated > 2) return 55;
  if (open > 6)      return 70;
  return 100;
}

// ── Phase 1476: Incident response ────────────────────────────────────────────

const VALID_INCIDENT_STAGES = ["detected", "investigating", "mitigating", "resolved", "post_mortem"];

function _loadIncidents() {
  return _cached(LO_INCIDENT_KEY, () =>
    _load(LO_INCIDENT_KEY, []).filter(i => Date.now() - (i.ts || 0) < TTL_7D)
  );
}

function _addIncident(items, entry) {
  if (!entry.id || !entry.severity || !VALID_INCIDENT_STAGES.includes(entry.stage)) return items;
  // anti-recursive: no more than 3 updates for same id in 10s
  const burst = items.filter(i => i.id === entry.id && Date.now() - (i.ts || 0) < 10 * 1000);
  if (burst.length >= 3) return items;
  // forward-only stage
  const existing = items.find(i => i.id === entry.id);
  if (existing) {
    const order = VALID_INCIDENT_STAGES.indexOf(entry.stage);
    const prev  = VALID_INCIDENT_STAGES.indexOf(existing.stage);
    if (order < prev) return items;
  }
  const dedup = items.filter(i => i.id !== entry.id);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(i => Date.now() - (i.ts || 0) < TTL_7D)
    .slice(0, MAX_INCIDENT);
}

function _incidentScore(items) {
  if (!items.length) return 100;
  const active = items.filter(i => ["detected", "investigating", "mitigating"].includes(i.stage));
  const p0     = active.filter(i => i.severity === "p0").length;
  const p1     = active.filter(i => i.severity === "p1").length;
  if (p0 > 0) return 40;
  if (p1 > 1) return 60;
  if (active.length > 3) return 70;
  return 100;
}

// ── Phase 1477: Launch survivability ─────────────────────────────────────────

function _loadSurv() {
  return _cached(LO_SURV_KEY, () =>
    _load(LO_SURV_KEY, []).filter(s => Date.now() - (s.ts || 0) < TTL_7D)
  );
}

function _addSurv(items, entry) {
  if (!entry.type || entry.userInput || entry.rawContent) return items;
  // 2min dedup per type+env
  const key = `${entry.type}:${entry.env || ""}`;
  const recent = items.find(s => `${s.type}:${s.env || ""}` === key && Date.now() - (s.ts || 0) < 2 * 60 * 1000);
  if (recent) return items;
  return [{ ...entry, recovered: Boolean(entry.recovered), ts: Date.now() }, ...items]
    .filter(s => Date.now() - (s.ts || 0) < TTL_7D)
    .slice(0, MAX_SURV);
}

function _survScore(items) {
  if (!items.length) return 100;
  const recovered = items.filter(s => s.recovered).length;
  return Math.round(Math.min(100, 60 + (recovered / Math.max(1, items.length)) * 40));
}

// ── Phase 1478: Multi-tenant runtime isolation ────────────────────────────────

const LO_PREFIXES = [
  LO_INFRA_KEY, LO_STABILITY_KEY, LO_MOBILE_KEY, LO_OBS_KEY,
  LO_SUPPORT_KEY, LO_INCIDENT_KEY, LO_SURV_KEY, LO_ISO_KEY, LO_PERF_KEY,
];

function _scanRuntimeIso() {
  return _cached("_lo_iso_scan", () => {
    const violations = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (LO_PREFIXES.includes(k)) continue;
        if (k.startsWith("jarvis_lo_") && !LO_PREFIXES.includes(k)) {
          violations.push({ key: k, ts: Date.now() });
        }
      }
    } catch {}
    const prev   = _load(LO_ISO_KEY, []);
    const merged = [...violations, ...prev].slice(0, MAX_ISO);
    _save(LO_ISO_KEY, merged);
    return violations;
  });
}

// ── Phase 1479: Perf audit ────────────────────────────────────────────────────

function _runLOPerfAudit() {
  return _cached("_lo_perf_audit", () => {
    const findings = [];

    try {
      const infra  = _load(LO_INFRA_KEY, []);
      const ids    = infra.map(i => i.id).filter(Boolean);
      const dupes  = ids.length - new Set(ids).size;
      if (dupes > 0) findings.push({ id: "infra_duplication", severity: "high", msg: `${dupes} duplicate infra IDs` });
    } catch {}

    try {
      const stability = _load(LO_STABILITY_KEY, []);
      const leaked    = stability.filter(s => s.userInput || s.rawContent || s.commandOutput);
      if (leaked.length > 0) findings.push({ id: "stability_pii_leak", severity: "high", msg: `${leaked.length} stability entries with PII` });
    } catch {}

    try {
      const incidents = _load(LO_INCIDENT_KEY, []);
      const ids2      = incidents.map(i => i.id).filter(Boolean);
      const dupes2    = ids2.length - new Set(ids2).size;
      if (dupes2 > 0) findings.push({ id: "incident_duplication", severity: "high", msg: `${dupes2} duplicate incident IDs` });
    } catch {}

    try {
      const support = _load(LO_SUPPORT_KEY, []);
      const open    = support.filter(s => s.stage === "open");
      if (open.length > 8) findings.push({ id: "support_overflow", severity: "medium", msg: `${open.length} open support items` });
    } catch {}

    try {
      const mobile = _load(LO_MOBILE_KEY, []);
      const leaked = mobile.filter(m => m.userInput || m.rawContent);
      if (leaked.length > 0) findings.push({ id: "mobile_pii_leak", severity: "high", msg: `${leaked.length} mobile entries with PII` });
    } catch {}

    const score  = findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75;
    const result = { ts: Date.now(), findings, highCount: findings.filter(f => f.severity === "high").length, score };
    _save(LO_PERF_KEY, result);
    return result;
  });
}

// ── Composite scoring ─────────────────────────────────────────────────────────

function _computeLOScore({
  infraScore    = 100,
  stabilityScore = 100,
  mobileScore   = 100,
  obsScore      = 100,
  supportScore  = 100,
  incidentScore = 100,
  survScore     = 100,
  perfScore     = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    incidentScore  * 0.25 +
    stabilityScore * 0.20 +
    infraScore     * 0.15 +
    survScore      * 0.15 +
    mobileScore    * 0.10 +
    obsScore       * 0.08 +
    supportScore   * 0.05 +
    perfScore      * 0.02
  )
  + (incidentScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const issue =
    isoViolations > 0    ? `Runtime isolation: ${isoViolations} violation${isoViolations > 1 ? "s" : ""}` :
    incidentScore < 60   ? `Active incidents degrading launch (${incidentScore}%)` :
    stabilityScore < 60  ? `Runtime stability degraded (${stabilityScore}%)` :
    infraScore < 60      ? `Infra health degraded (${infraScore}%)` :
    null;

  return {
    score,
    issue,
    color:   score >= 80 ? "var(--op-green)" : score >= 60 ? "var(--op-amber)" : "var(--op-red)",
    hasCrit: isoViolations > 0 || incidentScore < 60,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useLaunchOperations() {
  const [infra,      setInfra]      = useState(() => _loadInfra());
  const [stability,  setStability]  = useState(() => _loadStability());
  const [mobile,     setMobile]     = useState(() => _loadMobile());
  const [obs,        setObs]        = useState(() => _loadObs());
  const [support,    setSupport]    = useState(() => _loadSupport());
  const [incidents,  setIncidents]  = useState(() => _loadIncidents());
  const [surv,       setSurv]       = useState(() => _loadSurv());

  // ── Writers ─────────────────────────────────────────────────────────────────

  const addInfra = useCallback((entry) => {
    setInfra(prev => {
      const next = _addInfra(prev, entry);
      _save(LO_INFRA_KEY, next);
      _cache.delete(LO_INFRA_KEY);
      return next;
    });
  }, []);

  const addStability = useCallback((entry) => {
    setStability(prev => {
      const next = _addStability(prev, entry);
      _save(LO_STABILITY_KEY, next);
      _cache.delete(LO_STABILITY_KEY);
      return next;
    });
  }, []);

  const addMobile = useCallback((entry) => {
    setMobile(prev => {
      const next = _addMobile(prev, entry);
      _save(LO_MOBILE_KEY, next);
      _cache.delete(LO_MOBILE_KEY);
      return next;
    });
  }, []);

  const addObs = useCallback((entry) => {
    setObs(prev => {
      const next = _addObs(prev, entry);
      _save(LO_OBS_KEY, next);
      _cache.delete(LO_OBS_KEY);
      return next;
    });
  }, []);

  const addSupport = useCallback((entry) => {
    setSupport(prev => {
      const next = _addSupport(prev, entry);
      _save(LO_SUPPORT_KEY, next);
      _cache.delete(LO_SUPPORT_KEY);
      return next;
    });
  }, []);

  const addIncident = useCallback((entry) => {
    setIncidents(prev => {
      const next = _addIncident(prev, entry);
      _save(LO_INCIDENT_KEY, next);
      _cache.delete(LO_INCIDENT_KEY);
      return next;
    });
  }, []);

  const addSurv = useCallback((entry) => {
    setSurv(prev => {
      const next = _addSurv(prev, entry);
      _save(LO_SURV_KEY, next);
      _cache.delete(LO_SURV_KEY);
      return next;
    });
  }, []);

  // ── Derived scores (coarse dep-keys) ─────────────────────────────────────────

  const infraScoreVal     = useMemo(() => _infraScore(infra),         [Math.floor(infra.length / 2)]);
  const stabilityScoreVal = useMemo(() => _stabilityScore(stability),  [Math.floor(stability.length / 3)]);
  const mobileScoreVal    = useMemo(() => _mobileScore(mobile),        [Math.floor(mobile.length / 2)]);
  const obsScoreVal       = useMemo(() => _obsScore(obs),              [Math.floor(obs.length / 2)]);
  const supportScoreVal   = useMemo(() => _supportScore(support),      [Math.floor(support.length / 2)]);
  const incidentScoreVal  = useMemo(() => _incidentScore(incidents),   [Math.floor(incidents.length / 2)]);
  const survScoreVal      = useMemo(() => _survScore(surv),            [Math.floor(surv.length / 3)]);

  const perfAudit = useMemo(() => _runLOPerfAudit(),
    [Math.floor((infra.length + stability.length + incidents.length) / 3)]);

  const loIsoViolations = useMemo(() => _scanRuntimeIso(),
    [Math.floor((infra.length + incidents.length) / 3)]);

  // ── Composite bar ────────────────────────────────────────────────────────────

  const loBar = useMemo(() => {
    const result = _computeLOScore({
      infraScore:     infraScoreVal,
      stabilityScore: stabilityScoreVal,
      mobileScore:    mobileScoreVal,
      obsScore:       obsScoreVal,
      supportScore:   supportScoreVal,
      incidentScore:  incidentScoreVal,
      survScore:      survScoreVal,
      perfScore:      perfAudit.score,
      isoViolations:  loIsoViolations.length,
    });
    if (result.score >= 80 && !result.issue) return null;
    return result;
  }, [infraScoreVal, stabilityScoreVal, mobileScoreVal, obsScoreVal,
      supportScoreVal, incidentScoreVal, survScoreVal,
      perfAudit.score, loIsoViolations.length]);

  return {
    // writers
    addInfra, addStability, addMobile, addObs, addSupport, addIncident, addSurv,
    // scores
    loScore:        _computeLOScore({
                      infraScore: infraScoreVal, stabilityScore: stabilityScoreVal,
                      mobileScore: mobileScoreVal, obsScore: obsScoreVal,
                      supportScore: supportScoreVal, incidentScore: incidentScoreVal,
                      survScore: survScoreVal, perfScore: perfAudit.score,
                      isoViolations: loIsoViolations.length,
                    }).score,
    infraScore:     infraScoreVal,
    stabilityScore: stabilityScoreVal,
    mobileScore:    mobileScoreVal,
    incidentScore:  incidentScoreVal,
    survScore:      survScoreVal,
    perfAudit,
    loIsoViolations,
    loBar,
  };
}
