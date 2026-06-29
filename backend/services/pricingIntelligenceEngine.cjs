"use strict";
/**
 * pricingIntelligenceEngine.cjs — POST-Ω P15 Autonomous Revenue Engine
 *
 * Recommends pricing, discounts, bundles and subscriptions using:
 *   revenueOS (PLANS, PLAN_LTV, upgrade signals), customerHealthEngine,
 *   businessReasoningEngine (OBI X), digitalTwinEngine,
 *   companyLifecycleEngine, analyticsService, knowledgeFederationEngine.
 *
 * Storage: data/pricing-intelligence.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "pricing-intelligence.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _rev = () => _try(() => require("./revenueOS.cjs"));
const _che = () => _try(() => require("./customerHealthEngine.cjs"));
const _obi = () => _try(() => require("./businessReasoningEngine.cjs"));
const _dt  = () => _try(() => require("./digitalTwinEngine.cjs"));
const _ana = () => _try(() => require("./analyticsService.cjs"));
const _cje = () => _try(() => require("./customerJourneyEngine.cjs"));
const _rde = () => _try(() => require("./revenueDiscoveryEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `pie_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const PRICING_STRATEGIES = [
  "value_based",    // price anchored to customer value / LTV
  "competitive",    // benchmark vs market
  "penetration",    // low price to acquire, upsell later
  "premium",        // high price for high-value segment
  "freemium",       // free tier → paid conversion
  "usage_based",    // metered / credit-based
  "bundle",         // package multiple products
];

const DISCOUNT_RULES = {
  annual_commitment:   { pct: 20, reason: "Annual commitment discount" },
  high_volume:         { pct: 15, reason: "Volume discount (>5 seats)" },
  early_adopter:       { pct: 25, reason: "Early adopter rate lock" },
  churn_prevention:    { pct: 30, reason: "Churn prevention offer" },
  reactivation:        { pct: 40, reason: "Win-back / reactivation" },
  partner_referral:    { pct: 10, reason: "Partner referral discount" },
};

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { recommendations: [], stats: { total: 0, byStrategy: {}, avgLift: 0 }, updatedAt: null };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.recommendations)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.recommendations.length > 1000) d.recommendations = d.recommendations.slice(-1000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Intelligence helpers ──────────────────────────────────────────────────────

function _getRevenueContext() {
  try {
    const exec   = _rev()?.getExecutiveRevenueDashboard?.() || {};
    const plans  = _rev()?.PLANS || {};
    const ltvs   = _rev()?.PLAN_LTV || {};
    const scenarios = _rev()?.SCENARIOS || {};
    return { mrr: exec.revenue?.mrr || 999, arr: exec.revenue?.arr || 11988, plans, ltvs, scenarios };
  } catch { return { mrr: 999, arr: 11988, plans: {}, ltvs: {}, scenarios: {} }; }
}

function _getHealthContext() {
  try {
    const s = _che()?.getStats?.() || {};
    return { avgScore: s.avgScore || 0, atRisk: s.atRisk || 0, total: s.total || 0 };
  } catch { return { avgScore: 0, atRisk: 0, total: 0 }; }
}

// ── Recommendation builders ───────────────────────────────────────────────────

function _buildBundleRec(ctx) {
  const { plans, mrr } = ctx;
  const planKeys = Object.keys(plans).filter(k => plans[k].priceMonthly > 0);
  // Bundle = growth plan + marketplace access + custom AI at a modest uplift
  const growthPrice = plans.growth?.priceMonthly || 2499;
  const bundlePrice = Math.round(growthPrice * 1.3); // 30% uplift for bundle
  return {
    id: _id(), strategy: "bundle",
    title: "AI-Powered Growth Bundle",
    description: "Growth plan + Marketplace assets + AI compute bundle",
    basePrice:     growthPrice,
    recommendedPrice: bundlePrice,
    discount: null,
    projectedMRRLift: Math.round((bundlePrice - growthPrice) * (ctx.healthContext?.total || 1) * 0.1),
    rationale: "Bundle reduces cognitive load; 30% revenue uplift over standalone growth plan",
    targetSegment: "growth_plan_users",
    confidence: 78,
    createdAt: _ts(),
  };
}

function _buildAnnualRec(ctx) {
  const { mrr } = ctx;
  const annualLift = Math.round(mrr * 12 * 0.8); // annual = 12 months at 20% discount → 80% of annual
  return {
    id: _id(), strategy: "value_based",
    title: "Annual Commitment Incentive",
    description: "Offer 20% discount for annual upfront payment to secure ARR",
    basePrice: mrr,
    recommendedPrice: Math.round(mrr * 0.8),
    discount: { ...DISCOUNT_RULES.annual_commitment, appliedTo: "monthly_rate" },
    projectedMRRLift: Math.round(mrr * 0.2 * 0.3), // 30% of base take annual
    rationale: "Annual commits reduce churn by ~60%; net revenue positive even with discount",
    targetSegment: "monthly_paid_users",
    confidence: 85,
    createdAt: _ts(),
  };
}

function _buildChurnPreventionRec(ctx) {
  const atRisk   = ctx.healthContext?.atRisk || 0;
  const plans    = ctx.plans || {};
  const starterMRR = plans.starter?.priceMonthly || 999;
  const offerPrice = Math.round(starterMRR * (1 - DISCOUNT_RULES.churn_prevention.pct / 100));
  return {
    id: _id(), strategy: "penetration",
    title: `Churn Prevention Offer — ${atRisk} at-risk customers`,
    description: `30% discount + success manager assigned to ${atRisk} at-risk accounts`,
    basePrice: starterMRR,
    recommendedPrice: offerPrice,
    discount: { ...DISCOUNT_RULES.churn_prevention, affectedCount: atRisk },
    projectedMRRLift: -Math.round(starterMRR * 0.3 * atRisk) + Math.round(starterMRR * atRisk * 0.7),
    rationale: "Preventing churn at 30% discount is 7× cheaper than acquiring new customer",
    targetSegment: "at_risk_customers",
    confidence: 88,
    createdAt: _ts(),
  };
}

function _buildFreemiumOptimizationRec(ctx) {
  const exec = _rev()?.getExecutiveRevenueDashboard?.() || {};
  const trialCount = exec.conversion?.trialCount || 0;
  const convRate   = (exec.conversion?.trialConversionRate || 2) / 100;
  const plans      = ctx.plans || {};
  const starterMRR = plans.starter?.priceMonthly || 999;
  const conversionMRR = Math.round(trialCount * convRate * starterMRR);
  return {
    id: _id(), strategy: "freemium",
    title: "Freemium Conversion Optimization",
    description: `Optimize ${trialCount} trial → paid conversion (current: ${Math.round(convRate * 100)}%)`,
    basePrice: 0,
    recommendedPrice: starterMRR,
    discount: null,
    projectedMRRLift: conversionMRR,
    rationale: `${trialCount} active trials; improving conversion by 1% adds ~${Math.round(trialCount * 0.01 * starterMRR)} MRR`,
    targetSegment: "trial_users",
    confidence: 75,
    createdAt: _ts(),
  };
}

function _buildUsageBasedRec(ctx) {
  const { mrr } = ctx;
  return {
    id: _id(), strategy: "usage_based",
    title: "AI Credit Metering — Usage-Based Upsell",
    description: "Surface credit consumption patterns to trigger natural upsell moments",
    basePrice: mrr,
    recommendedPrice: null,
    discount: null,
    projectedMRRLift: Math.round(mrr * 0.15),
    rationale: "Usage-based triggers convert 3× better than time-based nudges",
    targetSegment: "high_credit_users",
    confidence: 80,
    createdAt: _ts(),
  };
}

// ── Core: recommend ───────────────────────────────────────────────────────────

function recommend({ accountId, plan, context } = {}) {
  const revCtx = _getRevenueContext();
  revCtx.healthContext = _getHealthContext();

  const recs = [
    _buildBundleRec(revCtx),
    _buildAnnualRec(revCtx),
    _buildChurnPreventionRec(revCtx),
    _buildFreemiumOptimizationRec(revCtx),
    _buildUsageBasedRec(revCtx),
  ];

  // If accountId passed, filter/personalize
  if (accountId) {
    recs.forEach(r => { r.accountId = accountId; if (plan) r.personalizedForPlan = plan; });
  }

  const d = _load();
  recs.forEach(r => d.recommendations.push(r));
  const byStrategy = {};
  PRICING_STRATEGIES.forEach(s => { byStrategy[s] = 0; });
  d.recommendations.forEach(r => { if (byStrategy[r.strategy] !== undefined) byStrategy[r.strategy]++; });
  const avgLift = d.recommendations.length
    ? Math.round(d.recommendations.reduce((s, r) => s + (r.projectedMRRLift || 0), 0) / d.recommendations.length)
    : 0;
  d.stats = { total: d.recommendations.length, byStrategy, avgLift };
  _save(d);

  return {
    ok: true,
    recommendations: recs,
    projectedTotalMRRLift: recs.reduce((s, r) => s + (r.projectedMRRLift || 0), 0),
    context: { mrr: revCtx.mrr, arr: revCtx.arr, healthAvg: revCtx.healthContext.avgScore },
  };
}

function getRecommendation(id) {
  return _load().recommendations.find(r => r.id === id) || null;
}

function listRecommendations({ strategy, limit = 50 } = {}) {
  let recs = _load().recommendations;
  if (strategy) recs = recs.filter(r => r.strategy === strategy);
  return { ok: true, recommendations: recs.slice(-limit), total: recs.length };
}

function getDiscountOffer(scenario) {
  const rule = DISCOUNT_RULES[scenario];
  if (!rule) return { ok: false, error: `unknown scenario: ${scenario}` };
  const plans = _rev()?.PLANS || {};
  const starterMRR = plans.starter?.priceMonthly || 999;
  return {
    ok: true,
    scenario,
    discount:  rule,
    basePrice: starterMRR,
    offerPrice: Math.round(starterMRR * (1 - rule.pct / 100)),
  };
}

function getStats() {
  const d = _load();
  return { ...d.stats, PRICING_STRATEGIES, DISCOUNT_RULES: Object.keys(DISCOUNT_RULES), updatedAt: d.updatedAt };
}

module.exports = {
  PRICING_STRATEGIES,
  DISCOUNT_RULES,
  recommend,
  getRecommendation,
  listRecommendations,
  getDiscountOffer,
  getStats,
};
