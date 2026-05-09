"use strict";
const { ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "ottAggregatorAgent";

const PLATFORMS = {
    netflix:    { name:"Netflix",    price:"₹149-649/mo", url:"netflix.com",    content:["movies","series","anime","documentaries"], regions:["IN","US","UK","global"] },
    prime:      { name:"Prime Video",price:"₹179/mo",     url:"primevideo.com", content:["movies","series","sports","originals"],    regions:["IN","US","UK","global"] },
    hotstar:    { name:"Disney+ Hotstar",price:"₹299-899/mo",url:"hotstar.com", content:["movies","series","sports","live","disney"],regions:["IN"] },
    zee5:       { name:"ZEE5",       price:"₹99-999/mo",  url:"zee5.com",       content:["movies","series","originals","live_tv"],   regions:["IN"] },
    sonyliv:    { name:"SonyLIV",    price:"₹199-999/mo", url:"sonyliv.com",    content:["movies","series","sports","originals"],    regions:["IN"] },
    jiocinema:  { name:"JioCinema",  price:"Free-₹999/mo",url:"jiocinema.com",  content:["movies","series","sports","live"],         regions:["IN"] },
    youtube:    { name:"YouTube Premium",price:"₹139/mo", url:"youtube.com",    content:["videos","music","originals","live"],        regions:["global"] },
    mubi:       { name:"MUBI",       price:"₹399/mo",     url:"mubi.com",       content:["arthouse","cinema","classics","docs"],     regions:["IN","global"] },
    apple_tv:   { name:"Apple TV+",  price:"₹99/mo",      url:"tv.apple.com",   content:["originals","movies","series"],             regions:["global"] },
    hbo_max:    { name:"Max (HBO)",  price:"$15.99/mo",   url:"max.com",         content:["movies","series","hbo","dc","warner"],    regions:["US","global"] }
};

// Title → platform mock lookup
const TITLE_AVAILABILITY = {
    "Sacred Games":         ["Netflix"],
    "Panchayat":            ["Prime"],
    "The Family Man":       ["Prime"],
    "Scam 1992":            ["SonyLIV"],
    "Mirzapur":             ["Prime"],
    "Delhi Crime":          ["Netflix"],
    "Aarya":                ["Hotstar"],
    "Mumbai Diaries":       ["Prime"],
    "Gullak":               ["SonyLIV"],
    "TVF Pitchers":         ["Prime","YouTube"],
    "Aspirants":            ["Prime","YouTube"],
    "The Boys":             ["Prime"],
    "Stranger Things":      ["Netflix"],
    "House of the Dragon":  ["Hotstar","Max"],
    "Wednesday":            ["Netflix"]
};

function listPlatforms({ userId, region = "IN", budget }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("ott_list", { userId, region });

    let platforms = Object.values(PLATFORMS).filter(p => p.regions.includes(region) || p.regions.includes("global"));
    if (budget === "free") platforms = platforms.filter(p => p.price.toLowerCase().includes("free"));

    return ok(AGENT, { platforms, region, total: platforms.length });
}

function findTitle({ userId, title }) {
    if (!userId || !title) return fail(AGENT, "userId and title required");
    trackEvent("ott_search", { userId, title });

    const lower    = title.toLowerCase();
    const exact    = TITLE_AVAILABILITY[title];
    const partial  = Object.entries(TITLE_AVAILABILITY).filter(([k]) => k.toLowerCase().includes(lower) && k !== title).map(([k, v]) => ({ title: k, platforms: v }));

    return ok(AGENT, {
        title,
        platforms:   exact || [],
        found:       !!(exact),
        similar:     partial.slice(0, 3),
        tip:         exact ? `"${title}" is available on: ${exact.join(", ")}` : "Title not in local database. Check JustWatch.com for complete availability.",
        justwatch:   `justwatch.com/in/search?q=${encodeURIComponent(title)}`
    });
}

function compareSubscriptions({ userId, titles = [] }) {
    if (!userId) return fail(AGENT, "userId required");
    const coverage = {};
    for (const title of titles) {
        const platforms = TITLE_AVAILABILITY[title] || [];
        for (const p of platforms) {
            coverage[p] = (coverage[p] || 0) + 1;
        }
    }
    const ranked = Object.entries(coverage).sort((a,b) => b[1]-a[1]).map(([p, count]) => ({ platform: p, covers: count, ofTotal: titles.length }));
    return ok(AGENT, { titles, coverageByPlatform: ranked, recommendation: ranked[0] ? `${ranked[0].platform} covers the most titles (${ranked[0].covers}/${titles.length})` : "No overlap found" });
}

module.exports = { listPlatforms, findTitle, compareSubscriptions };
