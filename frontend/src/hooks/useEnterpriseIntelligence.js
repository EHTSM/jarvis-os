// Phases 1426-1436: Enterprise + organizational intelligence maturity.
//
// Consolidates eleven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded arrays throughout.

import { useState, useCallback, useMemo } from "react";

// ── Keys ──────────────────────────────────────────────────────────────────────

const EI_ORG_COORD_KEY    = "jarvis_ei_org_coord";
const EI_EXEC_OBS_KEY     = "jarvis_ei_exec_obs";
const EI_BIZ_CONT_KEY     = "jarvis_ei_biz_cont";
const EI_ORG_WF_KEY       = "jarvis_ei_org_workflows";
const EI_PROD_OPT_KEY     = "jarvis_ei_prod_opt";
const EI_CROSS_TEAM_KEY   = "jarvis_ei_cross_team";
const EI_TRUST_KEY        = "jarvis_ei_trust";
const EI_ISO_KEY          = "jarvis_ei_org_iso";
const EI_PERF_KEY         = "jarvis_ei_perf";

// ── Bounds ────────────────────────────────────────────────────────────────────

const MAX_ORG_COORD    = 20;
const MAX_EXEC_OBS     = 20;
const MAX_BIZ_CONT     = 30;
const MAX_ORG_WF       = 20;
const MAX_PROD_OPT     = 15;
const MAX_CROSS_TEAM   = 20;
const MAX_TRUST        = 30;
const MAX_ISO          = 20;

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

// ── Phase 1426: Org coordination ─────────────────────────────────────────────

const VALID_COORD_STAGES = ["pending", "active", "blocked", "complete", "rolled_back"];

function _loadOrgCoord() {
  return _cached(EI_ORG_COORD_KEY, () =>
    _load(EI_ORG_COORD_KEY, []).filter(c => Date.now() - (c.ts || 0) < TTL_7D)
  );
}

function _addOrgCoord(items, entry) {
  if (!entry.id || !entry.orgId || !entry.summary) return items;
  if (!VALID_COORD_STAGES.includes(entry.stage)) return items;
  // approval-gate at active
  if (entry.stage === "active" && !entry.approvedAt) return items;
  const dedup = items.filter(c => c.id !== entry.id);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(c => Date.now() - (c.ts || 0) < TTL_7D)
    .slice(0, MAX_ORG_COORD);
}

function _coordScore(items) {
  if (!items.length) return 100;
  const active  = items.filter(c => c.stage === "active").length;
  const blocked = items.filter(c => c.stage === "blocked").length;
  if (blocked > 3) return 50;
  if (active > 8)  return 70;
  return 100;
}

// ── Phase 1427: Executive observability ──────────────────────────────────────

const VALID_OBS_TYPES = ["deployment_summary", "workflow_analytics", "productivity_diagnostic", "survivability_summary", "exec_briefing"];

function _loadExecObs() {
  return _cached(EI_EXEC_OBS_KEY, () =>
    _load(EI_EXEC_OBS_KEY, []).filter(o => Date.now() - (o.ts || 0) < TTL_24H)
  );
}

function _addExecObs(items, entry) {
  if (!entry.type || !VALID_OBS_TYPES.includes(entry.type)) return items;
  if (entry.userInput || entry.rawContent || entry.commandOutput) return items;
  // 5min dedup per type+orgId
  const key = `${entry.type}:${entry.orgId || ""}`;
  const recent = items.find(o => `${o.type}:${o.orgId || ""}` === key && Date.now() - (o.ts || 0) < 5 * 60 * 1000);
  if (recent) return items;
  return [{ ...entry, ts: Date.now() }, ...items]
    .filter(o => Date.now() - (o.ts || 0) < TTL_24H)
    .slice(0, MAX_EXEC_OBS);
}

function _obsScore(items) {
  if (!items.length) return 100;
  const stale = items.filter(o => Date.now() - (o.ts || 0) > 4 * 60 * 60 * 1000).length;
  if (stale > items.length * 0.5) return 65;
  return 100;
}

// ── Phase 1428: Business continuity ──────────────────────────────────────────

function _loadBizCont() {
  return _cached(EI_BIZ_CONT_KEY, () =>
    _load(EI_BIZ_CONT_KEY, []).filter(b => Date.now() - (b.ts || 0) < TTL_7D)
  );
}

function _addBizCont(items, entry) {
  if (!entry.type || !entry.orgId || entry.userInput || entry.rawContent) return items;
  // 2min dedup
  const key = `${entry.type}:${entry.orgId}`;
  const recent = items.find(b => `${b.type}:${b.orgId}` === key && Date.now() - (b.ts || 0) < 2 * 60 * 1000);
  if (recent) return items;
  return [{ ...entry, recovered: Boolean(entry.recovered), ts: Date.now() }, ...items]
    .filter(b => Date.now() - (b.ts || 0) < TTL_7D)
    .slice(0, MAX_BIZ_CONT);
}

function _contScore(items) {
  if (!items.length) return 100;
  const recovered = items.filter(b => b.recovered).length;
  return Math.round(Math.min(100, 60 + (recovered / items.length) * 40));
}

// ── Phase 1429: Org workflow analytics ───────────────────────────────────────

const VALID_WF_STAGES = ["queued", "running", "paused", "complete", "failed", "rolled_back"];

function _loadOrgWf() {
  return _cached(EI_ORG_WF_KEY, () =>
    _load(EI_ORG_WF_KEY, []).filter(w => Date.now() - (w.ts || 0) < TTL_7D)
  );
}

function _addOrgWf(items, entry) {
  if (!entry.id || !entry.orgId || !VALID_WF_STAGES.includes(entry.stage)) return items;
  if (entry.userInput || entry.rawContent) return items;
  const dedup = items.filter(w => w.id !== entry.id);
  // forward-only stage for same id
  const existing = items.find(w => w.id === entry.id);
  if (existing) {
    const order = VALID_WF_STAGES.indexOf(entry.stage);
    const prev  = VALID_WF_STAGES.indexOf(existing.stage);
    if (order < prev) return items;
  }
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(w => Date.now() - (w.ts || 0) < TTL_7D)
    .slice(0, MAX_ORG_WF);
}

function _wfScore(items) {
  if (!items.length) return 100;
  const failed  = items.filter(w => w.stage === "failed").length;
  const running = items.filter(w => w.stage === "running").length;
  if (failed > 3) return 50;
  if (running > 8) return 70;
  return 100;
}

// ── Phase 1430: Productivity optimization ────────────────────────────────────

function _loadProdOpt() {
  return _cached(EI_PROD_OPT_KEY, () =>
    _load(EI_PROD_OPT_KEY, []).filter(p => Date.now() - (p.ts || 0) < TTL_24H)
  );
}

function _addProdOpt(items, entry) {
  if (!entry.id || !entry.summary || !entry.orgId) return items;
  if (entry.userInput || entry.rawContent) return items;
  // 5min dedup per orgId+type
  const key = `${entry.orgId}:${entry.type || ""}`;
  const recent = items.find(p => `${p.orgId}:${p.type || ""}` === key && Date.now() - (p.ts || 0) < 5 * 60 * 1000);
  if (recent) return items;
  const acted = entry.acted ? { ...entry, actedAt: entry.actedAt || Date.now() } : entry;
  return [{ ...acted, ts: Date.now() }, ...items.filter(p => p.id !== entry.id)]
    .filter(p => Date.now() - (p.ts || 0) < TTL_24H)
    .slice(0, MAX_PROD_OPT);
}

function _prodOptScore(items) {
  if (!items.length) return 100;
  const stale = items.filter(p => !p.acted && Date.now() - (p.ts || 0) > 12 * 60 * 60 * 1000).length;
  if (stale > 4) return 65;
  return 100;
}

// ── Phase 1431: Cross-team continuity ────────────────────────────────────────

const VALID_TEAM_STAGES = ["pending", "syncing", "blocked", "complete"];

function _loadCrossTeam() {
  return _cached(EI_CROSS_TEAM_KEY, () =>
    _load(EI_CROSS_TEAM_KEY, []).filter(t => Date.now() - (t.ts || 0) < TTL_7D)
  );
}

function _addCrossTeam(items, entry) {
  if (!entry.id || !entry.orgId || !entry.teamId || !VALID_TEAM_STAGES.includes(entry.stage)) return items;
  // no cross-org contamination: deduplicate per orgId boundary
  const dedup = items.filter(t => t.id !== entry.id);
  // check anti-recursive: no more than 3 updates for same orgId+teamId in 10s
  const burst = items.filter(t => t.orgId === entry.orgId && t.teamId === entry.teamId && Date.now() - (t.ts || 0) < 10 * 1000);
  if (burst.length >= 3) return items;
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(t => Date.now() - (t.ts || 0) < TTL_7D)
    .slice(0, MAX_CROSS_TEAM);
}

function _crossTeamScore(items) {
  if (!items.length) return 100;
  const blocked = items.filter(t => t.stage === "blocked").length;
  if (blocked > 3) return 55;
  return 100;
}

// ── Phase 1432: Enterprise trust ─────────────────────────────────────────────

function _loadTrust() {
  return _cached(EI_TRUST_KEY, () =>
    _load(EI_TRUST_KEY, []).filter(t => Date.now() - (t.ts || 0) < TTL_7D)
  );
}

function _addTrust(items, entry) {
  if (!entry.dim || !entry.orgId || entry.userInput || entry.rawContent) return items;
  // 5min dedup per dim+orgId
  const key = `${entry.dim}:${entry.orgId}`;
  const recent = items.find(t => `${t.dim}:${t.orgId}` === key && Date.now() - (t.ts || 0) < 5 * 60 * 1000);
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

// ── Phase 1433: Multi-org isolation ──────────────────────────────────────────

const EI_PREFIXES = [
  EI_ORG_COORD_KEY, EI_EXEC_OBS_KEY, EI_BIZ_CONT_KEY,
  EI_ORG_WF_KEY, EI_PROD_OPT_KEY, EI_CROSS_TEAM_KEY,
  EI_TRUST_KEY, EI_ISO_KEY, EI_PERF_KEY,
];

function _scanOrgIso() {
  return _cached("_ei_iso_scan", () => {
    const violations = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (EI_PREFIXES.some(p => k === p)) continue;
        if (k.startsWith("jarvis_ei_") && !EI_PREFIXES.includes(k)) {
          violations.push({ key: k, ts: Date.now() });
        }
      }
    } catch {}
    const prev = _load(EI_ISO_KEY, []);
    const merged = [...violations, ...prev].slice(0, MAX_ISO);
    _save(EI_ISO_KEY, merged);
    return violations;
  });
}

// ── Phase 1434: Perf audit ────────────────────────────────────────────────────

function _runEIPerfAudit() {
  return _cached("_ei_perf_audit", () => {
    const findings = [];

    try {
      const coords = _load(EI_ORG_COORD_KEY, []);
      const ids    = coords.map(c => c.id).filter(Boolean);
      const dupes  = ids.length - new Set(ids).size;
      if (dupes > 0) findings.push({ id: "coord_duplication", severity: "high", msg: `${dupes} duplicate org coord IDs` });
    } catch {}

    try {
      const obs = _load(EI_EXEC_OBS_KEY, []);
      const leaked = obs.filter(o => o.userInput || o.rawContent || o.commandOutput);
      if (leaked.length > 0) findings.push({ id: "obs_pii_leak", severity: "high", msg: `${leaked.length} exec obs with PII` });
    } catch {}

    try {
      const wfs  = _load(EI_ORG_WF_KEY, []);
      const ids2 = wfs.map(w => w.id).filter(Boolean);
      const dupes2 = ids2.length - new Set(ids2).size;
      if (dupes2 > 0) findings.push({ id: "wf_duplication", severity: "high", msg: `${dupes2} duplicate org workflow IDs` });
    } catch {}

    try {
      const opts  = _load(EI_PROD_OPT_KEY, []);
      const stale = opts.filter(p => !p.acted && Date.now() - (p.ts || 0) > 12 * 60 * 60 * 1000);
      if (stale.length > 5) findings.push({ id: "stale_opts", severity: "medium", msg: `${stale.length} stale prod opt items` });
    } catch {}

    const score = findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75;
    const result = { ts: Date.now(), findings, highCount: findings.filter(f => f.severity === "high").length, score };
    _save(EI_PERF_KEY, result);
    return result;
  });
}

// ── Composite scoring ─────────────────────────────────────────────────────────

function _computeEnterpriseScore({
  coordScore    = 100,
  obsScore      = 100,
  contScore     = 100,
  wfScore       = 100,
  prodScore     = 100,
  teamScore     = 100,
  trustScore    = 100,
  perfScore     = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    trustScore  * 0.25 +
    contScore   * 0.20 +
    coordScore  * 0.15 +
    wfScore     * 0.15 +
    teamScore   * 0.10 +
    prodScore   * 0.08 +
    obsScore    * 0.05 +
    perfScore   * 0.02
  )
  + (trustScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const issue =
    isoViolations > 0    ? `Org isolation: ${isoViolations} violation${isoViolations > 1 ? "s" : ""}` :
    trustScore < 60      ? `Enterprise trust degraded (${trustScore}%)` :
    contScore < 60       ? `Business continuity degraded (${contScore}%)` :
    coordScore < 60      ? `Org coordination degraded (${coordScore}%)` :
    wfScore < 60         ? `Org workflows degraded (${wfScore}%)` :
    null;

  return {
    score,
    issue,
    color: score >= 80 ? "var(--op-green)" : score >= 60 ? "var(--op-amber)" : "var(--op-red)",
    hasCrit: isoViolations > 0 || trustScore < 60,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useEnterpriseIntelligence() {
  const [orgCoord,   setOrgCoord]   = useState(() => _loadOrgCoord());
  const [execObs,    setExecObs]    = useState(() => _loadExecObs());
  const [bizCont,    setBizCont]    = useState(() => _loadBizCont());
  const [orgWf,      setOrgWf]      = useState(() => _loadOrgWf());
  const [prodOpt,    setProdOpt]    = useState(() => _loadProdOpt());
  const [crossTeam,  setCrossTeam]  = useState(() => _loadCrossTeam());
  const [trust,      setTrust]      = useState(() => _loadTrust());

  // ── Writers ─────────────────────────────────────────────────────────────────

  const addOrgCoord = useCallback((entry) => {
    setOrgCoord(prev => {
      const next = _addOrgCoord(prev, entry);
      _save(EI_ORG_COORD_KEY, next);
      _cache.delete(EI_ORG_COORD_KEY);
      return next;
    });
  }, []);

  const addExecObs = useCallback((entry) => {
    setExecObs(prev => {
      const next = _addExecObs(prev, entry);
      _save(EI_EXEC_OBS_KEY, next);
      _cache.delete(EI_EXEC_OBS_KEY);
      return next;
    });
  }, []);

  const addBizCont = useCallback((entry) => {
    setBizCont(prev => {
      const next = _addBizCont(prev, entry);
      _save(EI_BIZ_CONT_KEY, next);
      _cache.delete(EI_BIZ_CONT_KEY);
      return next;
    });
  }, []);

  const addOrgWf = useCallback((entry) => {
    setOrgWf(prev => {
      const next = _addOrgWf(prev, entry);
      _save(EI_ORG_WF_KEY, next);
      _cache.delete(EI_ORG_WF_KEY);
      return next;
    });
  }, []);

  const addProdOpt = useCallback((entry) => {
    setProdOpt(prev => {
      const next = _addProdOpt(prev, entry);
      _save(EI_PROD_OPT_KEY, next);
      _cache.delete(EI_PROD_OPT_KEY);
      return next;
    });
  }, []);

  const actOnProdOpt = useCallback((id) => {
    setProdOpt(prev => {
      const next = prev.map(p => p.id === id ? { ...p, acted: true, actedAt: Date.now() } : p);
      _save(EI_PROD_OPT_KEY, next);
      _cache.delete(EI_PROD_OPT_KEY);
      return next;
    });
  }, []);

  const addCrossTeam = useCallback((entry) => {
    setCrossTeam(prev => {
      const next = _addCrossTeam(prev, entry);
      _save(EI_CROSS_TEAM_KEY, next);
      _cache.delete(EI_CROSS_TEAM_KEY);
      return next;
    });
  }, []);

  const addTrust = useCallback((entry) => {
    setTrust(prev => {
      const next = _addTrust(prev, entry);
      _save(EI_TRUST_KEY, next);
      _cache.delete(EI_TRUST_KEY);
      return next;
    });
  }, []);

  // ── Derived scores (coarse dep-keys) ─────────────────────────────────────────

  const coordScoreVal = useMemo(() => _coordScore(orgCoord),
    [Math.floor(orgCoord.length / 2)]);

  const obsScoreVal = useMemo(() => _obsScore(execObs),
    [Math.floor(execObs.length / 2)]);

  const contScoreVal = useMemo(() => _contScore(bizCont),
    [Math.floor(bizCont.length / 3)]);

  const wfScoreVal = useMemo(() => _wfScore(orgWf),
    [Math.floor(orgWf.length / 2)]);

  const prodOptScoreVal = useMemo(() => _prodOptScore(prodOpt),
    [Math.floor(prodOpt.length / 2)]);

  const crossTeamScoreVal = useMemo(() => _crossTeamScore(crossTeam),
    [Math.floor(crossTeam.length / 2)]);

  const trustScoreVal = useMemo(() => _trustScore(trust),
    [Math.floor(trust.length / 3)]);

  const perfAudit = useMemo(() => _runEIPerfAudit(),
    [Math.floor((orgCoord.length + orgWf.length + prodOpt.length) / 3)]);

  const eiIsoViolations = useMemo(() => _scanOrgIso(),
    [Math.floor((orgCoord.length + trust.length) / 4)]);

  // ── Composite bar ────────────────────────────────────────────────────────────

  const eiBar = useMemo(() => {
    const result = _computeEnterpriseScore({
      coordScore:    coordScoreVal,
      obsScore:      obsScoreVal,
      contScore:     contScoreVal,
      wfScore:       wfScoreVal,
      prodScore:     prodOptScoreVal,
      teamScore:     crossTeamScoreVal,
      trustScore:    trustScoreVal,
      perfScore:     perfAudit.score,
      isoViolations: eiIsoViolations.length,
    });
    if (result.score >= 80 && !result.issue) return null;
    return result;
  }, [coordScoreVal, obsScoreVal, contScoreVal, wfScoreVal,
      prodOptScoreVal, crossTeamScoreVal, trustScoreVal,
      perfAudit.score, eiIsoViolations.length]);

  const topProdOpt = useMemo(() =>
    prodOpt.find(p => !p.acted) || null,
    [Math.floor(prodOpt.length / 2)]);

  return {
    // writers
    addOrgCoord, addExecObs, addBizCont, addOrgWf,
    addProdOpt, actOnProdOpt, addCrossTeam, addTrust,
    // scores
    eiScore:        _computeEnterpriseScore({
                      coordScore: coordScoreVal, obsScore: obsScoreVal,
                      contScore: contScoreVal, wfScore: wfScoreVal,
                      prodScore: prodOptScoreVal, teamScore: crossTeamScoreVal,
                      trustScore: trustScoreVal, perfScore: perfAudit.score,
                      isoViolations: eiIsoViolations.length,
                    }).score,
    coordScore:     coordScoreVal,
    obsScore:       obsScoreVal,
    contScore:      contScoreVal,
    wfScore:        wfScoreVal,
    prodOptScore:   prodOptScoreVal,
    crossTeamScore: crossTeamScoreVal,
    trustScore:     trustScoreVal,
    perfAudit,
    eiIsoViolations,
    eiBar,
    topProdOpt,
  };
}
