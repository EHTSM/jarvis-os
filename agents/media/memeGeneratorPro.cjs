"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "memeGeneratorPro";

const MEME_TEMPLATES = {
    drake:          { name:"Drake Approving/Disapproving", panels:2, texts:["Top (disapprove)","Bottom (approve)"], aspectRatio:"1:1" },
    distracted_bf:  { name:"Distracted Boyfriend", panels:3, texts:["Girlfriend","Boyfriend","Other Woman"], aspectRatio:"16:9" },
    this_is_fine:   { name:"This is Fine", panels:1, texts:["Caption"], aspectRatio:"4:3" },
    expanding_brain:{ name:"Expanding Brain", panels:4, texts:["Small brain","Medium brain","Big brain","Galaxy brain"], aspectRatio:"9:16" },
    two_buttons:    { name:"Two Buttons", panels:1, texts:["Button 1","Button 2","Sweating guy"], aspectRatio:"1:1" },
    uno_reverse:    { name:"UNO Reverse Card", panels:1, texts:["Situation being reversed"], aspectRatio:"1:1" },
    surprised_pikachu: { name:"Surprised Pikachu", panels:1, texts:["Setup context","Surprised face"], aspectRatio:"16:9" },
    left_exit:      { name:"Left Exit 12 Off Ramp", panels:1, texts:["Main road label","Off ramp label","Car label"], aspectRatio:"4:3" },
    wojak:          { name:"Doomer Wojak", panels:1, texts:["Situation text"], aspectRatio:"1:1" },
    change_my_mind: { name:"Change My Mind", panels:1, texts:["Statement on sign"], aspectRatio:"16:9" }
};

const TRENDING_FORMATS = ["drake","distracted_bf","expanding_brain","surprised_pikachu","two_buttons"];

function generateMeme({ userId, template, texts = [], topic, style = "classic" }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("meme_generate", { userId, template });

    const key      = (template || "drake").toLowerCase().replace(/\s+/g,"_");
    const tmpl     = MEME_TEMPLATES[key] || MEME_TEMPLATES.drake;
    const allTexts = texts.length ? texts : tmpl.texts;

    if (texts.length && tmpl.texts.length > 1 && texts.length < tmpl.texts.length) {
        return fail(AGENT, `Template "${tmpl.name}" needs ${tmpl.texts.length} text panels: ${tmpl.texts.join(", ")}`);
    }

    const meme = {
        id:          uid("mm"),
        userId,
        template:    tmpl.name,
        templateKey: key,
        texts:       allTexts,
        topic,
        style,
        aspectRatio: tmpl.aspectRatio,
        exportFormats: ["PNG","JPEG","GIF","WebP"],
        renderNote:  "Connect to imgflip API or local canvas renderer to produce actual image",
        createdAt:   NOW()
    };

    const memes = load(userId, "memes", []);
    memes.push(meme);
    flush(userId, "memes", memes.slice(-200));

    return ok(AGENT, {
        meme,
        imgflipEndpoint: "https://api.imgflip.com/caption_image",
        suggestedHashtags: topic ? [`#${topic.replace(/\s+/g,"")}`, "#meme", "#funny", "#trending"] : ["#meme","#funny","#trending"]
    });
}

function getTrendingTemplates({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    return ok(AGENT, {
        trending: TRENDING_FORMATS.map(k => ({ key: k, ...MEME_TEMPLATES[k] })),
        all:      Object.entries(MEME_TEMPLATES).map(([k, v]) => ({ key: k, name: v.name, panels: v.panels }))
    });
}

function getUserMemes({ userId, limit = 20 }) {
    if (!userId) return fail(AGENT, "userId required");
    return ok(AGENT, load(userId, "memes", []).slice(-limit).reverse());
}

function remixMeme({ userId, originalMemeId, newTexts }) {
    if (!userId || !originalMemeId) return fail(AGENT, "userId and originalMemeId required");
    const memes    = load(userId, "memes", []);
    const original = memes.find(m => m.id === originalMemeId);
    if (!original)  return fail(AGENT, "Original meme not found");

    return generateMeme({ userId, template: original.templateKey, texts: newTexts || original.texts, topic: original.topic, style: original.style });
}

module.exports = { generateMeme, getTrendingTemplates, getUserMemes, remixMeme };
