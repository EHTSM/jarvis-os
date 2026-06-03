// Phases 1501-1511: Private beta + live deployment execution.
//
// Consolidates eleven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded arrays throughout.

import { useState, useCallback, useMemo } from "react";

// ── Keys ──────────────────────────────────────────────────────────────────────

const PB_DEPLOY_KEY   = "jarvis_pb_deployments";
const PB_BETA_KEY     = "jarvis_pb_beta_ops";
const PB_WORKFLOW_KEY = "jarvis_pb_workflows";
const PB_MONITOR_KEY  = "jarvis_pb_monitoring";
const PB_SUPPORT_KEY  = "jarvis_pb_support";
const PB_INCIDENT_KEY = "jarvis_pb_incidents";
const PB_TRUST_KEY    = "jarvis_pb_trust";
const PB_ISO_KEY      = "jarvis_pb_live_iso";
const PB_PERF_KEY     = "jarvis_pb_perf";

// ── Bounds ────────────────────────────────────────────────────────────────────

const MAX_DEPLOY   = 15;
const MAX_BETA     = 20;
const MAX_WORKFLOW = 20;
const MAX_MONITOR  = 30;
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

// ── Phase 1501: Live deployments ─────────────────────────────────────────────

const VALID_DEPLOY_STAGES = ["queued", "deploying", "verifying", "live", "rolled_back", "failed"];

function _loadDeploys() {
  return _cached(PB_DEPLOY_KEY, () =>
    _load(PB_DEPLOY_KEY, []).filter(d => Date.now() - (d.ts || 0) < TTL_7D)
  );
}

function _addDeploy(items, entry) {
  if (!entry.id || !entry.env || !VALID_DEPLOY_STAGES.includes(entry.stage)) return items;
  if (["deploying", "live"].includes(entry.stage) && !entry.approvedAt) return items;
  // forward-only
  const existing = items.find(d => d.id === entry.id);
  if (existing) {
    const order = VALID_DEPLOY_STAGES.indexOf(entry.stage);
    const prev  = VALID_DEPLOY_STAGES.indexOf(existing.stage);
    if (order < prev) return items;
  }
  const dedup = items.filter(d => d.id !== entry.id);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(d => Date.now() - (d.ts || 0) < TTL_7D)
    .slice(0, MAX_DEPLOY);
}

function _deployScore(items) {
  if (!items.length) return 100;
  const failed     = items.filter(d => d.stage === "failed").length;
  const rolledBack = items.filter(d => d.stage === "rolled_back").length;
  if (failed > 2 || rolledBack > 2) return 50;
  if (failed > 0 || rolledBack > 0) return 70;
  return 100;
}

// ── Phase 1502: Private beta operations ──────────────────────────────────────

const VALID_BETA_STAGES = ["invited", "onboarding", "active", "churned", "graduated"];

function _loadBeta() {
  return _cached(PB_BETA_KEY, () =>
    _load(PB_BETA_KEY, []).filter(b => Date.now() - (b.ts || 0) < TTL_7D)
  );
}

function _addBeta(items, entry) {
  if (!entry.userId || !VALID_BETA_STAGES.includes(entry.stage)) return items;
  // forward-only per userId
  const existing = items.find(b => b.userId === entry.userId);
  if (existing) {
    const order = VALID_BETA_STAGES.indexOf(entry.stage);
    const prev  = VALID_BETA_STAGES.indexOf(existing.stage);
    if (order < prev) return items;
  }
  const dedup = items.filter(b => b.userId !== entry.userId);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(b => Date.now() - (b.ts || 0) < TTL_7D)
    .slice(0, MAX_BETA);
}

function _betaScore(items) {
  if (!items.length) return 100;
  const churned = items.filter(b => b.stage === "churned").length;
  if (churned > items.length * 0.3) return 55;
  if (churned > 2) return 70;
  return 100;
}

// ── Phase 1503: Live workflow readiness ───────────────────────────────────────

const VALID_WF_STAGES = ["queued", "running", "paused", "complete", "failed"];

function _loadWorkflows() {
  return _cached(PB_WORKFLOW_KEY, () =>
    _load(PB_WORKFLOW_KEY, []).filter(w => Date.now() - (w.ts || 0) < TTL_24H)
  );
}

function _addWorkflow(items, entry) {
  if (!entry.id || !entry.orgId || !VALID_WF_STAGES.includes(entry.stage)) return items;
  if (entry.userInput || entry.rawContent) return items;
  // forward-only per id
  const existing = items.find(w => w.id === entry.id);
  if (existing) {
    const order = VALID_WF_STAGES.indexOf(entry.stage);
    const prev  = VALID_WF_STAGES.indexOf(existing.stage);
    if (order < prev) return items;
  }
  const dedup = items.filter(w => w.id !== entry.id);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(w => Date.now() - (w.ts || 0) < TTL_24H)
    .slice(0, MAX_WORKFLOW);
}

function _workflowScore(items) {
  if (!items.length) return 100;
  const failed  = items.filter(w => w.stage === "failed").length;
  const running = items.filter(w => w.stage === "running").length;
  if (failed > 3) return 50;
  if (running > 8) return 70;
  return 100;
}

// ── Phase 1504: Production monitoring ────────────────────────────────────────

const VALID_MONITOR_TYPES = ["health", "latency", "error_rate", "saturation", "availability", "throughput"];

function _loadMonitor() {
  return _cached(PB_MONITOR_KEY, () =>
    _load(PB_MONITOR_KEY, []).filter(m => Date.now() - (m.ts || 0) < TTL_24H)
  );
}

function _addMonitor(items, entry) {
  if (!entry.type || !VALID_MONITOR_TYPES.includes(entry.type)) return items;
  if (entry.userInput || entry.rawContent || entry.commandOutput) return items;
  // 30s dedup per type+env
  const key = `${entry.type}:${entry.env || ""}`;
  const recent = items.find(m => `${m.type}:${m.env || ""}` === key && Date.now() - (m.ts || 0) < 30_000);
  if (recent) return items;
  return [{ ...entry, ts: Date.now() }, ...items]
    .filter(m => Date.now() - (m.ts || 0) < TTL_24H)
    .slice(0, MAX_MONITOR);
}

function _monitorScore(items) {
  if (!items.length) return 100;
  const errors = items.filter(m => m.type === "error_rate" && (m.value ?? 0) > 0.05).length;
  if (errors > 2) return 55;
  const stale = items.filter(m => Date.now() - (m.ts || 0) > 4 * 60 * 60 * 1000).length;
  if (stale > items.length * 0.5) return 65;
  return 100;
}

// ── Phase 1505: Live support ──────────────────────────────────────────────────

const VALID_SUPPORT_STAGES = ["open", "investigating", "escalated", "resolved", "closed"];

function _loadSupport() {
  return _cached(PB_SUPPORT_KEY, () =>
    _load(PB_SUPPORT_KEY, []).filter(s => Date.now() - (s.ts || 0) < TTL_7D)
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

// ── Phase 1506: Incident recovery ────────────────────────────────────────────

const VALID_INCIDENT_STAGES = ["detected", "investigating", "mitigating", "resolved", "post_mortem"];

function _loadIncidents() {
  return _cached(PB_INCIDENT_KEY, () =>
    _load(PB_INCIDENT_KEY, []).filter(i => Date.now() - (i.ts || 0) < TTL_7D)
  );
}

function _addIncident(items, entry) {
  if (!entry.id || !entry.severity || !VALID_INCIDENT_STAGES.includes(entry.stage)) return items;
  // anti-recursive burst guard
  const burst = items.filter(i => i.id === entry.id && Date.now() - (i.ts || 0) < 10 * 1000);
  if (burst.length >= 3) return items;
  // forward-only
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

// ── Phase 1507: Beta trust ────────────────────────────────────────────────────

function _loadTrust() {
  return _cached(PB_TRUST_KEY, () =>
    _load(PB_TRUST_KEY, []).filter(t => Date.now() - (t.ts || 0) < TTL_7D)
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

// ── Phase 1508: Multi-tenant live isolation ───────────────────────────────────

const PB_PREFIXES = [
  PB_DEPLOY_KEY, PB_BETA_KEY, PB_WORKFLOW_KEY, PB_MONITOR_KEY,
  PB_SUPPORT_KEY, PB_INCIDENT_KEY, PB_TRUST_KEY, PB_ISO_KEY, PB_PERF_KEY,
];

function _scanLiveIso() {
  return _cached("_pb_iso_scan", () => {
    const violations = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (PB_PREFIXES.includes(k)) continue;
        if (k.startsWith("jarvis_pb_") && !PB_PREFIXES.includes(k)) {
          violations.push({ key: k, ts: Date.now() });
        }
      }
    } catch {}
    const prev   = _load(PB_ISO_KEY, []);
    const merged = [...violations, ...prev].slice(0, MAX_ISO);
    _save(PB_ISO_KEY, merged);
    return violations;
  });
}

// ── Phase 1509: Perf audit ────────────────────────────────────────────────────

function _runPBPerfAudit() {
  return _cached("_pb_perf_audit", () => {
    const findings = [];

    try {
      const deploys = _load(PB_DEPLOY_KEY, []);
      const ids     = deploys.map(d => d.id).filter(Boolean);
      const dupes   = ids.length - new Set(ids).size;
      if (dupes > 0) findings.push({ id: "deploy_duplication", severity: "high", msg: `${dupes} duplicate deployment IDs` });
    } catch {}

    try {
      const monitor = _load(PB_MONITOR_KEY, []);
      const leaked  = monitor.filter(m => m.userInput || m.rawContent || m.commandOutput);
      if (leaked.length > 0) findings.push({ id: "monitor_pii_leak", severity: "high", msg: `${leaked.length} monitor entries with PII` });
    } catch {}

    try {
      const wfs    = _load(PB_WORKFLOW_KEY, []);
      const leaked = wfs.filter(w => w.userInput || w.rawContent);
      if (leaked.length > 0) findings.push({ id: "workflow_pii_leak", severity: "high", msg: `${leaked.length} workflow entries with PII` });
    } catch {}

    try {
      const deploys = _load(PB_DEPLOY_KEY, []);
      const active  = deploys.filter(d => d.stage === "deploying");
      if (active.length > 5) findings.push({ id: "deploy_saturation", severity: "high", msg: `${active.length} concurrent deployments` });
    } catch {}

    try {
      const incidents = _load(PB_INCIDENT_KEY, []);
      const ids2      = incidents.map(i => i.id).filter(Boolean);
      const dupes2    = ids2.length - new Set(ids2).size;
      if (dupes2 > 0) findings.push({ id: "incident_duplication", severity: "high", msg: `${dupes2} duplicate incident IDs` });
    } catch {}

    const score  = findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75;
    const result = { ts: Date.now(), findings, highCount: findings.filter(f => f.severity === "high").length, score };
    _save(PB_PERF_KEY, result);
    return result;
  });
}

// ── Composite scoring ─────────────────────────────────────────────────────────

function _computePBScore({
  deployScore   = 100,
  betaScore     = 100,
  workflowScore = 100,
  monitorScore  = 100,
  supportScore  = 100,
  incidentScore = 100,
  trustScore    = 100,
  perfScore     = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    incidentScore * 0.25 +
    trustScore    * 0.20 +
    deployScore   * 0.15 +
    workflowScore * 0.15 +
    betaScore     * 0.10 +
    monitorScore  * 0.08 +
    supportScore  * 0.05 +
    perfScore     * 0.02
  )
  + (incidentScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const issue =
    isoViolations > 0   ? `Live isolation: ${isoViolations} violation${isoViolations > 1 ? "s" : ""}` :
    incidentScore < 60  ? `Active incidents (${incidentScore}%)` :
    trustScore < 60     ? `Beta trust degraded (${trustScore}%)` :
    deployScore < 60    ? `Live deployments degraded (${deployScore}%)` :
    null;

  return {
    score,
    issue,
    color:   score >= 80 ? "var(--op-green)" : score >= 60 ? "var(--op-amber)" : "var(--op-red)",
    hasCrit: isoViolations > 0 || incidentScore < 60,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function usePrivateBeta() {
  const [deploys,   setDeploys]   = useState(() => _loadDeploys());
  const [beta,      setBeta]      = useState(() => _loadBeta());
  const [workflows, setWorkflows] = useState(() => _loadWorkflows());
  const [monitor,   setMonitor]   = useState(() => _loadMonitor());
  const [support,   setSupport]   = useState(() => _loadSupport());
  const [incidents, setIncidents] = useState(() => _loadIncidents());
  const [trust,     setTrust]     = useState(() => _loadTrust());

  // ── Writers ─────────────────────────────────────────────────────────────────

  const addDeploy = useCallback((entry) => {
    setDeploys(prev => {
      const next = _addDeploy(prev, entry);
      _save(PB_DEPLOY_KEY, next);
      _cache.delete(PB_DEPLOY_KEY);
      return next;
    });
  }, []);

  const addBetaUser = useCallback((entry) => {
    setBeta(prev => {
      const next = _addBeta(prev, entry);
      _save(PB_BETA_KEY, next);
      _cache.delete(PB_BETA_KEY);
      return next;
    });
  }, []);

  const addWorkflow = useCallback((entry) => {
    setWorkflows(prev => {
      const next = _addWorkflow(prev, entry);
      _save(PB_WORKFLOW_KEY, next);
      _cache.delete(PB_WORKFLOW_KEY);
      return next;
    });
  }, []);

  const addMonitor = useCallback((entry) => {
    setMonitor(prev => {
      const next = _addMonitor(prev, entry);
      _save(PB_MONITOR_KEY, next);
      _cache.delete(PB_MONITOR_KEY);
      return next;
    });
  }, []);

  const addSupport = useCallback((entry) => {
    setSupport(prev => {
      const next = _addSupport(prev, entry);
      _save(PB_SUPPORT_KEY, next);
      _cache.delete(PB_SUPPORT_KEY);
      return next;
    });
  }, []);

  const addIncident = useCallback((entry) => {
    setIncidents(prev => {
      const next = _addIncident(prev, entry);
      _save(PB_INCIDENT_KEY, next);
      _cache.delete(PB_INCIDENT_KEY);
      return next;
    });
  }, []);

  const addTrust = useCallback((entry) => {
    setTrust(prev => {
      const next = _addTrust(prev, entry);
      _save(PB_TRUST_KEY, next);
      _cache.delete(PB_TRUST_KEY);
      return next;
    });
  }, []);

  // ── Derived scores (coarse dep-keys) ─────────────────────────────────────────

  const deployScoreVal   = useMemo(() => _deployScore(deploys),     [Math.floor(deploys.length / 2)]);
  const betaScoreVal     = useMemo(() => _betaScore(beta),           [Math.floor(beta.length / 2)]);
  const workflowScoreVal = useMemo(() => _workflowScore(workflows),  [Math.floor(workflows.length / 2)]);
  const monitorScoreVal  = useMemo(() => _monitorScore(monitor),     [Math.floor(monitor.length / 3)]);
  const supportScoreVal  = useMemo(() => _supportScore(support),     [Math.floor(support.length / 2)]);
  const incidentScoreVal = useMemo(() => _incidentScore(incidents),  [Math.floor(incidents.length / 2)]);
  const trustScoreVal    = useMemo(() => _trustScore(trust),         [Math.floor(trust.length / 3)]);

  const perfAudit = useMemo(() => _runPBPerfAudit(),
    [Math.floor((deploys.length + workflows.length + incidents.length) / 3)]);

  const pbIsoViolations = useMemo(() => _scanLiveIso(),
    [Math.floor((deploys.length + incidents.length) / 3)]);

  // ── Composite bar ────────────────────────────────────────────────────────────

  const pbBar = useMemo(() => {
    const result = _computePBScore({
      deployScore:   deployScoreVal,
      betaScore:     betaScoreVal,
      workflowScore: workflowScoreVal,
      monitorScore:  monitorScoreVal,
      supportScore:  supportScoreVal,
      incidentScore: incidentScoreVal,
      trustScore:    trustScoreVal,
      perfScore:     perfAudit.score,
      isoViolations: pbIsoViolations.length,
    });
    if (result.score >= 80 && !result.issue) return null;
    return result;
  }, [deployScoreVal, betaScoreVal, workflowScoreVal, monitorScoreVal,
      supportScoreVal, incidentScoreVal, trustScoreVal,
      perfAudit.score, pbIsoViolations.length]);

  return {
    addDeploy, addBetaUser, addWorkflow, addMonitor, addSupport, addIncident, addTrust,
    pbScore:       _computePBScore({
                     deployScore: deployScoreVal, betaScore: betaScoreVal,
                     workflowScore: workflowScoreVal, monitorScore: monitorScoreVal,
                     supportScore: supportScoreVal, incidentScore: incidentScoreVal,
                     trustScore: trustScoreVal, perfScore: perfAudit.score,
                     isoViolations: pbIsoViolations.length,
                   }).score,
    deployScore:   deployScoreVal,
    betaScore:     betaScoreVal,
    workflowScore: workflowScoreVal,
    incidentScore: incidentScoreVal,
    trustScore:    trustScoreVal,
    perfAudit,
    pbIsoViolations,
    pbBar,
  };
}
