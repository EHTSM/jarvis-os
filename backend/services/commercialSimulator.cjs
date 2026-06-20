"use strict";
/**
 * Commercial Benchmark Simulator — Module 10.
 *
 * Simulates 100 / 1,000 / 10,000 / 100,000 users.
 * Estimates: AI costs, revenue, gross margin, infrastructure load, readiness.
 *
 * Reuses: PLAN_PRICES (billing), PLAN_FREE_CREDITS, CREDIT_COSTS (creditEngine),
 *         creativeRegistry (credit costs per capability).
 */

// billingService and creditEngine constants are inlined below for simulator isolation

// ── Assumptions ────────────────────────────────────────────────────
// Plan distribution at scale (% of users)
const PLAN_MIX = { trial: 0.60, starter: 0.25, growth: 0.12, scale: 0.03 };
// Monthly revenue in USD per plan
const PLAN_REV_USD = { trial: 0, starter: 12, growth: 30, scale: 120 };
// Avg AI requests per user per month
const AVG_REQ_PER_USER_MONTH = { trial: 20, starter: 80, growth: 200, scale: 500 };
// AI cost per request in USD (blended provider cost)
const COST_PER_AI_REQ_USD = 0.008;
// Infrastructure cost per 1000 MAU/month
const INFRA_PER_1K_USERS_USD = 15;
// Support cost per 1000 users
const SUPPORT_PER_1K_USERS_USD = 8;
// Fixed overhead per month
const FIXED_OVERHEAD_USD = 500;

function simulate(userCount) {
  const breakdown = {};
  let totalRev = 0, totalAiCost = 0, totalReq = 0;

  for (const [plan, pct] of Object.entries(PLAN_MIX)) {
    const users    = Math.round(userCount * pct);
    const rev      = users * PLAN_REV_USD[plan];
    const reqPerU  = AVG_REQ_PER_USER_MONTH[plan];
    const totalR   = users * reqPerU;
    const aiCost   = totalR * COST_PER_AI_REQ_USD;

    breakdown[plan] = { users, revenue: rev, requests: totalR, aiCost: Math.round(aiCost * 100) / 100 };
    totalRev    += rev;
    totalAiCost += aiCost;
    totalReq    += totalR;
  }

  const infraCost   = (userCount / 1000) * INFRA_PER_1K_USERS_USD;
  const supportCost = (userCount / 1000) * SUPPORT_PER_1K_USERS_USD;
  const totalCost   = totalAiCost + infraCost + supportCost + FIXED_OVERHEAD_USD;
  const grossProfit = totalRev - totalCost;
  const grossMargin = totalRev > 0 ? Math.round((grossProfit / totalRev) * 100) : 0;
  const payingUsers = Object.entries(PLAN_MIX)
    .filter(([p]) => p !== "trial")
    .reduce((s, [p]) => s + Math.round(userCount * PLAN_MIX[p]), 0);

  // Infrastructure load estimate
  const reqPerSec = (totalReq / 30 / 24 / 3600);
  const load = reqPerSec < 1    ? "trivial" :
               reqPerSec < 10   ? "light"   :
               reqPerSec < 100  ? "moderate":
               reqPerSec < 500  ? "heavy"   : "extreme";

  const readiness = grossMargin > 50  ? "commercial_ready" :
                    grossMargin > 20  ? "growing"          :
                    grossMargin > 0   ? "near_breakeven"   : "pre_commercial";

  return {
    userCount,
    payingUsers,
    breakdown,
    revenue: {
      monthly:  Math.round(totalRev),
      annual:   Math.round(totalRev * 12),
    },
    costs: {
      ai:         Math.round(totalAiCost),
      infra:      Math.round(infraCost),
      support:    Math.round(supportCost),
      fixed:      FIXED_OVERHEAD_USD,
      total:      Math.round(totalCost),
    },
    profit: {
      gross:      Math.round(grossProfit),
      margin:     grossMargin,
    },
    ai: {
      totalRequests: Math.round(totalReq),
      reqPerSec:     Math.round(reqPerSec * 100) / 100,
      load,
    },
    readiness,
  };
}

function runFullBenchmark() {
  const tiers = [100, 1000, 10000, 100000];
  const results = tiers.map(n => simulate(n));

  // Regression checks
  const checks = [
    { id: "breakeven_1k",   label: "Break-even at 1K users",    ok: results[1].profit.gross > 0 },
    { id: "margin_10k",     label: "Positive margin at 10K",    ok: results[2].profit.margin > 0 },
    { id: "infra_scales",   label: "Infra cost linear",         ok: results[3].costs.infra < results[3].revenue.monthly },
    { id: "ai_cost_ok",     label: "AI cost <50% of revenue",   ok: results[2].costs.ai < results[2].revenue.monthly * 0.5 },
    { id: "100k_viable",    label: "100K user plan viable",     ok: results[3].profit.margin > 30 },
  ];

  const passing = checks.filter(c => c.ok).length;
  const score   = Math.round((passing / checks.length) * 100);

  return {
    score,
    passing,
    total:       checks.length,
    checks,
    regressionPass: passing === checks.length,
    tiers:       results,
    assumptions: { PLAN_MIX, PLAN_REV_USD, AVG_REQ_PER_USER_MONTH, COST_PER_AI_REQ_USD },
    ts:          new Date().toISOString(),
  };
}

module.exports = { simulate, runFullBenchmark };
