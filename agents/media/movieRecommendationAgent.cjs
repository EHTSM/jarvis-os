"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");

const AGENT = "movieRecommendationAgent";

const MOVIE_DB = {
    action:    [{ title:"Mad Max: Fury Road",year:2015,rating:8.1,platform:["Netflix","Prime"] },{ title:"John Wick",year:2014,rating:7.4,platform:["Prime","Hulu"] },{ title:"RRR",year:2022,rating:7.8,platform:["Netflix","ZEE5"] },{ title:"Top Gun: Maverick",year:2022,rating:8.3,platform:["Paramount+","Prime"] }],
    drama:     [{ title:"The Shawshank Redemption",year:1994,rating:9.3,platform:["Netflix","Prime"] },{ title:"The Godfather",year:1972,rating:9.2,platform:["Paramount+"] },{ title:"Drishyam",year:2013,rating:8.3,platform:["Prime","Hotstar"] }],
    comedy:    [{ title:"The Grand Budapest Hotel",year:2014,rating:8.1,platform:["Hulu","Prime"] },{ title:"Andaz Apna Apna",year:1994,rating:8.1,platform:["Hotstar","Prime"] },{ title:"Dhamaal",year:2007,rating:7.3,platform:["Hotstar","ZEE5"] }],
    thriller:  [{ title:"Parasite",year:2019,rating:8.6,platform:["Prime","Hulu"] },{ title:"Oldboy",year:2003,rating:8.4,platform:["Hulu","Mubi"] },{ title:"Drishyam 2",year:2022,rating:8.1,platform:["Prime"] }],
    sci_fi:    [{ title:"Interstellar",year:2014,rating:8.7,platform:["Paramount+","Netflix"] },{ title:"Arrival",year:2016,rating:7.9,platform:["Paramount+","Prime"] },{ title:"2001: A Space Odyssey",year:1968,rating:8.3,platform:["Prime","Mubi"] }],
    horror:    [{ title:"Get Out",year:2017,rating:7.7,platform:["Peacock","Prime"] },{ title:"The Conjuring",year:2013,rating:7.5,platform:["Max","Prime"] },{ title:"A Quiet Place",year:2018,rating:7.5,platform:["Prime","Paramount+"] }],
    romance:   [{ title:"Before Sunrise",year:1995,rating:8.1,platform:["Hulu","Mubi"] },{ title:"Dilwale Dulhania Le Jayenge",year:1995,rating:8.1,platform:["Netflix","Prime"] }],
    animation: [{ title:"Spirited Away",year:2001,rating:8.6,platform:["Netflix","Max"] },{ title:"Spider-Man: Into the Spider-Verse",year:2018,rating:8.4,platform:["Netflix"] }],
    documentary:[{ title:"Icarus",year:2017,rating:7.9,platform:["Netflix"] },{ title:"13th",year:2016,rating:8.2,platform:["Netflix"] },{ title:"The Social Dilemma",year:2020,rating:7.6,platform:["Netflix"] }],
    bollywood: [{ title:"3 Idiots",year:2009,rating:8.4,platform:["Netflix","Prime"] },{ title:"Lagaan",year:2001,rating:8.1,platform:["Prime","Hotstar"] },{ title:"Gully Boy",year:2019,rating:7.9,platform:["Prime","Netflix"] }],
    hollywood: [{ title:"The Dark Knight",year:2008,rating:9.0,platform:["Max","Prime"] },{ title:"Inception",year:2010,rating:8.8,platform:["Netflix","Max"] }]
};

function recommend({ userId, genres = [], mood, language, minRating = 7, exclude = [], limit = 5 }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("movie_recommend", { userId, genres });

    const targetGenres = genres.length ? genres.map(g => g.toLowerCase().replace(/[^a-z_]/g,"_")) : ["action","drama","thriller"];
    const pool   = [];

    for (const genre of targetGenres) {
        const movies = MOVIE_DB[genre] || [];
        for (const m of movies) {
            if (m.rating >= minRating && !exclude.includes(m.title)) {
                pool.push({ ...m, genre });
            }
        }
    }

    // Mood adjustment
    if (mood) {
        const moodMap = { happy:"comedy", sad:"drama", excited:"action", scared:"horror", thoughtful:"sci_fi" };
        const moodGenre = moodMap[mood.toLowerCase()];
        if (moodGenre && MOVIE_DB[moodGenre]) {
            pool.push(...MOVIE_DB[moodGenre].map(m => ({ ...m, genre: moodGenre })));
        }
    }

    const deduplicated = [...new Map(pool.map(m => [m.title, m])).values()];
    const sorted       = deduplicated.sort((a, b) => b.rating - a.rating).slice(0, limit);

    // Save to watch history preferences
    const prefs = load(userId, "movie_prefs", { genres: [], watchList: [] });
    prefs.genres  = [...new Set([...(prefs.genres || []), ...targetGenres])].slice(0, 20);
    flush(userId, "movie_prefs", prefs);

    return ok(AGENT, { recommendations: sorted, total: sorted.length, basedOn: { genres: targetGenres, mood, minRating } });
}

function addToWatchlist({ userId, title, platform }) {
    if (!userId || !title) return fail(AGENT, "userId and title required");
    const prefs = load(userId, "movie_prefs", { genres: [], watchList: [] });
    if (!(prefs.watchList || []).find(w => w.title === title)) {
        prefs.watchList = [...(prefs.watchList || []), { title, platform, addedAt: NOW() }];
        flush(userId, "movie_prefs", prefs);
    }
    return ok(AGENT, { watchList: prefs.watchList, added: title });
}

module.exports = { recommend, addToWatchlist };
