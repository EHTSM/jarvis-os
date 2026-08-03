"use strict";
/**
 * orgAiBrain.cjs — V5 Global AI Organization Platform, Module 1:
 * Organization AI Brain.
 *
 * A single org-scoped entry point for "ask the org's AI" — NOT a new AI
 * execution engine. Every real capability below is a thin, permission-
 * gated composition over services that already exist and are already
 * either org-scoped or org-scopable:
 *
 *   - aiOrchestrator.execute/executeStream/recommend/getProviderHealth —
 *     the real, single AI execution engine (fallback chains, capability
 *     routing, streaming, response caching). Already accepts orgId and,
 *     when passed, already runs the request through enterprisePolicies.cjs
 *     (org provider/model/cost/country gates) internally via
 *     buildFallbackChain — this file does NOT re-apply that policy check
 *     itself, since doing so would be a second, possibly-contradictory
 *     enforcement of the same rules.
 *   - usageMetering.record / queryFromLedger({orgId}) — the real,
 *     already-org-scoped AI cost/usage ledger. aiOrchestrator.execute
 *     already writes to it; this file's getUsage() just reads it back.
 *   - orgBudgets.checkBudget({orgId}) — real spend-cap enforcement,
 *     already invoked inside aiOrchestrator.execute/executeStream.
 *   - promptHistory.record/query({orgId}) — the real, already-org-scoped
 *     conversation history. aiOrchestrator.execute already records to it;
 *     this file's getHistory() just reads it back.
 *   - organizationService.hasPermission — the single real RBAC source of
 *     truth (Module 1 of the prior Enterprise mission's ACTIONS map).
 *     A new "use_ai" action is added there (member-level, matching
 *     create_mission's bar — using the org's AI is a normal-member
 *     capability, not an admin-only one).
 *
 * No new storage. No new execution runtime. No new provider routing.
 * No new usage ledger. No new conversation store.
 */

const _try = fn => { try { return fn(); } catch { return null; } };
const _orchestrator = () => _try(() => require("./aiOrchestrator.cjs"));
const _org = () => _try(() => require("./organizationService.cjs"));
const _usage = () => _try(() => require("./usageMetering.cjs"));
const _history = () => _try(() => require("./promptHistory.cjs"));
const _budgets = () => _try(() => require("./orgBudgets.cjs"));

function _assertCanUseAi(orgId, accountId) {
  if (!_org()?.hasPermission?.(orgId, accountId, "use_ai")) {
    const e = new Error("Forbidden — requires permission: use_ai");
    e.status = 403;
    throw e;
  }
}

/**
 * Org-scoped chat execution — the primary entry point. Thin wrapper over
 * aiOrchestrator.execute; the only things added here are the org
 * membership/permission gate and guaranteeing orgId always flows through
 * (so budget checks, enterprisePolicies, usage ledger, and history all
 * apply — a caller can't accidentally omit orgId and silently bypass them).
 */
async function ask(orgId, accountId, messages, opts = {}) {
  if (!orgId) throw new Error("orgId required");
  _assertCanUseAi(orgId, accountId);
  const orchestrator = _orchestrator();
  if (!orchestrator) throw new Error("aiOrchestrator unavailable");
  return orchestrator.execute(messages, { ...opts, orgId, accountId });
}

/** Streaming counterpart to ask(). */
async function askStream(orgId, accountId, messages, opts = {}, onChunk = () => {}) {
  if (!orgId) throw new Error("orgId required");
  _assertCanUseAi(orgId, accountId);
  const orchestrator = _orchestrator();
  if (!orchestrator) throw new Error("aiOrchestrator unavailable");
  return orchestrator.executeStream(messages, { ...opts, orgId, accountId }, onChunk);
}

// Autonomous Learning Engine V2 — real historical re-ranking. Confirmed
// genuinely missing before this: recommend() only ever returned
// aiOrchestrator's on-paper ranking (cost/quality/latencyClass) plus a
// live reachability probe — no read of any stored outcome data anywhere
// in this file. usageMetering.queryFromLedger({orgId}) is this org's
// already-real, already-org-scoped usage ledger (the exact same store
// getUsage() above reads), and every recorded event already carries a
// real `success` boolean (see aiOrchestrator.cjs:425/449) — this reuses
// that data, it does not add a second usage-tracking mechanism.
const MIN_EVENTS_FOR_RERANK = 5;
const MAX_SCORE_ADJUSTMENT  = 0.2;

function _providerHistoricalSuccessRate(orgId, providerId) {
  const usage = _usage();
  if (!usage) return null;
  const events = usage.queryFromLedger?.({ orgId, provider: providerId, maxScan: 2000 }) || [];
  if (events.length < MIN_EVENTS_FOR_RERANK) return null;
  const successCount = events.filter(e => e.success !== false).length;
  return { successRate: successCount / events.length, sampleSize: events.length };
}

/** Provider/model recommendation for a capability — read-only, no
 * execution, so it only needs membership, not the full use_ai gate.
 * aiOrchestrator.recommend() is async (it live-probes each top candidate's
 * reachability) and returns a plain ranked array directly (not
 * {candidates: [...]}) — awaited and wrapped here under a "candidates" key
 * so the route's response shape is self-describing JSON, not a bare array
 * or (the bug this fixes) an un-awaited Promise.
 *
 * Candidates are then annotated with this org's REAL historical success
 * rate for each provider (>=5 real usage events required before any
 * adjustment is applied — never speculate from a handful of calls), and
 * re-sorted by a blended score: aiOrchestrator's on-paper rank position
 * stays the primary signal, historical reliability breaks ties and can
 * demote a provider that looks good on paper but has been failing for
 * this specific org. */
async function recommend(orgId, accountId, capability, opts = {}) {
  if (!_org()?.hasPermission?.(orgId, accountId, "view_members")) {
    const e = new Error("Forbidden — not a member of this organization");
    e.status = 403;
    throw e;
  }
  const raw = await _orchestrator()?.recommend?.(capability, opts) || [];

  const annotated = raw.map((c, i) => {
    const hist = _providerHistoricalSuccessRate(orgId, c.providerId);
    return {
      ...c,
      rankScore: raw.length > 1 ? 1 - i / (raw.length - 1) : 1, // on-paper rank, normalized 0..1 (best=1)
      historicalSuccessRate: hist?.successRate ?? null,
      historicalSampleSize:  hist?.sampleSize ?? 0,
    };
  });

  const scored = annotated.map(c => {
    const histTerm = c.historicalSuccessRate != null ? (c.historicalSuccessRate - 0.5) * 2 * MAX_SCORE_ADJUSTMENT : 0;
    return { ...c, blendedScore: Math.round((c.rankScore + histTerm) * 1000) / 1000 };
  });

  scored.sort((a, b) => b.blendedScore - a.blendedScore);
  // Preserve aiOrchestrator's own reachability-based recommendation unless
  // history has enough real evidence to override it — never silently
  // recommend an unreachable provider just because it scored well historically.
  const firstReachable = scored.find(c => c.reachable);
  const candidates = scored.map(c => ({ ...c, recommended: firstReachable ? c.providerId === firstReachable.providerId : false }));

  return { candidates };
}

/** Real conversation history for this org — reads promptHistory's
 * already-org-scoped store, does not maintain a second one. */
function getHistory(orgId, accountId, opts = {}) {
  if (!_org()?.hasPermission?.(orgId, accountId, "view_members")) {
    const e = new Error("Forbidden — not a member of this organization");
    e.status = 403;
    throw e;
  }
  return _history()?.query?.({ ...opts, orgId }) || [];
}

/** Real AI usage/cost for this org — reads usageMetering's already-org-
 * scoped ledger, does not maintain a second one. */
function getUsage(orgId, accountId, opts = {}) {
  if (!_org()?.hasPermission?.(orgId, accountId, "view_members")) {
    const e = new Error("Forbidden — not a member of this organization");
    e.status = 403;
    throw e;
  }
  const events = _usage()?.queryFromLedger?.({ orgId, ...opts }) || [];
  const budget = _budgets()?.checkBudget?.({ orgId }) || { allowed: true };
  return {
    requests: events.length,
    totalCostUsd: Math.round(events.reduce((s, e) => s + (e.estimatedCostUsd || 0), 0) * 1_000_000) / 1_000_000,
    failures: events.filter(e => e.success === false).length,
    budget: budget.org || null,
    budgetAllowed: budget.allowed,
  };
}

/** Real, live provider health — direct passthrough, no caching layer
 * added (aiOrchestrator.getProviderHealth already does its own real
 * network probes). */
async function getProviderHealth(orgId, accountId, providerId) {
  if (!_org()?.hasPermission?.(orgId, accountId, "view_members")) {
    const e = new Error("Forbidden — not a member of this organization");
    e.status = 403;
    throw e;
  }
  return _orchestrator()?.getProviderHealth?.(providerId);
}

module.exports = { ask, askStream, recommend, getHistory, getUsage, getProviderHealth };
