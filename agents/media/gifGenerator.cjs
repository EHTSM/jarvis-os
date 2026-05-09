"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "gifGenerator";

const GIF_SOURCES = {
    reaction:   { categories:["happy","sad","surprised","angry","confused","celebrating","facepalm","thumbsup"] },
    gaming:     { categories:["victory","defeat","rage_quit","clutch","glitch","speedrun"] },
    animals:    { categories:["cats","dogs","pandas","otters","birds","funny_animals"] },
    sports:     { categories:["goal","dunk","touchdown","race","knockout","trophy"] },
    movies:     { categories:["action","drama","comedy","plot_twist","epic_scene"] }
};

const TENOR_SEARCH_BASE = "https://tenor.com/search/";
const GIPHY_SEARCH_BASE  = "https://giphy.com/search/";

function searchGif({ userId, query, category, source = "tenor", limit = 8 }) {
    if (!userId || !query) return fail(AGENT, "userId and query required");
    trackEvent("gif_search", { userId, query });

    const safeQuery = encodeURIComponent(query.slice(0, 100));
    const tenorUrl  = `${TENOR_SEARCH_BASE}${safeQuery}`;
    const giphyUrl  = `${GIPHY_SEARCH_BASE}${safeQuery}`;

    const reactionSuggestions = [];
    if (category && GIF_SOURCES[category]) {
        reactionSuggestions.push(...GIF_SOURCES[category].categories.slice(0, 4).map(c => ({
            suggestion: `${query} ${c}`,
            searchUrl:  `${TENOR_SEARCH_BASE}${encodeURIComponent(`${query} ${c}`)}`
        })));
    }

    return ok(AGENT, {
        query,
        searchLinks:  { tenor: tenorUrl, giphy: giphyUrl },
        suggestions:  reactionSuggestions,
        apiNote:      "Integrate Tenor API (key: TENOR_API_KEY) or Giphy API for programmatic GIF retrieval",
        tenorEndpoint:`https://tenor.googleapis.com/v2/search?q=${safeQuery}&key=YOUR_KEY&limit=${limit}`,
        giphyEndpoint:`https://api.giphy.com/v1/gifs/search?q=${safeQuery}&api_key=YOUR_KEY&limit=${limit}`
    });
}

function createCustomGif({ userId, frames = [], fps = 10, width = 480, height = 480, title, loop = true }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!frames.length) return fail(AGENT, "frames array required (array of image URLs or base64)");
    trackEvent("gif_create", { userId, frameCount: frames.length });

    const gif = {
        id:        uid("gif"),
        userId,
        title:     title || `Custom GIF ${NOW().slice(0,10)}`,
        frames:    frames.length,
        fps,
        width,
        height,
        loop,
        durationMs: Math.round(frames.length / fps * 1000),
        renderNote: "Use ffmpeg or sharp+gifencoder library to render frames to GIF",
        ffmpegCmd:  `ffmpeg -r ${fps} -i frame%d.png -vf "scale=${width}:${height}" -loop ${loop ? 0 : 1} output.gif`,
        createdAt:  NOW()
    };

    const gifs = load(userId, "custom_gifs", []);
    gifs.push(gif);
    flush(userId, "custom_gifs", gifs.slice(-100));

    return ok(AGENT, { gif });
}

function getReactionGif({ userId, emotion }) {
    if (!userId || !emotion) return fail(AGENT, "userId and emotion required");
    const normalised = emotion.toLowerCase().replace(/\s+/g,"_");
    const url        = `${TENOR_SEARCH_BASE}${encodeURIComponent(`${emotion} reaction`)}`;
    const apiUrl     = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(normalised+" reaction")}&key=YOUR_KEY&limit=4`;
    return ok(AGENT, { emotion, searchUrl: url, tenorApiUrl: apiUrl });
}

module.exports = { searchGif, createCustomGif, getReactionGif };
