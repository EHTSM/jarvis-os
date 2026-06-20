"use strict";
/**
 * Capability Router — user asks for work, router chooses capability (not provider).
 *
 * Input:  natural language intent OR explicit capability key.
 * Output: { capability, providerId, model, fallbackChain, reason, creditCost }
 *
 * Reuses: aiRegistry.bestFor(), smartRouter.route(), creditEngine.checkCredit()
 */

const aiRegistry   = require("./aiRegistry.cjs");
const smartRouter  = require("./smartRouter.cjs");
const creditEngine = require("./creditEngine.cjs");

// ── Intent → Capability map ───────────────────────────────────────
const INTENT_PATTERNS = [
  { cap: "code",       patterns: [/code|program|implement|function|class|debug|fix|refactor|test|lint|syntax|typescript|python|javascript|rust|go|sql/i] },
  { cap: "reasoning",  patterns: [/reason|think|analyze|explain|plan|compare|evaluate|decide|strategy|hypothesis|deduce/i] },
  { cap: "vision",     patterns: [/image|photo|picture|screenshot|diagram|describe.*visual|what.*in.*image|ocr|read.*image/i] },
  { cap: "image",      patterns: [/generate.*image|create.*image|draw|paint|illustration|artwork|logo|icon|poster|dalle|stable\s?diff/i] },
  { cap: "video",      patterns: [/video|animation|animate|movie|clip|render.*motion/i] },
  { cap: "speech",     patterns: [/speak|narrate|text.?to.?speech|tts|read.*aloud|voice.*over/i] },
  { cap: "voice",      patterns: [/transcribe|speech.?to.?text|stt|listen|microphone|audio.*to|whisper/i] },
  { cap: "music",      patterns: [/music|song|melody|compose|soundtrack|beat|audio.*generate/i] },
  { cap: "browser",    patterns: [/browse|scrape|click|navigate|fill.*form|automate.*browser|playwright|chrome|screenshot.*web/i] },
  { cap: "embeddings", patterns: [/embed|vector|semantic.*search|similarity|retrieval|RAG|chunk/i] },
  { cap: "animation",  patterns: [/3d.*animation|animate.*3d|rigging|character.*animation/i] },
  { cap: "3d",         patterns: [/3d.*model|mesh|render.*3d|CAD|geometry|point.*cloud/i] },
  { cap: "chat",       patterns: [/.*/] }, // fallback
];

/**
 * Detect capability from intent string.
 */
function detectCapability(intent) {
  for (const { cap, patterns } of INTENT_PATTERNS) {
    if (patterns.some(p => p.test(intent))) return cap;
  }
  return "chat";
}

/**
 * Route a user request to the best provider + model for the needed capability.
 *
 * @param {object} opts
 *   intent         string   natural language or raw capability key
 *   accountId      string
 *   plan           string
 *   userPref       string?  preferred provider id
 *   enterprisePolicy object?
 *   availableKeys  string[]
 *   prefer         "quality"|"cost"|"speed"
 *
 * @returns {object} { capability, primary, model, fallbackChain, creditCheck, scores, reason }
 */
function route(opts = {}) {
  const intent    = opts.intent || "";
  const prefer    = opts.prefer || "cost";
  const accountId = opts.accountId || "unknown";
  const plan      = opts.plan || "trial";

  // 1. Detect capability
  const capability = aiRegistry.CAPABILITIES.includes(intent)
    ? intent
    : detectCapability(intent);

  // 2. Find best provider for this capability
  const best = aiRegistry.bestFor(capability, {
    prefer,
    minQuality:    opts.minQuality || 0.6,
    maxCostPer1k:  opts.maxCostPer1k,
  });

  // 3. Build fallback chain (same capability, sorted by cost)
  const capProviders = aiRegistry.getByCapability(capability)
    .map(p => ({ id: p.id, name: p.name, cap: p.capabilities[capability] }))
    .filter(p => p.cap)
    .sort((a, b) => (a.cap.costPer1k || 0) - (b.cap.costPer1k || 0))
    .map(p => ({ providerId: p.id, model: p.cap.models?.[0] || "default", costPer1k: p.cap.costPer1k }));

  // 4. Credit check
  const creditCheck = creditEngine.checkCredit(accountId, capability, plan);

  // 5. Smart router scores (for the underlying transport if it's a text-based cap)
  const textCaps = ["chat","code","reasoning","vision","embeddings","browser"];
  let routerResult = null;
  if (textCaps.includes(capability)) {
    routerResult = smartRouter.route({
      task:          capability,
      userPref:      opts.userPref,
      availableKeys: opts.availableKeys || [],
      enterprisePolicy: opts.enterprisePolicy,
    });
  }

  return {
    capability,
    primary:       best?.providerId || routerResult?.primary?.id || "groq",
    model:         best?.model || routerResult?.model || "default",
    providerName:  best?.providerName,
    fallbackChain: capProviders,
    creditCheck,
    scores:        best ? { quality: best.quality, costPer1k: best.costPer1k, latencyClass: best.latencyClass } : null,
    routerResult:  routerResult ? { primary: routerResult.primary?.id, scores: routerResult.scores } : null,
    reason:        opts.userPref ? "user_pref" : `capability_optimized_${prefer}`,
    detectedFrom:  intent !== capability ? intent : null,
  };
}

/**
 * List all available capabilities and which providers cover them.
 */
function listCapabilities() {
  return aiRegistry.getAllCapabilities().map(cap => ({
    capability: cap,
    providers: aiRegistry.getByCapability(cap).map(p => ({
      id: p.id, name: p.name, type: p.type,
      model: p.capabilities[cap]?.models?.[0],
      costPer1k: p.capabilities[cap]?.costPer1k,
      quality: p.capabilities[cap]?.quality,
      latencyClass: p.capabilities[cap]?.latencyClass,
    })),
  }));
}

module.exports = { route, detectCapability, listCapabilities };
