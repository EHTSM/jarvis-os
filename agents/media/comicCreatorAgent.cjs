"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "comicCreatorAgent";

const PANEL_LAYOUTS = {
    single:       { panels:1, layout:"full page", use:"splash pages, dramatic moments" },
    "2_equal":    { panels:2, layout:"side by side", use:"contrast, parallel action" },
    "3_strip":    { panels:3, layout:"horizontal strip", use:"newspaper comics, webcomics" },
    "4_grid":     { panels:4, layout:"2x2 grid", use:"balanced pacing" },
    "6_classic":  { panels:6, layout:"2x3 grid", use:"standard comic page" },
    "action_dynamic":{ panels:5, layout:"irregular overlapping", use:"fight scenes, drama" }
};

const BUBBLE_TYPES = {
    speech:    "Regular dialogue",
    thought:   "Internal monologue (cloud shape)",
    whisper:   "Dashed border, smaller font",
    shout:     "Jagged border, CAPS",
    narration: "Caption box, rectangular",
    sound_fx:  "Bold stylised text (BOOM, POW)"
};

const COMIC_STYLES = ["superhero","manga","newspaper_strip","webcomic","graphic_novel","chibi","realistic","watercolour"];

function createComicScript({ userId, title, genre = "superhero", synopsis, panels = 6, characters = [], style = "superhero" }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("comic_create", { userId, genre });

    const layoutKey  = Object.keys(PANEL_LAYOUTS).find(k => PANEL_LAYOUTS[k].panels === panels) || "6_classic";
    const layout     = PANEL_LAYOUTS[layoutKey];

    const script = {
        id:        uid("co"),
        userId,
        title,
        genre,
        synopsis:  synopsis || "Enter your story synopsis here",
        style,
        layout:    layout,
        panels:    Array.from({ length: panels }, (_, i) => ({
            number:       i + 1,
            description:  `Panel ${i + 1}: Describe the scene, action, and mood`,
            dialogue:     [],
            soundFx:      [],
            cameraAngle:  i === 0 ? "establishing_shot" : "medium_shot",
            mood:         "neutral"
        })),
        characters: characters.length ? characters : [
            { name:"Hero",     design:"Describe costume and appearance" },
            { name:"Sidekick", design:"Describe appearance" },
            { name:"Villain",  design:"Describe threatening appearance" }
        ],
        bubbleTypes: BUBBLE_TYPES,
        exportFormats: ["PDF","CBZ","PNG sequence","WebP sequence"],
        createdAt: NOW()
    };

    const comics = load(userId, "comics", []);
    comics.push(script);
    flush(userId, "comics", comics.slice(-50));

    return ok(AGENT, { comic: script, renderNote: "Use comigo/webtoon/tapas APIs or a PDF renderer for final output", styleOptions: COMIC_STYLES });
}

function addDialogue({ userId, comicId, panelNumber, speaker, text, bubbleType = "speech" }) {
    if (!userId || !comicId) return fail(AGENT, "userId and comicId required");
    const comics = load(userId, "comics", []);
    const comic  = comics.find(c => c.id === comicId);
    if (!comic)  return fail(AGENT, "Comic not found");
    const panel  = comic.panels.find(p => p.number === panelNumber);
    if (!panel)  return fail(AGENT, `Panel ${panelNumber} not found`);

    panel.dialogue.push({ speaker, text, bubbleType, addedAt: NOW() });
    flush(userId, "comics", comics);

    return ok(AGENT, { comicId, panelNumber, dialogue: panel.dialogue });
}

function getLayouts() {
    return ok(AGENT, { layouts: PANEL_LAYOUTS, styles: COMIC_STYLES, bubbleTypes: BUBBLE_TYPES });
}

module.exports = { createComicScript, addDialogue, getLayouts };
