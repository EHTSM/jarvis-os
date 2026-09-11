"use strict";
/**
 * customerHealthEngine.cjs — POST-Ω P11 Autonomous Customer Organization
 *
 * Continuously computes and tracks customer health scores.
 * Aggregates signals from customerSuccess, revenueOS, crmService, analyticsService.
 *
 * Health dimensions:
 *   product_usage      0.30 — feature adoption, session frequency
 *   relationship       0.20 — last contact, support satisfaction
 *   financial          0.20 — payment history, ARR, plan tier
 *   lifecycle_progress 0.15 — journey stage advancement
 *   support_health     0.10 — open tickets, resolution time
 *   engagement         0.05 — NPS, advocacy signals
 *
 * Storage: data/customer-health.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "customer-health.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _rev = () => _try(() => require("./revenueOS.cjs"));
const _cs  = () => _try(() => require("./customerSuccess.cjs"));
const _crm = () => _try(() => require("./crmService.js"));
const _cje = () => _try(() => require("./customerJourneyEngine.cjs"));
const _obi = () => _try(() => require("./businessIntelligenceDashboard.cjs"));

function _ts()     { return new Date().toISOString(); }
function _id()     { return `ch_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }
function _clamp(v) { return Math.min(100, Math.max(0, Math.round(v))); }

const WEIGHTS = {
  product_usage:      0.30,
  relationship:       0.20,
  financial:          0.20,
  lifecycle_progress: 0.15,
  support_health:     0.10,
  engagement:         0.05,
};

const GRADE_THRESHOLDS = { A: 80, B: 65, C: 50, D: 35 };

function _grade(score) {
  if (score >= GRADE_THRESHOLDS.A) return "A";
  if (score >= GRADE_THRESHOLDS.B) return "B";
  if (score >= GRADE_THRESHOLDS.C) return "C";
  if (score >= GRADE_THRESHOLDS.D) return "D";
  return "F";
}

function _riskLevel(score) {
  return score >= 70 ? "low" : score >= 50 ? "medium" : score >= 30 ? "high" : "critical";
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { records: [], history: {}, stats: { total: 0, avgScore: 0, atRisk: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.records.length > 500) d.records = d.records.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Dimension scorers ─────────────────────────────────────────────────────────

function _scoreProductUsage(revHealth, csHealth) {
  const breakdown = revHealth?.breakdown || {};
  const missions  = breakdown.mission_count || 0;
  const features  = breakdown.feature_breadth || 0;
  const csScore   = typeof csHealth === "number" ? csHealth : 0;
  return _clamp(missions * 0.4 + features * 0.4 + csScore * 0.2);
}

function _scoreRelationship(lead, revHealth) {
  const lastInteraction = lead?.lastInteraction;
  if (!lastInteraction) return 40;
  const daysSince = (Date.now() - new Date(lastInteraction).getTime()) / 86400000;
  const recencyScore = daysSince < 1 ? 100 : daysSince < 7 ? 80 : daysSince < 30 ? 60 : daysSince < 90 ? 30 : 10;
  return _clamp(recencyScore);
}

function _scoreFinancial(lead, revHealth) {
  const isPaid = lead?.paymentStatus === "paid" || revHealth?.plan === "pro" || revHealth?.plan === "enterprise";
  const planScore = isPaid ? 80 : 40;
  const breakdown = revHealth?.breakdown || {};
  const loginRecency = breakdown.login_recency || 0;
  return _clamp(planScore * 0.7 + loginRecency * 0.3);
}

function _scoreLifecycleProgress(journey) {
  if (!journey) return 30;
  const idx = journey.stageIndex || 0;
  // 13 stages total — further = better (up to renewal/advocacy)
  const progressPct = (idx / 12) * 100;
  // Penalty for being in retention/recovery
  const penalty = (journey.stage === "retention" || journey.stage === "recovery") ? 20 : 0;
  return _clamp(progressPct - penalty);
}

function _scoreSupportHealth(revHealth) {
  // No live support ticket data yet — derive from risk signals
  const risks = revHealth?.risks || [];
  return _clamp(100 - risks.length * 15);
}

function _scoreEngagement(lead, revHealth) {
  const isOnboarded = lead?.onboardingDone || false;
  const hasNotes    = (revHealth?.notes || []).length > 0;
  return _clamp((isOnboarded ? 60 : 20) + (hasNotes ? 20 : 0) + 20);
}

// ── Score customer ────────────────────────────────────────────────────────────

function scoreCustomer(customerId, opts = {}) {
  const revHealth = _try(() => _rev()?.getCustomerHealth?.(customerId)) || null;
  const journey   = _try(() => _cje()?.getJourney?.(customerId)) || null;
  const leads     = _try(() => _crm()?.getLeads?.()) || [];
  // Customer-Reachable API / Data-Access Boundary Audit (2026-08-21): this
  // used to match `(l.userId || l.phone || l.chatId) === customerId`, which
  // only ever compares customerId against whichever field is truthy FIRST
  // per lead, not against all three. Every real lead created through the
  // actual product route (POST /crm/lead) carries a real userId (the
  // authenticated caller's own account id) alongside its phone — so any
  // scoreCustomer(phone) call for a real customer silently failed to match
  // its own lead, leaving orgId permanently null. That, in turn, made the
  // cross-tenant ownership check this same audit added to the health/score
  // route (comparing the record's stored orgId against the caller's real
  // orgId) reject the LEGITIMATE owner too, since null never equals a real
  // orgId. Live-reproduced against a real /crm/lead-created lead. Fixed by
  // matching customerId against each candidate field independently.
  const lead      = leads.find(l => l.userId === customerId || l.phone === customerId || l.chatId === customerId) || null;
  const csHealth  = _try(() => _cs()?.computeHealth?.({ accountId: customerId, signals: {} }));

  const dims = {
    product_usage:      _scoreProductUsage(revHealth, csHealth),
    relationship:       _scoreRelationship(lead, revHealth),
    financial:          _scoreFinancial(lead, revHealth),
    lifecycle_progress: _scoreLifecycleProgress(journey),
    support_health:     _scoreSupportHealth(revHealth),
    engagement:         _scoreEngagement(lead, revHealth),
  };

  const overall = _clamp(
    Object.entries(WEIGHTS).reduce((sum, [k, w]) => sum + (dims[k] * w), 0)
  );

  const grade    = _grade(overall);
  const risk     = _riskLevel(overall);
  const alerts   = [];

  if (dims.product_usage < 30)      alerts.push({ severity: "high",   code: "low_usage",       msg: "Very low product usage — intervention needed" });
  if (dims.relationship < 30)       alerts.push({ severity: "high",   code: "dark",             msg: "Customer has gone dark — no recent contact" });
  if (dims.financial < 40)          alerts.push({ severity: "medium", code: "payment_risk",     msg: "Payment or plan tier concern" });
  if (dims.lifecycle_progress < 25) alerts.push({ severity: "medium", code: "stuck_in_stage",   msg: "Customer stuck early in lifecycle" });
  if (dims.support_health < 30)     alerts.push({ severity: "high",   code: "support_issues",   msg: "Multiple risk signals from customer success" });

  const id    = _id();
  // Cross-tenant fix — same class as customerSupportEngine.cjs's ticket fix
  // and customerJourneyEngine.cjs's journey fix: health records carried no
  // orgId, so listHealthRecords() returned every organization's customer
  // health scores to every caller. Reproduced live: two real orgs each
  // received the identical health-record list, same customerIds. Inherit
  // orgId from the matching CRM lead where one exists (leads already carry a
  // real orgId — see crmService.js); null for customers with no CRM lead,
  // matching the null-orgId convention used throughout this fix family.
  const entry = { id, customerId, orgId: lead?.orgId || null, overall, grade, risk, dimensions: dims, alerts, journey: journey?.stage || null, scoredAt: _ts() };

  const d = _load();
  const existing = d.records.findIndex(r => r.customerId === customerId);
  if (existing >= 0) d.records[existing] = entry;
  else d.records.push(entry);

  if (!d.history[customerId]) d.history[customerId] = [];
  d.history[customerId].push({ id, overall, grade, scoredAt: entry.scoredAt });
  if (d.history[customerId].length > 30) d.history[customerId] = d.history[customerId].slice(-30);

  const all    = d.records.map(r => r.overall);
  const atRisk = d.records.filter(r => r.risk === "high" || r.risk === "critical").length;
  d.stats = { total: d.records.length, avgScore: +(all.reduce((a,b)=>a+b,0)/all.length).toFixed(1), atRisk };
  _save(d);

  return { ok: true, health: entry };
}

function scoreAll() {
  // Score from revenueOS health list (most comprehensive source)
  const healthList = _try(() => _rev()?.listCustomerHealth?.({ limit: 500 })) || [];
  const scored = [];
  healthList.forEach(h => {
    const r = scoreCustomer(h.accountId);
    if (r.ok) scored.push(r.health);
  });
  // Also score CRM leads not in healthList
  const leads   = _try(() => _crm()?.getLeads?.()) || [];
  const done    = new Set(scored.map(s => s.customerId));
  leads.forEach(l => {
    const cid = l.userId || l.phone || l.chatId;
    if (cid && !done.has(cid)) {
      const r = scoreCustomer(cid);
      if (r.ok) scored.push(r.health);
    }
  });
  return { ok: true, scored: scored.length, atRisk: scored.filter(s => s.risk === "high" || s.risk === "critical").length };
}

function getHealthRecord(customerId, orgId = null) {
  const r = _load().records.find(x => x.customerId === customerId);
  if (!r) return null;
  if (orgId && (r.orgId || null) !== orgId) return null;
  return r;
}

function listHealthRecords({ risk, grade, limit = 50, orgId = null } = {}) {
  let list = _load().records;
  // Same scoping rule as customerJourneyEngine.listJourneys() — legacy
  // null-orgId records are excluded from a scoped call, not misattributed.
  if (orgId) list = list.filter(r => r.orgId === orgId);
  if (risk)  list = list.filter(r => r.risk === risk);
  if (grade) list = list.filter(r => r.grade === grade);
  list.sort((a, b) => a.overall - b.overall); // worst first
  return { ok: true, records: list.slice(0, limit) };
}

// Customer-Reachable API / Data-Access Boundary Audit (2026-08-21): orgId is
// OPTIONAL, same convention as getHealthRecord() above — when supplied, the
// customer's current record must belong to that org or the call returns
// nothing/an error, exactly like getHealthRecord()'s own check. Previously
// had no orgId parameter, so any authenticated customer could read another
// org's real customer health history/trend by customerId — live-reproduced.
function getHealthHistory(customerId, limit = 10, orgId = null) {
  if (orgId) {
    const rec = getHealthRecord(customerId, orgId);
    if (!rec) return { ok: false, error: "health record not found" };
  }
  const d = _load();
  const hist = (d.history[customerId] || []).slice(-limit);
  return { ok: true, customerId, history: hist };
}

function getHealthTrend(customerId, orgId = null) {
  if (orgId) {
    const rec = getHealthRecord(customerId, orgId);
    if (!rec) return { ok: false, error: "health record not found" };
  }
  const d    = _load();
  const hist = (d.history[customerId] || []).slice(-5);
  if (hist.length < 2) return { ok: false, error: "insufficient history" };
  const delta = hist[hist.length-1].overall - hist[0].overall;
  return { ok: true, customerId, direction: delta > 3 ? "improving" : delta < -3 ? "declining" : "stable", delta: +delta.toFixed(1) };
}

function getStats() { return { ...(_load().stats), WEIGHTS, updatedAt: _load().updatedAt }; }

module.exports = { WEIGHTS, scoreCustomer, scoreAll, getHealthRecord, listHealthRecords, getHealthHistory, getHealthTrend, getStats };
