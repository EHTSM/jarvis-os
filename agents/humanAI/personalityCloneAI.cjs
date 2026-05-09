"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "personalityCloneAI";

// ⚠️ SIMULATION ONLY — does NOT clone, replicate or impersonate any real person

const BIG_FIVE = ["openness","conscientiousness","extraversion","agreeableness","neuroticism"];
const MBTI_TYPES = ["INTJ","INTP","ENTJ","ENTP","INFJ","INFP","ENFJ","ENFP","ISTJ","ISFJ","ESTJ","ESFJ","ISTP","ISFP","ESTP","ESFP"];
const INTERACTION_STYLES = ["analytical","empathetic","direct","nurturing","creative","pragmatic"];

function _randScore() { return parseFloat((Math.random() * 100).toFixed(1)); }

function buildPersonalityProfile({ userId, consent, traitInputs = {}, profileName }) {
    const gate = requireConsent(consent, "personality profile creation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const bigFiveScores = {};
    BIG_FIVE.forEach(t => { bigFiveScores[t] = traitInputs[t] !== undefined ? Math.min(100, Math.max(0, Number(traitInputs[t]))) : _randScore(); });

    const mbti = MBTI_TYPES[Math.floor(Math.random() * MBTI_TYPES.length)];
    const style = INTERACTION_STYLES[Math.floor(Math.random() * INTERACTION_STYLES.length)];

    const profile = {
        id:              uid("pc"),
        profileName:     profileName || `SimProfile_${uid("sp")}`,
        bigFive:         bigFiveScores,
        mbtiType:        mbti,
        interactionStyle: style,
        traitSummary:    `Simulated personality: ${style}, MBTI ${mbti}`,
        generatedAt:     NOW(),
        ...watermark(AGENT)
    };

    const profiles = load(userId, "personality_profiles", []);
    profiles.push({ id: profile.id, profileName: profile.profileName, mbti, style, createdAt: profile.generatedAt });
    flush(userId, "personality_profiles", profiles.slice(-100));

    humanAILog(AGENT, userId, "personality_profile_built", { profileId: profile.id, mbti, style }, "INFO");
    return ok(AGENT, profile, { notice: "SIMULATION ONLY — no real person is modelled or impersonated" });
}

function simulateResponse({ userId, consent, profileId, prompt }) {
    const gate = requireConsent(consent, "personality simulation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !profileId) return fail(AGENT, "userId and profileId required");
    if (!prompt) return fail(AGENT, "prompt required");

    const profiles = load(userId, "personality_profiles", []);
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return fail(AGENT, `profileId ${profileId} not found`);

    const response = {
        id:          uid("pr"),
        profileId,
        style:       profile.style,
        mbti:        profile.mbti,
        simulatedReply: `[${profile.style.toUpperCase()} / ${profile.mbti}] Simulated response to: "${String(prompt).slice(0,100)}"`,
        confidence:  Math.round(60 + Math.random() * 35),
        generatedAt: NOW(),
        ...watermark(AGENT)
    };

    humanAILog(AGENT, userId, "personality_response_simulated", { profileId, promptLength: prompt.length }, "INFO");
    return ok(AGENT, response);
}

function listProfiles({ userId, consent }) {
    const gate = requireConsent(consent, "personality profile listing");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const profiles = load(userId, "personality_profiles", []);
    return ok(AGENT, { total: profiles.length, profiles });
}

function deleteProfile({ userId, consent, profileId }) {
    const gate = requireConsent(consent, "personality profile deletion");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !profileId) return fail(AGENT, "userId and profileId required");

    let profiles = load(userId, "personality_profiles", []);
    const before = profiles.length;
    profiles = profiles.filter(p => p.id !== profileId);
    if (profiles.length === before) return fail(AGENT, `profileId ${profileId} not found`);
    flush(userId, "personality_profiles", profiles);

    humanAILog(AGENT, userId, "personality_profile_deleted", { profileId }, "WARN");
    return ok(AGENT, { deleted: profileId });
}

module.exports = { buildPersonalityProfile, simulateResponse, listProfiles, deleteProfile };
