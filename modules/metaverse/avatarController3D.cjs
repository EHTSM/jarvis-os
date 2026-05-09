"use strict";
const { loadWorld, flushWorld, loadUser, flushUser, metaLog, uid, NOW, ok, fail, blocked } = require("./_metaverseStore.cjs");

const AGENT = "avatarController3D";

const AVATAR_MODELS  = ["humanoid","robot","creature","ghost","orb","custom"];
const ANIMATION_SETS = ["idle","walk","run","jump","wave","sit","dance","fly","combat"];
const ACCESSORY_SLOTS= ["head","body","feet","hand_left","hand_right","back","face"];

function createAvatar({ userId, worldId, displayName, model = "humanoid", color = "#3498db", accessories = {} }) {
    if (!userId || !worldId)  return fail(AGENT, "userId and worldId required");
    if (!displayName)          return fail(AGENT, "displayName required");
    if (!AVATAR_MODELS.includes(model)) return fail(AGENT, `model must be: ${AVATAR_MODELS.join(", ")}`);

    const world = loadWorld(worldId);
    if (!world) return fail(AGENT, `worldId ${worldId} not found`);
    if (world.status === "deleted") return fail(AGENT, "world has been deleted");
    if (world.users.length >= world.maxUsers) return blocked(AGENT, `world is full (${world.maxUsers} max users)`);

    // check if user already has avatar in this world
    if (world.users.find(u => u.userId === userId)) return fail(AGENT, "user already has an avatar in this world — use updateAvatar");

    const avatar = {
        avatarId:     uid("av"),
        userId,
        worldId,
        displayName,
        model,
        color,
        accessories:  Object.fromEntries(ACCESSORY_SLOTS.map(s => [s, accessories[s] || null])),
        transform: {
            position: world.settings?.spawnPoint || { x:0, y:0, z:0 },
            rotation: { x:0, y:0, z:0 },
            scale:    { x:1, y:1, z:1 }
        },
        animation:    "idle",
        health:       100,
        energy:       100,
        visible:      true,
        joinedAt:     NOW()
    };

    world.users.push({ userId, avatarId: avatar.avatarId, displayName, model, joinedAt: avatar.joinedAt, lastSeen: avatar.joinedAt });
    world.interactions.push({ type:"join", userId, avatarId: avatar.avatarId, timestamp: avatar.joinedAt });
    world.updatedAt = NOW();
    flushWorld(worldId, world);
    flushUser(userId, `avatar_${worldId}`, avatar);

    metaLog(AGENT, userId, "avatar_created", { worldId, avatarId: avatar.avatarId, model }, "INFO");
    return ok(AGENT, avatar);
}

function getAvatar({ userId, worldId }) {
    if (!userId || !worldId) return fail(AGENT, "userId and worldId required");
    const avatar = loadUser(userId, `avatar_${worldId}`);
    if (!avatar) return fail(AGENT, "no avatar found for this user in this world");
    return ok(AGENT, avatar);
}

function updateTransform({ userId, worldId, position, rotation, scale }) {
    if (!userId || !worldId) return fail(AGENT, "userId and worldId required");
    const avatar = loadUser(userId, `avatar_${worldId}`);
    if (!avatar) return fail(AGENT, "avatar not found");

    if (position) avatar.transform.position = position;
    if (rotation) avatar.transform.rotation = rotation;
    if (scale)    avatar.transform.scale    = scale;
    avatar.lastUpdated = NOW();
    flushUser(userId, `avatar_${worldId}`, avatar);

    // update lastSeen in world
    const world = loadWorld(worldId);
    if (world) {
        const user = world.users.find(u => u.userId === userId);
        if (user) { user.lastSeen = NOW(); flushWorld(worldId, world); }
    }

    metaLog(AGENT, userId, "avatar_moved", { worldId, position }, "INFO");
    return ok(AGENT, { avatarId: avatar.avatarId, transform: avatar.transform });
}

function setAnimation({ userId, worldId, animation }) {
    if (!userId || !worldId)   return fail(AGENT, "userId and worldId required");
    if (!ANIMATION_SETS.includes(animation)) return fail(AGENT, `animation must be: ${ANIMATION_SETS.join(", ")}`);
    const avatar = loadUser(userId, `avatar_${worldId}`);
    if (!avatar) return fail(AGENT, "avatar not found");

    avatar.animation  = animation;
    avatar.lastUpdated = NOW();
    flushUser(userId, `avatar_${worldId}`, avatar);

    return ok(AGENT, { avatarId: avatar.avatarId, animation });
}

function equipAccessory({ userId, worldId, slot, itemId }) {
    if (!userId || !worldId) return fail(AGENT, "userId and worldId required");
    if (!ACCESSORY_SLOTS.includes(slot)) return fail(AGENT, `slot must be: ${ACCESSORY_SLOTS.join(", ")}`);
    const avatar = loadUser(userId, `avatar_${worldId}`);
    if (!avatar) return fail(AGENT, "avatar not found");

    avatar.accessories[slot] = itemId || null;
    avatar.lastUpdated = NOW();
    flushUser(userId, `avatar_${worldId}`, avatar);

    metaLog(AGENT, userId, "accessory_equipped", { worldId, slot, itemId }, "INFO");
    return ok(AGENT, { avatarId: avatar.avatarId, accessories: avatar.accessories });
}

function leaveWorld({ userId, worldId }) {
    if (!userId || !worldId) return fail(AGENT, "userId and worldId required");
    const world = loadWorld(worldId);
    if (!world) return fail(AGENT, `worldId ${worldId} not found`);

    world.users = world.users.filter(u => u.userId !== userId);
    world.interactions.push({ type:"leave", userId, timestamp: NOW() });
    world.updatedAt = NOW();
    flushWorld(worldId, world);

    metaLog(AGENT, userId, "avatar_left", { worldId }, "INFO");
    return ok(AGENT, { left: worldId, userId });
}

module.exports = { createAvatar, getAvatar, updateTransform, setAnimation, equipAccessory, leaveWorld };
