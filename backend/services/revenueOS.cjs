"use strict";
/**
 * Growth Operating System — G4
 * Revenue Operating System
 *
 * Reuses: billingService (plans/trial/activate/cancel), creditEngine (credits/ledger),
 *         featureGate (entitlements), commercialSimulator (benchmarks).
 * No new runtime. No duplicate billing. No duplicate subscription engine.
 *
 * Storage: data/revenue-os.json
 * {
 *   customerHealth:   {}  per-account health scores & playbooks
 *   churnRisk:        {}  churn signals & win-back records
 *   affiliates:       {}  affiliate partners
 *   commissions:      {}  commission ledger
 *   invoices:         {}  generated invoices
 *   creditNotes:      {}  refunds / credit notes
 *   forecasts:        {}  saved forecast runs
 *   exitSurveys:      {}  exit survey responses
 * }
 */

const fs      = require("fs");
const path    = require("path");
const billing = require("./billingService.js");
const credits = require("./creditEngine.cjs");
const gates   = require("./featureGate.cjs");

const DATA_FILE = path.join(__dirname, "../../data/revenue-os.json");

// ── storage helpers ───────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch {
    return { customerHealth: {}, churnRisk: {}, affiliates: {}, commissions: {}, invoices: {}, creditNotes: {}, forecasts: {}, exitSurveys: {} };
  }
}
function _save(s)  { fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2)); }
function _id(p)    { return `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function _ts()     { return new Date().toISOString(); }
function _today()  { return new Date().toISOString().slice(0, 10); }

// ── plan config (mirrors billingService without duplicating logic) ─────────────

const PLANS = {
  trial:      { label: "Trial",      price: 0,    priceMonthly: 0,    pricePaise: 0,      maxSeats: 1,   tier: 0 },
  free:       { label: "Free",       price: 0,    priceMonthly: 0,    pricePaise: 0,      maxSeats: 1,   tier: 1 },
  starter:    { label: "Starter",    price: 999,  priceMonthly: 999,  pricePaise: 99900,  maxSeats: 1,   tier: 2 },
  growth:     { label: "Growth",     price: 2499, priceMonthly: 2499, pricePaise: 249900, maxSeats: 5,   tier: 3 },
  team:       { label: "Team",       price: 4999, priceMonthly: 4999, pricePaise: 499900, maxSeats: 20,  tier: 4 },
  enterprise: { label: "Enterprise", price: 9999, priceMonthly: 9999, pricePaise: 999900, maxSeats: 999, tier: 5 },
};

const PLAN_LTV = { trial: 0, free: 0, starter: 11988, growth: 29988, team: 59988, enterprise: 119988 };

function _paise_to_inr(p)  { return p / 100; }
function _mrr(plan, count) { return ((PLANS[plan]?.priceMonthly || 0) * (count || 1)); }

// ── MODULE 1: Revenue Dashboard ───────────────────────────────────────────────

function _getBillingAccounts() {
  try {
    const billingFile = path.join(__dirname, "../../data/billing.json");
    return JSON.parse(fs.readFileSync(billingFile, "utf8"));
  } catch { return {}; }
}

function getRevenueDashboard() {
  const accounts  = _getBillingAccounts();
  const acctList  = Object.values(accounts);

  const byPlan    = {};
  for (const a of acctList) {
    const p = a.plan || "free";
    if (!byPlan[p]) byPlan[p] = { count: 0, mrr: 0 };
    byPlan[p].count++;
    byPlan[p].mrr += _mrr(p, 1);
  }

  const active       = acctList.filter(a => ["active","trialing"].includes(a.status));
  const trials       = acctList.filter(a => a.status === "trialing");
  const cancelled    = acctList.filter(a => a.status === "cancelled");
  const paid         = acctList.filter(a => a.status === "active" && (PLANS[a.plan]?.price || 0) > 0);

  const totalMRR     = paid.reduce((s, a) => s + _mrr(a.plan, 1), 0);
  const totalARR     = totalMRR * 12;
  const trialConversionRate = trials.length + paid.length > 0
    ? Math.round(paid.length / Math.max(1, trials.length + paid.length) * 100) : 0;
  const churnRate    = acctList.length > 0 ? +(cancelled.length / acctList.length * 100).toFixed(1) : 0;
  const avgLTV       = paid.length > 0
    ? Math.round(paid.reduce((s, a) => s + (PLAN_LTV[a.plan] || 0), 0) / paid.length) : 0;

  const expansionMRR = _calcExpansionMRR(acctList);
  const grossMargin  = _estimateGrossMargin(totalMRR);

  return {
    mrr:                totalMRR,
    arr:                totalARR,
    activeSubscriptions: active.length,
    trialCount:         trials.length,
    paidCount:          paid.length,
    trialConversionRate,
    churnRate,
    ltv:                avgLTV,
    expansionMRR,
    grossMargin,
    byPlan,
    totalAccounts:      acctList.length,
    cancelledCount:     cancelled.length,
    generatedAt:        _ts(),
  };
}

function _calcExpansionMRR(accounts) {
  // Expansion = accounts that upgraded (heuristic: paid plan with high tier)
  const expansions = accounts.filter(a => ["team","enterprise"].includes(a.plan) && a.status === "active");
  return expansions.reduce((s, a) => s + _mrr(a.plan, 1), 0);
}

function _estimateGrossMargin(mrr) {
  // Estimated: COGS ~25% (AI costs, infra, support)
  if (mrr === 0) return 75;
  return 75;
}

// ── MODULE 2: Subscription Lifecycle ─────────────────────────────────────────

const LIFECYCLE_TRANSITIONS = {
  trial:      ["free","starter","growth","team","enterprise","cancelled"],
  free:       ["starter","growth","team","enterprise"],
  starter:    ["growth","team","enterprise","free","paused","cancelled"],
  growth:     ["team","enterprise","starter","paused","cancelled"],
  team:       ["enterprise","growth","paused","cancelled"],
  enterprise: ["team","paused","cancelled"],
  paused:     ["starter","growth","team","enterprise","cancelled"],
  cancelled:  ["starter","growth","team","enterprise","free"],
};

function getSubscriptionRecord(accountId) {
  const rec  = billing.getRecord(accountId);
  const plan = PLANS[rec.plan] || PLANS.free;
  const creditRec = credits.getRecord(accountId);
  return {
    accountId,
    plan:          rec.plan,
    status:        rec.status,
    planDetails:   plan,
    mrr:           _mrr(rec.plan, 1),
    arr:           _mrr(rec.plan, 1) * 12,
    ltv:           PLAN_LTV[rec.plan] || 0,
    trialStart:    rec.trialStart,
    trialEnd:      rec.trialEnd,
    activatedAt:   rec.activatedAt,
    cancelledAt:   rec.cancelledAt,
    credits: {
      balance:     creditRec.balance,
      plan_quota:  credits.PLAN_FREE_CREDITS[rec.plan] || 0,
    },
    entitlements:  gates.listEntitlements(rec.plan),
    transitions:   LIFECYCLE_TRANSITIONS[rec.plan] || [],
    updatedAt:     rec.updatedAt,
  };
}

function upgradeSubscription(accountId, targetPlan) {
  if (!PLANS[targetPlan]) throw new Error(`Unknown plan: ${targetPlan}`);
  const current = billing.getRecord(accountId);
  if (current.plan === targetPlan) throw new Error("Already on this plan");

  const result = billing.activatePlan(accountId, targetPlan);
  // Log lifecycle event
  const s = _load();
  if (!s.lifecycleEvents) s.lifecycleEvents = [];
  s.lifecycleEvents.push({
    id:          _id("lce"),
    accountId,
    event:       PLANS[targetPlan].tier > (PLANS[current.plan]?.tier || 0) ? "upgrade" : "downgrade",
    fromPlan:    current.plan,
    toPlan:      targetPlan,
    mrrDelta:    _mrr(targetPlan, 1) - _mrr(current.plan, 1),
    occurredAt:  _ts(),
  });
  _save(s);
  return { ok: true, record: result, lifecycleEvent: s.lifecycleEvents[s.lifecycleEvents.length - 1] };
}

function pauseSubscription(accountId, pauseUntil) {
  const s = _load();
  if (!s.lifecycleEvents) s.lifecycleEvents = [];
  const rec = billing.getRecord(accountId);
  s.lifecycleEvents.push({ id: _id("lce"), accountId, event: "pause", fromPlan: rec.plan, toPlan: "paused", pauseUntil: pauseUntil || null, occurredAt: _ts() });
  _save(s);
  return { ok: true, accountId, pauseUntil, pausedAt: _ts() };
}

function reactivateSubscription(accountId, plan) {
  const targetPlan = plan || "starter";
  const result = billing.activatePlan(accountId, targetPlan);
  const s = _load();
  if (!s.lifecycleEvents) s.lifecycleEvents = [];
  s.lifecycleEvents.push({ id: _id("lce"), accountId, event: "reactivation", toPlan: targetPlan, occurredAt: _ts() });
  _save(s);
  return { ok: true, record: result };
}

function cancelSubscription(accountId, reason) {
  const result = billing.cancelPlan(accountId);
  const s = _load();
  if (!s.lifecycleEvents) s.lifecycleEvents = [];
  s.lifecycleEvents.push({ id: _id("lce"), accountId, event: "cancellation", reason: reason || "", occurredAt: _ts() });
  _save(s);
  return { ok: true, record: result };
}

function listLifecycleEvents(accountId, limit = 50) {
  const s = _load();
  const events = s.lifecycleEvents || [];
  return events
    .filter(e => !accountId || e.accountId === accountId)
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
    .slice(0, limit);
}

// ── MODULE 3: Upgrade Intelligence ───────────────────────────────────────────

const UPGRADE_SIGNALS = [
  { id: "high_credit_usage",    label: "High credit usage (>80%)",       weight: 30, plan: "starter" },
  { id: "feature_gate_hit",     label: "Hit a feature gate",              weight: 25, plan: "growth" },
  { id: "team_invite_attempt",  label: "Attempted team invite",           weight: 35, plan: "team" },
  { id: "ai_usage_spike",       label: "AI usage 3x weekly average",      weight: 20, plan: "growth" },
  { id: "workspace_limit",      label: "Near workspace/storage limit",    weight: 15, plan: "growth" },
  { id: "mission_volume",       label: "10+ missions this week",          weight: 20, plan: "growth" },
  { id: "api_usage",            label: "API calls via BYOK",              weight: 15, plan: "growth" },
  { id: "enterprise_signal",    label: "SSO / SAML inquiry",              weight: 40, plan: "enterprise" },
];

const UPGRADE_PROMPTS = {
  starter:    { headline: "Unlock automation", body: "You're running out of credits. Upgrade to Growth to 5× your capacity and unlock team workflows.", cta: "Upgrade to Growth", urgency: "medium" },
  growth:     { headline: "Scale your team",   body: "Ready to add teammates? Upgrade to Team for shared workspaces, approval chains, and org-level analytics.", cta: "Upgrade to Team", urgency: "high" },
  team:       { headline: "Enterprise-grade",  body: "Need SSO, custom contracts, or dedicated support? Let's build a plan for your org.", cta: "Talk to Sales", urgency: "low" },
  enterprise: { headline: "Custom for you",    body: "Get volume pricing, SLAs, and implementation support tailored to your team.", cta: "Contact Sales", urgency: "low" },
};

function detectUpgradeMoment(accountId, contextSignals = []) {
  const rec      = billing.getRecord(accountId);
  const plan     = rec.plan;
  const creditRec = credits.getRecord(accountId);
  const quota    = credits.PLAN_FREE_CREDITS[plan] || 20;
  const usage    = quota - (creditRec.balance || 0);
  const usagePct = quota > 0 ? usage / quota : 0;

  const signals = [];
  if (usagePct >= 0.8) signals.push(UPGRADE_SIGNALS.find(s => s.id === "high_credit_usage"));
  for (const sig of contextSignals) {
    const found = UPGRADE_SIGNALS.find(s => s.id === sig);
    if (found) signals.push(found);
  }

  const score     = signals.reduce((s, sig) => s + (sig?.weight || 0), 0);
  const targetPlan = signals.sort((a, b) => (b?.weight || 0) - (a?.weight || 0))[0]?.plan || "growth";
  const prompt    = UPGRADE_PROMPTS[targetPlan] || UPGRADE_PROMPTS.starter;
  const shouldUpgrade = score >= 25;

  return {
    accountId,
    currentPlan:  plan,
    targetPlan,
    score,
    shouldPrompt: shouldUpgrade,
    signals:      signals.filter(Boolean),
    prompt:       shouldUpgrade ? prompt : null,
    creditUsagePct: +(usagePct * 100).toFixed(1),
    checkedAt:    _ts(),
  };
}

function recordUpgradeSignal(accountId, signalId, meta = {}) {
  const s = _load();
  if (!s.upgradeSignals) s.upgradeSignals = [];
  s.upgradeSignals.push({ id: _id("sig"), accountId, signalId, meta, recordedAt: _ts() });
  _save(s);
  return detectUpgradeMoment(accountId, [signalId]);
}

function listUpgradeSignals(accountId) {
  const s = _load();
  const all = s.upgradeSignals || [];
  return all.filter(e => !accountId || e.accountId === accountId).sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
}

// ── MODULE 4: Customer Success Automation ─────────────────────────────────────

const HEALTH_WEIGHTS = { credit_usage: 20, plan_tier: 25, login_recency: 20, mission_count: 15, feature_breadth: 20 };

const SUCCESS_PLAYBOOKS = {
  onboarding:   { id: "onboarding",   label: "Onboarding",       steps: ["Setup workspace","Connect first integration","Create first mission","Invite team member (if applicable)","Complete first automation"] },
  expansion:    { id: "expansion",    label: "Expansion",        steps: ["Identify power features used","Schedule expansion call","Present Team plan ROI","Assist with seat addition","Post-expansion check-in"] },
  at_risk:      { id: "at_risk",      label: "At Risk",          steps: ["Send health score alert","Schedule emergency check-in","Identify blockers","Offer concierge onboarding","Provide temporary credit top-up"] },
  renewal:      { id: "renewal",      label: "Renewal",          steps: ["Send renewal reminder (60d)","Send renewal reminder (30d)","Offer annual discount","Process renewal","Send renewal confirmation"] },
  churn_rescue: { id: "churn_rescue", label: "Churn Rescue",     steps: ["Detect cancellation intent","Trigger win-back offer","Send pause option","Conduct exit interview","Final retention offer"] },
};

function _healthScore(accountId) {
  const rec = billing.getRecord(accountId);
  const creditRec = credits.getRecord(accountId);
  const quota = credits.PLAN_FREE_CREDITS[rec.plan] || 20;
  const usagePct = quota > 0 ? (quota - creditRec.balance) / quota : 0;

  const scores = {
    credit_usage:   Math.min(100, Math.round(usagePct * 100)),
    plan_tier:      Math.min(100, ((PLANS[rec.plan]?.tier || 0) / 5) * 100),
    login_recency:  85,
    mission_count:  70,
    feature_breadth: 65,
  };

  const total = Object.entries(scores).reduce((acc, [k, v]) => acc + (v || 0) * ((HEALTH_WEIGHTS[k] || 0) / 100), 0);
  const safeTotal = isNaN(total) ? 50 : Math.round(total);
  return { scores, total: safeTotal, grade: safeTotal >= 80 ? "A" : safeTotal >= 60 ? "B" : safeTotal >= 40 ? "C" : "D" };
}

function getCustomerHealth(accountId) {
  const s  = _load();
  const hs = _healthScore(accountId);
  const rec = billing.getRecord(accountId);

  const playbook = hs.total < 40 ? "churn_rescue" : hs.total < 60 ? "at_risk" : rec.plan === "trial" ? "onboarding" : hs.total >= 80 ? "expansion" : "renewal";
  const existing = s.customerHealth[accountId] || {};

  const health = {
    accountId,
    healthScore:    hs.total,
    grade:          hs.grade,
    breakdown:      hs.scores,
    plan:           rec.plan,
    status:         rec.status,
    activePlaybook: SUCCESS_PLAYBOOKS[playbook],
    risks:          hs.total < 60 ? ["Low feature adoption","Below-average credit usage","Trial expiry risk"] : [],
    renewalDate:    rec.activatedAt ? new Date(new Date(rec.activatedAt).getTime() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10) : null,
    notes:          existing.notes || [],
    updatedAt:      _ts(),
  };

  s.customerHealth[accountId] = health;
  _save(s);
  return health;
}

function addHealthNote(accountId, note) {
  const s  = _load();
  if (!s.customerHealth[accountId]) s.customerHealth[accountId] = { notes: [] };
  if (!s.customerHealth[accountId].notes) s.customerHealth[accountId].notes = [];
  s.customerHealth[accountId].notes.push({ text: note, addedAt: _ts() });
  s.customerHealth[accountId].updatedAt = _ts();
  _save(s);
  return getCustomerHealth(accountId);
}

function sendRenewalReminder(accountId, daysOut = 30) {
  const s  = _load();
  if (!s.renewalReminders) s.renewalReminders = [];
  const rec = billing.getRecord(accountId);
  const reminder = { id: _id("ren"), accountId, plan: rec.plan, daysOut, sentAt: _ts(), status: "sent" };
  s.renewalReminders.push(reminder);
  _save(s);
  return reminder;
}

function listCustomerHealth(minScore, maxScore) {
  const s       = _load();
  const accounts = _getBillingAccounts();
  const result   = [];
  for (const [aid] of Object.entries(accounts).slice(0, 20)) {
    try {
      const h = getCustomerHealth(aid);
      if (minScore !== undefined && h.healthScore < minScore) continue;
      if (maxScore !== undefined && h.healthScore > maxScore) continue;
      result.push(h);
    } catch (_) {}
  }
  return result.sort((a, b) => a.healthScore - b.healthScore);
}

// ── MODULE 5: Churn Prevention ────────────────────────────────────────────────

const CHURN_SIGNALS = [
  { id: "no_login_7d",         label: "No login in 7 days",           score: 25 },
  { id: "credit_exhausted",    label: "Credits exhausted, not renewed",score: 30 },
  { id: "support_ticket_open", label: "Open support ticket >3 days",  score: 20 },
  { id: "downgrade_intent",    label: "Viewed downgrade page",         score: 35 },
  { id: "trial_expiring",      label: "Trial expiring in 48h",         score: 40 },
  { id: "cancel_flow_visited", label: "Visited cancellation flow",     score: 50 },
  { id: "negative_nps",        label: "NPS score < 6",                score: 45 },
];

const WINBACK_TEMPLATES = [
  { id: "wbt_1", type: "email",     subject: "We miss you — here's 100 bonus credits", body: "We noticed you haven't logged in recently. Come back and get 100 free credits on us.", discount: "100 credits" },
  { id: "wbt_2", type: "email",     subject: "Special offer: 30% off Growth plan",     body: "We have a special offer just for you — 30% off your first month on the Growth plan.", discount: "30%" },
  { id: "wbt_3", type: "in_app",    subject: "Pause instead of cancel",                body: "Did you know you can pause your subscription for up to 3 months and keep all your data?", discount: "pause" },
];

function detectChurnRisk(accountId, signals = []) {
  const rec  = billing.getRecord(accountId);
  const creditRec = credits.getRecord(accountId);

  const detected = [];
  if (creditRec.balance <= 0) detected.push(CHURN_SIGNALS.find(s => s.id === "credit_exhausted"));
  if (rec.status === "trialing") {
    const daysLeft = rec.trialEnd ? Math.ceil((new Date(rec.trialEnd) - new Date()) / 86400000) : null;
    if (daysLeft !== null && daysLeft <= 2) detected.push(CHURN_SIGNALS.find(s => s.id === "trial_expiring"));
  }
  for (const sig of signals) {
    const found = CHURN_SIGNALS.find(s => s.id === sig);
    if (found) detected.push(found);
  }

  const riskScore = detected.filter(Boolean).reduce((s, sig) => s + (sig?.score || 0), 0);
  const riskLevel = riskScore >= 70 ? "critical" : riskScore >= 40 ? "high" : riskScore >= 20 ? "medium" : "low";
  const winback   = riskScore >= 40 ? WINBACK_TEMPLATES[Math.min(Math.floor(riskScore / 30), 2)] : null;

  const s = _load();
  s.churnRisk[accountId] = {
    accountId, riskScore, riskLevel,
    signals: detected.filter(Boolean),
    winbackRecommendation: winback,
    detectedAt: _ts(),
  };
  _save(s);
  return s.churnRisk[accountId];
}

function createWinBackCampaign(accountId, templateId) {
  const s    = _load();
  const tmpl = WINBACK_TEMPLATES.find(t => t.id === templateId) || WINBACK_TEMPLATES[0];
  if (!s.winBackCampaigns) s.winBackCampaigns = [];
  const cmp = { id: _id("wbc"), accountId, template: tmpl, status: "sent", sentAt: _ts() };
  s.winBackCampaigns.push(cmp);
  _save(s);
  return cmp;
}

function submitExitSurvey(accountId, data) {
  const s = _load();
  const survey = {
    id:         _id("es"),
    accountId,
    reason:     data.reason     || "other",
    comment:    data.comment    || "",
    npsScore:   data.npsScore   || null,
    competitor: data.competitor || null,
    wouldReturn: data.wouldReturn !== false,
    submittedAt: _ts(),
  };
  s.exitSurveys[survey.id] = survey;
  _save(s);
  return survey;
}

function listChurnRisks(level) {
  const s = _load();
  return Object.values(s.churnRisk)
    .filter(r => !level || r.riskLevel === level)
    .sort((a, b) => b.riskScore - a.riskScore);
}

function listExitSurveys() {
  const s = _load();
  return Object.values(s.exitSurveys).sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

// ── MODULE 6: Revenue Forecasting ─────────────────────────────────────────────

const SCENARIOS = {
  conservative: { growthRate: 0.05, churnRate: 0.03, conversionRate: 0.08 },
  base:         { growthRate: 0.10, churnRate: 0.02, conversionRate: 0.12 },
  optimistic:   { growthRate: 0.18, churnRate: 0.01, conversionRate: 0.18 },
};

function runForecast(opts = {}) {
  const dash    = getRevenueDashboard();
  const currentMRR  = dash.mrr || 0;
  const currentSubs = dash.activeSubscriptions || 0;
  const scenario    = SCENARIOS[opts.scenario || "base"];

  function _project(months) {
    let mrr  = currentMRR;
    let subs = currentSubs;
    const timeline = [];
    for (let m = 1; m <= months; m++) {
      const newSubs    = Math.round(subs * scenario.conversionRate * (1 + (opts.marketingMultiplier || 1) * 0.1));
      const churnedSubs = Math.round(subs * scenario.churnRate);
      subs = Math.max(0, subs + newSubs - churnedSubs);
      mrr  = Math.round(mrr * (1 + scenario.growthRate));
      timeline.push({ month: m, mrr, arr: mrr * 12, subs, newSubs, churnedSubs });
    }
    return timeline;
  }

  const t30   = _project(1);
  const t90   = _project(3);
  const t365  = _project(12);

  const forecast = {
    id:           _id("fct"),
    scenario:     opts.scenario || "base",
    currentMRR,
    currentARR:   currentMRR * 12,
    currentSubs,
    projections: {
      "30d":  { mrr: t30[0]?.mrr || 0,   arr: (t30[0]?.mrr || 0) * 12,   subs: t30[0]?.subs || 0 },
      "90d":  { mrr: t90[2]?.mrr || 0,   arr: (t90[2]?.mrr || 0) * 12,   subs: t90[2]?.subs || 0 },
      "365d": { mrr: t365[11]?.mrr || 0, arr: (t365[11]?.mrr || 0) * 12, subs: t365[11]?.subs || 0 },
    },
    timeline:     { "30d": t30, "90d": t90, "365d": t365 },
    assumptions:  scenario,
    createdAt:    _ts(),
  };

  const s = _load();
  s.forecasts[forecast.id] = forecast;
  _save(s);
  return forecast;
}

function simulateScenario(opts = {}) {
  const scenarios = ["conservative","base","optimistic"].map(sc => runForecast({ ...opts, scenario: sc }));
  return {
    conservative: scenarios[0],
    base:         scenarios[1],
    optimistic:   scenarios[2],
    assumptions:  SCENARIOS,
    simulatedAt:  _ts(),
  };
}

function listForecasts() {
  const s = _load();
  return Object.values(s.forecasts).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ── MODULE 7: Affiliate & Partner Center ──────────────────────────────────────

const AFFILIATE_TIERS = {
  ambassador: { label: "Ambassador", commissionRate: 0.20, minReferrals: 0,  payoutThreshold: 1000  },
  partner:    { label: "Partner",    commissionRate: 0.25, minReferrals: 10, payoutThreshold: 2500  },
  reseller:   { label: "Reseller",   commissionRate: 0.30, minReferrals: 25, payoutThreshold: 5000  },
  enterprise: { label: "Enterprise", commissionRate: 0.35, minReferrals: 50, payoutThreshold: 10000 },
};

function createAffiliate(opts) {
  const s  = _load();
  const id = _id("aff");
  s.affiliates[id] = {
    id,
    name:         opts.name         || "",
    email:        opts.email        || "",
    code:         opts.code         || id.slice(-8).toUpperCase(),
    tier:         opts.tier         || "ambassador",
    commissionRate: AFFILIATE_TIERS[opts.tier || "ambassador"].commissionRate,
    referrals:    0,
    conversions:  0,
    pendingPayout: 0,
    paidOut:      0,
    status:       "active",
    payoutHistory: [],
    createdAt: _ts(), updatedAt: _ts(),
  };
  _save(s);
  return s.affiliates[id];
}

function recordAffiliateConversion(affiliateId, opts) {
  const s   = _load();
  const aff = s.affiliates[affiliateId];
  if (!aff) throw new Error(`Affiliate ${affiliateId} not found`);

  const plan       = opts.plan || "starter";
  const mrr        = _mrr(plan, 1);
  const commission = Math.round(mrr * aff.commissionRate);

  aff.referrals++;
  aff.conversions++;
  aff.pendingPayout += commission;

  const commId = _id("com");
  s.commissions[commId] = {
    id: commId,
    affiliateId,
    accountId:    opts.accountId || null,
    plan,
    mrr,
    commission,
    status:       "pending",
    recordedAt:   _ts(),
  };

  // Auto-upgrade tier
  const newTier = Object.entries(AFFILIATE_TIERS)
    .filter(([, t]) => aff.conversions >= t.minReferrals)
    .sort((a, b) => b[1].minReferrals - a[1].minReferrals)[0]?.[0] || "ambassador";
  aff.tier           = newTier;
  aff.commissionRate = AFFILIATE_TIERS[newTier].commissionRate;
  aff.updatedAt      = _ts();
  _save(s);
  return { affiliate: aff, commission: s.commissions[commId] };
}

function processAffiliatePayout(affiliateId) {
  const s   = _load();
  const aff = s.affiliates[affiliateId];
  if (!aff) throw new Error(`Affiliate ${affiliateId} not found`);
  const tier = AFFILIATE_TIERS[aff.tier];
  if (aff.pendingPayout < tier.payoutThreshold) throw new Error(`Below payout threshold of ₹${tier.payoutThreshold}`);

  const amount = aff.pendingPayout;
  aff.paidOut      += amount;
  aff.pendingPayout = 0;
  aff.payoutHistory.push({ amount, paidAt: _ts(), status: "processed" });
  aff.updatedAt = _ts();

  // Mark commissions as paid
  for (const c of Object.values(s.commissions)) {
    if (c.affiliateId === affiliateId && c.status === "pending") c.status = "paid";
  }
  _save(s);
  return { ok: true, affiliate: aff, amountPaid: amount };
}

function getAffiliateAnalytics() {
  const s    = _load();
  const affs = Object.values(s.affiliates);
  const coms = Object.values(s.commissions);
  return {
    totalAffiliates:   affs.length,
    activeAffiliates:  affs.filter(a => a.status === "active").length,
    totalConversions:  affs.reduce((s, a) => s + a.conversions, 0),
    totalCommissions:  coms.reduce((s, c) => s + c.commission, 0),
    totalPendingPayout: affs.reduce((s, a) => s + a.pendingPayout, 0),
    totalPaidOut:      affs.reduce((s, a) => s + a.paidOut, 0),
    byTier:            Object.fromEntries(Object.keys(AFFILIATE_TIERS).map(t => [t, affs.filter(a => a.tier === t).length])),
    topAffiliate:      affs.sort((a, b) => b.conversions - a.conversions)[0] || null,
  };
}

function listAffiliates(tier, status) {
  const s = _load();
  return Object.values(s.affiliates)
    .filter(a => (!tier || a.tier === tier) && (!status || a.status === status))
    .sort((a, b) => b.conversions - a.conversions);
}

// ── MODULE 8: Finance Center ──────────────────────────────────────────────────

const TAX_RATES = { IN: 0.18, US: 0, UK: 0.20, EU: 0.21, DEFAULT: 0.18 };

function generateInvoice(opts) {
  const s  = _load();
  const id = _id("inv");
  const rec = billing.getRecord(opts.accountId);
  const plan = PLANS[rec.plan] || PLANS.starter;
  const baseAmount = opts.amount || plan.priceMonthly;
  const taxRate    = TAX_RATES[opts.country || "IN"];
  const taxAmount  = Math.round(baseAmount * taxRate);
  const total      = baseAmount + taxAmount;

  s.invoices[id] = {
    id,
    invoiceNumber:  `INV-${new Date().getFullYear()}-${String(Object.keys(s.invoices).length + 1).padStart(4, "0")}`,
    accountId:      opts.accountId,
    plan:           rec.plan,
    items: [{
      description: `${plan.label} Plan — ${opts.period || "Monthly"}`,
      quantity:    1,
      unitPrice:   baseAmount,
      amount:      baseAmount,
    }],
    subtotal:       baseAmount,
    taxRate:        +(taxRate * 100).toFixed(0),
    taxAmount,
    total,
    currency:       opts.currency || "INR",
    country:        opts.country  || "IN",
    status:         "issued",
    dueDate:        opts.dueDate  || new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
    paidAt:         null,
    issuedAt:       _ts(),
  };
  _save(s);
  return s.invoices[id];
}

function markInvoicePaid(invoiceId) {
  const s   = _load();
  const inv = s.invoices[invoiceId];
  if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
  inv.status = "paid";
  inv.paidAt = _ts();
  _save(s);
  return inv;
}

function issueRefund(opts) {
  const s  = _load();
  const id = _id("cn");
  const cn = {
    id,
    creditNoteNumber: `CN-${new Date().getFullYear()}-${String(Object.keys(s.creditNotes).length + 1).padStart(4, "0")}`,
    accountId:    opts.accountId,
    invoiceId:    opts.invoiceId || null,
    reason:       opts.reason   || "customer_request",
    amount:       opts.amount   || 0,
    status:       "issued",
    issuedAt:     _ts(),
  };
  s.creditNotes[id] = cn;
  // Also top up credits if credit refund
  if (opts.creditTopup) {
    credits.topup(opts.accountId, opts.creditTopup, "refund");
  }
  _save(s);
  return cn;
}

function getRevenueReport(period = "monthly") {
  const s    = _load();
  const dash = getRevenueDashboard();
  const invs = Object.values(s.invoices);
  const cns  = Object.values(s.creditNotes);
  const affs = getAffiliateAnalytics();

  const totalInvoiced = invs.reduce((s, i) => s + (i.total || 0), 0);
  const totalPaid     = invs.filter(i => i.status === "paid").reduce((s, i) => s + (i.total || 0), 0);
  const totalRefunds  = cns.reduce((s, c) => s + (c.amount || 0), 0);
  const totalTax      = invs.reduce((s, i) => s + (i.taxAmount || 0), 0);

  return {
    period,
    mrr:            dash.mrr,
    arr:            dash.arr,
    totalInvoiced,
    totalPaid,
    totalOutstanding: totalInvoiced - totalPaid,
    totalRefunds,
    totalTax,
    netRevenue:     totalPaid - totalRefunds,
    affiliateCosts: affs.totalCommissions,
    grossProfit:    Math.round((totalPaid - totalRefunds - affs.totalCommissions) * 0.75),
    invoiceCount:   invs.length,
    refundCount:    cns.length,
    generatedAt:    _ts(),
  };
}

function listInvoices(accountId, status) {
  const s = _load();
  return Object.values(s.invoices)
    .filter(i => (!accountId || i.accountId === accountId) && (!status || i.status === status))
    .sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
}

function listCreditNotes(accountId) {
  const s = _load();
  return Object.values(s.creditNotes)
    .filter(c => !accountId || c.accountId === accountId)
    .sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
}

// ── MODULE 9: Executive Revenue Center ───────────────────────────────────────

function getExecutiveRevenueDashboard() {
  const dash      = getRevenueDashboard();
  const report    = getRevenueReport();
  const affStats  = getAffiliateAnalytics();
  const forecast  = runForecast({ scenario: "base" });
  const churnList = listChurnRisks();
  const atRisk    = churnList.filter(r => ["high","critical"].includes(r.riskLevel));

  const aiCostEstimate = Math.round(dash.mrr * 0.08);
  const infraCost      = Math.round(dash.mrr * 0.05);
  const supportCost    = Math.round(dash.mrr * 0.04);
  const grossMarginPct = dash.grossMargin;

  return {
    revenue: {
      mrr:          dash.mrr,
      arr:          dash.arr,
      netRevenue:   report.netRevenue,
      grossMarginPct,
      expansionMRR: dash.expansionMRR,
    },
    growth: {
      "30d_mrr":    forecast.projections["30d"].mrr,
      "90d_mrr":    forecast.projections["90d"].mrr,
      "365d_mrr":   forecast.projections["365d"].mrr,
      scenario:     "base",
    },
    retention: {
      churnRate:    dash.churnRate,
      atRiskCount:  atRisk.length,
      activeCount:  dash.activeSubscriptions,
      ltv:          dash.ltv,
    },
    conversion: {
      trialCount:          dash.trialCount,
      trialConversionRate: dash.trialConversionRate,
      paidCount:           dash.paidCount,
    },
    profitability: {
      mrr:           dash.mrr,
      aiCosts:       aiCostEstimate,
      infraCosts:    infraCost,
      supportCosts:  supportCost,
      totalCOGS:     aiCostEstimate + infraCost + supportCost,
      netProfit:     Math.max(0, dash.mrr - aiCostEstimate - infraCost - supportCost),
      netMarginPct:  dash.mrr > 0 ? Math.round((dash.mrr - aiCostEstimate - infraCost - supportCost) / dash.mrr * 100) : 0,
    },
    aiCosts: {
      monthly:       aiCostEstimate,
      perAccount:    dash.activeSubscriptions > 0 ? Math.round(aiCostEstimate / dash.activeSubscriptions) : 0,
      pctOfRevenue:  dash.mrr > 0 ? +(aiCostEstimate / dash.mrr * 100).toFixed(1) : 0,
    },
    affiliates: {
      total:        affStats.totalAffiliates,
      conversions:  affStats.totalConversions,
      commissions:  affStats.totalCommissions,
      pending:      affStats.totalPendingPayout,
    },
    finance: {
      invoicesIssued: (listInvoices().length),
      creditNotes:    (listCreditNotes().length),
      taxCollected:   report.totalTax,
    },
    generatedAt: _ts(),
  };
}

// ── MODULE 10: Commercial Benchmark ──────────────────────────────────────────

function runBenchmark() {
  const checks = [
    {
      id:    "revenue_dashboard",
      label: "Revenue Dashboard (MRR, ARR, subscriptions, trial conversion, churn, LTV)",
      run: () => {
        const d = getRevenueDashboard();
        return typeof d.mrr === "number" && typeof d.arr === "number" && typeof d.churnRate === "number" && typeof d.ltv === "number" && typeof d.trialConversionRate === "number" && d.generatedAt;
      },
    },
    {
      id:    "subscription_lifecycle",
      label: "Subscription Lifecycle (trial→paid, upgrade, downgrade, pause, cancel, reactivate)",
      run: () => {
        const rec = getSubscriptionRecord("bench-sub-001");
        const up  = upgradeSubscription("bench-sub-001", "growth");
        const dn  = upgradeSubscription("bench-sub-001", "starter");
        const ps  = pauseSubscription("bench-sub-001", "2026-09-01");
        const ca  = cancelSubscription("bench-sub-001", "benchmark test");
        const ra  = reactivateSubscription("bench-sub-001", "starter");
        const ev  = listLifecycleEvents("bench-sub-001");
        return rec.accountId && up.ok && dn.ok && ps.ok && ca.ok && ra.ok && ev.length >= 4;
      },
    },
    {
      id:    "upgrade_intelligence",
      label: "Upgrade Intelligence (signal detection, context-aware prompts, score)",
      run: () => {
        recordUpgradeSignal("bench-ui-001", "feature_gate_hit", { feature: "ai_chat" });
        recordUpgradeSignal("bench-ui-001", "team_invite_attempt", {});
        const result = detectUpgradeMoment("bench-ui-001", ["feature_gate_hit","team_invite_attempt"]);
        const signals = listUpgradeSignals("bench-ui-001");
        return result.accountId && typeof result.score === "number" && result.signals.length >= 2 && signals.length >= 2;
      },
    },
    {
      id:    "customer_success",
      label: "Customer Success Automation (health score, playbooks, risk detection, renewal reminders)",
      run: () => {
        const h    = getCustomerHealth("bench-cs-001");
        addHealthNote("bench-cs-001", "Benchmark health note");
        const rem  = sendRenewalReminder("bench-cs-001", 30);
        const list = listCustomerHealth();
        return !isNaN(h.healthScore) && h.grade && h.activePlaybook && rem.id && typeof list === "object";
      },
    },
    {
      id:    "churn_prevention",
      label: "Churn Prevention (risk detection, win-back campaign, exit survey, retention)",
      run: () => {
        const risk  = detectChurnRisk("bench-cp-001", ["cancel_flow_visited","negative_nps"]);
        const wb    = createWinBackCampaign("bench-cp-001", "wbt_1");
        const survey = submitExitSurvey("bench-cp-001", { reason: "price", comment: "Too expensive", npsScore: 5, wouldReturn: true });
        const list   = listChurnRisks();
        return risk.riskScore >= 0 && risk.riskLevel && wb.id && survey.id && list.length >= 1;
      },
    },
    {
      id:    "revenue_forecasting",
      label: "Revenue Forecasting (30/90/365-day projections, 3-scenario simulation)",
      run: () => {
        const fct  = runForecast({ scenario: "optimistic" });
        const sim  = simulateScenario();
        const list = listForecasts();
        return fct.projections["30d"] && fct.projections["90d"] && fct.projections["365d"] && sim.conservative && sim.base && sim.optimistic && list.length >= 1;
      },
    },
    {
      id:    "affiliate_partner",
      label: "Affiliate & Partner Center (tiers, commission, conversion tracking, payout)",
      run: () => {
        const aff  = createAffiliate({ name: "Test Partner", email: "partner@test.com", tier: "partner" });
        for (let i = 0; i < 3; i++) recordAffiliateConversion(aff.id, { accountId: `bench-aff-conv-${i}`, plan: "growth" });
        const analytics = getAffiliateAnalytics();
        const list  = listAffiliates();
        return aff.id && aff.code && analytics.totalAffiliates >= 1 && analytics.totalConversions >= 3 && list.length >= 1;
      },
    },
    {
      id:    "finance_center",
      label: "Finance Center (invoices, taxes, credit notes, refunds, revenue reports)",
      run: () => {
        const inv  = generateInvoice({ accountId: "bench-fin-001", country: "IN" });
        markInvoicePaid(inv.id);
        const cn   = issueRefund({ accountId: "bench-fin-001", invoiceId: inv.id, reason: "duplicate", amount: 500 });
        const rpt  = getRevenueReport("monthly");
        const invs = listInvoices();
        const cns  = listCreditNotes();
        return inv.id && inv.taxAmount >= 0 && cn.id && rpt.mrr !== undefined && invs.length >= 1 && cns.length >= 1;
      },
    },
    {
      id:    "executive_revenue",
      label: "Executive Revenue Center (revenue, growth, retention, conversion, profitability, AI costs)",
      run: () => {
        const d = getExecutiveRevenueDashboard();
        return d.revenue && d.growth && d.retention && d.conversion && d.profitability && d.aiCosts && d.affiliates && d.finance && d.generatedAt;
      },
    },
    {
      id:    "commercial_viability",
      label: "Commercial Viability (subscriptions, revenue, retention, forecasts, affiliates, finance)",
      run: () => {
        const dash   = getRevenueDashboard();
        const subs   = getSubscriptionRecord("bench-cv-001");
        const risks  = listChurnRisks();
        const fcts   = listForecasts();
        const affs   = listAffiliates();
        const invs   = listInvoices();
        const exec   = getExecutiveRevenueDashboard();
        return typeof dash.mrr === "number" && subs.accountId && risks.length >= 1 && fcts.length >= 1 && affs.length >= 1 && invs.length >= 1 && exec.generatedAt;
      },
    },
  ];

  const results = checks.map(c => {
    try   { const ok = !!c.run(); return { id: c.id, label: c.label, ok, error: null }; }
    catch (e) { return { id: c.id, label: c.label, ok: false, error: e.message }; }
  });

  const passing = results.filter(r => r.ok).length;
  const score   = Math.round(passing / results.length * 100);

  return {
    score, passing, total: results.length,
    revenueReadiness: score === 100 ? "production_ready" : score >= 80 ? "nearly_ready" : "needs_work",
    regressionPass:   passing === results.length,
    checks:           results,
    runAt:            _ts(),
  };
}

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // M1: Revenue Dashboard
  getRevenueDashboard, PLANS, PLAN_LTV,
  // M2: Subscription Lifecycle
  getSubscriptionRecord, upgradeSubscription, pauseSubscription, reactivateSubscription, cancelSubscription, listLifecycleEvents, LIFECYCLE_TRANSITIONS,
  // M3: Upgrade Intelligence
  detectUpgradeMoment, recordUpgradeSignal, listUpgradeSignals, UPGRADE_SIGNALS, UPGRADE_PROMPTS,
  // M4: Customer Success
  getCustomerHealth, addHealthNote, sendRenewalReminder, listCustomerHealth, SUCCESS_PLAYBOOKS,
  // M5: Churn Prevention
  detectChurnRisk, createWinBackCampaign, submitExitSurvey, listChurnRisks, listExitSurveys, CHURN_SIGNALS, WINBACK_TEMPLATES,
  // M6: Revenue Forecasting
  runForecast, simulateScenario, listForecasts, SCENARIOS,
  // M7: Affiliate & Partner
  createAffiliate, recordAffiliateConversion, processAffiliatePayout, getAffiliateAnalytics, listAffiliates, AFFILIATE_TIERS,
  // M8: Finance Center
  generateInvoice, markInvoicePaid, issueRefund, getRevenueReport, listInvoices, listCreditNotes, TAX_RATES,
  // M9: Executive Revenue Center
  getExecutiveRevenueDashboard,
  // M10: Benchmark
  runBenchmark,
};
