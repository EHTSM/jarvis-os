"use strict";
/**
 * Launch Metrics — aggregates data for the executive dashboard.
 *
 * Pulls from: billing, creditEngine, usageMetering, local-accounts, sessions.
 * Computes: MRR, ARR, beta users, active users, retention, activation, NPS.
 *
 * Storage: data/launch-metrics.json (rolling snapshots)
 */

const fs   = require("fs");
const path = require("path");

const SNAP_FILE  = path.join(__dirname, "../../data/launch-metrics.json");
const NPS_FILE   = path.join(__dirname, "../../data/nps-responses.json");

// INR monthly prices (from billingService)
const PLAN_MRR_INR = { trial: 0, starter: 999, growth: 2499, scale: 9999 };
// USD approximate (1 USD ≈ 83 INR)
const INR_TO_USD = 1 / 83;

function _load(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return {}; }
}
function _save(file, d) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}

// ── Billing data ───────────────────────────────────────────────────

function _getBillingData() {
  const billing = _load(path.join(__dirname, "../../data/billing.json"));
  const accounts = Object.values(billing);
  const byPlan = { trial: 0, starter: 0, growth: 0, scale: 0 };
  let mrrInr = 0;

  for (const a of accounts) {
    const plan = a.plan || "trial";
    byPlan[plan] = (byPlan[plan] || 0) + 1;
    mrrInr += PLAN_MRR_INR[plan] || 0;
  }

  return { accounts, byPlan, mrrInr, mrrUsd: Math.round(mrrInr * INR_TO_USD) };
}

// ── User data ──────────────────────────────────────────────────────

function _getUserData() {
  const accounts = _load(path.join(__dirname, "../../data/local-accounts.json"));
  const list     = Array.isArray(accounts) ? accounts : Object.values(accounts);
  const now      = Date.now();
  const day7ago  = now - 7  * 24 * 3600 * 1000;
  const day30ago = now - 30 * 24 * 3600 * 1000;

  let betaUsers = 0, activeWeek = 0, activeMonth = 0;
  for (const u of list) {
    if (u.betaUser || u.plan === "trial") betaUsers++;
    const lastSeen = u.lastSeen ? new Date(u.lastSeen).getTime() : 0;
    if (lastSeen > day7ago)  activeWeek++;
    if (lastSeen > day30ago) activeMonth++;
  }

  return { total: list.length, betaUsers, activeWeek, activeMonth };
}

// ── Credit / AI usage ──────────────────────────────────────────────

function _getUsageData() {
  try {
    const ledger  = _load(path.join(__dirname, "../../data/credit-ledger.json"));
    const records = Object.values(ledger);
    let totalUsed = 0, totalRequests = 0;
    for (const r of records) {
      totalUsed    += r.totalUsed    || 0;
      totalRequests += r.totalRequests || 0;
    }
    return { totalCreditsUsed: totalUsed, totalAiRequests: totalRequests };
  } catch { return { totalCreditsUsed: 0, totalAiRequests: 0 }; }
}

// ── NPS ────────────────────────────────────────────────────────────

function submitNPS(opts = {}) {
  const store = _load(NPS_FILE) || { responses: [] };
  if (!store.responses) store.responses = [];
  store.responses.push({
    score: opts.score, comment: opts.comment || "",
    accountId: opts.accountId || null,
    ts: new Date().toISOString(),
  });
  _save(NPS_FILE, store);
}

function getNPS() {
  const store   = _load(NPS_FILE) || { responses: [] };
  const resps   = store.responses || [];
  if (!resps.length) return { score: null, promoters: 0, detractors: 0, passives: 0, responses: 0 };
  const promoters  = resps.filter(r => r.score >= 9).length;
  const detractors = resps.filter(r => r.score <= 6).length;
  const passives   = resps.length - promoters - detractors;
  const nps        = Math.round(((promoters - detractors) / resps.length) * 100);
  return { score: nps, promoters, detractors, passives, responses: resps.length };
}

// ── Activation (users who completed onboarding) ────────────────────

function _getActivation() {
  try {
    const ob = _load(path.join(__dirname, "../../data/onboarding-state.json"));
    const all = Object.values(ob || {});
    const activated = all.filter(s => s.completed).length;
    return { activated, total: all.length, rate: all.length ? Math.round((activated / all.length) * 100) : 0 };
  } catch { return { activated: 0, total: 0, rate: 0 }; }
}

// ── Retention ──────────────────────────────────────────────────────

function _getRetention(users) {
  // Simple 7-day retention estimate
  const rate = users.total > 0 ? Math.round((users.activeWeek / users.total) * 100) : 0;
  return { day7: rate, day30: users.total > 0 ? Math.round((users.activeMonth / users.total) * 100) : 0 };
}

// ── Master snapshot ────────────────────────────────────────────────

function getSnapshot() {
  const billing  = _getBillingData();
  const users    = _getUserData();
  const usage    = _getUsageData();
  const nps      = getNPS();
  const activation = _getActivation();
  const retention  = _getRetention(users);

  const snap = {
    ts:          new Date().toISOString(),
    users: {
      total:       users.total,
      beta:        users.betaUsers,
      activeWeek:  users.activeWeek,
      activeMonth: users.activeMonth,
    },
    revenue: {
      mrrInr:    billing.mrrInr,
      mrrUsd:    billing.mrrUsd,
      arrUsd:    billing.mrrUsd * 12,
      byPlan:    billing.byPlan,
    },
    ai: {
      totalCreditsUsed: usage.totalCreditsUsed,
      totalAiRequests:  usage.totalAiRequests,
    },
    retention,
    activation,
    nps,
  };

  // Persist rolling snapshot (keep last 30)
  const snaps = _load(SNAP_FILE) || { snapshots: [] };
  if (!snaps.snapshots) snaps.snapshots = [];
  snaps.snapshots.unshift(snap);
  snaps.snapshots = snaps.snapshots.slice(0, 30);
  _save(SNAP_FILE, snaps);

  return snap;
}

function getHistory(limit = 10) {
  const snaps = _load(SNAP_FILE) || { snapshots: [] };
  return (snaps.snapshots || []).slice(0, limit);
}

module.exports = { getSnapshot, getHistory, submitNPS, getNPS };
