"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "virtualHumanCreator";

// ⚠️ SIMULATION ONLY — all virtual humans are fully synthetic; no real person is modelled

const APPEARANCE_PRESETS = ["realistic","stylised","anime","cartoon","abstract","photorealistic"];
const PERSONALITY_BASES   = ["friendly","professional","creative","analytical","nurturing","adventurous","witty"];
const LANGUAGES           = ["en","es","fr","de","ja","zh","ar","pt","hi","ko"];

function createVirtualHuman({ userId, consent, humanName, appearancePreset = "realistic", personalityBase = "friendly", languages = ["en"], backstory }) {
    const gate = requireConsent(consent, "virtual human creation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (!APPEARANCE_PRESETS.includes(appearancePreset)) return fail(AGENT, `appearancePreset must be: ${APPEARANCE_PRESETS.join(", ")}`);
    if (!PERSONALITY_BASES.includes(personalityBase)) return fail(AGENT, `personalityBase must be: ${PERSONALITY_BASES.join(", ")}`);
    const invalidLangs = languages.filter(l => !LANGUAGES.includes(l));
    if (invalidLangs.length) return fail(AGENT, `unsupported languages: ${invalidLangs.join(",")}. Supported: ${LANGUAGES.join(", ")}`);

    const human = {
        id:              uid("vh"),
        humanName:       humanName || `VH_${uid("vhn")}`,
        appearancePreset,
        personalityBase,
        languages,
        backstory:       backstory ? String(backstory).slice(0, 1000) : null,
        capabilities: {
            speech:      true,
            facialExpressions: true,
            gestureSupport: true,
            emotionalResponse: true,
            multilingual: languages.length > 1
        },
        renderResolution: "1080p_simulated",
        fps:             "60_simulated",
        createdAt:       NOW(),
        ...watermark(AGENT)
    };

    const humans = load(userId, "virtual_humans", []);
    humans.push({ id: human.id, humanName: human.humanName, appearancePreset, personalityBase, createdAt: human.createdAt });
    flush(userId, "virtual_humans", humans.slice(-100));

    humanAILog(AGENT, userId, "virtual_human_created", { humanId: human.id, appearancePreset, personalityBase }, "INFO");
    return ok(AGENT, human, { notice: "SIMULATION ONLY — fully synthetic virtual human, not based on any real person" });
}

function animateVirtualHuman({ userId, consent, humanId, script, emotion = "neutral", durationSec = 10 }) {
    const gate = requireConsent(consent, "virtual human animation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !humanId) return fail(AGENT, "userId and humanId required");
    if (!script) return fail(AGENT, "script required");

    const humans = load(userId, "virtual_humans", []);
    const human = humans.find(h => h.id === humanId);
    if (!human) return fail(AGENT, `humanId ${humanId} not found`);

    const animation = {
        id:            uid("anim"),
        humanId,
        humanName:     human.humanName,
        emotion,
        scriptLength:  String(script).split(/\s+/).length,
        durationSec:   Math.min(durationSec, 300),
        outputFormat:  "mp4_simulated",
        renderStatus:  "completed_simulated",
        simulatedPath: `/simulated_output/${humanId}/animation_${uid("clip")}.mp4`,
        animatedAt:    NOW(),
        ...watermark(AGENT)
    };

    humanAILog(AGENT, userId, "virtual_human_animated", { humanId, emotion, durationSec: animation.durationSec }, "INFO");
    return ok(AGENT, animation);
}

function listVirtualHumans({ userId, consent }) {
    const gate = requireConsent(consent, "virtual human listing");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const humans = load(userId, "virtual_humans", []);
    return ok(AGENT, { total: humans.length, humans, appearancePresets: APPEARANCE_PRESETS, personalityBases: PERSONALITY_BASES, supportedLanguages: LANGUAGES });
}

module.exports = { createVirtualHuman, animateVirtualHuman, listVirtualHumans };
