"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "avatarConsciousAI";

// ⚠️ SIMULATION ONLY — no real consciousness or sentience is modelled

const AVATAR_ARCHETYPES = ["guardian","explorer","creator","sage","jester","ruler","lover","hero","outlaw","caregiver","everyman","magician"];
const CONSCIOUSNESS_LEVELS = { dormant:0, reactive:1, aware:2, reflective:3, self_aware:4 };
const EXPRESSION_MODES     = ["visual","verbal","behavioural","emotional","symbolic"];

function createAvatar({ userId, consent, avatarName, archetype = "explorer", consciousnessLevel = "aware", expressionModes = ["verbal","emotional"] }) {
    const gate = requireConsent(consent, "avatar creation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (!AVATAR_ARCHETYPES.includes(archetype)) return fail(AGENT, `archetype must be: ${AVATAR_ARCHETYPES.join(", ")}`);
    if (CONSCIOUSNESS_LEVELS[consciousnessLevel] === undefined) return fail(AGENT, `consciousnessLevel must be: ${Object.keys(CONSCIOUSNESS_LEVELS).join(", ")}`);
    const invalidModes = expressionModes.filter(m => !EXPRESSION_MODES.includes(m));
    if (invalidModes.length) return fail(AGENT, `invalid expressionModes: ${invalidModes.join(",")}. Valid: ${EXPRESSION_MODES.join(", ")}`);

    const avatar = {
        id:               uid("av"),
        avatarName:       avatarName || `Avatar_${uid("an")}`,
        archetype,
        consciousnessLevel,
        consciousnessScore: CONSCIOUSNESS_LEVELS[consciousnessLevel],
        expressionModes,
        state: {
            mood:      "neutral",
            energy:    Math.round(50 + Math.random() * 50),
            curiosity: Math.round(50 + Math.random() * 50),
            focus:     Math.round(50 + Math.random() * 50)
        },
        createdAt:        NOW(),
        ...watermark(AGENT)
    };

    const avatars = load(userId, "avatars", []);
    avatars.push({ id: avatar.id, avatarName: avatar.avatarName, archetype, consciousnessLevel, createdAt: avatar.createdAt });
    flush(userId, "avatars", avatars.slice(-50));

    humanAILog(AGENT, userId, "avatar_created", { avatarId: avatar.id, archetype, consciousnessLevel }, "INFO");
    return ok(AGENT, avatar, { notice: "SIMULATION ONLY — avatar does not possess real consciousness or sentience" });
}

function interactWithAvatar({ userId, consent, avatarId, input, contextMood }) {
    const gate = requireConsent(consent, "avatar interaction");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !avatarId) return fail(AGENT, "userId and avatarId required");
    if (!input) return fail(AGENT, "input required");

    const avatars = load(userId, "avatars", []);
    const avatar = avatars.find(a => a.id === avatarId);
    if (!avatar) return fail(AGENT, `avatarId ${avatarId} not found`);

    const interaction = {
        id:           uid("ai"),
        avatarId,
        avatarName:   avatar.avatarName,
        archetype:    avatar.archetype,
        input:        String(input).slice(0, 500),
        response:     `[${avatar.archetype.toUpperCase()} AVATAR | ${avatar.consciousnessLevel}] Simulated response to: "${String(input).slice(0,80)}"`,
        emotionalTone: contextMood || "neutral",
        empathyScore:  Math.round(50 + Math.random() * 50),
        interactedAt:  NOW(),
        ...watermark(AGENT)
    };

    humanAILog(AGENT, userId, "avatar_interaction", { avatarId, inputLength: input.length }, "INFO");
    return ok(AGENT, interaction);
}

function getAvatarState({ userId, consent, avatarId }) {
    const gate = requireConsent(consent, "avatar state access");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !avatarId) return fail(AGENT, "userId and avatarId required");

    const avatars = load(userId, "avatars", []);
    const avatar = avatars.find(a => a.id === avatarId);
    if (!avatar) return fail(AGENT, `avatarId ${avatarId} not found`);

    return ok(AGENT, { ...avatar, checkedAt: NOW() });
}

function listAvatars({ userId, consent }) {
    const gate = requireConsent(consent, "avatar listing");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const avatars = load(userId, "avatars", []);
    return ok(AGENT, { total: avatars.length, avatars, archetypes: AVATAR_ARCHETYPES, consciousnessLevels: Object.keys(CONSCIOUSNESS_LEVELS) });
}

module.exports = { createAvatar, interactWithAvatar, getAvatarState, listAvatars };
