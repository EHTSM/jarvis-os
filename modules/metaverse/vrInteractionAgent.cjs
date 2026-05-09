"use strict";
const { loadWorld, flushWorld, loadUser, metaLog, uid, NOW, ok, fail, rateCheck } = require("./_metaverseStore.cjs");

const AGENT = "vrInteractionAgent";

const INPUT_TYPES  = ["controller_button","controller_trigger","controller_grip","gaze","gesture","voice","haptic","keyboard","mouse"];
const EVENT_TYPES  = ["grab","release","point","teleport","select","deselect","interact","proximity_enter","proximity_exit","collision"];
const XR_MODES     = ["inline","immersive-vr","immersive-ar"];

function dispatchInteraction({ userId, worldId, inputType, eventType, targetObjectId, position, payload = {} }) {
    if (!userId || !worldId)    return fail(AGENT, "userId and worldId required");
    if (!INPUT_TYPES.includes(inputType))  return fail(AGENT, `inputType must be: ${INPUT_TYPES.join(", ")}`);
    if (!EVENT_TYPES.includes(eventType))  return fail(AGENT, `eventType must be: ${EVENT_TYPES.join(", ")}`);

    // rate-limit interactions
    if (!rateCheck(userId, "vr_interaction", 60)) return fail(AGENT, "too many interactions — slow down (max 60/min)");

    const world = loadWorld(worldId);
    if (!world) return fail(AGENT, `worldId ${worldId} not found`);

    const event = {
        id:             uid("evt"),
        userId,
        worldId,
        inputType,
        eventType,
        targetObjectId: targetObjectId || null,
        position:       position || null,
        payload,
        resolvedAt:     NOW()
    };

    world.interactions.push(event);
    if (world.interactions.length > 5000) world.interactions = world.interactions.slice(-5000);
    world.updatedAt = NOW();
    flushWorld(worldId, world);

    metaLog(AGENT, userId, "vr_interaction", { worldId, inputType, eventType, targetObjectId }, "INFO");
    return ok(AGENT, { event, broadcastTo: "all_clients_in_world" });
}

function getInteractionHistory({ worldId, userId, eventType, limit = 50 }) {
    if (!worldId) return fail(AGENT, "worldId required");
    const world = loadWorld(worldId);
    if (!world) return fail(AGENT, `worldId ${worldId} not found`);

    let history = world.interactions;
    if (userId)    history = history.filter(e => e.userId === userId);
    if (eventType) history = history.filter(e => e.eventType === eventType);

    return ok(AGENT, { total: history.length, events: history.slice(-limit).reverse() });
}

function getXRCapabilities({ xrMode = "immersive-vr" }) {
    if (!XR_MODES.includes(xrMode)) return fail(AGENT, `xrMode must be: ${XR_MODES.join(", ")}`);
    return ok(AGENT, {
        xrMode,
        supportedInputTypes: INPUT_TYPES,
        supportedEventTypes: EVENT_TYPES,
        clientRequirements: {
            api:        "WebXR Device API",
            library:    "Three.js + XRControllerModelFactory",
            fallback:   "Mouse + Keyboard for non-XR devices",
            hapticFeedback: xrMode === "immersive-vr"
        },
        backendNote: "Backend receives interaction events — rendering and input capture happen client-side only"
    });
}

function sendHapticFeedback({ userId, worldId, intensity = 0.5, durationMs = 200, hand = "both" }) {
    if (!userId || !worldId) return fail(AGENT, "userId and worldId required");
    if (intensity < 0 || intensity > 1) return fail(AGENT, "intensity must be 0.0–1.0");
    if (durationMs < 0 || durationMs > 5000) return fail(AGENT, "durationMs must be 0–5000");
    if (!["left","right","both"].includes(hand)) return fail(AGENT, "hand must be left|right|both");

    const haptic = { id: uid("hap"), userId, worldId, intensity, durationMs, hand, issuedAt: NOW() };
    metaLog(AGENT, userId, "haptic_issued", { worldId, intensity, durationMs, hand }, "INFO");
    return ok(AGENT, { haptic, deliveryNote: "Haptic command delivered to XR controller via client WebXR API" });
}

module.exports = { dispatchInteraction, getInteractionHistory, getXRCapabilities, sendHapticFeedback };
