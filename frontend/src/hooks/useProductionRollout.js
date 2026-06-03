// Phases 1441-1451: Production rollout + platform polish excellence.
//
// Consolidates eleven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded arrays throughout.

import { useState, useCallback, useMemo } from "react";

// ── Keys ──────────────────────────────────────────────────────────────────────

const PR_ROLLOUT_KEY    = "jarvis_pr_rollout";
const PR_ONBOARD_KEY    = "jarvis_pr_onboarding";
const PR_TRUST_KEY      = "jarvis_pr_trust";
const PR_PLUGIN_KEY     = "jarvis_pr_plugin_quality";
const PR_SUPPORT_KEY    = "jarvis_pr_support";
const PR_ECO_KEY        = "jarvis_pr_eco_stability";
const PR_ISO_KEY        = "jarvis_pr_tenant_iso";
const PR_PERF_KEY       = "jarvis_pr_perf";

// ── Bounds ────────────────────────────────────────────────────────────────────

const MAX_ROLLOUT   = 15;
const MAX_ONBOARD   = 20;
const MAX_TRUST     = 30;
const MAX_PLUGIN    = 20;
const MAX_SUPPORT   = 15;
const MAX_ECO       = 20;
const MAX_ISO       = 20;

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

// ── Phase 1441: Rollout continuity ───────────────────────────────────────────

const VALID_ROLLOUT_STAGES = ["staged", "canary", "rolling", "complete", "rolled_back", "paused"];

function _loadRollout() {
  return _cached(PR_ROLLOUT_KEY, () =>
    _load(PR_ROLLOUT_KEY, []).filter(r => Date.now() - (r.ts || 0) < TTL_7D)
  );
}

function _addRollout(items, entry) {
  if (!entry.id || !entry.env || !VALID_ROLLOUT_STAGES.includes(entry.stage)) return items;
  // approval-gate at rolling/canary
  if (["rolling", "canary"].includes(entry.stage) && !entry.approvedAt) return items;
  // forward-only stage progression
  const existing = items.find(r => r.id === entry.id);
  if (existing) {
    const order = VALID_ROLLOUT_STAGES.indexOf(entry.stage);
    const prev  = VALID_ROLLOUT_STAGES.indexOf(existing.stage);
    if (order < prev) return items;
  }
  const dedup = items.filter(r => r.id !== entry.id);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(r => Date.now() - (r.ts || 0) < TTL_7D)
    .slice(0, MAX_ROLLOUT);
}

function _rolloutScore(items) {
  if (!items.length) return 100;
  const rolledBack = items.filter(r => r.stage === "rolled_back").length;
  const active     = items.filter(r => ["rolling", "canary", "staged"].includes(r.stage)).length;
  if (rolledBack > 2) return 55;
  if (active > 6)     return 70;
  return 100;
}

// ── Phase 1442: Onboarding polish ────────────────────────────────────────────

const VALID_OB_STAGES = ["not_started", "started", "workspace_ready", "first_workflow", "complete"];

function _loadOnboard() {
  return _cached(PR_ONBOARD_KEY, () =>
    _load(PR_ONBOARD_KEY, []).filter(o => Date.now() - (o.ts || 0) < TTL_7D)
  );
}

function _addOnboard(items, entry) {
  if (!entry.sessionId || !VALID_OB_STAGES.includes(entry.stage)) return items;
  // forward-only
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
  const complete = items.filter(o => o.stage === "complete").length;
  const stale    = items.filter(o =>
    o.stage !== "complete" && Date.now() - (o.ts || 0) > 48 * 60 * 60 * 1000
  ).length;
  if (stale > 3) return 60;
  if (!complete && items.length > 5) return 70;
  return 100;
}

// ── Phase 1444: Public trust excellence ──────────────────────────────────────

function _loadTrust() {
  return _cached(PR_TRUST_KEY, () =>
    _load(PR_TRUST_KEY, []).filter(t => Date.now() - (t.ts || 0) < TTL_7D)
  );
}

function _addTrust(items, entry) {
  if (!entry.dim || entry.userInput || entry.rawContent) return items;
  // 5min dedup per dim+source
  const key = `${entry.dim}:${entry.source || ""}`;
  const recent = items.find(t => `${t.dim}:${t.source || ""}` === key && Date.now() - (t.ts || 0) < 5 * 60 * 1000);
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

// ── Phase 1445: Plugin quality ────────────────────────────────────────────────

function _loadPluginQuality() {
  return _cached(PR_PLUGIN_KEY, () =>
    _load(PR_PLUGIN_KEY, []).filter(p => Date.now() - (p.ts || 0) < TTL_7D)
  );
}

function _addPluginQuality(items, entry) {
  if (!entry.pluginId || entry.userInput || entry.rawContent) return items;
  // 5min dedup per pluginId+dim
  const key = `${entry.pluginId}:${entry.dim || ""}`;
  const recent = items.find(p => `${p.pluginId}:${p.dim || ""}` === key && Date.now() - (p.ts || 0) < 5 * 60 * 1000);
  if (recent) return items;
  return [{ ...entry, ts: Date.now() }, ...items]
    .filter(p => Date.now() - (p.ts || 0) < TTL_7D)
    .slice(0, MAX_PLUGIN);
}

function _pluginScore(items) {
  if (!items.length) return 100;
  const recent = items.filter(p => Date.now() - (p.ts || 0) < TTL_24H);
  if (!recent.length) return 100;
  const sum = recent.reduce((acc, p) => acc + (p.score ?? 100), 0);
  return Math.round(sum / recent.length);
}

// ── Phase 1446: Support excellence ───────────────────────────────────────────

const VALID_SUPPORT_STAGES = ["open", "investigating", "escalated", "resolved", "closed"];

function _loadSupport() {
  return _cached(PR_SUPPORT_KEY, () =>
    _load(PR_SUPPORT_KEY, []).filter(s => Date.now() - (s.ts || 0) < TTL_7D)
  );
}

function _addSupport(items, entry) {
  if (!entry.id || !entry.summary || !VALID_SUPPORT_STAGES.includes(entry.stage)) return items;
  // escalation requires operator approval
  if (entry.stage === "escalated" && !entry.operatorApproved) return items;
  const dedup = items.filter(s => s.id !== entry.id);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(s => Date.now() - (s.ts || 0) < TTL_7D)
    .slice(0, MAX_SUPPORT);
}

function _supportScore(items) {
  if (!items.length) return 100;
  const open     = items.filter(s => s.stage === "open").length;
  const escalated = items.filter(s => s.stage === "escalated").length;
  if (escalated > 2) return 55;
  if (open > 5)      return 70;
  return 100;
}

// ── Phase 1448: Ecosystem stability ──────────────────────────────────────────

function _loadEco() {
  return _cached(PR_ECO_KEY, () =>
    _load(PR_ECO_KEY, []).filter(e => Date.now() - (e.ts || 0) < TTL_7D)
  );
}

function _addEco(items, entry) {
  if (!entry.type || entry.userInput || entry.rawContent) return items;
  // 2min dedup per type+pluginId
  const key = `${entry.type}:${entry.pluginId || ""}`;
  const recent = items.find(e => `${e.type}:${e.pluginId || ""}` === key && Date.now() - (e.ts || 0) < 2 * 60 * 1000);
  if (recent) return items;
  return [{ ...entry, recovered: Boolean(entry.recovered), ts: Date.now() }, ...items]
    .filter(e => Date.now() - (e.ts || 0) < TTL_7D)
    .slice(0, MAX_ECO);
}

function _ecoScore(items) {
  if (!items.length) return 100;
  const recovered = items.filter(e => e.recovered).length;
  return Math.round(Math.min(100, 60 + (recovered / Math.max(1, items.length)) * 40));
}

// ── Phase 1449: Multi-tenant isolation scanner ────────────────────────────────

const PR_PREFIXES = [
  PR_ROLLOUT_KEY, PR_ONBOARD_KEY, PR_TRUST_KEY,
  PR_PLUGIN_KEY, PR_SUPPORT_KEY, PR_ECO_KEY,
  PR_ISO_KEY, PR_PERF_KEY,
];

function _scanTenantIso() {
  return _cached("_pr_iso_scan", () => {
    const violations = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (PR_PREFIXES.includes(k)) continue;
        if (k.startsWith("jarvis_pr_") && !PR_PREFIXES.includes(k)) {
          violations.push({ key: k, ts: Date.now() });
        }
      }
    } catch {}
    const prev   = _load(PR_ISO_KEY, []);
    const merged = [...violations, ...prev].slice(0, MAX_ISO);
    _save(PR_ISO_KEY, merged);
    return violations;
  });
}

// ── Phase 1447: Perf audit ────────────────────────────────────────────────────

function _runPRPerfAudit() {
  return _cached("_pr_perf_audit", () => {
    const findings = [];

    try {
      const rollouts = _load(PR_ROLLOUT_KEY, []);
      const ids      = rollouts.map(r => r.id).filter(Boolean);
      const dupes    = ids.length - new Set(ids).size;
      if (dupes > 0) findings.push({ id: "rollout_duplication", severity: "high", msg: `${dupes} duplicate rollout IDs` });
    } catch {}

    try {
      const trust  = _load(PR_TRUST_KEY, []);
      const leaked = trust.filter(t => t.userInput || t.rawContent || t.commandOutput);
      if (leaked.length > 0) findings.push({ id: "trust_pii_leak", severity: "high", msg: `${leaked.length} trust entries with PII` });
    } catch {}

    try {
      const rollouts = _load(PR_ROLLOUT_KEY, []);
      const active   = rollouts.filter(r => ["rolling", "canary", "staged"].includes(r.stage));
      if (active.length > 6) findings.push({ id: "rollout_saturation", severity: "high", msg: `${active.length} active rollouts` });
    } catch {}

    try {
      const support  = _load(PR_SUPPORT_KEY, []);
      const open     = support.filter(s => s.stage === "open");
      if (open.length > 8) findings.push({ id: "support_overflow", severity: "medium", msg: `${open.length} open support items` });
    } catch {}

    try {
      const eco    = _load(PR_ECO_KEY, []);
      const leaked = eco.filter(e => e.userInput || e.rawContent);
      if (leaked.length > 0) findings.push({ id: "eco_pii_leak", severity: "high", msg: `${leaked.length} eco entries with PII` });
    } catch {}

    const score  = findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75;
    const result = { ts: Date.now(), findings, highCount: findings.filter(f => f.severity === "high").length, score };
    _save(PR_PERF_KEY, result);
    return result;
  });
}

// ── Composite scoring ─────────────────────────────────────────────────────────

function _computePRScore({
  rolloutScore  = 100,
  onboardScore  = 100,
  trustScore    = 100,
  pluginScore   = 100,
  supportScore  = 100,
  ecoScore      = 100,
  perfScore     = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    trustScore   * 0.25 +
    rolloutScore * 0.20 +
    onboardScore * 0.20 +
    ecoScore     * 0.15 +
    pluginScore  * 0.10 +
    supportScore * 0.07 +
    perfScore    * 0.03
  )
  + (trustScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const issue =
    isoViolations > 0   ? `Tenant isolation: ${isoViolations} violation${isoViolations > 1 ? "s" : ""}` :
    trustScore < 60     ? `Platform trust degraded (${trustScore}%)` :
    rolloutScore < 60   ? `Rollout health degraded (${rolloutScore}%)` :
    onboardScore < 60   ? `Onboarding degraded (${onboardScore}%)` :
    ecoScore < 60       ? `Ecosystem stability degraded (${ecoScore}%)` :
    null;

  return {
    score,
    issue,
    color:   score >= 80 ? "var(--op-green)" : score >= 60 ? "var(--op-amber)" : "var(--op-red)",
    hasCrit: isoViolations > 0 || trustScore < 60,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useProductionRollout() {
  const [rollout,  setRollout]  = useState(() => _loadRollout());
  const [onboard,  setOnboard]  = useState(() => _loadOnboard());
  const [trust,    setTrust]    = useState(() => _loadTrust());
  const [plugin,   setPlugin]   = useState(() => _loadPluginQuality());
  const [support,  setSupport]  = useState(() => _loadSupport());
  const [eco,      setEco]      = useState(() => _loadEco());

  // ── Writers ─────────────────────────────────────────────────────────────────

  const addRollout = useCallback((entry) => {
    setRollout(prev => {
      const next = _addRollout(prev, entry);
      _save(PR_ROLLOUT_KEY, next);
      _cache.delete(PR_ROLLOUT_KEY);
      return next;
    });
  }, []);

  const addOnboard = useCallback((entry) => {
    setOnboard(prev => {
      const next = _addOnboard(prev, entry);
      _save(PR_ONBOARD_KEY, next);
      _cache.delete(PR_ONBOARD_KEY);
      return next;
    });
  }, []);

  const addTrust = useCallback((entry) => {
    setTrust(prev => {
      const next = _addTrust(prev, entry);
      _save(PR_TRUST_KEY, next);
      _cache.delete(PR_TRUST_KEY);
      return next;
    });
  }, []);

  const addPluginQuality = useCallback((entry) => {
    setPlugin(prev => {
      const next = _addPluginQuality(prev, entry);
      _save(PR_PLUGIN_KEY, next);
      _cache.delete(PR_PLUGIN_KEY);
      return next;
    });
  }, []);

  const addSupport = useCallback((entry) => {
    setSupport(prev => {
      const next = _addSupport(prev, entry);
      _save(PR_SUPPORT_KEY, next);
      _cache.delete(PR_SUPPORT_KEY);
      return next;
    });
  }, []);

  const addEco = useCallback((entry) => {
    setEco(prev => {
      const next = _addEco(prev, entry);
      _save(PR_ECO_KEY, next);
      _cache.delete(PR_ECO_KEY);
      return next;
    });
  }, []);

  // ── Derived scores (coarse dep-keys) ─────────────────────────────────────────

  const rolloutScoreVal = useMemo(() => _rolloutScore(rollout),
    [Math.floor(rollout.length / 2)]);

  const onboardScoreVal = useMemo(() => _onboardScore(onboard),
    [Math.floor(onboard.length / 2)]);

  const trustScoreVal = useMemo(() => _trustScore(trust),
    [Math.floor(trust.length / 3)]);

  const pluginScoreVal = useMemo(() => _pluginScore(plugin),
    [Math.floor(plugin.length / 2)]);

  const supportScoreVal = useMemo(() => _supportScore(support),
    [Math.floor(support.length / 2)]);

  const ecoScoreVal = useMemo(() => _ecoScore(eco),
    [Math.floor(eco.length / 2)]);

  const perfAudit = useMemo(() => _runPRPerfAudit(),
    [Math.floor((rollout.length + trust.length + eco.length) / 3)]);

  const prIsoViolations = useMemo(() => _scanTenantIso(),
    [Math.floor((rollout.length + eco.length) / 3)]);

  // ── Composite bar ────────────────────────────────────────────────────────────

  const prBar = useMemo(() => {
    const result = _computePRScore({
      rolloutScore:  rolloutScoreVal,
      onboardScore:  onboardScoreVal,
      trustScore:    trustScoreVal,
      pluginScore:   pluginScoreVal,
      supportScore:  supportScoreVal,
      ecoScore:      ecoScoreVal,
      perfScore:     perfAudit.score,
      isoViolations: prIsoViolations.length,
    });
    if (result.score >= 80 && !result.issue) return null;
    return result;
  }, [rolloutScoreVal, onboardScoreVal, trustScoreVal,
      pluginScoreVal, supportScoreVal, ecoScoreVal,
      perfAudit.score, prIsoViolations.length]);

  return {
    // writers
    addRollout, addOnboard, addTrust, addPluginQuality, addSupport, addEco,
    // scores
    prScore:       _computePRScore({
                     rolloutScore: rolloutScoreVal, onboardScore: onboardScoreVal,
                     trustScore: trustScoreVal, pluginScore: pluginScoreVal,
                     supportScore: supportScoreVal, ecoScore: ecoScoreVal,
                     perfScore: perfAudit.score, isoViolations: prIsoViolations.length,
                   }).score,
    rolloutScore:  rolloutScoreVal,
    onboardScore:  onboardScoreVal,
    trustScore:    trustScoreVal,
    pluginScore:   pluginScoreVal,
    supportScore:  supportScoreVal,
    ecoScore:      ecoScoreVal,
    perfAudit,
    prIsoViolations,
    prBar,
  };
}
