// Phases 1516-1526: Live internet deployment + user scaling maturity.
//
// Consolidates eleven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded arrays throughout.

import { useState, useCallback, useMemo } from "react";

// ── Keys ──────────────────────────────────────────────────────────────────────

const LD_DOMAIN_KEY   = "jarvis_ld_domain";
const LD_VPS_KEY      = "jarvis_ld_vps";
const LD_ONBOARD_KEY  = "jarvis_ld_onboarding";
const LD_TRAFFIC_KEY  = "jarvis_ld_traffic";
const LD_SUPPORT_KEY  = "jarvis_ld_support";
const LD_INCIDENT_KEY = "jarvis_ld_incidents";
const LD_TRUST_KEY    = "jarvis_ld_trust";
const LD_ISO_KEY      = "jarvis_ld_live_iso";
const LD_PERF_KEY     = "jarvis_ld_perf";

// ── Bounds ────────────────────────────────────────────────────────────────────

const MAX_DOMAIN   = 15;
const MAX_VPS      = 20;
const MAX_ONBOARD  = 20;
const MAX_TRAFFIC  = 30;
const MAX_SUPPORT  = 15;
const MAX_INCIDENT = 20;
const MAX_TRUST    = 30;
const MAX_ISO      = 20;

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

// ── Phase 1516: Live domain deployment ───────────────────────────────────────

const VALID_DOMAIN_STAGES = ["pending", "propagating", "active", "degraded", "failed", "rolled_back"];

function _loadDomain() {
  return _cached(LD_DOMAIN_KEY, () =>
    _load(LD_DOMAIN_KEY, []).filter(d => Date.now() - (d.ts || 0) < TTL_7D)
  );
}

function _addDomain(items, entry) {
  if (!entry.id || !entry.domain || !VALID_DOMAIN_STAGES.includes(entry.stage)) return items;
  if (entry.stage === "active" && !entry.approvedAt) return items;
  const existing = items.find(d => d.id === entry.id);
  if (existing) {
    const order = VALID_DOMAIN_STAGES.indexOf(entry.stage);
    const prev  = VALID_DOMAIN_STAGES.indexOf(existing.stage);
    if (order < prev) return items;
  }
  const dedup = items.filter(d => d.id !== entry.id);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(d => Date.now() - (d.ts || 0) < TTL_7D)
    .slice(0, MAX_DOMAIN);
}

function _domainScore(items) {
  if (!items.length) return 100;
  const degraded = items.filter(d => d.stage === "degraded" || d.stage === "failed").length;
  if (degraded > 1) return 50;
  if (degraded > 0) return 70;
  return 100;
}

// ── Phase 1517: VPS operational stability ─────────────────────────────────────

const VALID_VPS_TYPES = ["health", "cpu", "memory", "disk", "network", "restart", "crash"];

function _loadVps() {
  return _cached(LD_VPS_KEY, () =>
    _load(LD_VPS_KEY, []).filter(v => Date.now() - (v.ts || 0) < TTL_24H)
  );
}

function _addVps(items, entry) {
  if (!entry.type || !VALID_VPS_TYPES.includes(entry.type)) return items;
  if (entry.userInput || entry.rawContent || entry.commandOutput) return items;
  // 2min dedup per type+host
  const key = `${entry.type}:${entry.host || ""}`;
  const recent = items.find(v => `${v.type}:${v.host || ""}` === key && Date.now() - (v.ts || 0) < 2 * 60 * 1000);
  if (recent) return items;
  return [{ ...entry, recovered: Boolean(entry.recovered), ts: Date.now() }, ...items]
    .filter(v => Date.now() - (v.ts || 0) < TTL_24H)
    .slice(0, MAX_VPS);
}

function _vpsScore(items) {
  if (!items.length) return 100;
  const crashes   = items.filter(v => v.type === "crash").length;
  const recovered = items.filter(v => v.recovered).length;
  if (crashes > 3) return 50;
  if (crashes > 1) return 70;
  return Math.round(Math.min(100, 70 + (recovered / Math.max(1, items.length)) * 30));
}

// ── Phase 1518: Real user onboarding ─────────────────────────────────────────

const VALID_OB_STAGES = ["not_started", "started", "workspace_ready", "first_workflow", "complete"];

function _loadOnboard() {
  return _cached(LD_ONBOARD_KEY, () =>
    _load(LD_ONBOARD_KEY, []).filter(o => Date.now() - (o.ts || 0) < TTL_7D)
  );
}

function _addOnboard(items, entry) {
  if (!entry.sessionId || !VALID_OB_STAGES.includes(entry.stage)) return items;
  const existing = items.find(o => o.sessionId === entry.sessionId);
  if (existing) {
    const order = VALID_OB_STAGES.indexOf(entry.stage);
    const prev  = VALID_OB_STAGES.indexOf(existing.stage);
    if (order < prev) return items;
  }
  const dedup = items.filter(o => o.sessionId !== entry.sessionId);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(o => Date.now() - (o.ts || 0) < TTL_7D)
    .slice(0, MAX_ONBOARD);
}

function _onboardScore(items) {
  if (!items.length) return 100;
  const stale = items.filter(o =>
    o.stage !== "complete" && Date.now() - (o.ts || 0) > 48 * 60 * 60 * 1000
  ).length;
  if (stale > 3) return 60;
  const complete = items.filter(o => o.stage === "complete").length;
  if (items.length > 5 && complete === 0) return 65;
  return 100;
}

// ── Phase 1519: Live traffic observability ────────────────────────────────────

const VALID_TRAFFIC_TYPES = ["request_rate", "error_rate", "latency_p50", "latency_p99", "availability", "bandwidth"];

function _loadTraffic() {
  return _cached(LD_TRAFFIC_KEY, () =>
    _load(LD_TRAFFIC_KEY, []).filter(t => Date.now() - (t.ts || 0) < TTL_24H)
  );
}

function _addTraffic(items, entry) {
  if (!entry.type || !VALID_TRAFFIC_TYPES.includes(entry.type)) return items;
  if (entry.userInput || entry.rawContent || entry.commandOutput) return items;
  // 30s dedup per type+env
  const key = `${entry.type}:${entry.env || ""}`;
  const recent = items.find(t => `${t.type}:${t.env || ""}` === key && Date.now() - (t.ts || 0) < 30_000);
  if (recent) return items;
  return [{ ...entry, ts: Date.now() }, ...items]
    .filter(t => Date.now() - (t.ts || 0) < TTL_24H)
    .slice(0, MAX_TRAFFIC);
}

function _trafficScore(items) {
  if (!items.length) return 100;
  const errors = items.filter(t => t.type === "error_rate" && (t.value ?? 0) > 0.05).length;
  if (errors > 2) return 55;
  const avail = items.filter(t => t.type === "availability" && (t.value ?? 1) < 0.99).length;
  if (avail > 0) return 65;
  return 100;
}

// ── Phase 1520: Real user support ────────────────────────────────────────────

const VALID_SUPPORT_STAGES = ["open", "investigating", "escalated", "resolved", "closed"];

function _loadSupport() {
  return _cached(LD_SUPPORT_KEY, () =>
    _load(LD_SUPPORT_KEY, []).filter(s => Date.now() - (s.ts || 0) < TTL_7D)
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
  const escalated = items.filter(s => s.stage === "escalated").length;
  const open      = items.filter(s => s.stage === "open").length;
  if (escalated > 2) return 55;
  if (open > 6)      return 70;
  return 100;
}

// ── Phase 1521: Live incident recovery ───────────────────────────────────────

const VALID_INCIDENT_STAGES = ["detected", "investigating", "mitigating", "resolved", "post_mortem"];

function _loadIncidents() {
  return _cached(LD_INCIDENT_KEY, () =>
    _load(LD_INCIDENT_KEY, []).filter(i => Date.now() - (i.ts || 0) < TTL_7D)
  );
}

function _addIncident(items, entry) {
  if (!entry.id || !entry.severity || !VALID_INCIDENT_STAGES.includes(entry.stage)) return items;
  // anti-recursive burst guard
  const burst = items.filter(i => i.id === entry.id && Date.now() - (i.ts || 0) < 10 * 1000);
  if (burst.length >= 3) return items;
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

// ── Phase 1522: User trust + retention ───────────────────────────────────────

function _loadTrust() {
  return _cached(LD_TRUST_KEY, () =>
    _load(LD_TRUST_KEY, []).filter(t => Date.now() - (t.ts || 0) < TTL_7D)
  );
}

function _addTrust(items, entry) {
  if (!entry.dim || entry.userInput || entry.rawContent) return items;
  // 5min dedup per dim+userId
  const key = `${entry.dim}:${entry.userId || ""}`;
  const recent = items.find(t => `${t.dim}:${t.userId || ""}` === key && Date.now() - (t.ts || 0) < 5 * 60 * 1000);
  if (recent) return items;
  return [{ ...entry, ts: Date.now() }, ...items]
    .filter(t => Date.now() - (t.ts || 0) < TTL_7D)
    .slice(0, MAX_TRUST);
}

function _trustScore(items) {
  if (!items.length) return 100;
  const recent = items.filter(t => Date.now() - (t.ts || 0) < TTL_24H);
  if (!recent.length) return 100;
  const sum = recent.reduce((acc, t) => acc + (t.score ?? 100), 0);
  return Math.round(sum / recent.length);
}

// ── Phase 1523: Multi-tenant live isolation ───────────────────────────────────

const LD_PREFIXES = [
  LD_DOMAIN_KEY, LD_VPS_KEY, LD_ONBOARD_KEY, LD_TRAFFIC_KEY,
  LD_SUPPORT_KEY, LD_INCIDENT_KEY, LD_TRUST_KEY, LD_ISO_KEY, LD_PERF_KEY,
];

function _scanLiveIso() {
  return _cached("_ld_iso_scan", () => {
    const violations = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (LD_PREFIXES.includes(k)) continue;
        if (k.startsWith("jarvis_ld_") && !LD_PREFIXES.includes(k)) {
          violations.push({ key: k, ts: Date.now() });
        }
      }
    } catch {}
    const prev   = _load(LD_ISO_KEY, []);
    const merged = [...violations, ...prev].slice(0, MAX_ISO);
    _save(LD_ISO_KEY, merged);
    return violations;
  });
}

// ── Phase 1524: Perf audit ────────────────────────────────────────────────────

function _runLDPerfAudit() {
  return _cached("_ld_perf_audit", () => {
    const findings = [];

    try {
      const domain = _load(LD_DOMAIN_KEY, []);
      const ids    = domain.map(d => d.id).filter(Boolean);
      const dupes  = ids.length - new Set(ids).size;
      if (dupes > 0) findings.push({ id: "domain_duplication", severity: "high", msg: `${dupes} duplicate domain IDs` });
    } catch {}

    try {
      const vps    = _load(LD_VPS_KEY, []);
      const leaked = vps.filter(v => v.userInput || v.rawContent || v.commandOutput);
      if (leaked.length > 0) findings.push({ id: "vps_pii_leak", severity: "high", msg: `${leaked.length} VPS entries with PII` });
    } catch {}

    try {
      const traffic = _load(LD_TRAFFIC_KEY, []);
      const leaked  = traffic.filter(t => t.userInput || t.rawContent);
      if (leaked.length > 0) findings.push({ id: "traffic_pii_leak", severity: "high", msg: `${leaked.length} traffic entries with PII` });
    } catch {}

    try {
      const incidents = _load(LD_INCIDENT_KEY, []);
      const active    = incidents.filter(i => ["detected", "investigating", "mitigating"].includes(i.stage));
      if (active.length > 5) findings.push({ id: "incident_saturation", severity: "high", msg: `${active.length} active incidents` });
    } catch {}

    try {
      const trust  = _load(LD_TRUST_KEY, []);
      const leaked = trust.filter(t => t.userInput || t.rawContent);
      if (leaked.length > 0) findings.push({ id: "trust_pii_leak", severity: "high", msg: `${leaked.length} trust entries with PII` });
    } catch {}

    const score  = findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75;
    const result = { ts: Date.now(), findings, highCount: findings.filter(f => f.severity === "high").length, score };
    _save(LD_PERF_KEY, result);
    return result;
  });
}

// ── Composite scoring ─────────────────────────────────────────────────────────

function _computeLDScore({
  domainScore   = 100,
  vpsScore      = 100,
  onboardScore  = 100,
  trafficScore  = 100,
  supportScore  = 100,
  incidentScore = 100,
  trustScore    = 100,
  perfScore     = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    incidentScore * 0.25 +
    trustScore    * 0.20 +
    domainScore   * 0.15 +
    vpsScore      * 0.15 +
    onboardScore  * 0.10 +
    trafficScore  * 0.08 +
    supportScore  * 0.05 +
    perfScore     * 0.02
  )
  + (incidentScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const issue =
    isoViolations > 0   ? `Live isolation: ${isoViolations} violation${isoViolations > 1 ? "s" : ""}` :
    incidentScore < 60  ? `Active incidents (${incidentScore}%)` :
    domainScore < 60    ? `Domain/routing degraded (${domainScore}%)` :
    vpsScore < 60       ? `VPS stability degraded (${vpsScore}%)` :
    trustScore < 60     ? `User trust degraded (${trustScore}%)` :
    null;

  return {
    score,
    issue,
    color:   score >= 80 ? "var(--op-green)" : score >= 60 ? "var(--op-amber)" : "var(--op-red)",
    hasCrit: isoViolations > 0 || incidentScore < 60 || domainScore < 60,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useLiveDeployment() {
  const [domain,    setDomain]    = useState(() => _loadDomain());
  const [vps,       setVps]       = useState(() => _loadVps());
  const [onboard,   setOnboard]   = useState(() => _loadOnboard());
  const [traffic,   setTraffic]   = useState(() => _loadTraffic());
  const [support,   setSupport]   = useState(() => _loadSupport());
  const [incidents, setIncidents] = useState(() => _loadIncidents());
  const [trust,     setTrust]     = useState(() => _loadTrust());

  // ── Writers ─────────────────────────────────────────────────────────────────

  const addDomain = useCallback((entry) => {
    setDomain(prev => {
      const next = _addDomain(prev, entry);
      _save(LD_DOMAIN_KEY, next);
      _cache.delete(LD_DOMAIN_KEY);
      return next;
    });
  }, []);

  const addVps = useCallback((entry) => {
    setVps(prev => {
      const next = _addVps(prev, entry);
      _save(LD_VPS_KEY, next);
      _cache.delete(LD_VPS_KEY);
      return next;
    });
  }, []);

  const addOnboard = useCallback((entry) => {
    setOnboard(prev => {
      const next = _addOnboard(prev, entry);
      _save(LD_ONBOARD_KEY, next);
      _cache.delete(LD_ONBOARD_KEY);
      return next;
    });
  }, []);

  const addTraffic = useCallback((entry) => {
    setTraffic(prev => {
      const next = _addTraffic(prev, entry);
      _save(LD_TRAFFIC_KEY, next);
      _cache.delete(LD_TRAFFIC_KEY);
      return next;
    });
  }, []);

  const addSupport = useCallback((entry) => {
    setSupport(prev => {
      const next = _addSupport(prev, entry);
      _save(LD_SUPPORT_KEY, next);
      _cache.delete(LD_SUPPORT_KEY);
      return next;
    });
  }, []);

  const addIncident = useCallback((entry) => {
    setIncidents(prev => {
      const next = _addIncident(prev, entry);
      _save(LD_INCIDENT_KEY, next);
      _cache.delete(LD_INCIDENT_KEY);
      return next;
    });
  }, []);

  const addTrust = useCallback((entry) => {
    setTrust(prev => {
      const next = _addTrust(prev, entry);
      _save(LD_TRUST_KEY, next);
      _cache.delete(LD_TRUST_KEY);
      return next;
    });
  }, []);

  // ── Derived scores (coarse dep-keys) ─────────────────────────────────────────

  const domainScoreVal   = useMemo(() => _domainScore(domain),     [Math.floor(domain.length / 2)]);
  const vpsScoreVal      = useMemo(() => _vpsScore(vps),            [Math.floor(vps.length / 2)]);
  const onboardScoreVal  = useMemo(() => _onboardScore(onboard),    [Math.floor(onboard.length / 2)]);
  const trafficScoreVal  = useMemo(() => _trafficScore(traffic),    [Math.floor(traffic.length / 3)]);
  const supportScoreVal  = useMemo(() => _supportScore(support),    [Math.floor(support.length / 2)]);
  const incidentScoreVal = useMemo(() => _incidentScore(incidents), [Math.floor(incidents.length / 2)]);
  const trustScoreVal    = useMemo(() => _trustScore(trust),        [Math.floor(trust.length / 3)]);

  const perfAudit = useMemo(() => _runLDPerfAudit(),
    [Math.floor((domain.length + vps.length + incidents.length) / 3)]);

  const ldIsoViolations = useMemo(() => _scanLiveIso(),
    [Math.floor((domain.length + incidents.length) / 3)]);

  // ── Composite bar ────────────────────────────────────────────────────────────

  const ldBar = useMemo(() => {
    const result = _computeLDScore({
      domainScore:   domainScoreVal,
      vpsScore:      vpsScoreVal,
      onboardScore:  onboardScoreVal,
      trafficScore:  trafficScoreVal,
      supportScore:  supportScoreVal,
      incidentScore: incidentScoreVal,
      trustScore:    trustScoreVal,
      perfScore:     perfAudit.score,
      isoViolations: ldIsoViolations.length,
    });
    if (result.score >= 80 && !result.issue) return null;
    return result;
  }, [domainScoreVal, vpsScoreVal, onboardScoreVal, trafficScoreVal,
      supportScoreVal, incidentScoreVal, trustScoreVal,
      perfAudit.score, ldIsoViolations.length]);

  return {
    addDomain, addVps, addOnboard, addTraffic, addSupport, addIncident, addTrust,
    ldScore:       _computeLDScore({
                     domainScore: domainScoreVal, vpsScore: vpsScoreVal,
                     onboardScore: onboardScoreVal, trafficScore: trafficScoreVal,
                     supportScore: supportScoreVal, incidentScore: incidentScoreVal,
                     trustScore: trustScoreVal, perfScore: perfAudit.score,
                     isoViolations: ldIsoViolations.length,
                   }).score,
    domainScore:   domainScoreVal,
    vpsScore:      vpsScoreVal,
    onboardScore:  onboardScoreVal,
    incidentScore: incidentScoreVal,
    trustScore:    trustScoreVal,
    perfAudit,
    ldIsoViolations,
    ldBar,
  };
}
