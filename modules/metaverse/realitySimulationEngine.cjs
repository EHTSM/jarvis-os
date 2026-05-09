"use strict";
const { loadWorld, flushWorld, loadGlobal, metaLog, uid, NOW, ok, fail } = require("./_metaverseStore.cjs");

const AGENT = "realitySimulationEngine";

// Backend defines rules — Three.js/Cannon.js/Rapier execute them client-side

const PHYSICS_PRESETS = {
    standard:     { gravity:-9.8,  friction:0.3,  restitution:0.2,  airResistance:0.01 },
    low_gravity:  { gravity:-2.0,  friction:0.2,  restitution:0.4,  airResistance:0.005 },
    zero_gravity: { gravity:0,     friction:0.1,  restitution:0.9,  airResistance:0.001 },
    water:        { gravity:-1.5,  friction:0.8,  restitution:0.05, airResistance:0.3   },
    custom:       { gravity:-9.8,  friction:0.3,  restitution:0.2,  airResistance:0.01  }
};

const WEATHER_STATES = ["clear","rain","storm","fog","snow","sandstorm","aurora","heatwave"];
const TIME_CYCLES    = ["static","day_night","sunrise","sunset","fast_cycle"];
const ENV_EFFECTS    = ["wind","gravity_shift","magnetic_field","radiation_zone","healing_zone","speed_boost"];

function setPhysicsRules({ worldId, preset, overrides = {} }) {
    if (!worldId) return fail(AGENT, "worldId required");
    if (!PHYSICS_PRESETS[preset]) return fail(AGENT, `preset must be: ${Object.keys(PHYSICS_PRESETS).join(", ")}`);
    const world = loadWorld(worldId);
    if (!world) return fail(AGENT, `worldId ${worldId} not found`);

    const physics = { ...PHYSICS_PRESETS[preset], ...overrides, preset };
    world.physicsRules = physics;
    world.updatedAt = NOW();
    flushWorld(worldId, world);

    metaLog(AGENT, "system", "physics_set", { worldId, preset }, "INFO");
    return ok(AGENT, { worldId, physicsRules:physics, clientNote:"Pass physicsRules to Cannon.js or Rapier.js on client side" });
}

function setWeather({ worldId, weatherState, intensity = 0.5, transitionSeconds = 10 }) {
    if (!worldId) return fail(AGENT, "worldId required");
    if (!WEATHER_STATES.includes(weatherState)) return fail(AGENT, `weatherState must be: ${WEATHER_STATES.join(", ")}`);
    if (intensity < 0 || intensity > 1) return fail(AGENT, "intensity must be 0.0–1.0");
    const world = loadWorld(worldId);
    if (!world) return fail(AGENT, `worldId ${worldId} not found`);

    world.environment = world.environment || {};
    world.environment.weather = { state:weatherState, intensity, transitionSeconds, setAt:NOW() };
    world.updatedAt = NOW();
    flushWorld(worldId, world);

    metaLog(AGENT, "system", "weather_set", { worldId, weatherState, intensity }, "INFO");
    return ok(AGENT, { worldId, weather:world.environment.weather, clientNote:"Apply weather shader and particle effects client-side via Three.js" });
}

function setTimeCycle({ worldId, cycle, speedMultiplier = 1.0, currentHour = 12 }) {
    if (!worldId) return fail(AGENT, "worldId required");
    if (!TIME_CYCLES.includes(cycle)) return fail(AGENT, `cycle must be: ${TIME_CYCLES.join(", ")}`);
    if (speedMultiplier < 0.1 || speedMultiplier > 100) return fail(AGENT, "speedMultiplier must be 0.1–100");
    const world = loadWorld(worldId);
    if (!world) return fail(AGENT, `worldId ${worldId} not found`);

    world.environment = world.environment || {};
    world.environment.timeCycle = { cycle, speedMultiplier, currentHour: currentHour % 24, setAt:NOW() };
    world.updatedAt = NOW();
    flushWorld(worldId, world);

    metaLog(AGENT, "system", "time_cycle_set", { worldId, cycle, speedMultiplier }, "INFO");
    return ok(AGENT, { worldId, timeCycle:world.environment.timeCycle, clientNote:"Animate sun position and sky colour client-side" });
}

function addEnvironmentEffect({ worldId, effectType, zone, durationSeconds = 60, magnitude = 1.0 }) {
    if (!worldId) return fail(AGENT, "worldId required");
    if (!ENV_EFFECTS.includes(effectType)) return fail(AGENT, `effectType must be: ${ENV_EFFECTS.join(", ")}`);
    const world = loadWorld(worldId);
    if (!world) return fail(AGENT, `worldId ${worldId} not found`);

    const effect = { id:uid("eff"), effectType, zone:zone||{center:{x:0,y:0,z:0},radius:20}, durationSeconds, magnitude, expiresAt: new Date(Date.now()+durationSeconds*1000).toISOString(), addedAt:NOW() };
    world.environment = world.environment || {};
    world.environment.effects = world.environment.effects || [];
    world.environment.effects = world.environment.effects.filter(e => new Date(e.expiresAt) > new Date());
    world.environment.effects.push(effect);
    world.updatedAt = NOW();
    flushWorld(worldId, world);

    metaLog(AGENT, "system", "env_effect_added", { worldId, effectType, durationSeconds }, "INFO");
    return ok(AGENT, effect);
}

function getWorldEnvironment({ worldId }) {
    if (!worldId) return fail(AGENT, "worldId required");
    const world = loadWorld(worldId);
    if (!world) return fail(AGENT, `worldId ${worldId} not found`);
    return ok(AGENT, {
        worldId,
        physicsRules:  world.physicsRules || PHYSICS_PRESETS.standard,
        environment:   world.environment  || {},
        presets:       PHYSICS_PRESETS,
        weatherStates: WEATHER_STATES,
        timeCycles:    TIME_CYCLES,
        envEffects:    ENV_EFFECTS
    });
}

module.exports = { setPhysicsRules, setWeather, setTimeCycle, addEnvironmentEffect, getWorldEnvironment };
