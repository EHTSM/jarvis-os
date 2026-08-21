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
const { attachOrg } = require("../middleware/orgMiddleware.cjs");
const rateLimiter = require("../middleware/rateLimiter");

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

// Enterprise Import/Export Validation mission — real generation agents.
// Reused, not duplicated: agents/content/imageGeneratorAgent.cjs already
// makes a genuine DALL-E 3 call (real image bytes hosted by OpenAI, real
// URL returned) and agents/content/voiceCloningAgent.cjs already makes
// genuine ElevenLabs/OpenAI TTS calls (real MP3 bytes written to disk).
// Neither was ever wired to this route file — every capability here
// previously went through a generic text-LLM stub that asked the model to
// "respond with JSON {result, url: null}", so image/voice generation
// requests always returned no media despite real generation code existing
// elsewhere in the repo.
function _imageAgent() {
  try { return require("../../agents/content/imageGeneratorAgent.cjs"); } catch { return null; }
}
function _voiceAgent() {
  try { return require("../../agents/content/voiceCloningAgent.cjs"); } catch { return null; }
}
// Enterprise Capability Expansion mission — real Sora video rendering via
// videoGeneratorAgent.cjs's generateRealVideo(), credential-gated on
// OPENAI_API_KEY exactly like the image/voice agents above. The same file
// also exports generate()/run(), a genuinely useful text production-brief
// generator that predates this mission and stays wired to the autonomous
// agent runtime (content_video, capability video_brief) — this route only
// adds the byte-producing path, it doesn't touch that one.
function _videoAgent() {
  try { return require("../../agents/content/videoGeneratorAgent.cjs"); } catch { return null; }
}
// Enterprise Capability Expansion mission — real pixel-level processing
// (resize/format-convert/rotate/grayscale) via sharp, no AI provider or
// credential needed. Deliberately does NOT cover background_remove (needs
// ML segmentation sharp cannot do) — that capability stays on the honest
// text-only fallback below rather than faking a cutout.
function _imageProcessor() {
  try { return require("../../agents/content/imageProcessorAgent.cjs"); } catch { return null; }
}

// Capabilities with a real, byte-producing generator behind them (vs. the
// text-LLM fallback used for every other capability, which never produces
// real media — see the honest `generated:false`/`note` fields it now
// returns instead of silently claiming success).
const REAL_IMAGE_CAPABILITIES = new Set(["image_generate", "logo_generate", "banner_generate"]);
const REAL_VOICE_CAPABILITIES = new Set(["text_to_speech"]);
const REAL_VIDEO_CAPABILITIES = new Set(["text_to_video"]);
const REAL_IMAGE_PROCESSING_CAPABILITIES = new Set(["image_upscale", "image_edit"]);

router.use("/creative", requireAuth);
router.use("/creative", rateLimiter(30, 60_000));

function _account(req) { return req.user?.sub || req.user?.accountId || req.user?.id || "unknown"; }
function _plan(req)    { return req.user?.plan || "trial"; }

// Creative Studio OS pass (2026-08-15): every service behind this route
// keys its records purely by their own generated id — creativeAssetLibrary,
// brandStudio, and creativeJobQueue's getters/mutators take no accountId
// argument at all, so any authenticated caller who knew or guessed another
// account's real asset/brand-kit/job id could read, edit, or (for assets and
// brand kits) permanently delete/overwrite it. Live-reproduced with two real
// accounts: account B read account A's private asset by id (200), then
// deleted it (200, confirmed gone from A's own view); B also renamed A's
// brand kit to prove a persisted cross-account write. This route file is the
// only enforcement point available (the services have no owner concept to
// add a check to without expanding their API across every caller), so the
// fix is a record-ownership check here, immediately after each lookup and
// before any mutation — mirroring the record-not-found response (404) an
// outsider already gets for a nonexistent id, so this never discloses
// whether an id exists for someone else's account.
function _ownedOrDenied(res, record, accountId) {
  if (!record) { res.status(404).json({ error: "not_found" }); return null; }
  if (record.accountId && record.accountId !== accountId) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  return record;
}

// Same-pass companion for the generated-file serving routes below
// (/creative/image|video/file/:filename, /creative/audio/:filename): those
// routes already independently verify the file exists on disk and the
// resolved path stays inside its own directory BEFORE this check runs, so
// unlike _ownedOrDenied() above, "no matching asset record" here is not
// proof of nonexistence — the asset index only gained a `url` field in this
// same pass (see creativeAssetLibrary.cjs), so any file generated before
// this fix has no record to check ownership against. Denying those would
// incorrectly break legitimate access to already-generated files. Deny only
// when a record IS found and belongs to someone else; allow through when no
// record can be matched at all.
function _fileOwnedOrDenied(res, record, accountId) {
  if (record && record.accountId && record.accountId !== accountId) {
    res.status(404).json({ error: "not_found" });
    return false;
  }
  return true;
}

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
  // Hoisted so the outer catch (below) can reap a job stuck at "running" if
  // something throws after createJob()/startJob() but before the job
  // reaches its own completeJob()/failJob() call (e.g. assets.storeAsset()
  // itself throwing) — otherwise that job would stay "running" forever with
  // no restart-recovery mechanism to ever detect or reap it.
  let job = null;
  try {
    const body   = req.body || {};
    const prompt = body[promptKey] || body.prompt;
    if (!prompt) return res.status(400).json({ error: `${promptKey} required` });

    const decision = creativeRouter.route({
      capability, accountId: _account(req), plan: _plan(req),
      preferQuality: body.quality === "high",
    });
    if (!decision.ok) return res.status(400).json({ error: decision.error });

    if (!decision.creditCheck.canProceed) {
      return res.status(402).json({ error: "insufficient_credits", creditCheck: decision.creditCheck });
    }

    // Reserve (check + deduct atomically) before the slow provider call below
    // rather than trusting the earlier decision.creditCheck snapshot. Credit
    // consumption used to happen only after the await'd provider call
    // completed, which left a TOCTOU gap — concurrent requests from the same
    // account could all pass the balance check before any of their slow
    // calls finished, letting every one of them proceed even when the
    // account could only afford a fraction (verified: 25 concurrent requests
    // against a balance of 20 all proceeded pre-fix). Reserving here, before
    // any slow work starts, makes the check-and-deduct atomic per request.
    const reservation = creativeRouter.reserveCredits(_account(req), decision, _plan(req));
    if (!reservation.canProceed) {
      return res.status(402).json({ error: "insufficient_credits", creditCheck: reservation });
    }

    job = jobQueue.createJob({
      capability, studioType,
      provider: decision.provider, model: decision.model,
      prompt, accountId: _account(req), params: body,
    });

    jobQueue.startJob(job.id);
    let outputUrl   = null;
    let aiOutput    = null;
    let generated   = false;
    let generatedVia = null;
    // Queue Layer Reliability & Safety Audit (2026-08-16): failJob() was
    // defined and exported by creativeJobQueue.cjs but never called from
    // anywhere in the codebase — every job reaching this point in the
    // handler, including ones whose real generator threw a genuine
    // exception, ended up calling completeJob() regardless. A real DALL-E/
    // TTS/Sora/image-processor exception (provider outage, invalid key,
    // content-policy rejection, network error) is a real failure, distinct
    // from the "no generator is wired for this capability" branch below,
    // which intentionally and honestly returns a text-only description as
    // its own successful (if limited) outcome. Only the genuine-exception
    // paths set this flag.
    let hardFailure = null;

    if (REAL_IMAGE_CAPABILITIES.has(capability)) {
      // Real path: DALL-E 3 via imageGeneratorAgent.cjs.
      try {
        const agent = _imageAgent();
        const result = await agent?.generate({ topic: prompt, style: body.style, mood: body.mood, size: body.size });
        if (result?.generated && result.imageUrl) {
          outputUrl    = result.imageUrl;
          generated    = true;
          generatedVia = result.via;
        }
        aiOutput = result;
      } catch (e) { aiOutput = { error: e.message }; hardFailure = e.message; }
    } else if (REAL_VOICE_CAPABILITIES.has(capability)) {
      // Real path: ElevenLabs/OpenAI TTS via voiceCloningAgent.cjs. Writes a
      // real local MP3 — served via the new /creative/audio/:filename
      // static route below so the returned URL is actually fetchable.
      try {
        const agent = _voiceAgent();
        const result = await agent?.synthesize({ text: prompt, voiceProfile: body.voiceProfile, speed: body.speed, pitch: body.pitch });
        if (result?.generated && result.filename) {
          outputUrl    = `/creative/audio/${result.filename}`;
          generated    = true;
          generatedVia = result.via;
        }
        aiOutput = result;
      } catch (e) { aiOutput = { error: e.message }; hardFailure = e.message; }
    } else if (REAL_VIDEO_CAPABILITIES.has(capability)) {
      // Real path: OpenAI Sora via videoGeneratorAgent.cjs's
      // generateRealVideo(). Writes a real local MP4 — served via
      // /creative/video/file/:filename below. Honest failure (generated:
      // false + note/jobId) when no OPENAI_API_KEY is configured or the
      // render hasn't finished within the inline poll window.
      try {
        const agent = _videoAgent();
        const result = await agent?.generateRealVideo({ prompt, seconds: body.seconds, size: body.size });
        if (result?.generated && result.filename) {
          outputUrl    = `/creative/video/file/${result.filename}`;
          generated    = true;
          generatedVia = result.via;
        }
        aiOutput = result;
      } catch (e) { aiOutput = { error: e.message }; hardFailure = e.message; }
    } else if (REAL_IMAGE_PROCESSING_CAPABILITIES.has(capability) && body.imageUrl) {
      // Real path: sharp-backed pixel processing via imageProcessorAgent.cjs.
      // Requires a real source image (body.imageUrl) — image_edit's
      // promptKey defaults to "prompt" (a text description) since it can
      // also be used for AI-driven edits with no source image; only when a
      // real imageUrl is actually supplied do we run genuine pixel
      // transforms. Writes a real local file served via
      // /creative/image/file/:filename below.
      try {
        const processor = _imageProcessor();
        const result = capability === "image_upscale"
          ? await processor?.upscale({ imageUrl: body.imageUrl, scale: body.scale, format: body.format })
          : await processor?.edit({ imageUrl: body.imageUrl, resize: body.resize, format: body.format, rotate: body.rotate, grayscale: body.grayscale, quality: body.quality });
        if (result?.generated && result.filename) {
          outputUrl    = `/creative/image/file/${result.filename}`;
          generated    = true;
          generatedVia = result.via;
        }
        aiOutput = result;
      } catch (e) { aiOutput = { error: e.message, generated: false, note: e.message }; hardFailure = e.message; }
    } else {
      // No real generator exists for this capability (image-to-video,
      // image edit/upscale/background-remove, stt, music). Honest
      // fallback: ask the model for a description, but never claim media
      // was produced — generated:false and a note are always present so
      // callers (and the UI) can tell the difference between a real asset
      // and a preview.
      try {
        const ai = _ai();
        if (ai?.callAI) {
          const aiPrompt = `You are a creative AI assistant. ${capability.replace(/_/g," ")}: "${prompt}".
Respond with a JSON object: { "result": "description of what was generated", "metadata": {} }`;
          const aiResult = await ai.callAI(aiPrompt, { maxTokens: 256 });
          const raw = aiResult?.content || aiResult?.text || null;
          try { aiOutput = JSON.parse(raw); } catch { aiOutput = { result: raw }; }
        }
      } catch {}
      aiOutput = { ...aiOutput, generated: false, note: `No real ${studioType} generator is wired for capability "${capability}" — this is a text description only, not a real asset.` };
    }

    // Store asset regardless — real asset when outputUrl is set, a
    // description-only record otherwise (matches prior behavior for
    // capabilities with no real generator).
    const storedAsset = assets.storeAsset({
      type: studioType, prompt, provider: decision.provider,
      capability, model: decision.model,
      url: outputUrl, accountId: _account(req),
      jobId: job.id, tags: body.tags || [],
      folder: body.folder || studioType,
      metadata: { params: body, aiOutput, generated, generatedVia },
    });

    // Credits were already reserved (deducted) atomically above, before the
    // slow provider call — nothing left to consume here.
    // A genuine exception from a real generator (hardFailure set above) is a
    // real failure — the job must reach status "failed", not "complete",
    // so the queue's own state honestly reflects what happened. The asset
    // record above is still stored either way (matches prior behavior) so
    // the error/context isn't lost, but jobQueue.getSummary()'s
    // queued/running/complete/failed counts are no longer silently wrong.
    const completed = hardFailure
      ? jobQueue.failJob(job.id, hardFailure)
      : jobQueue.completeJob(job.id, { assetId: storedAsset.id, outputUrl, credits: decision.creditsRequired });

    res.json({
      ok: true, job: completed, asset: storedAsset, decision,
      output: aiOutput, creditsUsed: decision.creditsRequired,
      generated, generatedVia, url: outputUrl,
    });
  } catch (e) {
    // If a job was created (and possibly started) before this exception,
    // reap it now — otherwise it would stay "running" forever with no
    // stale-job recovery to ever detect it (see the hoisted `job` comment).
    if (job?.id) { try { jobQueue.failJob(job.id, e.message); } catch { /* best-effort */ } }
    res.status(500).json({ error: e.message });
  }
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

// Serves the real processed image files imageProcessorAgent.cjs writes to
// data/processed-images/ — same pattern as the audio/video serving routes:
// server-generated `upscale_<timestamp>.<ext>` / `edit_<timestamp>.<ext>`
// filename, strict regex, resolved path confirmed to stay inside IMAGE_DIR.
const _imgPath = require("path");
const _imgFs   = require("fs");
const PROCESSED_IMAGE_DIR = _imgPath.join(__dirname, "../../data/processed-images");
const IMAGE_MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
router.get("/creative/image/file/:filename", requireAuth, (req, res) => {
  const filename = req.params.filename;
  const m = filename.match(/^[A-Za-z0-9_.-]+\.(png|jpeg|webp)$/);
  if (!m) return res.status(400).json({ error: "invalid_filename" });
  const abs = _imgPath.join(PROCESSED_IMAGE_DIR, filename);
  if (!abs.startsWith(PROCESSED_IMAGE_DIR + _imgPath.sep)) return res.status(400).json({ error: "invalid_path" });
  if (!_imgFs.existsSync(abs)) return res.status(404).json({ error: "not_found" });
  // Creative Studio OS pass: filename is only a millisecond timestamp
  // (`upscale_<ts>.<ext>`), not cryptographically random, so requireAuth
  // alone let any authenticated account fetch another account's processed
  // image by guessing/enumerating nearby timestamps. Every processed file
  // has a corresponding asset record recording who generated it — deny
  // unless the requester owns that asset.
  if (!_fileOwnedOrDenied(res, assets.getAssetByUrl(`/creative/image/file/${filename}`), _account(req))) return;
  res.setHeader("Content-Type", IMAGE_MIME[m[1]] || "application/octet-stream");
  res.sendFile(abs);
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

// Serves the real MP4 files videoGeneratorAgent.cjs's generateRealVideo()
// writes to data/video/ — same pattern as /creative/audio/:filename below:
// server-generated `video_<timestamp>.mp4` filename, strict regex, and the
// resolved path is confirmed to stay inside VIDEO_DIR before serving.
const _videoPath = require("path");
const _videoFs   = require("fs");
const VIDEO_DIR  = _videoPath.join(__dirname, "../../data/video");
router.get("/creative/video/file/:filename", requireAuth, (req, res) => {
  const filename = req.params.filename;
  if (!/^[A-Za-z0-9_.-]+\.mp4$/.test(filename)) return res.status(400).json({ error: "invalid_filename" });
  const abs = _videoPath.join(VIDEO_DIR, filename);
  if (!abs.startsWith(VIDEO_DIR + _videoPath.sep)) return res.status(400).json({ error: "invalid_path" });
  if (!_videoFs.existsSync(abs)) return res.status(404).json({ error: "not_found" });
  // Creative Studio OS pass: same fix as /creative/image/file/:filename above.
  if (!_fileOwnedOrDenied(res, assets.getAssetByUrl(`/creative/video/file/${filename}`), _account(req))) return;
  res.setHeader("Content-Type", "video/mp4");
  res.sendFile(abs);
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

// Serves the real MP3 files voiceCloningAgent.cjs writes to data/audio/ —
// without this, the "url" returned from /creative/voice/tts pointed at a
// path nothing ever served, so a real generated file existed on disk but
// was unfetchable. Filename is a server-generated `tts_<timestamp>.mp3`
// (see voiceCloningAgent.cjs), never derived from user input beyond the
// route param — still validated against a strict pattern and resolved
// path is confirmed to stay inside AUDIO_DIR before serving, since :filename
// is technically caller-controlled at the HTTP layer.
const _audioPath = require("path");
const _audioFs   = require("fs");
const AUDIO_DIR  = _audioPath.join(__dirname, "../../data/audio");
router.get("/creative/audio/:filename", requireAuth, (req, res) => {
  const filename = req.params.filename;
  if (!/^[A-Za-z0-9_.-]+\.mp3$/.test(filename)) return res.status(400).json({ error: "invalid_filename" });
  const abs = _audioPath.join(AUDIO_DIR, filename);
  if (!abs.startsWith(AUDIO_DIR + _audioPath.sep)) return res.status(400).json({ error: "invalid_path" });
  if (!_audioFs.existsSync(abs)) return res.status(404).json({ error: "not_found" });
  // Creative Studio OS pass: same fix as /creative/image/file/:filename above.
  if (!_fileOwnedOrDenied(res, assets.getAssetByUrl(`/creative/audio/${filename}`), _account(req))) return;
  res.setHeader("Content-Type", "audio/mpeg");
  res.sendFile(abs);
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
    const kit = _ownedOrDenied(res, brandStudio.getKit(req.params.id), _account(req));
    if (!kit) return;
    res.json({ ok: true, kit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/creative/brand/:id", (req, res) => {
  try {
    if (!_ownedOrDenied(res, brandStudio.getKit(req.params.id), _account(req))) return;
    const kit = brandStudio.updateKit(req.params.id, req.body);
    res.json({ ok: true, kit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/creative/brand/:id", (req, res) => {
  try {
    if (!_ownedOrDenied(res, brandStudio.getKit(req.params.id), _account(req))) return;
    const ok = brandStudio.deleteKit(req.params.id);
    res.json({ ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/creative/brand/:id/voice", (req, res) => {
  try {
    if (!_ownedOrDenied(res, brandStudio.getKit(req.params.id), _account(req))) return;
    const kit = brandStudio.updateBrandVoice(req.params.id, req.body);
    res.json({ ok: true, kit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/brand/:id/logo", (req, res) => {
  try {
    const { assetId, variant } = req.body || {};
    if (!assetId) return res.status(400).json({ error: "assetId required" });
    if (!_ownedOrDenied(res, brandStudio.getKit(req.params.id), _account(req))) return;
    const kit = brandStudio.attachLogo(req.params.id, assetId, variant);
    res.json({ ok: true, kit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/brand/:id/template", (req, res) => {
  try {
    if (!_ownedOrDenied(res, brandStudio.getKit(req.params.id), _account(req))) return;
    const kit = brandStudio.addTemplate(req.params.id, req.body);
    res.json({ ok: true, kit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/brand/:id/brief", (req, res) => {
  try {
    if (!_ownedOrDenied(res, brandStudio.getKit(req.params.id), _account(req))) return;
    const brief = brandStudio.buildIdentityBrief(req.params.id);
    res.json({ ok: true, brief });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/brand/:id/generate", async (req, res) => {
  try {
    if (!_ownedOrDenied(res, brandStudio.getKit(req.params.id), _account(req))) return;
    const brief = brandStudio.buildIdentityBrief(req.params.id);
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

    // Call AI with the prompt. A.7 fix: callAI() always resolves to a plain
    // string — every real provider branch in aiService.js's callAI (groq,
    // openai, claude, etc.) returns `res.data.choices[0].message.content`
    // directly, a string, never `{content}`/`{text}`. The old
    // `raw?.content || raw?.text || ""` therefore always fell through to ""
    // regardless of whether the AI call actually succeeded — reproduced
    // live: a real agency account got back {ok:true, result:{caption:"",
    // hashtags:[],...}}, a "successful" response with genuinely nothing
    // generated and no error shown anywhere. Also removed the placeholder
    // fallback branch (fabricated "Compelling {platform} content for..."
    // copy) that fired whenever aiService failed to load — that's exactly
    // the kind of fake-success content this pass forbids; when AI is
    // unavailable, say so honestly instead.
    const ai = _ai();
    if (!ai?.callAI) {
      return res.status(503).json({ error: "AI service is unavailable (aiService module failed to load)." });
    }

    const raw = await ai.callAI(request.prompt, { maxTokens: 1024 });
    if (typeof raw !== "string" || !raw.trim() || raw.startsWith("AI backend unavailable")) {
      return res.status(502).json({ error: raw || "AI generation returned no content. Check provider API keys in your .env file." });
    }

    let result;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { caption: raw, hashtags: [], hook: "", cta: "" };
    } catch { result = { caption: raw, hashtags: [] }; }

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

// Phase 6 connector reachability audit: socialPostingService.cjs (real X
// API v2 posting, org-scoped credential via secretVault's social:twitter
// connector — set up through /my-connectors/twitter) had no route calling
// it anywhere — /creative/social/generate only produces caption text,
// nothing ever published it. This is the missing "actually post" route,
// reusing socialContentEngine's generation history as the source text so
// a generated caption can be published without retyping it, and reusing
// orgMiddleware's attachOrg (non-blocking — falls back to the global
// TWITTER_BEARER_TOKEN env var when no org context is present, same
// single-tenant fallback socialPostingService.cjs already documents).
function _socialPoster() { try { return require("../services/socialPostingService.cjs"); } catch { return null; } }

router.post("/creative/social/publish", attachOrg, async (req, res) => {
  try {
    const poster = _socialPoster();
    if (!poster) return res.status(503).json({ error: "socialPostingService unavailable" });
    const { text, entryId } = req.body || {};
    let body = text;
    if (!body && entryId) {
      const entry = socialEngine.getHistory({ accountId: _account(req) }).find(h => h.id === entryId);
      body = entry?.result?.caption || null;
      if (!body) return res.status(404).json({ error: `No generated caption found for entryId: ${entryId}` });
    }
    if (!body) return res.status(400).json({ error: "text or entryId required" });

    const result = await poster.post(body, req.org?.id || null);
    if (!result.success) return res.status(422).json({ ok: false, error: result.error, status: result.status });
    res.json({ ok: true, postId: result.postId, url: result.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/creative/social/publish/:postId", attachOrg, async (req, res) => {
  try {
    const poster = _socialPoster();
    if (!poster) return res.status(503).json({ error: "socialPostingService unavailable" });
    const result = await poster.deletePost(req.params.postId, req.org?.id || null);
    if (!result.success) return res.status(422).json({ ok: false, error: result.error });
    res.json({ ok: true, deleted: result.deleted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 8: Creative Workspace
// ══════════════════════════════════════════════════════════════════

router.get("/creative/workspace", (req, res) => {
  try {
    const accountId = _account(req);
    const jobSummary = jobQueue.getSummary(accountId);
    // Phase A.11.3 — same fix as GET /creative/assets: these three were global
    // while recentAssets/favoriteAssets below are account-scoped, so the
    // Workspace tab rendered other accounts' totals next to this account's own
    // (empty) asset list. Scope them the same way. jobSummary joined this same
    // fix in the Creative Studio OS pass — see creativeJobQueue.cjs.
    const assetStats = assets.getStats(accountId);
    const recentJobs = jobQueue.listJobs({ accountId, limit: 10 });
    const recentAssets = assets.listAssets({ accountId, limit: 12 });
    const favoriteAssets = assets.listAssets({ accountId, favorite: true, limit: 10 });
    const folders = assets.getFolders(accountId);
    const tags    = assets.getTags(accountId).slice(0, 20);
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
    // Creative Studio OS pass: was unscoped — any authenticated account saw
    // every other account's in-flight job prompts (running/queued lists) and
    // a platform-wide summary. There is no operator role distinction on this
    // route (unlike e.g. support inbox), so scope it the same as every other
    // list in this file rather than leaving it as the one unscoped exception.
    const accountId = _account(req);
    const running = jobQueue.listJobs({ status: "running",  accountId, limit: 20 });
    const queued  = jobQueue.listJobs({ status: "queued",   accountId, limit: 20 });
    res.json({ ok: true, running, queued, summary: jobQueue.getSummary(accountId) });
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
    // Phase A.11.3 — account-scoped, matching listAssets() everywhere else.
    const folders = assets.getFolders(_account(req));
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
    const job = _ownedOrDenied(res, jobQueue.getJob(req.params.id), _account(req));
    if (!job) return;
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
    // Phase A.11.3 — getStats() used to count every account's assets, so this
    // response paired an account-scoped `assets` list with a global `stats`
    // block; the Assets tab renders both together and showed other accounts'
    // totals above its own honest empty state. Scope it the same way the list
    // above is already scoped.
    const stats = assets.getStats(opts.accountId);
    res.json({ ok: true, assets: list, stats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/assets/folders", (req, res) => {
  // Phase A.11.3 — account-scoped, matching listAssets() everywhere else.
  try { res.json({ ok: true, folders: assets.getFolders(_account(req)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/assets/tags", (req, res) => {
  // Phase A.11.3 — account-scoped, matching listAssets() everywhere else.
  try { res.json({ ok: true, tags: assets.getTags(_account(req)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/creative/assets/:id", (req, res) => {
  try {
    const asset = _ownedOrDenied(res, assets.getAsset(req.params.id), _account(req));
    if (!asset) return;
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
    if (!_ownedOrDenied(res, assets.getAsset(req.params.id), _account(req))) return;
    const asset = assets.toggleFavorite(req.params.id);
    res.json({ ok: true, asset });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/assets/:id/tag", (req, res) => {
  try {
    const { tag } = req.body || {};
    if (!tag) return res.status(400).json({ error: "tag required" });
    if (!_ownedOrDenied(res, assets.getAsset(req.params.id), _account(req))) return;
    const asset = assets.addTag(req.params.id, tag);
    res.json({ ok: true, asset });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/creative/assets/:id/move", (req, res) => {
  try {
    const { folder } = req.body || {};
    if (!folder) return res.status(400).json({ error: "folder required" });
    if (!_ownedOrDenied(res, assets.getAsset(req.params.id), _account(req))) return;
    const asset = assets.moveToFolder(req.params.id, folder);
    res.json({ ok: true, asset });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/creative/assets/:id", (req, res) => {
  try {
    if (!_ownedOrDenied(res, assets.getAsset(req.params.id), _account(req))) return;
    const ok = assets.deleteAsset(req.params.id);
    res.json({ ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reuse ref for Browser Automation and Engineering Workspace
router.get("/creative/assets/:id/reuse", (req, res) => {
  try {
    if (!_ownedOrDenied(res, assets.getAsset(req.params.id), _account(req))) return;
    const ref = assets.getReuseRef(req.params.id);
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
