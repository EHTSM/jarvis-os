"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "animationCreator";

const ANIMATION_STYLES = {
    "2d_cartoon":   { fps:24, tools:["Adobe Animate","Toon Boom Harmony","OpenToonz"], description:"Classic cartoon style" },
    "3d_render":    { fps:24, tools:["Blender","Maya","Cinema 4D"], description:"3D CGI animation" },
    "motion_graphics":{ fps:30, tools:["After Effects","DaVinci Resolve","Rive"], description:"Text and shape animations" },
    stop_motion:    { fps:12, tools:["Dragonframe","Stop Motion Studio"], description:"Physical object frame-by-frame" },
    whiteboard:     { fps:15, tools:["VideoScribe","Doodly","Animaker"], description:"Hand-drawn whiteboard style" },
    anime:          { fps:24, tools:["Clip Studio Paint","Krita"], description:"Japanese animation style" },
    pixel_art:      { fps:8,  tools:["Aseprite","Pixilart"], description:"Retro pixel animation" },
    kinetic_text:   { fps:30, tools:["After Effects","Rive","Jitter"], description:"Animated typography" }
};

const ASSET_TYPES = ["background","character","prop","effect","text","transition"];

function planAnimation({ userId, title, style = "motion_graphics", durationSeconds = 30, scenes = [], targetPlatform = "youtube" }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("animation_plan", { userId, style });

    const styleKey  = style.toLowerCase().replace(/\s+/g,"_");
    const styleDef  = ANIMATION_STYLES[styleKey] || ANIMATION_STYLES.motion_graphics;
    const totalFrames = styleDef.fps * durationSeconds;

    const autoScenes = scenes.length ? scenes : [
        { name:"Opening",   durationSec: Math.round(durationSeconds * 0.15), description:"Title/hook" },
        { name:"Main Body", durationSec: Math.round(durationSeconds * 0.70), description:"Core content" },
        { name:"Outro",     durationSec: Math.round(durationSeconds * 0.15), description:"CTA/credits" }
    ];

    const plan = {
        id:           uid("an"),
        userId,
        title,
        style:        styleKey,
        styleInfo:    styleDef,
        durationSeconds,
        totalFrames,
        targetPlatform,
        scenes:       autoScenes.map((s, i) => ({
            ...s,
            order:     i + 1,
            frames:    styleDef.fps * s.durationSec,
            assets:    ASSET_TYPES.slice(0, 3).map(a => ({ type: a, status: "needed" }))
        })),
        exportFormats:["MP4 H.264","WebM","GIF","APNG"],
        createdAt:    NOW()
    };

    const animations = load(userId, "animations", []);
    animations.push(plan);
    flush(userId, "animations", animations.slice(-50));

    return ok(AGENT, { animation: plan, toolRecommendations: styleDef.tools });
}

function addAsset({ userId, animationId, assetType, assetName, sourceUrl }) {
    if (!userId || !animationId) return fail(AGENT, "userId and animationId required");
    if (!ASSET_TYPES.includes(assetType)) return fail(AGENT, `assetType must be one of: ${ASSET_TYPES.join(", ")}`);

    const animations = load(userId, "animations", []);
    const animation  = animations.find(a => a.id === animationId);
    if (!animation)  return fail(AGENT, "Animation plan not found");

    if (!animation.assets) animation.assets = [];
    animation.assets.push({ id: uid("ast"), type: assetType, name: assetName, sourceUrl, addedAt: NOW() });
    flush(userId, "animations", animations);

    return ok(AGENT, { animationId, asset: animation.assets[animation.assets.length - 1] });
}

function getAnimationStyles() {
    return ok(AGENT, Object.entries(ANIMATION_STYLES).map(([k, v]) => ({ key: k, ...v })));
}

module.exports = { planAnimation, addAsset, getAnimationStyles };
