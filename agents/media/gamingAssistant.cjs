"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "gamingAssistant";

const GAME_DB = {
    action:  [{ title:"GTA V",platform:["PC","PS5","Xbox"],genre:"open_world",rating:9.5 },{ title:"God of War",platform:["PS5","PC"],genre:"action_adventure",rating:9.0 },{ title:"Ghost of Tsushima",platform:["PS5","PC"],genre:"action",rating:9.0 }],
    fps:     [{ title:"Valorant",platform:["PC"],genre:"tactical_fps",rating:8.5,freeToPlay:true },{ title:"CS2",platform:["PC"],genre:"tactical_fps",rating:8.3,freeToPlay:true },{ title:"Apex Legends",platform:["PC","PS5","Xbox"],genre:"battle_royale",rating:8.0,freeToPlay:true }],
    rpg:     [{ title:"Elden Ring",platform:["PC","PS5","Xbox"],genre:"action_rpg",rating:9.5 },{ title:"The Witcher 3",platform:["PC","PS5","Xbox","Switch"],genre:"rpg",rating:9.8 },{ title:"Baldur's Gate 3",platform:["PC","PS5"],genre:"crpg",rating:9.6 }],
    mobile:  [{ title:"BGMI",platform:["Android","iOS"],genre:"battle_royale",rating:8.0,freeToPlay:true },{ title:"Free Fire",platform:["Android","iOS"],genre:"battle_royale",rating:7.5,freeToPlay:true },{ title:"Clash of Clans",platform:["Android","iOS"],genre:"strategy",rating:7.8,freeToPlay:true }],
    indie:   [{ title:"Hollow Knight",platform:["PC","Switch"],genre:"metroidvania",rating:9.0 },{ title:"Celeste",platform:["PC","Switch"],genre:"platformer",rating:9.0 },{ title:"Hades",platform:["PC","PS5","Switch"],genre:"roguelite",rating:9.5 }],
    strategy:[{ title:"Civilization VI",platform:["PC"],genre:"4x_strategy",rating:8.5 },{ title:"Total War: Warhammer III",platform:["PC"],genre:"rts",rating:8.2 }],
    sports:  [{ title:"FC 24",platform:["PC","PS5","Xbox"],genre:"football",rating:7.5 },{ title:"NBA 2K24",platform:["PC","PS5","Xbox"],genre:"basketball",rating:7.0 }]
};

const TIPS = {
    valorant:   ["Play in a dark room to reduce glare","Practice aim in The Range daily (30 min)","Learn callouts for each map","Play Deathmatch to warm up","Crosshair placement is more important than flicking"],
    bgmi:       ["Land in Pochinki or Georgopol for high action","Use 4x scope for medium range","Prone in grass with gillie suit","Always carry smoke grenades","Play in school for loot and practice"],
    elden_ring: ["Level Vigor to at least 40 first","Explore before progressing main story","Spirit ashes make bosses easier","Don't skip side dungeons — great gear","If stuck: explore a different area first"],
    default:    ["Warm up before ranked matches","Take breaks every 90 minutes","Watch pro gameplay for your main game","Focus on one mechanic at a time to improve"]
};

function recommendGames({ userId, platform, genre, freeToPlay = false, rating = 7 }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("game_recommend", { userId, genre, platform });

    const key    = (genre || "action").toLowerCase().replace(/\s+/g,"_");
    let games    = (GAME_DB[key] || []).concat(GAME_DB.action || []);
    if (platform) games = games.filter(g => g.platform.some(p => p.toLowerCase() === platform.toLowerCase()));
    if (freeToPlay) games = games.filter(g => g.freeToPlay);
    games = games.filter(g => g.rating >= rating);

    return ok(AGENT, { recommendations: [...new Map(games.map(g => [g.title, g])).values()].slice(0, 8), filters: { platform, genre, freeToPlay, minRating: rating } });
}

function getGamingTips({ userId, game }) {
    if (!userId || !game) return fail(AGENT, "userId and game required");
    trackEvent("gaming_tips", { userId, game });

    const key    = game.toLowerCase().replace(/\s+/g,"_");
    const matched = Object.entries(TIPS).find(([k]) => key.includes(k) || k.includes(key));
    const tips   = matched ? matched[1] : TIPS.default;

    return ok(AGENT, { game, tips, source: "community strategies (not affiliated with game developer)" });
}

function logSession({ userId, game, durationMinutes, outcome, notes = "" }) {
    if (!userId || !game) return fail(AGENT, "userId and game required");
    const log   = load(userId, "game_sessions", []);
    const entry = { id: uid("gs"), game, durationMinutes, outcome, notes, date: NOW().slice(0,10), loggedAt: NOW() };
    log.push(entry);
    flush(userId, "game_sessions", log.slice(-500));
    const total   = log.filter(s => s.game === game).length;
    const wins    = log.filter(s => s.game === game && s.outcome === "win").length;
    return ok(AGENT, { entry, stats: { totalSessions: total, wins, winRate: total ? Math.round(wins/total*100) + "%" : "N/A" } });
}

module.exports = { recommendGames, getGamingTips, logSession };
