"use strict";
const { ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, blocked, killed } = require("./_ultimateStore.cjs");

const AGENT = "multiSystemIntegrator";

// Registry of all Jarvis OS layers and their module paths
const LAYER_REGISTRY = {
    futureTech:  { path: "../../modules/futureTech/index.cjs",     description: "Space, climate, energy, environment, agriculture, food supply" },
    metaverse:   { path: "../../modules/metaverse/index.cjs",      description: "Virtual worlds, avatars, NFTs, virtual economy" },
    humanAI:     { path: "../../agents/humanAI/index.cjs",         description: "Brain-computer interface, emotion, personality, digital twin" },
    dev:         { path: "../../agents/dev/index.cjs",             description: "Code generation, debugging, deployment" },
    business:    { path: "../../agents/business/index.cjs",        description: "Business automation, analytics, CRM" },
    intelligence:{ path: "../../agents/intelligence/index.cjs",    description: "Advanced reasoning, hypothesis, curiosity, multi-brain" },
    governance:  { path: "../../agents/governance/index.cjs",      description: "Compliance, tokenization, governance reporting" },
    health:      { path: "../../agents/health/index.cjs",          description: "Health tracking, medical analysis, wellness" },
    education:   { path: "../../agents/education/index.cjs",       description: "Learning, tutoring, curriculum, assessment" },
    life:        { path: "../../agents/life/index.cjs",            description: "Personal assistant, scheduling, relationships, goals" }
};

// ── Connect and probe available layers ───────────────────────────
function connectLayers({ requestedLayers = [] }) {
    if (isKillSwitchActive()) return killed(AGENT);

    const targets    = requestedLayers.length > 0 ? requestedLayers : Object.keys(LAYER_REGISTRY);
    const connected  = [];
    const failed     = [];

    for (const name of targets) {
        if (!LAYER_REGISTRY[name]) {
            failed.push({ layer: name, reason: "Not in layer registry" });
            continue;
        }
        try {
            const mod = require(LAYER_REGISTRY[name].path);
            const exports = Object.keys(mod);
            connected.push({ layer: name, description: LAYER_REGISTRY[name].description, agentCount: exports.length, status: "connected" });
        } catch (e) {
            failed.push({ layer: name, reason: e.message, status: "unavailable" });
        }
    }

    const result = {
        connectionId:  uid("con"),
        requested:     targets.length,
        connected:     connected.length,
        failed:        failed.length,
        layers:        connected,
        unavailable:   failed,
        health:        failed.length === 0 ? "all_connected" : connected.length === 0 ? "none_connected" : "partial",
        connectedAt:   NOW()
    };

    ultimateLog(AGENT, "layers_connected", { connected: connected.length, failed: failed.length }, "INFO");
    return ok(AGENT, result);
}

// ── Route a sub-task to a specific layer ─────────────────────────
function routeToLayer({ layer, method, args = {} }) {
    if (!layer || !method) return fail(AGENT, "layer and method are required");
    if (isKillSwitchActive()) return killed(AGENT);
    if (!LAYER_REGISTRY[layer]) return fail(AGENT, `Unknown layer '${layer}'. Available: ${Object.keys(LAYER_REGISTRY).join(", ")}`);

    try {
        const mod = require(LAYER_REGISTRY[layer].path);
        if (typeof mod[method] !== "function") {
            return fail(AGENT, `Method '${method}' not found in layer '${layer}'`);
        }
        const result = mod[method](args);
        ultimateLog(AGENT, "layer_routed", { layer, method }, "INFO");
        return ok(AGENT, { layer, method, result, routedAt: NOW() });
    } catch (e) {
        ultimateLog(AGENT, "layer_route_failed", { layer, method, error: e.message }, "WARN");
        return fail(AGENT, `Layer routing failed: ${e.message}`);
    }
}

// ── Get system topology ───────────────────────────────────────────
function getTopology() {
    return ok(AGENT, {
        totalLayers:  Object.keys(LAYER_REGISTRY).length,
        layers:       Object.entries(LAYER_REGISTRY).map(([name, info]) => ({ name, description: info.description })),
        architecture: "modular_integration",
        note:         "Layers are loosely coupled. Each can function independently."
    });
}

module.exports = { connectLayers, routeToLayer, getTopology, LAYER_REGISTRY };
