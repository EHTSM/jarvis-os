// Phases 1456-1466: Launch execution + monetization maturity.
//
// Consolidates eleven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded arrays throughout.

import { useState, useCallback, useMemo } from "react";

// ── Keys ──────────────────────────────────────────────────────────────────────

const MI_SUB_KEY      = "jarvis_mi_subscriptions";
const MI_CREATOR_KEY  = "jarvis_mi_creator_revenue";
const MI_TXN_KEY      = "jarvis_mi_transactions";
const MI_BILLING_KEY  = "jarvis_mi_billing";
const MI_BIZ_KEY      = "jarvis_mi_biz_intel";
const MI_GROWTH_KEY   = "jarvis_mi_growth";
const MI_SURV_KEY     = "jarvis_mi_rev_surv";
const MI_ISO_KEY      = "jarvis_mi_billing_iso";
const MI_PERF_KEY     = "jarvis_mi_perf";

// ── Bounds ────────────────────────────────────────────────────────────────────

const MAX_SUB      = 20;
const MAX_CREATOR  = 20;
const MAX_TXN      = 30;
const MAX_BILLING  = 20;
const MAX_BIZ      = 20;
const MAX_GROWTH   = 20;
const MAX_SURV     = 30;
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

// ── Phase 1456: Subscriptions ─────────────────────────────────────────────────

const VALID_SUB_STAGES = ["trialing", "active", "past_due", "canceled", "paused"];

function _loadSubs() {
  return _cached(MI_SUB_KEY, () =>
    _load(MI_SUB_KEY, []).filter(s => Date.now() - (s.ts || 0) < TTL_7D)
  );
}

function _addSub(items, entry) {
  if (!entry.id || !entry.orgId || !VALID_SUB_STAGES.includes(entry.stage)) return items;
  // approval-gate activation
  if (entry.stage === "active" && !entry.approvedAt) return items;
  const dedup = items.filter(s => s.id !== entry.id);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(s => Date.now() - (s.ts || 0) < TTL_7D)
    .slice(0, MAX_SUB);
}

function _subScore(items) {
  if (!items.length) return 100;
  const pastDue  = items.filter(s => s.stage === "past_due").length;
  const canceled = items.filter(s => s.stage === "canceled").length;
  if (pastDue > 3 || canceled > items.length * 0.3) return 55;
  if (pastDue > 1) return 75;
  return 100;
}

// ── Phase 1457: Creator revenue ───────────────────────────────────────────────

function _loadCreator() {
  return _cached(MI_CREATOR_KEY, () =>
    _load(MI_CREATOR_KEY, []).filter(c => Date.now() - (c.ts || 0) < TTL_7D)
  );
}

function _addCreator(items, entry) {
  if (!entry.creatorId || !entry.type || entry.userInput || entry.rawContent) return items;
  // approval-gate payouts
  if (entry.type === "payout" && !entry.approvedAt) return items;
  // 5min dedup per creatorId+type
  const key = `${entry.creatorId}:${entry.type}`;
  const recent = items.find(c => `${c.creatorId}:${c.type}` === key && Date.now() - (c.ts || 0) < 5 * 60 * 1000);
  if (recent) return items;
  return [{ ...entry, ts: Date.now() }, ...items]
    .filter(c => Date.now() - (c.ts || 0) < TTL_7D)
    .slice(0, MAX_CREATOR);
}

function _creatorScore(items) {
  if (!items.length) return 100;
  const recent = items.filter(c => Date.now() - (c.ts || 0) < TTL_24H);
  if (!recent.length) return 100;
  const sum = recent.reduce((acc, c) => acc + (c.score ?? 100), 0);
  return Math.round(sum / recent.length);
}

// ── Phase 1458: Marketplace transactions ─────────────────────────────────────

const VALID_TXN_TYPES = ["purchase", "refund", "trial_conversion", "upgrade", "downgrade", "addon"];

function _loadTxns() {
  return _cached(MI_TXN_KEY, () =>
    _load(MI_TXN_KEY, []).filter(t => Date.now() - (t.ts || 0) < TTL_7D)
  );
}

function _addTxn(items, entry) {
  if (!entry.id || !VALID_TXN_TYPES.includes(entry.type)) return items;
  if (entry.userInput || entry.rawContent || entry.cardNumber || entry.cvv) return items;
  // 30s dedup per id
  const recent = items.find(t => t.id === entry.id && Date.now() - (t.ts || 0) < 30_000);
  if (recent) return items;
  return [{ ...entry, ts: Date.now() }, ...items.filter(t => t.id !== entry.id)]
    .filter(t => Date.now() - (t.ts || 0) < TTL_7D)
    .slice(0, MAX_TXN);
}

function _txnScore(items) {
  if (!items.length) return 100;
  const recent  = items.filter(t => Date.now() - (t.ts || 0) < TTL_24H);
  if (!recent.length) return 100;
  const refunds = recent.filter(t => t.type === "refund").length;
  if (refunds > recent.length * 0.3) return 55;
  if (refunds > 2) return 75;
  return 100;
}

// ── Phase 1459: Billing excellence ───────────────────────────────────────────

const VALID_BILLING_STAGES = ["pending", "processing", "succeeded", "failed", "refunded"];

function _loadBilling() {
  return _cached(MI_BILLING_KEY, () =>
    _load(MI_BILLING_KEY, []).filter(b => Date.now() - (b.ts || 0) < TTL_24H)
  );
}

function _addBilling(items, entry) {
  if (!entry.id || !entry.orgId || !VALID_BILLING_STAGES.includes(entry.stage)) return items;
  if (entry.cardNumber || entry.cvv || entry.rawPayload) return items;
  const dedup = items.filter(b => b.id !== entry.id);
  return [{ ...entry, ts: Date.now() }, ...dedup]
    .filter(b => Date.now() - (b.ts || 0) < TTL_24H)
    .slice(0, MAX_BILLING);
}

function _billingScore(items) {
  if (!items.length) return 100;
  const failed = items.filter(b => b.stage === "failed").length;
  if (failed > 3) return 50;
  if (failed > 1) return 70;
  return 100;
}

// ── Phase 1460: Business intelligence ────────────────────────────────────────

function _loadBizIntel() {
  return _cached(MI_BIZ_KEY, () =>
    _load(MI_BIZ_KEY, []).filter(b => Date.now() - (b.ts || 0) < TTL_24H)
  );
}

function _addBizIntel(items, entry) {
  if (!entry.type || !entry.orgId || entry.userInput || entry.rawContent) return items;
  // 5min dedup per type+orgId
  const key = `${entry.type}:${entry.orgId}`;
  const recent = items.find(b => `${b.type}:${b.orgId}` === key && Date.now() - (b.ts || 0) < 5 * 60 * 1000);
  if (recent) return items;
  return [{ ...entry, ts: Date.now() }, ...items]
    .filter(b => Date.now() - (b.ts || 0) < TTL_24H)
    .slice(0, MAX_BIZ);
}

// ── Phase 1461: Ecosystem growth ─────────────────────────────────────────────

function _loadGrowth() {
  return _cached(MI_GROWTH_KEY, () =>
    _load(MI_GROWTH_KEY, []).filter(g => Date.now() - (g.ts || 0) < TTL_7D)
  );
}

function _addGrowth(items, entry) {
  if (!entry.type || !entry.orgId || entry.userInput || entry.rawContent) return items;
  // 2min dedup per type+orgId; anti-recursive burst guard
  const key = `${entry.type}:${entry.orgId}`;
  const burst = items.filter(g => `${g.type}:${g.orgId}` === key && Date.now() - (g.ts || 0) < 10 * 1000);
  if (burst.length >= 3) return items;
  const recent = items.find(g => `${g.type}:${g.orgId}` === key && Date.now() - (g.ts || 0) < 2 * 60 * 1000);
  if (recent) return items;
  return [{ ...entry, ts: Date.now() }, ...items]
    .filter(g => Date.now() - (g.ts || 0) < TTL_7D)
    .slice(0, MAX_GROWTH);
}

function _growthScore(items) {
  if (!items.length) return 100;
  const recent = items.filter(g => Date.now() - (g.ts || 0) < TTL_24H);
  if (!recent.length) return 100;
  const sum = recent.reduce((acc, g) => acc + (g.score ?? 100), 0);
  return Math.round(sum / recent.length);
}

// ── Phase 1462: Revenue survivability ────────────────────────────────────────

function _loadRevSurv() {
  return _cached(MI_SURV_KEY, () =>
    _load(MI_SURV_KEY, []).filter(r => Date.now() - (r.ts || 0) < TTL_7D)
  );
}

function _addRevSurv(items, entry) {
  if (!entry.type || entry.userInput || entry.rawContent) return items;
  // 2min dedup per type+orgId
  const key = `${entry.type}:${entry.orgId || ""}`;
  const recent = items.find(r => `${r.type}:${r.orgId || ""}` === key && Date.now() - (r.ts || 0) < 2 * 60 * 1000);
  if (recent) return items;
  return [{ ...entry, recovered: Boolean(entry.recovered), ts: Date.now() }, ...items]
    .filter(r => Date.now() - (r.ts || 0) < TTL_7D)
    .slice(0, MAX_SURV);
}

function _revSurvScore(items) {
  if (!items.length) return 100;
  const recovered = items.filter(r => r.recovered).length;
  return Math.round(Math.min(100, 60 + (recovered / Math.max(1, items.length)) * 40));
}

// ── Phase 1463: Multi-tenant billing isolation ────────────────────────────────

const MI_PREFIXES = [
  MI_SUB_KEY, MI_CREATOR_KEY, MI_TXN_KEY, MI_BILLING_KEY,
  MI_BIZ_KEY, MI_GROWTH_KEY, MI_SURV_KEY, MI_ISO_KEY, MI_PERF_KEY,
];

function _scanBillingIso() {
  return _cached("_mi_iso_scan", () => {
    const violations = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (MI_PREFIXES.includes(k)) continue;
        if (k.startsWith("jarvis_mi_") && !MI_PREFIXES.includes(k)) {
          violations.push({ key: k, ts: Date.now() });
        }
      }
    } catch {}
    const prev   = _load(MI_ISO_KEY, []);
    const merged = [...violations, ...prev].slice(0, MAX_ISO);
    _save(MI_ISO_KEY, merged);
    return violations;
  });
}

// ── Phase 1464: Perf audit ────────────────────────────────────────────────────

function _runMIPerfAudit() {
  return _cached("_mi_perf_audit", () => {
    const findings = [];

    try {
      const subs = _load(MI_SUB_KEY, []);
      const ids  = subs.map(s => s.id).filter(Boolean);
      const dupes = ids.length - new Set(ids).size;
      if (dupes > 0) findings.push({ id: "sub_duplication", severity: "high", msg: `${dupes} duplicate subscription IDs` });
    } catch {}

    try {
      const txns   = _load(MI_TXN_KEY, []);
      const leaked = txns.filter(t => t.cardNumber || t.cvv || t.rawPayload);
      if (leaked.length > 0) findings.push({ id: "txn_pii_leak", severity: "high", msg: `${leaked.length} transactions with PII` });
    } catch {}

    try {
      const billing = _load(MI_BILLING_KEY, []);
      const failed  = billing.filter(b => b.stage === "failed");
      if (failed.length > 3) findings.push({ id: "billing_failures", severity: "high", msg: `${failed.length} failed billing events` });
    } catch {}

    try {
      const creator = _load(MI_CREATOR_KEY, []);
      const leaked  = creator.filter(c => c.userInput || c.rawContent);
      if (leaked.length > 0) findings.push({ id: "creator_pii_leak", severity: "high", msg: `${leaked.length} creator entries with PII` });
    } catch {}

    try {
      const growth = _load(MI_GROWTH_KEY, []);
      if (growth.length > 18) findings.push({ id: "growth_overflow", severity: "medium", msg: `${growth.length} growth entries` });
    } catch {}

    const score  = findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75;
    const result = { ts: Date.now(), findings, highCount: findings.filter(f => f.severity === "high").length, score };
    _save(MI_PERF_KEY, result);
    return result;
  });
}

// ── Composite scoring ─────────────────────────────────────────────────────────

function _computeMIScore({
  subScore      = 100,
  creatorScore  = 100,
  txnScore      = 100,
  billingScore  = 100,
  growthScore   = 100,
  revSurvScore  = 100,
  perfScore     = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    subScore      * 0.25 +
    billingScore  * 0.20 +
    txnScore      * 0.20 +
    revSurvScore  * 0.15 +
    creatorScore  * 0.10 +
    growthScore   * 0.07 +
    perfScore     * 0.03
  )
  + (billingScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const issue =
    isoViolations > 0  ? `Billing isolation: ${isoViolations} violation${isoViolations > 1 ? "s" : ""}` :
    billingScore < 60  ? `Billing health degraded (${billingScore}%)` :
    subScore < 60      ? `Subscription health degraded (${subScore}%)` :
    txnScore < 60      ? `Marketplace transactions degraded (${txnScore}%)` :
    null;

  return {
    score,
    issue,
    color:   score >= 80 ? "var(--op-green)" : score >= 60 ? "var(--op-amber)" : "var(--op-red)",
    hasCrit: isoViolations > 0 || billingScore < 60,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useMonetizationIntelligence() {
  const [subs,    setSubs]    = useState(() => _loadSubs());
  const [creator, setCreator] = useState(() => _loadCreator());
  const [txns,    setTxns]    = useState(() => _loadTxns());
  const [billing, setBilling] = useState(() => _loadBilling());
  const [biz,     setBiz]     = useState(() => _loadBizIntel());
  const [growth,  setGrowth]  = useState(() => _loadGrowth());
  const [revSurv, setRevSurv] = useState(() => _loadRevSurv());

  // ── Writers ─────────────────────────────────────────────────────────────────

  const addSub = useCallback((entry) => {
    setSubs(prev => {
      const next = _addSub(prev, entry);
      _save(MI_SUB_KEY, next);
      _cache.delete(MI_SUB_KEY);
      return next;
    });
  }, []);

  const addCreatorRevenue = useCallback((entry) => {
    setCreator(prev => {
      const next = _addCreator(prev, entry);
      _save(MI_CREATOR_KEY, next);
      _cache.delete(MI_CREATOR_KEY);
      return next;
    });
  }, []);

  const addTxn = useCallback((entry) => {
    setTxns(prev => {
      const next = _addTxn(prev, entry);
      _save(MI_TXN_KEY, next);
      _cache.delete(MI_TXN_KEY);
      return next;
    });
  }, []);

  const addBilling = useCallback((entry) => {
    setBilling(prev => {
      const next = _addBilling(prev, entry);
      _save(MI_BILLING_KEY, next);
      _cache.delete(MI_BILLING_KEY);
      return next;
    });
  }, []);

  const addBizIntel = useCallback((entry) => {
    setBiz(prev => {
      const next = _addBizIntel(prev, entry);
      _save(MI_BIZ_KEY, next);
      _cache.delete(MI_BIZ_KEY);
      return next;
    });
  }, []);

  const addGrowth = useCallback((entry) => {
    setGrowth(prev => {
      const next = _addGrowth(prev, entry);
      _save(MI_GROWTH_KEY, next);
      _cache.delete(MI_GROWTH_KEY);
      return next;
    });
  }, []);

  const addRevSurv = useCallback((entry) => {
    setRevSurv(prev => {
      const next = _addRevSurv(prev, entry);
      _save(MI_SURV_KEY, next);
      _cache.delete(MI_SURV_KEY);
      return next;
    });
  }, []);

  // ── Derived scores (coarse dep-keys) ─────────────────────────────────────────

  const subScoreVal      = useMemo(() => _subScore(subs),        [Math.floor(subs.length / 2)]);
  const creatorScoreVal  = useMemo(() => _creatorScore(creator),  [Math.floor(creator.length / 2)]);
  const txnScoreVal      = useMemo(() => _txnScore(txns),         [Math.floor(txns.length / 3)]);
  const billingScoreVal  = useMemo(() => _billingScore(billing),  [Math.floor(billing.length / 2)]);
  const growthScoreVal   = useMemo(() => _growthScore(growth),    [Math.floor(growth.length / 2)]);
  const revSurvScoreVal  = useMemo(() => _revSurvScore(revSurv),  [Math.floor(revSurv.length / 3)]);

  const perfAudit = useMemo(() => _runMIPerfAudit(),
    [Math.floor((subs.length + txns.length + billing.length) / 3)]);

  const miIsoViolations = useMemo(() => _scanBillingIso(),
    [Math.floor((subs.length + billing.length) / 3)]);

  // ── Composite bar ────────────────────────────────────────────────────────────

  const miBar = useMemo(() => {
    const result = _computeMIScore({
      subScore:      subScoreVal,
      creatorScore:  creatorScoreVal,
      txnScore:      txnScoreVal,
      billingScore:  billingScoreVal,
      growthScore:   growthScoreVal,
      revSurvScore:  revSurvScoreVal,
      perfScore:     perfAudit.score,
      isoViolations: miIsoViolations.length,
    });
    if (result.score >= 80 && !result.issue) return null;
    return result;
  }, [subScoreVal, creatorScoreVal, txnScoreVal, billingScoreVal,
      growthScoreVal, revSurvScoreVal, perfAudit.score, miIsoViolations.length]);

  return {
    // writers
    addSub, addCreatorRevenue, addTxn, addBilling, addBizIntel, addGrowth, addRevSurv,
    // scores
    miScore:       _computeMIScore({
                     subScore: subScoreVal, creatorScore: creatorScoreVal,
                     txnScore: txnScoreVal, billingScore: billingScoreVal,
                     growthScore: growthScoreVal, revSurvScore: revSurvScoreVal,
                     perfScore: perfAudit.score, isoViolations: miIsoViolations.length,
                   }).score,
    subScore:      subScoreVal,
    creatorScore:  creatorScoreVal,
    txnScore:      txnScoreVal,
    billingScore:  billingScoreVal,
    growthScore:   growthScoreVal,
    revSurvScore:  revSurvScoreVal,
    perfAudit,
    miIsoViolations,
    miBar,
  };
}
