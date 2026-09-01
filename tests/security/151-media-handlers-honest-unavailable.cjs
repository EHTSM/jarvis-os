#!/usr/bin/env node
"use strict";
/**
 * agents/executor.cjs — Video/Audio Ecosystem mission.
 *
 * Discovery found agents/executor.cjs's mediaAudioClean/mediaSubtitle/
 * mediaDubbing task handlers (`require("./media/{audioCleaner,
 * subtitleGenerator,dubbingAgent}.cjs")`) pointed at files that had been
 * moved to `_archive/20260520_010917/agents/media/` and never restored or
 * removed — `agents/media/` does not exist at all in the live tree. This is
 * a real, live, user-reachable defect, not dead code: a natural-language
 * request classified by the runtime dispatcher into "clean this audio" /
 * "add subtitles" / "dub this video" reaches these exact handlers via
 * agents/automation/toolSelector.cjs's task-type map (media_audio_clean →
 * mediaAudioClean, media_subtitle → mediaSubtitle, media_dubbing →
 * mediaDubbing) and, pre-fix, threw an uncaught MODULE_NOT_FOUND that
 * propagated as a raw internal error string via errorHandler.handle()
 * rather than an honest "not implemented" response.
 *
 * The archived originals were read in full before deciding the fix: none
 * of the three ever executed real audio-cleaning/STT/dubbing — each only
 * returned a static "here's the ffmpeg/Whisper command a human could run"
 * recommendation with a job status of "pending" that was never advanced,
 * since no real ffmpeg or STT backend exists anywhere in this repository
 * (confirmed separately: zero ffmpeg child-process invocation, zero
 * Deepgram/AssemblyAI footprint, zero real Whisper execution path).
 * Restoring the archived files would have traded one dishonest failure
 * (a crash) for a subtler one (a job that looks queued but can never
 * complete) — not a genuine fix. Instead, all three handlers now use the
 * same `_capabilityUnavailable()` pattern already established elsewhere in
 * this exact file (maps/gps/wallet, etc.) for precisely this situation.
 *
 * No external provider is mocked because none is called — this test proves
 * the honest-failure contract end-to-end through the real dispatch chain
 * (executorAgent → automationEngine → toolSelector → toolExecutor →
 * handler), not just the handler function in isolation.
 *
 * Usage: node tests/security/151-media-handlers-honest-unavailable.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  const fs = require("fs");
  const path = require("path");

  section("Precondition — agents/media/ genuinely does not exist (confirms this is a live gap, not a stale assumption)");
  {
    const mediaDir = path.join(__dirname, "../../agents/media");
    assert(!fs.existsSync(mediaDir), "agents/media/ directory does not exist in the live tree", mediaDir);
  }

  const { executorAgent } = require("../../agents/executor.cjs");

  section("mediaAudioClean — real dispatch path returns an honest, non-retriable failure, not a crash");
  {
    const result = await executorAgent({ type: "media_audio_clean", payload: { userId: "u1", fileId: "f1", fileName: "test.wav", noiseType: "hiss" } });
    assert(result && result.success === false, "executorAgent() resolves (does not throw/crash) for media_audio_clean", JSON.stringify(result));
    assert(/not implemented/i.test(result.error || ""), "the error honestly states the capability is not implemented", result.error);
    assert(!/Cannot find module|MODULE_NOT_FOUND/i.test(result.error || ""), "no raw Node internal error (MODULE_NOT_FOUND) leaks to the caller", result.error);
    assert(result.nonRetriable === true, "the failure is marked non-retriable so callers don't waste retries on a permanently-unavailable capability");
  }

  section("mediaSubtitle — real dispatch path returns an honest, non-retriable failure, not a crash");
  {
    const result = await executorAgent({ type: "media_subtitle", payload: { userId: "u1", videoId: "v1", videoTitle: "Test Video", language: "english", format: "srt" } });
    assert(result && result.success === false, "executorAgent() resolves for media_subtitle", JSON.stringify(result));
    assert(/not implemented/i.test(result.error || ""), "honest not-implemented message", result.error);
    assert(!/Cannot find module|MODULE_NOT_FOUND/i.test(result.error || ""), "no raw MODULE_NOT_FOUND leak", result.error);
    assert(result.nonRetriable === true, "marked non-retriable");
  }

  section("mediaDubbing — real dispatch path returns an honest, non-retriable failure, not a crash");
  {
    const result = await executorAgent({ type: "media_dubbing", payload: { userId: "u1", videoId: "v1", videoTitle: "Test Video", sourceLang: "en", targetLang: "hi", consent: true } });
    assert(result && result.success === false, "executorAgent() resolves for media_dubbing", JSON.stringify(result));
    assert(/not implemented/i.test(result.error || ""), "honest not-implemented message", result.error);
    assert(!/Cannot find module|MODULE_NOT_FOUND/i.test(result.error || ""), "no raw MODULE_NOT_FOUND leak", result.error);
    assert(result.nonRetriable === true, "marked non-retriable");
  }

  section("Sub-task-type variants (formats/langs listing) also fail honestly, not just the primary job-creation type");
  {
    const formats = await executorAgent({ type: "media_subtitle_formats", payload: {} });
    assert(formats.success === false && /not implemented/i.test(formats.error || ""), "media_subtitle_formats fails honestly too", JSON.stringify(formats));

    const dubLangs = await executorAgent({ type: "media_dub_langs", payload: {} });
    assert(dubLangs.success === false && /not implemented/i.test(dubLangs.error || ""), "media_dub_langs fails honestly too", JSON.stringify(dubLangs));

    const noiseTypes = await executorAgent({ type: "media_noise_types", payload: {} });
    assert(noiseTypes.success === false && /not implemented/i.test(noiseTypes.error || ""), "media_noise_types fails honestly too", JSON.stringify(noiseTypes));
  }

  section("Regression — an unrelated, genuinely-implemented capability elsewhere in this same file is unaffected");
  {
    // map_location was already stubbed via _capabilityUnavailable before
    // this pass — proves the shared helper itself and its other call sites
    // are untouched (toolSelector maps "map_location" -> "mapLocation").
    const result = await executorAgent({ type: "map_location", payload: {} });
    assert(result.success === false && /not implemented/i.test(result.error || ""), "the pre-existing mapLocation stub still behaves identically (untouched by this pass)", JSON.stringify(result));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
