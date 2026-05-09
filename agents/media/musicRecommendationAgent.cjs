"use strict";
const { load, flush, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "musicRecommendationAgent";

const MOOD_TRACKS = {
    happy:        [{ title:"Happy",artist:"Pharrell Williams",genre:"pop" },{ title:"Can't Stop the Feeling",artist:"Justin Timberlake",genre:"pop" },{ title:"Jai Ho",artist:"A.R. Rahman",genre:"bollywood" }],
    sad:          [{ title:"The Night We Met",artist:"Lord Huron",genre:"indie" },{ title:"Someone Like You",artist:"Adele",genre:"pop" },{ title:"Tujhe Bhula Diya",artist:"Shafqat Amanat Ali",genre:"bollywood" }],
    focused:      [{ title:"Weightless",artist:"Marconi Union",genre:"ambient" },{ title:"Experience",artist:"Ludovico Einaudi",genre:"classical" },{ title:"Time",artist:"Hans Zimmer",genre:"score" }],
    energetic:    [{ title:"Eye of the Tiger",artist:"Survivor",genre:"rock" },{ title:"Sandstorm",artist:"Darude",genre:"electronic" },{ title:"Chaiyya Chaiyya",artist:"A.R. Rahman",genre:"bollywood" }],
    romantic:     [{ title:"Perfect",artist:"Ed Sheeran",genre:"pop" },{ title:"Tum Hi Ho",artist:"Arijit Singh",genre:"bollywood" },{ title:"Kal Ho Naa Ho",artist:"Sonu Nigam",genre:"bollywood" }],
    relaxed:      [{ title:"Somewhere Only We Know",artist:"Keane",genre:"indie" },{ title:"Banana Pancakes",artist:"Jack Johnson",genre:"acoustic" },{ title:"Iktara",artist:"Kavita Seth",genre:"indie_hindi" }],
    workout:      [{ title:"Lose Yourself",artist:"Eminem",genre:"hiphop" },{ title:"Thunderstruck",artist:"AC/DC",genre:"rock" },{ title:"Jump Around",artist:"House of Pain",genre:"hiphop" }],
    party:        [{ title:"Uptown Funk",artist:"Bruno Mars",genre:"pop" },{ title:"Senorita",artist:"Shawn Mendes",genre:"pop" },{ title:"Badtameez Dil",artist:"Pritam",genre:"bollywood" }],
    morning:      [{ title:"Here Comes the Sun",artist:"The Beatles",genre:"classic_rock" },{ title:"Good Life",artist:"OneRepublic",genre:"pop" },{ title:"Subah Ho Gayi Mamu",artist:"Suraj Jagan",genre:"bollywood" }],
    night:        [{ title:"Starboy",artist:"The Weeknd",genre:"rnb" },{ title:"Blinding Lights",artist:"The Weeknd",genre:"pop" },{ title:"Raabta",artist:"Arijit Singh",genre:"bollywood" }]
};

const GENRE_ARTISTS = {
    bollywood: ["Arijit Singh","A.R. Rahman","Pritam","Shankar Ehsaan Loy","Sonu Nigam","Shreya Ghoshal"],
    pop:       ["Taylor Swift","Ed Sheeran","Billie Eilish","Dua Lipa","Justin Bieber"],
    rock:      ["Coldplay","Imagine Dragons","Linkin Park","The Beatles","Queen"],
    hiphop:    ["Drake","Kendrick Lamar","Eminem","J. Cole","Badshah"],
    classical: ["Ludovico Einaudi","Yanni","Hans Zimmer","A.R. Rahman (instrumentals)"],
    jazz:      ["Miles Davis","John Coltrane","Louis Armstrong","Norah Jones"],
    electronic:["Calvin Harris","David Guetta","Martin Garrix","Avicii"],
    indie:     ["Arctic Monkeys","The Lumineers","Kodaline","Local Natives"]
};

function recommend({ userId, mood, genres = [], activity, language }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("music_recommend", { userId, mood });

    const tracks = [];

    if (mood) {
        const moodKey = mood.toLowerCase();
        tracks.push(...(MOOD_TRACKS[moodKey] || MOOD_TRACKS.relaxed));
    }

    for (const genre of genres) {
        const key     = genre.toLowerCase();
        const artists = GENRE_ARTISTS[key] || [];
        if (artists.length) tracks.push({ genre: key, topArtists: artists, suggestion: `Search ${key} playlist on Spotify/JioSaavn` });
    }

    if (activity) {
        const actMap = { gym:"workout", study:"focused", date:"romantic", sleep:"relaxed", commute:"energetic" };
        const mapped = actMap[activity.toLowerCase()];
        if (mapped && MOOD_TRACKS[mapped]) tracks.push(...MOOD_TRACKS[mapped]);
    }

    const deduped = [...new Map(tracks.filter(t => t.title).map(t => [t.title, t])).values()];

    // Save music preferences
    const prefs = load(userId, "music_prefs", { favGenres: [], history: [] });
    if (mood) prefs.history = [{ mood, date: new Date().toISOString().slice(0,10) }, ...(prefs.history || [])].slice(0, 50);
    flush(userId, "music_prefs", prefs);

    return ok(AGENT, {
        tracks:     deduped.slice(0, 10),
        mood,
        activity,
        streamOn:   ["Spotify","JioSaavn","Apple Music","YouTube Music","Gaana"],
        tip:        mood ? `Playlist curated for '${mood}' mood` : "Recommendations based on selected genres"
    });
}

module.exports = { recommend };
