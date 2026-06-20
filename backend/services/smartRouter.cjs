"use strict";
/**
 * Smart AI Router — auto-select cheapest valid model.
 *
 * Scores each available provider on:
 *   quality  (task-specific capability)
 *   latency  (historic p50 latency, lower = better)
 *   cost     (per-token cost, lower = better)
 * Combined with user preference and enterprise policy.
 *
 * Builds a fallback chain: if selected provider fails, route to next.
 *
 * Reuses: aiService.getProviderStatus() for live health data.
 * Storage: data/router-state.json for historic latency/quality tracking.
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const STATE_FILE = path.join(__dirname, "../../data/router-state.json");

// ── Provider catalogue ────────────────────────────────────────────
// cost_per_1k_tokens in USD (input). Used for cost scoring.
const PROVIDERS = {
  groq: {
    id: "groq", name: "Groq",
    models: { default: "llama-3.3-70b-versatile", fast: "llama-3.1-8b-instant" },
    cost_per_1k: 0.0001,   // near-free
    base_quality: 0.72,
    base_latency_ms: 400,
    capabilities: ["chat", "coding/ask", "coding/action", "chat", "completion"],
  },
  openrouter: {
    id: "openrouter", name: "OpenRouter",
    models: { default: "anthropic/claude-haiku-4-5", fast: "google/gemini-flash-1.5" },
    cost_per_1k: 0.0008,
    base_quality: 0.85,
    base_latency_ms: 700,
    capabilities: ["chat", "coding/ask", "coding/action", "coding/review", "mission", "completion"],
  },
  claude: {
    id: "claude", name: "Claude",
    models: { default: "claude-sonnet-4-6", fast: "claude-haiku-4-5-20251001" },
    cost_per_1k: 0.003,
    base_quality: 0.96,
    base_latency_ms: 1200,
    capabilities: ["coding/ask", "coding/review", "coding/action", "mission", "chat", "completion"],
  },
  openai: {
    id: "openai", name: "OpenAI",
    models: { default: "gpt-4o-mini", fast: "gpt-3.5-turbo" },
    cost_per_1k: 0.0015,
    base_quality: 0.88,
    base_latency_ms: 900,
    capabilities: ["chat", "coding/ask", "coding/action", "coding/review", "completion"],
  },
  gemini: {
    id: "gemini", name: "Gemini",
    models: { default: "gemini-2.0-flash", fast: "gemini-2.0-flash" },
    cost_per_1k: 0.00025,
    base_quality: 0.82,
    base_latency_ms: 800,
    capabilities: ["chat", "coding/ask", "completion"],
  },
  ollama: {
    id: "ollama", name: "Ollama (Local)",
    models: { default: "llama3.2", fast: "llama3.2" },
    cost_per_1k: 0,
    base_quality: 0.65,
    base_latency_ms: 2000,
    capabilities: ["chat", "coding/ask", "completion"],
  },
};

// ── Default policy ────────────────────────────────────────────────
const DEFAULT_POLICY = {
  maxCostPer1k: 0.01,          // don't use providers > $0.01 / 1k without explicit opt-in
  minQuality:   0.60,          // minimum acceptable quality score
  preferFast:   false,         // prefer fast model variant
  preferCheap:  true,          // optimize for cost
  weights: { quality: 0.3, latency: 0.2, cost: 0.5 },
};

// ── State ─────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { latencies: {}, decisions: [], blocked: {} }; }
}

function _save(s) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch (e) { logger.error("[SmartRouter] persist failed:", e.message); }
}

// ── Scoring ───────────────────────────────────────────────────────

function _costScore(provider, policy) {
  if (provider.cost_per_1k === 0) return 1.0; // local = perfect cost score
  const maxC = policy.maxCostPer1k || DEFAULT_POLICY.maxCostPer1k;
  return Math.max(0, 1 - (provider.cost_per_1k / maxC));
}

function _latencyScore(provider, state) {
  const hist = state.latencies[provider.id];
  const latMs = hist?.p50 || provider.base_latency_ms;
  // score: 0 at 5000ms, 1 at 100ms
  return Math.max(0, 1 - (latMs - 100) / 4900);
}

function _qualityScore(provider, task, state) {
  const base = provider.base_quality;
  // boost if provider supports the task natively
  const boost = provider.capabilities.includes(task) ? 0.05 : -0.1;
  return Math.min(1, Math.max(0, base + boost));
}

function _composite(provider, task, state, policy) {
  const w = { ...DEFAULT_POLICY.weights, ...(policy?.weights || {}) };
  const q = _qualityScore(provider, task, state);
  const l = _latencyScore(provider, state);
  const c = _costScore(provider, policy || DEFAULT_POLICY);
  return {
    quality: q, latency: l, cost: c,
    composite: q * w.quality + l * w.latency + c * w.cost,
  };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Select best provider + build fallback chain.
 *
 * @param {object} opts
 *   task           string   "coding/ask" | "coding/review" | "chat" | "mission" | ...
 *   userPref       string?  preferred provider id
 *   enterprisePolicy object? overrides weights/limits
 *   availableKeys  string[] providers with valid API keys
 *   byok           bool     user is providing own key
 *
 * @returns { primary, chain, scores, reason }
 */
function route(opts = {}) {
  const state    = _load();
  const task     = opts.task || "chat";
  const policy   = { ...DEFAULT_POLICY, ...(opts.enterprisePolicy || {}) };
  const available = opts.availableKeys || _detectAvailableKeys();
  const pref     = opts.userPref;

  // Score each provider
  const scored = Object.values(PROVIDERS)
    .filter(p => available.includes(p.id))
    .filter(p => !state.blocked[p.id] || (Date.now() - state.blocked[p.id]) > 30000)
    .filter(p => p.base_quality >= (policy.minQuality || 0.6))
    .map(p => {
      const scores = _composite(p, task, state, policy);
      return { provider: p, scores };
    })
    .sort((a, b) => b.scores.composite - a.scores.composite);

  if (scored.length === 0) {
    // Fallback: use any available
    const any = Object.values(PROVIDERS).find(p => available.includes(p.id));
    return {
      primary: any || PROVIDERS.groq,
      chain:   any ? [any] : [PROVIDERS.groq],
      scores:  {},
      reason:  "no_qualified_providers_fallback",
    };
  }

  // User preference override (if available and meets min quality)
  let primary = scored[0];
  if (pref && PROVIDERS[pref] && available.includes(pref)) {
    const prefScored = scored.find(s => s.provider.id === pref);
    if (prefScored && prefScored.provider.base_quality >= (policy.minQuality || 0.6)) {
      primary = prefScored;
    }
  }

  const chain = [primary, ...scored.filter(s => s !== primary)].map(s => s.provider);

  // Record decision
  const decision = {
    ts:       new Date().toISOString(),
    task,
    primary:  primary.provider.id,
    chain:    chain.map(p => p.id),
    reason:   pref && chain[0].id === pref ? "user_pref" : "cost_quality_opt",
    scores:   primary.scores,
  };
  state.decisions = [decision, ...(state.decisions || [])].slice(0, 200);
  _save(state);

  return {
    primary: primary.provider,
    chain,
    scores:  primary.scores,
    reason:  decision.reason,
    model:   primary.provider.models[policy.preferFast ? "fast" : "default"],
  };
}

/**
 * Record observed latency after a call completes.
 */
function recordLatency(providerId, latencyMs) {
  const state = _load();
  if (!state.latencies[providerId]) {
    state.latencies[providerId] = { p50: latencyMs, samples: 1 };
  } else {
    const s = state.latencies[providerId];
    // Exponential moving average
    s.p50 = Math.round(s.p50 * 0.85 + latencyMs * 0.15);
    s.samples = (s.samples || 0) + 1;
  }
  _save(state);
}

/**
 * Mark provider as temporarily blocked (e.g. rate-limit).
 */
function blockProvider(providerId, durationMs = 30000) {
  const state = _load();
  state.blocked = state.blocked || {};
  state.blocked[providerId] = Date.now() + durationMs;
  _save(state);
}

/**
 * Get recent routing decisions.
 */
function getDecisions(limit = 50) {
  const state = _load();
  return (state.decisions || []).slice(0, limit);
}

/**
 * Get all provider scores for current state (used by Developer Console).
 */
function getProviderScores(task = "chat", opts = {}) {
  const state   = _load();
  const policy  = { ...DEFAULT_POLICY, ...(opts.policy || {}) };
  const keys    = opts.availableKeys || _detectAvailableKeys();
  return Object.values(PROVIDERS).map(p => ({
    ...p,
    available: keys.includes(p.id),
    scores: _composite(p, task, state, policy),
    latency_p50: state.latencies[p.id]?.p50 || p.base_latency_ms,
    blocked: !!(state.blocked?.[p.id] && Date.now() < state.blocked[p.id]),
  }));
}

/**
 * List all providers (catalogue).
 */
function getProviders() { return Object.values(PROVIDERS); }

// ── Key detection ─────────────────────────────────────────────────

function _detectAvailableKeys() {
  const available = [];
  if (process.env.GROQ_API_KEY)       available.push("groq");
  if (process.env.OPENROUTER_API_KEY) available.push("openrouter");
  if (process.env.ANTHROPIC_API_KEY)  available.push("claude");
  if (process.env.OPENAI_API_KEY)     available.push("openai");
  if (process.env.GEMINI_API_KEY)     available.push("gemini");
  // Ollama always available if running locally
  available.push("ollama");
  return available;
}

module.exports = {
  route,
  recordLatency,
  blockProvider,
  getDecisions,
  getProviderScores,
  getProviders,
  PROVIDERS,
  DEFAULT_POLICY,
};
