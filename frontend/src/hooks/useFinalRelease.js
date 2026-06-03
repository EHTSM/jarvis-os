// Phases 1486-1497: Final deployment + public release execution.
//
// Consolidates twelve phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded arrays throughout.

import { useState, useCallback, useMemo } from "react";

// ── Keys ──────────────────────────────────────────────────────────────────────

const FR_HOSTING_KEY   = "jarvis_fr_hosting";
const FR_DOMAIN_KEY    = "jarvis_fr_domain";
const FR_WEB_KEY       = "jarvis_fr_web_release";
const FR_MOBILE_KEY    = "jarvis_fr_mobile_release";
const FR_STORE_KEY     = "jarvis_fr_store";
const FR_ONBOARD_KEY   = "jarvis_fr_onboarding";
const FR_SUPPORT_KEY   = "jarvis_fr_support";
const FR_ANALYTICS_KEY = "jarvis_fr_analytics";
const FR_ISO_KEY       = "jarvis_fr_release_iso";
const FR_PERF_KEY      = "jarvis_fr_perf";

// ── Bounds ────────────────────────────────────────────────────────────────────

const MAX_HOSTING   = 15;
const MAX_DOMAIN    = 15;
const MAX_WEB       = 20;
const MAX_MOBILE    = 20;
const MAX_STORE     = 15;
const MAX_ONBOARD   = 20;
const MAX_SUPPORT   = 15;
const MAX_ANALYTICS = 30;
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

// ── Phase 1486: Production hosting ───────────────────────────────────────────

const VALID_HOSTING_STAGES = ["provisioning", "active", "degraded", "maintenance", "decommissioned"];

function _loadHosting() {
  return _cached(FR_HOSTING_KEY, () =>
    _load(FR_HOSTING_KEY, []).filter(h => Date.now() - (h.ts || 0) < TTL_7D)
  );
}

function _addHosting(items, entry) {
  if (!entry.id || !entry.env || !VALID_HOSTING_STAGES.includes(entry.stage)) return items;
  if (entry.stage === "active" && !entry.approvedAt) return items;
  const dedup = items.filter(h => h.id !== entry.id);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(h => Date.now() - (h.ts || 0) < TTL_7D)
    .slice(0, MAX_HOSTING);
}

function _hostingScore(items) {
  if (!items.length) return 100;
  const degraded = items.filter(h => h.stage === "degraded").length;
  if (degraded > 1) return 50;
  if (degraded > 0) return 70;
  return 100;
}

// ── Phase 1487: Domain + routing ─────────────────────────────────────────────

const VALID_DOMAIN_STAGES = ["pending", "propagating", "active", "failed", "rolled_back"];

function _loadDomain() {
  return _cached(FR_DOMAIN_KEY, () =>
    _load(FR_DOMAIN_KEY, []).filter(d => Date.now() - (d.ts || 0) < TTL_7D)
  );
}

function _addDomain(items, entry) {
  if (!entry.id || !entry.domain || !VALID_DOMAIN_STAGES.includes(entry.stage)) return items;
  if (entry.stage === "active" && !entry.approvedAt) return items;
  const dedup = items.filter(d => d.id !== entry.id);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(d => Date.now() - (d.ts || 0) < TTL_7D)
    .slice(0, MAX_DOMAIN);
}

function _domainScore(items) {
  if (!items.length) return 100;
  const failed = items.filter(d => d.stage === "failed").length;
  if (failed > 1) return 50;
  if (failed > 0) return 70;
  return 100;
}

// ── Phase 1488: Web release ───────────────────────────────────────────────────

function _loadWeb() {
  return _cached(FR_WEB_KEY, () =>
    _load(FR_WEB_KEY, []).filter(w => Date.now() - (w.ts || 0) < TTL_7D)
  );
}

function _addWeb(items, entry) {
  if (!entry.version || !entry.env || entry.userInput || entry.rawContent) return items;
  if (entry.stage === "live" && !entry.approvedAt) return items;
  const dedup = items.filter(w => w.version !== entry.version);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(w => Date.now() - (w.ts || 0) < TTL_7D)
    .slice(0, MAX_WEB);
}

function _webScore(items) {
  if (!items.length) return 100;
  const unapproved = items.filter(w => w.stage === "live" && !w.approvedAt).length;
  if (unapproved > 0) return 50;
  const failed = items.filter(w => w.stage === "failed").length;
  if (failed > 1) return 65;
  return 100;
}

// ── Phase 1489-1490: Mobile + app store ──────────────────────────────────────

const VALID_MOBILE_STAGES = ["building", "review", "approved", "live", "rejected", "rolled_back"];
const VALID_PLATFORMS     = ["ios", "android", "web"];

function _loadMobile() {
  return _cached(FR_MOBILE_KEY, () =>
    _load(FR_MOBILE_KEY, []).filter(m => Date.now() - (m.ts || 0) < TTL_7D)
  );
}

function _addMobile(items, entry) {
  if (!entry.version || !VALID_PLATFORMS.includes(entry.platform) || !VALID_MOBILE_STAGES.includes(entry.stage)) return items;
  if (entry.stage === "live" && !entry.approvedAt) return items;
  // forward-only per version+platform
  const key      = `${entry.version}:${entry.platform}`;
  const existing = items.find(m => `${m.version}:${m.platform}` === key);
  if (existing) {
    const order = VALID_MOBILE_STAGES.indexOf(entry.stage);
    const prev  = VALID_MOBILE_STAGES.indexOf(existing.stage);
    if (order < prev) return items;
  }
  const dedup = items.filter(m => `${m.version}:${m.platform}` !== key);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(m => Date.now() - (m.ts || 0) < TTL_7D)
    .slice(0, MAX_MOBILE);
}

function _mobileScore(items) {
  if (!items.length) return 100;
  const rejected = items.filter(m => m.stage === "rejected").length;
  if (rejected > 1) return 50;
  if (rejected > 0) return 70;
  return 100;
}

function _loadStore() {
  return _cached(FR_STORE_KEY, () =>
    _load(FR_STORE_KEY, []).filter(s => Date.now() - (s.ts || 0) < TTL_7D)
  );
}

function _addStore(items, entry) {
  if (!entry.platform || !VALID_PLATFORMS.includes(entry.platform) || !entry.status) return items;
  if (entry.status === "approved" && !entry.approvedAt) return items;
  const dedup = items.filter(s => s.platform !== entry.platform);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(s => Date.now() - (s.ts || 0) < TTL_7D)
    .slice(0, MAX_STORE);
}

function _storeScore(items) {
  if (!items.length) return 100;
  const rejected = items.filter(s => s.status === "rejected").length;
  if (rejected > 0) return 55;
  return 100;
}

// ── Phase 1491: Onboarding ────────────────────────────────────────────────────

const VALID_OB_STAGES = ["not_started", "started", "workspace_ready", "first_workflow", "complete"];

function _loadOnboard() {
  return _cached(FR_ONBOARD_KEY, () =>
    _load(FR_ONBOARD_KEY, []).filter(o => Date.now() - (o.ts || 0) < TTL_7D)
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
  return 100;
}

// ── Phase 1492: Support ───────────────────────────────────────────────────────

const VALID_SUPPORT_STAGES = ["open", "investigating", "escalated", "resolved", "closed"];

function _loadSupport() {
  return _cached(FR_SUPPORT_KEY, () =>
    _load(FR_SUPPORT_KEY, []).filter(s => Date.now() - (s.ts || 0) < TTL_7D)
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

// ── Phase 1493: Analytics ─────────────────────────────────────────────────────

const VALID_ANALYTICS_TYPES = ["onboard_completion", "deployment_event", "trust_signal", "engagement", "responsiveness", "error_rate"];

function _loadAnalytics() {
  return _cached(FR_ANALYTICS_KEY, () =>
    _load(FR_ANALYTICS_KEY, []).filter(a => Date.now() - (a.ts || 0) < TTL_24H)
  );
}

function _addAnalytics(items, entry) {
  if (!entry.type || !VALID_ANALYTICS_TYPES.includes(entry.type)) return items;
  if (entry.userInput || entry.rawContent || entry.commandOutput) return items;
  const key = `${entry.type}:${entry.env || ""}`;
  const recent = items.find(a => `${a.type}:${a.env || ""}` === key && Date.now() - (a.ts || 0) < 30_000);
  if (recent) return items;
  return [{ ...entry, ts: Date.now() }, ...items]
    .filter(a => Date.now() - (a.ts || 0) < TTL_24H)
    .slice(0, MAX_ANALYTICS);
}

function _analyticsScore(items) {
  if (!items.length) return 100;
  const errors = items.filter(a => a.type === "error_rate" && (a.value ?? 0) > 0.05).length;
  if (errors > 2) return 60;
  return 100;
}

// ── Phase 1494: Isolation scanner ────────────────────────────────────────────

const FR_PREFIXES = [
  FR_HOSTING_KEY, FR_DOMAIN_KEY, FR_WEB_KEY, FR_MOBILE_KEY,
  FR_STORE_KEY, FR_ONBOARD_KEY, FR_SUPPORT_KEY,
  FR_ANALYTICS_KEY, FR_ISO_KEY, FR_PERF_KEY,
];

function _scanReleaseIso() {
  return _cached("_fr_iso_scan", () => {
    const violations = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (FR_PREFIXES.includes(k)) continue;
        if (k.startsWith("jarvis_fr_") && !FR_PREFIXES.includes(k)) {
          violations.push({ key: k, ts: Date.now() });
        }
      }
    } catch {}
    const prev   = _load(FR_ISO_KEY, []);
    const merged = [...violations, ...prev].slice(0, MAX_ISO);
    _save(FR_ISO_KEY, merged);
    return violations;
  });
}

// ── Phase 1495: Perf audit ────────────────────────────────────────────────────

function _runFRPerfAudit() {
  return _cached("_fr_perf_audit", () => {
    const findings = [];

    try {
      const hosting = _load(FR_HOSTING_KEY, []);
      const ids     = hosting.map(h => h.id).filter(Boolean);
      const dupes   = ids.length - new Set(ids).size;
      if (dupes > 0) findings.push({ id: "hosting_duplication", severity: "high", msg: `${dupes} duplicate hosting IDs` });
    } catch {}

    try {
      const web    = _load(FR_WEB_KEY, []);
      const leaked = web.filter(w => w.userInput || w.rawContent);
      if (leaked.length > 0) findings.push({ id: "web_pii_leak", severity: "high", msg: `${leaked.length} web release entries with PII` });
    } catch {}

    try {
      const mobile   = _load(FR_MOBILE_KEY, []);
      const rejected = mobile.filter(m => m.stage === "rejected");
      if (rejected.length > 1) findings.push({ id: "mobile_rejections", severity: "high", msg: `${rejected.length} rejected mobile releases` });
    } catch {}

    try {
      const analytics = _load(FR_ANALYTICS_KEY, []);
      const leaked    = analytics.filter(a => a.userInput || a.rawContent || a.commandOutput);
      if (leaked.length > 0) findings.push({ id: "analytics_pii_leak", severity: "high", msg: `${leaked.length} analytics entries with PII` });
    } catch {}

    try {
      const support = _load(FR_SUPPORT_KEY, []);
      const open    = support.filter(s => s.stage === "open");
      if (open.length > 8) findings.push({ id: "support_overflow", severity: "medium", msg: `${open.length} open support items` });
    } catch {}

    const score  = findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75;
    const result = { ts: Date.now(), findings, highCount: findings.filter(f => f.severity === "high").length, score };
    _save(FR_PERF_KEY, result);
    return result;
  });
}

// ── Composite scoring ─────────────────────────────────────────────────────────

function _computeFRScore({
  hostingScore   = 100,
  domainScore    = 100,
  webScore       = 100,
  mobileScore    = 100,
  storeScore     = 100,
  onboardScore   = 100,
  supportScore   = 100,
  analyticsScore = 100,
  perfScore      = 100,
  isoViolations  = 0,
} = {}) {
  const composite = Math.round(
    hostingScore   * 0.20 +
    webScore       * 0.20 +
    mobileScore    * 0.15 +
    onboardScore   * 0.15 +
    domainScore    * 0.10 +
    storeScore     * 0.10 +
    supportScore   * 0.06 +
    analyticsScore * 0.03 +
    perfScore      * 0.01
  )
  + (hostingScore === 100 && webScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const issue =
    isoViolations > 0  ? `Release isolation: ${isoViolations} violation${isoViolations > 1 ? "s" : ""}` :
    hostingScore < 60  ? `Hosting degraded (${hostingScore}%)` :
    webScore < 60      ? `Web release degraded (${webScore}%)` :
    mobileScore < 60   ? `Mobile release degraded (${mobileScore}%)` :
    storeScore < 60    ? `App store rejected (${storeScore}%)` :
    null;

  return {
    score,
    issue,
    color:   score >= 80 ? "var(--op-green)" : score >= 60 ? "var(--op-amber)" : "var(--op-red)",
    hasCrit: isoViolations > 0 || hostingScore < 60 || storeScore < 60,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useFinalRelease() {
  const [hosting,   setHosting]   = useState(() => _loadHosting());
  const [domain,    setDomain]    = useState(() => _loadDomain());
  const [web,       setWeb]       = useState(() => _loadWeb());
  const [mobile,    setMobile]    = useState(() => _loadMobile());
  const [store,     setStore]     = useState(() => _loadStore());
  const [onboard,   setOnboard]   = useState(() => _loadOnboard());
  const [support,   setSupport]   = useState(() => _loadSupport());
  const [analytics, setAnalytics] = useState(() => _loadAnalytics());

  // ── Writers ─────────────────────────────────────────────────────────────────

  const addHosting = useCallback((entry) => {
    setHosting(prev => {
      const next = _addHosting(prev, entry);
      _save(FR_HOSTING_KEY, next);
      _cache.delete(FR_HOSTING_KEY);
      return next;
    });
  }, []);

  const addDomain = useCallback((entry) => {
    setDomain(prev => {
      const next = _addDomain(prev, entry);
      _save(FR_DOMAIN_KEY, next);
      _cache.delete(FR_DOMAIN_KEY);
      return next;
    });
  }, []);

  const addWebRelease = useCallback((entry) => {
    setWeb(prev => {
      const next = _addWeb(prev, entry);
      _save(FR_WEB_KEY, next);
      _cache.delete(FR_WEB_KEY);
      return next;
    });
  }, []);

  const addMobileRelease = useCallback((entry) => {
    setMobile(prev => {
      const next = _addMobile(prev, entry);
      _save(FR_MOBILE_KEY, next);
      _cache.delete(FR_MOBILE_KEY);
      return next;
    });
  }, []);

  const addStore = useCallback((entry) => {
    setStore(prev => {
      const next = _addStore(prev, entry);
      _save(FR_STORE_KEY, next);
      _cache.delete(FR_STORE_KEY);
      return next;
    });
  }, []);

  const addOnboard = useCallback((entry) => {
    setOnboard(prev => {
      const next = _addOnboard(prev, entry);
      _save(FR_ONBOARD_KEY, next);
      _cache.delete(FR_ONBOARD_KEY);
      return next;
    });
  }, []);

  const addSupport = useCallback((entry) => {
    setSupport(prev => {
      const next = _addSupport(prev, entry);
      _save(FR_SUPPORT_KEY, next);
      _cache.delete(FR_SUPPORT_KEY);
      return next;
    });
  }, []);

  const addAnalytics = useCallback((entry) => {
    setAnalytics(prev => {
      const next = _addAnalytics(prev, entry);
      _save(FR_ANALYTICS_KEY, next);
      _cache.delete(FR_ANALYTICS_KEY);
      return next;
    });
  }, []);

  // ── Derived scores (coarse dep-keys) ─────────────────────────────────────────

  const hostingScoreVal   = useMemo(() => _hostingScore(hosting),    [Math.floor(hosting.length / 2)]);
  const domainScoreVal    = useMemo(() => _domainScore(domain),       [Math.floor(domain.length / 2)]);
  const webScoreVal       = useMemo(() => _webScore(web),             [Math.floor(web.length / 2)]);
  const mobileScoreVal    = useMemo(() => _mobileScore(mobile),       [Math.floor(mobile.length / 2)]);
  const storeScoreVal     = useMemo(() => _storeScore(store),         [Math.floor(store.length / 2)]);
  const onboardScoreVal   = useMemo(() => _onboardScore(onboard),     [Math.floor(onboard.length / 2)]);
  const supportScoreVal   = useMemo(() => _supportScore(support),     [Math.floor(support.length / 2)]);
  const analyticsScoreVal = useMemo(() => _analyticsScore(analytics), [Math.floor(analytics.length / 3)]);

  const perfAudit = useMemo(() => _runFRPerfAudit(),
    [Math.floor((hosting.length + web.length + mobile.length) / 3)]);

  const frIsoViolations = useMemo(() => _scanReleaseIso(),
    [Math.floor((hosting.length + web.length) / 3)]);

  // ── Composite bar ────────────────────────────────────────────────────────────

  const frBar = useMemo(() => {
    const result = _computeFRScore({
      hostingScore:   hostingScoreVal,
      domainScore:    domainScoreVal,
      webScore:       webScoreVal,
      mobileScore:    mobileScoreVal,
      storeScore:     storeScoreVal,
      onboardScore:   onboardScoreVal,
      supportScore:   supportScoreVal,
      analyticsScore: analyticsScoreVal,
      perfScore:      perfAudit.score,
      isoViolations:  frIsoViolations.length,
    });
    if (result.score >= 80 && !result.issue) return null;
    return result;
  }, [hostingScoreVal, domainScoreVal, webScoreVal, mobileScoreVal,
      storeScoreVal, onboardScoreVal, supportScoreVal, analyticsScoreVal,
      perfAudit.score, frIsoViolations.length]);

  return {
    addHosting, addDomain, addWebRelease, addMobileRelease,
    addStore, addOnboard, addSupport, addAnalytics,
    frScore:       _computeFRScore({
                     hostingScore: hostingScoreVal, domainScore: domainScoreVal,
                     webScore: webScoreVal, mobileScore: mobileScoreVal,
                     storeScore: storeScoreVal, onboardScore: onboardScoreVal,
                     supportScore: supportScoreVal, analyticsScore: analyticsScoreVal,
                     perfScore: perfAudit.score, isoViolations: frIsoViolations.length,
                   }).score,
    hostingScore:  hostingScoreVal,
    domainScore:   domainScoreVal,
    webScore:      webScoreVal,
    mobileScore:   mobileScoreVal,
    storeScore:    storeScoreVal,
    onboardScore:  onboardScoreVal,
    perfAudit,
    frIsoViolations,
    frBar,
  };
}
