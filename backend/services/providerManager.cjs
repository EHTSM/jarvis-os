"use strict";
/**
 * Provider Manager — manages AI provider health, quota, and priority.
 *
 * Providers: OpenAI, Claude, Gemini, OpenRouter, Groq, Ollama (+ future).
 * Reads api key availability from env. Persists quota/health in data/providers.json.
 *
 * Reuses: aiService.getProviderStatus() for live call counts.
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const STATE_FILE = path.join(__dirname, "../../data/providers.json");

// ── Provider registry ─────────────────────────────────────────────
const REGISTRY = {
  groq:       { id: "groq",       name: "Groq",          type: "cloud", envKey: "GROQ_API_KEY",       priority: 1, dailyQuota: 100000, model_family: "llama"    },
  openrouter: { id: "openrouter", name: "OpenRouter",    type: "cloud", envKey: "OPENROUTER_API_KEY", priority: 2, dailyQuota: 50000,  model_family: "mixed"    },
  claude:     { id: "claude",     name: "Claude / Anthropic", type: "cloud", envKey: "ANTHROPIC_API_KEY", priority: 3, dailyQuota: 10000, model_family: "claude" },
  openai:     { id: "openai",     name: "OpenAI",        type: "cloud", envKey: "OPENAI_API_KEY",     priority: 4, dailyQuota: 20000,  model_family: "gpt"      },
  gemini:     { id: "gemini",     name: "Gemini",        type: "cloud", envKey: "GEMINI_API_KEY",     priority: 5, dailyQuota: 60000,  model_family: "gemini"   },
  ollama:     { id: "ollama",     name: "Ollama (Local)", type: "local", envKey: null,                priority: 6, dailyQuota: null,   model_family: "llama"    },
};

function _load() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return {}; }
}

function _save(s) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch (e) { logger.error("[ProviderManager] persist failed:", e.message); }
}

function _isKeyPresent(providerId) {
  const prov = REGISTRY[providerId];
  if (!prov?.envKey) return true; // local — always present
  return !!(process.env[prov.envKey]);
}

function _today() { return new Date().toISOString().split("T")[0]; }

function _ensureState(state, id) {
  if (!state[id]) {
    state[id] = {
      id,
      healthy:      true,
      lastCheck:    null,
      errorCount:   0,
      usageToday:   0,
      usageDate:    _today(),
      rateLimited:  false,
      rateLimitUntil: null,
    };
  }
  // Reset daily quota
  if (state[id].usageDate !== _today()) {
    state[id].usageToday = 0;
    state[id].usageDate  = _today();
    state[id].rateLimited = false;
  }
  return state[id];
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Get health + status for all providers.
 */
function getAll() {
  const state = _load();
  return Object.values(REGISTRY).map(p => {
    const s = _ensureState(state, p.id);
    const keyPresent = _isKeyPresent(p.id);
    const quotaUsePct = p.dailyQuota ? Math.round((s.usageToday / p.dailyQuota) * 100) : null;
    return {
      ...p,
      keyPresent,
      available:       keyPresent && s.healthy && !_isRateLimited(s),
      healthy:         s.healthy,
      errorCount:      s.errorCount,
      usageToday:      s.usageToday,
      dailyQuota:      p.dailyQuota,
      quotaUsePct,
      rateLimited:     _isRateLimited(s),
      rateLimitUntil:  s.rateLimitUntil,
      lastCheck:       s.lastCheck,
    };
  });
}

function _isRateLimited(s) {
  if (!s.rateLimited) return false;
  if (!s.rateLimitUntil) return false;
  return new Date(s.rateLimitUntil) > new Date();
}

/**
 * Record a successful call.
 */
function recordSuccess(providerId, tokenCount = 0) {
  const state = _load();
  const s = _ensureState(state, providerId);
  s.healthy       = true;
  s.usageToday   += tokenCount;
  s.lastCheck     = new Date().toISOString();
  s.errorCount    = Math.max(0, s.errorCount - 1);
  _save(state);
}

/**
 * Record a failed call. Auto-marks unhealthy after 5 consecutive failures.
 */
function recordFailure(providerId, errorCode = null) {
  const state = _load();
  const s = _ensureState(state, providerId);
  s.errorCount++;
  s.lastCheck = new Date().toISOString();
  if (errorCode === 429) {
    s.rateLimited = true;
    s.rateLimitUntil = new Date(Date.now() + 60000).toISOString(); // 60s backoff
  }
  if (s.errorCount >= 5) s.healthy = false;
  _save(state);
}

/**
 * Manually set a provider's health/priority.
 */
function updateProvider(providerId, patch) {
  const state = _load();
  const s = _ensureState(state, providerId);
  Object.assign(s, patch);
  _save(state);
  return { ...REGISTRY[providerId], ...s };
}

/**
 * Get ordered priority list of available providers.
 */
function getAvailableChain() {
  return getAll()
    .filter(p => p.available)
    .sort((a, b) => (a.priority || 99) - (b.priority || 99))
    .map(p => p.id);
}

/**
 * Register a future/custom provider.
 */
function registerProvider(def) {
  REGISTRY[def.id] = {
    priority: 99,
    dailyQuota: null,
    ...def,
  };
  return REGISTRY[def.id];
}

/**
 * Check quota — returns true if provider has remaining daily quota.
 */
function hasQuota(providerId) {
  const state = _load();
  const s = _ensureState(state, providerId);
  const p = REGISTRY[providerId];
  if (!p?.dailyQuota) return true; // unlimited
  return s.usageToday < p.dailyQuota;
}

module.exports = {
  getAll,
  recordSuccess,
  recordFailure,
  updateProvider,
  getAvailableChain,
  registerProvider,
  hasQuota,
  REGISTRY,
};
