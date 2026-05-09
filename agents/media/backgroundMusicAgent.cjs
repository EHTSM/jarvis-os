"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "backgroundMusicAgent";

const MOOD_TRACKS = {
    epic:        { bpm:"120-160", key:"minor",  instruments:["orchestra","brass","choir","drums"],      libraries:["Epidemic Sound","Artlist","Musicbed"] },
    chill:       { bpm:"70-95",   key:"major",  instruments:["acoustic_guitar","piano","soft_pads"],    libraries:["Epidemic Sound","Uppbeat","Pixabay Music"] },
    tense:       { bpm:"90-130",  key:"minor",  instruments:["strings","percussion","synths"],          libraries:["Artlist","Musicbed","Pond5"] },
    happy:       { bpm:"100-130", key:"major",  instruments:["ukulele","xylophone","claps","piano"],    libraries:["Epidemic Sound","Bensound","Pixabay"] },
    corporate:   { bpm:"90-120",  key:"major",  instruments:["piano","light_drums","strings","guitar"], libraries:["Artlist","Musicbed","Shutterstock Music"] },
    dark:        { bpm:"60-90",   key:"minor",  instruments:["cello","deep_bass","ambient_pads"],       libraries:["Artlist","Musicbed","Pond5"] },
    inspirational:{ bpm:"80-110",key:"major",  instruments:["piano","strings","gentle_choir"],          libraries:["Epidemic Sound","Artlist","Musicbed"] },
    action:      { bpm:"130-170", key:"minor",  instruments:["electric_guitar","synth","heavy_drums"],  libraries:["Artlist","Pond5","Musicbed"] },
    romantic:    { bpm:"60-90",   key:"major",  instruments:["violin","piano","soft_guitar"],           libraries:["Epidemic Sound","Artlist","Bensound"] },
    documentary: { bpm:"70-100",  key:"major",  instruments:["acoustic","ambient_pad","piano"],         libraries:["Musicbed","Artlist","Artgrid"] }
};

const FREE_SOURCES = [
    { name:"YouTube Audio Library", url:"studio.youtube.com/channel/*/music", license:"Free for YT" },
    { name:"Pixabay Music",          url:"pixabay.com/music",                  license:"CC0" },
    { name:"ccMixter",               url:"ccmixter.org",                       license:"CC" },
    { name:"Free Music Archive",     url:"freemusicarchive.org",               license:"Various CC" },
    { name:"Bensound",               url:"bensound.com",                       license:"Attribution required" },
    { name:"Incompetech",            url:"incompetech.filmmusic.io",           license:"CC-BY/Royalty Free" }
];

function selectMusic({ userId, mood, durationSeconds, videoType, contentId }) {
    if (!userId || !mood) return fail(AGENT, "userId and mood required");
    trackEvent("bgm_select", { userId, mood });

    const moodKey  = mood.toLowerCase().replace(/\s+/g,"_");
    const track    = MOOD_TRACKS[moodKey] || MOOD_TRACKS.chill;

    const selection = {
        id:          uid("bgm"),
        userId,
        contentId,
        mood:        moodKey,
        trackProfile:track,
        durationSeconds,
        videoType,
        recommendation: {
            bpm:         track.bpm,
            key:         track.key,
            instruments: track.instruments,
            loopable:    true,
            fadeIn:      "3 seconds",
            fadeOut:     "5 seconds",
            volumeMix:   videoType === "voiceover" ? "-18dB under speech" : "-12dB"
        },
        licensedLibraries: track.libraries,
        freeSources:       FREE_SOURCES,
        searchQueries:     track.libraries.map(l => `${l}: ${moodKey} background music ${durationSeconds ? `${durationSeconds}s` : ""}`),
        createdAt:   NOW()
    };

    const log = load(userId, "bgm_selections", []);
    log.push(selection);
    flush(userId, "bgm_selections", log.slice(-200));

    return ok(AGENT, { selection, notice: "Always verify license before publishing. Royalty-free ≠ copyright-free." });
}

function getMoodOptions() {
    return ok(AGENT, { moods: Object.entries(MOOD_TRACKS).map(([k, v]) => ({ mood: k, bpm: v.bpm, key: v.key, instruments: v.instruments })), freeSources: FREE_SOURCES });
}

module.exports = { selectMusic, getMoodOptions };
