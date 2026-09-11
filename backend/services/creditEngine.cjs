"use strict";
/**
 * Credit Engine — AI Credit management for Ooplix.
 *
 * Credit types:
 *   free      — refreshed daily, per plan limits
 *   premium   — purchased add-on packs, expire on expiry date
 *   byok      — Bring Your Own Key; unlimited, billed directly to user's provider
 *   local     — Ollama / local models; no credit cost
 *
 * Storage: data/credit-ledger.json
 * Schema:  { [accountId]: LedgerRecord }
 *
 * LedgerRecord: {
 *   accountId:   string
 *   free:        { balance: int, dailyLimit: int, refreshedAt: ISO }
 *   premium:     { balance: int, expiresAt: ISO | null }
 *   byok:        { enabled: bool, key_hash: string | null }
 *   local:       { enabled: bool }
 *   transactions: TransactionEntry[]   // last 200
 * }
 *
 * TransactionEntry: {
 *   id:          string
 *   ts:          ISO
 *   type:        "consume" | "refund" | "topup" | "refresh"
 *   creditType:  "free" | "premium" | "byok" | "local"
 *   amount:      int   (negative = consumed, positive = added)
 *   reason:      string
 *   missionId:   string | null
 *   provider:    string | null
 * }
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const LEDGER_FILE = path.join(__dirname, "../../data/credit-ledger.json");

// ── Daily free credit limits per plan ────────────────────────────
const PLAN_FREE_CREDITS = {
  trial:   20,
  starter: 100,
  growth:  500,
  scale:   2000,
};

// ── Cost per request type (in credits) ───────────────────────────
const CREDIT_COSTS = {
  "coding/ask":    2,
  "coding/action": 1,
  "coding/review": 3,
  chat:            1,
  mission:         5,
  completion:      1,
  default:         2,
};

function _genId() {
  return `cr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function _load() {
  try { return JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8")); }
  catch { return {}; }
}

function _save(data) {
  try {
    fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(data, null, 2));
  } catch (e) { logger.error("[CreditEngine] persist failed:", e.message); }
}

// ── Helpers ───────────────────────────────────────────────────────

function _isToday(isoStr) {
  if (!isoStr) return false;
  const d = new Date(isoStr);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() &&
         d.getMonth()    === n.getMonth()    &&
         d.getDate()     === n.getDate();
}

function _ensureRecord(records, accountId, plan = "trial") {
  if (!records[accountId]) {
    const dailyLimit = PLAN_FREE_CREDITS[plan] || PLAN_FREE_CREDITS.trial;
    records[accountId] = {
      accountId,
      free:         { balance: dailyLimit, dailyLimit, refreshedAt: new Date().toISOString() },
      premium:      { balance: 0, expiresAt: null },
      byok:         { enabled: false, key_hash: null },
      local:        { enabled: false },
      transactions: [],
    };
  }
  return records[accountId];
}

function _refreshFree(rec, plan = "trial") {
  const daily = PLAN_FREE_CREDITS[plan] || PLAN_FREE_CREDITS.trial;
  if (!_isToday(rec.free.refreshedAt)) {
    rec.free.dailyLimit  = daily;
    rec.free.balance     = daily;
    rec.free.refreshedAt = new Date().toISOString();
    rec.transactions.push({
      id: _genId(), ts: new Date().toISOString(),
      type: "refresh", creditType: "free",
      amount: daily, reason: "daily_refresh",
      missionId: null, provider: null,
    });
  } else {
    rec.free.dailyLimit = daily; // update limit on plan change
  }
}

function _pushTx(rec, entry) {
  rec.transactions = [entry, ...rec.transactions].slice(0, 200);
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Get or create ledger record for an account.
 */
function getRecord(accountId, plan = "trial") {
  const records = _load();
  const rec = _ensureRecord(records, accountId, plan);
  _refreshFree(rec, plan);
  _save(records);
  return rec;
}

/**
 * Check available credit for an account.
 * Returns { canProceed, source, balance, cost }
 *
 * `local.enabled` only waives cost when the caller confirms (via
 * opts.localProviderAvailable) that the request will actually be served by a
 * real local/free provider for the requested capability. Without that
 * confirmation the flag is ignored and normal billing applies — local mode
 * is "route this to my free local model," not a blanket billing waiver, and
 * whether a local provider exists for a given capability is a routing-layer
 * fact (capabilityRouter/creativeRouter), not something this ledger can
 * verify on its own.
 */
function checkCredit(accountId, requestType = "default", plan = "trial", opts = {}) {
  const records = _load();
  const rec = _ensureRecord(records, accountId, plan);
  _refreshFree(rec, plan);
  _save(records);

  const cost = CREDIT_COSTS[requestType] || CREDIT_COSTS.default;

  // BYOK never consumes credits — billed directly to the user's own key.
  if (rec.byok.enabled) return { canProceed: true, source: "byok",  balance: Infinity, cost: 0 };
  if (rec.local.enabled && opts.localProviderAvailable) {
    return { canProceed: true, source: "local", balance: Infinity, cost: 0 };
  }

  // Premium credits (check expiry)
  if (rec.premium.balance > 0) {
    const expired = rec.premium.expiresAt && new Date(rec.premium.expiresAt) < new Date();
    if (!expired && rec.premium.balance >= cost) {
      return { canProceed: true, source: "premium", balance: rec.premium.balance, cost };
    }
  }

  // Free credits
  if (rec.free.balance >= cost) {
    return { canProceed: true, source: "free", balance: rec.free.balance, cost };
  }

  return { canProceed: false, source: "none", balance: 0, cost, reason: "insufficient_credits" };
}

/**
 * Reserve (check-and-deduct in one synchronous pass) credits for a request
 * that is about to start slow work (e.g. a real paid provider call).
 *
 * checkCredit() and consume() are each individually atomic (this module has
 * no `await` between its own load/save calls, so under Node's single-threaded
 * event loop no other request can interleave mid-call) — but a caller that
 * calls checkCredit(), then `await`s slow work, then calls consume()
 * afterward reintroduces a real TOCTOU gap: N concurrent requests can all
 * pass the check against the same starting balance before any of their slow
 * awaits finish and their consume() calls fire, letting all N proceed even
 * when the account can only afford a fraction of them (verified: 25
 * concurrent check→await→consume-style calls against a balance of 20 all
 * proceeded). reserve() closes that gap by doing the check and the deduction
 * in the same synchronous pass, before the caller's slow work starts — call
 * this instead of checkCredit() whenever slow/async work happens between the
 * check and the eventual consume.
 *
 * Returns { ok, tx?, creditType?, cost, canProceed, source, balance }.
 * If ok is false, no state was mutated (nothing to refund).
 */
function reserve(accountId, requestType = "default", opts = {}) {
  const check = checkCredit(accountId, requestType, opts.plan || "trial", opts);
  if (!check.canProceed) return { ok: false, canProceed: false, ...check };
  const result = consume(accountId, requestType, opts);
  return { ok: true, canProceed: true, ...result, ...check, cost: result.cost };
}

/**
 * Consume credits for a request. Returns the transaction entry.
 * Same localProviderAvailable gate as checkCredit — see its doc comment.
 *
 * NOTE: consume() alone does not re-check the balance — a caller that
 * checked earlier and now wants to commit that reservation after slow work
 * completed should use reserve() up front instead so the check and the
 * deduction happen in the same atomic pass (see reserve() doc comment).
 */
function consume(accountId, requestType = "default", opts = {}) {
  const records  = _load();
  const rec      = _ensureRecord(records, accountId, opts.plan || "trial");
  _refreshFree(rec, opts.plan || "trial");

  const cost = opts.cost ?? (CREDIT_COSTS[requestType] || CREDIT_COSTS.default);

  let creditType = "free";
  if (rec.byok.enabled) { creditType = "byok"; }
  else if (rec.local.enabled && opts.localProviderAvailable) { creditType = "local"; }
  else if (rec.premium.balance >= cost && !(rec.premium.expiresAt && new Date(rec.premium.expiresAt) < new Date())) {
    creditType = "premium";
    rec.premium.balance = Math.max(0, rec.premium.balance - cost);
  } else {
    rec.free.balance = Math.max(0, rec.free.balance - cost);
  }

  const tx = {
    id: _genId(), ts: new Date().toISOString(),
    type: "consume", creditType,
    amount: -cost, reason: requestType,
    missionId: opts.missionId || null,
    provider:  opts.provider  || null,
  };
  _pushTx(rec, tx);
  _save(records);
  return { tx, creditType, cost };
}

/**
 * Add premium credits (from purchase or admin grant).
 */
function topup(accountId, amount, opts = {}) {
  const records = _load();
  const rec = _ensureRecord(records, accountId, opts.plan || "trial");
  rec.premium.balance += amount;
  if (opts.expiresAt) rec.premium.expiresAt = opts.expiresAt;
  const tx = {
    id: _genId(), ts: new Date().toISOString(),
    type: "topup", creditType: "premium",
    amount, reason: opts.reason || "purchase",
    missionId: null, provider: null,
  };
  _pushTx(rec, tx);
  _save(records);
  return rec;
}

/**
 * Refund credits (e.g. failed request).
 */
function refund(accountId, txId, opts = {}) {
  const records = _load();
  const rec = _ensureRecord(records, accountId, "trial");
  const original = rec.transactions.find(t => t.id === txId);
  if (!original) return null;
  const refundAmt = Math.abs(original.amount);
  if (original.creditType === "premium") rec.premium.balance += refundAmt;
  else if (original.creditType === "free") rec.free.balance += refundAmt;
  const tx = {
    id: _genId(), ts: new Date().toISOString(),
    type: "refund", creditType: original.creditType,
    amount: refundAmt, reason: opts.reason || "refund",
    missionId: original.missionId, provider: original.provider,
  };
  _pushTx(rec, tx);
  _save(records);
  return tx;
}

/**
 * Enable/disable BYOK mode.
 */
function setBYOK(accountId, enabled, key_hash = null) {
  const records = _load();
  const rec = _ensureRecord(records, accountId, "trial");
  rec.byok.enabled  = enabled;
  rec.byok.key_hash = key_hash;
  _save(records);
  return rec.byok;
}

/**
 * Enable/disable local (Ollama) mode.
 */
function setLocal(accountId, enabled) {
  const records = _load();
  const rec = _ensureRecord(records, accountId, "trial");
  rec.local.enabled = enabled;
  _save(records);
  return rec.local;
}

/**
 * Get ledger for an account (last N transactions).
 */
function getLedger(accountId, limit = 50) {
  const records = _load();
  const rec = _ensureRecord(records, accountId, "trial");
  return {
    ...rec,
    transactions: rec.transactions.slice(0, limit),
  };
}

/**
 * Get all accounts summary (for admin).
 */
function getAllSummary() {
  const records = _load();
  return Object.values(records).map(r => ({
    accountId:      r.accountId,
    freeBalance:    r.free.balance,
    premiumBalance: r.premium.balance,
    byok:           r.byok.enabled,
    local:          r.local.enabled,
    txCount:        r.transactions.length,
  }));
}

module.exports = {
  getRecord,
  checkCredit,
  reserve,
  consume,
  topup,
  refund,
  setBYOK,
  setLocal,
  getLedger,
  getAllSummary,
  PLAN_FREE_CREDITS,
  CREDIT_COSTS,
};
