"use strict";
const { load, flush, uid, NOW, ok, fail, blocked, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "copyrightChecker";

// SAFETY AGENT: Must run BEFORE publish for all media content.

const KNOWN_LABELS = ["Universal Music Group","Sony Music","Warner Music Group","T-Series","YRF","Zee Music","Tips Music","Sony Pictures","Warner Bros","Disney","Paramount","Netflix Originals","Amazon Originals"];
const SAFE_LICENSES = ["CC0","CC-BY","CC-BY-SA","CC-BY-ND","Public Domain","Royalty Free (purchased)","Original (user-created)","Open Source Audio"];

const RISKY_PATTERNS = [
    { pattern:/\b(bollywood|hindi film)\b/i,         risk:"MEDIUM", note:"Bollywood tracks are usually claimed by T-Series/Zee/YRF" },
    { pattern:/\b(hollywood|marvel|disney|dc)\b/i,   risk:"HIGH",   note:"Major studio IP — high claim/takedown risk" },
    { pattern:/\b(trending|viral|popular)\s+song\b/i,risk:"HIGH",   note:"Popular songs are almost always claimed by major labels" },
    { pattern:/\b(background music|bgm)\b/i,         risk:"MEDIUM", note:"BGM must be licensed or royalty-free" }
];

function checkAsset({ userId, contentId, assetType, assetName, license, source, artist, label }) {
    if (!userId || !assetType || !assetName) return fail(AGENT, "userId, assetType, assetName required");
    trackEvent("copyright_check", { userId, assetType, assetName });

    const flags    = [];
    let   riskLevel= "LOW";

    if (license && SAFE_LICENSES.some(l => license.toUpperCase().includes(l.toUpperCase()))) {
        flags.push({ type:"safe_license", note: `License "${license}" is cleared for use` });
    } else if (!license) {
        flags.push({ type:"no_license", risk:"HIGH", note:"No license specified — do not publish without clearing rights" });
        riskLevel = "HIGH";
    }

    if (label && KNOWN_LABELS.some(l => label.toLowerCase().includes(l.toLowerCase()))) {
        flags.push({ type:"major_label", risk:"HIGH", note:`"${label}" content is likely ContentID-claimed` });
        riskLevel = "HIGH";
    }

    for (const { pattern, risk, note } of RISKY_PATTERNS) {
        if (pattern.test(assetName + " " + (source || ""))) {
            flags.push({ type:"keyword_risk", risk, note });
            if (risk === "HIGH") riskLevel = "HIGH";
            else if (risk === "MEDIUM" && riskLevel !== "HIGH") riskLevel = "MEDIUM";
        }
    }

    const approved = riskLevel !== "HIGH";
    const record   = {
        id:         uid("cr"),
        userId,
        contentId,
        assetType,
        assetName,
        license:    license || "UNKNOWN",
        source,
        artist,
        label,
        flags,
        riskLevel,
        approved,
        checkedAt:  NOW()
    };

    const checks = load(userId, "copyright_checks", []);
    checks.push(record);
    flush(userId, "copyright_checks", checks.slice(-1000));

    if (!approved) {
        return blocked(AGENT, `HIGH copyright risk for "${assetName}". ${flags.map(f => f.note).join(" | ")} Use royalty-free or original assets.`);
    }

    return ok(AGENT, {
        record,
        clearanceStatus: riskLevel === "LOW" ? "CLEARED" : "PROCEED_WITH_CAUTION",
        safeSources: ["Epidemic Sound","Artlist","Pixabay Music","ccMixter","Free Music Archive","Incompetech"]
    });
}

function checkMultipleAssets({ userId, contentId, assets = [] }) {
    if (!userId || !assets.length) return fail(AGENT, "userId and assets array required");
    const results  = assets.map(a => checkAsset({ userId, contentId, ...a }));
    const blocked_ = results.filter(r => r.status === 403);
    const cleared  = results.filter(r => r.status !== 403);

    return ok(AGENT, {
        total:    assets.length,
        cleared:  cleared.length,
        blocked:  blocked_.length,
        canPublish: blocked_.length === 0,
        results
    });
}

function getCopyrightLog({ userId, riskLevel }) {
    if (!userId) return fail(AGENT, "userId required");
    let log = load(userId, "copyright_checks", []);
    if (riskLevel) log = log.filter(r => r.riskLevel === riskLevel.toUpperCase());
    return ok(AGENT, log.slice(-50).reverse());
}

module.exports = { checkAsset, checkMultipleAssets, getCopyrightLog };
