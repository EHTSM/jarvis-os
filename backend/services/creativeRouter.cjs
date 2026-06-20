"use strict";
/**
 * Unified Creative Router — user never selects a provider.
 *
 * Intent → capability detection → best provider → fallback chain
 *        → credit validation → execution decision returned.
 *
 * Reuses: creditEngine, smartRouter, capabilityRouter, creativeRegistry.
 *
 * Does NOT execute AI calls — returns a routing decision for the caller
 * to execute with the appropriate adapter.
 */

const creditEngine    = require("./creditEngine.cjs");
const creativeRegistry = require("./creativeRegistry.cjs");

// Intent → capability keyword map
const INTENT_PATTERNS = [
  { pattern: /\b(ad|advertisement|campaign|promote|commercial)\b/i,         cap: "ad_generate" },
  { pattern: /\b(logo|brand mark|emblem|icon design)\b/i,                   cap: "logo_generate" },
  { pattern: /\b(banner|header image|cover photo|social header)\b/i,        cap: "banner_generate" },
  { pattern: /\b(presentation|slide|deck|pitch)\b/i,                        cap: "presentation_generate" },
  { pattern: /\b(music|song|jingle|soundtrack|audio track)\b/i,             cap: "music_generate" },
  { pattern: /\b(animation|animate|motion|gif|animated)\b/i,                cap: "animation_generate" },
  { pattern: /\b(text.to.video|generate video|create video|video clip)\b/i, cap: "text_to_video" },
  { pattern: /\b(image.to.video|animate.image|bring.to.life)\b/i,           cap: "image_to_video" },
  { pattern: /\b(clone voice|voice clone|replicate voice)\b/i,              cap: "voice_clone" },
  { pattern: /\b(text.to.speech|read.aloud|speak|narrate|tts)\b/i,          cap: "text_to_speech" },
  { pattern: /\b(transcribe|speech.to.text|stt|transcript)\b/i,             cap: "speech_to_text" },
  { pattern: /\b(remove background|bg remove|transparent bg)\b/i,           cap: "background_remove" },
  { pattern: /\b(upscale|enhance resolution|4x|super.resol)\b/i,            cap: "image_upscale" },
  { pattern: /\b(edit image|inpaint|outpaint|modify image|change)\b/i,      cap: "image_edit" },
  { pattern: /\b(image|photo|picture|illustration|artwork|visual|design)\b/i, cap: "image_generate" },
];

/**
 * Detect creative capability from natural language intent.
 */
function detectCapability(intent) {
  const s = (intent || "").toLowerCase();
  for (const { pattern, cap } of INTENT_PATTERNS) {
    if (pattern.test(s)) return cap;
  }
  return "image_generate"; // safe default
}

/**
 * Route a creative request.
 *
 * Returns:
 * {
 *   ok: boolean,
 *   capability, provider, model, fallbackChain,
 *   creditsRequired, creditCheck, source, explanation
 * }
 */
function route(opts = {}) {
  const { intent, capability: explicitCap, accountId, plan = "trial",
          preferQuality, preferCheap, excludeProvider } = opts;

  const capability = explicitCap || detectCapability(intent);
  const cap        = creativeRegistry.getCapability(capability);

  if (!cap) {
    return { ok: false, error: `Unknown capability: ${capability}` };
  }

  const primary = creativeRegistry.getBestProvider(capability, {
    quality: !!preferQuality,
    cheapest: !!preferCheap,
    excludeProvider,
  });

  if (!primary) {
    return { ok: false, capability, error: "No provider available for this capability" };
  }

  const fallbackChain = creativeRegistry.getFallbackChain(capability, primary.id);

  // Credit validation
  let creditCheck = { allowed: true, remaining: 999, reason: "no_account" };
  if (accountId) {
    creditCheck = creditEngine.checkCredit(accountId, "creative", plan);
  }

  // Pick first available model
  const model = (primary.models || [])[0] || "default";

  return {
    ok:              true,
    capability,
    capabilityLabel: cap.label,
    provider:        primary.id,
    providerName:    primary.name,
    model,
    models:          primary.models,
    creditsRequired: primary.credits,
    quality:         primary.quality,
    latencyMs:       primary.latencyMs,
    streamSupport:   primary.stream,
    fallbackChain:   fallbackChain.map(p => ({ id: p.id, name: p.name, model: p.models[0] })),
    creditCheck,
    source:          "creative_router",
    explanation:     `Routing "${intent || capability}" → ${cap.label} → ${primary.name} (${model})`,
  };
}

/**
 * Consume credits for a completed creative job.
 */
function consumeCredits(accountId, routingDecision, plan = "trial") {
  if (!accountId) return { ok: true, note: "no_account" };
  return creditEngine.consume(accountId, "creative", {
    plan,
    cost: routingDecision.creditsRequired || 2,
    meta: { capability: routingDecision.capability, provider: routingDecision.provider },
  });
}

/**
 * List all routable capabilities with routing metadata.
 */
function listCapabilities() {
  return creativeRegistry.listCapabilities();
}

module.exports = { route, detectCapability, consumeCredits, listCapabilities };
