"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "characterGenerator";

const ARCHETYPES = {
    hero:        { traits:["brave","determined","selfless"],      flaw:"reckless overconfidence" },
    villain:     { traits:["calculating","powerful","driven"],    flaw:"blind obsession" },
    mentor:      { traits:["wise","patient","mysterious"],        flaw:"secrets kept too long" },
    trickster:   { traits:["witty","adaptable","unpredictable"],  flaw:"unreliable loyalty" },
    everyman:    { traits:["relatable","resourceful","ordinary"], flaw:"self-doubt" },
    anti_hero:   { traits:["complex","skilled","morally grey"],   flaw:"selfishness" },
    caregiver:   { traits:["compassionate","nurturing","loyal"],  flaw:"martyrdom" },
    rebel:       { traits:["independent","charismatic","bold"],   flaw:"destructive impulse" }
};

const VISUAL_STYLES = ["anime","realistic","cartoon","pixel_art","comic_book","chibi","painterly","sketch"];

const VOICE_ARCHETYPES = ["deep_authoritative","high_energetic","soft_calm","raspy_mysterious","cheerful_bright","monotone_robotic"];

function generateCharacter({ userId, name, archetype = "hero", genre = "fantasy", visualStyle = "realistic", backstory, age, gender }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("character_generate", { userId, archetype });

    const archetypeKey = archetype.toLowerCase().replace(/[^a-z_]/g,"_");
    const arch         = ARCHETYPES[archetypeKey] || ARCHETYPES.hero;

    const character = {
        id:           uid("ch"),
        userId,
        name:         name || `Character_${uid("n")}`,
        archetype:    archetypeKey,
        age:          age || "Unknown",
        gender:       gender || "Any",
        genre,
        traits:       arch.traits,
        primaryFlaw:  arch.flaw,
        backstory:    backstory || `A ${archetypeKey} shaped by past hardship, driven to ${arch.traits[0]} action`,
        visualStyle,
        appearance: {
            build:      "Define: slim/athletic/stocky/etc.",
            hairColour: "Define hair colour and style",
            eyeColour:  "Define eye colour",
            distinctive:"Add one distinctive feature (scar, tattoo, prosthetic, etc.)",
            clothing:   "Describe outfit that reflects personality and world"
        },
        voice:        VOICE_ARCHETYPES[Math.floor(Math.random() * VOICE_ARCHETYPES.length)],
        motivations:  ["Primary goal: what they openly pursue", "Hidden desire: what they secretly want", "Fear: what they most dread"],
        relationships:[],
        createdAt:    NOW()
    };

    const characters = load(userId, "characters", []);
    characters.push(character);
    flush(userId, "characters", characters.slice(-200));

    return ok(AGENT, { character, renderNote: "Connect to image generation API (Midjourney/DALL-E/Stable Diffusion) for visual output" });
}

function addRelationship({ userId, characterId, relatedCharacterId, relatedName, relationshipType, description }) {
    if (!userId || !characterId) return fail(AGENT, "userId and characterId required");
    const characters = load(userId, "characters", []);
    const character  = characters.find(c => c.id === characterId);
    if (!character)  return fail(AGENT, "Character not found");

    character.relationships.push({ with: relatedName || relatedCharacterId, type: relationshipType, description, addedAt: NOW() });
    flush(userId, "characters", characters);

    return ok(AGENT, { characterId, relationships: character.relationships });
}

function getUserCharacters({ userId, genre }) {
    if (!userId) return fail(AGENT, "userId required");
    let chars = load(userId, "characters", []);
    if (genre) chars = chars.filter(c => c.genre === genre.toLowerCase());
    return ok(AGENT, chars.slice(-30).reverse());
}

function getArchetypes() {
    return ok(AGENT, { archetypes: ARCHETYPES, visualStyles: VISUAL_STYLES, voiceArchetypes: VOICE_ARCHETYPES });
}

module.exports = { generateCharacter, addRelationship, getUserCharacters, getArchetypes };
