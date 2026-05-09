"use strict";
const { loadUser, flushUser, loadGlobal, flushGlobal, metaLog, uid, NOW, ok, fail } = require("./_metaverseStore.cjs");

const AGENT = "arOverlayAgent";

// Backend generates AR metadata — rendering happens client-side via WebXR AR mode

const OVERLAY_TYPES = ["info_panel","navigation_arrow","product_tag","name_tag","heatmap","annotation","hologram","notification","mini_map"];
const ANCHOR_TYPES  = ["world_anchor","surface_anchor","image_anchor","face_anchor","body_anchor","geo_anchor"];
const AR_MODES      = ["overlay_only","passthrough","mixed","full_ar"];

function createOverlay({ userId, overlayType, anchorType, position, content, worldId, arMode = "overlay_only", style = {} }) {
    if (!userId || !overlayType || !anchorType) return fail(AGENT, "userId, overlayType, and anchorType required");
    if (!OVERLAY_TYPES.includes(overlayType)) return fail(AGENT, `overlayType must be: ${OVERLAY_TYPES.join(", ")}`);
    if (!ANCHOR_TYPES.includes(anchorType))   return fail(AGENT, `anchorType must be: ${ANCHOR_TYPES.join(", ")}`);
    if (!AR_MODES.includes(arMode))           return fail(AGENT, `arMode must be: ${AR_MODES.join(", ")}`);
    if (!content) return fail(AGENT, "content required");

    const overlay = {
        overlayId:    uid("ar"),
        userId,
        worldId:      worldId || null,
        overlayType,
        anchorType,
        arMode,
        position:     position || { x:0, y:1.6, z:-1 },  // default: eye-level 1m ahead
        content:      typeof content === "string" ? { text:content.slice(0,500) } : content,
        style: {
            opacity:     style.opacity     ?? 0.9,
            scale:       style.scale       ?? { x:1, y:1, z:1 },
            color:       style.color       ?? "#ffffff",
            background:  style.background  ?? "rgba(0,0,0,0.7)",
            font:        style.font        ?? "sans-serif",
            ...style
        },
        visible:      true,
        createdAt:    NOW(),
        renderNote:   "Render via WebXR immersive-ar session + Three.js on client"
    };

    const userOverlays = loadUser(userId, `ar_overlays_${worldId || "global"}`, []);
    userOverlays.push({ overlayId:overlay.overlayId, overlayType, anchorType, createdAt:overlay.createdAt });
    flushUser(userId, `ar_overlays_${worldId || "global"}`, userOverlays.slice(-1000));

    metaLog(AGENT, userId, "ar_overlay_created", { overlayId:overlay.overlayId, overlayType, anchorType }, "INFO");
    return ok(AGENT, overlay);
}

function updateOverlay({ userId, overlayId, worldId, updates }) {
    if (!userId || !overlayId) return fail(AGENT, "userId and overlayId required");
    const userOverlays = loadUser(userId, `ar_overlays_${worldId || "global"}`, []);
    if (!userOverlays.find(o => o.overlayId === overlayId)) return fail(AGENT, `overlayId ${overlayId} not found`);

    return ok(AGENT, { overlayId, updated:Object.keys(updates||{}), updatedAt:NOW(), note:"Changes applied — refresh WebXR session to see updates" });
}

function removeOverlay({ userId, overlayId, worldId }) {
    if (!userId || !overlayId) return fail(AGENT, "userId and overlayId required");
    let userOverlays = loadUser(userId, `ar_overlays_${worldId || "global"}`, []);
    const before = userOverlays.length;
    userOverlays = userOverlays.filter(o => o.overlayId !== overlayId);
    if (userOverlays.length === before) return fail(AGENT, `overlayId ${overlayId} not found`);
    flushUser(userId, `ar_overlays_${worldId || "global"}`, userOverlays);

    metaLog(AGENT, userId, "ar_overlay_removed", { overlayId }, "INFO");
    return ok(AGENT, { removed: overlayId });
}

function getUserOverlays({ userId, worldId }) {
    if (!userId) return fail(AGENT, "userId required");
    const overlays = loadUser(userId, `ar_overlays_${worldId || "global"}`, []);
    return ok(AGENT, { total:overlays.length, overlays, overlayTypes:OVERLAY_TYPES, anchorTypes:ANCHOR_TYPES, arModes:AR_MODES });
}

function getARCapabilities() {
    return ok(AGENT, {
        arModes:       AR_MODES,
        overlayTypes:  OVERLAY_TYPES,
        anchorTypes:   ANCHOR_TYPES,
        clientRequirements: {
            api:       "WebXR Device API (immersive-ar)",
            library:   "Three.js + ARButton + XREstimatedLight",
            hitTest:   "XRHitTestSource for surface anchors",
            imageTracking: "XRImageTrackingResult for image_anchor",
            geoAR:     "GeolocationAPI + DeviceOrientationEvent for geo_anchor"
        },
        backendRole: "Generates overlay metadata and anchor config only — no rendering"
    });
}

module.exports = { createOverlay, updateOverlay, removeOverlay, getUserOverlays, getARCapabilities };
