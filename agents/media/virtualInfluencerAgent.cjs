"use strict";
const { load, flush, uid, NOW, ok, fail, blocked, trackEvent, requireSafeContext } = require("./_mediaStore.cjs");
const AGENT = "virtualInfluencerAgent";

const PERSONA_TYPES = {
    fashion:     { niches:["streetwear","luxury","sustainable"], platforms:["Instagram","TikTok","Pinterest"] },
    gaming:      { niches:["fps","rpg","speedrun","variety"],    platforms:["Twitch","YouTube","TikTok"] },
    lifestyle:   { niches:["wellness","travel","food","fitness"],platforms:["Instagram","YouTube","TikTok"] },
    tech:        { niches:["reviews","tutorials","ai","gadgets"],platforms:["YouTube","Twitter","LinkedIn"] },
    music:       { niches:["pop","hiphop","electronic","indie"], platforms:["TikTok","Instagram","Spotify"] },
    education:   { niches:["science","history","language","math"],platforms:["YouTube","TikTok","Instagram"] }
};

function createPersona({ userId, name, personaType, niche, backstory, visualStyle, voiceStyle, platforms = [], isBasedOnRealPerson = false, consent = false, watermark }) {
    if (!userId || !name) return fail(AGENT, "userId and name required");

    // SAFETY: only block if explicitly based on a real person's likeness (requires consent + watermark)
    if (isBasedOnRealPerson) {
        const safetyCheck = requireSafeContext({ consent, source: "virtualInfluencerAgent", watermark, contentType: "avatar" });
        if (!safetyCheck.safe) return blocked(AGENT, safetyCheck.reason);
    }

    trackEvent("virtual_influencer_create", { userId, personaType });

    const typeKey = (personaType || "lifestyle").toLowerCase();
    const typeDef = PERSONA_TYPES[typeKey] || PERSONA_TYPES.lifestyle;

    const persona = {
        id:          uid("vi"),
        userId,
        name,
        personaType: typeKey,
        niche:       niche || typeDef.niches[0],
        backstory:   backstory || `${name} is a virtual ${typeKey} influencer with a passion for ${niche || typeDef.niches[0]}`,
        visualStyle: visualStyle || "anime",
        voiceStyle:  voiceStyle || "energetic",
        platforms:   platforms.length ? platforms : typeDef.platforms,
        contentPillars: ["Educational posts","Behind-the-scenes","Product features","Community Q&A","Trend participation"],
        postingSchedule:{ frequency:"4-5x/week", bestTimes:["7-9am","12-1pm","7-9pm"] },
        disclaimer:  "This is a fictional virtual character. AI-generated content.",
        consentOnFile: consent,
        watermark,
        status:      "draft",
        createdAt:   NOW()
    };

    const personas = load(userId, "virtual_influencers", []);
    personas.push(persona);
    flush(userId, "virtual_influencers", personas.slice(-20));

    return ok(AGENT, { persona, notice: "All posts by virtual influencers must include an AI disclosure label per FTC/ASA guidelines." });
}

function generateContentPlan({ userId, personaId, weeks = 4, platform }) {
    if (!userId || !personaId) return fail(AGENT, "userId and personaId required");
    const personas = load(userId, "virtual_influencers", []);
    const persona  = personas.find(p => p.id === personaId);
    if (!persona)  return fail(AGENT, "Persona not found");

    const plan = [];
    for (let w = 1; w <= weeks; w++) {
        for (let d = 1; d <= 5; d++) {
            const pillar = persona.contentPillars[(w * d) % persona.contentPillars.length];
            plan.push({
                week: w, day: d,
                platform: platform || persona.platforms[0],
                contentType: d % 2 === 0 ? "video" : "image",
                pillar,
                caption: `[Draft] ${persona.name} — ${pillar} | #${persona.niche.replace(/\s+/g,"")} #VirtualInfluencer #AIGenerated`,
                disclosure: "⚠️ Virtual AI character | Disclosure required by FTC/ASA"
            });
        }
    }

    return ok(AGENT, { personaId, plan, notice: "Always include #AIGenerated and #VirtualInfluencer disclosures in captions." });
}

function getPersonas({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    return ok(AGENT, load(userId, "virtual_influencers", []).slice(-10).reverse());
}

module.exports = { createPersona, generateContentPlan, getPersonas };
