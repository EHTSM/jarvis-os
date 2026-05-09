"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "storyGenerator";

const STORY_STRUCTURES = {
    three_act:   { acts:["Setup","Confrontation","Resolution"], description:"Classic Hollywood structure" },
    hero_journey:{ acts:["Ordinary World","Call to Adventure","Refusal","Mentor","Crossing Threshold","Tests","Ordeal","Reward","Road Back","Resurrection","Return"], description:"Joseph Campbell's monomyth" },
    five_act:    { acts:["Exposition","Rising Action","Climax","Falling Action","Denouement"], description:"Shakespearean dramatic structure" },
    kishotenketsu:{ acts:["Ki (Introduction)","Sho (Development)","Ten (Twist)","Ketsu (Conclusion)"], description:"Japanese 4-act structure (no conflict required)" },
    freytag:     { acts:["Exposition","Rising Action","Climax","Falling Action","Catastrophe/Resolution"], description:"Freytag's Pyramid" }
};

const GENRE_HOOKS = {
    thriller:   ["A phone rings at 3am — the caller ID shows your own number","The detective realises the killer has been one step ahead — because they read the case file"],
    romance:    ["They meet for the first time — at the altar, marrying other people","Enemies forced to share a small apartment to avoid a storm"],
    sci_fi:     ["First contact — but the message is a warning, not a greeting","A time traveller arrives in the past to prevent their own invention"],
    horror:     ["The babysitter's calls are coming from inside the house","The town has no children — and nobody will explain why"],
    fantasy:    ["The chosen one refuses the prophecy — and a nobody must save the world","Magic has died — but one blacksmith still hears it whispering in metal"],
    mystery:    ["The murder weapon is a book — the words on the last page are the cause of death","Everyone in the sealed mansion is innocent — because the victim killed themselves to frame someone"],
    comedy:     ["A mistaken identity leads to the most absurd week of two strangers' lives","A wedding planner falls for the groom — whose fake fiancée is the planner's best friend"]
};

function generateStory({ userId, genre, premise, structure = "three_act", characters = [], length = "short", targetAudience = "general" }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("story_generate", { userId, genre });

    const genreKey  = (genre || "thriller").toLowerCase();
    const struct    = STORY_STRUCTURES[structure] || STORY_STRUCTURES.three_act;
    const hooks     = GENRE_HOOKS[genreKey] || GENRE_HOOKS.thriller;
    const hook      = hooks[Math.floor(Math.random() * hooks.length)];

    const wordCounts = { flash:"100-500 words", short:"500-2000 words", novelette:"2000-7500 words", novella:"7500-40000 words" };

    const story = {
        id:             uid("st"),
        userId,
        genre:          genreKey,
        premise:        premise || hook,
        structure:      struct.description,
        acts:           struct.acts.map((act, i) => ({
            act:        act,
            order:      i + 1,
            guidance:   `Develop your story's ${act.toLowerCase()} here`,
            wordTarget: Math.round((parseInt(wordCounts[length] || "1000") || 1000) / struct.acts.length)
        })),
        characters:     characters.length ? characters : [
            { role:"Protagonist", archetype:"The Hero", motivation:"Survival/love/justice" },
            { role:"Antagonist",  archetype:"The Shadow", motivation:"Power/revenge/fear" },
            { role:"Mentor",      archetype:"The Wise One", motivation:"Guide the hero" }
        ],
        targetAudience,
        targetLength:   wordCounts[length] || wordCounts.short,
        suggestedHook:  hook,
        createdAt:      NOW()
    };

    const stories = load(userId, "stories", []);
    stories.push(story);
    flush(userId, "stories", stories.slice(-100));

    return ok(AGENT, { story, promptSeed: `Write a ${genreKey} story. Hook: "${hook}". Structure: ${struct.description}.` });
}

function getStoryPrompt({ userId, genre, style }) {
    if (!userId) return fail(AGENT, "userId required");
    const genreKey = (genre || "thriller").toLowerCase();
    const hooks    = GENRE_HOOKS[genreKey] || GENRE_HOOKS.thriller;
    return ok(AGENT, {
        genre: genreKey,
        prompts: hooks,
        structures: Object.entries(STORY_STRUCTURES).map(([k, v]) => ({ key: k, ...v }))
    });
}

function getUserStories({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    return ok(AGENT, load(userId, "stories", []).slice(-20).reverse());
}

module.exports = { generateStory, getStoryPrompt, getUserStories };
