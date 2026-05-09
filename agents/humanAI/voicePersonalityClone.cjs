"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "voicePersonalityClone";

// ⚠️ SIMULATION ONLY — no real voice synthesis, cloning or biometric processing occurs

const VOICE_ARCHETYPES = {
    warm_alto:     { pitch:"low-mid", tone:"warm",      pace:"moderate", resonance:"chest" },
    crisp_tenor:   { pitch:"mid-high",tone:"crisp",     pace:"brisk",    resonance:"nasal" },
    deep_bass:     { pitch:"low",     tone:"authoritative",pace:"slow",  resonance:"deep chest" },
    bright_soprano:{ pitch:"high",    tone:"bright",    pace:"lively",   resonance:"head" },
    neutral_mid:   { pitch:"mid",     tone:"neutral",   pace:"moderate", resonance:"balanced" }
};

const SPEECH_STYLES = ["formal","casual","storytelling","instructional","empathetic","enthusiastic","calm"];

function createVoiceProfile({ userId, consent, profileName, archetype = "neutral_mid", speechStyle = "casual", customTraits = {} }) {
    const gate = requireConsent(consent, "voice profile creation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (!VOICE_ARCHETYPES[archetype]) return fail(AGENT, `archetype must be: ${Object.keys(VOICE_ARCHETYPES).join(", ")}`);
    if (!SPEECH_STYLES.includes(speechStyle)) return fail(AGENT, `speechStyle must be: ${SPEECH_STYLES.join(", ")}`);

    const arch = VOICE_ARCHETYPES[archetype];
    const profile = {
        id:           uid("vp"),
        profileName:  profileName || `VoiceProfile_${uid("vn")}`,
        archetype,
        speechStyle,
        voiceParams:  { ...arch, ...customTraits },
        simulatedSampleRate: "24kHz",
        bitDepth:     "16-bit",
        createdAt:    NOW(),
        ...watermark(AGENT)
    };

    const profiles = load(userId, "voice_profiles", []);
    profiles.push({ id: profile.id, profileName: profile.profileName, archetype, speechStyle, createdAt: profile.createdAt });
    flush(userId, "voice_profiles", profiles.slice(-100));

    humanAILog(AGENT, userId, "voice_profile_created", { profileId: profile.id, archetype, speechStyle }, "INFO");
    return ok(AGENT, profile, { notice: "SIMULATION ONLY — no real audio is generated or stored" });
}

function synthesiseSpeech({ userId, consent, profileId, text, emotionalOverlay }) {
    const gate = requireConsent(consent, "voice synthesis simulation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !profileId) return fail(AGENT, "userId and profileId required");
    if (!text) return fail(AGENT, "text required");

    const profiles = load(userId, "voice_profiles", []);
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return fail(AGENT, `profileId ${profileId} not found`);

    const wordCount = String(text).trim().split(/\s+/).length;
    const durationSeconds = parseFloat((wordCount / 2.5).toFixed(1));

    const synthesis = {
        id:               uid("ss"),
        profileId,
        archetype:        profile.archetype,
        speechStyle:      profile.speechStyle,
        emotionalOverlay: emotionalOverlay || "none",
        text:             String(text).slice(0, 500),
        wordCount,
        estimatedDurationSec: durationSeconds,
        simulatedOutput:  `[SIMULATED AUDIO — ${wordCount} words, ${durationSeconds}s @ ${profile.archetype}/${profile.speechStyle}]`,
        quality:          Math.round(75 + Math.random() * 24),
        synthesisedAt:    NOW(),
        ...watermark(AGENT)
    };

    humanAILog(AGENT, userId, "speech_synthesised", { profileId, wordCount }, "INFO");
    return ok(AGENT, synthesis);
}

function listVoiceProfiles({ userId, consent }) {
    const gate = requireConsent(consent, "voice profile listing");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const profiles = load(userId, "voice_profiles", []);
    return ok(AGENT, { total: profiles.length, profiles, archetypes: Object.keys(VOICE_ARCHETYPES), speechStyles: SPEECH_STYLES });
}

module.exports = { createVoiceProfile, synthesiseSpeech, listVoiceProfiles };
