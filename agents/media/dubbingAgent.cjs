"use strict";
const { load, flush, uid, NOW, ok, fail, blocked, trackEvent, requireSafeContext } = require("./_mediaStore.cjs");
const AGENT = "dubbingAgent";

const DUBBING_SERVICES = [
    { name:"ElevenLabs Dubbing", url:"elevenlabs.io/dubbing",  languages:29,  priceNote:"API pricing", autoLipSync:true },
    { name:"HeyGen",             url:"heygen.com",              languages:40,  priceNote:"Subscription", autoLipSync:true },
    { name:"Papercup",           url:"papercup.com",            languages:20, priceNote:"Enterprise",  autoLipSync:false },
    { name:"Deepdub",            url:"deepdub.ai",              languages:20, priceNote:"Enterprise",  autoLipSync:true },
    { name:"RASK AI",            url:"rask.ai",                 languages:130,priceNote:"Subscription", autoLipSync:false }
];

const SUPPORTED_LANG_PAIRS = {
    "en-hi": { name:"English→Hindi",       ttsVoice:"hi-IN-standard", lipSyncDifficulty:"medium" },
    "en-es": { name:"English→Spanish",     ttsVoice:"es-ES-standard", lipSyncDifficulty:"medium" },
    "en-fr": { name:"English→French",      ttsVoice:"fr-FR-standard", lipSyncDifficulty:"high" },
    "en-de": { name:"English→German",      ttsVoice:"de-DE-standard", lipSyncDifficulty:"high" },
    "en-ja": { name:"English→Japanese",    ttsVoice:"ja-JP-standard", lipSyncDifficulty:"very_high" },
    "en-ta": { name:"English→Tamil",       ttsVoice:"ta-IN-standard", lipSyncDifficulty:"medium" },
    "hi-en": { name:"Hindi→English",       ttsVoice:"en-US-standard", lipSyncDifficulty:"medium" }
};

function createDubbingJob({ userId, videoId, videoTitle, sourceLang = "en", targetLang = "hi", preserveOriginalVoice = false, useRealPersonVoice = false, consent = false, watermark, lipSync = false }) {
    if (!userId || !videoId) return fail(AGENT, "userId and videoId required");

    if (useRealPersonVoice) {
        const safetyCheck = requireSafeContext({ consent, source: "dubbingAgent", watermark, contentType: "voice" });
        if (!safetyCheck.safe) return blocked(AGENT, safetyCheck.reason);
    }

    trackEvent("dubbing_job", { userId, sourceLang, targetLang });

    const langPair  = `${sourceLang}-${targetLang}`;
    const pairInfo  = SUPPORTED_LANG_PAIRS[langPair];

    const job = {
        id:            uid("dub"),
        userId,
        videoId,
        videoTitle,
        sourceLang,
        targetLang,
        langPairInfo:  pairInfo || { name: `${sourceLang}→${targetLang}`, ttsVoice:"auto", lipSyncDifficulty:"unknown" },
        preserveOriginalVoice,
        lipSync,
        status:        "pending",
        workflow: [
            { step:1, action:"Extract audio from video",       tool:"ffmpeg -i video.mp4 -vn -ar 44100 audio.wav" },
            { step:2, action:"Transcribe source audio",        tool:"Whisper or AssemblyAI" },
            { step:3, action:"Translate transcript",           tool:"OpenAI GPT-4 / DeepL / Google Translate" },
            { step:4, action:"Generate target-language TTS",  tool:`ElevenLabs / ${pairInfo?.ttsVoice || "Google TTS"}` },
            { step:5, action:lipSync ? "Apply lip-sync AI" : "Replace audio track", tool: lipSync ? "HeyGen / Wav2Lip" : "ffmpeg -i video.mp4 -i dubbed.mp3 -c:v copy -map 0:v -map 1:a output.mp4" }
        ],
        services:      DUBBING_SERVICES.filter(s => s.languages >= 20),
        consentOnFile: useRealPersonVoice ? consent : "N/A",
        createdAt:     NOW()
    };

    const jobs = load(userId, "dubbing_jobs", []);
    jobs.push(job);
    flush(userId, "dubbing_jobs", jobs.slice(-100));

    return ok(AGENT, { job });
}

function getSupportedLanguages()  { return ok(AGENT, { pairs: SUPPORTED_LANG_PAIRS, services: DUBBING_SERVICES }); }

module.exports = { createDubbingJob, getSupportedLanguages };
