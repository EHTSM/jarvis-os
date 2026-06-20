"use strict";
/**
 * Referral Engine — invite users, track referrals, issue credit rewards.
 *
 * Reward tiers:
 *   - Referred user starts trial → referrer gets 50 credits
 *   - Referred user upgrades to paid → referrer gets 200 credits + 1 month free
 *
 * Storage: data/referrals.json
 */

const fs           = require("fs");
const path         = require("path");
const creditEngine = require("./creditEngine.cjs");

const STORE_FILE = path.join(__dirname, "../../data/referrals.json");

const REWARDS = {
  trial_signup: { credits: 50,  label: "Trial signup",    description: "+50 credits when friend starts trial" },
  paid_upgrade: { credits: 200, label: "Paid conversion", description: "+200 credits + 1 month free" },
};

function _load() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return { refs: {}, codes: {} }; }
}
function _save(d) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}
function _genCode(accountId) {
  return `ooplix-${accountId.slice(-4)}-${Math.random().toString(36).slice(2,6)}`.toUpperCase();
}

// ── Create / get referral code ─────────────────────────────────────

function getOrCreateCode(accountId) {
  const store = _load();
  if (!store.refs[accountId]) {
    const code = _genCode(accountId);
    store.refs[accountId] = {
      accountId, code,
      createdAt:   new Date().toISOString(),
      invites:     [],
      totalEarned: 0,
      pendingCredits: 0,
    };
    store.codes[code] = accountId;
    _save(store);
  }
  return store.refs[accountId];
}

function getCode(accountId) { return _load().refs[accountId] || null; }

// ── Track invite usage ─────────────────────────────────────────────

function useCode(code, invitedAccountId) {
  const store    = _load();
  const referrerId = store.codes[code.toUpperCase()];
  if (!referrerId) return { ok: false, error: "Invalid referral code" };
  if (referrerId === invitedAccountId) return { ok: false, error: "Cannot refer yourself" };

  const ref = store.refs[referrerId];
  if (!ref) return { ok: false, error: "Referrer not found" };

  // Prevent duplicate
  if (ref.invites.find(i => i.accountId === invitedAccountId)) {
    return { ok: false, error: "Already used this referral" };
  }

  ref.invites.push({
    accountId: invitedAccountId,
    usedAt:    new Date().toISOString(),
    status:    "trial",
    reward:    null,
  });
  _save(store);

  // Issue trial reward
  return _issueReward(store, referrerId, invitedAccountId, "trial_signup");
}

function _issueReward(store, referrerId, invitedId, type) {
  const reward = REWARDS[type];
  const ref    = store.refs[referrerId];
  if (!ref) return { ok: false };
  const invite = ref.invites.find(i => i.accountId === invitedId);
  if (invite) {
    invite.status = type === "paid_upgrade" ? "paid" : "trial";
    invite.reward = { type, credits: reward.credits, issuedAt: new Date().toISOString() };
  }
  ref.totalEarned    += reward.credits;
  ref.pendingCredits += reward.credits;
  _save(store);
  return { ok: true, referrerId, reward, type };
}

function upgradedReferral(invitedAccountId) {
  const store = _load();
  // Find who referred this user
  for (const [refId, ref] of Object.entries(store.refs)) {
    const invite = ref.invites.find(i => i.accountId === invitedAccountId && i.status === "trial");
    if (invite) {
      return _issueReward(store, refId, invitedAccountId, "paid_upgrade");
    }
  }
  return { ok: false, note: "No referrer found" };
}

function getDashboard(accountId) {
  const ref = getOrCreateCode(accountId);
  const invites = ref.invites || [];
  return {
    code:     ref.code,
    link:     `https://ooplix.com/signup?ref=${ref.code}`,
    invites:  invites.length,
    trials:   invites.filter(i => i.status === "trial").length,
    paid:     invites.filter(i => i.status === "paid").length,
    totalEarned: ref.totalEarned || 0,
    pendingCredits: ref.pendingCredits || 0,
    rewards: REWARDS,
  };
}

function getLeaderboard() {
  const store = _load();
  return Object.values(store.refs)
    .map(r => ({ accountId: r.accountId, invites: r.invites.length, totalEarned: r.totalEarned || 0 }))
    .sort((a,b) => b.totalEarned - a.totalEarned)
    .slice(0, 20);
}

function redeemCredits(accountId) {
  const store = _load();
  const ref   = store.refs[accountId];
  if (!ref || !ref.pendingCredits) return { ok: false, credits: 0 };
  const credits = ref.pendingCredits;
  ref.pendingCredits = 0;
  _save(store);
  // Directly issue credits to the account via creditEngine
  try {
    creditEngine.topup(accountId, credits, { reason: "referral_reward" });
  } catch (_) { /* creditEngine unavailable — credits already zeroed, log and continue */ }
  return { ok: true, credits };
}

module.exports = { getOrCreateCode, getCode, useCode, upgradedReferral, getDashboard, getLeaderboard, redeemCredits, REWARDS };
