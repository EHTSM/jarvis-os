"use strict";
/**
 * AI Provider Orchestrator — single entrypoint for production-grade multi-
 * provider orchestration: intelligent routing, automatic fallback, retry,
 * health monitoring, latency tracking, cost tracking, budget enforcement,
 * capability matching, and prompt history.
 *
 * This is NOT a new AI system. It composes services that already existed:
 *   - aiService.js        real provider HTTP adapters (12 providers) — the
 *                          ONLY place that ever calls an actual AI API.
 *   - aiRegistry.cjs       capability → provider/model catalogue.
 *   - smartRouter.cjs      cost/quality/latency scoring + fallback chain.
 *   - enterprisePolicies.cjs  org-level provider/model/cost policy gates.
 *   - usageMetering.cjs    real per-request cost/latency ledger.
 *   - billingService.js    per-account plan quota (extended with per-org/
 *                          per-workspace limits — see checkBudget below).
 *   - secretVault.cjs      encrypted credential storage (env fallback).
 *
 * The orchestrator adds NO new HTTP calls to any provider — every actual
 * request still goes through aiService.chat()/chatWithTools(). It decides
 * WHICH provider/model to call, in WHAT order, whether the caller is allowed
 * to spend more, and records what happened.
 *
 * Storage: reuses usageMetering's ledger and billingService's per-account
 * store; adds ONE new store (data/org-budgets.json) for the org/workspace
 * budget caps described in Module 3 — no other new storage. Response
 * caching (Module 6) is in-memory only by design — see aiResponseCache.cjs.
 */

const logger        = require("../utils/logger");
const aiService      = require("./aiService");
const aiRegistry      = require("./aiRegistry.cjs");
const smartRouter     = require("./smartRouter.cjs");
const usageMetering   = require("./usageMetering.cjs");
const billingService  = require("./billingService");
const responseCache   = require("./aiResponseCache.cjs");

function _enterprisePolicies() { try { return require("./enterprisePolicies.cjs"); } catch { return null; } }
function _capabilityRouter()   { try { return require("./capabilityRouter.cjs");   } catch { return null; } }
function _promptHistory()      { try { return require("./promptHistory.cjs");      } catch { return null; } }
function _budgets()            { try { return require("./orgBudgets.cjs");         } catch { return null; } }
function _integrationConnectors() { try { return require("./integrationConnectors.cjs"); } catch { return null; } }

// ── Capability detection (reuses capabilityRouter's intent patterns rather
// than re-implementing regex matching) ───────────────────────────────────
function detectCapability(intentOrCapability) {
  const cr = _capabilityRouter();
  if (aiRegistry.CAPABILITIES.includes(intentOrCapability)) return intentOrCapability;
  if (cr) return cr.detectCapability(intentOrCapability);
  return "chat";
}

// ── Which providers are reachable right now (has key AND, for local
// providers, a real TCP reachability probe) ──────────────────────────────
// Local providers (Ollama/LM Studio) are $0/1k-token and therefore always
// sort first under cost-based preference — but unlike cloud providers, "has
// no key requirement" doesn't mean "is actually running". Ranking one first
// only to have it fail on the very next call wastes a full request cycle
// before falling through to a real, working, keyed provider. Probing here
// (same TCP-connect technique aiService.js already uses internally to fail
// fast) means the fallback chain only ever ranks a local provider first when
// it can genuinely answer right now.
async function _availableProviders() {
  const keyed = {
    groq: "GROQ_API_KEY", openrouter: "OPENROUTER_API_KEY", openai: "OPENAI_API_KEY",
    claude: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY", deepseek: "DEEPSEEK_API_KEY",
    together: "TOGETHER_API_KEY", fireworks: "FIREWORKS_API_KEY", cohere: "COHERE_API_KEY",
    nvidia: "NVIDIA_API_KEY", grok: "GROK_API_KEY", qwen: "DASHSCOPE_API_KEY",
  };
  const available = Object.entries(keyed).filter(([, env]) => !!process.env[env]).map(([id]) => id);

  const [ollamaUp, lmstudioUp] = await Promise.all([
    aiService.isLocalServerReachable(aiService.ollamaUrl()),
    aiService.isLocalServerReachable(aiService.lmStudioUrl()),
  ]);
  if (ollamaUp)   available.push("ollama");
  if (lmstudioUp) available.push("lmstudio");
  return available;
}

/**
 * Build a ranked provider+model fallback chain for a capability/task.
 *
 * @param {object} opts
 *   capability|task  string   e.g. "chat","code","reasoning" (aiRegistry.CAPABILITIES)
 *   intent           string   free-text — capability is detected from this if capability/task absent
 *   userPref         string?  preferred provider id
 *   orgId            string?  enterprisePolicies + budget scoping
 *   workspaceId      string?  budget scoping
 *   prefer           "cost"|"quality"|"speed"  (default "cost")
 *   minQuality       number 0-1
 *   maxCostPer1k     number
 *
 * @returns {Promise<{ capability, chain: [{providerId, model, costPer1k, quality}], reason }>}
 */
async function buildFallbackChain(opts = {}) {
  const capability = opts.capability || opts.task || detectCapability(opts.intent || "chat");
  const available  = await _availableProviders();

  // 1. Capability-qualified candidates from aiRegistry, cheapest-first (or by `prefer`)
  let candidates = aiRegistry.getByCapability(capability)
    .filter(p => available.includes(p.id))
    .map(p => {
      const cap = p.capabilities[capability];
      return { providerId: p.id, providerName: p.name, model: cap.models?.[0] || "default",
               costPer1k: cap.costPer1k, quality: cap.quality, latencyClass: cap.latencyClass,
               streamable: !!cap.streamable, capability };
    });

  if (opts.minQuality != null)   candidates = candidates.filter(c => c.quality >= opts.minQuality);
  if (opts.maxCostPer1k != null) candidates = candidates.filter(c => c.costPer1k <= opts.maxCostPer1k);

  // 2. Enterprise policy gate (org-scoped provider/model/cost/country rules)
  const policies = _enterprisePolicies();
  if (policies && opts.orgId) {
    candidates = policies.filterCandidates(
      candidates.map(c => ({ providerId: c.providerId, modelId: c.model, capability, costPer1kUsd: c.costPer1k })),
      opts.orgId
    ).map(filtered => candidates.find(c => c.providerId === filtered.providerId && c.model === filtered.modelId));
  }

  // 3. Sort by preference
  const prefer = opts.prefer || "cost";
  if (prefer === "quality") candidates.sort((a, b) => b.quality - a.quality);
  else if (prefer === "speed") { const order = { fast: 0, medium: 1, slow: 2 }; candidates.sort((a, b) => order[a.latencyClass] - order[b.latencyClass]); }
  else candidates.sort((a, b) => a.costPer1k - b.costPer1k);

  // 4. User preference bump-to-front (still requires the provider to be in the qualified set)
  if (opts.userPref) {
    const idx = candidates.findIndex(c => c.providerId === opts.userPref);
    if (idx > 0) candidates.unshift(candidates.splice(idx, 1)[0]);
  }

  if (!candidates.length) {
    // Nothing qualifies for this capability — fall back to smartRouter's
    // general chat-scoring chain so the caller still gets *something*
    // rather than an empty chain (matches capabilityRouter's existing
    // "chat fallback" behavior, reused rather than reinvented).
    const routed = smartRouter.route({ task: "chat", userPref: opts.userPref, availableKeys: available });
    return {
      capability,
      chain: routed.chain.map(p => ({ providerId: p.id, providerName: p.name, model: p.models?.default || "default", costPer1k: p.cost_per_1k, quality: p.base_quality })),
      reason: "no_capability_match_fallback_to_chat",
    };
  }

  return { capability, chain: candidates, reason: opts.userPref && candidates[0]?.providerId === opts.userPref ? "user_pref" : `capability_optimized_${prefer}` };
}

/**
 * Composite health snapshot for one or all providers: live reachability
 * probe (integrationConnectors.healthAIProvider — real network call, real
 * measured latency, see Module 4) merged with smartRouter's persisted
 * historical latency (EMA p50 across real completed requests, recorded by
 * execute() below on every successful call). Two different signals on
 * purpose: "can I reach it right now" vs "how fast has it actually been
 * responding to real chat requests over time."
 *
 * @param {string} [providerId]  omit for all 14 providers
 * @returns {Promise<object|object[]>}
 */
async function getProviderHealth(providerId) {
  const ic = _integrationConnectors();
  // smartRouter.PROVIDERS, not aiRegistry.getAll() — the registry also
  // carries non-chat providers (Stability, ElevenLabs, Playwright) that
  // integrationConnectors has no AI_PROVIDERS entry for; this function is
  // specifically about the 14 real text/chat adapters aiService.js implements.
  const ids = providerId ? [providerId] : Object.keys(smartRouter.PROVIDERS);
  const routerScores = smartRouter.getProviderScores();

  const results = await Promise.all(ids.map(async id => {
    const historical = routerScores.find(s => s.id === id);
    let live = { ok: false, latencyMs: null, detail: "integrationConnectors unavailable" };
    if (ic) {
      // integrationConnectors uses "anthropic" for Claude — same naming
      // reconciliation aiOrchestrator/aiService already do elsewhere.
      const icId = id === "claude" ? "anthropic" : id;
      live = await ic.healthAIProvider(icId).catch(e => ({ ok: false, latencyMs: null, detail: e.message }));
    }
    return {
      providerId: id,
      reachable: live.ok,
      liveLatencyMs: live.latencyMs,
      liveDetail: live.detail,
      historicalP50LatencyMs: historical?.latency_p50 ?? null,
      blocked: historical?.blocked ?? false,
      qualityScore: historical?.scores?.quality ?? null,
    };
  }));

  return providerId ? results[0] : results;
}

/**
 * Execute a chat request through the orchestrated fallback chain, recording
 * real cost/latency to usageMetering and enforcing budget along the way.
 * This is the ONE function every route (routes/ai.js, routes/jarvis.js)
 * should call instead of hitting aiService.chat() directly, once Module 8
 * wires them through — it does not replace aiService, it decides how to call it.
 *
 * @param {Array<{role,content}>} messages   OpenAI-format messages
 * @param {object} opts
 *   capability|task, intent, userPref, prefer, minQuality, maxCostPer1k  — see buildFallbackChain
 *   accountId, orgId, workspaceId, missionId  — attribution for usageMetering + budget checks
 *   model        string?  force a specific model on the chosen provider
 *   maxTokens, temperature — passed through to aiService
 *   tools        Array?   if present, uses aiService.chatWithTools instead of chat
 *   noCache      bool?    skip the response cache for this call (default false)
 *
 * @returns {Promise<{text, toolCalls, provider, model, latencyMs, estimatedCostUsd, chain, capability, cached?}>}
 */
async function execute(messages, opts = {}) {
  const { chain, capability, reason } = await buildFallbackChain(opts);
  if (!chain.length) throw new Error("No AI provider available for this request");

  // Budget check BEFORE spending anything — Module 3 wires real org/workspace
  // limits into this; until then (or if unavailable) this is a no-op pass.
  const budgets = _budgets();
  if (budgets && (opts.orgId || opts.workspaceId)) {
    const check = budgets.checkBudget({ orgId: opts.orgId, workspaceId: opts.workspaceId });
    if (!check.allowed) {
      const e = new Error(check.reason || "Budget limit exceeded for this organization/workspace");
      e.status = 429; e.code = "budget_exceeded";
      throw e;
    }
  }

  // Response cache — exact-match only, and only for plain chat (never for
  // tool-calling: a tool call may have real side effects — e.g. a connector
  // action — replaying a cached tool_calls response without re-executing
  // those tools, or worse silently skipping their execution, would be wrong
  // in a way a stale chat answer isn't).
  const cacheable = !opts.noCache && !(Array.isArray(opts.tools) && opts.tools.length);
  const primary = chain[0];
  if (cacheable) {
    const hit = responseCache.get(primary.providerId, opts.model || primary.model, messages, opts.temperature);
    if (hit) {
      return { ...hit, chain: chain.map(c => c.providerId), capability, reason: `${reason}_cache_hit` };
    }
  }

  const errors = [];
  for (const candidate of chain) {
    const t0 = Date.now();
    try {
      const callOpts = { provider: candidate.providerId, model: opts.model || candidate.model,
                          maxTokens: opts.maxTokens, temperature: opts.temperature };
      const result = (Array.isArray(opts.tools) && opts.tools.length)
        ? await aiService.chatWithTools(messages, opts.tools, callOpts)
        : await aiService.chat(messages, callOpts);

      const latencyMs = Date.now() - t0;
      smartRouter.recordLatency(candidate.providerId, latencyMs);

      // Rough token estimate (no provider here returns real usage counts
      // uniformly — see Module 7 for per-provider token accounting follow-up).
      const inputChars  = messages.reduce((s, m) => s + (m.content?.length || 0), 0);
      const outputChars = (result.text || "").length;
      const inputTokens  = Math.ceil(inputChars / 4);
      const outputTokens = Math.ceil(outputChars / 4);

      const event = usageMetering.record({
        accountId: opts.accountId, orgId: opts.orgId, workspaceId: opts.workspaceId, missionId: opts.missionId,
        provider: candidate.providerId, model: result.model || candidate.model,
        requestType: opts.tools?.length ? "chat_with_tools" : "chat",
        inputTokens, outputTokens, latencyMs, success: true,
      });

      const history = _promptHistory();
      if (history) {
        try {
          history.record({
            accountId: opts.accountId, orgId: opts.orgId, workspaceId: opts.workspaceId,
            capability, provider: candidate.providerId, model: result.model || candidate.model,
            prompt: messages[messages.length - 1]?.content || "", response: result.text || "",
            latencyMs, estimatedCostUsd: event.estimatedCostUsd,
          });
        } catch (e) { logger.warn(`[aiOrchestrator] prompt history record failed: ${e.message}`); }
      }

      const response = {
        text: result.text, toolCalls: result.toolCalls || [], provider: candidate.providerId,
        model: result.model || candidate.model, latencyMs, estimatedCostUsd: event.estimatedCostUsd,
        chain: chain.map(c => c.providerId), capability, reason,
      };

      // Populate the cache with exactly what a repeat of THIS candidate call
      // would produce — keyed on the candidate actually used (which may not
      // be `primary` if earlier providers in the chain failed), not the
      // originally-preferred provider, so a later identical request that
      // resolves to the same candidate gets a real hit.
      if (cacheable) {
        responseCache.set(candidate.providerId, callOpts.model, messages, opts.temperature, {
          text: response.text, provider: response.provider, model: response.model,
          latencyMs: response.latencyMs, estimatedCostUsd: response.estimatedCostUsd,
        });
      }

      return response;
    } catch (err) {
      const latencyMs = Date.now() - t0;
      errors.push({ providerId: candidate.providerId, error: err.message });
      usageMetering.record({
        accountId: opts.accountId, orgId: opts.orgId, workspaceId: opts.workspaceId, missionId: opts.missionId,
        provider: candidate.providerId, requestType: opts.tools?.length ? "chat_with_tools" : "chat",
        latencyMs, success: false, errorCode: err.message,
      });
      // Rate-limit-shaped errors temporarily deprioritize this provider in
      // future routing decisions (smartRouter's existing blockProvider) —
      // reuses the mechanism smartRouter already had, doesn't add a new one.
      if (err.response?.status === 429 || /429|rate.?limit/i.test(err.message)) {
        smartRouter.blockProvider(candidate.providerId, 30000);
      }
      logger.warn(`[aiOrchestrator] ${candidate.providerId} failed, trying next in chain: ${err.message}`);
    }
  }

  const e = new Error(`All providers in fallback chain failed: ${errors.map(e => `${e.providerId} (${e.error})`).join("; ")}`);
  e.chainErrors = errors;
  throw e;
}

/**
 * Streaming counterpart to execute() — same fallback chain, budget check,
 * and cost/latency/history accounting, but delivers tokens incrementally via
 * onChunk as they arrive from aiService.streamChat() instead of waiting for
 * the full response. Only attempts providers aiService.isStreamCapable()
 * reports as supporting real streaming (see Module 5's STREAM_CAPABLE list) —
 * a provider in the capability-ranked chain that can't stream is skipped here
 * rather than silently falling back to a blocking call, since a caller who
 * asked to stream needs to know if nothing in the chain could actually do it.
 *
 * @returns {Promise<{text, provider, model, latencyMs, estimatedCostUsd, chain, capability}>}
 */
async function executeStream(messages, opts = {}, onChunk = () => {}) {
  const { chain, capability, reason } = await buildFallbackChain(opts);
  const streamableChain = chain.filter(c => aiService.isStreamCapable(c.providerId));
  if (!streamableChain.length) throw new Error("No streaming-capable AI provider available for this request");

  const budgets = _budgets();
  if (budgets && (opts.orgId || opts.workspaceId)) {
    const check = budgets.checkBudget({ orgId: opts.orgId, workspaceId: opts.workspaceId });
    if (!check.allowed) {
      const e = new Error(check.reason || "Budget limit exceeded for this organization/workspace");
      e.status = 429; e.code = "budget_exceeded";
      throw e;
    }
  }

  const errors = [];
  for (const candidate of streamableChain) {
    const t0 = Date.now();
    try {
      const result = await aiService.streamChat(
        messages,
        { provider: candidate.providerId, model: opts.model || candidate.model, maxTokens: opts.maxTokens, temperature: opts.temperature },
        onChunk
      );
      const latencyMs = Date.now() - t0;
      smartRouter.recordLatency(candidate.providerId, latencyMs);

      const inputChars  = messages.reduce((s, m) => s + (m.content?.length || 0), 0);
      const outputChars = (result.text || "").length;
      const inputTokens  = Math.ceil(inputChars / 4);
      const outputTokens = Math.ceil(outputChars / 4);

      const event = usageMetering.record({
        accountId: opts.accountId, orgId: opts.orgId, workspaceId: opts.workspaceId, missionId: opts.missionId,
        provider: candidate.providerId, model: result.model || candidate.model,
        requestType: "chat_stream", inputTokens, outputTokens, latencyMs, success: true,
      });

      const history = _promptHistory();
      if (history) {
        try {
          history.record({
            accountId: opts.accountId, orgId: opts.orgId, workspaceId: opts.workspaceId,
            capability, provider: candidate.providerId, model: result.model || candidate.model,
            prompt: messages[messages.length - 1]?.content || "", response: result.text || "",
            latencyMs, estimatedCostUsd: event.estimatedCostUsd,
          });
        } catch (e) { logger.warn(`[aiOrchestrator] prompt history record failed: ${e.message}`); }
      }

      return {
        text: result.text, provider: candidate.providerId, model: result.model || candidate.model,
        latencyMs, estimatedCostUsd: event.estimatedCostUsd, chain: streamableChain.map(c => c.providerId), capability, reason,
      };
    } catch (err) {
      const latencyMs = Date.now() - t0;
      errors.push({ providerId: candidate.providerId, error: err.message });
      usageMetering.record({
        accountId: opts.accountId, orgId: opts.orgId, workspaceId: opts.workspaceId, missionId: opts.missionId,
        provider: candidate.providerId, requestType: "chat_stream", latencyMs, success: false, errorCode: err.message,
      });
      if (err.response?.status === 429 || /429|rate.?limit/i.test(err.message)) {
        smartRouter.blockProvider(candidate.providerId, 30000);
      }
      logger.warn(`[aiOrchestrator] streaming ${candidate.providerId} failed, trying next in chain: ${err.message}`);
    }
  }

  const e = new Error(`All streaming-capable providers in fallback chain failed: ${errors.map(e => `${e.providerId} (${e.error})`).join("; ")}`);
  e.chainErrors = errors;
  throw e;
}

module.exports = {
  detectCapability,
  buildFallbackChain,
  execute,
  executeStream,
  getProviderHealth,
  getCacheStats: responseCache.stats,
  clearCache: responseCache.clear,
  _availableProviders, // exported for tests/inspection only
};
