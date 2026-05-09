"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "soundEffectGenerator";

const SFX_LIBRARY = {
    ui:         ["button_click","notification_pop","error_buzz","success_chime","hover_tick","toggle_switch","keyboard_type","page_turn"],
    nature:     ["rain_light","rain_heavy","thunder","ocean_waves","wind","forest_birds","fire_crackling","waterfall"],
    vehicles:   ["car_engine","car_horn","car_crash","motorcycle","helicopter","airplane_flyby","train_whistle"],
    human:      ["crowd_cheer","crowd_boo","single_clap","applause","footsteps_wood","footsteps_gravel","door_knock","door_creak"],
    gaming:     ["coin_collect","power_up","explosion","laser_shot","sword_clash","level_up","game_over","jump"],
    horror:     ["heartbeat","breathing_heavy","scream","creaking_floor","wind_howl","thunder_crack","door_slam"],
    music_hits: ["cinematic_boom","drum_hit","bass_drop","vinyl_scratch","sting_short","logo_ident"],
    comedy:     ["boing","slide_whistle","cartoon_pop","spring","rubber_duck","kazoo"],
    ambient:    ["office_hum","coffee_shop","city_traffic","park_ambience","library_quiet","rain_window"]
};

const FREE_SFX_SOURCES = [
    { name:"Freesound.org",    url:"freesound.org",    license:"Various CC" },
    { name:"Zapsplat",         url:"zapsplat.com",     license:"Royalty Free" },
    { name:"BBC Sound Effects",url:"sound-effects.bbcrewind.co.uk", license:"RemArc Licence" },
    { name:"Soundsnap",        url:"soundsnap.com",    license:"Royalty Free" },
    { name:"Pixabay",          url:"pixabay.com/sound-effects", license:"CC0/Royalty Free" }
];

function searchSFX({ userId, category, query, mood }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("sfx_search", { userId, category });

    const catKey = (category || "ui").toLowerCase();
    const lib    = SFX_LIBRARY[catKey] || [];

    let results  = lib;
    if (query)   results = results.filter(s => s.includes(query.toLowerCase().replace(/\s+/g,"_")));
    if (!results.length) {
        results = Object.values(SFX_LIBRARY).flat().filter(s => s.includes((query || "").toLowerCase().replace(/\s+/g,"_")));
    }

    return ok(AGENT, {
        query,
        category:    catKey,
        found:       results.slice(0, 10),
        allCategories: Object.keys(SFX_LIBRARY),
        sources:     FREE_SFX_SOURCES,
        searchLinks: FREE_SFX_SOURCES.map(s => ({ name: s.name, url: `https://${s.url}/search?q=${encodeURIComponent(query || category || "")}` }))
    });
}

function generateSFX({ userId, type, description, duration = 2, format = "wav" }) {
    if (!userId || !type) return fail(AGENT, "userId and type required");
    trackEvent("sfx_generate", { userId, type });

    const sfx = {
        id:          uid("sfx"),
        userId,
        type,
        description: description || type,
        duration,
        format,
        renderNote:  "Integrate ElevenLabs SFX, Adobe Firefly Audio, or AudioCraft (Meta) for generation",
        elevenlabsEndpoint: "https://api.elevenlabs.io/v1/sound-generation",
        audiocraftModel:    "audiocraft/audiogen",
        createdAt:   NOW()
    };

    const sfxLog = load(userId, "sfx_log", []);
    sfxLog.push(sfx);
    flush(userId, "sfx_log", sfxLog.slice(-500));

    return ok(AGENT, { sfx, sources: FREE_SFX_SOURCES });
}

function getSFXCategories() {
    return ok(AGENT, { categories: Object.fromEntries(Object.entries(SFX_LIBRARY).map(([k, v]) => [k, { count: v.length, samples: v.slice(0, 3) }])), sources: FREE_SFX_SOURCES });
}

module.exports = { searchSFX, generateSFX, getSFXCategories };
