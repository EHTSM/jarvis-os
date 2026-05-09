"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "metaverseAgent";

// ⚠️ SIMULATION ONLY — no real metaverse platform, blockchain, or digital asset is accessed

const WORLD_TYPES      = ["social_hub","workspace","gaming","education","commerce","creative_studio","event_space"];
const AVATAR_STYLES    = ["realistic","voxel","anime","abstract","robot","fantasy"];
const INTERACTION_TYPES= ["voice","gesture","haptic","text","gaze","emote"];

function createMetaverseSpace({ userId, consent, spaceName, worldType = "social_hub", maxOccupants = 50, features = [] }) {
    const gate = requireConsent(consent, "metaverse space creation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (!WORLD_TYPES.includes(worldType)) return fail(AGENT, `worldType must be: ${WORLD_TYPES.join(", ")}`);
    if (maxOccupants < 1 || maxOccupants > 10000) return fail(AGENT, "maxOccupants must be 1-10000");

    const space = {
        id:           uid("ms"),
        spaceName:    spaceName || `MetaSpace_${uid("mn")}`,
        worldType,
        maxOccupants,
        features:     features.slice(0, 20),
        simulatedURL: `metaverse://jarvis-sim/${uid("url")}`,
        renderEngine: "simulated_WebGL",
        physics:      "simulated_bullet",
        status:       "active",
        createdAt:    NOW(),
        ...watermark(AGENT)
    };

    const spaces = load(userId, "metaverse_spaces", []);
    spaces.push({ id: space.id, spaceName: space.spaceName, worldType, maxOccupants, createdAt: space.createdAt });
    flush(userId, "metaverse_spaces", spaces.slice(-200));

    humanAILog(AGENT, userId, "metaverse_space_created", { spaceId: space.id, worldType }, "INFO");
    return ok(AGENT, space, { notice: "SIMULATION ONLY — no real metaverse platform is used" });
}

function spawnAvatar({ userId, consent, spaceId, avatarStyle = "realistic", displayName, interactionTypes = ["voice","text"] }) {
    const gate = requireConsent(consent, "avatar spawn");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !spaceId) return fail(AGENT, "userId and spaceId required");
    if (!AVATAR_STYLES.includes(avatarStyle)) return fail(AGENT, `avatarStyle must be: ${AVATAR_STYLES.join(", ")}`);
    const invalidTypes = interactionTypes.filter(t => !INTERACTION_TYPES.includes(t));
    if (invalidTypes.length) return fail(AGENT, `invalid interactionTypes: ${invalidTypes.join(",")}. Valid: ${INTERACTION_TYPES.join(", ")}`);

    const avatar = {
        id:               uid("spa"),
        spaceId,
        avatarStyle,
        displayName:      displayName || `User_${uid("dn")}`,
        interactionTypes,
        position:         { x: parseFloat((Math.random()*100).toFixed(2)), y:0, z: parseFloat((Math.random()*100).toFixed(2)) },
        spawnedAt:        NOW(),
        ...watermark(AGENT)
    };

    humanAILog(AGENT, userId, "avatar_spawned", { spaceId, avatarStyle }, "INFO");
    return ok(AGENT, avatar);
}

function getSpaceAnalytics({ userId, consent, spaceId }) {
    const gate = requireConsent(consent, "space analytics");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !spaceId) return fail(AGENT, "userId and spaceId required");

    const spaces = load(userId, "metaverse_spaces", []);
    if (!spaces.find(s => s.id === spaceId)) return fail(AGENT, `spaceId ${spaceId} not found`);

    return ok(AGENT, {
        spaceId,
        simulatedOccupants:  Math.round(Math.random() * 30),
        peakOccupants:       Math.round(30 + Math.random() * 50),
        sessionDurationAvgMin: Math.round(10 + Math.random() * 50),
        interactionsToday:   Math.round(Math.random() * 500),
        collectedAt:         NOW()
    });
}

function listSpaces({ userId, consent }) {
    const gate = requireConsent(consent, "metaverse space listing");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const spaces = load(userId, "metaverse_spaces", []);
    return ok(AGENT, { total: spaces.length, spaces, worldTypes: WORLD_TYPES, avatarStyles: AVATAR_STYLES, interactionTypes: INTERACTION_TYPES });
}

module.exports = { createMetaverseSpace, spawnAvatar, getSpaceAnalytics, listSpaces };
