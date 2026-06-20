"use strict";
/**
 * Creative Registry — all AI creative capabilities + their providers.
 *
 * 15 capabilities, each with: provider list, models, credit cost,
 * quality score, latency estimate, stream support.
 *
 * Reuses aiRegistry.cjs provider data where available.
 */

const fs   = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "../../data/creative-registry.json");

// ── Capability definitions ─────────────────────────────────────────
const BUILTIN_CAPABILITIES = {
  image_generate: {
    id: "image_generate", label: "Image Generation",
    providers: [
      { id: "stability",  name: "Stability AI",  models: ["sd3-medium","sd3.5-large","sdxl-1.0"], credits: 5,  quality: 0.90, latencyMs: 4000,  stream: false },
      { id: "openai",     name: "OpenAI",         models: ["dall-e-3","dall-e-2"],                 credits: 8,  quality: 0.92, latencyMs: 6000,  stream: false },
      { id: "openrouter", name: "OpenRouter",     models: ["playground-v2.5","flux-1"],            credits: 4,  quality: 0.85, latencyMs: 5000,  stream: false },
      { id: "local",      name: "Local (ComfyUI)",models: ["sdxl-local"],                         credits: 0,  quality: 0.80, latencyMs: 8000,  stream: false },
    ],
    defaultProvider: "stability",
    description: "Generate images from text prompts",
  },
  image_edit: {
    id: "image_edit", label: "Image Edit",
    providers: [
      { id: "stability",  name: "Stability AI",  models: ["sd3-inpaint","sdxl-inpaint"],         credits: 6,  quality: 0.88, latencyMs: 5000,  stream: false },
      { id: "openai",     name: "OpenAI",         models: ["dall-e-2-edit"],                      credits: 8,  quality: 0.90, latencyMs: 7000,  stream: false },
    ],
    defaultProvider: "stability",
    description: "Edit existing images with prompt guidance",
  },
  image_upscale: {
    id: "image_upscale", label: "Image Upscale",
    providers: [
      { id: "stability",  name: "Stability AI",  models: ["esrgan-v1-x2plus","upscale-4x"],      credits: 3,  quality: 0.92, latencyMs: 3000,  stream: false },
    ],
    defaultProvider: "stability",
    description: "Upscale images up to 4x resolution",
  },
  background_remove: {
    id: "background_remove", label: "Background Remove",
    providers: [
      { id: "stability",  name: "Stability AI",  models: ["bg-remove-v1"],                       credits: 2,  quality: 0.90, latencyMs: 2000,  stream: false },
    ],
    defaultProvider: "stability",
    description: "Remove background from any image",
  },
  text_to_video: {
    id: "text_to_video", label: "Text to Video",
    providers: [
      { id: "openrouter", name: "OpenRouter",     models: ["runway-gen3","pika-labs"],            credits: 20, quality: 0.85, latencyMs: 30000, stream: true  },
    ],
    defaultProvider: "openrouter",
    description: "Generate video clips from text prompts",
  },
  image_to_video: {
    id: "image_to_video", label: "Image to Video",
    providers: [
      { id: "openrouter", name: "OpenRouter",     models: ["stable-video-diffusion","runway-gen3"],credits: 15, quality: 0.83, latencyMs: 25000, stream: true  },
    ],
    defaultProvider: "openrouter",
    description: "Animate a still image into a video clip",
  },
  voice_clone: {
    id: "voice_clone", label: "Voice Clone",
    providers: [
      { id: "elevenlabs", name: "ElevenLabs",    models: ["voice-clone-v2","voice-clone-v3"],    credits: 10, quality: 0.95, latencyMs: 8000,  stream: false },
    ],
    defaultProvider: "elevenlabs",
    description: "Clone a voice from a sample audio file",
  },
  text_to_speech: {
    id: "text_to_speech", label: "Text to Speech",
    providers: [
      { id: "elevenlabs", name: "ElevenLabs",    models: ["eleven_monolingual_v1","eleven_multilingual_v2"], credits: 2, quality: 0.95, latencyMs: 1500, stream: true },
      { id: "openai",     name: "OpenAI",         models: ["tts-1","tts-1-hd"],                  credits: 3,  quality: 0.90, latencyMs: 2000,  stream: true  },
    ],
    defaultProvider: "elevenlabs",
    description: "Convert text to natural-sounding speech",
  },
  speech_to_text: {
    id: "speech_to_text", label: "Speech to Text",
    providers: [
      { id: "openai",     name: "OpenAI",         models: ["whisper-1","whisper-large-v3"],       credits: 2,  quality: 0.95, latencyMs: 3000,  stream: true  },
      { id: "groq",       name: "Groq",            models: ["whisper-large-v3-turbo"],             credits: 1,  quality: 0.93, latencyMs: 800,   stream: true  },
    ],
    defaultProvider: "openai",
    description: "Transcribe audio to text with speaker detection",
  },
  music_generate: {
    id: "music_generate", label: "Music Generation",
    providers: [
      { id: "openrouter", name: "OpenRouter",     models: ["musicgen-large","audiocraft"],        credits: 8,  quality: 0.85, latencyMs: 15000, stream: false },
    ],
    defaultProvider: "openrouter",
    description: "Generate original music from text descriptions",
  },
  animation_generate: {
    id: "animation_generate", label: "Animation Generation",
    providers: [
      { id: "openrouter", name: "OpenRouter",     models: ["zeroscope-v2","animatediff"],         credits: 18, quality: 0.80, latencyMs: 35000, stream: true  },
    ],
    defaultProvider: "openrouter",
    description: "Generate animated sequences and motion graphics",
  },
  presentation_generate: {
    id: "presentation_generate", label: "Presentation Generation",
    providers: [
      { id: "claude",     name: "Claude",         models: ["claude-opus-4-8"],                    credits: 5,  quality: 0.92, latencyMs: 5000,  stream: true  },
    ],
    defaultProvider: "claude",
    description: "Generate complete slide decks from briefs",
  },
  logo_generate: {
    id: "logo_generate", label: "Logo Generation",
    providers: [
      { id: "stability",  name: "Stability AI",  models: ["sd3-medium","sdxl-1.0"],              credits: 6,  quality: 0.87, latencyMs: 5000,  stream: false },
      { id: "openai",     name: "OpenAI",         models: ["dall-e-3"],                           credits: 8,  quality: 0.90, latencyMs: 7000,  stream: false },
    ],
    defaultProvider: "stability",
    description: "Generate logos and brand mark variations",
  },
  banner_generate: {
    id: "banner_generate", label: "Banner Generation",
    providers: [
      { id: "stability",  name: "Stability AI",  models: ["sdxl-1.0","sd3-medium"],              credits: 4,  quality: 0.88, latencyMs: 4000,  stream: false },
      { id: "openai",     name: "OpenAI",         models: ["dall-e-3"],                           credits: 8,  quality: 0.91, latencyMs: 6000,  stream: false },
    ],
    defaultProvider: "stability",
    description: "Generate ad banners and social media headers",
  },
  ad_generate: {
    id: "ad_generate", label: "Ad Generation",
    providers: [
      { id: "claude",     name: "Claude",         models: ["claude-opus-4-8"],                    credits: 4,  quality: 0.93, latencyMs: 4000,  stream: true  },
      { id: "openai",     name: "OpenAI",         models: ["gpt-4o"],                             credits: 5,  quality: 0.90, latencyMs: 5000,  stream: true  },
    ],
    defaultProvider: "claude",
    description: "Generate ad copy, headlines, and creative briefs",
  },
};

// ── Custom capability storage ──────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return { custom: {} }; }
}
function _save(d) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}

// ── Public API ─────────────────────────────────────────────────────

function getAll() {
  const store  = _load();
  return { ...BUILTIN_CAPABILITIES, ...store.custom };
}

function getCapability(id) {
  return getAll()[id] || null;
}

function listCapabilities() {
  return Object.values(getAll()).map(c => ({
    id:          c.id,
    label:       c.label,
    description: c.description,
    providerCount: (c.providers || []).length,
    defaultProvider: c.defaultProvider,
    minCredits: Math.min(...(c.providers || [{ credits: 0 }]).map(p => p.credits)),
    streamSupport: (c.providers || []).some(p => p.stream),
  }));
}

/**
 * Get best provider for a capability (lowest latency among healthy providers).
 */
function getBestProvider(capabilityId, opts = {}) {
  const cap = getCapability(capabilityId);
  if (!cap) return null;
  const available = cap.providers.filter(p => !opts.excludeProvider || p.id !== opts.excludeProvider);
  if (!available.length) return null;
  return available.sort((a, b) => {
    if (opts.quality)  return b.quality  - a.quality;
    if (opts.cheapest) return a.credits  - b.credits;
    return a.latencyMs - b.latencyMs;
  })[0];
}

/**
 * Get fallback chain for a capability.
 */
function getFallbackChain(capabilityId, primaryProvider) {
  const cap = getCapability(capabilityId);
  if (!cap) return [];
  return cap.providers.filter(p => p.id !== primaryProvider).sort((a, b) => a.latencyMs - b.latencyMs);
}

function registerCapability(def) {
  const store = _load();
  store.custom[def.id] = def;
  _save(store);
}

function getStats() {
  const caps = getAll();
  const total = Object.keys(caps).length;
  const providers = new Set();
  let totalProviders = 0;
  for (const c of Object.values(caps)) {
    (c.providers || []).forEach(p => { providers.add(p.id); totalProviders++; });
  }
  return { capabilities: total, uniqueProviders: providers.size, totalProviderSlots: totalProviders };
}

module.exports = {
  getAll, getCapability, listCapabilities,
  getBestProvider, getFallbackChain,
  registerCapability, getStats,
  BUILTIN_CAPABILITIES,
};
