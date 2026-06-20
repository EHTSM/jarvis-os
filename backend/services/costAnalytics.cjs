"use strict";
/**
 * Cost Analytics — cost per user, workspace, mission, provider, profit estimation.
 *
 * Reuses: usageMetering for raw data.
 * Reads: billing.json for plan data.
 * Outputs: P&L estimates for commercial benchmark.
 */

const usageMetering = require("./usageMetering.cjs");
const path = require("path");
const fs   = require("fs");

const BILLING_FILE = path.join(__dirname, "../../data/billing.json");

// ── Revenue model ─────────────────────────────────────────────────
const PLAN_REVENUE_USD_MONTH = {
  trial:   0,
  starter: 12,    // ~999 INR ≈ $12
  growth:  30,    // ~2499 INR ≈ $30
  scale:   200,   // enterprise baseline
};

// ── Gross margin target ───────────────────────────────────────────
const TARGET_MARGIN = 0.65; // 65% gross margin target

function _loadBilling() {
  try { return JSON.parse(fs.readFileSync(BILLING_FILE, "utf8")); }
  catch { return {}; }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Cost breakdown by provider.
 */
function costByProvider(opts = {}) {
  return usageMetering.aggregateCost("provider", opts);
}

/**
 * Cost breakdown by user (accountId).
 */
function costByUser(opts = {}) {
  return usageMetering.aggregateCost("accountId", opts);
}

/**
 * Cost breakdown by workspace.
 */
function costByWorkspace(opts = {}) {
  return usageMetering.aggregateCost("workspaceId", opts);
}

/**
 * Cost breakdown by mission.
 */
function costByMission(opts = {}) {
  return usageMetering.aggregateCost("missionId", opts).filter(r => r.key && r.key !== "null");
}

/**
 * Full P&L summary.
 */
function profitSummary(opts = {}) {
  const billing    = _loadBilling();
  const usage      = usageMetering.summary(opts);
  const accounts   = Object.values(billing);

  const totalCostUsd = usage.totalCostUsd;

  // Revenue estimation
  const planCounts = { trial: 0, starter: 0, growth: 0, scale: 0, cancelled: 0 };
  for (const rec of accounts) {
    const plan = rec.plan || "trial";
    if (planCounts[plan] !== undefined) planCounts[plan]++;
  }

  const monthlyRevenue = Object.entries(planCounts).reduce((sum, [plan, count]) => {
    return sum + count * (PLAN_REVENUE_USD_MONTH[plan] || 0);
  }, 0);

  // Annualized
  const arr = monthlyRevenue * 12;

  // Gross profit = revenue - AI provider cost (monthly estimated from usage window)
  const grossProfit    = monthlyRevenue - totalCostUsd;
  const grossMargin    = monthlyRevenue > 0 ? grossProfit / monthlyRevenue : 0;
  const marginStatus   = grossMargin >= TARGET_MARGIN ? "healthy"
                       : grossMargin >= 0.4           ? "watch"
                       :                                "at_risk";

  // Break-even
  const fixedCostEstimateUsd = 500; // infra + salaries placeholder per month
  const breakEvenUsers = monthlyRevenue > 0
    ? Math.ceil(fixedCostEstimateUsd / (monthlyRevenue / Math.max(1, accounts.length - planCounts.trial)))
    : null;

  return {
    accounts: {
      total:    accounts.length,
      trial:    planCounts.trial,
      starter:  planCounts.starter,
      growth:   planCounts.growth,
      scale:    planCounts.scale,
      paid:     planCounts.starter + planCounts.growth + planCounts.scale,
    },
    revenue: {
      monthlyUsd:   parseFloat(monthlyRevenue.toFixed(2)),
      arrUsd:       parseFloat(arr.toFixed(2)),
      mrrUsd:       parseFloat(monthlyRevenue.toFixed(2)),
    },
    cost: {
      aiProviderUsd:    parseFloat(totalCostUsd.toFixed(4)),
      totalRequests:    usage.totalRequests,
      totalTokens:      usage.totalTokens,
    },
    profit: {
      grossUsd:       parseFloat(grossProfit.toFixed(4)),
      grossMargin:    parseFloat((grossMargin * 100).toFixed(1)),
      marginStatus,
      targetMarginPct: TARGET_MARGIN * 100,
      breakEvenPaidUsers: breakEvenUsers,
    },
    byProvider: usage.byProvider,
  };
}

/**
 * Per-account cost report.
 */
function perAccount(accountId, opts = {}) {
  const usage = usageMetering.summary({ ...opts, accountId });
  const billing = _loadBilling();
  const rec = billing[accountId] || {};
  return {
    accountId,
    plan:         rec.plan || "trial",
    status:       rec.status || "unknown",
    aiCostUsd:    usage.totalCostUsd,
    requests:     usage.totalRequests,
    tokens:       usage.totalTokens,
    byProvider:   usage.byProvider,
  };
}

/**
 * Commercial benchmark — can the platform sustain free tier?
 */
function benchmark() {
  const summary = profitSummary();

  const checks = [];

  // 1. No request can guarantee a loss (cost per request < credit value)
  const avgCostPerReq = summary.cost.totalRequests > 0
    ? summary.cost.aiProviderUsd / summary.cost.totalRequests
    : 0;
  const avgRevenuePerReq = summary.revenue.monthlyUsd > 0 && summary.accounts.paid > 0
    ? summary.revenue.monthlyUsd / (summary.accounts.paid * 200) // ~200 req/user/mo
    : 0;

  checks.push({
    check: "no_guaranteed_loss_per_request",
    ok:    avgRevenuePerReq >= avgCostPerReq || summary.accounts.paid === 0,
    avgCostPerReq:    parseFloat(avgCostPerReq.toFixed(6)),
    avgRevenuePerReq: parseFloat(avgRevenuePerReq.toFixed(6)),
  });

  // 2. Free tier sustainable (AI cost per free user < $0.20/mo)
  const freeCostPerUser = summary.accounts.trial > 0
    ? summary.cost.aiProviderUsd / Math.max(1, summary.accounts.trial)
    : 0;
  checks.push({
    check: "free_tier_sustainable",
    ok:    freeCostPerUser < 0.20,
    freeCostPerUser: parseFloat(freeCostPerUser.toFixed(4)),
    limit: 0.20,
  });

  // 3. Premium profitable (margin > 40%)
  checks.push({
    check: "premium_profitable",
    ok:    summary.profit.grossMargin >= 40 || summary.revenue.monthlyUsd === 0,
    grossMarginPct: summary.profit.grossMargin,
    required: 40,
  });

  // 4. Enterprise scalable (cost per request < $0.01)
  checks.push({
    check: "enterprise_scalable",
    ok:    avgCostPerReq < 0.01,
    avgCostPerReq: parseFloat(avgCostPerReq.toFixed(6)),
    limit: 0.01,
  });

  const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);

  return {
    summary,
    checks,
    score,
    grossMarginPct:       summary.profit.grossMargin,
    breakEvenPaidUsers:   summary.profit.breakEvenPaidUsers,
    commercialReadiness:  score >= 75 ? "ready" : score >= 50 ? "developing" : "pre_commercial",
  };
}

module.exports = {
  costByProvider,
  costByUser,
  costByWorkspace,
  costByMission,
  profitSummary,
  perAccount,
  benchmark,
  PLAN_REVENUE_USD_MONTH,
};
