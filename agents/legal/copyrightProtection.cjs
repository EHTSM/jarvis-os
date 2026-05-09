"use strict";
const { load, flush, uid, NOW, auditLog, ok, fail } = require("./_legalStore.cjs");
const AGENT = "copyrightProtection";

const PROTECTABLE = ["literary works","artistic works","musical works","cinematographic films","sound recordings","broadcasts","computer programs","databases","architectural works"];
const NOT_PROTECTABLE = ["ideas","facts","titles","names","slogans","styles","methods","algorithms (as such)","government documents (India — not protected)"];

const TAKEDOWN_PLATFORMS = {
    youtube:    { name:"YouTube",  process:"Content ID system + copyright.youtube.com",      timeframe:"24-72 hours" },
    instagram:  { name:"Instagram",process:"instagram.com/help/copyright",                   timeframe:"24-48 hours" },
    facebook:   { name:"Facebook", process:"facebook.com/help/copyright",                    timeframe:"24-48 hours" },
    twitter:    { name:"Twitter/X",process:"help.twitter.com/forms/dmca",                    timeframe:"24-72 hours" },
    google:     { name:"Google",   process:"dmca.google.com — for search indexing removal",  timeframe:"1-7 days" },
    amazon:     { name:"Amazon",   process:"Amazon IP Policy form",                          timeframe:"2-5 days" }
};

function registerCopyrightAsset({ userId, assetTitle, assetType, creationDate, authorName, description }) {
    if (!userId || !assetTitle) return fail(AGENT, "userId and assetTitle required");
    auditLog(AGENT, userId, "copyright_registered", { assetTitle, assetType });

    const asset = {
        id:          uid("cop"),
        userId,
        assetTitle,
        assetType,
        authorName,
        description,
        creationDate:creationDate || NOW().slice(0,10),
        registeredAt:NOW(),
        copyrightNotice:`© ${new Date().getFullYear()} ${authorName || "[Author Name]"}. All rights reserved.`,
        status:      "registered_in_jarvis",
        officialRegistration:"File at copyright.gov.in (India) or copyright.gov (USA) for official record",
        protectionTips:["Use © notice on all published works","Timestamp your work (email to yourself, git commits, blockchain)","Keep creation drafts and records","Register officially for court evidence benefits"]
    };

    const assets = load(userId, "copyright_assets", []);
    assets.push(asset);
    flush(userId, "copyright_assets", assets.slice(-500));

    return ok(AGENT, asset);
}

function generateTakedownNotice({ userId, assetTitle, infringingUrl, platform, rightsOwner }) {
    if (!userId || !assetTitle || !infringingUrl) return fail(AGENT, "userId, assetTitle, infringingUrl required");
    auditLog(AGENT, userId, "takedown_generated", { platform, infringingUrl });

    const platformInfo = TAKEDOWN_PLATFORMS[platform?.toLowerCase()] || { name: platform, process: "Contact platform's IP team", timeframe: "Varies" };

    const notice = {
        id:         uid("td"),
        type:       "DMCA / Copyright Infringement Notice",
        date:       new Date().toISOString().slice(0,10),
        to:         `${platformInfo.name} Trust & Safety`,
        from:       rightsOwner || "[YOUR NAME/COMPANY]",
        subject:    `Notice of Copyright Infringement — "${assetTitle}"`,
        body:       `I am the copyright owner of "${assetTitle}" (or authorised to act on behalf of the owner). I have identified that this work is being infringed at:\n\n${infringingUrl}\n\nI have a good faith belief that the use of the material is not authorised by the copyright owner, its agent, or the law. The information in this notification is accurate, and under penalty of perjury, I am authorised to act on behalf of the copyright owner.\n\nPlease remove or disable access to the infringing material immediately.\n\nSigned: ${rightsOwner || "[SIGNATURE]"}\nDate: ${new Date().toISOString().slice(0,10)}`,
        submission: platformInfo.process,
        expectedTimeframe: platformInfo.timeframe
    };

    return ok(AGENT, { notice, disclaimer: "Have a lawyer review before sending if the matter is commercially significant." });
}

function getCopyrightInfo() {
    return ok(AGENT, { protectable: PROTECTABLE, notProtectable: NOT_PROTECTABLE, platforms: TAKEDOWN_PLATFORMS });
}

function getUserAssets({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    return ok(AGENT, load(userId, "copyright_assets", []));
}

module.exports = { registerCopyrightAsset, generateTakedownNotice, getCopyrightInfo, getUserAssets };
