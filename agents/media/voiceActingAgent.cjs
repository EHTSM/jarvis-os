"use strict";
const { load, flush, uid, NOW, ok, fail, blocked, trackEvent, requireSafeContext } = require("./_mediaStore.cjs");
const AGENT = "voiceActingAgent";

const ACTING_STYLES = {
    narrator:      { description:"Calm, authoritative storytelling voice",   pacing:"slow",   pitch:"medium-low" },
    commercial:    { description:"Energetic, persuasive ad delivery",         pacing:"medium", pitch:"medium-high" },
    character:     { description:"Exaggerated character portrayal",           pacing:"varied", pitch:"varied" },
    documentary:   { description:"Neutral, informative delivery",             pacing:"slow",   pitch:"medium" },
    audiobook:     { description:"Warm, engaging long-form narration",        pacing:"slow",   pitch:"medium" },
    animation:     { description:"Expressive, high-energy character voice",   pacing:"fast",   pitch:"high" },
    news_anchor:   { description:"Formal, clear journalistic delivery",       pacing:"medium", pitch:"medium" },
    meditation:    { description:"Soft, calming breathwork pacing",           pacing:"very_slow",pitch:"low" },
    horror:        { description:"Tense, creepy atmospheric narration",       pacing:"slow",   pitch:"low" },
    children:      { description:"Bright, simple, encouraging tone",          pacing:"slow",   pitch:"high" }
};

const EMOTION_MODIFIERS = ["neutral","happy","sad","angry","fearful","excited","mysterious","sarcastic","warm","urgent"];

function generateVoiceover({ userId, scriptText, style = "narrator", emotion = "neutral", language = "en", speakerName, consent = false, watermark, isRealPersonVoice = false }) {
    if (!userId || !scriptText) return fail(AGENT, "userId and scriptText required");

    if (isRealPersonVoice) {
        const safetyCheck = requireSafeContext({ consent, source: "voiceActingAgent", watermark, contentType: "voice" });
        if (!safetyCheck.safe) return blocked(AGENT, safetyCheck.reason);
    }

    trackEvent("voiceover_generate", { userId, style, language });

    const styleKey  = style.toLowerCase();
    const styleDef  = ACTING_STYLES[styleKey] || ACTING_STYLES.narrator;
    const wordCount = scriptText.trim().split(/\s+/).length;
    const estSeconds= Math.round(wordCount / (styleDef.pacing === "slow" ? 2.0 : styleDef.pacing === "fast" ? 3.5 : 2.8));

    const voiceover = {
        id:           uid("vo"),
        userId,
        scriptText,
        scriptWords:  wordCount,
        style:        styleKey,
        styleInfo:    styleDef,
        emotion,
        language,
        speakerName:  speakerName || "Default TTS Voice",
        estimatedDurationSec: estSeconds,
        ttsEngines:   ["ElevenLabs","Play.ht","Amazon Polly","Google TTS","Murf.ai","Resemble.ai"],
        ssmlHints: {
            pause:    `<break time="500ms"/> for pauses`,
            emphasis: `<emphasis level="strong">word</emphasis>`,
            rate:     `<prosody rate="${styleDef.pacing === "slow" ? "slow" : "medium"}">text</prosody>`
        },
        exportFormats:["MP3","WAV","OGG","FLAC"],
        consentOnFile:isRealPersonVoice ? consent : "N/A",
        watermark:    isRealPersonVoice ? watermark : null,
        createdAt:    NOW()
    };

    const vos = load(userId, "voiceovers", []);
    vos.push(voiceover);
    flush(userId, "voiceovers", vos.slice(-200));

    return ok(AGENT, { voiceover });
}

function getActingStyles() {
    return ok(AGENT, { styles: ACTING_STYLES, emotions: EMOTION_MODIFIERS });
}

function getUserVoiceovers({ userId, limit = 20 }) {
    if (!userId) return fail(AGENT, "userId required");
    return ok(AGENT, load(userId, "voiceovers", []).slice(-limit).reverse());
}

module.exports = { generateVoiceover, getActingStyles, getUserVoiceovers };
