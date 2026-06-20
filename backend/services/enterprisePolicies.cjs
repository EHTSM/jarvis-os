"use strict";
/**
 * Enterprise Policies — allowed models, blocked models, cost ceilings,
 *                       country restrictions, privacy rules.
 *
 * Storage: data/enterprise-policies.json
 * Schema: { [orgId]: Policy }
 *
 * Policy: {
 *   allowedProviders:  string[]  // empty = allow all
 *   blockedProviders:  string[]
 *   allowedModels:     string[]  // "provider/model" or "provider/*"
 *   blockedModels:     string[]
 *   maxCostPer1kUsd:   number
 *   maxCostPerDayUsd:  number
 *   allowedCountries:  string[]  // ISO-3166 alpha-2; empty = no restriction
 *   blockedCountries:  string[]
 *   privacyRules: {
 *     noDataRetention:   bool   // don't send to providers that retain data
 *     requireEncryption: bool
 *     localOnlyModels:   string[]   // capabilities that must use local
 *   }
 *   modelMinQuality:   number   // 0-1, default 0
 *   requireApprovalAboveCost: number  // per-request USD, require human approval
 * }
 */

const fs   = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "../../data/enterprise-policies.json");

// ── Data retention classification ─────────────────────────────────
// Providers known to NOT retain data by default
const NO_RETENTION_PROVIDERS = new Set(["ollama","lmstudio","anthropic","openai"]);

const DEFAULT_POLICY = {
  allowedProviders:  [],
  blockedProviders:  [],
  allowedModels:     [],
  blockedModels:     [],
  maxCostPer1kUsd:   0.10,
  maxCostPerDayUsd:  50,
  allowedCountries:  [],
  blockedCountries:  [],
  privacyRules: {
    noDataRetention:   false,
    requireEncryption: false,
    localOnlyModels:   [],
  },
  modelMinQuality:   0,
  requireApprovalAboveCost: null,
};

function _load() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return {}; }
}

function _save(d) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}

// ── Public API ────────────────────────────────────────────────────

function getPolicy(orgId = "default") {
  const store = _load();
  return { ...DEFAULT_POLICY, ...(store[orgId] || {}) };
}

function setPolicy(orgId = "default", patch) {
  const store  = _load();
  const existing = store[orgId] || {};
  store[orgId] = {
    ...DEFAULT_POLICY,
    ...existing,
    ...patch,
    privacyRules: { ...DEFAULT_POLICY.privacyRules, ...(existing.privacyRules || {}), ...(patch.privacyRules || {}) },
  };
  _save(store);
  return store[orgId];
}

function getAllPolicies() {
  const store = _load();
  return Object.entries(store).map(([orgId, p]) => ({ orgId, ...p }));
}

/**
 * Evaluate whether a routing decision passes enterprise policy.
 *
 * @param {object} opts  { providerId, modelId, capability, costPer1kUsd, country, orgId }
 * @returns {{ allowed: bool, violations: string[] }}
 */
function evaluate(opts = {}) {
  const policy    = getPolicy(opts.orgId || "default");
  const violations = [];

  const { providerId, modelId, capability, costPer1kUsd = 0, country } = opts;
  const modelKey = `${providerId}/${modelId}`;

  // Provider allow/block
  if (policy.allowedProviders.length && !policy.allowedProviders.includes(providerId)) {
    violations.push(`provider_not_allowed:${providerId}`);
  }
  if (policy.blockedProviders.includes(providerId)) {
    violations.push(`provider_blocked:${providerId}`);
  }

  // Model allow/block (supports "provider/*" wildcard)
  const modelAllowed = !policy.allowedModels.length || policy.allowedModels.some(p => {
    if (p.endsWith("/*")) return p.startsWith(providerId + "/");
    return p === modelKey;
  });
  if (!modelAllowed) violations.push(`model_not_allowed:${modelKey}`);

  const modelBlocked = policy.blockedModels.some(p => {
    if (p.endsWith("/*")) return p.startsWith(providerId + "/");
    return p === modelKey;
  });
  if (modelBlocked) violations.push(`model_blocked:${modelKey}`);

  // Cost ceiling
  if (costPer1kUsd > policy.maxCostPer1kUsd) {
    violations.push(`cost_ceiling_exceeded:${costPer1kUsd}>${policy.maxCostPer1kUsd}`);
  }

  // Country restrictions
  if (country) {
    if (policy.allowedCountries.length && !policy.allowedCountries.includes(country)) {
      violations.push(`country_not_allowed:${country}`);
    }
    if (policy.blockedCountries.includes(country)) {
      violations.push(`country_blocked:${country}`);
    }
  }

  // Privacy rules
  if (policy.privacyRules?.noDataRetention && !NO_RETENTION_PROVIDERS.has(providerId)) {
    violations.push(`data_retention_policy:${providerId}`);
  }
  if (policy.privacyRules?.localOnlyModels?.includes(capability) && providerId !== "ollama" && providerId !== "lmstudio") {
    violations.push(`local_only_required:${capability}`);
  }

  return { allowed: violations.length === 0, violations, policy: { orgId: opts.orgId || "default" } };
}

/**
 * Filter a list of provider candidates by enterprise policy.
 */
function filterCandidates(candidates, orgId = "default") {
  return candidates.filter(c => evaluate({ ...c, orgId }).allowed);
}

module.exports = { getPolicy, setPolicy, getAllPolicies, evaluate, filterCandidates, DEFAULT_POLICY };
