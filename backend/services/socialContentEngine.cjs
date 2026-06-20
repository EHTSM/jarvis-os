"use strict";
/**
 * Social Content Engine — generate optimized content for every platform.
 *
 * Platforms: Instagram, Facebook, LinkedIn, Pinterest, X, YouTube,
 *            Threads, Blog, Email, Ads.
 *
 * Each platform spec: maxLength, hashtagStyle, captionStyle, bestFormats.
 * Uses creditEngine for cost tracking.
 * Delegates AI generation to the aiService (Claude by default).
 *
 * Storage: data/social-content-history.json (last 200 generations)
 */

const fs   = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "../../data/social-content-history.json");

// ── Platform specs ─────────────────────────────────────────────────
const PLATFORMS = {
  instagram: {
    id: "instagram", label: "Instagram",
    maxCaption: 2200, maxHashtags: 30, hashtagStyle: "inline_and_block",
    formats: ["post", "reel", "story", "carousel"],
    tips: "Warm, aspirational tone. 3-5 hashtags inline, 15-25 in first comment.",
  },
  facebook: {
    id: "facebook", label: "Facebook",
    maxCaption: 63206, maxHashtags: 5, hashtagStyle: "minimal",
    formats: ["post", "story", "reel", "event"],
    tips: "Conversational, community-focused. Emojis welcome. Ask questions.",
  },
  linkedin: {
    id: "linkedin", label: "LinkedIn",
    maxCaption: 3000, maxHashtags: 5, hashtagStyle: "end",
    formats: ["post", "article", "carousel", "newsletter"],
    tips: "Professional, insight-driven. Hook in first line. Data and stories.",
  },
  pinterest: {
    id: "pinterest", label: "Pinterest",
    maxCaption: 500, maxHashtags: 20, hashtagStyle: "inline",
    formats: ["pin", "board", "story_pin"],
    tips: "Keyword-rich, helpful, aspirational. Visual description essential.",
  },
  x: {
    id: "x", label: "X (Twitter)",
    maxCaption: 280, maxHashtags: 2, hashtagStyle: "inline",
    formats: ["tweet", "thread", "space"],
    tips: "Punchy, direct, opinionated. Threads for depth. 1-2 hashtags max.",
  },
  youtube: {
    id: "youtube", label: "YouTube",
    maxCaption: 5000, maxHashtags: 15, hashtagStyle: "end",
    formats: ["video", "short", "community_post"],
    tips: "SEO-driven title. First 100 chars of description shown in search.",
  },
  threads: {
    id: "threads", label: "Threads",
    maxCaption: 500, maxHashtags: 5, hashtagStyle: "end",
    formats: ["post", "thread"],
    tips: "Conversational, direct. Like X but more casual. No hashtag spam.",
  },
  blog: {
    id: "blog", label: "Blog",
    maxCaption: 100000, maxHashtags: 0, hashtagStyle: "none",
    formats: ["article", "listicle", "how_to", "case_study"],
    tips: "Long-form, SEO-optimized. H2/H3 structure. Include TL;DR.",
  },
  email: {
    id: "email", label: "Email",
    maxCaption: 200, maxHashtags: 0, hashtagStyle: "none",
    formats: ["newsletter", "promotional", "welcome", "drip"],
    tips: "Subject line < 50 chars. Personalized. Clear single CTA.",
  },
  ads: {
    id: "ads", label: "Ads",
    maxCaption: 125, maxHashtags: 0, hashtagStyle: "none",
    formats: ["google_search", "facebook_ad", "instagram_ad", "display"],
    tips: "Benefit-first headline. USP clear. Strong CTA. A/B test copy.",
  },
};

// ── Storage ────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return { history: [] }; }
}

function _save(d) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}

function _genId() { return `sc-${Date.now()}-${Math.random().toString(36).slice(2,5)}`; }

// ── Generation ─────────────────────────────────────────────────────

/**
 * Build the AI prompt for a platform + brief combination.
 */
function buildPrompt(platform, brief, opts = {}) {
  const spec = PLATFORMS[platform];
  if (!spec) throw new Error(`Unknown platform: ${platform}`);

  const format = opts.format || spec.formats[0];
  const hashtagCount = opts.hashtagCount || Math.floor(spec.maxHashtags * 0.6);

  return `You are a world-class social media strategist and copywriter.

Platform: ${spec.label}
Format: ${format}
Topic/Brief: ${brief}
Brand Voice: ${opts.brandVoice || "professional, engaging, authentic"}
Target Audience: ${opts.audience || "general audience"}
Goal: ${opts.goal || "engagement and reach"}
Character limit: ${spec.maxCaption}
Hashtag style: ${spec.hashtagStyle} (${hashtagCount} hashtags)
Platform tips: ${spec.tips}

Generate:
1. CAPTION — optimized for ${spec.label}, within ${spec.maxCaption} chars
2. HASHTAGS — ${hashtagCount} hashtags in ${spec.hashtagStyle} style
3. HOOK — first 2 lines designed to stop the scroll
4. CTA — clear call to action
5. VARIATIONS — 2 alternative headline/caption variations
6. BEST_TIME — best time to post on ${spec.label}
7. CAROUSEL_COPY — if applicable, 5 slide titles

Respond as JSON with keys: caption, hashtags (array), hook, cta, variations (array), bestTime, carouselCopy (array).`;
}

/**
 * Parse or mock AI response (no actual AI call — returns structure
 * that can be populated by caller via aiService.callAI).
 */
function buildGenerationRequest(platform, brief, opts = {}) {
  const spec = PLATFORMS[platform];
  if (!spec) return { ok: false, error: `Unknown platform: ${platform}` };
  return {
    ok:       true,
    platform,
    spec,
    format:   opts.format || spec.formats[0],
    prompt:   buildPrompt(platform, brief, opts),
    capability: "ad_generate",
    creditCost: 2,
  };
}

/**
 * Store a completed generation in history.
 */
function storeGeneration(platform, brief, result, opts = {}) {
  const store = _load();
  const entry = {
    id:        _genId(),
    platform,
    brief,
    result,
    accountId: opts.accountId || null,
    assetId:   opts.assetId   || null,
    format:    opts.format     || "post",
    ts:        new Date().toISOString(),
  };
  store.history.unshift(entry);
  store.history = store.history.slice(0, 200);
  _save(store);
  return entry;
}

function getHistory(opts = {}) {
  const store = _load();
  let   list  = store.history || [];
  if (opts.platform)  list = list.filter(h => h.platform === opts.platform);
  if (opts.accountId) list = list.filter(h => h.accountId === opts.accountId);
  return list.slice(0, opts.limit || 50);
}

// ── Batch generation request builder ──────────────────────────────

/**
 * Build generation requests for multiple platforms at once.
 */
function buildMultiPlatform(platforms, brief, opts = {}) {
  return platforms.map(p => buildGenerationRequest(p, brief, opts));
}

function listPlatforms() {
  return Object.values(PLATFORMS);
}

function getPlatform(id) {
  return PLATFORMS[id] || null;
}

function getStats() {
  const store = _load();
  const hist  = store.history || [];
  const byPlat = {};
  for (const h of hist) byPlat[h.platform] = (byPlat[h.platform] || 0) + 1;
  return { total: hist.length, byPlatform: byPlat };
}

module.exports = {
  buildGenerationRequest, buildMultiPlatform, buildPrompt,
  storeGeneration, getHistory,
  listPlatforms, getPlatform, getStats,
  PLATFORMS,
};
