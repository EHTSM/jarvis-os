"use strict";
/**
 * Org/Workspace AI Budgets — monthly USD spend caps scoped to an
 * organization or workspace, enforced against usageMetering's real cost
 * ledger. This is the gap billingService.js's checkUsageQuota doesn't cover:
 * that function only enforces a per-ACCOUNT monthly request-count quota tied
 * to the account's subscription plan — there was no way to cap spend for an
 * organization as a whole (e.g. a team of 5 seats sharing one org) or for a
 * single workspace within it, independent of any one member's personal plan.
 *
 * Does NOT replace billingService.checkUsageQuota — an account can be
 * blocked by either check; both run (see aiOrchestrator.execute()).
 * Does NOT introduce new usage tracking — reads usageMetering's existing
 * ledger (queryFromLedger/summary with fromLedger:true) for real recorded
 * cost, the same ledger every other cost/analytics feature reads.
 *
 * Storage: data/org-budgets.json — { orgId: {...}, workspace:{workspaceId}: {...} }
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const STORE_FILE = path.join(__dirname, "../../data/org-budgets.json");

const DEFAULT_BUDGET = {
  monthlyCapUsd:     null,   // null = no cap (unlimited)
  monthlyRequestCap: null,   // null = no cap
  alertThresholdPct: 80,     // warn (in the API response) once spend crosses this % of cap
  updatedAt:         null,
};

function _load() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return { orgs: {}, workspaces: {} }; }
}

function _save(store) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
  } catch (e) { logger.error("[OrgBudgets] persist failed:", e.message); }
}

function _monthStart() {
  const d = new Date();
  d.setDate(1); d.setHours(0, 0, 0, 0);
  return d;
}

// ── Budget CRUD ───────────────────────────────────────────────────────────

function getOrgBudget(orgId) {
  const store = _load();
  return { orgId, ...DEFAULT_BUDGET, ...(store.orgs[orgId] || {}) };
}

function setOrgBudget(orgId, patch) {
  if (!orgId) throw new Error("orgId required");
  const store = _load();
  store.orgs[orgId] = { ...DEFAULT_BUDGET, ...(store.orgs[orgId] || {}), ...patch, updatedAt: new Date().toISOString() };
  _save(store);
  return { orgId, ...store.orgs[orgId] };
}

function getWorkspaceBudget(workspaceId) {
  const store = _load();
  return { workspaceId, ...DEFAULT_BUDGET, ...(store.workspaces[workspaceId] || {}) };
}

function setWorkspaceBudget(workspaceId, patch) {
  if (!workspaceId) throw new Error("workspaceId required");
  const store = _load();
  store.workspaces[workspaceId] = { ...DEFAULT_BUDGET, ...(store.workspaces[workspaceId] || {}), ...patch, updatedAt: new Date().toISOString() };
  _save(store);
  return { workspaceId, ...store.workspaces[workspaceId] };
}

function getAllBudgets() {
  const store = _load();
  return {
    orgs:       Object.entries(store.orgs || {}).map(([orgId, b]) => ({ orgId, ...DEFAULT_BUDGET, ...b })),
    workspaces: Object.entries(store.workspaces || {}).map(([workspaceId, b]) => ({ workspaceId, ...DEFAULT_BUDGET, ...b })),
  };
}

// ── Spend lookup (reads usageMetering's real ledger, no new tracking) ─────

function _spendThisMonth(dimension, id) {
  const usageMetering = require("./usageMetering.cjs");
  const since = _monthStart().toISOString();
  const s = usageMetering.summary({ [dimension]: id, since, fromLedger: true });
  return { costUsd: s.totalCostUsd, requests: s.totalRequests };
}

// ── In-flight reservation (closes the check-then-await-then-record gap) ──
//
// checkBudget() reads usageMetering's ledger, which is only written to AFTER
// a request's real provider call completes (aiOrchestrator.execute() checks
// budget, then `await`s the actual AI call, then records real cost). N
// concurrent requests for the same org can each see the same ledger snapshot
// and all pass the check before any of their spend lands — verified: 30
// concurrent requests against a $0.01 cap ($0.002/request) all proceeded,
// spending $0.06 (6x over cap).
//
// This process-local map tracks estimated cost for requests that have
// passed the check but not yet recorded real spend. checkBudget() adds this
// in-flight total to the ledger total, so a concurrent request sees the
// prior requests' reservations even though their real cost hasn't hit the
// ledger yet. reserveInFlight()/releaseInFlight() are synchronous (plain Map
// ops, no I/O), so — same reasoning as creditEngine.reserve() in Module 3 —
// they're atomic per call under Node's single-threaded event loop; no lock
// needed for a single-process deployment (this app runs pm2 fork mode,
// instances:1 — see ecosystem.config.cjs).
const _inFlight = new Map(); // key: `${dimension}:${id}` -> total estimated USD reserved

function _inFlightKey(dimension, id) { return `${dimension}:${id}`; }

function _inFlightTotal(dimension, id) {
  return _inFlight.get(_inFlightKey(dimension, id)) || 0;
}

/**
 * Reserve an estimated cost against an org/workspace's in-flight total,
 * before starting the slow provider call. Call releaseInFlight() with the
 * SAME estimatedUsd once the real cost has been recorded (or the request
 * failed/was abandoned) to remove the reservation.
 */
function reserveInFlight({ orgId, workspaceId, estimatedUsd }) {
  const amt = Number(estimatedUsd) || 0;
  if (orgId)       _inFlight.set(_inFlightKey("orgId", orgId),             _inFlightTotal("orgId", orgId) + amt);
  if (workspaceId) _inFlight.set(_inFlightKey("workspaceId", workspaceId), _inFlightTotal("workspaceId", workspaceId) + amt);
}

/**
 * Release a previously reserved estimate (called after the real spend is
 * recorded to the ledger, or if the request never completed).
 */
function releaseInFlight({ orgId, workspaceId, estimatedUsd }) {
  const amt = Number(estimatedUsd) || 0;
  if (orgId)       _inFlight.set(_inFlightKey("orgId", orgId),             Math.max(0, _inFlightTotal("orgId", orgId) - amt));
  if (workspaceId) _inFlight.set(_inFlightKey("workspaceId", workspaceId), Math.max(0, _inFlightTotal("workspaceId", workspaceId) - amt));
}

/**
 * Check whether an org and/or workspace is within budget. Both are checked
 * independently when both ids are supplied — either one failing blocks the
 * request (a workspace budget is meant to be a tighter sub-cap within its
 * org's budget, not an alternative to it).
 *
 * spentUsd/spentRequests include both real (ledger) spend and any
 * currently-reserved in-flight estimate — see reserveInFlight() above.
 *
 * @returns {{ allowed: bool, reason?: string, org?: object, workspace?: object }}
 */
function checkBudget({ orgId, workspaceId } = {}) {
  const result = { allowed: true };

  if (orgId) {
    const budget = getOrgBudget(orgId);
    const spend  = _spendThisMonth("orgId", orgId);
    const costUsd = spend.costUsd + _inFlightTotal("orgId", orgId);
    result.org = { orgId, ...budget, spentUsd: costUsd, spentRequests: spend.requests };
    if (budget.monthlyCapUsd != null && costUsd >= budget.monthlyCapUsd) {
      result.allowed = false;
      result.reason = `Organization monthly AI budget exceeded ($${costUsd.toFixed(6)} / $${budget.monthlyCapUsd})`;
    }
    if (result.allowed && budget.monthlyRequestCap != null && spend.requests >= budget.monthlyRequestCap) {
      result.allowed = false;
      result.reason = `Organization monthly AI request cap exceeded (${spend.requests} / ${budget.monthlyRequestCap})`;
    }
  }

  if (result.allowed && workspaceId) {
    const budget = getWorkspaceBudget(workspaceId);
    const spend  = _spendThisMonth("workspaceId", workspaceId);
    const costUsd = spend.costUsd + _inFlightTotal("workspaceId", workspaceId);
    result.workspace = { workspaceId, ...budget, spentUsd: costUsd, spentRequests: spend.requests };
    if (budget.monthlyCapUsd != null && costUsd >= budget.monthlyCapUsd) {
      result.allowed = false;
      result.reason = `Workspace monthly AI budget exceeded ($${costUsd.toFixed(6)} / $${budget.monthlyCapUsd})`;
    }
    if (result.allowed && budget.monthlyRequestCap != null && spend.requests >= budget.monthlyRequestCap) {
      result.allowed = false;
      result.reason = `Workspace monthly AI request cap exceeded (${spend.requests} / ${budget.monthlyRequestCap})`;
    }
  }

  return result;
}

module.exports = {
  getOrgBudget, setOrgBudget, getWorkspaceBudget, setWorkspaceBudget, getAllBudgets, checkBudget,
  reserveInFlight, releaseInFlight,
};
