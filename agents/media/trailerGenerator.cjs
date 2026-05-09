"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "trailerGenerator";

const TRAILER_TYPES = {
    teaser:     { durationRange:"30-60s",  pace:"fast",   musicEnergy:"high",   hookPlacement:"first_5s" },
    theatrical: { durationRange:"90-180s", pace:"medium", musicEnergy:"epic",   hookPlacement:"first_10s" },
    tv_spot:    { durationRange:"15-30s",  pace:"very_fast",musicEnergy:"high", hookPlacement:"first_3s" },
    social:     { durationRange:"15-60s",  pace:"fast",   musicEnergy:"high",   hookPlacement:"first_3s" },
    documentary:{ durationRange:"60-120s", pace:"slow",   musicEnergy:"ambient",hookPlacement:"first_10s" }
};

const BEAT_STRUCTURE = {
    fast: [
        { beat:1, timeRange:"0-5s",   element:"Hook/Opening question or action shot" },
        { beat:2, timeRange:"5-15s",  element:"Context setup — who/what is this?" },
        { beat:3, timeRange:"15-25s", element:"Escalating tension/drama" },
        { beat:4, timeRange:"25-35s", element:"Best moments montage (fast cuts)" },
        { beat:5, timeRange:"35-45s", element:"Climax reveal or twist" },
        { beat:6, timeRange:"45-60s", element:"Title card + CTA (subscribe/watch now)" }
    ],
    epic: [
        { beat:1, timeRange:"0-10s",   element:"Atmospheric opening — tone setting" },
        { beat:2, timeRange:"10-30s",  element:"Story introduction — stakes established" },
        { beat:3, timeRange:"30-70s",  element:"Rising action montage" },
        { beat:4, timeRange:"70-100s", element:"Orchestral build to boom" },
        { beat:5, timeRange:"100-120s",element:"Title reveal on black" },
        { beat:6, timeRange:"120-150s",element:"Final beat + release date/CTA" }
    ]
};

function generateTrailerPlan({ userId, sourceContentId, sourceTitle, contentType = "youtube_video", trailerType = "teaser", highlights = [], targetPlatform = "youtube" }) {
    if (!userId || !sourceContentId) return fail(AGENT, "userId and sourceContentId required");
    trackEvent("trailer_plan", { userId, trailerType });

    const type     = TRAILER_TYPES[trailerType] || TRAILER_TYPES.teaser;
    const beats    = BEAT_STRUCTURE[type.pace === "very_fast" || type.pace === "fast" ? "fast" : "epic"];

    const plan = {
        id:           uid("tr"),
        userId,
        sourceContentId,
        sourceTitle,
        contentType,
        trailerType,
        trailerProfile: type,
        beatStructure: beats,
        selectedHighlights: highlights.slice(0, 10),
        musicSuggestion: {
            mood:    type.musicEnergy,
            note:    "Use copyrightChecker before adding any music",
            sources: ["Epidemic Sound","Artlist","YouTube Audio Library"]
        },
        textElements: [
            { type:"hook",    timing:"0-3s",  text:"Opening bold statement or question" },
            { type:"title",   timing:"end",   text:sourceTitle },
            { type:"cta",     timing:"final", text:`Subscribe / Watch Now on ${targetPlatform}` }
        ],
        exportPreset: { resolution:"1920x1080", format:"MP4 H.264", fps:30 },
        tools:        ["Adobe Premiere","DaVinci Resolve","CapCut","Canva Video"],
        status:       "draft",
        createdAt:    NOW()
    };

    const plans = load(userId, "trailer_plans", []);
    plans.push(plan);
    flush(userId, "trailer_plans", plans.slice(-50));

    return ok(AGENT, { plan });
}

function getTrailerTypes() { return ok(AGENT, { trailerTypes: TRAILER_TYPES, beatStructures: BEAT_STRUCTURE }); }

module.exports = { generateTrailerPlan, getTrailerTypes };
