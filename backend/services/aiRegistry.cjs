"use strict";
/**
 * Universal AI Registry — every provider registers capabilities.
 *
 * Capabilities: chat, code, vision, image, video, voice, browser,
 *               reasoning, embeddings, speech, music, animation, 3d
 *
 * Each provider entry: { id, name, type, capabilities: { [cap]: CapabilityDef } }
 * CapabilityDef: { models: string[], costPer1k: number, contextWindow: number,
 *                  maxOutput: number, streamable: bool, quality: number,
 *                  latencyClass: "fast"|"medium"|"slow" }
 *
 * Storage: data/ai-registry.json (merged with live health from providerManager)
 */

const fs   = require("fs");
const path = require("path");

const REGISTRY_FILE = path.join(__dirname, "../../data/ai-registry.json");

// ── Capability taxonomy ───────────────────────────────────────────
const CAPABILITIES = [
  "chat", "code", "vision", "image", "video", "voice",
  "browser", "reasoning", "embeddings", "speech", "music",
  "animation", "3d",
];

// ── Built-in provider registry ────────────────────────────────────
const BUILTIN = {
  groq: {
    id: "groq", name: "Groq", type: "cloud",
    website: "https://groq.com",
    capabilities: {
      chat:      { models: ["llama-3.3-70b-versatile","llama-3.1-8b-instant","mixtral-8x7b-32768"], costPer1k: 0.0001, contextWindow: 131072, maxOutput: 8192, streamable: true, quality: 0.72, latencyClass: "fast" },
      code:      { models: ["llama-3.3-70b-versatile"], costPer1k: 0.0001, contextWindow: 131072, maxOutput: 8192, streamable: true, quality: 0.70, latencyClass: "fast" },
      reasoning: { models: ["llama-3.3-70b-versatile"], costPer1k: 0.0002, contextWindow: 131072, maxOutput: 8192, streamable: true, quality: 0.68, latencyClass: "fast" },
    },
  },
  openrouter: {
    id: "openrouter", name: "OpenRouter", type: "cloud",
    website: "https://openrouter.ai",
    capabilities: {
      chat:       { models: ["anthropic/claude-haiku-4-5","google/gemini-flash-1.5","meta-llama/llama-3.3-70b-instruct"], costPer1k: 0.0008, contextWindow: 200000, maxOutput: 16384, streamable: true, quality: 0.85, latencyClass: "medium" },
      code:       { models: ["anthropic/claude-haiku-4-5","google/gemini-flash-1.5"], costPer1k: 0.001, contextWindow: 200000, maxOutput: 16384, streamable: true, quality: 0.83, latencyClass: "medium" },
      vision:     { models: ["anthropic/claude-haiku-4-5","google/gemini-flash-1.5"], costPer1k: 0.002, contextWindow: 200000, maxOutput: 4096, streamable: true, quality: 0.82, latencyClass: "medium" },
      reasoning:  { models: ["anthropic/claude-sonnet-4-6","deepseek/deepseek-r1"], costPer1k: 0.003, contextWindow: 200000, maxOutput: 16384, streamable: true, quality: 0.90, latencyClass: "medium" },
      image:      { models: ["openai/dall-e-3","stability/stable-diffusion-3"], costPer1k: 0.04, contextWindow: 4096, maxOutput: 1, streamable: false, quality: 0.88, latencyClass: "slow" },
      embeddings: { models: ["openai/text-embedding-3-small","mistral/mistral-embed"], costPer1k: 0.00002, contextWindow: 8192, maxOutput: 1536, streamable: false, quality: 0.87, latencyClass: "fast" },
    },
  },
  claude: {
    id: "claude", name: "Claude (Anthropic)", type: "cloud",
    website: "https://anthropic.com",
    capabilities: {
      chat:      { models: ["claude-sonnet-4-6","claude-haiku-4-5-20251001","claude-opus-4-8"], costPer1k: 0.003, contextWindow: 1000000, maxOutput: 32000, streamable: true, quality: 0.96, latencyClass: "medium" },
      code:      { models: ["claude-sonnet-4-6","claude-opus-4-8"], costPer1k: 0.003, contextWindow: 1000000, maxOutput: 32000, streamable: true, quality: 0.96, latencyClass: "medium" },
      vision:    { models: ["claude-sonnet-4-6","claude-haiku-4-5-20251001"], costPer1k: 0.004, contextWindow: 200000, maxOutput: 16384, streamable: true, quality: 0.95, latencyClass: "medium" },
      reasoning: { models: ["claude-opus-4-8","claude-sonnet-4-6"], costPer1k: 0.005, contextWindow: 1000000, maxOutput: 32000, streamable: true, quality: 0.97, latencyClass: "slow" },
    },
  },
  openai: {
    id: "openai", name: "OpenAI", type: "cloud",
    website: "https://openai.com",
    capabilities: {
      chat:       { models: ["gpt-4o-mini","gpt-4o","gpt-3.5-turbo"], costPer1k: 0.0015, contextWindow: 128000, maxOutput: 16384, streamable: true, quality: 0.88, latencyClass: "medium" },
      code:       { models: ["gpt-4o","gpt-4o-mini"], costPer1k: 0.002, contextWindow: 128000, maxOutput: 16384, streamable: true, quality: 0.87, latencyClass: "medium" },
      vision:     { models: ["gpt-4o","gpt-4o-mini"], costPer1k: 0.003, contextWindow: 128000, maxOutput: 4096, streamable: true, quality: 0.88, latencyClass: "medium" },
      image:      { models: ["dall-e-3","dall-e-2"], costPer1k: 0.04, contextWindow: 4096, maxOutput: 1, streamable: false, quality: 0.90, latencyClass: "slow" },
      speech:     { models: ["tts-1","tts-1-hd"], costPer1k: 0.015, contextWindow: 4096, maxOutput: null, streamable: true, quality: 0.88, latencyClass: "medium" },
      voice:      { models: ["whisper-1"], costPer1k: 0.006, contextWindow: null, maxOutput: null, streamable: false, quality: 0.90, latencyClass: "medium" },
      embeddings: { models: ["text-embedding-3-small","text-embedding-3-large"], costPer1k: 0.00002, contextWindow: 8192, maxOutput: 1536, streamable: false, quality: 0.90, latencyClass: "fast" },
      reasoning:  { models: ["o1","o3-mini"], costPer1k: 0.015, contextWindow: 200000, maxOutput: 32768, streamable: true, quality: 0.95, latencyClass: "slow" },
    },
  },
  gemini: {
    id: "gemini", name: "Gemini (Google)", type: "cloud",
    website: "https://deepmind.google",
    capabilities: {
      chat:       { models: ["gemini-2.0-flash","gemini-1.5-pro"], costPer1k: 0.00025, contextWindow: 2000000, maxOutput: 8192, streamable: true, quality: 0.82, latencyClass: "fast" },
      code:       { models: ["gemini-2.0-flash","gemini-1.5-pro"], costPer1k: 0.00025, contextWindow: 2000000, maxOutput: 8192, streamable: true, quality: 0.80, latencyClass: "fast" },
      vision:     { models: ["gemini-2.0-flash","gemini-1.5-pro"], costPer1k: 0.0005, contextWindow: 2000000, maxOutput: 4096, streamable: true, quality: 0.85, latencyClass: "fast" },
      image:      { models: ["imagen-3"], costPer1k: 0.02, contextWindow: null, maxOutput: 1, streamable: false, quality: 0.87, latencyClass: "medium" },
      embeddings: { models: ["text-embedding-004"], costPer1k: 0.00001, contextWindow: 2048, maxOutput: 768, streamable: false, quality: 0.83, latencyClass: "fast" },
      reasoning:  { models: ["gemini-2.0-flash-thinking"], costPer1k: 0.001, contextWindow: 1000000, maxOutput: 8192, streamable: true, quality: 0.85, latencyClass: "medium" },
      video:      { models: ["gemini-1.5-pro"], costPer1k: 0.001, contextWindow: 1000000, maxOutput: 4096, streamable: false, quality: 0.80, latencyClass: "slow" },
    },
  },
  ollama: {
    id: "ollama", name: "Ollama (Local)", type: "local",
    website: "https://ollama.com",
    capabilities: {
      chat:      { models: ["llama3.2","llama3.1","mistral","codellama","phi4"], costPer1k: 0, contextWindow: 128000, maxOutput: 4096, streamable: true, quality: 0.65, latencyClass: "medium" },
      code:      { models: ["codellama","deepseek-coder","qwen2.5-coder"], costPer1k: 0, contextWindow: 128000, maxOutput: 4096, streamable: true, quality: 0.68, latencyClass: "medium" },
      embeddings:{ models: ["nomic-embed-text","mxbai-embed-large"], costPer1k: 0, contextWindow: 8192, maxOutput: 768, streamable: false, quality: 0.72, latencyClass: "fast" },
      vision:    { models: ["llava","moondream"], costPer1k: 0, contextWindow: 4096, maxOutput: 2048, streamable: true, quality: 0.60, latencyClass: "slow" },
    },
  },
  stability: {
    id: "stability", name: "Stability AI", type: "cloud",
    website: "https://stability.ai",
    capabilities: {
      image:     { models: ["stable-diffusion-3.5-large","stable-diffusion-xl-1024-v1-0"], costPer1k: 0.065, contextWindow: 2048, maxOutput: 1, streamable: false, quality: 0.88, latencyClass: "slow" },
      animation: { models: ["stable-video-diffusion"], costPer1k: 0.12, contextWindow: null, maxOutput: 1, streamable: false, quality: 0.82, latencyClass: "slow" },
      "3d":      { models: ["stable-point-e"], costPer1k: 0.15, contextWindow: null, maxOutput: 1, streamable: false, quality: 0.75, latencyClass: "slow" },
    },
  },
  elevenlabs: {
    id: "elevenlabs", name: "ElevenLabs", type: "cloud",
    website: "https://elevenlabs.io",
    capabilities: {
      speech: { models: ["eleven_multilingual_v2","eleven_turbo_v2_5"], costPer1k: 0.30, contextWindow: 10000, maxOutput: null, streamable: true, quality: 0.97, latencyClass: "fast" },
      voice:  { models: ["eleven_multilingual_v2"], costPer1k: 0.30, contextWindow: 10000, maxOutput: null, streamable: true, quality: 0.97, latencyClass: "fast" },
      music:  { models: ["eleven_multilingual_v2"], costPer1k: 0.30, contextWindow: null, maxOutput: null, streamable: false, quality: 0.85, latencyClass: "medium" },
    },
  },
  playwright: {
    id: "playwright", name: "Playwright (Browser)", type: "local",
    website: "https://playwright.dev",
    capabilities: {
      browser: { models: ["chromium","firefox","webkit"], costPer1k: 0, contextWindow: null, maxOutput: null, streamable: false, quality: 0.95, latencyClass: "medium" },
    },
  },
};

// ── State: overlay (user-registered / custom providers) ──────────
function _loadOverlay() {
  try { return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8")); }
  catch { return {}; }
}

function _saveOverlay(data) {
  try {
    fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2));
  } catch { /* non-fatal */ }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * All registered providers (built-in + custom overlays).
 */
function getAll() {
  const overlay = _loadOverlay();
  const merged  = { ...BUILTIN };
  for (const [id, p] of Object.entries(overlay)) {
    if (merged[id]) {
      merged[id] = { ...merged[id], ...p, capabilities: { ...merged[id].capabilities, ...p.capabilities } };
    } else {
      merged[id] = p;
    }
  }
  return Object.values(merged);
}

/**
 * All providers that support a given capability.
 */
function getByCapability(capability) {
  return getAll().filter(p => p.capabilities?.[capability]);
}

/**
 * Best model for a capability (cheapest that meets minQuality).
 * Returns { providerId, model, capability, costPer1k, quality, contextWindow }
 */
function bestFor(capability, opts = {}) {
  const minQuality = opts.minQuality || 0.6;
  const maxCost    = opts.maxCostPer1k != null ? opts.maxCostPer1k : Infinity;
  const prefer     = opts.prefer; // "quality" | "cost" | "speed"

  const candidates = [];
  for (const p of getAll()) {
    const cap = p.capabilities?.[capability];
    if (!cap) continue;
    if (cap.quality < minQuality) continue;
    if (cap.costPer1k > maxCost) continue;
    candidates.push({ providerId: p.id, providerName: p.name, model: cap.models?.[0] || "default",
                      capability, costPer1k: cap.costPer1k, quality: cap.quality,
                      latencyClass: cap.latencyClass, contextWindow: cap.contextWindow,
                      streamable: cap.streamable });
  }
  if (!candidates.length) return null;

  if (prefer === "quality") return candidates.sort((a, b) => b.quality - a.quality)[0];
  if (prefer === "speed")   return candidates.sort((a, b) => { const o={fast:0,medium:1,slow:2}; return o[a.latencyClass]-o[b.latencyClass]; })[0];
  // default: cost-optimised (lowest cost among quality-passing candidates)
  return candidates.sort((a, b) => a.costPer1k - b.costPer1k)[0];
}

/**
 * All capabilities supported by at least one provider.
 */
function getAllCapabilities() {
  const caps = new Set();
  for (const p of getAll()) Object.keys(p.capabilities || {}).forEach(c => caps.add(c));
  return [...caps].sort();
}

/**
 * Register or update a provider (custom/future providers).
 */
function registerProvider(def) {
  const overlay = _loadOverlay();
  overlay[def.id] = def;
  _saveOverlay(overlay);
  return getAll().find(p => p.id === def.id);
}

/**
 * Get a single provider by id.
 */
function getProvider(id) { return getAll().find(p => p.id === id) || null; }

module.exports = { getAll, getByCapability, bestFor, getAllCapabilities, registerProvider, getProvider, CAPABILITIES, BUILTIN };
