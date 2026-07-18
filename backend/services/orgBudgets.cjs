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

/**
 * Check whether an org and/or workspace is within budget. Both are checked
 * independently when both ids are supplied — either one failing blocks the
 * request (a workspace budget is meant to be a tighter sub-cap within its
 * org's budget, not an alternative to it).
 *
 * @returns {{ allowed: bool, reason?: string, org?: object, workspace?: object }}
 */
function checkBudget({ orgId, workspaceId } = {}) {
  const result = { allowed: true };

  if (orgId) {
    const budget = getOrgBudget(orgId);
    const spend  = _spendThisMonth("orgId", orgId);
    result.org = { orgId, ...budget, spentUsd: spend.costUsd, spentRequests: spend.requests };
    if (budget.monthlyCapUsd != null && spend.costUsd >= budget.monthlyCapUsd) {
      result.allowed = false;
      result.reason = `Organization monthly AI budget exceeded ($${spend.costUsd.toFixed(6)} / $${budget.monthlyCapUsd})`;
    }
    if (result.allowed && budget.monthlyRequestCap != null && spend.requests >= budget.monthlyRequestCap) {
      result.allowed = false;
      result.reason = `Organization monthly AI request cap exceeded (${spend.requests} / ${budget.monthlyRequestCap})`;
    }
  }

  if (result.allowed && workspaceId) {
    const budget = getWorkspaceBudget(workspaceId);
    const spend  = _spendThisMonth("workspaceId", workspaceId);
    result.workspace = { workspaceId, ...budget, spentUsd: spend.costUsd, spentRequests: spend.requests };
    if (budget.monthlyCapUsd != null && spend.costUsd >= budget.monthlyCapUsd) {
      result.allowed = false;
      result.reason = `Workspace monthly AI budget exceeded ($${spend.costUsd.toFixed(6)} / $${budget.monthlyCapUsd})`;
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
};
