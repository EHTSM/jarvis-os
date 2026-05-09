"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "avatarCreatorPro";

const AVATAR_STYLES = {
    realistic:   { description:"Photorealistic portrait", renderEngine:"Stable Diffusion/DALL-E", useCase:"professional profiles" },
    cartoon:     { description:"Stylised cartoon",        renderEngine:"Cartoonify/Custom model",  useCase:"social media, gaming" },
    anime:       { description:"Anime/manga style",       renderEngine:"NovelAI/Waifu Diffusion",  useCase:"gaming, fanart" },
    pixel:       { description:"8-bit pixel art",         renderEngine:"PixelMind",                useCase:"retro gaming, Discord" },
    "3d_render": { description:"3D rendered avatar",      renderEngine:"Ready Player Me / VRM",    useCase:"metaverse, VR" },
    chibi:       { description:"Cute super-deformed",     renderEngine:"Custom model",             useCase:"stickers, emoji packs" },
    watercolour: { description:"Soft painterly style",    renderEngine:"Midjourney",               useCase:"artistic profiles" },
    line_art:    { description:"Clean line illustration", renderEngine:"Inkscape/custom",          useCase:"branding, logos" }
};

const AVATAR_PARTS = {
    face:    ["oval","round","square","heart","diamond"],
    eyes:    ["round","almond","hooded","upturned","monolid"],
    hair:    ["short","medium","long","curly","wavy","straight","buzz_cut","bun","braids","dreadlocks"],
    skin:    ["fair","light","medium","tan","brown","dark"],
    expression:["neutral","smiling","serious","playful","determined","mysterious"]
};

function createAvatar({ userId, style = "cartoon", name, customisation = {}, platform = "general", exportSize = "512x512" }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("avatar_create", { userId, style });

    const styleKey = style.toLowerCase().replace(/\s+/g,"_");
    const styleDef = AVATAR_STYLES[styleKey] || AVATAR_STYLES.cartoon;

    const avatar = {
        id:          uid("av"),
        userId,
        name:        name || "My Avatar",
        style:       styleKey,
        styleInfo:   styleDef,
        platform,
        exportSize,
        customisation: {
            faceShape:  customisation.faceShape  || "oval",
            eyeShape:   customisation.eyeShape   || "almond",
            hairStyle:  customisation.hairStyle  || "medium",
            skinTone:   customisation.skinTone   || "medium",
            expression: customisation.expression || "smiling",
            accessories: customisation.accessories || [],
            outfit:      customisation.outfit || "casual",
            background:  customisation.background || "gradient",
            ...customisation
        },
        exportFormats:["PNG","SVG","WebP","GIF (animated)","GLB (3D, if applicable)"],
        platforms:   { "Ready Player Me":"readyplayer.me", "VRoid Hub":"hub.vroid.com", "Lofty.ai":"lofty.ai" },
        renderNote:  `Use ${styleDef.renderEngine} to generate final output`,
        createdAt:   NOW()
    };

    const avatars = load(userId, "avatars", []);
    avatars.push(avatar);
    flush(userId, "avatars", avatars.slice(-50));

    return ok(AGENT, { avatar, parts: AVATAR_PARTS });
}

function getAvatarStyles() {
    return ok(AGENT, { styles: AVATAR_STYLES, customisationParts: AVATAR_PARTS });
}

function getUserAvatars({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    return ok(AGENT, load(userId, "avatars", []).slice(-10).reverse());
}

function updateAvatar({ userId, avatarId, updates }) {
    if (!userId || !avatarId) return fail(AGENT, "userId and avatarId required");
    const avatars = load(userId, "avatars", []);
    const avatar  = avatars.find(a => a.id === avatarId);
    if (!avatar)  return fail(AGENT, "Avatar not found");

    avatar.customisation = { ...avatar.customisation, ...updates };
    avatar.updatedAt     = NOW();
    flush(userId, "avatars", avatars);

    return ok(AGENT, { avatar });
}

module.exports = { createAvatar, getAvatarStyles, getUserAvatars, updateAvatar };
