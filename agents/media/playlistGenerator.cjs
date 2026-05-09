"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "playlistGenerator";

const PLAYLIST_TEMPLATES = {
    workout:    { bpm: "120-160", energy:"high",   duration:"45-60 min", theme:"Pump Up Your Workout" },
    chill:      { bpm: "60-90",   energy:"low",    duration:"30-60 min", theme:"Sunday Chill Session" },
    focus:      { bpm: "70-90",   energy:"medium", duration:"90-120 min",theme:"Deep Work Mode" },
    party:      { bpm: "120-140", energy:"high",   duration:"60-120 min",theme:"Party All Night" },
    sleep:      { bpm: "40-70",   energy:"minimal",duration:"45-60 min", theme:"Sleep Soundscape" },
    road_trip:  { bpm: "100-130", energy:"medium", duration:"120-180 min",theme:"Road Trip Anthems" },
    romantic:   { bpm: "70-100",  energy:"medium", duration:"60-90 min", theme:"Date Night Vibes" },
    morning:    { bpm: "90-120",  energy:"medium", duration:"30-45 min", theme:"Rise & Shine" }
};

function generatePlaylist({ userId, theme, mood, genres = [], trackCount = 20, duration, title }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("playlist_generate", { userId, theme });

    const key      = (theme || mood || "chill").toLowerCase().replace(/\s+/g,"_");
    const template = PLAYLIST_TEMPLATES[key] || PLAYLIST_TEMPLATES.chill;

    const playlist = {
        id:          uid("pl"),
        userId,
        title:       title || template.theme,
        theme:       key,
        template,
        trackCount,
        genres:      genres.length ? genres : ["mixed"],
        totalDuration: duration || template.duration,
        exportFormats:["Spotify URI","M3U","JSON"],
        generationNote:"Track list is a suggestion template — import to Spotify/JioSaavn to fill with actual tracks",
        sections:    _buildSections(key, trackCount),
        createdAt:   NOW()
    };

    const playlists = load(userId, "playlists", []);
    playlists.push(playlist);
    flush(userId, "playlists", playlists.slice(-100));

    return ok(AGENT, {
        playlist,
        spotifyQuery: `https://open.spotify.com/search/${encodeURIComponent(template.theme)}`,
        jiosaavnQuery:`https://www.jiosaavn.com/search/${encodeURIComponent(template.theme)}`
    });
}

function _buildSections(theme, trackCount) {
    const sections = {
        workout:   [{ name:"Warm Up",tracks:3,energy:"medium"},{ name:"Peak Intensity",tracks:12,energy:"high"},{ name:"Cool Down",tracks:5,energy:"low"}],
        focus:     [{ name:"Ease In",tracks:5,energy:"low"},{ name:"Deep Work",tracks:10,energy:"medium"},{ name:"Break",tracks:3,energy:"light"},{ name:"Final Push",tracks:5,energy:"medium"}],
        party:     [{ name:"Opener",tracks:5,energy:"medium"},{ name:"Peak",tracks:12,energy:"high"},{ name:"Late Night",tracks:5,energy:"medium-high"}],
        road_trip: [{ name:"Starting Out",tracks:5,energy:"medium"},{ name:"Cruising",tracks:10,energy:"high"},{ name:"Winding Down",tracks:5,energy:"medium"}]
    };
    return (sections[theme] || [{ name:"Main",tracks:trackCount,energy:"mixed"}]);
}

function getPlaylists({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    return ok(AGENT, load(userId, "playlists", []).slice(-20).reverse());
}

module.exports = { generatePlaylist, getPlaylists };
