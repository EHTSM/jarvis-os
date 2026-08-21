"use strict";
/**
 * customerJourneyEngine.cjs — POST-Ω P11 Autonomous Customer Organization
 *
 * Tracks every customer automatically through the full lifecycle.
 * Reads live data from crmService, revenueOS, customerSuccess, analyticsService.
 *
 * Lifecycle stages:
 *   lead → qualification → demo → proposal → closing →
 *   onboarding → activation → adoption → expansion →
 *   renewal → advocacy → retention → recovery
 *
 * Storage: data/customer-journeys.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "customer-journeys.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _crm = () => _try(() => require("./crmService.js"));
const _rev = () => _try(() => require("./revenueOS.cjs"));
const _cs  = () => _try(() => require("./customerSuccess.cjs"));
const _ana = () => _try(() => require("./analyticsService.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `cj_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const LIFECYCLE_STAGES = [
  "lead","qualification","demo","proposal","closing",
  "onboarding","activation","adoption","expansion",
  "renewal","advocacy","retention","recovery",
];

// CRM status → lifecycle stage mapping
const STATUS_TO_STAGE = {
  new:        "lead",
  hot:        "qualification",
  paid:       "onboarding",
  onboarded:  "adoption",
  churned:    "recovery",
  cancelled:  "recovery",
  trial:      "qualification",
  trialing:   "qualification",
  active:     "adoption",
  at_risk:    "retention",
};

// Revenue OS health grade → stage refinement
function _gradeToStage(grade, baseStage) {
  if (baseStage === "adoption" || baseStage === "onboarding") {
    if (grade === "A" || grade === "B") return "expansion";
    if (grade === "D" || grade === "F") return "retention";
  }
  return baseStage;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { journeys: [], stats: { total: 0, byStage: {}, avgDaysInStage: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.journeys.length > 500) d.journeys = d.journeys.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Core functions ────────────────────────────────────────────────────────────

function _buildJourney(lead, healthRecord) {
  const status  = lead.status || "new";
  const base    = STATUS_TO_STAGE[status] || "lead";
  const grade   = healthRecord?.grade || null;
  const stage   = grade ? _gradeToStage(grade, base) : base;
  const stageIdx= LIFECYCLE_STAGES.indexOf(stage);

  const completedStages = LIFECYCLE_STAGES.slice(0, stageIdx);
  const nextStage       = LIFECYCLE_STAGES[stageIdx + 1] || null;

  const daysInCRM = lead.createdAt
    ? Math.round((Date.now() - new Date(lead.createdAt).getTime()) / 86400000)
    : 0;

  const churnSignals = healthRecord?.risks || [];
  const healthScore  = healthRecord?.healthScore || 0;
  const churnRisk    = healthScore < 30 ? "critical" : healthScore < 50 ? "high" : healthScore < 70 ? "medium" : "low";

  return {
    customerId:      lead.userId || lead.phone || lead.chatId || `unknown_${Date.now()}`,
    // B.21-class cross-tenant fix (same pattern already applied to
    // customerSupportEngine.cjs's tickets): journeys carried no orgId at all,
    // so listJourneys() returned every organization's customer journeys to
    // every caller — reproduced live: two real orgs each received the
    // identical 68-journey list, including the same customerId per org.
    // crmService leads already carry a real orgId (see crmService.js); this
    // propagates it through so journeys can finally be scoped the same way
    // tickets already are. null for legacy/direct-signup records exactly as
    // crmService's own null-orgId leads behave.
    orgId:           lead.orgId || null,
    name:            lead.name || "Unknown",
    phone:           lead.phone || null,
    status,
    stage,
    stageIndex:      stageIdx,
    nextStage,
    completedStages,
    remainingStages: LIFECYCLE_STAGES.slice(stageIdx + 1),
    daysInCRM,
    healthScore,
    healthGrade:     grade,
    churnRisk,
    churnSignals,
    plan:            lead.paymentStatus || healthRecord?.plan || "unknown",
    renewalDate:     healthRecord?.renewalDate || null,
    activePlaybook:  healthRecord?.activePlaybook || null,
    revenue:         lead.paymentStatus === "paid" ? (lead.amount || 0) : 0,
    updatedAt:       _ts(),
  };
}

function syncJourneys() {
  const leads      = _try(() => _crm()?.getLeads?.()) || [];
  const healthList = _try(() => _rev()?.listCustomerHealth?.({ limit: 500 })) || [];
  const healthMap  = new Map(healthList.map(h => [h.accountId, h]));

  const journeys = leads.map(lead => {
    const acctId = lead.userId || lead.chatId || lead.phone;
    const health = healthMap.get(acctId) || null;
    return _buildJourney(lead, health);
  });

  // Also include health records that have no CRM lead (direct signups)
  healthList.forEach(h => {
    const exists = journeys.find(j => j.customerId === h.accountId);
    if (!exists) {
      journeys.push(_buildJourney(
        { userId: h.accountId, status: h.status || "trialing", paymentStatus: h.plan },
        h
      ));
    }
  });

  const byStage = {};
  LIFECYCLE_STAGES.forEach(s => { byStage[s] = 0; });
  journeys.forEach(j => { byStage[j.stage] = (byStage[j.stage] || 0) + 1; });

  const d = _load();
  // Merge: update existing, append new
  journeys.forEach(j => {
    const idx = d.journeys.findIndex(x => x.customerId === j.customerId);
    if (idx >= 0) d.journeys[idx] = { ...d.journeys[idx], ...j };
    else d.journeys.push({ id: _id(), ...j });
  });
  d.stats = { total: d.journeys.length, byStage, avgDaysInStage: 0 };
  _save(d);

  return { ok: true, synced: journeys.length, byStage };
}

function getJourney(customerId, orgId = null) {
  const j = _load().journeys.find(x => x.customerId === customerId);
  if (!j) return null;
  // Same scoping rule as listJourneys() below — see its comment.
  if (orgId && (j.orgId || null) !== orgId) return null;
  return j;
}

function listJourneys({ stage, churnRisk, limit = 50, orgId = null } = {}) {
  let list = _load().journeys;
  // Cross-tenant fix — see the orgId comment on _buildJourney() above.
  // Legacy rows with no orgId are EXCLUDED from a scoped call rather than
  // attributed to whoever asks, matching customerSupportEngine.listTickets().
  // An unscoped call (orgId omitted) keeps prior behaviour for internal
  // callers such as stats aggregation.
  if (orgId) list = list.filter(j => j.orgId === orgId);
  // `if (stage) list = list.filter(j => j.stage === churnRisk ? true : j.stage === stage)`
  // previously compared a string (j.stage) to a boolean (churnRisk-derived
  // ternary) whenever churnRisk was falsy — always false, so any call with
  // `stage` set and no `churnRisk` silently emptied the list before the
  // correct filter on the next line ever ran. The `stage && !churnRisk`
  // branch below was unreachable dead code protecting against a case this
  // line had already destroyed. Filter on stage and churnRisk independently.
  if (stage)     list = list.filter(j => j.stage === stage);
  if (churnRisk) list = list.filter(j => j.churnRisk === churnRisk);
  return { ok: true, journeys: list.slice(0, limit), total: list.length };
}

function getStageDistribution() {
  const d       = _load();
  const byStage = {};
  LIFECYCLE_STAGES.forEach(s => { byStage[s] = 0; });
  d.journeys.forEach(j => { byStage[j.stage] = (byStage[j.stage] || 0) + 1; });
  return { ok: true, stages: byStage, total: d.journeys.length };
}

// Customer-Reachable API / Data-Access Boundary Audit (2026-08-21): orgId is
// OPTIONAL, same convention as getJourney()/listJourneys() above — when
// supplied, the target journey's own orgId must match or the call is
// rejected, exactly like getJourney()'s existing check. Previously had no
// orgId parameter at all, so any authenticated customer (verified as a
// member of *some* org by customerOrg.js's router-level requireOrgMember)
// could advance a foreign org's customer lifecycle stage — live-reproduced.
function advanceStage(customerId, toStage, orgId = null) {
  if (!LIFECYCLE_STAGES.includes(toStage)) return { ok: false, error: `invalid stage: ${toStage}` };
  const d   = _load();
  const idx = d.journeys.findIndex(j => j.customerId === customerId);
  if (idx < 0) return { ok: false, error: "journey not found" };
  const j = d.journeys[idx];
  if (orgId && (j.orgId || null) !== orgId) return { ok: false, error: "journey not found" };
  const prevStage = j.stage;
  j.stage      = toStage;
  j.stageIndex = LIFECYCLE_STAGES.indexOf(toStage);
  j.nextStage  = LIFECYCLE_STAGES[j.stageIndex + 1] || null;
  j.completedStages = LIFECYCLE_STAGES.slice(0, j.stageIndex);
  j.updatedAt  = _ts();
  _save(d);
  return { ok: true, customerId, prevStage, newStage: toStage };
}

function getStats() {
  const d = _load();
  const churnRisks = { critical: 0, high: 0, medium: 0, low: 0 };
  d.journeys.forEach(j => { churnRisks[j.churnRisk] = (churnRisks[j.churnRisk] || 0) + 1; });

  // Phase B.16: this spread the stored d.stats, whose byStage was computed by
  // syncJourneys() from the *pre-merge* lead list. Because customerId prefers
  // lead.userId, several leads collapse into one journey (7 customerIds were
  // shared by 2–5 leads each), so byStage counted leads while total counted
  // distinct customers. Reproduced live: total=60 with byStage summing to 71,
  // and the two customer-reporting surfaces disagreed on the same question —
  // getStats said lead=17/qualification=43 while getStageDistribution() said
  // 12/37 from the same store. Recompute from the stored journeys so both
  // agree; getStageDistribution() already did exactly this.
  const byStage = {};
  LIFECYCLE_STAGES.forEach(s => { byStage[s] = 0; });
  d.journeys.forEach(j => { byStage[j.stage] = (byStage[j.stage] || 0) + 1; });

  return { ...d.stats, total: d.journeys.length, byStage, churnRisks, updatedAt: d.updatedAt };
}

module.exports = {
  LIFECYCLE_STAGES,
  STATUS_TO_STAGE,
  syncJourneys,
  getJourney,
  listJourneys,
  getStageDistribution,
  advanceStage,
  getStats,
};
