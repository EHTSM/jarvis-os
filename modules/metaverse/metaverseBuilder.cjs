"use strict";
const { loadWorld, flushWorld, loadGlobal, flushGlobal, newWorld, metaLog, uid, NOW, ok, fail, blocked } = require("./_metaverseStore.cjs");

const AGENT = "metaverseBuilder";

const WORLD_TYPES = ["social","office","classroom","gaming","marketplace","gallery","conference","event","sandbox"];
const THEMES      = ["futuristic","nature","urban","fantasy","abstract","corporate","underwater","space","retro"];
const PHYSICS_MODES = ["standard","low_gravity","zero_gravity","water","custom"];

function createWorld({ userId, worldName, worldType = "social", theme = "futuristic", maxUsers = 100, physics = "standard", settings = {} }) {
    if (!userId)    return fail(AGENT, "userId required");
    if (!worldName) return fail(AGENT, "worldName required");
    if (!WORLD_TYPES.includes(worldType)) return fail(AGENT, `worldType must be: ${WORLD_TYPES.join(", ")}`);
    if (!THEMES.includes(theme))          return fail(AGENT, `theme must be: ${THEMES.join(", ")}`);
    if (!PHYSICS_MODES.includes(physics)) return fail(AGENT, `physics must be: ${PHYSICS_MODES.join(", ")}`);
    if (maxUsers < 1 || maxUsers > 10000) return fail(AGENT, "maxUsers must be 1–10000");

    const world = newWorld({ name: worldName, worldType, theme, ownerId: userId, maxUsers, physics });
    world.settings = {
        spawnPoint:   settings.spawnPoint   || { x:0, y:0, z:0 },
        skybox:       settings.skybox       || `${theme}_default`,
        ambientLight: settings.ambientLight || 0.6,
        fogDensity:   settings.fogDensity   || 0.02,
        gravity:      physics === "zero_gravity" ? 0 : physics === "low_gravity" ? -2 : -9.8,
        ...settings
    };
    world.sceneConfig = {
        renderer:  "client_threejs",
        xr:        true,
        assets:    [],
        lights:    [{ type:"ambient", intensity:world.settings.ambientLight }, { type:"directional", intensity:0.8, position:{ x:10, y:20, z:10 } }],
        fog:       { enabled: world.settings.fogDensity > 0, density: world.settings.fogDensity }
    };

    flushWorld(world.worldId, world);

    // global world registry
    const registry = loadGlobal("world_registry", []);
    registry.push({ worldId: world.worldId, name: world.name, worldType, theme, ownerId: userId, status: "active", createdAt: world.createdAt });
    flushGlobal("world_registry", registry);

    metaLog(AGENT, userId, "world_created", { worldId: world.worldId, worldType, theme }, "INFO");
    return ok(AGENT, world, { note: "sceneConfig is client-side rendering data — render with Three.js/WebXR" });
}

function getWorld({ worldId }) {
    if (!worldId) return fail(AGENT, "worldId required");
    const world = loadWorld(worldId);
    if (!world) return fail(AGENT, `worldId ${worldId} not found`);
    return ok(AGENT, world);
}

function updateWorld({ userId, worldId, updates = {} }) {
    if (!userId || !worldId) return fail(AGENT, "userId and worldId required");
    const world = loadWorld(worldId);
    if (!world) return fail(AGENT, `worldId ${worldId} not found`);
    if (world.ownerId !== userId) return blocked(AGENT, "only the world owner can update this world");

    const allowedKeys = ["name","theme","maxUsers","physics","settings","status"];
    allowedKeys.forEach(k => { if (updates[k] !== undefined) world[k] = updates[k]; });
    world.updatedAt = NOW();
    flushWorld(worldId, world);

    metaLog(AGENT, userId, "world_updated", { worldId, keys: Object.keys(updates) }, "INFO");
    return ok(AGENT, world);
}

function deleteWorld({ userId, worldId, confirm }) {
    if (!userId || !worldId) return fail(AGENT, "userId and worldId required");
    if (!confirm) return fail(AGENT, "confirm:true required to delete a world");
    const world = loadWorld(worldId);
    if (!world) return fail(AGENT, `worldId ${worldId} not found`);
    if (world.ownerId !== userId) return blocked(AGENT, "only the world owner can delete this world");

    world.status = "deleted";
    world.deletedAt = NOW();
    flushWorld(worldId, world);

    const registry = loadGlobal("world_registry", []);
    const idx = registry.findIndex(r => r.worldId === worldId);
    if (idx !== -1) { registry[idx].status = "deleted"; flushGlobal("world_registry", registry); }

    metaLog(AGENT, userId, "world_deleted", { worldId }, "WARN");
    return ok(AGENT, { deleted: worldId });
}

function listWorlds({ userId, worldType, theme, status = "active" }) {
    let worlds = loadGlobal("world_registry", []);
    if (userId)    worlds = worlds.filter(w => w.ownerId === userId);
    if (worldType) worlds = worlds.filter(w => w.worldType === worldType);
    if (theme)     worlds = worlds.filter(w => w.theme === theme);
    if (status)    worlds = worlds.filter(w => w.status === status);
    return ok(AGENT, { total: worlds.length, worlds, worldTypes: WORLD_TYPES, themes: THEMES });
}

module.exports = { createWorld, getWorld, updateWorld, deleteWorld, listWorlds };
