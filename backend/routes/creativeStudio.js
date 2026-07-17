"use strict";
/**
 * Creative Studio Routes — all 10 modules.
 *
 * MODULE 1 – Creative Registry          /creative/registry/*
 * MODULE 2 – Unified Creative Router    /creative/route/*
 * MODULE 3 – Image Studio               /creative/image/*
 * MODULE 4 – Video Studio               /creative/video/*
 * MODULE 5 – Voice Studio               /creative/voice/*
 * MODULE 6 – Brand Studio               /creative/brand/*
 * MODULE 7 – Social Content Engine      /creative/social/*
 * MODULE 8 – Creative Workspace         /creative/workspace/*
 * MODULE 9 – Asset Library              /creative/assets/*
 * MODULE 10 – Commercial Benchmark      /creative/benchmark
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const creativeRegistry = require("../services/creativeRegistry.cjs");
const creativeRouter   = require("../services/creativeRouter.cjs");
const assets           = require("../services/creativeAssetLibrary.cjs");
const brandStudio      = require("../services/brandStudio.cjs");
const socialEngine     = require("../services/socialContentEngine.cjs");
const jobQueue         = require("../services/creativeJobQueue.cjs");
const benchmark        = require("../services/creativeBenchmark.cjs");
const creditEngine     = require("../services/creditEngine.cjs");

// Lazy-load aiService
function _ai() {
  try { return require("../services/aiService"); } catch { return null; }
}

router.use("/creative", requireAuth);

function _account(req) { return req.user?.sub || req.user?.accountId || req.user?.id || "unknown"; }
function _plan(req)    { return req.user?.plan || "trial"; }

// ══════════════════════════════════════════════════════════════════
// MODULE 1: Creative Registry
// ══════════════════════════════════════════════════════════════════

router.get("/creative/registry", (req, res) => {
  try { res.json({ ok: true, capabilities: creativeRegistry.listCapabilities(), stats: creativeRegistry.getStats() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/registry/:id", (req, res) => {
  try {
    const cap = creativeRegistry.getCapability(req.params.id);
    if (!cap) return res.status(404).json({ error: "capability_not_found" });
    res.json({ ok: true, capability: cap });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/registry", (req, res) => {
  try {
    const def = req.body;
    if (!def?.id || !def?.providers) return res.status(400).json({ error: "id and providers required" });
    creativeRegistry.registerCapability(def);
    res.json({ ok: true, capability: creativeRegistry.getCapability(def.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 2: Unified Creative Router
// ══════════════════════════════════════════════════════════════════

router.post("/creative/route", (req, res) => {
  try {
    const { intent, capability, preferQuality, preferCheap } = req.body || {};
    if (!intent && !capability) return res.status(400).json({ error: "intent or capability required" });
    const decision = creativeRouter.route({
      intent, capability,
      accountId: _account(req), plan: _plan(req),
      preferQuality, preferCheap,
    });
    res.json({ ok: true, decision });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/route/capabilities", (req, res) => {
  try { res.json({ ok: true, capabilities: creativeRouter.listCapabilities() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/route/detect", (req, res) => {
  try {
    const { intent } = req.body || {};
    if (!intent) return res.status(400).json({ error: "intent required" });
    const detected = creativeRouter.detectCapability(intent);
    const cap      = creativeRegistry.getCapability(detected);
    res.json({ ok: true, detected, capability: cap });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 3: Image Studio
// ══════════════════════════════════════════════════════════════════

async function _createCreativeJob(req, res, capability, studioType, promptKey = "prompt") {
  try {
    const body   = req.body || {};
    const prompt = body[promptKey] || body.prompt;
    if (!prompt) return res.status(400).json({ error: `${promptKey} required` });

    const decision = creativeRouter.route({
      capability, accountId: _account(req), plan: _plan(req),
      preferQuality: body.quality === "high",
    });
    if (!decision.ok) return res.status(400).json({ error: decision.error });

    if (!decision.creditCheck.allowed) {
      return res.status(402).json({ error: "insufficient_credits", creditCheck: decision.creditCheck });
    }

    const job = jobQueue.createJob({
      capability, studioType,
      provider: decision.provider, model: decision.model,
      prompt, accountId: _account(req), params: body,
    });

    // Attempt actual AI call (falls back gracefully if no key)
    jobQueue.startJob(job.id);
    let outputUrl = null;
    let aiOutput  = null;

    try {
      const ai = _ai();
      if (ai?.callAI) {
        const aiPrompt = `You are a creative AI assistant. ${capability.replace(/_/g," ")}: "${prompt}".
Respond with a JSON object: { "result": "description of what was generated", "url": null, "metadata": {} }`;
        const aiResult = await ai.callAI(aiPrompt, { maxTokens: 256 });
        aiOutput = aiResult?.content || aiResult?.text || null;
        try { const parsed = JSON.parse(aiOutput); outputUrl = parsed.url; aiOutput = parsed; } catch {}
      }
    } catch {}

    // Store asset regardless
    const storedAsset = assets.storeAsset({
      type: studioType, prompt, provider: decision.provider,
      capability, model: decision.model,
      url: outputUrl, accountId: _account(req),
      jobId: job.id, tags: body.tags || [],
      folder: body.folder || studioType,
      metadata: { params: body, aiOutput },
    });

    // Consume credits
    creativeRouter.consumeCredits(_account(req), decision, _plan(req));
    const completed = jobQueue.completeJob(job.id, { assetId: storedAsset.id, outputUrl, credits: decision.creditsRequired });

    res.json({
      ok: true, job: completed, asset: storedAsset, decision,
      output: aiOutput, creditsUsed: decision.creditsRequired,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

router.post("/creative/image/generate",          (req, res) => _createCreativeJob(req, res, "image_generate",        "image"));
router.post("/creative/image/edit",              (req, res) => _createCreativeJob(req, res, "image_edit",            "image"));
router.post("/creative/image/upscale",           (req, res) => _createCreativeJob(req, res, "image_upscale",         "image", "imageUrl"));
router.post("/creative/image/remove-background", (req, res) => _createCreativeJob(req, res, "background_remove",     "image", "imageUrl"));
router.post("/creative/image/logo",              (req, res) => _createCreativeJob(req, res, "logo_generate",         "image"));
router.post("/creative/image/banner",            (req, res) => _createCreativeJob(req, res, "banner_generate",       "image"));

router.get("/creative/image/history", (req, res) => {
  try {
    const jobs = jobQueue.listJobs({ studioType: "image", accountId: _account(req), limit: 50 });
    res.json({ ok: true, jobs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 4: Video Studio
// ══════════════════════════════════════════════════════════════════

router.post("/creative/video/text-to-video",  (req, res) => _createCreativeJob(req, res, "text_to_video",  "video"));
router.post("/creative/video/image-to-video", (req, res) => _createCreativeJob(req, res, "image_to_video", "video", "imageUrl"));
router.post("/creative/video/reel",           (req, res) => _createCreativeJob(req, res, "text_to_video",  "video"));
router.post("/creative/video/short",          (req, res) => _createCreativeJob(req, res, "text_to_video",  "video"));
router.post("/creative/video/animation",      (req, res) => _createCreativeJob(req, res, "animation_generate", "video"));

router.get("/creative/video/queue", (req, res) => {
  try {
    const jobs = jobQueue.listJobs({ studioType: "video", accountId: _account(req), limit: 50 });
    const summary = { queued: 0, running: 0, complete: 0, failed: 0 };
    jobs.forEach(j => { summary[j.status] = (summary[j.status] || 0) + 1; });
    res.json({ ok: true, jobs, summary });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/video/history", (req, res) => {
  try { res.json({ ok: true, jobs: jobQueue.listJobs({ studioType: "video", accountId: _account(req) }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 5: Voice Studio
// ══════════════════════════════════════════════════════════════════

router.post("/creative/voice/tts", (req, res) => _createCreativeJob(req, res, "text_to_speech", "audio"));
router.post("/creative/voice/stt", (req, res) => _createCreativeJob(req, res, "speech_to_text", "audio", "audioUrl"));
router.post("/creative/voice/music", (req, res) => _createCreativeJob(req, res, "music_generate", "audio"));

router.post("/creative/voice/clone", async (req, res) => {
  try {
    const { sampleUrl, voiceName, consentConfirmed } = req.body || {};
    if (!sampleUrl) return res.status(400).json({ error: "sampleUrl required" });
    if (!consentConfirmed) {
      return res.status(400).json({
        error: "consent_required",
        message: "Voice cloning requires explicit consent from the voice owner. Set consentConfirmed: true to proceed.",
        consentRequired: true,
      });
    }
    return _createCreativeJob(req, res, "voice_clone", "audio", "sampleUrl");
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/voice/history", (req, res) => {
  try { res.json({ ok: true, jobs: jobQueue.listJobs({ studioType: "audio", accountId: _account(req) }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 6: Brand Studio
// ══════════════════════════════════════════════════════════════════

router.get("/creative/brand", (req, res) => {
  try { res.json({ ok: true, kits: brandStudio.listKits(_account(req)), stats: brandStudio.getStats() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/brand", (req, res) => {
  try {
    const kit = brandStudio.createKit({ ...req.body, accountId: _account(req) });
    res.json({ ok: true, kit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/brand/:id", (req, res) => {
  try {
    const kit = brandStudio.getKit(req.params.id);
    if (!kit) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, kit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/creative/brand/:id", (req, res) => {
  try {
    const kit = brandStudio.updateKit(req.params.id, req.body);
    if (!kit) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, kit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/creative/brand/:id", (req, res) => {
  try {
    const ok = brandStudio.deleteKit(req.params.id);
    res.json({ ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/creative/brand/:id/voice", (req, res) => {
  try {
    const kit = brandStudio.updateBrandVoice(req.params.id, req.body);
    if (!kit) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, kit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/brand/:id/logo", (req, res) => {
  try {
    const { assetId, variant } = req.body || {};
    if (!assetId) return res.status(400).json({ error: "assetId required" });
    const kit = brandStudio.attachLogo(req.params.id, assetId, variant);
    if (!kit) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, kit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/brand/:id/template", (req, res) => {
  try {
    const kit = brandStudio.addTemplate(req.params.id, req.body);
    if (!kit) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, kit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/brand/:id/brief", (req, res) => {
  try {
    const brief = brandStudio.buildIdentityBrief(req.params.id);
    if (!brief) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, brief });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/brand/:id/generate", async (req, res) => {
  try {
    const brief     = brandStudio.buildIdentityBrief(req.params.id);
    if (!brief) return res.status(404).json({ error: "brand_kit_not_found" });

    const { what = "logo" } = req.body || {};
    const capMap = { logo: "logo_generate", banner: "banner_generate", ad: "ad_generate" };
    const cap    = capMap[what] || "logo_generate";

    req.body = { ...req.body, prompt: brief.prompts[what] || brief.prompts.logo };
    return _createCreativeJob(req, res, cap, "image");
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 7: Social Content Engine
// ══════════════════════════════════════════════════════════════════

router.get("/creative/social/platforms", (req, res) => {
  try { res.json({ ok: true, platforms: socialEngine.listPlatforms() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/social/generate", async (req, res) => {
  try {
    const { platform, brief, format, brandVoice, audience, goal, brandKitId } = req.body || {};
    if (!platform) return res.status(400).json({ error: "platform required" });
    if (!brief)    return res.status(400).json({ error: "brief required" });

    let voice = brandVoice;
    if (!voice && brandKitId) {
      const kit = brandStudio.getKit(brandKitId);
      if (kit) voice = `${kit.brandVoice.tone}, ${(kit.brandVoice.personality || []).join(", ")}`;
    }

    const request = socialEngine.buildGenerationRequest(platform, brief, { format, brandVoice: voice, audience, goal });
    if (!request.ok) return res.status(400).json({ error: request.error });

    // Call AI with the prompt
    let result = null;
    try {
      const ai = _ai();
      if (ai?.callAI) {
        const raw = await ai.callAI(request.prompt, { maxTokens: 1024 });
        const text = raw?.content || raw?.text || "";
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          result = jsonMatch ? JSON.parse(jsonMatch[0]) : { caption: text, hashtags: [], hook: "", cta: "" };
        } catch { result = { caption: text, hashtags: [] }; }
      } else {
        result = {
          caption:      `Compelling ${platform} content for: ${brief}`,
          hashtags:     ["#ooplix", "#ai", `#${platform}`],
          hook:         `You won't believe this...`,
          cta:          "Comment below!",
          variations:   ["Alternative 1", "Alternative 2"],
          bestTime:     "Tuesday 9am or Thursday 6pm",
          carouselCopy: ["Slide 1", "Slide 2", "Slide 3"],
        };
      }
    } catch {
      result = { caption: `${platform} content for: ${brief}`, hashtags: [] };
    }

    const entry = socialEngine.storeGeneration(platform, brief, result, {
      accountId: _account(req), format,
    });

    res.json({ ok: true, platform, result, entry, request });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/social/multi", async (req, res) => {
  try {
    const { platforms, brief, ...opts } = req.body || {};
    if (!platforms?.length) return res.status(400).json({ error: "platforms array required" });
    if (!brief)             return res.status(400).json({ error: "brief required" });
    const requests = socialEngine.buildMultiPlatform(platforms, brief, opts);
    res.json({ ok: true, requests, count: requests.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/social/history", (req, res) => {
  try {
    const history = socialEngine.getHistory({ accountId: _account(req), platform: req.query.platform, limit: parseInt(req.query.limit || "50") });
    res.json({ ok: true, history, stats: socialEngine.getStats() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 8: Creative Workspace
// ══════════════════════════════════════════════════════════════════

router.get("/creative/workspace", (req, res) => {
  try {
    const accountId = _account(req);
    const jobSummary = jobQueue.getSummary();
    const assetStats = assets.getStats();
    const recentJobs = jobQueue.listJobs({ accountId, limit: 10 });
    const recentAssets = assets.listAssets({ accountId, limit: 12 });
    const favoriteAssets = assets.listAssets({ accountId, favorite: true, limit: 10 });
    const folders = assets.getFolders();
    const tags    = assets.getTags().slice(0, 20);
    const brandKits = brandStudio.listKits(accountId);

    res.json({
      ok: true,
      jobs:    jobSummary,
      assets:  assetStats,
      recentJobs,
      recentAssets,
      favoriteAssets,
      folders,
      tags,
      brandKits,
      ts: new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/workspace/queue", (req, res) => {
  try {
    const running = jobQueue.listJobs({ status: "running",  limit: 20 });
    const queued  = jobQueue.listJobs({ status: "queued",   limit: 20 });
    res.json({ ok: true, running, queued, summary: jobQueue.getSummary() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/workspace/recent", (req, res) => {
  try {
    const accountId = _account(req);
    const type      = req.query.type || null;
    const items     = assets.listAssets({ accountId, type, limit: 24 });
    res.json({ ok: true, assets: items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/workspace/collections", (req, res) => {
  try {
    const folders = assets.getFolders();
    res.json({ ok: true, collections: folders });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/workspace/favorites", (req, res) => {
  try {
    const items = assets.listAssets({ accountId: _account(req), favorite: true, limit: 50 });
    res.json({ ok: true, assets: items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/workspace/jobs/:id", (req, res) => {
  try {
    const job = jobQueue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, job });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 9: Asset Library
// ══════════════════════════════════════════════════════════════════

router.get("/creative/assets", (req, res) => {
  try {
    const opts = {
      type:       req.query.type,
      folder:     req.query.folder,
      tag:        req.query.tag,
      capability: req.query.capability,
      search:     req.query.search,
      accountId:  _account(req),
      limit:      parseInt(req.query.limit || "50"),
    };
    const list  = assets.listAssets(opts);
    const stats = assets.getStats();
    res.json({ ok: true, assets: list, stats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/assets/folders", (req, res) => {
  try { res.json({ ok: true, folders: assets.getFolders() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/assets/tags", (req, res) => {
  try { res.json({ ok: true, tags: assets.getTags() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/assets/:id", (req, res) => {
  try {
    const asset = assets.getAsset(req.params.id);
    if (!asset) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, asset });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/assets", (req, res) => {
  try {
    const asset = assets.storeAsset({ ...req.body, accountId: _account(req) });
    res.json({ ok: true, asset });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/assets/:id/favorite", (req, res) => {
  try {
    const asset = assets.toggleFavorite(req.params.id);
    if (!asset) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, asset });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/assets/:id/tag", (req, res) => {
  try {
    const { tag } = req.body || {};
    if (!tag) return res.status(400).json({ error: "tag required" });
    const asset = assets.addTag(req.params.id, tag);
    if (!asset) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, asset });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/assets/:id/move", (req, res) => {
  try {
    const { folder } = req.body || {};
    if (!folder) return res.status(400).json({ error: "folder required" });
    const asset = assets.moveToFolder(req.params.id, folder);
    if (!asset) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, asset });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/creative/assets/:id", (req, res) => {
  try {
    const ok = assets.deleteAsset(req.params.id);
    res.json({ ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reuse ref for Browser Automation and Engineering Workspace
router.get("/creative/assets/:id/reuse", (req, res) => {
  try {
    const ref = assets.getReuseRef(req.params.id);
    if (!ref) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, ref });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 10: Commercial Benchmark
// ══════════════════════════════════════════════════════════════════

router.get("/creative/benchmark", async (req, res) => {
  try {
    const result = await benchmark.runBenchmark();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
